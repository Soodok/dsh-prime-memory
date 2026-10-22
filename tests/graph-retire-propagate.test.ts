/**
 * 图谱退场传播 + 强制重投单测(expiry-tiering R9/R10 冻结契约 · 先行刀,
 * 对齐上游 task_7.4 / task_7.6 的验收面)。
 *
 * 钉死的性质:
 * ① 软删唯一来源记录 → 支撑它的 active/disputed 节点·边被标 archived 墓碑(行保留);
 * ② restore(清退场标记)→ 同源全复活的 archived 项回 active;
 * ③ 来源有任一存活 → 不动(跨记录聚合的节点不被单源退场误杀);
 * ④ 合法历史 valid_to(无 marker)不退场传播——"过时"与"退场"正交(门1 解耦方向);
 * ⑤ forceReprojectRecord:删投影凭证 + 高优入队;在途 job 期间重复调用不堆重 job。
 *
 * 图侧形状全部经 queue→claim→complete 的既有投影通道铸造,测试不手写图内部逻辑。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MemoryDb } from '../src/store/sqlite.js';
import { GraphStore } from '../src/store/graph-store.js';
import { GRAPH_PRIORITY_NEW } from '../src/graph/types.js';
import type { GraphProjectionResult } from '../src/graph/types.js';
import type { MemoryRecord } from '../src/types.js';

const dirs: string[] = [];
const dbs: MemoryDb[] = [];
afterAll(async () => {
  // Windows 下文件句柄未关就 rm 会 EBUSY:先关库再删目录
  for (const d of dbs.splice(0)) d.close();
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

function rec(id: string, content: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  const t = Date.now();
  return {
    id, content, type: 'work_fact', priority: 60, scene_name: 's',
    timestamps: [t], createdAt: t, updatedAt: t, version: 0, metadata: {}, family: 'work',
    ...overrides,
  };
}

/** 建一个 L1+图同库的 MemoryDb(纯 FTS 档:dimensions=0,向量路结构性不存在)。 */
async function setup(): Promise<MemoryDb> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-retire-graph-'));
  dirs.push(dir);
  const db = new MemoryDb(join(dir, 'g.db'), 0);
  db.init();
  dbs.push(db);
  return db;
}

/** 走 claim→complete 通道把给定记录投影成节点(名=记录 id,便于找回)。 */
function projectNodes(db: MemoryDb, ids: string[], edges: GraphProjectionResult['edges'] = []): void {
  const g = db.graphStore;
  expect(g.queueGraphProjection(ids, GRAPH_PRIORITY_NEW)).toBeGreaterThan(0);
  const claim = g.claimNext();
  expect(claim).not.toBeNull();
  const result: GraphProjectionResult = {
    reason: 'test',
    nodes: ids.map((id, i) => ({
      ref: `n${i}`, name: `实体-${id}`, type: 'person', sourceRecordIds: [id], status: 'active',
    })),
    edges,
  };
  g.complete(claim!.job.id, result, { now: new Date().toISOString() });
}

function nodeStatusOf(db: MemoryDb, name: string): string | undefined {
  return db.graphStore.loadGraph().nodes.find((n) => n.name === name)?.status;
}
function edgeStatusOf(db: MemoryDb, relation: string): string | undefined {
  return db.graphStore.loadGraph().edges.find((e) => e.relation === relation)?.status;
}

