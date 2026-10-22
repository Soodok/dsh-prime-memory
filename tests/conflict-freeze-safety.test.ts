/**
 * §C 矛盾冻结 / task_24:安全阀 —— 队列上限 + 超时降级。
 *
 * 冻结的代价是**消耗人的注意力**。若没有安全阀,两个后果都是确定的:
 * ① 一个频繁产出矛盾的部署,队列会**无界增长**,人永远追不上;
 * ② 一条永远没人看的待裁决对会把"新记忆已入库、旧记忆仍并列"的状态**永久**留在库里,
 *    检索层于是长期同时召回两条互相矛盾的记忆——比它想解决的问题更糟。
 *
 * 故安全阀的语义是**回落自动裁决**(= 按 LLM 给出的 winner/loser 了结),
 * 而**不是**"偷偷丢掉待裁决对":被自动了结的对**仍写进 conflict_pending**,
 * 只是 `resolved_at` 非空、`resolution='auto'`——审计痕迹必须留下,
 * 否则"机器替人裁决"这个 §C 最想消灭的行为会以"悄悄发生"的形式回来。
 *
 * 两条判据:
 * ① **队列上限**:未裁决数达上限时**不再停放**,直接自动了结;
 * ② **超时降级**:停放超过 timeoutDays 的对,在下一轮蒸馏开头被自动了结。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const { readSupersedeMarker } = await import('../src/store/supersede.js');

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
const { memorySchema } = await import('../src/config.js');
type MemoryConfig = import('../src/config.js').MemoryConfig;
// 动态 import 值绑定不带类型空间,补同名类型别名供类型位使用
type MemoryDb = import('../src/store/sqlite.js').MemoryDb;

/** 夹具基线取自真 schema 的部署默认值,只在用例关心处覆盖(防 schema 漂移)。 */
const DEFAULTS = (memorySchema as unknown as (v: unknown) => Record<string, unknown>)({});

let root: string;
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} } as never;

function mkCfg(dataDir: string, freeze: { maxPending: number; timeoutDays: number }): MemoryConfig {
  return {
    ...DEFAULTS,
    dataDir, family: 'auto',
    graph: { enabled: false },
    conflictFreeze: { enabled: true, ...freeze },
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
      scene_name: '安全阀验证场景',
      message_ids: ['m1'],
      memories: [
        { record_id: '占位', content, type: 'work_fact', priority: 60, family: 'work', source_message_ids: ['m1'], metadata: {} },
      ],
    },
  ]);
}

const MSGS = [
  { id: 'm1', role: 'user', content: '安全阀验证', timestamp: 1_700_000_000_000 },
  { id: 'm2', role: 'assistant', content: '收到', timestamp: 1_700_000_001_000 },
] as never;

function pendingRows(db: MemoryDb): Array<{ pair_id: string; winner_id: string; loser_id: string; resolved_at: string; resolution: string }> {
  return (
    db as unknown as {
      db: { prepare: (s: string) => { all: () => Array<{ pair_id: string; winner_id: string; loser_id: string; resolved_at: string; resolution: string }> } };
    }
  ).db
    .prepare('SELECT pair_id, winner_id, loser_id, resolved_at, resolution FROM conflict_pending ORDER BY created_at, pair_id')
    .all();
}

const OLD_TEXT = '安全阀验证:项目 Beta 的负责人在 2026 年是张三';
const NEW_TEXT = '安全阀验证:项目 Beta 的负责人在 2026 年是李四';

interface Setup {
  store: InstanceType<typeof L1Store>;
  db: MemoryDb;
  dataDir: string;
  oldId: string;
  close: () => void;
}

async function setup(tag: string, freeze: { maxPending: number; timeoutDays: number }): Promise<Setup> {
  root = root ?? (await mkdtemp(join(tmpdir(), 'dsh-conflict-valve-')));
  const dataDir = join(root, `${tag}-${Date.now()}`);
  const db = new MemoryDb(join(dataDir, 'memory.db'), 0);
  db.init();
  const store = new L1Store(dataDir, db, undefined, 'keyword', noopLogger, 0);
  await store.init();
  const cfg = mkCfg(dataDir, freeze);
  extractQueue.push(extraction(OLD_TEXT));
  actionQueue.push('store');
  const first = await runExtraction({} as never, cfg, store, mkStates(), MSGS, [], noopLogger, 'work');
  const oldId = first.newRecords[0]?.id ?? '';
  expect(oldId).toMatch(/^mem_/);
  return { store, db, dataDir, oldId, close: () => db.close() };
}

async function runConflict(s: Setup, freeze: { maxPending: number; timeoutDays: number }) {
  extractQueue.push(extraction(NEW_TEXT));
  actionQueue.push('conflict');
  return runExtraction({} as never, mkCfg(s.dataDir, freeze), s.store, mkStates(), MSGS, [], noopLogger, 'work');
}

