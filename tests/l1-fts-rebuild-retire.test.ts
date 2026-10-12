/**
 * 退场不变量在**旁路写路径**上的回归（文件↔库权威模型的地基）。
 *
 * `retire` 的“移出检索面”本来只在**写入漏斗**上强制（`upsertL1InTx` 的 `retiredNow`）。
 * 但有两处写检索面是**绕过漏斗**的，它们若不共用同一退场判据，“标失效”就会静默失效：
 *
 * 1. **FTS 重建回灌** `backfillL1Fts`：一次分词器版本戳变更就把整批已退场记录
 *    放回关键词面。低频，但升级/换分词器时一次就全量中招——已实测坐实。
 * 2. **增量重嵌入取数与补齐判据** `getL1ForReindex` / `countVecMissing`：
 *    退场时 `detachL1FromRetrieval` 删了向量行，于是该记录永远算“缺向量”；
 *    取数不排除它 → `updateL1VecBatch`（直插 `l1_vec`）把向量塞回去 → **向量面复活**。
 *    这一轮 30 分钟就来一次，比 FTS 重建常见得多；判据不排除它 → 补齐永不收敛。
 *
 * 症状都落在最难查的位置：面板“已退场”列表里有它、`valid_to` 是闭合的，
 * 但检索照样命中——用户看到的“标失效”实际没生效。
 *
 * 每个用例都带**反向对照**，防止断言因为“查询恒空/环境无向量能力”而假绿。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { L1Store } from '../src/store/l1.js';
import { MemoryDb } from '../src/store/sqlite.js';
import type { EmbeddingService } from '../src/store/embedding.js';
import type { MemoryRecord } from '../src/types.js';

const DIM = 16;
const AT = '2026-10-12T00:00:00.000Z';
const KEEP = 'mem_keep_fts';
const GONE = 'mem_retired_fts';
const Q = '部署脚本 evidence';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

function vecFor(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (let i = 0; i < text.length; i++) v[text.charCodeAt(i) % DIM] += 1;
  const mag = Math.sqrt(v.reduce((s, x) => s + (x as number) * (x as number), 0));
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
  return { id, content, type: 'work_fact', priority: 60, scene_name: 's', timestamps: [t], createdAt: t, updatedAt: t };
}

const ids = (hits: Array<{ id: string }>) => hits.map((h) => h.id);

/**
 * 把 FTS 分词器版本戳写成陈旧值，逼下一次 `init()` 走"drop + 全量回灌"分支
 * (重建判据 b：`readMetaString('fts_tokenizer') !== tokenizerStamp()`)。
 * 必须**关库之后**做，否则与库内 WAL 状态打架。
 */
function forceFtsRebuild(dbPath: string): void {
  const raw = new DatabaseSync(dbPath);
  raw
    .prepare("INSERT INTO embedding_meta (key, value) VALUES ('fts_tokenizer', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run('probe-stale-stamp');
  raw.close();
}

describe('FTS 重建不得把已退场记录放回检索面', () => {
  it('分词器戳变更 → 重建 → 退场记录仍不可见，活跃邻居仍在', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'dsh-fts-rebuild-'));
    dirs.push(dataDir);
    const dbPath = join(dataDir, 'r.db');

    // ── 第一代库生命周期：写入 → 退场 → 确认已撤出检索面 ──
    let db = new MemoryDb(dbPath, DIM);
    db.init();
    let store = new L1Store(dataDir, db, fakeEmbed(), 'hybrid', undefined, 0);
    await store.init();
    await store.appendNew([
      rec(GONE, '部署脚本 evidence 目录 回滚逻辑'),
      rec(KEEP, '咖啡豆每周采购一次'),
    ]);
    expect(ids(await store.search(Q, 5)), '基线:退场前应能检索到').toContain(GONE);

    expect(store.retire([GONE], { at: AT, reason: 'obsolete' })).toBe(1);
    expect(ids(await store.search(Q, 5)), '退场后立刻不可见(漏斗口径)').not.toContain(GONE);
    db.close();

    // ── 强制重建，模拟"用户升级后换了分词器" ──
    forceFtsRebuild(dbPath);

    db = new MemoryDb(dbPath, DIM);
    db.init();
    store = new L1Store(dataDir, db, fakeEmbed(), 'hybrid', undefined, 0);
    await store.init();

    expect(db.searchL1Fts(Q, 10).map((h) => h.id), '① 回灌不得带上退场行').not.toContain(GONE);
    expect(ids(await store.search(Q, 5)), '② 对外检索面同样看不到').not.toContain(GONE);
    expect(ids(await store.search('咖啡豆', 5)), '③ 活跃邻居必须照样回灌(防假修复)').toContain(KEEP);

    // 主表行仍在(可恢复的载体没被破坏)，只是不进检索面
    const [row] = store.getByIds([GONE]);
    expect(row, '主表行必须保留').toBeDefined();
    expect(row.validTo).toBe(Date.parse(AT));

    db.close();
  });
});

