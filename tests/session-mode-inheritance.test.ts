/**
 * §A 子代理档位隔离回归测试(task_6)。
 *
 * **缺陷**:子代理以**新 session id** 调用记忆工具时,`SessionModeStore.get()` 查不到条目,
 * 回落 `?? this.loaded`(全局默认档,通常 `auto`)。于是父会话被用户**显式**设为 `off`
 * 或只写时,其派发的子代理**仍能读到用户明确关闭的记忆**——不是偏好问题,是
 * **用户的显式关闭指令被绕过**(故 §A 定级 P0)。
 *
 * **同步通路**(task_4 spike 实测,见 `findings.md §8`):
 *
 *   exec.agent.session.header.parentSession     ← 三个 readonly 字段,无 Promise
 *
 * 子代理会话 header **无条件**携带父会话 id(`dsh-subagent/.../child-agent.js:111-125`
 * 的 `childSessionMeta` 对 `parentSession` 不设 `undefined` 守卫)。
 *
 * **多级父链上溯**(spike 边界 1)额外需要按 id 取某个会话的 header:
 *
 *   ctx.get('agents').get(id).session.header.parentSession
 *
 * 该宽容路径的既有先例:`src/hooks/recall.ts:402-407`(注释:「cordis 属性访问
 * (ctx.sessions)对未 inject 的服务抛 "without inject";可选服务一律走 ctx.get()
 * 的宽容路径」)与 `:461` 的 `const agents = ctx.get('agents')`。
 *
 * **TDD 序**:本文件按 v3.2 修正的执行序**先于实现(task_5)编写**,首轮必须 **RED**——
 * 当前实现不读 `session.header`,故子代理一律按 `auto` 放行,三条档位断言全部失败。
 * 实现后转 GREEN。末两条为**回归护栏**(应始终 PASS),用于确认修复没有破坏
 * 顶层会话语义与 fail-open 语义。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { registerMemoryTools } from '../src/tools/index.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { L0Store } from '../src/store/l0.js';
import { L1Store } from '../src/store/l1.js';
import { SceneStore } from '../src/store/scenes.js';
import { PersonaStore } from '../src/store/persona.js';
import { SessionModeStore } from '../src/store/session-modes.js';
import type { LiveSettingsHandle } from '../src/settings.js';
import type { MemoryLiveSettings } from '../src/contract.js';
import type { MemoryConfig } from '../src/config.js';
import type { MemoryLogger } from '../src/types.js';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';

let dir: string;
/**
 * 已开启的库句柄:用例在断言失败时不会走到 `db.close()`,会让 teardown 的 rm 撞
 * EBUSY 并把 RED 信号淹没成 "Failed Suite"。故集中登记、在 afterAll 兜底关闭。
 */
const openedDbs: Array<{ close: () => void }> = [];
async function tmp(): Promise<string> {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'dsh-mode-inherit-'));
  return dir;
}
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

/** 工具 execute 收到的 exec 形状(只声明本测试关心的字段)。 */
interface ExecShape {
  agent?: {
    id?: string;
    session?: { header: { id?: string; parentSession?: string } };
  };
}
interface RegisteredTool {
  name: string;
  execute: (args: Record<string, unknown>, exec?: ExecShape) => Promise<unknown>;
}
interface SearchResult {
  items?: Array<{ id?: string; content?: string }>;
  notice?: string;
}

/** 子代理调用:自身 id **不在**档位表,靠 session.header.parentSession 指回父会话。 */
function childExec(childId: string, parentId: string): ExecShape {
  return { agent: { id: childId, session: { header: { id: childId, parentSession: parentId } } } };
}
/** 顶层会话:无父(`parentSession` 缺省)。 */
function rootExec(id: string): ExecShape {
  return { agent: { id, session: { header: { id } } } };
}

/**
 * 伪造 AgentRegistry:`ctx.get('agents').get(id)` 返回该 id 的 Agent,
 * 其 `session.header.parentSession` 指向 `links[id]`。用于多级父链上溯。
 */
function fakeAgents(links: Record<string, string>): { get: (id: string) => unknown } {
  return {
    get: (id: string) => {
      const parent = links[id];
      if (parent === undefined) return undefined;
      return { id, session: { header: { id, parentSession: parent } } };
    },
  };
}

