/**
 * memoryRecall 投影单测（G-live 显示契约）。
 *
 * 钉住：注册形状 / 服务缺席降级 / **init 靠 header.id 定位会话**（宿主实证形状
 * `{ version, id, createdAt, … }`）/ apply 的 O(1) 判脏与**跨会话不 republish** /
 * view 引用稳定 + 最近在上 + 截断 + 缺失记录诚实跳过 / schema 校验闸。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import {
  MEMORY_RECALL_KEY,
  RECALL_VIEW_CAP,
  registerRecallProjection,
  stateSchema,
  viewSchema,
} from '../src/projection/recall.js';
import type { RecallL1Face } from '../src/projection/recall.js';
import { SessionRecalledStore } from '../src/store/session-recalled.js';

let dir: string;
/** 本套件创过的 store：afterAll 先等写穿完成再删目录（Windows 上在途写会顶回 ENOTEMPTY）。 */
const stores: SessionRecalledStore[] = [];
async function tmp(): Promise<string> {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'dsh-recall-proj-'));
  return dir;
}
afterAll(async () => {
  await Promise.all(stores.map((s) => s.flush()));
  if (dir) await rm(dir, { recursive: true, force: true });
});

interface CapturedDef {
  key: string;
  stateVersion: number;
  stateSchema: { parse(value: unknown): unknown };
  init(header: unknown): State;
  apply(state: State, event: { type: string; data: unknown }): State;
  wire: { viewSchema: { parse(value: unknown): unknown }; view(state: State): View };
}
interface State {
  rev: number;
  /** 反馈 sidecar 序号(可选;旧帧没这个字段)。 */
  fb?: number;
  sessionId: string;
  ids: string[];
}
interface View {
  rev: number;
  sessionId: string;
  count: number;
  items: Array<{ id: string; type: string; title: string; priority: number; scenario?: string[]; rating?: number; body?: string; retired?: true }>;
}

async function newStore(): Promise<SessionRecalledStore> {
  const store = new SessionRecalledStore(join(await tmp(), `p-${Math.random().toString(36).slice(2)}`));
  await store.flush(); // 等 init 载盘完成，再动数据
  stores.push(store);
  return store;
}

/** 捕获注册定义（可选喂 L1 面 / 反馈面）。 */
async function captured(
  l1?: RecallL1Face,
  feedback?: { revision(): number; lastOf(id: string): number | undefined },
): Promise<{ def: CapturedDef; store: SessionRecalledStore }> {
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
  registerRecallProjection(ctx, store, l1, feedback);
  const def = defs[0];
  if (!def) throw new Error('未捕获到 projection 定义');
  return { def, store };
}

const header = (id: string): unknown => ({ version: 3, id, createdAt: Date.now(), isSeeded: false });

function fakeL1(rows: Record<string, { type?: string; content: string; priority?: number; metadata?: Record<string, unknown>; validTo?: number }>): RecallL1Face {
  return {
    getByIds: (ids) =>
      ids
        .filter((id) => rows[id] !== undefined)
        .map((id) => ({
          id,
          type: rows[id]!.type ?? 'work_fact',
          content: rows[id]!.content,
          priority: rows[id]!.priority ?? 60,
          metadata: rows[id]!.metadata,
          // 真库的 getL1ByIds 不过滤退场行，假面也不能滤（否则删除线测不到）。
          ...(rows[id]!.validTo !== undefined ? { validTo: rows[id]!.validTo } : {}),
        })),
  };
}

describe('memoryRecall 投影：注册形状', () => {
  it('经 ctx.inject([sessionProjections]) 注册，stateVersion 0，schema 同对象', async () => {
    const store = await newStore();
    const defs: CapturedDef[] = [];
    const ctx = {
      inject: (deps: string[], callback: (injected: unknown) => void) => {
        expect(deps).toEqual(['sessionProjections']);
        callback({ sessionProjections: { register: (d: CapturedDef) => { defs.push(d); return () => {}; } } });
      },
    } as unknown as Context;
    registerRecallProjection(ctx, store);
    expect(defs).toHaveLength(1);
    expect(defs[0]!.key).toBe(MEMORY_RECALL_KEY);
    expect(defs[0]!.stateVersion).toBe(0);
    expect(defs[0]!.stateSchema).toBe(stateSchema);
    expect(defs[0]!.wire.viewSchema).toBe(viewSchema);
  });

  it('服务缺席 / 形状不符：静默不注册、不抛错', async () => {
    const store = await newStore();
    for (const service of [undefined, { register: 'not-a-function' }]) {
      const defs: CapturedDef[] = [];
      const ctx = {
        inject: (_d: string[], cb: (i: unknown) => void) => {
          cb({ sessionProjections: service });
          defs.push();
        },
      } as unknown as Context;
      expect(() => registerRecallProjection(ctx, store)).not.toThrow();
      expect(defs).toEqual([]);
    }
  });
});

