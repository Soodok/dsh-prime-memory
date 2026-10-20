/**
 * §B L1 决策凭证链（Wave 2a）—— task_19 双维回溯。
 *
 * 凭证链前四刀（建表 / 摘要 / 写入 / 保留）都是**往里存**；本刀是**往外读**，
 * 也是整条链唯一能被用户看见的地方——若读不出来，前面四刀等于没做。
 *
 * 两个维度对应两类互不替代的问题：
 * - **按 `record_id`**：「这条记忆是怎么来的？」——它的完整判定史（可能横跨多次 run）。
 * - **按 `run_id`**：「上一轮蒸馏都判了什么？」——那一批的全部决策（跨多条记录）。
 *
 * 本文件钉住四条：
 * ① 两个维度各自正确、同给时为 AND、**都不给时不整表泄漏**；
 * ② 排序确定（同一记录的历史跨 run 时顺序稳定，回溯才能复现）；
 * ③ 工具层与 RPC 层**共用同一形状**（一个事实源，两处消费）；
 * ④ 工具走与 `memory_search` 同款的**档位拒读门**——`off` 会话对记忆系统完全隐身，
 *    不该能反过来内省记忆系统的判定史。
 */
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MemoryDb } from '../src/store/sqlite.js';
import { L1Store } from '../src/store/l1.js';
import { L0Store } from '../src/store/l0.js';
import { buildReceipts } from '../src/store/receipts.js';
import type { L1Receipt } from '../src/store/receipts.js';
import type { MemoryLiveSettings } from '../src/contract.js';
import type { MemoryConfig } from '../src/config.js';
import type { LiveSettingsHandle } from '../src/settings.js';
import type { MemoryLogger } from '../src/types.js';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';

let dir: string;
/**
 * 已开启的库句柄:用例在断言失败时不会走到 `db.close()`,会让 teardown 的 rm 撞
 * EBUSY 并把 RED 信号淹没成 "Failed Suite"。故集中登记、在 afterAll 兜底关闭。
 */
const openedDbs: Array<{ close: () => void }> = [];
afterAll(async () => {
  for (const db of openedDbs) {
    try {
      db.close();
    } catch {
      /* 已关闭或已释放 */
    }
  }
  if (dir) await rm(dir, { recursive: true, force: true });
});

const noopLogger: MemoryLogger = { info: () => {}, warn: () => {}, error: () => {} };

let seq = 0;
function freshDb(): MemoryDb {
  if (!dir) dir = mkdtempSync(join(tmpdir(), 'dsh-receipts-query-'));
  const db = new MemoryDb(join(dir, `m-${++seq}-${Date.now()}.db`), 0);
  db.init();
  openedDbs.push(db);
  return db;
}

/** 一轮蒸馏:每条记录一个指定 kind。 */
function run(runId: string, at: string, items: Array<[string, string]>): L1Receipt[] {
  return buildReceipts(
    runId,
    at,
    items.map(([recordId, action]) => ({ recordId, candidateIds: [`cand-${recordId}`], action })),
  );
}

/** 一份可供三个层面共用的固定夹具(3 个 run,记录 rA 横跨 run1/run3)。 */
function seed(db: MemoryDb): void {
  db.recordReceipts(run('run_1', '2026-09-16T01:00:00.000Z', [['rA', 'store'], ['rB', 'skip']]));
  db.recordReceipts(run('run_2', '2026-09-16T02:00:00.000Z', [['rC', 'store']]));
  db.recordReceipts(run('run_3', '2026-09-16T03:00:00.000Z', [['rA', 'update'], ['rD', 'bogus_action']]));
}

