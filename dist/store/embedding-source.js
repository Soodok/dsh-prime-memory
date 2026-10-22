/**
 * 嵌入源状态层 + 活切换管理器。
 *
 * - 状态文件 embedding-source.json(写穿持久化:内存态 + tmp/rename 原子写 +
 *   写队列串行化);无文件 = remote(与历史行为完全一致,老用户无感);
 * - 生效 = 部署上限 AND 运行时选择(仓库铁律):远程档要求静态四件套配齐
 *   (运行时覆盖字段由 effectiveCfg 注入后同样计入),本地档受
 *   embedding.allowLocalModels 上限约束;
 * - 活切换链(后台执行,RPC 立即返回 accepted,进度靠轮询):
 *   安装运行时(首次本地)→ 预热加载 → 换服务 + swapProvider(维度变化 drop 向量表)
 *   → 后台全量重嵌(L1 计数进度,可取消;l0 计数进度字段随契约保留恒 0)→ 持久化状态。
 *   失败语义:异常(安装失败/模型加载失败/db 拒绝)→ 状态不持久化,重启回到旧源;
 *   重嵌取消/部分失败 → 已切换(物理表即新维度,meta 已同步),缺失向量由周期
 *   backfill 补齐——不回滚(回滚需要再 drop 一次表,得不偿失)。
 */
