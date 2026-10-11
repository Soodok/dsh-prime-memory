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
