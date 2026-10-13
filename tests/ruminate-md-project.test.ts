/**
 * 反刍收尾的 md 投射（pm-md-authority task_2.8）。
 *
 * 投射是**旁路**，所以这里钉的是三件事：
 * 1. 关着（`cfg.memExport.enabled !== true`）时**零动作**——不建目录、不碰账本，
 *    连全库读（`l1.all()`）都不发生；产物与改动前逐字一致是本仓红线。
 * 2. 开着时**只导本轮新增/变更的那批**：本轮新蒸馏出的记录落文件 + 进账本，
 *    基线里既有的旧记录不得被重导（判据是 id→updatedAt 的基线 diff，不是时间戳）。
 * 3. 导出内部抛错只 warn + 计数，反刍照常 `done`（`status.error` 仍为 null）。
 *
 * 两条收尾路径都要覆盖（历史教训：`sessions.length === 0` 走 doLightRefresh，
 * 只挂 finalize 等于没挂）：① 全量与轻量各跑一次，②③ 走全量、②b④ 走轻量。
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { emptyPending, pendingPathFor, savePending } from '../src/store/pending.js';
import { targetFor } from '../src/store/memory-md.js';
import type { MdLedgerEntry } from '../src/store/memory-md-ledger.js';
import { RuminateController } from '../src/pipeline/ruminate.js';
import type { MemoryConfig } from '../src/config.js';
import type { LiveSettingsHandle } from '../src/settings.js';
import type { MemoryLogger, MemoryRecord } from '../src/types.js';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

const noopLogger: MemoryLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** 最小配置:关 L2/L3 保证 hermetic(不触 LLM),保留 extract.enabled 以穿过 start() 守卫。 */
function cfg(dataDir: string, memExport: Partial<MemoryConfig['memExport']> = {}): MemoryConfig {
  return {
    dataDir, family: 'auto',
    capture: { enabled: true, stripCodeBlocks: true, maxMessageChars: 4000 },
    extract: { enabled: true, minMessages: 6, idleSeconds: 300, backgroundMessages: 10, candidatePool: 5 },
    l2: { enabled: false, minNewMemories: 5, maxScenes: 12, sceneContextLimit: 3 },
    l3: { enabled: false, interval: 20 },
    recall: { enabled: true, maxResults: 5, maxCharsPerMemory: 500, maxTotalRecallChars: 2000, timeoutMs: 5000, includePersona: true, includeSceneNav: true, strategy: 'hybrid', scoreThreshold: 0.3, decayHalfLifeDays: 30 },
    embedding: { enabled: false, baseUrl: '', apiKey: '', model: '', dimensions: 0, maxInputChars: 5000, timeoutMs: 10000, allowLocalModels: true, mirror: 'https://hf-mirror.com', proxy: '' },
    llm: { provider: '', model: '', mode: 'host', baseURL: '', apiKey: '', maxTokens: 65536, reasoningEffort: '', maxInputChars: 700000, timeoutMs: 120000 },
    hall: { enabled: ['work'] },
    tokenCost: { retentionDays: 365 },
    tools: true,
    benchControl: false,
    // 投射护栏的默认值与 config.ts 的 schema 一致（300 条 / 120s）；本用例不新增配置项。
    memExport: { enabled: false, root: '', maxRecords: 300, timeBudgetMs: 120_000, ...memExport },
  } as MemoryConfig;
}

function liveHandle(): LiveSettingsHandle {
  const s = { enabled: true, capture: true, distill: true };
  return { supported: true, get: () => s, update: async () => {} } as unknown as LiveSettingsHandle;
}

const T0 = Date.parse('2026-10-11T00:00:00Z');

function rec(id: string, content: string, extra: Partial<MemoryRecord> = {}): MemoryRecord {
  return { id, content, type: 'work_fact', priority: 60, scene_name: 's', timestamps: [T0], createdAt: T0, updatedAt: T0, ...extra };
}

/** 账本替身：只实现 `exportRecords` 用到的 get/set/flush，条目留在内存里供断言。 */
interface LedgerStub {
  entries: Map<string, MdLedgerEntry>;
  flushThrows: boolean;
  get(abs: string): MdLedgerEntry | undefined;
  set(abs: string, e: MdLedgerEntry): void;
  flush(): Promise<void>;
}
function makeLedger(): LedgerStub {
  const entries = new Map<string, MdLedgerEntry>();
  const stub: LedgerStub = {
    entries,
    flushThrows: false,
    get: (abs: string) => entries.get(abs),
    set: (abs: string, e: MdLedgerEntry) => { entries.set(abs, e); },
    // 真账本在 flush 才落盘；替身把这一面用来模拟导出抛错（用例 ③）。
    flush: async () => {
      if (stub.flushThrows) throw new Error('账本落盘失败(替身注入)');
    },
  };
  return stub;
}

