/**
 * 投射落点（N10：workspace 优先）与失效联动（N11：`.disable`）。
 *
 * 两组断言放一起，是因为它们共用同一个 `targetFor`——**导出、对账、改名三处算出的
 * 落点必须是同一个字符串**，否则"刚写进去的文件"会被下一轮算成另一个账本键，
 * 对账永远报"文件缺失"。库里 `workspace_id` 在 Windows 上是小写形态（F29），
 * 这正是最容易出错的地方，所以这里既测落点也测幂等。
 */
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MdLedgerStore } from '../src/store/memory-md-ledger.js';
import { exportRecords, reconcileLedger } from '../src/store/memory-md-export.js';
import { disableProjectionFile } from '../src/store/memory-md-disable.js';
import { targetFor } from '../src/store/memory-md.js';
import { digest as digestOf } from '../src/store/memory-md.js';
import type { MemoryRecord } from '../src/types.js';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

function rec(id: string, content: string, extra: Partial<MemoryRecord> = {}): MemoryRecord {
  const t = Date.parse('2026-10-12T00:00:00Z');
  return { id, content, type: 'work_fact', priority: 60, scene_name: 's', timestamps: [t], createdAt: t, updatedAt: t, ...extra };
}

async function ctx() {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-mdws-'));
  const wsDir = await mkdtemp(join(tmpdir(), 'dsh-wsdir-'));
  dirs.push(dataDir, wsDir);
  const ledger = new MdLedgerStore(dataDir);
  await ledger.init();
  // 库里的 workspace_id 是归一化后的小写形态（normalizeWorkspacePath 在 win32 转小写）。
  const ws = resolve(wsDir).toLowerCase();
  return { dataDir, wsDir, ws, ledger };
}

const run = (records: MemoryRecord[], c: { dataDir: string; ledger: MdLedgerStore }, cfgRoot?: string) =>
  exportRecords({ records, cfgRoot, dataDir: c.dataDir, ledger: c.ledger, maxRecords: 300, timeBudgetMs: 60_000 });

describe('targetFor / 导出落点（N10）', () => {
  it('有 workspace 的记录落在 <ws>/.agents/memory/<type>/，report 里 inWorkspace 计数', async () => {
    const c = await ctx();
    const r = rec('w1', '这条记忆属于某个项目', { name: 'ws-owned', workspaceId: c.ws });
    const t = targetFor(r, undefined, c.dataDir);
    expect(t.inWorkspace).toBe(true);
    expect(t.absPath).toBe(join(resolve(c.ws, '.agents', 'memory'), 'work_fact', 'ws-owned.memory.md'));

    const rep = await run([r], c);
    expect(rep.written).toBe(1);
    expect(rep.inWorkspace).toBe(1);
    expect(rep.root).toBe(resolve(c.dataDir, 'memories'));
    const dirsUnderAgents = await readdir(join(c.ws, '.agents', 'memory'));
    expect(dirsUnderAgents).toContain('work_fact');
  });

  it('无 workspace 的落单根；cfgRoot 只影响这一批', async () => {
    const c = await ctx();
    const plain = rec('p1', '归属不明的记录', { name: 'no-owner' });
    const rep = await run([plain], c);
    expect(rep.inWorkspace).toBe(0);
    const files = await readdir(join(c.dataDir, 'memories', 'work_fact'));
    expect(files).toContain('no-owner.memory.md');

    // 换 cfgRoot：无归属那批改道，有 workspace 的那条**不受影响**。
    const other = await mkdtemp(join(tmpdir(), 'dsh-otherroot-'));
    dirs.push(other);
    const c2 = { ...c, ledger: new MdLedgerStore(other) };
    await c2.ledger.init();
    const mixed = [plain, rec('w2', '属于项目', { name: 'ws-2', workspaceId: c.ws })];
    const rep2 = await run(mixed, c2, resolve(other));
    expect(rep2.inWorkspace).toBe(1);
    expect(await readdir(join(other, 'work_fact'))).toContain('no-owner.memory.md');
    expect(await readdir(join(c.ws, '.agents', 'memory', 'work_fact'))).toContain('ws-2.memory.md');
  });

  it('同名不同 workspace 的两条不互盖（账本两个键、磁盘两个文件）', async () => {
    const c = await ctx();
    const wsA = c.ws;
    const wsB = await mkdtemp(join(tmpdir(), 'dsh-wsdir-b-'));
    dirs.push(wsB);
    const rep = await run([
      rec('sa', 'A 项目里的同名记忆', { name: 'same-name', workspaceId: wsA }),
      rec('sb', 'B 项目里的同名记忆', { name: 'same-name', workspaceId: resolve(wsB) }),
    ], c);
    expect(rep.written).toBe(2);
    const keys = c.ledger.all().map((e) => e.id).sort();
    expect(keys).toEqual(['sa', 'sb']);
    expect(await readdir(join(wsA, '.agents', 'memory', 'work_fact'))).toContain('same-name.memory.md');
    expect(await readdir(join(wsB, '.agents', 'memory', 'work_fact'))).toContain('same-name.memory.md');
  });

  it('导出→对账→再导出三步幂等（落点函数三处共用，键不会漂）', async () => {
    const c = await ctx();
    const list = [rec('i1', '项目内记忆', { name: 'in-ws', workspaceId: c.ws })];
    await run(list, c);
    const rec1 = await reconcileLedger({ records: list, cfgRoot: undefined, dataDir: c.dataDir, ledger: c.ledger, maxRecords: 300, timeBudgetMs: 60_000 });
    expect(rec1.same).toBe(1);
    expect(rec1.missingFile).toBe(0);
    const rep2 = await run(list, c);
    expect(rep2.written).toBe(0);
    expect(rep2.unchanged).toBe(1);
  });
});

