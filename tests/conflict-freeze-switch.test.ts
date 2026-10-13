/**
 * §C 矛盾冻结 / task_23:配置开关 —— **默认关，关闭态零行为漂移**。
 *
 * "零漂移"不能靠人工复核 diff 断言，必须是**结构性**的：关闭态
 * `getConflictDetectionSystemPrompt` 直接 `return base`，base 是三份已发布常量本身，
 * 所以"关闭态 prompt 与改动前逐字一致"是构造出来的，不是比对出来的。
 *
 * 但静态比对还不够——它证明不了管线**真的把开关传下去了**。故本文件同时跑真管线：
 * 抓 `l1-dedup` 那次调用实际送出的 system prompt，断言
 * ① 关 → 与 base 逐字相同；② 开 → 含 conflict 动作。
 * ② 是防"接线漏了、静态函数却全绿"的反向验证（本计划已被空洞通过咬过四次）。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

/** 每轮 `l1-dedup` 调用实际送出的 system prompt。 */
const dedupSystems: string[] = [];
const extractQueue: string[] = [];

vi.mock('../src/llm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/llm.js')>();
  return {
    ...actual,
    callLLM: vi.fn(async (_ctx: unknown, _cfg: unknown, opts: { layer?: string; system?: string; user?: string }) => {
      if (opts?.layer !== 'l1-dedup') return extractQueue.shift() ?? '[]';
      dedupSystems.push(String(opts.system ?? ''));
      const ids = [...String(opts.user ?? '').matchAll(/record_id: (\S+?)\)/g)].map((m) => m[1]);
      return JSON.stringify(ids.map((id) => ({ record_id: id, action: 'store' })));
    }),
  };
});

const { CONFLICT_DETECTION_SYSTEM_PROMPT, WORK_CONFLICT_DETECTION_SYSTEM_PROMPT, ALL_CONFLICT_DETECTION_SYSTEM_PROMPT, getConflictDetectionSystemPrompt } =
  await import('../src/prompts/l1-dedup.js');
const { memorySchema } = await import('../src/config.js');
const { runExtraction } = await import('../src/pipeline/l1.js');
const { L1Store } = await import('../src/store/l1.js');
const { MemoryDb } = await import('../src/store/sqlite.js');
type MemoryConfig = import('../src/config.js').MemoryConfig;

const MODES = ['chat', 'work', 'auto'] as const;
const BASE: Record<(typeof MODES)[number], string> = {
  chat: CONFLICT_DETECTION_SYSTEM_PROMPT,
  work: WORK_CONFLICT_DETECTION_SYSTEM_PROMPT,
  auto: ALL_CONFLICT_DETECTION_SYSTEM_PROMPT,
};
/** 改动前的动作枚举行——base 必须逐字保持这一行。 */
const LEGACY_ENUM = '"action": "store|update|skip|merge"';
const CONFLICT_ACTION_DEF = /- "conflict"：/;

let root: string;
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} } as never;

describe('task_23 关闭态零漂移（静态）', () => {
  it.each(MODES)('%s 变体:不传 opts 时返回 base 本身', (mode) => {
    expect(getConflictDetectionSystemPrompt(mode)).toBe(BASE[mode]);
  });

  it.each(MODES)('%s 变体:显式 conflictFreeze=false 时仍返回 base 本身', (mode) => {
    expect(getConflictDetectionSystemPrompt(mode, { conflictFreeze: false })).toBe(BASE[mode]);
  });

  it.each(MODES)('%s 变体:关闭态不含 conflict 动作定义', (mode) => {
    expect(getConflictDetectionSystemPrompt(mode, { conflictFreeze: false })).not.toMatch(CONFLICT_ACTION_DEF);
  });

  it.each(MODES)('%s 变体:base 的动作枚举行保持改动前的取值集合', (mode) => {
    expect(BASE[mode]).toContain(LEGACY_ENUM);
  });

  it('部署默认值为关', () => {
    const defaults = (memorySchema as unknown as (v: unknown) => Record<string, unknown>)({});
    expect(defaults.conflictFreeze).toBeDefined();
    expect((defaults.conflictFreeze as Record<string, unknown>).enabled).toBe(false);
  });
});

