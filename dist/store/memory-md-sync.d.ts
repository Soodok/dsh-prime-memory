import type { MemExportReport, SuffixReport } from './memory-md-types.js';
import type { MdLedgerStore } from './memory-md-ledger.js';
import type { MemoryLogger, MemoryRecord } from '../types.js';
/** 生效的投射配置（现读，含 `live.mdExportMaxRecords` 覆盖后的预算）。 */
export interface FileSyncCfg {
    enabled: boolean;
    root: string | undefined;
    maxRecords: number;
    timeBudgetMs: number;
}
export interface FileSyncDeps {
    /** 取**变更后**的快照（判据要看新的 `validTo` / `name`）。 */
    getByIds: (ids: readonly string[]) => readonly MemoryRecord[];
    exportCfg: () => FileSyncCfg;
    dataDir: string;
    /** 账本未装配时整个挂钩空转（与投射面其他入口一致）。 */
    ledger: () => MdLedgerStore | undefined;
    logger?: MemoryLogger;
}
/**
 * `L1Store` 侧的注入面：两类语义变更，调用方只管点火。
 *
 * - `sync`：有效性变了（增 / 退场 / 恢复）→ 导出该批 + 对齐后缀；
 * - `renamed`：身份（`name`）变了 → 投射文件跟着搬（文件名就是 `name`，不搬就出现
 *   「库里的名字与盘上的文件对不上」的偏离，收敛器也修不了，因为它按当前 name 算路径）。
 */
export interface L1FileSyncHook {
    sync: (ids: readonly string[], why: string) => void;
    renamed: (oldNameById: ReadonlyMap<string, string>, why: string) => void;
}
/** 一轮「导出 + 后缀收敛」的结果（反刍增量投射复用同一形状，不各写一套日志）。 */
export interface SyncFilesResult {
    exported: MemExportReport;
    suffix: SuffixReport;
}
/** 一轮「导出 + 后缀收敛」必需的最小依赖（不需要按 id 回查的调用方拿这一份就够）。 */
export type SyncFilesCoreDeps = Pick<FileSyncDeps, 'exportCfg' | 'dataDir' | 'ledger' | 'logger'>;
/**
 * 该批记录的投射跟随：导出 → 后缀收敛。**不打日志**（调用方自己的口径不同：钩子说
 * “联动”，反刍说“增量”，统一格式反而把两者都稀释）；也不抛，异常由调用方收敛。
 *
 * @returns 两个报告；投射面关着或账本未装配时返回 `undefined`（调用方据此不打日志）。
 */
export declare function syncFiles(deps: SyncFilesCoreDeps, records: readonly MemoryRecord[]): Promise<SyncFilesResult | undefined>;
/** 按 id 取快照后跑一轮 `syncFiles`（钩子走这个入口，判据只有一份）。 */
export declare function syncFilesByIds(deps: FileSyncDeps, ids: readonly string[], why: string): Promise<SyncFilesResult | undefined>;
/**
 * 造注入给 `L1Store` 的挂钩。契约与 `disableProjectionFile` 一致：同步返回、异常只落日志。
 *
 * 双触发是**允许的**（`recall-feedback(-1)` 仍直接调 `disableProjectionFile` 拿确定性凭证）：
 * 两条路径落到同一形状，第二次要么 ENOENT 兜底、要么 `already` 幂等。
 *
 * **串行队列（真机测出来的，不是洁癖）**：同一批文件与同一本账不能被两个后台任务同时
 * 动。旧写法每次点火就自己开一个 promise，于是「先 `appendNew` 再 `retire`」这种紧邻的两次
 * 点火会重叠：第二个任务的收敛器在第一个还没写出文件时判「盘上没这份」(`absent`)，
 * 什么都不做——退场记录就永久停在 `.memory.md` 上，直到下次全量导出才被抬回来。
 * 串成一条链后，后一个任务看到的是前一个的终态；执行时再按 id 回查快照，拿到的也是最新有效性。
 */
export declare function makeFileSyncHook(deps: FileSyncDeps): L1FileSyncHook;
