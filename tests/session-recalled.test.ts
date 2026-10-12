/** G-live 会话活召回集存储：owner/session 隔离、插入序去重、reset、空输入不建条、持久化往返。 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SessionRecalledStore } from '../src/store/session-recalled.js';

let dir: string;
async function dataDir(): Promise<string> {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'dsh-recalled-'));
  return dir;
}
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('SessionRecalledStore 不负责任意单条摘除（删除线的根）', () => {
  it('不提供 remove：条目只能随 reset（压缩/清空）整段离开', async () => {
    const base = await dataDir();
    const s = new SessionRecalledStore(join(base, `no-remove-${Math.random().toString(36).slice(2)}`));
    // 护栏：这个 API 上一季存在过，作用是「声明过时就把条目从列表剔掉」，
    // 后果是卡片上条目瞬时消失、用户看不出自己刚判过谁过时。不得再回来。
    expect((s as unknown as { remove?: unknown }).remove).toBeUndefined();
    s.add('s', ['a', 'b', 'c']);
    const rev = s.revision();
    expect(s.list('s')).toEqual(['a', 'b', 'c']);
    // 未被压缩 → 一条也不该少，且不动 revision
    expect(s.revision()).toBe(rev);
    // 压缩 → 整段清
    s.reset('s');
    expect(s.list('s')).toEqual([]);
    await s.flush();
  });

  it('reset 只清该会话，不连带洗掉别的会话（挨条退场不该变成全局洗）', async () => {
    const base = await dataDir();
    const s = new SessionRecalledStore(join(base, `rm2-${Math.random().toString(36).slice(2)}`));
    s.add('s', ['a']);
    s.add('other', ['z']);
    s.reset('s');
    expect(s.list('s')).toEqual([]);
    expect(s.list('other')).toEqual(['z']);
    await s.flush();
  });

  it('reset 后的会话持久化往返不把它载回来', async () => {
    const base = await dataDir();
    const dirFor = join(base, `rm3-${Math.random().toString(36).slice(2)}`);
    const s = new SessionRecalledStore(dirFor);
    s.add('s', ['a']);
    s.reset('s');
    await s.flush();
    const t = new SessionRecalledStore(dirFor);
    await t.flush();
    expect(t.list('s')).toEqual([]);
  });
});

describe('SessionRecalledStore', () => {
  it('add 累积、list 按插入序去重、reset 清空', async () => {
    const s = new SessionRecalledStore(await dataDir());
    s.add('owner1', ['a', 'b']);
    s.add('owner1', ['b', 'c']);
    expect(s.list('owner1')).toEqual(['a', 'b', 'c']);
    s.reset('owner1');
    expect(s.list('owner1')).toEqual([]);
    await s.flush();
  });
  it('会话之间互不串', async () => {
    const s = new SessionRecalledStore(await dataDir());
    s.add('o1', ['x']);
    s.add('o2', ['y']);
    expect(s.list('o1')).toEqual(['x']);
    expect(s.list('o2')).toEqual(['y']);
    await s.flush();
  });
  it('空 sessionKey / 空 ids 不建条', async () => {
    const s = new SessionRecalledStore(await dataDir());
    s.add('', ['a']);
    s.add('o', []);
    expect(s.size()).toBe(0);
  });
  it('revision 随变更递增（供投影脏检）', async () => {
    const s = new SessionRecalledStore(await dataDir());
    const r0 = s.revision();
    s.add('o', ['a']);
    expect(s.revision()).toBeGreaterThan(r0);
    await s.flush();
  });
  it('持久化往返：新实例从磁盘载回（旧会话重开可读）', async () => {
    const d = await dataDir();
    const a = new SessionRecalledStore(d);
    a.add('sess-xyz', ['m1', 'm2']);
    await a.flush();
    const b = new SessionRecalledStore(d);
    await b.flush(); // 等 init 载盘完成
    expect(b.list('sess-xyz')).toEqual(['m1', 'm2']);
  });
});
