/**
 * 邻域态几何层（graph-ego-layout）验收面——四个显示缺陷的共同根因层，逐条钉住：
 * ① 同对节点多条关系 → 合并成一个邻居、关系词全留、key 天然唯一；
 * ② 环半径随邻居数/标签宽度自适应，同带相邻点的弦长必须容得下最宽标签（不压字）；
 * ③ 标签按角度分锚点（右侧 start / 左侧 end / 正上正下 middle 外推）；
 * ④ 因果边末端让出箭头位，且线段两端都不落进圆里（方向才读得出）。
 */
import { describe, expect, it } from 'vitest';
import {
  EGO_ARROW_GAP,
  EGO_CENTER_R,
  EGO_NEIGHBOR_R,
  EGO_RING_MAX,
  EGO_RING_MIN,
  EGO_STAGGER_BAND,
  clipName,
  egoLayout,
  groupNeighbors,
  labelWidth,
  type RawNeighbor,
} from '../client/src/tabs/graph-ego-layout.js';

function nb(id: string, relation: string, opts: Partial<RawNeighbor> = {}): RawNeighbor {
  return { id, name: opts.name ?? `节点-${id}`, type: opts.type ?? 'tool', relation, causal: opts.causal ?? false };
}

const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);

describe('groupNeighbors（重复 key 与丢关系的根因）', () => {
  it('同 id 多条关系并成一个邻居，关系词按出现序全留、去重', () => {
    const g = groupNeighbors([nb('a', '取代', { causal: true }), nb('b', '相关'), nb('a', '导致', { causal: true }), nb('a', '取代')]);
    expect(g).toHaveLength(2);
    expect(g[0]!.id).toBe('a');
    expect(g[0]!.relations).toEqual(['取代', '导致']);
  });

  it('首次出现顺序即服务端排序序（因果→度数→新度），不重排', () => {
    const g = groupNeighbors([nb('x', '使用'), nb('y', '相关'), nb('z', '修复了', { causal: true })]);
    expect(g.map((e) => e.id)).toEqual(['x', 'y', 'z']);
  });

  it('任一条关系是因果边即整体判因果（箭头与强调色按邻居给）', () => {
    const g = groupNeighbors([nb('a', '相关'), nb('a', '导致', { causal: true })]);
    expect(g[0]!.causal).toBe(true);
  });

  it('空输入 → 空数组（渲染层据此只画中心）', () => {
    expect(groupNeighbors([])).toEqual([]);
  });
});

describe('标签宽度估算', () => {
  it('CJK 满宽、latin 半宽：同字符数下中文标签明显更宽', () => {
    expect(labelWidth('上下文压缩插件')).toBeGreaterThan(labelWidth('abcdefg'));
    expect(labelWidth('上下文压缩插件')).toBeCloseTo(7 * 11, 1);
  });

  it('超 8 字截断加省略号（与径向卡旧口径一致）', () => {
    expect(clipName('一二三四五六七八九')).toBe('一二三四五六七八…');
    expect(clipName('短')).toBe('短');
  });
});

describe('egoLayout 环半径自适应（压字问题的正面判据）', () => {
  it('邻居少时取下限；错带也不够容时才真放大环（n=20 长中文名）', () => {
    const few = egoLayout(3, ['甲', '乙', '丙']);
    const many = egoLayout(20, Array.from({ length: 20 }, () => '上下文压缩插件名'));
    expect(few.ring).toBe(EGO_RING_MIN);
    // 同带 10 点、最宽标签≈94.6 ⇒ 弦长要 ≥ 94.6 就得把环从 120 撑大
    expect(many.ring).toBeGreaterThan(EGO_RING_MIN);
    expect(many.ring).toBeLessThanOrEqual(EGO_RING_MAX);
    const widest = labelWidth(clipName('上下文压缩插件名'));
    const band0 = many.pts.filter((_, i) => i % 2 === 0);
    expect(dist(band0[0]!.x, band0[0]!.y, band0[1]!.x, band0[1]!.y)).toBeGreaterThanOrEqual(widest);
  });

  it('n≥8 启用错带，奇偶点半径差 = 错带量（角向拥挤度减半）', () => {
    const l = egoLayout(10, Array.from({ length: 10 }, (_, i) => `n${i}`));
    expect(l.staggered).toBe(true);
    expect(l.pts[1]!.radius - l.pts[0]!.radius).toBeCloseTo(EGO_STAGGER_BAND, 1);
    expect(l.pts[2]!.radius).toBeCloseTo(l.pts[0]!.radius, 1);
  });

  it('同带相邻点的弦长容得下最宽标签（这条挂了就会重新压字）', () => {
    const names = Array.from({ length: 12 }, () => '上下文压缩插件');
    const l = egoLayout(12, names);
    const widest = Math.max(...names.map((s) => labelWidth(clipName(s))));
    const band0 = l.pts.filter((_, i) => i % 2 === 0);
    for (let i = 0; i < band0.length; i++) {
      const a = band0[i]!;
      const b = band0[(i + 1) % band0.length]!;
      expect(dist(a.x, a.y, b.x, b.y)).toBeGreaterThanOrEqual(widest);
    }
  });

  it('任意两点不重合（旧版重复 key 会画到同一位置造成叠字）', () => {
    const l = egoLayout(9, Array.from({ length: 9 }, (_, i) => `m${i}`));
    for (let i = 0; i < l.pts.length; i++) {
      for (let j = i + 1; j < l.pts.length; j++) {
        expect(dist(l.pts[i]!.x, l.pts[i]!.y, l.pts[j]!.x, l.pts[j]!.y)).toBeGreaterThan(1);
      }
    }
  });

  it('同输入两次调用逐位一致（确定性：无 Math.random）', () => {
    const a = egoLayout(6, ['一', '二', '三', '四', '五', '六'], [true, false, false, true, false, false]);
    expect(a).toEqual(egoLayout(6, ['一', '二', '三', '四', '五', '六'], [true, false, false, true, false, false]));
  });

  it('n=0 → 空 pts 但画幅仍可容纳中心圆', () => {
    const l = egoLayout(0);
    expect(l.pts).toEqual([]);
    expect(l.size).toBeGreaterThan(EGO_CENTER_R * 2);
    expect(l.cx).toBeCloseTo(l.size / 2, 0);
  });
});