describe('task_24 安全阀:队列上限', () => {
  it('未裁决数已达上限时不再停放,直接按 LLM 的 winner/loser 自动了结', async () => {
    const freeze = { maxPending: 1, timeoutDays: 0 };
    const s = await setup('cap', freeze);
    try {
      // 预置一条未裁决对,把队列占满
      s.store.recordConflictPending([
        { pairId: 'pair_seed', runId: 'run_seed', winnerId: 'w_seed', loserId: 'l_seed', createdAt: new Date().toISOString(), resolvedAt: '', resolution: '' },
      ]);
      expect(pendingRows(s.db).filter((r) => r.resolved_at === '')).toHaveLength(1);

      const out = await runConflict(s, freeze);

      const rows = pendingRows(s.db);
      // ① 新的那一对**仍在表里**(审计痕迹),但已是已裁决态
      const auto = rows.filter((r) => r.resolution === 'auto');
      expect(auto).toHaveLength(1);
      expect(auto[0].resolved_at).not.toBe('');
      expect(auto[0].winner_id).toBe(out.newRecords[0]?.id);
      expect(auto[0].loser_id).toBe(s.oldId);
      // ② "不再停放"的实质:未裁决数没有增加
      expect(rows.filter((r) => r.resolved_at === '')).toHaveLength(1);
      // ③ 自动裁决真的执行了:LLM 的 loser 已**退场(软删)**——主表保留但退出检索面
      const [autoGone] = s.store.getByIds([s.oldId]);
      expect(autoGone, '软删:主表行保留').toBeDefined();
      expect(autoGone.metadata?.dsh_superseded).toBeDefined(); // 门1:退场凭 marker，不闭 valid_to
      expect(readSupersedeMarker(autoGone.metadata)).toMatchObject({ reason: 'conflict', verdict: 'auto' });
      expect(s.store.listRetired({ limit: 10, offset: 0 }).items.map((r) => r.id)).toContain(s.oldId);
      // ④ winner(新记忆)在库
      expect(s.store.getByIds([out.newRecords[0]?.id ?? ''])).toHaveLength(1);
    } finally {
      s.close();
    }
  });

  it('队列未满时照常停放(防止上限判据写成恒真)', async () => {
    const freeze = { maxPending: 10, timeoutDays: 0 };
    const s = await setup('room', freeze);
    try {
      const out = await runConflict(s, freeze);
      const rows = pendingRows(s.db);
      expect(rows).toHaveLength(1);
      expect(rows[0].resolved_at).toBe(''); // 未裁决
      expect(rows[0].resolution).toBe('');
      expect(s.store.getByIds([s.oldId])).toHaveLength(1); // 旧记忆仍在
      expect(s.store.getByIds([out.newRecords[0]?.id ?? ''])).toHaveLength(1);
    } finally {
      s.close();
    }
  });
});

describe('task_24 安全阀:超时降级', () => {
  it('停放超过 timeoutDays 的对,在下一轮蒸馏开头被自动了结', async () => {
    const freeze = { maxPending: 100, timeoutDays: 7 };
    const s = await setup('timeout', freeze);
    try {
      // 先正常停放一对,再把它的 created_at 改成 30 天前(模拟长期无人裁决)
      await runConflict(s, freeze);
      const before = pendingRows(s.db);
      expect(before).toHaveLength(1);
      expect(before[0].resolved_at).toBe('');

      const stale = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const raw = (s.db as unknown as { db: { prepare: (x: string) => { run: (...a: unknown[]) => unknown } } }).db;
      raw.prepare('UPDATE conflict_pending SET created_at = ?').run(stale);

      // 下一轮蒸馏(任意一轮即可)开头应把它扫掉
      extractQueue.push(extraction('安全阀验证:超时扫描轮'));
      actionQueue.push('store');
      await runExtraction({} as never, mkCfg(s.dataDir, freeze), s.store, mkStates(), MSGS, [], noopLogger, 'work');

      const after = pendingRows(s.db);
      expect(after).toHaveLength(1);
      expect(after[0].resolved_at).not.toBe('');
      expect(after[0].resolution).toBe('auto');
      // loser 已**退场(软删)**,winner 仍在
      const [timeoutGone] = s.store.getByIds([after[0].loser_id]);
      expect(timeoutGone, '软删:主表行保留').toBeDefined();
      expect(timeoutGone.metadata?.dsh_superseded).toBeDefined(); // 门1:marker 单源
      expect(s.store.getByIds([after[0].winner_id])).toHaveLength(1);
    } finally {
      s.close();
    }
  });

  it('未超时的对不被扫掉(防止超时判据写成恒真)', async () => {
    const freeze = { maxPending: 100, timeoutDays: 7 };
    const s = await setup('fresh', freeze);
    try {
      await runConflict(s, freeze);
      extractQueue.push(extraction('安全阀验证:未超时轮'));
      actionQueue.push('store');
      await runExtraction({} as never, mkCfg(s.dataDir, freeze), s.store, mkStates(), MSGS, [], noopLogger, 'work');

      const after = pendingRows(s.db);
      expect(after).toHaveLength(1);
      expect(after[0].resolved_at).toBe(''); // 仍是未裁决
    } finally {
      s.close();
    }
  });

  it('timeoutDays = 0 表示**不做超时降级**(显式关闭,而非"立刻全部超时")', async () => {
    const freeze = { maxPending: 100, timeoutDays: 0 };
    const s = await setup('disabled', freeze);
    try {
      await runConflict(s, freeze);
      const raw = (s.db as unknown as { db: { prepare: (x: string) => { run: (...a: unknown[]) => unknown } } }).db;
      raw.prepare('UPDATE conflict_pending SET created_at = ?').run('2000-01-01T00:00:00.000Z');

      extractQueue.push(extraction('安全阀验证:超时关闭轮'));
      actionQueue.push('store');
      await runExtraction({} as never, mkCfg(s.dataDir, freeze), s.store, mkStates(), MSGS, [], noopLogger, 'work');

      expect(pendingRows(s.db)[0].resolved_at).toBe('');
    } finally {
      s.close();
    }
  });
});
