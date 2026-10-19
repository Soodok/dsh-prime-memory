/**
 * 激活槽位服务端投影片测试(task_36):注册形状 / 服务缺席降级 / init 跨会话可见性(R7) /
 * view 引用稳定(I1)与字段集(F9) / apply 同引用(I1b)与 rev 判脏(task_33) / schema 校验(task_30)。
 *
 * 后半段走**真** `SessionProjectionRegistry`(宿主包,动态加载:未安装则整段 skip),
 * 验证定义能被真注册表接受、真 drive 能刷新、卸载后 key 消失(I6)。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import {
  MEMORY_SLOTS_KEY,
  registerSlotsProjection,
  stateSchema,
  viewSchema,
} from '../src/projection/slots.js';
import type { SlotsProjectionState, SlotsView } from '../src/projection/slots.js';
import { SlotStore } from '../src/store/slots.js';
import type { MemoryLogger } from '../src/types.js';

let dir: string;
async function tmp(): Promise<string> {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'dsh-slots-proj-'));
  return dir;
}
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as MemoryLogger;

interface CapturedDef {
  key: string;
  stateVersion: number;
  stateSchema: { parse(value: unknown): unknown };
  init(): SlotsProjectionState;
  apply(state: SlotsProjectionState, event: { type: string; data: unknown }): SlotsProjectionState;
  wire: { viewSchema: { parse(value: unknown): unknown }; view(state: SlotsProjectionState): SlotsView };
}

async function newStore(): Promise<SlotStore> {
  const dataDir = join(await tmp(), `p-${Math.random().toString(36).slice(2)}`);
  const store = new SlotStore(SlotStore.pathFor(dataDir), noopLogger, {
    maxSlots: 8,
    maxBodyChars: 512,
    maxTitleChars: 60,
  });
  await store.load();
  return store;
}

/** 伪注册表:只实现我们依赖的 `register`,并记录注入请求。 */
function fakeCtx(service: unknown): { ctx: Context; defs: CapturedDef[]; injectCalls: string[][] } {
  const defs: CapturedDef[] = [];
  const injectCalls: string[][] = [];
  const ctx = {
    inject: (deps: string[], callback: (injected: unknown) => void) => {
      injectCalls.push(deps);
      callback({ sessionProjections: service });
    },
  } as unknown as Context;
  return { ctx, defs, injectCalls };
}

/** 可注册的伪服务(单独构造,便于注入"形状不符"的变体)。 */
function registerableService(defs: CapturedDef[]) {
  return { register: (def: CapturedDef) => { defs.push(def); return () => {}; } };
}

async function captured(l1?: unknown): Promise<{ def: CapturedDef; store: SlotStore }> {
  const store = await newStore();
  const defs: CapturedDef[] = [];
  const ctx = {
    inject: (_deps: string[], callback: (injected: unknown) => void) => {
      callback({
        sessionProjections: {
          register: (def: CapturedDef) => {
            defs.push(def);
            return () => {};
          },
        },
      });
    },
  } as unknown as Context;
  registerSlotsProjection(ctx, store, l1 as undefined);
  const def = defs[0];
  if (!def) throw new Error('未捕获到 projection 定义');
  return { def, store };
}

const TOOL_RESULT = { type: 'tool/result', data: { message: { content: [{ isError: false }] } } };
const TOOL_RESULT_ERROR = { type: 'tool/result', data: { message: { content: [{ isError: true }] } } };

