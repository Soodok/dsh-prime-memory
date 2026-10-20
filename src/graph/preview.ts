/**
 * 面板图谱预览(读路径纯函数):种子推荐榜 + 指定节点邻域展开。
 *
 * 定位:图谱投影三表的"值得画哪些片"视图筛选,不查库、不落库、无 I/O——
 * job 计数(pendingJobs/jobsTotal)由存储缝(graph-store.buildPreview)传入。
 * 起点推荐有实证底座(2026-10-20 装机审计):关系全落规范词表、因果边 ~24%,
 * 故 score 以 active 度数为主键、因果边加权——纯 top 度会漏"因→果"链。
 *
 * 判据与检索同源(search.ts):候选 = active|disputed 节点 × active 边;
 * 确定性 = 同输入两次调用逐位一致(同分裁决链落到 id 升序兜底)。
 */
import { GRAPH_CAUSAL_RELATIONS } from './constraints.js';
import { GRAPH_PREVIEW_CAUSAL_WEIGHT, GRAPH_PREVIEW_NEIGHBORS, GRAPH_PREVIEW_SEEDS } from './types.js';
import type { GraphEdge, GraphNode, GraphNodeType } from './types.js';

const CAUSAL_SET: ReadonlySet<string> = new Set<string>(GRAPH_CAUSAL_RELATIONS);

/** 预览唯一判定的节点可见性(与 searchGraphNodes 候选集同式)。 */
function visible(n: GraphNode): boolean {
  return n.status === 'active' || n.status === 'disputed';
}

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
}

/** S-2:邻接统计——active 边且两端都可见才计度(双向)。 */
export interface DegreeMaps {
  degree: Map<string, number>;
  causal: Map<string, number>;
}

export function degreeMaps(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): DegreeMaps {
  const candidate = new Set<string>(nodes.filter(visible).map((n) => n.id));
  const degree = new Map<string, number>();
  const causal = new Map<string, number>();
  for (const e of edges) {
    if (e.status !== 'active') continue;
    if (!candidate.has(e.fromNodeId) || !candidate.has(e.toNodeId)) continue;
    const isCausal = CAUSAL_SET.has(e.relation);
    for (const id of [e.fromNodeId, e.toNodeId]) {
      degree.set(id, (degree.get(id) ?? 0) + 1);
      if (isCausal) causal.set(id, (causal.get(id) ?? 0) + 1);
    }
  }
  return { degree, causal };
}

/** 种子卡装配:邻居条目 + 因果优先排序 + 截断。 */
function seedView(
  center: GraphNode,
  edges: readonly GraphEdge[],
  byId: Map<string, GraphNode>,
  dm: DegreeMaps,
  neighborLimit: number,
): GraphSeedView {
  const list: Array<GraphSeedNeighbor & { _deg: number; _upd: string }> = [];
  for (const e of edges) {
    if (e.status !== 'active') continue;
    let otherId: string | undefined;
    if (e.fromNodeId === center.id) otherId = e.toNodeId;
    else if (e.toNodeId === center.id) otherId = e.fromNodeId;
    else continue;
    const o = byId.get(otherId);
    if (!o || !visible(o)) continue;
    list.push({
      id: o.id,
      name: o.name,
      type: o.type,
      relation: e.relation,
      causal: CAUSAL_SET.has(e.relation),
      _deg: dm.degree.get(o.id) ?? 0,
      _upd: o.updatedAt,
    });
  }
  list.sort((a, b) => {
    if (a.causal !== b.causal) return a.causal ? -1 : 1;
    if (a._deg !== b._deg) return b._deg - a._deg;
    if (a._upd !== b._upd) return a._upd < b._upd ? -1 : 1; // updatedAt 新(大)先
    return a.id < b.id ? -1 : 1;
  });
  const truncated = list.length > neighborLimit;
  return {
    node: {
      id: center.id,
      name: center.name,
      type: center.type,
      degree: dm.degree.get(center.id) ?? 0,
      causalDegree: dm.causal.get(center.id) ?? 0,
    },
    neighbors: list.slice(0, neighborLimit).map(({ _deg, _upd, ...view }) => view),
    truncated,
  };
}

/**
 * S-3/S-4:预览主函数。
 * - seedId 视图:直接展开该节点(跳过挑选);不可见/悬挂 → 空 seeds。
 * - 榜单视图:score = degree + causal×WEIGHT;同分链 causal→sources→updatedAt→id↑;
 *   候选落入已选种子的"自身∪邻居"覆盖集则跳过(相邻合并,画布片不重复);
 *   孤立节点(度 0)不入榜——画布只有中心一个点没有信息量。
 */
export function buildGraphPreview(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  opts: PreviewOpts = {},
): GraphPreviewResult {
  const byId = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));
  const dm = degreeMaps(nodes, edges);
  const visNodes = nodes.filter(visible);
  const visEdges = edges.filter((e) => e.status === 'active');
  const stats: GraphPreviewStats = {
    nodes: visNodes.length,
    edges: visEdges.length,
    causalEdges: visEdges.filter((e) => CAUSAL_SET.has(e.relation)).length,
    pendingJobs: opts.pendingJobs ?? 0,
    jobsTotal: opts.jobsTotal ?? 0,
  };
  const seedLimit = Math.min(Math.max(Math.floor(opts.seedLimit ?? GRAPH_PREVIEW_SEEDS), 1), 20);
  const neighborLimit = Math.min(Math.max(Math.floor(opts.neighborLimit ?? GRAPH_PREVIEW_NEIGHBORS), 1), 40);

  if (opts.seedId !== undefined) {
    const target = byId.get(opts.seedId);
    if (!target || !visible(target)) return { seeds: [], stats };
    return { seeds: [seedView(target, edges, byId, dm, neighborLimit)], stats };
  }

  const scored = visNodes
    .map((n) => ({
      n,
      score: (dm.degree.get(n.id) ?? 0) + (dm.causal.get(n.id) ?? 0) * GRAPH_PREVIEW_CAUSAL_WEIGHT,
    }))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      const ca = dm.causal.get(a.n.id) ?? 0;
      const cb = dm.causal.get(b.n.id) ?? 0;
      if (ca !== cb) return cb - ca;
      const sa = a.n.sourceRecordIds.length;
      const sb = b.n.sourceRecordIds.length;
      if (sa !== sb) return sb - sa;
      if (a.n.updatedAt !== b.n.updatedAt) return a.n.updatedAt < b.n.updatedAt ? 1 : -1;
      return a.n.id < b.n.id ? -1 : 1;
    });

  const picked: GraphNode[] = [];
  const covered = new Set<string>();
  for (const { n, score } of scored) {
    if (picked.length >= seedLimit) break;
    if (score === 0) continue; // 孤立点不入榜(score 单调降,continue 等价于提前结束)
    if (covered.has(n.id)) continue; // 相邻合并:已被前一种子的邻域覆盖
    picked.push(n);
    covered.add(n.id);
    for (const e of visEdges) {
      if (e.fromNodeId === n.id) covered.add(e.toNodeId);
      else if (e.toNodeId === n.id) covered.add(e.fromNodeId);
    }
  }
  return {
    seeds: picked.map((n) => seedView(n, edges, byId, dm, neighborLimit)),
    stats,
  };
}
