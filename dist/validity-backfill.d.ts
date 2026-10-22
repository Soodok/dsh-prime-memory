/**
 * 存量 `dsh_validity` 标注回填（expiry-tiering task_6.2 / 6.3 / 7.7）。
 *
 * 与 keyword/wing 回填同族但**零 LLM**——classifyValidity 是纯函数，本回填是
 * 本地派生：分批扫存量 L1，对"缺标注或标注与现算不符"的行写回 `dsh_validity`
 * 快照，每攒一批对被改记录调 `forceReprojectRecord` 让图谱保鲜（task_7.7 的接缝）。
 *
 * 安全边界（继承回填族四件套）：
 * - 单飞：同时最多一个任务（重复触发返回 running，不排队不叠加）；
 * - 后台执行 + 可中断：逐页推进、`shouldCancel`/墙钟预算/条数上限三闸，跑了多少算多少，
 *   其余 deferred 留待下次触发（低频周期或面板）；
 * - 失败可退：单行 patch 失败只计数，原记录零改动；
 * - 门控：`validity.tieringEnabled`（部署 ∨ 面板）关时不跑——标注面与消费面同开同关，
 *   功能关着时存量 metadata 逐字不变（零漂移）。
 */
import type { L1Store } from './store/l1.js';
import { stateOfRecord } from './store/validity.js';
import type { MemoryLogger } from './types.js';
export interface ValidityBackfillOutcome {
    started: boolean;
    running: boolean;
    scanned: number;
    updated: number;
    failed: number;
    /** 预算/上限用尽留下的条数（下次周期续跑）。 */
    deferred: number;
    cancelled: boolean;
    /** 累计因本次回填而被重投入队的记录数（图谱保鲜面）。 */
    reprojected: number;
}
interface RunState extends ValidityBackfillOutcome {
    scanned: number;
}
/** 当前进度快照（面板/日志读;无任务在跑返回 null）。 */
export declare function validityBackfillState(): RunState | null;
/** 请求中止本轮（在跑的任务在下一个检查点收工;空闲时零效果）。 */
export declare function cancelValidityBackfill(): {
    cancelled: boolean;
    running: boolean;
};
export interface ValidityBackfillDeps {
    l1: L1Store;
    logger: MemoryLogger;
    /**
     * 强制重投缝（runner.reprojectGraph：图谱未启用时自己回零,本模块不碰图谱门）。
     * 只对被改过标注的记录调用——没动的记录不需要重投（图谱读时派生不吃 dsh_validity）。
     */
    reproject: (recordIds: readonly string[]) => void;
    maxRecords?: number;
    timeBudgetMs?: number;
    /** 外部中止判据（宿主 dispose / 面板取消）；每行前检查一次。 */
    shouldCancel?: () => boolean;
}
/**
 * 启动后台回填；已在运行返回 {started:false}（单飞）。
 * 完成状态留在 `validityBackfillState()` 供最后一次读取（下轮启动时重置）。
 */
export declare function startValidityBackfill(deps: ValidityBackfillDeps): {
    started: boolean;
    running: boolean;
};
/**
 * 回填主体（导出供单测 await 到完成；生产走 `startValidityBackfill` 的单飞包装）。
 * 同步扫描 + 同步写回（L1Store 的读面都是同步的），只在页间 `yieldLoop` 让位——
 * 没有 LLM 的回填不需要并发池，串行就是最快且最不会打脏的形状。
 */
export declare function runValidityBackfillOnce(deps: ValidityBackfillDeps): Promise<ValidityBackfillOutcome>;
/** 单行是否需要补标/重标（导出供单测钉判据；生产路径走 runValidityBackfillOnce）。 */
export declare function validityBackfillNeeds(metadata: unknown, record: Parameters<typeof stateOfRecord>[0], now: number): boolean;
/** 内部常量导出（测试钉预算/批形）。 */
export declare const VALIDITY_BACKFILL_TUNING: {
    readonly PAGE: 200;
    readonly DEFAULT_MAX_RECORDS: 5000;
    readonly DEFAULT_TIME_BUDGET_MS: 120000;
    readonly REPROJECT_BATCH: 50;
    readonly VALIDITY_METADATA_KEY: "dsh_validity";
};
export {};
