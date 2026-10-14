import { isRetiredRecord } from './memory-md.js';
import type { SuffixReport } from './memory-md-types.js';
import type { MdLedgerStore } from './memory-md-ledger.js';
import type { MemoryLogger, MemoryRecord } from '../types.js';
/** 文件侧的结果，原样进端点响应（面板看得见"到底动没动文件"）。 */
export type DisableOutcome = 'renamed' | 'created' | 'already' | 'no-workspace' | 'failed';
/**
 * 退场判据的单一真源在 `memory-md.ts`（导出侧与这里必须共用一个），本模块只转发，
 * 免得既有调用方拿不到。另起一套（比如再叠上 `persistence`）只会让"列表说它退了、
 * 文件却没后缀"重新变成常态。
 */
export { isRetiredRecord };
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
 * 账本跟着换键。
 *
 * 键是绝对路径（N10），所以改名必须"删旧键、记新键"——只改文件不改账本，下一轮对账
 * 会同时报"旧键文件缺失"和"新文件是外人加的"，两边都错。
 * 没有旧条目（人从没导出过）时只记新键，不补造旧键。
 *
 * ⚠️ `fileDigest` **取磁盘上的真实字节**，不取我们手上那份渲染结果：改名分支里
 * 旧文件是“未退场时导出的那一版”（不带 `retired`），拿新渲染的摘要当基线，
 * 下一轮对账就会把“我们自己改的文件”报成“人改过文件”。
 *
 * @param persist - 默认 true（单条失效联动：写完就该落盘）。**批量收敛必须传 false**：
 * 账本是整本 JSON 的原子重写，每条都 `flush()` 就把「窗口内只记脏、收尾落一次」
 * 的设计退化成 O(n²)（真机 912 条回填会被墙钟 `timeBudgetMs` 拦成好几次点击）。
 *
 * 导出给 `memory-md-sync.ts` 的改名跟随用——「取磁盘真实字节当基线」这条纪律只该有一份。
 */
export declare function moveLedger(ledger: MdLedgerStore, fromAbs: string, toAbs: string, r: MemoryRecord, fallbackText: string, persist?: boolean): Promise<void>;
/**
 * 把一条已退场记忆的投射文件标成 `.disable`。
 *
 * @param deps - 记录、根配置、数据目录、账本与日志。
 * @returns 文件侧结果；**任何异常都收敛成 `'failed'`，不抛**。
 */
export declare function disableProjectionFile(deps: DisableDeps): Promise<DisableOutcome>;
export interface SuffixConvergeDeps {
    /** 全量记录（含退场的）——收敛是库→盘的形状对齐，不是增量事件。 */
    records: readonly MemoryRecord[];
    cfgRoot: string | undefined;
    dataDir: string;
    ledger: MdLedgerStore;
    /** 与 `exportRecords` 同口径：只约束**真碰了磁盘**的动作数，判为“形状已对”的不吃配额。 */
    maxRecords: number;
    timeBudgetMs: number;
    logger?: MemoryLogger;
    /** 注入时钟（测试用）。 */
    now?: () => number;
}
/**
 * 后缀不变式收敛：把「库里的有/无效」与「文件的 `.memory.md` / `.memory.md.disable`」对齐。
 *
 * 为什么挂在导出后面而不是各个退场调用点：那 8 处 `.retire()` 分布在手动软删、批量退场、
 * 合并取代、冲突判负、slot 连带等路径上，事件挂钩注定会漏（真机实测：920 条退场记录
 * 只有 8 个 `.disable`，全部来自召回面板那一条路径）。收敛器只依赖三个可观测事实：
 * 文件存在性、当前后缀、指纹一致性。
 *
 * 护栏与导出同一套（`maxRecords` 只数碰盘动作 + `timeBudgetMs` 墙钟），所以第一次点可能只
 * 收敛一部分，`capped`/`remaining` 会告诉你还要点几次。
 */
export declare function convergeDisabledSuffix(deps: SuffixConvergeDeps): Promise<SuffixReport>;
