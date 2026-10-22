/**
 * 有效性定性纯函数层单测(expiry-tiering 冻结契约 · 先行刀,对齐上游 task_1.6/1.7)。
 *
 * 覆盖四类:
 * 1. round-trip —— `with`→`read` 全字段无损(读侧是白名单,漏一个就静默丢字段)
 * 2. classify 六态 —— spec §0 判据表逐档各 1 例 + fail-open 例
 * 3. 不可变/零漂移 —— 无 state 不写键、strip 无键返原引用
 * 4. 读侧从严 —— 坏标注当作"未标注"(未标注由调用方 fail-open,不误判过时)
 */
import { describe, expect, it } from 'vitest';
import {
  VALIDITY_METADATA_KEY,
  classifyValidity,
  isExitedState,
  readValidity,
  stripValidity,
  validToSourceOf,
  withValidity,
} from '../src/store/validity.js';
import type { ValidityInfo } from '../src/store/validity.js';
import { SUPERSEDE_METADATA_KEY } from '../src/store/supersede.js';
import type { SupersedeInfo } from '../src/store/supersede.js';

const AT = '2026-10-22T12:00:00.000Z';
const NOW = Date.parse(AT);

describe('withValidity / readValidity', () => {
  it('roundtrip:全字段写完读回一致', () => {
    const info: ValidityInfo = {
      state: 'expired',
      validToSource: 'evidence',
      basis: 'persistence=o 且 valid_to≤now(证据)',
      at: AT,
      by: 'mem_new_1',
      pairId: 'p1',
      confidence: 0.9,
    };
    const out = withValidity({ hall: 'work' }, info);
    expect(out.hall).toBe('work');
    expect(readValidity(out)).toEqual(info);
  });

  it('六态全部能写完读回(读侧是白名单,漏一个就静默丢态)', () => {
    for (const state of ['current', 'historical', 'expired', 'expired_suspect', 'superseded', 'retired'] as const) {
      const back = readValidity(withValidity({}, { state, validToSource: 'unknown', basis: '', at: AT }));
      expect(back?.state, `state=${state}`).toBe(state);
    }
  });

  it('不可变:with/strip 都不改入参', () => {
    const base = { a: 1 };
    const out = withValidity(base, { state: 'current', validToSource: 'unknown', basis: '', at: AT });
    expect(base).toEqual({ a: 1 });
    expect(VALIDITY_METADATA_KEY in base).toBe(false);
    const stripped = stripValidity(out);
    expect(out).not.toBe(stripped);
    expect(VALIDITY_METADATA_KEY in out).toBe(true);
    expect(stripped).toEqual({ a: 1 });
  });

  it('有值才写键:无 state 时 metadata 字节零漂移(task_1.7)', () => {
    const base: Record<string, unknown> = { temporal: { st: 'o' } };
    const before = JSON.stringify(base);
    const noInfo = withValidity(base, undefined);
    const badState = withValidity(base, { state: 'nonsense' as ValidityInfo['state'], validToSource: 'evidence', basis: '', at: AT });
    expect(JSON.stringify(noInfo)).toBe(before);
    expect(JSON.stringify(badState)).toBe(before);
    expect(JSON.stringify(base)).toBe(before);
  });

  it('可选字段缺省即不写键;strip 无键返回原引用', () => {
    const out = withValidity({}, { state: 'current', validToSource: 'unknown', basis: '', at: AT });
    expect(out[VALIDITY_METADATA_KEY]).toEqual({ state: 'current', validToSource: 'unknown', basis: '', at: AT });
    const untouched: Record<string, unknown> = { x: 1 };
    expect(stripValidity(untouched)).toBe(untouched);
  });
});

describe('readValidity 形状校验', () => {
  it('非对象/坏 state/坏键 → undefined(当作未标注,不伪装成系统定性)', () => {
    expect(readValidity(undefined)).toBeUndefined();
    expect(readValidity(null)).toBeUndefined();
    expect(readValidity('str')).toBeUndefined();
    expect(readValidity({})).toBeUndefined();
    expect(readValidity({ [VALIDITY_METADATA_KEY]: null })).toBeUndefined();
    expect(readValidity({ [VALIDITY_METADATA_KEY]: { state: 'bogus' } })).toBeUndefined();
    expect(readValidity({ [VALIDITY_METADATA_KEY]: 'not-object' })).toBeUndefined();
  });

  it('validToSource 非法值归一为 unknown(可判疑,不可判死)', () => {
    const back = readValidity({ [VALIDITY_METADATA_KEY]: { state: 'expired', validToSource: 'web', basis: '', at: AT } });
    expect(back?.validToSource).toBe('unknown');
    expect(validToSourceOf({ [VALIDITY_METADATA_KEY]: { state: 'expired', basis: '', at: AT } })).toBe('unknown');
  });
});

