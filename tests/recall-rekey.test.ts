/**
 * 派生数据的 rekey（P0-d）：merge 将旧行退场、新行另铸 id，使用史与人工标注
 * 存在另两个 sidecar 里——不搬就等于**每次合并把这条记忆清零**。
 *
 * 现状正是这样（没人报，因为面板上看不到"曾经有过的标注"去哪了）。这里钉：
 *   - 计数相加、时刻取新，**不覆盖**新 id 上已有的条目；
 *   - 旧 id 无条目时返回 false 且**不造零条目**（否则表被噪声灌满）；
 *   - 人工那一笔 `-1`（已判过时）跟着走——它丢了就意味着一条被判过时的记忆
 *     以"未标注"的活状态回到召回里；
 *   - feedback 的 `revision()` 推进（投影靠它判脏，不推进卡片就停在旧的那一笔）。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { RecallUsageStore } from '../src/store/recall-usage.js';
import { RecallFeedbackStore } from '../src/store/recall-feedback.js';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

async function usageStore(): Promise<RecallUsageStore> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-rekey-u-'));
  dirs.push(dir);
  const s = new RecallUsageStore(dir);
  await s.init();
  return s;
}
async function feedbackStore(): Promise<RecallFeedbackStore> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-rekey-f-'));
  dirs.push(dir);
  const s = new RecallFeedbackStore(dir);
  await s.init();
  return s;
}

describe('RecallUsageStore.rekey', () => {
  it('把使用史搬到新 id：次数相加、时刻取新、旧条目消失', async () => {
    const s = await usageStore();
    s.recordAttempt(['old'], ['old']);
    s.recordAttempt(['old'], []);
    const before = s.get('old')!;
    expect(before.attempts).toBe(2);
    expect(before.used).toBe(1);

    expect(s.rekey('old', 'new')).toBe(true);
    const moved = s.get('new')!;
    expect(moved.attempts).toBe(before.attempts);
    expect(moved.used).toBe(before.used);
    expect(moved.lastUsedAt).toBe(before.lastUsedAt);
    expect(s.get('old')).toBeUndefined();
    s.flushSync();
  });

  it('新 id 上已有条目时相加，不是覆盖', async () => {
    const s = await usageStore();
    s.recordAttempt(['old'], ['old']);
    s.recordAttempt(['new'], []);
    s.rekey('old', 'new');
    const merged = s.get('new')!;
    expect(merged.attempts).toBe(2);
    expect(merged.used).toBe(1);
    s.flushSync();
  });

  it('旧 id 没条目 → false，且**不**给新 id 造一条全零记录', async () => {
    const s = await usageStore();
    expect(s.rekey('ghost', 'new')).toBe(false);
    expect(s.get('new')).toBeUndefined();
    expect(s.summary().tracked).toBe(0);
    s.flushSync();
  });

  it('oldId === newId 是空操作（幂等，不推条目）', async () => {
    const s = await usageStore();
    s.recordAttempt(['x'], ['x']);
    const snapshot = s.get('x')!;
    expect(s.rekey('x', 'x')).toBe(false);
    expect(s.get('x')).toEqual(snapshot);
    s.flushSync();
  });
});

describe('RecallFeedbackStore.rekey', () => {
  it('人工标注跟着走：计数相加、last 取较新一侧、revision 推进', async () => {
    const s = await feedbackStore();
    s.rate('old', 5, 1_000);
    s.rate('old', 3, 2_000);
    s.rate('new', 4, 1_500);
    const rev = s.revision();

    expect(s.rekey('old', 'new')).toBe(true);
    expect(s.revision()).toBeGreaterThan(rev);
    const merged = s.get('new')!;
    expect(merged.rated).toBe(3);
    // 均值按两侧加权合并：(4 + 5 + 3) / 3 = 4
    expect(merged.mean).toBe(4);
    // 较新一侧是搬来的那条（at=2000 > 1500）
    expect(merged.last).toBe(3);
    expect(s.get('old')).toBeUndefined();
    await s.flush();
  });

  it('那一笔 -1（已判过时）跟着走：obsolete 计数不丢、也不混进相关度均值', async () => {
    const s = await feedbackStore();
    s.rate('old', 4, 1_000);
    s.rate('old', -1, 2_000);
    s.rekey('old', 'new');
    const merged = s.get('new')!;
    expect(merged.obsolete).toBe(1);
    expect(merged.rated).toBe(1);
    expect(merged.mean).toBe(4);
    expect(merged.last).toBe(-1);
    expect(s.lastOf('new')).toBe(-1);
    await s.flush();
  });

  it('旧 id 无条目 → false，不给新 id 凭空造标注', async () => {
    const s = await feedbackStore();
    const rev = s.revision();
    expect(s.rekey('ghost', 'new')).toBe(false);
    expect(s.revision()).toBe(rev);
    expect(s.get('new')).toBeUndefined();
    await s.flush();
  });
});
