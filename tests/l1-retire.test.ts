/**
 * 记忆退场**软删原语**闭环单测(task_3~6)。
 *
 * 要钉死的性质:
 * ① 退场后**主表仍在**(可恢复的载体),但检索面(FTS + 向量)与**去重候选召回**
 *    都看不到它 —— 后者尤其重要:若退场记录还能当去重候选,它会被反复"重新发现"
 *    并参与新的决策,退场等于没退。
 * ② 退场**幂等**:二次调用不重复写标记,保留首次退场的原因与时刻。
 * ③ 恢复是**闭环**:退场 → 检索不到 → 恢复 → 检索得到,且 `valid_to` 与标记都被清掉。
 * ④ 面板浏览路径**不隐藏**退场记录(静默消失正是本功能要根治的病)。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { L1Store } from '../src/store/l1.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { readSupersedeMarker } from '../src/store/supersede.js';
import type { EmbeddingService } from '../src/store/embedding.js';
import type { MemoryRecord } from '../src/types.js';

const DIM = 16;
const AT = '2026-09-18T12:00:00.000Z';
const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

function vecFor(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (let i = 0; i < text.length; i++) v[text.charCodeAt(i) % DIM] += 1;
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (mag < 1e-10) return v;
  for (let i = 0; i < DIM; i++) v[i] /= mag;
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

const KEEP = 'mem_keep_1';
const GONE = 'mem_retire_1';

function rec(id: string, content: string): MemoryRecord {
  const t = Date.now();
  return { id, content, type: 'work_fact', priority: 60, scene_name: 's', timestamps: [t], createdAt: t, updatedAt: t };
}

async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-retire-'));
  dirs.push(dataDir);
  const db = new MemoryDb(join(dataDir, 'r.db'), DIM);
  db.init();
  const store = new L1Store(dataDir, db, fakeEmbed(), 'hybrid', undefined, 0);
  await store.init();
  await store.appendNew([
    rec(GONE, '部署脚本 evidence 目录 回滚逻辑'),
    rec(KEEP, '咖啡豆每周采购一次'),
  ]);
  return { db, store };
}

const ids = (hits: Array<{ id: string }>) => hits.map((h) => h.id);

describe('软删原语:退场 → 检索不可见 → 恢复可见', () => {
  it('闭环', async () => {
    const { db, store } = await setup();
    const Q = '部署脚本 evidence';

    // 基线:检索面能看到
    expect(ids(await store.search(Q, 5))).toContain(GONE);
    expect(store.listRetired({ limit: 50, offset: 0 }).total).toBe(0);

    // ── 退场 ──
    expect(store.retire([GONE], { at: AT, reason: 'manual' })).toBe(1);

    // ① 检索面与去重候选都看不到
    expect(ids(await store.search(Q, 5))).not.toContain(GONE);
    expect((await store.searchCandidates(Q, 5)).map((r) => r.id)).not.toContain(GONE);
    // 未退场的邻居不受影响(零漂移)
    expect(ids(await store.search('咖啡豆', 5))).toContain(KEEP);
    expect(db.searchL1Fts(Q, 5).map((h) => h.id)).not.toContain(GONE);

    // ② 主表仍在 + 标记可读(门1 解耦:retire 不再闭合 valid_to——它回归现实有效期)
    const [row] = store.getByIds([GONE]);
    expect(row, '主表行必须保留(可恢复的载体)').toBeDefined();
    expect(row.validTo).toBeUndefined();
    expect(readSupersedeMarker(row.metadata)).toEqual({ at: AT, reason: 'manual' });
    expect(row.content).toBe('部署脚本 evidence 目录 回滚逻辑');

    // ③ 面板浏览路径不隐藏
    const browse = store.list({ limit: 50, offset: 0 });
    expect(browse.items.map((r) => r.id)).toContain(GONE);
    // 已退场列表能列出它
    const retired = store.listRetired({ limit: 50, offset: 0 });
    expect(retired.total).toBe(1);
    expect(retired.items[0].id).toBe(GONE);

    // ── 恢复 ──
    const res = await store.restore([GONE]);
    expect(res.restored).toBe(1);
    expect(ids(await store.search(Q, 5))).toContain(GONE);
    expect(store.listRetired({ limit: 50, offset: 0 }).total).toBe(0);
    const [back] = store.getByIds([GONE]);
    expect(back.validTo).toBeUndefined(); // 本就没写,恢复后依旧未闭合
    expect(readSupersedeMarker(back.metadata)).toBeUndefined();
    expect(back.content).toBe('部署脚本 evidence 目录 回滚逻辑');

    db.close();
  });

  it('退场筛查三态:listL1 的 retired 过滤(缺省全量/false 仅活跃/true 仅退场)', async () => {
    const { db, store } = await setup();
    store.retire([GONE], { at: AT, reason: 'manual' });

    // 缺省:不过滤,活跃+退场都在(浏览路径不隐藏退场记录的设计不变)
    const all = store.list({ limit: 50, offset: 0 });
    expect(all.items.map((r) => r.id).sort()).toEqual([GONE, KEEP].sort());
    expect(all.total).toBe(2);

    // false:仅活跃
    const active = store.list({ limit: 50, offset: 0, retired: false });
    expect(active.items.map((r) => r.id)).toEqual([KEEP]);
    expect(active.total).toBe(1);

    // true:仅已退场,与 listRetiredL1 同一批行
    const retiredOnly = store.list({ limit: 50, offset: 0, retired: true });
    expect(retiredOnly.items.map((r) => r.id)).toEqual([GONE]);
    expect(retiredOnly.total).toBe(1);
    expect(retiredOnly.items.map((r) => r.id)).toEqual(
      store.listRetired({ limit: 50, offset: 0 }).items.map((r) => r.id),
    );

    // 恢复后三态随之归位:退场视图回空
    await store.restore([GONE]);
    expect(store.list({ limit: 50, offset: 0, retired: true }).total).toBe(0);
    expect(store.list({ limit: 50, offset: 0, retired: false }).total).toBe(2);
    db.close();
  });

  it('幂等:二次退场不改写首次的原因与时刻', async () => {
    const { db, store } = await setup();
    expect(store.retire([GONE], { at: AT, reason: 'conflict', verdict: 'winner', pairId: 'p1' })).toBe(1);
    // 换一套参数再退一次:必须被忽略
    expect(store.retire([GONE], { at: '2027-01-01T00:00:00.000Z', reason: 'manual' })).toBe(0);
    const [row] = store.getByIds([GONE]);
    expect(readSupersedeMarker(row.metadata)).toEqual({ at: AT, reason: 'conflict', verdict: 'winner', pairId: 'p1' });
    db.close();
  });

  it('取代标记带 `by`(去重 update/merge 场景)', async () => {
    const { db, store } = await setup();
    store.retire([GONE], { at: AT, reason: 'superseded', by: 'mem_new_9' });
    const [row] = store.getByIds([GONE]);
    expect(readSupersedeMarker(row.metadata)).toEqual({ at: AT, reason: 'superseded', by: 'mem_new_9' });
    db.close();
  });

  it('不存在的 id 静默跳过(不抛、不计数)', async () => {
    const { db, store } = await setup();
    expect(store.retire(['no_such_id'], { at: AT, reason: 'manual' })).toBe(0);
    expect(store.listRetired({ limit: 50, offset: 0 }).total).toBe(0);
    expect(await store.restore(['no_such_id'])).toEqual({ restored: 0, vectorsWritten: 0 });
    db.close();
  });

  it('恢复未退场的记录是无害 no-op(不产生标记、不改内容)', async () => {
    const { db, store } = await setup();
    const res = await store.restore([KEEP]);
    expect(res.restored).toBe(1); // 记录仍在(被 upsert 回来),但从未退场
    const [row] = store.getByIds([KEEP]);
    expect(row.validTo).toBeUndefined();
    expect(readSupersedeMarker(row.metadata)).toBeUndefined();
    expect(store.listRetired({ limit: 50, offset: 0 }).total).toBe(0);
    expect(ids(await store.search('咖啡豆', 5))).toContain(KEEP);
    db.close();
  });

  it('退场不变量在**写入漏斗**上强制:重新 upsert 已退场记录不会让它回到检索面', async () => {
    // 场景:快照恢复 / 重建 / 旧版导入都会经 upsertL1InTx 写回记录。若那里照常
    // 重建 FTS/向量行,一条带退场标记的记录会悄悄回到检索结果里(检索侧刻意
    // 不看 valid_to,正是为了零漂移)—— 故不变量必须在这里强制,而不只靠 retire。
    const { db, store } = await setup();
    const Q = '部署脚本 evidence';
    store.retire([GONE], { at: AT, reason: 'manual' });
    expect(db.searchL1Fts(Q, 5).map((h) => h.id)).not.toContain(GONE);

    const [retiredRec] = store.getByIds([GONE]);
    await store.upsert(retiredRec); // 走真实写入漏斗(仍带 valid_to + 标记)
    expect(db.searchL1Fts(Q, 5).map((h) => h.id)).not.toContain(GONE);
    expect(store.listRetired({ limit: 10, offset: 0 }).items.map((r) => r.id)).toContain(GONE);

    // 但清掉退场状态后必须能回来(否则"不变量"会退化成永久封禁)
    expect((await store.restore([GONE])).restored).toBe(1);
    expect(db.searchL1Fts(Q, 5).map((h) => h.id)).toContain(GONE);
    db.close();
  });
});
