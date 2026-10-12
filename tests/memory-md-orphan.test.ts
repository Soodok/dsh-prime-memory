/**
 * 孤儿投射文件的归档（P4.4）——真 L1Store + 真账本 + 真磁盘。
 *
 * 每条用例都钉一个“搬错了比不搬更糟”的形状：
 *   - 只搬有账可查的：账本里没有的来路不明文件可能是**人放进去等着被同步的输入**；
 *   - `.disable` 兄弟不算孤儿：那个后缀是 N11 失效凭证的唯一文件侧表达；
 *   - 越界 relPath 不许借归档手续把文件写到目录外；
 *   - 护栏吃配额的方式不能把孤儿扫不到却报“没孤儿”。
 */
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { L1Store } from '../src/store/l1.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { MdLedgerStore } from '../src/store/memory-md-ledger.js';
import { exportRecords } from '../src/store/memory-md-export.js';
import { resolveMemoriesRoot, disablePathOf } from '../src/store/memory-md.js';
import { sweepOrphanFiles } from '../src/store/memory-md-orphan.js';
import type { EmbeddingService } from '../src/store/embedding.js';
import type { MemoryRecord } from '../src/types.js';

const DIM = 16;
const dirs: string[] = [];
const dbs: MemoryDb[] = [];

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

function rec(id: string, content: string, extra: Partial<MemoryRecord> = {}): MemoryRecord {
  const t = Date.parse('2026-10-12T00:00:00Z');
  return { id, content, type: 'work_fact', priority: 60, scene_name: 's', timestamps: [t], createdAt: t, updatedAt: t, ...extra };
}

async function setup(recordList: MemoryRecord[]) {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-mdorphan-'));
  dirs.push(dataDir);
  const db = new MemoryDb(join(dataDir, 'm.db'), DIM);
  db.init();
  dbs.push(db);
  const store = new L1Store(dataDir, db, fakeEmbed(), 'hybrid', undefined, 0);
  await store.init();
  await store.appendNew(recordList);
  const ledger = new MdLedgerStore(dataDir);
  await ledger.init();
  const root = resolveMemoriesRoot(undefined, dataDir);
  const archiveRoot = join(dataDir, 'archive-in');
  const run = (opts: { dryRun: boolean; maxFiles?: number }) => sweepOrphanFiles({
    records: store.all(),
    cfgRoot: undefined,
    dataDir,
    ledger,
    dryRun: opts.dryRun,
    maxFiles: opts.maxFiles ?? 1000,
    timeBudgetMs: 60_000,
    archiveRoot,
  });
  return { dataDir, db, store, ledger, root, archiveRoot, run };
}

const exists = (p: string) => stat(p).then(() => true, () => false);

