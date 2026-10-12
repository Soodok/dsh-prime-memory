/**
 * 人工打分对**指标**的影响（成熟度合成 + 召回排序）——用户口径：
 *   0/1/2 按一定方式拉低，4/5 抬高，3 中性，-1 走退场不再计一次罚。
 *
 * 钉住三件容易在后续调参时被悄悄破坏的事：
 *   1. **未打分逐字等于旧行为**（加性项贡献 0），否则所有既有成熟度断言与线上档位都会漂；
 *   2. 排序是**纯重排**：score 不被改写、同档内保持进入顺序（不推翻围栏/场景细排）；
 *   3. 判据是**最近一笔**而非均值：先 5 后 0 必须下沉（否则"改主意"这条路不存在）。
 */
import { describe, expect, it } from 'vitest';
import { computeMaturity, markSignal, maturityScore } from '../src/util/maturity.js';
import { sortByHumanMark } from '../src/domain-gate.js';

describe('markSignal — 打分到人工信号', () => {
  it('0/1/2 为负且依次递增、4/5 为正、3 与未打分与 -1 为中性', () => {
    expect(markSignal(0)).toBe(-1);
    expect(markSignal(1)).toBe(-0.7);
    expect(markSignal(2)).toBe(-0.4);
    expect(markSignal(3)).toBe(0);
    expect(markSignal(4)).toBe(0.5);
    expect(markSignal(5)).toBe(1);
    expect(markSignal(-1)).toBe(0);
    expect(markSignal(undefined)).toBe(0);
    expect(markSignal(null)).toBe(0);
    // 正侧只有两档（4 半、5 满），负侧分三档渐次加重（2 轻罚、1 中、0 重罚）：
    // 不相关是一个需要区分程度的否定，认可则不必分那么细。
    expect(markSignal(4)).toBe(0.5);
    expect(Math.abs(markSignal(2)!)).toBeLessThan(0.5);
    expect(Math.abs(markSignal(1)!)).toBeGreaterThan(Math.abs(markSignal(2)!));
    expect(Math.abs(markSignal(0)!)).toBeGreaterThan(Math.abs(markSignal(1)!));
    expect(markSignal(2)).toBeGreaterThan(markSignal(0));
    expect(markSignal(1)).toBeGreaterThan(markSignal(0));
  });
});

describe('computeMaturity — 打分参与成熟度', () => {
  const base = { priority: 60, usage: { used: 2 }, agingWeight: 1 };

  it('未打分/3 分/-1 分 → 分值与旧口径逐字相等', () => {
    const legacy = maturityScore(base);
    expect(maturityScore({ ...base, mark: undefined })).toBe(legacy);
    expect(maturityScore({ ...base, mark: 3 })).toBeCloseTo(legacy, 10);
    expect(maturityScore({ ...base, mark: -1 })).toBeCloseTo(legacy, 10);
  });

  it('单调：0 < 1 < 2 < 3 ≤ 未打分 < 4 < 5', () => {
    const s = (mark: number | undefined): number => maturityScore({ ...base, mark });
    expect(s(0)).toBeLessThan(s(1)!);
    expect(s(1)).toBeLessThan(s(2)!);
    expect(s(2)).toBeLessThan(s(3)!);
    expect(s(3)).toBe(s(undefined));
    expect(s(3)).toBeLessThan(s(4)!);
    expect(s(4)).toBeLessThan(s(5)!);
  });

  it('低分能把 high 打下来、高分能把 low 抬上去（档位真的会动）', () => {
    // 强先验：high（.36+.3+.25=.91）
    const strong = { priority: 80, usage: { used: 5 }, agingWeight: 1 };
    expect(computeMaturity({ ...strong, mark: undefined })).toBe('high');
    expect(computeMaturity({ ...strong, mark: 0 })).toBe('mid'); // .91-.3=.61
    // 弱记录：low（.09+0+.15=.24）
    const weak = { priority: 20, usage: { used: 0 }, agingWeight: 0.6 };
    expect(computeMaturity({ ...weak, mark: undefined })).toBe('low');
    expect(computeMaturity({ ...weak, mark: 5 })).toBe('mid'); // .24+.3=.54
  });

  it('钳制在 0..1：0 分不能把分值压成负数，5 分不能越过 1', () => {
    expect(maturityScore({ priority: 0, usage: null, agingWeight: 0.5, mark: 0 })).toBe(0);
    expect(maturityScore({ priority: 100, usage: { used: 99 }, agingWeight: 1, mark: 5 })).toBe(1);
  });
});

describe('sortByHumanMark — 打分参与召回排序', () => {
  const hits = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('高分上浮、低分下沉，未打分保持中性原序', () => {
    const mark = (id: string): number | undefined => (id === 'd' ? 5 : id === 'a' ? 0 : undefined);
    expect(sortByHumanMark(hits, mark).map((h) => h.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('同档内保持进入顺序（稳定，不推翻上游围栏/场景细排的结果）', () => {
    const mark = (id: string): number | undefined => (id === 'a' || id === 'c' ? 4 : undefined);
    expect(sortByHumanMark(hits, mark).map((h) => h.id)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('全部未打分 → 与输入逐字同序（默认开也不改变现状）', () => {
    expect(sortByHumanMark(hits, () => undefined)).toEqual(hits);
  });

  it('3 分与未打分同档，不产生任何位移', () => {
    expect(sortByHumanMark(hits, (id) => (id === 'b' ? 3 : undefined)).map((h) => h.id))
      .toEqual(['a', 'b', 'c', 'd']);
  });

  it('0/1/2 之间也要分层：越不被认可越靠后', () => {
    const mark = (id: string): number | undefined =>
      ({ a: 2, b: 1, c: 0 } as Record<string, number>)[id];
    expect(sortByHumanMark(hits, mark).map((h) => h.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('不改写 score（只重排，排序分留给原口径）', () => {
    const scored = [{ id: 'a', score: 9 }, { id: 'b', score: 1 }];
    const out = sortByHumanMark(scored, (id) => (id === 'b' ? 5 : undefined));
    expect(out.map((h) => h.id)).toEqual(['b', 'a']);
    expect(out.find((h) => h.id === 'a')!.score).toBe(9);
    expect(out.find((h) => h.id === 'b')!.score).toBe(1);
  });

  it('判据是最近一笔：先 5 后 0 的记录应当下沉（均值口径下这条路会被堵死）', () => {
    const marks: Record<string, number> = { a: 5, b: 0 };
    const first = sortByHumanMark(hits, (id) => marks[id]).map((h) => h.id);
    expect(first).toEqual(['a', 'c', 'd', 'b']);
    // 用户改主意：a 打 0、b 打 5
    marks.a = 0;
    marks.b = 5;
    expect(sortByHumanMark(hits, (id) => marks[id]).map((h) => h.id)).toEqual(['b', 'c', 'd', 'a']);
  });
});
