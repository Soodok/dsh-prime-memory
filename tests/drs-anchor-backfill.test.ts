/**
 * DRS 历史锚点回填纯核心单测(T8.2)。
 *
 * 覆盖:最近邻填充、四类保守放弃(no-drs-session/no-role-match/
 * out-of-window/ambiguous-turn)、已锚定行永不覆盖、行数不变式、幂等、
 * session 过滤与时间窗参数。
 */
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  applyAnchorBackfill,
  DEFAULT_WINDOW_MS,
  planAnchorBackfill,
  type AnchorSkipRow,
} from '../src/drs-anchor-backfill.js';

const MEMORY_DDL = `
  CREATE TABLE l0_conversations (
    record_id TEXT PRIMARY KEY,
    session_id TEXT DEFAULT 'default',
    role TEXT NOT NULL DEFAULT '',
    message_text TEXT NOT NULL,
    recorded_at TEXT DEFAULT '',
    timestamp INTEGER DEFAULT 0,
    turn INTEGER,
    step INTEGER
  )
`;

const DRS_DDL = `
  CREATE TABLE segments (
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    turn INTEGER DEFAULT 0,
    step INTEGER DEFAULT 0,
    role TEXT DEFAULT '',
    time INTEGER DEFAULT 0,
    PRIMARY KEY(session_id, seq)
  )
`;

interface L0Row {
  turn: number | null;
  step: number | null;
}

