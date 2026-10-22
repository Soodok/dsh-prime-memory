import type { GraphEdge, GraphNode, GraphNodeType } from './types.js';
export interface GraphSeedNode {
    id: string;
    name: string;
    type: GraphNodeType;
    /** active 边双向计数(两端都可见才计入,与 degreeMaps 同口径)。 */
    degree: number;
    /** 其中因果边(constraints.GRAPH_CAUSAL_RELATIONS)计数。 */
    causalDegree: number;
}
export interface GraphSeedNeighbor {
    id: string;
    name: string;
    type: GraphNodeType;
    /** 该条边的关系词(平行多边各占一条,标注各画各的)。 */
    relation: string;
    causal: boolean;
}
export interface GraphSeedView {
    node: GraphSeedNode;
    /** 因果边优先→邻居度数降序→updatedAt 新先→id 升序;长度 ≤ neighborLimit。 */
    neighbors: GraphSeedNeighbor[];
    /** 邻居超上限被截断的标记(UI 画 "+n" 角标)。 */
    truncated: boolean;
}
export interface GraphPreviewStats {
    nodes: number;
    edges: number;
    causalEdges: number;
    /** 未定投影 job 数(pending/running/failed),>0 → UI "构建中 x/y"。 */
    pendingJobs: number;
    /** 全量 job 数(分母)。 */
    jobsTotal: number;
    /** 永久失败(dead)作业数,可选(零漂移先例);>0 → UI 拆三档。 */
    deadJobs?: number;
}
export interface GraphPreviewResult {
    seeds: GraphSeedView[];
    stats: GraphPreviewStats;
}
export interface PreviewOpts {
    /** 给定即只展开该节点为唯一中心(悬挂/不可见 → 空 seeds,不抛)。 */
    seedId?: string;
    seedLimit?: number;
    neighborLimit?: number;
    pendingJobs?: number;
    jobsTotal?: number;
    deadJobs?: number;
}
/** S-2:邻接统计——active 边且两端都可见才计度(双向)。 */
export interface DegreeMaps {
    degree: Map<string, number>;
    causal: Map<string, number>;
}
export declare function degreeMaps(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): DegreeMaps;
/**
 * S-3/S-4:预览主函数。
 * - seedId 视图:直接展开该节点(跳过挑选);不可见/悬挂 → 空 seeds。
 * - 榜单视图:score = degree + causal×WEIGHT;同分链 causal→sources→updatedAt→id↑;
 *   候选落入已选种子的"自身∪邻居"覆盖集则跳过(相邻合并,画布片不重复);
 *   孤立节点(度 0)不入榜——画布只有中心一个点没有信息量。
 */
export declare function buildGraphPreview(nodes: readonly GraphNode[], edges: readonly GraphEdge[], opts?: PreviewOpts): GraphPreviewResult;
/** 全图节点轻量项（星图渲染只需这三字段，facts/sources 不下发——带宽与隐私面同步收紧）。 */
export interface FullViewNode {
    id: string;
    name: string;
    type: GraphNodeType;
}
/** 全图边轻量项（causal 由单源词表判出，渲染侧不再抄词表）。 */
export interface FullViewEdge {
    from: string;
    to: string;
    relation: string;
    causal: boolean;
}
export interface GraphFullView {
    nodes: FullViewNode[];
    edges: FullViewEdge[];
    /** 任一维触顶即 true（截断标记而非硬拒；渲染侧可据此提示"仅画部分"）。 */
    truncated: boolean;
}
export interface FullViewCaps {
    nodeCap?: number;
    edgeCap?: number;
}
/**
 * 全图星图数据块（纯函数，不查库）：可见节点轻量投影 × active 边，
 * 双上限截断。**顺序纪律**：节点按入参序截断（调用方 loadGraph 的行序），
 * 悬挂边（端点之一被截掉/不可见）在截断前剔除——星图上不画悬空线。
 */
export declare function buildFullView(nodes: readonly GraphNode[], edges: readonly GraphEdge[], caps?: FullViewCaps): GraphFullView;
