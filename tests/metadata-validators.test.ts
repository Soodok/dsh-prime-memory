/**
 * metadata 枚举校验器单元测试(单一事实源)。
 *
 * 重点验证三套枚举的**正交性**:Wing(生活域)与认知 hall(类型轴)值域不相交,
 * 校验器必须双向拒绝对方的值 —— 历史上 Wing 侧零校验导致认知 hall 值可能被写进
 * `metadata.hall`,污染生活域轴。
 */
import { describe, expect, it } from 'vitest';
import { COGNITIVE_HALLS, isCognitiveHall, isRoomSlug, isTag, isWingId, normTags, normUsageScenario } from '../src/metadata-validators.js';
import { WING_CATALOG, WING_FALLBACK } from '../src/types.js';

describe('isWingId', () => {
  it('8 个生活域 + general 兜底全部通过', () => {
    for (const w of WING_CATALOG) expect(isWingId(w.id)).toBe(true);
    expect(isWingId(WING_FALLBACK)).toBe(true);
    expect(WING_FALLBACK).toBe('general');
    expect(WING_CATALOG).toHaveLength(8);
  });

  it('拒绝认知 hall 的值(正交性,Wing 侧方向的验证)', () => {
    for (const h of COGNITIVE_HALLS) expect(isWingId(h)).toBe(false);
  });

  it('拒绝大小写变体、空白、空串与非字符串', () => {
    expect(isWingId('WORK')).toBe(false);
    expect(isWingId(' work')).toBe(false);
    expect(isWingId('work ')).toBe(false);
    expect(isWingId('')).toBe(false);
    expect(isWingId('general ')).toBe(false);
    expect(isWingId(1)).toBe(false);
    expect(isWingId(null)).toBe(false);
    expect(isWingId(undefined)).toBe(false);
    expect(isWingId({})).toBe(false);
    expect(isWingId(['work'])).toBe(false);
  });
});

describe('isCognitiveHall(自 cognitive-hall 统一出口)', () => {
  it('五个认知 hall 全部通过,并拒绝 Wing 的值(正交性,反向验证)', () => {
    for (const h of COGNITIVE_HALLS) expect(isCognitiveHall(h)).toBe(true);
    for (const w of WING_CATALOG) expect(isCognitiveHall(w.id)).toBe(false);
    expect(isCognitiveHall(WING_FALLBACK)).toBe(false);
  });
});

describe('isTag', () => {
  it('接受合法 slug', () => {
    expect(isTag('graphql-switch')).toBe(true);
    expect(isTag('a')).toBe(true);
    expect(isTag('a1')).toBe(true);
    expect(isTag('x'.repeat(32))).toBe(true);
  });

  it('拒绝大写(须先归一)、前导连字符、下划线、空格与超长', () => {
    expect(isTag('GraphQL')).toBe(false);
    expect(isTag('-bad')).toBe(false);
    expect(isTag('under_score')).toBe(false);
    expect(isTag('has space')).toBe(false);
    expect(isTag('x'.repeat(33))).toBe(false);
    expect(isTag('')).toBe(false);
    expect(isTag(42)).toBe(false);
  });
});

describe('normTags', () => {
  it('保留两级 room slug(归类写回的 hall/minor 标签不得被洗掉)', () => {
    expect(isRoomSlug('dsh-plugin/merge')).toBe(true);
    expect(normTags(['dsh-plugin/merge', 'graphql'])).toEqual(['dsh-plugin/merge', 'graphql']);
    expect(normTags(['a/b/c', 'ok'])).toEqual(['ok']); // 三级仍拒
  });
  it('trim + 转小写 + 去重,保留首次出现顺序', () => {
    expect(normTags([' GraphQL ', 'graphql', 'MIGRATION'])).toEqual(['graphql', 'migration']);
  });

  it('过滤非法项与非字符串项', () => {
    expect(normTags(['ok-tag', 'Has Space', '-lead', '', 42, null, {}, 'also-ok'])).toEqual(['ok-tag', 'also-ok']);
  });

  it('按 max 截断(默认 3)', () => {
    expect(normTags(['t1', 't2', 't3', 't4', 't5'])).toEqual(['t1', 't2', 't3']);
    expect(normTags(['t1', 't2', 't3', 't4'], 2)).toEqual(['t1', 't2']);
    expect(normTags(['t1'], 0)).toEqual([]);
  });

  it('非数组输入一律返回空数组(不抛)', () => {
    expect(normTags(undefined)).toEqual([]);
    expect(normTags(null)).toEqual([]);
    expect(normTags('single')).toEqual([]);
    expect(normTags(42)).toEqual([]);
    expect(normTags({ tags: ['a'] })).toEqual([]);
  });

  it('去重发生在截断之前(不然会因重复项浪费配额)', () => {
    expect(normTags(['a', 'a', 'a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c']);
  });
});

describe('normUsageScenario (G1)', () => {
  it('保留自然语言短语(不做 slug 字符集校验)，trim + 去重 + 默认≤ 3', () => {
    expect(normUsageScenario([' 修改 profile 时', '重启服务前', '改依赖后', '第四条'])).toEqual([
      '修改 profile 时',
      '重启服务前',
      '改依赖后',
    ]);
  });
  it('非数组/空一律 []（缺字段中性，不抛）', () => {
    expect(normUsageScenario(undefined)).toEqual([]);
    expect(normUsageScenario(null)).toEqual([]);
    expect(normUsageScenario('single')).toEqual([]);
    expect(normUsageScenario([])).toEqual([]);
  });
  it('过滤空串/非字符串项，单条长度钳制≤ 60', () => {
    const long = 'x'.repeat(100);
    const out = normUsageScenario(['', long, 42, 'ok']);
    expect(out[0]).toHaveLength(60);
    expect(out).toContain('ok');
    expect(out).not.toContain('');
  });
});