describe('task_19 双维回溯:数据层', () => {
  it('① 按 record_id:返回该记录的判定行(查询层支持多行,见下方说明)', () => {
    // ⚠️ 本条用**手搓凭证**构造同 id 跨 run 的数据 —— 这是**查询层的能力**,不是生产形态。
    // 真实管线里 `record_id: newId('mem')` 每轮新铸,一个 id 只属于一轮,
    // 故该维度现实中恒 0/1 行(端到端实证见 tests/l1-receipts-backtracking.test.ts
    // 与 evidence/task19-backtracking-raw.json)。保留多行断言是为了钉住排序与
    // 分组逻辑在将来的 id 复用场景下不退化。
    const db = freshDb();
    seed(db);
    const rows = db.listReceipts({ recordId: 'rA', limit: 50 });
    expect(rows.map((r) => r.runId).sort()).toEqual(['run_1', 'run_3']);
    expect(rows.map((r) => r.recordId)).toEqual(['rA', 'rA']);
  });

  it('② 按 run_id:返回该批次的全部决策,跨多条记录', () => {
    const db = freshDb();
    seed(db);
    const rows = db.listReceipts({ runId: 'run_3', limit: 50 });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.recordId).sort()).toEqual(['rA', 'rD']);
    // 非法动作在写入时已归 skip_missing(读路径不重新解释,只是忠实回放)
    expect(rows.find((r) => r.recordId === 'rD')?.kind).toBe('skip_missing');
  });

  it('③ 两维同给为 AND(交集),不是并集', () => {
    const db = freshDb();
    seed(db);
    const both = db.listReceipts({ recordId: 'rA', runId: 'run_3', limit: 50 });
    expect(both).toHaveLength(1);
    expect(both[0].kind).toBe('update');
    // 交集为空的组合也必须为空,而不是回退成"任一维命中"
    expect(db.listReceipts({ recordId: 'rB', runId: 'run_3', limit: 50 })).toHaveLength(0);
  });

  it('④ 两维都不给 → 空(绝不整表返回:那会让一次误调用变成全库判定史导出)', () => {
    const db = freshDb();
    seed(db);
    expect(db.listReceipts({ limit: 50 })).toHaveLength(0);
    expect(db.countReceipts({})).toBe(0);
    // 反向对照:证明库里**确实**有数据,空结果是"拒答"而不是"本来就没有"
    expect(db.countReceipts({ recordId: 'rA' })).toBe(2);
  });

  it('⑤ limit 生效,且 count 不受 limit 影响(总数与分页各司其职)', () => {
    const db = freshDb();
    seed(db);
    expect(db.listReceipts({ runId: 'run_1', limit: 1 })).toHaveLength(1);
    expect(db.countReceipts({ runId: 'run_1' })).toBe(2);
  });

  it('⑥ 排序确定:同记录跨 run 时按 decided_at 倒序,同刻按 run_id 兜底', () => {
    const db = freshDb();
    seed(db);
    const rows = db.listReceipts({ recordId: 'rA', limit: 50 });
    expect(rows.map((r) => r.runId)).toEqual(['run_3', 'run_1']); // 新的在前

    // 同一时刻的两批:靠 run_id 降序兜底 → 结果**确定**,不依赖插入顺序
    const a = freshDb();
    a.recordReceipts(run('run_zzz', '2026-09-16T05:00:00.000Z', [['rX', 'store']]));
    a.recordReceipts(run('run_aaa', '2026-09-16T05:00:00.000Z', [['rX', 'merge']]));
    expect(a.listReceipts({ recordId: 'rX', limit: 50 }).map((r) => r.runId)).toEqual(['run_zzz', 'run_aaa']);

    const b = freshDb();
    b.recordReceipts(run('run_aaa', '2026-09-16T05:00:00.000Z', [['rX', 'merge']]));
    b.recordReceipts(run('run_zzz', '2026-09-16T05:00:00.000Z', [['rX', 'store']]));
    expect(b.listReceipts({ recordId: 'rX', limit: 50 }).map((r) => r.runId)).toEqual(['run_zzz', 'run_aaa']);
  });

  it('⑦ 行形状完整映射(六列全出,遗漏任一列都会让回溯失去依据)', () => {
    const db = freshDb();
    seed(db);
    const row = db.listReceipts({ recordId: 'rA', runId: 'run_1', limit: 1 })[0];
    expect(row).toEqual({
      receiptId: expect.any(String),
      runId: 'run_1',
      recordId: 'rA',
      kind: 'store',
      inputDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      decidedAt: '2026-09-16T01:00:00.000Z',
    });
  });

  it('⑧ L1Store 缝合层透传(工具/端点只认它,不直连 db)', async () => {
    const db = freshDb();
    seed(db);
    const dataDir = join(dir, `l1-${Date.now()}`);
    const l1 = new L1Store(dataDir, db, undefined, 'hybrid', noopLogger, 0);
    await l1.init();
    expect(l1.listReceipts({ runId: 'run_2', limit: 50 })).toHaveLength(1);
    expect(l1.countReceipts({ runId: 'run_2' })).toBe(1);
  });
});

// ── 工具层 ──
type RegisteredTool = ToolDefinition;

function liveHandle(over: Partial<MemoryLiveSettings> = {}): LiveSettingsHandle {
  // 基线不含 conflictFreeze 键(留空 = 不覆盖,见 runner.ts 的 !== undefined 判定),故用断言
  const s = {
    enabled: true, capture: true, distill: true, recall: true,
    reasoningEffort: '', distillProvider: '', distillModel: '', distillChain: [],
    distillBudgets: { extract: 0, dedup: 0, l2: 0, l3: 0, graph: 0 }, distillMaxInputChars: 0,
    distillLayerChains: { l1: [], l2: [], l3: [] }, distillMode: '', directBaseURL: '', directApiKey: '',
    embedRemoteBaseURL: '', embedRemoteApiKey: '', embedRemoteModel: '', embedRemoteDimensions: 0,
    memoryMutate: false,
    ...over,
  } as MemoryLiveSettings;
  return { supported: true, get: () => s, update: async (patch) => { Object.assign(s, patch); } };
}

