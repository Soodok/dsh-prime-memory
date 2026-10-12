/**
 * workspace 内容路由的端到端回归（真 MemoryDb + FTS，不 mock 存储）。
 *
 * 钉住 re-link 的四条承诺——每条都对应一个会静默坏掉的地方：
 *   1. **干跑不写库**（默认 dry-run 是这功能的门面，漏挡一次就当场改用户数据）；
 *   2. **绝不碰 `updated_time`**（它在 `canonicalRecords` 哈希字段表里，动了=旧快照永久
 *      verify 不通过；又是时效衰减与列表排序的输入）；
 *   3. **`l1_fts` 的 workspace_id 同步**（检索过滤读的是 FTS 行自带的列，只改主表会让
 *      关键词路与向量路按不同归属过滤）；
 *   4. **幂等**（第二次跑 unchanged==matched、written==0；不幂等的回填会无限刷 WAL）；
 *   外加一条可见性不变：`scope` 保持 global，回填后检索照样命中。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { L1Store } from '../src/store/l1.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { relinkWorkspaces } from '../src/pipeline/workspace-relink.js';
import type { WorkspaceRoute } from '../src/workspace-route.js';
import type { EmbeddingService } from '../src/store/embedding.js';
import type { MemoryRecord } from '../src/types.js';

const DIM = 16;
const ROUTES: WorkspaceRoute[] = [
  { path: 'E:\\test\\rewrite-agently\\.agents', anyOf: ['dsh', 'cordis', 'prime-memory'], noneOf: [] },
  { path: 'E:\\test\\agent-no-dsh', anyOf: ['hanako', 'inferglow'], noneOf: ['dsh'] },
];
const DIR_AGENT = 'e:\\test\\rewrite-agently\\.agents';
const DIR_NO_DSH = 'e:\\test\\agent-no-dsh';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

function vecFor(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (let i = 0; i < text.length; i++) v[text.charCodeAt(i) % DIM] += 1;
  const mag = Math.sqrt(v.reduce((s, x) => s + (x as number) * (x as number), 0));
  if (mag > 1e-10) for (let i = 0; i < DIM; i++) v[i] /= mag;
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

function rec(id: string, content: string): MemoryRecord {
  const t = Date.now();
  return { id, content, type: 'work_fact', priority: 60, scene_name: 's', timestamps: [t], createdAt: t, updatedAt: t };
}

async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-wsroute-'));
  dirs.push(dataDir);
  const dbPath = join(dataDir, 'w.db');
  const db = new MemoryDb(dbPath, DIM);
  db.init();
  const store = new L1Store(dataDir, db, fakeEmbed(), 'hybrid', undefined, 0);
  await store.init();
  await store.appendNew([
    rec('r_dsh', 'dsh-prime-memory 的反刍计数没有持久化'),
    rec('r_hana', 'Hanako 的 asar 是明文未加密的'),
    rec('r_coffee', '咖啡豆每周采购一次'),
  ]);
  return { db, dbPath, store };
}

const faceOf = (store: L1Store) => ({
  list: (o: { limit: number; offset: number }) => store.list(o),
  setWorkspaceIds: (items: ReadonlyArray<{ id: string; workspaceId: string }>) => store.setWorkspaceIds(items),
});

const wsOf = (store: L1Store, id: string): string | undefined => store.getByIds([id])[0]?.workspaceId;
const updatedOf = (store: L1Store, id: string): number | undefined => store.getByIds([id])[0]?.updatedAt;
/** FTS 行自带的 workspace_id（FTS5 是内置模块，裸连接读得动）。 */
function ftsWorkspace(dbPath: string, id: string): string | undefined {
  const raw = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = raw.prepare('SELECT workspace_id FROM l1_fts WHERE record_id = ?').get(id) as { workspace_id?: string } | undefined;
    return row?.workspace_id;
  } finally {
    raw.close();
  }
}

