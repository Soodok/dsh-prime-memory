/**
 * prime-memory-conflict-3axis:三轴(validFrom/validTo/persistence)注入 §C 矛盾冻结。
 *
 * 钉四件事:
 * ① 检测侧:`formatBatchConflictPrompt` 的候选池透传三轴字段(**受 `conflictFreeze` 门控**);
 * ② 裁决侧:`listConflictPairs` 的视图带双方三轴,且 `renderConflicts` 渲染出对比;
 * ③ 零漂移:三轴条款仅在开启时注入,关闭态 system / user **两路 prompt** 逐字节不变;
 * ④ 护栏:关闭态两路 prompt 与 system 三 mode 均有 **sha1 golden 锚**(task_a.5 / task_a.7)。
 *    ——原「不含某子串」的负式断言已升级:子串断言只证明「没多出某个词」,
 *    证明不了「逐字未变」,这正是本特性连续两轮漏判的成因。
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  formatBatchConflictPrompt,
  getConflictDetectionSystemPrompt,
  type CandidateMatch,
} from '../src/prompts/l1-dedup.js';
import { listConflictPairs, renderConflicts } from '../src/conflict-service.js';
import type { ConflictPair } from '../src/store/conflicts.js';
import type { ExtractMode, ExtractedMemory, MemoryRecord } from '../src/types.js';

const T = 1_700_000_000_000;
const sha1 = (s: string) => createHash('sha1').update(s, 'utf8').digest('hex');

/**
 * golden 锚(task_a.7):关闭态**系统** prompt 的 sha1 常量。
 * 基线沿革:升级前 `445c89f` 实跑 → §B 防注入声明(memorax-absorb Wave 2)加入后重锚
 * (2026-09-28 实跑) → pm-name-distill task_1.6 把 dedup 枚举串改为词表单一真源渲染
 * （计划内变更）后重锚(2026-10-13 实跑,长度: `auto` 4926 / `chat` 3530 / `work` 3777)。
 * 三个 mode 各一条,替代原先的负式子串断言。
 */
const SYSTEM_CLOSED_SHA1: Record<ExtractMode, string> = {
  auto: '7c49af36db6d2251386447064977995a0dfbe66e',
  chat: '4ab4e11f7eba1f9a7fd579423049f506c37d3263',
  work: '1c2a4c2f145294a7a1c3bfdac5513d9ecae5f67b',
};

function rec(
  id: string,
  content: string,
  axis?: Partial<Pick<MemoryRecord, 'validFrom' | 'validTo' | 'persistence'>>,
): MemoryRecord {
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
    ...axis,
  };
}

describe('检测侧:候选池透传三轴(conflict-3axis)', () => {
  const matches: CandidateMatch[] = [
    {
      newMemory: {
        record_id: 'n1',
        content: '新',
        type: 'episodic',
        priority: 50,
        source_message_ids: [],
        metadata: {},
        scene_name: 's',
      } as ExtractedMemory & { record_id: string },
      candidates: [rec('c1', '旧', { validFrom: T + 1000, validTo: undefined, persistence: 'o' })],
    },
  ];

  /**
   * golden 锚(task_a.5):关闭态 user prompt 的 sha1 常量(同一夹具)。
   * 基线沿革:升级前 `445c89f` 实跑(长度 513)→ §B 数据界定行加入后重锚(2026-09-28,长度 592)。
   * 这是「关闭态零漂移」的机械护栏——三轴键若漏了门控,此断言必红。
   */
  const CLOSED_STATE_SHA1 = '4cb29377368db4feb3fd3f4c5181e43878422ed6';
  /** 开启态候选池的 sha1(同一夹具):与关闭态必须不同,防「门控写反/恒开」。 */
  const ENABLED_STATE_SHA1 = 'd7641f02756565fd8e383b82c8ab8bc00a00f17e';

  it('关闭态候选池不含三轴键:user prompt 与改动前逐字节相同', () => {
    const off = formatBatchConflictPrompt(matches);
    expect(off).not.toContain('"valid_from_ms"');
    expect(off).not.toContain('"valid_to_ms"');
    expect(off).not.toContain('"persistence"');
    // 三轴取值本身也不得泄漏进关闭态 prompt
    expect(off).not.toContain(String(T + 1000));
    expect(sha1(off)).toBe(CLOSED_STATE_SHA1);
    // 显式 false 与省略 opts 等价(调用点按开关取值,两种写法都须零漂移)
    expect(sha1(formatBatchConflictPrompt(matches, { conflictFreeze: false }))).toBe(CLOSED_STATE_SHA1);
  });

  it('开启态候选池含三轴键且值正确透传', () => {
    const on = formatBatchConflictPrompt(matches, { conflictFreeze: true });
    expect(on).toContain('"valid_from_ms"');
    expect(on).toContain('"valid_to_ms"');
    expect(on).toContain('"persistence"');
    // 候选记录带的值被正确透传
    expect(on).toContain(String(T + 1000));
    expect(sha1(on)).toBe(ENABLED_STATE_SHA1);
  });

  it('关闭态系统 prompt 逐字节不变(零漂移):三 mode 与升级前 sha1 相同', () => {
    for (const m of ['auto', 'chat', 'work'] as ExtractMode[]) {
      const off = getConflictDetectionSystemPrompt(m, {});
      expect(off).not.toContain('三轴');
      expect(off).not.toContain('valid_from_ms');
      expect(sha1(off)).toBe(SYSTEM_CLOSED_SHA1[m]);
      // 显式 false 与省略 opts 等价(调用点按开关取值,两种写法都须零漂移)
      expect(sha1(getConflictDetectionSystemPrompt(m, { conflictFreeze: false }))).toBe(
        SYSTEM_CLOSED_SHA1[m],
      );
    }
  });

  it('开启态注入三轴判定条款', () => {
    const on = getConflictDetectionSystemPrompt('auto', { conflictFreeze: true });
    expect(on).toContain('三轴');
    expect(on).toContain('valid_from_ms');
    expect(on).toContain('persistence');
  });
});