describe('标签锚点与画幅', () => {
  it('首点在 12 点方向且标签外推到圆上方；右侧点 start、左侧点 end', () => {
    const l = egoLayout(4, ['上', '右', '下', '左']);
    const [top, right, bottom, left] = l.pts;
    expect(top!.anchor).toBe('middle');
    expect(top!.labelY).toBeLessThan(top!.y);
    expect(right!.anchor).toBe('start');
    expect(right!.labelX).toBeGreaterThan(right!.x);
    expect(left!.anchor).toBe('end');
    expect(left!.labelX).toBeLessThan(left!.x);
    expect(bottom!.anchor).toBe('middle');
    expect(bottom!.labelY).toBeGreaterThan(bottom!.y);
  });

  it('viewBox 容得下最宽标签（左右上下四个方向都不溢出）', () => {
    const names = Array.from({ length: 8 }, () => '上下文压缩插件');
    const l = egoLayout(8, names);
    const widest = labelWidth(clipName(names[0]!));
    for (const p of l.pts) {
      const right = p.anchor === 'start' ? p.labelX + widest : p.labelX + (p.anchor === 'middle' ? widest / 2 : 0);
      const left = p.anchor === 'end' ? p.labelX - widest : p.labelX - (p.anchor === 'middle' ? widest / 2 : 0);
      expect(right).toBeLessThanOrEqual(l.size);
      expect(left).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('线段端点与因果箭头让位', () => {
  it('两端都不落进圆里：起点离中心 > 中心圆半径，终点离邻居 > 邻居圆半径', () => {
    const l = egoLayout(5, ['a', 'b', 'c', 'd', 'e']);
    for (const p of l.pts) {
      expect(dist(p.x1, p.y1, l.cx, l.cy)).toBeGreaterThan(EGO_CENTER_R);
      expect(dist(p.x2, p.y2, p.x, p.y)).toBeGreaterThan(EGO_NEIGHBOR_R);
    }
  });

  it('因果边末端比非因果多让出箭头长（箭头尖才落在圆边而非压在圆上）', () => {
    const names = ['甲', '乙'];
    const plain = egoLayout(2, names, [false, false]);
    const arrowed = egoLayout(2, names, [true, true]);
    const dPlain = dist(plain.pts[0]!.x2, plain.pts[0]!.y2, plain.pts[0]!.x, plain.pts[0]!.y);
    const dArrow = dist(arrowed.pts[0]!.x2, arrowed.pts[0]!.y2, arrowed.pts[0]!.x, arrowed.pts[0]!.y);
    expect(dArrow - dPlain).toBeCloseTo(EGO_ARROW_GAP, 1);
  });

  it('关系词落点在线段偏外处（不压中心圆、不压邻居圆）', () => {
    const l = egoLayout(3, ['a', 'b', 'c']);
    for (const p of l.pts) {
      expect(dist(p.midX, p.midY, l.cx, l.cy)).toBeGreaterThan(EGO_CENTER_R);
      expect(dist(p.midX, p.midY, p.x, p.y)).toBeGreaterThan(EGO_NEIGHBOR_R);
    }
  });
});