describe('workspace 内容路由 re-link', () => {
  it('干跑：只出报告，一列都不写', async () => {
    const { db, store } = await setup();
    const report = await relinkWorkspaces({ l1: faceOf(store), routes: ROUTES });
    expect(report.dryRun).toBe(true);
    expect(report.scanned).toBe(3);
    expect(report.matched).toBe(2);
    expect(report.written, '干跑不得写库').toBe(0);
    expect(report.toWrite, '干跑要把“若真跑会写多少”报出来，否则用户看不到影响面').toBe(2);
    expect(report.byWorkspace[DIR_AGENT]).toBe(1);
    expect(report.byWorkspace[DIR_NO_DSH]).toBe(1);
    expect(wsOf(store, 'r_dsh'), '干跑不得写归属').toBeFalsy();
    expect(wsOf(store, 'r_coffee'), '未命中的绝不写').toBeFalsy();
    db.close();
  });

  it('真写：归属正确、scope 与 updated_time 都不动、FTS 同步、检索可见性不变', async () => {
    const { db, dbPath, store } = await setup();
    const before = updatedOf(store, 'r_dsh');
    const report = await relinkWorkspaces({ l1: faceOf(store), routes: ROUTES, dryRun: false });
    expect(report.written).toBe(2);
    expect(wsOf(store, 'r_dsh')).toBe(DIR_AGENT);
    expect(wsOf(store, 'r_hana')).toBe(DIR_NO_DSH);
    expect(wsOf(store, 'r_coffee'), '宁缺勿猜：不命中就不写').toBeFalsy();

    // ① updated_time 必须逐字不动（它进快照哈希，也是衰减/排序的输入）
    expect(updatedOf(store, 'r_dsh')).toBe(before);
    // ② scope 不被改写 → 回填不改变可见性
    expect(store.getByIds(['r_dsh'])[0]?.scope ?? 'global').toBe('global');
    const hits = await store.search('咖啡豆', 5);
    expect(hits.map((h) => h.id)).toContain('r_coffee');
    const dshHits = await store.search('dsh-prime-memory 反刍', 5);
    expect(dshHits.map((h) => h.id), '归属不该让它看不见').toContain('r_dsh');

    // ③ FTS 行同步（只改主表就是这条断言抓到的）
    expect(ftsWorkspace(dbPath, 'r_dsh')).toBe(DIR_AGENT);
    expect(ftsWorkspace(dbPath, 'r_hana')).toBe(DIR_NO_DSH);
    db.close();
  });

  it('幂等：第二次跑 unchanged==matched、written==0', async () => {
    const { db, store } = await setup();
    await relinkWorkspaces({ l1: faceOf(store), routes: ROUTES, dryRun: false });
    const again = await relinkWorkspaces({ l1: faceOf(store), routes: ROUTES, dryRun: false });
    expect(again.matched).toBe(2);
    expect(again.unchanged).toBe(2);
    expect(again.written).toBe(0);
    db.close();
  });

  it('空路由表（功能关）→ 零扫描零写入', async () => {
    const { db, store } = await setup();
    const report = await relinkWorkspaces({ l1: faceOf(store), routes: [], dryRun: false });
    expect(report.scanned).toBe(0);
    expect(report.written).toBe(0);
    expect(wsOf(store, 'r_dsh')).toBeFalsy();
    db.close();
  });

  it('受 maxRecords 截断时 remaining 如实报出（可重入的凭据）', async () => {
    const { db, store } = await setup();
    const report = await relinkWorkspaces({ l1: faceOf(store), routes: ROUTES, dryRun: false, maxRecords: 1 });
    // 只断言与顺序无关的量：扫了几条、还剩几条。首条是否命中取决于 list() 的排序，
    // 把 written/matched 写死会变成靠插入顺序碰运气的 flaky 断言。
    expect(report.scanned).toBe(1);
    expect(report.remaining).toBe(2);
    expect(report.matched).toBeLessThanOrEqual(1);
    db.close();
  });
});
