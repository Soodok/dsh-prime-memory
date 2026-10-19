/**
 * DRS 历史锚点回填(三期接线 T8.2,一次性任务的纯核心)。
 *
 * 职责:`l0_conversations` 里 `turn IS NULL` 的旧行,按
 * (session_id, role, 时间窗) 与 DRS 投影库 segments(turn/step/role/time)
 * 最近邻匹配,补填 turn/step。
 *
 * 纪律(对齐 store/sqlite.ts R7 迁移注释,「旧行留 NULL ⇒ 无锚点,不伪造」):
 * - 匹配不上留 NULL;同窗内出现**多个不同 turn** 的候选 = 歧义,也留 NULL;
 * - UPDATE 恒带 `AND turn IS NULL`,已锚定行永不覆盖(与 upsert COALESCE 同向);
 * - 行数不变式:回填只填列,绝不增删行;apply 报告给前后 COUNT 对账。
 *
 * DRS 来源契约:projection.db segments 只读直连——与 HTTP `op=session&turn=`
 * 的检索面同字段(session_id/turn/step/role/time);离线一次性任务走只读
 * SQLite,宿主不在线也可跑。role 词表两侧同形:DRS eventRole 只产
 * user/assistant,l0 capture 只收 user/assistant(capture.ts L0Record)。
 *
 * 本模块零 cordis/运行时依赖:入参是结构化 SQLite 面(prepare/all/run),
 * CLI(scripts/drs-anchor-backfill.mjs)喂真身,单测喂临时 DatabaseSync。
 */

/** 结构化 SQLite 面(node:sqlite DatabaseSync 的窄投影,方法双向可赋值)。 */
export interface PreparedStatementLike {
  all(...params: unknown[]): unknown[]
  run(...params: unknown[]): unknown
}

export interface SqliteLike {
  prepare(sql: string): PreparedStatementLike
}

/** 缺省时间窗:|l0.timestamp − segments.time| ≤ 90s 视为同一条消息。 */
export const DEFAULT_WINDOW_MS = 90_000

export interface AnchorBackfillOptions {
  /** 只回填该会话;缺省全量。 */
  sessionId?: string
  /** 本次最多处理的候选行数(防跑飞);缺省不限。 */
  limit?: number
  /** 匹配时间窗(ms);缺省 {@link DEFAULT_WINDOW_MS}。 */
  windowMs?: number
}

interface DrsAnchorRow {
  sessionId: string
  turn: number
  step: number
  role: string
  time: number
}

interface L0CandidateRow {
  recordId: string
  sessionId: string
  role: string
  timestamp: number
}

/** 一条可回填的匹配(证据齐全:两侧时间与差值)。 */
export interface AnchorFillRow {
  recordId: string
  sessionId: string
  role: string
  l0Timestamp: number
  drsTime: number
  deltaMs: number
  turn: number
  step: number
}

/** 一条被保守放弃的候选(宁缺毋伪造)。 */
export interface AnchorSkipRow {
  recordId: string
  sessionId: string
  reason: 'no-drs-session' | 'no-role-match' | 'out-of-window' | 'ambiguous-turn'
}

export interface AnchorBackfillPlan {
  windowMs: number
  /** 扫到的候选数(turn IS NULL)。 */
  candidates: number
  /** DRS 侧有投影的会话数。 */
  drsSessions: number
  /** 已锚定(无需处理)行数——信息面,不是候选。 */
  alreadyAnchored: number
  fills: AnchorFillRow[]
  skips: AnchorSkipRow[]
}

/** DRS segments → 锚点行(只收 turn>0 且 role∈{user,assistant} 的行)。 */
function loadDrsAnchors(drs: SqliteLike, sessionId: string | undefined): Map<string, DrsAnchorRow[]> {
  const sql = sessionId === undefined
    ? 'SELECT session_id, turn, step, role, time FROM segments WHERE turn > 0 AND role IN (?, ?) ORDER BY session_id, time'
    : 'SELECT session_id, turn, step, role, time FROM segments WHERE turn > 0 AND role IN (?, ?) AND session_id = ? ORDER BY session_id, time'
  const rows = drs.prepare(sql).all('user', 'assistant', ...(sessionId === undefined ? [] : [sessionId])) as Array<{
    session_id: unknown
    turn: unknown
    step: unknown
    role: unknown
    time: unknown
  }>
  const bySession = new Map<string, DrsAnchorRow[]>()
  for (const row of rows) {
    if (typeof row.session_id !== 'string' || typeof row.turn !== 'number' || typeof row.time !== 'number') continue
    const entry: DrsAnchorRow = {
      sessionId: row.session_id,
      turn: row.turn,
      step: typeof row.step === 'number' ? row.step : 0,
      role: typeof row.role === 'string' ? row.role : '',
      time: row.time,
    }
    const bucket = bySession.get(entry.sessionId)
    if (bucket === undefined) bySession.set(entry.sessionId, [entry])
    else bucket.push(entry)
  }
  return bySession
}

