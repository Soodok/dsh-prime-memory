/**
 * 压缩与清空对「本会话召回列表」的不同后果（2026-10-13 用户口径）。
 *
 * 旧实现两种都整表清，于是压缩过一次就把本会话召回历史抹平——尤其**已判过时的条目
 * 是人对这条记忆的裁决凭证**，跟着消失等于判定历史丢了。现在：
 *   - `compact`（摘要替换）不动这张表；`clear`（用户主动清空）整表清；
 *   - 判过时的条目受 `protectedIds` 保护，**上限淘汰也走不到它**；
 *   - 保护必须落盘：不落的话重启后它又变回可被淘汰的普通条目。
 * 另两条反向断言同样重要：没判过时的条目仍要能被淘汰（否则上限就是个摆设），
 * 以及 `clear` 仍要真的清掉（否则"清空会话"变成假动作）。
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SessionRecalledStore } from '../src/store/session-recalled.js';
import { RECALL_DEDUPE_IDS_CAP } from '../src/store/recall-dedupe.js';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

async function fresh(): Promise<{ store: SessionRecalledStore; dataDir: string; file: string }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-recalled-'));
  dirs.push(dataDir);
  const store = new SessionRecalledStore(dataDir);
  await store.flush();
  return { store, dataDir, file: join(dataDir, 'session-recalled.json') };
}

describe('压缩不清列表、清空才清', () => {
  it('compact 之后条目全在；clear 之后整表空', async () => {
    const { store } = await fresh();
    store.add('s1', ['a', 'b', 'c']);
    store.reset('s1', 'compact');
    await store.flush();
    expect(store.list('s1')).toEqual(['a', 'b', 'c']);

    store.reset('s1', 'clear');
    await store.flush();
    expect(store.list('s1')).toEqual([]);
  });

  it('缺省 reason 仍是"清"（老调用点不传第二个参数时行为不变）', async () => {
    const { store } = await fresh();
    store.add('s2', ['x']);
    store.reset('s2');
    await store.flush();
    expect(store.list('s2')).toEqual([]);
  });
});

describe('判过时的条目受保护', () => {
  it('超上限时淘汰的是未判过时的，判过时的留下', async () => {
    const { store } = await fresh();
    // 先塞满到上限，再保护最旧那一条，然后继续注入逼它淘汰。
    const first = ['keep-me', ...Array.from({ length: RECALL_DEDUPE_IDS_CAP - 1 }, (_, i) => `id-${i}`)];
    store.add('s3', first);
    store.protect('s3', ['keep-me']);
    expect(store.list('s3').length).toBe(RECALL_DEDUPE_IDS_CAP);

    store.add('s3', ['extra-1', 'extra-2']);
    await store.flush();
    const left = store.list('s3');
    expect(left).toContain('keep-me');
    expect(left).toContain('extra-2');
    // 淘汰发生在未受保护的一侧：最旧的 id-0 被挤掉
    expect(left).not.toContain('id-0');
    expect(left.length).toBe(RECALL_DEDUPE_IDS_CAP);
  });

  it('保护会落盘，重启后仍然生效（不落盘 = 保护只活在内存里）', async () => {
    const { store, dataDir, file } = await fresh();
    store.add('s4', ['a', 'b']);
    store.protect('s4', ['a']);
    await store.flush();
    const disk = JSON.parse(await readFile(file, 'utf8')) as {
      sessions: Record<string, { recordIds: string[]; protectedIds?: string[] }>;
    };
    expect(disk.sessions.s4?.protectedIds).toEqual(['a']);

    const again = new SessionRecalledStore(dataDir);
    await again.flush();
    expect(again.list('s4')).toEqual(['a', 'b']);
    // 载回后仍是受保护状态：把它顶到上限再注入，a 不得被挤掉
    const pad = Array.from({ length: RECALL_DEDUPE_IDS_CAP }, (_, i) => `p-${i}`);
    again.add('s4', pad);
    await again.flush();
    expect(again.list('s4')).toContain('a');
  });

  it('没有保护条目时文件形状与改动前逐字一致（不新增空键）', async () => {
    const { store, file } = await fresh();
    store.add('s5', ['a']);
    await store.flush();
    const disk = JSON.parse(await readFile(file, 'utf8')) as { sessions: Record<string, Record<string, unknown>> };
    expect(Object.keys(disk.sessions.s5 ?? {})).toEqual(['recordIds', 'updatedAt']);
  });

  it('protect 不凭空调用就新建条目（id 不在列表里时忽略，也不推序号）', async () => {
    const { store } = await fresh();
    store.add('s6', ['a']);
    await store.flush();
    expect(store.revision()).toBe(1); // 只有 add 算一次真实变更
    store.protect('s6', ['ghost']);
    await store.flush();
    expect(store.list('s6')).toEqual(['a']);
    expect(store.revision()).toBe(1); // 幽灵 id 被忽略：不得把无变更当脏（会白写盘）

    store.protect('s6', ['a']);
    await store.flush();
    expect(store.revision()).toBe(2);
    store.protect('s6', ['a']);
    await store.flush();
    expect(store.revision()).toBe(2); // 重复保护幂等，不再推序号
  });
});

/**
 * 「正文已被摘要取代」这一维（2026-10-13：brief 无法区分旧召回与当前召回）。
 *
 * 压缩只改「正文还在不在上下文」：当时在列表里的一律打取代标记，**不删条目**
 * （已判过时的条目还要靠它留在列表里挂删除线）；重新注入则撤销标记。
 */
