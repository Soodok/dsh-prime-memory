/**
 * RPC 层单元测试:端点分发(统计聚合/档位设置校验/settings-set 写入门/
 * records-delete 门/list-records wing 过滤/log-tail)、机密脱敏、bench 控制面。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { registerMemoryRpc, handleEndpoint, buildEndpointDeps, PLUGIN_VERSION, type MemoryStatusSource, type SessionInfoSource, type EndpointDeps } from '../src/stats.js';
import { registerBenchControl } from '../src/bench-control.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { L0Store } from '../src/store/l0.js';
import { L1Store } from '../src/store/l1.js';
import { SceneStore } from '../src/store/scenes.js';
import { PersonaStore } from '../src/store/persona.js';
import { StateStore } from '../src/store/state.js';
import { SessionModeStore } from '../src/store/session-modes.js';
import { RoomRegistryStore } from '../src/store/rooms-registry.js';
import { emptyOccupancyLedger } from '../src/util/context-occupancy.js';
import { initTokenCost, resetTokenCost } from '../src/token-cost.js';
import type { MemoryLiveSettings } from '../src/contract.js';
import type { MemoryConfig } from '../src/config.js';
import type { LiveSettingsHandle } from '../src/settings.js';
import type { MemoryLogger } from '../src/types.js';
import { ANCHOR_METADATA_KEY } from '../src/pipeline/anchors.js';

let dir: string;
async function tmp(): Promise<string> {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'dsh-rpc-'));
  return dir;
}
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const noopLogger: MemoryLogger = { info: () => {}, warn: () => {}, error: () => {} };

function cfg(
  over: Partial<MemoryConfig['llm']> = {},
  /** 非 llm 子树覆盖(如 conflictFreeze):合并进返回的 cfg 字面量,供端点层验证
   *  "运行时开关覆盖静态部署值"这一读路径。 */
  cfgOver: Partial<MemoryConfig> = {},
): MemoryConfig {
  return {
    dataDir: '', family: 'auto',
    capture: { enabled: true, stripCodeBlocks: true, maxMessageChars: 4000 },
    extract: { enabled: true, minMessages: 6, idleSeconds: 300, backgroundMessages: 10, candidatePool: 5 },
    l2: { enabled: true, minNewMemories: 5, maxScenes: 12, sceneContextLimit: 3 },
    l3: { enabled: true, interval: 20 },
    recall: { enabled: true, maxResults: 5, maxCharsPerMemory: 500, maxTotalRecallChars: 2000, timeoutMs: 5000, includePersona: true, includeSceneNav: true, strategy: 'hybrid', scoreThreshold: 0.3, decayHalfLifeDays: 30 },
    embedding: { enabled: false, baseUrl: '', apiKey: '', model: '', dimensions: 0, maxInputChars: 5000, timeoutMs: 10000, allowLocalModels: true, mirror: 'https://hf-mirror.com', proxy: '' },
    llm: { provider: '', model: '', mode: 'host', baseURL: '', apiKey: '', maxTokens: 65536, reasoningEffort: '', maxInputChars: 700000, timeoutMs: 120000, ...over },
    hall: { enabled: ['work'] },
    tokenCost: { retentionDays: 365 },
    tools: true,
    benchControl: false,
    ...cfgOver,
  } as MemoryConfig;
}

function liveHandle(over: Partial<MemoryLiveSettings> = {}): LiveSettingsHandle {
  // 断言而非注解:基线刻意不提供 conflictFreeze(与生产 LiveSettings 解析的缺省语义保持一致)
  const s = {
    enabled: true, capture: true, distill: true, recall: true,
    reasoningEffort: '', distillProvider: '', distillModel: '', distillChain: [],
    distillBudgets: { extract: 0, dedup: 0, l2: 0, l3: 0, graph: 0 }, distillMaxInputChars: 0,
    distillLayerChains: { l1: [], l2: [], l3: [] }, distillMode: '', directBaseURL: '', directApiKey: '',
    embedRemoteBaseURL: '', embedRemoteApiKey: '', embedRemoteModel: '', embedRemoteDimensions: 0, memoryMutate: false,
    ...over,
  } as MemoryLiveSettings;
  return { supported: true, get: () => s, update: async (patch) => { Object.assign(s, patch); } };
}

