/**
 * 持久化文件的 schema 版本(单一事实源)。
 *
 * 以前这些字面量散落在各 store(`version: 1` × 15 / `version: 2` × 2),读侧
 * 有的校验有的不校验(findings §3.2)。集中到这里后:
 * - 写侧统一用常量,不会写出"自己都不认识"的版本;
 * - 读侧统一拿常量做 `expectedVersion`,未知版本才有判据(fail-closed 的前提)。
 *
 * 注意:**只收持久化文件的 schema 版本**。契约版本 / 快照版本 / 协议版本等
 * 非持久化用途的字面量不在此列(它们有各自的常量)。
 */
/** `state.json`:v1 = 平铺,v2 = 分族(chat/work)。 */
export declare const STATE_FILE_VERSION = 2;
/** v1 平铺格式的版本号(迁移判定用;`undefined` 亦按 v1 处理)。 */
export declare const STATE_FILE_VERSION_LEGACY = 1;
/** `slots.json`。 */
export declare const SLOTS_FILE_VERSION = 1;
/** `session-modes.json`。 */
export declare const SESSION_MODES_FILE_VERSION = 1;
/** `occupancy.json`。 */
export declare const OCCUPANCY_FILE_VERSION = 1;
/** `recall-dedupe.json`。 */
export declare const RECALL_DEDUPE_FILE_VERSION = 1;
/** `session-recalled.json`（G-live 活召回集，持久化以令旧会话重开可读）。 */
export declare const SESSION_RECALLED_FILE_VERSION = 1;
/** `pending.json`。 */
export declare const PENDING_FILE_VERSION = 1;
/** `reconcile-state.json`。 */
export declare const RECONCILE_STATE_FILE_VERSION = 1;
/** `mem-md-ledger.json`（md 投射指纹账本，N9；派生态，删了可重建）。*/
export declare const MEM_MD_LEDGER_FILE_VERSION = 1;
