import { type MdLedgerStore } from './memory-md-ledger.js';
import type { MemoryLogger, MemoryRecord } from '../types.js';
import type { OrphanReport } from './memory-md-types.js';
export interface OrphanDeps {
    /** 当前全部记录（含退场行——退场行仍认领自己的文件，那不是孤儿）。 */
    records: readonly MemoryRecord[];
    /** `cfg.memExport.root`（空 = 默认单根）。 */
    cfgRoot: string | undefined;
    dataDir: string;
    ledger: MdLedgerStore;
    /** true = 只报告不搬（默认值由端点侧兜死，这里不设默认）。 */
    dryRun: boolean;
    maxFiles: number;
    timeBudgetMs: number;
    logger?: MemoryLogger;
    /** 归档根；缺省 `<dataDir>/memories-orphans`。测试注入临时目录用。 */
    archiveRoot?: string;
    /** 注入时钟（测试用）。 */
    now?: () => number;
}
/**
 * 扫一遍账本，把无人认领的投射文件搬进归档目录。
 *
 * @param deps - 见 `OrphanDeps`。
 * @returns 报告；`dir` 在干跑时是空串（还没建批次目录）。任何单条失败只计数并留痕，绝不抛挂整轮。
 */
export declare function sweepOrphanFiles(deps: OrphanDeps): Promise<OrphanReport>;
