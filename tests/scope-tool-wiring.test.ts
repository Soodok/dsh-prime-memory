/**
 * §E 存储作用域 / task_28:**接线**测试——`memory_search` 到底有没有真把工作区传下去。
 *
 * 为什么单独一个文件:`scope-isolation.test.ts` 证明的是「**能**隔离」（存储层有这能力），
 * 而本文件证明「**会**隔离」（工具路径真的用了它）。这两件事在历史上被混为一谈过
 * （§14.6 第四形态：「能查」≠「会查」），而这里更险——`workspaceId` 是**可选参数**，
 * 忘传**不会报错**，只会静默地不过滤。
 *
 * 三条断言，其中第三条是区分力所在:
 * ① `cfg.scope='workspace'` + 会话 cwd=A → 看得到 A 的、看不到 B 的；
 * ② 同配置但 cwd 缺失 → **不过滤**（fail-open：宁可退化成全局可见，也不让记忆凭空消失）；
 * ③ **对照**：`cfg.scope` 非 `workspace`（含缺省）→ 同一 exec 下**看到全部**。
 *    少了 ③，"接线正确"与"过滤恒开"无法区分——而恒开会打破既有部署的零漂移。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MemoryConfig } from '../src/config.js';
import type { LiveSettingsHandle } from '../src/settings.js';
import { L0Store } from '../src/store/l0.js';
import { L1Store } from '../src/store/l1.js';
import { PersonaStore } from '../src/store/persona.js';
import { SceneStore } from '../src/store/scenes.js';
import { SessionModeStore } from '../src/store/session-modes.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { registerMemoryTools } from '../src/tools/index.js';

const noopLogger = { debug() {}, info() {}, warn() {}, error() {} };
const WS_A = 'E:\\proj\\a';
const WS_B = 'E:\\proj\\b';

let dataDir: string;
let db: MemoryDb;

interface Reg {
  name: string;
  execute: (args: Record<string, unknown>, exec: unknown) => Promise<unknown>;
}

/** 与 tests/tools.test.ts 同款最小 harness（这里只需要 tools.register 与 cfg）。 */
function harness(scope: 'global' | 'workspace' | undefined): { cfg: MemoryConfig; registered: Reg[] } {
  const registered: Reg[] = [];
  const cfg = {
    tools: true,
    recall: { maxResults: 5 },
    ...(scope === undefined ? {} : { scope }),
  } as unknown as MemoryConfig;
  return { cfg, registered };
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dsh-scope-tool-'));
  db = new MemoryDb(join(dataDir, 'memory.db'), 0);
  db.init();
  const now = Date.now();
  db.upsertL1Batch([
    { id: 't-a', content: 'alpha shared fact', type: 'work_fact', priority: 60, scene_name: 's', timestamps: [now], createdAt: now, updatedAt: now, version: 0, family: 'work', scope: 'workspace', workspaceId: WS_A },
    { id: 't-b', content: 'alpha shared fact', type: 'work_fact', priority: 60, scene_name: 's', timestamps: [now], createdAt: now, updatedAt: now, version: 0, family: 'work', scope: 'workspace', workspaceId: WS_B },
    { id: 't-g', content: 'alpha shared fact', type: 'work_fact', priority: 60, scene_name: 's', timestamps: [now], createdAt: now, updatedAt: now, version: 0, family: 'work', scope: 'global', workspaceId: '' },
  ]);
});

