import type { MdLedgerStore } from './memory-md-ledger.js';
import type { MemExportReport, ReconcileCounts, ReconcileReport, ReconcileSample } from './memory-md-types.js';
import type { MemoryLogger, MemoryRecord } from '../types.js';
export type { MemExportReport, ReconcileCounts, ReconcileReport, ReconcileSample };
/**
 * 解析投射根目录。
 *
 * 给了 `cfgRoot` 就用它（必须是绝对路径且不含 `..`），否则默认 `<dataDir>/memories`。
 * **不合法只回退默认并 warn，绝不抛错**：投射是旁路，旁路配置写错不能弄挂记忆本体。
 */
export declare function resolveMemoriesRoot(cfgRoot: string | undefined, dataDir: string, logger?: MemoryLogger): string;
/**
 * 把渲染出的相对路径安全地拼到根下。
 *
 * 越界（绝对路径、`..` 跳出、盘符切换）一律返回 `undefined` 由调用方跳过并 warn——
 * 记录内容是人/模型写的，它可能包含 `../../`，这里必须是结构性挡死而不是"应该不会有"。
 */
export declare function safeJoin(root: string, relPath: string): string | undefined;
/** 导出报告等形状见 `memory-md-types.ts`（与契约层共用）。 */
export interface MemExportDeps {
    /** 待投射的记录（含退场行——退场也要有投影，否则文件树里看不到它）。 */
    records: readonly MemoryRecord[];
    root: string;
    ledger: MdLedgerStore;
    maxRecords: number;
    timeBudgetMs: number;
    logger?: MemoryLogger;
    /** 注入时钟（测试用）。 */
    now?: () => number;
}
/**
 * 单向导出：库 → 文件 + 账本。
 *
 * 每次**全量重写**该写的：增量 patch 与内容指纹判据互相打脸（patch 的前提是"我知道
 * 差在哪"，而那正是指纹要回答的）。指纹一致就跳过，不刷 mtime——刷了会让下一轮
 * 对账把"我们没动过"误判成"文件被改过"。
 */
export declare function exportRecords(deps: MemExportDeps): Promise<MemExportReport>;
/** 四态计数与报告形状见 `memory-md-types.ts`。 */
export interface ReconcileDeps {
    records: readonly MemoryRecord[];
    root: string;
    ledger: MdLedgerStore;
    maxRecords: number;
    timeBudgetMs: number;
    logger?: MemoryLogger;
    sampleCap?: number;
    now?: () => number;
}
/**
 * 只读对账：按账本基线判每条记录落在哪个象限。
 *
 * 判据是**三方**的（基线 = 账本里的两个 digest）：
 * `dbDigest ≠ 现在库内容` → 库动过；`fileDigest ≠ 现在文件内容` → 动过文件。
 * 两方比较必吃一边，这就是账本要同时存两个 digest 的原因。
 */
export declare function reconcileLedger(deps: ReconcileDeps): Promise<ReconcileReport>;