describe('裁决侧:待裁决视图带三轴(conflict-3axis)', () => {
  const pair: ConflictPair = {
    pairId: 'pair-1',
    runId: 'run-1',
    winnerId: 'w-1',
    loserId: 'l-1',
    createdAt: new Date(T).toISOString(),
    resolvedAt: '',
    resolution: '',
  };
  function fakeL1(records: MemoryRecord[]) {
    return {
      listConflictPending: () => [pair],
      countConflictPendingUnresolved: () => 1,
      getByIds: (ids: string[]) => records.filter((r) => ids.includes(r.id)),
    };
  }

  it('视图带双方三轴,值正确透传', () => {
    const records = [
      rec('w-1', '胜方', { validFrom: T + 1000, validTo: T + 2000, persistence: 'o' }),
      rec('l-1', '败方', { validFrom: T, validTo: undefined, persistence: 's' }),
    ];
    const v = listConflictPairs({ l1: fakeL1(records), conflictFreezeEnabled: true });
    const it0 = v.items[0]!;
    expect(it0.winner_valid_from_ms).toBe(T + 1000);
    expect(it0.winner_valid_to_ms).toBe(T + 2000);
    expect(it0.winner_persistence).toBe('o');
    expect(it0.loser_valid_from_ms).toBe(T);
    expect(it0.loser_valid_to_ms).toBeNull();
    expect(it0.loser_persistence).toBe('s');
  });

  it('记录缺三轴 → 字段为 null,不报错', () => {
    const v = listConflictPairs({ l1: fakeL1([rec('w-1', 'A'), rec('l-1', 'B')]), conflictFreezeEnabled: true });
    const it0 = v.items[0]!;
    expect(it0.winner_valid_from_ms).toBeNull();
    expect(it0.winner_valid_to_ms).toBeNull();
    expect(it0.winner_persistence).toBeNull();
    expect(it0.loser_valid_from_ms).toBeNull();
    expect(it0.loser_valid_to_ms).toBeNull();
    expect(it0.loser_persistence).toBeNull();
  });
});

/**
 * 渲染侧(task_a.7):`renderConflicts` 是把三轴交到人眼前的最后一跳——
 * 此前**零用例覆盖**(文件头声称「渲染出对比」,但从未调用过它),
 * 故 axisLine / iso 两条新增逻辑实际处于无护栏状态。
 */
describe('渲染侧:renderConflicts 三轴对比(conflict-3axis)', () => {
  const base = {
    pair_id: 'pair-1',
    run_id: 'run-1',
    winner_id: 'w-1',
    winner_content: '胜方',
    loser_id: 'l-1',
    loser_content: '败方',
    created_at: '2026-09-16T00:00:00.000Z',
  };
  const DAY = 86_400_000;

  it('渲染出三轴对比(有效期起 / 有效期止 / 持续性)', () => {
    const out = renderConflicts({
      enabled: true,
      total: 1,
      items: [
        {
          ...base,
          winner_valid_from_ms: T,
          winner_valid_to_ms: T + 10 * DAY,
          winner_persistence: 'o',
          loser_valid_from_ms: T - 10 * DAY,
          loser_valid_to_ms: null,
          loser_persistence: 's',
        },
      ],
    });
    expect(out).toContain('三轴: 有效期起 2023-11-14 / 有效期止 2023-11-24 / 持续性 o');
    expect(out).toContain('三轴: 有效期起 2023-11-04 / 持续性 s');
    expect(out).not.toContain('有效期止 null');
  });

  it('三轴全缺时不产生多余空行', () => {
    const out = renderConflicts({
      enabled: true,
      total: 1,
      items: [
        {
          ...base,
          winner_valid_from_ms: null,
          winner_valid_to_ms: null,
          winner_persistence: null,
          loser_valid_from_ms: null,
          loser_valid_to_ms: null,
          loser_persistence: null,
        },
      ],
    });
    expect(out).not.toContain('三轴');
    // 无空行:胜方行与败方行相邻,且全文不存在纯空白行
    expect(out).toMatch(/LLM 建议胜方 w-1:胜方\n {3}LLM 建议败方 l-1:败方/);
    expect(out).not.toMatch(/^[ \t]+$/m);
  });
});
