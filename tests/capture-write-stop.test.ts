/**
 * T8.4 写停不变式测试(drsc-redact-memory-wiring task_17,checklist 硬判据)。
 *
 * capture turn/end 后:
 * - l0_conversations / l0_fts / l0_vec 零新增行;
 * - conversations/*.jsonl 不再写(事实源退役);
 * - l0_watermark 推进到该 turn(hasAny 等价判定成立);
 * - 蒸馏直传照常拿到脱敏消息(R6:capture 单点脱敏语义不动)。
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { registerCapture } from '../src/hooks/capture.js';
import { SessionModeStore } from '../src/store/session-modes.js';
import { MemoryDb } from '../src/store/sqlite.js';
import type { ConversationMessage, MemoryLogger } from '../src/types.js';
import type { MemoryConfig } from '../src/config.js';

let dir: string;
async function tmp(): Promise<string> {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'dsh-write-stop-'));
  return dir;
}
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const SECRET = 'token= sk-proj-abcdefghijklmnop123456';

describe('capture 写停不变式', () => {
  it('turn/end 后三表零新增、JSONL 不落、水位推进、蒸馏直传仍脱敏', async () => {
    const dataDir = await tmp();
    const db = new MemoryDb(join(await tmp(), 'ws.db'), 0);
    db.init();
    try {
      const handlers = new Map<string, (s: unknown, e: SessionEvent) => void>();
      const ctx = { on: (name: string, cb: never) => handlers.set(name, cb as never) } as unknown as Context;
      const enqueued: Array<{ sid: string; messages: ConversationMessage[] }> = [];
      const runner = { enqueue: (sid: string, messages: ConversationMessage[]) => enqueued.push({ sid, messages }) };
      const logger: MemoryLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
      const live = { get: () => ({ enabled: true, capture: true }) };
      const modes = new SessionModeStore(join(dataDir, 'modes'), 'auto');
      const cfg = {
        capture: { enabled: true, maxMessageChars: 4000, stripCodeBlocks: false },
      } as unknown as MemoryConfig;
      const flush = registerCapture(ctx, cfg, runner as never, db.l0Watermark, logger, live as never, modes);

      const now = Date.now() + 60_000;
      const ev = (type: string, data: unknown, i: number): SessionEvent =>
        ({ type, seq: i, time: now, data }) as unknown as SessionEvent;
      const onEvent = handlers.get('session/event')!;
      const session = { id: 's-ws' };
      onEvent(session, ev('turn/start', { turn: 4 }, 1));
      onEvent(session, ev('step/start', { turn: 4, step: 2 }, 2));
      onEvent(
        session,
        ev('user/message', { content: [{ type: 'text', text: `密钥 ${SECRET}` }], source: { kind: 'user' } }, 3),
      );
      onEvent(
        session,
        ev('assistant/message', { turn: 4, step: 2, message: { content: [{ type: 'text', text: '收到' }] } }, 4),
      );
      onEvent(session, ev('turn/end', { turn: 4 }, 5));
      await flush();

      // 三表零新增(写停前该会话无行,捕获后仍无行;表缺席 = 0 行,同为满足)
      const countOf = (table: string): number => {
        const raw = db as unknown as { db: { prepare(s: string): { get(...p: unknown[]): unknown } } };
        const exists = raw.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(table);
        if (exists === undefined) return 0;
        return ((raw.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
      };
      expect(countOf('l0_conversations')).toBe(0);
      expect(countOf('l0_fts')).toBe(0);
      expect(countOf('l0_vec')).toBe(0);
      // JSONL 事实源退役:conversations 目录不被创建
      await expect(readdir(join(dataDir, 'conversations'))).rejects.toThrow();
      // 水位推进 + hasAny 等价判定
      expect(db.l0Watermark.maxTurn('s-ws')).toBe(4);
      expect(db.l0Watermark.hasAny('s-ws', 4)).toBe(true);
      expect(db.l0Watermark.hasAny('s-ws', 5)).toBe(false);
      // 蒸馏直传照常,且 capture 单点脱敏语义不动
      expect(enqueued).toHaveLength(1);
      expect(enqueued[0].messages.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(enqueued[0].messages[0].content).toContain('[REDACTED:API_KEY]');
      expect(enqueued[0].messages[0].content).not.toContain('sk-proj');
      expect(enqueued[0].messages[0].anchor).toEqual({ sessionId: 's-ws', turn: 4, step: 2 });
    } finally {
      db.close();
    }
  });
});
