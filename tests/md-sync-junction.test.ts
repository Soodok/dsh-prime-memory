/**
 * task_3.7 遍历防护：投射根下的链接不得把根外的树吞进 P2 反向同步。
 *
 * 为什么光有 `Dirent.isSymbolicLink()` 不够：win32 上"链接"不止 symlink 一种形状，
 * junction（目录联接，reparse point）也算，而它的 dirent 判定随 Node 版本与文件系统漂移
 * （本机 Node 22.22.1 实测报 true，但不能把边界押在一个会漂移的布尔上）。漏一个目录链接，
 * 吞进来的就是整棵外部树。
 *
 * 钉三件事：
 * 1. 根外的 `.memory.md` / `.memory.md.disable` 不进 `scanned`，也不许产生任何写动作——
 *    越界在这里从来不只是"读多了"：`.disable` 一旦被看见就会把无辜的记录退场。
 * 2. 拦下的条目要落进 `skippedLinks` 与样本（静默跳过=谎报），但**不**占用 `capped`/`remaining`
 *    ——那些文件本就不在范围内，不是护栏截断，混进剩余量就是另一谎。
 * 3. 防护不许过头：真实的子目录照常遍历（用例③），否则"加固"就变成了"整根扫不到"。
 *
 * 权限门控：junction 一般无需特权，目录 symlink 需开发者模式/管理员。创建不了时用
 * `describe.runIf` 让整组**显示为 skipped**（vitest 输出里看得见，组名带原因），
 * 绝不写成无条件通过的假绿。判据本身（`isWithinRoot`）另有不受权限影响的用例。
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { L1Store } from '../src/store/l1.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { hashRecords } from '../src/store/l1-snapshot.js';
import { MdLedgerStore } from '../src/store/memory-md-ledger.js';
import { exportRecords } from '../src/store/memory-md-export.js';
import { resolveMemoriesRoot } from '../src/store/memory-md.js';
import { isWithinRoot, syncFromFiles } from '../src/pipeline/md-sync.js';
import type { EmbeddingService } from '../src/store/embedding.js';
import type { MemoryLogger, MemoryRecord } from '../src/types.js';

const DIM = 16;
const dirs: string[] = [];
const dbs: MemoryDb[] = [];
/** 建过的链接路径：清理时先删链接本身，再递归删基目录，避免任何"顺着链接删"的可能。 */
const links: string[] = [];

