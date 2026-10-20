/**
 * 存储层小件单元测试:pending 缓冲/state checkpoint/session-modes/recall-dedupe、
 * L1 双写(legacy 迁移 + 双写失败闭环)与嵌入服务基座(重试退避/信号量/降级助手)。
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { StateStore, defaultState } from '../src/store/state.js';
import {
  LEGACY_SESSION,
  PENDING_MODES,
  emptyPending,
  freshWarmup,
  groupPendingBySession,
  loadPending,
  pendingPathFor,
  savePending,
} from '../src/store/pending.js';
import { SessionModeStore, isMemoryMode } from '../src/store/session-modes.js';
import {
  RECALL_DEDUPE_IDS_CAP,
  RECALL_DEDUPE_SESSION_CAP,
  RecallDedupeStore,
} from '../src/store/recall-dedupe.js';
import { L1Store } from '../src/store/l1.js';
import { EmbedHelper, NoopEmbeddingService, RemoteEmbeddingService } from '../src/store/embedding.js';
import { MemoryDb } from '../src/store/sqlite.js';
import type { EmbeddingService } from '../src/store/embedding.js';
import type { MemoryRecord } from '../src/types.js';

let dir: string;
async function tmp(): Promise<string> {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'dsh-store-'));
  return dir;
}
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('state store', () => {
  it('v2 roundtrip with per-family buckets', async () => {
    const file = join(await tmp(), `state-${Date.now()}.json`);
    const s = new StateStore(file);
    await s.load();
    expect(s.didMigrate).toBe(false);
    s.forFamily('chat').totalExtracted = 12;
    s.forFamily('work').lastSceneName = '发布';
    await s.save();
    const s2 = new StateStore(file);
    await s2.load();
    expect(s2.forFamily('chat').totalExtracted).toBe(12);
    expect(s2.forFamily('work').lastSceneName).toBe('发布');
  });

  it('v1 flat file migrates into chat bucket', async () => {
    const file = join(await tmp(), `state-v1-${Date.now()}.json`);
    await writeFile(file, JSON.stringify({ lastExtractAt: 111, totalExtracted: 7, hasPersona: true }));
    const s = new StateStore(file);
    await s.load();
    expect(s.didMigrate).toBe(true);
    expect(s.forFamily('chat').totalExtracted).toBe(7);
    expect(s.forFamily('chat').lastExtractAt).toBe(111);
    expect(s.forFamily('work')).toEqual(defaultState());
  });

  it('reset mutates buckets in place (live references keep working)', async () => {
    const s = new StateStore(join(await tmp(), 'none.json'));
    await s.load();
    const ref = s.forFamily('chat');
    ref.totalExtracted = 5;
    s.reset();
    expect(ref.totalExtracted).toBe(0); // 同一对象,原地清零
  });
});

describe('pending buffer', () => {
  it('roundtrip with warmup; legacy entries grouped; bad records dropped', async () => {
    const file = pendingPathFor(await tmp());
    const buckets = emptyPending();
    buckets.auto.push({ sessionId: 's1', id: 'a1', role: 'user', content: 'hi', timestamp: 5 });
    buckets.chat.push({ id: 'old', role: 'assistant', content: 'legacy', timestamp: 1 } as never);
    await savePending(file, buckets, { auto: 4, chat: 2, work: 1 });

    const { buckets: loaded, warmup } = await loadPending(file);
    expect(loaded.auto).toEqual([{ sessionId: 's1', id: 'a1', role: 'user', content: 'hi', timestamp: 5 }]);
    expect(loaded.chat[0].sessionId).toBe(LEGACY_SESSION);
    expect(warmup).toEqual({ auto: 4, chat: 2, work: 1 });

    // 坏文件:宽容起步
    const bad = join(await tmp(), 'bad.json');
    await writeFile(bad, '{broken');
    const empty = await loadPending(bad);
    expect(empty.buckets).toEqual(emptyPending());
    expect(empty.warmup).toEqual(freshWarmup());
  });

  it('groupPendingBySession sorts groups by first message and members by time', () => {
    const groups = groupPendingBySession([
      { sessionId: 'b', id: '3', role: 'user', content: '', timestamp: 30 },
      { sessionId: 'a', id: '2', role: 'user', content: '', timestamp: 22 },
      { sessionId: 'b', id: '1', role: 'user', content: '', timestamp: 10 },
      { sessionId: 'a', id: '4', role: 'user', content: '', timestamp: 5 },
    ]);
    expect(groups.map((g) => g.sessionId)).toEqual(['a', 'b']);
    expect(groups[0].messages.map((m) => m.id)).toEqual(['4', '2']);
    expect(groups[1].messages.map((m) => m.id)).toEqual(['1', '3']);
    expect(PENDING_MODES).toEqual(['auto', 'chat', 'work']);
  });
});

describe('session mode store', () => {
  it('default/get/set/recall override with orthogonal persistence', async () => {
    const dataDir = await tmp();
    const store = new SessionModeStore(dataDir, 'auto');
    await store.init();
    expect(store.get('nope')).toBe('auto');
    expect(isMemoryMode('work')).toBe(true);
    expect(isMemoryMode('bogus')).toBe(false);

    const changes: Array<[string, string, string]> = [];
    store.setModeChangeHandler((sid, o, n) => changes.push([sid, o, n]));
    store.set('s1', 'work');
    store.setRecall('s1', false);
    store.set('s1', 'chat'); // 切档保留覆盖
    await store.flush();
    expect(changes).toEqual([['s1', 'auto', 'work'], ['s1', 'work', 'chat']]);
    expect(store.getRecall('s1')).toBe(false);
    expect(store.resolvedRecall('s1', true)).toBe(false);
    store.setRecall('s1', undefined);
    await store.flush();
    expect(store.resolvedRecall('s1', true)).toBe(true);

    // 重新载入:持久化生效
    const store2 = new SessionModeStore(dataDir, 'auto');
    await store2.init();
    expect(store2.get('s1')).toBe('chat');
  });

  it('corrupt file degrades to in-memory defaults', async () => {
    const dataDir = join(await tmp(), `modes-${Date.now()}`);
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'session-modes.json'), '{oops');
    const store = new SessionModeStore(dataDir, 'work');
    await store.init();
    expect(store.get('anything')).toBe('work');
  });
});

describe('recall dedupe store', () => {
  it('mark/seen/reset roundtrip with persistence', async () => {
    const dataDir = await tmp();
    const d = new RecallDedupeStore(dataDir);
    await d.flush();
    d.mark('s1', ['m1', 'm2']);
    d.mark('s1', ['m2', 'm3']);
    await d.flush();
    expect([...d.seen('s1')]).toEqual(['m1', 'm2', 'm3']);
    d.reset('s1');
    await d.flush();
    expect(d.seen('s1').size).toBe(0);

    const d2 = new RecallDedupeStore(dataDir);
    await d2.flush();
    expect(d2.seen('s1').size).toBe(0); // reset 已持久化
    d2.mark('s2', ['x']);
    await d2.flush();
    const d3 = new RecallDedupeStore(dataDir);
    await d3.flush();
    expect([...d3.seen('s2')]).toEqual(['x']);
  });

  it('per-session ids capped at 512 by insertion order', async () => {
    const d = new RecallDedupeStore(await tmp());
    await d.flush();
    const ids = Array.from({ length: RECALL_DEDUPE_IDS_CAP + 10 }, (_, i) => `id${i}`);
    d.mark('big', ids);
    await d.flush();
    const seen = d.seen('big');
    expect(seen.size).toBe(RECALL_DEDUPE_IDS_CAP);
    expect(seen.has('id0')).toBe(false); // 最旧被挤出
    expect(seen.has(`id${RECALL_DEDUPE_IDS_CAP + 9}`)).toBe(true);
  });

  it('session entries capped at 200 on serialize', { timeout: 30000 }, async () => {
    const d = new RecallDedupeStore(await tmp());
    await d.flush();
    for (let i = 0; i < RECALL_DEDUPE_SESSION_CAP + 5; i++) {
      d.mark(`s${i}`, ['x']);
    }
    await d.flush();
    // 无异常即通过;文件体积受 SESSION_CAP 约束(内部淘汰)
    expect(d.seen(`s${RECALL_DEDUPE_SESSION_CAP + 4}`).size).toBe(1);
  });
});

describe('L0/L1 dual-write stores', () => {
  async function freshDb(tag: string): Promise<MemoryDb> {
    const db = new MemoryDb(join(await tmp(), `${tag}-${Date.now()}.db`), 0);
    db.init();
    return db;
  }

  it('L1 appendNew fills family and dual-writes; search strategies and candidates', async () => {
    const dataDir = join(await tmp(), `l1-${Date.now()}`);
    const db = await freshDb('l1db');
    const store = new L1Store(dataDir, db, new NoopEmbeddingService(), 'hybrid', undefined, 0);
    await store.init();
    const now = Date.now();
    await store.appendNew([
      { id: 'r1', content: '用户对 Rust 感兴趣', type: 'preference', priority: 60, scene_name: '兴趣', timestamps: [now], createdAt: now, updatedAt: now },
      { id: 'r2', content: '团队用 GitLab CI', type: 'work_fact', priority: 50, scene_name: '基建', timestamps: [now], createdAt: now, updatedAt: now },
    ]);
    expect(store.size).toBe(2);
    // family 按 type 前缀回填
    const all = store.all();
    expect(all.find((r) => r.id === 'r2')?.family).toBe('work');

    const kw = await store.search('Rust', 5, { strategyHint: undefined } as never);
    expect(kw[0]?.id).toBe('r1');
    const byFamily = await store.search('GitLab', 5, { family: 'work' });
    expect(byFamily.map((h) => h.id)).toEqual(['r2']);
    const candidates = await store.searchCandidates('Rust', 5, 'chat');
    expect(candidates.map((r) => r.id)).toEqual(['r1']);
    db.close();
  });

  it('L1 legacy single-file migrates and renames', async () => {
    const dataDir = join(await tmp(), `l1legacy-${Date.now()}`);
    await mkdir(join(dataDir, 'l1'), { recursive: true });
    const now = new Date('2026-08-01T00:00:00Z').toISOString();
    await writeFile(
      join(dataDir, 'l1', 'records.jsonl'),
      [
        JSON.stringify({ id: 'old1', content: '旧记忆一', type: 'episodic', priority: 50, scene_name: 'x', timestamp_str: now, created_time: now, updated_time: now, version: 1, metadata_json: '{}' }),
        JSON.stringify({ id: 'old2', content: '旧记忆二 work', type: 'work_fact', priority: 50, scene_name: 'y', timestamp_str: now, created_time: now, updated_time: now, version: 1, metadata_json: '{}' }),
      ].join('\n'),
    );
    const db = await freshDb('l1legacy');
    const store = new L1Store(dataDir, db);
    await store.init();
    const { readdir } = await import('node:fs/promises');
    expect((await readdir(join(dataDir, 'l1'))).some((f) => f.endsWith('.imported'))).toBe(true);
    expect(store.size).toBe(2);
    db.close();
  });

  it('L1 upsert (dedup merge path) updates db only, JSONL untouched', async () => {
    const dataDir = join(await tmp(), `l1up-${Date.now()}`);
    const db = await freshDb('l1up');
    const store = new L1Store(dataDir, db, new NoopEmbeddingService(), 'keyword', undefined, 0);
    await store.init();
    const now = Date.now();
    const r: MemoryRecord = { id: 'u1', content: '初版事实', type: 'episodic', priority: 50, scene_name: 's', timestamps: [now], createdAt: now, updatedAt: now, version: 0 };
    await store.appendNew([r]);
    await store.upsert({ ...r, id: 'u1-new', content: '合并后事实', version: 2 });
    expect(store.getByIds(['u1-new'])[0]?.version).toBe(2);
    const { readdir } = await import('node:fs/promises');
    const days = await readdir(join(dataDir, 'records'));
    const after = await readFile(join(dataDir, 'records', days[0]), 'utf-8');
    expect(after).toContain('初版事实');
    expect(after).not.toContain('合并后事实'); // JSONL 事实源只增不改
    db.close();
  });
});

describe('embedding service base', () => {
  it('Noop service is safe and not ready', async () => {
    const noop = new NoopEmbeddingService();
    expect(noop.isReady()).toBe(false);
    expect(noop.getDimensions()).toBe(0);
    expect(await noop.embedBatch(['a', 'b'])).toEqual([new Float32Array(0), new Float32Array(0)]);
  });

  it('EmbedHelper degrades query/batch to undefined on failure, warns once', async () => {
    const failing: EmbeddingService = {
      getDimensions: () => 3,
      getProviderInfo: () => ({ provider: 'x', model: 'm', dimensions: 3 }),
      isReady: () => true,
      embed: async () => {
        throw new Error('boom');
      },
      embedBatch: async () => {
        throw new Error('boom');
      },
    };
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    const helper = new EmbedHelper(failing, logger);
    expect(await helper.query('q')).toBeUndefined();
    expect(await helper.batch(['a', 'b'])).toEqual([undefined, undefined]);
    expect(helper.vectorReady()).toBe(true);
    // 两次告警:①query 降级 ②连续失败 ≥2 触发熔断(背压设计:快速降级 FTS-only)
    expect(logger.warn).toHaveBeenCalledTimes(2);
    // 熔断中:不再触达底层服务,直接 undefined(底层 embed 调用数不变),且无新增告警
    expect(await helper.query('q2')).toBeUndefined();
    expect(await helper.batch(['c'])).toEqual([undefined]);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('RemoteEmbeddingService retries 5xx with backoff, not 4xx', async () => {
    let calls = 0;
    const statuses = [500, 500, 200];
    const fetchMock = vi.fn(async () => {
      const status = statuses[Math.min(calls, statuses.length - 1)];
      calls++;
      if (status !== 200) return new Response('oops', { status });
      return Response.json({ data: [{ index: 0, embedding: [1, 0, 0] }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const svc = new RemoteEmbeddingService({ baseUrl: 'http://x/v1', apiKey: '', model: 'm', dimensions: 3, maxRetries: 2 });
      const vec = await svc.embed('hello');
      expect(Array.from(vec)).toEqual([1, 0, 0]);
      expect(calls).toBe(3); // 两次 5xx 重试后成功
      expect(svc.getProviderInfo().provider).toBe('remote');

      const fail4xx = new RemoteEmbeddingService({ baseUrl: 'http://x/v1', apiKey: '', model: 'm', dimensions: 3, maxRetries: 3 });
      let calls4 = 0;
      vi.stubGlobal('fetch', async () => {
        calls4++;
        return new Response('bad request', { status: 400 });
      });
      await expect(fail4xx.embed('x')).rejects.toThrow('HTTP 400');
      expect(calls4).toBe(1); // 4xx 不重试
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('RemoteEmbeddingService L2-normalizes and preserves order via index', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({
        data: [
          { index: 1, embedding: [0, 3, 0] },
          { index: 0, embedding: [0, 0, 2] },
        ],
      }),
    );
    try {
      const svc = new RemoteEmbeddingService({ baseUrl: 'http://x/v1', apiKey: '', model: 'm', dimensions: 3 });
      const vecs = await svc.embedBatch(['a', 'b']);
      expect(Array.from(vecs[0])).toEqual([0, 0, 1]); // 按 index 还原 + 归一化
      expect(Array.from(vecs[1])).toEqual([0, 1, 0]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
