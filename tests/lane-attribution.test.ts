/**
 * 轨 B（D 系列）路归因 —— hybrid 融合给每条命中挂 `lanes`（来源路集合）。
 *
 * 钉死的性质：
 * ① **归因与路数语义同源**：未接线的路不出现在取值里（provider 缺省 → 无 'graph'）；
 *    衰减关 → 无 'recency'；单路检索策略（keyword/embedding）不挂归因（undefined）；
 * ② **零分数扰动**：挂 lanes 是纯附加字段，既有「双路 rank1 = 1.0」等分数判据不变；
 * ③ **确定性顺序**：路集按构造序 fts→vec→graph→recency，不随命中集抖动。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { L1Store } from '../src/store/l1.js';
import { MemoryDb } from '../src/store/sqlite.js';
import type { EmbeddingService } from '../src/store/embedding.js';
import type { MemoryRecord } from '../src/types.js';

const DIM = 16;
const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

function vecFor(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (let i = 0; i < text.length; i++) v[text.charCodeAt(i) % DIM] += 1;
  const mag = Math.sqrt(Array.from(v).reduce((s, x) => s + x * x, 0));
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

function rec(id: string, content: string): MemoryRecord {
  const t = Date.now();
  return { id, content, type: 'episodic', priority: 50, scene_name: 's', timestamps: [t], createdAt: t, updatedAt: t };
}

/** 伪造图谱命中已除——轨 A 后 provider 直接回链记录 id 串，见 setup.graphIds。 */

async function setup(records: MemoryRecord[], opts: {
  halfLifeDays?: number;
  /** 图谱路 provider(轨 A 新路形:直接回链记录 id 有序列)。 */
  graphIds?: () => readonly string[];
  strategy?: 'hybrid' | 'keyword' | 'embedding';
}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-lanes-'));
  dirs.push(dataDir);
  const db = new MemoryDb(join(dataDir, 'r.db'), DIM);
  db.init();
  const store = new L1Store(
    dataDir,
    db,
    fakeEmbed(),
    opts.strategy ?? 'hybrid',
    undefined,
    opts.halfLifeDays ?? 0,
    opts.graphIds ? () => opts.graphIds!() : undefined,
  );
  await store.init();
  await store.appendNew(records);
  return { db, store };
}

describe('轨 B 路归因(lanes)', () => {
  it('多路命中挂并集,图谱独占命中只挂 graph', async () => {
    const records = [rec('a', 'Rust 所有权模型'), rec('b', 'Go channel 调度')];
    const s = await setup(records, { graphIds: () => ['b'] });
    try {
      const hits = await s.store.search('Rust 所有权模型', 10);
      const a = hits.find((h) => h.id === 'a')!;
      const b = hits.find((h) => h.id === 'b')!;
      // a 由词法+向量命中(夹具同文),没有图谱回链
      expect(a.lanes).toBeDefined();
      expect(a.lanes).toContain('fts');
      expect(a.lanes).toContain('vec');
      expect(a.lanes ?? []).not.toContain('graph');
      // b 词面不含任何查询词 → FTS 必不命中;能进结果集只能是图谱路带来的
      // (假嵌入是字符哈希直方图，可能湮巧撞进向量候选——不断言独占)
      expect(b.lanes).toContain('graph');
      expect(b.lanes ?? []).not.toContain('fts');
      // 构造序确定性:fts 在 vec 前
      expect((a.lanes ?? []).indexOf('fts')).toBeLessThan((a.lanes ?? []).indexOf('vec'));
    } finally {
      s.db.close();
    }
  });

  it('衰减开启时 recency 进归因;关闭时不出现(与路数语义同源)', async () => {
    const records = [rec('a', 'Rust 所有权模型')];
    const on = await setup(records, { halfLifeDays: 30 });
    const off = await setup(records, { halfLifeDays: 0 });
    try {
      const hitOn = (await on.store.search('Rust 所有权模型', 5))[0];
      const hitOff = (await off.store.search('Rust 所有权模型', 5))[0];
      expect(hitOn.lanes).toContain('recency');
      expect(hitOff.lanes ?? []).not.toContain('recency');
    } finally {
      on.db.close();
      off.db.close();
    }
  });

  it('零分数扰动:未接图谱、关衰减时双路 rank1 仍恰为 1.0(既有不变量不回归)', async () => {
    const records = [rec('a', 'Rust 所有权模型详解')];
    const s = await setup(records, {});
    try {
      const a = (await s.store.search('Rust 所有权模型详解', 5)).find((h) => h.id === 'a')!;
      expect(a.score).toBe(1);
    } finally {
      s.db.close();
    }
  });

  it('单路检索策略不挂归因(keyword = 纯 FTS,无歧义可归)', async () => {
    const records = [rec('a', 'Rust 所有权模型')];
    const s = await setup(records, { strategy: 'keyword' });
    try {
      const a = (await s.store.search('Rust 所有权模型', 5)).find((h) => h.id === 'a')!;
      expect(a.lanes).toBeUndefined();
    } finally {
      s.db.close();
    }
  });
});
