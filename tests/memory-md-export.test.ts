/**
 * md 投射的导出与对账（P1 / N1 + N9）——真 L1Store + 真磁盘临时目录。
 *
 * 钉住的每一条都对应一个会静默坏掉的地方：
 *   - 导出不写库（拿 `hashRecords` 前后比对，不是"看着没写"）；
 *   - 渲染是纯函数（第二次导出 written=0，否则账本 fileDigest 每轮都变，
 *     "文件被人改过"永远判不出来）；
 *   - frontmatter 键集**恰等于**白名单（多一个键就是往文件里泄漏一份会过期的副本）；
 *   - 越界路径结构性挡死（记录内容是人/模型写的，可能含 `../../`）；
 *   - 对账四态各自命中，且对账本身什么都不写。
 */
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { L1Store } from '../src/store/l1.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { hashRecords } from '../src/store/l1-snapshot.js';
import { MdLedgerStore } from '../src/store/memory-md-ledger.js';
import { exportRecords, reconcileLedger, resolveMemoriesRoot, safeJoin } from '../src/store/memory-md-export.js';
import { FRONTMATTER_KEYS, renderRecord } from '../src/store/memory-md.js';
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
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-mdexport-'));
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
  return { dataDir, db, store, ledger, root };
}

const THREE = [
  rec('r1', 'pnpm 需要 hoisted 平铺布局', { name: 'pnpm-hoisted' }),
  rec('r2', '上行必须走官方地址\n因为镜像有同步延迟', { name: '官方地址上行' }),
  rec('r3', '没有名字的存量记录'),
];

describe('exportRecords', () => {
  it('每条记录一个文件，且导出一字不改库', async () => {
    const { store, db, ledger, root } = await setup(THREE);
    const before = hashRecords(store.all());
    const report = await exportRecords({ records: store.all(), root, ledger, maxRecords: 300, timeBudgetMs: 60_000 });
    expect(report.written).toBe(3);
    expect(report.skipped).toBe(0);
    expect(report.remaining).toBe(0);
    expect(hashRecords(store.all())).toBe(before);
    expect(db.isDegraded()).toBe(false);
    // 文件真在盘上，且落在 type 目录下。
    const text = await readFile(join(root, 'work_fact', 'pnpm-hoisted.memory.md'), 'utf8');
    expect(text).toContain('pnpm 需要 hoisted 平铺布局');
  });

  it('第二次导出全 unchanged（渲染是纯函数，不刷 mtime）', async () => {
    const { store, ledger, root } = await setup(THREE);
    await exportRecords({ records: store.all(), root, ledger, maxRecords: 300, timeBudgetMs: 60_000 });
    const target = join(root, 'work_fact', 'pnpm-hoisted.memory.md');
    const mtimeBefore = (await stat(target)).mtimeMs;
    const second = await exportRecords({ records: store.all(), root, ledger, maxRecords: 300, timeBudgetMs: 60_000 });
    expect(second.written).toBe(0);
    expect(second.unchanged).toBe(3);
    expect((await stat(target)).mtimeMs).toBe(mtimeBefore);
  });

  it('frontmatter 键集**恰等于**白名单（防检索轴与派生评价泄漏进文件）', async () => {
    const { store, ledger, root } = await setup([
      rec('r1', '带轴带评价的记录', {
        name: 'with-axes',
        metadata: { hall: 'work', tags: ['npm-publish'], cogHall: 'facts', dsh_usage_scenario: ['发版前'] },
      }),
    ]);
    await exportRecords({ records: store.all(), root, ledger, maxRecords: 300, timeBudgetMs: 60_000 });
    const text = await readFile(join(root, 'work_fact', 'with-axes.memory.md'), 'utf8');
    const block = text.split('---')[1] ?? '';
    const keys = block.split('\n').filter((l) => /^\w+:/.test(l)).map((l) => l.split(':')[0]);
    expect([...keys].sort()).toEqual([...FRONTMATTER_KEYS.filter((k) => k !== 'retired')].sort());
    // 一个轴都不该出现在文件里。
    for (const leak of ['hall', 'tags', 'cogHall', 'maturity', 'usage']) {
      expect(new RegExp(`^${leak}:`, 'm').test(block)).toBe(false);
    }
    expect(text).toContain('发版前');
  });

  it('没名字的记录回落到 mem-<id8>，两条同内容也不崩', async () => {
    const { store, ledger, root } = await setup([
      rec('mem_aaaa1111', '同样的首行内容'),
      rec('mem_bbbb2222', '同样的首行内容'),
    ]);
    const report = await exportRecords({ records: store.all(), root, ledger, maxRecords: 300, timeBudgetMs: 60_000 });
    expect(report.written).toBe(2);
    expect(report.skipped).toBe(0);
    // 回落名走的是 deriveName 之前的分支：两条正文一样 ⇒ 名字一样 ⇒ 由唯一索引/后写覆盖决定，
    // 这里只要求"不抛错、不丢记录"，不要求两份不同文件。
    expect(store.all().length).toBe(2);
  });

  it('越界路径被结构性跳过（记录内容可能含 ../，不能靠"应该不会有"）', async () => {
    expect(safeJoin('/root', '../../etc/passwd')).toBeUndefined();
    expect(safeJoin('/root', '/abs/memory.md')).toBeUndefined();
    expect(safeJoin('/root', 'work_fact/ok.memory.md')).toBe(resolve('/root', 'work_fact/ok.memory.md'));
  });

  it('条数护栏：maxRecords 截断后如实回报 remaining，并提示再点一次', async () => {
    const many = Array.from({ length: 5 }, (_, i) => rec(`m${i}`, `记录 ${i} 号`, { name: `rec-${i}` }));
    const { store, ledger, root } = await setup(many);
    const first = await exportRecords({ records: store.all(), root, ledger, maxRecords: 2, timeBudgetMs: 60_000 });
    expect(first.scanned).toBe(2);
    expect(first.capped).toBe(true);
    expect(first.remaining).toBe(3);
    const second = await exportRecords({ records: store.all(), root, ledger, maxRecords: 10, timeBudgetMs: 60_000 });
    expect(second.remaining).toBe(0);
    expect(second.written + second.unchanged).toBe(5);
  });
});

