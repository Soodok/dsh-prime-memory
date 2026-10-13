import type { MemoryConfig } from '../config.js';
import type { MemoryLogger } from '../types.js';
import type { EmbeddingProviderInfo, EmbeddingService } from './embedding.js';
import type { L0Store } from './l0.js';
import type { L1Store } from './l1.js';
import { LocalEmbeddingService } from './local-embedding.js';
import { ModelDownloadQueue } from './download-queue.js';
import { RuntimeInstaller } from './runtime-installer.js';
import type { MemoryDb } from './sqlite.js';
import type { EmbeddingSourceKind, EmbeddingStateView } from '../contract.js';
export type { ApplyPhase, EmbeddingSourceKind, EmbeddingStateView, ReindexProgressState, VectorCountView, VectorIndexView, } from '../contract.js';
export interface EmbeddingSourceState {
    source: EmbeddingSourceKind;
    /** source=local 时启用的目录模型 id。 */
    activeModel: string | null;
}
export declare class EmbeddingSourceStore {
    private state;
    private readonly file;
    private writeQueue;
    private readonly logger?;
    /** 只读降级原因(undefined = 正常):文件损坏/不可读时置位,此后 `set()` 一律失败。 */
    private degraded;
    /** 本进程上次成功写入的磁盘内容(紧凑 JSON);并发冲突判据。 */
    private lastPersisted;
    constructor(dataDir: string, logger?: MemoryLogger);
    get(): EmbeddingSourceState;
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
    init(): Promise<void>;
    /**
     * 改状态并写穿持久化。
     *
     * **失败必须对调用方可观测**:旧实现是 `writeQueue.then(persist).catch(() => {})`,
     * 写失败后 `await` 照样 resolve——调用方以为已落盘,重启却回到旧源(G6 静默失败)。
     * 现在本次 await 直接抛出;队列本身用 `.catch()` 兜住,免得一次失败把后续
     * set 永久钉在 rejected 链上。
     */
    set(next: EmbeddingSourceState): Promise<void>;
    /**
     * 落盘。走 `atomicWriteText` 而不是自研 tmp+rename:白拿文件级 fsync、
     * 随机 tmp 名(旧实现的固定名 `*.tmp` 在多实例下会撞名)、以及失败路径清理。
     */
    private persist;
}
export interface InitialEmbedding {
    svc: EmbeddingService;
    dims: number;
    /** 传给 db.init 的 providerInfo(触发既有配置比对 → drop → needsReindex 链)。 */
    providerInfo?: EmbeddingProviderInfo;
    /** 解析降级原因(UI 展示)。 */
    note?: string;
}
/** 远程档部署上限:baseUrl + model + 维度 + enabled。apiKey 可选(本地免 key 自托管
 *  /embeddings 也放行——与蒸馏 direct 通道的 key 可选语义一致)。cfg.embedding 缺失视为未就绪。 */
export declare function remoteCeiling(cfg: MemoryConfig): boolean;
export declare function resolveInitialEmbedding(cfg: MemoryConfig, sourceStore: EmbeddingSourceStore, downloader: ModelDownloadQueue, makeLocal: (modelId: string) => LocalEmbeddingService | null, logger?: MemoryLogger): Promise<InitialEmbedding>;
/** 本地服务构造工厂(index.ts 的初始解析与 Manager 共用一份实现,防漂移)。
 *  推理在 worker 线程(见 local-embedding.ts);此处只传 runtime 目录与模型目录。 */
