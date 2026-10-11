/**
 * 待裁决队列读视图（`listConflictPairs`）。
 *
 * ## 这个测试防的是什么
 *
 * §C 矛盾冻结的裁决端点（`dsh-memory/conflict-resolve`）一直都在，但**读**那一半
 * 曾经两端都缺：没有列出待裁决对的端点，也没有对应工具 —— 于是 `pair_id` 无处可得，
 * 队列成了只进不出的黑洞，安全阀超时自动了结会成为唯一出路。
 *
 * 补上读出口时最容易犯的两个错，都在这里钉住：
 *
 * ① **把"开关没开"说成"没有待裁决"** —— 两者在数据上都是空数组，但对人的含义
 *    完全相反：前者要去开开关，后者无事可做。混淆 = 用户以为系统没问题。
 * ② **只给 id 不给正文** —— 人工裁决的对象就是"这两条到底说了什么"，只给 id
 *    等于让人（或模型）盲判。
 */
import { describe, expect, it } from 'vitest';
import {
  CONFLICT_LIST_LIMIT_DEFAULT,
  CONFLICT_LIST_LIMIT_MAX,
  listConflictPairs,
} from '../src/conflict-service.js';
import type { ConflictPair } from '../src/store/conflicts.js';
import type { MemoryRecord } from '../src/types.js';

const T = 1_700_000_000_000;

function rec(id: string, content: string): MemoryRecord {
  return {
    id,
    content,
    type: 'episodic',
    priority: 50,
    scene_name: '日常',
    timestamps: [T],
    createdAt: T,
    updatedAt: T,
    version: 0,
    metadata: {},
    sessionId: 'default',
    family: 'chat',
  };
}

function pair(n: number): ConflictPair {
  return {
    pairId: `pair-${n}`,
    runId: `run-${n}`,
    winnerId: `w-${n}`,
    loserId: `l-${n}`,
    createdAt: new Date(T).toISOString(),
    resolvedAt: '',
    resolution: '',
  };
}

/** 最小 L1 夹具：三个方法都是读视图实际用到的那三个。 */
function fakeL1(pairs: ConflictPair[], records: MemoryRecord[], totalOverride?: number) {
  return {
    listConflictPending: (opts?: { limit?: number }) => pairs.slice(0, opts?.limit ?? pairs.length),
    countConflictPendingUnresolved: () => totalOverride ?? pairs.length,
    getByIds: (ids: string[]) => records.filter((r) => ids.includes(r.id)),
  };
}

describe('listConflictPairs：开关状态必须与"队列为空"分开', () => {
  it('未开启冻结 → enabled:false + 空列表 + notice（**不是**"没有待裁决"）', () => {
    const v = listConflictPairs({ l1: fakeL1([pair(1)], []), conflictFreezeEnabled: false });
    expect(v.enabled).toBe(false);
    expect(v.items).toEqual([]);
    expect(v.total).toBe(0);
    expect(v.notice, '必须给出可区分的说明，否则与"开了但没冲突"无从分辨').toContain('未开启');
  });

  it('未开启时**不读队列**（开关关着，队列内容不该泄漏出去）', () => {
    let called = false;
    const l1 = { ...fakeL1([pair(1)], []), listConflictPending: () => { called = true; return []; } };
    listConflictPairs({ l1, conflictFreezeEnabled: false });
    expect(called).toBe(false);
  });

  it('已开启但队列为空 → enabled:true + 空列表 + **无 notice**', () => {
    const v = listConflictPairs({ l1: fakeL1([], []), conflictFreezeEnabled: true });
    expect(v.enabled).toBe(true);
    expect(v.items).toEqual([]);
    expect(v.notice).toBeUndefined();
  });
});