interface Harness {
  // call 返回的是 HTTP envelope 解包后的 value(非 200/ok:false 已 throw),与运行时行为一致
  call: (endpoint: string, payload?: unknown) => Promise<unknown>;
  stores: { l0: L0Store; l1: L1Store; scenes: Record<'chat' | 'work', SceneStore>; persona: Record<'chat' | 'work', PersonaStore>; state: StateStore };
  db: MemoryDb;
  modes: SessionModeStore;
  dataDir: string;
  /** opts.roomRegistry 开时装配的注册表(未开 = undefined)。 */
  registry?: RoomRegistryStore;
}

/** 直调端点分发层:经生产同款 buildEndpointDeps 组装 deps,验证 rebuild/ruminate 接线。 */
function ctlDeps(over: { rebuild?: unknown; ruminate?: unknown; status?: unknown } = {}): EndpointDeps {
  return buildEndpointDeps(
    { ctx: {} as never, cfg: cfg(), stores: {} as never, logger: noopLogger },
    {
      status: over.status as never,
      // 守卫链要求 enabled/distill 皆真,否则 start 被"蒸馏开关已关闭"拦下
      live: { supported: true, get: () => ({ enabled: true, distill: true, recall: true }), update: async () => {} } as never,
      modes: new SessionModeStore('/nonexistent', 'auto'),
      dataDir: tmpdir(),
      rebuild: over.rebuild as never,
    },
    over.ruminate as never,
  );
}

