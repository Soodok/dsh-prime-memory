/**
 * `mem-export` / `mem-reconcile` 两个端点的门与接线（N8 的后端那一半）。
 *
 * 面板那三枚按钮最终只是这两个端点的壳，所以这里钉的是"按钮按下去到底会发生什么"：
 *   - 功能没开 → 明确报"未开启（cfg.memExport.enabled）"，而不是静默返回空报告
 *     （面板把这行原样显示，用户才知道为什么点了没动）；
 *   - 账本未装配 → 同样明确报错，不假装成功；
 *   - 开着时导出真的落盘，且**一字不改库**。
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { handleEndpoint, type EndpointDeps } from '../src/stats.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { L1Store } from '../src/store/l1.js';
import { MdLedgerStore } from '../src/store/memory-md-ledger.js';
import { hashRecords } from '../src/store/l1-snapshot.js';
import type { EmbeddingService } from '../src/store/embedding.js';
import type { MemoryRecord } from '../src/types.js';

const DIM = 16;
const dirs: string[] = [];
const dbs: MemoryDb[] = [];
afterAll(async () => {
  for (const db of dbs) db.close();
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} } as never;
function fakeEmbed(): EmbeddingService {
  return {
    getDimensions: () => DIM,
    getProviderInfo: () => ({ provider: 'probe', model: 'probe', dimensions: DIM }),
    isReady: () => true,
    embed: async () => new Float32Array(DIM),
    embedBatch: async (ts: string[]) => ts.map(() => new Float32Array(DIM)),
  };
}

function rec(id: string, content: string, extra: Partial<MemoryRecord> = {}): MemoryRecord {
  const t = Date.parse('2026-10-12T00:00:00Z');
  return { id, content, type: 'work_fact', priority: 60, scene_name: 's', timestamps: [t], createdAt: t, updatedAt: t, ...extra };
}

async function deps(overrides: Record<string, unknown> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-memexport-ep-'));
  dirs.push(dataDir);
  const db = new MemoryDb(join(dataDir, 'e.db'), DIM);
  db.init();
  dbs.push(db);
  const store = new L1Store(dataDir, db, fakeEmbed(), 'hybrid', undefined, 0);
  await store.init();
  await store.appendNew([rec('r1', '上行必须走官方地址', { name: 'official-uplink' })]);
  const ledger = new MdLedgerStore(dataDir);
  await ledger.init();
  const base = {
    ctx: { on: () => {}, inject: () => {} } as never,
    cfg: { memExport: { enabled: true, root: '', maxRecords: 300, timeBudgetMs: 60_000 } } as never,
    stores: { l1: store } as never,
    dataDir,
    logger: noopLogger,
  };
  const d = { ...base, ...overrides } as unknown as EndpointDeps;
  return { d, store, ledger, dataDir };
}

describe('dsh-memory/mem-export', () => {
  it('账本未装配 → 明确报错（不是静默空报告）', async () => {
    const { d } = await deps();
    (d.stores as unknown as { mdLedger?: unknown }).mdLedger = undefined;
    await expect(handleEndpoint('dsh-memory/mem-export', {}, d)).rejects.toThrow('账本未装配');
  });

  it('开关关着 → 报"未开启"，且一个文件都不写', async () => {
    const { d, dataDir } = await deps();
    (d.cfg as unknown as { memExport: { enabled: boolean } }).memExport.enabled = false;
    await expect(handleEndpoint('dsh-memory/mem-export', {}, d)).rejects.toThrow('未开启');
    // 投射根压根没建过。
    const entries = await readdir(dataDir).catch(() => []);
    expect(entries).not.toContain('memories');
  });

  it('关着 → 抛错且骨架目录一个不建（红线：enabled=false 时零动作）', async () => {
    // 骨架接线在配置门之后（enabled!==true 已先抛），故关着时 ensureTypeSkeleton 根本到不了。
    const { d, dataDir } = await deps();
    (d.cfg as unknown as { memExport: { enabled: boolean } }).memExport.enabled = false;
    await expect(handleEndpoint('dsh-memory/mem-export', {}, d)).rejects.toThrow('未开启');
    const rootExists = await readdir(join(dataDir, 'memories')).then(() => true, () => false);
    expect(rootExists).toBe(false);
  });

  it('开着 → 落盘并回报计数，且库内容一字未改', async () => {
    const { d, store, ledger } = await deps();
    (d.stores as unknown as { mdLedger: MdLedgerStore }).mdLedger = ledger;
    const before = hashRecords(store.all());
    const rep = await handleEndpoint('dsh-memory/mem-export', {}, d) as {
      written: number; unchanged: number; remaining: number; root: string;
    };
    expect(rep.written).toBe(1);
    expect(rep.remaining).toBe(0);
    const files = await readdir(join(rep.root, 'work_fact'));
    expect(files).toContain('official-uplink.memory.md');
    expect(hashRecords(store.all())).toBe(before);
    await ledger.flush();
  });
});

describe('dsh-memory/mem-reconcile', () => {
  it('导出后对账 → 全 same；未导出前 → 全 firstTime', async () => {
    const { d, ledger } = await deps();
    (d.stores as unknown as { mdLedger: MdLedgerStore }).mdLedger = ledger;
    const first = await handleEndpoint('dsh-memory/mem-reconcile', {}, d) as { firstTime: number; same: number };
    expect(first.firstTime).toBe(1);
    expect(first.same).toBe(0);
    await handleEndpoint('dsh-memory/mem-export', {}, d);
    const again = await handleEndpoint('dsh-memory/mem-reconcile', {}, d) as { firstTime: number; same: number };
    expect(again.same).toBe(1);
    expect(again.firstTime).toBe(0);
    await ledger.flush();
  });

  it('对账是只读的：跑完账本条目数与库哈希都不动', async () => {
    const { d, store, ledger } = await deps();
    (d.stores as unknown as { mdLedger: MdLedgerStore }).mdLedger = ledger;
    await handleEndpoint('dsh-memory/mem-export', {}, d);
    const ledgerCount = ledger.all().length;
    const before = hashRecords(store.all());
    await handleEndpoint('dsh-memory/mem-reconcile', {}, d);
    expect(ledger.all().length).toBe(ledgerCount);
    expect(hashRecords(store.all())).toBe(before);
    await ledger.flush();
  });
});
