/**
 * 后缀不变式收敛（`.memory.md` ⇄ `.memory.md.disable` 只跟随「库里是否退场」）。
 *
 * 为什么单独一个文件而不塞进 `memory-md-workspace.test.ts`：那批用例测的是**事件**
 * （点一次「判过时」动一次盘），这里测的是**状态**（任意路径造成的形状偏离都要被收回来）。
 * 真机的偏差正是这么来的：920 条退场记录只有 8 个 `.disable`，因为全仓 8 处 `.retire()`
 * 里只有召回面板那一处挂了事件；而无归属那 486 条即使手动判过时也被 `no-workspace` 早退
 * 挡掉——导出写得出单根文件，退场却改不了名。两类漏都必须在**状态**这一层钉住。
 */
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MdLedgerStore } from '../src/store/memory-md-ledger.js';
import { exportRecords } from '../src/store/memory-md-export.js';
import { convergeDisabledSuffix, disableProjectionFile } from '../src/store/memory-md-disable.js';
import { digest as digestOf } from '../src/store/memory-md.js';
import type { MemoryRecord } from '../src/types.js';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

const RETIRED_AT = Date.parse('2026-10-12T09:00:00Z');

function rec(id: string, content: string, extra: Partial<MemoryRecord> = {}): MemoryRecord {
  const t = Date.parse('2026-10-12T00:00:00Z');
  return { id, content, type: 'work_fact', priority: 60, scene_name: 's', timestamps: [t], createdAt: t, updatedAt: t, ...extra };
}

async function ctx() {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-sfx-'));
  const wsDir = await mkdtemp(join(tmpdir(), 'dsh-sfx-ws-'));
  dirs.push(dataDir, wsDir);
  const ledger = new MdLedgerStore(dataDir);
  await ledger.init();
  return { dataDir, wsDir, ws: resolve(wsDir).toLowerCase(), ledger };
}

type Ctx = Awaited<ReturnType<typeof ctx>>;

const converge = (records: readonly MemoryRecord[], c: Ctx, over: { maxRecords?: number; timeBudgetMs?: number } = {}) =>
  convergeDisabledSuffix({
    records,
    cfgRoot: undefined,
    dataDir: c.dataDir,
    ledger: c.ledger,
    maxRecords: over.maxRecords ?? 300,
    timeBudgetMs: over.timeBudgetMs ?? 60_000,
  });

const exportThen = async (records: MemoryRecord[], c: Ctx) =>
  exportRecords({ records, cfgRoot: undefined, dataDir: c.dataDir, ledger: c.ledger, maxRecords: 300, timeBudgetMs: 60_000 });

const singleRootFile = (c: Ctx, stem: string): string => join(resolve(c.dataDir, 'memories'), 'work_fact', `${stem}.memory.md`);
const wsFile = (c: Ctx, stem: string): string => join(resolve(c.ws, '.agents', 'memory'), 'work_fact', `${stem}.memory.md`);

/** 人造文件得先建目录（这些用例走的是“没导出过”的盘态，投射器还没 mkdir 过）。 */
async function putFile(p: string, text: string): Promise<void> {
  await mkdir(join(p, '..'), { recursive: true });
  await writeFile(p, text, 'utf8');
}

