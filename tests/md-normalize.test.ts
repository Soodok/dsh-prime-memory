/**
 * 正文版式归一（P4.2）与它的两条连带约束。
 *
 * 主判据是**幂等**：`f(f(x)) === f(x)`。不幂等，`renderRecord` 的产物每轮都在动，
 * 账本 `fileDigest` 就永远对不上，反向同步会一直判"文件被人改过"——那是 P2 用例
 * 钉死过的写回环，只是这次由我们自己的渲染器引入。
 */
import { describe, expect, it } from 'vitest';
import { normalizeContentMd } from '../src/util/md-normalize.js';
import { UNSORTED_DIR, renderRecord } from '../src/store/memory-md.js';
import { parseMdFile } from '../src/store/memory-md-parse.js';
import type { MemoryRecord } from '../src/types.js';

const NL = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const FENCE = String.fromCharCode(96, 96, 96);

/** 一批畸形输入：幂等性必须对每一个都成立，而不是对我挑得最顺眼的那一个。 */
const MALFORMED: readonly string[] = [
  `段落一${NL}${NL}${NL}${NL}段落二`,
  `  开头有空行${NL}${NL}正文${NL}${NL}${NL}`,
  `正文尾随空行${NL}${NL}`,
  `行尾一个空格 ${NL}下一行`,
  `硬换行保留${NL}下一段`,
  `* 星号列表${NL}+ 加号列表${NL}· 中点列表${NL}• 圆点列表${NL}- 已规范`,
  `1. 有序一${NL}2. 有序二`,
  `  # 缩进标题`,
  `${FENCE}ts${NL}  * 代码块里的星号不是列表${NL}const a = 1;  ${NL}${FENCE}`,
  `${FENCE}${NL}未闭合的围栏${NL}`,
  `  带 tab 缩进${NL}${TAB}代码风段落`,
];

function rec(extra: Partial<MemoryRecord> = {}): MemoryRecord {
  const t = Date.parse('2026-10-12T00:00:00Z');
  return {
    id: 'r1', content: '正文', type: 'work_fact', priority: 60, scene_name: 's',
    timestamps: [t], createdAt: t, updatedAt: t, name: 'r1', ...extra,
  };
}

describe('normalizeContentMd 幂等', () => {
  it.each(MALFORMED.map((s, i) => [i, s]))('#%i 两轮归一逐字相同', (_i, s) => {
    const once = normalizeContentMd(s);
    expect(normalizeContentMd(once)).toBe(once);
  });

  it('CRLF 与裸 CR 都归一成 LF，且 BOM 吃掉', () => {
    const crlf = `甲${String.fromCharCode(13)}${NL}乙${String.fromCharCode(13)}`;
    expect(normalizeContentMd(`\uFEFF${crlf}`)).toBe(`甲${NL}乙`);
  });

  it('无末尾换行（渲染器自己补），首尾空行都剪掉', () => {
    const out = normalizeContentMd(`${NL}${NL}正文${NL}${NL}`);
    expect(out).toBe('正文');
    expect(out.endsWith(NL)).toBe(false);
  });
});

describe('normalizeContentMd 版式规则', () => {
  it('连续 2 个以上空行压成一个（段落间距统一）', () => {
    expect(normalizeContentMd(`甲${NL}${NL}${NL}${NL}乙`)).toBe(`甲${NL}${NL}乙`);
  });

  it('行尾单个空格去掉，两个空格保留（那是 markdown 硬换行，不是噪音）', () => {
    const one = normalizeContentMd(`甲 `);
    const two = normalizeContentMd(`甲  `);
    const three = normalizeContentMd(`甲   `);
    expect(one).toBe('甲');
    expect(two).toBe('甲  ');
    expect(three).toBe('甲  ');
  });

  it('尾随 tab 一律去掉（tab 不承担硬换行语义）', () => {
    expect(normalizeContentMd(`甲${TAB}`)).toBe('甲');
  });

  it('四种无序符号统一成 `- `，缩进层级保留', () => {
    expect(normalizeContentMd(`* 甲${NL}+ 乙${NL}· 丙${NL}• 丁`)).toBe(`- 甲${NL}- 乙${NL}- 丙${NL}- 丁`);
    expect(normalizeContentMd(`  * 子项`)).toBe('  - 子项');
  });

  it('有序列表号一字不动（1./2./3. 自带语义顺序，重排就是改内容）', () => {
    expect(normalizeContentMd(`3. 第三步${NL}1. 第一步`)).toBe(`3. 第三步${NL}1. 第一步`);
  });

  it('代码块内逐字保留：星号、行尾双空格、围栏行本身都不动', () => {
    const inside = `  * 不是列表${NL}const a = 1;  `;
    const doc = `${FENCE}ts${NL}${inside}${NL}${FENCE}`;
    expect(normalizeContentMd(doc)).toBe(doc);
  });

  it('未闭合围栏不崩；后面的行按 CommonMark 当作代码逐字保留', () => {
    // 人在文件里漏写一个闭合围栏时，markdown 渲染器就是把余下全部内容当代码——归一器必须
    // 与渲染器同一个读法，否则“文件里看到的”与“库里存的”会不一致。
    expect(normalizeContentMd(`${FENCE}${NL}没闭合${NL}* 当代码保留`)).toBe(`${FENCE}${NL}没闭合${NL}* 当代码保留`);
  });

  it('标题行的前导空白去掉；列表项里的 # 不算标题', () => {
    expect(normalizeContentMd('  # 标题')).toBe('# 标题');
    expect(normalizeContentMd('  - # 这不是标题')).toBe('  - # 这不是标题');
  });

  it('纯散文不被改成列表（版式归一不做语义改写）', () => {
    const prose = '因为镜像有同步延迟，所以上行必须走官方地址。';
    expect(normalizeContentMd(prose)).toBe(prose);
  });
});

describe('与投射层的接缝', () => {
  it('renderRecord 的正文是归一后的形状，且往返一致（P2 的性质在标准化后仍成立）', () => {
    const messy = `上行必须走官方地址${NL}${NL}${NL}因为镜像有同步延迟 `;
    const { text } = renderRecord(rec({ content: messy }));
    const parsed = parseMdFile(text);
    expect(parsed?.content).toBe(normalizeContentMd(messy));
    // 再渲染一次：文件逐字相同 ⇒ 账本 fileDigest 不抖
    expect(renderRecord(rec({ content: parsed!.content })).text).toBe(text);
  });

  it('词表外的 type 落进默认类目录，但 frontmatter 里的 type 保持原值', () => {
    const { relPath, text } = renderRecord(rec({ type: 'legacy_kind' }));
    expect(relPath.startsWith(`${UNSORTED_DIR}/`)).toBe(true);
    expect(UNSORTED_DIR).toBe('unclassified');
    // 目录是投影、字段是事实：不许把我们的猜测写成记录的原值
    expect(text).toContain('type: "legacy_kind"');
    expect(text).not.toContain('type: "unclassified"');
  });
});
