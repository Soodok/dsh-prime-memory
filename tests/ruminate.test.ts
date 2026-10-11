/**
 * 反刍控制器单元测试:控制器级集成护栏。
 *
 * 背景:pending.json 的磁盘形状是 PendingFile(`{version, buckets:{auto,chat,work}, warmup}`),
 * 而控制器曾用 `JSON.parse(raw) as PendingBuckets` 直接断言——漏了 buckets 解包,
 * 导致 `buckets[mode]` 为 undefined,在 groupPendingBySession 的 for...of 抛
 * "TypeError: ... is not iterable"。因 tests/ 从不实例化 RuminateController,
 * 该缺陷长期潜伏。本文件钉死"控制器真实读取路径"这条契约。
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { emptyPending, pendingPathFor, savePending } from '../src/store/pending.js';
import { RuminateController } from '../src/pipeline/ruminate.js';
import type { MemoryConfig } from '../src/config.js';
import type { LiveSettingsHandle } from '../src/settings.js';
import type { MemoryLogger } from '../src/types.js';

let dir: string;
async function tmp(): Promise<string> {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'dsh-ruminate-'));
  return dir;
}
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const noopLogger: MemoryLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** 最小配置:关 L2/L3 保证 hermetic(不触 LLM),保留 extract.enabled 以穿过 start() 守卫。 */
function cfg(): MemoryConfig {
  return {
    dataDir: '', family: 'auto',
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
  } as MemoryConfig;
}

function liveHandle(): LiveSettingsHandle {
  const s = { enabled: true, capture: true, distill: true };
  return { supported: true, get: () => s, update: async () => {} } as unknown as LiveSettingsHandle;
}

interface Enqueued { sessionId: string; mode: string; messageCount: number }

/** 装配一个只记录入队参数的控制器(不触真实抽取/存储)。
 *  桩与真实 runner 的契约一致:任务跑完后调用 onTurnDone——反刍的链式背压
 *  (上个会话完成才入队下一个)依赖该回调推进。 */
function makeController(file: string, seen: Enqueued[]): RuminateController {
  const runner = {
    enqueue: (sessionId: string, _messages: unknown, mode: string, opts?: { onTurnDone?: (n: number) => void }) => {
      seen.push({ sessionId, mode, messageCount: Array.isArray(_messages) ? _messages.length : -1 });
      setImmediate(() => opts?.onTurnDone?.(0));
    },
    states: {},
  };
  const stores = { l1: { list: () => ({ items: [], total: 0 }), invalidateRooms: () => {} }, scenes: {}, persona: {}, state: {} };
  return new RuminateController(
    {} as never,
    cfg(),
    runner as never,
    stores as never,
    noopLogger,
    liveHandle(),
    file,
  );
}

