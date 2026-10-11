/**
 * 会话「活召回集」服务端投影(memoryRecall)。
 *
 * 语义：本会话**已注入、且目前仍在上下文里**的记忆（= 模型此刻真正看到的几条）。
 * 上下文被压缩/清空时注入内容离开模型，集合随之清空——数据源是
 * `SessionRecalledStore`（sessionKey 键、写穿持久化），所以**旧会话重开也读得到**。
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
}
/** 持久态：本会话的活召回 id 集 + 判脏序号。 */
export interface RecallProjectionState {
    rev: number;
    sessionId: string;
    /** 注入序（旧→新），由 store 保证。 */
    ids: string[];
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
/** view 校验（出网前调用；未知键容忍，同 slots 投影的语义边界）。 */
export declare const viewSchema: SchemaLike<RecallView>;
/** 投影需要的 L1 只读面（结构化声明，避免跨模块类型耦合）。 */
export interface RecallL1Face {
    getByIds(ids: string[]): Array<{
        id: string;
        type: string;
        content: string;
        priority: number;
        metadata?: Record<string, unknown>;
    }>;
}
/**
 * 注册 memoryRecall 投影。
 *
 * 缺席降级同 slots 投影：`ctx.inject` 在服务未提供时不回调；形状不符静默不注册。
 * apply 是 O(1) 判脏（store.revision() 比对），任意已提交事件都会带进来看一眼。
 */
export declare function registerRecallProjection(ctx: Context, store: SessionRecalledStore, l1?: RecallL1Face): void;
export {};