describe('init：会话定位靠 header.id', () => {
  it('按 header.id 读本会话活召回集（注入序）', async () => {
    const { def, store } = await captured();
    store.add('session-a', ['m1', 'm2']);
    const state = def.init(header('session-a'));
    expect(state.sessionId).toBe('session-a');
    expect(state.ids).toEqual(['m1', 'm2']);
  });

  it('不同会话互不串（各自只见自己的桶）', async () => {
    const { def, store } = await captured();
    store.add('session-a', ['m1']);
    store.add('session-b', ['m9', 'm8']);
    expect(def.init(header('session-b')).ids).toEqual(['m9', 'm8']);
  });

  it('header 形状不符（null / 无 id）→ 空态且不抛', async () => {
    const { def } = await captured();
    for (const h of [null, undefined, {}, { id: 42 }]) {
      const state = def.init(h);
      expect(state.sessionId).toBe('');
      expect(state.ids).toEqual([]);
    }
  });
});

describe('apply：O(1) 判脏且不跨会话 republish', () => {
  it('rev 未变 → 同引用', async () => {
    const { def, store } = await captured();
    store.add('s', ['a']);
    const st = def.init(header('s'));
    expect(def.apply(st, { type: 'user/message', data: {} })).toBe(st);
  });

  it('别的会话写入（rev 变了）→ 本会话仍同引用', async () => {
    const { def, store } = await captured();
    store.add('s', ['a']);
    const st = def.init(header('s'));
    store.add('other', ['x', 'y']);
    expect(store.revision()).toBeGreaterThan(st.rev);
    expect(def.apply(st, { type: 'user/message', data: {} })).toBe(st);
  });

  it('本会话集合变化 → 重建新态（含 reset 后清空）', async () => {
    const { def, store } = await captured();
    store.add('s', ['a']);
    const st = def.init(header('s'));
    store.add('s', ['b']);
    const next = def.apply(st, { type: 'tool/result', data: {} });
    expect(next).not.toBe(st);
    expect(next.ids).toEqual(['a', 'b']);
    store.reset('s');
    expect(def.apply(next, { type: 'agent/created', data: {} }).ids).toEqual([]);
  });
});

describe('view：引用稳定 + 最近在上 + 截断', () => {
  it('同一 state 两次 view 满足 Object.is（registry 据此判发布）', async () => {
    const l1 = fakeL1({ m1: { content: 'A' }, m2: { content: 'B' } });
    const { def, store } = await captured(l1);
    store.add('s', ['m1', 'm2']);
    const st = def.init(header('s'));
    expect(def.wire.view(st)).toBe(def.wire.view(st));
  });

  it('items 最近在上；count 是总数；缺失记录跳过不编造', async () => {
    const l1 = fakeL1({
      m1: { content: '第一行\n第二行', priority: 70 },
      m2: { type: 'work_method', content: '第二条', priority: 88, metadata: { dsh_usage_scenario: ['改配置时'] } },
    });
    const { def, store } = await captured(l1);
    store.add('s', ['m1', 'm2', 'gone']);
    const v = def.wire.view(def.init(header('s')));
    expect(v.count).toBe(3);
    expect(v.items.map((i) => i.id)).toEqual(['m2', 'm1']); // 最近在上，gone 不存在 → 不透出
    expect(v.items[0]!.type).toBe('work_method');
    expect(v.items[0]!.scenario).toEqual(['改配置时']);
    expect(v.items[1]!.title).toBe('第一行'); // 只取首个非空行
    expect(v.items[1]!.scenario).toBeUndefined();
  });

  it('超出 RECALL_VIEW_CAP 只透出最近若干条，count 仍为总数', async () => {
    const rows: Record<string, { content: string }> = {};
    const ids: string[] = [];
    for (let i = 0; i < RECALL_VIEW_CAP + 5; i++) {
      const id = `m${i}`;
      ids.push(id);
      rows[id] = { content: `正文 ${i}` };
    }
    const { def, store } = await captured(fakeL1(rows));
    store.add('s', ids);
    const v = def.wire.view(def.init(header('s')));
    expect(v.count).toBe(ids.length);
    expect(v.items).toHaveLength(RECALL_VIEW_CAP);
    expect(v.items[0]!.id).toBe(`m${ids.length - 1}`);
  });

  it('无 L1 面（未装配）→ items 空但 count 如实', async () => {
    const { def, store } = await captured();
    store.add('s', ['m1']);
    const v = def.wire.view(def.init(header('s')));
    expect(v.items).toEqual([]);
    expect(v.count).toBe(1);
  });
});