describe('markSourcesRetired(软删→图谱退役传播,R9)', () => {
  it('软删唯一来源记录 → active 节点被标 archived;restore → 回 active', async () => {
    const db = await setup();
    db.upsertL1(rec('r1', '张三负责图谱写面'));
    projectNodes(db, ['r1']);
    expect(nodeStatusOf(db, '实体-r1')).toBe('active');

    const n = db.retireL1Batch(['r1'], { at: new Date().toISOString(), reason: 'manual' });
    expect(n).toBe(1);
    expect(nodeStatusOf(db, '实体-r1')).toBe('archived');
    // 墓碑保留行(不是删除):expand/全图读仍可见
    expect(db.graphStore.loadGraph().nodes.some((x) => x.name === '实体-r1')).toBe(true);

    db.clearRetireMarker(['r1']);
    expect(nodeStatusOf(db, '实体-r1')).toBe('active');
  });

  it('边同样随来源全退场而 archived;来源有任一存活则不动', async () => {
    const db = await setup();
    db.upsertL1(rec('rA', '甲'));
    db.upsertL1(rec('rB', '乙'));
    db.upsertL1(rec('rC', '丙'));
    projectNodes(db, ['rA', 'rB', 'rC'], [
      { fromRef: 'n0', toRef: 'n1', relation: 'owns', sourceRecordIds: ['rA', 'rB'] },
      { fromRef: 'n0', toRef: 'n2', relation: 'caused', sourceRecordIds: ['rA'] },
    ]);
    expect(db.graphStore.loadGraph().edges).toHaveLength(2);

    db.retireL1Batch(['rA'], { at: new Date().toISOString(), reason: 'superseded', by: 'rB' });
    // 'owns' 还有存活来源 rB → 不墓碑;'caused' 唯一来源退场 → 墓碑
    expect(edgeStatusOf(db, 'owns')).toBe('active');
    expect(edgeStatusOf(db, 'caused')).toBe('archived');
    // 节点 n(rA) 退场,但节点(rB) 仍 active
    expect(nodeStatusOf(db, '实体-rA')).toBe('archived');
    expect(nodeStatusOf(db, '实体-rB')).toBe('active');
  });

  it('合法历史 valid_to(无 marker)不触发退役——"过时"与"退场"是正交两轴', async () => {
    const db = await setup();
    db.upsertL1(rec('rH', '2020 年在巴黎旅行', { persistence: 's', validTo: Date.now() - 86_400_000 }));
    projectNodes(db, ['rH']);
    db.graphStore.markSourcesRetired(['rH']);
    expect(nodeStatusOf(db, '实体-rH')).toBe('active');
  });

  it('disputed 节点也会被清扫;未初始化/空入参不抛', async () => {
    const db = await setup();
    db.upsertL1(rec('rD', '丁'));
    projectNodes(db, ['rD']);
    // 经矛盾冻结通道置 disputed(同步 sweep 的真实入口),再退场来源 → 墓碑应覆盖 disputed
    expect(db.graphStore.syncDisputed(['rD']).marked).toBe(1);
    expect(nodeStatusOf(db, '实体-rD')).toBe('disputed');
    db.retireL1Batch(['rD'], { at: new Date().toISOString(), reason: 'obsolete' });
    expect(nodeStatusOf(db, '实体-rD')).toBe('archived');
    const cold = new GraphStore();
    expect(() => cold.markSourcesRetired([])).not.toThrow();
    expect(() => cold.markSourcesRetired(['rD'])).not.toThrow();
  });
});

describe('forceReprojectRecord(强制重投,R10)', () => {
  it('删投影凭证 + 高优入队;在途期间重复调用不堆重 job(PK 去重)', async () => {
    const db = await setup();
    db.upsertL1(rec('r1', '初版内容'));
    projectNodes(db, ['r1']);
    const g = db.graphStore;
    // 投影已完成 → 凭证在
    const r1 = g.forceReprojectRecord(['r1']);
    expect(r1.queued).toBe(1);
    expect(r1.jobIds).toHaveLength(1);
    // 在途 job 未被第二次调用绕过:queued=0,不堆重
    const r2 = g.forceReprojectRecord(['r1']);
    expect(r2.queued).toBe(0);
    expect(r2.jobIds).toHaveLength(0);
  });

  it('job 完成后可再次重投(合法保鲜,非堆积)', async () => {
    const db = await setup();
    db.upsertL1(rec('r2', '内容 v2'));
    projectNodes(db, ['r2']);
    const g = db.graphStore;
    expect(g.forceReprojectRecord(['r2']).queued).toBe(1);
    const claim = g.claimNext();
    expect(claim).not.toBeNull();
    g.complete(claim!.job.id, { reason: '', nodes: [], edges: [] }, { now: new Date().toISOString() });
    // complete 写回凭证 → 再投又是一条新 job
    expect(g.forceReprojectRecord(['r2']).queued).toBe(1);
  });

  it('claim 现读 L1:改后内容经在途 job 投出(不动 job_records 映射的幂等依据)', async () => {
    const db = await setup();
    db.upsertL1(rec('r3', '旧文案'));
    const g = db.graphStore;
    expect(g.forceReprojectRecord(['r3']).queued).toBe(1);
    // 入队后、claim 前修改 L1 内容
    db.upsertL1(rec('r3', '新文案'));
    const claim = g.claimNext();
    expect(claim).not.toBeNull();
    expect(claim!.records[0]?.content).toBe('新文案');
  });

  it('空入参/未初始化返回 {queued:0},绝不抛', () => {
    const fresh = new GraphStore();
    expect(fresh.forceReprojectRecord([])).toEqual({ queued: 0, jobIds: [] });
    expect(fresh.forceReprojectRecord(['x'])).toEqual({ queued: 0, jobIds: [] });
  });
});