describe('sweepOrphanFiles', () => {
  it('改名留下的旧路径才算孤儿：干跑不动任何东西，真跑搬走并删账', async () => {
    const { dataDir, store, ledger, root, archiveRoot, run } = await setup([rec('o1', '上行必须走官方地址', { name: 'old-name' })]);
    await exportRecords({ records: store.all(), cfgRoot: undefined, dataDir, ledger, maxRecords: 100, timeBudgetMs: 60_000 });
    const oldPath = join(root, 'work_fact', 'old-name.memory.md');
    expect(await exists(oldPath)).toBe(true);

    // 人（或消歧器）改了名：旧路径没人认领了，账本还记着它。
    expect(store.rename('o1', 'new-name').ok).toBe(true);

    const preview = await run({ dryRun: true });
    expect(preview.dryRun).toBe(true);
    expect(preview.orphans).toBe(1);
    expect(preview.moved).toBe(0);
    expect(preview.dir).toBe('');
    expect(preview.samples[0]?.reason).toBe('orphan');
    // 干跑真的什么都没动。
    expect(await exists(oldPath)).toBe(true);
    expect(ledger.allWithKeys().some((r) => r.path === oldPath)).toBe(true);

    const gone = await run({ dryRun: false });
    expect(gone.dryRun).toBe(false);
    expect(gone.moved).toBe(1);
    expect(gone.dir.startsWith(archiveRoot)).toBe(true);
    expect(await exists(oldPath)).toBe(false);
    // 账本条目跟着删了（留着下一轮对账会一直报“文件缺失”）。
    expect(ledger.allWithKeys().some((r) => r.path === oldPath)).toBe(false);
    // 归档里保住了 `<home>/<类型>/<名>` 的相对形状与原文。
    const archived = join(gone.dir, 'home', 'work_fact', 'old-name.memory.md');
    expect(await exists(archived)).toBe(true);
    expect(await readFile(archived, 'utf8')).toContain('上行必须走官方地址');

    // 第三次：账本里已经没有那条旧路径了（跟着文件一起搬走），故扫描面为空。
    const again = await run({ dryRun: true });
    expect(again.scanned).toBe(0);
    expect(again.orphans).toBe(0);
    expect(again.claimed).toBe(0);
  });

  it('来路不明的文件一律不动（那可能是人放进去等着被同步的输入）', async () => {
    const { dataDir, store, ledger, root, run } = await setup([rec('p1', '正经记录', { name: 'legit' })]);
    await exportRecords({ records: store.all(), cfgRoot: undefined, dataDir, ledger, maxRecords: 100, timeBudgetMs: 60_000 });
    const stranger = join(root, 'work_fact', 'handwritten.memory.md');
    await writeFile(stranger, '人手写的、账本里没有的内容', 'utf8');

    const rep = await run({ dryRun: false });
    expect(rep.orphans).toBe(0);
    expect(rep.moved).toBe(0);
    expect(await exists(stranger)).toBe(true);
    expect(await readFile(stranger, 'utf8')).toBe('人手写的、账本里没有的内容');
  });

  it('`.disable` 兄弟不算孤儿（N11 的失效凭证必须留在原地）', async () => {
    const { dataDir, store, ledger, root, run } = await setup([rec('q1', '这条被判过时', { name: 'stale-one' })]);
    await exportRecords({ records: store.all(), cfgRoot: undefined, dataDir, ledger, maxRecords: 100, timeBudgetMs: 60_000 });
    const live = join(root, 'work_fact', 'stale-one.memory.md');
    const disabled = disablePathOf(live);
    await writeFile(disabled, await readFile(live, 'utf8'), 'utf8');
    await rm(live, { force: true });

    const rep = await run({ dryRun: false });
    expect(rep.orphans).toBe(0);
    expect(await exists(disabled)).toBe(true);
  });

  it('退场记录仍认领自己的文件（清理之前它不是孤儿）', async () => {
    const { dataDir, store, ledger, root, run } = await setup([rec('s1', '已判过时但仍入库', { name: 'retired-file' })]);
    await exportRecords({ records: store.all(), cfgRoot: undefined, dataDir, ledger, maxRecords: 100, timeBudgetMs: 60_000 });
    store.retire(['s1'], { at: '2026-10-13T00:00:00.000Z', reason: 'obsolete' });

    const rep = await run({ dryRun: false });
    expect(rep.orphans).toBe(0);
    expect(rep.claimed).toBe(1);
    expect(await exists(join(root, 'work_fact', 'retired-file.memory.md'))).toBe(true);
  });

  it('账本 relPath 越界 → 记 failed 且不动文件（不许借归档手续写到目录外）', async () => {
    const { dataDir, store, ledger, root, archiveRoot, run } = await setup([rec('t1', '越界账本', { name: 'edge-case' })]);
    await exportRecords({ records: store.all(), cfgRoot: undefined, dataDir, ledger, maxRecords: 100, timeBudgetMs: 60_000 });
    store.rename('t1', 'renamed-away');
    // 手工把一条账本的 relPath 改成越界形状（模拟被人编辑过的账本文件）。
    const rows = ledger.allWithKeys();
    const bad = rows.find((r) => r.path.endsWith('edge-case.memory.md'))!;
    ledger.set(bad.path, { ...bad.entry, relPath: '../../escape.memory.md' });
    await ledger.flush();

    const rep = await run({ dryRun: false });
    expect(rep.orphans).toBe(1);
    expect(rep.failed).toBe(1);
    expect(rep.moved).toBe(0);
    expect(rep.samples.some((s) => s.reason === 'unsafe-relPath')).toBe(true);
    // 原文件还在投射目录里，没被搬走，也没在投射根之外造出文件。
    expect(await exists(join(root, 'work_fact', 'edge-case.memory.md'))).toBe(true);
    expect(await exists(join(dataDir, 'escape.memory.md'))).toBe(false);
    // 什么都没搬成 → 连批次目录都不该建（不留空转的归档目录）。
    expect(await exists(archiveRoot)).toBe(false);
    expect(await exists(join(dataDir, 'memories-orphans'))).toBe(false);
  });

  it('护栏只吃动作：前面一堆“仍被认领”不能把孤儿挡在窗外', async () => {
    // 这条直接对应本轮修掉的缺陷类：配额若数“遍历”，收敛的库会把配额全花在确认没差上，
    // 报告就会一边说 capped 一边说 orphans=0 —— 那是把谎报写进护栏。
    const many = Array.from({ length: 12 }, (_, i) => rec(`u${i}`, `认领记录 ${i}`, { name: `claimed-${i}` }));
    const { dataDir, store, ledger, root, run } = await setup(many);
    await exportRecords({ records: store.all(), cfgRoot: undefined, dataDir, ledger, maxRecords: 100, timeBudgetMs: 60_000 });
    // 改掉一条的名字：旧路径仍挂在账本里，但已经没记录认领它了。
    expect(store.rename('u11', 'claimed-11-moved').ok).toBe(true);

    // maxFiles=1：11 条“仍被认领”不吃配额，那个孤儿照样被抓到，也不会谎称 capped。
    const rep = await run({ dryRun: true, maxFiles: 1 });
    expect(rep.scanned).toBe(12);
    expect(rep.claimed).toBe(11);
    expect(rep.orphans).toBe(1);
    expect(rep.capped).toBe(false);
    expect(rep.remaining).toBe(0);
    expect(rep.samples[0]?.path.endsWith('claimed-11.memory.md')).toBe(true);
  });

  it('骨架文件 `_index.md` 不被当孤儿搬走（孤儿扫描只遍历账本键，不认它）', async () => {
    // 钉住判据：`sweepOrphanFiles` 的扫描面 = 账本键，而 `_index.md` 从不进账本 → 天然不在遍历集里。
    const { dataDir, store, ledger, root, run } = await setup([rec('w1', '正经记录', { name: 'keep-me' })]);
    await exportRecords({ records: store.all(), cfgRoot: undefined, dataDir, ledger, maxRecords: 100, timeBudgetMs: 60_000 });
    const idx = join(root, 'work_fact', '_index.md');
    const idxText = '# 工作事实\n\n- 类型: work_fact\n- 条数: 1\n';
    await writeFile(idx, idxText, 'utf8');

    const rep = await run({ dryRun: false });
    expect(rep.orphans).toBe(0);
    expect(rep.moved).toBe(0);
    expect(await exists(idx)).toBe(true);
    expect(await readFile(idx, 'utf8')).toBe(idxText);
    // 账本里根本没有这条骨架路径的键（扫描面与它无交集）。
    expect(ledger.allWithKeys().some((r) => r.path === idx)).toBe(false);
  });
});