function loadCandidates(memory: SqliteLike, sessionId: string | undefined, limit: number | undefined): L0CandidateRow[] {
  const sql = sessionId === undefined
    ? 'SELECT record_id, session_id, role, timestamp FROM l0_conversations WHERE turn IS NULL AND role IN (?, ?) ORDER BY session_id, timestamp'
    : 'SELECT record_id, session_id, role, timestamp FROM l0_conversations WHERE turn IS NULL AND role IN (?, ?) AND session_id = ? ORDER BY session_id, timestamp'
  const rows = memory.prepare(sql).all('user', 'assistant', ...(sessionId === undefined ? [] : [sessionId])) as Array<{
    record_id: unknown
    session_id: unknown
    role: unknown
    timestamp: unknown
  }>
  const out: L0CandidateRow[] = []
  for (const row of rows) {
    if (typeof row.record_id !== 'string' || typeof row.session_id !== 'string' || typeof row.timestamp !== 'number') continue
    out.push({
      recordId: row.record_id,
      sessionId: row.session_id,
      role: typeof row.role === 'string' ? row.role : '',
      timestamp: row.timestamp,
    })
    if (limit !== undefined && out.length >= limit) break
  }
  return out
}

/**
 * 产出回填计划(纯只读,两个库都不写)。匹配规则:
 * 同会话 + 同 role + |Δt| ≤ windowMs 的 DRS 行里,若候选 turn 唯一 → 取
 * |Δt| 最近一条;turn 不唯一 → 歧义放弃;无行/无窗内行 → 如实分型放弃。
 */
export function planAnchorBackfill(input: {
  memory: SqliteLike
  drs: SqliteLike
} & AnchorBackfillOptions): AnchorBackfillPlan {
  const windowMs = input.windowMs ?? DEFAULT_WINDOW_MS
  const drsBySession = loadDrsAnchors(input.drs, input.sessionId)
  const candidates = loadCandidates(input.memory, input.sessionId, input.limit)
  const anchored = input.memory.prepare(
    input.sessionId === undefined
      ? 'SELECT COUNT(*) AS n FROM l0_conversations WHERE turn IS NOT NULL'
      : 'SELECT COUNT(*) AS n FROM l0_conversations WHERE turn IS NOT NULL AND session_id = ?',
  ).all(...(input.sessionId === undefined ? [] : [input.sessionId])) as Array<{ n: unknown }>
  const plan: AnchorBackfillPlan = {
    windowMs,
    candidates: candidates.length,
    drsSessions: drsBySession.size,
    alreadyAnchored: typeof anchored[0]?.n === 'number' ? anchored[0].n : 0,
    fills: [],
    skips: [],
  }
  for (const candidate of candidates) {
    const rows = drsBySession.get(candidate.sessionId)
    if (rows === undefined) {
      plan.skips.push({ recordId: candidate.recordId, sessionId: candidate.sessionId, reason: 'no-drs-session' })
      continue
    }
    const sameRole = rows.filter(row => row.role === candidate.role)
    if (sameRole.length === 0) {
      plan.skips.push({ recordId: candidate.recordId, sessionId: candidate.sessionId, reason: 'no-role-match' })
      continue
    }
    const inWindow = sameRole
      .map(row => ({ row, delta: Math.abs(row.time - candidate.timestamp) }))
      .filter(entry => entry.delta <= windowMs)
    if (inWindow.length === 0) {
      plan.skips.push({ recordId: candidate.recordId, sessionId: candidate.sessionId, reason: 'out-of-window' })
      continue
    }
    const turns = new Set(inWindow.map(entry => entry.row.turn))
    if (turns.size > 1) {
      plan.skips.push({ recordId: candidate.recordId, sessionId: candidate.sessionId, reason: 'ambiguous-turn' })
      continue
    }
    const nearest = inWindow.reduce((best, entry) => (entry.delta < best.delta ? entry : best))
    plan.fills.push({
      recordId: candidate.recordId,
      sessionId: candidate.sessionId,
      role: candidate.role,
      l0Timestamp: candidate.timestamp,
      drsTime: nearest.row.time,
      deltaMs: nearest.delta,
      turn: nearest.row.turn,
      step: nearest.row.step,
    })
  }
  return plan
}

export interface AnchorApplyReport {
  plan: AnchorBackfillPlan
  applied: number
  totalRowsBefore: number
  totalRowsAfter: number
  /** 行数不变式:回填只填列,前后 COUNT 必须相等。 */
  invariantHolds: boolean
}

/**
 * 应用计划:逐条 UPDATE,恒带 `AND turn IS NULL`(已锚定行永不覆盖;
 * plan→apply 之间若有新写入恰好锚定了同一行,该条自然落空,不报错)。
 */
export function applyAnchorBackfill(memory: SqliteLike, plan: AnchorBackfillPlan): AnchorApplyReport {
  const countOf = (sql: string): number => {
    const rows = memory.prepare(sql).all() as Array<{ n: unknown }>
    return typeof rows[0]?.n === 'number' ? rows[0].n : 0
  }
  const totalRowsBefore = countOf('SELECT COUNT(*) AS n FROM l0_conversations')
  const update = memory.prepare(
    'UPDATE l0_conversations SET turn = ?, step = ? WHERE record_id = ? AND turn IS NULL',
  )
  let applied = 0
  for (const fill of plan.fills) {
    const result = update.run(fill.turn, fill.step, fill.recordId) as { changes?: unknown }
    if (typeof result?.changes === 'number' && result.changes > 0) applied += result.changes
  }
  const totalRowsAfter = countOf('SELECT COUNT(*) AS n FROM l0_conversations')
  return {
    plan,
    applied,
    totalRowsBefore,
    totalRowsAfter,
    invariantHolds: totalRowsBefore === totalRowsAfter,
  }
}
