/**
 * 存量记忆重蒸馏整形回填的回归测试。
 *
 * 钉四件最关键的事（对应 findings 的风险）：
 * 1. **质量闸（R1）**：`reshapePassesGate` 只在整形后骨架命中数严格上升（或旧不齐备且新齐备）
 *    且正文非空时判可写；持平/更差/空 → 不写。
 * 2. **门控关零漂移（R2）**：`redistill.enabled=false` 时回填不触碰 l1 任何方法。
 * 3. **向量未就绪即跳过**：`vectorsReady()=false` 时整轮不跑（改正文会静默丢向量）。
 * 4. **写回三联动 + 只活跃（真库）**：整形过的记录 content 变、FTS 命中「只在新正文里」的词、
 *    version 递增并**盖整形版本戳**；未过闸的留原文且**不打任何标记**（下轮仍可再试）；
 *    被取代(superseded)的记录根本不进 LLM。
 *
 * LLM 桩范式取自 tests/keyword-backfill.test.ts；真库 harness 同（bare MemoryDb + fakeEmbed，
 * 投射覆盖那一路 ride 在 appendNew 既有的 fireFileSync 上，由 md-sync 用例另行覆盖，此处不重复搭账本）。
 */
import { describe, expect, it, vi, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { MemoryLogger, MemoryRecord } from '../src/types.js';
import type { MemoryConfig } from '../src/config.js';
import { L1Store } from '../src/store/l1.js';
import { MemoryDb } from '../src/store/sqlite.js';
import type { EmbeddingService } from '../src/store/embedding.js';

const llmReplies: string[] = [];
const llmCalls: Array<{ system?: string; user?: string; layer?: string; signal?: unknown; reasoningEffort?: string }> = [];
/** 并发观测：同时在飞的 LLM 调用数与历史峰值（扫批是共享游标的工作池，峰值就是并行度）。 */
let llmActive = 0;
let llmPeak = 0;
/** 每次调用挂起多久：让一批 LLM 真占住一个 worker，峰值才有意义（0 = 立即返回，重叠不成立）。 */
let llmHoldMs = 0;
vi.mock('../src/llm.js', async (io) => {
  const actual = await io<typeof import('../src/llm.js')>();
  return {
    ...actual,
    callLLM: vi.fn(async (_c: unknown, _cfg: unknown, opts: { system?: string; user?: string; layer?: string; signal?: AbortSignal }) => {
      llmCalls.push(opts);
      llmActive++;
      if (llmActive > llmPeak) llmPeak = llmActive;
      const hold = (globalThis as { __llmHold?: () => number }).__llmHold?.() ?? 0;
      if (hold > 0) {
        // 桩必须尊重 signal：真实 callLLM 也会被中止信号当场掐断，
        // 否则“强杀”这类用例根本测不出来（桩会自顾自睡满 hold）。
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, hold);
          opts.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new Error('llm aborted: 桩按 signal 中断'));
          }, { once: true });
        });
      }
      llmActive--;
      // 逐条形状下“哪条对应哪个回复”不能靠队列序（扫描序不直观），
      // 所以允许注入按 user 文本裁决的解析器；没注入时仍用脚本队列。
      const resolve = (globalThis as { __llmResolve?: (u: string) => string | undefined }).__llmResolve;
      const byUser = resolve?.(opts.user ?? '');
      return byUser ?? llmReplies.shift() ?? 'null';
    }),
  };
});
// hold 值走全局函数：上面的工厂闭包拿不到本作文件的 `let`（vi.mock 会被提升到 import 之上）。
(globalThis as { __llmHold?: () => number }).__llmHold = () => llmHoldMs;

const { reshapePassesGate, reshapeOne, runRedistillBackfillOnce, hasHollowHeading, isReshapedAtCurrentVersion, RESHAPE_VER_KEY, RESHAPE_SCHEMA_VERSION, startRedistillBackfill, cancelRedistillBackfill, redistillBackfillState } = await import('../src/redistill-backfill.js');

const warned: string[] = [];
const logger = { info: () => {}, warn: (m: string) => warned.push(m), error: () => {}, debug: () => {} } as unknown as MemoryLogger;
const cfg = {} as MemoryConfig;
const ctx = {} as Context;
function rec(id: string, content = '内容', type = 'work_fact'): MemoryRecord {
  return { id, content, type } as unknown as MemoryRecord;
}