export declare function makeLocalServiceFactory(installer: RuntimeInstaller, downloader: ModelDownloadQueue, logger?: MemoryLogger, maxInputChars?: number): (modelId: string) => LocalEmbeddingService | null;
export interface EmbeddingManagerDeps {
    dataDir: string;
    cfg: MemoryConfig;
    /** 取当前生效配置(含运行时覆盖:远程嵌入 baseURL/apiKey/model/dimensions 在 UI 可编辑)。
     *  缺省回退 deps.cfg(静态配置)。远程档的 ceiling/换端点在运行期都读它,而非静态 cfg,
     *  否则设置页里的编辑即时生效不到活切换。 */
    getEff?: () => MemoryConfig;
    db: MemoryDb;
    l0: L0Store;
    l1: L1Store;
    sourceStore: EmbeddingSourceStore;
    installer: RuntimeInstaller;
    downloader: ModelDownloadQueue;
    initial: InitialEmbedding;
    logger: MemoryLogger;
    /** 本地服务构造(默认用 makeLocalServiceFactory(installer, downloader)。 */
    makeLocal?: (modelId: string) => LocalEmbeddingService | null;
}
export declare class EmbeddingManager {
    readonly sourceStore: EmbeddingSourceStore;
    readonly installer: RuntimeInstaller;
    readonly downloader: ModelDownloadQueue;
    private readonly deps;
    private current;
    private localSvc;
    private applyPhase;
    private applyMessage;
    private applyStartedAt;
    private applyBusy;
    private reindex;
    private reindexCancel;
    /**
     * 上一次重建的留痕（类型就地取自契约，不另开 import）。
     *
     * 为什么必须存：进度条只在 `running` 期间存在，而“待补 0 条”的重建会瞬间跑完，
     * 界面上与“点了没反应”长得一模一样——真机反馈就是这么读的。留痕存**前后待补数**，
     * 让“效果”是两个可比数字而不是一句“我转了一下”。
     */
    private reindexLast;
    /**
     * 向量计数缓存(分级 TTL)。
     *
     * 见 `vectorsCached()`:`embedding-state-get` 是设置页轮询热点,
     * 原实现每次现场跑 6 次 COUNT + 2 次 vec0 LEFT JOIN(实测 2.5–3.1s)。
     */
    private vecCache;
    /** 停机标志:dispose 后应用链不再推进(防卸载后的孤儿重嵌/安装)。 */
    private disposedFlag;
    /** 当前生效目标的 providerInfo(backfill/启动链的 meta 写入用——杜绝陈旧闭包)。 */
    private currentInfo;
    /** 初始解析的降级说明(活切换成功后清空,防过期提示常驻)。 */
    private activeNote;
    constructor(deps: EmbeddingManagerDeps);
    /** 当前目标的 providerInfo(index.ts 的启动重嵌链/周期 backfill 写 meta 用)。 */
    currentProviderInfo(): EmbeddingProviderInfo | undefined;
    /** 当前生效配置(运行时覆盖优先;缺省回退静态 deps.cfg)。远程档 ceiling/换端点都读它。 */
    private eff;
    /** 取消运行时安装(RPC:npm 卡死/用户主动放弃)。 */
    cancelRuntimeInstall(): boolean;
    /** 当前生效服务(index.ts 初始建 store 用)。 */
    getService(): EmbeddingService;
    /** 构造绑定真实运行时 loader 的本地服务(deps.makeLocal 可注入,测试替换)。 */
    private makeLocalService;
    /** 活切换请求:验证通过即接受,后台执行应用链(进度轮询可见)。 */
    requestSource(next: {
        source: EmbeddingSourceKind;
        activeModel?: string | null;
    }): {
        accepted: boolean;
        error?: string;
    };
    /** 下载启动(串行队列忙时拒绝);完成后自动做一次可加载性预热验证。 */
    startDownload(modelId: string): {
        ok: boolean;
        error?: string;
    };
    cancelDownload(): boolean;
    deleteModel(modelId: string): Promise<{
        ok: boolean;
        error?: string;
    }>;
    cancelReindex(): boolean;
    /**
     * 手动触发重建(RPC:`embedding-reindex`)。
     *
     * 受理即返回,不等跑完——进度照旧走 `snapshot().reindex` 轮询,不在这里回传。
     * 门槛全部前置,且**宁可拒绝也不谎报**:以下四种情况直接抛错而非"成功受理":
     *
     * - 插件已卸载 / 重嵌已在跑 / 嵌入源切换占着锁:并发语义,重复触发无意义;
     * - 嵌入服务未就绪:`L1Store.reindex` / `L0Store.reindex` 会**静默短路**成
     *   `0/0/0`,受理了就等于告诉用户"重建成功、零条待补"——而真相是它根本没开始。
     *
     * 用抛错而不是返回 `{accepted:false, error}`:与 `embedding-model-delete` 等既有
     * 端点一致,客户端 `call()` 已有统一的错误呈现,多一套返回形状只会多一处要维护。
     */
    startReindex(): {
        accepted: true;
    };
    /** 应用链/后台任务是否在跑(backfill 并发门禁用)。 */
    isBusy(): boolean;
    /** 停机钩子(插件 dispose):取消 npm 安装、下载与重嵌——不留后台孤儿任务。 */
    dispose(): void;
    private applyChain;
    private reindexNow;
    /** RPC 快照(设置页嵌入区块数据源;client 忙时 1s 轮询)。 */
    snapshot(): Promise<EmbeddingStateView>;
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
    private vectorCounts;
    /**
     * 快照用的向量计数(带分级 TTL 缓存)。
     *
     * 即便改成了相减法,`getVecSkipSet` 仍是一次读 + JSON 解析,两次 COUNT 也要扫表;
     * 而设置页在**忙时 1s 轮询**、反刍跑起来时前端并发取数 —— 重复算没意义。
     * 分级 TTL:忙时 1s(重建进度要看得见)、空闲 30s(面板常开也不敲库)。
     */
    private vectorsCached;
    /**
     * 丢弃向量计数缓存。
     *
     * 向量侧的写路径大多在 store 层(L1/L0 的 reindex、删除、skip 集变更),
     * 本管理器拿不到逐批回调,故以「忙时短 TTL + 收尾显式失效」组合保证收敛:
     * 重建/切换期间最长落后 1s,收尾时立即失效,不会停在旧值。
     */
    invalidateVecCache(): void;
}
