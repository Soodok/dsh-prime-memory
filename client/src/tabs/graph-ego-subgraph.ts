/**
 * 邻域子图裁剪与关系归组（纯函数层）：以起点做无向 BFS，按跳数圈出"该画哪一小片"，
 * 并把服务端按边下发的关系归组成"一个邻居一行"。
 *
 * 设计要点（本轮裁定）：邻域态不再另发明一套静态径向画法，而是**复用全图的力导图**，
 * 只把数据换成"起点 + 至多 N 跳可达"的子图。于是：
 * - 观感一致（都会浮动、都能拖能缩），学习成本为零；
 * - 隔离边界清楚：同一张 full 块 + (seedId, hops) 唯一决定子图，换起点或换跳数
 *   就是另一份数据、另一个实例（渲染层按 key 重挂载，不共享布局态）；
 * - 少一次往返：起点/跳数全在客户端算，不必再打 seedId 请求。
 *
 * BFS 走**无向**（关系本身有方向，但"谁跟它有关"这个问题不分方向），
 * 边的 from/to 原样保留 —— 指向性由渲染层的箭头表达，这里不掰。
 * 同一起点的多条关系全部保留（不去重成一条），关系词在详情列表里合并展示。
 */
import type { GraphFull } from './graph-canvas-data.js';

/** 跳数档位上限（再深就等于全图，隔离失去意义）。 */
export const EGO_HOPS_MAX = 3;
/** 子图节点软上限：触顶即置 truncated，避免 3 跳把整张图吞进来还照画。 */
export const EGO_SUBGRAPH_NODE_CAP = 400;

export interface EgoSubgraph {
  /** 裁出来的子图（形状与 GraphFull 一致，可直接喂给同一个画布组件）。 */
  nodes: GraphFull['nodes'];
  edges: GraphFull['edges'];
  /** seedId → 跳数（0=起点本身；未连通则不出现在表里）。 */
  depth: Map<string, number>;
  /** 起点是否可见（不可见时 nodes/edges 皆空，渲染层走空态）。 */
  seedFound: boolean;
  /** 因跳数或软上限被截掉的连通节点数（0 = 这片全画出来了）。 */
  cutByCap: number;
  truncated: boolean;
}

/** 空子图（起点缺席/无 full 块时给渲染层的稳定形状）。 */
function emptySubgraph(): EgoSubgraph {
  return { nodes: [], edges: [], depth: new Map(), seedFound: false, cutByCap: 0, truncated: false };
}

/**
 * 以 seedId 为中心、至多 maxHops 跳的子图。
 * 确定性：同 (full, seed, hops) 两次调用产出逐位一致——邻居按 full.nodes 原序展开，
 * 不引入 Map 迭代顺序之外的随机源。
 */
export function egoSubgraph(
  full: GraphFull | undefined,
  seedId: string | null | undefined,
  maxHops: number,
  nodeCap: number = EGO_SUBGRAPH_NODE_CAP,
): EgoSubgraph {
  if (!full || !seedId) return emptySubgraph();
  const byId = new Map(full.nodes.map((n) => [n.id, n]));
  if (!byId.has(seedId)) return emptySubgraph();

  // 无向邻接表：id → 相连 id 列表（保持 full.edges 原序，展开顺序随之确定）
  const adj = new Map<string, string[]>();
  for (const e of full.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue; // 悬挂边（服务端已过滤，双保险）
    if (e.from === e.to) continue; // 自环不参与 BFS（否则跳数被自己吃掉）
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }

  const hops = Math.min(Math.max(1, Math.floor(maxHops)), EGO_HOPS_MAX);
  const depth = new Map<string, number>([[seedId, 0]]);
  let frontier: string[] = [seedId];
  let capped = false;
  for (let d = 1; d <= hops && !capped; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (depth.has(nb)) continue;
        if (depth.size >= nodeCap) {
          capped = true;
          break;
        }
        depth.set(nb, d);
        next.push(nb);
      }
      if (capped) break;
    }
    frontier = next;
  }

  const nodes = full.nodes.filter((n) => depth.has(n.id));
  // 自环不画（力导里它只能变成贴在身上的一小段，语义上“自己关自己”也不是关系）
  const edges = full.edges.filter((e) => e.from !== e.to && depth.has(e.from) && depth.has(e.to));
  // 软上限之外还有多少连通节点没画：从"被 cap 拦住的那一层"起算，够诚实即可
  let cutByCap = 0;
  if (capped) {
    const seen = new Set(depth.keys());
    const queue = [...seen];
    const visited = new Set(seen);
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const nb of adj.get(id) ?? []) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        queue.push(nb);
      }
    }
    cutByCap = Math.max(0, visited.size - seen.size);
  }
  return {
    nodes,
    edges,
    depth,
    seedFound: true,
    cutByCap,
    truncated: capped || depth.size > nodeCap,
  };
}

/** 该起点在 maxHops 下还能不能"再展开一层"（跳数按钮的可用位由它决定）。 */
export function canGrow(full: GraphFull | undefined, seedId: string | null | undefined, maxHops: number): boolean {
  const here = egoSubgraph(full, seedId, maxHops);
  const deeper = egoSubgraph(full, seedId, Math.min(EGO_HOPS_MAX, maxHops + 1));
  return here.seedFound && deeper.nodes.length > here.nodes.length;
}

/* ── 关系归组与显示名（清单侧用；拓扑侧不需要） ───────────────────────── */

/** 名字截断字数（与画布标签同口径，两处视图一致才不致“同一个节点两个名字”）。 */
export const EGO_NAME_CLIP = 8;

/** 服务端按边下发的邻居条目（契约 GraphPreviewResponse.seeds[].neighbors 的元素形状）。 */
export interface RawNeighbor {
  id: string;
  name: string;
  type: string;
  relation: string;
  causal: boolean;
}

/** 归组后的邻居：一个节点一行，关系词全留。 */
export interface EgoNeighbor {
  id: string;
  name: string;
  type: string;
  /** 与中心之间的全部关系词（去重、保持出现序）。 */
  relations: string[];
  /** 任一条关系是因果边即为真。 */
  causal: boolean;
}

/**
 * 按 id 归组：服务端 neighbors 是**按边**生成的（同一对节点可多条关系），
 * 不归组就会出现重复行与丢关系。首次出现顺序即服务端排序序（因果→度数→新度），不重排。
 */
export function groupNeighbors(neighbors: readonly RawNeighbor[]): EgoNeighbor[] {
  const out: EgoNeighbor[] = [];
  const index = new Map<string, number>();
  for (const nb of neighbors) {
    const at = index.get(nb.id);
    if (at === undefined) {
      index.set(nb.id, out.length);
      out.push({ id: nb.id, name: nb.name, type: nb.type, relations: [nb.relation], causal: nb.causal });
      continue;
    }
    const cur = out[at]!;
    if (!cur.relations.includes(nb.relation)) cur.relations.push(nb.relation);
    if (nb.causal) cur.causal = true;
  }
  return out;
}

/** 截断显示名（超出加省略号；全名给 title / 清单）。 */
export function clipName(name: string): string {
  return name.length > EGO_NAME_CLIP ? `${name.slice(0, EGO_NAME_CLIP)}…` : name;
}
