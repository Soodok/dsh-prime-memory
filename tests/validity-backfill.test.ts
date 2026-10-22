/**
 * validity 存量回填验收（expiry-tiering task_6.2 / 7.7）：
 * - 无标注/标注过时的行被补盖 `dsh_validity`；已新鲜标注的行零写；
 * - 每攒一批被改记录调 `forceReprojectRecord` 缝（task_7.7），图谱未启用时该缝自己回零；
 * - 可中断（shouldCancel）：剩余量如实 deferred。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MemoryDb } from '../src/store/sqlite.js';
import { L1Store } from '../src/store/l1.js';
import { readValidity } from '../src/store/validity.js';
import { runValidityBackfillOnce, validityBackfillState } from '../src/validity-backfill.js';
import type { MemoryLogger, MemoryRecord } from '../src/types.js';

const noopLogger: MemoryLogger = { info: () => {}, warn: () => {}, error: () => {} };
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

/** 建库并**绕过 L1Store 汇流口**直写记录（模拟存量：没有 dsh_validity 的行）。 */
async function seededStore(records: MemoryRecord[]) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-vbackfill-'));
  dirs.push(dir);
  const db = new MemoryDb(join(dir, 'vb.db'), 0);
  db.init();
  dbs.push(db);
  for (const r of records) db.upsertL1(r);
  const l1 = new L1Store(dir, db, undefined, 'keyword', noopLogger, 0);
  await l1.init();
  return { db, l1 };
}

describe('validity-backfill(task_6.2/7.7)', () => {
  it('无标注补盖;过时标注重算;新鲜标注零写;被改记录走重投缝', async () => {
    const { l1 } = await seededStore([
      rec('v1', '常真规则'),
      rec('v2', '已过期事实', { persistence: 'o', validTo: Date.now() - 1000 }),
      rec('v3', '新鲜标注', { metadata: { dsh_validity: { state: 'current', validToSource: 'unknown', basis: '', at: new Date().toISOString() } } }),
      // 陈旧标注:写着 current 但 validTo 已过(unknown → 应重算成 expired_suspect)
      rec('v4', '陈旧标注', { persistence: 'o', validTo: Date.now() - 1000, metadata: { dsh_validity: { state: 'current', validToSource: 'unknown', basis: '', at: '2026-01-01T00:00:00.000Z' } } }),
    ]);
    const reprojections: string[][] = [];
    const out = await runValidityBackfillOnce({
      l1,
      logger: noopLogger,
      reproject: (ids) => { reprojections.push([...ids]); },
    });
    expect(out.scanned).toBe(4);
    expect(out.updated).toBe(3); // v1/v2/v4；v3 已是 current 不动
    expect(out.failed).toBe(0);
    const m1 = readValidity(l1.getByIds(['v1'])[0]!.metadata);
    expect(m1?.state).toBe('current');
    const m2 = readValidity(l1.getByIds(['v2'])[0]!.metadata);
    expect(m2?.state).toBe('expired_suspect'); // unknown 证据只判疑
    // v3 已是 current:原标注逐字不动(at 未被刷新 = 没被 patch 过)
    expect(readValidity(l1.getByIds(['v3'])[0]!.metadata)?.state).toBe('current');
    const m4 = readValidity(l1.getByIds(['v4'])[0]!.metadata);
    expect(m4?.state).toBe('expired_suspect');
    // task_7.7:三条被改记录一次 flush(< REPROJECT_BATCH 一批)
    expect(reprojections.flat().sort()).toEqual(['v1', 'v2', 'v4']);
  });

  it('重跑幂等:第二轮 updated=0(标注已新鲜)', async () => {
    const { l1 } = await seededStore([rec('w1', '一条事实'), rec('w2', '另一条事实')]);
    const deps = { l1, logger: noopLogger, reproject: () => {} };
    expect((await runValidityBackfillOnce(deps)).updated).toBe(2);
    const second = await runValidityBackfillOnce(deps);
    expect(second.updated).toBe(0);
    expect(second.scanned).toBe(2);
  });

  it('可中断:shouldCancel 在页/行检查点生效,剩余量 deferred 如实', async () => {
    const recs = Array.from({ length: 3 }, (_, i) => rec(`z${i}`, `记录 ${i}`));
    const { l1 } = await seededStore(recs);
    let seen = 0;
    const out = await runValidityBackfillOnce({
      l1,
      logger: noopLogger,
      reproject: () => {},
      shouldCancel: () => { seen += 1; return seen > 2; }, // 第一页扫两行后取消
    });
    expect(out.cancelled).toBe(true);
    expect(out.scanned).toBeLessThan(3);
    // 单飞状态收尾可见
    expect(validityBackfillState()?.running).toBe(false);
  });
});
