/**
 * 轨 S · 面板图谱预览(buildGraphPreview / GraphStore.buildPreview)验收面。
 *
 * 钉住的性质(spec 模块 A):
 * ① 榜单按 score=degree+causal×2 降序;同分链 causal→sources→updatedAt→id↑ 确定性;
 * ② 相邻合并:高分候选被前一种子的"自身∪邻居"覆盖则跳过(画布片不重复);
 * ③ 邻居排序 因果→度→新;超上限截断且 truncated=true;
 * ④ seedId 视图:可见节点直接展开;悬挂/不可见 → 空 seeds 不抛(graph-node-get 同款宽容);
 * ⑤ 空图/降级 → 全零结构,无 throw;
 * ⑥ 不可见节点(superseded/archived)不参与计度、不作为邻居出现;
 * ⑦ pendingJobs/jobsTotal 透传进 stats(构建中 x/y 的数据源)。
 */
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { buildFullView, buildGraphPreview, degreeMaps } from '../src/graph/preview.js';
import { GRAPH_PREVIEW_CAUSAL_WEIGHT } from '../src/graph/types.js';
import type { GraphEdge, GraphNode } from '../src/graph/types.js';
import { GraphStore } from '../src/store/graph-store.js';

const T0 = '2026-01-01T00:00:00.000Z';

function node(id: string, opts: { status?: GraphNode['status']; updatedAt?: string; sources?: string[]; type?: GraphNode['type'] } = {}): GraphNode {
  return {
    id,
    name: `n-${id}`,
    type: opts.type ?? 'tool',
    aliases: [],
    tags: [],
    currentState: '',
    facts: [],
    status: opts.status ?? 'active',
    confidence: 1,
    sourceRecordIds: opts.sources ?? [`${id}-rec`],
    families: [],
    createdAt: T0,
    updatedAt: opts.updatedAt ?? T0,
  };
}

function edge(from: string, to: string, relation = '依赖', status: GraphEdge['status'] = 'active'): GraphEdge {
  return {
    id: `e-${from}-${to}-${relation}`,
    fromNodeId: from,
    toNodeId: to,
    relation,
    status,
    confidence: 1,
    sourceRecordIds: [],
    createdAt: T0,
    updatedAt: T0,
  };
}

describe('degreeMaps —— active 边双向计度', () => {
  it('两端都可见才计入;非 active 边、指向不可见节点的边不计数', () => {
    const nodes = [node('a'), node('b'), node('gone', { status: 'superseded' })];
    const edges = [edge('a', 'b'), edge('a', 'gone'), edge('b', 'a', '导致', 'superseded')];
    const dm = degreeMaps(nodes, edges);
    expect(dm.degree.get('a')).toBe(1);
    expect(dm.degree.get('b')).toBe(1);
    expect(dm.degree.get('gone')).toBeUndefined();
    expect(dm.causal.get('a')).toBeUndefined(); // 因果边是 superseded → 不计
  });
});

