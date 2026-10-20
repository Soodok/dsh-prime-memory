/**
 * 捕获侧锚点 fold 集成测试(task_30)。
 *
 * 走**真** `registerCapture`(只把 L0/runner 打桩),因为要验的正是
 * "事件 → L0 记录"这一段的行为,而不是某个内部函数:
 * - `assistant/message` 自带 `{turn, step}` → 直接采用
 * - `user/message` **不带** step → 由 `step/start` fold 出**同轮**坐标
 * - step/start 之前出现的消息 → step **留空**(红线:不推算)
 * - `step/start` 自身不落盘(只为 fold 而缓冲)
 */
import { describe, expect, it } from 'vitest';
import { registerCapture } from '../src/hooks/capture.js';
import { SessionModeStore } from '../src/store/session-modes.js';
import type { Context } from '@deepseek-ai/cordis';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ConversationMessage } from '../src/types.js';
import type { MemoryConfig as Cfg } from '../src/config.js';

interface Captured {
  sessionId: string;
  messages: ConversationMessage[];
}

/** 最小 ctx:只提供 registerCapture 用到的 `ctx.on`。 */
function fakeCtx(): { ctx: Context; emit: (e: SessionEvent) => void } {
  let handler: ((s: unknown, e: SessionEvent) => void) | undefined;
  const ctx = {
    on: (name: string, fn: (s: unknown, e: SessionEvent) => void) => {
      if (name === 'session/event') handler = fn;
    },
  } as unknown as Context;
  return {
    ctx,
    emit: (e: SessionEvent) => {
      if (!handler) throw new Error('session/event 处理器未注册');
      handler({ id: 'sess-1' }, e);
    },
  };
}

function makeCfg(): Cfg {
  return {
    extract: {},
    capture: { enabled: true, maxMessageChars: 4000, stripCodeBlocks: false },
  } as unknown as Cfg;
}

const okLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Cfg extends never ? never : Parameters<typeof registerCapture>[4];

describe('capture 锚点 fold', () => {
  async function run(events: Omit<SessionEvent, 'time'>[]): Promise<Captured[]> {
    const captured: Captured[] = [];
    const { ctx, emit } = fakeCtx();
    // T8.4 写停:正文不再走 L0 落盘,锚点断言改抓 runner.enqueue 的直传消息
    const runner = {
      enqueue: (sessionId: string, messages: ConversationMessage[]) => {
        captured.push({ sessionId, messages });
      },
    };
    const watermark = { record: () => {} };
    const live = {
      supported: true,
      get: () => ({ enabled: true, capture: true }) as never,
      update: async () => {},
    };
    const modes = new SessionModeStore('/nonexistent', 'auto');
    // 冷启动保护按 `event.time < startFloor` 过滤 → 事件时间必须晚于注册时刻
    const floor = Date.now();
    registerCapture(
      ctx,
      makeCfg(),
      runner as never,
      watermark as never,
      okLogger,
      live as never,
      modes,
    );
    for (const e of events) emit({ ...e, time: floor + 1 } as SessionEvent);
    await new Promise((r) => setTimeout(r, 0));
    return captured;
  }

  it('assistant 用自带 step;user 由 step/start fold 出同轮 step', async () => {
    const out = await run([
      { type: 'turn/start', data: { turn: 7 } } as never,
      { type: 'step/start', data: { turn: 7, step: 3 } } as never,
      { type: 'user/message', data: { content: [{ type: 'text', text: '用户问题' }], source: { kind: 'user' } } } as never,
      { type: 'assistant/message', data: { turn: 7, step: 3, message: { content: [{ type: 'text', text: '助手回答' }] } } } as never,
      { type: 'turn/end', data: { turn: 7 } } as never,
    ]);
    expect(out).toHaveLength(1);
    const msgs = out[0].messages;
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    // user:turn 来自 turn/end 的轮号,step 来自 fold
    expect(msgs[0].anchor).toEqual({ sessionId: 'sess-1', turn: 7, step: 3 });
    // assistant:自带 turn/step 优先
    expect(msgs[1].anchor).toEqual({ sessionId: 'sess-1', turn: 7, step: 3 });
  });

  it('step/start 之前出现的 user 消息 step 留空(不拿上一轮顶替)', async () => {
    const out = await run([
      { type: 'turn/start', data: { turn: 1 } } as never,
      { type: 'step/start', data: { turn: 1, step: 1 } } as never,
      { type: 'user/message', data: { content: [{ type: 'text', text: '第一问' }], source: { kind: 'user' } } } as never,
      { type: 'turn/end', data: { turn: 1 } } as never,
      { type: 'turn/start', data: { turn: 2 } } as never,
      // 第 2 轮:step/start 还没来
      { type: 'user/message', data: { content: [{ type: 'text', text: '第二问' }], source: { kind: 'user' } } } as never,
      { type: 'turn/end', data: { turn: 2 } } as never,
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].messages[0].anchor).toEqual({ sessionId: 'sess-1', turn: 1, step: 1 });
    // 第 2 轮的 user:turn 正确、step 缺席 —— 不是 step=1(那是上一轮的值)
    expect(out[1].messages[0].anchor).toEqual({ sessionId: 'sess-1', turn: 2 });
    expect('step' in (out[1].messages[0].anchor ?? {})).toBe(false);
  });

  it('step/start 自身不落盘(只为 fold 而缓冲)', async () => {
    const out = await run([
      { type: 'turn/start', data: { turn: 1 } } as never,
      { type: 'step/start', data: { turn: 1, step: 1 } } as never,
      { type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '答' }] } } } as never,
      { type: 'turn/end', data: { turn: 1 } } as never,
    ]);
    expect(out[0].messages).toHaveLength(1); // 只有 assistant,没有 step 事件落成消息
  });
});
