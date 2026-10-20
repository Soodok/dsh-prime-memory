/**
 * L0 水位表(T8.4 l0 写停,drsc-redact-memory-wiring task_16)。
 *
 * capture 停写 l0_conversations/l0_fts/l0_vec 三表后,§A 崩溃恢复的幂等判据
 * (maxCapturedTurn / hasAnyL0Message)失去数据源——本小表接住:每会话一行,
 * 只存 (max_turn, last_step),几十 KB 量级。正文改由 DRSC 投影供读(历史面),
 * 水位只服务「重启不重放旧 turn」的自检,不再承载任何文本。
 *
 * 语义对齐被退役的 SQL 口径:
 * - `maxTurn(sid)`  ≡ 退役前 `MAX(turn)`;只前进不回退(重放/乱序登记无害);
 * - `hasAny(sid, t)` ≡ 退役前 `t <= MAX(turn)` 的存在性判定——恢复窗口
 *   (foldRecoverableTurns 只产出 turn > 水位 的括号)内恒 false,行为与
 *   MAX 口径等价;写停后正文无「部分写残行」,逐 turn 点查的原始动机消失。
 *
 * 基线物化:写停生效前已存在的 l0_conversations 行由 {@link ensureBaseline}
 * 一次性灌入(INSERT OR IGNORE,存量水位行不覆盖)——没有它,升级后的首次
 * resume 会把水位当空、重放旧 turn 重复蒸馏。每次 init 幂等重跑(空表扫描
 * 零成本;task_22 存量清退删表后同样安静)。
 *
 * 与 CostLedger/GraphStore 同款纪律:独立职责类,唯一耦合是共享 node:sqlite
 * 连接;未 init / 降级时全部方法安全 no-op。
 */
import type { DatabaseSync } from 'node:sqlite';
import type { MemoryLogger } from '../types.js';
export declare const L0_WATERMARK_DDL = "\nCREATE TABLE IF NOT EXISTS l0_watermark (\n  session_id TEXT PRIMARY KEY,\n  max_turn INTEGER NOT NULL DEFAULT 0,\n  last_step INTEGER,\n  updated_at TEXT DEFAULT (datetime('now'))\n)\n";
export declare class L0WatermarkStore {
    private db;
    private logger;
    init(db: DatabaseSync, logger?: MemoryLogger): void;
    close(): void;
    /**
     * 基线物化:从现存 l0_conversations 把每会话最大 turn 灌进水位表。
     * INSERT OR IGNORE = 已有水位行(活捕获已推进)一律不覆盖;旧行文与
     * 水位并存期两侧取大者由 record 的单调语义兜底。
     */
    ensureBaseline(): void;
    /**
     * 登记一个已捕获轮次(写停后 capture 的唯一落盘点)。单调:turn 更小/相等的
     * 登记不回退水位(恢复对账与乱序事件都安全);step 取该轮已知最大 step。
     */
    record(sessionId: string, turn: number, step?: number): void;
    /** §A 水位线:该会话已捕获的最大 turn(空会话/未 init 返回 undefined)。 */
    maxTurn(sessionId: string): number | undefined;
    /** §A 幂等检查:该 (session, turn) 是否已捕获(≡ 退役前 hasAnyL0Message)。 */
    hasAny(sessionId: string, turn: number): boolean;
}
