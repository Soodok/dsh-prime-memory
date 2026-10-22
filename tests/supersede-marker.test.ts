/**
 * §C/退场 取代标记纯函数层单测(软删可恢复的正确性核心)。
 *
 * 覆盖三类:
 * 1. 不可变 —— `with*` / `strip*` 绝不改入参(检索命中与面板视图可能正引用同一对象)
 * 2. 零漂移 —— 无标记时不写键、`strip` 返回原引用
 * 3. 读侧从严 —— 坏标记当作"未退场"(宁可当活动记录,也不让记忆悄悄消失)
 */
import { describe, expect, it } from 'vitest';
import {
  SUPERSEDE_METADATA_KEY,
  isRetired,
  readSupersedeMarker,
  stripSupersedeMarker,
  withSupersedeMarker,
} from '../src/store/supersede.js';

const AT = '2026-09-18T12:00:00.000Z';

describe('withSupersedeMarker', () => {
  it('写入保留键且不改入参(不可变更新)', () => {
    const base = { hall: 'work' };
    const out = withSupersedeMarker(base, { at: AT, reason: 'conflict', verdict: 'winner', pairId: 'p1' });
    expect(out).toEqual({
      hall: 'work',
      [SUPERSEDE_METADATA_KEY]: { at: AT, reason: 'conflict', verdict: 'winner', pairId: 'p1' },
    });
    expect(base).toEqual({ hall: 'work' });
    expect(SUPERSEDE_METADATA_KEY in base).toBe(false);
  });

  it('metadata 缺失时不抛,产出只含标记的新对象', () => {
    const out = withSupersedeMarker(undefined, { at: AT, reason: 'manual' });
    expect(out).toEqual({ [SUPERSEDE_METADATA_KEY]: { at: AT, reason: 'manual' } });
  });

  it('可选字段缺省即不写键(空串会与"没有该字段"混淆)', () => {
    const out = withSupersedeMarker({}, { at: AT, reason: 'superseded', by: 'mem_new' });
    expect(out[SUPERSEDE_METADATA_KEY]).toEqual({ at: AT, reason: 'superseded', by: 'mem_new' });
    // 空串一律不写
    const blank = withSupersedeMarker({}, { at: AT, reason: 'conflict', verdict: '', pairId: '', by: '' });
    expect(blank[SUPERSEDE_METADATA_KEY]).toEqual({ at: AT, reason: 'conflict' });
  });
});

describe('readSupersedeMarker', () => {
  it('roundtrip:写完读回一致', () => {
    const info = { at: AT, reason: 'conflict' as const, verdict: 'loser', pairId: 'p9' };
    expect(readSupersedeMarker(withSupersedeMarker({ hall: 'work' }, info))).toEqual(info);
  });

  it('四个退场原因全部能写完读回（读侧是白名单，漏一个就静默丢标记）', () => {
    for (const reason of ['conflict', 'superseded', 'manual', 'obsolete'] as const) {
      const back = readSupersedeMarker(withSupersedeMarker({}, { at: AT, reason }));
      expect(back, `reason=${reason}`).toEqual({ at: AT, reason });
    }
  });

  it('形状校验从严:缺 at / reason 非法 → undefined', () => {
    expect(readSupersedeMarker({ [SUPERSEDE_METADATA_KEY]: { reason: 'conflict' } })).toBeUndefined();
    expect(readSupersedeMarker({ [SUPERSEDE_METADATA_KEY]: { at: '' } })).toBeUndefined();
    expect(readSupersedeMarker({ [SUPERSEDE_METADATA_KEY]: { at: AT, reason: 'nonsense' } })).toBeUndefined();
    expect(readSupersedeMarker({ [SUPERSEDE_METADATA_KEY]: { at: 123, reason: 'manual' } })).toBeUndefined();
  });

  it('非对象 / 无键 / 键值非对象 → undefined', () => {
    expect(readSupersedeMarker(undefined)).toBeUndefined();
    expect(readSupersedeMarker(null)).toBeUndefined();
    expect(readSupersedeMarker('str')).toBeUndefined();
    expect(readSupersedeMarker({})).toBeUndefined();
    expect(readSupersedeMarker({ [SUPERSEDE_METADATA_KEY]: 'not-object' })).toBeUndefined();
    expect(readSupersedeMarker({ [SUPERSEDE_METADATA_KEY]: null })).toBeUndefined();
  });

  it('缺省可选字段不写进结果(不产生空串假值)', () => {
    const got = readSupersedeMarker({ [SUPERSEDE_METADATA_KEY]: { at: AT, reason: 'manual', verdict: '' } });
    expect(got).toEqual({ at: AT, reason: 'manual' });
    expect('verdict' in (got as object)).toBe(false);
  });
});

describe('stripSupersedeMarker', () => {
  it('有标记时返回新对象且原键消失,不改入参', () => {
    const marked = withSupersedeMarker({ hall: 'work' }, { at: AT, reason: 'conflict' });
    const out = stripSupersedeMarker(marked);
    expect(SUPERSEDE_METADATA_KEY in out).toBe(false);
    expect(out).toEqual({ hall: 'work' });
    expect(SUPERSEDE_METADATA_KEY in marked).toBe(true); // 入参不动
  });

  it('零漂移:无标记时返回**原引用**(恢复对活动记录是彻底 no-op)', () => {
    const base = { hall: 'work' };
    expect(stripSupersedeMarker(base)).toBe(base);
    expect(stripSupersedeMarker(undefined)).toEqual({});
  });
});

describe('isRetired', () => {
  // 门1 解耦(expiry-tiering R1):退场判据是 marker 单源——valid_to 回归现实有效期,
  // 它闭合只说明"事实到期了"，不说明"记录退场了"。
  it('带标记 → 已退场;仅 valid_to 闭合(无标记) → 未退场', () => {
    expect(isRetired({ metadata: {} , validTo: Date.parse(AT) } as never)).toBe(false);
    expect(isRetired({ metadata: withSupersedeMarker({}, { at: AT, reason: 'manual' }) } as never)).toBe(true);
  });

  it('两者皆无 → 未退场(不得把活动记录误判为已退场)', () => {
    expect(isRetired({ metadata: {} } as never)).toBe(false);
    expect(isRetired({ metadata: undefined } as never)).toBe(false);
  });

  it('validTo=0/旧数据带退场时刻但无标记也不误判——marker 是唯一凭据', () => {
    // 旧版 retire 会写 valid_to;门1 升版回灌后那些行若未带 marker 就是普通历史记录。
    expect(isRetired({ metadata: {} , validTo: 0 } as never)).toBe(false);
  });
});
