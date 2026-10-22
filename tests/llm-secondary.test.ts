/**
 * pickSecondary 二线选路判据（R3）：按输入体量触发、未配不隐式改选。
 */
import { describe, expect, it } from 'vitest';
import { pickSecondary } from '../src/llm.js';
import type { MemoryConfig } from '../src/config.js';

function cfgWith(secondary?: Partial<NonNullable<MemoryConfig['llm']['secondary']>>): MemoryConfig {
  return {
    llm: {
      secondary: secondary === undefined ? undefined : { provider: '', model: '', triggerChars: 20_000, ...secondary },
    },
  } as unknown as MemoryConfig;
}

describe('pickSecondary', () => {
  it('二线未配 → null（不隐式改选任意模型）', () => {
    expect(pickSecondary(cfgWith(), 999_999)).toBeNull();
    expect(pickSecondary(cfgWith({ provider: '', model: 'x', triggerChars: 100 }), 999_999)).toBeNull();
    expect(pickSecondary(cfgWith({ provider: 'p', model: '', triggerChars: 100 }), 999_999)).toBeNull();
  });

  it('输入 < triggerChars → null（走一线）', () => {
    const cfg = cfgWith({ provider: 'big', model: 'cap', triggerChars: 20_000 });
    expect(pickSecondary(cfg, 19_999)).toBeNull();
  });

  it('输入 ≥ triggerChars → 命中二线', () => {
    const cfg = cfgWith({ provider: 'big', model: 'cap', triggerChars: 20_000 });
    expect(pickSecondary(cfg, 20_000)).toEqual({ provider: 'big', model: 'cap' });
    expect(pickSecondary(cfg, 50_000)).toEqual({ provider: 'big', model: 'cap' });
  });

  it('二线带 reasoningEffort 时透出', () => {
    const cfg = cfgWith({ provider: 'big', model: 'cap', reasoningEffort: 'high', triggerChars: 1000 });
    expect(pickSecondary(cfg, 2000)).toEqual({ provider: 'big', model: 'cap', reasoningEffort: 'high' });
  });

  it('triggerChars<=0 视为永不命中（防误配把小调用也上大容量档）', () => {
    const cfg = cfgWith({ provider: 'big', model: 'cap', triggerChars: 0 });
    expect(pickSecondary(cfg, 999_999)).toBeNull();
  });
});
