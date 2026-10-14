import type { MdRunStatus, SuffixReport } from './memory-md-types.js';
import type { MdLedgerStore } from './memory-md-ledger.js';
import type { MemoryLogger, MemoryRecord } from '../types.js';
/** 进度快照的形状与契约层共用一份定义（在 `memory-md-types.ts`），本模块只转发。 */
export type { MdRunStatus };
/** 只读快照副本（防调用方改到执行中的那份）。 */
export declare function mdRunStatus(): MdRunStatus;
export interface MdRunDeps {
    /** 全表快照（含退场行）；本函数按游标切片喂给两个执行器。 */
    records: readonly MemoryRecord[];
    cfgRoot: string | undefined;
    dataDir: string;
    ledger: MdLedgerStore;
    /** 单轮护栏（与 `cfg.memExport` 同值）。 */
    maxRecords: number;
    timeBudgetMs: number;
    /** 跨轮总闸：最多滚几轮 / 最多花多少毫秒。 */
    maxPasses?: number;
    totalBudgetMs?: number;
    logger?: MemoryLogger;
    /** 注入时钟（测试用）。 */
    now?: () => number;
}
/** 滚动执行的汇总（形状与单轮报告一致，多出的字段告诉人滚了几轮）。 */
export interface MdRunResult {
    root: string;
    inWorkspace: number;
    scanned: number;
    written: number;
    unchanged: number;
    skipped: number;
    /** 0 = 两阶段都滚到完；>0 = 总预算用尽，剩这么多条没处理，再点一次续跑。 */
    remaining: number;
    capped: boolean;
    /** 实际滚了几轮。 */
    passes: number;
    suffix: SuffixReport;
    appliedMaxRecords: number;
}
/**
 * 滚到完：先把导出游标推到表尾，再把收敛游标推到表尾。
 *
 * 两阶段分开推进度，是因为收敛必须等导出把该写的文件写完——那时盘态最全，
 * 判"盘上没这份"才准（反过来会把它误报成 `absent`）。
 *
 * @throws 已有任务在跑时抛（不排队，见模块头纪律 1）。
 */
export declare function runProjection(deps: MdRunDeps): Promise<MdRunResult>;