describe('reshapePassesGate 质量闸（严格更优才写）', () => {
  it('旧不齐备→新齐备 判可写', () => {
    expect(reshapePassesGate('work_fact', '部署脚本回滚逻辑', '结论：X。依据：实测Y。适用范围：仅Z场景。')).toBe(true);
  });
  it('命中数持平（同一条原样返回）判不写', () => {
    const old = '结论：部署脚本回滚逻辑'; // 已命中"结论"=1/3
    expect(reshapePassesGate('work_fact', old, old)).toBe(false);
  });
  it('更差（丢要素）判不写', () => {
    expect(reshapePassesGate('work_fact', '结论：X。依据：实测Y。适用范围：仅Z。', '结论：X。')).toBe(false);
  });
  it('空正文判不写', () => {
    expect(reshapePassesGate('work_fact', '结论：X。依据：Y。', '   ')).toBe(false);
  });
  it('空心标题（## 节名 下无正文）判不写——否则“加空标题凑命中”就能过闸', () => {
    expect(hasHollowHeading('## 结论\nX。\n## 依据\n\n## 适用范围\n仅 Z。')).toBe(true);
    expect(hasHollowHeading('## 结论\nX。\n## 依据\n实测通过。\n## 适用范围\n仅 Z。')).toBe(false);
    expect(reshapePassesGate(
      'work_fact',
      '部署脚本回滚逻辑', // 旧 0/3
      '## 结论\n部署脚本按名单回滚。\n## 依据\n\n## 适用范围\n\n', // 标题里有“结论/依据/适用范围”三个词
    )).toBe(false);
  });
  it('标题式分节（每节有正文）判可写', () => {
    expect(reshapePassesGate(
      'work_fact',
      '部署脚本回滚逻辑',
      '## 结论\n部署脚本按名单回滚。\n## 依据\n2026-10-12 实测通过。\n## 适用范围\n仅生产环境。',
    )).toBe(true);
  });
});

describe('reshapeOne 解析契约（一个请求只装一条）', () => {
  it('normKeywords 去重截 5；usage_scenario 保留；content 逐字传出', async () => {
    llmReplies.push(JSON.stringify({
      content: '## 结论\na\n## 依据\nb\n## 适用范围\nc',
      keywords: ['a', 'b', 'a', 'c', 'd', 'e', 'f'],
      usage_scenario: ['s1'],
    }));
    const out = await reshapeOne(ctx, cfg, logger, rec('m1'));
    expect(out).not.toBeNull();
    expect(out!.keywords).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(out!.usageScenario).toEqual(['s1']);
    expect(out!.content).toContain('## 结论');
  });
  it('模型回单元素数组也能解（不要求它严格守“只输出对象”）', async () => {
    llmReplies.push(JSON.stringify([{ content: '## 结论\na\n## 依据\nb\n## 适用范围\nc', keywords: ['k'], usage_scenario: [] }]));
    const out = await reshapeOne(ctx, cfg, logger, rec('m1'));
    expect(out?.keywords).toEqual(['k']);
  });
  it('空 content / 非法输出 → null（原记录不动，不抛错）', async () => {
    llmReplies.push(JSON.stringify({ content: '   ', keywords: ['k'] }));
    expect(await reshapeOne(ctx, cfg, logger, rec('m1'))).toBeNull();
    llmReplies.push('not json at all');
    expect(await reshapeOne(ctx, cfg, logger, rec('m2'))).toBeNull();
  });
  it('提示词是单条形状（不含 id 照抄要求，输出要求是对象不是数组）', async () => {
    llmCalls.length = 0;
    llmReplies.push('null');
    await reshapeOne(ctx, cfg, logger, rec('m1', 'x', 'work_method'));
    const sys = llmCalls[0]?.system ?? '';
    expect(sys).toContain('work_method');
    expect(sys, '要 markdown 小标题分节').toContain('## 节名');
    expect(sys, '节名要逐字用要素名（否则判定器认不出）').toContain('逐字');
    expect(sys).toContain('绝不编造');
    expect(sys, '不许交空节').toContain('绝不允许空节');
    expect(sys, '单条形状：输出一个对象').toContain('一个 JSON 对象');
    expect(sys, '逐条后不再要求回写 id').not.toContain('id 必须原样照抄');
    expect(llmCalls[0]?.user, 'user 只装一条记忆').not.toContain('记忆列表');
  });
  it('自带超时信号——不能沿用 cfg.llm.timeoutMs(120s)，否则回退链上会被掐死', async () => {
    llmCalls.length = 0;
    llmReplies.push('null');
    await reshapeOne(ctx, cfg, logger, rec('m1', 'x', 'work_fact'));
    expect(llmCalls[0]?.signal, '批扫调用必须传自己的 signal').toBeInstanceOf(AbortSignal);
    expect(llmCalls[0]?.reasoningEffort, '必须显式关思考（否则预算被 reasoning 吃光→空输出）').toBe('off');
  });
});

