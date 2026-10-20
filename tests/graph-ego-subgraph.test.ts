/**
 * 邻域数据层（graph-ego-subgraph）验收面。
 *
 * 钉住的性质：
 * ① 跳数就是隔离边界：子图只含 ≤N 跳可达节点，跨片边一律不带进来；
 * ② 方向不被 BFS 掰弯：边 from/to 原样保留（指向性由画布箭头表达）；
 * ③ 起点不可见 / 无 full 块 → 稳定空形状（渲染层据此走空态，不白屏）；
 * ④ 软上限触顶置 truncated 并如实报未画数（3 跳吞掉全图时不装作画全了）；
 * ⑤ 确定性 + 隔离唯一性：同 (full, seed, hops) 逐位一致，不同起点是不同一片；
 * ⑥ 关系归组：服务端按边下发 → 一个邻居一行、关系词全留、因果 any。
 */
import { describe, expect, it } from 'vitest';
import {
  EGO_HOPS_MAX,
  EGO_NAME_CLIP,
  canGrow,
  clipName,
  egoSubgraph,
  groupNeighbors,
  type RawNeighbor,
} from '../client/src/tabs/graph-ego-subgraph.js';
import type { GraphFull } from '../client/src/tabs/graph-canvas-data.js';

function graph(nodes: string[], edges: Array<[string, string, string?, boolean?]>): GraphFull {
  return {
    nodes: nodes.map((id) => ({ id, name: `名-${id}`, type: 'tool' })),
    edges: edges.map(([from, to, relation, causal]) => ({ from, to, relation: relation ?? '相关', causal: !!causal })),
    truncated: false,
  };
}

describe('egoSubgraph：跳数即边界', () => {
  // 链式 a-b-c-d-e，另挂一条与主体无关的 x-y
  const chain = graph(['a', 'b', 'c', 'd', 'e', 'x', 'y'], [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e'], ['x', 'y', '导致', true]]);

  it('1 跳只含起点与直连邻居，depth 标注准确', () => {
    const s = egoSubgraph(chain, 'a', 1);
    expect(s.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(s.depth.get('a')).toBe(0);
    expect(s.depth.get('b')).toBe(1);
    expect(s.edges).toHaveLength(1);
  });

  it('2 跳多长一层，且不相关分量永不混入（隔离）', () => {
    const s = egoSubgraph(chain, 'a', 2);
    expect(s.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(s.depth.get('c')).toBe(2);
    expect(s.nodes.some((n) => n.id === 'x')).toBe(false);
  });

  it('跨片边不外带：两端必须都在子图内', () => {
    const s = egoSubgraph(chain, 'c', 1);
    expect(s.edges.map((e) => [e.from, e.to])).toEqual([
      ['b', 'c'],
      ['c', 'd'],
    ]);
  });

  it('BFS 走无向但保留原方向（from/to 不翻）', () => {
    const g = graph(['a', 'b'], [['a', 'b', '导致', true]]);
    const fromB = egoSubgraph(g, 'b', 1);
    expect(fromB.edges[0]).toEqual({ from: 'a', to: 'b', relation: '导致', causal: true });
  });

  it('自环与悬挂边不参与 BFS（否则跳数被自己吃掉）', () => {
    const g = graph(['a', 'b'], [['a', 'a'], ['a', 'b'], ['b', 'ghost']]);
    const s = egoSubgraph(g, 'a', 2);
    expect(s.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(s.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['a>b']);
  });

  it('跳数钳制：0 以下按 1，超过上限按 EGO_HOPS_MAX（链上第 4 跳不进来）', () => {
    expect(egoSubgraph(chain, 'a', 0).nodes.map((n) => n.id)).toEqual(['a', 'b']);
    const deep = egoSubgraph(chain, 'a', 99);
    expect(deep.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']); // e 在 4 跳外
    expect(Math.max(...[...deep.depth.values()])).toBe(EGO_HOPS_MAX);
  });
});

describe('egoSubgraph：降级与上限', () => {
  const chain = graph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);

  it('起点不可见 / 无 full 块 / 无起点 → 同一稳定空形状', () => {
    for (const s of [egoSubgraph(chain, 'ghost', 2), egoSubgraph(undefined, 'a', 2), egoSubgraph(chain, null, 2)]) {
      expect(s.seedFound).toBe(false);
      expect(s.nodes).toEqual([]);
      expect(s.edges).toEqual([]);
      expect(s.truncated).toBe(false);
    }
  });

  it('软上限触顶：置 truncated 并如实报未画的连通节点数', () => {
    const s = egoSubgraph(chain, 'a', 3, 2);
    expect(s.nodes).toHaveLength(2);
    expect(s.truncated).toBe(true);
    expect(s.cutByCap).toBe(1); // c 仍连通但被上限拦在外面
  });

  it('同输入两次调用逐位一致（确定性：无随机源、无 Map 顺序依赖外的输入）', () => {
    expect(egoSubgraph(chain, 'a', 3)).toEqual(egoSubgraph(chain, 'a', 3));
  });

  it('不同起点是不同一片（隔离唯一性）', () => {
    const a = egoSubgraph(chain, 'a', 1);
    const c = egoSubgraph(chain, 'c', 1);
    expect(a.nodes.map((n) => n.id)).not.toEqual(c.nodes.map((n) => n.id));
  });
});

describe('canGrow（跳数档位的可用位）', () => {
  it('链上还有纵深时才能长；已到跳数上限或起点不可见则不能长', () => {
    const chain = graph(['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'c'], ['c', 'd']]);
    expect(canGrow(chain, 'a', 1)).toBe(true); // 2 跳能多拉进 c
    expect(canGrow(chain, 'a', 2)).toBe(true); // 3 跳能多拉进 d
    expect(canGrow(chain, 'a', 3)).toBe(false); // 跳数已到顶，再按也不会变
    expect(canGrow(chain, 'ghost', 1)).toBe(false);
  });
});

describe('groupNeighbors（按边下发 → 按节点归组）', () => {
  function nb(id: string, relation: string, causal = false): RawNeighbor {
    return { id, name: `名-${id}`, type: 'tool', relation, causal };
  }

  it('同 id 多条关系并成一行，关系词按出现序去重全留', () => {
    const g = groupNeighbors([nb('a', '取代', true), nb('b', '相关'), nb('a', '导致', true), nb('a', '取代')]);
    expect(g.map((e) => e.id)).toEqual(['a', 'b']);
    expect(g[0]!.relations).toEqual(['取代', '导致']);
  });

  it('任一条因果即整体判因果；空输入给空数组', () => {
    expect(groupNeighbors([nb('a', '相关'), nb('a', '导致', true)])[0]!.causal).toBe(true);
    expect(groupNeighbors([])).toEqual([]);
  });

  it('超 8 字截断加省略号（与画布标签同口径）', () => {
    expect(clipName('一二三四五六七八九十')).toBe('一二三四五六七八九十'); // 10 CJK = 20 单位，正好吃满预算
    expect(clipName('一二三四五六七八九十a')).toBe('一二三四五六七八九十\u2026'); // 21 单位超预算
    expect(clipName('短')).toBe('短');
    expect(clipName('dsh-prime-memory')).toBe('dsh-prime-memory'); // 16 英文字符不截
    expect(EGO_NAME_CLIP).toBe(20);
  });
});
