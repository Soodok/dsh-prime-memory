/**
 * §A 崩溃恢复(memorax-absorb Wave 1)——TDD 测试。
 *
 * 三段:
 *  1. foldRecoverableTurns 纯函数:bracket 完整性 + interrupted 闭合 + 上限 2 + 水位线窗口
 *     (真实事件形状依据 evidence/probe-runtime.json 实测:data 即消息快照
 *      {content, source, role, id};turn/end 带 reason:{kind})
 *  2. MemoryDb 水位线:maxCapturedTurn / hasAnyL0Message(turn 空洞是常态,probe ③ 实证)
 *  3. registerCapture 恢复接线:agent/session-start(resume) 时尾轮入 L0 且 enqueue
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { registerCapture } from '../src/hooks/capture.js';
import { foldRecoverableTurns } from '../src/hooks/capture-recovery.js';
import { MemoryDb } from '../src/store/sqlite.js';
import type { MemoryLogger } from '../src/types.js';
import type { MemoryConfig } from '../src/config.js';

// ── 事件夹具:形状对齐实测(probe-results.md §探针②) ──
let seq = 0;
function ev(type: string, data: unknown, time = 1000): SessionEvent {
  seq += 1;
  return { type, seq, time, data } as unknown as SessionEvent;
}
function userMsg(text: string, time = 1000): SessionEvent {
  return ev('user/message', {
    id: `m-${seq}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }, time);
}
function pluginRecallMsg(text: string): SessionEvent {
  return ev('user/message', {
    id: `m-${seq}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'memory', form: 'recall' },
  });
}
function assistantMsg(text: string): SessionEvent {
  return ev('assistant/message', {
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    turn: undefined,
    step: undefined,
  });
}
function bracket(
  turn: number,
  opts: { user?: string; assistant?: string; reason?: string; pluginFirst?: boolean } = {},
): SessionEvent[] {
  const out: SessionEvent[] = [ev('turn/start', { turn })];
  if (opts.pluginFirst) out.push(pluginRecallMsg('【激活槽位】'));
  if (opts.user !== undefined) out.push(userMsg(opts.user));
  if (opts.assistant !== undefined) out.push(assistantMsg(opts.assistant));
  out.push(ev('turn/end', { turn, reason: { kind: opts.reason ?? 'completed' } }));
  return out;
}

describe('foldRecoverableTurns 折叠纯函数', () => {
  it('interrupted 尾轮:watermark=1 时恢复 turn 2,切片含 user/assistant/turn-end、不含 turn/start', () => {
    const events = [
      ...bracket(1, { user: '第一轮', assistant: '回复一' }),
      ...bracket(2, { user: '崩溃轮', reason: 'interrupted' }),
    ];
    const got = foldRecoverableTurns(events, 1);
    expect(got).toHaveLength(1);
    expect(got[0].turn).toBe(2);
    expect(got[0].startSeq).toBeLessThan(got[0].endSeq);
    const types = got[0].events.map((e) => e.type);
    expect(types).not.toContain('turn/start');
    expect(types).toContain('turn/end');
    expect(types).toContain('user/message');
  });

  it('watermark undefined(会话 L0 全空)→ 全部 bracket 可恢复', () => {
    const events = [...bracket(1, { user: 'a' }), ...bracket(2, { user: 'b' })];
    expect(foldRecoverableTurns(events, undefined).map((t) => t.turn)).toEqual([1, 2]);
  });

  it('watermark 已覆盖全部 → 空(不重放已落盘轮)', () => {
    const events = [...bracket(1, { user: 'a' }), ...bracket(2, { user: 'b' })];
    expect(foldRecoverableTurns(events, 2)).toEqual([]);
  });

  it('completed 闭合同样恢复(插件停机期间宿主正常完成的轮次也缺 L0)', () => {
    const events = [...bracket(1, { user: 'a', reason: 'completed' })];
    expect(foldRecoverableTurns(events, 0).map((t) => t.turn)).toEqual([1]);
  });

  it('未闭合 tail(只有 turn/start)跳过——等宿主 reload 补 interrupted 闭合后再恢复', () => {
    const events = [...bracket(1, { user: 'a' }), ev('turn/start', { turn: 2 }), userMsg('没说完')];
    expect(foldRecoverableTurns(events, 1)).toEqual([]);
  });

  it('上限 2:3 个未落盘 bracket 只恢复最后 2 个,且按 startSeq 升序', () => {
    const events = [
      ...bracket(1, { user: 'a' }),
      ...bracket(2, { user: 'b' }),
      ...bracket(3, { user: 'c' }),
      ...bracket(4, { user: 'd' }),
    ];
    const got = foldRecoverableTurns(events, 0);
    expect(got.map((t) => t.turn)).toEqual([3, 4]);
    expect(got[0].startSeq).toBeLessThan(got[1].startSeq);
  });

  it('乱序输入按 seq 防御性排序;插件注入消息(source.kind=plugin)不进消息,但 bracket 照常折叠', () => {
    const b1 = bracket(1, { user: 'a' });
    const b2 = bracket(2, { user: 'b', pluginFirst: true });
    const events = [...b2, ...b1]; // 故意乱序
    const got = foldRecoverableTurns(events, 0);
    expect(got.map((t) => t.turn)).toEqual([1, 2]);
    const types2 = got[1].events.map((e) => e.type);
    expect(types2).toContain('user/message');
  });
});

describe('MemoryDb 水位线:maxCapturedTurn / hasAnyL0Message', () => {
  const dbs: MemoryDb[] = [];
  let dir: string;
  afterAll(async () => {
    for (const db of dbs) db.close();
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  async function mkDb(): Promise<MemoryDb> {
    if (!dir) dir = await mkdtemp(join(tmpdir(), 'dsh-recover-'));
    const db = new MemoryDb(join(dir, `m-${Math.random().toString(36).slice(2)}.db`), 0);
    db.init();
    dbs.push(db);
    return db;
  }
  function l0row(db: MemoryDb, sessionId: string, turn: number, text: string) {
    const ok = db.upsertL0Batch([
      {
        id: `msg_${sessionId}_${turn}_${text}`,
        sessionId,
        role: 'user',
        content: text,
        recordedAt: '2026-09-27T00:00:00.000Z',
        timestamp: 1000 + turn,
        turn,
      } as never,
    ]);
    expect(ok).toBe(true);
  }

  it('空会话 maxCapturedTurn 返回 undefined;有行会话返回 MAX(turn)', async () => {
    const db = await mkDb();
    expect(db.maxCapturedTurn('s-none')).toBeUndefined();
    l0row(db, 's-a', 3, 'x');
    l0row(db, 's-a', 5, 'y');
    l0row(db, 's-a', 5, 'y2');
    expect(db.maxCapturedTurn('s-a')).toBe(5);
  });

  it('hasAnyL0Message:存在行 true / 不存在的 turn false / 无锚点(null turn)行不影响', async () => {
    const db = await mkDb();
    l0row(db, 's-b', 2, 'x');
    expect(db.hasAnyL0Message('s-b', 2)).toBe(true);
    expect(db.hasAnyL0Message('s-b', 3)).toBe(false);
    expect(db.hasAnyL0Message('s-missing', 1)).toBe(false);
  });

  it('turn 空洞是常态:MAX 跳档不破坏语义(probe ③ 实证形状)', async () => {
    const db = await mkDb();
    l0row(db, 's-c', 53, 'x');
    l0row(db, 's-c', 55, 'y');
    expect(db.maxCapturedTurn('s-c')).toBe(55);
    expect(db.hasAnyL0Message('s-c', 54)).toBe(false);
  });
});

describe('registerCapture 恢复接线(agent/session-start resume)', () => {
  function makeDeps() {
    const handlers = new Map<string, (...args: never[]) => unknown>();
    const ctx = { on: (name: string, cb: (...args: never[]) => unknown) => handlers.set(name, cb) } as unknown as Context;
    // T8.4 写停:capture 不再写正文,对水位表只做 record/maxTurn/hasAny——
    // 恢复的消息内容改从 runner.enqueue 侧断言。
    const recorded: Array<{ sid: string; turn: number; step?: number | null }> = [];
    const enqueued: Array<{ sid: string; messages: Array<{ role: string; content: string }>; mode: string }> = [];
    const infos: string[] = [];
    const warns: string[] = [];
    const watermark = {
      record: (sid: string, turn: number, step?: number | null) => {
        recorded.push({ sid, turn, ...(step === undefined ? {} : { step }) });
      },
      maxTurn: (_sid: string) => undefined as number | undefined,
      hasAny: (_sid: string, _turn: number) => false,
    };
    const runner = { enqueue: (sid: string, messages: never[], mode: string) => enqueued.push({ sid, messages, mode }) };
    const logger: MemoryLogger = {
      info: (m: string) => infos.push(String(m)),
      warn: (m: string) => warns.push(String(m)),
      error: () => {},
      debug: () => {},
    } as unknown as MemoryLogger;
    const live = { get: () => ({ enabled: true, capture: true, distill: true, recall: true, memoryMutate: false, conflictFreeze: false }) };
    const modes = { get: (_sid?: string) => 'auto' as const };
    const cfg = {
      capture: { enabled: true, maxMessageChars: 4000, stripCodeBlocks: true },
    } as unknown as MemoryConfig;
    return { ctx, handlers, recorded, enqueued, infos, warns, watermark, runner, logger, live, modes, cfg };
  }

  it('resume + 日志含尾轮 + 水位无该轮 → 尾轮登记水位且 enqueue 被调用', async () => {
    const d = makeDeps();
    const { recorded, enqueued } = d;
    d.watermark.maxTurn = () => 1; // turn 1 崩溃前已正常捕获,只有尾轮(turn 2)缺失
    const flush = registerCapture(d.ctx, d.cfg, d.runner as never, d.watermark as never, d.logger, d.live as never, d.modes as never);
    const onSessionStart = d.handlers.get('agent/created');
    expect(onSessionStart).toBeDefined();
    const events = [
      ...bracket(1, { user: '第一轮', assistant: '回复一' }),
      ...bracket(2, { user: '崩溃轮的宝贵输入', reason: 'interrupted' }),
    ];
    onSessionStart?.({ agent: { id: 'agent-1', session: { id: 's-rec', events, snapshotEvents: () => events, header: {} } }, source: 'resume' } as never);
    await flush?.();
    expect(recorded).toHaveLength(1);
    expect(recorded[0].sid).toBe('s-rec');
    expect(recorded[0].turn).toBe(2);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].mode).toBe('auto');
    expect(enqueued[0].messages.map((m) => m.content)).toContain('崩溃轮的宝贵输入');
  });

  it('幂等:水位判该轮已捕获 → 整轮跳过(不重复登记不重复蒸馏)', async () => {
    const d = makeDeps();
    const { recorded, enqueued } = d;
    d.watermark.maxTurn = () => 1; // turn 1 已捕获
    d.watermark.hasAny = (sid, turn) => sid === 's-rec' && turn <= 2;
    const flush = registerCapture(d.ctx, d.cfg, d.runner as never, d.watermark as never, d.logger, d.live as never, d.modes as never);
    const onSessionStart = d.handlers.get('agent/created');
    const events = [...bracket(2, { user: '部分写过的轮', reason: 'interrupted' })];
    onSessionStart?.({ agent: { id: 'agent-1', session: { id: 's-rec', events, snapshotEvents: () => events, header: {} } }, source: 'resume' } as never);
    await flush?.();
    expect(recorded).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it('off 档会话不恢复(完全隐身对齐现行为)', async () => {
    const d = makeDeps();
    const { recorded, enqueued } = d;
    (d.modes as { get: () => string }).get = () => 'off';
    const flush = registerCapture(d.ctx, d.cfg, d.runner as never, d.watermark as never, d.logger, d.live as never, d.modes as never);
    const onSessionStart = d.handlers.get('agent/created');
    const events = [...bracket(1, { user: 'a', reason: 'interrupted' })];
    onSessionStart?.({ agent: { id: 'agent-1', session: { id: 's-off', events, snapshotEvents: () => events, header: {} } }, source: 'resume' } as never);
    await flush?.();
    expect(recorded).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it('非 resume 来源(startup/clear/compact)不触发恢复', async () => {
    const d = makeDeps();
    const { recorded } = d;
    const flush = registerCapture(d.ctx, d.cfg, d.runner as never, d.watermark as never, d.logger, d.live as never, d.modes as never);
    const onSessionStart = d.handlers.get('agent/created');
    const events = [...bracket(1, { user: 'a', reason: 'interrupted' })];
    onSessionStart?.({ agent: { id: 'agent-1', session: { id: 's-x', events, snapshotEvents: () => events, header: {} } }, source: 'startup' } as never);
    await flush?.();
    expect(recorded).toHaveLength(0);
  });

  it('events 不可得(宿主版本偏差)→ 维持现状,不抛错不阻塞会话启动', async () => {
    const d = makeDeps();
    const { recorded } = d;
    const flush = registerCapture(d.ctx, d.cfg, d.runner as never, d.watermark as never, d.logger, d.live as never, d.modes as never);
    const onSessionStart = d.handlers.get('agent/created');
    expect(() =>
      onSessionStart?.({ agent: { id: 'agent-1', session: { id: 's-y' } }, source: 'resume' } as never),
    ).not.toThrow();
    await flush?.();
    expect(recorded).toHaveLength(0);
  });

  it('task_8 降级①:events 缺失但 ctx.sessionQuery.readSession 可得 → 从降级路径恢复', async () => {
    const d = makeDeps();
    const { recorded, enqueued } = d;
    (d.ctx as unknown as { get: (name: string) => unknown }).get = (name: string) =>
      name === 'sessionQuery'
        ? {
            readSession: (id: string) =>
              id === 's-rec'
                ? { header: {}, events: [...bracket(1, { user: '降级路径恢复', reason: 'interrupted' })] }
                : undefined,
          }
        : undefined;
    const flush = registerCapture(d.ctx, d.cfg, d.runner as never, d.watermark as never, d.logger, d.live as never, d.modes as never);
    const onSessionStart = d.handlers.get('agent/created');
    onSessionStart?.({ agent: { id: 'agent-1', session: { id: 's-rec' } }, source: 'resume' } as never);
    await flush?.();
    expect(recorded).toHaveLength(1);
    expect(enqueued[0].messages.map((m) => m.content)).toContain('降级路径恢复');
  });

  it('task_8 降级②:readSession 抛错 → sessionPersistence.readFrom 兜底', async () => {
    const d = makeDeps();
    const { recorded, enqueued } = d;
    (d.ctx as unknown as { get: (name: string) => unknown }).get = (name: string) => {
      if (name === 'sessionQuery') {
        return { readSession: () => { throw new Error('host version skew'); } };
      }
      if (name === 'sessionPersistence') {
        return {
          readFrom: (id: string, fromSeq: number) =>
            id === 's-rec' && fromSeq === 0
              ? { meta: {}, events: [...bracket(1, { user: 'readFrom 兜底恢复', reason: 'interrupted' })] }
              : undefined,
        };
      }
      return undefined;
    };
    const flush = registerCapture(d.ctx, d.cfg, d.runner as never, d.watermark as never, d.logger, d.live as never, d.modes as never);
    const onSessionStart = d.handlers.get('agent/created');
    expect(() =>
      onSessionStart?.({ agent: { id: 'agent-1', session: { id: 's-rec' } }, source: 'resume' } as never),
    ).not.toThrow();
    await flush?.();
    expect(recorded).toHaveLength(1);
    expect(enqueued[0].messages.map((m) => m.content)).toContain('readFrom 兜底恢复');
  });

  it('task_8 降级③:两服务全不可用 → 不抛错、现状行为、一次性提示(两次 resume 只提示一次)', async () => {
    const d = makeDeps();
    const { recorded, infos } = d;
    (d.ctx as unknown as { get: (name: string) => unknown }).get = () => undefined;
    const flush = registerCapture(d.ctx, d.cfg, d.runner as never, d.watermark as never, d.logger, d.live as never, d.modes as never);
    const onSessionStart = d.handlers.get('agent/created');
    for (let i = 0; i < 2; i++) {
      expect(() =>
        onSessionStart?.({ agent: { id: 'agent-1', session: { id: `s-z${i}` } }, source: 'resume' } as never),
      ).not.toThrow();
    }
    await flush?.();
    expect(recorded).toHaveLength(0);
    const notices = infos.filter((m) => m.includes('一次性'));
    expect(notices).toHaveLength(1);
  });
});
