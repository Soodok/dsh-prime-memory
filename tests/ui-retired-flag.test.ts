/**
 * 退场态透传单测(task:记忆删除可见性)。
 *
 * 钉死的性质:
 * ① 活动列表仍**包含**已退场记录(软删可恢复,设计不隐藏),但 `UiRecord.retired`
 *    必须为 `true`、`retiredReason` 带原因 —— 否则面板无从渲染「已退场」徽标,
 *    用户点了删除却看不到任何变化(本 bug 的根因)。
 * ② 活跃记录的 `retired` 为 `false` / `retiredReason` 为 `null`。
 * ③ 原因取自取代标记(`manual` / `conflict` / `superseded`),缺标记回落 `unknown`。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { L1Store } from '../src/store/l1.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { hitToUiRecord } from '../src/stats.js';
import type { EmbeddingService } from '../src/store/embedding.js';
import type { MemoryRecord } from '../src/types.js';

const DIM = 8;
const AT = '2026-09-20T12:00:00.000Z';
const dirs: string[] = [];
const dbs: MemoryDb[] = [];
/** Windows 文件锁:必须先 close 再 rm,且 rm 失败重试(room-counts 同款清理纪律)。 */
afterAll(async () => {
  for (const db of dbs) db.close();
  for (const d of dirs) {
    for (let i = 0; i < 3; i++) {
      try {
        await rm(d, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }
});
function embed(): EmbeddingService {
  return {
    getDimensions: () => DIM,
    getProviderInfo: () => ({ provider: 'probe', model: 'probe', dimensions: DIM }),
    isReady: () => true,
    embed: async () => new Float32Array(DIM),
    embedBatch: async (ts: string[]) => ts.map(() => new Float32Array(DIM)),
  };
}
function rec(id: string, content: string): MemoryRecord {
  const t = Date.now();
  return { id, content, type: 'work_fact', priority: 60, scene_name: 's', timestamps: [t], createdAt: t, updatedAt: t };
}

async function setup(): Promise<{ db: MemoryDb; store: L1Store }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-uiflag-'));
  dirs.push(dir);
  const db = new MemoryDb(join(dir, 'u.db'), DIM);
  db.init();
  dbs.push(db);
  const store = new L1Store(dir, db, embed(), 'hybrid', undefined, 0);
  await store.init();
  return { db, store };
}

describe('hitToUiRecord: 退场态透传到 UiRecord', () => {
  it('活跃记录 → retired:false, retiredReason:null', async () => {
    const { store } = await setup();
    await store.appendNew([rec('a1', '活跃记忆')]);
    const [a] = store.getByIds(['a1']);
    const ui = hitToUiRecord({ ...a, metadata: a.metadata });
    expect(ui.retired).toBe(false);
    expect(ui.retiredReason).toBeNull();
  });

  it('人工退场 → retired:true, retiredReason:"manual"', async () => {
    const { store } = await setup();
    await store.appendNew([rec('a1', '要退场的记忆')]);
    expect(store.retire(['a1'], { at: AT, reason: 'manual' })).toBe(1);
    const [a] = store.getByIds(['a1']);
    // 门1 解耦:retire 不再闭合 valid_to(它回归现实有效期)，UiRecord 的 retired 改判 marker。
    expect(a.validTo).toBeUndefined();
    expect(a.metadata && (a.metadata as Record<string, unknown>).dsh_superseded).toBeDefined();
    const ui = hitToUiRecord({ ...a, metadata: a.metadata });
    expect(ui.retired).toBe(true);
    expect(ui.retiredReason).toBe('manual');
  });

  it('取代退场 → retired:true, retiredReason:"superseded"', async () => {
    const { store } = await setup();
    await store.appendNew([rec('a1', '被取代的记忆')]);
    expect(store.retire(['a1'], { at: AT, reason: 'superseded', by: 'mem_new_1' })).toBe(1);
    const [a] = store.getByIds(['a1']);
    const ui = hitToUiRecord({ ...a, metadata: a.metadata });
    expect(ui.retired).toBe(true);
    expect(ui.retiredReason).toBe('superseded');
  });

  it('缺 validTo 的对象恒为未退场(检索命中形态,无退场判据)', () => {
    const ui = hitToUiRecord({
      id: 'x',
      content: 'c',
      type: 'work_fact',
      scene_name: 's',
      metadata: {},
    });
    expect(ui.retired).toBe(false);
    expect(ui.retiredReason).toBeNull();
  });
});
