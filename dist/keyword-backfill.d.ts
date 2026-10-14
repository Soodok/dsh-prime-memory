/**
 * 关键词蒸馏回填（keyword axis 产出方）。
 *
 * 职责：从 L1 记录中找「缺 dsh_keywords」的存量记录，按 chunk 20 条一批送 LLM 提炼关键词
 * 与使用场景，归一后写 `metadata.dsh_keywords` + `metadata.dsh_usage_scenario`，
 * 并用 `patchMetadataAndReindex` 保证新关键词**立即进 FTS BM25 轴**。
 *
 * 安全边界（继承 wing-backfill）：
 * - 单飞：同时最多一个回填任务,重复触发直接返回 running(不排队不叠加)
 * - 后台执行：端点立即返回,逐块推进(每块 20 条),不阻塞 RPC/管线
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
}
export interface KeywordBackfillState {
    running: boolean;
    updated: number;
    failed: number;
}
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
/** 关键词标注器（导出供单测）。 */
export declare function labelKeywordChunk(ctx: Context, cfg: MemoryConfig, logger: MemoryLogger, chunk: MemoryRecord[]): Promise<Array<{
    record: MemoryRecord;
    keywords: string[];
    usageScenario?: string[];
}>>;
