import type { MdLedgerStore } from './memory-md-ledger.js';
import type { MemoryLogger, MemoryRecord } from '../types.js';
/** 文件侧的结果，原样进端点响应（面板看得见"到底动没动文件"）。 */
export type DisableOutcome = 'renamed' | 'created' | 'already' | 'no-workspace' | 'failed';
export interface DisableDeps {
    /**
     * 刚被退场的那条记录。调用方应传**退场后**的快照（带 `validTo`），这样渲染出的
     * frontmatter 自然包含 `retired: true`——凭证自己就说清了它为什么存在。
     */
    record: MemoryRecord;
    /** `cfg.memExport.root`（只管无 workspace 那批，这里用不到但落点函数要它）。 */
    cfgRoot: string | undefined;
    dataDir: string;
    ledger: MdLedgerStore;
    logger?: MemoryLogger;
}
/**
 * 把一条已退场记忆的投射文件标成 `.disable`。
 *
 * @param deps - 记录、根配置、数据目录、账本与日志。
 * @returns 文件侧结果；**任何异常都收敛成 `'failed'`，不抛**。
 */
export declare function disableProjectionFile(deps: DisableDeps): Promise<DisableOutcome>;
