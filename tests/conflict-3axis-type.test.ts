/**
 * §C Phase 3(task_3.7):轴 2(`conflict_type`)/ 轴 3(`claim_key`)。
 *
 * 钉五件事:
 * ① **零漂移**(task_3.1):两轴条款只在 `conflictFreeze` 开启时**追加**,
 *    关闭态三 mode 仍与升级前 sha1 golden 相等,且既有条款块**逐字仍在**
 *    (「追加而非重写」的机械判据:`on.toContain(CONFLICT_ACTION_CLAUSE)`);
 * ② **fail-closed**(task_3.2):畸形输入一律落 `hard` + 空键,**绝不**回落 store;
 * ③ **落库与投影**(task_3.3):两列写入/读回/旧库 ALTER 迁移,且**不进**快照哈希投影;
 * ④ **类型路由**(task_3.4):额度只按 `hard` 计——判据抽成纯函数,SQL 侧另有实测;
 * ⑤ **读取面与退场审计**(task_3.5/3.6):三类可区分,退场标记带得走类型。
 *
 * 口径说明(诚实标注):task_3.4 的**分支条件**由 `conflicts.ts` 的两个纯函数承载并在此
 * 实测,库侧过滤由真实 SQL 实测;`runExtraction` 的那一跳**没有端到端覆盖**——
 * 它需要可注入 LLM 的管线夹具,本项目目前没有(已在 tasks.md 如实标注)。
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';

import { listConflictPairs, renderConflicts, resolveConflictPair } from '../src/conflict-service.js';
import {
  CONFLICT_ACTION_CLAUSE,
  CONFLICT_TYPE_CLAUSE,
  getConflictDetectionSystemPrompt,
} from '../src/prompts/l1-dedup.js';
import {
  CONFLICT_TYPES,
  buildConflictPair,
  groupConflictPairsByClaim,
  normalizeClaimKey,
  normalizeConflictType,
  occupiesConflictQuota,
  pendingHardTotal,
  type ConflictPair,
} from '../src/store/conflicts.js';
import { L1Store } from '../src/store/l1.js';
import { hashJson, projectConflictsForHash } from '../src/store/l1-snapshot.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { readSupersedeMarker, withSupersedeMarker } from '../src/store/supersede.js';
import type { ExtractMode, MemoryRecord } from '../src/types.js';

const T = 1_700_000_000_000;
const ISO_T = new Date(T).toISOString();
const noopLogger = { info: () => {}, warn: () => {}, error: () => {} } as never;
const sha1 = (s: string) => createHash('sha1').update(s, 'utf8').digest('hex');

/** 关闭态 golden 锚:与 `tests/conflict-3axis.test.ts` **同源同值**。
 *  基线沿革:升级前 `445c89f` 实跑 → §B 防注入声明(memorax-absorb Wave 2)加入后重锚(2026-09-28 实跑)
 *  → pm-name-distill task_1.6 dedup 枚举串改真源渲染后重锚(2026-10-13 实跑)。 */
const SYSTEM_CLOSED_SHA1: Record<ExtractMode, string> = {
  auto: '7c49af36db6d2251386447064977995a0dfbe66e',
  chat: '4ab4e11f7eba1f9a7fd579423049f506c37d3263',
  work: '1c2a4c2f145294a7a1c3bfdac5513d9ecae5f67b',
};
const MODES: ExtractMode[] = ['auto', 'chat', 'work'];

// ─────────────────────────────────────────────────────────────────────────────
// ① task_3.1 — 两轴条款:开启态追加,关闭态零漂移
// ─────────────────────────────────────────────────────────────────────────────