async function toolHarness() {
  const { registerMemoryTools } = await import('../src/tools/index.js');
  const { SessionModeStore } = await import('../src/store/session-modes.js');

  const db = freshDb();
  seed(db);
  const dataDir = join(dir, `tool-${Date.now()}`);
  const l1 = new L1Store(dataDir, db, undefined, 'hybrid', noopLogger, 0);
  const l0 = new L0Store(db);
  await l1.init();

  const modes = new SessionModeStore('/nonexistent', 'auto');
  const registered: RegisteredTool[] = [];
  const ctx = {
    tools: { register: (t: ToolDefinition) => registered.push(t as unknown as RegisteredTool) },
    get: () => undefined,
  } as unknown as Parameters<typeof registerMemoryTools>[0];

  const cfg = { tools: true, recall: { maxResults: 5 } } as unknown as MemoryConfig;
  const live = liveHandle();
  registerMemoryTools(ctx, cfg, { l1, l0, scenes: {}, persona: {} } as never, noopLogger, modes, live);

  const tool = registered.find((t) => t.name === 'memory_receipts');
  return { tool, modes, db };
}

/** 构造一个带 agent 标识的 exec(`resolveModeOwner` 靠它上溯档位)。 */
function execFor(sessionId: string): ToolRunContext {
  return { agent: { id: sessionId, session: { header: { id: sessionId } } } } as never;
}

describe('task_19 双维回溯:工具层', () => {
  it('⑨ 工具已注册,且两维任一即可用', async () => {
    const { tool } = await toolHarness();
    expect(tool).toBeDefined();

    const byRun = (await tool!.execute({ run_id: 'run_1' }, execFor('s1'))) as {
      items: Array<{ record_id: string }>;
      total: number;
    };
    expect(byRun.total).toBe(2);
    expect(byRun.items.map((i) => i.record_id).sort()).toEqual(['rA', 'rB']);

    const byRecord = (await tool!.execute({ record_id: 'rA' }, execFor('s1'))) as { total: number };
    expect(byRecord.total).toBe(2);
  });

  it('⑩ 两维都不给 → 明确拒答并提示用法(不静默返回空)', async () => {
    const { tool } = await toolHarness();
    const out = (await tool!.execute({}, execFor('s1'))) as { items: unknown[]; total: number; notice?: string };
    expect(out.total).toBe(0);
    expect(out.items).toHaveLength(0);
    expect(out.notice).toMatch(/record_id|run_id/);
  });

  it('⑪ 档位拒读门:off 会话不得反查判定史(与 memory_search 同款门)', async () => {
    const { tool, modes } = await toolHarness();
    // 不设档位的会话正常可读(对照组:证明下面的失败不是"工具整体坏掉")
    const ok = (await tool!.execute({ run_id: 'run_1' }, execFor('free'))) as { total: number };
    expect(ok.total).toBe(2);

    modes.set('blocked', 'off');
    const blocked = (await tool!.execute({ run_id: 'run_1' }, execFor('blocked'))) as {
      items: unknown[];
      total: number;
      notice?: string;
    };
    expect(blocked.total).toBe(0);
    expect(blocked.items).toHaveLength(0);
    expect(blocked.notice).toMatch(/关闭|隐身/);
  });
});

// ── RPC 层 ──
/**
 * 直调端点分发层(与 rpc.test.ts 同径,但不复制其 harness):端点只需 stores.l1,
 * 故这里不再搭 L0/场景/画像,避免用例被无关装配拖重。
 */
async function callEndpoint(payload: unknown): Promise<unknown> {
  const { handleEndpoint, buildEndpointDeps } = await import('../src/stats.js');
  const db = freshDb();
  seed(db);
  const dataDir = join(dir, `rpc-${Date.now()}`);
  const l1 = new L1Store(dataDir, db, undefined, 'hybrid', noopLogger, 0);
  await l1.init();
  const cfg = { dataDir, tools: true } as unknown as MemoryConfig;
  const deps = buildEndpointDeps(
    { ctx: {} as never, cfg, stores: { l1 } as never, logger: noopLogger },
    {},
    undefined,
  );
  return handleEndpoint('dsh-memory/receipts', payload, deps);
}

describe('task_19 双维回溯:RPC 端点', () => {
  it('⑫ 端点与工具共用同一形状(snake_case,与 DB 同形)', async () => {
    const byRun = (await callEndpoint({ runId: 'run_1' })) as {
      dimension: string;
      items: Array<Record<string, unknown>>;
      total: number;
    };
    expect(byRun.total).toBe(2);
    expect(byRun.dimension).toBe('run');
    expect(Object.keys(byRun.items[0]).sort()).toEqual(
      ['decided_at', 'input_digest', 'kind', 'receipt_id', 'record_id', 'run_id'].sort(),
    );
  });

  it('⑬ 两维都不给 → 报错(端点层比工具层严格:没有"给用户看的提示"这个出口)', async () => {
    // 端点载荷是 camelCase(与其余端点一致),工具参数才是 snake_case —— 故此处断言 camelCase
    await expect(callEndpoint({})).rejects.toThrow(/recordId|runId/);
  });

  it('⑭ 按 record_id 回溯端点:返回跨 run 的完整判定史', async () => {
    const byRecord = (await callEndpoint({ recordId: 'rA' })) as {
      dimension: string;
      items: Array<{ run_id: string; kind: string }>;
      total: number;
    };
    expect(byRecord.dimension).toBe('record');
    expect(byRecord.total).toBe(2);
    expect(byRecord.items.map((i) => i.run_id)).toEqual(['run_3', 'run_1']);
  });
});
