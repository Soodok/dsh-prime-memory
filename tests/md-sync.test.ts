/**
 * P2 反向同步（文件 → 库）的四象限与两条边界。
 *
 * 真 L1Store + 真磁盘临时目录，全部走公开写路径。每条用例都对应一个会**静默坏掉**的地方：
 *   - 回灌后不重渲染 → 账本停在旧基线 → 下一轮又判 fileOnly，写回环永远转不完；
 *   - 两边都变时自动挑一边 → 人的编辑或库里的蒸馏产物被无声覆盖；
 *   - `.disable` 直接删文件 → 归档链断裂（这里只退场，删除是 cleanup 的事）；
 *   - 投射目录里的陌生 md 被猜成一条新记忆 → 绕过写入内核的判据面。
 *
 * 遍历防护（junction / 目录符号链接不得把根外的树吞进来）另见 `md-sync-junction.test.ts`
 * （task_3.7）；这里只钉"干净树里那个计数保持 0"，别让它虚高。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { L1Store } from '../src/store/l1.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { hashRecords } from '../src/store/l1-snapshot.js';
import { MdLedgerStore } from '../src/store/memory-md-ledger.js';
import { exportRecords } from '../src/store/memory-md-export.js';
import { resolveMemoriesRoot } from '../src/store/memory-md.js';
import { syncFromFiles } from '../src/pipeline/md-sync.js';
import { parseMdFile } from '../src/store/memory-md-parse.js';
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

const THREE = [
  rec('r1', 'pnpm 需要 hoisted 平铺布局', { name: 'pnpm-hoisted' }),
  rec('r2', '上行必须走官方地址', { name: '官方地址上行' }),
  rec('r3', '发布要显式钉 registry'),
];

/** 建库 → 导出一次 → 账本有基线，这就是"同步前"的世界。 */
async function setup(recordList: MemoryRecord[] = THREE) {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-mdsync-'));
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
  await exportRecords({ records: store.all(), cfgRoot: undefined, dataDir, ledger, maxRecords: 300, timeBudgetMs: 60_000 });
  const sync = (over: { maxFiles?: number; timeBudgetMs?: number } = {}) =>
    syncFromFiles({
      store,
      ledger,
      cfgRoot: undefined,
      dataDir,
      maxFiles: over.maxFiles ?? 2000,
      timeBudgetMs: over.timeBudgetMs ?? 60_000,
    });
  return { dataDir, db, store, ledger, root, sync };
}

const pathOf = (root: string, type: string, stem: string): string => join(root, type, `${stem}.memory.md`);

describe('syncFromFiles 四象限', () => {
  it('什么都没改 → 全 same，一次写动作都不做', async () => {
    const { store, sync } = await setup();
    const before = hashRecords(store.all());
    const rep = await sync();
    expect(rep.roots).toBeGreaterThan(0);
    expect(rep.scanned).toBe(3);
    expect(rep.same).toBe(3);
    expect(rep.imported).toBe(0);
    expect(rep.rendered).toBe(0);
    expect(rep.pending).toBe(0);
    expect(rep.skipped).toBe(0);
    // 链接计数：干净投射树里一个链接都没有，这个数就该是 0。
    expect(rep.skippedLinks).toBe(0);
    expect(hashRecords(store.all())).toBe(before);
  });

  it('只有文件变 → 回灌入库，并把文件重写成规范渲染（下一轮判 same，不转环）', async () => {
    const { store, root, sync } = await setup();
    const p = pathOf(root, 'work_fact', '官方地址上行');
    const text = await readFile(p, 'utf8');
    await writeFile(p, text.replace('上行必须走官方地址', '上行必须走官方地址（镜像有同步延迟，实测 404）'), 'utf8');

    const rep = await sync();
    expect(rep.imported).toBe(1);
    expect(rep.pending).toBe(0);
    expect(store.all().find((r) => r.id === 'r2')?.content).toContain('实测 404');

    // 无写回环：文件已回到"库的规范渲染"，账本同步跟上，再跑一轮什么都不该发生。
    const rep2 = await sync();
    expect(rep2.imported).toBe(0);
    expect(rep2.rendered).toBe(0);
    expect(rep2.pending).toBe(0);
    expect(rep2.same).toBe(3);
    // 人的那段文字仍在文件里（重写只是归一 frontmatter，不是回滚正文）。
    expect(await readFile(p, 'utf8')).toContain('实测 404');
  });

  it('只有库变 → 重写文件，不动库', async () => {
    const { store, root, sync } = await setup();
    const r1 = store.all().find((r) => r.id === 'r1');
    expect(r1).toBeDefined();
    await store.appendNew([{ ...r1!, content: 'pnpm 需要 hoisted 平铺布局（改过）' }]);
    const before = hashRecords(store.all());

    const rep = await sync();
    expect(rep.rendered).toBe(1);
    expect(rep.imported).toBe(0);
    expect(hashRecords(store.all())).toBe(before);
    expect(await readFile(pathOf(root, 'work_fact', 'pnpm-hoisted'), 'utf8')).toContain('（改过）');
  });

  it('两边都变 → 挂账，两侧都不动，而且下轮还报同样的 pending', async () => {
    const { store, root, sync } = await setup();
    const p = pathOf(root, 'work_fact', '官方地址上行');
    await writeFile(p, (await readFile(p, 'utf8')).replace('上行必须走官方地址', '人手改的正文'), 'utf8');
    const r2 = store.all().find((r) => r.id === 'r2');
    await store.appendNew([{ ...r2!, content: '蒸馏侧改的正文' }]);

    const rep = await sync();
    expect(rep.pending).toBe(1);
    expect(rep.imported).toBe(0);
    expect(rep.rendered).toBe(0);
    expect(store.all().find((r) => r.id === 'r2')?.content).toBe('蒸馏侧改的正文');
    expect(await readFile(p, 'utf8')).toContain('人手改的正文');

    // 账本没被推进 → 挂账是持久的，不会过一轮就"自动解决了"
    expect((await sync()).pending).toBe(1);
  });
});

