/**
 * 两条落点/口径护栏：workspace 目录不存在时退回单根（投射护栏），以及退场行不计入向量待补分母。
 *
 * 都对应真机上会静默坏掉的形状：
 * - worktree 被删后仍往 `<消失的项目>/.agents/memory/` 造孤儿树；
 * - `待补 N 条` 恒等于退场数、永不归零，而「重建索引」按正确口径根本无事可做。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MemoryDb } from '../src/store/sqlite.js';
import { L1Store } from '../src/store/l1.js';
import { targetFor, WORKSPACE_SUBDIR } from '../src/store/memory-md.js';
import type { EmbeddingService } from '../src/store/embedding.js';
import type { MemoryRecord } from '../src/types.js';

const DIM = 16;
const dirs: string[] = [];
const dbs: MemoryDb[] = [];

afterAll(async () => {
  for (const db of dbs) db.close();
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

function fakeEmbed(): EmbeddingService {
  return {
    getDimensions: () => DIM,
    getProviderInfo: () => ({ provider: 'probe', model: 'probe', dimensions: DIM }),
    isReady: () => true,
    embed: async () => new Float32Array(DIM),
    embedBatch: async (ts: string[]) => ts.map(() => new Float32Array(DIM)),
  };
}

function rec(id: string, extra: Partial<MemoryRecord> = {}): MemoryRecord {
  const t = Date.parse('2026-10-12T00:00:00Z');
  return {
    id, content: `内容 ${id}`, type: 'work_fact', priority: 60, scene_name: 's',
    timestamps: [t], createdAt: t, updatedAt: t, name: id, ...extra,
  };
}

async function tmp(name: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), name));
  dirs.push(d);
  return d;
}

describe('targetFor 的 workspace 存在性护栏', () => {
  it('workspace 目录不存在 → 落点退回单根，不造孤儿树', async () => {
    const dataDir = await tmp('dsh-guard-');
    const gone = join(await tmp('dsh-ws-'), 'nope'); // 建完就删掉，模拟 worktree 被移除
    await rm(gone, { recursive: true, force: true });
    const t = targetFor(rec('r1', { workspaceId: gone }), undefined, dataDir);
    expect(t.inWorkspace).toBe(false);
    expect(t.root).toBe(join(dataDir, 'memories'));
    expect(t.absPath).toBeDefined();
    // 关键：路径里绝不能出现那个已消失的 workspace
    expect(t.absPath ?? '').not.toContain('nope');
  });

  it('workspace 目录存在 → 落 `<ws>/.agents/memory/`', async () => {
    const dataDir = await tmp('dsh-guard-');
    const ws = await tmp('dsh-ws-');
    const t = targetFor(rec('r1', { workspaceId: ws }), undefined, dataDir);
    expect(t.inWorkspace).toBe(true);
    expect(t.root).toBe(join(ws, ...WORKSPACE_SUBDIR));
  });

  it('无 workspace 归属 → 单根（护栏不该改变这条既有行为）', async () => {
    const dataDir = await tmp('dsh-guard-');
    const t = targetFor(rec('r1'), undefined, dataDir);
    expect(t.inWorkspace).toBe(false);
    expect(t.root).toBe(join(dataDir, 'memories'));
  });
});

describe('退场计数（向量待补的分母要扣它）', () => {
  it('countL1Retired 只数退场行，且 -1 不会污染展示', async () => {
    const dataDir = await tmp('dsh-ret-');
    const db = new MemoryDb(join(dataDir, 'm.db'), DIM);
    db.init();
    dbs.push(db);
    const store = new L1Store(dataDir, db, fakeEmbed(), 'hybrid', undefined, 0);
    await store.init();
    await store.appendNew([rec('a'), rec('b'), rec('c')]);
    expect(db.countL1Retired()).toBe(0);
    store.retire(['a'], { at: new Date().toISOString(), reason: 'obsolete' });
    expect(db.countL1Retired()).toBe(1);
    // 活跃分母 = 总 - 退场：这就是"待补 114"那笔账的正确算法
    expect(db.countL1() - db.countL1Retired()).toBe(2);
  });
});
