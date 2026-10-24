/**
 * 孤儿 Room 候选预标记 + 逐个复查(room-review.ts,73e5f02 地基)单测。
 *
 * 钉死:①候选解析(目录内优先/去重/截断 3/非法丢弃/id 过滤);②候选标注系统
 * prompt 含现有词表与计数;③annotate 选活跃孤儿、跳过 skipped、写 pending;
 * ④next 队列(pending 且有候选,更新时间升序)与 confirm/skip 语义;
 * ⑤confirm 后 invalidateRooms 被调用(计数口径)。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { MemoryDb } from '../src/store/sqlite.js';
import { L1Store } from '../src/store/l1.js';
import { NoopEmbeddingService } from '../src/store/embedding.js';
import {
  annotateOrphanCandidates,
  confirmReview,
  nextReview,
  parseRoomCandidateItems,
  pendingReviewCount,
  roomCandidateSystemPrompt,
  skipReview,
  ROOM_CANDIDATES_KEY,
  ROOM_REVIEW_KEY,
  type OrphanAnnotateIO,
} from '../src/room-review.js';
import type { MemoryLogger, MemoryRecord } from '../src/types.js';
import type { MemoryConfig } from '../src/config.js';

let dir: string;
const dbs: MemoryDb[] = [];
afterAll(async () => {
  for (const db of dbs) db.close();
  if (!dir) return;
  for (let i = 0; i < 3; i++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
});

const logger: MemoryLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const catalog = [
  { room: 'git-commits', count: 2 },
  { room: 'gpu-vram', count: 1 },
];

async function mkL1(): Promise<{ l1: L1Store; db: MemoryDb }> {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'dsh-roomreview-'));
  const db = new MemoryDb(join(dir, `m-${Math.random().toString(36).slice(2)}.db`), 0);
  db.init();
  dbs.push(db);
  return { l1: new L1Store(dir, db, new NoopEmbeddingService()), db };
}

function seedRecord(db: MemoryDb, id: string, over: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = Date.now();
  const r: MemoryRecord = {
    id,
    content: `内容 ${id}`,
    type: 'work_fact',
    priority: 60,
    scene_name: 's',
    timestamps: [now],
    createdAt: now,
    updatedAt: now,
    version: 0,
    metadata: {},
    family: 'work',
    scope: 'global',
    workspaceId: '',
    ...over,
  };
  db.upsertL1(r);
  return r;
}

const cfg = {
  extract: { enabled: true },
  llm: { maxInputChars: 40_000 },
} as unknown as MemoryConfig;

function io(l1: L1Store): OrphanAnnotateIO {
  return { l1, logger };
}

describe('parseRoomCandidateItems', () => {
  const ids = ['r1', 'r2'];

  it('目录内 slug 优先排前、去重、截断 3、非法丢弃', () => {
    const out = parseRoomCandidateItems(
      [
        { id: 'r1', rooms: ['new-idea', 'GIT-COMMITS', 'git-commits', 'bad slug!', 'gpu-vram', 'extra-1', 'extra-2'] },
      ],
      ids,
      catalog,
    );
    expect(out).toHaveLength(1);
    expect(out[0].rooms).toEqual(['git-commits', 'gpu-vram', 'new-idea']); // 目录内前移 + 截断 3
  });

  it('id 不在批内的候选丢弃', () => {
    const out = parseRoomCandidateItems([{ id: 'zz', rooms: ['git-commits'] }], ids, catalog);
    expect(out).toHaveLength(0);
  });

  it('两级 Room slug（major/minor）不被丢弃（issue #12）', () => {
    // 回归：候选清洗曾用 isTag()，而 `mpu/qos` 这类两级 slug 含 slash 必被判非法 →
    // 注册表收得下、候选却静默丢掉，confirm 也挂不上。判据须与 rooms-registry 同为 isRoomSlug。
    const out = parseRoomCandidateItems(
      [{ id: 'r1', rooms: ['mpu', 'mpu/qos', 'mpu/board'] }],
      ids,
      catalog,
    );
    expect(out[0].rooms).toEqual(['mpu', 'mpu/qos', 'mpu/board']);
  });

  it('两级 slug 仍受形状约束：三段 / 空段 / 尾斜杠都非法', () => {
    const out = parseRoomCandidateItems(
      [{ id: 'r1', rooms: ['a/b/c', '/qos', 'mpu/', 'mpu/qos'] }],
      ids,
      catalog,
    );
    expect(out[0].rooms).toEqual(['mpu/qos']);
  });

  it('系统 prompt 含现有词表与计数', () => {
    const prompt = roomCandidateSystemPrompt(catalog);
    expect(prompt).toContain('git-commits(现有 2 条)');
    expect(prompt).toContain('优先从现有 Room 词表里选');
  });
});

describe('annotateOrphanCandidates(候选预标记)', () => {
  it('选活跃孤儿写 pending;skipped 的不再选;annotator 注入生效', async () => {
    const { l1, db } = await mkL1();
    seedRecord(db, 'r1');
    seedRecord(db, 'r2');
    const seen: string[] = [];
    const r = await annotateOrphanCandidates({} as never, cfg, io(l1), 40, {
      annotator: async (rec, _catalog) => {
        seen.push(rec.id);
        return ['git-commits'];
      },
    });
    expect(r.selected).toBe(2);
    expect(r.written).toBe(2);
    expect(seen.sort()).toEqual(['r1', 'r2']);
    const meta1 = (db.getL1ByIds(['r1'])[0].metadata ?? {}) as Record<string, unknown>;
    expect(meta1[ROOM_CANDIDATES_KEY]).toEqual(['git-commits']);
    expect(meta1[ROOM_REVIEW_KEY]).toBe('pending');
    // r2 标 skipped 后重跑:不再选中
    skipReview(l1, 'r2');
    const r2 = await annotateOrphanCandidates({} as never, cfg, io(l1), 40, {
      annotator: async (_rec, _cat) => ['gpu-vram'],
    });
    expect(r2.selected).toBe(1);
  });

  it('零孤儿零动作', async () => {
    const { l1 } = await mkL1();
    const r = await annotateOrphanCandidates({} as never, cfg, io(l1), 40, {
      annotator: async () => [],
    });
    expect(r).toEqual({ selected: 0, candidates: 0, written: 0 });
  });
});

describe('nextReview / confirmReview / skipReview', () => {
  it('pending 队列升序取最旧;confirm 写 tags 清候选标 confirmed 并失效计数', async () => {
    const { l1, db } = await mkL1();
    const a = seedRecord(db, 'a', { updatedAt: 100 });
    const b = seedRecord(db, 'b', { updatedAt: 200 });
    const meta = (r: MemoryRecord): Record<string, unknown> => {
      const m = { ...(r.metadata ?? {}) } as Record<string, unknown>;
      m[ROOM_CANDIDATES_KEY] = ['git-commits'];
      m[ROOM_REVIEW_KEY] = 'pending';
      return m;
    };
    db.upsertL1({ ...a, metadata: meta(a) });
    db.upsertL1({ ...b, metadata: meta(b) });
    const invalidate = vi.spyOn(l1, 'invalidateRooms');

    const first = nextReview(l1);
    expect(first?.id).toBe('a'); // 升序:最旧优先
    expect(first?.remaining).toBe(2);
    expect(first?.candidates).toEqual(['git-commits']);

    const done = confirmReview(l1, 'a', ['Git-Commits', 'new-topic']);
    expect(done?.tags).toEqual(['git-commits', 'new-topic']);
    const after = db.getL1ByIds(['a'])[0];
    expect((after.metadata ?? {}).tags).toEqual(['git-commits', 'new-topic']);
    expect((after.metadata ?? {})[ROOM_CANDIDATES_KEY]).toBeUndefined();
    expect((after.metadata ?? {})[ROOM_REVIEW_KEY]).toBe('confirmed');
    expect(invalidate).toHaveBeenCalled();
    expect(nextReview(l1)?.id).toBe('b');
    expect(pendingReviewCount(l1)).toBe(1);
  });

  it('confirm 防重复(已 confirmed 返回 null);rooms 全非法返回 null;skip 生效', async () => {
    const { l1, db } = await mkL1();
    const r = seedRecord(db, 'r1');
    const meta = { ...(r.metadata ?? {}) } as Record<string, unknown>;
    meta[ROOM_CANDIDATES_KEY] = ['git-commits'];
    meta[ROOM_REVIEW_KEY] = 'pending';
    db.upsertL1({ ...r, metadata: meta });
    expect(confirmReview(l1, 'r1', ['###'])).toBeNull(); // 全非法
    expect(confirmReview(l1, 'r1', ['gpu-vram'])).not.toBeNull();
    expect(confirmReview(l1, 'r1', ['again'])).toBeNull(); // 已确认防重
    expect(skipReview(l1, 'r1')).toBe(false); // confirmed 不受 skip 影响(记录存在,id 命中仍 true)
    seedRecord(db, 'r2');
    expect(skipReview(l1, 'r2')).toBe(true);
    expect(nextReview(l1)).toBeNull(); // r2 无 pending 候选,不进队列
  });

  it('confirm 接受两级 slug（major/minor）（issue #12）', async () => {
    // 回归：此路径曾用 isTag()，`mpu/qos` 被判非法 → confirm 返回 null，
    // 工具层再把它包装成"id 不存在、已被确认过、或 rooms 全部非法"，指向完全错误的方向。
    const { l1, db } = await mkL1();
    seedRecord(db, 'r1');
    const done = confirmReview(l1, 'r1', ['mpu', 'mpu/qos']);
    expect(done?.tags).toEqual(['mpu', 'mpu/qos']);
    const after = db.getL1ByIds(['r1'])[0];
    expect((after.metadata ?? {}).tags).toEqual(['mpu', 'mpu/qos']);
  });
});
