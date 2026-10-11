import type { MemorySourceEntry } from '../store/memory-sources.js';
import type { MemoryRecord as L1Record } from '../types.js';
import type { MemportScanSourceResult } from '../contract.js';
/** l1 的最小读取面（解耦具体 store，便于测试注入）。 */
export interface L1Reader {
    all(): L1Record[];
}
/** 扫描一批来源（只读）。返回每个来源的四桶预览（含失败原因）。 */
export declare function scanSources(opts: {
    sources: MemorySourceEntry[];
    l1: L1Reader;
    maxRecords: number;
}): Promise<MemportScanSourceResult[]>;