import * as path from 'node:path';
import { readJsonStrict, rmwJson } from '../util/io.js';
import { NoopEmbeddingService, RemoteEmbeddingService } from './embedding.js';
import { catalogById, MODEL_CATALOG } from './model-catalog.js';
import { LocalEmbeddingService } from './local-embedding.js';
// ── 状态存储(写穿持久化) ──
/** 向量计数缓存 TTL(忙时:重建/切换进行中,进度要看得见)。 */
const VEC_CACHE_TTL_BUSY_MS = 1_000;
/** 向量计数缓存 TTL(空闲:面板常开也不敲库)。 */
const VEC_CACHE_TTL_IDLE_MS = 30_000;
export class EmbeddingSourceStore {
    state = { source: 'remote', activeModel: null };
    file;
    writeQueue = Promise.resolve();
    logger;
    /** 只读降级原因(undefined = 正常):文件损坏/不可读时置位,此后 `set()` 一律失败。 */
    degraded;
    /** 本进程上次成功写入的磁盘内容(紧凑 JSON);并发冲突判据。 */
    lastPersisted;
    constructor(dataDir, logger) {
        this.file = path.join(dataDir, 'embedding-source.json');
        this.logger = logger;
    }
    get() {
        return { ...this.state };
    }
    /**
     * 读侧 strict 化(文件层加固 T2.11)。
     *
     * 旧实现是「裸 readFile + 外层 `catch {}`」:那个 catch 同时吞掉 ENOENT 与
     * **JSON 解析错误**,于是「文件损坏」与「首次运行」长得一模一样——既无告警,
     * 也会在随后被回写覆盖。现在三态分开:
     * - `missing` → 默认 remote(历史行为,老用户无感),**不告警**;
     * - `corrupt` / `unreadable` → 告警 + **只读降级**(后续 `set()` 抛错,不覆盖原文件);
     * - 形状非法(解析成功但字段不对)→ 告警,同样按默认 remote 起步。
     */
    async init() {
        const r = await readJsonStrict(this.file);
        if (!r.ok) {
            if (r.reason === 'missing')
                return;
            this.degraded = r.reason;
            this.logger?.warn(`[memory] 嵌入源状态文件${r.reason === 'corrupt' ? '损坏' : '不可读'}(${this.file}): ` +
                `按默认 remote 起步且**不回写**,原文件已保留${r.detail ? ` — ${r.detail}` : ''}`);
            return;
        }
        const parsed = r.value;
        if ((parsed.source === 'remote' || parsed.source === 'local' || parsed.source === 'off') &&
            (parsed.activeModel === null || typeof parsed.activeModel === 'string')) {
            this.state = { source: parsed.source, activeModel: parsed.activeModel };
            this.lastPersisted = JSON.stringify(this.state);
        }
        else {
            this.logger?.warn('[memory] 嵌入源状态文件形状非法,按默认 remote 起步');
        }
    }
    /**
     * 改状态并写穿持久化。
     *
     * **失败必须对调用方可观测**:旧实现是 `writeQueue.then(persist).catch(() => {})`,
     * 写失败后 `await` 照样 resolve——调用方以为已落盘,重启却回到旧源(G6 静默失败)。
     * 现在本次 await 直接抛出;队列本身用 `.catch()` 兜住,免得一次失败把后续
     * set 永久钉在 rejected 链上。
     */
    async set(next) {
        if (this.degraded !== undefined) {
            // 损坏文件绝不覆盖:重启会回到旧源,但用户至少能看到这条失败(不再"改了没生效")
            throw new Error(`嵌入源状态文件${this.degraded === 'corrupt' ? '已损坏' : '不可读'},拒绝覆盖: ${this.file}`);
        }
        this.state = { source: next.source, activeModel: next.activeModel };
        const write = this.writeQueue.then(() => this.persist());
        this.writeQueue = write.catch(() => { });
        await write;
    }
    /**
     * 落盘。走 `atomicWriteText` 而不是自研 tmp+rename:白拿文件级 fsync、
     * 随机 tmp 名(旧实现的固定名 `*.tmp` 在多实例下会撞名)、以及失败路径清理。
     */
    async persist() {
        // 锁内 RMW(T4.11):嵌入源是"改一次落一次"的低频写,锁开销可忽略;
        // 两个实例并发 set 时,后写的那个会看到磁盘与自己的上次写入不同 → 显式失败。
        await rmwJson(this.file, async (cur) => {
            const diskRaw = cur.ok ? JSON.stringify(cur.value) : undefined;
            if (this.lastPersisted !== undefined && diskRaw !== undefined && diskRaw !== this.lastPersisted) {
                throw new Error(`嵌入源状态已被其它进程更新,本次写入已取消以避免覆盖;请重试该操作`);
            }
            const next = { source: this.state.source, activeModel: this.state.activeModel };
            this.lastPersisted = JSON.stringify(next);
            return { next, result: undefined };
        }, { logger: this.logger, purpose: 'embedding-source-rmw' });
    }
}
/** 远程档部署上限:baseUrl + model + 维度 + enabled。apiKey 可选(本地免 key 自托管
 *  /embeddings 也放行——与蒸馏 direct 通道的 key 可选语义一致)。cfg.embedding 缺失视为未就绪。 */
