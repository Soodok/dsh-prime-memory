export const L0_WATERMARK_DDL = `
CREATE TABLE IF NOT EXISTS l0_watermark (
  session_id TEXT PRIMARY KEY,
  max_turn INTEGER NOT NULL DEFAULT 0,
  last_step INTEGER,
  updated_at TEXT DEFAULT (datetime('now'))
)
`;
export class L0WatermarkStore {
    db = null;
    logger;
    init(db, logger) {
        this.db = db;
        this.logger = logger;
        db.exec(L0_WATERMARK_DDL);
        this.ensureBaseline();
    }
    close() {
        this.db = null;
    }
    /**
     * 基线物化:从现存 l0_conversations 把每会话最大 turn 灌进水位表。
     * INSERT OR IGNORE = 已有水位行(活捕获已推进)一律不覆盖;旧行文与
     * 水位并存期两侧取大者由 record 的单调语义兜底。
     */
    ensureBaseline() {
        if (!this.db)
            return;
        try {
            this.db.exec(`
        INSERT OR IGNORE INTO l0_watermark (session_id, max_turn, last_step)
        SELECT session_id, MAX(turn), NULL
        FROM l0_conversations
        WHERE turn IS NOT NULL
        GROUP BY session_id
      `);
        }
        catch (err) {
            // l0_conversations 可能已被存量清退(task_22)删除:表缺 = 无基线可灌,安静跳过
            this.logger?.debug?.(`[memory] L0 水位基线物化跳过: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /**
     * 登记一个已捕获轮次(写停后 capture 的唯一落盘点)。单调:turn 更小/相等的
     * 登记不回退水位(恢复对账与乱序事件都安全);step 取该轮已知最大 step。
     */
    record(sessionId, turn, step) {
        if (!this.db || !sessionId || !Number.isFinite(turn))
            return;
        try {
            this.db
                .prepare(`INSERT INTO l0_watermark (session_id, max_turn, last_step, updated_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(session_id) DO UPDATE SET
             max_turn = MAX(l0_watermark.max_turn, excluded.max_turn),
             last_step = CASE WHEN excluded.max_turn > l0_watermark.max_turn
                              THEN excluded.last_step ELSE l0_watermark.last_step END,
             updated_at = excluded.updated_at`)
                .run(sessionId, turn, typeof step === 'number' && Number.isFinite(step) ? step : null);
        }
        catch (err) {
            this.logger?.warn(`[memory] L0 水位登记失败(幂等自检可能重放): ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /** §A 水位线:该会话已捕获的最大 turn(空会话/未 init 返回 undefined)。 */
    maxTurn(sessionId) {
        if (!this.db || !sessionId)
            return undefined;
        try {
            const row = this.db
                .prepare('SELECT max_turn FROM l0_watermark WHERE session_id = ?')
                .get(sessionId);
            return typeof row?.max_turn === 'number' ? row.max_turn : undefined;
        }
        catch {
            return undefined;
        }
    }
    /** §A 幂等检查:该 (session, turn) 是否已捕获(≡ 退役前 hasAnyL0Message)。 */
    hasAny(sessionId, turn) {
        if (!this.db || !sessionId || !Number.isFinite(turn))
            return false;
        try {
            const row = this.db
                .prepare('SELECT 1 FROM l0_watermark WHERE session_id = ? AND max_turn >= ? LIMIT 1')
                .get(sessionId, turn);
            return row !== undefined;
        }
        catch {
            return false;
        }
    }
}