describe('schema 校验闸', () => {
  it('合法值原样返回同一引用（不 clone，保引用稳定契约）', async () => {
    const good = { rev: 1, sessionId: 's', ids: ['a'] };
    expect(stateSchema.parse(good)).toBe(good);
    const view = { rev: 1, sessionId: 's', count: 1, items: [{ id: 'a', type: 'work_fact', title: 'T', priority: 60 }] };
    expect(viewSchema.parse(view)).toBe(view);
  });

  it('非法一律抛错（不静默透传）', () => {
    expect(() => stateSchema.parse({ rev: -1, sessionId: 's', ids: [] })).toThrow();
    expect(() => stateSchema.parse({ rev: 0, sessionId: 's', ids: 'a' })).toThrow();
    expect(() => stateSchema.parse({ rev: 0, sessionId: 1, ids: [] })).toThrow();
    expect(() => viewSchema.parse({ rev: 0, sessionId: 's', count: 0, items: [{ id: 'a', type: 't', title: 'x', priority: 1.5 }] })).toThrow();
    expect(() => viewSchema.parse({ rev: 0, sessionId: 's', count: 0, items: {} })).toThrow();
  });

  it('附加字段缺席（旧 checkpoint 无 scenario）整条通过', () => {
    const view = { rev: 0, sessionId: 's', count: 1, items: [{ id: 'a', type: 't', title: 'x', priority: 1 }] };
    expect(() => viewSchema.parse(view)).not.toThrow();
  });
});

describe('人打分（rating）进 view', () => {
  /** 可变反馈面：set 会推 revision，模拟用户又打了一笔。 */
  function fbStub(initial: Record<string, number> = {}) {
    const map = new Map(Object.entries(initial));
    let rev = 0;
    return {
      set: (id: string, v: number): void => { map.set(id, v); rev += 1; },
      revision: (): number => rev,
      lastOf: (id: string): number | undefined => map.get(id),
    };
  }

  it('未装配反馈面 → 条目不带 rating（旧行为）', async () => {
    const { def, store } = await captured(fakeL1({ a: { content: '甲' } }));
    store.add('s', ['a']);
    const v = def.wire.view(def.init(header('s')));
    expect(v.items[0]).not.toHaveProperty('rating');
  });

  it('打过分的条目带 rating；-1 也如实透出（卡片要能显示选中态）', async () => {
    const fb = fbStub({ a: 4, b: -1 });
    const { def, store } = await captured(fakeL1({ a: { content: '甲' }, b: { content: '乙' } }), fb);
    store.add('s', ['a', 'b']);
    const v = def.wire.view(def.init(header('s')));
    expect(v.items.find((i) => i.id === 'a')!.rating).toBe(4);
    expect(v.items.find((i) => i.id === 'b')!.rating).toBe(-1);
  });

  it('只改打分不改集合 → 仍 republish（否则卡片停在旧的那一笔）', async () => {
    const fb = fbStub();
    const { def, store } = await captured(fakeL1({ a: { content: '甲' } }), fb);
    store.add('s', ['a']);
    const st0 = def.init(header('s'));
    const st1 = def.apply(st0, { type: 'tool/result', data: {} });
    expect(st1).toBe(st0); // 什么都没变 → 同引用
    fb.set('a', 5);
    const st2 = def.apply(st1, { type: 'tool/result', data: {} });
    expect(st2).not.toBe(st1);
    expect(st2.ids).toEqual(st1.ids); // 集合没变，只是 fb 序号动了
    expect(def.wire.view(st2).items[0]!.rating).toBe(5);
  });

  it('别的会话打分 → 本会话 view 不因此 thrash（ids/fb 未变则同引用）', async () => {
    let rev = 0;
    const fb = { revision: () => rev, lastOf: (_id: string) => undefined };
    const { def, store } = await captured(fakeL1({ a: { content: '甲' } }), fb);
    store.add('s', ['a']);
    const st0 = def.init(header('s'));
    rev += 1; // 反馈动了，但本会话集合与打分结果不变
    const st1 = def.apply(st0, { type: 'tool/result', data: {} });
    expect(st1).not.toBe(st0); // fb 进了 state → 重建一次（可接受：下一帧就稳）
    const st2 = def.apply(st1, { type: 'tool/result', data: {} });
    expect(st2).toBe(st1); // 再动一次事件不重复重建
  });

  it('stateSchema 容忍旧帧（无 fb 字段）', () => {
    expect(() => stateSchema.parse({ rev: 0, sessionId: 's', ids: ['a'] })).not.toThrow();
  });

  it('viewSchema 拒非数字 rating', () => {
    expect(() => viewSchema.parse({
      rev: 0, sessionId: 's', count: 1, items: [{ id: 'a', type: 't', title: 'x', priority: 1, rating: 'high' }],
    })).toThrow();
  });
});

