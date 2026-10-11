/**
 * 轨3 TS 侧 memport 实现 vs Python 侧的**跨实现一致性**守卫。
 *
 * 这是"两份实现漂移"唯一的防线：不跑 Python，而是拿 Python 早已实测冻结的金标准
 * ——`templates/example.mem` 头部声明的 `sha256=af1247329ce5`（SKILL §3 / foreign-agent §3 实测）
 * ——来验 TS 的包级校验和复算：TS 若与 Python 对同一 body 行 `\n` join 后 sha256 一致，
 * 则解析取体（哪些行算 body）与哈希口径必然对齐。
 *
 * 另含 prefilter 的四桶分档行为断言（near-dup / conflict-candidate / new / dup）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contentHash, parseBundle, recordId, unescapeContent } from '../src/memport/format.js';
import { plan } from '../src/memport/prefilter.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(HERE, '..', 'skills', 'memport', 'templates', 'example.mem');
const text = readFileSync(EXAMPLE, 'utf8');

describe('MMF 解析（跨实现金标准）', () => {
  const b = parseBundle(text);

  it('example.mem 结构校验零 error，且包级 sha256 复算命中金标准 af1247329ce5', () => {
    // 若 TS 的 body 取体或 sha 口径与 Python 有差，parseBundle 会写入"校验和不符"error。
    expect(b.errors).toEqual([]);
    expect(b.declaredSha).toBe('af1247329ce5');
  });

  it('解析出 8 条记录、10 列、v1.1', () => {
    expect(b.records).toHaveLength(8);
    expect(b.cols).toEqual(['type', 'created', 'updated', 'vf', 'vt', 'st', 'cf', 'rw', 'tags', 'content']);
    expect(b.header.version).toBe('1.1');
    expect(b.header.src).toBe('trae+workbuddy');
  });

  it('type 码映射与 tags 解析正确', () => {
    expect(b.records[0]?.typeFull).toBe('instruction'); // in →
    expect(b.records[0]?.tags.key).toBe('pnpm-noninteractive');
    expect(b.records[7]?.typeFull).toBe('work_task'); // wt →
    expect(b.records[7]?.sup).toBeUndefined();
    expect(b.records[7]?.tags.sup).toBe('mem-abc123');
  });

  it('content_hash / record_id 口径稳定且格式正确', () => {
    const first = b.records[0]!;
    expect(first.hash).toBe(contentHash(first.content));
    expect(first.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(recordId('trae+workbuddy/rewrite-agently', first.hash)).toMatch(/^mp_[0-9a-f]{16}$/);
  });

  it('unescapeContent 还原 \\n 与 \\\\，但 example.mem 无转义序列时逐字不变', () => {
    const first = b.records[0]!;
    // 反引号/分号原样保留（不是转义符）
    expect(first.content).toContain('pnpm --yes');
    expect(unescapeContent('a\\\\b\\nc')).toBe('a\\b\nc');
  });
});

describe('prefilter 四桶（行为）', () => {
  const b = parseBundle(text);

  it('内容哈希命中 → dup', () => {
    const rec = b.records[0]!;
    const existing = [{ id: 'mem-x', content: rec.content, hash: rec.hash }];
    const { rows, counts } = plan([rec], existing, { srcTag: 'trae/demo' });
    expect(rows[0]?.verdict).toBe('dup');
    expect(counts.dup).toBe(1);
  });

  it('同一事实换个说法 → near-dup（≥0.62）；无关内容 → new（<0.30）', () => {
    const rec = b.records[1]!; // "执行外部命令默认按非交互策略..."
    const reworded = {
      seq: 99,
      type: 'wm',
      typeFull: 'work_method',
      content: '执行外部命令默认走非交互策略,先查 help 找 --yes/-y/--no-input/CI=1,没有可靠非交互模式就不运行',
      created: '-',
      updated: '-',
      vf: '-',
      vt: '-',
      st: 't',
      cf: '0',
      rw: '0',
      tags: {},
      hash: contentHash('执行外部命令默认走非交互策略,先查 help 找 --yes/-y/--no-input/CI=1,没有可靠非交互模式就不运行'),
      createdMs: null,
      createdPrec: 'unknown',
      updatedMs: null,
      updatedPrec: 'unknown',
      vfMs: null,
      vfPrec: 'unknown',
      vtMs: null,
      vtPrec: 'unknown',
    };
    const existing = [{ id: 'mem-y', content: rec.content, hash: rec.hash }];
    const near = plan([reworded], existing);
    expect(near.rows[0]?.verdict).toBe('near-dup');

    const unrelated = { ...reworded, content: '今天午餐吃了牛肉面', hash: contentHash('今天午餐吃了牛肉面') };
    const neu = plan([unrelated], existing);
    expect(neu.rows[0]?.verdict).toBe('new');
  });
});
