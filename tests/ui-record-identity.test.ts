/**
 * 投射身份字段透传到面板（`UiRecord.name` / `scope` / `workspaceId` / `keywords`）。
 *
 * 为什么单独钉这一条：作者要核对“这条记忆对应哪个投射文件、对谁可见”——而这三个
 * 值（名称 / 可见范围 / 归属工作区）此前**从不进 UiRecord**，于是面板上永远对不上。
 * 名称就是投射文件的命名来源，缺它就没法与磁盘上的 `<type>/<name>.memory.md` 对齐。
 *
 * `keywords` 是**预留**字段（当前无产出方），它的整条意义是参与 BM25；所以这里不只
 * 钉映射，还用真库证明「正文不含该词、关键词含 → 能被 BM25 命中」，并带反向对照，
 * 免得断言因为查询恒空而假绿。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { hitToUiRecord } from '../src/stats.js';
import { L1Store } from '../src/store/l1.js';
import { MemoryDb } from '../src/store/sqlite.js';
import type { EmbeddingService } from '../src/store/embedding.js';
import type { MemoryRecord } from '../src/types.js';

const DIM = 16;
const dirs: string[] = [];
const dbs: MemoryDb[] = [];

/** Windows 上 sqlite 的 wal 会短暂握着临时目录（EBUSY），清理必须可重试。 */
async function rmRetry(p: string, tries = 6): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      await rm(p, { recursive: true, force: true });
      return;
    } catch (err) {
      if (i === tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
}

afterAll(async () => {
  for (const db of dbs) {
    try { db.close(); } catch { /* 已关/未开都不阻断清理 */ }
  }
  for (const d of dirs) await rmRetry(d);
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
function rec(id: string, content: string, metadata?: Record<string, unknown>): MemoryRecord {
  const t = Date.now();
  return { id, content, type: 'work_fact', priority: 60, scene_name: 's', timestamps: [t], createdAt: t, updatedAt: t, metadata };
}

describe('hitToUiRecord：投射身份字段', () => {
  const base = { id: 'mem_x', content: 'c', type: 'work_fact', scene_name: 's' };

  it('名称原样带出；无名字 → null（面板据此显示“未命名”并回落 mem-<id8>）', () => {
    expect(hitToUiRecord({ ...base, name: '代码审查技能目录' } as never).name).toBe('代码审查技能目录');
    expect(hitToUiRecord(base as never).name).toBeNull();
  });

  it("作用范围：只有 scope='workspace' 才带归属；其余（含缺省）归一 global 且不带归属", () => {
    const ws = hitToUiRecord({ ...base, scope: 'workspace', workspaceId: 'E:/proj' } as never);
    expect(ws.scope).toBe('workspace');
    expect(ws.workspaceId).toBe('E:/proj');
    // global 记录即使脏带了 workspaceId，也必须还原成“无归属”——否则面板会把它
    // 显示成“指定工作区”，而检索侧根本不会按这个工作区隔离它（两处口径打架）。
    const gl = hitToUiRecord({ ...base, scope: 'global', workspaceId: 'E:/proj' } as never);
    expect(gl.scope).toBe('global');
    expect(gl.workspaceId).toBeNull();
    expect(hitToUiRecord(base as never).scope).toBe('global');
  });

  it('关键词从保留键 dsh_keywords 读出（滤掉非串/空串）；无键 → undefined（缺席 ≠ 空数组）', () => {
    expect(hitToUiRecord({ ...base, metadata: { dsh_keywords: ['BM25', '检索轴'] } } as never).keywords).toEqual(['BM25', '检索轴']);
    expect(hitToUiRecord({ ...base, metadata: { dsh_keywords: ['ok', '', 5] } } as never).keywords).toEqual(['ok']);
    expect(hitToUiRecord(base as never).keywords).toBeUndefined();
  });
});

describe('关键词参与 BM25（只进检索轴，不改正文原文）', () => {
  it('正文不含该词、关键词含 → 能命中；无关键词的邻居不命中；正文含该词时同样命中（反向对照）', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'dsh-kw-fts-'));
    dirs.push(dataDir);
    const db = new MemoryDb(join(dataDir, 'l1.db'), DIM);
    db.init();
    dbs.push(db);
    const store = new L1Store(dataDir, db, fakeEmbed(), 'keyword', undefined, 0);
    await store.init();

    // 选一个正文里绝不出现的词，确保命中只可能来自关键词轴。
    const term = '苜蓿籽';
    await store.appendNew([rec('kw1', '一条与检索词无关的正文', { dsh_keywords: [term] })]);
    await store.appendNew([rec('plain', '另一条与检索词无关的正文')]);

    const hit = await store.search(term, 10);
    expect(hit.map((h) => h.id)).toContain('kw1');
    expect(hit.map((h) => h.id)).not.toContain('plain');

    // 反向对照：正文里直接写着该词 → 无关键词的那条也命中。证明查询本身有效，
    // 上面的“命中 kw1”不是因为查询恒空/恒中。
    await store.appendNew([rec('plain2', `正文里直接写着${term}`)]);
    const hit2 = await store.search(term, 10);
    expect(hit2.map((h) => h.id)).toContain('plain2');
  });
});