describe('投影片注册形状', () => {
  it('经 ctx.inject([sessionProjections]) 注册 memorySlots(stateVersion 0)', async () => {
    const store = await newStore();
    const defs: CapturedDef[] = [];
    const ctx = {
      inject: (deps: string[], callback: (injected: unknown) => void) => {
        expect(deps).toEqual(['sessionProjections']);
        callback({ sessionProjections: { register: (d: CapturedDef) => { defs.push(d); return () => {}; } } });
      },
    } as unknown as Context;
    registerSlotsProjection(ctx, store);
    expect(defs).toHaveLength(1);
    expect(defs[0]?.key).toBe(MEMORY_SLOTS_KEY);
    expect(defs[0]?.stateVersion).toBe(0);
    expect(typeof defs[0]?.init).toBe('function');
    expect(typeof defs[0]?.apply).toBe('function');
    expect(defs[0]?.wire.viewSchema).toBe(viewSchema);
    expect(defs[0]?.stateSchema).toBe(stateSchema);
  });

  it('服务缺席 / 形状不符:静默不注册、不抛错(F8)', async () => {
    const store = await newStore();
    const absent = fakeCtx(undefined);
    expect(() => registerSlotsProjection(absent.ctx, store)).not.toThrow();
    expect(absent.defs).toEqual([]);
    expect(absent.injectCalls).toEqual([['sessionProjections']]); // 仍然尝试注入,只是服务缺席

    const malformed = fakeCtx({ register: 'not-a-function' });
    expect(() => registerSlotsProjection(malformed.ctx, store)).not.toThrow();
    expect(malformed.defs).toEqual([]);
  });

  it('服务在场:注册一次', async () => {
    const store = await newStore();
    const defs: CapturedDef[] = [];
    const present = fakeCtx(registerableService(defs));
    registerSlotsProjection(present.ctx, store);
    expect(defs).toHaveLength(1);
  });
});

describe('init / apply / view 语义', () => {
  it('init() 每次按当下 SlotStore 读一次(跨会话可见性,R7)', async () => {
    const { def, store } = await captured();
    expect(def.init()).toMatchObject({ rev: 0, count: 0, openCount: 0, slots: [] });
    await store.upsert({ title: 'A', pinned: true });
    // 新会话 → 新 cell → 再次 init:自动拿到最新持久态
    expect(def.init()).toMatchObject({ rev: 1, count: 1, openCount: 1 });
    expect(def.init().slots.map((s) => s.title)).toEqual(['A']);
  });

  it('apply:无关事件与未变更 rev 均返回同引用(I1b)', async () => {
    const { def, store } = await captured();
    await store.upsert({ title: 'A' });
    const state = def.init();
    for (const event of [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'tool/call', data: { callId: 'c1', name: 'memory_slot_write' } },
      { type: 'user/message', data: {} },
      TOOL_RESULT,
    ]) {
      expect(Object.is(def.apply(state, event), state)).toBe(true);
    }
  });

  it('apply:任意事件都判脏——rev 变了,非 tool/result 事件也重建(v0.18.4)', async () => {
    const { def, store } = await captured();
    const before = def.init();
    await store.upsert({ title: '跨会话规则', kind: 'rule', pinned: true, priority: 90 });
    // 用户消息 / turn 边界等任意事件到达即刷新,不再依赖下一条 tool/result
    for (const event of [
      { type: 'user/message', data: {} },
      { type: 'turn/start', data: { turn: 2 } },
    ]) {
      const next = def.apply(before, event);
      expect(Object.is(next, before)).toBe(false);
      expect(next).toMatchObject({ rev: 1, count: 1, openCount: 1 });
    }
  });

  it('apply:tool/result 时 rev 变了才重建快照(task_33)', async () => {
    const { def, store } = await captured();
    const before = def.init();
    const slot = await store.upsert({ title: '网络规则', kind: 'rule', pinned: true, priority: 90 });
    const after = def.apply(before, TOOL_RESULT);
    expect(Object.is(after, before)).toBe(false);
    expect(after).toMatchObject({ rev: 1, count: 1, openCount: 1 });
    expect(after.slots[0]?.id).toBe(slot.id);

    expect(Object.is(def.apply(after, TOOL_RESULT), after)).toBe(true); // 再折同 rev → 同引用
    await store.close(slot.id, 'done');
    const closed = def.apply(after, TOOL_RESULT);
    expect(closed).toMatchObject({ rev: 2, count: 1, openCount: 0 });
    expect(closed.slots[0]?.status).toBe('done');
  });

  it('apply:错误事件不再抑制重建——rev 是唯一判据(v0.18.4 语义变更)', async () => {
    const { def, store } = await captured();
    const before = def.init();
    await store.upsert({ title: 'A' });
    // 旧行为:错误 tool/result 返回同引用。新行为:store 已真实变更(rev 1),
    // 无论到达的事件成败,重建都读当前真实快照——事件只是触发器,不是数据源。
    const next = def.apply(before, TOOL_RESULT_ERROR);
    expect(Object.is(next, before)).toBe(false);
    expect(next).toMatchObject({ rev: 1, count: 1 });
  });

  it('无可解析引用时省略 refViews，保持投影视图为无损 JSON', async () => {
    const { def, store } = await captured();
    await store.upsert({ title: '路径引用', refs: ['docs/guide.md'] });
    const state = def.init();
    const slot = state.slots[0]!;
    expect(Object.hasOwn(slot, 'refViews')).toBe(false);
    expect(Object.hasOwn(def.wire.view(state).slots[0]!, 'refViews')).toBe(false);

    const { def: missing, store: missingStore } = await captured({ getByIds: () => [] });
    await missingStore.upsert({ title: '已退场引用', refs: ['mem_missing'] });
    expect(Object.hasOwn(missing.init().slots[0]!, 'refViews')).toBe(false);
  });

  it('可解析 L1 引用仍保留 refViews', async () => {
    const { def, store } = await captured({
      getByIds: () => [{ id: 'mem_found', content: '规则正文', type: 'rule' }],
    });
    await store.upsert({ title: '有效引用', refs: ['mem_found'] });
    // 与 L402 同口径：refViews 全形状含 filePath（relPathFor 单一事实源，'rule' 非族类名→unclassified）
    expect(def.wire.view(def.init()).slots[0]?.refViews).toEqual([
      { ref: 'mem_found', title: '[rule] 规则正文', filePath: 'unclassified/规则正文.memory.md' },
    ]);
  });

  it('view 引用稳定(I1)且不含 body(F9)', async () => {
    const { def, store } = await captured();
    const before = def.init(); // rev 0
    const first = def.wire.view(before);
    expect(def.wire.view(before)).toBe(first); // Object.is 稳定

    await store.upsert({ title: 'A', body: '机密正文', kind: 'anchor', priority: 70, pinned: true });
    const after = def.apply(before, TOOL_RESULT);
    expect(Object.is(after, before)).toBe(false);
    const changed = def.wire.view(after);
    expect(changed).not.toBe(first); // 新 state → 新 view

    expect(Object.keys(changed).sort()).toEqual(['count', 'openCount', 'rev', 'slots']);
    expect(Object.keys(changed.slots[0]!).sort()).toEqual(['id', 'kind', 'priority', 'status', 'title']);
    expect(JSON.stringify(changed)).not.toContain('机密正文');
  });
});