describe('buildGraphPreview —— 榜单视图', () => {
  it('度序:度数高者先入榜', () => {
    const nodes = [node('hub'), node('l1'), node('l2'), node('l3'), node('mid'), node('m1'), node('m2')];
    const edges = [
      edge('hub', 'l1'), edge('hub', 'l2'), edge('hub', 'l3'),
      edge('mid', 'm1'), edge('mid', 'm2'),
    ];
    const r = buildGraphPreview(nodes, edges);
    expect(r.seeds.map((s) => s.node.id)).toEqual(['hub', 'mid']);
  });

  it(`因果加权:同度数下因果多者先(${GRAPH_PREVIEW_CAUSAL_WEIGHT} 条因果边的中心胜 2 条普通边的中心)`, () => {
    // cause 度 2 全因果(score=2+2×2=6);plain 度 2 全普通(score=2)——纯度数排序两者并列,加权后才分高下
    // (因果边两端双向计 causal 是既定语义:c1/c2 也带因果分,但被 cause 首选后覆盖)
    const nodes = [node('cause'), node('c1'), node('c2'), node('plain'), node('p1'), node('p2')];
    const edges = [edge('cause', 'c1', '导致'), edge('cause', 'c2', '取代'), edge('plain', 'p1', '使用'), edge('plain', 'p2', '相关')];
    const r = buildGraphPreview(nodes, edges);
    expect(r.seeds.map((s) => s.node.id)).toEqual(['cause', 'plain']); // c1(3 分)被 cause 覆盖不另开片
    expect(r.seeds[0].node.causalDegree).toBe(2);
    expect(r.seeds[1].node.causalDegree).toBe(0);
  });

  it('相邻合并:次高分候选 ∈ 首种子邻域则跳过;独立对取一端作种子即覆盖对端', () => {
    // b 度 3 最高且覆盖 c/d/f;a-e 独立对取 a 后 e 被覆盖不再另开一片(碎片不重复)
    const nodes = [node('b'), node('c'), node('d'), node('f'), node('e'), node('a')];
    const edges = [edge('b', 'c'), edge('b', 'd'), edge('b', 'f'), edge('a', 'e')];
    const r = buildGraphPreview(nodes, edges);
    expect(r.seeds.map((s) => s.node.id)).toEqual(['b', 'a']);
  });

  it('邻居截断:超 neighborLimit 截断并置 truncated;邻居不含不可见节点', () => {
    const nodes = [node('hub'), ...Array.from({ length: 12 }, (_, i) => node(`l${i}`)), node('ghost', { status: 'archived' })];
    const edges = [...Array.from({ length: 12 }, (_, i) => edge('hub', `l${i}`)), edge('hub', 'ghost')];
    const r = buildGraphPreview(nodes, edges, { seedId: 'hub' });
    expect(r.seeds[0].neighbors.length).toBe(10);
    expect(r.seeds[0].truncated).toBe(true);
    expect(r.seeds[0].neighbors.some((n) => n.id === 'ghost')).toBe(false);
  });

  it('邻居排序:因果边优先,其后按邻居度数降序', () => {
    const nodes = [node('c'), node('big'), node('bigX'), node('small'), node('causal')];
    // big 度=2(含自身连 c 的边);causal 度=1 但边是因果;small 度=1 普通
    const edges = [edge('c', 'big', '依赖'), edge('big', 'bigX'), edge('c', 'causal', '导致'), edge('c', 'small', '相关')];
    const r = buildGraphPreview(nodes, edges, { seedId: 'c' });
    const ids = r.seeds[0].neighbors.map((n) => n.id);
    expect(ids[0]).toBe('causal'); // 因果第一,哪怕 big 度更高
    expect(ids.indexOf('big')).toBeLessThan(ids.indexOf('small')); // 其后度降序
  });

  it('确定性:同输入两次调用逐位一致;同分对由 id 升序稳定裁决', () => {
    const nodes = [node('zz'), node('aa'), node('m')];
    const edges = [edge('m', 'zz'), edge('m', 'aa')];
    const a = buildGraphPreview(nodes, edges);
    const b = buildGraphPreview(nodes, edges);
    expect(a).toEqual(b);
    // m 度 2 居首;zz/aa 同分(度 1)→ id 升序:aa 在 zz 前(且 aa 是 m 的邻居被覆盖,榜单只 [m, …])
    expect(a.seeds[0].node.id).toBe('m');
    const mNeigh = a.seeds[0].neighbors.map((n) => n.id);
    expect(mNeigh).toEqual(['aa', 'zz']); // updatedAt 同值 → id 升序稳定
  });

  it('stats 计数:可见节点/active 边/因果边/pendingJobs/jobsTotal 全透传', () => {
    const nodes = [node('a'), node('b'), node('gone', { status: 'superseded' })];
    const edges = [edge('a', 'b', '导致'), edge('a', 'b', '相关'), edge('a', 'gone', '使用', 'superseded')];
    const r = buildGraphPreview(nodes, edges, { pendingJobs: 7, jobsTotal: 49 });
    expect(r.stats).toEqual({ nodes: 2, edges: 2, causalEdges: 1, pendingJobs: 7, jobsTotal: 49 });
  });
});

describe('buildGraphPreview —— seedId 视图与边界', () => {
  it('悬挂 id / 不可见节点 → 空 seeds(不抛),stats 照常', () => {
    const nodes = [node('a'), node('b'), node('gone', { status: 'archived' })];
    const edges = [edge('a', 'b')];
    expect(buildGraphPreview(nodes, edges, { seedId: 'nope' }).seeds).toEqual([]);
    const r = buildGraphPreview(nodes, edges, { seedId: 'gone' });
    expect(r.seeds).toEqual([]);
    expect(r.stats.nodes).toBe(2);
  });

  it('孤立节点(度 0)不入榜;空图返回全零结构', () => {
    const nodes = [node('solo'), node('a'), node('b')];
    const edges = [edge('a', 'b')];
    const r = buildGraphPreview(nodes, edges);
    expect(r.seeds.map((s) => s.node.id)).not.toContain('solo');
    const z = buildGraphPreview([], []);
    expect(z.seeds).toEqual([]);
    expect(z.stats).toEqual({ nodes: 0, edges: 0, causalEdges: 0, pendingJobs: 0, jobsTotal: 0 });
  });
});