describe('task_23 开关确实接进了管线（端到端）', () => {
  // 夹具基线取自真 schema 的部署默认值,只在用例关心处覆盖(手写整份 config
  // 会在 schema 新增键时静默漂移——本波已被咬过两次)。
  const DEFAULTS = (memorySchema as unknown as (v: unknown) => Record<string, unknown>)({});
  function cfg(dataDir: string, enabled: boolean): MemoryConfig {
    return {
      ...DEFAULTS,
      dataDir, family: 'auto',
      graph: { enabled: false },
      conflictFreeze: { enabled, maxPending: 1000, timeoutDays: 0 },
      recall: { enabled: true, maxResults: 5, maxCharsPerMemory: 500, maxTotalRecallChars: 2000, timeoutMs: 5000, includePersona: true, includeSceneNav: true, strategy: 'keyword', scoreThreshold: 0.3, decayHalfLifeDays: 30 },
      extract: { enabled: true, minMessages: 1, idleSeconds: 300, backgroundMessages: 10, candidatePool: 5 },
      hall: { enabled: ['work'] },
    } as MemoryConfig;
  }

  const STATES = () => {
    const s = () => ({ lastScene: '', chain: [], lastAt: 0, lastRunAt: 0, warmupThreshold: 0, distilledCount: 0 });
    return { chat: s(), work: s() } as never;
  };

  const MSGS = [
    { id: 'm1', role: 'user', content: '开关接线验证', timestamp: 1_700_000_000_000 },
    { id: 'm2', role: 'assistant', content: '收到', timestamp: 1_700_000_001_000 },
  ] as never;

  function extraction(): string {
    return JSON.stringify([
      {
        scene_name: '开关接线场景',
        message_ids: ['m1'],
        memories: [
          { record_id: '占位', content: '开关接线验证:一条工作事实', type: 'work_fact', priority: 60, family: 'work', source_message_ids: ['m1'], metadata: {} },
        ],
      },
    ]);
  }

  async function runOnce(enabled: boolean, tag: string): Promise<string> {
    root = root ?? (await mkdtemp(join(tmpdir(), 'dsh-conflict-switch-')));
    const dataDir = join(root, `${tag}-${Date.now()}`);
    const db = new MemoryDb(join(dataDir, 'memory.db'), 0);
    db.init();
    const store = new L1Store(dataDir, db, undefined, 'keyword', noopLogger, 0);
    await store.init();
    dedupSystems.length = 0;
    extractQueue.push(extraction());
    try {
      await runExtraction({} as never, cfg(dataDir, enabled), store, STATES(), MSGS, [], noopLogger, 'work');
    } finally {
      db.close();
    }
    expect(dedupSystems).toHaveLength(1);
    return dedupSystems[0] ?? '';
  }

  it('关:真管线送出的去重 prompt 不含 conflict 动作，且等于纯函数同名开关下的那份', async () => {
    // 以前这条是"与 base 逐字相同"。`naming.enabled` 现在默认开（实测：只给定义时
    // 骨架齐备 0/23，见 tools/ab-distill.mjs），管线会额外追加 merged_title 条款，
    // 所以"逐字等于 base"只在 naming 也关时成立。本用例要钉的是 **conflictFreeze 自己**
    // 的零漂移，不是 naming 的：断言改成"不含 conflict 动作 + 与纯函数同名开关结果相等"，
    // 既不给旧断言打掩护，也不拿另一个开关的默认值变化当它红了的理由。
    const title = (DEFAULTS.naming as { enabled?: boolean } | undefined)?.enabled === true;
    const system = await runOnce(false, 'off');
    expect(system).not.toMatch(CONFLICT_ACTION_DEF);
    expect(system).toBe(getConflictDetectionSystemPrompt('work', { conflictFreeze: false, title }));
    if (title) expect(system).toContain('merged_title');
    else expect(system).toBe(WORK_CONFLICT_DETECTION_SYSTEM_PROMPT);
  });

  it('开:真管线送出的去重 prompt 含 conflict 动作（接线未漏）', async () => {
    const system = await runOnce(true, 'on');
    expect(system).not.toBe(WORK_CONFLICT_DETECTION_SYSTEM_PROMPT);
    expect(system).toMatch(CONFLICT_ACTION_DEF);
    expect(system).toContain('"action": "store|update|skip|merge|conflict"');
  });
});
