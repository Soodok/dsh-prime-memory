/**
 * `dsh-memory/mem-orphans` 的门与接线（P4.4 的后端那一半）。
 *
 * 面板那两枚按钮只是这个端点的壳，所以这里钉的是"按下去到底发生什么"：
 *   - 默认**干跑**（省略 dryRun 即 true）：高权限没开也能动，因为什么都没动；
 *   - 真搬必须高权限；
 *   - 配置门在装配门之前（整面关着时该听到的是"没开"，不是"没装配"）。
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { handleEndpoint, type EndpointDeps } from '../src/stats.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { L1Store } from '../src/store/l1.js';
import { MdLedgerStore } from '../src/store/memory-md-ledger.js';
import { exportRecords } from '../src/store/memory-md-export.js';
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

async function deps(opts: { mutate?: boolean } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-morphans-ep-'));
  dirs.push(dataDir);
  const db = new MemoryDb(join(dataDir, 'o.db'), DIM);
  db.init();
  dbs.push(db);
  const store = new L1Store(dataDir, db, fakeEmbed(), 'hybrid', undefined, 0);
  await store.init();
  await store.appendNew([rec('r1', '上行必须走官方地址', { name: 'official-uplink' })]);
  const ledger = new MdLedgerStore(dataDir);
  await ledger.init();
  const d = {
    ctx: { on: () => {}, inject: () => {} } as never,
    cfg: {
      memExport: { enabled: true, root: '', maxRecords: 300, timeBudgetMs: 60_000 },
    } as never,
    stores: { l1: store, mdLedger: ledger } as never,
    live: { get: () => ({ memoryMutate: opts.mutate === true }) } as never,
    dataDir,
    logger: noopLogger,
  } as unknown as EndpointDeps;
  return { d, store, ledger, dataDir };
}

describe('dsh-memory/mem-orphans', () => {
  it('省略 dryRun 即干跑：不需要高权限，且不搬任何东西', async () => {
    const { d, store, ledger, dataDir } = await deps();
    await exportRecords({ records: store.all(), cfgRoot: undefined, dataDir, ledger, maxRecords: 100, timeBudgetMs: 60_000 });
    store.rename('r1', 'renamed-away');
    const memoriesDir = join(dataDir, 'memories', 'work_fact');
    const before = await readdir(memoriesDir);
    expect(before).toContain('official-uplink.memory.md');

    const rep = await handleEndpoint('dsh-memory/mem-orphans', {}, d) as { dryRun: boolean; orphans: number; moved: number };
    expect(rep.dryRun).toBe(true);
    expect(rep.orphans).toBe(1);
    expect(rep.moved).toBe(0);
    expect(await readdir(memoriesDir)).toEqual(before);
  });

  it('真搬要高权限：没开就明确报出去', async () => {
    const { d } = await deps();
    await expect(handleEndpoint('dsh-memory/mem-orphans', { dryRun: false }, d))
      .rejects.toThrow('高权限');
  });

  it('功能关着 → 报"未开启"，连账本都不查', async () => {
    const { d } = await deps();
    (d.cfg as unknown as { memExport: { enabled: boolean } }).memExport.enabled = false;
    await expect(handleEndpoint('dsh-memory/mem-orphans', {}, d)).rejects.toThrow('未开启');
  });

  it('账本未装配 → 明确报错（不是静默空报告）', async () => {
    const { d } = await deps();
    (d.stores as unknown as { mdLedger?: unknown }).mdLedger = undefined;
    await expect(handleEndpoint('dsh-memory/mem-orphans', {}, d)).rejects.toThrow('账本未装配');
  });
});
