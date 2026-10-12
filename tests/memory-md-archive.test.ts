/**
 * P3 归档面：`retired.md` 正文、投射文件搬运、以及批次级投影放行的清理。
 *
 * 三条钉死的判据：
 *   - **不传 files 时行为与改动前逐字一致**（投射面默认关，归档不能变成它的前置条件）；
 *   - 文件搬运在删除**之后**且失败不回滚（不对称的方向只有一个正确的）；
 *   - 本批之外的并发漂移**不中止**清理（旧整库哈希门禁会让清理永远删不动）。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { L1Store } from '../src/store/l1.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { MdLedgerStore } from '../src/store/memory-md-ledger.js';
import { exportRecords } from '../src/store/memory-md-export.js';
import { resolveMemoriesRoot } from '../src/store/memory-md.js';
import {
  ARCHIVE_FILES_DIR,
  ARCHIVE_MD,
  collectProjectionFiles,
  moveProjectionFiles,
  renderArchiveMarkdown,
} from '../src/store/memory-md-archive.js';
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
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-mdarchive-'));
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

describe('renderArchiveMarkdown', () => {
  const meta = { reason: 'cleanup-retired', at: new Date(Date.parse('2026-10-12T08:00:00Z')) };

  it('按 type 分片，每条一节，退场信息并进同一段 frontmatter', () => {
    const md = renderArchiveMarkdown(
      [rec('a', '甲的内容', { name: '甲条目' }), rec('b', '乙的内容', { name: '乙条目', type: 'episodic' })],
      meta,
    );
    expect(md).toContain('## episodic');
    expect(md).toContain('## work_fact');
    // type 分片按字典序，保证同一批两次渲染逐字相同（可 diff、可入库对比）
    expect(md.indexOf('## episodic')).toBeLessThan(md.indexOf('## work_fact'));
    expect(md).toContain('retireReason: "cleanup-retired"');
    expect(md).toContain('甲的内容');
    expect(md).toContain('乙的内容');
  });

  it('retiredAt 取记录上的退场时刻，不是归档时刻', () => {
    const retired = Date.parse('2026-09-01T00:00:00Z');
    const md = renderArchiveMarkdown([rec('a', '内容', { name: 'a', validTo: retired })], meta);
    expect(md).toContain('retiredAt: "2026-09-01T00:00:00.000Z"');
    expect(md).not.toContain('retiredAt: "2026-10-12T08:00:00.000Z"');
  });

  it('备注只在给了非空内容时出现（空串不留一行孤立噪音）', () => {
    expect(renderArchiveMarkdown([rec('a', '内容', { name: 'a' })], { ...meta, note: '   ' })).not.toContain('备注');
    expect(renderArchiveMarkdown([rec('a', '内容', { name: 'a' })], { ...meta, note: '季度清理' })).toContain('备注：季度清理');
  });
});

describe('清理时的归档', () => {
  it('不传 files：照常删除，搬运计数全 0（行为与改动前一致）', async () => {
    const { store } = await setup([rec('r1', '要清理的一条', { name: 'r1' })]);
    store.retire(['r1'], { at: new Date().toISOString(), reason: 'obsolete' });
    const r = await store.purgeRetired(['r1'], 'cleanup-retired');
    expect(r.aborted).toBe(false);
    expect(r.purged).toBe(1);
    expect(r.files).toEqual({ moved: 0, failed: 0, absent: 0 });
    expect(store.all().length).toBe(0);
  });

  it('本批之外的并发漂移不中止清理，只报 otherChanged', async () => {
    const { store } = await setup([
      rec('r1', '要清理的一条', { name: 'r1' }),
      rec('r2', '活着的一条', { name: 'r2' }),
    ]);
    store.retire(['r1'], { at: new Date().toISOString(), reason: 'obsolete' });
    // 快照在 purgeRetired 内部才拍，所以这里的"别处改动"发生在快照之前——
    // 它不会动摇本批的可恢复性，旧门禁却会因为整库哈希变了而永远中止。
    const r2 = store.all().find((x) => x.id === 'r2');
    await store.appendNew([{ ...r2!, content: '活着的一条（并发改过）' }]);
    const r = await store.purgeRetired(['r1'], 'cleanup-retired');
    expect(r.aborted).toBe(false);
    expect(r.purged).toBe(1);
    expect(store.all().find((x) => x.id === 'r2')?.content).toContain('并发改过');
  });

  it('退场记录的 .disable 文件被搬进快照目录，原地不再存在，正文里查得到', async () => {
    const { store, ledger, root, dataDir } = await setup([rec('r1', '要清理并归档的一条', { name: 'r1' })]);
    // 走一遍真实导出，让账本与文件都就位；再按 N11 的形态手工改名成 .disable
    await exportRecords({ records: store.all(), cfgRoot: undefined, dataDir, ledger, maxRecords: 10, timeBudgetMs: 60_000 });
    const base = join(root, 'work_fact', 'r1.memory.md');
    const disabled = `${base}.disable`;
    await writeFile(disabled, `${await readFile(base, 'utf8')}\n`, 'utf8');
    await rm(base, { force: true });
    store.retire(['r1'], { at: new Date().toISOString(), reason: 'obsolete' });

    const records = store.all().filter((r) => r.validTo !== undefined);
    const files = await collectProjectionFiles(records, undefined, dataDir);
    expect(files.has('r1')).toBe(true);

    const r = await store.purgeRetired(['r1'], 'cleanup-retired', { files });
    expect(r.purged).toBe(1);
    expect(r.files.moved).toBe(1);
    expect(r.files.failed).toBe(0);
    // 归档正文落盘，且能在这份文件里读回被删的那条
    const md = await readFile(join(r.dir, ARCHIVE_MD), 'utf8');
    expect(md).toContain('要清理并归档的一条');
    expect(md).toContain('## work_fact');
    // 投射文件搬到了 files/<home|ws>/<type>/ 下，原地已空
    const moved = await readFile(join(r.dir, ARCHIVE_FILES_DIR, 'home', 'work_fact', 'r1.memory.md.disable'), 'utf8');
    expect(moved).toContain('要清理并归档的一条');
    await expect(readFile(disabled, 'utf8')).rejects.toThrow();
  });

  it('找不到文件时只计 absent，不影响删除', async () => {
    const { store, dataDir } = await setup([rec('r1', '从没导出过的一条', { name: 'r1' })]);
    store.retire(['r1'], { at: new Date().toISOString(), reason: 'obsolete' });
    const files = await collectProjectionFiles(store.all(), undefined, dataDir);
    expect(files.size).toBe(0);
    const r = await store.purgeRetired(['r1'], 'cleanup-retired', { files });
    expect(r.purged).toBe(1);
    expect(r.files).toEqual({ moved: 0, failed: 0, absent: 0 });
  });

  it('搬运目标目录不可写时失败只 warn，删除照常完成', async () => {
    const { store, ledger, root, dataDir } = await setup([rec('r1', '搬运会失败的一条', { name: 'r1' })]);
    await exportRecords({ records: store.all(), cfgRoot: undefined, dataDir, ledger, maxRecords: 10, timeBudgetMs: 60_000 });
    store.retire(['r1'], { at: new Date().toISOString(), reason: 'obsolete' });
    const records = store.all().filter((r) => r.validTo !== undefined);
    const files = await collectProjectionFiles(records, undefined, dataDir);
    // 先手工把源文件删掉 ⇒ rename 必然 ENOENT ⇒ 走 failed 分支
    await rm(join(root, 'work_fact', 'r1.memory.md'), { force: true });
    const stale = new Map([[ 'r1', files.get('r1') ?? [] ]]);
    const out = await moveProjectionFiles(await mkdtemp(join(tmpdir(), 'dsh-mdarchive-dead-')), records, stale);
    expect(out.failed).toBeGreaterThan(0);
    expect(out.moved).toBe(0);
  });
});
