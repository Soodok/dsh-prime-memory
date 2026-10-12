/**
 * `deriveName` / `normalizeName`（P0-b：文件身份名的形状规则）。
 *
 * 名字直接当 `<root>/<type>/<name>.memory.md` 的文件名用，所以它的纪律**必须是**
 * `sanitizeFilename` 那一套（非法字符、Windows 保留设备名、stem 超长）——自己另写
 * 一份正则迟早和它漂移，漂移的后果是"库里存的名字写不出文件"。
 * 这里因此既测业务规则（取首行、截断、剥 markdown 前缀），也测那几条平台雷。
 */
import { describe, expect, it } from 'vitest';
import { NAME_MAX, deriveName, normalizeName } from '../src/util/md-name.js';

describe('deriveName', () => {
  it('取首个非空行，跳过 markdown 的前缀符号', () => {
    expect(deriveName('上行必须走官方地址\n因为镜像有同步延迟')).toBe('上行必须走官方地址');
    expect(deriveName('\n\n  # 标题式开头\n正文')).toBe('标题式开头');
    expect(deriveName('- 列表式记忆')).toBe('列表式记忆');
    expect(deriveName('> 引用式开头')).toBe('引用式开头');
  });

  it('截断到 NAME_MAX，且不会留尾部悬空分隔符', () => {
    const long = `${'记忆'.repeat(40)}\n第二行`;
    const n = deriveName(long);
    expect(n.length).toBeLessThanOrEqual(NAME_MAX);
    expect(n).not.toMatch(/[-_.]$/);
  });

  it('洗掉文件名非法字符（走 sanitizeFilename 的白名单）', () => {
    expect(deriveName('a/b\\c:d*e?f"g<h>i|j')).not.toMatch(/[/\\:*?"<>|]/);
    // 截断发生在洗**之前**（先取前 24 字再过字符纪律），所以尾部可能被切掉半截词；
    // 连续分隔符折叠后不余悬空横线。这两条都是故意选择，不是巧合。
    expect(deriveName('pnpm install --frozen-lockfile')).toBe('pnpm-install-frozen-lo');
  });

  it('Windows 保留设备名加前缀避让（CON.md 仍会命中设备语义）', () => {
    // 保留名判定不转小写（`CON` 与 `con` 都是设备名），故前缀后保留原大小写。
    expect(deriveName('CON')).toBe('_CON');
    expect(deriveName('nul')).toBe('_nul');
  });

  it('无可用文字时返回空串，**不**编一个看起来像名字的东西', () => {
    expect(deriveName('')).toBe('');
    expect(deriveName('   \n  \n')).toBe('');
    expect(deriveName('！！！')).toBe('');
    expect(deriveName('---')).toBe('');
  });

  it('CJK 与中英混排原样保留（白名单含汉字区，不该被洗成一串横线）', () => {
    expect(deriveName('DSH 宿主 0.2.0-rc.2 的 shell 能力缝')).toContain('宿主');
  });
});

describe('normalizeName（人给的改名入参）', () => {
  it('空串与超长都直接拒', () => {
    expect(normalizeName('')).toEqual({ ok: false, reason: 'empty' });
    expect(normalizeName('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(normalizeName('x'.repeat(NAME_MAX * 2 + 1))).toEqual({ ok: false, reason: 'too-long' });
  });

  it('含非法字符时**不静默洗掉**，而是报 illegal-chars（人以为改成了 A，实际存成 B 更糟）', () => {
    expect(normalizeName('bad/name')).toEqual({ ok: false, reason: 'illegal-chars' });
    expect(normalizeName('有 空格')).toEqual({ ok: false, reason: 'illegal-chars' });
  });

  it('全标点这类"洗完就空"的输入报 no-usable-char', () => {
    expect(normalizeName('!!!')).toEqual({ ok: false, reason: 'no-usable-char' });
  });

  it('合法名字原样通过，并返回归一后的值', () => {
    expect(normalizeName('pnpm-hoisted')).toEqual({ ok: true, name: 'pnpm-hoisted' });
    expect(normalizeName('上行必须走官方地址')).toEqual({ ok: true, name: '上行必须走官方地址' });
  });

  it('与 deriveName 一致：蒸馏出来的名字一定过得了 normalizeName（两条路不能互斥）', () => {
    const derived = deriveName('反刍计数没有持久化\n第二轮又回到 12/20');
    expect(derived.length).toBeGreaterThan(0);
    expect(normalizeName(derived)).toEqual({ ok: true, name: derived });
  });
});
