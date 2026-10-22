/**
 * 图谱确定性写面单测(graph-write-plane:R1/R2/R3/R4 的工具面验收)。
 *
 * 覆盖计划 tasks 的 task_1.5 / 2.5 / 3.3 / 3.4 / 4.4 / 4.5。
 * graphWrite 钩子在此直连 GraphStore 的入队/重投(runner 侧只是这两行的薄封装
 * + 泵 kick,泵行为由既有 graph-pipeline 测试覆盖,不在这里重复起 runner)。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { registerMemoryTools } from '../src/tools/index.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { L1Store } from '../src/store/l1.js';
import { SceneStore } from '../src/store/scenes.js';
import { PersonaStore } from '../src/store/persona.js';
import { SessionModeStore } from '../src/store/session-modes.js';
import { isRetired, readSupersedeMarker } from '../src/store/supersede.js';
import { GRAPH_PRIORITY_NEW } from '../src/graph/types.js';
import { writeNodeVectorsAfterComplete, nodeEmbedText } from '../src/pipeline/graph.js';
import type { GraphProjectionResult } from '../src/graph/types.js';
import type { LiveSettingsHandle } from '../src/settings.js';
import type { MemoryLiveSettings } from '../src/contract.js';
import type { MemoryConfig } from '../src/config.js';
import type { MemoryLogger, MemoryRecord } from '../src/types.js';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';

const noopLogger: MemoryLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** vec0 可用性探针:与 MemoryDb.ensureVecLoaded/生产加载路径逐字对齐(照抄 graph-node-vec 的教训)。 */
function probeVec0(): boolean {
  const req = createRequire(import.meta.url);
  const db = new DatabaseSync(':memory:', { allowExtension: true });
  try {
    const sqliteVec = req('sqlite-vec') as { load(d: unknown): void };
    db.enableLoadExtension(true);
    sqliteVec.load(db);
    db.exec('CREATE VIRTUAL TABLE probe USING vec0(v float[2])');
    return true;
  } catch {
    return false;
  } finally {
    try { db.enableLoadExtension(false); } catch { /* ignore */ }
    db.close();
  }
}
const VEC0_OK = probeVec0();
const DIM = 4;
function vecFor(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (let i = 0; i < text.length; i++) v[text.charCodeAt(i) % DIM] += 1;
  const mag = Math.sqrt(v.reduce((s, x) => s + (x as number) * (x as number), 0));
  if (mag < 1e-10) return v;
  for (let i = 0; i < DIM; i++) v[i] /= mag;
  return v;
}

let root: string;
const openDbs: MemoryDb[] = [];
afterAll(async () => {
  for (const db of openDbs) { try { db.close(); } catch { /* 已关 */ } }
  if (root) await rm(root, { recursive: true, force: true });
});

function rec(id: string, content: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  const t = Date.now();
  return {
    id, content, type: 'work_fact', priority: 60, scene_name: 's',
    timestamps: [t], createdAt: t, updatedAt: t, version: 0, metadata: {}, family: 'work',
    ...overrides,
  };
}

