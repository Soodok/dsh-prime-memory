/**
 * §C 矛盾冻结 / task_25:裁决出口(工具 + RPC 端点)。
 *
 * 冻结把裁决权交还给人,就必须有"人能把结论说回去"的出口——否则队列是只进不出的
 * 黑洞,安全阀(task_24)的自动了结会成为唯一出路,opt-in 的冻结等于被悄悄退回成
 * "超时后机器自己判"。
 *
 * 本文件用**真实 store + 真实端点**跑裁决闭环,而不是只测服务函数:
 * 裁决是**有副作用**的(记录退场 + 图谱状态重算),只测返回值等于没测。
 *
 * ⚠️ 执行序说明:task_25 的实现在本文件之前落笔(**偏离了 RED 先行的纪律**),
 * 补偿手段是下面的**变异探针**——把 `both` 分支改成"也退场 one 方"后,
 * 用例②③必须变红;实测见 `evidence/conflict-freeze-wave2b.log`。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const { L1Store } = await import('../src/store/l1.js');
const { MemoryDb } = await import('../src/store/sqlite.js');
const { conflictPairId } = await import('../src/store/conflicts.js');
const { readSupersedeMarker } = await import('../src/store/supersede.js');
const { resolveConflictPair } = await import('../src/conflict-service.js');
const { handleEndpoint, buildEndpointDeps } = await import('../src/stats.js');
const { memorySchema } = await import('../src/config.js');

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} } as never;
const DEFAULTS = (memorySchema as unknown as (v: unknown) => Record<string, unknown>)({});

let root: string;
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

function l1Row(id: string, content: string): Record<string, unknown> {
  return {
    id,
    content,
    type: 'work_fact',
    priority: 60,
    scene_name: 's',
    timestamps: [1_700_000_000_000],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    version: 0,
    source_message_ids: [],
    metadata: {},
    family: 'work',
  };
}

function seedNode(db: InstanceType<typeof MemoryDb>, ref: string, sourceRecordIds: string[]): void {
  db.graphStore.queueGraphProjection(sourceRecordIds, 10_000);
  const claim = db.graphStore.claimNext();
  db.graphStore.complete(claim?.job.id ?? '', {
    reason: '',
    nodes: [{ ref, name: `实体-${ref}`, type: 'project', sourceRecordIds }],
    edges: [],
  });
}

interface H {
  db: InstanceType<typeof MemoryDb>;
  store: InstanceType<typeof L1Store>;
  cfg: Record<string, unknown>;
  deps: ReturnType<typeof buildEndpointDeps>;
  pairId: string;
  winnerId: string;
  loserId: string;
  winnerNode: string;
  loserNode: string;
  close: () => void;
}

let seq = 0;
async function setup(tag: string, opts: { freeze?: boolean } = {}): Promise<H> {
  root = root ?? (await mkdtemp(join(tmpdir(), 'dsh-conflict-resolve-')));
  seq++;
  const dataDir = join(root, `${tag}-${seq}`);
  const db = new MemoryDb(join(dataDir, 'memory.db'), 0);
  db.init();
  const store = new L1Store(dataDir, db, undefined, 'keyword', noopLogger, 0);
  await store.init();
  const cfg = {
    ...DEFAULTS,
    dataDir,
    conflictFreeze: { enabled: opts.freeze ?? true, maxPending: 100, timeoutDays: 0 },
  } as Record<string, unknown>;

  const winnerId = `mem_w${seq}`;
  const loserId = `mem_l${seq}`;
  db.upsertL1Batch([l1Row(winnerId, '胜方:项目 Gamma 负责人是张三'), l1Row(loserId, '败方:项目 Gamma 负责人是李四')] as never);
  seedNode(db, `w${seq}`, [winnerId]);
  seedNode(db, `l${seq}`, [loserId]);

  const pairId = conflictPairId('run_x', winnerId, loserId);
  store.recordConflictPending([
    {
      pairId,
      runId: 'run_x',
      winnerId,
      loserId,
      createdAt: new Date().toISOString(),
      resolvedAt: '',
      resolution: '',
    },
  ]);

  const deps = buildEndpointDeps(
    { ctx: {} as never, cfg: cfg as never, stores: { l1: store } as never, logger: noopLogger },
    {},
    undefined,
  );
  return {
    db, store, cfg, deps, pairId, winnerId, loserId,
    winnerNode: `实体-w${seq}`,
    loserNode: `实体-l${seq}`,
    close: () => db.close(),
  };
}

function calls(h: H, pairId: string, outcome: string) {
  return resolveConflictPair(
    { l1: h.store, conflictFreezeEnabled: (h.cfg.conflictFreeze as { enabled: boolean }).enabled },
    pairId,
    outcome,
  );
}

describe('task_25 裁决闭环:winner / loser / both', () => {
  it('winner:败方从检索退场,胜方保留,图谱 disputed 复原为 active,resolved_at 落值', async () => {
    const h = await setup('winner');
    try {
      expect(h.db.graphStore.loadGraph().nodes.map((n) => n.status).every((s) => s === 'active')).toBe(true);
      h.store.syncGraphDisputed([h.winnerId, h.loserId]);
      expect(h.db.graphStore.loadGraph().nodes.every((n) => n.status === 'disputed')).toBe(true);

      const r = await calls(h, h.pairId, 'winner');
      expect(r.notice).toBeUndefined();
      expect(r.resolved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // 实际取值留档
      expect(r.removed_record_id).toBe(h.loserId);

      // **软删**(退场):主表行保留(可恢复的载体),但已撤出检索面。
      // 旧断言是 `toHaveLength(0)`(物理删除)——那正是"删错了只能去 JSONL 事实源捞"的病根。
      const [gone] = h.store.getByIds([h.loserId]);
      expect(gone, '主表行必须保留,否则无从恢复').toBeDefined();
      expect(gone.metadata?.dsh_superseded).toBeDefined(); // 门1:退场凭 marker，valid_to 不再被闭合
      expect(readSupersedeMarker(gone.metadata)).toMatchObject({ reason: 'conflict', verdict: 'winner' });
      expect(h.store.listRetired({ limit: 10, offset: 0 }).items.map((x) => x.id)).toContain(h.loserId);
      expect(h.store.getByIds([h.winnerId])).toHaveLength(1); // 保留(活动)

      const byName = new Map(h.db.graphStore.loadGraph().nodes.map((n) => [n.name, n.status]));
      expect(byName.get(h.winnerNode)).toBe('active'); // 争议已了结 → 复原
    } finally {
      h.close();
    }
  });

  it('both:两条都保留(判为各自独立的事实),不误删任何一条', async () => {
    const h = await setup('both');
    try {
      const r = await calls(h, h.pairId, 'both');
      expect(r.notice).toBeUndefined();
      expect(r.removed_record_id).toBe('');
      expect(h.store.getByIds([h.loserId])).toHaveLength(1);
      expect(h.store.getByIds([h.winnerId])).toHaveLength(1);
      // 队列里那条已是已裁决态
      expect(h.store.listConflictPending()).toHaveLength(0);
    } finally {
      h.close();
    }
  });

  it('loser:反过来退场胜方', async () => {
    const h = await setup('loser');
    try {
      const r = await calls(h, h.pairId, 'loser');
      expect(r.removed_record_id).toBe(h.winnerId);
      const [goneW] = h.store.getByIds([h.winnerId]);
      expect(goneW?.metadata?.dsh_superseded).toBeDefined(); // 门1:marker 单源
      expect(h.store.listRetired({ limit: 10, offset: 0 }).items.map((x) => x.id)).toContain(h.winnerId);
      expect(h.store.getByIds([h.loserId])).toHaveLength(1);
    } finally {
      h.close();
    }
  });
});

describe('task_25 裁决的边界与不可逆性', () => {
  it('二次裁决不覆盖第一次结论(WHERE resolved_at = \'\')', async () => {
    const h = await setup('twice');
    try {
      const first = await calls(h, h.pairId, 'both');
      expect(first.resolved_at).not.toBe('');
      const second = await calls(h, h.pairId, 'winner');
      expect(second.notice).toMatch(/找不到|已被裁决/);
      // 第一次的结论未被改写:败方仍在
      expect(h.store.getByIds([h.loserId])).toHaveLength(1);
    } finally {
      h.close();
    }
  });

  it('pair_id 不存在 → 给提示而非抛错,且不动任何数据', async () => {
    const h = await setup('missing');
    try {
      const r = await calls(h, 'pair_不存在', 'winner');
      expect(r.notice).toMatch(/找不到/);
      expect(h.store.getByIds([h.loserId])).toHaveLength(1);
      expect(h.store.listConflictPending()).toHaveLength(1);
    } finally {
      h.close();
    }
  });

  it('非法 outcome → 给提示而非抛错', async () => {
    const h = await setup('bad');
    try {
      const r = await calls(h, h.pairId, '随便');
      expect(r.notice).toMatch(/outcome 必须是/);
      expect(h.store.listConflictPending()).toHaveLength(1);
    } finally {
      h.close();
    }
  });

  it('冻结未开启 → 明示"无从裁决",而不是静默无操作', async () => {
    const h = await setup('off', { freeze: false });
    try {
      const r = await calls(h, h.pairId, 'winner');
      expect(r.notice).toMatch(/矛盾冻结未开启/);
      expect(h.store.listConflictPending()).toHaveLength(1);
    } finally {
      h.close();
    }
  });

  it('**仍有其他未裁决对时,图谱不得误复原**(派生同步的判据是"是否仍在冲突集里")', async () => {
    const h = await setup('partial');
    try {
      // 第二对:另一条记录,仍在待裁决
      const otherId = `mem_o${seq}`;
      h.db.upsertL1Batch([l1Row(otherId, '另一条待裁决记录')] as never);
      seedNode(h.db, `o${seq}`, [otherId]);
      const otherPair = conflictPairId('run_y', otherId, h.loserId);
      h.store.recordConflictPending([
        { pairId: otherPair, runId: 'run_y', winnerId: otherId, loserId: h.loserId, createdAt: new Date().toISOString(), resolvedAt: '', resolution: '' },
      ]);

      // 此刻争议集 = 两对的并集
      const all = new Set<string>();
      for (const p of h.store.listConflictPending()) { all.add(p.winnerId); all.add(p.loserId); }
      h.store.syncGraphDisputed([...all]);
      expect(h.db.graphStore.loadGraph().nodes.every((n) => n.status === 'disputed')).toBe(true);

      // 只裁决第一对:第二对仍未裁决 → 它的节点**必须仍是 disputed**
      await calls(h, h.pairId, 'both');
      const statuses = new Map(h.db.graphStore.loadGraph().nodes.map((n) => [n.name, n.status]));
      expect(statuses.get(`实体-o${seq}`)).toBe('disputed');
      expect(statuses.get(`实体-w${seq}`)).toBe('active');
    } finally {
      h.close();
    }
  });
});

describe('task_25 RPC 端点(与工具共用同一形状与语义)', () => {
  it('dsh-memory/conflict-resolve 跑通同一闭环', async () => {
    const h = await setup('rpc');
    try {
      const r = (await handleEndpoint('dsh-memory/conflict-resolve', { pairId: h.pairId, outcome: 'winner' }, h.deps)) as {
        pair_id: string;
        resolved_at: string;
        removed_record_id: string;
      };
      expect(r.pair_id).toBe(h.pairId);
      expect(r.resolved_at).not.toBe('');
      expect(r.removed_record_id).toBe(h.loserId);
      // 端点路径与工具路径同语义:软删(可恢复),不是物理删除
      const [viaEndpoint] = h.store.getByIds([h.loserId]);
      expect(viaEndpoint?.metadata?.dsh_superseded).toBeDefined(); // 门1:marker 单源
      expect(readSupersedeMarker(viaEndpoint?.metadata)).toMatchObject({ reason: 'conflict', verdict: 'winner' });
    } finally {
      h.close();
    }
  });

  it('端点层缺参**抛错**而非返回提示(端点是给程序用的,静默会被误读为"确实没有")', async () => {
    const h = await setup('rpc-bad');
    try {
      await expect(handleEndpoint('dsh-memory/conflict-resolve', { pairId: h.pairId }, h.deps)).rejects.toThrow(/outcome/);
      await expect(handleEndpoint('dsh-memory/conflict-resolve', { outcome: 'winner' }, h.deps)).rejects.toThrow(/pairId/);
    } finally {
      h.close();
    }
  });
});