export function remoteCeiling(cfg) {
    const e = cfg.embedding;
    if (!e)
        return false;
    return e.enabled && !!e.baseUrl && !!e.model && e.dimensions > 0;
}
export async function resolveInitialEmbedding(cfg, sourceStore, downloader, makeLocal, logger) {
    const state = sourceStore.get();
    if (state.source === 'off') {
        return { svc: new NoopEmbeddingService(), dims: 0 };
    }
    if (state.source === 'local') {
        if (!cfg.embedding.allowLocalModels) {
            logger?.warn('[memory] 嵌入源为 local 但部署已禁用本地模型(allowLocalModels=false),本次运行纯 FTS');
            return { svc: new NoopEmbeddingService(), dims: 0, note: '部署配置已禁用本地嵌入模型' };
        }
        const entry = state.activeModel ? catalogById(state.activeModel) : undefined;
        if (!entry) {
            logger?.warn(`[memory] 嵌入源 local 的模型 ${state.activeModel} 不在目录,本次运行纯 FTS`);
            return { svc: new NoopEmbeddingService(), dims: 0, note: '启用的模型不在内置目录' };
        }
        if (!(await downloader.isDownloaded(entry.id))) {
            logger?.warn(`[memory] 本地模型 ${entry.id} 文件缺失(可能被清理),本次运行纯 FTS`);
            return { svc: new NoopEmbeddingService(), dims: 0, note: '模型文件缺失,请重新下载' };
        }
        const svc = makeLocal(entry.id);
        if (!svc)
            return { svc: new NoopEmbeddingService(), dims: 0, note: '本地服务构造失败' };
        return { svc, dims: entry.dims, providerInfo: { provider: 'local', model: entry.id, dimensions: entry.dims } };
    }
    // remote(默认)
    if (!remoteCeiling(cfg)) {
        return { svc: new NoopEmbeddingService(), dims: 0 };
    }
    const svc = new RemoteEmbeddingService({
        baseUrl: cfg.embedding.baseUrl,
        apiKey: cfg.embedding.apiKey,
        model: cfg.embedding.model,
        dimensions: cfg.embedding.dimensions,
        maxInputChars: cfg.embedding.maxInputChars,
        timeoutMs: cfg.embedding.timeoutMs,
        logger,
    });
    return { svc, dims: cfg.embedding.dimensions, providerInfo: svc.getProviderInfo() };
}
/** 本地服务构造工厂(index.ts 的初始解析与 Manager 共用一份实现,防漂移)。
 *  推理在 fork 子进程(见 local-embedding.ts,fix #11);此处只传 runtime 目录与模型目录。 */