// ── fake l1 探针：门控关 / 向量未就绪 / 扫描期筛真目标 ──
function fakeL1(over: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  return {
    vectorsReady: vi.fn(() => true),
    /** 新扫描入口：只返活跃行（退场判据已下推到 SQL）。 */
    activeForSkeleton: vi.fn(() => [] as Array<{ id: string; type: string; content: string; metadata: Record<string, unknown> }>),
    allLite: vi.fn(() => []),
    getByIds: vi.fn(() => []),
    appendNew: vi.fn(async () => {}),
    patchMetadata: vi.fn(() => true),
    ...over,
  } as unknown as L1Store & Record<string, ReturnType<typeof vi.fn>>;
}

describe('门控关零漂移（R2）', () => {
  it('redistill.enabled=false → 不触碰 l1 任何方法', async () => {
    const l1 = fakeL1();
    const offCfg = { redistill: { enabled: false }, backfill: { maxRecords: 300, timeBudgetMs: 900_000, concurrency: 3 } } as unknown as MemoryConfig;
    await runRedistillBackfillOnce({ ctx, cfg: offCfg, l1, logger });
    expect(l1.vectorsReady).not.toHaveBeenCalled();
    expect(l1.activeForSkeleton).not.toHaveBeenCalled();
    expect(l1.appendNew).not.toHaveBeenCalled();
  });
});

describe('向量未就绪即跳过', () => {
  it('vectorsReady()=false → 扫描/写回都不跑（防静默丢向量）', async () => {
    const l1 = fakeL1({ vectorsReady: vi.fn(() => false) });
    const onCfg = { redistill: { enabled: true }, backfill: { maxRecords: 300, timeBudgetMs: 900_000, concurrency: 3 } } as unknown as MemoryConfig;
    await runRedistillBackfillOnce({ ctx, cfg: onCfg, l1, logger });
    expect(l1.vectorsReady).toHaveBeenCalled();
    expect(l1.activeForSkeleton).not.toHaveBeenCalled();
    expect(l1.appendNew).not.toHaveBeenCalled();
  });
});

/** 单页假扫描数据：第一页给行、后续页给空（分页循环靠空页终止，不能每页都非空）。 */
function onePage(rows: Array<{ id: string; type: string; content: string; metadata: Record<string, unknown> }>) {
  let called = 0;
  return vi.fn(() => {
    if (called++ > 0) return [];
    return rows;
  });
}

describe('isReshapedAtCurrentVersion 排除判据（只有成功替换的才不再进入）', () => {
  const HEAD = '## 结论\nx\n## 依据\ny\n## 适用范围\nz';
  it('带当前版本戳 ⇒ 排除', () => {
    expect(isReshapedAtCurrentVersion({ [RESHAPE_VER_KEY]: RESHAPE_SCHEMA_VERSION }, '平正文')).toBe(true);
  });
  it('带旧版本戳（≠当前）⇒ 重新入列（整形规则升级即重跑）', () => {
    expect(isReshapedAtCurrentVersion({ [RESHAPE_VER_KEY]: RESHAPE_SCHEMA_VERSION - 1 }, HEAD)).toBe(false);
  });
  it('无标记 ⇒ 入列（从未整过）', () => {
    expect(isReshapedAtCurrentVersion({}, '平正文')).toBe(false);
    expect(isReshapedAtCurrentVersion(undefined, '平正文')).toBe(false);
  });
  it('旧布尔标记 + 确为 ## 分节式 ⇒ 存量兼容判已整形（排除）', () => {
    expect(isReshapedAtCurrentVersion({ dsh_reshape_tried: true }, HEAD)).toBe(true);
  });
  it('旧布尔标记但正文无标题 ⇒ **重新入列**（试过却没改成 / 首轮行内标签式都得重跑）', () => {
    expect(isReshapedAtCurrentVersion({ dsh_reshape_tried: true }, '规则：X。触发时机：Y。')).toBe(false);
  });
});

