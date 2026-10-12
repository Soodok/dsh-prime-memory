/**
 * 投射文件解析（P2 读侧）。
 *
 * 钉住的不是"能解析"，而是**不接受我们从不产出的形状**：那些形状一旦被我猜成一条记录，
 * 就会顺着回灌路径写进库里。所以一半以上的用例是负例。
 */
import { describe, expect, it } from 'vitest';
import { parseMdFile } from '../src/store/memory-md-parse.js';
import { renderRecord } from '../src/store/memory-md.js';
import type { MemoryRecord } from '../src/types.js';

function rec(extra: Partial<MemoryRecord> = {}): MemoryRecord {
  const t = Date.parse('2026-10-12T00:00:00Z');
  return {
    id: 'r1',
    content: '上行必须走官方地址\n因为镜像有同步延迟',
    type: 'work_fact',
    priority: 60,
    scene_name: 's',
    timestamps: [t],
    createdAt: t,
    updatedAt: t,
    name: '官方地址上行',
    ...extra,
  };
}

describe('parseMdFile', () => {
  it('能读回我们自己渲染出去的东西（往返一致）', () => {
    const r = rec({ extKey: 'ext-1', metadata: { dsh_usage_scenario: ['发版前', '配置 registry 时'] } });
    const p = parseMdFile(renderRecord(r).text);
    expect(p).toBeDefined();
    expect(p?.name).toBe('官方地址上行');
    expect(p?.type).toBe('work_fact');
    expect(p?.priority).toBe(60);
    expect(p?.content).toBe(r.content);
    expect(p?.usageScenario).toEqual(['发版前', '配置 registry 时']);
    expect(p?.extKey).toBe('ext-1');
    expect(p?.retired).toBe(false);
  });

  it('CRLF 与 BOM 都吃得下（记事本改一行就会引入）', () => {
    const text = renderRecord(rec()).text.replace(/\n/g, '\r\n');
    expect(parseMdFile(`\uFEFF${text}`)?.content).toContain('镜像有同步延迟');
  });

  it('缺尾换行不影响正文', () => {
    const text = renderRecord(rec()).text.replace(/\s+$/, '');
    expect(parseMdFile(text)?.content).toBe('上行必须走官方地址\n因为镜像有同步延迟');
  });

  it('正文里的 markdown 结构原样保留（不吞列表、不吞代码块）', () => {
    const body = '- 第一项\n- 第二项\n\n```ts\nconst a = 1;\n```';
    const p = parseMdFile(renderRecord(rec({ content: body })).text);
    expect(p?.content).toBe(body);
  });

  it('没有 frontmatter 的普通 md → undefined（那是别人的文件，不是投射）', () => {
    expect(parseMdFile('# 标题\n\n正文\n')).toBeUndefined();
  });

  it('frontmatter 未闭合 → undefined', () => {
    expect(parseMdFile('---\nname: "x"\n正文没有分隔符')).toBeUndefined();
  });

  it('正文为空 → undefined（清空正文不该被回灌成一条空记忆）', () => {
    expect(parseMdFile('---\nname: "x"\ntype: "work_fact"\n---\n\n')).toBeUndefined();
  });

  it('值不是合法 JSON 时退回原始字符串，不抛也不丢整条', () => {
    const p = parseMdFile('---\nname: bare-value\ntype: "work_fact"\n---\n正文\n');
    expect(p?.name).toBe('bare-value');
  });

  it('usageScenario 不是数组时给空数组，不把垃圾塞进检索轴', () => {
    const p = parseMdFile('---\nname: "x"\nusageScenario: 不是数组\n---\n正文\n');
    expect(p?.usageScenario).toEqual([]);
  });

  it('retired: true 认得出（.disable 通道靠它表达意图）', () => {
    const p = parseMdFile('---\nname: "x"\nretired: true\n---\n正文\n');
    expect(p?.retired).toBe(true);
  });

  it('priority 非法值回落到 60，不让 NaN 进库', () => {
    const p = parseMdFile('---\nname: "x"\npriority: abc\n---\n正文\n');
    expect(p?.priority).toBe(60);
  });
});
