import type { EmbeddingProviderInfo } from './embedding.js';
import type { L0MessageRecord, MemoryFamily, MemoryLogger, MemoryRecord } from '../types.js';
import { isZeroVector, vecToBuffer } from './vec-utils.js';
export interface StoreInitResult {
    /** embedding 配置(provider/model/维度)变化,需要后台全量重嵌入。 */
    needsReindex: boolean;
    reason?: string;
}
export interface StoreCapabilities {
    ftsSearch: boolean;
    vectorSearch: boolean;
}
import { CostLedger } from './cost-ledger.js';
import type { BucketRow, CostAggregate, CostByLayer } from './cost-ledger.js';
import { L0WatermarkStore } from './l0-watermark.js';
export type { BucketRow, CostAggregate, CostByLayer } from './cost-ledger.js';
import type { CostByModel } from '../contract.js';
import { GraphStore } from './graph-store.js';
import type { L1Receipt, ReceiptQuery, ReceiptRetentionOptions } from './receipts.js';
import type { ConflictClaimGroup, ConflictPair, ConflictRejected, ConflictResolution, ConflictType } from './conflicts.js';
import { type SupersedeInfo } from './supersede.js';
/** L1 检索命中(含 BM25/余弦归一分数)。 */
export interface L1SearchHit {
    id: string;
    content: string;
    type: string;
    priority: number;
    scene_name: string;
    score: number;
    family: MemoryFamily;
}
/** L0 检索命中。 */
export interface L0SearchHit extends L0MessageRecord {
    score: number;
}
export declare class MemoryDb {
    private db;
    private degraded;
    private ftsAvailable;
    private vecLoaded;
    private vecLoadWarned;
    /** 向量维度:活切换嵌入源时会变——vec0 表随维度重建。 */
    private dimensions;
    private readonly logger?;
    private stmtUpsertL1;
    private stmtGetL1;
    /** 主表存在性点查(防御性 FTS 删除的前置判断,走主键索引)。 */
    private stmtL1Exists;
    private stmtDeleteL1Meta;
    private stmtDeleteL1Vec?;
    private stmtInsertL1Vec?;
    private stmtSearchL1Vec?;
    private stmtL1FtsInsert;
    private stmtL1FtsDelete;
    private stmtL1FtsSearch;
    private stmtL1FtsSearchFamily;
    /** 成本账本(token_cost 表族;init 内初始化,未就绪时方法返回零值)。 */
    readonly costLedger: CostLedger;
    /** 图谱存储(graph_* 表族;init 独立 try/catch,失败仅图谱 no-op)。 */
    readonly graphStore: GraphStore;
    /** L0 水位表(T8.4 写停;§A 恢复幂等判据的数据源,init 内建表+基线物化)。 */
    readonly l0Watermark: L0WatermarkStore;
    private stmtUpsertL0;
    private stmtGetL0;
    private stmtL0Exists;
    private stmtDeleteL0Vec?;
    private stmtInsertL0Vec?;
    private stmtSearchL0Vec?;
    private stmtL0FtsInsert;
    private stmtL0FtsDelete;
    private stmtL0FtsSearch;
    /** 按块缓存的 IN 语句(表名/动作/尺寸 → 预编译语句):热路径不再每次动态 prepare。 */
    private readonly inStmts;
    constructor(dbPath: string, dimensions: number, logger?: MemoryLogger);
    isDegraded(): boolean;
    getCapabilities(): StoreCapabilities;
    /** 统一事务边界:fn 抛出即 ROLLBACK 并把错误上抛(替代散落的手写 BEGIN/COMMIT/ROLLBACK)。 */
    private withTransaction;
    /**
     * 加载 sqlite-vec 扩展并建 schema。构造后必须调用一次。
     * providerInfo 变化(provider/model/维度)时 drop 向量表并返回 needsReindex。
     */
    init(providerInfo?: EmbeddingProviderInfo): StoreInitResult;
    /** 惰性加载 sqlite-vec(纯 FTS 起步后切本地嵌入时补加载);失败只停用向量能力并告警一次。 */
    private ensureVecLoaded;
    /**
     * 活切换嵌入源:provider/model/维度任一变化 → drop 向量表按新维度重建,
     * 返回 needsReindex=true(调用方后台重嵌,全部成功后 markEmbeddingSynced);
     * 配置未变化 → false(切回同一模型不重嵌)。
     * 新维度 > 0 但 sqlite-vec 不可用 → ok=false(调用方向用户说明,维持 FTS)。
     */
    swapProvider(info: EmbeddingProviderInfo): {
        ok: boolean;
        needsReindex: boolean;
        error?: string;
    };
    /** l1_vec 物理表的向量维度(建表 DDL 里的 float[N]);无表返回 null。 */
    private physicalVecDims;
    private initSchema;
    private prepareL1VecStatements;
    private prepareL0VecStatements;
    private dropVectorTables;
    private tableExists;
    private hasColumn;
    /**
     * 时间增强列:valid_from / valid_to / persistence。
     *
     * 与 family 列同款增量迁移——DDL 契约不改,只在缺列时补,幂等。
     * 存储形态与 created_time/updated_time 一致(ISO-8601 UTC 的 TEXT),
     * 于是区间比较既可按字典序,也能沿用 idx_l1_updated 的既有用法。
     *
     * 存量数据的 metadata.activity_start_time/activity_end_time 是这两列的前身,不回填:
     * 图谱时间锚仍读 metadata,列由新写入路径填充。
     */
    private ensureTemporalColumns;
    /**
     * 重建后的 l1_fts 从 l1_records 全量回灌(仅在 drop 重建时调用;iterate 流式防大库内存峰值)。
     *
     * ⚠️ 本函数的参数列表**必须与 `stmtL1FtsInsert` 逐位对齐**。不对齐时 node:sqlite 会在这里抛错,
     * 而下面的 `catch` 是**逐行吞掉**的——症状是 `count` 停在 0、索引静默变空,
     * 全库记录从此全文检索不可见却没有任何错误日志。§E 加列时正是这个位置最容易漏
     * (三处列清单:DDL / insert 语句 / 本函数),故在此留下警示。
     */
    private backfillL1Fts;
    /**
     * 已退场 L1 行数。原本只给回灌留痕用，现在展示面也要它：
     * `vectorCounts` 算“待补”时得分掉退场行（它们合法地无向量），否则那个数永远归不了零。
     * 失败返回 -1——宁可日志写“未知”也不假装 0 条。
     */
    countL1Retired(): number;
    /**
     * 清除“已退场但仍待在检索面”的残留行（FTS + 向量）。幂等：第二次跑命中 0 行。
     *
     * 为什么必须存在于启动路径：口径修复只挡住**新增**的脏行，而存量脏行仍在给
     * BM25/向量检索供货——对用户而言就是“标了失效却还能被召回”。
     * 失败只 warn：这是个修复动作，无权把库拖进 degraded，更不能抛进启动
     * 的 await 链（那里报错 = storageOk=false = 记忆功能整体停用）。
     */
    private purgeRetiredRetrievalRows;
    /** 重建后的 l0_fts 从 l0_conversations 全量回灌(仅 drop 重建时调用;iterate 流式)。 */
    private backfillL0Fts;
    private readEmbeddingMeta;
    private writeEmbeddingMeta;
    /** 通用字符串 kv(embedding_meta 表兼作元数据 kv 存储,如 FTS 分词器版本戳)。 */
    private readMetaString;
    private writeMetaString;
    /**
     * 持久化 embedding meta(语义:物理向量表当前对应的 provider/维度)。
     * 活切换在 swapProvider 成功后即写(表已是新维度);启动/补齐链在
     * 缺失向量补齐收敛(missing=0)后写——缺失行补齐判据是行数差,不依赖 meta。
     */
    markEmbeddingSynced(info: EmbeddingProviderInfo): void;
    /** upsert 一条 L1(元数据 + FTS 同步;embedding 非零时写向量)。失败返回 false 不抛。 */
    upsertL1(record: MemoryRecord, embedding?: Float32Array): boolean;
    /**
     * 批量 upsert L1(单事务;与单条同语义:FTS 失败整批回滚)。
     * 追加/导入热路径用它——逐条开事务在 WAL FULL 下每条一次 fsync。
     * 整批失败时回退逐条写入:好记录照常入库、坏记录只丢自身——否则
     * JSONL 事实源已先行追加,检索库却整批缺失且无自动重导路径(批次空洞)。
     */
    upsertL1Batch(records: MemoryRecord[], embeddings?: Array<Float32Array | undefined>): boolean;
    /** 事务内的单条写入体(upsertL1 / upsertL1Batch 共用;调用方负责事务)。 */
    private upsertL1InTx;
    /** 批量删除 L1(元数据 + 向量 + FTS),返回删除条数。IN 按 ≤900 分块(避变量数上限)。
     *  删除成功后触发图谱删除传播(来源全失效的节点/边惰性标 archived;失败不影响删除结果)。 */
    deleteL1Batch(ids: string[]): number;
    /**
     * **软删**(记忆退场):保留主表行,撤出检索面。
     *
     * 与 `deleteL1Batch` 的差别**只有一处**:不动 `l1_records` 行本身。
     * `metadata_json` 写取代标记 → 记录仍能被 `listL1` 列出、能被 `clearRetireMarker`
     * + upsert 恢复;而 FTS 与向量行照旧删除,于是检索面(含去重候选召回)自然看不到它。
     *
     * 门1 解耦(expiry-tiering R1/task_2.3):退场**只写 marker，不再闭合 valid_to**——
     * valid_to 回归纯现实有效期，退场与否由 marker 单源回答（`isRetired`）。
     *
     * 顺序刻意如此:先打标记(可逆的那一半),再撤检索面,且整体在一个事务里。
     * 反过来先撤索引而打标记失败,记录会落在"检索不到、也没被标记"的状态 ——
     * 既查不出来也恢复不了,是最坏的一种中间态。
     *
     * **幂等**:已退场(带 marker)的 id 不再重复写标记,
     * 保留首次退场的原因与时刻(「谁先取代了它」不该被后一次调用改写)。
     *
     * **不调** `graphStore.markSourcesDeleted`(那是"来源已物理消失"的传播,软删行一直在),
     * 而是调 `markSourcesRetired`(计划 R9 对偶刀):按"来源是否全部退场态"重算清扫,
     * 全退场的 active/disputed 节点·边标 archived 墓碑(派生投影由当前事实重算,非事件改写)。
     */
    retireL1Batch(ids: string[], info: SupersedeInfo): number;
    /**
     * 撤出检索面(删 FTS + 向量行,**主表保留**)。
     * 与 `deleteL1Batch` 的删除面同源,只是不动 `l1_records`。
     */
    private detachL1FromRetrieval;
    /**
     * 清掉退场标记(恢复的**前半**)。返回清完标记的记录,供调用方 re-upsert 以重建
     * FTS/向量 —— 那条路径(`upsertL1InTx`)已存在,不在这里重复实现。
     *
     * 门1 解耦(task_2.3 的对偶面):只剥 marker,**不碰 valid_to**——
     * 行若本就带着真实历史有效期(导入/抽取写入),恢复不该把它抹掉;
     * 旧版 retire 写进 valid_to 的退场时刻对新行只影响 classify 落到
     * historical/expired_suspect(仍可检可注入,带标注),由 validity-backfill 逐步纠偏。
     * 返回的 `validTo` 保持原值——upsert 照原样写回,不会静默改列。
     */
    clearRetireMarker(ids: string[]): MemoryRecord[];
    /** 已退场记录列表(面板用):与 `retiredL1Sql()` 同判据(marker 单源)。失败返回空。 */
    listRetiredL1(opts: {
        limit: number;
        offset: number;
    }): {
        items: MemoryRecord[];
        total: number;
    };
    private inStatement;
    /**
     * 清空 L1 检索库全部数据(重建用)。records/FTS 直接 DELETE;
     * 向量表走 DROP + 重建(vec0 的全表 DELETE 语义不可靠,dropVectorTables
     * 会连 l0_vec 一起删——L0 向量必须保留——故此处单独处理 l1_vec)。
     * L0 表与 embedding_meta 不动:backfill 的行数比对天然重新一致。
     * 图谱表族一并清空——图谱是 L1 的可重建投影,记录清空即投影作废(B2)。
     */
    clearL1(): boolean;
    countL1(): number;
    /**
     * 按外部导入幂等键查已存在记录 id(轨3-P0 幂等 pre-check)。
     * 空键/降级一律返回 undefined;未迁移旧库(无 ext_key 列)由 catch 兜底 undefined(fail-open)。
     */
    findRecordIdByExtKey(extKey: string): string | undefined;
    /**
     * 游标分批取 L1 元信息(**仅三列**):后台巡检专用。
     *
     * 为什么不复用 `getAllL1()`:后者会连 `content` 全文一起拉,且是一次性全量同步反序列化——
     * 记录数随使用单调增长,后台任务在事件循环里做这件事会阻塞所有 RPC。
     * 巡检(反刍重标定 / wing 回填)只需要 `id / type / metadata` 三列。
     *
     * `ORDER BY record_id` 而非 `updated_time`:record_id 是主键(唯一且不变),
     * 巡检期间即使有写回也不会有分页漂移;updated_time 会被写回改动。
     */
    getAllL1Lite(limit: number, offset: number): L1MetaLite[];
    /**
     * 游标分批取**活跃** L1 的骨架判定所需列（`id / type / content / metadata`）。
     *
     * 为什么单开一个方法而不是复用 `getAllL1Lite`：后者刻意不返 content（防写回把正文清空），
     * 而 redistill 的**扫描阶段就要用 content 判骨架**——把筛子下推到扫描期，才能像反刍
     * 重标定那样“只把真目标送 LLM”，而不是每批 hydrate 20 条候选后发现只有 4 条要整形。
     *
     * 退场判据走 `retiredL1Sql()`（全库唯一事实源）下推到 SQL：活跃集本就只占全库
     * 两成（真机 289/1221），先筛掉退场行可把扫描代价降到五分之一。
     * 分页同 `getAllL1Lite`：`ORDER BY record_id`（主键不变 ⇒ 无分页漂移）。
     */
    getActiveL1ForSkeleton(limit: number, offset: number): Array<{
        id: string;
        type: string;
        content: string;
        metadata: Record<string, unknown>;
    }>;
    /**
     * **只**更新 metadata_json(顺带 updated_time),绝不碰 content 或其它列。
     *
     * 为什么需要它:分批巡检后调用方手里**没有 content**(L1MetaLite 只有三列),
     * 若沿用 `upsert({...lite, metadata})` 会把正文写成空 —— 这是分页改造最危险的坑。
     *
     * 返回 false 表示 id 不存在或写入失败(调用方据此记账,不静默)。
     */
    /** repo 归属修补(T3.3;人工消歧用)。CAS:expectRepoKeyName 非空时要求当前值匹配。 */
    patchRepoKey(id: string, patch: {
        repoKeyName?: string;
        repoKeyOwner?: string;
    }, expectRepoKeyName?: string): number;
    /**
     * 批量写 `workspace_id`（内容路由 / 存量 re-link 用）。单事务，**刻意不碰 `updated_time`**。
     *
     * 为什么不碰 `updated_time`（三条都是硬约束）：
     * ① 它在 `canonicalRecords` 的哈希字段表里——动了就是“静默改写”，会让改动前建的快照
     *    永久 verify 不通过（`workspace_id` 本身不在表里，所以**只**写它才是快照安全的）；
     * ② 它是时效衰减（agingWeight）与列表排序的输入，改一下归属顺手把记忆“刷陈旧”是意外副作用；
     * ③ re-link 按固定序分页扫，不写它才不会边扫边漂。
     *
     * 为什么连 `l1_fts` 一起改：FTS 行**自带** `workspace_id`（UNINDEXED 随行），
     * 而检索过滤 `(? = '' OR scope='global' OR workspace_id = ?)` 读的就是 FTS 行那一列。
     * 只改主表 = 一旦启用围栏，关键词路按旧归属过滤、向量路按新归属过滤，两路结果不一致。
     * 退场行不在 FTS 里，那条 UPDATE 自然命中 0 行，不是错误。
     */
    setL1WorkspaceIds(items: ReadonlyArray<{
        id: string;
        workspaceId: string;
    }>): number;
    /**
     * 改一条记录的文件身份名（N1）。三态返回，**不碰 `updated_time`**：它在快照哈希
     * 字段表里、又是衰减与排序的输入——改名不是“内容变了”，不该顺带把这条记成刚更新过
     * （与 `setL1WorkspaceIds` 同一个理由）。`name=''` 是合法值（= 没名字，部分索引不约束空串）。
     *
     * 唯一性由 `l1_records_name_uidx` 挡：撞名 ⇒ `'dup'`，由调用方决定报错还是让用户先改
     * 另一条——**不自动加后缀**，那会静默造出语义重叠的第二条记忆。
     * （另一个口径：机器给**本来没名字**的记录起名时必须消歧，见 `renameL1Batch` 的注释。）
     */
    renameL1(id: string, name: string): 'ok' | 'dup' | 'missing' | 'failed';
    /**
     * 批量写 `name`（单事务）。给“机器起名”用：存量记录没名字时一次补齐。
     *
     * 与 `renameL1` 的分工不是性能而是**语义**：那里是**人给的**名字，撞了就报错让用户
     * 先改另一条，绝不静默加后缀；这里是机器给**本来没名字**的记录派生名字，同正文的
     * 多条必然撞名（真机实测 42 条挤进 17 个路径），**不消歧就是每轮导出重刷 + 反向同步
     * 把一份内容回灌给多条**。所以消歧必须在本层之上先把名字算唯一，本层只负责落库。
     *
     * 与 `renameL1` 同样**不碰 `updated_time`**（起名不是“内容变了”），也不动 FTS——
     * `name` 不在检索面里（`l1_fts` 没这一列）。
     *
     * @param items - `{ id, name }`，name 已由调用方保证全库唯一。
     * @returns 实际写入的 id 集（现值已等于目标值的跳过——幂等）与失败集。
     */
    renameL1Batch(items: ReadonlyArray<{
        id: string;
        name: string;
    }>): {
        done: string[];
        failed: string[];
    };
    /** 按文件身份名反查 record_id（重名预检与 md 回灌用）；没这条名 ⇒ undefined。*/
    findRecordIdByName(name: string): string | undefined;
    /** 入队一个重聚类作业(demote-to-wiki / repo 归属变化触发;source 区分来源)。 */
    enqueueSceneRecluster(family: string, sceneNames: readonly string[], batchId: string, source?: string): string;
    /** 取一个待处理作业(ruminate 空闲消费;按创建序)。 */
    claimSceneRecluster(): {
        jobId: string;
        family: string;
        sceneNames: string[];
        source: string;
    } | null;
    /** 打标作业完成/失败(失败保留行供诊断;重算由下一次触发再入队)。 */
    finishSceneRecluster(jobId: string, ok: boolean): void;
    patchL1Metadata(id: string, metadata: Record<string, unknown>): boolean;
    /**
     * 更新 metadata_json 后**顺带重索引该行的 `l1_fts`**（关键词回填专用）。
     *
     * `patchL1Metadata` 本身不碰 fts——多数写回点（tags / room / relabel）不需要、也不想付这个代价；
     * 但关键词轴若只写元数据不重索引，`ftsKeywordText` 读不到新 `dsh_keywords`，那条 BM25 轴
     * 对存量记录永远空。故把「写元数据 + 重索引」焊在一个方法里，杜绝“写了关键词但检索看不到”。
     *
     * 退场/不存在的行：只从 fts 删除（幂等），不插入。fts 不可用时降级为纯 `patchL1Metadata`。
     * 参数列表与 `stmtL1FtsInsert` / `backfillL1Fts` 逐位对齐（同三处列清单，漏一列静默丢索引）。
     */
    patchL1MetadataAndReindex(id: string, metadata: Record<string, unknown>): boolean;
    /** 全量读取(调试/迁移/重嵌入用;检索请走 FTS/向量)。 */
    getAllL1(): MemoryRecord[];
    getL1ByIds(ids: string[]): MemoryRecord[];
    /**
     * §B 决策凭证批量落盘。`INSERT OR IGNORE` + 确定性 `receipt_id`
     * (见 `receipts.ts` 的 `receiptIdFor`)→ 同一次 run 重放不产生重复行。
     * 返回实际新增条数(被忽略的重复不计)。
     *
     * 刻意**不开事务**:凭证是旁路观测数据,单条独立、重放幂等,部分写入无害;
     * 为它引入事务只会把失败面扩大。调用方另有 `persistReceiptsSafely` 兜底不抛。
     *
     * 写入后**顺带执行保留策略**(task_18)。把裁剪挂在这里而不是交给调用方,
     * 是为了让"有界"成为**结构性保证**:任何写路径都不可能忘记裁剪,
     * 因而表容量不可能随使用时间无界增长。裁剪自身失败只 warn——
     * 它是省空间的动作,失败了最坏是这次没省下来,绝不能因此弄丢刚落盘的凭证
     * (故裁剪在写入**之后**,且包在 try 里)。
     */
    recordReceipts(rows: readonly L1Receipt[], opts?: ReceiptRetentionOptions): number;
    /**
     * §C 矛盾冻结(task_22):落盘待裁决冲突对。
     *
     * `INSERT OR IGNORE`——幂等来自 **pair_id 主键**而非调用方自觉:
     * `conflictPairId(runId, winner, loser)` 对同一三元组恒等,故一轮蒸馏重复落盘
     * 只会得到一行。与 §B 凭证同一手法(那边是 `receipt_id` 主键)。
     *
     * 与凭证不同,这里**不做保留裁剪**:待裁决对是**欠人的债**,不是观测数据。
     * 裁剪它等于把用户还没看的裁决请求悄悄删掉,那是丢工作而不是省空间。
     * 有界性交给 task_24 的队列上限(超限不再停放、回落自动裁决),语义是
     * 「**不收新的**」而非「**偷偷删旧的**」。
     *
     * @returns 实际新插入的行数。
     */
    recordConflictPending(rows: readonly ConflictPair[]): number;
    /** §C 冻结:把图谱 `disputed` 状态同步到给定冲突集(薄缝,便于单测替换)。 */
    syncGraphDisputed(disputedRecordIds: readonly string[]): {
        marked: number;
        cleared: number;
    };
    /**
     * §C 冻结队列的**未裁决**条数(task_24 队列上限判据)。
     * 走 `idx_conflict_pending_unresolved` 偏索引,不是全表扫描。
     *
     * Phase 3(task_3.4):`conflictType` 可选过滤——**默认不带**(返回全部未裁决数),
     * 只有队列上限判据传 `{ conflictType: 'hard' }`(额度只按 hard 计)。
     * 刻意用**选项对象**而非位置参数:位置参数会被下一个调用点无声漏传,
     * 而"漏传 ⇒ 额度把非 hard 也算进去"正是这条轴要修的病。
     */
    countConflictPendingUnresolved(opts?: {
        conflictType?: ConflictType;
    }): number;
    /**
     * §C 取未裁决冲突对(task_24 超时扫描 / task_25 裁决工具)。
     *
     * `createdBefore` 为**排他上界**(ISO 串):只取该时刻之前创建的,用于超时判定。
     * 定序 `created_at ASC, pair_id ASC`——先来先服务,且同一毫秒内仍**确定可复现**。
     */
    listConflictPending(opts?: {
        createdBefore?: string;
        limit?: number;
        /**
         * R1(task_2.3):把已达复看上限(`DEFER_MAX`)的对**排除出超时扫描**。
         * **显式可选、默认关**——哈希输入、队列列出与人工裁决查找**绝不**能受它影响:
         * ① 否则快照哈希会随 `defer_count` 变化,旧 manifest 永久失配;
         * ② 否则钉子户将无法被 `resolveConflictPair` 找到,而人工裁决是它们**唯一**的出口。
         */
        excludeDeferExhausted?: boolean;
    }): ConflictPair[];
    /**
     * §C Phase 3(task_3.3):把未裁决对**按 `claim_key` 归并**后返回。
     *
     * 分组是**读取面的派生**,不是新状态:故它不从库外引入任何字段、不进快照哈希,
     * 只把 {@link listConflictPending} 的结果按轴归并(空键那组恒排最后)。
     * 归并逻辑在 `conflicts.ts` 的纯函数里(可单测、无 I/O),这里只负责取行。
     */
    listConflictGroupedByClaim(opts?: {
        limit?: number;
    }): ConflictClaimGroup[];
    /**
     * §C Phase 2(task_2.0):写入「已复看」痕迹——**不写 `resolved_at`**。
     *
     * `defer`(看过、暂不裁决)不是裁决结论,故它**不能**碰 `resolved_at` / `resolution`:
     * 那两列一旦写上,该对就退出待裁决队列了,而 `defer` 的语义恰恰是
     * 「还在队列里,只是我看过了」。这是 R1 与 R2 的分界(审计 N1)。
     *
     * `WHERE pair_id = ? AND resolved_at = ''` 保证**已裁决的对不被写回**
     * ——与 {@link resolveConflictPending} 同款的单向性。
     *
     * @returns 受影响行数(0 = 该对已裁决或不存在)。
     */
    markConflictReviewed(pairId: string, next: {
        reviewedAt: string;
        deferredAt: string;
        deferCount: number;
    }): number;
    /**
     * §C 打上裁决结论。
     *
     * `WHERE resolved_at = ''` 使**已裁决的不会被覆盖**:裁决是一次性的判定行为,
     * 重复调用不该把第一次的结论改写掉(人工裁决与自动了结的次序因此不可逆)。
     *
     * @returns 受影响行数(0 = 该对被裁决过或不存在)。
     */
    resolveConflictPending(pairId: string, resolution: ConflictResolution, resolvedAt: string): number;
    /**
     * §C 丢弃留痕:登记被判为「配不成对」的 conflict 决策。
     *
     * `INSERT OR IGNORE` + 主键 `reject_id` ⇒ 同一决策重复登记只留一行
     * (与 {@link recordConflictPending} 同款幂等,幂等来自主键而非调用方自觉)。
     *
     * @returns 实际新插入的行数。
     */
    recordConflictRejected(rows: readonly ConflictRejected[]): number;
    /**
     * §C 读取丢弃留痕(为审计/诊断出口预留)。
     *
     * `createdBefore` 为**排他上界**(ISO 串);定序 `created_at ASC, reject_id ASC`
     * —— 先来先服务且同一毫秒内确定可复现(与 {@link listConflictPending} 同口径)。
     */
    listConflictRejected(opts?: {
        createdBefore?: string;
        limit?: number;
    }): ConflictRejected[];
    /**
     * §B 凭证保留策略(task_18):只保留**最新**的 `maxRuns` 个 run,更老的整批删除。
     * 返回被删除的行数。
     *
     * 两条刻意的约束:
     * - **粒度是 run,不是行**。按行裁剪会切出"半截批次",而 task_19 的按 run 回溯
     *   正是要回答"这一轮蒸馏都判了什么"——一个少了尾巴的批次会给出**看似完整、
     *   实则遗漏**的结论,比查不到更糟。整批留、整批删,回溯的原子性才有保证。
     * - **只碰 `l1_receipts`,绝不碰 `l1_records`**。前者是可再生/可丢弃的观测数据,
     *   后者是用户的事实源。为省几 MB 而波及记忆本体,是把容量优化做成了数据丢失。
     *
     * `maxRuns <= 0` 或非有限值一律**不裁剪**——"传 0 即清空"是个太容易被误触的
     * 语义,宁可把它定义为无效输入。
     *
     * 定序取每 run 的 `MAX(decided_at)`(凭证的 decided_at 在一批内恒定)并以
     * `run_id` 兜底,使同一时刻产生的多个 run 也有**确定**的相对序,裁剪结果可复现。
     */
    trimReceipts(maxRuns: number): number;
    /**
     * §B 双维回溯(task_19):按 `record_id` / `run_id` 查判定史,两维同给为 **AND**。
     *
     * 两条刻意的行为:
     * - **两维都不给返回空,而不是全表**。「查全部凭证」不是本能力的目标;把缺参
     *   兜成全表,会让一次误调用变成全库判定史导出。调用方本就该先拒绝这种用法
     *   (工具层给提示、端点层直接报错),这里是第二道,方向一致。
     * - **定序确定**:`decided_at DESC, run_id DESC`。回溯的价值在于可复现——
     *   同一问题两次问出不同顺序,核对时就会怀疑是不是数据变了。`run_id` 兜底
     *   同一毫秒内的多批(L1 蒸馏是 LLM 调用,同刻两批罕见但非不可能)。
     *   新的在前,与 `listL1` 的倒序口径一致。
     */
    listReceipts(opts: ReceiptQuery & {
        limit: number;
    }): L1Receipt[];
    /** 同维度命中的**总条数**(不受 limit 影响,供"还有多少条没显示"提示)。 */
    countReceipts(opts: ReceiptQuery): number;
    /** 浏览列表(UI 用):按更新时间倒序,支持类型/场景/族/Hall/可见范围过滤与分页。失败返回空。 */
    listL1(opts: {
        type?: string;
        scene?: string;
        family?: string;
        hall?: string;
        halls?: readonly string[];
        /** Room 过滤(metadata.tags 含该 slug)。 */
        tag?: string;
        /** 孤儿记忆筛选(true = 只列没有 Room 的记录;与 tag 互斥,tag 优先)。 */
        untagged?: boolean;
        workspaceId?: string;
        /**
         * 退场(软删)筛查:三态。
         * - 省略(undefined):不过滤,活跃+已退场都列(快照导出/重建需要全量;面板「全部」同此);
         * - `false`:只列**活跃**记录(`valid_to` 为空);
         * - `true`:只列**已退场**记录(`valid_to` 非空)——与 `listRetiredL1` 同口径。
         * 面板默认不过滤而是靠徽标区分(「退场了」与「根本没这条」必须能分辨),
         * 筛查只是把混排的两种态**分开看**,不改变"浏览路径不隐藏退场记录"的设计。
         */
        retired?: boolean;
        limit: number;
        offset: number;
    }): {
        items: MemoryRecord[];
        total: number;
    };
    /** 场景名去重列表(UI 筛选器数据源)。失败返回空。 */
    distinctL1Scenes(): string[];
    /**
     * 主表全量元数据扫描(单一所有者共享函数):对 l1_records **全表**(含 retired 行,
     * 不加 valid_to 过滤——退场判定见 retireL1Batch,restore 后行仍须可解析)逐行回调
     * metadata。并行计划的引用门禁(如 multimodal 的 image_refs 清理判据)必须复用本函数,
     * 不得各写一份"活跃面扫描"——口径漂移会造成 restore 后死链。
     * 返回扫描行数;存储降级返回 0。
     */
    scanL1Metadata(cb: (recordId: string, metadata: Record<string, unknown> | null) => void): number;
    /**
     * 反向取代链查询(task_4.4,门3):"谁被这条记录取代了"——扫 metadata_json 里
     * 取代标记的 `by` 指向本 id 的行。百~千量级全扫可接受(与 `retiredL1Sql` 同属
     * LIKE 面);超过阈值时留 warn——真到万级该建索引，不在本计划面里预先造。
     * **只回退场行**："被取代者"正是带 marker 的旧行(活跃行若 by 指过来是脏数据)；
     * 模式含闭合引号(`"by":"<id>"`),不会前缀误配更长 id。
     */
    findSupersededTargets(newId: string): string[];
    /** retired 行计数(退场判定与 listRetiredL1 同口径:`retiredL1Sql` marker 单源)。失败返回 0。 */
    retiredL1Count(): number;
    /**
     * Room 计数(**标签自生长分类**):展开 `metadata.tags` 聚合,1 个 slug tag = 1 个 Room。
     *
     * 零 schema 变更——tags 落库即自动成为新 Room,无需注册表/迁移,这就是"自生长"。
     *
     * **口径与 `wingL1Counts()` 一致(不过滤 retired)**:两者常在同一面板相邻展示,
     * 口径不一会出现互相矛盾的数字。
     *
     * `json_valid` 守卫:单行 metadata 损坏时 `json_each` 会抛「malformed JSON」并连带
     * 整条聚合失败——宁可跳过该行,也不能让整个 Room 列表空掉。
     *
     * 失败返回空数组(存储降级或聚合异常都按"暂无 Room"处理,不报错)。
     */
    l1RoomCounts(): Array<{
        room: string;
        count: number;
    }>;
    /** 孤儿记忆计数:没有任何 Room(tags 为空/缺失)的记录条数(含已退场,与 l1RoomCounts 同口径)。 */
    untaggedL1Count(): number;
    /** Hall 域计数(八边形角数据源):按 metadata.hall 分组计数 + 未打标行数。失败返回空。 */
    wingL1Counts(): {
        counts: Record<string, number>;
        unlabeled: number;
    };
    /** FTS5 BM25 检索(family / workspaceId 缺省不过滤)。失败返回空数组(调用方降级)。 */
    searchL1Fts(query: string, limit: number, family?: string, workspaceId?: string): L1SearchHit[];
    /**
     * vec0 余弦 KNN 检索(score = 1 - cosine distance)。失败返回空数组。
     * family / workspaceId 过滤走**过度召回 + 回查过滤**(vec0 无法 WHERE)。
     * 放大倍数对两条轴**相乘**:两轴各自丢弃行,单独放大任一条都不够。
     */
    searchL1Vector(embedding: Float32Array, topK: number, family?: string, workspaceId?: string): L1SearchHit[];
    /** 批量 upsert L0 消息(元数据 + FTS;embeddings 与 records 等长,可省略)。 */
    upsertL0Batch(records: L0MessageRecord[], embeddings?: Array<Float32Array | undefined>): boolean;
    /** 记录一次蒸馏调用成本(委托 cost-ledger;语义见 CostLedger.insertCostCall)。 */
    insertCostCall(provider: string, model: string, layer: string, inputChars: number, outputTokens: number, reasoningTokens: number, retentionDays: number): void;
    /** 查询 token_cost 单窗口聚合(委托 cost-ledger;降级/异常返回零值)。 */
    aggregateCost(since: number): {
        total: CostAggregate;
        byModel: CostByModel[];
    };
    /** 按层级归并聚合(委托 cost-ledger;降级/异常返回空数组)。 */
    aggregateCostByLayer(since: number): CostByLayer[];
    /** 按时间桶 + model 聚合(委托 cost-ledger;趋势图与日均/周均/月均共用)。 */
    aggregateByBucket(bucketMs: number, offsetMs: number, since: number, layer: string): BucketRow[];
    countL0(): number;
    /** 统计 recorded_at >= iso 的消息数(状态面板"今日捕获"用)。 */
    countL0Since(iso: string): number;
    /** 统计某会话已捕获消息数(session-stats 数据源;idx_l0_session_id 索引点查)。 */
    countL0BySession(sessionId: string): number;
    /**
     * §A 崩溃恢复水位线(memorax-absorb):该会话 L0 已落盘的最大 turn。
     * L0 为追加式事实源、从不裁剪 → 水位线崩溃安全;turn 空洞是常态
     * (off 档/无消息轮),MAX 语义不受影响。空会话返回 undefined。
     */
    maxCapturedTurn(sessionId: string): number | undefined;
    /**
     * §A 幂等检查:该 (session, turn) 是否已有任意 L0 行。
     * 水位线 MAX(turn) 只判"整轮无"、判不了"部分有"——恢复窗口内逐 turn
     * 做存在性检查,命中即整轮跳过(重放 record id 非确定,upsert 不能去重)。
     */
    hasAnyL0Message(sessionId: string, turn: number): boolean;
    /** 按会话取最近消息(时间升序返回;走 idx_l0_session_id 索引)。
     *  蒸馏背景参考专用——按会话现查替代全局内存数组(ADR-0003)。 */
    recentL0BySession(sessionId: string, limit: number): L0MessageRecord[];
    /**
     * 锚点定向取消息(R7):按 `(session_id, turn[, step])` 取该回合的 L0 消息。
     *
     * 与 `recentL0BySession` 的区别是**按坐标而非按时间**:证据读取器(R2)手上
     * 只有锚点,没有"最近"的概念。`step` 缺省即整轮(不过滤 step)。
     *
     * 返回按 `timestamp, rowid` 升序——同一轮内的原始顺序,供下游拼回回合文本。
     */
    l0ByAnchor(sessionId: string, turn: number, step?: number): L0MessageRecord[];
    /**
     * L0 行 → 记录的统一映射。turn/step 为 NULL(旧行 / 无坐标)时**不写键**,
     * 使"无锚点"与"锚点为空"在类型层就是两件事。
     */
    private toL0Record;
    /** L0 全量列举(重建快照用;按时间升序,事务一致性避开 JSONL 追加竞态)。 */
    listL0All(): L0MessageRecord[];
    /** 重建成本预估(一次全表聚合:会话数 / 消息数 / 字符量)。 */
    l0RebuildEstimate(): {
        sessions: number;
        messages: number;
        chars: number;
    };
    /** 向量表行数(backfill 判据:与元数据行数的差值即缺失向量数;不可用时返回 -1)。 */
    countL1Vec(): number;
    countL0Vec(): number;
    searchL0Fts(query: string, limit: number): L0SearchHit[];
    searchL0Vector(embedding: Float32Array, topK: number): L0SearchHit[];
    /** L1 缺失向量的记录数(排除 skip 集后的补齐判据;向量能力不可用返回 -1)。 */
    countL1VecMissing(exclude?: Set<string>): number;
    /** L0 缺失向量的记录数(同上)。 */
    countL0VecMissing(exclude?: Set<string>): number;
    private countVecMissing;
    /**
     * 待重嵌入的 L1:只取缺失向量的记录(增量),排除 skip 集里已判定
     * "当前 provider 下不可嵌入(零向量)"的 id——缺 1 条不再全量重嵌,
     * 零向量记录也不再反复喂给 embeddings API(死循环双根因)。
     */
    getL1ForReindex(exclude?: Set<string>): Array<{
        id: string;
        content: string;
    }>;
    /** 待重嵌入的 L0(增量 + 排除 skip 集,同 getL1ForReindex)。 */
    getL0ForReindex(exclude?: Set<string>): Array<{
        id: string;
        text: string;
    }>;
    getVecSkipSet(kind: 'l1' | 'l0'): Set<string>;
    addVecSkippedIds(kind: 'l1' | 'l0', ids: string[]): void;
    clearVecSkipIds(kind: 'l1' | 'l0'): void;
    /** 只更新向量行(重嵌入用)。 */
    updateL1Vec(id: string, embedding: Float32Array): boolean;
    updateL0Vec(id: string, embedding: Float32Array, recordedAt: string): boolean;
    /**
     * 批量更新 L1 向量行(重嵌入热路径):单事务写入整批——逐条每行一次隐式事务,
     * 批量场景(万级记录重嵌)开销集中在 fsync 上。
     * 整批失败回退逐条:好行照常入库,坏行只丢自身(向量行 id 寻址,无顺序依赖)。
     * 返回成功写入的行数(零向量行防御性跳过、不计入)。
     */
    updateL1VecBatch(items: Array<{
        id: string;
        embedding: Float32Array;
    }>): number;
    /** L0 版 updateL1VecBatch(语义同:单事务 + 失败回退逐条)。recordedAt 整批统一。 */
    updateL0VecBatch(items: Array<{
        id: string;
        embedding: Float32Array;
    }>, recordedAt: string): number;
    close(): void;
}
/**
 * 后台巡检用的 L1 最小投影(**不含 content**)。
 *
 * 刻意与 `MemoryRecord` 分开:`MemoryRecord.content` 是必填的,若把三列投影硬塞进该类型,
 * 调用方会在写回时把正文写成空。用独立的窄类型 + `patchL1Metadata` 才能让"不碰正文"成为类型层面的约束。
 */
export interface L1MetaLite {
    id: string;
    type: string;
    metadata: Record<string, unknown>;
}
export { isZeroVector, vecToBuffer };
