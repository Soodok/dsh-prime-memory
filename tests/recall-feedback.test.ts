/**
 * 召回相关度反馈 sidecar（RecallFeedbackStore）回归。
 *
 * 钉住四件易被回退的事：
 *   1. `-1` **不进均值**（"过时"与"不相关"是两回事，混进均值会污染相关度口径）；
 *   2. 均值是**增量聚合**的（多次打分 = 加权平均，不是只留最后一次）；
 *   3. 写穿持久化：新实例从盘载回（打分是用户动作，崩了不该丢这一票）；
 *   4. 读侧逐条收窄：坏条目丢弃而不是拖垮整表。
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { RecallFeedbackStore, isFeedbackScore } from '../src/store/recall-feedback.js';

let root: string;
async function dir(): Promise<string> {
  if (!root) root = await mkdtemp(join(tmpdir(), 'dsh-feedback-'));
  return root;
}
afterAll(async () => {
  await Promise.all(open.map((s) => s.flush())); // 先等在途写完成(Windows 上顶回 ENOTEMPTY)
  if (root) await rm(root, { recursive: true, force: true });
});

/** 本套件创过的 store，供 afterAll 收口。 */
const open: RecallFeedbackStore[] = [];
function newFeedback(d: string): RecallFeedbackStore {
  const s = new RecallFeedbackStore(d);
  open.push(s);
  return s;
}

/** 每个用例独立子目录，避免同名 sidecar 互相污染。 */
async function fresh(): Promise<string> {
  const base = await dir();
  const sub = join(base, `s-${Math.random().toString(36).slice(2)}`);
  await mkdir(sub, { recursive: true }); // 用例要往里面预置坏文件,目录得先存在
  return sub;
}

describe('isFeedbackScore', () => {
  it('只认 -1 与 0..5，其余（含 5.5 / "-1" / null）一律拒', () => {
    for (const s of [-1, 0, 1, 2, 3, 4, 5]) expect(isFeedbackScore(s)).toBe(true);
    for (const bad of [-2, 6, 5.5, NaN, '-1', null, undefined, true]) expect(isFeedbackScore(bad)).toBe(false);
  });
});

describe('RecallFeedbackStore', () => {
  it('0..5 进均值、-1 不进均值但计 obsolete', async () => {
    const s = newFeedback(await fresh());
    await s.init();
    s.rate('a', 4);
    s.rate('a', 2);
    const mid = s.get('a')!;
    expect(mid.rated).toBe(2);
    expect(mid.mean).toBe(3);
    expect(mid.last).toBe(2);
    s.rate('a', -1);
    const after = s.get('a')!;
    expect(after.obsolete).toBe(1);
    expect(after.last).toBe(-1);
    // 关键:-1 不稀释相关度
    expect(after.rated).toBe(2);
    expect(after.mean).toBe(3);
  });

  it('只打 -1 时 rated=0 → meanOf 缺席(缺席 ≠ 0 分)', async () => {
    const s = newFeedback(await fresh());
    await s.init();
    s.rate('b', -1);
    expect(s.meanOf('b')).toBeUndefined();
    expect(s.lastOf('b')).toBe(-1);
    expect(s.get('b')!.mean).toBe(0);
  });

  it('revision 随每次有效写入递增(投影靠它判脏)', async () => {
    const s = newFeedback(await fresh());
    await s.init();
    const r0 = s.revision();
    s.rate('c', 5);
    expect(s.revision()).toBe(r0 + 1);
    s.rate('c', 1);
    expect(s.revision()).toBe(r0 + 2);
  });

  it('写穿持久化:新实例从盘载回聚合与轨迹', async () => {
    const dataDir = await fresh();
    const s = newFeedback(dataDir);
    await s.init();
    s.rate('d', 5);
    s.rate('d', 3);
    s.rate('e', -1);
    await s.flush();
    const t = newFeedback(dataDir);
    await t.init();
    expect(t.get('d')).toMatchObject({ rated: 2, mean: 4, last: 3 });
    expect(t.get('d')!.history.map((h) => h.s)).toEqual([5, 3]);
    expect(t.get('e')).toMatchObject({ obsolete: 1, last: -1 });
    expect(t.summary()).toMatchObject({ tracked: 2, rated: 2, obsolete: 1 });
  });

  it('损坏文件 → 只读降级:内存态照用、不再回写、不抛', async () => {
    const dataDir = await fresh();
    await writeFile(join(dataDir, 'recall-feedback.json'), '{ not json', 'utf8');
    const s = newFeedback(dataDir);
    await s.init();
    expect(s.get('x')).toBeUndefined();
    s.rate('x', 4); // 内存可用
    expect(s.meanOf('x')).toBe(4);
    await s.flush(); // 降级后静默不回写,不抛
    const raw = await readFileOrNull(join(dataDir, 'recall-feedback.json'));
    expect(raw).toBe('{ not json'); // 坏文件原样保留,没有被"修好"成空表
  });

  it('读侧逐条收窄:坏条目丢弃、好条目留下', async () => {
    const dataDir = await fresh();
    const body = {
      version: 1,
      entries: {
        ok: { last: 4, rated: 1, mean: 4, obsolete: 0, updatedAt: 1, history: [{ s: 4, at: 1 }] },
        badScore: { last: 9, rated: 1, mean: 4, obsolete: 0, updatedAt: 1, history: [] },
        badShape: 'nope',
        noUpdatedAt: { last: 1, rated: 1, mean: 1 },
        dirtyHistory: { last: 2, rated: 1, mean: 2, obsolete: 0, updatedAt: 2, history: [{ s: 7, at: 1 }, { s: 2, at: 2 }] },
      },
    };
    await writeFile(join(dataDir, 'recall-feedback.json'), JSON.stringify(body), 'utf8');
    const s = newFeedback(dataDir);
    await s.init();
    expect(s.get('ok')!.mean).toBe(4);
    expect(s.get('badScore')).toBeUndefined();
    expect(s.get('badShape')).toBeUndefined();
    expect(s.get('noUpdatedAt')).toBeUndefined();
    // history 里非法项被剔除,条目本身仍有效
    expect(s.get('dirtyHistory')!.history).toEqual([{ s: 2, at: 2 }]);
  });

  it('未 init 就读写 → 明确抛错(不静默给空表)', async () => {
    const s = newFeedback(await fresh());
    expect(() => s.get('z')).toThrow('未初始化');
    expect(() => s.rate('z', 1)).toThrow('未初始化');
  });
});

async function readFileOrNull(p: string): Promise<string | null> {
  try {
    return await (await import('node:fs/promises')).readFile(p, 'utf8');
  } catch {
    return null;
  }
}
