/**
 * 轨③ T3-4:type 扇区 seed 初始布局验收面。
 *
 * 钉住的性质:
 * ① 确定性——同输入两次调用逐位一致(布局不随重载漂移);
 * ② 顺序无关——坐标只由 id hash 决定,shuffle 输入后每个 id 坐标不变;
 * ③ 扇区归属——节点极角落在其 type 扇区的中段 [0.12,0.88] 分位(组间留白生效);
 * ④ 半径钳制——全部落在 [0.35R, 0.95R];
 * ⑤ 未知 type 独占末位扇区(五类扇隙不被污染,且扇区数 5→6);
 * ⑥ 空输入 → 空数组;worldRadius 按短边 0.85。
 */
import { describe, expect, it } from 'vitest';
import { seedPositions, worldRadius, type SeedInput } from '../client/src/tabs/graph-seed-layout.js';

const W = 800;
const H = 600;

const NODES: SeedInput[] = [
  { id: 'a', type: 'person' },
  { id: 'b', type: 'project' },
  { id: 'c', type: 'organization' },
  { id: 'd', type: 'tool' },
  { id: 'e', type: 'place' },
  { id: 'f', type: 'project' },
  { id: 'g', type: 'person' },
];

const SECTOR_ORDER = ['person', 'project', 'organization', 'tool', 'place'];

/** 极角归一到 [0,2π),0 = 扇区起轴(正上方 −π/2)。 */
function sectorFraction(x: number, y: number, sectors: number): { idx: number; frac: number } {
  const theta = Math.atan2(y, x) + Math.PI / 2;
  const a = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const w = (Math.PI * 2) / sectors;
  return { idx: Math.floor(a / w), frac: (a % w) / w };
}

describe('seedPositions —— 确定性与形状', () => {
  it('同输入两次调用逐位一致;空输入返回空数组', () => {
    const r1 = seedPositions(NODES, W, H);
    const r2 = seedPositions(NODES, W, H);
    expect(r1).toEqual(r2);
    expect(seedPositions([], W, H)).toEqual([]);
  });

  it('顺序无关:shuffle 输入后每个 id 的坐标不变', () => {
    const base = new Map(seedPositions(NODES, W, H).map((p) => [p.id, p]));
    const shuffled = [...NODES].reverse().concat([{ id: 'h', type: 'tool' }]).slice(0, NODES.length);
    for (const p of seedPositions(shuffled, W, H)) {
      if (base.has(p.id)) {
        expect(p.x).toBe(base.get(p.id)!.x);
        expect(p.y).toBe(base.get(p.id)!.y);
      }
    }
  });

  it('半径钳制:|p| ∈ [0.35R, 0.95R]', () => {
    const R = worldRadius(W, H);
    for (const p of seedPositions(NODES, W, H)) {
      const r = Math.hypot(p.x, p.y);
      expect(r).toBeGreaterThanOrEqual(R * 0.35 - 1e-9);
      expect(r).toBeLessThanOrEqual(R * 0.95 + 1e-9);
    }
  });
});

describe('seedPositions —— 分组语义', () => {
  it('五类节点各归其扇区,且落扇区中段 [0.12,0.88](组间留白)', () => {
    for (const p of seedPositions(NODES, W, H)) {
      const type = NODES.find((n) => n.id === p.id)!.type;
      const { idx, frac } = sectorFraction(p.x, p.y, 5);
      expect(SECTOR_ORDER[idx]).toBe(type);
      expect(frac).toBeGreaterThanOrEqual(0.12 - 1e-9);
      expect(frac).toBeLessThanOrEqual(0.88 + 1e-9);
    }
  });

  it('未知 type 走独立末位扇区:扇区数变 6,五类扇区归属不受污染', () => {
    const nodes: SeedInput[] = [...NODES, { id: 'mystery', type: 'concept' }];
    const pts = seedPositions(nodes, W, H);
    const m = pts.find((p) => p.id === 'mystery')!;
    expect(sectorFraction(m.x, m.y, 6).idx).toBe(5); // 末位专属扇区
    // 同时五类节点在 6 扇区口径下仍各归其位(扇区数变化只影响角度,不影响"同类同扇区"的相对事实)
    for (const p of pts) {
      if (p.id === 'mystery') continue;
      const type = nodes.find((n) => n.id === p.id)!.type;
      expect(SECTOR_ORDER[sectorFraction(p.x, p.y, 6).idx]).toBe(type);
    }
  });

  it('同 type 多节点必落同一扇区(a/g 皆 person)', () => {
    const pts = seedPositions(NODES, W, H);
    const ga = pts.filter((p) => p.id === 'a' || p.id === 'g');
    expect(ga.length).toBe(2);
    expect(sectorFraction(ga[0].x, ga[0].y, 5).idx).toBe(sectorFraction(ga[1].x, ga[1].y, 5).idx);
  });
});

describe('worldRadius', () => {
  it('短边一半 ×0.85(极端长短比同样按短边)', () => {
    expect(worldRadius(800, 600)).toBeCloseTo(300 * 0.85, 9);
    expect(worldRadius(200, 4000)).toBeCloseTo(100 * 0.85, 9);
  });
});
