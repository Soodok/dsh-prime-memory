/**
 * 同一条记录被两份投射文件认领时的裁决单元（改名后**尚未**跑孤儿归档的那个窗口）。
 *
 * 形状是真机沙箱实测出来的：改名会让旧路径文件与旧账本条目都留着（搬走它们的是
 * `mem-orphans`，不是同步），于是同一条记录在一轮里被两个条目独立判象限。两份都被改过
 * 就是两次「仅文件变」回灌——**后跑的赢**，前一份人写的编辑静默丢失，而
 * 「两边都变就不动」按单条账本条目判、看不见对面那份。
 *
 * 三条用例一条都不能少：只钉"多路径时不动"会锁死正常编辑（只改一份时必须照旧回灌），
 * 只钉前两条又证明不了这扇窗出得去（归档后必须回到正常轨道）。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { L1Store } from '../src/store/l1.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { MdLedgerStore } from '../src/store/memory-md-ledger.js';
import { hashRecords } from '../src/store/l1-snapshot.js';
import { exportRecords } from '../src/store/memory-md-export.js';
import { syncFromFiles } from '../src/pipeline/md-sync.js';
import { sweepOrphanFiles } from '../src/store/memory-md-orphan.js';
import type { EmbeddingService } from '../src/store/embedding.js';
import type { MemoryRecord } from '../src/types.js';

const DIM = 16;
const dirs: string[] = [];
const dbs: MemoryDb[] = [];
const logger = { info: () => {}, warn: () => {}, error: () => {} } as never;

afterAll(async () => {
  for (const db of dbs) db.close();
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

function fakeEmbed(): EmbeddingService {
  return {
    getDimensions: () => DIM,
    getProviderInfo: () => ({ provider: 'probe', model: 'probe', dimensions: DIM }),
    isReady: () => true,
    embed: async () => new Float32Array(DIM),
    embedBatch: async (ts: string[]) => ts.map(() => new Float32Array(DIM)),
  };
}

const BODY = '结论：npm publish 必须显式带 registry。依据：默认指向镜像会错投。';

/** 建库 → 导出 → 改名 → 再导出：盘上同一条记录留下旧路径 + 新路径两份，账本两条目。 */
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-mdmulti-'));
  dirs.push(dataDir);
  const db = new MemoryDb(join(dataDir, 'm.db'), DIM);
  db.init();
  dbs.push(db);
  const store = new L1Store(dataDir, db, fakeEmbed(), 'hybrid', undefined, 0, undefined, () => true);
  await store.init();
  const r = Date.parse('2026-10-13T00:00:00Z');
  const rec: MemoryRecord = { id: 'r1', content: BODY, type: 'work_fact', priority: 60, scene_name: 's', timestamps: [r], createdAt: r, updatedAt: r, name: 'alpha-name' };
  await store.appendNew([rec]);
  const ledger = new MdLedgerStore(dataDir);
  await ledger.init();
  const exp = () => exportRecords({ records: store.all(), cfgRoot: undefined, dataDir, ledger, maxRecords: 100, timeBudgetMs: 60_000, logger });
  const sync = () => syncFromFiles({ store, ledger, cfgRoot: undefined, dataDir, maxFiles: 100, timeBudgetMs: 60_000, logger });
  const sweep = async (dryRun: boolean) => sweepOrphanFiles({ records: store.all(), cfgRoot: undefined, dataDir, ledger, dryRun, maxFiles: 100, timeBudgetMs: 60_000, logger });
  await exp();
  store.rename('r1', 'beta-name');
  await exp();
  const at = (name: string): string => join(dataDir, 'memories', 'work_fact', `${name}.memory.md`);
  return { dataDir, store, ledger, db, exp, sync, sweep, oldPath: at('alpha-name'), newPath: at('beta-name') };
}

async function edit(path: string, mark: string): Promise<void> {
  const text = await readFile(path, 'utf8');
  await writeFile(path, `${text}\n${mark}\n`, 'utf8');
}

describe('同记录多路径（改名未归档的窗口）', () => {
  it('两份都被改 → 一律不动、计入 multiPath，库与两份文件都保持原样', async () => {
    const f = await fixture();
    // 前置：这一步确实留下了两份文件、两条账本条目（否则本用例测的是别的东西）。
    expect(f.ledger.all().length).toBe(2);

    await edit(f.oldPath, 'OLD-EDIT');
    await edit(f.newPath, 'NEW-EDIT');
    const before = hashRecords(f.store.all());

    const rep = await f.sync();
    expect(rep.imported).toBe(0);
    expect(rep.rendered).toBe(0);
    expect(rep.multiPath).toBe(2);
    expect(hashRecords(f.store.all())).toBe(before);
    // 两份文件都还在、各自的编辑都没被对面覆盖，也没被机器重写掉。
    expect(await readFile(f.oldPath, 'utf8')).toContain('OLD-EDIT');
    expect(await readFile(f.newPath, 'utf8')).toContain('NEW-EDIT');
    // 样本必须说清"为什么不动"，否则面板上就是一个没人能解释的数字。
    expect(rep.samples.some((s) => s.action.includes('同记录多路径'))).toBe(true);
  });

  it('只改一份（哪怕是旧路径那份）→ 照旧回灌，不把正常编辑也锁住', async () => {
    const f = await fixture();
    await edit(f.oldPath, 'ONLY-OLD');
    const rep = await f.sync();
    expect(rep.multiPath).toBe(0);
    expect(rep.imported).toBe(1);
    expect(String(f.store.getByIds(['r1'])[0]?.content ?? '')).toContain('ONLY-OLD');
  });

  it('把旧残片交给孤儿归档后，同一轮判定回到正常轨道', async () => {
    const f = await fixture();
    await edit(f.oldPath, 'OLD-EDIT');
    await edit(f.newPath, 'NEW-EDIT');
    expect((await f.sync()).multiPath).toBe(2);

    // 正规解法不是"再改一次文件"，而是让归档把没人认领的旧路径搬走（不删）。
    const dry = await f.sweep(true);
    expect(dry.orphans).toBe(1);
    const wet = await f.sweep(false);
    expect(wet.moved).toBe(1);
    expect(await readFile(f.oldPath, 'utf8').then(() => true).catch(() => false)).toBe(false);

    // 旧那份没了 → 只剩权威路径一份 → 它的编辑正常回灌，multiPath 归零。
    const rep = await f.sync();
    expect(rep.multiPath).toBe(0);
    expect(rep.imported).toBe(1);
    expect(String(f.store.getByIds(['r1'])[0]?.content ?? '')).toContain('NEW-EDIT');
    // 再跑一轮同步与导出都应零动作（不留下写回环）。
    const again = await f.sync();
    expect([again.imported, again.rendered, again.multiPath]).toEqual([0, 0, 0]);
  });
});
