/**
 * 门1 解耦（expiry-tiering Phase 2 / task_2.7）的验收面。
 *
 * 钉死的性质（改前全是反例，改后才是修复）：
 * ① `valid_to` 有值但**无 marker** 的记录 → 可被 FTS 命中（旧口径被静默遮蔽）；
 * ② 带 marker 的记录 → 主表保留但三处检索写路径一致排除（upsert 漏斗/FTS 回灌/向量补齐判据）；
 * ③ retire 只写 marker，不闭 valid_to；restore 只剥 marker，不清 valid_to；
 * ④ listRetired / retiredL1Count / listL1(retired 三态) 与 retiredL1Sql 同口径（marker 单源）。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MemoryDb } from '../src/store/sqlite.js';
import { L1Store } from '../src/store/l1.js';
import type { MemoryRecord } from '../src/types.js';

const dirs: string[] = [];
const dbs: MemoryDb[] = [];
afterAll(async () => {
  for (const d of dbs) { try { d.close(); } catch { /* 已关 */ } }
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

function rec(id: string, content: string, extra: Partial<MemoryRecord> = {}): MemoryRecord {
  const t = Date.now();
  return { id, content, type: 'work_fact', priority: 60, scene_name: 's', timestamps: [t], createdAt: t, updatedAt: t, ...extra };
}

async function setup(): Promise<{ db: MemoryDb; store: L1Store }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-gate1-'));
  dirs.push(dir);
  const db = new MemoryDb(join(dir, 'g1.db'), 0); // 纯 FTS 档,不拖向量
  db.init();
  dbs.push(db);
  const store = new L1Store(dir, db, undefined, 'keyword', undefined, 0);
  await store.init();
  return { db, store };
}

describe('门1:valid_to 与退场解耦', () => {
  it('① 合法历史 valid_to(无 marker)的记录可被 FTS 命中(改前被静默遮蔽)', async () => {
    const { db, store } = await setup();
    // 经 db 漏斗写入(绕开 L1Store 的标注,聚焦列语义):2020 年结束的旅行,事实成立过
    db.upsertL1(rec('t1', '2020 年在巴黎旅行', { persistence: 's', validTo: Date.parse('2020-08-01T00:00:00Z') }));
    const hits = db.searchL1Fts('巴黎旅行', 5).map((h) => h.id);
    expect(hits, '带历史有效期的记录不该被当成已退场').toContain('t1');
    expect(store.listRetired({ limit: 10, offset: 0 }).total).toBe(0);
    expect(db.retiredL1Count()).toBe(0);
  });

  it('② 带 marker 的记录:主表保留,检索面/去重候选/回灌/计数四口一致排除', async () => {
    const { db, store } = await setup();
    await store.appendNew([rec('m1', '将被退场的部署手册'), rec('m2', '邻活的部署手册')]);
    expect(store.retire(['m1'], { at: '2026-10-22T00:00:00.000Z', reason: 'manual' })).toBe(1);
    // FTS 撤出、邻居不受影响
    const hits = db.searchL1Fts('部署手册', 5).map((h) => h.id);
    expect(hits).not.toContain('m1');
    expect(hits).toContain('m2');
    // 去重候选召回也看不到(候选面复用检索)
    expect((await store.searchCandidates('部署手册', 5)).map((r) => r.id)).not.toContain('m1');
    // 退场计数/listRetired 与同一判据(marker):只认 m1
    expect(db.retiredL1Count()).toBe(1);
    expect(store.listRetired({ limit: 10, offset: 0 }).items.map((r) => r.id)).toEqual(['m1']);
    // 主表行仍在(可恢复的载体)
    expect(store.getByIds(['m1'])).toHaveLength(1);
  });

  it('③ retire 只写 marker 不闭 valid_to;restore 只剥 marker 不清 valid_to', async () => {
    const { db, store } = await setup();
    const past = Date.parse('2020-01-01T00:00:00Z');
    db.upsertL1(rec('r1', '带真实历史有效期的记录', { persistence: 's', validTo: past }));
    // 对该行退场:marker 落上,valid_to 保持原值(不被退场时刻顶替)
    expect(store.retire(['r1'], { at: '2026-10-22T00:00:00.000Z', reason: 'obsolete' })).toBe(1);
    const [afterRetire] = store.getByIds(['r1']);
    expect(afterRetire.metadata && (afterRetire.metadata as Record<string, unknown>).dsh_superseded).toBeDefined();
    expect(afterRetire.validTo).toBe(past);
    // 恢复:marker 剥掉、真实有效期保留(门1 对偶面)
    const back = await store.restore(['r1']);
    expect(back.restored).toBe(1);
    const [restored] = store.getByIds(['r1']);
    expect(restored.metadata && (restored.metadata as Record<string, unknown>).dsh_superseded).toBeUndefined();
    expect(restored.validTo).toBe(past);
    expect(db.searchL1Fts('历史有效期', 5).map((h) => h.id)).toContain('r1');
  });

  it('④ listL1 的 retired 三态与 marker 口径联动(不带 marker 的历史行归"活跃")', async () => {
    const { store } = await setup();
    const t = Date.now();
    await store.appendNew([
      rec('act', '活跃记录一条', { createdAt: t, updatedAt: t }),
      rec('his', '历史区间记录一条', { persistence: 's', validTo: t - 86_400_000 }),
    ]);
    await store.appendNew([rec('ret', '已退场记录一条')]);
    store.retire(['ret'], { at: '2026-10-22T00:00:00.000Z', reason: 'manual' });

    expect(store.list({ limit: 50, offset: 0 }).items.map((r) => r.id).sort()).toEqual(['act', 'his', 'ret']);
    expect(store.list({ limit: 50, offset: 0, retired: false }).items.map((r) => r.id).sort()).toEqual(['act', 'his']);
    expect(store.list({ limit: 50, offset: 0, retired: true }).items.map((r) => r.id)).toEqual(['ret']);
  });
});
