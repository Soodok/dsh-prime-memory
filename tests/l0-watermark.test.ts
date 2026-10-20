/**
 * L0 水位表单测(T8.4 写停,task_16)。
 *
 * 判据:水位单调、基线物化等价于退役 SQL 口径(MAX(turn))、重启持久、
 * OR IGNORE 不覆盖已有水位行。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MemoryDb } from '../src/store/sqlite.js';
import type { L0MessageRecord } from '../src/types.js';

let dir: string;
async function tmp(): Promise<string> {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'dsh-l0wm-'));
  return dir;
}
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

function seedRecords(sessionId: string, turns: number[], base = Date.now()): L0MessageRecord[] {
  return turns.map((turn, i) => ({
    sessionId,
    recordedAt: new Date(base + i).toISOString(),
    id: `${sessionId}-m${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `内容 ${i}`,
    timestamp: base + i,
    turn,
    ...(i === turns.length - 1 ? { step: 2 } : {}),
  }));
}

describe('L0WatermarkStore', () => {
  it(`init 建表;record/maxTurn/hasAny 基本语义`, async () => {
    const db = new MemoryDb(join(await tmp(), `wm-basic-${Date.now()}.db`), 0);
    db.init();
    try {
      const wm = db.l0Watermark;
      expect(wm.maxTurn('s-none')).toBeUndefined();
      expect(wm.hasAny('s-none', 1)).toBe(false);
      wm.record('s1', 3);
      wm.record('s1', 5, 1);
      expect(wm.maxTurn('s1')).toBe(5);
      // ≡ 退役前 hasAnyL0Message:turn ≤ 水位 = 已捕获
      expect(wm.hasAny('s1', 5)).toBe(true);
      expect(wm.hasAny('s1', 4)).toBe(true);
      expect(wm.hasAny('s1', 6)).toBe(false);
    } finally {
      db.close();
    }
  });

  it(`水位单调:更小/相等 turn 的登记不回退,不覆盖 last_step`, async () => {
    const db = new MemoryDb(join(await tmp(), `wm-mono-${Date.now()}.db`), 0);
    db.init();
    try {
      const wm = db.l0Watermark;
      wm.record('s1', 9, 4);
      wm.record('s1', 7, 99); // 回退登记被忽略
      expect(wm.maxTurn('s1')).toBe(9);
      expect(wm.hasAny('s1', 8)).toBe(true);
      // 同 turn 重复登记:MAX 语义下水位与既有 last_step 都不动
      wm.record('s1', 9, 0);
      expect(wm.maxTurn('s1')).toBe(9);
      const raw = (db as unknown as { db: { prepare(sql: string): { get(...p: unknown[]): unknown } } }).db
        .prepare('SELECT last_step FROM l0_watermark WHERE session_id = ?')
        .get('s1') as { last_step: number | null };
      expect(raw.last_step).toBe(4);
      // 非法入参安静忽略
      wm.record('', 3);
      wm.record('s1', Number.NaN);
      expect(wm.maxTurn('s1')).toBe(9);
    } finally {
      db.close();
    }
  });

  it('基线物化:存量 l0_conversations 行在重启后的 init 灌入,口径 ≡ MAX(turn)', async () => {
    const path = join(await tmp(), `wm-baseline-${Date.now()}.db`);
    // 第一代:写停前的世界——l0 三表有正文,水位表还是空
    const db1 = new MemoryDb(path, 0);
    db1.init();
    db1.upsertL0Batch(seedRecords('s-old', [2, 4, 5]));
    db1.upsertL0Batch(seedRecords('s-older', [1]));
    db1.close();
    // 第二代(升级后首次启动):init 基线物化,恢复对账直接拿到正确水位
    const db2 = new MemoryDb(path, 0);
    db2.init();
    try {
      const wm = db2.l0Watermark;
      expect(wm.maxTurn('s-old')).toBe(5);
      expect(wm.hasAny('s-old', 5)).toBe(true);
      expect(wm.hasAny('s-old', 6)).toBe(false);
      expect(wm.maxTurn('s-older')).toBe(1);
      // 无锚点旧行(turn NULL)不产出水位
      expect(wm.maxTurn('s-none')).toBeUndefined();
    } finally {
      db2.close();
    }
  });

  it(`ensureBaseline 幂等:已有水位行(活捕获已推进)不被存量行覆盖`, async () => {
    const path = join(await tmp(), `wm-idem-${Date.now()}.db`);
    const db1 = new MemoryDb(path, 0);
    db1.init();
    db1.upsertL0Batch(seedRecords('s1', [3, 5]));
    db1.close();
    const db2 = new MemoryDb(path, 0);
    db2.init();
    try {
      // 活捕获已把水位推到 10(存量行最多 5)
      db2.l0Watermark.record('s1', 10, 1);
      db2.l0Watermark.ensureBaseline();
      expect(db2.l0Watermark.maxTurn('s1')).toBe(10);
      expect(db2.l0Watermark.hasAny('s1', 10)).toBe(true);
      expect(db2.l0Watermark.hasAny('s1', 11)).toBe(false);
    } finally {
      db2.close();
    }
  });
});
