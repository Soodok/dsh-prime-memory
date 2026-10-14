/**
 * 投影长任务的滚动执行（`runProjection`）与进度面。
 *
 * 为什么单独钉：真机反馈是"点三下才清干净、每次一秒多"——单轮护栏本身没错，错在
 * 把"要不要继续"这个判断丢给人点。这里钉的是**一次调用滚到完**，以及滚不完时
 * 如实报"还剩多少、再点一次续跑"（而不是悄悄停在半路）。
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MdLedgerStore } from '../src/store/memory-md-ledger.js';
import { mdRunStatus, runProjection } from '../src/store/memory-md-run.js';
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
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-mdrun-'));
  const wsDir = await mkdtemp(join(tmpdir(), 'dsh-mdrun-ws-'));
  dirs.push(dataDir, wsDir);
  const ledger = new MdLedgerStore(dataDir);
  await ledger.init();
  return { dataDir, ws: resolve(wsDir).toLowerCase(), ledger };
}

/** 造 n 条记录（一半标成已退场，好让收敛阶段真有活可干）。 */
function many(n: number, ws: string): MemoryRecord[] {
  return Array.from({ length: n }, (_, i) => rec(`r${i}`, `记忆内容 ${i}`, { name: `run-${i}`, workspaceId: ws, validTo: i % 2 === 0 ? RETIRED_AT : undefined }));
}

describe('runProjection / 一次调用滚到完', () => {
  it('记录数远超单轮护栏时自己续跑：remaining=0、passes>1、退场行全部改名', async () => {
    const c = await ctx();
    const list = many(700, c.ws);
    const rep = await runProjection({
      records: list, cfgRoot: undefined, dataDir: c.dataDir, ledger: c.ledger,
      maxRecords: 100, timeBudgetMs: 600_000,
    });
    expect(rep.remaining).toBe(0);
    expect(rep.capped).toBe(false);
    // 700 条 ÷ 护栏 100 = 导出至少 7 轮；收敛阶段纯未变不吃配额，可少于 7 轮
    expect(rep.passes).toBeGreaterThanOrEqual(7);
    expect(rep.written).toBe(700);
    expect(rep.suffix.renamed).toBe(350);
    const files = await readdir(join(c.ws, '.agents', 'memory', 'work_fact'));
    expect(files.filter((f) => f.endsWith('.memory.md.disable'))).toHaveLength(350);
    expect(files.filter((f) => f.endsWith('.memory.md'))).toHaveLength(350);
    const st = mdRunStatus();
    expect(st.running).toBe(false);
    expect(st.phase).toBe('done');
    expect(st.endedAt).not.toBe('');
  });

  it('总预算用尽：如实报还剩多少 + notice 指路续跑，续跑一次清完', async () => {
    const c = await ctx();
    const list = many(300, c.ws);
    const first = await runProjection({
      records: list, cfgRoot: undefined, dataDir: c.dataDir, ledger: c.ledger,
      maxRecords: 50, timeBudgetMs: 600_000, maxPasses: 2, totalBudgetMs: 600_000,
    });
    expect(first.remaining).toBeGreaterThan(0);
    expect(first.capped).toBe(true);
    expect(first.passes).toBe(2);
    expect(mdRunStatus().phase).toBe('failed');
    expect(mdRunStatus().notice).toContain('再点一次');
    // 续跑：游标从头重扫是幂等的（未变不吃配额），所以第二次必然清完
    const second = await runProjection({
      records: list, cfgRoot: undefined, dataDir: c.dataDir, ledger: c.ledger,
      maxRecords: 50, timeBudgetMs: 600_000,
    });
    expect(second.remaining).toBe(0);
    const files = await readdir(join(c.ws, '.agents', 'memory', 'work_fact'));
    expect(files.filter((f) => f.endsWith('.memory.md.disable'))).toHaveLength(150);
  });

  it('同一时刻只跑一个：第二个进来直接抛，不排队（排队=人以为点了没反应）', async () => {
    const c = await ctx();
    const list = many(400, c.ws);
    const p1 = runProjection({
      records: list, cfgRoot: undefined, dataDir: c.dataDir, ledger: c.ledger,
      maxRecords: 20, timeBudgetMs: 600_000,
    });
    expect(mdRunStatus().running).toBe(true);
    await expect(runProjection({
      records: list, cfgRoot: undefined, dataDir: c.dataDir, ledger: c.ledger,
      maxRecords: 20, timeBudgetMs: 600_000,
    })).rejects.toThrow('已有 md 投影任务在跑');
    await p1;
    expect(mdRunStatus().running).toBe(false);
  });

  it('先导出后退场（真实顺序）：改名后的第二轮既不重写也不重改名', async () => {
    const c = await ctx();
    const live = many(80, c.ws).map((r) => ({ ...r, validTo: undefined }));
    await runProjection({ records: live, cfgRoot: undefined, dataDir: c.dataDir, ledger: c.ledger, maxRecords: 30, timeBudgetMs: 600_000 });
    // 退场发生在导出之后：盘上那份是 live 渲染，改名分支不会重写它
    const retired = live.map((r, i) => (i % 2 === 0 ? { ...r, validTo: RETIRED_AT } : r));
    const a = await runProjection({ records: retired, cfgRoot: undefined, dataDir: c.dataDir, ledger: c.ledger, maxRecords: 30, timeBudgetMs: 600_000 });
    expect(a.suffix.renamed).toBe(40);
    const b = await runProjection({ records: retired, cfgRoot: undefined, dataDir: c.dataDir, ledger: c.ledger, maxRecords: 30, timeBudgetMs: 600_000 });
    // 这两行就是“点三下”的根因守卫：不拦的话每轮都重新写 40 份再改一次名
    expect(b.written).toBe(0);
    expect(b.unchanged).toBe(80);
    expect(b.suffix.renamed).toBe(0);
    expect(existsSync(join(c.ws, '.agents', 'memory', 'work_fact', 'run-0.memory.md'))).toBe(false);
    expect(existsSync(join(c.ws, '.agents', 'memory', 'work_fact', 'run-0.memory.md.disable'))).toBe(true);
  });

  it('跑完的文件内容仍可被导出侧指纹判为未变（进度面不改写语义）', async () => {
    const c = await ctx();
    const list = many(120, c.ws);
    await runProjection({ records: list, cfgRoot: undefined, dataDir: c.dataDir, ledger: c.ledger, maxRecords: 30, timeBudgetMs: 600_000 });
    const again = await runProjection({ records: list, cfgRoot: undefined, dataDir: c.dataDir, ledger: c.ledger, maxRecords: 30, timeBudgetMs: 600_000 });
    expect(again.written).toBe(0);
    expect(again.unchanged).toBe(120);
    expect(again.suffix.renamed).toBe(0);
    expect(again.remaining).toBe(0);
    expect(existsSync(join(c.ws, '.agents', 'memory', 'work_fact', 'run-0.memory.md'))).toBe(false);
    expect(existsSync(join(c.ws, '.agents', 'memory', 'work_fact', 'run-1.memory.md'))).toBe(true);
  });
});