function seedMemory(db: DatabaseSync): void {
  db.exec(MEMORY_DDL);
  const insert = db.prepare(
    'INSERT INTO l0_conversations (record_id, session_id, role, message_text, recorded_at, timestamp, turn, step) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  insert.run('m1', 'sess-a', 'user', 'hello', '', 1500, null, null);
  insert.run('m2', 'sess-a', 'assistant', 'x', '', 99500, null, null);
  insert.run('m3', 'sess-a', 'user', 'y', '', 500_000, null, null);
  insert.run('m4', 'sess-a', 'user', 'z', '', 1600, 7, null);
  insert.run('m5', 'sess-b', 'user', 'w', '', 123_456, null, null);
  insert.run('m6', 'sess-c', 'user', 'v', '', 1_000, null, null);
}

function seedDrs(db: DatabaseSync): void {
  db.exec(DRS_DDL);
  const insert = db.prepare(
    'INSERT INTO segments (session_id, seq, turn, step, role, time) VALUES (?, ?, ?, ?, ?, ?)',
  );
  insert.run('sess-a', 1, 1, 1, 'user', 1500);
  insert.run('sess-a', 2, 2, 1, 'assistant', 99_000);
  insert.run('sess-a', 3, 3, 2, 'assistant', 99_900);
  insert.run('sess-c', 1, 1, 1, 'assistant', 1000);
}

function seedAll(): { memory: DatabaseSync; drs: DatabaseSync } {
  return { memory: new DatabaseSync(':memory:'), drs: new DatabaseSync(':memory:') };
}

function l0Row(db: DatabaseSync, recordId: string): L0Row {
  const rows = db.prepare('SELECT turn, step FROM l0_conversations WHERE record_id = ?').all(recordId) as Array<L0Row>;
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe('planAnchorBackfill', () => {
  it('classifies fills and all four skip reasons, never touching anchored rows', () => {
    const { memory, drs } = seedAll();
    seedMemory(memory);
    seedDrs(drs);

    const plan = planAnchorBackfill({ memory, drs });
    expect(plan.windowMs).toBe(DEFAULT_WINDOW_MS);
    expect(plan.candidates).toBe(5);
    expect(plan.drsSessions).toBe(2);
    expect(plan.alreadyAnchored).toBe(1);

    // m1:同 role 同会话零漂移 → 最近邻填充
    expect(plan.fills).toEqual([{
      recordId: 'm1', sessionId: 'sess-a', role: 'user',
      l0Timestamp: 1500, drsTime: 1500, deltaMs: 0, turn: 1, step: 1,
    }]);

    const reasonOf = (recordId: string): AnchorSkipRow['reason'] | undefined =>
      plan.skips.find(skip => skip.recordId === recordId)?.reason;
    expect(reasonOf('m2')).toBe('ambiguous-turn'); // 窗内两个不同 turn
    expect(reasonOf('m3')).toBe('out-of-window');
    expect(reasonOf('m5')).toBe('no-drs-session');
    expect(reasonOf('m6')).toBe('no-role-match');
    expect(plan.skips).toHaveLength(4);
    memory.close();
    drs.close();
  });

  it('honors sessionId filter and windowMs option', () => {
    const { memory, drs } = seedAll();
    seedMemory(memory);
    seedDrs(drs);

    const filtered = planAnchorBackfill({ memory, drs, sessionId: 'sess-a' });
    expect(filtered.candidates).toBe(3);
    expect(filtered.drsSessions).toBe(1);
    expect(filtered.skips.every(skip => skip.sessionId === 'sess-a')).toBe(true);

    // 窗口收紧到 100ms:m2 的两个候选(Δ500/Δ400)都出窗,歧义→出窗
    const tight = planAnchorBackfill({ memory, drs, windowMs: 100 });
    expect(tight.skips.find(skip => skip.recordId === 'm2')?.reason).toBe('out-of-window');
    // m1 零漂移仍在窗内
    expect(tight.fills.map(fill => fill.recordId)).toEqual(['m1']);
    memory.close();
    drs.close();
  });

  it('limit caps the candidate scan', () => {
    const { memory, drs } = seedAll();
    seedMemory(memory);
    seedDrs(drs);
    const plan = planAnchorBackfill({ memory, drs, limit: 2 });
    expect(plan.candidates).toBe(2);
    expect(plan.fills.length + plan.skips.length).toBeLessThanOrEqual(2);
    memory.close();
    drs.close();
  });
});

describe('applyAnchorBackfill', () => {
  it('fills only plan rows, never overwrites anchored rows, keeps row count invariant', () => {
    const { memory, drs } = seedAll();
    seedMemory(memory);
    seedDrs(drs);

    const plan = planAnchorBackfill({ memory, drs });
    const report = applyAnchorBackfill(memory, plan);
    expect(report.applied).toBe(1); // 只有 m1
    expect(report.invariantHolds).toBe(true);
    expect(report.totalRowsBefore).toBe(6);
    expect(report.totalRowsAfter).toBe(6);

    expect(l0Row(memory, 'm1')).toEqual({ turn: 1, step: 1 });
    // 已锚定行原样:turn 保留 7,step 仍 NULL(回填绝不覆盖)
    expect(l0Row(memory, 'm4')).toEqual({ turn: 7, step: null });
    // 放弃行保持 NULL(不伪造)
    expect(l0Row(memory, 'm2')).toEqual({ turn: null, step: null });
    expect(l0Row(memory, 'm3')).toEqual({ turn: null, step: null });
    expect(l0Row(memory, 'm5')).toEqual({ turn: null, step: null });
    expect(l0Row(memory, 'm6')).toEqual({ turn: null, step: null });
    memory.close();
    drs.close();
  });

  it('is idempotent: a second round has no candidates from previously filled rows', () => {
    const { memory, drs } = seedAll();
    seedMemory(memory);
    seedDrs(drs);

    const first = applyAnchorBackfill(memory, planAnchorBackfill({ memory, drs }));
    expect(first.applied).toBe(1);

    const secondPlan = planAnchorBackfill({ memory, drs });
    expect(secondPlan.fills).toEqual([]); // m1 已锚定,不再是候选
    expect(secondPlan.alreadyAnchored).toBe(2); // m4 + m1
    const second = applyAnchorBackfill(memory, secondPlan);
    expect(second.applied).toBe(0);
    expect(second.invariantHolds).toBe(true);
    memory.close();
    drs.close();
  });
});