describe('listConflictPairs：正文必须带上', () => {
  it('每对都带双方正文 —— 只给 id 等于让人盲判', () => {
    const records = [rec('w-1', '胜方说的是 A'), rec('l-1', '败方说的是 B')];
    const v = listConflictPairs({ l1: fakeL1([pair(1)], records), conflictFreezeEnabled: true });

    expect(v.items).toHaveLength(1);
    expect(v.items[0]!.winner_content).toBe('胜方说的是 A');
    expect(v.items[0]!.loser_content).toBe('败方说的是 B');
    expect(v.items[0]!.winner_id).toBe('w-1');
    expect(v.items[0]!.loser_id).toBe('l-1');
    expect(v.items[0]!.run_id).toBe('run-1');
  });

  it('记录已不在检索库 → 正文留空串，**不编造占位文案**（面板据此自行区分显示）', () => {
    // 只有胜方还在：败方被合并掉了
    const v = listConflictPairs({ l1: fakeL1([pair(1)], [rec('w-1', '只剩胜方')]), conflictFreezeEnabled: true });
    expect(v.items[0]!.winner_content).toBe('只剩胜方');
    expect(v.items[0]!.loser_content).toBe('');
  });

  it('两边都不在库 → 两条都空串，条目本身仍然返回（人对"这条对已无从裁决"有知情权）', () => {
    const v = listConflictPairs({ l1: fakeL1([pair(1)], []), conflictFreezeEnabled: true });
    expect(v.items).toHaveLength(1);
    expect(v.items[0]!.winner_content).toBe('');
    expect(v.items[0]!.loser_content).toBe('');
  });
});

describe('listConflictPairs：分页与总数', () => {
  it('limit 生效，且 total 报的是**未裁决总数**而非本页条数', () => {
    const pairs = [pair(1), pair(2), pair(3)];
    const v = listConflictPairs({ l1: fakeL1(pairs, [], 42), conflictFreezeEnabled: true });
    expect(v.items).toHaveLength(3);
    expect(v.total, '截断时必须让人知道还有多少没显示').toBe(42);
  });

  it('limit 超上限被夹到上限（不让人一个请求把页面拖死）', () => {
    let seen: number | undefined;
    const pairs = Array.from({ length: 10 }, (_, i) => pair(i));
    const l1 = {
      ...fakeL1(pairs, []),
      listConflictPending: (opts?: { limit?: number }) => {
        seen = opts?.limit;
        return pairs.slice(0, opts?.limit ?? pairs.length);
      },
    };
    listConflictPairs({ l1, conflictFreezeEnabled: true }, { limit: 99999 });
    expect(seen).toBe(CONFLICT_LIST_LIMIT_MAX);
  });

  it('不传 limit 用默认值；非法 limit（0 / NaN / 负数）也回落到默认值', () => {
    for (const bad of [undefined, 0, -5, Number.NaN, Number('abc')]) {
      let seen: number | undefined;
      const l1 = {
        ...fakeL1([], []),
        listConflictPending: (opts?: { limit?: number }) => {
          seen = opts?.limit;
          return [];
        },
      };
      listConflictPairs({ l1, conflictFreezeEnabled: true }, { limit: bad as number | undefined });
      expect(seen, `limit=${String(bad)}`).toBe(CONFLICT_LIST_LIMIT_DEFAULT);
    }
  });
});

describe('listConflictPairs：G3 成熟度旁注（读时派生，不自动裁决）', () => {
  it('默认（priority 50、无 usage、无半衰期）→ mid', () => {
    const records = [rec('w-1', 'A'), rec('l-1', 'B')];
    const v = listConflictPairs({ l1: fakeL1([pair(1)], records), conflictFreezeEnabled: true });
    expect(v.items[0]!.winner_maturity).toBe('mid');
    expect(v.items[0]!.loser_maturity).toBe('mid');
  });
  it('高优先级 + 多次被用 → high（usage 参与合成）', () => {
    const records = [{ ...rec('w-1', 'A'), priority: 90 }, rec('l-1', 'B')];
    const usage = { get: (_id: string) => ({ used: 8 }) };
    const v = listConflictPairs({ l1: fakeL1([pair(1)], records), conflictFreezeEnabled: true, usage, decayHalfLifeDays: 30 });
    expect(v.items[0]!.winner_maturity).toBe('high');
  });
  it('低优先级 → low（仅展示，outcome 集不变）', () => {
    const records = [{ ...rec('w-1', 'A'), priority: 10 }, rec('l-1', 'B')];
    const v = listConflictPairs({ l1: fakeL1([pair(1)], records), conflictFreezeEnabled: true, decayHalfLifeDays: 30 });
    expect(v.items[0]!.winner_maturity).toBe('low');
  });
});