describe('压缩把当时在列表里的那批标成已被摘要取代', () => {
  it('compact 打标记但不动列表；重新注入撤销该条的标记', async () => {
    const { store } = await fresh();
    store.add('c1', ['a', 'b']);
    store.reset('c1', 'compact');
    await store.flush();
    expect(store.list('c1')).toEqual(['a', 'b']); // 条目一个不少
    expect([...store.supersededOf('c1')].sort()).toEqual(['a', 'b']);

    // 重新注入 = 正文又回到上下文 → 该条的标记必须撤销（否则只能被取代一次）。
    store.add('c1', ['b']);
    await store.flush();
    expect([...store.supersededOf('c1')]).toEqual(['a']);

    store.add('c1', ['c']);
    await store.flush();
    expect([...store.supersededOf('c1')]).toEqual(['a']); // 新注入的不带标记
  });

  it('与保护正交：判过时的条目两个标记同时在，且仍不被淘汰', async () => {
    const { store } = await fresh();
    store.add('c2', ['keep', 'plain']);
    store.protect('c2', ['keep']);
    store.reset('c2', 'compact');
    await store.flush();
    expect([...store.supersededOf('c2')].sort()).toEqual(['keep', 'plain']);

    const pad = Array.from({ length: RECALL_DEDUPE_IDS_CAP }, (_, i) => `p-${i}`);
    store.add('c2', pad);
    await store.flush();
    expect(store.list('c2')).toContain('keep'); // 保护仍然生效
  });

  it('取代标记落盘，重启后仍在（不落 = 只活在内存里）', async () => {
    const { store, dataDir, file } = await fresh();
    store.add('c3', ['a', 'b']);
    store.reset('c3', 'compact');
    await store.flush();
    const disk = JSON.parse(await readFile(file, 'utf8')) as {
      sessions: Record<string, Record<string, unknown>>;
    };
    expect(disk.sessions.c3?.supersededIds).toEqual(['a', 'b']);
    expect(Object.keys(disk.sessions.c3 ?? {})).toEqual(['recordIds', 'supersededIds', 'updatedAt']);

    const again = new SessionRecalledStore(dataDir);
    await again.flush();
    expect([...again.supersededOf('c3')].sort()).toEqual(['a', 'b']);
  });

  it('clear 把取代集一起清；重复 compact 幂等（不推序号、不白写盘）', async () => {
    const { store } = await fresh();
    store.add('c4', ['a']);
    await store.flush();
    const afterAdd = store.revision();
    store.reset('c4', 'compact');
    await store.flush();
    expect(store.revision()).toBe(afterAdd + 1);
    store.reset('c4', 'compact'); // 同一个集合再压一次：无新标记
    await store.flush();
    expect(store.revision()).toBe(afterAdd + 1);

    store.reset('c4', 'clear');
    await store.flush();
    expect(store.list('c4')).toEqual([]);
    expect([...store.supersededOf('c4')]).toEqual([]);
  });

  it('没有任何取代时不写 supersededIds 键（与改动前文件形状逐字一致）', async () => {
    const { store, file } = await fresh();
    store.add('c5', ['a']);
    await store.flush();
    const disk = JSON.parse(await readFile(file, 'utf8')) as {
      sessions: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(disk.sessions.c5 ?? {})).toEqual(['recordIds', 'updatedAt']);
    expect([...store.supersededOf('c5')]).toEqual([]);
  });
});