describe('schema 校验(task_30)', () => {
  const valid: SlotsProjectionState = {
    rev: 3,
    count: 1,
    openCount: 1,
    slots: [{ id: 'slot_1', title: 'A', kind: 'rule', status: 'open', priority: 50 }],
  };

  it('合法态原样通过(同引用,不 clone)', () => {
    expect(stateSchema.parse(valid)).toBe(valid);
    const view = viewSchema.parse(valid);
    expect(view).toBe(valid);
    expect(stateSchema.parse({ rev: 0, count: 0, openCount: 0, slots: [] })).toMatchObject({ rev: 0 });
  });

  it('非法态一律抛错(不静默透传)', () => {
    const bad: unknown[] = [
      undefined,
      null,
      'x',
      [],
      { rev: 1, count: 1, openCount: 1 }, // 缺 slots
      { rev: -1, count: 0, openCount: 0, slots: [] },
      { rev: 1.5, count: 0, openCount: 0, slots: [] },
      { rev: 0, count: 0, openCount: 0, slots: 'nope' },
      { rev: 0, count: 0, openCount: 0, slots: [{ id: '', title: 'A', kind: 'rule', status: 'open', priority: 1 }] },
      { rev: 0, count: 0, openCount: 0, slots: [{ id: 's', title: 7, kind: 'rule', status: 'open', priority: 1 }] },
      { rev: 0, count: 0, openCount: 0, slots: [{ id: 's', title: 'A', kind: 'bogus', status: 'open', priority: 1 }] },
      { rev: 0, count: 0, openCount: 0, slots: [{ id: 's', title: 'A', kind: 'rule', status: 'bogus', priority: 1 }] },
      { rev: 0, count: 0, openCount: 0, slots: [{ id: 's', title: 'A', kind: 'rule', status: 'open', priority: 101 }] },
      { rev: 0, count: 0, openCount: 0, slots: [{ id: 's', title: 'A', kind: 'rule', status: 'open', priority: -1 }] },
    ];
    for (const value of bad) {
      expect(() => stateSchema.parse(value)).toThrow(/memorySlots\.(state|view)/);
    }
  });

  it('viewSchema 拦得住被篡改的 view(体量字段越界)', () => {
    expect(() => viewSchema.parse({ ...valid, slots: [{ ...valid.slots[0]!, priority: 500 }] })).toThrow();
    expect(() => viewSchema.parse({ ...valid, count: Number.NaN })).toThrow();
  });
});