afterAll(async () => {
  for (const l of links) await rm(l, { force: true, recursive: false }).catch(() => undefined);
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

const THREE = [
  rec('r1', 'pnpm 需要 hoisted 平铺布局', { name: 'pnpm-hoisted' }),
  rec('r2', '上行必须走官方地址', { name: '官方地址上行' }),
  rec('r3', '发布要显式钉 registry'),
];

/** 探测本机能不能造某种链接（造不出来 → 相关用例显示为 skipped，不假装通过）。 */
async function canLink(kind: 'junction' | 'dir'): Promise<boolean> {
  const b = await mkdtemp(join(tmpdir(), 'dsh-mdlink-probe-'));
  try {
    await mkdir(join(b, 'target'));
    await symlink(join(b, 'target'), join(b, 'l'), kind);
    return true;
  } catch {
    return false;
  } finally {
    await rm(b, { recursive: true, force: true });
  }
}

const CAN_JUNCTION = await canLink('junction');
const CAN_DIR_SYMLINK = await canLink('dir');

/** 真库 + 真导出 + 一个明确位于投射根外的目录树（链接就指向它）。 */
async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-mdlink-'));
  dirs.push(dataDir);
  const db = new MemoryDb(join(dataDir, 'm.db'), DIM);
  db.init();
  dbs.push(db);
  const store = new L1Store(dataDir, db, fakeEmbed(), 'hybrid', undefined, 0);
  await store.init();
  await store.appendNew(THREE);
  const ledger = new MdLedgerStore(dataDir);
  await ledger.init();
  const root = resolveMemoriesRoot(undefined, dataDir);
  await exportRecords({ records: store.all(), cfgRoot: undefined, dataDir, ledger, maxRecords: 300, timeBudgetMs: 60_000 });
  const outside = join(dataDir, 'outside-tree');
  await mkdir(join(outside, 'work_fact'), { recursive: true });
  const warn: string[] = [];
  const logger: MemoryLogger = { debug() {}, info() {}, warn: (m: string) => warn.push(m), error() {} };
  const sync = () =>
    syncFromFiles({
      store,
      ledger,
      cfgRoot: undefined,
      dataDir,
      maxFiles: 2000,
      timeBudgetMs: 60_000,
      logger,
    });
  return { dataDir, db, store, ledger, root, outside, sync, warn };
}

/** 一棵诱饵树：一个会被回灌的正文改动 + 一个会把记录判退场的 `.disable` + 一个深层新文件。
 * 放根外用来验防护，放根内用来验"诱饵本身确实有牙"。 */
async function plantBait(outside: string): Promise<void> {
  const dir = join(outside, 'work_fact');
  await mkdir(dir, { recursive: true }); // 调用方可能递进来一个尚不存在的根内目录
  await writeFile(
    join(dir, '官方地址上行.memory.md'),
    '---\nname: "官方地址上行"\ntype: "work_fact"\n---\n根外诱饵：一旦被看见就该被当成 fileOnly 回灌\n',
    'utf8',
  );
  await writeFile(
    join(dir, 'pnpm-hoisted.memory.md.disable'),
    '---\nname: "pnpm-hoisted"\ntype: "work_fact"\nretired: true\n---\n根外诱饵：一旦被看见就会退场无辜记录\n',
    'utf8',
  );
  // 再深一层：证明"吞进来"的量是一整棵树，不是一个文件。
  await mkdir(join(dir, 'deeper'), { recursive: true });
  await writeFile(
    join(dir, 'deeper', '更深的诱饵.memory.md'),
    '---\nname: "更深的诱饵"\ntype: "work_fact"\n---\n链接目录的二级子项\n',
    'utf8',
  );
}

const linkInto = async (root: string, name: string, target: string, kind: 'junction' | 'dir'): Promise<string> => {
  const abs = join(root, name);
  await symlink(target, abs, kind);
  links.push(abs);
  return abs;
};

/** 越界链接的共同断言：外面那三个诱饵一个都不许被看见，且不允许产生任何写动作。 */
const expectNoEscape = async (ctx: Awaited<ReturnType<typeof setup>>) => {
  const before = hashRecords(ctx.store.all());
  const rep = await ctx.sync();
  // 3 = 投射根里真导出的那三条；诱饵一个都没进来。
  expect(rep.scanned).toBe(3);
  expect(rep.imported).toBe(0);
  expect(rep.rendered).toBe(0);
  expect(rep.pending).toBe(0);
  expect(rep.retired).toBe(0);
  expect(rep.newFiles).toBe(0);
  expect(rep.orphan).toBe(0);
  // 库与检索面一字未改（`.disable` 诱饵尤其不能咬到人）。
  expect(hashRecords(ctx.store.all())).toBe(before);
  expect(ctx.store.all().find((r) => r.id === 'r1')?.validTo).toBeUndefined();
  // 拦下了要说出去：计数 + 路径样本 + 日志留痕。
  expect(rep.skippedLinks).toBeGreaterThanOrEqual(1);
  expect(rep.samples.some((s) => s.action.startsWith('link:'))).toBe(true);
  expect(ctx.warn.some((m) => m.includes('md 同步遍历防护拦下'))).toBe(true);
  // 但链接拦截不是护栏截断：那两个数保持干净。
  expect(rep.capped).toBe(false);
  expect(rep.remaining).toBe(0);
  return rep;
};

describe('isWithinRoot 越界判据（不依赖链接权限）', () => {
  const root = join(tmpdir(), 'proj-root');

  it('根自身与根的子目录算界内', () => {
    expect(isWithinRoot(root, root)).toBe(true);
    expect(isWithinRoot(root, join(root, 'work_fact'))).toBe(true);
    expect(isWithinRoot(root, join(root, 'work_fact', 'deeper'))).toBe(true);
  });

  it('兄弟目录 `<root>2` 不算界内（前缀必须带分隔符，否则经典越界陷阱）', () => {
    expect(isWithinRoot(root, join(root + '2', 'work_fact'))).toBe(false);
    expect(isWithinRoot(root, `${root}-evil`)).toBe(false);
  });

  it('父目录与旁支算越界', () => {
    expect(isWithinRoot(root, dirname(root))).toBe(false);
    expect(isWithinRoot(root, join(dirname(root), 'outside-tree', 'work_fact'))).toBe(false);
  });
});

const whyJunction = CAN_JUNCTION ? '' : '（本机创建不了 junction，此组显示为 skipped，原因见文件头权限门控说明）';
describe.runIf(CAN_JUNCTION)(`syncFromFiles 遍历防护 · junction${whyJunction}`, () => {
  it('junction 指向根外目录 → 根外的投射文件不进扫描，也不产生任何写动作', async () => {
    const ctx = await setup();
    await plantBait(ctx.outside);
    const abs = await linkInto(ctx.root, 'evil-junction', ctx.outside, 'junction');
    const rep = await expectNoEscape(ctx);
    // 样本里点名的就是那个链接本身（人拿它去查是哪个目录），而不是被吞进来的外部路径。
    expect(rep.samples.some((s) => s.path === abs)).toBe(true);
    expect(rep.samples.some((s) => s.path.includes('outside-tree'))).toBe(false);
  });

  it('junction 指回根内目录 → 仍不进（不重复计数、不顺着链接造环）', async () => {
    const ctx = await setup();
    await linkInto(ctx.root, 'loop-junction', join(ctx.root, 'work_fact'), 'junction');
    const before = hashRecords(ctx.store.all());
    const rep = await ctx.sync();
    // 真实三条各扫一次：链接回环不会把同一批文件算第二遍（那会误报成 pending/新文件）。
    expect(rep.scanned).toBe(3);
    expect(rep.same).toBe(3);
    expect(rep.pending).toBe(0);
    expect(rep.newFiles).toBe(0);
    expect(rep.skippedLinks).toBe(1);
    expect(hashRecords(ctx.store.all())).toBe(before);
  });
});

const whyDirLink = CAN_DIR_SYMLINK ? '' : '（本机创建不了目录 symlink，需开发者模式/管理员，此组显示为 skipped）';
describe.runIf(CAN_DIR_SYMLINK)(`syncFromFiles 遍历防护 · 目录符号链接${whyDirLink}`, () => {
  it('目录 symlink 指向根外 → 同样拦下', async () => {
    const ctx = await setup();
    await plantBait(ctx.outside);
    await linkInto(ctx.root, 'evil-symlink', ctx.outside, 'dir');
    await expectNoEscape(ctx);
  });
});

describe('syncFromFiles 遍历防护 · 不许过界到把自己锁死', () => {
  it('真实子目录照常遍历（防护只拦链接，不拦正常层级）', async () => {
    const ctx = await setup();
    const deep = join(ctx.root, 'work_fact', 'sub');
    await mkdir(deep, { recursive: true });
    await writeFile(
      join(deep, '深层合法条目.memory.md'),
      '---\nname: "深层合法条目"\ntype: "work_fact"\n---\n真目录里的新文件，应被看见并按"未入库"计数\n',
      'utf8',
    );
    const rep = await ctx.sync();
    expect(rep.scanned).toBe(4);
    expect(rep.newFiles).toBe(1);
    expect(rep.skippedLinks).toBe(0);
  });

  it('投射根整棵消失 → 正常缺席，不谎报成链接拦截（realpath 的 ENOENT 分支）', async () => {
    const ctx = await setup();
    // 根被搬空/删掉后仍会出现在"记录算出的根 ∪ 账本记过的根"里：那是正常缺席，不该计进
    // skippedLinks，否则每次正常缺席都刷一条防护日志，真越界就埋在里面了。
    await rm(ctx.root, { recursive: true, force: true });
    const rep = await ctx.sync();
    expect(rep.roots).toBeGreaterThan(0);
    expect(rep.scanned).toBe(0);
    expect(rep.skippedLinks).toBe(0);
    expect(ctx.warn.some((m) => m.includes('遍历防护拦下'))).toBe(false);
  });
});

describe('syncFromFiles 遍历防护 · 对照：诱饵本身有牙', () => {
  // 上面的"看不见"必须是因为防护，而不是因为诱饵本来就不起作用。同一个内容搬进根内，
  // 同步就得真的动作：退场/挂账/新文件各一个。谁要是把诱饵改成了谁都不理的形状，这条会先红。
  it('同样的诱饵直接放在投射根内 → 同步确实看见并动作（退场 1 + 挂账 1 + 新文件 1）', async () => {
    const ctx = await setup();
    await plantBait(join(ctx.root, 'outside-inline'));
    const rep = await ctx.sync();
    expect(rep.scanned).toBe(6);
    expect(rep.retired).toBe(1);
    expect(rep.pending).toBe(1);
    expect(rep.newFiles).toBe(1);
    // 门1 解耦:退场凭 marker(同步路径不再闭 valid_to)。
    expect(ctx.store.all().find((r) => r.id === 'r1')?.metadata?.dsh_superseded).toBeDefined();
    // 这一轮没有链接参与，不该凭空多出防护计数。
    expect(rep.skippedLinks).toBe(0);
  });
});
