/**
 * issue #8 钉桩测试:宿主 0.2.x 已删 `session.events` 属性(官方访问器为
 * `snapshotEvents()`)。取代对账与召回份额估算必须同时吃三种形状——
 * ① 旧宿主数组属性 ② 0.2.x 方法 ③ 两者皆无(走各自既有退路,且**不得**
 * 以 TypeError 落进 warn)。旧实现裸 `for (const ev of session.events)`,
 * ②③ 形状下每轮抛 `session.events is not iterable`,自愈旁路自装机起从未生效。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { readSessionEvents, registerRecall } from '../src/hooks/recall.js';
import type { MemoryConfig } from '../src/config.js';
import type { MemoryLogger } from '../src/types.js';

let dir: string;
async function tmp(): Promise<string> {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'pm-session-shape-'));
  return dir;
}
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

/** 一条本插件召回注入事件(v4 署名),seq 可指定。 */
function injEvent(id: string, seq: number): Record<string, unknown> {
  return {
    type: 'user/message',
    seq,
    data: {
      id,
      source: { kind: 'plugin:memory', form: 'recall' },
      content: [{ type: 'text', text: 'x'.repeat(120) }],
    },
  };
}

/** 三种会话形状共用的 registerRecall 最小驱动环境(照 capture-recovery.test 夹具模式)。 */
async function harness(session: Record<string, unknown>, storedEvents?: unknown[]) {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const services = new Map<string, unknown>([
    ['sessions', { get: (id: string) => (id === 's-1' ? session : undefined) }],
    ['agents', { list: () => [] }],
  ]);
  if (storedEvents !== undefined) {
    services.set('sessionPersistence', {
      loadStored: async () => ({ events: storedEvents }),
    });
  }
  const ctx = {
    on: (name: string, cb: (...args: never[]) => unknown) => {
      handlers.set(name, cb);
      return () => {};
    },
    get: (name: string) => services.get(name),
    effect: () => {},
  } as unknown as Context;
  const warns: string[] = [];
  const logger = {
    info: () => {},
    warn: (m: string) => {
      warns.push(String(m));
    },
    error: () => {},
    debug: () => {},
  } as unknown as MemoryLogger;
  const reconcileSuperseded = vi.fn(() => true);
  const hooks = registerRecall(
    ctx,
    { recall: {} } as unknown as MemoryConfig,
    {
      l1: {} as never,
      scenes: { chat: {} as never, work: {} as never },
      persona: { chat: {} as never, work: {} as never },
      recalled: { reconcileSuperseded } as never,
    },
    logger,
    { get: () => ({ enabled: true }) } as never,
    { get: () => 'auto', resolvedRecall: () => true } as never,
    await tmp(),
  );
  const fireCompactionEnd = async () => {
    const onEvent = handlers.get('session/event');
    expect(onEvent).toBeDefined();
    onEvent?.({ id: 's-1' } as never, { type: 'compaction/end' } as never);
    await new Promise((resolve) => setImmediate(resolve)); // reconcile 是 async 旁路,等微任务落定
  };
  return { hooks, warns, reconcileSuperseded, fireCompactionEnd };
}

describe('readSessionEvents 三形状(纯函数)', () => {
  it('① 数组属性原样返回(旧宿主热路径优先,即便同时有方法)', () => {
    const events = [injEvent('a', 1)];
    expect(readSessionEvents({ events, snapshotEvents: () => [injEvent('b', 2)] })).toBe(events);
  });

  it('② 无数组属性时走 snapshotEvents() 方法(0.2.x 宿主)', () => {
    const events = [injEvent('b', 2)];
    expect(readSessionEvents({ snapshotEvents: () => events })).toBe(events);
  });

  it('③ 两者皆无返回 undefined,不抛(交由调用点退路)', () => {
    expect(readSessionEvents({})).toBeUndefined();
    expect(readSessionEvents({ events: 'not-an-array', snapshotEvents: undefined })).toBeUndefined();
  });
});

describe('取代对账 reconcileSupersededFromSession(compaction/end 触发)', () => {
  it('旧宿主数组形状:真实对账,可见集按 surface.nodes 求交,无 warn', async () => {
    const d = await harness({ surface: { nodes: [7] }, events: [injEvent('inj-1', 7), injEvent('inj-2', 9)] });
    await d.fireCompactionEnd();
    expect(d.reconcileSuperseded).toHaveBeenCalledTimes(1);
    const [sid, visibleIds, knownIds] = d.reconcileSuperseded.mock.calls[0] as [string, Set<string>, Set<string>];
    expect(sid).toBe('s-1');
    expect([...knownIds].sort()).toEqual(['inj-1', 'inj-2']);
    expect([...visibleIds]).toEqual(['inj-1']); // seq 9 不在 nodes → 不可见
    expect(d.warns.filter((w) => w.includes('取代对账失败'))).toEqual([]);
  });

  it('0.2.x snapshotEvents 方法形状:对账同样执行(issue #8 主症状回归钉)', async () => {
    const d = await harness({
      surface: { nodes: [7] },
      snapshotEvents: () => [injEvent('inj-1', 7)],
    });
    await d.fireCompactionEnd();
    expect(d.reconcileSuperseded).toHaveBeenCalledTimes(1);
    const [, visibleIds] = d.reconcileSuperseded.mock.calls[0] as [string, Set<string>, Set<string>];
    expect([...visibleIds]).toEqual(['inj-1']);
    expect(d.warns.filter((w) => w.includes('取代对账失败'))).toEqual([]);
  });

  it('两形状皆无:本轮不动返回 false(退粗标记),且不落 TypeError warn', async () => {
    const d = await harness({ surface: { nodes: [7] } });
    await d.fireCompactionEnd();
    expect(d.reconcileSuperseded).not.toHaveBeenCalled();
    expect(d.warns.filter((w) => w.includes('取代对账失败'))).toEqual([]);
  });
});

describe('召回份额 estimateRecallTokens 三形状', () => {
  it('①② 数组/方法形状返回数值(注入 120 字符计入)', async () => {
    const arrayShape = await harness({ surface: { nodes: [7] }, events: [injEvent('inj-1', 7)] });
    expect(await arrayShape.hooks.estimateRecallTokens('s-1')).toBeGreaterThan(0);
    const methodShape = await harness({ surface: { nodes: [7] }, snapshotEvents: () => [injEvent('inj-1', 7)] });
    expect(await methodShape.hooks.estimateRecallTokens('s-1')).toBeGreaterThan(0);
  });

  it('③ 两形状皆无但持久化可读:走存储回填而非静默 null', async () => {
    const d = await harness({ surface: { nodes: [7] } }, [injEvent('inj-9', 3)]);
    expect(await d.hooks.estimateRecallTokens('s-1')).toBeGreaterThan(0);
  });
});