interface Harness {
  ctl: RuminateController;
  records: MemoryRecord[];
  ledger: LedgerStub;
  dataDir: string;
  warns: string[];
  infos: string[];
  /** `l1.all()` 被调用次数——关着时必须恒 0（连读都不该发生）。 */
  allCalls: () => number;
}

/**
 * 装配一个控制器：`pendingFile` 决定走全量（有切片）还是轻量（空桶）路径。
 * @param distilled - 模拟本轮蒸馏产物：入队时往库里追加的新记录。
 * @param mutate - 模拟本轮改写：第二次读库（收尾增量集）之前把某条的 updatedAt 推进。
 */
async function harness(opts: {
  enabled: boolean;
  withPending: boolean;
  distilled?: MemoryRecord;
  mutate?: (records: MemoryRecord[]) => void;
} = { enabled: false, withPending: true }): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-rum-md-'));
  dirs.push(dataDir);
  const file = pendingPathFor(dataDir);
  const buckets = emptyPending();
  if (opts.withPending) buckets.chat.push({ sessionId: 's1', id: 'a', role: 'user', content: 'x', timestamp: 1 });
  await savePending(file, buckets, { auto: 1, chat: 1, work: 1 });

  const records: MemoryRecord[] = [rec('old-1', '上行必须走官方地址', { name: 'old-1' })];
  const ledger = makeLedger();
  const warns: string[] = [];
  const infos: string[] = [];
  const logger: MemoryLogger = {
    info: (m) => { infos.push(m); },
    warn: (m) => { warns.push(m); },
    error: (m) => { warns.push(m); },
  };
  let n = 0;
  let mutated = false;
  const stores = {
    l1: {
      list: () => ({ items: [], total: 0 }),
      all: () => {
        n++;
        // 基线是第一次读（start 内），收尾再读一次——那时才把"本轮改写"落到替身上
        if (!mutated && n === 2 && opts.mutate !== undefined) {
          opts.mutate(records);
          mutated = true;
        }
        return records;
      },
      invalidateRooms: () => {},
    },
    scenes: { chat: { list: async () => [] }, work: { list: async () => [] } },
    persona: { chat: {}, work: {} },
    // finalize 里 `state.save()` 不在 try 内：缺它会让收尾整块失败，投射根本跑不到
    state: { save: async () => {} },
    mdLedger: ledger,
  };
  const runner = {
    enqueue: (_sessionId: string, _messages: unknown, _mode: string, o?: { onTurnDone?: (r: number) => void }) => {
      // 蒸馏产出：新记录进库（id 不在基线里 → 收尾必须把它算进增量集）
      if (opts.distilled !== undefined) records.push(opts.distilled);
      setImmediate(() => o?.onTurnDone?.(opts.distilled === undefined ? 0 : 1));
    },
    states: {},
  };
  const ctl = new RuminateController(
    {} as never,
    cfg(dataDir, { enabled: opts.enabled }),
    runner as never,
    stores as never,
    logger,
    liveHandle(),
    file,
  );
  return { ctl, records, ledger, dataDir, warns, infos, allCalls: () => n };
}

async function runToDone(ctl: RuminateController) {
  const first = await ctl.start();
  // 全量路径 start() 只入队第一个会话就返回,收尾是链式异步的 → 等它自己跑完
  await vi.waitFor(() => expect(ctl.getStatus().running).toBe(false));
  return { first, st: ctl.getStatus() };
}

