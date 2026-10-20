/**
 * §D 第 3 路（task_9）—— 图谱路径接入 hybrid RRF 融合。
 *
 * 链路：`searchGraphNodes` 命中 →（provider 内：向量种子并集 + 1-hop 边扩展）→
 * 节点/fact 的 `sourceRecordIds` 回链 → L1 记录 id 序列（保排名、去重）→
 * 作为第 3 条已排序列表参与 RRF。
 *
 * 前置：task_12（图谱可重建性冒烟）已通过 —— 本路让图谱成为检索承重部分，
 * 故必须先确认"图谱是可重建派生投影"这一前提成立。
 *
 * 本文件同时钉住三条不变量：
 * ① 图谱路可独立把记录带进结果（FTS/向量都无命中时仍可见）—— 这是本路的全部价值；
 * ② 档位隔离不得被绕过：`opts.family` 指定时，图谱回链出的跨族记录必须剔除；
 * ③ **未接线时恰为 2 路**，得分与 task_11 留档逐位一致（无漂移回归护栏）。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { graphHitRecordIds } from '../src/graph/search.js';
import { L1Store } from '../src/store/l1.js';
import { MemoryDb } from '../src/store/sqlite.js';
import type { GraphFact, GraphNode, GraphNodeSearchResult } from '../src/graph/types.js';
import type { EmbeddingService } from '../src/store/embedding.js';

const DIM = 16;
const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

async function freshDir(tag: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), `dsh-${tag}-`));
  dirs.push(d);
  return d;
}

function vecFor(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (let i = 0; i < text.length; i++) v[text.charCodeAt(i) % DIM] += 1;
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (mag < 1e-10) return v;
  for (let i = 0; i < DIM; i++) v[i] /= mag;
  return v;
}
function fakeEmbed(): EmbeddingService {
  return {
    getDimensions: () => DIM,
    getProviderInfo: () => ({ provider: 'probe', model: 'probe', dimensions: DIM }),
    isReady: () => true,
    embed: async (t: string) => vecFor(t),
    embedBatch: async (ts: string[]) => ts.map(vecFor),
  };
}

/** 极简 GraphNode 夹具（只填本路用得到的字段）。 */
function fact(key: string, sources: string[], status: 'active' | 'superseded'): GraphFact {
  return {
    id: `f-${key}-${status}`,
    key,
    value: key,
    status,
    confidence: 1,
    sourceRecordIds: sources,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
function node(id: string, sources: string[], facts: GraphFact[] = []): GraphNode {
  return {
    id,
    name: id,
    type: 'tool',
    aliases: [],
    tags: [],
    currentState: '',
    facts,
    status: 'active',
    confidence: 1,
    sourceRecordIds: sources,
    families: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
function hit(n: GraphNode): GraphNodeSearchResult {
  return { node: n, score: 1, matchedFields: ['name'], matchReason: 'x' };
}

function rec(id: string, content: string, family: 'chat' | 'work' = 'chat') {
  const now = Date.now();
  return {
    id,
    content,
    type: family === 'work' ? 'work_fact' : 'episodic',
    priority: 50,
    scene_name: 's',
    family,
    timestamps: [now],
    createdAt: now,
    updatedAt: now,
  };
}

describe('task_9 graphHitRecordIds —— 图谱命中回链 L1 记录 id(纯函数)', () => {
  it('按命中排名保序,跨节点/跨 fact 去重(取首次出现=最高排名)', () => {
    const hits = [hit(node('a', ['r1', 'r2'])), hit(node('b', ['r2', 'r3']))];
    expect(graphHitRecordIds(hits)).toEqual(['r1', 'r2', 'r3']);
  });

  it('节点自身来源优先于其 fact 来源', () => {
    const hits = [hit(node('a', ['r-node'], [fact('k', ['r-fact'], 'active')]))];
    expect(graphHitRecordIds(hits)).toEqual(['r-node', 'r-fact']);
  });

  it('非 active 的 fact 来源不计入(superseded 是历史,不该把旧记录拉进结果)', () => {
    const hits = [hit(node('a', ['r-node'], [fact('old', ['r-old'], 'superseded'), fact('new', ['r-new'], 'active')]))];
    expect(graphHitRecordIds(hits)).toEqual(['r-node', 'r-new']);
  });

  it('空输入 / 零来源 → 空(不产生空占位)', () => {
    expect(graphHitRecordIds([])).toEqual([]);
    expect(graphHitRecordIds([hit(node('a', []))])).toEqual([]);
  });
});

describe('task_9 §D 第 3 路接入 L1Store.search()', () => {
  async function setup(
    records: ReturnType<typeof rec>[],
    lane?: (q: string, n: number, f?: 'chat' | 'work') => readonly string[] | Promise<readonly string[]>,
  ) {
    const dataDir = await freshDir('graphlane');
    const db = new MemoryDb(join(dataDir, 'g.db'), DIM);
    db.init();
    const store = new L1Store(dataDir, db, fakeEmbed(), 'hybrid', undefined, 0, lane);
    await store.init();
    await store.appendNew(records);
    return { db, store };
  }

  it('图谱路把记录带进融合并前移其排名(词法路命不中它,只有图谱能给它加分)', async () => {
    // r2 与查询无 token 交集 → 不进 FTS 路;只在向量路垫底。
    // 「有/无图谱路」两次搜索的**排名差分**是本路生效的决定性证据——
    // 注意不能只断言"r2 在结果里":小夹具下向量路本来就会把它捞回来,
    // 那样 RED 阶段也会假通过(空洞通过)。
    const records = [
      rec('a', '用户对 Rust 感兴趣'),
      rec('b', 'Rust 编译器也很好'),
      rec('c', 'Rust 的所有权模型'),
      rec('d', 'Rust 的异步运行时'),
      rec('e', 'Rust 生态工具链'),
      rec('f', 'Rust 学习路线'),
      rec('r2', '完全无关的另一件事'),
    ];
    const query = 'Rust 感兴趣';
    const laneHit = () => ['r2'];
    const withLane = await setup(records, laneHit);
    const withoutLane = await setup(records);
    try {
      const a = await withoutLane.store.search(query, 5);
      const b = await withLane.store.search(query, 5);
      const idxWithout = a.findIndex((h) => h.id === 'r2');
      const idxWith = b.findIndex((h) => h.id === 'r2');
      // 前置:无图谱路时 r2 **连前 5 都进不去**(夹具确实把它排除在词法命中之外)
      expect(idxWithout).toBe(-1);
      // 图谱路加分后进入结果 —— 这是融合真的把第 3 路算进去了
      expect(idxWith).toBeGreaterThanOrEqual(0);
      // 3 路归一:得分仍不得超过 1.0(边界回归)
      for (const h of b) {
        expect(h.score).toBeGreaterThan(0);
        expect(h.score).toBeLessThanOrEqual(1);
      }
    } finally {
      withLane.db.close();
      withoutLane.db.close();
    }
  });

  it('档位隔离不被绕过:provider 确实被调用,但回链出的跨族记录被剔除', async () => {
    const lane = vi.fn(() => ['w1']); // 图谱把 work 记录带出来
    const { db, store } = await setup([rec('c1', 'chat 族记忆', 'chat'), rec('w1', 'work 族记忆', 'work')], lane);
    try {
      const hits = await store.search('任意查询', 5, { family: 'chat' });
      // 机制证明:图谱路真的跑了(否则"w1 不在结果里"是空洞通过)
      expect(lane).toHaveBeenCalled();
      // work 记录既进不了族过滤后的 FTS/向量路,也不得经图谱路漏出
      expect(hits.map((h) => h.id)).not.toContain('w1');
    } finally {
      db.close();
    }
  });

  it('图谱路抛错 → 降级双路,不向上抛(主链路不被派生投影拖垮)', async () => {
    const warn = vi.fn();
    const dataDir = await freshDir('graphlane-throw');
    const db = new MemoryDb(join(dataDir, 'g.db'), DIM);
    db.init();
    const store = new L1Store(dataDir, db, fakeEmbed(), 'hybrid', { warn, info: () => {}, error: () => {} }, 0, () => {
      throw new Error('graph boom');
    });
    await store.init();
    await store.appendNew([rec('r1', '用户对 Rust 感兴趣')]);
    try {
      const hits = await store.search('Rust 感兴趣', 5);
      expect(hits.map((h) => h.id)).toContain('r1'); // FTS/向量仍返回
      expect(warn).toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('**未接线 = 恰为 2 路**:得分与 task_11 留档逐位一致(无漂移回归护栏)', async () => {
    const { db, store } = await setup([
      rec('a', '用户对 Rust 感兴趣'),
      rec('b', '用户对 Rust 编译器感兴趣'),
      rec('c', '团队用 GitLab CI 做持续集成', 'work'),
      rec('d', '今天天气不错'),
    ]); // 不传 lane
    try {
      const hits = await store.search('Rust 感兴趣', 5);
      expect(hits.map((h) => [h.id, h.score])).toEqual([
        ['a', 1],
        ['b', 0.9838709677419355],
        ['c', 0.4841269841269841],
        ['d', 0.4765625],
      ]);
    } finally {
      db.close();
    }
  });

  it('真实接线表达式可用:db.graphStore.searchNodes 作 provider,图谱节点回链进入融合', async () => {
    const dataDir = await freshDir('graphlane-real');
    const file = join(dataDir, 'g.db');
    const db = new MemoryDb(file, DIM);
    db.init();
    const store = new L1Store(dataDir, db, fakeEmbed(), 'hybrid', undefined, 0, (q, n, f) =>
      db.graphStore.searchLaneRecords(q, undefined, n, f ? [f] : undefined),
    );
    await store.init();
    const records = [
      rec('a', '用户对 Rust 感兴趣'),
      rec('b', 'Rust 编译器也很好'),
      rec('c', 'Rust 的所有权模型'),
      rec('d', 'Rust 的异步运行时'),
      rec('e', 'Rust 生态工具链'),
      rec('f', 'Rust 学习路线'),
      rec('r2', '毫不相关的另一件事'),
    ];
    await store.appendNew(records);
    // 图谱行:节点名含查询词,来源指向词法命不中的 r2(生产路径写的是投影管线,
    // 这里用 raw INSERT 直造派生投影结果——与 tests/graph-store.test.ts:282-287 同款先例)
    const raw = new DatabaseSync(file, { allowExtension: false });
    raw
      .prepare(
        `INSERT INTO graph_nodes (node_id, name, type, facts_json, status, source_record_ids_json, families_json)
         VALUES ('n-rust', 'Rust 语言', 'concept', '[]', 'active', '["r2"]', '["chat"]')`,
      )
      .run();
    raw.close();

    // 对照组:同一夹具 + 同一 provider 表达式,但图谱表为空
    const dataDir2 = await freshDir('graphlane-real-off');
    const db2 = new MemoryDb(join(dataDir2, 'g.db'), DIM);
    db2.init();
    const store2 = new L1Store(dataDir2, db2, fakeEmbed(), 'hybrid', undefined, 0, (q, n, f) =>
      db2.graphStore.searchLaneRecords(q, undefined, n, f ? [f] : undefined),
    );
    await store2.init();
    await store2.appendNew(records);
    try {
      const off = await store2.search('Rust 感兴趣', 5);
      const on = await store.search('Rust 感兴趣', 5);
      // 前置:图谱表为空时 r2 连前 5 都进不去(证明 r2 只能靠图谱路进来)
      expect(off.findIndex((h) => h.id === 'r2')).toBe(-1);
      expect(on.findIndex((h) => h.id === 'r2')).toBeGreaterThanOrEqual(0);
    } finally {
      db.close();
      db2.close();
    }
  });
});