describe('classifyValidity 六态判据(spec §0)', () => {
  const marker = (reason: SupersedeInfo['reason']): SupersedeInfo => ({ at: AT, reason });

  it('current:persistence=o 且无 valid_to / valid_to>now', () => {
    expect(classifyValidity({ persistence: 'o', now: NOW })).toBe('current');
    expect(classifyValidity({ persistence: 'o', validTo: NOW + 60_000, validToSource: 'evidence', now: NOW })).toBe('current');
  });

  it('historical:persistence∈{p,s,t} 未退场(哪怕 valid_to 已闭合——历史不判过时)', () => {
    expect(classifyValidity({ persistence: 'p', validTo: NOW - 1, validToSource: 'evidence', now: NOW })).toBe('historical');
    expect(classifyValidity({ persistence: 's', validTo: NOW - 1, validToSource: 'evidence', now: NOW })).toBe('historical');
    expect(classifyValidity({ persistence: 't', now: NOW })).toBe('historical');
  });

  it('expired:persistence=o 且 valid_to≤now 且来源可信(evidence)', () => {
    expect(classifyValidity({ persistence: 'o', validTo: NOW, validToSource: 'evidence', now: NOW })).toBe('expired');
  });

  it('expired_suspect:同上但来源不可信(llm_inferred/fallback_now/unknown)', () => {
    for (const src of ['llm_inferred', 'fallback_now', 'unknown'] as const) {
      expect(classifyValidity({ persistence: 'o', validTo: NOW - 1, validToSource: src, now: NOW })).toBe('expired_suspect');
    }
  });

  it('superseded / retired:marker 优先于时间轴(正交两轴,marker 是既成事实)', () => {
    expect(classifyValidity({ marker: marker('superseded'), persistence: 'o', now: NOW })).toBe('superseded');
    expect(classifyValidity({ marker: marker('conflict'), now: NOW })).toBe('superseded');
    expect(classifyValidity({ marker: marker('manual'), validTo: NOW + 1, now: NOW })).toBe('retired');
    expect(classifyValidity({ marker: marker('obsolete'), now: NOW })).toBe('retired');
  });

  it('未判定 persistence → fail-open:无 valid_to 判 current,有则判疑不判死', () => {
    expect(classifyValidity({ now: NOW })).toBe('current');
    expect(classifyValidity({ validTo: NOW - 1, validToSource: 'evidence', now: NOW })).toBe('expired_suspect');
    expect(classifyValidity({ validTo: NOW + 1, validToSource: 'evidence', now: NOW })).toBe('current');
  });

  it('非法 valid_to(NaN/0/负)当作未闭合(fail-open)', () => {
    expect(classifyValidity({ persistence: 'o', validTo: Number.NaN, now: NOW })).toBe('current');
    expect(classifyValidity({ persistence: 'o', validTo: 0, now: NOW })).toBe('current');
  });
});

describe('isExitedState / 与 supersede 标记的接缝', () => {
  it('只有退场两档算 exited;current/historical/expired/expired_suspect 都还在检索面', () => {
    expect(isExitedState('superseded')).toBe(true);
    expect(isExitedState('retired')).toBe(true);
    for (const s of ['current', 'historical', 'expired', 'expired_suspect'] as const) {
      expect(isExitedState(s)).toBe(false);
    }
  });

  it('dsh_validity 与 dsh_superseded 两键互不覆盖(命名空间隔离)', () => {
    const meta = withValidity({ [SUPERSEDE_METADATA_KEY]: { at: AT, reason: 'manual' } }, {
      state: 'retired', validToSource: 'unknown', basis: '', at: AT,
    });
    expect(readValidity(meta)?.state).toBe('retired');
    expect(SUPERSEDE_METADATA_KEY in meta).toBe(true);
  });
});