describe('GraphStore.buildPreview 降级缝', () => {
  it('db 未 init → 全零结构不抛(展示面永不拖垮端点)', () => {
    const g = new GraphStore();
    expect(g.buildPreview()).toEqual({
      seeds: [],
      stats: { nodes: 0, edges: 0, causalEdges: 0, pendingJobs: 0, jobsTotal: 0 },
    });
    expect(g.buildPreview('anything').seeds).toEqual([]);
  });
});

describe('buildFullView —— 全图星图轻量块', () => {
  it('可见性过滤:不可见节点不下发;端点不可见/非 active 的边剔除(星图不画悬空线)', () => {
    const nodes = [node('a'), node('b'), node('gone', { status: 'archived' })];
    const edges = [edge('a', 'b'), edge('a', 'gone'), edge('a', 'b', '使用', 'superseded')];
    const v = buildFullView(nodes, edges);
    expect(v.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(v.edges.length).toBe(1); // 只剩 a-b active 边一条
    expect(v.truncated).toBe(false);
  });

  it('双上限截断:节点触顶/边触顶各置 truncated,且边集只引用存活节点', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('a', 'c')];
    const nv = buildFullView(nodes, edges, { nodeCap: 2 });
    expect(nv.truncated).toBe(true);
    expect(nv.nodes.length).toBe(2);
    expect(nv.edges.every((e) => nv.nodes.some((n) => n.id === e.from) && nv.nodes.some((n) => n.id === e.to))).toBe(true);
    const ev = buildFullView(nodes, edges, { edgeCap: 1 });
    expect(ev.truncated).toBe(true);
    expect(ev.edges.length).toBe(1);
  });

  it('轻量字段形状:节点仅 id/name/type 三键、边仅 from/to/relation/causal 四键(facts/sources 不外泄)', () => {
    const nodes = [node('a', { sources: ['r1', 'r2'] }), node('b')];
    const v = buildFullView(nodes, [edge('a', 'b', '导致')]);
    expect(Object.keys(v.nodes[0]).sort()).toEqual(['id', 'name', 'type']);
    expect(Object.keys(v.edges[0]).sort()).toEqual(['causal', 'from', 'relation', 'to']);
    expect(v.edges[0].causal).toBe(true);
  });
});

describe('GraphStore.buildPreview mode:full 与零漂移', () => {
  function storeWithGraph(): { db: DatabaseSync; g: GraphStore } {
    const db = new DatabaseSync(':memory:');
    const g = new GraphStore();
    g.init(db, undefined, { dimensions: 0 });
    db.prepare(
      `INSERT INTO graph_nodes (node_id, name, type, aliases_json, tags_json, current_state, facts_json,
         status, confidence, source_record_ids_json, families_json, created_time, updated_time)
       VALUES ('n1', '甲项目', 'project', '[]', '[]', '', '[]', 'active', 0.8, '["r1"]', '["work"]', '', '')`,
    ).run();
    db.prepare(
      `INSERT INTO graph_nodes (node_id, name, type, aliases_json, tags_json, current_state, facts_json,
         status, confidence, source_record_ids_json, families_json, created_time, updated_time)
       VALUES ('n2', '乙工具', 'tool', '[]', '[]', '', '[]', 'active', 0.8, '["r2"]', '["work"]', '', '')`,
    ).run();
    db.prepare(
      `INSERT INTO graph_edges (edge_id, from_node_id, to_node_id, relation, status, valid_from, valid_to,
         confidence, source_record_ids_json, created_time, updated_time)
       VALUES ('e1', 'n1', 'n2', '导致', 'active', '', '', 0.8, '[]', '', '')`,
    ).run();
    return { db, g };
  }

  it('无 mode 响应 **无 full 键**(零漂移硬判据:键缺席而非 undefined)', () => {
    const { db, g } = storeWithGraph();
    try {
      const r = g.buildPreview() as Record<string, unknown>;
      expect('full' in r).toBe(false);
      expect(r.seeds).toBeInstanceOf(Array);
    } finally {
      db.close();
    }
  });

  it("mode='full' 附全图块:节点/边/因果标记齐全;降级态也带空 full 块", () => {
    const { db, g } = storeWithGraph();
    try {
      const r = g.buildPreview(undefined, 'full');
      expect(r.full).toBeDefined();
      expect(r.full!.nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2']);
      expect(r.full!.edges).toEqual([{ from: 'n1', to: 'n2', relation: '导致', causal: true }]);
      expect(r.full!.truncated).toBe(false);
    } finally {
      db.close();
    }
    const fresh = new GraphStore();
    expect(fresh.buildPreview(undefined, 'full').full).toEqual({ nodes: [], edges: [], truncated: false });
  });
});