async function setupStores(seed: MemoryRecord[]) {
  if (!root) root = await mkdtemp(join(tmpdir(), 'dsh-wplane-'));
  const dataDir = join(root, `wp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const db = new MemoryDb(join(dataDir, 'memory.db'), 0);
  db.init();
  openDbs.push(db);
  const l1 = new L1Store(dataDir, db, undefined, 'hybrid', noopLogger, 0);
  await l1.init();
  await l1.appendNew(seed);
  const scenes = { chat: new SceneStore(dataDir, 'chat'), work: new SceneStore(dataDir, 'work') };
  const persona = { chat: new PersonaStore(dataDir, 'chat'), work: new PersonaStore(dataDir, 'work') };
  return { db, l1, scenes, persona };
}

interface RegisteredTool {
  name: string;
  execute: (args: Record<string, unknown>, exec?: { agent?: { id?: string } }) => Promise<unknown>;
}

function harness(liveMutate: boolean) {
  const live = {
    enabled: true, capture: true, distill: true, recall: true,
    memoryMutate: liveMutate, toolSkills: true,
  } as unknown as MemoryLiveSettings;
  const liveHandle: LiveSettingsHandle = { supported: true, get: () => live, update: async () => {} };
  const modes = new SessionModeStore('/nonexistent', 'auto');
  const registered: RegisteredTool[] = [];
  const ctx = {
    tools: {
      register: (t: ToolDefinition) => {
        registered.push(t as unknown as RegisteredTool);
        return () => {};
      },
    },
  } as unknown as Parameters<typeof registerMemoryTools>[0];
  const cfg = {
    tools: true,
    recall: { maxResults: 5 },
    graph: { enabled: true },
  } as unknown as MemoryConfig;
  return { ctx, cfg, modes, liveHandle, registered };
}

function registerWithWritePlane(h: ReturnType<typeof harness>, stores: Awaited<ReturnType<typeof setupStores>>) {
  const enqueued: string[][] = [];
  h.registered.length = 0;
  registerMemoryTools(
    h.ctx, h.cfg,
    { l1: stores.l1, scenes: stores.scenes, persona: stores.persona, graph: stores.db.graphStore },
    noopLogger, h.modes, h.liveHandle, undefined, undefined,
    {
      // runner 的薄封装在此直连 store(泵不在本测试面;入队/重投语义 = 同一实现)
      enqueueGraph: (ids) => {
        enqueued.push([...ids]);
        stores.db.graphStore.queueGraphProjection([...ids], GRAPH_PRIORITY_NEW);
      },
      reprojectGraph: (ids) => stores.db.graphStore.forceReprojectRecord(ids),
    },
  );
  return { enqueued };
}

const tool = (h: ReturnType<typeof harness>, name: string): RegisteredTool => {
  const t = h.registered.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
};

/** 经投影通道铸节点(名 = `实体-<id>`),返回图谱。 */
function projectNodes(db: MemoryDb, ids: string[], edges: GraphProjectionResult['edges'] = []): void {
  const g = db.graphStore;
  expect(g.queueGraphProjection(ids, GRAPH_PRIORITY_NEW)).toBeGreaterThan(0);
  const claim = g.claimNext();
  expect(claim).not.toBeNull();
  const result: GraphProjectionResult = {
    reason: 'seed',
    nodes: ids.map((id, i) => ({ ref: `n${i}`, name: `实体-${id}`, type: 'person', sourceRecordIds: [id], status: 'active' })),
    edges,
  };
  g.complete(claim!.job.id, result, { now: new Date().toISOString() });
}

describe('写面 R2:非蒸馏写入进投影队(task_1.5)', () => {
  it('memory_add(图谱启用)→ graph_projection_jobs 出 pending job 且记录可 claim', async () => {
    const stores = await setupStores([rec('r0', 'seed')]);
    const h = harness(true);
    registerWithWritePlane(h, stores);
    const add = tool(h, 'memory_add');
    const res = (await add.execute({ content: '用户的新规则:周报周五交' }, {})) as { id?: string; notice?: string };
    expect(res.id).toMatch(/^mem-/);

    const jobs = stores.db.graphStore.listJobs(50).filter((j) => j.sourceRecordIds.includes(res.id!));
    expect(jobs.length).toBe(1);
    expect(jobs[0].status).toBe('pending');
    expect(jobs[0].priority).toBe(GRAPH_PRIORITY_NEW);
  });

  it('memory_import 批量成功后同样入队(同一钩子,不另套逻辑)', async () => {
    const stores = await setupStores([rec('r0', 'seed')]);
    const h = harness(true);
    const { enqueued } = registerWithWritePlane(h, stores);
    const imp = tool(h, 'memory_import');
    const res = (await imp.execute({ records: [{ content: '规则A' }, { content: '规则B' }] }, {})) as { ids: string[] };
    expect(res.ids).toHaveLength(2);
    expect(enqueued.at(-1)).toEqual(res.ids);
  });
});

describe('写面 R1:memory_update(task_2.1~2.5)', () => {
  it('高权限关 → 拒答;旧行已退场 → 拒答(不与其 restore 语义串道)', async () => {
    const stores = await setupStores([rec('r1', '旧内容')]);
    const hOff = harness(false);
    registerWithWritePlane(hOff, stores);
    const off = (await tool(hOff, 'memory_update').execute({ record_id: 'r1', content: '新内容' }, {})) as { notice: string };
    expect(off.notice).toContain('高权限');

    const h = harness(true);
    registerWithWritePlane(h, stores);
    const missing = (await tool(h, 'memory_update').execute({ record_id: 'nope', content: 'x' }, {})) as { notice: string };
    expect(missing.notice).toContain('不存在');
    stores.db.retireL1Batch(['r1'], { at: new Date().toISOString(), reason: 'manual' });
    const retired = (await tool(h, 'memory_update').execute({ record_id: 'r1', content: 'x' }, {})) as { notice: string };
    expect(retired.notice).toContain('已退场');
  });

  it('update 后:旧记录 isRetired 且 marker.by==新id;新记录进检索面;旧源边随动墓碑;[旧,新]入队重投', async () => {
    const stores = await setupStores([rec('r1', '用户在 A 团队负责图谱')]);
    projectNodes(stores.db, ['r1']);
    const nodeId = stores.db.graphStore.loadGraph().nodes.find((n) => n.name === '实体-r1')!.id;
    const h = harness(true);
    const { enqueued } = registerWithWritePlane(h, stores);

    const upd = tool(h, 'memory_update');
    const res = (await upd.execute({ record_id: 'r1', content: '用户在 B 团队负责图谱' }, {})) as { id: string; retired_id: string };
    expect(res.retired_id).toBe('r1');
    expect(res.id).toMatch(/^mem-/);

    // 旧行:软删 + marker 指新 id,主表行仍在(可 restore,非物理删)
    const old = stores.l1.getByIds(['r1'])[0];
    expect(isRetired(old)).toBe(true);
    expect(readSupersedeMarker(old.metadata)?.reason).toBe('superseded');
    expect(readSupersedeMarker(old.metadata)?.by).toBe(res.id);

    // 新行:版本 +1,内容生效,进检索面
    const nw = stores.l1.getByIds([res.id])[0];
    expect(nw.version).toBe(1);
    expect(nw.content).toBe('用户在 B 团队负责图谱');
    const hits = await stores.l1.search('B 团队', 5, {});
    expect(hits.map((hh) => hh.id)).toContain(res.id);

    // 图谱随动:唯一旧源退场 → 节点被重算清扫标墓碑(retireL1Batch 内传播)
    expect(stores.db.graphStore.getNode(nodeId)?.status).toBe('archived');
    // 入队 + 强制重投都打到 [旧,新],且 r1 的投影凭证已被删、job 在途
    expect(enqueued.at(-1)).toEqual(['r1', res.id]);
    const jobs = stores.db.graphStore.listJobs(50).filter((j) => j.sourceRecordIds.includes(res.id));
    expect(jobs.length).toBe(1);
  });

  it('update 保留血缘字段:type/scene/created_at 缺省沿用旧值;extKey 留旧行(部分唯一索引不可双占)', async () => {
    const stores = await setupStores([
      { ...rec('r2', '旧导入', { type: 'work_fact', extKey: 'abc123', createdAt: Date.now() - 9_000_000, metadata: { hall: 'work', origin: 'o1' } }), },
    ]);
    const h = harness(true);
    registerWithWritePlane(h, stores);
    const res = (await tool(h, 'memory_update').execute({ record_id: 'r2', content: '新导入内容' }, {})) as { id: string };
    const nw = stores.l1.getByIds([res.id])[0];
    expect(nw.type).toBe('work_fact');
    // extKey 不随血缘走:旧行(退场态)继续占位幂等索引,新行不带键——不撞 UNIQUE 不静默丢写
    expect(nw.extKey).toBeUndefined();
    expect(stores.l1.getByIds(['r2'])[0].extKey).toBe('abc123');
    expect(stores.l1.findIdByExtKey('abc123')).toBe('r2');
    expect(nw.metadata?.hall).toBe('work');
    expect(nw.metadata?.origin).toBe('o1');
    expect(nw.createdAt).toBeLessThan(Date.now() - 9_000_000 + 60_000);
    expect(nw.updatedAt).toBeGreaterThanOrEqual(nw.createdAt);
  });
});

describe('写面 R3:memory_reproject(task_3.1~3.4)', () => {
  it('幂等:连续两次 reproject 同 ids 不堆重 job;不存在 id 被跳过并回报', async () => {
    const stores = await setupStores([rec('r1', '内容'), rec('r2', '内容2')]);
    projectNodes(stores.db, ['r1', 'r2']);
    const h = harness(true);
    registerWithWritePlane(h, stores);
    const rp = tool(h, 'memory_reproject');
    const first = (await rp.execute({ record_ids: ['r1', 'ghost'] }, {})) as { queued: number; job_ids: string[]; skipped_ids: string[] };
    expect(first.queued).toBe(1);
    expect(first.skipped_ids).toEqual(['ghost']);
    const second = (await rp.execute({ record_ids: ['r1'] }, {})) as { queued: number };
    expect(second.queued).toBe(0); // 在途 mapping 的 PK 去重吸收
  });

  it('对已投记录改 L1 后 reproject → 重投结果反映变更(经 claim/complete 通道)', async () => {
    const stores = await setupStores([rec('r1', '负责 A')]);
    projectNodes(stores.db, ['r1']);
    const nodeId = stores.db.graphStore.loadGraph().nodes.find((n) => n.name === '实体-r1')!.id;
    // 直改 L1 内容(模拟工具外路径的修正),再走 reproject 工具
    stores.db.upsertL1(rec('r1', '负责 Z'));
    const h = harness(true);
    registerWithWritePlane(h, stores);
    const rp = (await tool(h, 'memory_reproject').execute({ record_ids: ['r1'] }, {})) as { queued: number };
    expect(rp.queued).toBe(1);
    const claim = stores.db.graphStore.claimNext();
    expect(claim).not.toBeNull();
    expect(claim!.records[0]?.content).toBe('负责 Z');
    // 确定性"重投"结果:按新内容重写 fact → 节点当前状态跟随
    stores.db.graphStore.complete(claim!.job.id, {
      reason: 'rp',
      nodes: [{ ref: 'n0', name: '实体-r1', type: 'person', sourceRecordIds: ['r1'], state: '负责 Z', status: 'active' }],
      edges: [],
    }, { now: new Date().toISOString() });
    const node = stores.db.graphStore.getNode(nodeId)!;
    expect(node.currentState).toContain('负责 Z');
    expect(node.status).toBe('active'); // 重投复活墓碑(内容即当前事实)
  });
});

describe('写面 R4:memory_migrate_relation(task_4.1~4.5)', () => {
  async function seed3() {
    const stores = await setupStores([rec('m1', '用户属于甲组'), rec('m2', '用户调入乙组'), rec('m3', '丙组是目标组')]);
    projectNodes(stores.db, ['m1', 'm2', 'm3'], [
      { fromRef: 'n0', toRef: 'n1', relation: 'belongs_to', sourceRecordIds: ['m1'] },
    ]);
    return stores;
  }
  const ids = (stores: Awaited<ReturnType<typeof setupStores>>) => {
    const g = stores.db.graphStore.loadGraph();
    const byName = (n: string) => g.nodes.find((x) => x.name === n)!.id;
    return { x: byName('实体-m1'), y: byName('实体-m2'), z: byName('实体-m3'), graph: g };
  };

  it('不变量拒绝:空来源 / 已退场来源 / 悬挂节点,一律不落库', async () => {
    const stores = await seed3();
    const h = harness(true);
    registerWithWritePlane(h, stores);
    const mig = tool(h, 'memory_migrate_relation');
    const { x, y, z } = ids(stores);

    const empty = (await mig.execute({ from_node_id: x, relation: 'belongs_to', old_to_node_id: y, new_to_node_id: z, source_record_ids: [] }, {})) as { notice: string };
    expect(empty.notice).toContain('零无源事实');
    stores.db.retireL1Batch(['m2'], { at: new Date().toISOString(), reason: 'manual' });
    const exited = (await mig.execute({ from_node_id: x, relation: 'belongs_to', old_to_node_id: y, new_to_node_id: z, source_record_ids: ['m2'] }, {})) as { notice: string };
    expect(exited.notice).toContain('不变量');
    const ghost = (await mig.execute({ from_node_id: x, relation: 'belongs_to', old_to_node_id: y, new_to_node_id: 'node_ghost', source_record_ids: ['m1'] }, {})) as { notice: string };
    expect(ghost.notice).toContain('不存在');
    // 旧边原封不动(没有任何写路径在拒绝分支碰过 graph_edges)
    expect(ids(stores).graph.edges.find((e) => e.relation === 'belongs_to')?.status).toBe('active');
  });

  it('迁移后:旧边 superseded、新边 active 且可沿 sourceRecordIds 回溯到现存 L1;载体记录带审计;只对载体重投', async () => {
    const stores = await seed3();
    const h = harness(true);
    const { enqueued } = registerWithWritePlane(h, stores);
    const mig = tool(h, 'memory_migrate_relation');
    const { x, y, z } = ids(stores);

    const res = (await mig.execute({
      from_node_id: x, relation: 'belongs_to', old_to_node_id: y, new_to_node_id: z,
      source_record_ids: ['m1', 'm3'], content: '用户已调入丙组(2026-10)',
    }, {})) as { carrier_id: string; edge_ids: string[]; closed_edge_ids: string[]; queued: number };
    expect(res.closed_edge_ids).toHaveLength(1);
    expect(res.edge_ids.length).toBeGreaterThan(0);
    expect(res.queued).toBeGreaterThanOrEqual(0); // 载体可能并入同次在途 job,queued 不为负即可

    const g = stores.db.graphStore.loadGraph();
    const closed = g.edges.find((e) => e.id === res.closed_edge_ids[0])!;
    expect(closed.status).toBe('superseded');
    expect(closed.toNodeId).toBe(y);
    const opened = g.edges.find((e) => e.id === res.edge_ids[0])!;
    expect(opened.status).toBe('active');
    expect(opened.fromNodeId).toBe(x);
    expect(opened.toNodeId).toBe(z);
    // R5 回溯:新边每个来源都能点查回现存 L1
    expect(opened.sourceRecordIds.length).toBeGreaterThan(0);
    for (const sid of opened.sourceRecordIds) {
      expect(stores.l1.getByIds([sid]).length).toBe(1);
    }
    // 载体记录 + 审计标记(task_4.4:proposal_source=tool,与 LLM 投影/手写 SQL 区分)
    const carrier = stores.l1.getByIds([res.carrier_id])[0];
    expect(carrier.content).toBe('用户已调入丙组(2026-10)');
    const audit = carrier.metadata?.dsh_relation_migration as Record<string, unknown>;
    expect(audit.proposal_source).toBe('tool');
    expect(audit.closed_edge_ids).toEqual(res.closed_edge_ids);
    // 凭证落账:memory_receipts 可按 record_id 回溯到这次提案
    expect(stores.l1.countReceipts({ recordId: res.carrier_id })).toBe(1);
    // 重投只打载体 id(不把旧源拉进重投批——旧文本会把边翻回去)
    expect(enqueued.at(-1)).toEqual([res.carrier_id]);
    expect(y).not.toBe(z);
  });
});

describe('写面 R6:G-vec 缺陷修(task_6.x)', () => {
  it.runIf(VEC0_OK)('嵌入启用:complete 返回 touched 节点,收尾后 graph_node_vec 行数随节点增长', async () => {
    if (!root) root = await mkdtemp(join(tmpdir(), 'dsh-wplane-'));
    const dataDir = join(root, `wpv-${Date.now()}`);
    const db = new MemoryDb(join(dataDir, 'memory.db'), DIM);
    db.init();
    openDbs.push(db);
    const g = db.graphStore;
    expect(g.nodeVecReady).toBe(true);
    const l1 = new L1Store(dataDir, db, undefined, 'keyword', noopLogger, 0);
    await l1.init();
    await l1.appendNew([rec('w1', '实体甲的事'), rec('w2', '实体乙的事')]);

    // 第一轮投影 1 节点 → 向量 1 行
    g.queueGraphProjection(['w1'], GRAPH_PRIORITY_NEW);
    const claim1 = g.claimNext();
    const touched1 = g.complete(claim1!.job.id, {
      reason: '', nodes: [{ ref: 'n0', name: '甲', type: 'person', sourceRecordIds: ['w1'], state: '在测试', status: 'active' }], edges: [],
    }, { now: new Date().toISOString() });
    expect(touched1.map((n) => n.name)).toEqual(['甲']);
    expect(await writeNodeVectorsAfterComplete(g, touched1, async (t) => vecFor(t), noopLogger)).toBe(1);

    // 第二轮新节点 → 行数增长(缺陷修的验收面:不再永远 0 行)
    g.queueGraphProjection(['w2'], GRAPH_PRIORITY_NEW);
    const claim2 = g.claimNext();
    const touched2 = g.complete(claim2!.job.id, {
      reason: '', nodes: [{ ref: 'n0', name: '乙', type: 'person', sourceRecordIds: ['w2'], state: '在观察', status: 'active' }], edges: [],
    }, { now: new Date().toISOString() });
    expect(await writeNodeVectorsAfterComplete(g, touched2, async (t) => vecFor(t), noopLogger)).toBe(1);

    // 读路不再空转:向量种子能命中刚写入的两节点
    const hits = g.searchNodesByVector(vecFor('甲 在测试'), 10);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    // 被标墓碑的节点不在收尾输入里(complete 只交 active/disputed)
    db.retireL1Batch(['w1'], { at: new Date().toISOString(), reason: 'manual' });
    const claim3 = (() => { g.queueGraphProjection(['w1'], GRAPH_PRIORITY_NEW); return g.claimNext(); })();
    if (claim3) {
      const touched3 = g.complete(claim3.job.id, { reason: '', nodes: [], edges: [] }, { now: new Date().toISOString() });
      expect(touched3.every((n) => n.status === 'active' || n.status === 'disputed')).toBe(true);
    }
    void l1;
  });

  it('纯 FTS 档(nodeVecReady=false)→ 收尾结构性 no-op 返 0 不抛;嵌入缺席同 no-op', async () => {
    const stores = await setupStores([rec('z1', '内容')]);
    projectNodes(stores.db, ['z1']);
    const g = stores.db.graphStore;
    expect(g.nodeVecReady).toBe(false);
    const touched = g.loadGraph().nodes;
    expect(touched.length).toBeGreaterThan(0);
    expect(await writeNodeVectorsAfterComplete(g, touched, async (t) => vecFor(t), noopLogger)).toBe(0);
    expect(await writeNodeVectorsAfterComplete(g, touched, undefined, noopLogger)).toBe(0);
    // 嵌入文本形态单源:名+别名+状态串(空字段不进串)
    expect(nodeEmbedText({ ...touched[0], name: '甲', aliases: ['A哥'], currentState: '在职' })).toBe('甲 A哥 在职');
  });
});
