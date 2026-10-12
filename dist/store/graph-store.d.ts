import type { DatabaseSync } from 'node:sqlite';
import type { GraphEdge, GraphNode, GraphNodeSearchResult, GraphProjectionJob, GraphProjectionResult } from '../graph/types.js';
import type { MemoryFamily, MemoryLogger, MemoryRecord } from '../types.js';
/**
 * 图谱**向量路**单条命中。刻意不复用词法路的 `GraphNodeSearchResult`:
 * 那个类型要求 `matchedFields`(命中在哪些字段)与 `matchReason`(中文解释),
 * 而向量检索**没有"命中哪个字段"这个概念**——塞一个空数组进去会违反该类型
 * "无命中不返回、空数组不出现"的既有约定,把两种语义混成一个类型。
 */
export interface GraphNodeVecHit {
    node: GraphNode;
    score: number;
}
/** claim 的产出:job 元数据 + 本批真实存在的来源记录(已剔除被删者)。 */
export interface GraphClaim {
    job: GraphProjectionJob;
    records: MemoryRecord[];
}
/** complete 的注入缝(测试回滚路径 / 确定性断言用)。 */
export interface CompleteOptions {
    now?: string;
    idFactory?: (prefix: 'node' | 'edge' | 'gfact') => string;
}
export declare class GraphStore {
    private db;
    private logger;
    private stmtInsertNode;
    private stmtInsertEdge;
    /**
     * §F 图谱节点向量列（vec0）。**结构性可选**：维度未定或 vec0 不可用时这三个
     * 语句就是 `undefined`，该路整体 no-op——既不影响图谱的词法检索，也不向上抛。
     */
    private stmtInsertNodeVec?;
    private stmtDeleteNodeVec?;
    private stmtSearchNodeVec?;
    /** init 是否就绪(未就绪 = 图谱域整体 no-op,不抛错不传染)。 */
    get ready(): boolean;
    /**
     * 建表 + 语句缓存(MemoryDb.initSchema 内调用)。任何一步失败都只告警并保持
     * 未就绪——图谱域整体降级 no-op,检索主链路(L0/L1/FTS/向量)不受影响。
     *
     * @param vec §F 节点向量列的维度(来自 MemoryDb 的**既有**能力探测结果;
     *   缺省/0 = 部署未启用向量 → 该路结构性不存在,不建表也不报错)。
     */
    init(db: DatabaseSync, logger?: MemoryLogger, vec?: {
        dimensions: number;
    }): void;
    /**
     * §F 图谱节点向量列：与 `l1_vec` **同模式**的 vec0 虚拟表——同一个 `vec-utils`
     * 编码、同一种 `float[N] distance_metric=cosine` 声明。
     *
     * **内层 try/catch 是刻意的**（task_34）：vec0 扩展缺失时 `CREATE VIRTUAL TABLE`
     * 会抛。若让它冒到外层，图谱会从"向量路不可用"退化成"**整个图谱域不可用**"——
     * 词法检索、投影、裁决全部陪葬。外层那层 catch 是给"图谱表建不起来"用的，
     * 不该被一个**可选**的向量列触发。
     */
    private prepareNodeVec;
    /** 节点向量路是否可用。未就绪时下方两个方法的调用方**无需分支**——它们自身 no-op。 */
    get nodeVecReady(): boolean;
    /**
     * 写入/覆盖节点向量(先删后插:vec0 不支持 ON CONFLICT)。
     * 未就绪 / 零向量 / 单条失败 → **静默跳过**,绝不抛。
     * @returns 实际写入条数(供调用方记账,不用于控制流)。
     */
    upsertNodeVectors(rows: ReadonlyArray<{
        nodeId: string;
        embedding: Float32Array;
        updatedAt?: string;
    }>): number;
    /** 删除节点向量(节点删/合并时用)。未就绪 no-op。 */
    deleteNodeVectors(nodeIds: readonly string[]): void;
    /**
     * 向量检索节点(按 cosine 距离升序,score = 1 - distance,与 L1 向量路同口径)。
     * 未就绪返回**空数组**——调用方无需判断 `nodeVecReady`,降级是内建的。
     */
    searchNodesByVector(embedding: Float32Array, topK: number): GraphNodeVecHit[];
    /** 插件停机时清空连接引用(dispose 序调用,防悬空引用)。 */
    close(): void;
    /** 统一事务边界(immediate 供 complete 全程持写锁)。 */
    private tx;
    /** 事务内的 upsert 体(upsertTouched 与 complete 共用;调用方负责事务)。 */
    private upsertTouchedInTx;
    /** 全量读图谱(apply scope 与检索的统一入口;图谱量级为可重建投影,百~千级)。 */
    loadGraph(): {
        nodes: GraphNode[];
        edges: GraphEdge[];
    };
    /** 事务内的全图读取(complete 用;调用方负责事务)。 */
    private loadGraphInTx;
    /** 事务内按 id 装载 L1 记录(claim 与 complete 共用;调用方负责事务)。 */
    private loadRecordsInTx;
    /** 单节点详情(expand 用;不存在/未就绪返回 null)。 */
    getNode(id: string): GraphNode | null;
    /** 与某节点相连的 active 边(expand 用;悬挂 id 返回空数组,不解析不抛)。 */
    edgesOf(nodeId: string): GraphEdge[];
    /**
     * 图谱检索(纯函数 searchGraphNodes 的存储缝;可选族过滤)。
     * families 非空时只返回本族衍生的节点(档位隔离;无族信息节点一律不可见——
     * 宁可漏不可串)。降级/异常返回空数组。
     */
    searchNodes(query: string, limit: number, families?: readonly MemoryFamily[]): GraphNodeSearchResult[];
    private newJobId;
    /**
     * 投影入队(按 GRAPH_JOB_BATCH 分片成多个 job;去重下推 SQL):
     * 已有在途 mapping(pending/running/failed 退避中)或已按当前版本完成投影的
     * 记录跳过。返回实际新建的 job 数。
     */
    queueGraphProjection(recordIds: readonly string[], priority: number): number;
    /**
     * 记录被物理删除后，把两张**索引表**里指向它的行一并抹掉。
     *
     * 为什么必需（F19）：`graph_projected_records` 之前全仓**只增不减**。记录行删了而投影行还在，
     * 就留下两类静默问题：① 投影进度表里挂着一批查不到主人的 record_id；② 从快照**恢复**回来的
     * 记录因为投影行已存在而被当成“已投影”，**永远不会重投影**（检索图里就这么缺一条，不报错）。
     *
     * 只删索引行，**不动图节点/边**：节点是跨记录聚合出来的事实，归图自己的生命周期管。
     * 失败只 warn 并返回已删数——清理的既成事实不应被旁路索引拖挂。
     *
     * @param ids - 已被物理删除的记录 id。
     * @returns 从投影表删掉的行数。
     */
    forgetRecords(ids: readonly string[]): number;
    /**
     * 取下一个可执行 job 并置 running(attempts +1):只认当前 projectorVersion,
     * attempts 封顶与退避窗口在 WHERE 里过滤;来源全缺失 → job 判 dead 返 null
     * (不可重试不抛)。部分缺失时 job 收缩到真实存在的记录子集。
     */
    claimNext(): GraphClaim | null;
    /**
     * 提交投影结果(单事务,BEGIN IMMEDIATE):读全图 scope → 纯函数 apply(硬
     * 校验)→ 写回 touched 行 → job 置 completed + 登记已投影记录 + 放掉 mapping。
     * job 非 running 态(已完成/已 dead/已回收)一律幂等 no-op;任何一步抛错整体
     * 回滚,不留半写。
     */
    complete(jobId: string, result: GraphProjectionResult, opts?: CompleteOptions): void;
    /**
     * 投影失败收尾:attempts 已在 claim 时 +1——封顶转 dead(放掉 mapping,允许
     * 重新入队);未封顶转 failed + 指数退避 nextAttemptAt(mapping 保留防重复入队)。
     */
    fail(jobId: string, error: string): void;
    /** 启动回收:上次进程退出时卡在 running 的 job 放回 pending(dispose 缝不永久卡批)。 */
    recoverRunning(): number;
    /** 最近 job 列表(诊断/面板用;未就绪返回空)。 */
    listJobs(limit?: number): GraphProjectionJob[];
    /**
     * 存量补投影:从未投影(当前版本)且无在途 mapping 的 L1 记录里按创建时间
     * 升序取最多 limit 条分片入队(优先级 GRAPH_PRIORITY_BACKFILL,恒低于新蒸馏)。
     * 返回新建 job 数。
     */
    queueMissing(limit: number): number;
    /**
     * 删除传播(L1 批量删除后的惰性墓碑):来源在 L1 已全部不存在的 active/disputed
     * 节点与边标 archived(保留行,expand 可见墓碑)。挂在 MemoryDb.deleteL1Batch
     * 之后;按 L1 存活集判定(而非本次删除集合),跨多次删除与历史孤儿一并收敛。
     */
    markSourcesDeleted(deletedIds: readonly string[]): void;
    /**
     * §C 矛盾冻结:把图谱的 `disputed` 状态**同步**到给定冲突集。
     *
     * 为什么是"同步"而不是"标记":裁决会**撤销**争议。只做单向标记的话,
     * 一对已被人工裁决的对,其节点会永远停在 `disputed`——那是**派生投影在说谎**。
     * 图谱是本仓库反复确认的 L1 **派生投影**,派生字段就必须**由当前事实重算**,
     * 而不是靠一串增量事件累积(后者一旦漏一次就永久跑偏)。
     *
     * 判据(与 {@link markSourcesDeleted} 方向相反:那边问"来源是否**全部**消失",
     * 这边问"来源是否**命中**冲突集",命中一条即存疑):
     * - `active` 且来源命中冲突集 → `disputed`
     * - `disputed` 且来源**不**命中冲突集 → 复原为 `active`
     * - `archived` 墓碑两边都不动(墓碑是删除传播的产物,与争议无关)
     *
     * @returns 本次标记 / 复原的节点数。
     */
    syncDisputed(disputedRecordIds: readonly string[]): {
        marked: number;
        cleared: number;
    };
    /** 清空全部图谱数据(L1 重建时调用——图谱是 L1 的投影,记录清空即图谱作废)。 */
    resetAll(): void;
}
