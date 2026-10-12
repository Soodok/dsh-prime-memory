/**
 * `l1_records.name`（文件身份键，P0-a/P0-b）的落地回归——真 MemoryDb + FTS。
 *
 * 钉住四件会静默坏掉的事：
 *   1. **建列不 degraded**（F7：schema 迁移失败 = 整库降级，比缺一个索引严重得多）；
 *   2. **部分唯一索引只约束非空值**（存量 name 恒 ''，若索引写成全表唯一，旧库首次
 *      迁移就当场炸；两条没名字的记录也必须能共存）；
 *   3. **撞名被结构性挡住**（写侧分配器是第一道，索引是第二道——漏一道就会长出两份同名文件）；
 *   4. **name 不进快照哈希投影**（F5：`canonicalRecords` 显式列举字段，加列安全、
 *      改投影危险）。这条用"同一集合改 name 前后哈希不变"来断言，而不是抄一个魔数——
 *      魔数只能证明"当时算出来是这样"，性质才能证明"以后也不会变"。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { L1Store } from '../src/store/l1.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { hashRecords } from '../src/store/l1-snapshot.js';
import type { EmbeddingService } from '../src/store/embedding.js';
import type { MemoryRecord } from '../src/types.js';

const DIM = 16;
const dirs: string[] = [];
const dbs: MemoryDb[] = [];
afterAll(async () => {
  // Windows 上不先关句柄就删不了目录（EBUSY）；其它套件靠这一下才收得干净。
  for (const db of dbs) db.close();
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

function vecFor(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (let i = 0; i < text.length; i++) v[text.charCodeAt(i) % DIM] += 1;
  return v;
}
function fakeEmbed(): EmbeddingService {
  return {
    getDimensions: () => DIM,
    getProviderInfo: () => ({ provider: 'probe', model: 'probe', dimensions: DIM }),
    isReady: () => true,
    embed: async (t: string) => vecFor(t),
    embedBatch: async (ts: string[]) => ts.map(vecFor),
  };
}

function rec(id: string, content: string, extra: Partial<MemoryRecord> = {}): MemoryRecord {
  const t = Date.now();
  return { id, content, type: 'work_fact', priority: 60, scene_name: 's', timestamps: [t], createdAt: t, updatedAt: t, ...extra };
}

async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-l1name-'));
  dirs.push(dataDir);
  const db = new MemoryDb(join(dataDir, 'n.db'), DIM);
  db.init();
  dbs.push(db);
  const store = new L1Store(dataDir, db, fakeEmbed(), 'hybrid', undefined, 0);
  await store.init();
  return { db, store };
}

describe('l1_records.name 列', () => {
  it('建列成功且库不 degraded，读回时缺名字的记录 name 为 undefined', async () => {
    const { db, store } = await setup();
    expect(db.isDegraded()).toBe(false);
    await store.appendNew([rec('a1', '上行必须走官方地址')]);
    const got = store.getByIds(['a1'])[0];
    expect(got).toBeDefined();
    // 没写 name 就是 undefined（不是空串）：记录形状与加列前一致。
    expect(got!.name).toBeUndefined();
  });

  it('两条 name 为空的记录可共存（部分索引不约束空串）', async () => {
    const { store } = await setup();
    await store.appendNew([rec('b1', '第一条没名字'), rec('b2', '第二条没名字')]);
    expect(store.getByIds(['b1', 'b2']).length).toBe(2);
  });

  it('写入时带 name 能读回；撞名第二条被索引挡下、不同名可写', async () => {
    const { store } = await setup();
    await store.appendNew([rec('c1', 'pnpm 需要 hoisted 布局', { name: 'pnpm-hoisted' })]);
    expect(store.getByIds(['c1'])[0]!.name).toBe('pnpm-hoisted');
    expect(store.findIdByName('pnpm-hoisted')).toBe('c1');

    // 第二条想用同一个名字：写不进去（部分唯一索引），且不影响第一条。
    // `appendNew` 不回报成败，所以断言只能落在“库里的实际形状”上——这也正好是
    // 真正重要的那件事：批次不能因为一条撞名而连带丢好记录（upsertL1Batch 会回退逐条）。
    await store.appendNew([rec('c2', '另一条也想叫这个', { name: 'pnpm-hoisted' })]);
    expect(store.getByIds(['c2'])[0]).toBeUndefined();
    expect(store.getByIds(['c1'])[0]).toBeDefined();
    // 换个名字就写得进。
    await store.appendNew([rec('c3', '换个名字', { name: 'pnpm-hoisted-2' })]);
    expect(store.getByIds(['c3'])[0]!.name).toBe('pnpm-hoisted-2');
  });

  it('rename 生效、撞名返回 dup、且都不动 updated_time（快照哈希不漂）', async () => {
    const { store } = await setup();
    await store.appendNew([
      rec('d1', '第一条', { name: 'first' }),
      rec('d2', '第二条', { name: 'second' }),
    ]);
    const before = store.getByIds(['d1'])[0]!.updatedAt;

    expect(store.rename('d1', 'renamed').ok).toBe(true);
    expect(store.getByIds(['d1'])[0]!.name).toBe('renamed');
    expect(store.findIdByName('first')).toBeUndefined();
    expect(store.findIdByName('renamed')).toBe('d1');

    // 撞名：明确报 dup，**不自动加后缀**（那会静默长出语义重叠的第二条）。
    expect(store.rename('d1', 'second')).toEqual({ ok: false, reason: 'dup' });
    expect(store.getByIds(['d1'])[0]!.name).toBe('renamed');

    // 不存在的 id 不能凭空改名。
    expect(store.rename('nope', 'x')).toEqual({ ok: false, reason: 'missing' });

    // 改名不是"内容变了"：updated_time 一动，衰减/排序与快照哈希就都跟着漂。
    expect(store.getByIds(['d1'])[0]!.updatedAt).toBe(before);
  });

  it('name 不进快照哈希投影：同一集合改名字前后 hashRecords 不变', async () => {
    const { store } = await setup();
    await store.appendNew([rec('e1', '要改名的记录'), rec('e2', '另一条记录')]);
    const h0 = hashRecords(store.all());
    expect(store.rename('e1', 'e1-name').ok).toBe(true);
    expect(hashRecords(store.all())).toBe(h0);
    // 反向对照：内容真的变了，哈希必须变（否则上面那条断言只是"函数没在算"）。
    await store.appendNew([rec('e3', '新内容', { name: 'e3-name' })]);
    expect(hashRecords(store.all())).not.toBe(h0);
  });
});