describe('扫描期就把真目标筛出来（反刍巡检范式，不再盲扫全库）', () => {
  it('已按当前版本整过的、骨架齐备的、旧布尔+## 式的都不进 LLM；只送“平且真未整”的', async () => {
    const flat = { id: 'a_flat', type: 'work_fact', content: '部署脚本回滚逻辑', metadata: {} };
    const complete = { id: 'b_done', type: 'work_fact', content: '结论：X。依据：实测 Y。适用范围：仅 Z。', metadata: {} };
    const marked = { id: 'c_marked', type: 'work_fact', content: '部署脚本', metadata: { dsh_reshape_ver: 2 } };
    const legacyDone = { id: 'd_legacy', type: 'work_fact', content: '## 结论\nx\n## 依据\ny\n## 适用范围\nz', metadata: { dsh_reshape_tried: true } };
    const staleTried = { id: 'e_stale', type: 'work_fact', content: '部署脚本回滚逻辑', metadata: { dsh_reshape_tried: true } };
    const l1 = fakeL1({
      activeForSkeleton: onePage([flat, complete, marked, legacyDone, staleTried]),
      getByIds: vi.fn((ids: string[]) => ids.map((id) => ({ ...flat, id }))),
    });
    llmCalls.length = 0;
    llmReplies.push('null', 'null');
    const onCfg = { redistill: { enabled: true }, backfill: { maxRecords: 300, timeBudgetMs: 900_000, concurrency: 1 } } as unknown as MemoryConfig;
    await runRedistillBackfillOnce({ ctx, cfg: onCfg, l1, logger });

    // 真目标 = a_flat（从未整）+ e_stale（旧布尔但没改成，重新入列）
    expect(l1.getByIds.mock.calls.map((c) => c[0])).toEqual([['a_flat'], ['e_stale']]);
    expect(llmCalls, '一条一个请求：2 条真目标 = 2 次调用').toHaveLength(2);
  });
});

describe('LLM 单条请求按 concurrency 并行（默认串行）', () => {
  it('40 条真目标 = 40 次单条请求，并行度 2 时两条同时在飞', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `m${i}`, type: 'work_fact', content: `部署脚本回滚逻辑 ${i}`, metadata: {},
    }));
    const l1 = fakeL1({
      activeForSkeleton: onePage(many),
      getByIds: vi.fn((ids: string[]) => ids.map((id) => ({ id, type: 'work_fact', content: `部署脚本回滚逻辑 ${id}`, metadata: {}, version: 0 }))),
    });
    llmCalls.length = 0;
    llmPeak = 0;
    llmActive = 0;
    llmHoldMs = 20;
    try {
      const onCfg = { redistill: { enabled: true }, backfill: { maxRecords: 300, timeBudgetMs: 900_000, concurrency: 2 } } as unknown as MemoryConfig;
      await runRedistillBackfillOnce({ ctx, cfg: onCfg, l1, logger });
      expect(llmCalls, '逐条：40 条→ 40 次请求').toHaveLength(40);
      expect(llmPeak, '并行度 2 应看到两条同时在飞').toBeGreaterThanOrEqual(2);
    } finally {
      llmHoldMs = 0;
    }
  });

  it('concurrency=1（默认形状）时严格串行，峰值 1', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `s${i}`, type: 'work_fact', content: `部署脚本回滚逻辑 ${i}`, metadata: {},
    }));
    const l1 = fakeL1({
      activeForSkeleton: onePage(many),
      getByIds: vi.fn((ids: string[]) => ids.map((id) => ({ id, type: 'work_fact', content: `部署脚本回滚逻辑 ${id}`, metadata: {}, version: 0 }))),
    });
    llmCalls.length = 0;
    llmPeak = 0;
    llmActive = 0;
    llmHoldMs = 20;
    try {
      const onCfg = { redistill: { enabled: true }, backfill: { maxRecords: 300, timeBudgetMs: 900_000, concurrency: 1 } } as unknown as MemoryConfig;
      await runRedistillBackfillOnce({ ctx, cfg: onCfg, l1, logger });
      expect(llmCalls).toHaveLength(40);
      expect(llmPeak, '串行下不得出现两条同时在飞').toBe(1);
    } finally {
      llmHoldMs = 0;
    }
  });
});

