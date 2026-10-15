/**
 * 存量记忆重蒸馏整形回填（redistill）。
 *
 * 职责：对**活跃**且 `scoreSkeleton` 判「骨架不齐备」的 L1 记录，**一条一个请求**送 LLM
 * 把正文重排成 G2 分类型的 `## 节名` 分节骨架，并顺带产 `dsh_keywords` / `dsh_usage_scenario`；
 * 只有**整形后骨架分严格更优且无空心标题**才写回（并盖当前整形版本戳），否则留原文**不打标记**——
 * 下轮仍可再试（用户定：「成功替换的」才不再进入重蒸馏）。
 *
 * 与 keyword-backfill 的关键差异（为什么它更重一档）：
 * - **改 content** ⇒ 写回必须走 `L1Store.appendNew`（追加 JSONL 事实源 + upsertL1 重嵌+FTS +
 *   fireFileSync 重导出），**不能**走 `MemoryBackend.patchMetadata*`（只改元数据、不动正文），
 *   也**不能**走 worker backend（`memory-backend.ts` 明示 upsert 会重嵌、worker 拿不到
 *   embedding service 会写零向量毁数据）。故本模块 deps 直取 `l1: L1Store`（进程内）。
 * - **入口 `vectorsReady()` 守卫**：`upsertL1InTx` 先删向量行、仅非零 embedding 才插回；
 *   embed 未就绪时改正文会静默丢该记录向量。故向量未就绪 ⇒ 整轮回跳过（整形是可选优化，不抢这个险）。
 *
 * 安全边界（继承 keyword/wing 回填）：
 * - 单飞：同时最多一个任务，重复触发返回 running（不排队不叠加）
 * - 后台执行：端点立即返回，逐条推进并**每条即时提交**，不阻塞 RPC/管线
 * - 失败可退：LLM 失败/输出非法/质量闸不过 ⇒ 原记录零改动（写回只发生在严格更优且 embed 就绪时）
 * - 有界：单次最多 cfg.backfill.maxRecords 条 + timeBudgetMs 墙钟；其余计入 deferred 可再触发
 * - 排除靠**版本戳**：成功写回盖 `dsh_reshape_ver = RESHAPE_SCHEMA_VERSION`；扫描只排「当前版本
 *   已整过」的（存量兼容：只有旧布尔 `dsh_reshape_tried` 且正文确为 `## 分节`式也算已整）。
 *   整形规则/提示词改变时把 `RESHAPE_SCHEMA_VERSION` 递增，旧产物即自动重新入列。
 * - 门控关（`cfg.redistill.enabled = false`）：入口立即跳过——不动 content、FTS、投射逐字不变
 *
 * 形状约定（用户定）：**按单元、串行、不合并**——一个请求只装一条记忆，跑完一条再发下一条。
 * 扫描期就用 SQL 退场判据 + 骨架判据筛出真目标（旧实现收 1221 条候选、每批 20 条只命中 ~4 条）。
 * `cfg.backfill.concurrency` 默认 1（串行）；拖高概览页滑块可临时多路在飞（上限 8）。
 * 注意：本任务直接调 `callLLM`、不进 runner 队列，拿不到“live 优先”的让位保护。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { L1Store } from './store/l1.js';
import type { MemoryConfig } from './config.js';
import type { MemoryLogger, MemoryRecord } from './types.js';
/**
 * 整形**版本戳**：只在**成功替换**时写入，值为当前整形规则版本（`RESHAPE_SCHEMA_VERSION`）。
 * 扫描阶段据此排除「已按当前规则整过形」的记录——见 `isReshapedAtCurrentVersion`。
 */
export declare const RESHAPE_VER_KEY = "dsh_reshape_ver";
/**
 * 当前整形规则版本。**改动整形骨架/提示词/输出契约时必须 +1**，否则旧产物不会重跑。
 * v1 = 行内标签式（`规则：/触发时机：`，已废）；v2 = `## 节名` 分节 + 空心标题闸。
 */
