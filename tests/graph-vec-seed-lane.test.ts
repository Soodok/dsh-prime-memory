/**
 * 轨 A · §D 第 3 路路内向量种子(searchLaneRecords)验收面。
 *
 * 钉住的性质(spec 模块 A/B):
 * ① embedding=undefined 与旧 `searchNodes + graphHitRecordIds` 表达式**逐位一致**
 *    (向量种子是"路内并集",不改既有语义——"未接线/未就绪 = 既有行为"的推广);
 * ② 种子序:词法命中在前、向量种子追加在后,同节点去重不双计;
 * ③ 向量种子同样过族闸与状态闸(宁可漏不可串);
 * ④ 向量种子参与 1-hop(种子节点是联想起点,不是终点);
 * ⑤ vec 路未就绪(dimensions=0)时传 embedding 也**结构性降级**为纯词法——
 *    该用例不依赖 vec0,任何环境都有实质断言。
 *
 * vec0 相关组用 `it.runIf` 门控(可见的 skipped),探针逐字照抄
 * tests/graph-node-vec.test.ts 的 `probeVec0/openVecDb`(两坑教训见彼处注释)。
 */
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { GraphStore } from '../src/store/graph-store.js';
import { graphHitRecordIds } from '../src/graph/search.js';

const require = createRequire(import.meta.url);

function probeVec0(): boolean {
  const db = new DatabaseSync(':memory:', { allowExtension: true });
  try {
    const sqliteVec = require('sqlite-vec') as { load(d: unknown): void };
    db.enableLoadExtension(true);
    sqliteVec.load(db);
    db.exec('CREATE VIRTUAL TABLE probe USING vec0(v float[2])');
    return true;
  } catch {
    return false;
  } finally {
    try {
      db.enableLoadExtension(false);
    } catch {
      /* ignore */
    }
    db.close();
  }
}

function openVecDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { allowExtension: true });
  try {
    const sqliteVec = require('sqlite-vec') as { load(d: unknown): void };
    db.enableLoadExtension(true);
    sqliteVec.load(db);
    db.enableLoadExtension(false);
  } catch {
    /* 无扩展 → 裸连接(由 VEC0_OK 门控用例组) */
  }
  return db;
}

const VEC0_OK = probeVec0();

/** 受控四维伪向量:cosine 距离可手算,排序断言不靠运气。 */
const V = {
  same: new Float32Array([1, 0, 0, 0]),
  far: new Float32Array([0, 0, 0, 1]),
};

interface NodeSpec {
  id: string;
  name: string;
  sources: string[];
  families: string[];
  status?: string;
  updated?: string;
}

function rawNode(db: DatabaseSync, s: NodeSpec): void {
  db.prepare(
    `INSERT INTO graph_nodes (node_id, name, type, aliases_json, tags_json, current_state, facts_json,
       status, confidence, source_record_ids_json, families_json, created_time, updated_time)
     VALUES (?, ?, 'tool', '[]', '[]', '', '[]', ?, 0.8, ?, ?, '', ?)`,
  ).run(s.id, s.name, s.status ?? 'active', JSON.stringify(s.sources), JSON.stringify(s.families), s.updated ?? '2026-01-01T00:00:00.000Z');
}

function rawEdge(db: DatabaseSync, id: string, from: string, to: string, status = 'active'): void {
  db.prepare(
    `INSERT INTO graph_edges (edge_id, from_node_id, to_node_id, relation, status, valid_from, valid_to,
       confidence, source_record_ids_json, created_time, updated_time)
     VALUES (?, ?, ?, '依赖', ?, '', '', 0.8, '[]', '', '')`,
  ).run(id, from, to, status);
}

/** 装配一个含节点/边/向量的图谱(dimensions=4;vec 写入需 vec0 就绪)。 */
function makeGraph(
  nodes: NodeSpec[],
  edges: Array<[string, string, string?]>,
  vecRows: Array<{ id: string; v: Float32Array }> = [],
): { db: DatabaseSync; g: GraphStore } {
  const db = openVecDb();
  const g = new GraphStore();
  g.init(db, undefined, { dimensions: 4 });
  for (const n of nodes) rawNode(db, n);
  for (const [id, from, to, status] of edges) rawEdge(db, id, from, to, status ?? 'active');
  g.upsertNodeVectors(vecRows.map((r) => ({ nodeId: r.id, embedding: r.v })));
  return { db, g };
}

// 词法命不中 r2 场景的公共图:n-rust 词法可命中,n-cloud 只能靠向量种子到达
const BASE_NODES: NodeSpec[] = [
  { id: 'n-rust', name: 'Rust 语言', sources: ['r1'], families: ['work'] },
  { id: 'n-cloud', name: '云端深度', sources: ['r2'], families: ['work'] },
];
const BASE_VECS = [
  { id: 'n-rust', v: V.same },
  { id: 'n-cloud', v: V.same },
];