afterAll(async () => {
  db?.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

async function buildStores(): Promise<Parameters<typeof registerMemoryTools>[2]> {
  const l1 = new L1Store(dataDir, db, undefined, 'keyword', noopLogger, 0);
  const l0 = new L0Store(db);
  await l1.init();
  const scenes = { chat: new SceneStore(dataDir, 'chat'), work: new SceneStore(dataDir, 'work') };
  await scenes.chat.init();
  await scenes.work.init();
  const persona = { chat: new PersonaStore(dataDir, 'chat'), work: new PersonaStore(dataDir, 'work') };
  await persona.chat.init();
  await persona.work.init();
  return { db, l1, l0, scenes, persona } as unknown as Parameters<typeof registerMemoryTools>[2];
}

function makeModes(): SessionModeStore {
  return new SessionModeStore('/nonexistent', 'auto');
}

async function setupAll(scope: 'global' | 'workspace' | undefined, mutate = false): Promise<Reg[]> {
  const h = harness(scope);
  const stores = await buildStores();
  registerMemoryTools(
    { tools: { register: (t: Reg) => h.registered.push(t) } } as unknown as Parameters<typeof registerMemoryTools>[0],
    h.cfg,
    stores,
    noopLogger as never,
    makeModes(),
    // `recall: true` 必须显式给：`resolvedRecall(owner, live.get().recall)` 在
    // 缺字段时按 falsy 处理 → 工具返回 GLOBAL_OFF_NOTICE，测试会以"0 条"假绿/假红
    { supported: true, get: () => ({ memoryMutate: mutate, recall: true }), update: async () => {} } as unknown as LiveSettingsHandle,
  );
  return h.registered;
}

async function setup(scope: 'global' | 'workspace' | undefined): Promise<Reg> {
  return (await setupAll(scope)).find((t) => t.name === 'memory_search')!;
}

/** 带会话 cwd 的 exec —— 形态与 `workspaceIdOf` 读取的路径一致。 */
const execAt = (cwd: string) => ({ agent: { id: 'sess', session: { header: { cwd } } } });

async function idsFrom(tool: Reg, exec: unknown): Promise<string[]> {
  const res = (await tool.execute({ query: 'alpha', limit: 20 }, exec)) as { items: Array<{ content: string }> };
  // memory_search 的 items 不回 id（对外形状），故按 content 计数 + 用总数区分
  return res.items.map((i) => i.content);
}

describe('task_28 §E 工具接线：memory_search 真的把工作区传下去了吗', () => {
  it('① scope=workspace + cwd=A → 看不到 B 的记录，但看得到 global 的', async () => {
    const tool = await setup('workspace');
    const hits = await idsFrom(tool, execAt(WS_A));
    // 记录内容刻意同名，只能按**条数**区分：A 的 1 条 + global 的 1 条 = 2
    expect(hits.length).toBe(2);
  });

  it('② 同配置但 cwd 缺失 → 不过滤（fail-open：宁可全局可见，也不让记忆凭空消失）', async () => {
    const tool = await setup('workspace');
    const hits = await idsFrom(tool, { agent: { id: 'sess' } });
    expect(hits.length).toBe(3);
  });

  it('③ 对照：scope 缺省（既有部署）→ 同一 exec 下看到全部 3 条（零漂移）', async () => {
    const tool = await setup(undefined);
    const hits = await idsFrom(tool, execAt(WS_A));
    expect(hits.length).toBe(3);
  });

  it('③ 对照：scope=global 显式声明 → 同样看到全部（证明过滤确实由 cfg.scope 决定）', async () => {
    const tool = await setup('global');
    const hits = await idsFrom(tool, execAt(WS_A));
    expect(hits.length).toBe(3);
  });

  it('① 区分力自证：①的 2 条 < ③的 3 条 —— 过滤确实发生了，不是"工具压根没返回"', async () => {
    const isolated = (await idsFrom(await setup('workspace'), execAt(WS_A))).length;
    const unfiltered = (await idsFrom(await setup(undefined), execAt(WS_A))).length;
    expect(isolated).toBeLessThan(unfiltered);
    expect(isolated).toBeGreaterThan(0); // 排除"返回空也算隔离"的假绿
  });
});

describe('task_28 §E 写入路径不止一条：memory_add 也必须标归属', () => {
  it('scope=workspace 下 memory_add 写入的 work 记忆只在当前工作区可见', async () => {
    const tools = await setupAll('workspace', true);
    const add = tools.find((t) => t.name === 'memory_add')!;
    const search = tools.find((t) => t.name === 'memory_search')!;
    await add.execute({ content: 'gamma project note', type: 'work_fact' }, execAt(WS_A));

    const hits = async (exec: unknown): Promise<number> => {
      const res = (await search.execute({ query: 'gamma', limit: 20 }, exec)) as { items: unknown[] };
      return res.items.length;
    };
    expect(await hits(execAt(WS_A))).toBe(1);
    // ← 区分力：memory_add 若漏标归属，记录会回落 'global'，别的"工作区"也能查到它
    expect(await hits(execAt(WS_B))).toBe(0);
  });

  it('scope=workspace 下 memory_add 写入的 **chat** 记忆仍全局可见（默认值不是推导规则）', async () => {
    const tools = await setupAll('workspace', true);
    const add = tools.find((t) => t.name === 'memory_add')!;
    const search = tools.find((t) => t.name === 'memory_search')!;
    await add.execute({ content: 'delta personal note', type: 'episodic' }, execAt(WS_A));

    const hits = async (exec: unknown): Promise<number> => {
      const res = (await search.execute({ query: 'delta', limit: 20 }, exec)) as { items: unknown[] };
      return res.items.length;
    };
    expect(await hits(execAt(WS_A))).toBe(1);
    expect(await hits(execAt(WS_B))).toBe(1);
  });
});
