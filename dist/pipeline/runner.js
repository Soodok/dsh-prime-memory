import { resolveDataDir } from '../config.js';
import { GRAPH_PRIORITY_NEW } from '../graph/types.js';
import { NoDistillRouteError } from '../llm.js';
import { startValidityBackfill } from '../validity-backfill.js';
import { drscRowToConversationMessage } from '../clients/drsc.js';
import { trace } from '../store/trace.js';
import { emptyPending, freshWarmup, groupPendingBySession, loadPending, PENDING_MODES, pendingPathFor, savePending, } from '../store/pending.js';
import { errDetail } from '../util/filelog.js';
import { sessionWorkspaceIdOf } from '../workspace.js';
import { advanceWarmupThreshold, effectiveExtractThreshold, extractionBackoffMs, idleSessionsToFlush, modeSwitchAction, } from './trigger.js';
import { runExtraction } from './l1.js';
import { buildAnchorMap } from './anchors.js';
import { runGraphProjection } from './graph.js';
import { runSceneConsolidation } from './l2.js';
import { runPersona } from './l3.js';
/**
 * 选取下一个要执行的任务下标:最早的 live 优先,其次 graph(图谱投影单批短、
 * 让位用户轮次但优先于重建分块),否则队首。
 */
export function pickNextTaskIndex(tasks) {
    for (let i = 0; i < tasks.length; i++) {
        if (tasks[i].kind === 'live')
            return i;
    }
    for (let i = 0; i < tasks.length; i++) {
        if (tasks[i].kind === 'graph')
            return i;
    }
    return 0;
}
/**
 * 运行时调参视图:设置页运行时链(distillChain)与旧单路由/档位键、分层输出预算、
 * 蒸馏通道覆盖、远程嵌入覆盖可临时覆盖静态 config。浅拷贝只覆盖 llm/embedding
 * 相关键,其余键与原 cfg 共享只读引用;pipeline 全链继续收 cfg,无需感知。
 *
 * 优先级表(自上而下):
 * - 蒸馏模型:部署静态 pin(provider+model 双字段齐)> 运行时统一链 distillChain
 *   [0]> 旧单路由键(distillProvider+distillModel 成对)> agentDefaultModel;
 *   pinned 时链与旧键一并失效(部署锁定路由)。
 * - 思考档位:有 settings 服务时运行时值整体接管('' = 自动);链模式主路由档位走
 *   primaryEffort;非链模式旧键对静态回退条目盖章接管(存量兼容)。
 * - 输出预算/输入预算/通道覆盖/远程嵌入覆盖:非零/非空运行时值直接注入对应子树。
 */