describe('后缀不变式收敛（状态层，与退场路径无关）', () => {
  it('退场但盘上还是 .memory.md → 改名，且文件名（stem）逐字不变', async () => {
    const c = await ctx();
    const live = rec('a1', '被批量软删的记忆', { name: 'batch-retired', workspaceId: c.ws });
    await exportThen([live], c);
    const abs = wsFile(c, 'batch-retired');
    const rep = await converge([{ ...live, validTo: RETIRED_AT }], c);
    expect(rep.renamed).toBe(1);
    expect(existsSync(abs)).toBe(false);
    // name 无感：只加后缀，干部分一个字都不动
    expect(await readFile(`${abs}.disable`, 'utf8')).toContain('被批量软删的记忆');
    // 账本跟着换键（否则下一遍对账同时报"旧键缺失"和"新文件是外人加的"）
    expect(c.ledger.get(abs)).toBeUndefined();
    expect(c.ledger.get(`${abs}.disable`)?.id).toBe('a1');
  });

  it('无归属记录退场 → 单根那份也要改名（旧实现被 no-workspace 早退挡掉）', async () => {
    const c = await ctx();
    const live = rec('a2', '归属不明的记忆', { name: 'no-owner' });
    await exportThen([live], c);
    const abs = singleRootFile(c, 'no-owner');
    expect(existsSync(abs)).toBe(true);
    const rep = await converge([{ ...live, validTo: RETIRED_AT }], c);
    expect(rep.renamed).toBe(1);
    expect(existsSync(abs)).toBe(false);
    expect(existsSync(`${abs}.disable`)).toBe(true);
  });

  it('人改过正文 → 仍改名，字节原样带走，edited 计数 + 账本按磁盘真实字节重记', async () => {
    const c = await ctx();
    const live = rec('a3', '原始正文', { name: 'hand-edited', workspaceId: c.ws });
    await exportThen([live], c);
    const abs = wsFile(c, 'hand-edited');
    const edited = '---\nid: "a3"\n---\n\n原始正文\n\n人手补了一段结论\n';
    await writeFile(abs, edited, 'utf8');
    const rep = await converge([{ ...live, validTo: RETIRED_AT }], c);
    expect(rep.edited).toBe(1);
    expect(rep.renamed).toBe(1);
    const now = await readFile(`${abs}.disable`, 'utf8');
    expect(now).toBe(edited);
    expect(c.ledger.get(`${abs}.disable`)?.fileDigest).toBe(digestOf(edited));
  });

  it('恢复活跃 → 把我们写过账的 .disable 改回 .memory.md', async () => {
    const c = await ctx();
    const live = rec('a4', '先退再恢复的记忆', { name: 'revive-me', workspaceId: c.ws });
    await exportThen([live], c);
    const abs = wsFile(c, 'revive-me');
    await converge([{ ...live, validTo: RETIRED_AT }], c);
    expect(existsSync(`${abs}.disable`)).toBe(true);
    const rep = await converge([live], c);
    expect(rep.revived).toBe(1);
    expect(existsSync(abs)).toBe(true);
    expect(existsSync(`${abs}.disable`)).toBe(false);
    expect(c.ledger.get(abs)?.id).toBe('a4');
  });

  it('人手造的 .disable（没账）不回改：那是文件侧的退场凭证，揉掉等于丢人的裁决', async () => {
    const c = await ctx();
    const live = rec('a5', '人在文件侧判过时的记忆', { name: 'human-credential', workspaceId: c.ws });
    const abs = wsFile(c, 'human-credential');
    await c.ledger.flush();
    await putFile(`${abs}.disable`, '---\nid: "a5"\n---\n\n正文\n');
    const rep = await converge([live], c);
    expect(rep.revived).toBe(0);
    expect(rep.both).toBe(1);
    expect(existsSync(`${abs}.disable`)).toBe(true);
    expect(existsSync(abs)).toBe(false);
  });

  it('两份都在 → 保守不动，只报 both（删哪份都是不可逆判断）', async () => {
    const c = await ctx();
    const r = rec('a6', '改名中途崩过的记忆', { name: 'both-exist', workspaceId: c.ws, validTo: RETIRED_AT });
    const abs = wsFile(c, 'both-exist');
    await putFile(abs, 'x');
    await putFile(`${abs}.disable`, 'y');
    const rep = await converge([r], c);
    expect(rep.both).toBe(1);
    expect(rep.renamed).toBe(0);
    expect(existsSync(abs)).toBe(true);
    expect(existsSync(`${abs}.disable`)).toBe(true);
  });

  it('盘上什么都没有 → absent，不凭空造文件', async () => {
    const c = await ctx();
    const r = rec('a7', '从没导出过就被退场的记忆', { name: 'never-exported', workspaceId: c.ws, validTo: RETIRED_AT });
    const rep = await converge([r], c);
    expect(rep.absent).toBe(1);
    expect(rep.renamed).toBe(0);
    await expect(stat(resolve(c.ws, '.agents'))).rejects.toThrow();
  });

  it('幂等：收敛跑第二遍 renamed/revived 恒为 0，条目不翻倍', async () => {
    const c = await ctx();
    const list = [
      rec('b1', '第一条', { name: 'idem-1', workspaceId: c.ws }),
      rec('b2', '第二条', { name: 'idem-2' }),
    ];
    await exportThen(list, c);
    const retired = list.map((r) => ({ ...r, validTo: RETIRED_AT }));
    const first = await converge(retired, c);
    expect(first.renamed).toBe(2);
    const second = await converge(retired, c);
    expect(second.renamed).toBe(0);
    expect(second.revived).toBe(0);
    expect(second.already).toBe(2);
    const files = await readdir(join(resolve(c.dataDir, 'memories'), 'work_fact'));
    expect(files.filter((f) => f.startsWith('idem-2'))).toEqual(['idem-2.memory.md.disable']);
  });

  it('批量收敛只落一次账：每条 flush = 整本 JSON 重写，会把回填拖成 O(n²)', async () => {
    const c = await ctx();
    const list = Array.from({ length: 300 }, (_, i) => rec(`f${i}`, `记忆 ${i}`, { name: `flush-${i}`, workspaceId: c.ws }));
    await exportThen(list, c);
    // 数落盘次数而不是计时间：计时在 CI 上只会飘，而“整本重写 N 次”这个缺陷本身是确定的。
    let flushes = 0;
    const orig = c.ledger.flush.bind(c.ledger);
    c.ledger.flush = async () => { flushes += 1; return orig(); };
    const rep = await converge(list.map((r) => ({ ...r, validTo: RETIRED_AT })), c, { maxRecords: 2000 });
    expect(rep.renamed).toBe(300);
    expect(rep.capped).toBe(false);
    expect(flushes).toBeLessThanOrEqual(1);
    // 账本真的落盘了（不是“没刷所以快”）：另开一个实例从磁盘读回 300 个 `.disable` 键
    const again = new MdLedgerStore(c.dataDir);
    await again.init();
    expect(again.all().filter((e) => e.id.startsWith('f')).length).toBe(300);
  });

  it('护栏：maxRecords 只数碰盘动作，capped/remaining 真实', async () => {
    const c = await ctx();
    const list = Array.from({ length: 5 }, (_, i) => rec(`c${i}`, `记录 ${i}`, { name: `cap-${i}`, workspaceId: c.ws }));
    await exportThen(list, c);
    const retired = list.map((r) => ({ ...r, validTo: RETIRED_AT }));
    const rep = await converge(retired, c, { maxRecords: 2 });
    expect(rep.renamed).toBe(2);
    expect(rep.capped).toBe(true);
    expect(rep.remaining).toBe(3);
    // 再点一次继续：推进而不是在同一批上打转
    const rep2 = await converge(retired, c, { maxRecords: 2 });
    expect(rep2.renamed).toBe(2);
    expect(rep2.remaining).toBe(1);
  });
});