// ── 真注册表集成(宿主包缺失则整段跳过) ──
interface RealRegistryLike {
  register(def: unknown): () => void;
  snapshot(session: unknown): { values: Record<string, unknown> };
  stateOf(session: unknown, key: string): unknown;
}

let RegistryCtor: (new (ctx: Context) => RealRegistryLike) | undefined;
try {
  const mod = (await import('@deepseek-ai/dsh-session-projection')) as {
    SessionProjectionRegistry?: new (ctx: Context) => RealRegistryLike;
  };
  RegistryCtor = mod.SessionProjectionRegistry;
} catch {
  RegistryCtor = undefined;
}

/**
 * 最小 Session 桩。注册表在**两个**宿主构建里读的会话面不同(实测):
 * - dev 依赖树解析到的构建:`session.events`(数组)+ `session.seq`,`init()` 零参;
 * - 宿主运行时 0.1.5-rc.2 的构建:`session.snapshotEvents(from,to)` + `eventAt` +
 *   `header` + `inheritedEventCount`,`init(header, inheritedEventCount)`。
 * 两者都要满足,才能证明本插件对新旧注册表都兼容(我们的 init 忽略入参)。
 */
function makeSession(events: { seq: number; type: string; data: unknown }[]) {
  const session = {
    events,
    header: { id: 'sess-real' },
    inheritedEventCount: 0,
    get seq() {
      return events.length;
    },
    snapshotEvents(from = 0, to = events.length) {
      return events.filter((e) => e.seq >= from && e.seq < to);
    },
    eventAt(seq: number) {
      return events.find((e) => e.seq === seq);
    },
  };
  return session;
}

describe.skipIf(RegistryCtor === undefined)('真 SessionProjectionRegistry 集成', () => {
  it('注册 → drive 刷新 → snapshot 不含 body → 卸载后 key 消失(F8/F9/I6)', async () => {
    const ctor = RegistryCtor!;
    const store = await newStore();
    const ctx = new Context();
    const registry = new ctor(ctx);
    const ctxWithRegistry = ctx as unknown as Context;

    // 在注册之前挂上探针:注册 disposer 由注入 fiber 持有,注销后 key 必须消失(I6)
    const patched = registry as unknown as { register: (def: unknown) => () => void };
    const original = patched.register.bind(registry);
    const disposers: (() => void)[] = [];
    patched.register = (def: unknown) => {
      const disposer = original(def);
      disposers.push(disposer);
      return disposer;
    };

    registerSlotsProjection(ctxWithRegistry, store);
    await new Promise((r) => setTimeout(r, 0)); // inject 回调可能延后到微任务
    expect(disposers).toHaveLength(1);

    const events: { seq: number; type: string; data: unknown }[] = [];
    const session = makeSession(events);

    // 未写入时的初值(empty log)
    let snapshot = registry.snapshot(session);
    expect(snapshot.values[MEMORY_SLOTS_KEY]).toMatchObject({ rev: 0, count: 0, slots: [] });

    // 模拟一次成功的 memory_slot_write:store 先落库,再提交 tool/result 事件
    await store.upsert({ title: '网络规则', kind: 'rule', pinned: true, body: '机密正文', priority: 95 });
    const event = { seq: 0, type: 'tool/result', data: { message: { content: [{ isError: false }] } } };
    events.push(event);
    (ctx as unknown as { emit(name: string, ...args: unknown[]): unknown }).emit('session/event', session, event);

    snapshot = registry.snapshot(session);
    const view = snapshot.values[MEMORY_SLOTS_KEY] as SlotsView;
    expect(view).toMatchObject({ rev: 1, count: 1, openCount: 1 });
    expect(view.slots[0]?.title).toBe('网络规则');
    expect(JSON.stringify(view)).not.toContain('机密正文');
    expect((registry.stateOf(session, MEMORY_SLOTS_KEY) as SlotsProjectionState).rev).toBe(1);

    // 卸载:注销后 key 从快照消失(客户端读成能力缺席)
    for (const dispose of disposers) dispose();
    expect(registry.snapshot(session).values[MEMORY_SLOTS_KEY]).toBeUndefined();
  });
});