function harness(opts: { agents?: { get: (id: string) => unknown } } = {}) {
  // 基线不含 conflictFreeze 键(留空 = 不覆盖,见 runner.ts 的 !== undefined 判定),故用断言;
  // 空数组按契约类型加宽(never[] 会让断言两侧失去重叠)
  const live = {
    enabled: true, capture: true, distill: true, recall: true,
    reasoningEffort: '', distillProvider: '', distillModel: '', distillChain: [] as MemoryLiveSettings['distillChain'],
    distillBudgets: { extract: 0, dedup: 0, l2: 0, l3: 0, graph: 0 }, distillMaxInputChars: 0,
    distillLayerChains: { l1: [], l2: [], l3: [] } as MemoryLiveSettings['distillLayerChains'],
    distillMode: '', directBaseURL: '', directApiKey: '',
    embedRemoteBaseURL: '', embedRemoteApiKey: '', embedRemoteModel: '', embedRemoteDimensions: 0,
    memoryMutate: false,
  } as MemoryLiveSettings;
  const liveHandle: LiveSettingsHandle = { supported: true, get: () => live, update: async () => {} };

  // 全局默认档 = auto:正是"回落"会命中的那个值
  const modes = new SessionModeStore('/nonexistent', 'auto');
  const entries = (modes as unknown as { entries: Map<string, unknown> }).entries;
  // 父会话的**显式**档位
  entries.set('parent-off', { mode: 'off', recall: undefined, updatedAt: Date.now() });
  entries.set('parent-wo', { mode: 'chat', recall: false, updatedAt: Date.now() });
  entries.set('parent-work', { mode: 'work', recall: undefined, updatedAt: Date.now() });
  entries.set('parent-chat', { mode: 'chat', recall: undefined, updatedAt: Date.now() });
  // 顶层回归用:显式 off 的普通会话
  entries.set('root-off', { mode: 'off', recall: undefined, updatedAt: Date.now() });

  const registered: RegisteredTool[] = [];
  const ctx = {
    tools: { register: (t: ToolDefinition) => registered.push(t as unknown as RegisteredTool) },
    get: (name: string) => (name === 'agents' ? opts.agents : undefined),
  } as unknown as Parameters<typeof registerMemoryTools>[0];

  const cfg = { tools: true, recall: { maxResults: 5 } } as unknown as MemoryConfig;
  return { ctx, cfg, modes, liveHandle, registered };
}

