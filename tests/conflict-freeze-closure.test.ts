/**
 * §C 矛盾冻结 / task_26 —— **冻结 → 裁决闭环端到端**(真管线 → 真队列 → 真端点)。
 *
 * 为什么在单测与分片 E2E 之外还要这一条:前面几个文件各自证明了一半——
 * `conflict-freeze-semantics` 证明"真管线会冻结",`conflict-freeze-resolve`
 * 证明"真端点能裁决"。但两段之间隔着 `record_id` 的生成方式、
 * `pair_id` 的构造、`run_id` 的传递、图谱状态的同步——任何一处语义漂移都会
 * 让两边各自全绿而**闭环实际不通**。本计划已被这类"分段全绿、合起来不通"
 * 咬过五次(见 findings.md §13.4/§13.6/§14.6/§14.7)。
 *
 * 留档:设 `CONFLICT_EVIDENCE_OUT=<path>` 时把真实队列行的**原始 JSON** 写到该路径。
 * 不设则只断言,不落任何文件。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const extractQueue: string[] = [];
const actionQueue: string[] = [];

vi.mock('../src/llm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/llm.js')>();
  return {
    ...actual,
    callLLM: vi.fn(async (_ctx: unknown, _cfg: unknown, opts: { layer?: string; user?: string }) => {
      if (opts?.layer !== 'l1-dedup') return extractQueue.shift() ?? '[]';
      const user = String(opts.user ?? '');
      const ids = [...user.matchAll(/record_id: (\S+?)\)/g)].map((m) => m[1]);
      const candIds = [...user.matchAll(/【关联候选 ID】\["(\S+?)"\]/g)].map((m) => m[1]);
      const action = actionQueue.shift() ?? 'store';
      return JSON.stringify(
        ids.map((id, i) =>
          action === 'conflict'
            ? { record_id: id, action: 'conflict', winner: id, loser: candIds[i] }
            : { record_id: id, action },
        ),
      );
    }),
  };
});

const { runExtraction } = await import('../src/pipeline/l1.js');
const { L1Store } = await import('../src/store/l1.js');
const { MemoryDb } = await import('../src/store/sqlite.js');
const { handleEndpoint, buildEndpointDeps } = await import('../src/stats.js');
const { memorySchema } = await import('../src/config.js');
type MemoryConfig = import('../src/config.js').MemoryConfig;
// 动态 import 值绑定不带类型空间,补同名类型别名供类型位使用
type MemoryDb = import('../src/store/sqlite.js').MemoryDb;

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} } as never;
const DEFAULTS = (memorySchema as unknown as (v: unknown) => Record<string, unknown>)({});

let root: string;
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

function mkCfg(dataDir: string): MemoryConfig {
  return {
    ...DEFAULTS,
    dataDir, family: 'auto',
    graph: { enabled: false },
    // 关掉安全阀:本用例要的是"人还没裁决时它一直在队列里",不是超时/上限路径
    conflictFreeze: { enabled: true, maxPending: 100, timeoutDays: 0 },
    recall: { enabled: true, maxResults: 5, maxCharsPerMemory: 500, maxTotalRecallChars: 2000, timeoutMs: 5000, includePersona: true, includeSceneNav: true, strategy: 'keyword', scoreThreshold: 0.3, decayHalfLifeDays: 30 },
    extract: { enabled: true, minMessages: 1, idleSeconds: 300, backgroundMessages: 10, candidatePool: 5 },
    hall: { enabled: ['work'] },
  } as MemoryConfig;
}

function mkStates(): never {
  const s = () => ({ lastScene: '', chain: [], lastAt: 0, lastRunAt: 0, warmupThreshold: 0, distilledCount: 0 });
  return { chat: s(), work: s() } as never;
}

function extraction(content: string): string {
  return JSON.stringify([
    {
      scene_name: '闭环验证场景',
      message_ids: ['m1'],
      memories: [
        { record_id: '占位', content, type: 'work_fact', priority: 60, family: 'work', source_message_ids: ['m1'], metadata: {} },
      ],
    },
  ]);
}

const MSGS = [
  { id: 'm1', role: 'user', content: '闭环验证', timestamp: 1_700_000_000_000 },
  { id: 'm2', role: 'assistant', content: '收到', timestamp: 1_700_000_001_000 },
] as never;

function rawQueue(db: MemoryDb): Array<Record<string, unknown>> {
  return (
    db as unknown as { db: { prepare: (s: string) => { all: () => Array<Record<string, unknown>> } } }
  ).db
    .prepare('SELECT pair_id, run_id, winner_id, loser_id, created_at, resolved_at, resolution FROM conflict_pending ORDER BY created_at, pair_id')
    .all();
}

describe('task_26 §C 冻结 → 裁决 闭环(端到端)', () => {
  it('真管线冻结 → 真端点裁决 → 双方记忆状态收敛,且队列行留下完整审计痕迹', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-conflict-closure-'));
    const dataDir = join(root, 'data');
    const db = new MemoryDb(join(dataDir, 'memory.db'), 0);
    db.init();
    const store = new L1Store(dataDir, db, undefined, 'keyword', noopLogger, 0);
    await store.init();
    const cfg = mkCfg(dataDir);
    const ctx = {} as never;

    try {
      // ── 第 1 轮:旧记忆入库 ──
      extractQueue.push(extraction('闭环验证:项目 Delta 的负责人在 2026 年是张三'));
      actionQueue.push('store');
      const r1 = await runExtraction(ctx, cfg, store, mkStates(), MSGS, [], noopLogger, 'work');
      const oldId = r1.newRecords[0]?.id ?? '';
      expect(oldId).toMatch(/^mem_/);

      // ── 第 2 轮:新记忆与旧记忆矛盾 → 冻结 ──
      extractQueue.push(extraction('闭环验证:项目 Delta 的负责人在 2026 年是李四'));
      actionQueue.push('conflict');
      const r2 = await runExtraction(ctx, cfg, store, mkStates(), MSGS, [], noopLogger, 'work');
      const newId = r2.newRecords[0]?.id ?? '';
      expect(newId).toMatch(/^mem_/);

      // 冻结态:双方**都在库**,队列里一条**未裁决**
      expect(store.getByIds([oldId])).toHaveLength(1);
      expect(store.getByIds([newId])).toHaveLength(1);
      const frozenRows = rawQueue(db);
      expect(frozenRows).toHaveLength(1);
      expect(frozenRows[0].resolved_at).toBe('');
      expect(frozenRows[0].run_id).toMatch(/^run_/); // 接上 §B 凭证批次
      const pairId = String(frozenRows[0].pair_id);

      // §B 凭证必须**认得** conflict 动作。§C 的裁决可审计性完全依赖这一条:
      // 若凭证把它记成 skip_missing("模型没答"),审计链上看到的是"这轮没决策",
      // 而真实情况恰恰相反——模型**明确说**了"我判不了"。那是假证据。
      const conflictRunReceipts = (await handleEndpoint(
        'dsh-memory/receipts',
        { runId: String(frozenRows[0].run_id) },
        buildEndpointDeps({ ctx, cfg, stores: { l1: store } as never, logger: noopLogger }, {}, undefined),
      )) as { items: Array<{ kind: string }> };
      expect(conflictRunReceipts.items.map((i) => i.kind)).toEqual(['conflict']);

      // ── 裁决:判新记忆为真(即 LLM 建议的 winner) ──
      const deps = buildEndpointDeps(
        { ctx, cfg, stores: { l1: store } as never, logger: noopLogger },
        {},
        undefined,
      );
      const verdict = (await handleEndpoint(
        'dsh-memory/conflict-resolve',
        { pairId, outcome: 'winner' },
        deps,
      )) as { resolved_at: string; removed_record_id: string };

      // 收敛态:胜方在库(活动)、败方**软删退场**(主表仍在,可恢复)、队列清空、行留痕
      expect(verdict.removed_record_id).toBe(oldId);
      const [retired] = store.getByIds([oldId]);
      expect(retired, '软删:主表行必须保留').toBeDefined();
      expect(retired.metadata?.dsh_superseded).toBeDefined(); // 门1 解耦:退场凭 marker，不再闭 valid_to
      expect(store.listRetired({ limit: 10, offset: 0 }).items.map((r) => r.id)).toContain(oldId);
      expect(store.getByIds([newId])).toHaveLength(1);
      expect(store.listConflictPending()).toHaveLength(0);

      const resolvedRows = rawQueue(db);
      expect(resolvedRows).toHaveLength(1);
      expect(resolvedRows[0].resolution).toBe('winner');
      expect(resolvedRows[0].resolved_at).toBe(verdict.resolved_at);
      // winner/loser **仍是 LLM 当时给的**,不被裁决改写——裁决只落结论列
      expect(resolvedRows[0].winner_id).toBe(newId);
      expect(resolvedRows[0].loser_id).toBe(oldId);

      // ── 可选留档:原始 JSON ──
      const out = process.env.CONFLICT_EVIDENCE_OUT;
      if (out) {
        const receipts = await handleEndpoint('dsh-memory/receipts', { runId: String(frozenRows[0].run_id) }, deps);
        await writeFile(
          out,
          JSON.stringify(
            {
              生成方式: '真 runExtraction × 2(仅 LLM 传输层打桩)→ 真 handleEndpoint(conflict-resolve)',
              生成时间: new Date().toISOString(),
              第1轮入库记录: oldId,
              第2轮入库记录: newId,
              冻结后队列行: frozenRows,
              裁决返回: verdict,
              裁决后队列行: resolvedRows,
              同批次凭证链: receipts,
              裁决后_败方主表条数_软删可恢复: store.getByIds([oldId]).length,
              裁决后_胜方主表条数: store.getByIds([newId]).length,
              裁决后_已退场条数: store.listRetired({ limit: 100, offset: 0 }).total,
              裁决后_未裁决条数: store.listConflictPending().length,
            },
            null,
            2,
          ),
        );
      }
    } finally {
      db.close();
    }
  });
});
