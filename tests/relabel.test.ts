/**
 * 反刍重标定阶段(relabelPass)测试:机械校验(cogHall 派生补写 / 非法 wing 剥离)+
 * LLM 有界重标(wing 补标 / 涌现标签,注入桩)+ 门控与失败路径。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MemoryDb } from '../src/store/sqlite.js';
import { L1Store } from '../src/store/l1.js';
import { NoopEmbeddingService } from '../src/store/embedding.js';
import { relabelPass } from '../src/pipeline/relabel.js';
import { InProcMemoryBackend } from '../src/store/memory-backend.js';
import type { MemoryLogger } from '../src/types.js';
import type { MemoryConfig } from '../src/config.js';
import type { Context } from '@deepseek-ai/cordis';

let dir: string;
async function tmp(): Promise<string> {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'dsh-relabel-'));
  return dir;
}
afterAll(async () => {
  for (const db of dbs) db.close();
  if (!dir) return;
  // Windows 句柄释放有延迟:重试几次,最终失败也不算测试失败(临时目录留给系统清理)
  for (let i = 0; i < 3; i++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
});

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as MemoryLogger;
const cfg = { hall: { enabled: ['work', 'relationships', 'learning', 'creative', 'home', 'health', 'finance', 'journey'] } } as unknown as MemoryConfig;
const ctx = {} as Context;

const dbs: MemoryDb[] = [];

async function mkL1(): Promise<L1Store> {
  const root = await tmp();
  const db = new MemoryDb(join(root, `m-${Math.random().toString(36).slice(2)}.db`), 0);
  db.init();
  dbs.push(db); // afterAll 显式关句柄:Windows 上不关会导致 tmp 清理 EBUSY
  return new L1Store(root, db, new NoopEmbeddingService());
}

const now = Date.now();
const base = { priority: 60, scene_name: 's', timestamps: [now], createdAt: now, updatedAt: now };

describe('relabelPass 机械校验(零 LLM 部分)', () => {
  it('cogHall 按 type 派生补写;非法 wing 剥离并转入 LLM 队列', async () => {
    const l1 = await mkL1();
    await l1.appendNew([
      { id: 'r1', content: '合法 wing', type: 'work_fact', ...base, metadata: { hall: 'work' } },
      { id: 'r2', content: '非法 wing', type: 'episodic', ...base, metadata: { hall: 'bogus-domain' } },
      { id: 'r3', content: '未打标', type: 'persona', ...base, metadata: {} },
    ]);
    const stats = await relabelPass(
      { ctx, cfg, backend: new InProcMemoryBackend(l1), logger: noopLogger },
      {
        wingLabeler: async (rec) => (rec.id === 'r3' ? 'creative' : null),
        tagger: async () => ['Riley-College', 'x_9', 'ok-tag'],
      },
    );
    expect(stats.checked).toBe(3);
    expect(stats.cogHallFixed).toBe(3); // 三条都可派生且原本缺失
    expect(stats.wingInvalidFixed).toBe(1);
    expect(stats.wingLabeled).toBe(1);
    expect(stats.tagged).toBe(1); // tags 只打在成功补上 wing 的记录池上(r2 未补上,不进 tags 批)
    expect(stats.llmSkipped).toBe(1); // r2 在批里但桩未返回

    const byId = new Map(l1.all().map((r) => [r.id, r]));
    expect(byId.get('r1')?.metadata).toMatchObject({ hall: 'work', cogHall: 'facts' });
    expect(byId.get('r2')?.metadata).toMatchObject({ cogHall: 'events' });
    expect(byId.get('r2')?.metadata?.hall).toBeUndefined(); // 非法值已剥离
    expect(byId.get('r3')?.metadata).toMatchObject({ hall: 'creative', cogHall: 'facts' });
    // slug 归一:大写转小写、下划线非法被剔除
    expect(byId.get('r3')?.metadata?.tags).toEqual(['riley-college', 'ok-tag']);
  });

  it('wing.enabled 为空:LLM 部分整体跳过,机械校验照常', async () => {
    const l1 = await mkL1();
    await l1.appendNew([{ id: 'u1', content: '未打标', type: 'episodic', ...base, metadata: {} }]);
    let llmCalled = false;
    const stats = await relabelPass(
      { ctx, cfg: { hall: { enabled: [] } } as unknown as MemoryConfig, backend: new InProcMemoryBackend(l1), logger: noopLogger },
      { wingLabeler: async () => { llmCalled = true; return null; }, tagger: async () => null },
    );
    expect(llmCalled).toBe(false);
    expect(stats.wingLabeled).toBe(0);
    expect(stats.cogHallFixed).toBe(1); // 机械部分不受 wing.enabled 影响
    expect(l1.all()[0]?.metadata?.cogHall).toBe('events');
  });

  it('空库:零巡检、零 LLM', async () => {
    const l1 = await mkL1();
    let llmCalled = false;
    const stats = await relabelPass(
      { ctx, cfg, backend: new InProcMemoryBackend(l1), logger: noopLogger },
      { wingLabeler: async () => { llmCalled = true; return null; }, tagger: async () => null },
    );
    expect(stats.checked).toBe(0);
    expect(llmCalled).toBe(false);
  });

  it('机械段必须产出子进度(否则面板在写回期间全空白)', async () => {
    const l1 = await mkL1();
    await l1.appendNew([
      { id: 'p1', content: 'a', type: 'work_fact', ...base, metadata: {} },
      { id: 'p2', content: 'b', type: 'episodic', ...base, metadata: {} },
    ]);
    const seen: Array<{ label?: string; done: number; total: number }> = [];
    await relabelPass(
      { ctx, cfg, backend: new InProcMemoryBackend(l1), logger: noopLogger },
      { wingLabeler: async () => null, tagger: async () => null },
      { progress: (_text, done, total, label) => seen.push({ label, done, total }) },
    );
    // 机械巡检是第一个上报的段,且必须带 label(面板靠它区分机械段与 LLM 段)
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].label).toBe('机械巡检');
    expect(seen[0].total).toBe(2);
    expect(seen[0].done).toBe(2);
  });
});
