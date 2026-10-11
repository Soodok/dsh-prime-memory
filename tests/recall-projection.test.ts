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
  sessionId: string;
  ids: string[];
}
interface View {
  rev: number;
  sessionId: string;
  count: number;
  items: Array<{ id: string; type: string; title: string; priority: number; scenario?: string[] }>;
}

async function newStore(): Promise<SessionRecalledStore> {
  const store = new SessionRecalledStore(join(await tmp(), `p-${Math.random().toString(36).slice(2)}`));
  await store.flush(); // 等 init 载盘完成，再动数据
  stores.push(store);
  return store;
}

/** 捕获注册定义（可选喂 L1 面）。 */
async function captured(l1?: RecallL1Face): Promise<{ def: CapturedDef; store: SessionRecalledStore }> {
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
  registerRecallProjection(ctx, store, l1);
  const def = defs[0];
  if (!def) throw new Error('未捕获到 projection 定义');
  return { def, store };
}

const header = (id: string): unknown => ({ version: 3, id, createdAt: Date.now(), isSeeded: false });

function fakeL1(rows: Record<string, { type?: string; content: string; priority?: number; metadata?: Record<string, unknown> }>): RecallL1Face {
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