describe('task_3.1 prompt:两轴条款只追加、不改写', () => {
  it('关闭态三 mode 逐字节不变(sha1 golden 锚仍相等)', () => {
    for (const m of MODES) {
      const off = getConflictDetectionSystemPrompt(m, { conflictFreeze: false });
      expect(off).not.toContain('conflict_type');
      expect(off).not.toContain('claim_key');
      expect(off).not.toContain(CONFLICT_TYPE_CLAUSE);
      expect(sha1(off), `${m} 关闭态漂移`).toBe(SYSTEM_CLOSED_SHA1[m]);
      // 省略 opts 与显式 false 等价(调用点按开关取值)
      expect(getConflictDetectionSystemPrompt(m, {})).toBe(off);
    }
  });

  it('开启态:既有条款块逐字仍在(追加而非重写)', () => {
    for (const m of MODES) {
      const on = getConflictDetectionSystemPrompt(m, { conflictFreeze: true });
      // 最强判据:既有整块作为**连续子串**仍在 ⇒ 它没有被改写(审计 S8 的三处措辞
      // —— 首行 `- "conflict"：`、winner/loser 必须不同、`不覆盖|不合并` —— 都在这块里)
      expect(on).toContain(CONFLICT_ACTION_CLAUSE);
      expect(on).toContain('- "conflict"：');
      expect(on).toMatch(/winner[\s\S]{0,80}loser[\s\S]{0,40}(必须不同|不得相同|不能相同)/);
      expect(on).toContain('不覆盖、不合并');
      // 追加顺序:新字段块在既有块**之后**(而不是插进它的 JSON 块里)
      expect(on.indexOf(CONFLICT_TYPE_CLAUSE)).toBeGreaterThan(on.indexOf(CONFLICT_ACTION_CLAUSE));
    }
  });

  it('开启态:两轴字段、三枚举与「拿不准填 hard / 留空」的兜底措辞齐备', () => {
    const on = getConflictDetectionSystemPrompt('chat', { conflictFreeze: true });
    expect(on).toContain('"conflict_type"');
    expect(on).toContain('"claim_key"');
    for (const t of CONFLICT_TYPES) expect(on).toContain(`"${t}"`);
    // 兜底措辞:畸形/缺失不阻断配对(否则模型漏一个字段就会丢掉整条 conflict 决策)
    expect(on).toMatch(/拿不准[^\n]{0,12}hard/);
    expect(on).toMatch(/留空/);
    expect(on).toMatch(/不影响这条决策是否成立/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② task_3.2 — fail-closed 归一
// ─────────────────────────────────────────────────────────────────────────────

describe('task_3.2 fail-closed 归一:畸形输入落 hard + 空键(不回落 store)', () => {
  /** 非字符串:对两条轴都是"畸形"。 */
  const NON_STRING: unknown[] = [undefined, null, 42, true, {}, []];
  /** 空 / 纯空白:对两条轴都是"没给值"。 */
  const BLANK: unknown[] = ['', '   '];
  /** 仅对**枚举**轴畸形:claim 键是自由标识,字符串一律保留(没有枚举可校验)。 */
  const BAD_ENUM: unknown[] = ['HARD', 'Hard', 'hard-ish', 'hard\n', 'unknown'];
  const caseOf = (v: unknown): [string, unknown] => [JSON.stringify(v) ?? 'undefined', v];
  const VALID_PADDED: Array<[unknown, string]> = [
    ['hard', 'hard'],
    [' conditional ', 'conditional'],
    ['supersession', 'supersession'],
  ];

  it.each([...NON_STRING, ...BLANK, ...BAD_ENUM].map(caseOf))('conflict_type %s → hard', (_label, v) => {
    expect(normalizeConflictType(v)).toBe('hard');
  });

  it.each(VALID_PADDED)('conflict_type %s 归一为 %s', (v, want) => {
    expect(normalizeConflictType(v)).toBe(want);
  });

  it.each([...NON_STRING, ...BLANK].map(caseOf))('claim_key %s → 空串', (_label, v) => {
    expect(normalizeClaimKey(v)).toBe('');
  });

  it('claim_key 是自由标识:字符串 trim 后原样保留(不做枚举校验)', () => {
    expect(normalizeClaimKey('  deploy.port  ')).toBe('deploy.port');
    expect(normalizeClaimKey('proj-x.ci.provider')).toBe('proj-x.ci.provider');
    // 与 conflict_type 的关键差别:不在这三枚举里的字符串**不能**被抹成空键
    expect(normalizeClaimKey('Hard')).toBe('Hard');
    expect(normalizeClaimKey('hard-ish')).toBe('hard-ish');
    expect(normalizeClaimKey('   ')).toBe('');
  });

  it('空键**不阻断**配对:带空键的对与不带键的对是同一个 pair_id', () => {
    const base = { runId: 'r', winnerId: 'w', loserId: 'l', createdAt: ISO_T };
    const a = buildConflictPair({ ...base, conflictType: 'hard', claimKey: '' });
    const b = buildConflictPair(base);
    expect(a.pairId).toBe(b.pairId);
    // 「只在有值时写键」:显式传空串算有值,省略则连键都不写——磁盘上仍是同一行
    expect(a.claimKey).toBe('');
    expect(b.claimKey).toBeUndefined();
  });

  it('两轴**不进** pair_id 输入(键值不同/类型不同 ⇒ 同一 pair_id)', () => {
    const base = { runId: 'r', winnerId: 'w', loserId: 'l', createdAt: ISO_T };
    const ids = (['hard', 'conditional', 'supersession'] as const).flatMap((t) =>
      ['', 'deploy.port', 'proj-x.ci'].map((k) => buildConflictPair({ ...base, conflictType: t, claimKey: k }).pairId),
    );
    expect(new Set(ids).size, 'pair_id 只由 runId+winner+loser 决定').toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ task_3.3 — 两列落库 / 投影链 / 旧库迁移 / 分组读取(真实 DB)
// ─────────────────────────────────────────────────────────────────────────────

let dir: string;
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

function uniquePath(tag: string, ext: string): string {
  return join(dir, `${tag}-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
}
async function freshDbFile(tag: string): Promise<string> {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'dsh-conflict-3axis-type-'));
  return uniquePath(tag, '.db');
}
async function freshDataDir(tag: string): Promise<string> {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'dsh-conflict-3axis-type-'));
  const d = uniquePath(tag, '');
  await mkdir(d, { recursive: true });
  return d;
}

function pairOf(tag: string, extra: Partial<ConflictPair> = {}): ConflictPair {
  return {
    ...buildConflictPair({
      runId: `run-${tag}`,
      winnerId: `w-${tag}`,
      loserId: `l-${tag}`,
      createdAt: ISO_T,
    }),
    ...extra,
  };
}

describe('task_3.3 落库与投影链(真实 DB)', () => {
  it('写入即归一、读回即归一:畸形值不会落库成脏值', async () => {
    const db = new MemoryDb(await freshDbFile('normalize'), 0);
    db.init();
    try {
      // 绕过 TS 直接把畸形值塞进 store 的写侧:归一必须是**存储层自己**的责任,
      // 不能指望每个调用方都记得先调 normalize(否则脏值只会在读侧被掩盖)
      db.recordConflictPending([
        pairOf('a', { conflictType: 'HARD-ISH' as never, claimKey: 42 as never }),
        pairOf('b', { conflictType: ' conditional ' as never, claimKey: '  deploy.port ' as never }),
      ]);
      const byId = new Map(db.listConflictPending({ limit: 10 }).map((r) => [r.winnerId, r]));
      expect(byId.get('w-a')?.conflictType).toBe('hard');
      expect(byId.get('w-a')?.claimKey).toBe('');
      expect(byId.get('w-b')?.conflictType).toBe('conditional');
      expect(byId.get('w-b')?.claimKey).toBe('deploy.port');
    } finally {
      db.close();
    }
  });

  it('旧库(仅 7 列)打开时 ALTER 补两列,旧行读回 hard + 空键', async () => {
    const file = await freshDbFile('legacy');
    const legacy = new DatabaseSync(file);
    legacy.exec(`
      CREATE TABLE conflict_pending (
        pair_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL DEFAULT '',
        winner_id TEXT NOT NULL DEFAULT '',
        loser_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT '',
        resolved_at TEXT NOT NULL DEFAULT '',
        resolution TEXT NOT NULL DEFAULT ''
      )
    `);
    legacy
      .prepare(
        `INSERT INTO conflict_pending (pair_id, run_id, winner_id, loser_id, created_at, resolved_at, resolution)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('legacy-pair', 'run-legacy', 'w-legacy', 'l-legacy', ISO_T, '', '');
    legacy.close();

    const db = new MemoryDb(file, 0);
    db.init();
    const cols = (
      (
        db as unknown as { db: { prepare: (s: string) => { all: () => Array<{ name: string }> } } }
      ).db.prepare('PRAGMA table_info(conflict_pending)').all()
    ).map((c) => c.name);
    // Phase 2 的三列与 Phase 3 的两列都必须补齐(缺一即"旧行读得回默认值"的判据失效)
    for (const c of ['reviewed_at', 'deferred_at', 'defer_count', 'conflict_type', 'claim_key']) {
      expect(cols, `缺列 ${c}`).toContain(c);
    }
    const [legacyRow] = db.listConflictPending({ limit: 10 });
    expect(legacyRow?.pairId).toBe('legacy-pair');
    expect(legacyRow?.conflictType).toBe('hard');
    expect(legacyRow?.claimKey).toBe('');
    db.close();

    // 迁移可重复执行:二次打开不报错(ALTER 的存在性判据把重复执行挡在外面)
    const db2 = new MemoryDb(file, 0);
    expect(() => db2.init()).not.toThrow();
    db2.close();
  });

  it('两列**不进**快照哈希投影(反向:原始行哈希确实变了)', () => {
    const base = pairOf('h1');
    const withAxes: ConflictPair = { ...base, conflictType: 'supersession', claimKey: 'deploy.port' };
    // 投影只取 7 字段 ⇒ 两轴的取值不改变旧 manifest 的哈希输入
    expect(hashJson(projectConflictsForHash([withAxes]))).toBe(hashJson(projectConflictsForHash([base])));
    // 而原始行**确实**变了 —— 这正是"列投影必须存在"的反向证明
    expect(hashJson([withAxes])).not.toBe(hashJson([base]));
  });

  it('listConflictGroupedByClaim:同键归并、组内按 pair_id 去重、空键那组排最后', async () => {
    const db = new MemoryDb(await freshDbFile('group'), 0);
    db.init();
    try {
      const g1 = pairOf('g1', { claimKey: 'deploy.port' });
      const g2 = pairOf('g2', { claimKey: 'deploy.port' });
      const g3 = pairOf('g3', { claimKey: 'deploy.port' });
      const g4 = pairOf('g4', { claimKey: 'proj-x.ci' });
      const g5 = pairOf('g5');
      // 第四次写入是 g1 的重复(主键幂等):组内不得因此虚胖
      db.recordConflictPending([g1, g2, g3, g4, g5, g1]);

      const groups = db.listConflictGroupedByClaim({ limit: 100 });
      expect(groups.map((g) => g.claimKey)).toEqual(['deploy.port', 'proj-x.ci', '']);
      expect(groups[0]?.pairs.map((p) => p.pairId)).toEqual(
        [g1, g2, g3].map((p) => p.pairId).sort(),
      );
      expect(groups[1]?.pairs.map((p) => p.pairId)).toEqual([g4.pairId]);
      expect(groups[2]?.pairs.map((p) => p.pairId)).toEqual([g5.pairId]);
      // 全库仍是 5 行(去重发生在**组内**,不是把行删掉)
      expect(db.listConflictPending({ limit: 100 })).toHaveLength(5);
    } finally {
      db.close();
    }
  });

  it('纯函数:同一对从两条路径汇入也不重复(组内按 pair_id 去重)', () => {
    const p = pairOf('dup', { claimKey: 'k' });
    const groups = groupConflictPairsByClaim([p, { ...p }, pairOf('other', { claimKey: 'k' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.pairs).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ task_3.4 — 类型路由:额度只按 hard 计
// ─────────────────────────────────────────────────────────────────────────────

describe('task_3.4 类型路由:只有 hard 占额度', () => {
  it('占额度的类型表:hard 占,conditional / supersession 不占', () => {
    expect(occupiesConflictQuota('hard')).toBe(true);
    expect(occupiesConflictQuota('conditional')).toBe(false);
    expect(occupiesConflictQuota('supersession')).toBe(false);
  });

  it('本轮 hard 未裁决数 = 库内 hard 数 + 未了结的 hard 停放数(非 hard 不计)', () => {
    const frozen: ConflictPair[] = [
      pairOf('f1', { conflictType: 'hard' }), // 未裁决 → 计
      pairOf('f2', { conflictType: 'conditional' }), // 不占额度 → 不计
      pairOf('f3', { conflictType: 'supersession' }), // 不占额度 → 不计
      pairOf('f4', { conflictType: 'hard', resolvedAt: ISO_T, resolution: 'auto' }), // 已了结 → 不计
      { ...pairOf('f5'), conflictType: undefined }, // 未分类按 hard 处理 → 计
    ];
    expect(pendingHardTotal(4, frozen)).toBe(6);
    expect(pendingHardTotal(0, [])).toBe(0);
  });

  it('SQL 侧实测:未裁决计数可按 hard 过滤,不过滤时仍是全部', async () => {
    const db = new MemoryDb(await freshDbFile('count'), 0);
    db.init();
    try {
      db.recordConflictPending([
        pairOf('c1', { conflictType: 'hard' }),
        pairOf('c2', { conflictType: 'hard' }),
        pairOf('c3', { conflictType: 'conditional' }),
        pairOf('c4', { conflictType: 'supersession' }),
        pairOf('c5', { conflictType: 'hard', resolvedAt: ISO_T, resolution: 'auto' }),
      ]);
      expect(db.countConflictPendingUnresolved({ conflictType: 'hard' })).toBe(2);
      // 默认不带过滤 ⇒ 全部未裁决(读取面/面板的 total 语义不受本轮改动影响)
      expect(db.countConflictPendingUnresolved()).toBe(4);
      expect(db.countConflictPendingUnresolved({ conflictType: 'conditional' })).toBe(1);
    } finally {
      db.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ task_3.5 — 读取面;task_3.6 — 退场标记带类型
// ─────────────────────────────────────────────────────────────────────────────

function rec(id: string, content: string): MemoryRecord {
  return {
    id,
    content,
    type: 'work_fact',
    priority: 60,
    scene_name: 's',
    timestamps: [T],
    createdAt: T,
    updatedAt: T,
    version: 0,
    metadata: {},
    sessionId: 'default',
    family: 'work',
  };
}

describe('task_3.5 读取面:三类可区分', () => {
  const pairs: ConflictPair[] = [
    { ...pairOf('t1'), conflictType: 'conditional', claimKey: 'deploy.port' },
    { ...pairOf('t2'), conflictType: 'supersession' },
    { ...pairOf('t3') }, // 未分类 → 兜底 hard
  ];
  const fakeL1 = {
    listConflictPending: () => pairs,
    countConflictPendingUnresolved: () => pairs.length,
    getByIds: (ids: string[]) => ids.map((id) => rec(id, `正文-${id}`)),
  };

  it('items 带上 conflict_type / claim_key,缺值兜底 hard + 空串', () => {
    const v = listConflictPairs({ l1: fakeL1, conflictFreezeEnabled: true });
    const types = v.items.map((i) => i.conflict_type);
    expect(types).toEqual(['conditional', 'supersession', 'hard']);
    expect(new Set(types).size, '三类必须可区分').toBe(3);
    expect(v.items[0]?.claim_key).toBe('deploy.port');
    expect(v.items[1]?.claim_key).toBe('');
    expect(v.items[2]?.claim_key).toBe('');
  });

  it('renderConflicts 把类型与 claim 键印在抬头(否则"不占额度"无从解释)', () => {
    const out = renderConflicts(listConflictPairs({ l1: fakeL1, conflictFreezeEnabled: true }));
    expect(out).toContain('类型 conditional · claim deploy.port');
    expect(out).toContain('类型 supersession');
    expect(out).toMatch(/类型 hard\n/);
  });
});

describe('task_3.6 退场审计串上类型(真实 store round-trip)', () => {
  async function seed(tag: string, withType: boolean) {
    const dataDir = await freshDataDir(tag);
    const db = new MemoryDb(join(dataDir, 'memory.db'), 0);
    db.init();
    const store = new L1Store(dataDir, db, undefined, 'keyword', noopLogger, 0);
    await store.init();
    const winnerId = `mem_w_${tag}`;
    const loserId = `mem_l_${tag}`;
    db.upsertL1Batch([rec(winnerId, '胜方'), rec(loserId, '败方')] as never);
    const pair: ConflictPair = {
      ...buildConflictPair({
        runId: `run-${tag}`,
        winnerId,
        loserId,
        createdAt: ISO_T,
        ...(withType ? { conflictType: 'conditional' as const, claimKey: 'deploy.port' } : {}),
      }),
    };
    store.recordConflictPending([pair]);
    return { db, store, pair, winnerId, loserId };
  }

  it('人工裁决 conditional 对 ⇒ 退场标记写回 verdict / pairId / conflictType', async () => {
    const h = await seed('typed', true);
    try {
      const r = await resolveConflictPair(
        { l1: h.store, conflictFreezeEnabled: true },
        h.pair.pairId,
        'winner',
      );
      expect(r.notice).toBeUndefined();
      expect(r.removed_record_id).toBe(h.loserId);
      const [gone] = h.store.getByIds([h.loserId]);
      expect(gone, '软删:主表行必须保留').toBeDefined();
      expect(readSupersedeMarker(gone?.metadata)).toMatchObject({
        reason: 'conflict',
        verdict: 'winner',
        pairId: h.pair.pairId,
        conflictType: 'conditional',
      });
    } finally {
      h.db.close();
    }
  });

  it('未显式给类型的对:库读回后是 hard(列默认值),标记如实带上它;而 store 层直调不凭空写键', async () => {
    const h = await seed('untyped', false);
    try {
      const r = await resolveConflictPair(
        { l1: h.store, conflictFreezeEnabled: true },
        h.pair.pairId,
        'winner',
      );
      expect(r.notice).toBeUndefined();
      const [gone] = h.store.getByIds([h.loserId]);
      const marker = readSupersedeMarker(gone?.metadata);
      expect(marker).toMatchObject({ reason: 'conflict', verdict: 'winner' });
      // 实跑发现(初版断言写反了):`resolveConflictPair` 的对来自**库读回**,
      // 而 `conflict_type` 列的默认值就是 'hard' ⇒ 未分类的对在读取面已经是 hard。
      // 所以标记里出现 'hard' **不是**"凭空多写了一个键",而是把列默认值显式化——
      // 这正是"未分类 = 硬冲突"这条语义在审计链上的落点。
      expect(marker).toHaveProperty('conflictType', 'hard');

      // 写侧「有值才写键」的机械判据在**store 层直调**上仍然成立(既有精确断言守的就是这层):
      // 不经库读回的对没有类型 ⇒ 标记里不得出现该键。
      const h2 = await seed('untyped-direct', false);
      try {
        h2.store.retire([h2.loserId], {
          at: new Date(T).toISOString(),
          reason: 'conflict',
          verdict: 'winner',
          pairId: h2.pair.pairId,
        });
        const [gone2] = h2.store.getByIds([h2.loserId]);
        const m2 = readSupersedeMarker(gone2?.metadata);
        expect(m2).toMatchObject({ reason: 'conflict', verdict: 'winner', pairId: h2.pair.pairId });
        expect(Object.keys(m2 as object)).toEqual(['at', 'reason', 'verdict', 'pairId']);
      } finally {
        h2.db.close();
      }

      // 构造器层同一判据(有类型才多一个键)
      const withoutType = withSupersedeMarker(
        {},
        { at: 'x', reason: 'conflict', verdict: 'winner', pairId: 'p' },
      )['dsh_superseded'] as Record<string, unknown>;
      expect(Object.keys(withoutType)).toEqual(['at', 'reason', 'verdict', 'pairId']);
      const withType = withSupersedeMarker(
        {},
        { at: 'x', reason: 'conflict', verdict: 'winner', pairId: 'p', conflictType: 'hard' },
      )['dsh_superseded'] as Record<string, unknown>;
      expect(Object.keys(withType)).toEqual(['at', 'reason', 'verdict', 'pairId', 'conflictType']);
    } finally {
      h.db.close();
    }
  });
});
