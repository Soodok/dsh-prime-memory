/**
 * 「记忆已声明过时」待播报队列（ObsoleteNoticeStore）回归。
 *
 * 核心语义是 **outbox**：入队 → 下一轮取走 → 取走即离队。
 * 最坏的一种实现是"取走但没落盘"或"没取走"——前者重启后重复播报，后者让模型
 * 永远不知道那条已失效。所以 drain 的**一次性**与**持久化**都要钉住。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ObsoleteNoticeStore } from '../src/store/obsolete-notices.js';

let root: string;
async function fresh(): Promise<string> {
  if (!root) root = await mkdtemp(join(tmpdir(), 'dsh-notices-'));
  return join(root, `s-${Math.random().toString(36).slice(2)}`);
}
afterAll(async () => {
  await Promise.all(open.map((s) => s.flush())); // 先等在途写完成(Windows 上顶回 ENOTEMPTY)
  if (root) await rm(root, { recursive: true, force: true });
});

/** 本套件创过的 store，供 afterAll 收口。 */
const open: ObsoleteNoticeStore[] = [];
function newStore(d: string): ObsoleteNoticeStore {
  const s = new ObsoleteNoticeStore(d);
  open.push(s);
  return s;
}

const notice = (id: string, title = `标题 ${id}`, at = Date.now()): { id: string; title: string; at: number } =>
  ({ id, title, at });

describe('ObsoleteNoticeStore', () => {
  it('drain 取走即离队:第二次为空', async () => {
    const s = newStore(await fresh());
    await s.init();
    s.push('sess-1', notice('a'));
    s.push('sess-1', notice('b'));
    const first = s.drain('sess-1');
    expect(first.map((n) => n.id)).toEqual(['a', 'b']);
    expect(s.drain('sess-1')).toEqual([]);
    expect(s.size()).toBe(0);
  });

  it('会话之间互不串(播报错会话比不播报更糟)', async () => {
    const s = newStore(await fresh());
    await s.init();
    s.push('s1', notice('x'));
    s.push('s2', notice('y'));
    expect(s.drain('s1').map((n) => n.id)).toEqual(['x']);
    expect(s.peek('s2').map((n) => n.id)).toEqual(['y']);
  });

  it('同 id 重复入队去重(重复点 -1 不该多播一行)', async () => {
    const s = newStore(await fresh());
    await s.init();
    s.push('s', notice('dup'));
    s.push('s', notice('dup', '换了个标题'));
    expect(s.peek('s')).toHaveLength(1);
    expect(s.peek('s')[0]!.title).toBe('标题 dup'); // 保留首次那条
  });

  it('空 sessionKey / 未 init 的边界:静默不入队 / 明确抛错', async () => {
    const s = newStore(await fresh());
    await s.init();
    s.push('', notice('z'));
    expect(s.size()).toBe(0);
    const raw = newStore(await fresh());
    expect(() => raw.peek('s')).toThrow('未初始化');
  });

  it('标题截断到 120 + 省略号(注入正文不被一条长记忆灌爆)', async () => {
    const s = newStore(await fresh());
    await s.init();
    s.push('s', notice('long', 'x'.repeat(300)));
    const [only] = s.peek('s');
    expect(only!.title.length).toBeLessThanOrEqual(121);
    expect(only!.title.endsWith('…')).toBe(true);
  });

  it('写穿持久化:新实例载回未播报的(打 -1 后重启也不能丢掉这一笔告知)', async () => {
    const dataDir = await fresh();
    const s = newStore(dataDir);
    await s.init();
    s.push('s', notice('a', '甲'));
    await s.flush();
    const t = newStore(dataDir);
    await t.init();
    expect(t.peek('s').map((n) => n.title)).toEqual(['甲']);
    // 取走后落盘:第三次实例应为空
    t.drain('s');
    await t.flush();
    const u = newStore(dataDir);
    await u.init();
    expect(u.size()).toBe(0);
  });

  it('单会话上限 8 条,超出丢最旧', async () => {
    const s = newStore(await fresh());
    await s.init();
    for (let i = 0; i < 12; i++) s.push('s', notice(`id-${i}`, `t${i}`, 1000 + i));
    const kept = s.peek('s');
    expect(kept).toHaveLength(8);
    expect(kept[0]!.id).toBe('id-4'); // 最旧的 4 条被挤掉
  });
});