export function makeLocalServiceFactory(installer, downloader, logger, maxInputChars, 
/** 测试注入缝:子进程资产路径(源码态下 dist 产物不存在,显式指向 resources 源文件)。 */
childPath) {
    return (modelId) => {
        const entry = catalogById(modelId);
        if (!entry)
            return null;
        return new LocalEmbeddingService(entry, downloader.modelsDir(entry.id), {
            runtimeDir: installer.runtimeDir,
            childPath,
            logger,
            maxInputChars,
        });
    };
}
export class EmbeddingManager {
    sourceStore;
    installer;
    downloader;
    deps;
    current;
    localSvc = null;
    applyPhase = 'idle';
    applyMessage = '';
    applyStartedAt = 0;
    applyBusy = false;
    reindex = {
        running: false,
        l1Done: 0,
        l1Total: 0,
        l0Done: 0,
        l0Total: 0,
        startedAt: 0,
        cancelled: false,
    };
    reindexCancel = false;
    /**
     * 上一次重建的留痕（类型就地取自契约，不另开 import）。
     *
     * 为什么必须存：进度条只在 `running` 期间存在，而“待补 0 条”的重建会瞬间跑完，
     * 界面上与“点了没反应”长得一模一样——真机反馈就是这么读的。留痕存**前后待补数**，
     * 让“效果”是两个可比数字而不是一句“我转了一下”。
     */
    reindexLast;
    /**
     * 向量计数缓存(分级 TTL)。
     *
     * 见 `vectorsCached()`:`embedding-state-get` 是设置页轮询热点,
     * 原实现每次现场跑 6 次 COUNT + 2 次 vec0 LEFT JOIN(实测 2.5–3.1s)。
     */
    vecCache = null;
    /** 停机标志:dispose 后应用链不再推进(防卸载后的孤儿重嵌/安装)。 */
    disposedFlag = false;
    /** 当前生效目标的 providerInfo(backfill/启动链的 meta 写入用——杜绝陈旧闭包)。 */
    currentInfo;
    /** 初始解析的降级说明(活切换成功后清空,防过期提示常驻)。 */
    activeNote;
    constructor(deps) {
        this.deps = deps;
        this.sourceStore = deps.sourceStore;
        this.installer = deps.installer;
        this.downloader = deps.downloader;
        this.current = deps.initial.svc;
        this.currentInfo = deps.initial.providerInfo;
        this.activeNote = deps.initial.note;
        // 启动即本地档:initial.svc 已是绑定真实运行时 loader 的 LocalEmbeddingService。
        // 立即后台预热(不阻塞启动)——否则 L1/L0.reindex 与 EmbedHelper.batch 的
        // vectorReady 短路都不会触发懒加载,缺失向量要等到首次召回才补
        if (deps.initial.providerInfo?.provider === 'local') {
            this.localSvc = this.current;
            this.localSvc.startWarmup();
        }
    }
    /** 当前目标的 providerInfo(index.ts 的启动重嵌链/周期 backfill 写 meta 用)。 */
    currentProviderInfo() {
        return this.currentInfo;
    }
    /** 当前生效配置(运行时覆盖优先;缺省回退静态 deps.cfg)。远程档 ceiling/换端点都读它。 */
    eff() {
        return this.deps.getEff ? this.deps.getEff() : this.deps.cfg;
    }
    /** 取消运行时安装(RPC:npm 卡死/用户主动放弃)。 */
    cancelRuntimeInstall() {
        return this.installer.cancel();
    }
    /** 当前生效服务(index.ts 初始建 store 用)。 */
    getService() {
        return this.current;
    }
    /** 构造绑定真实运行时 loader 的本地服务(deps.makeLocal 可注入,测试替换)。 */
    makeLocalService(modelId) {
        const factory = this.deps.makeLocal ?? makeLocalServiceFactory(this.installer, this.downloader, this.deps.logger, this.deps.cfg.embedding.maxInputChars);
        return factory(modelId);
    }
    /** 活切换请求:验证通过即接受,后台执行应用链(进度轮询可见)。 */
    requestSource(next) {
        if (this.applyBusy)
            return { accepted: false, error: '切换进行中,请等待完成' };
        if (next.source === 'remote' && !remoteCeiling(this.eff())) {
            return { accepted: false, error: '未配置远程嵌入(baseUrl/model/dimensions,可在设置页填写),远程档不可选' };
        }
        if (next.source === 'local') {
            if (!this.deps.cfg.embedding.allowLocalModels) {
                return { accepted: false, error: '部署已禁用本地嵌入模型(allowLocalModels=false)' };
            }
            if (!next.activeModel || !catalogById(next.activeModel)) {
                return { accepted: false, error: '请选择内置目录中的模型' };
            }
        }
        const state = {
            source: next.source,
            activeModel: next.source === 'local' ? next.activeModel : null,
        };
        this.applyBusy = true;
        this.applyStartedAt = Date.now();
        this.applyMessage = '';
        void this.applyChain(state).finally(() => {
            this.applyBusy = false;
            this.invalidateVecCache(); // 切换链含 drop 重建,计数必须重新取
        });
        return { accepted: true };
    }
    /** 下载启动(串行队列忙时拒绝);完成后自动做一次可加载性预热验证。 */
    startDownload(modelId) {
        if (!this.deps.cfg.embedding.allowLocalModels) {
            return { ok: false, error: '部署已禁用本地嵌入模型' };
        }
        if (!catalogById(modelId))
            return { ok: false, error: '未知模型' };
        if (this.downloader.isBusy())
            return { ok: false, error: '已有下载任务进行中' };
        void this.downloader
            .start(modelId)
            .then(async (p) => {
            if (p.phase !== 'done')
                return;
            // 下载完成自动预热验证:当前启用模型 → 直接 warmup;未启用的临时模型验完即释放
            if (this.sourceStore.get().source === 'local' && this.sourceStore.get().activeModel === modelId) {
                this.localSvc?.startWarmup();
                return;
            }
            const scratch = this.makeLocalService(modelId);
            if (!scratch)
                return;
            if (await this.installer.isReady()) {
                // 预热只为验证可加载性:完成后必须释放(bge-m3 ~550MB,不关就常驻泄漏,
                // 且 onnxruntime 持文件句柄会卡住该模型的删除)
                scratch.startWarmup();
                void scratch.waitForReady().then(() => scratch.close(), () => scratch.close());
            }
        })
            .catch(() => {
            /* 失败态在 downloader 进度里 */
        });
        return { ok: true };
    }
    cancelDownload() {
        return this.downloader.cancel();
    }
    async deleteModel(modelId) {
        const state = this.sourceStore.get();
        if (state.source === 'local' && state.activeModel === modelId) {
            return { ok: false, error: '该模型正在使用中,请先切换嵌入源' };
        }
        return this.downloader.deleteModel(modelId);
    }
    cancelReindex() {
        if (!this.reindex.running)
            return false;
        this.reindexCancel = true;
        return true;
    }
    /**
     * 手动触发重建(RPC:`embedding-reindex`)。
     *
     * 受理即返回,不等跑完——进度照旧走 `snapshot().reindex` 轮询,不在这里回传。
     * 门槛全部前置,且**宁可拒绝也不谎报**:以下四种情况直接抛错而非"成功受理":
     *
     * - 插件已卸载 / 重嵌已在跑 / 嵌入源切换占着锁:并发语义,重复触发无意义;
     * - 嵌入服务未就绪:`L1Store.reindex` 会**静默短路**成
     *   `0/0/0`,受理了就等于告诉用户"重建成功、零条待补"——而真相是它根本没开始。
     *
     * 用抛错而不是返回 `{accepted:false, error}`:与 `embedding-model-delete` 等既有
     * 端点一致,客户端 `call()` 已有统一的错误呈现,多一套返回形状只会多一处要维护。
     */
    startReindex() {
        if (this.disposedFlag)
            throw new Error('插件已卸载，无法重建');
        if (this.reindex.running)
            throw new Error('重建已在进行中');
        if (this.applyBusy)
            throw new Error('嵌入源切换进行中，请稍后再试');
        if (!this.currentInfo)
            throw new Error('嵌入源已关闭，重建无意义（请先启用嵌入）');
        if (!this.deps.l1.vectorsReady()) {
            throw new Error('嵌入服务未就绪（模型加载中或推理运行时未安装），请稍后再试');
        }
        void this.reindexNow()
            .then((r) => {
            if (r.error)
                this.deps.logger.warn(`[memory] 手动重建失败: ${r.error}`);
            else
                this.deps.logger.info(`[memory] 手动重建结束（已取消=${r.cancelled}, 失败=${r.failedTotal}）`);
        })
            .catch(() => {
            /* reindexNow 内部已兜底,不外抛(否则成未处理的 rejection) */
        });
        return { accepted: true };
    }
    /** 应用链/后台任务是否在跑(backfill 并发门禁用)。 */
    isBusy() {
        return this.applyBusy || this.reindex.running || this.downloader.isBusy();
    }
    /** 停机钩子(插件 dispose):取消 npm 安装、下载与重嵌——不留后台孤儿任务。 */
    dispose() {
        this.disposedFlag = true;
        this.installer.cancel();
        this.downloader.cancel();
        this.cancelReindex();
        this.localSvc?.close();
    }
    async applyChain(next) {
        try {
            let svc;
            let providerInfo;
            if (next.source === 'off') {
                this.applyPhase = 'switching';
                svc = new NoopEmbeddingService();
                providerInfo = undefined;
                this.currentInfo = undefined;
            }
            else if (next.source === 'remote') {
                this.applyPhase = 'switching';
                const re = this.eff().embedding;
                svc = new RemoteEmbeddingService({
                    baseUrl: re.baseUrl,
                    apiKey: re.apiKey,
                    model: re.model,
                    dimensions: re.dimensions,
                    maxInputChars: re.maxInputChars,
                    timeoutMs: re.timeoutMs,
                    logger: this.deps.logger,
                });
                providerInfo = svc.getProviderInfo();
            }
            else {
                // local:下载完整性前置校验 → 运行时 → 预热 → 切换
                if (!(await this.downloader.isDownloaded(next.activeModel))) {
                    throw new Error('模型文件不完整(未下载或已损坏),请先完成下载');
                }
                if (!(await this.installer.isReady())) {
                    this.applyPhase = 'installing-runtime';
                    const ok = await this.installer.ensure();
                    if (!ok) {
                        throw new Error(`运行时安装失败: ${this.installer.getProgress().error ?? '未知原因'}`);
                    }
                }
                if (this.disposedFlag)
                    throw new Error('插件已卸载,切换中止');
                this.applyPhase = 'warming';
                const local = this.makeLocalService(next.activeModel);
                if (!local)
                    throw new Error('模型不在目录');
                await local.waitForReady();
                svc = local;
                providerInfo = local.getProviderInfo();
                this.applyPhase = 'switching';
            }
            // 换服务 + 换表(providerInfo 变化 → drop 向量表按新维度重建)
            let needsReindex = false;
            if (providerInfo) {
                const swap = this.deps.db.swapProvider(providerInfo);
                if (!swap.ok)
                    throw new Error(swap.error ?? '切换向量引擎失败');
                needsReindex = swap.needsReindex;
                // 物理表在 swap 成功那一刻已是新维度——meta 立即跟上(即使后续重嵌被取消/
                // 部分失败):meta 的语义是"物理表现状",缺失行由 backfill 按 missing 计数补,
                // 不依赖 meta。拖着不写会把"meta=旧 provider"留给下次比对埋雷。
                this.deps.db.markEmbeddingSynced(providerInfo);
                this.currentInfo = providerInfo;
            }
            const oldLocal = this.localSvc;
            this.localSvc = next.source === 'local' ? svc : null;
            this.current = svc;
            this.deps.l1.setEmbeddingService(svc);
            oldLocal?.close();
            let pendingNote = '';
            if (needsReindex) {
                if (this.disposedFlag)
                    throw new Error('插件已卸载,重嵌入中止');
                this.applyPhase = 'reindexing';
                const result = await this.reindexNow();
                if (result.cancelled) {
                    pendingNote = ';重嵌入已取消,缺失向量由周期任务补齐';
                    this.deps.logger.warn('[memory] 重嵌入已取消,缺失向量将由周期补齐(检索暂按关键词降级)');
                }
                else if (result.failedTotal > 0) {
                    pendingNote = `;${result.failedTotal} 条向量待补齐(周期任务会补)`;
                }
                if (result.error)
                    throw new Error(result.error);
            }
            // 落盘失败不等于切换失败:走到这里服务已换、物理表已按新维度重建——真相是
            // "本次会话用新源、重启回旧源"。旧实现把失败吞掉(§6.2),UI 却显示完全成功,
            // 于是用户以为已保存。这里如实报出来,不再把两种结果混成一个 'done'。
            let persistNote = '';
            try {
                await this.sourceStore.set(next);
            }
            catch (err) {
                persistNote = ';状态持久化失败,重启将回到旧嵌入源';
                this.deps.logger.warn(`[memory] 嵌入源状态持久化失败(本次会话仍用新源): ${err instanceof Error ? err.message : String(err)}`);
            }
            this.activeNote = undefined;
            this.applyPhase = 'done';
            this.applyMessage =
                (next.source === 'off' ? '已切换为关键词检索' : '切换完成' + pendingNote) + persistNote;
        }
        catch (err) {
            this.applyPhase = 'error';
            this.applyMessage = err instanceof Error ? err.message : String(err);
            this.deps.logger.warn(`[memory] 嵌入源切换失败(状态保持不变): ${this.applyMessage}`);
        }
    }
    async reindexNow() {
        this.reindexCancel = false;
        this.reindex = { running: true, l1Done: 0, l1Total: 0, l0Done: 0, l0Total: 0, startedAt: Date.now(), cancelled: false };
        // 重建**前**的待补数：先破缓存再取，否则拿到的可能是 TTL 里的旧值（那会让“前后差”假报 0）。
        // 口径故意与界面用的同一个（相减法），不拿精确口径去对展示数字，否则两边永远对不上。
        this.invalidateVecCache();
        const v0 = this.vectorCounts();
        const missingBefore = { l1: v0.l1.missing, l0: v0.l0.missing };
        const finish = (cancelled, error) => {
            this.invalidateVecCache();
            const v1 = this.vectorCounts();
            const at = Date.now();
            this.reindexLast = {
                finishedAt: at,
                durationMs: Math.max(0, at - this.reindex.startedAt),
                processed: this.reindex.l1Done + this.reindex.l0Done,
                planned: this.reindex.l1Total + this.reindex.l0Total,
                failed: failedTotal,
                cancelled,
                ...(error === undefined ? {} : { error }),
                missingBefore,
                missingAfter: { l1: v1.l1.missing, l0: v1.l0.missing },
            };
        };
        let failedTotal = 0;
        try {
            const r1 = await this.deps.l1.reindex({
                onProgress: (done, total) => {
                    this.reindex.l1Done = done;
                    this.reindex.l1Total = total;
                },
                shouldCancel: () => this.reindexCancel,
            });
            failedTotal += r1.failed;
            // T8.4:l0 向量腿随写停退役(表清空后无缺失,无需重建);契约的
            // l0Done/l0Total 字段保留恒 0,client 进度面零改动。
            const cancelled = !!r1.cancelled;
            this.reindex.cancelled = cancelled;
            this.reindex.running = false;
            this.invalidateVecCache(); // 收尾:计数必须立刻反映重建结果(TTL 可能还压着 1s 旧值)
            finish(cancelled);
            return { cancelled, failedTotal };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.reindex.running = false;
            this.reindex.error = message;
            this.invalidateVecCache();
            finish(false, message);
            return { cancelled: false, failedTotal, error: `重嵌入失败: ${message}` };
        }
    }
    /** RPC 快照(设置页嵌入区块数据源;client 忙时 1s 轮询)。 */
    async snapshot() {
        const status = await this.downloader.listStatus();
        const models = MODEL_CATALOG.map((entry) => {
            const s = status.find((x) => x.id === entry.id);
            return {
                id: entry.id,
                name: entry.name,
                dims: entry.dims,
                contextTokens: entry.contextTokens,
                tags: entry.tags,
                description: entry.description,
                totalBytes: s?.totalBytes ?? 0,
                bytesOnDisk: s?.bytesOnDisk ?? 0,
                state: s?.state ?? 'none',
            };
        });
        const state = this.sourceStore.get();
        const effE = this.eff().embedding;
        return {
            source: state.source,
            activeModel: state.activeModel,
            ceilings: { remote: remoteCeiling(this.eff()), local: this.deps.cfg.embedding.allowLocalModels },
            remote: {
                baseURL: effE.baseUrl ?? '',
                model: effE.model ?? '',
                dimensions: effE.dimensions ?? 0,
                // API key:生效(运行时覆盖 ? 静态配置)非空即视为已配置——明文不回传
                apiKeySet: Boolean(effE.apiKey),
            },
            runtime: this.installer.getProgress(),
            models,
            download: this.downloader.getProgress(),
            apply: { phase: this.applyPhase, message: this.applyMessage, startedAt: this.applyStartedAt, busy: this.applyBusy },
            local: this.localSvc ? { state: this.localSvc.getState(), error: this.localSvc.getLoadError() } : null,
            reindex: { ...this.reindex, last: this.reindexLast },
            vectors: this.vectorsCached(),
            activeNote: this.activeNote,
        };
    }
    /**
     * 向量索引计数(设置页「已嵌入 X / 总 Y」的数据源)。
     *
     * **缺失数走相减,不走 `countVecMissing` 的 LEFT JOIN**。原因:vec 表是
     * `vec0` 虚拟表,普通谓词下 `LEFT JOIN ... WHERE v.record_id IS NULL` 退化成
     * **逐行 probe**(L0 侧驱动 24467 行),实测该接口稳定 2.5–3.1s —— 而它只是个展示用计数。
     * 相减法的前提是「vec 表无指向已删记录的孤儿行」,已对四条写路径审计(硬删同事务删 vec /
     * 软删走 detach / upsert 先删再插 / clearL1 DROP 重建),并以 `Math.max(0, ·)` 兜底。
     *
     * ⚠️ **仅用于展示**。`index.ts` 里「missing 复查 == 0 才 markEmbeddingSynced」的门控
     * 仍走精确的 `countVecMissing` —— 那处若因孤儿行少算,会把未完成的重建误标成完成。
     *
     * db 层的 `-1` 哨兵原样透传(向量能力不可用),UI 据此换文案——
     * 不在这里折叠成 0,否则"能力挂了"与"一条都没嵌"在界面上长得一样。
     */
    vectorCounts() {
        const count = (kind) => {
            const skip = this.deps.db.getVecSkipSet(kind);
            const embedded = kind === 'l1' ? this.deps.db.countL1Vec() : this.deps.db.countL0Vec();
            // 相减法还有第二条前提，之前漏了：**分母必须是活跃行**。退场行按设计就合法地没有
            // 向量（撤检索面时 vec 行被 detach），把它们算进 total 会让 missing 恒等于退场数、
            // 永不归零；而真正驱动补齐的 `countVecMissing`/`getL1ForReindex` 都排除退场行，于是
            // 界面上同时出现“待补 114 条”与“重建索引无事可做”。本机实测：1280 总 / 114 退场 /
            // 1166 活跃且全部已嵌，正是这个形状。`countL1Retired` 失败给 -1，按 0 处理退回旧行为。
            const retired = kind === 'l1' ? Math.max(0, this.deps.db.countL1Retired()) : 0;
            const total = (kind === 'l1' ? this.deps.db.countL1() : this.deps.db.countL0()) - retired;
            // 缺失数走**相减**而非 LEFT JOIN:见下方 vectorsCached 上方的说明。
            const missing = embedded < 0 || total < 0 ? -1 : Math.max(0, total - embedded - skip.size);
            return { embedded, total, missing, skipped: skip.size };
        };
        return { l1: count('l1'), l0: count('l0') };
    }
    /**
     * 快照用的向量计数(带分级 TTL 缓存)。
     *
     * 即便改成了相减法,`getVecSkipSet` 仍是一次读 + JSON 解析,两次 COUNT 也要扫表;
     * 而设置页在**忙时 1s 轮询**、反刍跑起来时前端并发取数 —— 重复算没意义。
     * 分级 TTL:忙时 1s(重建进度要看得见)、空闲 30s(面板常开也不敲库)。
     */
    vectorsCached() {
        // 忙时判定与 isBusy() 同源但排除 downloader:模型下载不改变向量计数本身
        const busy = this.applyBusy || this.reindex.running;
        const ttl = busy ? VEC_CACHE_TTL_BUSY_MS : VEC_CACHE_TTL_IDLE_MS;
        const now = Date.now();
        if (this.vecCache && now - this.vecCache.at < ttl)
            return this.vecCache.view;
        const view = this.vectorCounts();
        this.vecCache = { at: now, view };
        return view;
    }
    /**
     * 丢弃向量计数缓存。
     *
     * 向量侧的写路径大多在 store 层(L1/L0 的 reindex、删除、skip 集变更),
     * 本管理器拿不到逐批回调,故以「忙时短 TTL + 收尾显式失效」组合保证收敛:
     * 重建/切换期间最长落后 1s,收尾时立即失效,不会停在旧值。
     */
    invalidateVecCache() {
        this.vecCache = null;
    }
}
