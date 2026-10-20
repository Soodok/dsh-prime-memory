/**
 * 轨 A · 1-hop 边扩展（expandHitRecordIds）——纯函数验收面。
 *
 * 钉住的性质（spec 模块 B）:
 * ① 直连段恒先于 hop 段(命中排名不被联想挤后);
 * ② hop 只沿 active 边、只落 active|disputed 邻居(superseded/archived 不扩散);
 * ③ 邻居去重(多命中共享同一邻居只展开一次)、邻居按 updatedAt 新→旧;
 * ④ hop 段新增记录整段封顶 GRAPH_HOP_RECORD_CAP,且**已被直连段占位的 id 不吃名额**;
 * ⑤ graphHitRecordIds 委托后与 expand(hits, [], []) 逐位一致(task_9 语义不回退)。
 */
import { describe, expect, it } from 'vitest';
import { expandHitRecordIds, graphHitRecordIds } from '../src/graph/search.js';
import { GRAPH_HOP_RECORD_CAP } from '../src/graph/types.js';
import type { GraphEdge, GraphFact, GraphNode, GraphNodeSearchResult } from '../src/graph/types.js';

const T0 = '2026-01-01T00:00:00.000Z';

function fact(key: string, sources: string[], status: GraphFact['status'] = 'active'): GraphFact {
  return {
    id: `f-${key}-${status}`,
    key,
    value: key,
    status,
    confidence: 1,
    sourceRecordIds: sources,
    createdAt: T0,
    updatedAt: T0,
  };
}

function node(
  id: string,
  sources: string[],
  opts: { status?: GraphNode['status']; updatedAt?: string; facts?: GraphFact[] } = {},
): GraphNode {
  return {
    id,
    name: id,
    type: 'tool',
    aliases: [],
    tags: [],
    currentState: '',
    facts: opts.facts ?? [],
    status: opts.status ?? 'active',
    confidence: 1,
    sourceRecordIds: sources,
    families: [],
    createdAt: T0,
    updatedAt: opts.updatedAt ?? T0,
  };
}

function edge(from: string, to: string, status: GraphEdge['status'] = 'active'): GraphEdge {
  return {
    id: `e-${from}-${to}-${status}`,
    fromNodeId: from,
    toNodeId: to,
    relation: '依赖',
    status,
    confidence: 1,
    sourceRecordIds: ['e-src'],
    createdAt: T0,
    updatedAt: T0,
  };
}

function hit(n: GraphNode): GraphNodeSearchResult {
  return { node: n, score: 1, matchedFields: ['name'], matchReason: 'x' };
}

describe('expandHitRecordIds —— 直连段 + 1-hop 段', () => {
  it('直连段恒先于 hop 段(命中排名不被联想挤后)', () => {
    const a = node('a', ['r1', 'r2']);
    const b = node('b', ['r3']);
    expect(expandHitRecordIds([hit(a)], [a, b], [edge('a', 'b')])).toEqual(['r1', 'r2', 'r3']);
  });

  it('边是双向的:命中在 to 端也扩 from 端', () => {
    const a = node('a', ['r-a']);
    const b = node('b', ['r-b']);
    expect(expandHitRecordIds([hit(b)], [a, b], [edge('a', 'b')])).toEqual(['r-b', 'r-a']);
  });

  it('非 active 边不扩散(superseded 的旧关系不该把旁支拉进当前结果)', () => {
    const a = node('a', ['r1']);
    const b = node('b', ['r2']);
    expect(expandHitRecordIds([hit(a)], [a, b], [edge('a', 'b', 'superseded')])).toEqual(['r1']);
  });

  it('邻居状态非 active|disputed 不展开(superseded/archived 的历史节点不作为联想)', () => {
    const a = node('a', ['r1']);
    const gone = node('g', ['rg'], { status: 'archived' });
    const old = node('o', ['ro'], { status: 'superseded' });
    const dispute = node('d', ['rd'], { status: 'disputed' });
    expect(expandHitRecordIds([hit(a)], [a, gone, old, dispute], [edge('a', 'g'), edge('a', 'o'), edge('a', 'd')])).toEqual([
      'r1',
      // disputed 邻居可展开(未裁决 ≠ 不该被关联到);与检索候选集 active|disputed 同判据
      'rd',
    ]);
  });

  it('邻居去重:两个命中共享同一邻居,邻居来源只展开一次', () => {
    const a = node('a', ['ra']);
    const c = node('c', ['rc']);
    const b = node('b', ['rb']);
    expect(expandHitRecordIds([hit(a), hit(c)], [a, b, c], [edge('a', 'b'), edge('c', 'b')])).toEqual(['ra', 'rc', 'rb']);
  });

  it('邻居排序:updatedAt 新→旧(与检索结果排序同式)', () => {
    const a = node('a', ['ra']);
    const oldN = node('old', ['r-old'], { updatedAt: '2026-01-02T00:00:00.000Z' });
    const newN = node('new', ['r-new'], { updatedAt: '2026-02-01T00:00:00.000Z' });
    expect(expandHitRecordIds([hit(a)], [a, oldN, newN], [edge('a', 'old'), edge('a', 'new')])).toEqual([
      'ra',
      'r-new',
      'r-old',
    ]);
  });

  it('hop 段新增整段封顶 GRAPH_HOP_RECORD_CAP;邻居自身的 fact 来源不参与(只取节点来源)', () => {
    const a = node('a', ['direct-1']);
    const many = node('hub', Array.from({ length: GRAPH_HOP_RECORD_CAP + 36 }, (_, i) => `h-${i}`), {
      facts: [fact('k', ['fact-of-hub'])],
    });
    const out = expandHitRecordIds([hit(a)], [a, many], [edge('a', 'hub')]);
    expect(out[0]).toBe('direct-1');
    expect(out.length).toBe(1 + GRAPH_HOP_RECORD_CAP);
    expect(out).not.toContain('fact-of-hub');
  });

  it('已被直连段占位的 id 不吃 hop 名额(关联额度不被身份来源挤占)', () => {
    const shared = ['x1', 'x2'];
    const a = node('a', shared);
    // 邻居来源:前两个与直连段重叠,后面 64 个是新 id——全部应进(重叠不占额)
    const b = node('b', ['x2', ...Array.from({ length: GRAPH_HOP_RECORD_CAP }, (_, i) => `y-${i}`)]);
    const out = expandHitRecordIds([hit(a)], [a, b], [edge('a', 'b')]);
    expect(out).toEqual(['x1', 'x2', ...Array.from({ length: GRAPH_HOP_RECORD_CAP }, (_, i) => `y-${i}`)]);
    // 再多一个新 id 应被名额截断
    const c = node('c', ['z-1']);
    const out2 = expandHitRecordIds([hit(a)], [a, b, c], [edge('a', 'b'), edge('a', 'c')]);
    expect(out2[out2.length - 1]).toBe('y-63');
    expect(out2).not.toContain('z-1');
  });

  it('空边集/空命中 → 与 graphHitRecordIds 委托逐位一致(task_9 语义不回退)', () => {
    const a = node('a', ['r1'], { facts: [fact('k', ['r2']), fact('old', ['r3'], 'superseded')] });
    const b = node('b', ['r4']);
    const hits = [hit(a), hit(b)];
    expect(graphHitRecordIds(hits)).toEqual(expandHitRecordIds(hits, [a, b], []));
    expect(expandHitRecordIds([], [], [])).toEqual([]);
  });
});