describe('refs / refViews 解析(v0.20.2)', () => {
  const L1 = {
    getByIds: (ids: string[]) =>
      ids.filter((id) => !id.includes('gone')).map((id) => ({
        id,
        content: '回复永远是中文,技术名词保留英文。' + (id.includes('long') ? '很长的正文'.repeat(30) : ''),
        type: 'work_fact',
        ...(id === 'mem_named9' ? { name: '语言红线', workspaceId: 'e:/proj/x' } : {}),
      })),
  };

  it('wire view 透出 refs,record_id 解析成名称简述', async () => {
    const { def, store } = await captured(L1);
    await store.upsert({
      title: '语言规则',
      kind: 'rule',
      pinned: true,
      refs: ['mem_abc123', 'notes/a.md', 'https://x.y'],
    });
    const view = def.wire.view(def.init());
    const slot = view.slots[0]!;
    expect(slot.refs).toEqual(['mem_abc123', 'notes/a.md', 'https://x.y']);
    expect(slot.refViews).toEqual([{ ref: 'mem_abc123', title: '[work_fact] 回复永远是中文,技术名词保留英文。', filePath: 'work_fact/回复永远是中文-技术名词保留英文.memory.md' }]);
  });

  it('有 name 时标题走 name，并透出 filePath/workspaceId（与投射写盘同一算法）', async () => {
    const { def, store } = await captured(L1);
    await store.upsert({ title: '命名引用', refs: ['mem_named9'] });
    const slot = def.wire.view(def.init()).slots[0]!;
    expect(slot.refViews).toEqual([
      {
        ref: 'mem_named9',
        title: '[work_fact] 语言红线',
        filePath: 'work_fact/语言红线.memory.md',
        workspaceId: 'e:/proj/x',
      },
    ]);
  });

  it('超长 content 截断;缺失记录不产生条目;无 record_id 时 refViews 缺席', async () => {
    const { def, store } = await captured(L1);
    await store.upsert({ title: '长文', refs: ['mem_long1', 'mem_gone'] });
    let view = def.wire.view(def.init());
    const slot = view.slots[0]!;
    expect(slot.refViews).toHaveLength(1);
    expect(slot.refViews![0]!.ref).toBe('mem_long1');
    expect(slot.refViews![0]!.title.length).toBeLessThanOrEqual('[work_fact] '.length + 81);

    const bare = await captured(L1);
    await bare.store.upsert({ title: '只有路径', refs: ['notes/b.md'] });
    view = bare.def.wire.view(bare.def.init());
    expect(view.slots[0]!.refViews).toBeUndefined();
    expect(view.slots[0]!.refs).toEqual(['notes/b.md']);
  });

  it('parser:refs/refViews 存在才校验;旧 checkpoint 无新字段整条通过(A5)', async () => {
    const legacy = { rev: 1, count: 1, openCount: 1, slots: [{ id: 's1', title: '旧', kind: 'rule', status: 'open', priority: 1 }] };
    expect(() => stateSchema.parse(legacy)).not.toThrow();
    expect(() =>
      stateSchema.parse({
        rev: 1, count: 1, openCount: 1,
        slots: [{ id: 's1', title: '新', kind: 'rule', status: 'open', priority: 1, refs: ['mem_x', 7], refViews: [{ ref: 'mem_x' }] }],
      }),
    ).toThrow();
    expect(() =>
      stateSchema.parse({
        rev: 1, count: 1, openCount: 1,
        slots: [{ id: 's1', title: '新', kind: 'rule', status: 'open', priority: 1, refs: ['mem_x'], refViews: [{ ref: 'mem_x', title: 't' }] }],
      }),
    ).not.toThrow();
  });
});
