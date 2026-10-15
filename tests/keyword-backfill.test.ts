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
const llmCalls: Array<{ system?: string; user?: string; layer?: string; reasoningEffort?: string }> = [];
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

const { labelKeywordOne, runKeywordBackfillOnce } = await import('../src/keyword-backfill.js');

const warned: string[] = [];
const logger = { info: () => {}, warn: (m: string) => warned.push(m), error: () => {}, debug: () => {} } as unknown as MemoryLogger;
const cfg = {} as MemoryConfig;
const ctx = {} as Context;
function rec(id: string, content = '内容'): MemoryRecord {
  return { id, content } as unknown as MemoryRecord;
}

describe('labelKeywordOne 解析契约（一个请求只装一条）', () => {
  it('接受合法输出；normKeywords 去重 + 截 ≤5', async () => {
    warned.length = 0;
    llmReplies.push(JSON.stringify({ keywords: ['a', 'b', 'a', 'c', 'd', 'e', 'f'], usage_scenario: ['x', 'y'] }));
    const out = await labelKeywordOne(ctx, cfg, logger, rec('m1'));
    expect(out).not.toBeNull();
    expect(out!.keywords).toEqual(['a', 'b', 'c', 'd', 'e']); // 去重 'a' + 上限 5
    expect(out!.usageScenario).toEqual(['x', 'y']);
  });

  it('模型回单元素数组也能解', async () => {
    llmReplies.push(JSON.stringify([{ keywords: ['k1'], usage_scenario: [] }]));
    expect((await labelKeywordOne(ctx, cfg, logger, rec('m1')))?.keywords).toEqual(['k1']);
  });

  it('keywords 全空/非法 → null（不写空关键词轴，不静默）', async () => {
    warned.length = 0;
    llmReplies.push(JSON.stringify({ keywords: ['', '  '] }));
    expect(await labelKeywordOne(ctx, cfg, logger, rec('m1'))).toBeNull();
    expect(warned.some((w) => w.includes('normKeywords 结果为空'))).toBe(true);
  });

  it('系统提示词含反例(禁抽象压缩词)且是单条形状（输出对象、不要求回写 id）', async () => {
    llmCalls.length = 0;
    llmReplies.push('null');
    await labelKeywordOne(ctx, cfg, logger, rec('m1'));
    const sys = llmCalls[0]?.system ?? '';
    expect(sys).toContain('批量流量判定'); // 明确列出的抽象反例
    expect(sys).toContain('keywords');
    expect(sys, '单条形状：输出一个对象').toContain('一个 JSON 对象');
    expect(sys, '逐条后不再要求回写 id').not.toContain('原样照抄');
    expect(llmCalls[0]?.user, 'user 只装一条').not.toContain('记忆列表');
    expect(llmCalls[0]?.reasoningEffort, '必须显式关思考（否则 512 预算被 reasoning 吃光→空输出）').toBe('off');
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