describe('ruminate 收尾 md 投射(task_2.8)', () => {
  it('① 投射关着:全量与轻量两条路径都零动作(不建目录、不碰账本、连全库读都不发生)', async () => {
    for (const withPending of [true, false]) {
      const h = await harness({ enabled: false, withPending, distilled: rec('new-1', 'pnpm 需要 hoisted 平铺布局', { name: 'new-1', createdAt: Date.now(), updatedAt: Date.now() }) });
      const { st } = await runToDone(h.ctl);

      expect(st.phase).toBe('done');
      expect(existsSync(join(h.dataDir, 'memories'))).toBe(false);
      expect(h.ledger.entries.size).toBe(0);
      expect(h.allCalls()).toBe(0);
      expect(h.infos.some((m) => m.includes('md 投射'))).toBe(false);
    }
  });

  it('② 投射开着·全量路径:只导本轮新增的那条,旧记录不重导', async () => {
    const fresh = Date.now();
    const h = await harness({
      enabled: true,
      withPending: true,
      distilled: rec('new-1', 'pnpm 需要 hoisted 平铺布局\n因为 linker 默认是 isolated', { name: 'pnpm-hoisted', createdAt: fresh, updatedAt: fresh }),
    });
    const { st } = await runToDone(h.ctl);

    expect(st.phase).toBe('done');
    expect(st.error).toBeNull();
    const [oldRec, newRec] = h.records;
    const oldAbs = targetFor(oldRec!, undefined, h.dataDir).absPath!;
    const newAbs = targetFor(newRec!, undefined, h.dataDir).absPath!;
    expect(h.ledger.entries.has(newAbs)).toBe(true);
    expect(h.ledger.entries.get(newAbs)?.id).toBe('new-1');
    // 基线里就有的旧记录:既不写文件也不记账(只导增量,不重导全库)
    expect(h.ledger.entries.has(oldAbs)).toBe(false);
    expect(existsSync(oldAbs)).toBe(false);
    const text = await readFile(newAbs, 'utf8');
    expect(text).toContain('pnpm-hoisted');
    expect(h.infos.some((m) => m.includes('反刍 md 投射(反刍收尾)') && m.includes('增量 1 条'))).toBe(true);
  });

  it('②b 投射开着·轻量路径:本轮被改写的记录(updatedAt 推进)进增量集', async () => {
    const h = await harness({
      enabled: true,
      withPending: false,
      mutate: (rs) => { rs[0]!.updatedAt = Date.now(); },
    });
    const { st } = await runToDone(h.ctl);

    expect(st.phase).toBe('done');
    const abs = targetFor(h.records[0]!, undefined, h.dataDir).absPath!;
    expect(h.ledger.entries.has(abs)).toBe(true);
    expect(existsSync(abs)).toBe(true);
    expect(h.infos.some((m) => m.includes('反刍 md 投射(轻量刷新)'))).toBe(true);
  });

  it('③ 导出内部抛错:只 warn + 计数,反刍照常完成且不抛给调用方', async () => {
    const fresh = Date.now();
    const h = await harness({
      enabled: true,
      withPending: true,
      distilled: rec('new-1', '队列深度必须 ≤1', { name: 'backpressure', createdAt: fresh, updatedAt: fresh }),
    });
    h.ledger.flushThrows = true;

    // start() 本身是异步链头,任何逃逸的抛错都会在这里显形
    const first = await h.ctl.start();
    await vi.waitFor(() => expect(h.ctl.getStatus().running).toBe(false));
    const st = h.ctl.getStatus();

    expect(first.phase).toBe('distilling');
    expect(st.phase).toBe('done');
    expect(st.error).toBeNull();
    expect(st.running).toBe(false);
    expect(h.ctl.getMdFailures()).toBe(1);
    expect(h.warns.some((m) => m.includes('md 投射失败'))).toBe(true);
  });

  it('④ mdLedger 未装配(投射面没开):直接跳过,不报错也不写盘', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'dsh-rum-md-noledger-'));
    dirs.push(dataDir);
    const file = pendingPathFor(dataDir);
    await savePending(file, emptyPending(), { auto: 1, chat: 1, work: 1 });

    const warns: string[] = [];
    const stores = {
      l1: { list: () => ({ items: [], total: 0 }), all: () => [rec('old-1', '没有账本也该跳过')], invalidateRooms: () => {} },
      scenes: { chat: { list: async () => [] }, work: { list: async () => [] } },
      persona: { chat: {}, work: {} },
      state: { save: async () => {} },
      // 故意不给 mdLedger
    };
    const ctl = new RuminateController(
      {} as never,
      cfg(dataDir, { enabled: true }),
      { enqueue: () => {}, states: {} } as never,
      stores as never,
      { info: () => {}, warn: (m) => { warns.push(m); }, error: (m) => { warns.push(m); } } as MemoryLogger,
      liveHandle(),
      file,
    );
    const st = await ctl.start();

    expect(st.phase).toBe('done');
    expect(existsSync(join(dataDir, 'memories'))).toBe(false);
    expect(ctl.getMdFailures()).toBe(0);
    expect(warns.some((m) => m.includes('md 投射'))).toBe(false);
  });
});
