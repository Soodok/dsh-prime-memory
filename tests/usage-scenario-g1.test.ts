/**
 * G1 usageScenario 门控回归：off 态抽取系统提示逐字不变（零漂移），
 * on 态仅追加一段指令（off 是 on 的前缀）；hitToUiRecord 从保留键带出。
 */
import { describe, expect, it } from 'vitest';
import { getExtractMemoriesSystemPrompt } from '../src/prompts/l1-extraction.js';
import { hitToUiRecord } from '../src/stats.js';

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
