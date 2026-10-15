/**
 * 工具层单元测试:五工具注册、档位过滤(off/只写/纯档/auto/fail-open)、
 * limit 钳制、memoryMutate 门与 add/delete 语义。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { registerMemoryTools } from '../src/tools/index.js';
import { registerSkillTools } from '../src/tools/skills.js';
import { registerSlotTools } from '../src/tools/slots.js';
import { SlotStore } from '../src/store/slots.js';
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
const openDbs: MemoryDb[] = [];
async function tmp(): Promise<string> {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'dsh-tools-'));
  return dir;
}
afterAll(async () => {
  openDbs.forEach((db) => {
    try { db.close(); } catch { /* 已关 */ }
  });
  openDbs.length = 0;
  if (!dir) return;
  // Windows Defender 会短暂锁住刚写完的 memory.db,rm 重试 5 次兜底
  for (let i = 0; i < 5; i++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  await rm(dir, { recursive: true, force: true });
});

const noopLogger: MemoryLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** 技能工具注册只需注册面(execute 不被调用),故用最小桩。 */
const skillStub = {
  list: () => [],
  get: () => undefined,
  update: async () => false,
  archive: async () => false,
} as unknown as Parameters<typeof registerSkillTools>[1];

interface RegisteredTool {
  name: string;
  execute: (args: Record<string, unknown>, exec?: { agent?: { id?: string } }) => Promise<unknown>;
}

function harness(opts: { liveMutate?: boolean; sessionMode?: (sid: string) => string; captureEvents?: boolean; cfgSkillsEnabled?: boolean; liveSkillsEnabled?: boolean } = {}) {
  const events: Array<(paths: string[]) => void> = [];
  // 基线不含 conflictFreeze 键(留空 = 不覆盖,见 runner.ts 的 !== undefined 判定),故用断言;
  // 空数组按契约类型加宽(never[] 会让断言两侧失去重叠)
  const live = {
    enabled: true, capture: true, distill: true, recall: true,
    reasoningEffort: '', distillProvider: '', distillModel: '', distillChain: [] as MemoryLiveSettings['distillChain'],
    distillBudgets: { extract: 0, dedup: 0, l2: 0, l3: 0, graph: 0 }, distillMaxInputChars: 0,
    distillLayerChains: { l1: [], l2: [], l3: [] } as MemoryLiveSettings['distillLayerChains'],
    distillMode: '', directBaseURL: '', directApiKey: '',
    embedRemoteBaseURL: '', embedRemoteApiKey: '', embedRemoteModel: '', embedRemoteDimensions: 0,
    memoryMutate: opts.liveMutate ?? false,
    skillsEnabled: opts.liveSkillsEnabled === true,
    toolSkills: true,
  } as MemoryLiveSettings;
  const liveHandle: LiveSettingsHandle = { supported: true, get: () => live, update: async () => {} };
  const modes = new SessionModeStore('/nonexistent', 'auto');
  (modes as unknown as { entries: Map<string, unknown> }).entries.set(
    'work-sess', { mode: 'work', recall: undefined, updatedAt: Date.now() },
  );
  (modes as unknown as { entries: Map<string, unknown> }).entries.set(
    'off-sess', { mode: 'off', recall: undefined, updatedAt: Date.now() },
  );
  (modes as unknown as { entries: Map<string, unknown> }).entries.set(
    'wo-sess', { mode: 'chat', recall: false, updatedAt: Date.now() },
  );

  const registered: RegisteredTool[] = [];
  const ctx = {
    tools: {
      register: (t: ToolDefinition) => {
        registered.push(t as unknown as RegisteredTool);
        return () => {
          const i = registered.findIndex((x) => x.name === (t as unknown as RegisteredTool).name);
          if (i >= 0) registered.splice(i, 1);
        };
      },
    },
    ...(opts.captureEvents
      ? {
          on: (event: string, fn: (paths: string[]) => void) => {
            if (event === 'loader/volatile-update') events.push(fn);
            return () => {};
          },
        }
      : {}),
  } as unknown as Parameters<typeof registerMemoryTools>[0];

  const cfg = {
    tools: true,
    recall: { maxResults: 5 },
    skills: { enabled: opts.cfgSkillsEnabled === true },
  } as unknown as MemoryConfig;

  return { ctx, cfg, modes, liveHandle, registered, events };
}