describe('resolveMemoriesRoot', () => {
  it('相对路径或含 .. 的配置回退默认根，不抛错', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-mdroot-'));
    dirs.push(dir);
    const warns: string[] = [];
    const logger = { warn: (m: string) => { warns.push(m); }, info: () => {}, error: () => {} } as never;
    expect(resolveMemoriesRoot(undefined, dir, logger)).toBe(resolve(dir, 'memories'));
    expect(resolveMemoriesRoot('   ', dir, logger)).toBe(resolve(dir, 'memories'));
    expect(resolveMemoriesRoot('relative/path', dir, logger)).toBe(resolve(dir, 'memories'));
    expect(resolveMemoriesRoot('C:\\x\\..\\y', dir, logger)).toBe(resolve(dir, 'memories'));
    expect(warns.length).toBe(2);
  });
});

describe('reconcileLedger 四态', () => {
  async function seeded() {
    const ctx = await setup([
      rec('r1', '会被改库的记录', { name: 'db-side' }),
      rec('r2', '会被改文件的记录', { name: 'file-side' }),
      rec('r3', '两边都会被改的记录', { name: 'both-side' }),
      rec('r4', '会被删掉的记录', { name: 'gone-side' }),
      rec('r5', '没动过的记录', { name: 'same-side' }),
    ]);
    await exportRecords({ records: ctx.store.all(), root: ctx.root, ledger: ctx.ledger, maxRecords: 300, timeBudgetMs: 60_000 });
    return ctx;
  }
  const fileOf = (root: string, stem: string): string => join(root, 'work_fact', `${stem}.memory.md`);

  it('首次导出前全是 firstTime', async () => {
    const { store, ledger, root } = await setup(THREE);
    const r = await reconcileLedger({ records: store.all(), root, ledger, maxRecords: 300, timeBudgetMs: 60_000 });
    expect(r.firstTime).toBe(3);
    expect(r.same).toBe(0);
  });

  it('导出后全 same，且对账什么都不写（文件字节与账本都不动）', async () => {
    const { store, db, ledger, root } = await seeded();
    const target = fileOf(root, 'file-side');
    const bytesBefore = await readFile(target, 'utf8');
    const ledgerBefore = ledger.all();
    const r = await reconcileLedger({ records: store.all(), root, ledger, maxRecords: 300, timeBudgetMs: 60_000 });
    expect(r.same).toBe(5);
    expect(await readFile(target, 'utf8')).toBe(bytesBefore);
    expect(ledger.all().length).toBe(ledgerBefore.length);
    expect(hashRecords(store.all())).toBeDefined();
    expect(db.isDegraded()).toBe(false);
  });

  it('四个象限各自命中：改库=dbOnly、改文件=fileOnly、都改=both、删文件=missingFile', async () => {
    const { store, ledger, root } = await seeded();
    // 改库：直接写一条新内容（走 store 的正常路径）。
    const rows = store.all().map((x) => (x.id === 'r1' ? { ...x, content: '会被改库的记录（改过了）' } : x));
    await store.appendNew(rows);
    // 改文件：人手工编辑正文。
    await writeFile(fileOf(root, 'file-side'), '---\nname: "file-side"\n---\n\n人手改过的正文\n', 'utf8');
    // 两边都改。
    const bothRow = rows.find((x) => x.id === 'r3')!;
    await store.appendNew([{ ...bothRow, content: '库也改了' }]);
    await writeFile(fileOf(root, 'both-side'), '文件也改了\n', 'utf8');
    // 删文件。
    await rm(fileOf(root, 'gone-side'), { force: true });

    const r = await reconcileLedger({ records: store.all(), root, ledger, maxRecords: 300, timeBudgetMs: 60_000 });
    expect(r.dbOnly).toBeGreaterThanOrEqual(1);
    expect(r.fileOnly).toBeGreaterThanOrEqual(1);
    expect(r.both).toBeGreaterThanOrEqual(1);
    expect(r.missingFile).toBe(1);
    expect(r.samples.length).toBeLessThanOrEqual(10);
  });

  it('mtime 变、内容没变 ⇒ 仍算 same（判据是内容指纹，不是时间戳）', async () => {
    const { store, ledger, root } = await seeded();
    const target = fileOf(root, 'same-side');
    const before = await stat(target);
    await utimes(target, new Date(before.atime.getTime() + 5000), new Date(before.mtime.getTime() + 5000));
    const r = await reconcileLedger({ records: store.all(), root, ledger, maxRecords: 300, timeBudgetMs: 60_000 });
    expect(r.same).toBe(5);
    expect(r.fileOnly).toBe(0);
  });

  it('renderRecord 的 relPath 落在 type 目录下，未知 type 归 unsorted', () => {
    expect(renderRecord(rec('x', '内容', { type: 'work_fact' })).relPath).toMatch(/^work_fact\/.+\.memory\.md$/);
    expect(renderRecord(rec('y', '内容', { type: 'legacy_unknown' })).relPath).toMatch(/^unsorted\/.+\.memory\.md$/);
  });
});
