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
/** 缺省时间窗:|l0.timestamp − segments.time| ≤ 90s 视为同一条消息。 */
export const DEFAULT_WINDOW_MS = 90_000;
/** DRS segments → 锚点行(只收 turn>0 且 role∈{user,assistant} 的行)。 */
function loadDrsAnchors(drs, sessionId) {
    const sql = sessionId === undefined
        ? 'SELECT session_id, turn, step, role, time FROM segments WHERE turn > 0 AND role IN (?, ?) ORDER BY session_id, time'
        : 'SELECT session_id, turn, step, role, time FROM segments WHERE turn > 0 AND role IN (?, ?) AND session_id = ? ORDER BY session_id, time';
    const rows = drs.prepare(sql).all('user', 'assistant', ...(sessionId === undefined ? [] : [sessionId]));
    const bySession = new Map();
    for (const row of rows) {
        if (typeof row.session_id !== 'string' || typeof row.turn !== 'number' || typeof row.time !== 'number')
            continue;
        const entry = {
            sessionId: row.session_id,
            turn: row.turn,
            step: typeof row.step === 'number' ? row.step : 0,
            role: typeof row.role === 'string' ? row.role : '',
            time: row.time,
        };
        const bucket = bySession.get(entry.sessionId);
        if (bucket === undefined)
            bySession.set(entry.sessionId, [entry]);
        else
            bucket.push(entry);
    }
    return bySession;
}
function loadCandidates(memory, sessionId, limit) {
    const sql = sessionId === undefined
        ? 'SELECT record_id, session_id, role, timestamp FROM l0_conversations WHERE turn IS NULL AND role IN (?, ?) ORDER BY session_id, timestamp'
        : 'SELECT record_id, session_id, role, timestamp FROM l0_conversations WHERE turn IS NULL AND role IN (?, ?) AND session_id = ? ORDER BY session_id, timestamp';
    const rows = memory.prepare(sql).all('user', 'assistant', ...(sessionId === undefined ? [] : [sessionId]));
    const out = [];
    for (const row of rows) {
        if (typeof row.record_id !== 'string' || typeof row.session_id !== 'string' || typeof row.timestamp !== 'number')
            continue;
        out.push({
            recordId: row.record_id,
            sessionId: row.session_id,
            role: typeof row.role === 'string' ? row.role : '',
            timestamp: row.timestamp,
        });
        if (limit !== undefined && out.length >= limit)
            break;
    }
    return out;
}
/**
 * 产出回填计划(纯只读,两个库都不写)。匹配规则:
 * 同会话 + 同 role + |Δt| ≤ windowMs 的 DRS 行里,若候选 turn 唯一 → 取
 * |Δt| 最近一条;turn 不唯一 → 歧义放弃;无行/无窗内行 → 如实分型放弃。
 */
export function planAnchorBackfill(input) {
    const windowMs = input.windowMs ?? DEFAULT_WINDOW_MS;
    const drsBySession = loadDrsAnchors(input.drs, input.sessionId);
    const candidates = loadCandidates(input.memory, input.sessionId, input.limit);
    const anchored = input.memory.prepare(input.sessionId === undefined
        ? 'SELECT COUNT(*) AS n FROM l0_conversations WHERE turn IS NOT NULL'
        : 'SELECT COUNT(*) AS n FROM l0_conversations WHERE turn IS NOT NULL AND session_id = ?').all(...(input.sessionId === undefined ? [] : [input.sessionId]));
    const plan = {
        windowMs,
        candidates: candidates.length,
        drsSessions: drsBySession.size,
        alreadyAnchored: typeof anchored[0]?.n === 'number' ? anchored[0].n : 0,
        fills: [],
        skips: [],
    };
    for (const candidate of candidates) {
        const rows = drsBySession.get(candidate.sessionId);
        if (rows === undefined) {
            plan.skips.push({ recordId: candidate.recordId, sessionId: candidate.sessionId, reason: 'no-drs-session' });
            continue;
        }
        const sameRole = rows.filter(row => row.role === candidate.role);
        if (sameRole.length === 0) {
            plan.skips.push({ recordId: candidate.recordId, sessionId: candidate.sessionId, reason: 'no-role-match' });
            continue;
        }
        const inWindow = sameRole
            .map(row => ({ row, delta: Math.abs(row.time - candidate.timestamp) }))
            .filter(entry => entry.delta <= windowMs);
        if (inWindow.length === 0) {
            plan.skips.push({ recordId: candidate.recordId, sessionId: candidate.sessionId, reason: 'out-of-window' });
            continue;
        }
        const turns = new Set(inWindow.map(entry => entry.row.turn));
        if (turns.size > 1) {
            plan.skips.push({ recordId: candidate.recordId, sessionId: candidate.sessionId, reason: 'ambiguous-turn' });
            continue;
        }
        const nearest = inWindow.reduce((best, entry) => (entry.delta < best.delta ? entry : best));
        plan.fills.push({
            recordId: candidate.recordId,
            sessionId: candidate.sessionId,
            role: candidate.role,
            l0Timestamp: candidate.timestamp,
            drsTime: nearest.row.time,
            deltaMs: nearest.delta,
            turn: nearest.row.turn,
            step: nearest.row.step,
        });
    }
    return plan;
}
/**
 * 应用计划:逐条 UPDATE,恒带 `AND turn IS NULL`(已锚定行永不覆盖;
 * plan→apply 之间若有新写入恰好锚定了同一行,该条自然落空,不报错)。
 */
export function applyAnchorBackfill(memory, plan) {
    const countOf = (sql) => {
        const rows = memory.prepare(sql).all();
        return typeof rows[0]?.n === 'number' ? rows[0].n : 0;
    };
    const totalRowsBefore = countOf('SELECT COUNT(*) AS n FROM l0_conversations');
    const update = memory.prepare('UPDATE l0_conversations SET turn = ?, step = ? WHERE record_id = ? AND turn IS NULL');
    let applied = 0;
    for (const fill of plan.fills) {
        const result = update.run(fill.turn, fill.step, fill.recordId);
        if (typeof result?.changes === 'number' && result.changes > 0)
            applied += result.changes;
    }
    const totalRowsAfter = countOf('SELECT COUNT(*) AS n FROM l0_conversations');
    return {
        plan,
        applied,
        totalRowsBefore,
        totalRowsAfter,
        invariantHolds: totalRowsBefore === totalRowsAfter,
    };
}
