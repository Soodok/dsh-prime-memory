/**
 * runner 背景窗读切测试(task_19):MemoryRunner.drscBackground 的形状映射、
 * 切片轮次剔除、截尾与空窗降级口径(经 DrscClient mock fetch 全链)。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MemoryRunner, type MemoryStores } from '../src/pipeline/runner.js';
import { DrscClient } from '../src/clients/drsc.js';
import type { Context } from '@deepseek-ai/cordis';
import type { ConversationMessage, MemoryLogger } from '../src/types.js';
import type { MemoryConfig } from '../src/config.js';

let dir: string;
async function tmp(): Promise<string> {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'dsh-drsc-bg-'));
  return dir;
}
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const noopLogger: MemoryLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

async function makeRunner(drsc: DrscClient): Promise<MemoryRunner> {
  const stores = {
    drsc,
    l1: {} as never,
    scenes: {} as never,
    persona: {} as never,
    state: {} as never,
  } as unknown as MemoryStores;
  const ctx = { effect: () => () => {} } as unknown as Context;
  const cfg = {
    dataDir: await tmp(),
    extract: { enabled: true, minMessages: 2, backgroundMessages: 3 },
  } as unknown as MemoryConfig;
  return new MemoryRunner(ctx, cfg, stores, noopLogger, { get: () => ({}) } as never);
}

/** 经私有路径的等价驱动:直接调 extractSessionSlice 太重,改走 sessionTail 断言面。 */
async function backgroundOf(
  runner: MemoryRunner,
  sessionId: string,
  n: number,
  sliceTurns: ReadonlySet<number>,
): Promise<ConversationMessage[]> {
  const inner = runner as unknown as {
    drscBackground(sid: string, n: number, turns: ReadonlySet<number>): Promise<ConversationMessage[]>;
  };
  return inner.drscBackground(sessionId, n, sliceTurns);
}

function wireRows() {
  return [
    { seq: 0, turn: 1, step: 0, kind: 'user/message', role: 'user', time: 1000, text: '背景一' },
    { seq: 1, turn: 1, step: 1, kind: 'assistant/message', role: 'assistant', time: 1001, text: '背景二' },
    { seq: 2, turn: 2, step: 0, kind: 'tool/call', role: '', time: 1002, text: '工具噪声' },
    { seq: 3, turn: 2, step: 1, kind: 'user/message', role: 'user', time: 1003, text: '切片轮消息' },
    { seq: 4, turn: 3, step: 0, kind: 'assistant/message', role: 'assistant', time: 1004, text: '尾段' },
  ];
}

describe('runner 背景窗读切(DRSC tail redact 臂)', () => {
  it('形状映射 + 切片轮次整轮剔除 + 截尾保尾段', async () => {
    const { impl } = wireFetch(wireRows());
    const runner = await makeRunner(new DrscClient({ fetchImpl: impl }));
    const out = await backgroundOf(runner, 's1', 3, new Set([2]));
    // tool/call 被过滤;turn=2(切片轮)整轮剔除;剩 3 条按序保尾
    expect(out.map((m) => m.content)).toEqual(['背景一', '背景二', '尾段']);
    expect(out[2].id).toBe('drsc:s1:4');
    expect(out[2].anchor).toEqual({ sessionId: 's1', turn: 3 });
  });

  it('请求形状:op=session&session&tail=N&redact=1(tail=背景预算+切片条数)', async () => {
    let url = '';
    const { impl } = wireFetch(wireRows(), (u) => {
      url = u;
    });
    const runner = await makeRunner(new DrscClient({ fetchImpl: impl }));
    await backgroundOf(runner, 's-9', 5, new Set());
    expect(url).toContain('op=session&session=s-9&tail=5&redact=1');
  });

  it('collector 缺席(空转臂)→ 空数组;拉取失败 → 空窗降级 warn,不抛', async () => {
    const runnerAbsent = await makeRunner(new DrscClient({
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    }));
    expect(await backgroundOf(runnerAbsent, 's1', 3, new Set())).toEqual([]);

    const { impl } = wireFetch(wireRows(), undefined, 503);
    const runner503 = await makeRunner(new DrscClient({ fetchImpl: impl }));
    const warns: string[] = [];
    (runnerAbsent as unknown as { logger: MemoryLogger }).logger = {
      ...noopLogger,
      warn: (m: string) => warns.push(m),
    };
    (runner503 as unknown as { logger: MemoryLogger }).logger = {
      ...noopLogger,
      warn: (m: string) => warns.push(m),
    };
    expect(await backgroundOf(runner503, 's1', 3, new Set())).toEqual([]);
    expect(warns.some((m) => m.includes('背景窗') && m.includes('空窗降级'))).toBe(true);
  });

  it('n<=0 直接空(不发请求)', async () => {
    let calls = 0;
    const { impl } = wireFetch(wireRows(), () => {
      calls += 1;
    });
    const runner = await makeRunner(new DrscClient({ fetchImpl: impl }));
    expect(await backgroundOf(runner, 's1', 0, new Set())).toEqual([]);
    expect(calls).toBe(0);
  });
});

function wireFetch(
  rows: unknown[],
  onCall?: (url: string) => void,
  status = 200,
): { impl: typeof fetch } {
  const impl = (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    onCall?.(u);
    return new Response(JSON.stringify({ ok: true, session: { session_id: 's' }, rows }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { impl };
}
