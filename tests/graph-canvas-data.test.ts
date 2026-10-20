/**
 * 全图星图纯数据层（graph-canvas-data）验收面。
 *
 * 钉住的性质（spec 模块 B/C + 契约 R6 确定性）：
 * ① 半径映射单调且钳在 [3,7]（hub 不得长成气球）；
 * ② PRNG 与散列跨调用确定（同种子同序列、[0,1) 值域）；
 * ③ 度数双向计（与服务端 degreeMaps 同判据，孤立点缺席→装配时按 0）；
 * ④ toGraphData 的初始坐标逐位等于 seedPositions（分组观感的唯一来源，渲染层不另算）；
 * ⑤ 边 id 唯一（G6 以 id 寻址，重复即吞元素）；
 * ⑥ 星点层同节点集恒同图、不同节点集换图，坐标落 viewBox 值域。
 */
import { describe, expect, it } from 'vitest';
import {
  NAME_CLIP,
  STAR_COUNT,
  degreeMapOf,
  hash32,
  nodeKeyOf,
  radiusForDegree,
  seededRandom,
  starField,
  toGraphData,
  type GraphFull,
} from '../client/src/tabs/graph-canvas-data.js';
import { seedPositions } from '../client/src/tabs/graph-seed-layout.js';

function full(nodes: Array<{ id: string; name?: string; type?: string }>, edges: Array<[string, string, boolean?]>): GraphFull {
  return {
    nodes: nodes.map((n) => ({ id: n.id, name: n.name ?? `名-${n.id}`, type: n.type ?? 'tool' })),
    edges: edges.map(([from, to, causal]) => ({ from, to, relation: causal ? '导致' : '使用', causal: !!causal })),
    truncated: false,
  };
}

describe('radiusForDegree', () => {
  it('零度节点取下限 3，且随度数单调不减', () => {
    expect(radiusForDegree(0)).toBe(3);
    const seq = [0, 1, 2, 4, 8, 16, 32].map(radiusForDegree);
    for (let i = 1; i < seq.length; i++) expect(seq[i]!).toBeGreaterThanOrEqual(seq[i - 1]!);
  });

  it('高度数钳在 7（hub 不吞屏），负度数按零处理', () => {
    expect(radiusForDegree(10_000)).toBe(7);
    expect(radiusForDegree(-5)).toBe(3);
  });
});

describe('确定性散列与伪随机', () => {
  it('hash32 同串同值且落 32 位无符号域', () => {
    expect(hash32('a|b')).toBe(hash32('a|b'));
    expect(hash32('a|b')).not.toBe(hash32('b|a'));
    const h = hash32('');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it('seededRandom 同种子同序列、值域 [0,1)', () => {
    const a = seededRandom(12345);
    const b = seededRandom(12345);
    for (let i = 0; i < 50; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('degreeMapOf / toGraphData', () => {
  it('度数双向计边，孤立节点缺席（装配时按 0 处理）', () => {
    const f = full([{ id: 'a' }, { id: 'b' }, { id: 'lone' }], [['a', 'b'], ['b', 'a', true]]);
    const deg = degreeMapOf(f);
    expect(deg.get('a')).toBe(2);
    expect(deg.get('b')).toBe(2);
    expect(deg.has('lone')).toBe(false);
    const data = toGraphData(f, 600, 400);
    expect(data.nodes.find((n) => n.id === 'lone')!.data.degree).toBe(0);
  });

  it('初始坐标逐位等于 seedPositions（分组观感单源，渲染层不另算一套）', () => {
    const f = full([{ id: 'a', type: 'person' }, { id: 'b', type: 'place' }], [['a', 'b']]);
    const expectPos = seedPositions([{ id: 'a', type: 'person' }, { id: 'b', type: 'place' }], 640, 460);
    const data = toGraphData(f, 640, 460);
    expect(data.nodes.map((n) => n.style)).toEqual(expectPos.map((p) => ({ x: p.x, y: p.y })));
  });

  it('边 id 唯一 + 端点与 causal 透传', () => {
    const f = full([{ id: 'a' }, { id: 'b' }, { id: 'c' }], [['a', 'b'], ['b', 'c'], ['a', 'b', true]]);
    const data = toGraphData(f, 600, 400);
    expect(new Set(data.edges.map((e) => e.id)).size).toBe(3);
    expect(data.edges[2]!.data.causal).toBe(true);
    expect(data.edges.map((e) => [e.source, e.target])).toEqual([['a', 'b'], ['b', 'c'], ['a', 'b']]);
  });

  it('同输入两次装配逐位一致（含名字/类型/度数三字段）', () => {
    const f = full([{ id: 'a', type: 'tool' }, { id: 'b', type: 'person' }], [['a', 'b', true]]);
    expect(toGraphData(f, 500, 500)).toEqual(toGraphData(f, 500, 500));
    expect(toGraphData(f, 500, 500).nodes[0]!.data.name!.length).toBeLessThanOrEqual(20);
  });
});

describe('starField 星点背层', () => {
  it('同节点集恒同图，不同节点集换图（指纹来自 nodeKeyOf）', () => {
    const f = full([{ id: 'a' }, { id: 'b' }], [['a', 'b']]);
    const key = nodeKeyOf(f);
    expect(starField(key)).toEqual(starField(key));
    expect(starField(key)).not.toEqual(starField(nodeKeyOf(full([{ id: 'c' }], []))));
  });

  it('条数=STAR_COUNT，坐标落 viewBox 100 值域，半径/透明度有下界', () => {
    const stars = starField('x|y');
    expect(stars).toHaveLength(STAR_COUNT);
    for (const s of stars) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(100);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(100);
      expect(s.r).toBeGreaterThanOrEqual(0.12);
      expect(s.o).toBeGreaterThanOrEqual(0.12);
    }
  });

  it('空图也有完整星点层（空态引导时背景不塌）', () => {
    expect(starField('')).toHaveLength(STAR_COUNT);
  });
});

describe('常量口径', () => {
  it('名字截断字数与径向卡同为 8（两处视图同口径）', () => {
    expect(NAME_CLIP).toBe(8);
  });
});

describe('平行边错开（同对节点多条关系不得叠成一条）', () => {
  it('首条保持直线，第 2、3 条改二次曲线并两侧交替偏移', () => {
    const f = full([{ id: 'a' }, { id: 'b' }], [['a', 'b'], ['a', 'b', true], ['b', 'a']]);
    const data = toGraphData(f, 600, 400);
    expect(data.edges[0]!.type).toBeUndefined();
    expect(data.edges[0]!.style).toBeUndefined();
    expect(data.edges[1]!.type).toBe('quadratic');
    expect(data.edges[2]!.type).toBe('quadratic');
    const offs = [data.edges[1]!.style!.curveOffset, data.edges[2]!.style!.curveOffset];
    expect(offs).toEqual([30, -30]); // 方向无关：b→a 也算同一对
  });

  it('不同节点对不受影响（单条关系还是直线）', () => {
    const f = full([{ id: 'a' }, { id: 'b' }, { id: 'c' }], [['a', 'b'], ['b', 'c']]);
    const data = toGraphData(f, 600, 400);
    expect(data.edges.every((e) => e.type === undefined)).toBe(true);
  });

  it('关系词仍逐条下发（平行边不得合并丢词）', () => {
    const f = full([{ id: 'a' }, { id: 'b' }], [['a', 'b', true], ['a', 'b']]);
    const data = toGraphData(f, 600, 400);
    expect(data.edges.map((e) => [e.data.relation, e.data.causal])).toEqual([
      ['导致', true],
      ['使用', false],
    ]);
  });
});
