/**
 * 会话「活召回集」服务端投影(memoryRecall)。
 *
 * 语义：本会话**已注入**的记忆，以及其中「此刻仍在上下文里」的那部分。
 * 数据源是 `SessionRecalledStore`（sessionKey 键、写穿持久化），所以**旧会话重开也读得到**。
 *
 * 压缩/清空对这张表的作用不同（2026-10-13 用户口径）：
 * - `clear`（主动清空）整表清，view 随之空；
 * - `compact`（摘要替换）**不删条目**，只把当时在列表里的那批标成 `superseded`（正文已被
 *   摘要取代、已不在上下文里）。读侧据此把旧召回与当前召回区分开，而不是继续谎报“还在”。
 *   已退场（`retired`）的条目必须留在列表里（人的裁决凭证），取代标记与它正交。
 *
 * 与 memorySlots 的分工（两条轴，互不替代）：
 * - `memorySlots` = 用户手动 pin 的**常驻约定**（每轮硬注入，注册表语义）；
 * - `memoryRecall` = 按相关性**隐式浮现**的召回结果（非常驻，本投影）。
 * 召回记录绝不灌进 memorySlots：那会把"非常驻"伪装成槽位注册表。
 *
 * 会话感知靠 `init(header)`：宿主在 `session/created` 与冷加载 restore 两处都传
 * `session.header`（`dsh-session/lib/index.js` 实证形状 `{ version, id, createdAt, … }`），
 * `header.id` 即会话 id，与召回记账的 sessionKey（`agent.session?.id ?? agent.id`）同源。
 * state 里带上 sessionId，apply 无 session 参数也能按本会话重读 store。
 *
 * 消费方是 dsh-brief-sidebar 的「本会话召回」分区（`useProjectionValue(ctx, sessionId, key)`）。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionRecalledStore } from '../store/session-recalled.js';
import type { MemoryRecord } from '../types.js';
export declare const MEMORY_RECALL_KEY = "memoryRecall";
/** view 最多透出条数（最近在上；超出部分只计入 count，防 wire 体量失控）。 */
export declare const RECALL_VIEW_CAP = 20;
/** 一条召回记录在 wire view 上的呈现。 */
export interface RecallItemView {
    id: string;
    type: string;
    /** 正文首行（截断至 TITLE_MAX）；全文由消费方按需走面板读。 */
    title: string;
    priority: number;
    /** 使用场景（metadata.dsh_usage_scenario）；无则缺席（附加字段，旧帧没有也整条通过）。 */
    scenario?: string[];
    /**
     * 人给的最近一次打分(-1..5)；未标注则缺席。
     * 卡片靠它把已打的那一笔显示成选中态；均值等细粒度数据走 `session-recalled` 端点。
     */
    rating?: number;
    /**
     * 正文全文（截断至 BODY_MAX）；消费方悬停泡泡直接读它，不再回查端点。
     * 缺席 = 旧帧（读侧退化成只显示 title）。
     */
    body?: string;
    /**
     * 该记录已被判定过时（`isRetired`）。只写 true：未退场时字段缺席，
     * 读侧按「缺席即活跃」处理，旧帧自然兼容。
     */
    retired?: true;
    /**
     * 该条目的正文**已被摘要取代**（压缩发生时时它就在列表里），即不在模型上下文里了。
     * 只写 true（同 `retired` 的兼容手法）；与 `retired` 正交，两者可共存。
     * 读侧据此把「已被摘要取代的旧召回」与「此刻仍在上下文里的召回」区分开。
     */
    superseded?: true;
    /**
     * 时效定性快照(task_3.5,expiry-tiering 门2 展示面)：仅在 `expired`/`expired_suspect`
     * 两档写键(泡泡如实标"已于 X 失效/疑似失效")；current/historical 等缺席=旧帧兼容。
     */
    validity?: import('../store/validity.js').ValidityState;
    /** 现实有效期(ISO)：与 `validity` 同进同退，只在写 validity 时带上。 */
    validUntil?: string;
}
/** 持久态：本会话的活召回 id 集 + 判脏序号。 */
export interface RecallProjectionState {
    rev: number;
    /**
     * 反馈 sidecar 的序号（打分也会让 view 变：条目要显示已打的那一笔）。
     * 可选：旧 checkpoint 帧里没这个字段，读侧必须容忍。
     */
    fb?: number;
    sessionId: string;
    /** 注入序（旧→新），由 store 保证。 */
    ids: string[];
    /**
     * 已被摘要取代的 id（压缩水位之上的那批）。可选：旧 checkpoint 没有这个字段，
     * 读侧必须容忍（缺席 = 无取代，与改动前逐字一致）。
     */
    superseded?: string[];
}
/** wire view：count 是总数，items 是**最近在上**的截断视图。 */
export interface RecallView {
    rev: number;
    sessionId: string;
    count: number;
    items: RecallItemView[];
}
/** 零依赖 schema（同 slots 投影的理由：registry 只调 `parse`，且按 Object.is 比较引用）。 */
interface SchemaLike<T> {
    parse(value: unknown): T;
}
/** state 校验（registry 用它挡掉损坏/过期的 checkpoint 行）。 */
export declare const stateSchema: SchemaLike<RecallProjectionState>;
export declare const viewSchema: SchemaLike<RecallView>;
/** 投影需要的 L1 只读面（结构化声明，避免跨模块类型耦合）。
 *  判退场要 `validTo`/`metadata`，时效定性还要 `persistence`/`validFrom`，
 *  故直接 Pick 自 MemoryRecord，不在投影里自写时间比较。
 *  `name` 是名称蒸馏产出的短标题，优先作为展示标题。 */
export interface RecallL1Face {
    getByIds(ids: string[]): Array<Pick<MemoryRecord, 'id' | 'type' | 'content' | 'priority' | 'metadata' | 'validFrom' | 'validTo' | 'persistence' | 'name'>>;
}
/** 投影需要的反馈只读面（缺席 = view 不带 rating，旧行为）。 */
export interface RecallFeedbackFace {
    revision(): number;
    lastOf(id: string): number | undefined;
}
/**
 * 注册 memoryRecall 投影。
 *
 * 缺席降级同 slots 投影：`ctx.inject` 在服务未提供时不回调；形状不符静默不注册。
 * apply 是 O(1) 判脏（store.revision() 与反馈序号比对），任意已提交事件都会带进来看一眼。
 * @param feedback - 相关度反馈只读面；缺席时 view 不带 rating（旧行为）。
 */
export declare function registerRecallProjection(ctx: Context, store: SessionRecalledStore, l1?: RecallL1Face, feedback?: RecallFeedbackFace): void;
export {};
