/**
 * 关键词蒸馏回填的回归测试。
 *
 * 钉三件最关键的事（对应 findings 的 R1/R2 风险）：
 * 1. **FTS 关键词轴真的被激活**——回填写 `dsh_keywords` 后，BM25 能命中一个「正文里根本没有、
 *    只进了关键词轴」的词；并用反向对照证明「只 patchMetadata 不重索引 → 不命中」，
 *    防止 R1（写了关键词但检索看不到）被假绿掩盖。
 * 2. **门控关零漂移**——`keyword.enabled=false` 时回填不触碰 backend（不产键、不动 fts）。
 * 3. **解析契约**——字段名 keywords、id 配对失败留痕、全非法不写空。
 *
 * LLM 桩范式取自 tests/wing-label-parse.test.ts；真库 FTS 取自 tests/l1-fts-rebuild-retire.test.ts
 * （bare DatabaseSync 能碰 FTS5，但碰不了 vec0，故向量不参与本用例）。
 */
import { describe, expect, it, vi, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { MemoryLogger, MemoryRecord } from '../src/types.js';
import type { MemoryConfig } from '../src/config.js';
import { L1Store } from '../src/store/l1.js';
import { MemoryDb } from '../src/store/sqlite.js';
import type { InProcMemoryBackend } from '../src/store/memory-backend.js';
import type { EmbeddingService } from '../src/store/embedding.js';

// ── LLM 桩：按序吐预设回复，记录每次调用（供断言提示词内容）──
const llmReplies: string[] = [];
const llmCalls: Array<{ system?: string; user?: string; layer?: string }> = [];
vi.mock('../src/llm.js', async (io) => {
  const actual = await io<typeof import('../src/llm.js')>();
  return {
    ...actual,
    callLLM: vi.fn(async (_c: unknown, _cfg: unknown, opts: { system?: string; user?: string; layer?: string }) => {
      llmCalls.push(opts);
      return llmReplies.shift() ?? '[]';
    }),
  };
});

const { labelKeywordChunk, runKeywordBackfillOnce } = await import('../src/keyword-backfill.js');

const warned: string[] = [];
const logger = { info: () => {}, warn: (m: string) => warned.push(m), error: () => {}, debug: () => {} } as unknown as MemoryLogger;
const cfg = {} as MemoryConfig;
const ctx = {} as Context;
function rec(id: string, content = '内容'): MemoryRecord {
  return { id, content } as unknown as MemoryRecord;
}

describe('labelKeywordChunk 解析契约', () => {
  it('接受合法输出；normKeywords 去重 + 截 ≤5', async () => {
    warned.length = 0;
    llmReplies.push(JSON.stringify([{ id: 'm1', keywords: ['a', 'b', 'a', 'c', 'd', 'e', 'f'], usage_scenario: ['x', 'y'] }]));
    const out = await labelKeywordChunk(ctx, cfg, logger, [rec('m1')]);
    expect(out).toHaveLength(1);
    expect(out[0].record.id).toBe('m1');
    expect(out[0].keywords).toEqual(['a', 'b', 'c', 'd', 'e']); // 去重 'a' + 上限 5
    expect(out[0].usageScenario).toEqual(['x', 'y']);
  });

  it('id 配对失败被丢弃且留痕（不许静默）', async () => {
    warned.length = 0;
    llmReplies.push(JSON.stringify([{ id: 'ghost', keywords: ['k1'] }]));
    expect(await labelKeywordChunk(ctx, cfg, logger, [rec('m1')])).toEqual([]);
    expect(warned.some((w) => w.includes('id 配对失败'))).toBe(true);
  });

  it('keywords 全空/非法 → 该条跳过（不写空关键词轴）', async () => {
    warned.length = 0;
    llmReplies.push(JSON.stringify([{ id: 'm1', keywords: ['', '  '] }]));
    expect(await labelKeywordChunk(ctx, cfg, logger, [rec('m1')])).toEqual([]);
    expect(warned.some((w) => w.includes('normKeywords 结果为空'))).toBe(true);
  });

  it('系统提示词含反例(禁抽象压缩词)与 id 照抄约束（字段名与解析同源）', async () => {
    llmCalls.length = 0;
    llmReplies.push('[]');
    await labelKeywordChunk(ctx, cfg, logger, [rec('m1')]);
    const sys = llmCalls[0]?.system ?? '';
    expect(sys).toContain('批量流量判定'); // 明确列出的抽象反例
    expect(sys).toContain('原样照抄');
    expect(sys).toContain('keywords');
  });
});

// ── 真库：patchMetadataAndReindex 是否让关键词轴进 BM25 ──
const DIM = 16;
const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});
function vecFor(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (let i = 0; i < text.length; i++) v[text.charCodeAt(i) % DIM] += 1;
  const m = Math.sqrt(Array.from(v).reduce((s, x) => s + x * x, 0));
  if (m > 1e-10) for (let i = 0; i < DIM; i++) v[i] /= m;
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
function mk(id: string, content: string): MemoryRecord {
  const t = Date.now();
  return { id, content, type: 'work_fact', priority: 60, scene_name: 's', timestamps: [t], createdAt: t, updatedAt: t } as unknown as MemoryRecord;
}

describe('patchMetadataAndReindex 激活关键词轴（R1 反向对照）', () => {
  it('回填后 BM25 命中「只进关键词轴、正文不含」的词；纯 patchMetadata 不重索引则不命中', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'dsh-kw-fts-'));
    dirs.push(dataDir);
    const dbPath = join(dataDir, 'k.db');
    const db = new MemoryDb(dbPath, DIM);
    db.init();
    const store = new L1Store(dataDir, db, fakeEmbed(), 'hybrid', undefined, 0);
    await store.init();
    await store.appendNew([mk('kw1', '部署脚本 目录 回滚逻辑')]);
    const KW = 'zebrakeyword';

    // 基线：正文不含该词 → 检索不到
    expect(db.searchL1Fts(KW, 10).map((h) => h.id), '基线:正文不含').not.toContain('kw1');

    // 反向对照：只 patchMetadata（不重索引）→ fts 未变 → 仍不命中（证明“写元数据≠进检索面”）
    store.patchMetadata('kw1', { dsh_keywords: [KW] });
    expect(db.searchL1Fts(KW, 10).map((h) => h.id), 'patchMetadata 不碰 fts（若这里就命中说明对照失效）').not.toContain('kw1');

    // 正解：patchMetadataAndReindex → 关键词轴命中
    store.patchMetadataAndReindex('kw1', { dsh_keywords: [KW] });
    expect(db.searchL1Fts(KW, 10).map((h) => h.id), '重索引后关键词轴命中').toContain('kw1');

    db.close();
  });
});

describe('门控关零漂移（R2）', () => {
  it('keyword.enabled=false → 回填不触碰任何 backend 方法', async () => {
    const spy = {
      size: vi.fn(async () => 0),
      allLite: vi.fn(async () => []),
      getByIds: vi.fn(async () => []),
      list: vi.fn(async () => ({ items: [], total: 0 })),
      patchMetadata: vi.fn(async () => true),
      patchMetadataAndReindex: vi.fn(async () => true),
      dispose: vi.fn(async () => {}),
    };
    const offCfg = { keyword: { enabled: false }, backfill: { maxRecords: 300, timeBudgetMs: 120_000 } } as unknown as MemoryConfig;
    await runKeywordBackfillOnce({ ctx, cfg: offCfg, backend: spy as unknown as InProcMemoryBackend, logger });
    expect(spy.size).not.toHaveBeenCalled();
    expect(spy.patchMetadataAndReindex).not.toHaveBeenCalled();
    expect(spy.patchMetadata).not.toHaveBeenCalled();
  });
});
