import { resolveDataDir } from '../config.js';
import { InProcMemoryBackend } from '../store/memory-backend.js';
import { syncFiles } from '../store/memory-md-sync.js';
import { groupPendingBySession, loadPending, } from '../store/pending.js';
import { errDetail } from '../util/filelog.js';
import { runSceneConsolidation } from './l2.js';
import { migrateLegacySlots } from './slot-migrate.js';
import { relabelPass } from './relabel.js';
import { processSceneReclusterJobs } from './recluster.js';
import { annotateOrphanCandidates } from '../room-review.js';
import { runPersona } from './l3.js';
const IDLE_STATUS = {
    running: false,
    phase: 'idle',
    done: 0,
    total: 0,
    recordsBuilt: 0,
    relabel: null,
    sub: null,
    detail: null,
    cancelRequested: false,
    startedAt: null,
    finishedAt: null,
    error: null,
};
function groupSessions(buckets) {
    const sessions = [];
    for (const mode of ['auto', 'chat', 'work']) {
        const groups = groupPendingBySession(buckets[mode]);
        for (const g of groups) {
            if (g.messages.length === 0)
                continue;
            sessions.push({ sessionId: g.sessionId, mode, messages: g.messages });
        }
    }
    return sessions;
}
export class RuminateController {
    ctx;
    cfg;
    runner;
    stores;
    logger;
    live;
    status = IDLE_STATUS;
    cancelRequested = false;
    /** 启动守卫:置位早于 status.running,封住"await 读取"期间的双击窗口。 */
    starting = false;
    sessions = [];
    totalL1 = 0;
    pendingFile;
    /** Room 注册表(可选;孤儿候选预标记的合并词表来源)。 */
    roomRegistry;
    /**
     * 本轮起始时的库快照（id → updatedAt），供收尾算「本轮新增/变更」增量集（task_2.8）。
     * `undefined` = 本轮没拍（投射门未开或拍失败）→ 收尾一律不做全库重导。
     */
    mdBaseline;
    /** 投射旁路失败累计次数（只 warn 不抛，计数供诊断/测试读取）。 */
    mdFailures = 0;
    /** 记忆后端:未注入时包 l1(进程内,行为与改造前等价)。 */
    backend() {
        return this.stores.backend ?? new InProcMemoryBackend(this.stores.l1);
    }
    constructor(ctx, cfg, runner, stores, logger, live, pendingFile, 
    /** Room 注册表(可选;孤儿候选预标记的合并词表来源)。 */
    roomRegistry) {
        this.ctx = ctx;
        this.cfg = cfg;
        this.runner = runner;
        this.stores = stores;
        this.logger = logger;
        this.live = live;
        this.pendingFile = pendingFile;
        this.roomRegistry = roomRegistry;
    }
    /** 状态快照 */
    getStatus() {
        return { ...this.status };
    }
    /**
     * 启动反刍:扫描 pending 三桶,按会话分组,逐个入队蒸馏;完成后强制 L2+L3。
     * 桶形状的唯一权威是 store/pending.ts 的 loadPending——不得在本层再解析该文件。
     */
    async start() {
        if (this.status.running || this.starting)
            throw new Error('反刍已在进行中');
        this.starting = true;
        try {
            const liveNow = this.live.get();
            if (!liveNow.enabled || !liveNow.distill) {
                throw new Error('蒸馏开关已关闭,请先开启蒸馏再反刍');
            }
            if (!this.cfg.extract.enabled) {
                throw new Error('部署配置已停用蒸馏(extract.enabled=false),无法反刍');
            }
            // 读取 pending 三桶(loadPending 负责解包 PendingFile 并校验条目)
            const { buckets } = await loadPending(this.pendingFile, this.logger);
            this.sessions = groupSessions(buckets);
            this.cancelRequested = false;
            this.totalL1 = 0;
            // md 投射基线（task_2.8）：两条收尾路径（finalize / doLightRefresh）共用同一份起点，
            // 所以必须在这里拍——放在 `sessions.length === 0` 分支之前，轻量刷新才覆盖得到。
            this.snapshotMdBaseline();
            if (this.sessions.length === 0) {
                // 没有 pending 切片 → 做 L2/L3 轻量刷新
                return await this.doLightRefresh();
            }
            this.status = {
                ...IDLE_STATUS,
                running: true,
                phase: 'distilling',
                total: this.sessions.length,
                startedAt: Date.now(),
            };
            this.logger.info(`[memory] 反刍开始:${this.sessions.length} 个会话待消化`);
            // 第一个会话入队
            this.doEnqueue(0);
            // 此刻 status.running 已置位,后续并发 start() 由该守卫拦截
            this.starting = false;
            return { ...this.status };
        }
        catch (err) {
            // 失败必须落状态:否则 status 仍报 idle/error:null,与面板上的报错自相矛盾
            this.status = {
                ...IDLE_STATUS,
                running: false,
                phase: 'failed',
                error: errDetail(err),
                finishedAt: Date.now(),
            };
            this.logger.warn(`[memory] 反刍启动失败: ${errDetail(err)}`);
            throw err;
        }
        finally {
            this.starting = false;
        }
    }
    /** 请求取消:当前块完成后停止,已蒸馏部分保留。 */
    requestCancel() {
        if (!this.status.running)
            return this.getStatus();
        this.cancelRequested = true;
        this.status.cancelRequested = true;
        this.logger.info('[memory] 反刍取消已请求(当前块完成后停止)');
        return { ...this.status };
    }
    /** 入队一个会话。 */
    doEnqueue(index) {
        if (this.cancelRequested || index >= this.sessions.length) {
            // 已登记的会话(含被取消截断者)视为已完成,避免 done 恒 0
            this.status.done = index;
            // 收尾
            void this.finalize();
            return;
        }
        const session = this.sessions[index];
        this.status.phase = 'distilling';
        this.status.detail = `L1 蒸馏中:会话 ${session.sessionId}(第 ${index + 1}/${this.sessions.length} 个)`;
        // 背压:上个会话真正跑完(onTurnDone)才入队下一个——队列深度 ≤1。
        // 原先 setImmediate 连发会把全部会话一次性塞进 runner 队列(无界堆积),
        // LLM e2e 延迟波动时既拖慢 live 任务也让取消语义变钝;链式入队后
        // 进度(done)真实逐会话推进,取消即刻停止入队。
        // 传空消息（与 enqueueSessionSlices 同一语义）：让 runTurn 不回灌缓冲，
        // 由 distillSession 直接处理该会话在内存缓冲里的既有切片。
        // （旧代码传 session.messages——那是从 pending.json 读出的、已在缓冲中的消息，
        //   经 runTurn 的 `bucket.push(...messages)` 会重复入桶 → 反刍后待处理计数“还原/变多”。）
        this.runner.enqueue(session.sessionId, [], session.mode, {
            force: true,
            onTurnDone: (records) => {
                this.totalL1 += records;
                this.status.recordsBuilt = this.totalL1;
                this.status.done = index + 1;
                setImmediate(() => this.doEnqueue(index + 1));
            },
        });
    }
    /** 收尾:强制 L2 + L3。 */
    async finalize() {
        try {
            this.status.phase = 'consolidating';
            this.status.detail = 'L2 场景整合(收尾)';
            const liveNow = this.live.get();
            const distillOn = liveNow.enabled && liveNow.distill;
            // 强制 L2:把全部未整合的残余记录落进场景
            if (this.cfg.l2.enabled && distillOn) {
                for (const family of ['chat', 'work']) {
                    const fstate = this.runner.states?.[family];
                    if (!fstate)
                        continue;
                    // 收集本族所有记录(反刍后全部未整合)
                    const records = this.stores.l1.list({ family, limit: 500, offset: 0 }).items;
                    if (records.length === 0)
                        continue;
                    try {
                        const t = Date.now();
                        await runSceneConsolidation(this.ctx, this.cfg, this.stores.scenes[family], records, this.logger, family);
                        if (fstate) {
                            fstate.newMemoriesSinceL2 = 0;
                            fstate.lastL2At = Date.now();
                        }
                        this.logger.info(`[memory] 反刍 L2 完成(family=${family},${Date.now() - t}ms,${records.length} 条记录)`);
                    }
                    catch (err) {
                        this.logger.warn(`[memory] 反刍 L2 失败(family=${family}): ${errDetail(err)}`);
                    }
                }
            }
            // 强制 L3:画像更新
            if (this.cfg.l3.enabled && distillOn) {
                this.status.phase = 'updating';
                this.status.detail = 'L3 画像更新';
                for (const family of ['chat', 'work']) {
                    try {
                        const scenes = await this.stores.scenes[family].list();
                        if (scenes.length === 0)
                            continue;
                        const fstate = this.runner.states?.[family];
                        // 强制 L3：runPersona 自带触发判定(memoriesSinceL3>=interval 才跑)，反刍是用户
                        // 显式整理动作，需绕过阈值真跑——置 personaRequestedReason 走“主动请求”分支。
                        if (fstate)
                            fstate.personaRequestedReason = '反刍收尾';
                        await runPersona(this.ctx, this.cfg, this.stores.scenes[family], this.stores.persona[family], fstate || undefined, this.logger, family);
                        // 与 L2 块对称：无论 runPersona 是否因“无变化场景”早退，反刍收尾都清零 L3 计数，
                        // 否则“待 L3 新记忆”会永远卡在阈值下(本 bug 根因)。runPersona 成功时已自清，这里幂等兜底。
                        if (fstate) {
                            fstate.memoriesSinceL3 = 0;
                            fstate.lastL3At = Date.now();
                            fstate.personaRequestedReason = undefined;
                        }
                        this.logger.info(`[memory] 反刍 L3 完成(family=${family})`);
                    }
                    catch (err) {
                        this.logger.warn(`[memory] 反刍 L3 失败(family=${family}): ${errDetail(err)}`);
                    }
                }
            }
            // 反刍收尾改了 L2/L3 计数（runner.states 是 StateStore 的活引用，内存态）——
            // 必须显式落盘，否则重启从 state.json 读回旧值，表现为“待处理计数反复”。
            // （正常蒸馏路径由 runTurn 末尾 save；反刍 finalize 是独立路径，需自己 save。）
            await this.stores.state.save();
            // 旧 slot 语义迁移（cfg.slots.migrateLegacy 默认关 → 直接 0 动作）：
            // 把“钉成常驻、内容已由活 L1 记忆承载”的 rule 槽位软退场。
            if (this.stores.slots !== undefined) {
                await migrateLegacySlots(this.stores.slots, this.stores.l1, this.cfg.slots.migrateLegacy === true, this.logger);
            }
            // 标注校验/重标定:Wing 合法性 + 认知 hall 映射 + 未打标补标 + 涌现标签
            // 批次进度经 onProgress 写入 detail + sub 子进度(非会话阶段的进度由重标批次决定)
            this.status.phase = 'relabeling';
            this.status.detail = '标注校验与重标定(Wing/认知 hall/标签)';
            try {
                this.status.relabel = await relabelPass({ ctx: this.ctx, cfg: this.cfg, backend: this.backend(), logger: this.logger }, {}, {
                    progress: (text, done, total, label) => {
                        this.status.detail = text;
                        this.status.sub = { done, total, label: label ?? '重标定批次' };
                    },
                });
                this.status.sub = null;
                // tags 刚被改写 → Room 分类(由 tags 派生)必须重算,否则新 Room 要等 30s TTL
                this.stores.l1.invalidateRooms();
                const r = this.status.relabel;
                this.logger.info(`[memory] 反刍重标定完成:巡检 ${r.checked},补 cogHall ${r.cogHallFixed},非法 wing ${r.wingInvalidFixed},LLM 补 wing ${r.wingLabeled},打 tags ${r.tagged},跳过 ${r.llmSkipped},预算让出 ${r.deferred}`);
            }
            catch (err) {
                this.status.sub = null;
                // 重标定失败不拖垮反刍整体(蒸馏/L2/L3 产物保留)
                this.logger.warn(`[memory] 反刍重标定失败(不影响本次产物): ${errDetail(err)}`);
            }
            // 场景重聚类消费(治理 W3,T3.10/T3.11):demote-to-wiki / repo 归属变化的
            // 派生修复在空闲档落地;每次至多 1 个作业,内部吞错绝不拖垮反刍。
            try {
                const reprocessed = await processSceneReclusterJobs(this.stores.l1, this.stores.scenes, this.logger);
                if (reprocessed > 0)
                    this.status.detail = `场景重聚类 ${reprocessed} 个作业已派发重算`;
            }
            catch (err) {
                this.logger.warn(`[memory] 场景重聚类调度失败(忽略): ${errDetail(err)}`);
            }
            // 孤儿候选预标记(长尾治理):无 Room 的活跃孤儿对照现有 Room 词表产出
            // 候选(roomReview='pending'),由 agent 用 memory_room_review 逐个复查;
            // 每轮至多 40 条,吞错不拖垮反刍。
            try {
                const r = await annotateOrphanCandidates(this.ctx, this.cfg, { l1: this.stores.l1, logger: this.logger, registry: this.roomRegistry }, 40);
                if (r.written > 0)
                    this.status.detail = `孤儿候选预标记 ${r.written} 条(待 agent 复查,工具 memory_room_review)`;
            }
            catch (err) {
                this.logger.warn(`[memory] 孤儿候选预标记失败(忽略): ${errDetail(err)}`);
            }
            // md 投射收尾（task_2.8）：只导本轮新增/变更的记录；旁路，失败不影响本次产物。
            await this.projectMd('反刍收尾');
            this.status.phase = 'done';
            this.finish(null);
        }
        catch (err) {
            this.finish(`收尾失败: ${errDetail(err)}`);
        }
    }
    /**
     * 轻量刷新:没有 pending 时仅跑一轮 L2/L3。
     *
     * 为什么必须先置 running/phase:此处每次 runSceneConsolidation/runPersona 都是**真实 LLM 调用**
     * (实测单次可达 70s+),而本方法是 `await` 的、期间 `start()` 一直挂着并占住守卫。
     * 原先不置 running,导致刷新期间界面既无进度也无取消按钮,再点一次只得到"反刍已在进行中"
     * 却看不到任何进展——即用户反馈的"管线进度和状态提示仍然欠缺"。
     * 现在:先把步骤数登记为 total、每完成一步自增 done,并给出当前动作描述(detail)。
     */
    async doLightRefresh() {
        const liveNow = this.live.get();
        const distillOn = liveNow.enabled && liveNow.distill;
        // 先算出待执行步骤(每族 L2/L3 各算一步),据此给界面一个真实进度
        const l2Targets = [];
        if (this.cfg.l2.enabled && distillOn) {
            for (const family of ['chat', 'work']) {
                const fstate = this.runner.states?.[family];
                if (!fstate || fstate.newMemoriesSinceL2 <= 0)
                    continue;
                const records = this.stores.l1.list({ family, limit: 200, offset: 0 }).items;
                if (records.length === 0)
                    continue;
                l2Targets.push(family);
            }
        }
        const l3Targets = [];
        if (this.cfg.l3.enabled && distillOn) {
            for (const family of ['chat', 'work']) {
                if (!this.runner.states?.[family])
                    continue;
                l3Targets.push(family);
            }
        }
        this.cancelRequested = false;
        // 重标定固定算一步(即使无未打标也走一次机械校验),必须计进 total——
        // 否则会出现 done > total 的荒谬计数(实测 3/2)。
        const relabelStep = 1;
        this.status = {
            ...IDLE_STATUS,
            running: true,
            phase: 'refreshing',
            done: 0,
            total: l2Targets.length + l3Targets.length + relabelStep,
            detail: '准备轻量刷新(无未蒸馏缓冲)',
            startedAt: Date.now(),
        };
        this.logger.info(`[memory] 反刍轻量刷新开始(pending 无切片):L2 ${l2Targets.length} 族 / L3 ${l3Targets.length} 族`);
        if (l2Targets.length > 0)
            this.status.phase = 'consolidating';
        for (const family of l2Targets) {
            if (this.cancelRequested)
                break;
            this.status.detail = `L2 场景整合(${family})`;
            const fstate = this.runner.states?.[family];
            const records = this.stores.l1.list({ family, limit: 200, offset: 0 }).items;
            try {
                await runSceneConsolidation(this.ctx, this.cfg, this.stores.scenes[family], records, this.logger, family);
                // 仅成功后归零:失败时保留计数,留给下一次触发重试(原先先归零会静默吞掉失败)
                if (fstate) {
                    fstate.newMemoriesSinceL2 = 0;
                    fstate.lastL2At = Date.now();
                }
            }
            catch (err) {
                this.logger.warn(`[memory] 反刍轻量刷新 L2 失败(family=${family}): ${errDetail(err)}`);
            }
            this.status.done++;
        }
        if (l3Targets.length > 0)
            this.status.phase = 'updating';
        for (const family of l3Targets) {
            if (this.cancelRequested)
                break;
            this.status.detail = `L3 画像更新(${family})`;
            const fstate = this.runner.states?.[family];
            try {
                // 强制 L3：runPersona 自带触发判定(memoriesSinceL3>=interval 才跑)，反刍是显式整理动作，
                // 需绕过阈值真跑——置 personaRequestedReason 走“主动请求”分支。
                if (fstate)
                    fstate.personaRequestedReason = '反刍轻量刷新';
                await runPersona(this.ctx, this.cfg, this.stores.scenes[family], this.stores.persona[family], fstate, this.logger, family);
                // 与 L2 循环对称：无论 runPersona 是否因“无变化场景”早退，都清零 L3 计数，
                // 否则“待 L3 新记忆”永远卡在阈值下。runPersona 成功时已自清，这里幂等兜底。
                if (fstate) {
                    fstate.memoriesSinceL3 = 0;
                    fstate.lastL3At = Date.now();
                    fstate.personaRequestedReason = undefined;
                }
            }
            catch (err) {
                this.logger.warn(`[memory] 反刍轻量刷新 L3 失败(family=${family}): ${errDetail(err)}`);
            }
            this.status.done++;
        }
        // 轻量刷新同样做标注校验/重标定(有界,失败不影响刷新结果)
        this.status.phase = 'relabeling';
        this.status.detail = '标注校验与重标定(Wing/认知 hall/标签)';
        try {
            this.status.relabel = await relabelPass({ ctx: this.ctx, cfg: this.cfg, backend: this.backend(), logger: this.logger }, {}, {
                progress: (text, done, total, label) => {
                    this.status.detail = text;
                    this.status.sub = { done, total, label: label ?? '重标定批次' };
                },
            });
        }
        catch (err) {
            this.logger.warn(`[memory] 反刍轻量刷新重标定失败(不影响刷新结果): ${errDetail(err)}`);
        }
        finally {
            // 同全量路径:tags 可能被改写过,成败都要让 Room 缓存重算
            this.stores.l1.invalidateRooms();
            // 计数与成败解耦:该步已执行(无论成败都算走完),否则失败时 done 永远追不上 total
            this.status.sub = null;
            this.status.done++;
        }
        // 轻量刷新改了 L2/L3 计数（runner.states 是 StateStore 活引用）——必须显式落盘，
        // 否则重启从 state.json 读回旧值，表现为“待 L2/L3 计数反复”。
        try {
            await this.stores.state.save();
        }
        catch (err) {
            this.logger.warn(`[memory] 反刍轻量刷新 state 落盘失败(计数可能不持久): ${errDetail(err)}`);
        }
        // 旧 slot 语义迁移：无 pending 缓冲时走的是本路径（“待 L3 12/20”那类场景），
        // 与 finalize 同一动作、同样默认关；两处幂等（退场后不再命中 open）。
        if (this.stores.slots !== undefined) {
            await migrateLegacySlots(this.stores.slots, this.stores.l1, this.cfg.slots.migrateLegacy === true, this.logger);
        }
        // md 投射收尾（task_2.8）：与 finalize 同一动作的两个挂载点之一——历史教训是
        // `sessions.length === 0` 走本路径，只挂 finalize 等于没挂。
        await this.projectMd('轻量刷新');
        this.status.running = false;
        this.status.detail = null;
        this.status.phase = this.cancelRequested ? 'cancelled' : 'done';
        this.status.finishedAt = Date.now();
        const cost = this.status.finishedAt - (this.status.startedAt ?? this.status.finishedAt);
        this.logger.info(`[memory] 反刍轻量刷新结束(${this.status.phase}):${this.status.done}/${this.status.total} 步,耗时 ${Math.round(cost / 1000)}s`);
        return this.getStatus();
    }
    /**
     * 投射侧诊断计数（只增不减；不进任何端点，避开契约五处齐改的面）。
     */
    getMdFailures() {
        return this.mdFailures;
    }
    /**
     * 拍本轮起始基线（id → updatedAt）。三道门任一不满足就**一个动作都不做**：
     * 连 `l1.all()` 都不调，这样“投射关着”时的产物与改动前逐字一致（本仓红线）。
     *
     * 为什么用基线 diff 而不是 `updatedAt >= startedAt`：relabel / 退场等改写走的是
     * `patchMetadata` 那类最小写回，**不碰 `updated_time`**（它在快照哈希字段表里），
     * 按时间戳筛会把这批真变了的记录漏掉。
     */
    snapshotMdBaseline() {
        this.mdBaseline = undefined;
        const exp = this.cfg.memExport;
        if (exp === undefined || exp.enabled !== true)
            return;
        if (this.stores.mdLedger === undefined)
            return;
        try {
            const map = new Map();
            for (const r of this.stores.l1.all())
                map.set(r.id, r.updatedAt);
            this.mdBaseline = map;
        }
        catch (err) {
            // 拍不上基线 = 本轮不投射（而不是退回全库重导）；旁路失败不拖垮反刍。
            this.mdFailures++;
            this.logger.warn(`[memory] 反刍 md 投射基线失败(本次不做投射): ${errDetail(err)}`);
        }
    }
    /**
     * 反刍收尾的增量 md 投射（task_2.8）：库 → 文件 + 账本 + 后缀对齐，**只碰本轮新增/变更的那批**。
     *
     * 与手动的 `dsh-memory/mem-export` 端点的区别：
     * - 不跑命名回填（`assignMissingNames` 会写库，反刍是只读旁路，不能在那里改库）；
     *   本轮新记录的 `name` 已在写入前由管线单一真源分配，未命名的按 `fileStemFor` 回落。
     * - 不建类型目录骨架（`ensureTypeSkeleton`），那是面板显式触发的动作。
     * 护栏全部复用 `cfg.memExport` 既有值（`maxRecords`/`timeBudgetMs`），**不新增配置项**。
     *
     * 一轮投射走 `syncFiles`（与 `L1Store` 钩子同一函数）：导出之后紧跟后缀收敛，
     * 所以本轮被合并取代/冲突判负的增量记录不会停在未改名的 `.memory.md` 上。
     *
     * 失败面：整个方法自吞异常，只 warn + 计数，绝不抛给调用方、绝不改变反刍结果。
     * @param stage - 日志里的路径名（区分 finalize 与轻量刷新两条挂载点）。
     */
    async projectMd(stage) {
        const baseline = this.mdBaseline;
        if (baseline === undefined)
            return;
        const exp = this.cfg.memExport;
        const ledger = this.stores.mdLedger;
        if (exp === undefined || exp.enabled !== true || ledger === undefined)
            return;
        try {
            const changed = [];
            for (const r of this.stores.l1.all()) {
                const prev = baseline.get(r.id);
                // 新 id（本轮蒸馏产出）或 updatedAt 变了（合并/改写）才算变更；其余不重导。
                if (prev === undefined || prev !== r.updatedAt)
                    changed.push(r);
            }
            if (changed.length === 0)
                return;
            const deps = {
                exportCfg: () => ({
                    enabled: exp.enabled === true,
                    root: exp.root,
                    maxRecords: exp.maxRecords,
                    timeBudgetMs: exp.timeBudgetMs,
                }),
                dataDir: resolveDataDir(this.cfg),
                ledger: () => this.stores.mdLedger,
                logger: this.logger,
            };
            const out = await syncFiles(deps, changed);
            if (out === undefined)
                return;
            const { exported: rep, suffix } = out;
            this.logger.info(`[memory] 反刍 md 投射(${stage}):增量 ${changed.length} 条,写 ${rep.written},未变 ${rep.unchanged},跳过 ${rep.skipped},改名 ${suffix.renamed},落点 ${rep.root}${rep.capped ? `,预算用尽剩 ${rep.remaining} 个文件(下轮反刍继续)` : ''}`);
        }
        catch (err) {
            this.mdFailures++;
            this.logger.warn(`[memory] 反刍 md 投射失败(旁路忽略,不影响本次产物,累计 ${this.mdFailures} 次): ${errDetail(err)}`);
        }
        finally {
            // 基线一次性消费：同一次运行不重投射同一批（两条挂载点互斥，这里只防异常复用）。
            this.mdBaseline = undefined;
        }
    }
    finish(error) {
        this.status.running = false;
        this.status.detail = null;
        this.status.phase = this.cancelRequested ? 'cancelled' : 'done';
        this.status.error = error;
        this.status.finishedAt = Date.now();
        this.status.recordsBuilt = this.totalL1;
        const cost = this.status.finishedAt - (this.status.startedAt ?? this.status.finishedAt);
        this.logger.info(`[memory] 反刍结束(${this.status.phase}):${this.status.done}/${this.status.total} 会话,产出 ${this.totalL1} 条记录,耗时 ${Math.round(cost / 1000)}s`);
    }
}