describe('searchLaneRecords —— 路内向量种子 + 1-hop 并集', () => {
  it('纯词法用例(不依赖 vec0):dimensions=0 → 传 embedding 也结构性降级为词法+hop', () => {
    const db = new DatabaseSync(':memory:');
    const g = new GraphStore();
    g.init(db, undefined, { dimensions: 0 });
    expect(g.nodeVecReady).toBe(false);
    rawNode(db, { id: 'n-a', name: 'Rust 语言', sources: ['ra'], families: ['work'] });
    rawNode(db, { id: 'n-b', name: '邻接节点', sources: ['rb'], families: ['work'] });
    rawEdge(db, 'e1', 'n-a', 'n-b');
    const withVec = g.searchLaneRecords('Rust', V.same, 5);
    expect(withVec).toEqual(['ra', 'rb']); // embedding 传了也没用——vec 表压根不存在
    db.close();
  });
});

describe.runIf(VEC0_OK)('searchLaneRecords —— vec0 就绪环境的种子语义', () => {
  it('embedding=undefined 与旧 searchNodes+graphHitRecordIds 表达式逐位一致', () => {
    const { db, g } = makeGraph(BASE_NODES, [], BASE_VECS);
    try {
      const legacy = graphHitRecordIds(g.searchNodes('Rust 语言', 5, ['work']));
      expect(g.searchLaneRecords('Rust 语言', undefined, 5, ['work'])).toEqual(legacy);
      expect(legacy).toEqual(['r1']);
    } finally {
      db.close();
    }
  });

  it('词法不可达的节点经向量种子进入,且**追加在词法命中之后**(顺序即 RRF 排名权重)', () => {
    const { db, g } = makeGraph(BASE_NODES, [], BASE_VECS);
    try {
      const out = g.searchLaneRecords('Rust 语言', V.same, 5, ['work']);
      expect(out[0]).toBe('r1'); // 词法命中的身份来源仍居首
      expect(out).toContain('r2'); // n-cloud 只靠向量种子到达
      expect(out.length).toBe(new Set(out).size); // 无重复
    } finally {
      db.close();
    }
  });

  it('同节点被词法与向量双命中 → 去重不双计', () => {
    const { db, g } = makeGraph(BASE_NODES, [], BASE_VECS);
    try {
      // 'n-rust' 与 'n-cloud' 向量同向;topK 内两枚种子都会回到 hits,
      // 但 n-rust 已在词法段——输出长度 = 两个节点来源的并集,不多不少
      const out = g.searchLaneRecords('Rust 语言', V.same, 5, ['work']);
      expect([...out].sort()).toEqual(['r1', 'r2']);
    } finally {
      db.close();
    }
  });

  it('族闸对向量种子生效:跨族种子被拒(宁可漏不可串)', () => {
    const nodes: NodeSpec[] = [
      { id: 'n-rust', name: 'Rust 语言', sources: ['r1'], families: ['work'] },
      { id: 'n-chat', name: '闲聊深度', sources: ['c1'], families: ['chat'] },
    ];
    const { db, g } = makeGraph(nodes, [], [
      { id: 'n-rust', v: V.same },
      { id: 'n-chat', v: V.same },
    ]);
    try {
      const out = g.searchLaneRecords('Rust 语言', V.same, 5, ['work']);
      expect(out).not.toContain('c1');
      expect(out).toContain('r1');
    } finally {
      db.close();
    }
  });

  it('状态闸对向量种子生效:superseded 节点不作种子', () => {
    const nodes: NodeSpec[] = [
      { id: 'n-rust', name: 'Rust 语言', sources: ['r1'], families: ['work'] },
      { id: 'n-old', name: '旧的深度', sources: ['ro'], families: ['work'], status: 'superseded' },
    ];
    const { db, g } = makeGraph(nodes, [], [
      { id: 'n-rust', v: V.same },
      { id: 'n-old', v: V.same },
    ]);
    try {
      const out = g.searchLaneRecords('Rust 语言', V.same, 5, ['work']);
      expect(out).not.toContain('ro');
    } finally {
      db.close();
    }
  });

  it('集成:向量种子节点参与 1-hop(邻居无向量行——只能经"种子→边"两步到达)', () => {
    const nodes: NodeSpec[] = [
      { id: 'n-rust', name: 'Rust 语言', sources: ['r1'], families: ['work'] },
      { id: 'n-cloud', name: '云端深度', sources: ['r2'], families: ['work'] },
      { id: 'n-extra', name: '邻接项目', sources: ['r3'], families: ['work'] },
    ];
    // n-extra 刻意不入 vec 表:KNN 返回不了它,只能由 n-cloud(种子)的 active 边 hop 到达
    const { db, g } = makeGraph(nodes, [['e1', 'n-cloud', 'n-extra']], [
      { id: 'n-rust', v: V.same },
      { id: 'n-cloud', v: V.same },
    ]);
    try {
      const out = g.searchLaneRecords('Rust 语言', V.same, 5, ['work']);
      expect(out).toEqual(['r1', 'r2', 'r3']); // 词法 → 向量种子 → 种子的 hop 邻居
    } finally {
      db.close();
    }
  });
});
