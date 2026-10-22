import type { GraphEdge, GraphNode, GraphNodeSearchResult } from './types.js';
/** 字段权重(检索命中计分;名称最高、关系词最低)。 */
export declare const GRAPH_FIELD_WEIGHTS: {
    readonly name: 6;
    readonly aliases: 5;
    readonly tags: 5;
    readonly currentState: 4;
    readonly facts: 4;
    readonly relations: 3;
    readonly type: 2;
};
/**
 * as-of 回放可选参数(expiry-tiering Phase 5:图谱读时派生,不加冻结列)。
 * 默认(缺席)= 当前态检索,行为与改前逐字一致。
 */
export interface GraphAsOfOptions {
    /** ISO 8601 时刻:把"当时成立"的 superseded fact/边也纳入检索与回链;
     *  archived 仍排除(那是删除传播的墓碑，来源已不在，回放也不该复活)。 */
    asOf?: string;
}
/**
 * 图谱命中 → L1 记录 id 序列(§D 第 3 路 RRF 的输入;纯函数,无 I/O)。
 *
 * 图谱是**可重建派生投影**,节点/fact 的 `sourceRecordIds` 是它回链 L1 的唯一凭证
 * (types.ts:6-7)。此处把"节点排名"翻译成"L1 记录排名",分两段:
 *
 * - **直连段**:命中节点自身 + 其 active facts 的来源(task_9 原语义、原顺序);
 * - **1-hop 段**:命中节点沿 **active 边**的双向邻居(邻居需 active|disputed)的
 *   节点自身来源,按邻居 updatedAt 新→旧追加,整段新增封顶
 *   `GRAPH_HOP_RECORD_CAP`——这是图路"关系可达"增量价值的兑现面。
 *   hop 段只取邻居节点自身来源,不取 fact 来源(hop 是联想不是证据,噪声从紧)。
 *
 * 两段共用纪律:
 * - **保序**:先出现的记录 = 更高排名(直连段恒先于 hop 段);已被直连段占位的
 *   id 不重复计入、也**不吃 hop 名额**(关联额度不被身份来源挤占);
 * - **去重**:同一 L1 记录被多个节点/fact 引用,只占首次出现的位置;
 * - **节点自身来源优先于其 fact 来源**:节点的 sourceRecordIds 是它的身份来源,
 *   而单个 fact 的来源可能引向与该查询无关的旁支记录;
 * - **只取 active fact**:superseded 是历史状态,不该把旧记录拉进当前检索结果;
 * - **不查库**:返回的 id 可能已被删除(墓碑边界),由调用方按"取不到的跳过"处理,
 *   不得补空占位(占位会在 RRF 里凭空加分)。
 *
 * edges/nodes 由调用方传入(loadGraph 结果,百~千量级全扫即可;>2k 再考虑预建索引,
 * 见文件头演进阶梯)。族过滤不在本函数:邻居节点可跨族,兜底在 graphLane 尾部的
 * 记录级 family/scope 双闸(宁可漏不可串落在记录上)。
 */
export declare function expandHitRecordIds(hits: readonly GraphNodeSearchResult[], nodes: readonly GraphNode[], edges: readonly GraphEdge[], opts?: GraphAsOfOptions): string[];
/**
 * 直连段回链(无 hop)——保留 task_9 的原语义形状(既有测试继续钉住);
 * 生产链路一律走 expandHitRecordIds(向量种子并集 + 1-hop)。
 */
export declare function graphHitRecordIds(hits: readonly GraphNodeSearchResult[]): string[];
/**
 * 图谱节点检索:返回按 score 降序的命中(最多 limit 条;limit 钳制 1~20)。
 * 候选节点 = active | disputed(superseded/archived 不进检索)。
 */
export declare function searchGraphNodes(nodes: readonly GraphNode[], edges: readonly GraphEdge[], query: string, limit: number, opts?: GraphAsOfOptions): GraphNodeSearchResult[];
