/**
 * G1 usageScenario 门控回归：off 态抽取系统提示逐字不变（零漂移），
 * on 态仅追加一段指令（off 是 on 的前缀）；hitToUiRecord 从保留键带出。
 */
import { describe, expect, it } from 'vitest';
import { getExtractMemoriesSystemPrompt } from '../src/prompts/l1-extraction.js';
import { hitToUiRecord } from '../src/stats.js';
import { sortByUsageScenario } from '../src/domain-gate.js';

describe('G1 usageScenario 门控', () => {
  for (const mode of ['auto', 'work', 'chat'] as const) {
    it(`off 态系统提示 === 无 opts 调用（${mode}）`, () => {
      expect(getExtractMemoriesSystemPrompt(mode, { usageScenario: false })).toBe(getExtractMemoriesSystemPrompt(mode));
    });
    it(`on 态追加 usageScenario 指令且 off 是其前缀（${mode}）`, () => {
      const off = getExtractMemoriesSystemPrompt(mode);
      const on = getExtractMemoriesSystemPrompt(mode, { usageScenario: true });
      expect(on).toContain('usageScenario');
      expect(on.startsWith(off)).toBe(true);
      expect(on.length).toBeGreaterThan(off.length);
    });
  }

  it('hitToUiRecord 从 metadata.dsh_usage_scenario 带出；无键 → undefined', () => {
    const base = { id: 'x', content: 'c', type: 'work_fact', scene_name: 's' };
    expect(hitToUiRecord({ ...base, metadata: { dsh_usage_scenario: ['改配置时'] } } as never).usageScenario).toEqual(['改配置时']);
    expect(hitToUiRecord(base as never).usageScenario).toBeUndefined();
  });
});

describe('G1b sortByUsageScenario（纯函数细排）', () => {
  const hits = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('命中查询场景词的记忆上浮，未命中保持相对原序', () => {
    const sc = (id: string) => (id === 'c' ? ['deploy k8s'] : []);
    const out = sortByUsageScenario(hits, sc, 'deploy now').map((h) => h.id);
    expect(out[0]).toBe('c');
    expect(out.slice(1)).toEqual(['a', 'b']);
  });
  it('无查询词 → 原样返回', () => {
    expect(sortByUsageScenario(hits, () => ['x'], '  ')).toEqual(hits);
  });
  it('全部无场景 → 原序不变（fail-open）', () => {
    expect(sortByUsageScenario(hits, () => [], 'deploy').map((h) => h.id)).toEqual(['a', 'b', 'c']);
  });
  it('score 不改写（只重排）', () => {
    const scored = [{ id: 'a', score: 9 }, { id: 'b', score: 1 }];
    const out = sortByUsageScenario(scored, (id) => (id === 'b' ? ['deploy'] : []), 'deploy');
    expect(out[0]!.id).toBe('b');
    expect(out.find((h) => h.id === 'b')!.score).toBe(1);
  });
});
