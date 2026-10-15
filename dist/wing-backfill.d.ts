/**
 * 存量未打标记录的一键回填(task_15):从 WingWheel"未打标 M"入口触发,
 * 对 metadata 无 wing 的 L1 记录按 8 角词表**逐条**补打标签(复用 L1 抽取的打标路径:
 * 同一候选词表与措辞,经既有蒸馏 LLM 路由)。
 *
 * 安全边界:
 * - **单飞**:同时最多一个回填任务,重复触发直接返回 running(不排队不叠加);
 * - **后台执行**:端点立即返回,**逐条推进、跑完一条再发下一条**,不阻塞 RPC/管线;
 * - **失败可退**:LLM 失败/输出不合法只跳过当前条,原记录零改动(标签只写成功的);
 * - **有界**:单次任务最多处理 MAX_RECORDS 条,防止一次跑飞;其余可再次触发。
 *
 * 形状约定(用户定):**按单元、串行、不合并**——一个请求只装一条记忆。旧形状把 20 条
 * 合并进一个 prompt(一次截断/空输出就整批丢弃),逐条只把爆炸半径限制在 1 条。
 */
import type { Context } from '@deepseek-ai/cordis';
import { type MemoryLogger, type MemoryRecord } from './types.js';
import type { MemoryBackend } from './store/memory-backend.js';
import type { MemoryConfig } from './config.js';
export interface HallBackfillDeps {
    ctx: Context;
    cfg: MemoryConfig;
    /** 记忆后端(后台边界)。 */
    backend: MemoryBackend;
    logger: MemoryLogger;
}
export interface HallBackfillState {
    running: boolean;
    /** 本进程累计成功打标条数(重启归零;仅作观测,不作账)。 */
    updated: number;
    failed: number;
}
export declare function wingBackfillState(): HallBackfillState;
/** 启动后台回填;已在运行返回 false(单飞)。 */
export declare function startWingBackfill(deps: HallBackfillDeps): {
    started: boolean;
    running: boolean;
};
/**
 * Wing 标注器(导出):一键回填与反刍重标定共用同一 LLM 路径与措辞。
 *
 * **一个请求只装一条**(旧名 `labelWingChunk`,多条一次,已废)。返回该条的 wing,
 * 失败/字段缺失/值非法返回 null(记账归调用方,本函数不动全局状态)。
 */
export declare function labelWingOne(ctx: Context, cfg: MemoryConfig, logger: MemoryLogger, rec: MemoryRecord, candidates: string, callTimeoutMs?: number): Promise<string | null>;
/**
 * 涌现标签标注器(导出):为**一条**记录提炼 slug 标签(tags)——Room 的前身。
 * 一个请求只装一条(旧名 `tagChunk`,多条一次,已废)。失败返回 null;合法但为空返回 []。
 */
export declare function tagOne(ctx: Context, cfg: MemoryConfig, logger: MemoryLogger, rec: MemoryRecord, callTimeoutMs?: number): Promise<string[] | null>;
