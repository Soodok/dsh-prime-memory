/**
 * §C 接线测试(memorax-absorb Wave 2 / task_17-18):
 * ① 捕获路径——session/event 带密钥 → 蒸馏直传(写停后 L0 不落正文,脱敏断言
 *    抓 runner.enqueue 的直传消息)的内容是占位符;redactSecrets:false → 逐字节原样;
 * ② 手动路径——memory_add 高权限写入同样脱敏(两条 L1 写入边界语义一致)。
 */
import { describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { registerCapture } from '../src/hooks/capture.js';
import { registerMemoryTools } from '../src/tools/index.js';
import type { MemoryLogger, MemoryRecord } from '../src/types.js';
import type { MemoryConfig } from '../src/config.js';

const SECRET_MSG = '帮我看看这个 key 对不对: sk-proj-abcdefghijklmnop123456';

function captureHarness(cfgOverride?: Partial<MemoryConfig['capture']>) {
  // 异类注册表:既有 session/event 回调也有工具对象,取用侧各自收窄为精确形状
  const handlers = new Map<string, unknown>();
  const ctx = { on: (name: string, cb: (...args: never[]) => unknown) => handlers.set(name, cb) } as unknown as Context;
  const enqueued: Array<{ sid: string; messages: Array<{ role: string; content: string }> }> = [];
  const runner = {
    enqueue: (sid: string, messages: Array<{ role: string; content: string }>) => {
      enqueued.push({ sid, messages });
    },
  };
  const watermark = { record: () => {} };
  const logger: MemoryLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as MemoryLogger;
  const live = { get: () => ({ enabled: true, capture: true }) };
  const modes = { get: () => 'auto' };
  const cfg = { capture: { enabled: true, maxMessageChars: 4000, stripCodeBlocks: false, ...cfgOverride } } as unknown as MemoryConfig;
  return { ctx, handlers, enqueued, watermark, runner, logger, live, modes, cfg };
}

function userTurn(text: string): SessionEvent[] {
  let seq = 0;
  const now = Date.now() + 60_000; // 冷启动地板:事件时间必须晚于插件激活
  const ev = (type: string, data: unknown): SessionEvent => ({ type, seq: ++seq, time: now, data }) as unknown as SessionEvent;
  return [
    ev('turn/start', { turn: 1 }),
    ev('user/message', { id: 'm1', role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }),
    ev('turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ];
}

describe('§C 捕获路径接线', () => {
  it('默认(开启):user 消息里的 API key 进蒸馏直传前已替换为占位符', async () => {
    const h = captureHarness();
    registerCapture(h.ctx, h.cfg, h.runner as never, h.watermark as never, h.logger, h.live as never, h.modes as never);
    const onEvent = h.handlers.get('session/event') as ((session: unknown, e: SessionEvent) => unknown) | undefined;
    const session = { id: 's-r' };
    for (const e of userTurn(SECRET_MSG)) onEvent?.(session, e);
    await new Promise((r) => setTimeout(r, 10));
    const { enqueued } = h;
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].messages[0].content).toContain('[REDACTED:API_KEY]');
    expect(enqueued[0].messages[0].content).not.toContain('sk-proj-abcdefghijklmnop123456');
  });

  it('redactSecrets:false → 内容逐字节原样(与旧行为一致)', async () => {
    const h = captureHarness({ redactSecrets: false });
    registerCapture(h.ctx, h.cfg, h.runner as never, h.watermark as never, h.logger, h.live as never, h.modes as never);
    const onEvent = h.handlers.get('session/event') as ((session: unknown, e: SessionEvent) => unknown) | undefined;
    for (const e of userTurn(SECRET_MSG)) onEvent?.({ id: 's-r' }, e);
    await new Promise((r) => setTimeout(r, 10));
    const { enqueued } = h;
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].messages[0].content).toContain('sk-proj-abcdefghijklmnop123456');
  });

  it('无密钥内容零行为变化(占位符不引入)', async () => {
    const h = captureHarness();
    registerCapture(h.ctx, h.cfg, h.runner as never, h.watermark as never, h.logger, h.live as never, h.modes as never);
    const onEvent = h.handlers.get('session/event') as ((session: unknown, e: SessionEvent) => unknown) | undefined;
    const plain = '今天讨论了部署方案,周四上线';
    for (const e of userTurn(plain)) onEvent?.({ id: 's-r' }, e);
    await new Promise((r) => setTimeout(r, 10));
    const { enqueued } = h;
    expect(enqueued[0].messages[0].content).toBe(plain);
  });
});

describe('§C 手动路径接线(memory_add)', () => {
  function toolHarness(cfgOverride?: Partial<MemoryConfig['capture']>) {
    const handlers = new Map<string, unknown>();
    const ctx = { on: () => {}, tools: { register: (t: unknown) => handlers.set((t as { name: string }).name, t) } } as unknown as Context;
    const written: MemoryRecord[] = [];
    const logger: MemoryLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as MemoryLogger;
    const live = { get: () => ({ memoryMutate: true }) };
    const cfg = { tools: true, capture: { enabled: true, maxMessageChars: 4000, stripCodeBlocks: false, ...cfgOverride } } as unknown as MemoryConfig;
    const stores = {
      l0: {} as never,
      l1: { appendNew: async (records: MemoryRecord[]) => written.push(...records) },
      scenes: {} as never,
      persona: {} as never,
    };
    registerMemoryTools(ctx, cfg, stores as never, logger, {} as never, live as never);
    return { handlers, written };
  }

  it('memory_add 默认脱敏:密钥内容进 L1 前替换为占位符', async () => {
    const { handlers, written } = toolHarness();
    const tool = handlers.get('memory_add') as { execute: (args: Record<string, unknown>) => Promise<unknown> };
    await tool.execute({ content: SECRET_MSG });
    expect(written).toHaveLength(1);
    expect(written[0].content).toContain('[REDACTED:API_KEY]');
    expect(written[0].content).not.toContain('sk-proj-abcdefghijklmnop123456');
  });

  it('memory_add redactSecrets:false → 原样写入', async () => {
    const { handlers, written } = toolHarness({ redactSecrets: false });
    const tool = handlers.get('memory_add') as { execute: (args: Record<string, unknown>) => Promise<unknown> };
    await tool.execute({ content: SECRET_MSG });
    expect(written[0].content).toContain('sk-proj-abcdefghijklmnop123456');
  });
});
