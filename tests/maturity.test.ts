/**
 * G3 成熟度合成纯函数回归（读时派生，单一事实源）。
 * 钉住：三信号配比、阈值边界、缺 usage 不虚构、agingWeight=null 视为 1。
 */
import { describe, expect, it } from 'vitest';
import { computeMaturity, maturityScore } from '../src/util/maturity.js';

describe('computeMaturity', () => {
  it('高优先级 + 多次被用 + 新鲜 → high', () => {
    expect(computeMaturity({ priority: 90, usage: { used: 8 }, agingWeight: 1 })).toBe('high');
  });
  it('高优先级但从未被用、衰减到底 → mid（先验撑住）', () => {
    expect(computeMaturity({ priority: 90, usage: { used: 0 }, agingWeight: 0.5 })).toBe('mid');
  });
  it('低优先级 + 无使用 + 陈旧 → low', () => {
    expect(computeMaturity({ priority: 30, usage: { used: 0 }, agingWeight: 0.5 })).toBe('low');
  });
  it('缺 usage（未装配）按 0 强化，不虚构成熟度', () => {
    expect(maturityScore({ priority: 60, usage: null, agingWeight: null })).toBeCloseTo(0.45 * 0.6 + 0.25);
  });
  it('agingWeight=null 视为 1（衰减关闭不惩罚）→ 满分', () => {
    expect(maturityScore({ priority: 100, usage: { used: 5 }, agingWeight: null })).toBeCloseTo(1);
  });
  it('used 超饱和阈值不再加分（cap=5）', () => {
    expect(maturityScore({ priority: 0, usage: { used: 5 }, agingWeight: 0 })).toBeCloseTo(
      maturityScore({ priority: 0, usage: { used: 999 }, agingWeight: 0 }),
    );
  });
});
