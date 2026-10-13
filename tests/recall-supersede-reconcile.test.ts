/**
 * Phase 0B：「正文已被摘要取代」的判据从宿主事件换成会话日志可见性。
 *
 * 钉住四件会静默坏掉的事：
 *   1. 识别口径只有一份——token 估算与取代对账必须读同一个 `ownInjectionFromEvent`，
 *      且 v4 (`plugin:memory`) 与 v3 (`plugin`+`plugin:'memory'`) 两种署名形状都要认得；
 *   2. 对账既能**标上**也能**撤销**（这是"漏一次就永久错"的解药）；
 *   3. 注入没落日志（被宿主取消）属"无从判"，**不得**被猜成已被取代；
 *   4. 新键 `injectedBy` 是可选的：不写它时磁盘形状必须与改动前逐字一致（零漂移），
 *      且不升文件版本号（升了会让老文件整体进只读降级）。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ownInjectionFromEvent } from '../src/hooks/recall.js';
import { SessionRecalledStore } from '../src/store/session-recalled.js';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

async function freshStore() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-recalled-'));
  dirs.push(dir);
  const store = new SessionRecalledStore(dir);
  await store.flush();
  return { dir, store };
}

describe('ownInjectionFromEvent（唯一识别口径）', () => {
  const msg = (source: Record<string, unknown>, id = 'm1', text = 'abcde') => ({
    type: 'user/message',
    seq: 7,
    data: { id, source, content: [{ type: 'text', text }] },
  });

  it('v4 与 v3 两种署名形状都认得，并取出 id / seq / 字数', () => {
    const v4 = ownInjectionFromEvent(msg({ kind: 'plugin:memory', form: 'recall' }));
    const v3 = ownInjectionFromEvent(msg({ kind: 'plugin', plugin: 'memory', form: 'recall' }));
    expect(v4).toEqual({ id: 'm1', seq: 7, chars: 5 });
    expect(v3).toEqual(v4);
  });

  it('不是本插件注入 / 不是 user/message / 无正文 → 不认', () => {
    expect(ownInjectionFromEvent(msg({ kind: 'plugin', plugin: 'other', form: 'recall' }))).toBeUndefined();
    expect(ownInjectionFromEvent(msg({ kind: 'user' }))).toBeUndefined();
    expect(ownInjectionFromEvent({ type: 'assistant/message', seq: 1, data: { source: { kind: 'plugin:memory', form: 'recall' } } })).toBeUndefined();
    // 认得出但零字数：chars 如实为 0，由调用方决定跳过（不在这里藏判据）
    expect(ownInjectionFromEvent(msg({ kind: 'plugin:memory', form: 'recall' }, 'm2', ''))?.chars).toBe(0);
  });

  it('消息 id 缺失时给空串——对账侧据此判"无从判"，不会误标', () => {
    const got = ownInjectionFromEvent({ type: 'user/message', seq: 3, data: { source: { kind: 'plugin:memory', form: 'recall' } } });
    expect(got?.id).toBe('');
  });
});

describe('reconcileSuperseded（从 surface 对账）', () => {
  it('注入过的条目：不在可见集就标取代，回到可见集就撤销；重复对账不推 rev', async () => {
    const { store } = await freshStore();
    store.add('s1', ['a', 'b'], 'inj-1');
    await store.flush();

    // inj-1 已不在 surface（被摘要顶掉），但仍在日志里
    expect(store.reconcileSuperseded('s1', new Set(), new Set(['inj-1']))).toBe(true);
    expect([...store.supersededOf('s1')].sort()).toEqual(['a', 'b']);

    // 幂等：同样输入再来一次，不该改状态、不该推 rev
    const rev = store.revision();
    expect(store.reconcileSuperseded('s1', new Set(), new Set(['inj-1']))).toBe(false);
    expect(store.revision()).toBe(rev);

    // 重新注入后 inj-1 又可见 → 撤销（自愈；否则一条记忆只能被取代一次）
    expect(store.reconcileSuperseded('s1', new Set(['inj-1']), new Set(['inj-1']))).toBe(true);
    expect(store.supersededOf('s1').size).toBe(0);
  });

  it('注入从未落日志（被宿主取消）→ 无从判，绝不猜成已被取代', async () => {
    const { store } = await freshStore();
    store.add('s1', ['a'], 'inj-gone');
    await store.flush();
    // known 里没有这个 id：既不该标，也不该撤销
    expect(store.reconcileSuperseded('s1', new Set(), new Set())).toBe(false);
    expect(store.supersededOf('s1').size).toBe(0);
  });

  it('seq 因压缩而重排时仍正确：判据只认 message id，不认 seq', async () => {
    const { store } = await freshStore();
    store.add('s1', ['a', 'b'], 'inj-1');
    store.add('s1', ['c'], 'inj-2');
    await store.flush();
    // 压缩把 inj-1 顶掉（不在 visible），inj-2 仍在；两条都 known
    expect(store.reconcileSuperseded('s1', new Set(['inj-2']), new Set(['inj-1', 'inj-2']))).toBe(true);
    expect([...store.supersededOf('s1')].sort()).toEqual(['a', 'b']);
  });

  it('重新注入会撤销取代标记（add 侧的既有语义，与对账不冲突）', async () => {
    const { store } = await freshStore();
    store.add('s1', ['a'], 'inj-1');
    store.reconcileSuperseded('s1', new Set(), new Set(['inj-1']));
    expect(store.supersededOf('s1').has('a')).toBe(true);
    store.add('s1', ['a'], 'inj-9');
    expect(store.supersededOf('s1').has('a')).toBe(false);
  });
});

describe('injectedBy 的持久化纪律', () => {
  it('不带 injectionId 时磁盘形状与改动前逐字一致（零漂移，且没塞空对象）', async () => {
    const { dir, store } = await freshStore();
    store.add('s1', ['a', 'b']);
    await store.flush();
    const raw = JSON.parse(await readFile(join(dir, 'session-recalled.json'), 'utf8'));
    expect(Object.keys(raw.sessions.s1).sort()).toEqual(['recordIds', 'updatedAt']);
    expect(raw.version).toBe(1);
  });

  it('带 injectionId 才写键；老文件没这个键也照旧可读，且对账直接返回 false', async () => {
    const { dir, store } = await freshStore();
    store.add('s1', ['a'], 'inj-1');
    await store.flush();
    const raw = JSON.parse(await readFile(join(dir, 'session-recalled.json'), 'utf8'));
    expect(raw.sessions.s1.injectedBy).toEqual({ a: 'inj-1' });

    // 老形状：手写一份没有 injectedBy 的文件，重开存储
    const legacy = { version: 1, sessions: { s9: { recordIds: ['x'], updatedAt: Date.now() } } };
    const dir2 = await mkdtemp(join(tmpdir(), 'dsh-recalled-legacy-'));
    dirs.push(dir2);
    await writeFile(join(dir2, 'session-recalled.json'), JSON.stringify(legacy), 'utf8');
    const store2 = new SessionRecalledStore(dir2);
    await store2.flush();
    expect(store2.list('s9')).toEqual(['x']);
    // 没有 injectedBy → 无从判，对账不动状态
    expect(store2.reconcileSuperseded('s9', new Set(), new Set(['anything']))).toBe(false);
  });
});