describe('人工中止（cancel）', () => {
  it('start 后立刻 cancel ⇒ 提前收工、计 cancelled，且已写回的保留', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`, type: 'work_fact', content: `部署脚本回滚逻辑 ${i}`, metadata: {},
    }));
    const l1 = fakeL1({
      activeForSkeleton: onePage(many),
      getByIds: vi.fn((ids: string[]) => ids.map((id) => ({ id, type: 'work_fact', content: `部署 ${id}`, metadata: {}, version: 0 }))),
    });
    llmCalls.length = 0;
    llmReplies.length = 0;
    for (let i = 0; i < 60; i++) llmReplies.push('null'); // 回复内容不重要，只看是否提前停
    const onCfg = { redistill: { enabled: true }, backfill: { maxRecords: 300, timeBudgetMs: 900_000, concurrency: 1 } } as unknown as MemoryConfig;

    startRedistillBackfill({ ctx, cfg: onCfg, l1, logger });
    cancelRedistillBackfill(); // 立刻请求中止（单飞下 running 已置位）

    // 等运行结束（不硬杀：在飞的那条要跑完）
    for (let i = 0; i < 200 && redistillBackfillState().running; i++) await new Promise((r) => setTimeout(r, 25));
    const st = redistillBackfillState();
    expect(st.running, '中止后运行态应回落').toBe(false);
    expect(st.cancelled, '本轮应标记为已中止').toBe(true);
    expect(st.processed, '应远早于 40 条就收工').toBeLessThan(40);
    expect(st.deferred, '剩余条数应计入 deferred 供再触发').toBeGreaterThan(0);
  });

  it('中止宽限到期 ⇒ **强杀**在飞请求（中止有界，不会等满单条时长）', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `k${i}`, type: 'work_fact', content: `部署脚本回滚逻辑 ${i}`, metadata: {},
    }));
    const l1 = fakeL1({
      activeForSkeleton: onePage(many),
      getByIds: vi.fn((ids: string[]) => ids.map((id) => ({ id, type: 'work_fact', content: `部署 ${id}`, metadata: {}, version: 0 }))),
    });
    llmHoldMs = 5_000; // 单条要 5s：宽限 60ms 到期必须把它强杀，否则用例会跑 5s
    try {
      const onCfg = {
        redistill: { enabled: true },
        backfill: { maxRecords: 300, timeBudgetMs: 900_000, concurrency: 1, cancelGraceMs: 60 },
      } as unknown as MemoryConfig;
      startRedistillBackfill({ ctx, cfg: onCfg, l1, logger });
      await new Promise((r) => setTimeout(r, 150)); // 让第一条真的在飞
      const t0 = Date.now();
      cancelRedistillBackfill();
      for (let i = 0; i < 200 && redistillBackfillState().running; i++) await new Promise((r) => setTimeout(r, 25));
      const elapsed = Date.now() - t0;
      expect(redistillBackfillState().running, '中止后运行态必须回落').toBe(false);
      expect(elapsed, '宽限+强杀必须远早于单条 5s 的在飞时长').toBeLessThan(2_000);
    } finally {
      llmHoldMs = 0;
    }
  });
});

// ── 真库：写回三联动 + 只活跃 + 质量闸留原文 ──
const DIM = 16;
const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});
function vecFor(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (let i = 0; i < text.length; i++) v[text.charCodeAt(i) % DIM] += 1;
  const m = Math.sqrt(Array.from(v).reduce((s, x) => s + x * x, 0));
  if (m > 1e-10) for (let i = 0; i < DIM; i++) v[i] /= m;
  return v;
}
function fakeEmbed(): EmbeddingService {
  return {
    getDimensions: () => DIM,
    getProviderInfo: () => ({ provider: 'probe', model: 'probe', dimensions: DIM }),
    isReady: () => true,
    embed: async (t: string) => vecFor(t),
    embedBatch: async (ts: string[]) => ts.map(vecFor),
  };
}
function mk(id: string, content: string, type = 'work_fact'): MemoryRecord {
  const t = Date.now();
  return { id, content, type, priority: 60, scene_name: 's', timestamps: [t], createdAt: t, updatedAt: t } as unknown as MemoryRecord;
}

describe('真库写回三联动 + 只活跃（R1/R3）', () => {
  it('整形过的记录 content 变 + FTS 命中新词 + version 递增并盖版本戳；未过闸留原文不标记；被取代者不进 LLM', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'dsh-rd-'));
    dirs.push(dataDir);
    const db = new MemoryDb(join(dataDir, 'r.db'), DIM);
    db.init();
    try {
      const store = new L1Store(dataDir, db, fakeEmbed(), 'hybrid', undefined, 0);
      await store.init();
      // r_write 全平(0/3)、r_keep 半平(1/3)，都是不齐备的 target；r_sup 标 superseded → 应被排除。
      await store.appendNew([mk('r_write', '部署脚本回滚逻辑'), mk('r_keep', '结论：部署脚本回滚逻辑'), mk('r_sup', '结论：部署脚本回滚逻辑')]);
      store.patchMetadata('r_sup', { dsh_superseded: { by: 'x' } });

      const NEWWORD = 'zebraredistill';
      // 逐条形状：每条一个请求，prompt 不带 id，所以按正文裁决回复。
      // r_write（全平 0/3）→ 补成 3/3 过闸；r_keep（已含“结论：”，1/3）→ 原样返回不过闸。
      const resolve = (user: string): string => (user.includes('结论：')
        ? JSON.stringify({ content: '结论：部署脚本回滚逻辑', keywords: ['回滚'], usage_scenario: ['随便一个场景够长'] })
        : JSON.stringify({ content: `## 结论\n部署脚本按${NEWWORD}回滚。\n## 依据\n实测通过。\n## 适用范围\n仅生产环境。`, keywords: ['回滚脚本', NEWWORD], usage_scenario: ['生产回滚时查步骤'] }));
      (globalThis as { __llmResolve?: (u: string) => string | undefined }).__llmResolve = resolve;
      llmCalls.length = 0;

      const onCfg = { redistill: { enabled: true }, backfill: { maxRecords: 300, timeBudgetMs: 900_000, concurrency: 1 } } as unknown as MemoryConfig;
      try {
        await runRedistillBackfillOnce({ ctx, cfg: onCfg, l1: store, logger });
      } finally {
        delete (globalThis as { __llmResolve?: (u: string) => string | undefined }).__llmResolve;
      }

      // 只有两条活跃且平的被送进 LLM（r_sup 被 SQL 退场判据排除在扫描阶段）
      expect(llmCalls, 'r_sup 不该进 LLM，只送两条真目标').toHaveLength(2);

      const after = new Map(store.getByIds(['r_write', 'r_keep', 'r_sup']).map((r) => [r.id, r]));
      // r_write：content 变、version 递增、FTS 命中只在新正文里的词
      expect(after.get('r_write')!.content).toContain(NEWWORD);
      expect(after.get('r_write')!.version).toBe(1);
      expect(db.searchL1Fts(NEWWORD, 10).map((h) => h.id), 'FTS content 列已重索引').toContain('r_write');
      expect(after.get('r_write')!.metadata?.[RESHAPE_VER_KEY]).toBe(RESHAPE_SCHEMA_VERSION);
      // r_keep：质量闸不过（持平）→ 原文不动，且**不打任何标记**（下轮仍可再试）
      expect(after.get('r_keep')!.content).toBe('结论：部署脚本回滚逻辑');
      expect(after.get('r_keep')!.metadata?.[RESHAPE_VER_KEY]).toBeUndefined();
      expect(after.get('r_keep')!.metadata?.dsh_reshape_tried).toBeUndefined();
      // r_sup：未被整形
      expect(after.get('r_sup')!.content).toBe('结论：部署脚本回滚逻辑');
    } finally {
      db.close();
    }
  });
});