describe('ruminate: 控制器读取 pending.json(形状契约护栏)', () => {
  it('三桶含真实消息时 start() 不抛,且 total == 会话组数、mode 由桶键推导', async () => {
    const file = pendingPathFor(await tmp());
    const buckets = emptyPending();
    buckets.chat.push({ sessionId: 's1', id: 'a', role: 'user', content: 'x', timestamp: 1 });
    buckets.work.push({ sessionId: 's2', id: 'b', role: 'user', content: 'y', timestamp: 2 });
    // 经生产同款原子写落盘 → 磁盘形状为 PendingFile({version,buckets,warmup})
    await savePending(file, buckets, { auto: 1, chat: 1, work: 1 });

    const seen: Enqueued[] = [];
    const ctl = makeController(file, seen);
    const st = await ctl.start();

    expect(st.total).toBe(2);
    expect(st.phase).toBe('distilling');
    // doEnqueue 用 setImmediate 逐个入队:等两个会话都排到再断言顺序与 mode
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    // mode 必须由桶键推导——统一成 'auto' 会造成混桶 + L1 场景名错档
    expect(seen).toEqual([
      { sessionId: 's1', mode: 'chat', messageCount: 0 },
      { sessionId: 's2', mode: 'work', messageCount: 0 },
    ]);
    // 回归护栏：反刍必须传空消息（让 runTurn 不回灌缓冲，由 distillSession 处理既有切片）。
    // 传非空会把 pending.json 里已在缓冲中的消息重复入桶 → 反刍后待处理计数“还原/变多”。
    expect(seen.every((e) => e.messageCount === 0)).toBe(true);
  });

  it('手写磁盘形状 JSON(不经 savePending 往返)同样被正确解析', async () => {
    const handDir = join(await tmp(), 'hand');
    await mkdir(handDir, { recursive: true });
    const file = pendingPathFor(handDir);
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        buckets: { auto: [], chat: [{ id: 'a', role: 'user', content: 'x', timestamp: 1, sessionId: 's1' }], work: [] },
        warmup: { auto: 0, chat: 1, work: 1 },
      }),
      'utf-8',
    );

    const seen: Enqueued[] = [];
    const st = await makeController(file, seen).start();

    expect(st.total).toBe(1);
    expect(seen).toEqual([{ sessionId: 's1', mode: 'chat', messageCount: 0 }]);
  });

  it('三桶皆空时走轻量刷新:运行期间必须如实上报 running/phase/进度', async () => {
    const file = pendingPathFor(join(await tmp(), 'empty'));
    await savePending(file, emptyPending(), { auto: 1, chat: 1, work: 1 });

    // L2 开启且 chat 有新记忆 → 轻量刷新产生 1 个步骤(真实环境是分钟级 LLM 调用)。
    // 用挂起的 scenes.list() 把该步骤钉住,以便在"运行期间"取样——
    // 这正是用户看到"反刍已在进行中"却无任何进度的那个窗口。
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const mkScenes = () => ({ list: () => gate, save: async () => {}, remove: async () => {} });

    const cfgR = cfg();
    cfgR.l2 = { ...cfgR.l2, enabled: true, minNewMemories: 1 };
    cfgR.l3 = { ...cfgR.l3, enabled: false };
    const runner = {
      enqueue: () => {},
      states: { chat: { newMemoriesSinceL2: 3, lastL2At: 0 }, work: { newMemoriesSinceL2: 0, lastL2At: 0 } },
    };
    const stores = {
      l1: { list: () => ({ items: [{ id: 'a' }], total: 1 }), invalidateRooms: () => {} },
      scenes: { chat: mkScenes(), work: mkScenes() },
      persona: { chat: {}, work: {} },
      state: {},
    };
    const ctl = new RuminateController(
      {} as never,
      cfgR,
      runner as never,
      stores as never,
      noopLogger,
      liveHandle(),
      file,
    );

    const started = ctl.start();
    await vi.waitFor(() => expect(ctl.getStatus().phase).toBe('consolidating'));

    const mid = ctl.getStatus();
    expect(mid.running).toBe(true);        // 关键:刷新期间不得声称空闲
    expect(mid.total).toBeGreaterThan(0);  // 有可显示的步骤总数
    expect(mid.done).toBe(0);
    expect(mid.detail).toContain('L2');    // 有当前动作描述

    release();
    const st = await started;
    expect(st.running).toBe(false);
    expect(st.phase).toBe('done');
    // 1 个 L2 步 + 1 个重标定步 = 2(重标定步固定计入 total,否则出现 done>total 的荒谬计数)
    expect(st.done).toBe(2);
    expect(st.total).toBe(2);
    expect(st.done).toBeLessThanOrEqual(st.total);
    expect(st.detail).toBeNull();
  });

  it('pending.json 缺失时走轻量刷新(ENOENT 属正常路径)', async () => {
    const seen: Enqueued[] = [];
    const st = await makeController(pendingPathFor(join(await tmp(), 'nope')), seen).start();

    expect(st.phase).toBe('done');
    expect(seen).toEqual([]);
  });

  it('并发 start() 只有一次通过,另一次被守卫拒绝', async () => {
    const file = pendingPathFor(join(await tmp(), 'race'));
    const buckets = emptyPending();
    buckets.chat.push({ sessionId: 's1', id: 'a', role: 'user', content: 'x', timestamp: 1 });
    await savePending(file, buckets, { auto: 1, chat: 1, work: 1 });

    const seen: Enqueued[] = [];
    const ctl = makeController(file, seen);
    const results = await Promise.allSettled([ctl.start(), ctl.start()]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});
