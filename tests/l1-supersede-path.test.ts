/**
 * 取代路径(去重 `update`/`merge`)的**软删**集成测试(task_9/10)。
 *
 * 为什么单独一个文件:`tests/l1-receipts-write.test.ts` 的打桩决策不带 `target_ids`,
 * 覆盖不到取代分支;而取代是**三条退场路径里最容易出错的一条**——它发生在
 * 每轮蒸馏里,不像裁决要人去点、也不像人工删除要显式指令。
 *
 * 钉死的性质:
 * ① 被取代的旧记录**不物理消失**(主表保留),带 `valid_to` 与 `by=<新记录 id>` 标记;
 * ② 它**退出检索面**(FTS 查不到)且进入"已退场"列表(可恢复);
 * ③ 取代者(新记录)正常存活。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const OLD_ID = 'mem_old_zeta_1';
let decisionAction = 'update';
let decisionTargets: string[] = [OLD_ID];

vi.mock('../src/llm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/llm.js')>();
  return {
    ...actual,
    callLLM: vi.fn(async (_ctx: unknown, _cfg: unknown, opts: { layer?: string; user?: string }) => {
      if (opts?.layer !== 'l1-dedup') {
        // 抽取:一条与旧记录同义的记忆,交给去重判 update
        return JSON.stringify([
          {
            scene_name: '取代测试场景',
            message_ids: ['m1'],
            memories: [
              {
                record_id: '占位(被丢弃)',
                content: '项目 Zeta 负责人改由乙担任',
                type: 'work_fact',
                priority: 70,
                source_message_ids: ['m1'],
                metadata: { hall: 'work' },
              },
            ],
          },
        ]);
      }
      // 去重:record_id 必须从提示词里读回真实值(pipeline 生成的),不能自己编
      const ids = [...String(opts.user ?? '').matchAll(/record_id: (\S+?)\)/g)].map((m) => m[1]);
      return JSON.stringify(
        ids.map((id) => ({ record_id: id, action: decisionAction, target_ids: decisionTargets })),
      );
    }),
  };
});

const { runExtraction } = await import('../src/pipeline/l1.js');
const { L1Store } = await import('../src/store/l1.js');
const { MemoryDb } = await import('../src/store/sqlite.js');
const { readSupersedeMarker } = await import('../src/store/supersede.js');
type MemoryConfig = import('../src/config.js').MemoryConfig;
type FamilyStates = import('../src/pipeline/l1.js').FamilyStates;
type ConversationMessage = import('../src/types.js').ConversationMessage;

let root: string;
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} } as never;

function cfg(): MemoryConfig {
  return {
    dataDir: '', family: 'auto',
    capture: { enabled: true, stripCodeBlocks: true, maxMessageChars: 4000 },
    extract: { enabled: true, minMessages: 1, idleSeconds: 300, backgroundMessages: 10, candidatePool: 5 },
    l2: { enabled: true, minNewMemories: 5, maxScenes: 12, sceneContextLimit: 3 },
    l3: { enabled: true, interval: 20 },
    recall: { enabled: true, maxResults: 5, maxCharsPerMemory: 500, maxTotalRecallChars: 2000, timeoutMs: 5000, includePersona: true, includeSceneNav: true, strategy: 'keyword', scoreThreshold: 0, decayHalfLifeDays: 0 },
    embedding: { enabled: false, baseUrl: '', apiKey: '', model: '', dimensions: 0, maxInputChars: 5000, timeoutMs: 10000, allowLocalModels: true, mirror: '', proxy: '' },
    llm: { provider: '', model: '', mode: 'host', baseURL: '', apiKey: '', maxTokens: 65536, reasoningEffort: 'medium', maxInputChars: 700000, timeoutMs: 120000 },
    hall: { enabled: ['work'] },
    tokenCost: { retentionDays: 365 },
    tools: true,
    benchControl: false,
    conflictFreeze: { enabled: false },
  } as MemoryConfig;
}

function states(): FamilyStates {
  const s = () => ({ lastScene: '', chain: [], lastAt: 0, lastRunAt: 0, warmupThreshold: 0, distilledCount: 0 });
  return { chat: s(), work: s() } as unknown as FamilyStates;
}

const messages = (): ConversationMessage[] => [
  { id: 'm1', role: 'user', content: '项目 Zeta 现在由乙负责', timestamp: 1_700_000_000_000 },
  { id: 'm2', role: 'assistant', content: '收到', timestamp: 1_700_000_001_000 },
];

async function setup() {
  const dir = await mkdtemp(join(root, 'supersede-'));
  const db = new MemoryDb(join(dir, 'm.db'), 0);
  db.init();
  const store = new L1Store(dir, db, undefined, 'keyword', noopLogger, 0);
  await store.init();
  const t = Date.now();
  await store.appendNew([
    {
      id: OLD_ID,
      content: '项目 Zeta 负责人是甲',
      type: 'work_fact',
      priority: 70,
      scene_name: '旧场景',
      timestamps: [t],
      createdAt: t,
      updatedAt: t,
      family: 'work',
      metadata: { hall: 'work' },
    },
  ]);
  return { db, store };
}

describe('取代路径(update/merge)改软删', () => {
  it('update:旧记录退场但保留主表,带 by 标记,且退出检索面', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-supersede-'));
    decisionAction = 'update';
    decisionTargets = [OLD_ID];
    const { db, store } = await setup();
    try {
      // 前置:旧记录原本可检索
      expect(db.searchL1Fts('项目 Zeta 负责人', 5).map((h) => h.id)).toContain(OLD_ID);

      const out = await runExtraction({} as never, cfg(), store, states(), messages(), [], noopLogger, 'auto');
      expect(out.stored).toBe(1);
      const newId = out.newRecords[0]?.id;
      expect(newId).toBeTruthy();
      expect(newId).not.toBe(OLD_ID);

      // ① 旧记录**没被物理删除**(门1 解耦:退场凭 marker，valid_to 不再被闭合)
      const [old] = store.getByIds([OLD_ID]);
      expect(old, '取代不该让旧记录消失(否则无从恢复)').toBeDefined();
      expect(old.validTo).toBeUndefined();
      expect(readSupersedeMarker(old.metadata)).toMatchObject({ reason: 'superseded', by: newId });
      expect(old.content).toBe('项目 Zeta 负责人是甲'); // 内容不被改写

      // ② 退出检索面 + 进"已退场"列表
      expect(db.searchL1Fts('项目 Zeta 负责人', 5).map((h) => h.id)).not.toContain(OLD_ID);
      expect(store.listRetired({ limit: 10, offset: 0 }).items.map((r) => r.id)).toContain(OLD_ID);

      // ③ 取代者存活且可检索
      expect(store.getByIds([newId as string])).toHaveLength(1);
      expect(db.searchL1Fts('Zeta 负责人改由乙', 5).map((h) => h.id)).toContain(newId);
    } finally {
      db.close();
    }
  });

  it('merge 走同一条软删路径', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-supersede-merge-'));
    decisionAction = 'merge';
    decisionTargets = [OLD_ID];
    const { db, store } = await setup();
    try {
      const out = await runExtraction({} as never, cfg(), store, states(), messages(), [], noopLogger, 'auto');
      expect(out.stored).toBe(1);
      const [old] = store.getByIds([OLD_ID]);
      // 门1 解耦:merge 产物同走 marker 单源软删，不闭 valid_to。
      expect(old?.validTo).toBeUndefined();
      expect(readSupersedeMarker(old?.metadata)?.reason).toBe('superseded');
      expect(store.listRetired({ limit: 10, offset: 0 }).total).toBe(1);
    } finally {
      db.close();
    }
  });

  it('target_ids 指向不存在的记录时不留垃圾退场(byId 过滤生效)', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-supersede-ghost-'));
    decisionAction = 'update';
    decisionTargets = ['mem_ghost_not_exist'];
    const { db, store } = await setup();
    try {
      const out = await runExtraction({} as never, cfg(), store, states(), messages(), [], noopLogger, 'auto');
      expect(out.stored).toBe(1);
      // 旧记录没被点名,不受影响
      expect(store.getByIds([OLD_ID])[0]?.validTo).toBeUndefined();
      expect(store.listRetired({ limit: 10, offset: 0 }).total).toBe(0);
    } finally {
      db.close();
    }
  });
});

beforeEach(() => {
  decisionAction = 'update';
  decisionTargets = [OLD_ID];
});