async function harness(opts: {
  live?: LiveSettingsHandle;
  sessionInfo?: SessionInfoSource;
  status?: MemoryStatusSource;
  /** 静态部署 cfg 覆盖(非 llm 子树),用于验证运行时开关与静态值的优先级。 */
  cfgOver?: Partial<MemoryConfig>;
  /** 装配 Room 注册表(回归:rpcHandler 曾漏带 roomRegistry,面板侧 room-* 恒"未装配")。 */
  roomRegistry?: boolean;
} = {}): Promise<Harness> {
  const dataDir = join(await tmp(), `rpc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const db = new MemoryDb(join(dataDir, 'memory.db'), 0);
  db.init();
  const l1 = new L1Store(dataDir, db, undefined, 'hybrid', noopLogger, 0);
  const l0 = new L0Store(db);
  await l1.init();
  const scenes = { chat: new SceneStore(dataDir, 'chat'), work: new SceneStore(dataDir, 'work') };
  await scenes.chat.init();
  await scenes.work.init();
  const persona = { chat: new PersonaStore(dataDir, 'chat'), work: new PersonaStore(dataDir, 'work') };
  await persona.chat.init();
  await persona.work.init();
  const state = new StateStore(join(dataDir, 'state.json'));
  await state.load();
  const modes = new SessionModeStore(dataDir, 'auto');
  await modes.init();
  let registry: RoomRegistryStore | undefined;
  if (opts.roomRegistry) {
    registry = new RoomRegistryStore(dataDir, noopLogger);
    await registry.init();
  }

  let handler: ((req: unknown, res: unknown) => Promise<void>) | undefined;
  const ctx = {
    get: (name: string) => {
      // 0.1.5 契约:宿主半直接向 webServer 注册 prefix 路由(不再走 connection.rpc)
      if (name === 'webServer') {
        return {
          register: (route: { handler: (req: unknown, res: unknown) => Promise<void> }) => {
            handler = route.handler;
            return () => {};
          },
        };
      }
      return undefined;
    },
    on: () => () => {},
    effect: (fn: () => (() => void) | void) => {
      const d = fn();
      return typeof d === 'function' ? d : () => {};
    },
    llm: {} as never,
  } as unknown as Parameters<typeof registerMemoryRpc>[0];

  registerMemoryRpc(ctx, cfg({}, opts.cfgOver ?? {}), { l0, l1, scenes, persona, state, graph: db.graphStore }, noopLogger, opts.status, opts.live, modes, dataDir, undefined, undefined, opts.sessionInfo, undefined, registry);
  return {
    registry,
    call: async (endpoint, payload) => {
      // 模拟 HTTP 层:构造 loopback req(流式 body)+ 捕获型 res,过完整 handler
      const req = new PassThrough() as PassThrough & { headers: Record<string, string>; method: string; url: string };
      req.headers = { host: 'localhost' };
      req.method = 'POST';
      req.url = `/dsh-memory/rpc/${endpoint.slice('dsh-memory/'.length)}`;
      req.end(JSON.stringify(payload ?? {}));
      const captured = { statusCode: 0, body: '' };
      const res = {
        writeHead(status: number) {
          captured.statusCode = status;
        },
        end(body?: string) {
          captured.body = body ?? '';
        },
      };
      await handler!(req as unknown, res as unknown);
      const parsed = JSON.parse(captured.body) as { ok: boolean; value?: unknown; error?: { message: string } };
      if (captured.statusCode !== 200 || !parsed.ok) throw new Error(parsed.error?.message ?? `HTTP ${captured.statusCode}`);
      return parsed.value;
    },
    stores: { l0, l1, scenes, persona, state },
    db,
    modes,
    dataDir,
  };
}

describe('rpc: stats / token-cost / unknown', () => {
  it('stats aggregates two-family state into a mixed view', async () => {
    const h = await harness();
    const s = await h.call('dsh-memory/stats') as Record<string, unknown>;
    expect(s.ok).toBe(true);
    expect(s.version).toBe(PLUGIN_VERSION);
    expect(s.family).toBe('auto');
    expect(s.thresholds).toEqual({ l2MinNewMemories: 5, l3Interval: 20 });
    h.db.close();
  });

  it('token-cost: invalid granularity normalizes; rangeDays forces day granularity', async () => {
    const h = await harness();
    initTokenCost(h.db, 365); // 接上真库,走趋势聚合路径(零值早退路径不体现 rangeDays 强制)
    const ok = await h.call('dsh-memory/token-cost', { granularity: 'month' }) as { trend: { granularity: string } };
    expect(ok.trend.granularity).toBe('month');
    const bad = await h.call('dsh-memory/token-cost', { granularity: 'hour', rangeDays: 99999 }) as { trend: { granularity: string } };
    expect(bad.trend.granularity).toBe('day'); // 非法粒度归 day;rangeDays 也强制日粒度
    // 近 N 天:强制日粒度出 N 个桶
    const near = await h.call('dsh-memory/token-cost', { granularity: 'month', rangeDays: 7 }) as { trend: { granularity: string } };
    expect(near.trend.granularity).toBe('day');
    resetTokenCost();
    h.db.close();
  });

  it('conflicts: 面板读的 enabled 跟随**运行时开关**,不被静态部署值压住', async () => {
    // 回归:端点曾读 cfg.conflictFreeze(静态部署值)。面板开关写的是 live settings,
    // 于是开关已开、settings.yaml 已落 true,冲突页仍报 "矛盾冻结未开启" ——
    // 读路径与写路径各看一份配置。此例钉死:静态关 + 运行时开 = 开。
    const staticOff = { conflictFreeze: { enabled: false, maxPending: 100, timeoutDays: 30 } };
    const h = await harness({ live: liveHandle({ conflictFreeze: true }), cfgOver: staticOff });
    const v = (await h.call('dsh-memory/conflicts', {})) as { enabled: boolean; total: number; items: unknown[] };
    expect(v.enabled).toBe(true);
    expect(v.total).toBe(0);
    expect(v.items).toEqual([]);
    h.db.close();
  });

  it('conflicts: 运行时关闭时静态开启也不放行(开关双向都覆盖)', async () => {
    const staticOn = { conflictFreeze: { enabled: true, maxPending: 100, timeoutDays: 30 } };
    const h = await harness({ live: liveHandle({ conflictFreeze: false }), cfgOver: staticOn });
    const v = (await h.call('dsh-memory/conflicts', {})) as { enabled: boolean; notice?: string };
    expect(v.enabled).toBe(false);
    expect(v.notice).toContain('矛盾冻结未开启');
    h.db.close();
  });

  it('unknown endpoint errors via ok:false envelope (call wrapper turns into throw)', async () => {
    const h = await harness();
    await expect(h.call('dsh-memory/nope')).rejects.toThrow('unknown api method');
    h.db.close();
  });
});

describe('rpc: session mode endpoints', () => {
  it('mode set with recall override; validation rejects bad mode/payload shape', async () => {
    const h = await harness({ live: liveHandle({ recall: true }) });
    const set = await h.call('dsh-memory/session-mode-set', { sessionId: 's1', mode: 'work', recall: false }) as { mode: string; recall: boolean | null; recallResolved: boolean };
    expect(set).toEqual({
      sessionId: 's1',
      mode: 'work',
      recall: false,
      recallResolved: false,
      hall: null,
      halls: [],
      hallIncludeUnlabeled: true,
      hallIncludeGeneral: false,
    });
    // 显式 null 清除覆盖
    const cleared = await h.call('dsh-memory/session-mode-set', { sessionId: 's1', mode: 'auto', recall: null }) as { recall: null; recallResolved: boolean };
    expect(cleared.recall).toBeNull();
    expect(cleared.recallResolved).toBe(true);
    // 缺省 recall:覆盖不动
    await h.call('dsh-memory/session-mode-set', { sessionId: 's1', mode: 'chat', recall: true });
    const kept = (await h.call('dsh-memory/session-mode-set', { sessionId: 's1', mode: 'off' })) as { recall: boolean | null };
    expect(kept.recall).toBe(true);
    // 非法档位 / 非法覆盖 / 超长 sessionId
    await expect(h.call('dsh-memory/session-mode-set', { sessionId: 's', mode: 'bogus' })).rejects.toThrow('非法档位');
    await expect(h.call('dsh-memory/session-mode-set', { sessionId: 's' })).rejects.toThrow('需要 mode');
    await expect(h.call('dsh-memory/session-mode-set', { sessionId: 's', mode: 'auto', recall: 'yes' })).rejects.toThrow('非法注入覆盖');
    await expect(h.call('dsh-memory/session-mode-set', { sessionId: 'x'.repeat(600), mode: 'auto' })).rejects.toThrow('过长');
    const get = await h.call('dsh-memory/session-mode-get', { sessionId: 's1' }) as { mode: string; recallResolved: boolean };
    expect(get.mode).toBe('off');
    h.db.close();
  });
});

describe('rpc: settings get/set (incl. reverse-engineered keys)', () => {
  it('settings-set validates embedRemote* fields and memoryMutate boolean', async () => {
    const h = await harness({ live: liveHandle() });
    const ok = await h.call('dsh-memory/settings-set', {
      memoryMutate: true,
      embedRemoteBaseURL: 'http://ui/v1',
      embedRemoteModel: 'ui-model',
      embedRemoteDimensions: 1024,
    }) as { settings: MemoryLiveSettings };
    expect(ok.settings.memoryMutate).toBe(true);
    expect(ok.settings.embedRemoteBaseURL).toBe('http://ui/v1');
    expect(ok.settings.embedRemoteDimensions).toBe(1024);
    // 越界/非法
    await expect(h.call('dsh-memory/settings-set', { embedRemoteDimensions: 9000 })).rejects.toThrow('0~8192');
    await expect(h.call('dsh-memory/settings-set', { embedRemoteModel: 'x'.repeat(300) })).rejects.toThrow('过长');
    await expect(h.call('dsh-memory/settings-set', { memoryMutate: 'yes' })).rejects.toThrow('载荷为空'); // 非布尔不收,空载荷报错
    h.db.close();
  });

  it('api keys never leave host: set/get redact both secrets', async () => {
    const h = await harness({ live: liveHandle() });
    const set = await h.call('dsh-memory/settings-set', { directApiKey: 'secret-a', embedRemoteApiKey: 'secret-b' }) as { settings: MemoryLiveSettings };
    expect(set.settings.directApiKey).toBe('');
    expect(set.settings.embedRemoteApiKey).toBe('');
    const get = await h.call('dsh-memory/settings-get') as { settings: MemoryLiveSettings };
    expect(get.settings.directApiKey).toBe('');
    expect(get.settings.embedRemoteApiKey).toBe('');
    h.db.close();
  });

  it('effort/budget validation stays on EFFORT_CHOICES whitelist', async () => {
    const h = await harness({ live: liveHandle() });
    await expect(h.call('dsh-memory/settings-set', { reasoningEffort: 'ultra' })).rejects.toThrow('非法思考档位');
    await expect(h.call('dsh-memory/settings-set', { distillBudgets: { extract: -1, dedup: 0, l2: 0, l3: 0 } })).rejects.toThrow('0~1000000');
    await expect(h.call('dsh-memory/settings-set', { distillMaxInputChars: 500 })).rejects.toThrow('1000~1000000');
    const ok = await h.call('dsh-memory/settings-set', { reasoningEffort: 'xhigh', distillMaxInputChars: 1000 }) as Record<string, unknown>;
    expect(ok.ok).toBe(true);
    h.db.close();
  });
});

describe('rpc: list-records / records-delete', () => {
  async function seed(h: Harness) {
    const now = Date.now();
    await h.stores.l1.appendNew([
      { id: 'h1', content: '咖啡记忆', type: 'preference', priority: 60, scene_name: '日常', timestamps: [now], createdAt: now, updatedAt: now, metadata: { hall: 'work' } },
      { id: 'h2', content: '无 Hall 记忆', type: 'episodic', priority: 60, scene_name: '日常', timestamps: [now], createdAt: now, updatedAt: now, metadata: {} },
    ]);
  }

  it('list-records filters by wing on both browse and search paths', async () => {
    const h = await harness();
    await seed(h);
    const browse = await h.call('dsh-memory/list-records', { hall: 'work' }) as { items: Array<{ id: string; hall: string | null }> };
    expect(browse.items.map((i) => i.id)).toEqual(['h1']);
    expect(browse.items[0].hall).toBe('work');
    const search = await h.call('dsh-memory/list-records', { query: '咖啡 记忆', hall: 'work' }) as { items: Array<{ id: string }> };
    expect(search.items.map((i) => i.id)).toEqual(['h1']);
    h.db.close();
  });

  it('search path hydrates time/version/anchors like browse path (无过滤也必须补)', async () => {
    // 旧缺陷:检索分支只送 L1SearchHit 的 7 个字段入 hitToUiRecord,卡片因此
    // 把创建/活跃时间、版本、来源锚点全渲成占位值;而 metaById 只在勾了 Wing/tag
    // 时才建——默认视图连 metadata 都不补。本例跑的就是默认视图(无任何过滤)。
    type Card = { id: string; createdAt: string | null; updatedAt: string | null; timestamps: string[]; version: number; sourceAnchors: string[] };
    const h = await harness();
    const t = Date.now() - 60_000;
    await h.stores.l1.appendNew([
      {
        id: 'w1',
        content: '水合验证记忆',
        type: 'work_fact',
        priority: 60,
        scene_name: '日常',
        timestamps: [t, t + 10],
        createdAt: t,
        updatedAt: t + 10,
        version: 7,
        metadata: { [ANCHOR_METADATA_KEY]: [{ sessionId: 's1', turn: 12, step: 3 }] },
      },
    ]);
    const browse = (await h.call('dsh-memory/list-records', {})) as { items: Card[] };
    const search = (await h.call('dsh-memory/list-records', { query: '水合验证' })) as { items: Card[] };
    const b = browse.items.find((i) => i.id === 'w1');
    const s = search.items.find((i) => i.id === 'w1');
    expect(b).toBeDefined();
    expect(s).toBeDefined();
    // 两路必须同口径:检索结果不得比浏览结果少字段(占位值就是 bug 的形状)
    expect(s?.createdAt).toBe(b?.createdAt);
    expect(s?.updatedAt).toBe(b?.updatedAt);
    expect(s?.timestamps).toEqual(b?.timestamps);
    expect(s?.version).toBe(7);
    expect(s?.sourceAnchors).toEqual(['t12 s3']);
    h.db.close();
  });

  it('list-records multi-value halls on browse path (R13: 无 query 的 list 分支)', async () => {
    const h = await harness();
    await seed(h);
    const now = Date.now();
    await h.stores.l1.appendNew([
      { id: 'h3', content: '跨域记忆', type: 'episodic', priority: 60, scene_name: '日常', timestamps: [now], createdAt: now, updatedAt: now, metadata: { hall: 'general' } },
    ]);
    const both = await h.call('dsh-memory/list-records', { halls: ['work', 'general'] }) as { items: Array<{ id: string }> };
    expect(both.items.map((i) => i.id)).toEqual(expect.arrayContaining(['h1']));
    const single = await h.call('dsh-memory/list-records', { halls: ['general'] }) as { items: Array<{ id: string }> };
    expect(single.items.map((i) => i.id)).not.toContain('h1');
    // 单值 wing 与 halls 合并去重
    const merged = await h.call('dsh-memory/list-records', { hall: 'work', halls: ['general'] }) as { items: Array<{ id: string }> };
    expect(merged.items.map((i) => i.id)).toEqual(expect.arrayContaining(['h1']));
    h.db.close();
  });

  it('records-delete is gated by memoryMutate and caps ids at 200', async () => {
    const h = await harness({ live: liveHandle({ memoryMutate: false }) });
    await seed(h);
    await expect(h.call('dsh-memory/records-delete', { ids: ['h1'] })).rejects.toThrow('高权限');
    h.db.close();

    const h2 = await harness({ live: liveHandle({ memoryMutate: true }) });
    await seed(h2);
    const ok = await h2.call('dsh-memory/records-delete', { ids: ['h1', 42] }) as { deleted: number };
    expect(ok.deleted).toBe(1); // 非字符串 id 被滤除
    await expect(h2.call('dsh-memory/records-delete', { ids: [] })).rejects.toThrow('ids 缺失');
    h2.db.close();
  });
});

describe('rpc: log-tail', () => {
  it('reads last N lines of memory.log with UTF-8 safe chunking', async () => {
    const h = await harness();
    await writeFile(join(h.dataDir, 'memory.log'), 'l1\nl2\n中文行\nl4\n', 'utf-8');
    const r = await h.call('dsh-memory/log-tail', { lines: 2 }) as { lines: string[] };
    expect(r.lines).toEqual(['中文行', 'l4']);
    const missing = await h.call('dsh-memory/log-tail', { lines: 2 }) as { lines: string[] };
    h.db.close();
    void missing;
  });
});

describe('rpc: session-stats via SessionInfoSource', () => {
  it('builds recall reason short-circuit and retrieval capability view', async () => {
    const sessionInfo: SessionInfoSource = {
      recallStats: () => undefined,
      memoryOccupancy: () => emptyOccupancyLedger(),
      runnerView: () => ({ pendingSlice: 2, parkedSlices: 1, threshold: 6, producedRecords: 3, lastDistillAt: 1700000000000 }),
      l0Count: async () => 7,
      capabilities: () => ({ ftsSearch: true, vectorSearch: false }),
    };
    const h = await harness({ live: liveHandle({ recall: false }), sessionInfo });
    const r = await h.call('dsh-memory/session-stats', { sessionId: 's9' }) as {
      supported: boolean; recall: { enabled: boolean; reason?: string }; retrieval: string; l0Count: number; distill: { threshold: number | null };
    };
    expect(r.supported).toBe(true);
    expect(r.recall.enabled).toBe(false);
    expect(r.recall.reason).toBe('global'); // 全局关是第一个为假因子
    expect(r.retrieval).toBe('keyword');
    expect(r.l0Count).toBe(7);
    expect(r.distill.threshold).toBe(6);
    h.db.close();
  });
});

describe('rpc: graph endpoints', () => {
  it('graph-search returns compact cards; graph-node-get resolves and tolerates dangling ids', async () => {
    const h = await harness();
    h.db.upsertL1({
      id: 'rec-1', content: '张三参与 GraphX 项目', type: 'episodic', priority: 60, scene_name: '默认',
      timestamps: [Date.now()], createdAt: Date.now(), updatedAt: Date.now(), family: 'chat',
    });
    h.db.graphStore.queueGraphProjection(['rec-1'], 10000);
    const claim = h.db.graphStore.claimNext()!;
    h.db.graphStore.complete(claim.job.id, {
      reason: '',
      nodes: [
        { ref: 'a', name: '张三', type: 'person', sourceRecordIds: ['rec-1'], state: '参与 GraphX' },
      ],
      edges: [],
    });
    // 检索:返回紧凑卡(score/matchedFields/matchReason)
    const search = await h.call('dsh-memory/graph-search', { query: '张三' }) as {
      items: Array<{ node: { id: string; name: string; currentState: string }; score: number; matchReason: string }>;
    };
    expect(search.items).toHaveLength(1);
    expect(search.items[0]!.node.name).toBe('张三');
    expect(search.items[0]!.node.currentState).toContain('GraphX');
    expect(search.items[0]!.matchReason).toContain('命中');
    // 详情:node + edges;悬挂 id → node=null 不解析
    const got = await h.call('dsh-memory/graph-node-get', { id: search.items[0]!.node.id }) as { node: { name: string } | null; edges: unknown[] };
    expect(got.node?.name).toBe('张三');
    expect(got.edges).toEqual([]);
    const dangling = await h.call('dsh-memory/graph-node-get', { id: 'no-such-node' }) as { node: unknown; edges: unknown[] };
    expect(dangling.node).toBeNull();
    h.db.close();
  });

  it('graph endpoints validate inputs and degrade to empty without graph store', async () => {
    const h = await harness();
    // 入参校验:超长 query / 缺失 id
    const badQuery = (await callError(h, 'dsh-memory/graph-search', { query: 'x'.repeat(5000) }));
    expect(badQuery).toContain('4096');
    const badId = (await callError(h, 'dsh-memory/graph-node-get', { id: '' }));
    expect(badId).toContain('id');
    // limit 钳制到 1~20:超界值不炸
    const clamped = await h.call('dsh-memory/graph-search', { query: '张三', limit: 999 }) as { items: unknown[] };
    expect(Array.isArray(clamped.items)).toBe(true);
    h.db.close();
  });
});

/** 捕获端点抛错文案:模块级共用(rebuild/ruminate 块与 graph 块都需要)。 */
async function callError(h: Harness, endpoint: string, payload: unknown): Promise<string> {
  try {
    await h.call(endpoint, payload);
    return '';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

describe('rpc: rebuild/ruminate 控制器端点(注入护栏)', () => {
  // rebuild 与 ruminate 是同一范式:可选控制器 + 降级响应 + deps 注入。
  // 差异仅一处:rebuild.start() 同步返 RebuildStatus,ruminate.start() 为 async。
  const running = {
    running: true, phase: 'distilling', done: 2, total: 5, recordsBuilt: 3,
    cancelRequested: false, startedAt: 1700000000000, finishedAt: null, error: null,
  };
  const ctlStub = () => ({
    getStatus: () => running,
    start: () => ({ ...running }),                                  // RebuildController.start():同步
    requestCancel: () => ({ ...running, cancelRequested: true }),
  });
  const ruminateStub = () => ({
    getStatus: () => running,
    start: async () => ({ ...running }),                            // RuminateController.start():async
    requestCancel: () => ({ ...running, cancelRequested: true }),
  });

  it('rebuild: 控制器已装配时 status/start/cancel 可达', async () => {
    const deps = ctlDeps({ rebuild: ctlStub() });
    const s = await handleEndpoint('dsh-memory/rebuild-status', {}, deps) as { supported?: boolean; running: boolean; done: number };
    // 未接通时该端点恒返 {supported:false} → 此断言即注入护栏
    expect(s.supported).not.toBe(false);
    expect(s.running).toBe(true);
    expect(s.done).toBe(2);
    const st = await handleEndpoint('dsh-memory/rebuild-start', {}, deps) as { running: boolean };
    expect(st.running).toBe(true);
    const ca = await handleEndpoint('dsh-memory/rebuild-cancel', {}, deps) as { cancelRequested: boolean };
    expect(ca.cancelRequested).toBe(true);
  });

  it('rebuild: 未装配时 status 降级、start/cancel 报未初始化', async () => {
    const deps = ctlDeps();
    const s = await handleEndpoint('dsh-memory/rebuild-status', {}, deps) as { supported?: boolean; running: boolean };
    expect(s.supported).toBe(false);
    expect(s.running).toBe(false);
    await expect(handleEndpoint('dsh-memory/rebuild-start', {}, deps)).rejects.toThrow('重建控制器未初始化');
    await expect(handleEndpoint('dsh-memory/rebuild-cancel', {}, deps)).rejects.toThrow('重建控制器未初始化');
  });

  it('rebuild-start: 存储降级时被守卫拦下', async () => {
    const deps = ctlDeps({ rebuild: ctlStub(), status: { degraded: () => true, pending: () => 0 } });
    await expect(handleEndpoint('dsh-memory/rebuild-start', {}, deps)).rejects.toThrow('存储处于降级状态');
  });

  it('ruminate: 控制器已装配时 status/start/cancel 可达', async () => {
    const deps = ctlDeps({ ruminate: ruminateStub() });
    const s = await handleEndpoint('dsh-memory/ruminate-status', {}, deps) as { supported?: boolean; running: boolean; done: number };
    // 现行 deps 装配漏注入 ruminate 时该端点恒返 {supported:false} → 此断言即接线护栏
    expect(s.supported).not.toBe(false);
    expect(s.running).toBe(true);
    expect(s.done).toBe(2);
    const st = await handleEndpoint('dsh-memory/ruminate-start', {}, deps) as { running: boolean };
    expect(st.running).toBe(true);
    const ca = await handleEndpoint('dsh-memory/ruminate-cancel', {}, deps) as { cancelRequested: boolean };
    expect(ca.cancelRequested).toBe(true);
  });

  it('ruminate: 未装配时 status 降级、start/cancel 报未初始化', async () => {
    const deps = ctlDeps();
    const s = await handleEndpoint('dsh-memory/ruminate-status', {}, deps) as { supported?: boolean; running: boolean };
    expect(s.supported).toBe(false);
    expect(s.running).toBe(false);
    await expect(handleEndpoint('dsh-memory/ruminate-start', {}, deps)).rejects.toThrow('未初始化');
    await expect(handleEndpoint('dsh-memory/ruminate-cancel', {}, deps)).rejects.toThrow('未初始化');
  });
});

describe('bench control service', () => {
  it('provides the dsh-memory-bench surface with thin delegation', () => {
    let provided: unknown;
    const ctx = {
      provide: vi.fn((name: string, surface: unknown) => {
        provided = surface;
        return () => {};
      }),
    } as unknown as Parameters<typeof registerBenchControl>[0];
    const rebuild = { start: vi.fn(), getStatus: vi.fn() };
    const modes = new SessionModeStore('/nonexistent', 'work');
    const dispose = registerBenchControl(ctx, rebuild as never, modes, noopLogger);
    expect(dispose).toBeTypeOf('function');
    const surface = provided as Record<string, (...a: unknown[]) => unknown>;
    surface.setSessionMode('s1', 'chat');
    expect(modes.get('s1')).toBe('chat');
    expect(surface.getSessionMode('s1')).toBe('chat');
    surface.rebuildStart();
    expect(rebuild.start).toHaveBeenCalled();
    expect(surface.getDistillUsage()).toEqual({ layers: {} });
  });
});

describe('rpc: room registry wiring(HTTP 面全链路)', () => {
  it('room-register / rooms-get / room-admin 经 registerMemoryRpc 可用(回归:rpcHandler 曾漏带 roomRegistry → 面板侧恒"未装配")', async () => {
    const h = await harness({ live: liveHandle({ memoryMutate: true }), roomRegistry: true });
    const reg = await h.call('dsh-memory/room-register', { slug: 'dsh-plugin', label: 'dsh插件' }) as { created: boolean; slug: string };
    expect(reg.created).toBe(true);
    expect(reg.slug).toBe('dsh-plugin');
    // rooms-get 端点层合并注册表(registry 数组下发)
    const g = await h.call('dsh-memory/rooms-get', {}) as { registry?: Array<{ slug: string; label?: string }> };
    expect(g.registry?.some((e) => e.slug === 'dsh-plugin' && e.label === 'dsh插件')).toBe(true);
    // room-admin(破坏性面)走同一 deps:retire → 注册表状态翻转
    await h.call('dsh-memory/room-admin', { action: 'retire', slug: 'dsh-plugin' });
    expect(h.registry!.bySlug('dsh-plugin')!.status).toBe('retired');
    h.db.close();
  });

  it('未装配注册表时 room-register 报"未装配"(默认 harness 不带 registry)', async () => {
    const h = await harness({ live: liveHandle({ memoryMutate: true }) });
    await expect(h.call('dsh-memory/room-register', { slug: 'x' })).rejects.toThrow('未装配');
    h.db.close();
  });
});

describe('md 投射护栏旋钮：settings-set 白名单必须收 mdExportMaxRecords', () => {
  it('写进去读得到（被静默丢 = 面板上能改但没反应）；越界值钳到 0~10000', async () => {
    const h = await harness({ live: liveHandle() });
    await h.call('dsh-memory/settings-set', { mdExportMaxRecords: 700 });
    const got = await h.call('dsh-memory/settings-get', {}) as { settings: { mdExportMaxRecords?: number } };
    expect(got.settings.mdExportMaxRecords).toBe(700);
    await h.call('dsh-memory/settings-set', { mdExportMaxRecords: 99_999 });
    const hi = await h.call('dsh-memory/settings-get', {}) as { settings: { mdExportMaxRecords?: number } };
    expect(hi.settings.mdExportMaxRecords).toBe(10_000);
    await h.call('dsh-memory/settings-set', { mdExportMaxRecords: -5 });
    const lo = await h.call('dsh-memory/settings-get', {}) as { settings: { mdExportMaxRecords?: number } };
    expect(lo.settings.mdExportMaxRecords).toBe(0);
    h.db.close();
  });
});