/**
 * 同一个病灶的第二处（且更常触发）：增量重嵌入的**取数**与补齐**判据**。
 *
 * 退场时 `detachL1FromRetrieval` 删掉向量行，于是这条记录从此永远算“缺向量”。
 * 若取数不看退场态，`updateL1VecBatch`（直插 `l1_vec`、不经 upsert 漏斗）就会把
 * 向量塞回去——退场记录在**向量检索面**复活，而这一轮只要 30 分钟就来一次，
 * 不需要分词器变更那种低频条件。
 */
describe('增量重嵌入不得把退场记录塞回向量面', () => {
  it('退场行既不进 reindex 取数、也不计入补齐判据', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'dsh-vec-rebuild-'));
    dirs.push(dataDir);
    const dbPath = join(dataDir, 'v.db');
    const db = new MemoryDb(dbPath, DIM);
    db.init();
    const store = new L1Store(dataDir, db, fakeEmbed(), 'hybrid', undefined, 0);
    await store.init();
    await store.appendNew([
      rec(GONE, '部署脚本 evidence 目录 回滚逻辑'),
      rec(KEEP, '咖啡豆每周采购一次'),
    ]);

    // 能力探测：-1 = 本环境无向量能力（`l1_vec` 不存在）——该面在本环境不适用，
    // **不假装绿**；退场口径由上面的 FTS 用例在同样环境里实跑守住。
    const baseMissing = db.countL1VecMissing();
    if (baseMissing < 0) {
      db.close();
      return;
    }

    store.retire([GONE], { at: AT, reason: 'obsolete' });

    // 反向对照（没有它，下面两条可能是“查询恒空”带来的假绿）：
    // 直接走 `db.upsertL1` 塞一条**不带向量**的活跃行——它该被当成“缺向量”。
    // 机制要是真的在工作，它必须出现在清单里并被计入判据。
    const THIRD = 'mem_novec_fts';
    db.upsertL1(rec(THIRD, '测试夹具 无向量活跃行'));
    expect(db.getL1ForReindex().map((r) => r.id), '对照:缺向量的活跃行必须进清单').toContain(THIRD);
    expect(db.countL1VecMissing(), '对照:缺向量的活跃行必须被计入').toBe(baseMissing + 1);

    // 取数侧：退场时 `detachL1FromRetrieval` 已删掉它的向量行——它**真的**缺向量，
    // 所以“不在清单里”只能是因为排除了退场行，不是因为没东西可列。
    const input = db.getL1ForReindex().map((r) => r.id);
    expect(input, '待重嵌清单不能有退场行').not.toContain(GONE);
    // 判据侧：退场行不算“还差”——否则补齐永不收敛、每轮白跑（对照已证 +1 机制有效，
    // 若不排除应为 +2）。
    expect(db.countL1VecMissing(), '退场行不得算进缺向量判据').toBe(baseMissing + 1);

    db.close();
  });
});