describe('正文全文（body）与退场标注（retired）进 view', () => {
  it('items 带 body；超长截断到 BODY_MAX 并补省略号（≤701 字符）', async () => {
    const long = `${'甲'.repeat(800)}\n尾部不该被丢到看不见`;
    const { def, store } = await captured(fakeL1({ a: { content: long } }));
    store.add('s', ['a']);
    const v = def.wire.view(def.init(header('s')));
    const body = v.items[0]!.body!;
    expect(body.length).toBeLessThanOrEqual(701);
    expect(body.endsWith('…')).toBe(true);
    // title 仍只取首行，不受 body 影响
    expect(v.items[0]!.title.length).toBeLessThanOrEqual(160);
  });

  it('短正文原样透出（去首尾空白，不丢换行）', async () => {
    const { def, store } = await captured(fakeL1({ a: { content: '  第一行\n第二行  ' } }));
    store.add('s', ['a']);
    const v = def.wire.view(def.init(header('s')));
    expect(v.items[0]!.body).toBe('第一行\n第二行');
  });

  it('退场记录仍在 items 里且 retired === true（删除线的根）', async () => {
    const { def, store } = await captured(fakeL1({
      a: { content: '活跃', validTo: undefined },
      b: { content: '已判过时', validTo: Date.parse('2026-10-12T00:00:00Z') },
    }));
    store.add('s', ['a', 'b']);
    const v = def.wire.view(def.init(header('s')));
    expect(v.count).toBe(2);
    expect(v.items).toHaveLength(2); // 不得被摘出列表
    const alive = v.items.find((i) => i.id === 'a')!;
    const stale = v.items.find((i) => i.id === 'b')!;
    expect(alive).not.toHaveProperty('retired'); // 缺席即活跃，旧帧同形状
    expect(stale.retired).toBe(true);
  });

  it('viewSchema 容忍无 body/retired 的旧帧；retired:false 视为脏帧抛错', () => {
    const legacy = { rev: 0, sessionId: 's', count: 1, items: [{ id: 'a', type: 't', title: 'x', priority: 1 }] };
    expect(() => viewSchema.parse(legacy)).not.toThrow();
    expect(() => viewSchema.parse({
      rev: 0, sessionId: 's', count: 1, items: [{ id: 'a', type: 't', title: 'x', priority: 1, retired: false }],
    })).toThrow();
    expect(() => viewSchema.parse({
      rev: 0, sessionId: 's', count: 1, items: [{ id: 'a', type: 't', title: 'x', priority: 1, body: 42 }],
    })).toThrow();
  });
});