export function effectiveCfg(cfg, live) {
    const s = live?.get();
    const eff = s?.reasoningEffort ?? '';
    // 可选链防御:smoke/测试缝构造的最小 cfg 可能没有 llm 字段
    const pinned = Boolean(cfg.llm?.provider && cfg.llm?.model);
    // 统一路由链:只认显式 distillChain(非空即权威);未配置链时旧键走不变的旧路径;
    // pinned 时链整体失效(部署锁定路由,链编辑器只读)
    const chain = s?.distillChain?.length ? s.distillChain : [];
    const chainMode = chain.length > 0 && !pinned;
    const chainEffort = chainMode && chain[0].reasoningEffort ? chain[0].reasoningEffort : null;
    // 链非空即整体接管:回退链以运行时链为准(slice(1)),单行链 = 显式无回退
    // (空数组覆盖静态 cfg.llm.fallbacks——"UI 所见即所跑")
    const chainFallbacks = chainMode
        ? chain.slice(1).map((e) => ({ provider: e.provider, model: e.model, reasoningEffort: e.reasoningEffort || '' }))
        : null;
    const override = chainMode && chain[0].provider && chain[0].model
        ? { provider: chain[0].provider, model: chain[0].model }
        : !chain.length && s && !pinned && s.distillProvider && s.distillModel
            ? { provider: s.distillProvider, model: s.distillModel }
            : null;
    const b = s?.distillBudgets;
    // 守卫必须含 graph(只配图谱预算也要注入 budgets 子树——漏键 = 静默丢预算)
    const budgets = b && (b.extract > 0 || b.dedup > 0 || b.l2 > 0 || b.l3 > 0 || b.graph > 0)
        ? {
            ...(b.extract > 0 ? { extract: b.extract } : {}),
            ...(b.dedup > 0 ? { dedup: b.dedup } : {}),
            ...(b.l2 > 0 ? { l2: b.l2 } : {}),
            ...(b.l3 > 0 ? { l3: b.l3 } : {}),
            ...(b.graph > 0 ? { graph: b.graph } : {}),
        }
        : null;
    // 运行时按层路由链:非空层链逐层注入 layerChainsRuntime(解析侧层内第一优先级);
    // pinned 一并失效;全部层为空 = 无注入。层键逐个 ?.length 容忍部分键缺失
    const lc = s?.distillLayerChains;
    const layerPick = lc && !pinned
        ? {
            ...(lc.l1?.length ? { l1: lc.l1 } : {}),
            ...(lc.l2?.length ? { l2: lc.l2 } : {}),
            ...(lc.l3?.length ? { l3: lc.l3 } : {}),
        }
        : null;
    const layerChains = layerPick && Object.keys(layerPick).length ? layerPick : null;
    const maxInput = s && s.distillMaxInputChars > 0 ? s.distillMaxInputChars : null;
    // R10 蒸馏超时运行时覆盖：>0 才注入 llm.timeoutMs，否则跟随静态配置
    const timeoutOv = s && s.distillTimeoutMs > 0 ? s.distillTimeoutMs : null;
    // 旧档位键的全局接管(含给静态回退条目盖章):仅非链模式保留(旧存量值兼容)
    const fallbacksTakeover = !chainMode && eff && cfg.llm?.fallbacks?.length
        ? cfg.llm.fallbacks.map((f) => ({ ...f, reasoningEffort: eff }))
        : null;
    // 档位注入:链模式下不走全局接管(主路由档位走 primaryEffort,空档位条目回退
    // 静态全局而非运行时旧键);非链模式保持旧整体接管语义
    const effortInject = live && !chainMode && (eff !== '' || Boolean(cfg.llm?.reasoningEffort))
        ? { reasoningEffort: eff }
        : null;
    // 蒸馏通道运行时覆盖:distillMode='host'|'direct' 锁定通道档,directBaseURL /
    // directApiKey 覆盖直连端点与密钥(与路由 pin 正交:pin 锁宿主 provider 路由,
    // direct 是独立传输层)
    const dm = s?.distillMode;
    const modeOverride = dm === 'host' || dm === 'direct' ? { mode: dm } : null;
    const baseOverride = s && s.directBaseURL ? { baseURL: s.directBaseURL } : null;
    const keyOverride = s && s.directApiKey ? { apiKey: s.directApiKey } : null;
    const hasChannel = modeOverride !== null || baseOverride !== null || keyOverride !== null;
    // 远程嵌入连接运行时覆盖(设置 UI 可编辑,替代部署 YAML):任一字段非空即视为
    // 启用远程(覆盖 embedding.enabled 为 true,让 remoteCeiling 放行);注入到
    // cfg.embedding 子树(与 llm 分属不同子树,独立注入,不进 channel 判定)
    const erb = s?.embedRemoteBaseURL;
    const erc = s?.embedRemoteApiKey;
    const erm = s?.embedRemoteModel;
    const erd = s?.embedRemoteDimensions;
    const embedOverride = erb || erc || erm || (erd ?? 0) > 0
        ? {
            embedding: {
                ...(cfg.embedding ?? {}),
                enabled: true,
                ...(erb ? { baseUrl: erb } : {}),
                ...(erc ? { apiKey: erc } : {}),
                ...(erm ? { model: erm } : {}),
                ...((erd ?? 0) > 0 ? { dimensions: erd } : {}),
            },
        }
        : null;
    // §C 人工冲突裁决运行时覆盖:live.conflictFreeze 覆盖静态 cfg.conflictFreeze.enabled
    const cfOverride = s?.conflictFreeze !== undefined
        ? { conflictFreeze: { ...(cfg.conflictFreeze ?? {}), enabled: s.conflictFreeze } }
        : null;
    // 存量回填/进阶功能启用开关：live 与部署 cfg.<x>.enabled 取或（部署强制开、live 追加开，
    // 任一为真即放行）。关关关时保持逐字 false（零漂移不破）。
    const kwOverride = s?.keywordEnabled !== undefined
        ? { keyword: { ...(cfg.keyword ?? {}), enabled: cfg.keyword?.enabled === true || s.keywordEnabled === true } }
        : null;
    const rdOverride = s?.redistillEnabled !== undefined
        ? { redistill: { ...(cfg.redistill ?? {}), enabled: cfg.redistill?.enabled === true || s.redistillEnabled === true } }
        : null;
    const mdsOverride = s?.mdSyncEnabled !== undefined
        ? { mdSync: { ...(cfg.mdSync ?? {}), enabled: cfg.mdSync?.enabled === true || s.mdSyncEnabled === true } }
        : null;
    const mpOverride = s?.memportEnabled !== undefined
        ? { memport: { ...(cfg.memport ?? {}), enabled: cfg.memport?.enabled === true || s.memportEnabled === true } }
        : null;
    // 时效分级门2 灰度闸:live.validityTiering 与部署 cfg.validity.tieringEnabled 取或
    // (同一先例)。两字都假时回 `{tieringEnabled:false}` 与缺省形状等价，注入侧零漂移不破。
    const vtOverride = s?.validityTiering !== undefined
        ? { validity: { ...(cfg.validity ?? {}), tieringEnabled: cfg.validity?.tieringEnabled === true || s.validityTiering === true } }
        : null;
    // md 投射/后缀收敛的单次动作护栏运行时覆盖(0 = 跟随部署 cfg.memExport.maxRecords)。
    // 只覆盖条数护栏，不动 enabled/root——开关与根路径仍属部署配置。
    const mdx = s?.mdExportMaxRecords ?? 0;
    const memExportOverride = mdx > 0 ? { memExport: { ...(cfg.memExport ?? {}), maxRecords: mdx } } : null;
    // 回填并行度运行时覆盖(0 = 跟随部署 cfg.backfill.concurrency)：只改并发度，
    // 不动 maxRecords/timeBudgetMs/callTimeoutMs——那三个仍属部署护栏，要改得改 YAML。
    const bf = s?.backfillConcurrency ?? 0;
    const backfillOverride = bf > 0 ? { backfill: { ...(cfg.backfill ?? {}), concurrency: bf } } : null;
    if (!override && !budgets && !maxInput && !fallbacksTakeover && !chainEffort && !chainFallbacks && !effortInject && !layerChains && !hasChannel && !embedOverride && !cfOverride && !memExportOverride && !backfillOverride && !kwOverride && !rdOverride && !mdsOverride && !mpOverride && !vtOverride)
        return cfg;
    return {
        ...cfg,
        ...(embedOverride ?? {}),
        ...(cfOverride ?? {}),
        ...(kwOverride ?? {}),
        ...(rdOverride ?? {}),
        ...(mdsOverride ?? {}),
        ...(mpOverride ?? {}),
        ...(vtOverride ?? {}),
        ...(memExportOverride ?? {}),
        ...(backfillOverride ?? {}),
        llm: {
            ...cfg.llm,
            ...(effortInject ?? {}),
            ...(override ?? {}),
            ...(budgets ? { budgets } : {}),
            ...(maxInput ? { maxInputChars: maxInput } : {}),
            ...(timeoutOv ? { timeoutMs: timeoutOv } : {}),
            ...(fallbacksTakeover ? { fallbacks: fallbacksTakeover } : {}),
            ...(chainEffort ? { primaryEffort: chainEffort } : {}),
            ...(chainFallbacks ? { fallbacks: chainFallbacks } : {}),
            ...(layerChains ? { layerChainsRuntime: layerChains } : {}),
            ...(modeOverride ?? {}),
            ...(baseOverride ?? {}),
            ...(keyOverride ?? {}),
        },
    };
}
/** 单桶堆积上限(防无限堆积;重建分块不受限——历史会话需全量入桶蒸馏)。 */
const PENDING_BUCKET_CAP = 200;
/** 会话产出记账表容量上限(超出淘汰最久未蒸馏会话;悬浮卡信息区数据源防泄漏)。 */
const SESSION_PRODUCED_CAP = 400;
/** 启动补跑延迟:避开宿主启动期忙乱。 */
const STARTUP_RETRY_DELAY_MS = 20_000;
/** 闲置扫描 tick 粒度(实际落袋延迟 = idleSeconds + 至多一个 tick)。 */
const IDLE_TICK_MS = 30_000;
export class MemoryRunner {
    ctx;
    cfg;
    stores;
    logger;
    live;
    modes;
    tasks = [];
    draining = false;
    /** 停止标志(dispose 序置位):不再取新任务;进行中任务自然收尾。 */
    stopped = false;
    pending = emptyPending();
    /** pending.json 的只读降级原因(undefined = 正常):非空时不再回写缓冲。 */
    pendingDegraded;
    pendingDegradedLogged = false;
    /** 各档位桶渐进阈值(1 起步翻倍至稳态毕业;随 pending.json 持久化)。 */
    warmup = freshWarmup();
    /** 每会话最后活动时间(闲置兜底判定用)。 */
    lastActivity = new Map();
    /** 每会话累计产出 L1 条数与最近蒸馏时间(session-stats 数据源;LRU 上限防泄漏)。 */
    sessionProduced = new Map();
    /** 抽取连续失败退避(瞬态,不持久化:重启后允许首试再退避)。 */
    extractFailures = new Map();
    /** 图谱泵在队列中的占位标志(同一时刻至多一个 graph 任务;护栏四件套之一)。 */
    graphPumpQueued = false;
    /** R7：已入队、尚未消费的 force-flush 键集（`session:mode`），同键不重复入队（治积压刷屏）。 */
    flushQueued = new Set();
    pendingFile;
    /** 分族 checkpoint(init 后可用;重建收尾也从这里读活引用)。 */
    states;
    afterRun;
    constructor(ctx, cfg, stores, logger, live, 
    /** 会话档位只读句柄(闲置扫描跳过 off 档会话;挂起语义)。 */
    modes) {
        this.ctx = ctx;
        this.cfg = cfg;
        this.stores = stores;
        this.logger = logger;
        this.live = live;
        this.modes = modes;
        this.pendingFile = pendingPathFor(resolveDataDir(cfg));
    }
    async init() {
        await this.stores.state.load();
        this.states = {
            chat: this.stores.state.forFamily('chat'),
            work: this.stores.state.forFamily('work'),
        };
        if (this.stores.state.didMigrate) {
            this.logger.info('[memory] state.json 已迁移为 v2 分族格式(旧数据归 chat 桶)');
            await this.stores.state.save();
        }
        // 恢复未蒸馏缓冲(上次进程退出前未蒸馏的消息,含失败待重试与攒阈值中途的)
        try {
            const { buckets: loaded, warmup, degraded } = await loadPending(this.pendingFile, this.logger);
            this.pendingDegraded = degraded;
            for (const key of PENDING_MODES) {
                if (loaded[key].length > PENDING_BUCKET_CAP)
                    loaded[key] = loaded[key].slice(-PENDING_BUCKET_CAP);
            }
            this.pending = loaded;
            this.warmup = warmup;
            if (this.pendingCount > 0) {
                this.logger.info(`[memory] 未蒸馏缓冲已恢复 ${this.pendingCount} 条(auto=${this.pending.auto.length}/chat=${this.pending.chat.length}/work=${this.pending.work.length}),${STARTUP_RETRY_DELAY_MS / 1000}s 后自动补跑`);
                this.scheduleStartupRetry();
            }
        }
        catch (err) {
            this.logger.warn(`[memory] 未蒸馏缓冲恢复失败(空桶起步): ${errDetail(err)}`);
        }
        // 图谱:启动回收上次进程退出卡在 running 的投影任务(dispose 缝不永久卡批),
        // 存量补投影延后单次限速入队(≤9000,由 20s 后的启动补跑与周期泵低速收敛)
        const graphs = this.stores.graph;
        if (graphs) {
            graphs.recoverRunning();
            if (this.cfg.graph?.enabled) {
                this.ctx.effect(() => {
                    const timer = setTimeout(() => {
                        if (this.stopped)
                            return;
                        const jobs = graphs.queueMissing(9000);
                        if (jobs > 0) {
                            this.logger.info(`[memory] 图谱存量补投影:${jobs} 个任务入队`);
                            this.maybeQueueGraphTask();
                        }
                    }, STARTUP_RETRY_DELAY_MS);
                    return () => clearTimeout(timer);
                });
            }
        }
    }
    /** 启动补跑:对每个非空桶的每个会话切片入队一次蒸馏尝试(受 live 开关与
     *  生效阈值约束;不足阈值的消息等用户继续或闲置兜底,失败不无限重试)。 */
    scheduleStartupRetry() {
        const modes = PENDING_MODES.filter((m) => this.pending[m].length > 0);
        this.ctx.effect(() => {
            const timer = setTimeout(() => {
                // 到点后按当前桶内容重新分组(期间可能有新轮次已消费切片)
                for (const mode of modes) {
                    for (const g of groupPendingBySession(this.pending[mode])) {
                        this.enqueue(g.sessionId, [], mode);
                    }
                }
            }, STARTUP_RETRY_DELAY_MS);
            return () => clearTimeout(timer);
        });
    }
    /** L1 抽取待重试的消息条数(状态面板用)。 */
    get pendingCount() {
        return this.pending.auto.length + this.pending.chat.length + this.pending.work.length;
    }
    /**
     * 会话级蒸馏视图(session-stats 端点数据源;纯内存读,零 I/O)。
     * pendingSlice = 当前档位桶中该会话的攒批切片条数(threshold 为生效阈值,含 warmup 爬坡);
     * parkedSlices = 其余档位桶中的残留切片(换档遗留 / off 档挂起)。
     */
    sessionView(sessionId, mode) {
        const count = (bucket) => bucket.reduce((n, m) => (m.sessionId === sessionId ? n + 1 : n), 0);
        const view = {
            pendingSlice: 0,
            parkedSlices: 0,
            threshold: null,
            producedRecords: 0,
            lastDistillAt: null,
        };
        const prod = this.sessionProduced.get(sessionId);
        if (prod) {
            view.producedRecords = prod.count;
            view.lastDistillAt = prod.lastAt;
        }
        const own = PENDING_MODES.includes(mode) ? mode : null;
        if (own) {
            view.pendingSlice = count(this.pending[own]);
            view.threshold = effectiveExtractThreshold(this.warmup[own], this.cfg.extract?.minMessages ?? 0);
        }
        for (const m of PENDING_MODES) {
            if (m !== own)
                view.parkedSlices += count(this.pending[m]);
        }
        return view;
    }
    /** 会话产出记账(切片成功消费时调用;LRU 淘汰最久未蒸馏会话防 Map 无界增长)。 */
    noteSessionDistill(sessionId, produced) {
        const now = Date.now();
        const cur = this.sessionProduced.get(sessionId);
        if (cur) {
            cur.count += produced;
            cur.lastAt = now;
        }
        else {
            this.sessionProduced.set(sessionId, { count: produced, lastAt: now });
        }
        if (this.sessionProduced.size > SESSION_PRODUCED_CAP) {
            let oldestKey = null;
            let oldestAt = Infinity;
            for (const [sid, v] of this.sessionProduced) {
                if (v.lastAt < oldestAt) {
                    oldestAt = v.lastAt;
                    oldestKey = sid;
                }
            }
            if (oldestKey)
                this.sessionProduced.delete(oldestKey);
        }
    }
    /** 管线跑完一轮后的回调(用于召回缓存失效)。 */
    setAfterRun(fn) {
        this.afterRun = fn;
    }
    /** 一轮对话结束后入队(L0 落盘由 capture 在 turn/end 即时完成,不排蒸馏队列)。
     *  onTurnDone 在该任务真正跑完后回调,携带本轮新增记录数(供反刍统计真实产出)。 */
    enqueue(sessionId, messages, mode, opts) {
        // R7：闲置/反刍/换档触发的 force-flush（空消息 + force）按 (session,mode) 去重，
        // 同键未消费前不重复入队（一次长阻塞不再积压几十个 no-op 排空刷屏）。
        const isFlush = opts?.force === true && messages.length === 0;
        const fkey = isFlush ? `${sessionId}:${mode}` : '';
        if (isFlush && this.flushQueued.has(fkey))
            return;
        if (isFlush)
            this.flushQueued.add(fkey);
        this.pushTask({
            kind: 'live',
            run: async () => {
                try {
                    return await this.runTurn(sessionId, messages, mode, opts);
                }
                finally {
                    if (isFlush)
                        this.flushQueued.delete(fkey); // 无论成败都释占，避免键泄漏永久屏蔽后续 flush
                }
            },
            ...(opts?.onTurnDone ? { onDone: (r) => opts.onTurnDone?.(typeof r === 'number' ? r : 0) } : {}),
        });
    }
    /** 重建任务入队(低优先级:让位于正常轮次;由 RebuildController 分块驱动)。 */
    enqueueRebuildTask(run) {
        this.pushTask({ kind: 'rebuild', run });
    }
    /** 重建蒸馏轮:统一 auto 档,全量强制蒸馏(不受阈值约束)、不受缓冲 200 上限。 */
    runRebuildTurn(sessionId, messages) {
        return this.runTurn(sessionId, messages, 'auto', { noBufferCap: true, force: true });
    }
    /** 停止取新任务(插件 dispose 序调用;进行中任务照常跑完但不 await)。 */
    stop() {
        this.stopped = true;
    }
    /** 启动闲置兜底定时器(index.ts 装配;idleSeconds=0 关闭)。 */
    startIdleTimer() {
        const idleMs = (this.cfg.extract.idleSeconds ?? 0) * 1000;
        if (!(idleMs > 0))
            return;
        this.ctx.effect(() => {
            const timer = setInterval(() => this.flushIdleSlices(Date.now(), idleMs), IDLE_TICK_MS);
            return () => clearInterval(timer);
        });
    }
    /** 闲置扫描:静默达标且有切片的会话按捕获档位落袋(off 档会话挂起跳过)。 */
    flushIdleSlices(now, idleMs) {
        if (this.stopped)
            return;
        const liveNow = this.live.get();
        if (!(liveNow.enabled && liveNow.distill))
            return;
        // 聚合每会话跨桶切片(sessionId 全局唯一)
        const infos = new Map();
        for (const mode of PENDING_MODES) {
            for (const m of this.pending[mode]) {
                const info = infos.get(m.sessionId) ?? { sessionId: m.sessionId, count: 0, lastMessageAt: 0 };
                info.count++;
                info.lastMessageAt = Math.max(info.lastMessageAt, m.timestamp);
                infos.set(m.sessionId, info);
            }
        }
        if (infos.size === 0)
            return;
        const targets = idleSessionsToFlush([...infos.values()], this.lastActivity, now, idleMs, (sid) => this.modes?.get(sid) === 'off').filter((sid) => !this.inExtractBackoff(sid, now)); // 退避中的会话不入队(任务堆积源头)
        for (const sid of targets) {
            this.logger.info(`[memory] 闲置兜底:会话 ${sid} 静默达标,未蒸馏切片落袋`);
            this.enqueueSessionSlices(sid);
        }
    }
    /** 把某会话在各桶中的切片按捕获档位逐个入队强制蒸馏(闲置兜底 / 档位切换共用)。 */
    enqueueSessionSlices(sessionId) {
        for (const mode of PENDING_MODES) {
            if (this.pending[mode].some((m) => m.sessionId === sessionId)) {
                this.enqueue(sessionId, [], mode, { force: true });
            }
        }
    }
    /**
     * 档位切换同步(session-modes 的 set() 回调,ADR-0003):
     * 非 off 间切换 → 该会话切片立即按捕获档位蒸馏(新档位从空切片起步);
     * 切到 off → 挂起(切片留存,闲置扫描跳过);从 off 切回 → 挂起片按捕获档位落袋。
     */
    onModeChange(sessionId, oldMode, newMode) {
        const action = modeSwitchAction(oldMode, newMode);
        if (action === 'none')
            return;
        if (action === 'park') {
            this.logger.info(`[memory] 档位切换 ${oldMode}→off:会话 ${sessionId} 未蒸馏切片挂起`);
            return;
        }
        this.logger.info(`[memory] 档位切换 ${oldMode}→${newMode}(${action}):会话 ${sessionId} 切片按捕获档位落袋`);
        this.enqueueSessionSlices(sessionId);
    }
    pushTask(task) {
        if (this.stopped)
            return;
        this.tasks.push(task);
        void this.drain();
    }
    /**
     * 图谱泵任务入队(护栏四件套,见 maybeQueueGraphTask;成功投影后有积压则续排,
     * 每轮 drain 至多消费一个 graph 任务且永远让位 live)。
     */
    startGraphBackfillTimer() {
        const graphs = this.stores.graph;
        if (!graphs || !this.cfg.graph?.enabled)
            return;
        this.ctx.effect(() => {
            const timer = setInterval(() => {
                if (this.stopped)
                    return;
                const jobs = graphs.queueMissing(500);
                if (jobs > 0) {
                    this.logger.debug?.(`[memory] 图谱周期补投影:${jobs} 个任务入队`);
                    this.maybeQueueGraphTask();
                }
            }, 30 * 60_000);
            return () => clearInterval(timer);
        });
    }
    /**
     * validity 标注存量回填的接线(task_6.3):低频、让位于蒸馏——启动 3 分钟后首轮,
     * 之后每 6h 一次(首轮收敛后多数轮是纯扫描 no-op;defer 的部分自动续上)。
     * 门控跟灰度闸走:tieringEnabled(部署 ∨ 面板)关时不进任务——功能关着时
     * 存量 metadata 逐字不变(零漂移,与 keyword-backfill 的门控同法)。
     */
    startValidityBackfillTimer() {
        this.ctx.effect(() => {
            let loop = null;
            const first = setTimeout(() => {
                this.runValidityBackfillTick();
                loop = setInterval(() => this.runValidityBackfillTick(), 6 * 3_600_000);
            }, 180_000);
            return () => { clearTimeout(first); if (loop !== null)
                clearInterval(loop); };
        });
    }
    runValidityBackfillTick() {
        if (this.stopped)
            return;
        const eff = effectiveCfg(this.cfg, this.live);
        if (eff.validity?.tieringEnabled !== true)
            return;
        startValidityBackfill({
            l1: this.stores.l1,
            logger: this.logger,
            // task_7.7 接缝:回填改过标注的记录顺手重投保鲜图谱(图谱未启用时 reprojectGraph 自己回零)。
            reproject: (ids) => { this.reprojectGraph(ids); },
            shouldCancel: () => this.stopped,
        });
    }
    /**
     * 确定性写面的公共入队钩子(graph-write-plane R2):非蒸馏写入路径
     * (`memory_add`/`memory_import`/`memory_update`)落库成功后把涉及记录投进
     * 投影队——与 distill 分支同源同优先级,闭合"只有蒸馏才投影"的旁路缺口
     * (用户手加记录长期 projected=None 的真根因)。部署未开图谱时 no-op,
     * 用户后续开启由启动/周期补投影兜底(与 distill 分支同一口径)。
     */
    enqueueGraphFor(recordIds) {
        if (recordIds.length === 0 || !this.stores.graph || !this.cfg.graph?.enabled)
            return;
        this.stores.graph.queueGraphProjection([...recordIds], GRAPH_PRIORITY_NEW);
        this.maybeQueueGraphTask();
    }
    /**
     * 强制重投的写面入口(graph-write-plane R3):把上游 R10 的内部
     * `forceReprojectRecord` 接到泵上——删凭证、高优入队、拉泵;幂等由
     * 在途 mapping 的 PK 去重保证。图谱未启用时直接回零(不开"投了永不泵"
     * 的陈旧队列口子,纠正通道的语义前提是图谱通路存在)。
     */
    reprojectGraph(recordIds) {
        const graphs = this.stores.graph;
        if (!graphs || !this.cfg.graph?.enabled || recordIds.length === 0)
            return { queued: 0, jobIds: [] };
        const r = graphs.forceReprojectRecord(recordIds);
        if (r.queued > 0)
            this.maybeQueueGraphTask();
        return r;
    }
    /**
     * 图谱投影泵入队判定:
     * - 双门:部署级 cfg.graph.enabled + 运行时 live.enabled/distill,任一为假不入队;
     * - 占位:同一时刻至多一个 graph 任务在队列(靠 graphPumpQueued 标志),永不与
     *   live 抢位(pickNextTaskIndex 保证 live > graph);
     * - 退避/attempts 封顶:由 GraphStore.claimNext 的 WHERE 过滤与 fail 转 dead 承接,
     *   退避窗口内的 claim 是廉价空转,不在此重复实现。
     */
    maybeQueueGraphTask() {
        const graphs = this.stores.graph;
        if (!graphs || this.stopped || this.graphPumpQueued)
            return;
        if (!this.cfg.graph?.enabled)
            return;
        const liveNow = this.live.get();
        if (!(liveNow.enabled && liveNow.distill))
            return;
        this.graphPumpQueued = true;
        this.pushTask({
            kind: 'graph',
            run: async () => {
                this.graphPumpQueued = false;
                if (this.stopped)
                    return;
                const had = await runGraphProjection(this.ctx, effectiveCfg(this.cfg, this.live), graphs, this.logger, 
                // G-vec 缺陷修的嵌入缝:惰性取 L1 同一嵌入源(活切换不被钉死),
                // 未就绪/失败 embedText 回 undefined = 不补写(词法路不受影响)。
                (t) => this.stores.l1.embedText(t));
                // 有实际投影(说明队列还有积压)才续排;claim 落空则停泵,等下一个触发源
                if (had)
                    this.maybeQueueGraphTask();
            },
        });
    }
    async drain() {
        if (this.draining)
            return;
        this.draining = true;
        try {
            while (!this.stopped && this.tasks.length > 0) {
                const [task] = this.tasks.splice(pickNextTaskIndex(this.tasks), 1);
                try {
                    const result = await task.run();
                    // 回调失败不得影响管线
                    try {
                        task.onDone?.(result);
                    }
                    catch (err) {
                        this.logger.warn(`[memory] 任务完成回调失败(已忽略): ${errDetail(err)}`);
                    }
                }
                catch (err) {
                    this.logger.warn(`[memory] 管线失败(已兜底): ${errDetail(err)}`);
                }
            }
        }
        finally {
            this.draining = false;
        }
    }
    /** 该会话是否处于抽取退避窗口内。 */
    inExtractBackoff(sessionId, now = Date.now()) {
        const f = this.extractFailures.get(sessionId);
        return !!f && now < f.nextAt;
    }
    /** 缓冲落盘(每次蒸馏尝试后调用;失败只告警不阻断管线)。
     *  非重建轮持久化前按桶截断到上限:重建取消后的大桶不至于在后续每次
     *  蒸馏尝试时反复整量序列化落盘(多 MB 级 IO);重建轮豁免维持。 */
    async persistPending(noBufferCap = false) {
        // 只读降级(pending.json 损坏或版本未知):缓冲不再落盘,但**蒸馏照常跑**——
        // 缓冲只是"待蒸馏队列",丢了不回写最多是重启后重蒸馏一轮,
        // 而按旧解释覆盖新格式会真的弄坏文件。
        if (this.pendingDegraded !== undefined) {
            if (!this.pendingDegradedLogged) {
                this.pendingDegradedLogged = true;
                this.logger.warn(`[memory] 未蒸馏缓冲处于只读降级(${this.pendingDegraded}),已停止回写(磁盘文件保持不变)`);
            }
            return;
        }
        try {
            if (!noBufferCap) {
                for (const key of PENDING_MODES) {
                    const bucket = this.pending[key];
                    if (bucket.length > PENDING_BUCKET_CAP)
                        this.pending[key] = bucket.slice(-PENDING_BUCKET_CAP);
                }
            }
            await savePending(this.pendingFile, this.pending, this.warmup);
        }
        catch (err) {
            this.logger.warn(`[memory] 未蒸馏缓冲落盘失败: ${errDetail(err)}`);
        }
    }
    async runTurn(sessionId, messages, mode, opts) {
        const turnStart = Date.now();
        this.logger.info(`[memory] 蒸馏管线开始(session=${sessionId},mode=${mode},本轮 ${messages.length} 条消息,待重试 ${this.pendingCount} 条)`);
        // ── L0:原始对话已由 capture 在 turn/end 即时落盘(不排蒸馏队列,防慢 LLM 阻塞/退出丢消息) ──
        const cfg = effectiveCfg(this.cfg, this.live);
        // ── L1:抽取 + 去重(按档分桶、桶内按会话切片;失败按切片保留待重试) ──
        let newRecords = [];
        const liveNow = this.live.get();
        const distillOn = liveNow.enabled && liveNow.distill;
        if (cfg.extract.enabled && distillOn) {
            const bucket = this.pending[mode];
            // 入桶即携带会话标识(会话切片成员;切片内永不跨会话混装)
            bucket.push(...messages.map((m) => ({ ...m, sessionId })));
            if (!opts?.noBufferCap && bucket.length > PENDING_BUCKET_CAP) {
                bucket.splice(0, bucket.length - PENDING_BUCKET_CAP);
            }
            if (messages.length > 0)
                this.lastActivity.set(sessionId, Date.now());
            // 按会话切片触发:只看本会话切片是否达到生效阈值(渐进爬坡),
            // 达标只抽取该切片——其余会话的切片继续攒,绝不跨会话混装。
            // force:重建轮全量蒸馏(历史小会话也必须出记忆,不受阈值约束)。
            const effective = effectiveExtractThreshold(this.warmup[mode], cfg.extract.minMessages);
            const sliceLen = bucket.reduce((n, m) => (m.sessionId === sessionId ? n + 1 : n), 0);
            // 抽取失败退避:重建轮(noBufferCap,用户显式动作、有自己的失败/取消 UI)豁免
            const backedOff = !opts?.noBufferCap && !opts?.bypassBackoff && this.inExtractBackoff(sessionId);
            if ((opts?.force || sliceLen >= effective) && !backedOff) {
                newRecords = await this.extractSessionSlice(sessionId, mode, cfg, effective, opts);
                // 新记录入投影队列(优先级恒高于存量补投影)并拉起图谱泵;入队本身廉价,
                // 部署未开图谱(cfg.graph.enabled)时不入队——用户后续开启由启动补投影兜底。
                // (写面 R2:分支本体抽成 enqueueGraphFor,与工具三路径同源,不再两处漂移。)
                this.enqueueGraphFor(newRecords.map((r) => r.id));
            }
            else {
                this.logger.debug?.(backedOff
                    ? `[memory] 蒸馏退避中,本轮跳过抽取(session=${sessionId},mode=${mode})`
                    : `[memory] 会话切片攒批中(session=${sessionId},mode=${mode},${sliceLen}/${effective})`);
                // 攒阈值中途也落盘:进程退出后切片与爬坡状态不丢
                await this.persistPending(opts?.noBufferCap);
            }
        }
        // ── L2/L3:按记录族各自判定与执行 ──
        if (cfg.l2.enabled && distillOn) {
            for (const family of ['chat', 'work']) {
                const familyRecords = newRecords.filter((r) => (r.family ?? 'chat') === family);
                if (familyRecords.length === 0)
                    continue;
                const fstate = this.states[family];
                if (fstate.newMemoriesSinceL2 >= cfg.l2.minNewMemories) {
                    try {
                        const t = Date.now();
                        const result = await runSceneConsolidation(this.ctx, cfg, this.stores.scenes[family], familyRecords, this.logger, family);
                        fstate.lastL2At = Date.now();
                        fstate.newMemoriesSinceL2 = 0;
                        if (result.personaRequestedReason)
                            fstate.personaRequestedReason = result.personaRequestedReason;
                        this.logger.info(`[memory] L2 阶段完成(family=${family},${Date.now() - t}ms)`);
                        // §F 追踪:L2 run 级事件
                        trace({
                            kind: 'distill_run',
                            ts: Date.now(),
                            layer: 'l2',
                            sessionId,
                            inputChars: familyRecords.reduce((n, m) => n + m.content.length, 0),
                            durationMs: Date.now() - t,
                            newRecords: familyRecords.length,
                            ok: true,
                        });
                    }
                    catch (err) {
                        this.logger.warn(`[memory] L2 场景整合失败(family=${family}): ${errDetail(err)}`);
                        trace({
                            kind: 'distill_run',
                            ts: Date.now(),
                            layer: 'l2',
                            sessionId,
                            inputChars: familyRecords.reduce((n, m) => n + m.content.length, 0),
                            durationMs: 0,
                            ok: false,
                            errorKind: err instanceof Error ? err.name : 'error',
                        });
                    }
                }
                else {
                    this.logger.debug?.(`[memory] L2 跳过(family=${family},本族新增 ${familyRecords.length} 条,累计未整合 ${fstate.newMemoriesSinceL2}/${cfg.l2.minNewMemories})`);
                }
            }
        }
        if (cfg.l3.enabled && distillOn) {
            for (const family of ['chat', 'work']) {
                const tL3 = Date.now();
                try {
                    await runPersona(this.ctx, cfg, this.stores.scenes[family], this.stores.persona[family], this.states[family], this.logger, family);
                    // §F 追踪:L3 run 级事件
                    trace({ kind: 'distill_run', ts: Date.now(), layer: 'l3', sessionId, inputChars: 0, durationMs: Date.now() - tL3, ok: true });
                }
                catch (err) {
                    this.logger.warn(`[memory] L3 画像蒸馏失败(family=${family}): ${errDetail(err)}`);
                    trace({
                        kind: 'distill_run',
                        ts: Date.now(),
                        layer: 'l3',
                        sessionId,
                        inputChars: 0,
                        durationMs: 0,
                        ok: false,
                        errorKind: err instanceof Error ? err.name : 'error',
                    });
                }
            }
        }
        // ── 持久化状态 ──
        try {
            await this.stores.state.save();
        }
        catch (err) {
            this.logger.warn(`[memory] 状态保存失败: ${errDetail(err)}`);
        }
        this.logger.info(`[memory] 蒸馏管线结束(本轮新增 ${newRecords.length} 条,总耗时 ${Date.now() - turnStart}ms)`);
        this.afterRun?.();
        return newRecords.length;
    }
    /**
     * 蒸馏背景窗(T8.4 读切,task_19):DRSC 会话尾窗(redact 臂)→ ConversationMessage。
     * - 形状映射:segment 行 → 消息(drscRowToConversationMessage;非 user/assistant 段跳过);
     * - 坐标剔除:切片自身轮次整轮剔除(尾窗在 DRS 30s interval 同步后会含刚捕获
     *   的 turn——旧 l0 读面按消息 id 剔除,跨系统 id 不同构,按坐标等价替身);
     * - 报错口径:collector 缺席/超时 → warn 后空窗降级,**不抛穿蒸馏管线**
     *   (工具面 conversation_search 的显式报错口径在 tools 层分清,spec R7)。
     */
    async drscBackground(sessionId, n, sliceTurns) {
        if (n <= 0)
            return [];
        try {
            const rows = await this.stores.drsc.sessionTail(sessionId, n);
            return rows
                .map((r) => drscRowToConversationMessage(r, sessionId))
                .filter((m) => m !== undefined)
                .filter((m) => m.anchor === undefined || !sliceTurns.has(m.anchor.turn))
                .slice(-n);
        }
        catch (err) {
            this.logger.warn(`[memory] 蒸馏背景窗拉取失败(DRSC),本轮空窗降级: ${errDetail(err)}`);
            return [];
        }
    }
    /**
     * 抽取并消费一个会话切片:成功才把切片移出桶并推进爬坡阈值;失败保留切片待重试。
     * 调用方已保证切片达到生效阈值(或 force)。背景参考按会话从 DRSC 尾窗现查并
     * 剔除切片自身轮次(ADR-0003:会话间互不污染、重启不丢背景)。
     */
    async extractSessionSlice(sessionId, mode, cfg, effectiveThreshold, opts) {
        const bucket = this.pending[mode];
        const slice = bucket.filter((m) => m.sessionId === sessionId);
        if (slice.length === 0)
            return [];
        const rest = bucket.filter((m) => m.sessionId !== sessionId);
        try {
            // 背景参考(T8.4 读切):DRSC 会话尾窗(redact 臂)按会话现查(ADR-0003 等价),
            // 剔除切片自身轮次(切片消息可能已进 DRS 尾窗——30s interval 同步后)。
            // 多取切片条数补偿被剔除者,与旧 l0 读面同口径。
            const background = this.stores.drsc
                ? await this.drscBackground(sessionId, cfg.extract.backgroundMessages + slice.length, new Set(slice.map((m) => m.anchor?.turn).filter((t) => typeof t === 'number')))
                : [];
            const t = Date.now();
            // R7:锚点映射同时收切片与背景——模型偶尔会引用背景消息的 id,收了它
            // 就能追溯到正确坐标;不收则那条被静默丢弃(丢弃是可接受降级,比编坐标好)。
            const anchorMap = buildAnchorMap([...slice, ...background]);
            const result = await runExtraction(this.ctx, cfg, this.stores.l1, this.states, slice, background, this.logger, mode, 
            // §E 写入侧工作区:后台蒸馏手上只有 sessionId(没有 exec),经
            // `ctx.get('agents')` 宽容解析——与 §A 的多级父链解析同一招。
            // 拿不到 → undefined → 归属回落 global(pipeline 侧 `resolveRecordScope` 兜底)。
            sessionWorkspaceIdOf(this.ctx, sessionId), anchorMap, 
            // 派生数据跟着搬（P0-d）：不搬等于每次合并把这条记忆的使用史与人工标注清零。
            // 两个 sidecar 都是后装上的（`stores.usage` 在装配段才填），故在调用时点现取。
            (oldId, newId) => {
                this.stores.usage?.rekey(oldId, newId);
                this.stores.feedback?.rekey(oldId, newId);
            }, this.stores.routeHealth);
            // R9: 本轮学到的跑通块长落盘（best-effort，失败不阻蒸馏）
            await this.stores.routeHealth?.save().catch(() => { });
            if (!result.skipped) {
                // R1′ 部分消费：成功块出桶、抽取失败块留桶下轮重投（rest ∪ failedMessages）
                this.pending[mode] = [...rest, ...(result.failedMessages ?? [])];
                // 重建轮(force)不是有机对话,不推进爬坡
                if (!opts?.force)
                    this.warmup[mode] = advanceWarmupThreshold(this.warmup[mode], cfg.extract.minMessages);
                // 会话产出记账(成功消费即记——零产出也算"蒸馏过",lastAt 推进)
                this.noteSessionDistill(sessionId, result.newRecords.length);
                // 成功消费清零失败退避(切片已出桶,后续轮次恢复正常触发)
                this.extractFailures.delete(sessionId);
            }
            this.logger.info(`[memory] L1 阶段完成(session=${sessionId},mode=${mode},切片 ${slice.length} 条,背景 ${background.length} 条,阈值 ${effectiveThreshold},${Date.now() - t}ms)`);
            // §F 追踪:L1 run 级事件(runId/byKind 与 l1_receipts 同源,可交叉审计);
            // skipped = 蒸馏开关关闭的 no-op,不入追踪
            if (!result.skipped) {
                trace({
                    kind: 'distill_run',
                    ts: Date.now(),
                    layer: 'l1',
                    sessionId,
                    runId: result.runId,
                    inputChars: slice.reduce((n, m) => n + m.content.length, 0),
                    byKind: result.byKind,
                    newRecords: result.newRecords.length,
                    durationMs: Date.now() - t,
                    ok: true,
                });
            }
            // 缓冲与爬坡每次尝试后立即落盘:进程中途退出不丢待重试/攒阈值状态
            await this.persistPending(opts?.noBufferCap);
            // L1 计数推进后立即落盘:L2/L3 失败或进程中途退出不得回滚阈值进度
            // (记录已入库但计数丢失会让该族 L2 永远差一截,state 与 DB 脱节)
            try {
                await this.stores.state.save();
            }
            catch (err) {
                this.logger.warn(`[memory] 状态保存失败: ${errDetail(err)}`);
            }
            return result.newRecords;
        }
        catch (err) {
            // 保留切片下次重试(桶入口已裁到 ≤200,防无限堆积;重建轮不裁,量被会话规模约束)
            this.logger.warn(`[memory] L1 抽取失败(session=${sessionId},mode=${mode},切片 ${slice.length} 条): ${errDetail(err)}`);
            // §F 追踪:失败也是 run 级事实(退避链路诊断)
            trace({
                kind: 'distill_run',
                ts: Date.now(),
                layer: 'l1',
                sessionId,
                inputChars: slice.reduce((n, m) => n + m.content.length, 0),
                durationMs: 0,
                ok: false,
                errorKind: err instanceof Error ? err.name : 'error',
            });
            // R4:无可用蒸馏路由=配置缺失、非模型慢——不进退避(否则把"没配"误当故障反复退避)，只顺延。
            if (err instanceof NoDistillRouteError) {
                this.logger.warn(`[memory] 无可用蒸馏路由,本轮蒸馏顺延、不记退避(session=${sessionId},mode=${mode})`);
                await this.persistPending(opts?.noBufferCap).catch(() => { });
                return [];
            }
            // 指数退避:压制闲置兜底/补跑在 LLM 故障期间的连环重试(成功消费时清零)
            const streak = (this.extractFailures.get(sessionId)?.streak ?? 0) + 1;
            const delayMs = extractionBackoffMs(streak);
            this.extractFailures.set(sessionId, { streak, nextAt: Date.now() + delayMs });
            this.logger.info(`[memory] 蒸馏连续失败 ${streak} 次,${Math.round(delayMs / 1000)}s 内暂停该会话的自动重试`);
            await this.persistPending(opts?.noBufferCap).catch(() => { });
            return [];
        }
    }
}