describe('失效联动 .disable（N11）', () => {
  const dis = (p: string): string => `${p}.disable`;

  it('文件已存在 → 改名，旧文件消失、账本跟着换键', async () => {
    const c = await ctx();
    const live = rec('d1', '要被判过时的记忆', { name: 'to-disable', workspaceId: c.ws });
    await run([live], c);
    const abs = join(resolve(c.ws, '.agents', 'memory'), 'work_fact', 'to-disable.memory.md');
    expect(await readFile(abs, 'utf8')).toContain('要被判过时的记忆');

    // 调用方传的是退场**后**的快照（带 validTo）。
    const r = { ...live, validTo: Date.parse('2026-10-12T09:00:00Z') };
    expect(await disableProjectionFile({ record: r, cfgRoot: undefined, dataDir: c.dataDir, ledger: c.ledger })).toBe('renamed');
    await expect(stat(abs)).rejects.toThrow();
    const text = await readFile(dis(abs), 'utf8');
    expect(text).toContain('要被判过时的记忆');
    // 改名分支不重写内容：旧文件是“未退场时导出的那一版”，后缀本身就是标记。
    // 而账本的 fileDigest 必须按磁盘真实字节算，否则下轮对账会把我们自己的
    // 改名当成“人改过文件”。
    expect(text).not.toMatch(/^retired: true$/m);
    const entry = c.ledger.get(dis(abs));
    expect(entry).toBeDefined();
    expect(entry!.fileDigest).toBe(digestOf(text));
    expect(c.ledger.get(abs)).toBeUndefined();
  });

  it('从没导出过 → 创建 .disable 凭证（内容带 retired: true）', async () => {
    const c = await ctx();
    const r = { ...rec('d2', '没导出过就被判过时', { name: 'never-exported', workspaceId: c.ws }), validTo: Date.parse('2026-10-12T09:00:00Z') };
    expect(await disableProjectionFile({ record: r, cfgRoot: undefined, dataDir: c.dataDir, ledger: c.ledger })).toBe('created');
    const disPath = join(resolve(c.ws, '.agents', 'memory'), 'work_fact', 'never-exported.memory.md.disable');
    const text = await readFile(disPath, 'utf8');
    expect(text).toContain('没导出过就被判过时');
    expect(text).toMatch(/^retired: true$/m);
  });

  it('再点一次 ⇒ already，不产生第二个凭证', async () => {
    const c = await ctx();
    const r = { ...rec('d3', '重复点击', { name: 'twice', workspaceId: c.ws }), validTo: Date.parse('2026-10-12T09:00:00Z') };
    await disableProjectionFile({ record: r, cfgRoot: undefined, dataDir: c.dataDir, ledger: c.ledger });
    expect(await disableProjectionFile({ record: r, cfgRoot: undefined, dataDir: c.dataDir, ledger: c.ledger })).toBe('already');
    const listed = await readdir(join(resolve(c.ws, '.agents', 'memory'), 'work_fact'));
    expect(listed.filter((f) => f.startsWith('twice'))).toEqual(['twice.memory.md.disable']);
  });

  it('无 workspace ⇒ no-workspace，磁盘上什么都不写', async () => {
    const c = await ctx();
    const r = rec('d4', '归属不明', { name: 'no-ws' });
    expect(await disableProjectionFile({ record: r, cfgRoot: undefined, dataDir: c.dataDir, ledger: c.ledger })).toBe('no-workspace');
    // 单根连目录都不该被建出来（不是"建了个空目录"）。
    await expect(stat(resolve(c.dataDir, 'memories'))).rejects.toThrow();
  });

  it('文件侧炸了 ⇒ failed 且**不抛**（退场已成立，不能把端点变 500）', async () => {
    const c = await ctx();
    // 把 workspace 根指向一个**普通文件**：任何 mkdir/写盘都会 ENOTDIR。
    const asFile = join(c.wsDir, 'not-a-dir');
    await writeFile(asFile, 'x', 'utf8');
    const r = rec('d5', '落点是文件不是目录', { name: 'broken', workspaceId: asFile });
    const warns: string[] = [];
    const logger = { info: () => {}, warn: (m: string) => { warns.push(m); }, error: () => {} } as never;
    expect(await disableProjectionFile({ record: r, cfgRoot: undefined, dataDir: c.dataDir, ledger: c.ledger, logger })).toBe('failed');
    expect(warns.length).toBeGreaterThan(0);
  });
});
