import { safeJoin, resolveMemoriesRoot } from './memory-md.js';
import type { MdLedgerStore } from './memory-md-ledger.js';
import type { MemExportReport, ReconcileCounts, ReconcileReport, ReconcileSample } from './memory-md-types.js';
import type { MemoryLogger, MemoryRecord } from '../types.js';
export type { MemExportReport, ReconcileCounts, ReconcileReport, ReconcileSample };
export { resolveMemoriesRoot, safeJoin };
/** 导出报告等形状见 `memory-md-types.ts`（与契约层共用）。 */
export interface MemExportDeps {
    /** 待投射的记录（含退场行——退场也要有投影，否则文件树里看不到它）。 */
    records: readonly MemoryRecord[];
    /** `cfg.memExport.root`（空 = 默认单根）；workspace 优先时它只管无归属那批。 */
    cfgRoot: string | undefined;
    /** 插件数据目录：算默认单根用。 */
    dataDir: string;
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
    /** `cfg.memExport.root`（空 = 默认单根）；与 `dataDir` 一起交给 `targetFor`。 */
    cfgRoot: string | undefined;
    dataDir: string;
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