describe('单点失效联动的不对称修复（写得出也要收得回）', () => {
  it('无归属但单根已有投射文件 → renamed（旧实现一进函数就 no-workspace 早退，盘上永远留着未退场版）', async () => {
    const c = await ctx();
    const live = rec('s1', '无归属但已导出过的记忆', { name: 'single-root-owned' });
    await exportThen([live], c);
    const abs = singleRootFile(c, 'single-root-owned');
    expect(existsSync(abs)).toBe(true);
    const outcome = await disableProjectionFile({
      record: { ...live, validTo: RETIRED_AT },
      cfgRoot: undefined,
      dataDir: c.dataDir,
      ledger: c.ledger,
    });
    expect(outcome).toBe('renamed');
    expect(existsSync(abs)).toBe(false);
    expect(existsSync(`${abs}.disable`)).toBe(true);
  });

  it('无归属且盘上没这份 → 仍返回 no-workspace，不凭空造（原红线保留）', async () => {
    const c = await ctx();
    const r = rec('s2', '无归属也没导出过', { name: 'single-root-ghost', validTo: RETIRED_AT });
    expect(await disableProjectionFile({ record: r, cfgRoot: undefined, dataDir: c.dataDir, ledger: c.ledger })).toBe('no-workspace');
    await expect(stat(resolve(c.dataDir, 'memories'))).rejects.toThrow();
  });
});

// 「点火」这一层（四个汇流口是否都触发、未注入时零动作、钩子内部抛异常不弄挂库侧）
// 已搬到 `tests/memory-md-sync.test.ts`：挂钩收口在 `L1Store`，`makeSuffixSync` 已退役。
// 这里只留**状态层**（收敛器本体）的用例。