describe('memory tools', () => {
  async function setupStores() {
    const dataDir = join(await tmp(), `tools-${Date.now()}`);
    const db = new MemoryDb(join(dataDir, 'memory.db'), 0);
    db.init();
    openDbs.push(db);
    const l1 = new L1Store(dataDir, db, undefined, 'hybrid', noopLogger, 0);
    const l0 = new L0Store(dataDir, db);
    await l1.init();
    await l0.init();
    const now = Date.now();
    await l1.appendNew([
      { id: 'r1', content: '用户喜欢手冲咖啡', type: 'preference', priority: 60, scene_name: '日常', timestamps: [now], createdAt: now, updatedAt: now },
      { id: 'r2', content: '团队用 GitLab CI', type: 'work_fact', priority: 50, scene_name: '基建', timestamps: [now], createdAt: now, updatedAt: now },
    ]);
    const scenes = {
      chat: new SceneStore(dataDir, 'chat'),
      work: new SceneStore(dataDir, 'work'),
    };
    await scenes.chat.init();
    await scenes.work.init();
    await scenes.chat.write('咖啡.md', '# 咖啡偏好');
    const persona = {
      chat: new PersonaStore(dataDir, 'chat'),
      work: new PersonaStore(dataDir, 'work'),
    };
    await persona.chat.init();
    await persona.work.init();
    await persona.chat.write('# 用户画像');
    return { db, l1, l0, scenes, persona };
  }

  it('registers the retrieval/mutation tools, the three ruminate tools, and memory_room_review', async () => {
    const stores = await setupStores();
    const h = harness();
    registerMemoryTools(h.ctx, h.cfg, stores, noopLogger, h.modes, h.liveHandle);
    // 这份清单是**有意**穷举的:新增工具必须在此显式登记,避免"悄悄多了一个模型可见
    // 的能力"(§B 的 memory_receipts 即在此处被拦下一次,确认后才加入)。
    //
    // §C 的 memory_conflicts 则是反过来的一次:`memory_resolve_conflict` 的描述里
    // 早就写着"待裁决对可用 memory_conflicts 查看",而那个工具**一直不存在** ——
    // 模型照着描述调用只会拿到"工具不存在"。本次补上读出口,故在此登记。
    expect(h.registered.map((t) => t.name).sort()).toEqual([
      'conversation_search', 'memory_add', 'memory_conflicts', 'memory_conflicts_rejected', 'memory_delete', 'memory_expand_graph_node', 'memory_import', 'memory_read_scene', 'memory_receipts', 'memory_resolve_conflict', 'memory_room_admin', 'memory_room_review', 'memory_ruminate', 'memory_ruminate_cancel', 'memory_ruminate_status', 'memory_search', 'memory_search_graph',
    ]);
    stores.db.close();
  });

  it('ruminate tools degrade to a notice when no controller is assembled', async () => {
    // 回归护栏:工具 schema 必须始终能被 defineTool 编译通过(DSH 的 value schema DSL
    // 只认一组作者键,历史上 nullable 曾让整个插件树加载失败)。
    const stores = await setupStores();
    const h = harness();
    registerMemoryTools(h.ctx, h.cfg, stores, noopLogger, h.modes, h.liveHandle);
    const status = h.registered.find((t) => t.name === 'memory_ruminate_status')!;
    const res = (await status.execute({})) as { notice: string; running: boolean };
    expect(res.notice).toContain('反刍未初始化');
    expect(res.running).toBe(false);
    stores.db.close();
  });

  it('memory_search: auto unfiltered, pure mode filters family, limit clamped 1-20', async () => {
    const stores = await setupStores();
    const h = harness();
    registerMemoryTools(h.ctx, h.cfg, stores, noopLogger, h.modes, h.liveHandle);
    const search = h.registered.find((t) => t.name === 'memory_search')!;
    const exec = (id?: string) => ({ agent: id === undefined ? undefined : { id } });

    const all = (await search.execute({ query: '咖啡 GitLab', limit: 50 }, exec('auto-sess'))) as { items: Array<{ id?: string; content: string }> };
    expect(all.items.length).toBe(2); // auto 不过滤族;limit 钳到 20 后全命中
    const workOnly = (await search.execute({ query: 'GitLab 咖啡', limit: 5 }, exec('work-sess'))) as { items: Array<{ content: string }> };
    expect(workOnly.items.length).toBe(1);
    expect(workOnly.items[0].content).toContain('GitLab');
    stores.db.close();
  });

  it('read gates: off / write-only / global recall off return distinct notices', async () => {
    const stores = await setupStores();
    const h = harness();
    registerMemoryTools(h.ctx, h.cfg, stores, noopLogger, h.modes, h.liveHandle);
    const search = h.registered.find((t) => t.name === 'memory_search')!;
    const off = (await search.execute({ query: 'x' }, { agent: { id: 'off-sess' } })) as { notice: string };
    expect(off.notice).toContain('完全隐身');
    const wo = (await search.execute({ query: 'x' }, { agent: { id: 'wo-sess' } })) as { notice: string };
    expect(wo.notice).toContain('只写模式');
    // fail-open:缺 agent 标识 → 全族放行
    const noAgent = (await search.execute({ query: '咖啡' }, {})) as { items: unknown[] };
    expect(noAgent.items.length).toBe(1);
    stores.db.close();
  });

  it('memory_read_scene resolves persona and cross-family scene files', async () => {
    const stores = await setupStores();
    const h = harness();
    registerMemoryTools(h.ctx, h.cfg, stores, noopLogger, h.modes, h.liveHandle);
    const read = h.registered.find((t) => t.name === 'memory_read_scene')!;
    const persona = (await read.execute({ path: 'persona-chat.md' }, { agent: { id: 'auto-sess' } })) as { content: string };
    expect(persona.content).toContain('用户画像');
    const scene = (await read.execute({ path: '咖啡.md' }, { agent: { id: 'work-sess' } })) as { content: string };
    expect(scene.content).toContain('咖啡偏好'); // work 会话查 chat 族场景(先本族后另一族)
    stores.db.close();
  });

  it('memory_add: gated by memoryMutate; defaults episodic/80/__manual__', async () => {
    const stores = await setupStores();
    const h = harness({ liveMutate: false });
    registerMemoryTools(h.ctx, h.cfg, stores, noopLogger, h.modes, h.liveHandle);
    const add = h.registered.find((t) => t.name === 'memory_add')!;
    const denied = (await add.execute({ content: '测试' }, {})) as { notice: string };
    expect(denied.notice).toContain('高权限');

    // 开门后写入
    const h2 = harness({ liveMutate: true });
    registerMemoryTools(h2.ctx, h2.cfg, stores, noopLogger, h2.modes, h2.liveHandle);
    const add2 = h2.registered.find((t) => t.name === 'memory_add')!;
    const ok = (await add2.execute({ content: '记得我明天要体检', type: 'work_task', hall: 'work' }, {})) as { id: string };
    expect(ok.id).toMatch(/^mem-/);
    const rec = stores.l1.getByIds([ok.id])[0];
    expect(rec.type).toBe('work_task');
    expect(rec.family).toBe('work');
    expect(rec.priority).toBe(80);
    expect(rec.scene_name).toBe('__manual__');
    expect(rec.metadata).toEqual({ hall: 'work', temporal: { st: '?', vf: null, vt: null } });
    // 非法 type 缺省 episodic
    const fallback = (await add2.execute({ content: '随便记一条' }, {})) as { id: string };
    expect(stores.l1.getByIds([fallback.id])[0].type).toBe('episodic');
    stores.db.close();
  });

  it('memory_add: 时间轴三轴独立落库(有效期/持续性不与记录时间混用)', async () => {
    const stores = await setupStores();
    const h = harness({ liveMutate: true });
    registerMemoryTools(h.ctx, h.cfg, stores, noopLogger, h.modes, h.liveHandle);
    const add = h.registered.find((t) => t.name === 'memory_add')!;
    const res = (await add.execute(
      {
        content: '用户目前在做 dsh-prime-memory 的记忆时间轴改造',
        type: 'work_task',
        persistence: 'o',
        valid_from: '2026-09-01T00:00:00+08:00',
        created_at: '2026-09-10T09:00:00+08:00',
        origin: '.workbuddy/memory/2026-09-01.md#L48',
        conflict: true,
      },
      {},
    )) as { id: string };
    const rec = stores.l1.getByIds([res.id])[0];
    // 有效期起 = vf;记录时间 = created_at;两者是不同的轴,不得相等地互相顶替
    expect(rec.validFrom).toBe(Date.parse('2026-09-01T00:00:00+08:00'));
    expect(rec.createdAt).toBe(Date.parse('2026-09-10T09:00:00+08:00'));
    expect(rec.validTo).toBeUndefined(); // o 仍在持续 → 未闭合
    expect(rec.persistence).toBe('o');
    expect(rec.metadata).toMatchObject({
      origin: '.workbuddy/memory/2026-09-01.md#L48',
      conflict: true,
      temporal: { st: 'o', vf: '2026-08-31T16:00:00.000Z', vt: null },
    });
    // 持续性缺省 = 未判定,不参与取代判定
    const plain = (await add.execute({ content: '没有时间信息的普通事实' }, {})) as { id: string };
    const plainRec = stores.l1.getByIds([plain.id])[0];
    expect(plainRec.persistence).toBeUndefined();
    expect(plainRec.validFrom).toBeUndefined();
    stores.db.close();
  });

  it('memory_import: 批量写入 + 批内重复拦截 + 上限拒绝 + 高权限门控', async () => {
    const stores = await setupStores();
    const deniedHarness = harness({ liveMutate: false });
    registerMemoryTools(deniedHarness.ctx, deniedHarness.cfg, stores, noopLogger, deniedHarness.modes, deniedHarness.liveHandle);
    const deniedTool = deniedHarness.registered.find((t) => t.name === 'memory_import')!;
    const denied = (await deniedTool.execute({ records: [{ content: '外部记忆' }] }, {})) as { written: number; notice: string };
    expect(denied.written).toBe(0);
    expect(denied.notice).toContain('高权限');

    const h = harness({ liveMutate: true });
    registerMemoryTools(h.ctx, h.cfg, stores, noopLogger, h.modes, h.liveHandle);
    const imp = h.registered.find((t) => t.name === 'memory_import')!;
    const res = (await imp.execute(
      {
        scene: '外部导入/trae',
        records: [
          {
            content: 'pnpm 首次交互确认可用 `pnpm --yes` 规避',
            type: 'instruction',
            persistence: 't',
            origin: '~/.trae/memories/rules.md#L2',
          },
          { content: 'pnpm 首次交互确认可用 `pnpm --yes` 规避', type: 'instruction' }, // 批内重复
          { content: '   ' }, // 空内容
          {
            content: 'dsh-perm-gate 的 lib/ 已被 .gitignore 忽略',
            type: 'work_artifact',
            persistence: 'o',
            valid_from: '2026-09-01',
            hall: 'work',
          },
        ],
      },
      {},
    )) as { written: number; ids: string[]; skipped: Array<{ index: number; reason: string }> };
    expect(res.written).toBe(2);
    expect(res.skipped.map((s) => s.index)).toEqual([1, 2]);
    const recs = stores.l1.getByIds(res.ids);
    expect(recs.every((r) => r.scene_name === '外部导入/trae')).toBe(true);
    const artifact = recs.find((r) => r.type === 'work_artifact')!;
    expect(artifact.persistence).toBe('o');
    expect(artifact.validFrom).toBe(Date.parse('2026-09-01'));

    // 上限拒绝:超过 MAX_IMPORT 不写入
    const over = (await imp.execute(
      { records: Array.from({ length: 201 }, (_, i) => ({ content: `批量记忆 ${i}` })) },
      {},
    )) as { written: number; notice: string };
    expect(over.written).toBe(0);
    expect(over.notice).toContain('上限');
    stores.db.close();
  });

  it('memory_delete: gated, semantic search then **soft-delete**(可恢复)', async () => {
    const stores = await setupStores();
    const h2 = harness({ liveMutate: true });
    registerMemoryTools(h2.ctx, h2.cfg, stores, noopLogger, h2.modes, h2.liveHandle);
    const del = h2.registered.find((t) => t.name === 'memory_delete')!;
    const noMatch = (await del.execute({ query: '完全不存在的量子记忆' }, { agent: { id: 'auto-sess' } })) as { deleted: number; notice?: string };
    expect(noMatch.deleted).toBe(0);
    const ok = (await del.execute({ query: '手冲咖啡', limit: 1 }, { agent: { id: 'auto-sess' } })) as { deleted: number; ids: string[] };
    expect(ok.deleted).toBe(1);
    // **软删**:主表仍在(可恢复的载体),但已退出检索面
    const [retired] = stores.l1.getByIds(ok.ids);
    expect(retired, '退场不该让记录消失').toBeDefined();
    expect(retired.validTo).toBeDefined();
    expect(stores.db.searchL1Fts('手冲咖啡', 5).map((h) => h.id)).not.toContain(ok.ids[0]);
    expect(stores.l1.listRetired({ limit: 10, offset: 0 }).items.map((r) => r.id)).toEqual(ok.ids);
    // 恢复闭环:回到检索面
    expect((await stores.l1.restore(ok.ids)).restored).toBe(1);
    expect(stores.l1.getByIds(ok.ids)[0]?.validTo).toBeUndefined();
    // 关门拒绝
    const h1 = harness({ liveMutate: false });
    registerMemoryTools(h1.ctx, h1.cfg, stores, noopLogger, h1.modes, h1.liveHandle);
    const del1 = h1.registered.find((t) => t.name === 'memory_delete')!;
    const denied = (await del1.execute({ query: '咖啡' }, {})) as { notice: string };
    expect(denied.notice).toContain('高权限');
    stores.db.close();
  });

  it('memory_delete: 默认只退场 1 条(复刻真实误删事故)', async () => {
    // 事故原样:调用方只想忘掉 1 条,默认 limit=3 却按语义邻近连带退场了 3 条
    // (memory.log 实测「高权限删除记忆 3 条(...)」其中 2 条与本意无关)。
    const stores = await setupStores();
    const h = harness({ liveMutate: true });
    registerMemoryTools(h.ctx, h.cfg, stores, noopLogger, h.modes, h.liveHandle);
    const del = h.registered.find((t) => t.name === 'memory_delete')!;
    const r = (await del.execute({ query: '手冲咖啡' }, { agent: { id: 'auto-sess' } })) as { deleted: number; ids: string[] };
    expect(r.deleted).toBe(1); // 默认 limit=1,不再是 3
    expect(r.ids).toHaveLength(1);
    expect(stores.l1.listRetired({ limit: 10, offset: 0 }).total).toBe(1);
    // 另一条记忆完全没被牵连
    expect(stores.l1.getByIds(['r2'])[0]?.validTo).toBeUndefined();
    stores.db.close();
  });

  it('memory_delete: ids 精确路径**跳过**语义匹配', async () => {
    const stores = await setupStores();
    const h = harness({ liveMutate: true });
    registerMemoryTools(h.ctx, h.cfg, stores, noopLogger, h.modes, h.liveHandle);
    const del = h.registered.find((t) => t.name === 'memory_delete')!;
    // query 故意与目标无关:精确路径不得受它影响
    const r = (await del.execute({ ids: ['r2'], query: '手冲咖啡' }, { agent: { id: 'auto-sess' } })) as { deleted: number; ids: string[] };
    expect(r.ids).toEqual(['r2']);
    expect(r.deleted).toBe(1);
    expect(stores.l1.getByIds(['r2'])[0]?.validTo).toBeDefined();
    // 与 query 匹配的 r1 未被牵连(语义匹配根本没跑)
    expect(stores.l1.getByIds(['r1'])[0]?.validTo).toBeUndefined();
    stores.db.close();
  });

  it('graph tools: 拒读门 + 族过滤 + expand 悬挂/跨族 id 不解析', async () => {
    const stores = await setupStores();
    const h = harness();
    registerMemoryTools(h.ctx, h.cfg, { ...stores, graph: stores.db.graphStore }, noopLogger, h.modes, h.liveHandle);
    // 投影一条 chat 族节点(来源 r1 = 用户喜欢手冲咖啡)
    stores.db.graphStore.queueGraphProjection(['r1'], 10000);
    const claim = stores.db.graphStore.claimNext()!;
    stores.db.graphStore.complete(claim.job.id, {
      reason: '',
      nodes: [{ ref: 'a', name: '手冲咖啡', type: 'tool', sourceRecordIds: ['r1'], state: '用户的日常咖啡方式' }],
      edges: [],
    });
    const search = h.registered.find((t) => t.name === 'memory_search_graph')!;
    // auto 档:命中并返回紧凑卡(含 id 与匹配说明)
    const auto = (await search.execute({ query: '手冲咖啡' }, { agent: { id: 'auto-sess' } })) as {
      items: Array<{ id: string; name: string; match_reason: string }>;
    };
    expect(auto.items).toHaveLength(1);
    expect(auto.items[0]!.name).toBe('手冲咖啡');
    expect(auto.items[0]!.match_reason).toContain('命中');
    // 纯档 work 会话:节点族为 chat → 族过滤不可见
    const work = (await search.execute({ query: '手冲咖啡' }, { agent: { id: 'work-sess' } })) as { items: unknown[] };
    expect(work.items).toHaveLength(0);
    // off 档:拒读门
    const off = (await search.execute({ query: 'x' }, { agent: { id: 'off-sess' } })) as { notice: string };
    expect(off.notice).toContain('完全隐身');

    const expand = h.registered.find((t) => t.name === 'memory_expand_graph_node')!;
    // auto 会话展开:属性(含历史标注)与来源记忆 id
    const detail = (await expand.execute({ id: auto.items[0]!.id }, { agent: { id: 'auto-sess' } })) as { node: string };
    expect(detail.node).toContain('手冲咖啡');
    expect(detail.node).toContain('用户的日常咖啡方式');
    expect(detail.node).toContain('来源记忆: r1');
    // 悬挂 id / 跨族 id 一律不解析
    const missing = (await expand.execute({ id: 'no-such-node' }, { agent: { id: 'auto-sess' } })) as { notice: string };
    expect(missing.notice).toContain('不存在');
    const crossFamily = (await expand.execute({ id: auto.items[0]!.id }, { agent: { id: 'work-sess' } })) as { notice: string };
    expect(crossFamily.notice).toContain('不存在');
    stores.db.close();
  });
  // ── 工具分组封印 + mem_ 引用校验(v0.21.0)──
  it('封印组:volatile-update 后该组工具反注册,解封后重注册', async () => {
    const stores = await setupStores();
    const h = harness({ captureEvents: true });
    registerMemoryTools(h.ctx, h.cfg, stores, noopLogger, h.modes, h.liveHandle);
    const names = () => h.registered.map((t) => t.name);
    expect(names()).toContain('memory_room_admin');
    expect(names()).toContain('memory_search');

    (h.liveHandle.get() as { toolRoom?: boolean }).toolRoom = false;
    h.events.forEach((fn) => fn(['toolRoom']));
    expect(names()).not.toContain('memory_room_admin');
    expect(names()).toContain('memory_search'); // 核心读不受控

    (h.liveHandle.get() as { toolRoom?: boolean }).toolRoom = true;
    h.events.forEach((fn) => fn(['toolRoom']));
    expect(names()).toContain('memory_room_admin');
  });

  // ── 技能组并轨封印:功能开关与 toolSkills 都随 volatile 热更 ──
  it('技能组:功能关时零表面积,volatile 开启后注册', async () => {
    const stores = await setupStores();
    const h = harness({ captureEvents: true, cfgSkillsEnabled: false, liveSkillsEnabled: false });
    const seals = registerMemoryTools(h.ctx, h.cfg, stores, noopLogger, h.modes, h.liveHandle);
    registerSkillTools(h.ctx, skillStub, noopLogger, h.liveHandle, seals);
    const names = () => h.registered.map((t) => t.name);
    // 功能关(部署 cfg 与 live 皆关)⇒ 零表面积
    expect(names()).not.toContain('memory_skill_list');
    // live 开启 → volatile 热更 → 四件注册
    (h.liveHandle.get() as { skillsEnabled?: boolean }).skillsEnabled = true;
    h.events.forEach((fn) => fn(['skillsEnabled']));
    expect(names()).toContain('memory_skill_list');
    expect(names()).toContain('memory_skill_read');
    expect(names()).toContain('memory_skill_pin');
    expect(names()).toContain('memory_skill_archive');
  });

  it('技能组:toolSkills 封印反注册、解封重注册(volatile 热更)', async () => {
    const stores = await setupStores();
    const h = harness({ captureEvents: true, cfgSkillsEnabled: true });
    const seals = registerMemoryTools(h.ctx, h.cfg, stores, noopLogger, h.modes, h.liveHandle);
    registerSkillTools(h.ctx, skillStub, noopLogger, h.liveHandle, seals);
    const names = () => h.registered.map((t) => t.name);
    // 功能开 + toolSkills 未封 → 注册
    expect(names()).toContain('memory_skill_list');
    // 封印 → 反注册(核心读不受影响)
    (h.liveHandle.get() as { toolSkills?: boolean }).toolSkills = false;
    h.events.forEach((fn) => fn(['toolSkills']));
    expect(names()).not.toContain('memory_skill_list');
    expect(names()).toContain('memory_search');
    // 解封 → 重注册
    (h.liveHandle.get() as { toolSkills?: boolean }).toolSkills = true;
    h.events.forEach((fn) => fn(['toolSkills']));
    expect(names()).toContain('memory_skill_list');
  });

  it('slot 写入:mem_ 引用必须真实存在,幻觉 id 被拒且不落库', async () => {
    const stores = await setupStores();
    await stores.l1.appendNew([
      { id: 'mem_real1', content: '真实记忆', type: 'work_fact', priority: 50, scene_name: '基建', timestamps: [Date.now()], createdAt: Date.now(), updatedAt: Date.now() },
    ]);
    const h = harness({ liveMutate: true });
    const slots = new SlotStore(join(await tmp(), `slots-v21-${Date.now()}.json`), noopLogger);
    await slots.load();
    registerMemoryTools(h.ctx, h.cfg, stores, noopLogger, h.modes, h.liveHandle);
    registerSlotTools(h.ctx, h.cfg, slots, noopLogger, h.modes, h.liveHandle, stores.l1);
    const write = h.registered.find((t) => t.name === 'memory_slot_write');
    expect(write).toBeDefined();

    const bad = (await write!.execute({ title: '坏引用', kind: 'rule', pinned: true, refs: 'mem_ghost,notes/a.md' })) as { notice?: string };
    expect(bad.notice).toContain('写入被拒');
    expect(bad.notice).toContain('mem_ghost');
    expect(slots.list()).toHaveLength(0);

    const good = (await write!.execute({ title: '好引用', kind: 'rule', pinned: true, refs: 'mem_real1,notes/a.md' })) as { id?: string };
    expect(good.id).toMatch(/^slot_/);
    expect(slots.list()).toHaveLength(1);
    // 释放 sqlite 句柄,否则 Windows 下 afterAll 的 rm 会 EBUSY
    stores.db.close();
  });
});