describe('syncFromFiles 边界', () => {
  it('.disable 文件 → 退场对应记录（不删文件，删除是 cleanup 的事）', async () => {
    const { store, root, sync } = await setup();
    const base = pathOf(root, 'work_fact', 'pnpm-hoisted');
    const text = await readFile(base, 'utf8');
    await writeFile(`${base}.disable`, text.replace('---\n', '---\nretired: true\n'), 'utf8');

    const rep = await sync();
    expect(rep.retired).toBe(1);
    expect(store.all().find((r) => r.id === 'r1')?.validTo).toBeDefined();
    // 原文件没被删、也没被"顺手"重写：退场只写 valid_to
    expect(await readFile(base, 'utf8')).toBe(text);
    // 再跑一轮：已退场 → 判 same，不重复退场
    expect((await sync()).retired).toBe(0);
  });

  it('.disable 找不到记录 → orphan 计数，不抛也不瞎退场', async () => {
    const { root, sync } = await setup([rec('r1', '只有这一条', { name: 'pnpm-hoisted' })]);
    await writeFile(pathOf(root, 'work_fact', '陌生条目') + '.disable', '---\nname: "陌生条目"\n---\n正文\n', 'utf8');
    const rep = await sync();
    expect(rep.orphan).toBe(1);
    expect(rep.retired).toBe(0);
  });

  it('正文被手改（hash 与正文不符）→ 计入 hashMismatch，仍按文件侧回灌并重盖指纹', async () => {
    const { store, root, sync } = await setup();
    const p = pathOf(root, 'work_fact', '官方地址上行');
    await writeFile(p, (await readFile(p, 'utf8')).replace('上行必须走官方地址', '上行必须走镜像地址'), 'utf8');

    const rep = await sync();
    // 自校验不符被看见，但没有变成拒收：正文照旧回灌入库。
    expect(rep.hashMismatch).toBe(1);
    expect(rep.imported).toBe(1);
    expect(store.all().find((r) => r.id === 'r2')?.content).toContain('镜像地址');
    // 重写后文件自洽：hash 与正文再次对上。
    expect(parseMdFile(await readFile(p, 'utf8'))?.hashValid).toBe(true);
    // 再跑一轮：自校验已恢复，一切 same，不再报不符。
    const rep2 = await sync();
    expect(rep2.hashMismatch).toBe(0);
    expect(rep2.same).toBe(3);
  });

  it('老投射文件没有 hash 键 → 计入 unsigned（无自校验能力），按文件侧回灌后补盖', async () => {
    const { root, sync } = await setup();
    const p = pathOf(root, 'work_fact', '官方地址上行');
    // 模拟升级前的产物：整行删掉 hash。
    await writeFile(p, (await readFile(p, 'utf8')).replace(/^hash: .*\n/m, ''), 'utf8');

    const rep = await sync();
    expect(rep.unsigned).toBe(1);
    expect(rep.hashMismatch).toBe(0);
    // 回灌重写带上新指纹；下一轮 unsigned 归零。
    expect(parseMdFile(await readFile(p, 'utf8'))?.hashValid).toBe(true);
    expect((await sync()).unsigned).toBe(0);
  });

  it('.disable 的正文与 hash 不符也照样退场（后缀即裁决，自校验只留痕）', async () => {
    const { store, root, sync } = await setup();
    const base = pathOf(root, 'work_fact', 'pnpm-hoisted');
    const text = await readFile(base, 'utf8');
    // 凭证正文被手改（hash 停留在改前）——不能因此把退场锁死。
    await writeFile(`${base}.disable`, text.replace('pnpm 需要 hoisted 平铺布局', 'pnpm 已不需要 hoisted'), 'utf8');

    const rep = await sync();
    expect(rep.retired).toBe(1);
    expect(rep.hashMismatch).toBe(1);
    expect(store.all().find((r) => r.id === 'r1')?.validTo).toBeDefined();
  });

  it('没有账本也认不出记录的新文件 → 计数，绝不入库（导入须过写入内核）', async () => {
    const { store, root, sync } = await setup();
    const n = store.all().length;
    await writeFile(pathOf(root, 'work_fact', '手写新记忆'), '---\nname: "手写新记忆"\ntype: "work_fact"\n---\n我自己写的一条\n', 'utf8');
    const rep = await sync();
    expect(rep.newFiles).toBe(1);
    expect(rep.imported).toBe(0);
    expect(store.all().length).toBe(n);
  });

  it('非投射格式的普通 md → skipped，库一个字不动', async () => {
    const { store, root, sync } = await setup();
    const before = hashRecords(store.all());
    await writeFile(pathOf(root, 'work_fact', '随手笔记'), '# 随手笔记\n\n这不是投射文件\n', 'utf8');
    const rep = await sync();
    expect(rep.skipped).toBe(1);
    expect(rep.imported).toBe(0);
    expect(hashRecords(store.all())).toBe(before);
  });

  it('文件数护栏：掉过的那部分必须报成 capped + remaining', async () => {
    const { sync } = await setup();
    const rep = await sync({ maxFiles: 1 });
    expect(rep.scanned).toBe(1);
    expect(rep.capped).toBe(true);
    expect(rep.remaining).toBe(2);
  });

  it('骨架文件 `_index.md` 不进任何计数（md-sync 只认 .memory.md/.disable 后缀）', async () => {
    // 钉住判据：`listProjectionFiles` 按后缀过滤，`_index.md` 既不以 `.memory.md` 也不以
    // `.disable` 结尾 → 根本不进 files 列表，扫不到、也不当新文件/陌生格式计数。
    const { store, root, sync } = await setup();
    const idx = join(root, 'work_fact', '_index.md');
    await writeFile(idx, '# 工作事实\n\n- 类型: work_fact\n- 条数: 3\n', 'utf8');
    const before = hashRecords(store.all());

    const rep = await sync();
    expect(rep.scanned).toBe(3);
    expect(rep.same).toBe(3);
    expect(rep.newFiles).toBe(0);
    expect(rep.skipped).toBe(0);
    expect(rep.imported).toBe(0);
    expect(rep.rendered).toBe(0);
    // 原地不动：内容逐字未变，库一字不改。
    expect(await readFile(idx, 'utf8')).toContain('工作事实');
    expect(hashRecords(store.all())).toBe(before);
  });

  it('同一条记录在两个根下各一份时：旧根那份不回灌、权威那份不被覆盖（真机双根往返报出的缺陷）', async () => {
    // 形状：换过 `memExport.root` / 迁库之后，账本里同时留着旧根与新根的键，而
    // `roots` 是“记录落点根 ∪ 账本记过的根”，两份文件都会进循环。旧逻辑拿旧根那份
    // 判象限、却往 `targetFor` 算出的新根那份写——结果旧根里人写的编辑能绕过
    // “两边都变就不动”把权威那份盖掉。现在非权威落点一律不动，计入 `staleRootFiles`。
    const { dataDir, store, ledger, sync } = await setup();
    const 权威前 = hashRecords(store.all());
    // 再以第二个根导出一次：账本里就有了同一记录的两个根各自的条目（旧根残片）。
    const 旧根 = join(dataDir, 'old-memories');
    await exportRecords({ records: store.all(), cfgRoot: 旧根, dataDir, ledger, maxRecords: 300, timeBudgetMs: 60_000 });

    const rec0 = store.all()[0]!;
    const stale = ledger.allWithKeys().find((e) => e.entry.id === rec0.id && e.path.startsWith(旧根));
    expect(stale, '旧根应该有一份条目').toBeTruthy();
    const MARK = '人在旧根补的一句，不该被任何一侧采纳。';
    await writeFile(stale!.path, `${await readFile(stale!.path, 'utf8')}

${MARK}
`, 'utf8');

    const rep = await sync();
    // 不回灌、不重写，且旧根那份被计成陈旧文件
    expect(rep.imported).toBe(0);
    expect(rep.rendered).toBe(0);
    expect(rep.staleRootFiles).toBeGreaterThanOrEqual(1);
    // 库逐字未动
    expect(hashRecords(store.all())).toBe(权威前);
    // 旧根那份也没被动（人不裁决机器不许动，它的处置是孤儿归档）
    expect(await readFile(stale!.path, 'utf8')).toContain(MARK);
  });
});