/** 两条基线记录:chat 族一条(preference)、work 族一条(work_fact)。 */
async function setupStores() {
  const dataDir = join(await tmp(), `mode-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const db = new MemoryDb(join(dataDir, 'memory.db'), 0);
  db.init();
  openedDbs.push(db);
  const l1 = new L1Store(dataDir, db, undefined, 'hybrid', noopLogger, 0);
  const l0 = new L0Store(db);
  await l1.init();
  const now = Date.now();
  await l1.appendNew([
    { id: 'r1', content: '用户喜欢手冲咖啡', type: 'preference', priority: 60, scene_name: '日常', timestamps: [now], createdAt: now, updatedAt: now },
    { id: 'r2', content: '团队用 GitLab CI', type: 'work_fact', priority: 50, scene_name: '基建', timestamps: [now], createdAt: now, updatedAt: now },
  ]);
  const scenes = { chat: new SceneStore(dataDir, 'chat'), work: new SceneStore(dataDir, 'work') };
  await scenes.chat.init();
  await scenes.work.init();
  const persona = { chat: new PersonaStore(dataDir, 'chat'), work: new PersonaStore(dataDir, 'work') };
  await persona.chat.init();
  await persona.work.init();
  return { db, l1, l0, scenes, persona };
}

async function setupSearch(opts: { agents?: { get: (id: string) => unknown } } = {}) {
  const stores = await setupStores();
  const h = harness(opts);
  registerMemoryTools(h.ctx, h.cfg, stores, noopLogger, h.modes, h.liveHandle);
  const search = h.registered.find((t) => t.name === 'memory_search')!;
  return { stores, search };
}

const CHAT_MARK = '手冲咖啡';
const WORK_MARK = 'GitLab';

describe('task_6 §A 子代理档位隔离回归', () => {
  it('父会话 off → 子代理 memory_search 必须不返回任何记忆', async () => {
    const { stores, search } = await setupSearch();
    // 先确认基线:同一查询在允许读取时会返回记忆(否则"返回空"可能是假阳性)
    const baseline = (await search.execute({ query: `${CHAT_MARK} ${WORK_MARK}` }, rootExec('auto-root'))) as SearchResult;
    expect(baseline.items?.length).toBe(2);

    const res = (await search.execute({ query: `${CHAT_MARK} ${WORK_MARK}` }, childExec('child-of-off', 'parent-off'))) as SearchResult;
    expect(res.items ?? []).toHaveLength(0);
    expect(typeof res.notice).toBe('string');
    expect((res.notice ?? '').length).toBeGreaterThan(0);
    stores.db.close();
  });

  it('父会话只写(recall:false) → 子代理必须不返回任何记忆', async () => {
    const { stores, search } = await setupSearch();
    const res = (await search.execute({ query: `${CHAT_MARK} ${WORK_MARK}` }, childExec('child-of-wo', 'parent-wo'))) as SearchResult;
    expect(res.items ?? []).toHaveLength(0);
    expect((res.notice ?? '').length).toBeGreaterThan(0);
    stores.db.close();
  });

  it('父会话 work → 子代理不得返回 chat 族记录', async () => {
    const { stores, search } = await setupSearch();
    const res = (await search.execute({ query: `${CHAT_MARK} ${WORK_MARK}`, limit: 5 }, childExec('child-of-work', 'parent-work'))) as SearchResult;
    const items = res.items ?? [];
    expect(items.length).toBeGreaterThan(0); // 纯档是过滤而非禁用
    expect(items.some((i) => (i.content ?? '').includes(CHAT_MARK))).toBe(false);
    expect(items.every((i) => (i.content ?? '').includes(WORK_MARK))).toBe(true);
    stores.db.close();
  });

  it('父会话 chat → 子代理不得返回 work 族记录(对称)', async () => {
    const { stores, search } = await setupSearch();
    const res = (await search.execute({ query: `${CHAT_MARK} ${WORK_MARK}`, limit: 5 }, childExec('child-of-chat', 'parent-chat'))) as SearchResult;
    const items = res.items ?? [];
    expect(items.some((i) => (i.content ?? '').includes(WORK_MARK))).toBe(false);
    expect(items.every((i) => (i.content ?? '').includes(CHAT_MARK))).toBe(true);
    stores.db.close();
  });

  it('多级父链:孙代理上溯至首个有显式档位的祖先(off) → 不返回任何记忆', async () => {
    // 链:grandchild → midchild → parent-off
    // 只有两端其一在档位表里,midchild 是子代理故无条目 → 必须继续上溯
    const { stores, search } = await setupSearch({ agents: fakeAgents({ midchild: 'parent-off' }) });
    const res = (await search.execute(
      { query: `${CHAT_MARK} ${WORK_MARK}` },
      childExec('grandchild', 'midchild'),
    )) as SearchResult;
    expect(res.items ?? []).toHaveLength(0);
    stores.db.close();
  });

  it('回归护栏:顶层会话(无父)语义不变', async () => {
    const { stores, search } = await setupSearch();
    // auto 且未设置 → 不过滤族
    const auto = (await search.execute({ query: `${CHAT_MARK} ${WORK_MARK}`, limit: 5 }, rootExec('never-set'))) as SearchResult;
    expect(auto.items?.length).toBe(2);
    // 显式 off → 仍拒读(既有语义,不得被本次修复改变)
    const off = (await search.execute({ query: CHAT_MARK }, rootExec('root-off'))) as SearchResult;
    expect(off.items ?? []).toHaveLength(0);
    expect(off.notice).toContain('完全隐身');
    stores.db.close();
  });

  it('回归护栏:fail-open 语义不变(exec.agent 缺失 → 全族放行 + 不拒绝)', async () => {
    const { stores, search } = await setupSearch();
    const res = (await search.execute({ query: CHAT_MARK }, {})) as SearchResult;
    expect(res.items?.length).toBe(1);
    expect(res.notice).toBeUndefined();
    stores.db.close();
  });
});