export declare const RESHAPE_SCHEMA_VERSION = 2;
export interface RedistillBackfillDeps {
    ctx: Context;
    cfg: MemoryConfig;
    /** 直取 L1Store（进程内）：改 content 要 appendNew 重嵌 + 追加 JSONL + 投射点火，不经 worker backend。 */
    l1: L1Store;
    logger: MemoryLogger;
    /**
     * 运行时**生效并发**读取器（可选）：给正在跑的任务即时改并发用——池子每完成一条重读一次。
     * 缺省 = 启动时读一次 `cfg.backfill.concurrency`（旧行为）。
     */
    concurrency?: () => number | undefined;
}
export interface RedistillBackfillState {
    running: boolean;
    /** 整形成功写回条数。 */
    updated: number;
    /** 质量闸判不写（留原文）条数。 */
    skipped: number;
    /** 失败/跳过（LLM 失败、id 配不上、embed 掉线）条数。 */
    failed: number;
    /** 分批进度（UI 轮询据此显示「扫描中 / 第几条」，否则运行期只有一个「整形中…」）： */
    /** 每个请求处理的条数——本任务已改成逐条，永远为 1（保留字段与 keyword 同形状）。 */
    chunk: number;
    /** 扫描阶段确定的**真目标**总数（骨架不齐备且未试过；扫描未完成时为已发现数）。 */
    candidates: number;
    /** 本次已完成（送过 LLM 且已提交结果）条数。**在请求完成时才自增**——
     *  在开始处加会让“全部超时失败”跟“全部成功”长得一模一样。 */
    processed: number;
    /** 仍在扫描阶段（此阶段 candidates 还在动，UI 应报「扫描中」而非「第 N 条」）。 */
    scanning: boolean;
    /** 已完成条数（与 processed 同值，保留为与 keyword 共用的进度形状）。 */
    batchesDone: number;
    /** 本次要处理的总条数。 */
    batchTotal: number;
    /** LLM 批调用并行度。 */
    concurrency: number;
    /** 预算/上限用尽未处理、留下次的条数。 */
    deferred: number;
}
export declare function redistillBackfillState(): RedistillBackfillState;
/**
 * 空心标题检测：某个 `## 节名` 到下一标题之间没有实质文字。
 *
 * 为什么需要它：判定器（`scoreSkeleton`）按子串命中认骨架，而标题词本身就是那个子串——
 * 只写 `## 触发时机` 不写内容就能白得一个命中。不堵这个闸，“加分才写回”会退化成
 * “加空标题就写回”，正文反而被掏空了。
 */
export declare function hasHollowHeading(content: string): boolean;
/** 质量闸：整形后骨架命中数严格上升（或旧不齐备且新齐备）且正文非空、无空心标题 → 判可写。 */
export declare function reshapePassesGate(type: string, oldContent: string, newContent: string): boolean;
/**
 * 是否已按**当前版本**整理过 → 扫描阶段排除（用户定：「成功替换的」才不再进入）。
 *
 * 判据：
 * - 带当前版本戳（`dsh_reshape_ver === RESHAPE_SCHEMA_VERSION`）⇒ 已成功替换，排除；
 * - 旧存量兼容：只有布尔 `dsh_reshape_tried`（成功与留原文都打过，无法区分）+ 正文确实是
 *   `## 分节`式 ⇒ 视为已整形排除；**不带标题的则重新入列**（它们是「试过但没改成」的，
 *   或首轮行内标签式产物，都该重跑）。
 */
export declare function isReshapedAtCurrentVersion(meta: Record<string, unknown> | undefined, content: string): boolean;
/** 启动后台重蒸馏回填；已在运行返回 false（单飞）。 */
export declare function startRedistillBackfill(deps: RedistillBackfillDeps): {
    started: boolean;
    running: boolean;
};
/**
 * 回填主体（导出供单测 await 到完成；生产走 `startRedistillBackfill` 的单飞后台包装）。
 * 门控关或向量未就绪 ⇒ 入口即返回，不碰任何记录、FTS、投射。
 *
 * 阶段划分对齐反刍重标定（`pipeline/relabel.ts`）：**机械扫描期把筛子下推到底**，
 * LLM 期只吃真目标、逐条推进、**每条即时提交**、条间受墙钟预算约束。
 * 形状约定（用户定）：**按单元、串行、不合并**——`concurrency` 默认 1（跑完一条再发下一条），
 * 拖高概览页滑块只是临时提速。旧形状（20 条一批）真机把单请求拖到 200s+ 并在超时线上被掐。
 */
export declare function runRedistillBackfillOnce(deps: RedistillBackfillDeps): Promise<void>;
/** 单条整形结果。 */
export interface ReshapeOneResult {
    content: string;
    keywords: string[];
    usageScenario: string[];
}
/**
 * 整形**一条**记忆（一个请求只装一条）。失败/输出非法返回 null（原记录不动）。
 *
 * 导出不带 ctx/cfg 以外的参数，供单测注入桩 LLM。旧名 `reshapeChunk`（多条一次）已废：
 * 合并请求把爆炸半径从 1 条放大到 20 条，而实测逐条只花 2.6s，合并毫无收益。
 */
export declare function reshapeOne(ctx: Context, cfg: MemoryConfig, logger: MemoryLogger, rec: MemoryRecord, callTimeoutMs?: number): Promise<ReshapeOneResult | null>;
