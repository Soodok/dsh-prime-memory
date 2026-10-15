/**
 * 关键词蒸馏回填（keyword axis 产出方）。
 *
 * 职责：从 L1 记录中找「缺 dsh_keywords」的存量记录，**一条一个请求**送 LLM 提炼关键词
 * 与使用场景，归一后写 `metadata.dsh_keywords` + `metadata.dsh_usage_scenario`，
 * 并用 `patchMetadataAndReindex` 保证新关键词**立即进 FTS BM25 轴**。
 *
 * 安全边界（继承 wing-backfill）：
 * - 单飞：同时最多一个回填任务,重复触发直接返回 running(不排队不叠加)
 * - 后台执行：端点立即返回,**逐条推进、跑完一条再发下一条**,不阻塞 RPC/管线
 * - 失败可退：LLM 失败/输出不合法只跳过当前块,原记录零改动(标签只写成功的)
 * - 有界：单次任务最多处理 cfg.backfill.maxRecords 条,防止一次跑飞;其余可再次触发
 * - 门控关（`cfg.keyword.enabled = false`）：run() 入口立即跳过——无回填、FTS 逐字不变
 */
import type { Context } from '@deepseek-ai/cordis';
import type { MemoryLogger, MemoryRecord } from './types.js';
import type { MemoryBackend } from './store/memory-backend.js';
import type { MemoryConfig } from './config.js';
export interface KeywordBackfillDeps {
    ctx: Context;
    cfg: MemoryConfig;
    backend: MemoryBackend;
    logger: MemoryLogger;
    /**
     * 运行时**生效并发**读取器（可选）：给正在跑的任务即时改并发用——池子每完成一条重读一次。
     * 缺省 = 启动时读一次 `cfg.backfill.concurrency`（旧行为）。
     */
    concurrency?: () => number | undefined;
}
export interface KeywordBackfillState {
    running: boolean;
    updated: number;
    failed: number;
    /** 分批进度（UI 轮询据此显示「扫描中 / 第几条」，否则运行期只有一个「回填中…」）： */
    /** 每个请求处理的条数——已改逐条，永远为 1（与 redistill 同形状）。 */
    chunk: number;
    /** 扫描阶段确定的真目标总数（缺关键词；扫描未完成时为已发现数）。 */
    candidates: number;
    /** 本次已完成（送过 LLM 且已写回）**在请求完成时才自增**，否则“全失败”跟“全成功”看起来一样。 */
    processed: number;
    /** 仍在扫描阶段。 */
    scanning: boolean;
    /** 已完成条数（与 processed 同值）。 */
    batchesDone: number;
    /** 本次要处理的总条数。 */
    batchTotal: number;
    /** LLM 批调用并行度。 */
    concurrency: number;
    /** 预算/上限用尽未处理、留下次的条数。 */
    deferred: number;
    /** 本轮被人工中止（进端点 cancel）——与“预算用尽”分开报文案。 */
    cancelled: boolean;
    /**
     * 扫描期已扫行数 / 总行数（`scanTotal=0` = 总数未知）。
     * 为何要暴露：扫描段原本在面板上只是一个静态「正在扫描…」，存量上千行时
     * 用户分不清“在跑”还是“卡死”——真机就是因为这个把它当成“不开始”。
     */
    scanned: number;
    scanTotal: number;
}
/** 请求中止本轮（空闲时无副作用）；返回后中止是**有界**的：最多等 graceMs。 */
export declare function cancelKeywordBackfill(): {
    cancelled: boolean;
    running: boolean;
};
export declare function keywordBackfillState(): KeywordBackfillState;
/** 启动后台关键词回填；已在运行返回 false（单飞）。 */
export declare function startKeywordBackfill(deps: KeywordBackfillDeps): {
    started: boolean;
    running: boolean;
};
/**
 * 回填主体（导出供单测 await 到完成；生产走 `startKeywordBackfill` 的单飞后台包装）。
 * 门控关（`cfg.keyword.enabled = false`）时入口立即返回，不碰任何记录与 fts。
 */
export declare function runKeywordBackfillOnce(deps: KeywordBackfillDeps): Promise<void>;
/** 单条标注结果。 */
export interface KeywordOneResult {
    keywords: string[];
    usageScenario: string[];
}
/**
 * 标注**一条**记忆的关键词与情景（一个请求只装一条）。失败/无合法关键词返回 null。
 *
 * 旧名 `labelKeywordChunk`（多条一次）已废：合并请求下一次截断/空输出就整批丢弃，
 * 而逐条只花秒级。记账（state.failed 等）全部归调用方——标注器不再动全局状态，
 * 否则同一条会被两处各计一次。
 */
export declare function labelKeywordOne(ctx: Context, cfg: MemoryConfig, logger: MemoryLogger, rec: MemoryRecord, callTimeoutMs?: number, 
/** 本轮中止信号（可选）：与单次超时**取或**，宽限到期后由它当场掐断请求。 */
externalSignal?: AbortSignal): Promise<KeywordOneResult | null>;
