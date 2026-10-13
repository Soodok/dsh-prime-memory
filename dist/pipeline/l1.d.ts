import type { Context } from '@deepseek-ai/cordis';
import type { MemoryConfig } from '../config.js';
import type { L1Store } from '../store/l1.js';
import type { MemoryState } from '../store/state.js';
import type { ConversationAnchor, ConversationMessage, ExtractedMemory, ExtractMode, MemoryFamily, MemoryLogger, MemoryRecord, MemoryScope } from '../types.js';
export interface ExtractionResult {
    stored: number;
    skipped: boolean;
    sceneName: string;
    newRecords: MemoryRecord[];
    /** §F 追踪捎带:与本轮 l1_receipts 同源的 runId(可交叉审计);早退分支缺省。 */
    runId?: string;
    /** §F 追踪捎带:六值决策词表聚合;早退分支缺省。 */
    byKind?: Record<string, number>;
}
/** 分族 checkpoint 桶(活引用,改动由调用方 save 落盘)。 */
export type FamilyStates = Record<MemoryFamily, MemoryState>;
/** 抽取产出 + 管线补上的五个字段(与 Step 1 的 `extracted` 元素同形)。 */
export type PendingMemory = ExtractedMemory & {
    record_id: string;
    scene_name: string;
    family: MemoryFamily;
    /** §E 归属:write 侧已按 `resolveRecordScope` 算好,`toStoreRecord` 原样带出 */
    scope: MemoryScope;
    workspaceId: string;
    /** 治理归属(ADR-0015 T1.9/T1.10):进管线时一次算定(I-21),写时随 store 行落盘。 */
    repoKeyName: string;
    repoKeyOwner: string;
    applicability: string;
};
/**
 * 合并时的检索轴并集（P0-c）。
 *
 * 此前合并产物只带新记忆的 metadata，targets 的 tags/hall/cogHall/使用场景全丢——
 * 一次合并就把这条记忆从它原来的 Room/Wing 里摘出去，而面板上看不出任何异常（F2）。
 * 这里只并**检索轴**：派生评价（maturity/usage/rating）与内容层字段不在其列。
 *
 * 单值轴（hall/cogHall）两侧互斥时**保留新记忆侧并留痕**，不拼成 `"a,b"`——那会
 * 造出一个不存在的域（与 `isWingId` 的值域约束相冲）。
 *
 * @param self - 新记忆自己的 metadata（可为 undefined）。
 * @param targets - 被合并掉的旧记录们的 metadata。
 * @returns 并集后的 metadata 与若干条“丢了什么”的留痕文案。
 */
export declare function mergeAxes(self: Record<string, unknown> | undefined, targets: ReadonlyArray<Record<string, unknown> | undefined>): {
    metadata: Record<string, unknown>;
    notes: string[];
};
/**
 * 导出仅供用例：`title → name` 这一跳是本计划的风隙（模型给的名字能不能落成合法身份名），
 * 而驱动整条 LLM 管线会把断言埋进抽取/去重两段的噪声里。与 `mergeAxes` 同一先例。
 */
export declare function toStoreRecord(m: PendingMemory, now: number, ts: number, anchorMap?: ReadonlyMap<string, ConversationAnchor>): MemoryRecord;
/**
 * 按字符预算把消息切成多块(保持顺序,单条超预算独占一块,由 callLLM 兜底截断)。
 * 每条消息按 content 长度 + 64 字符脚手架开销(id/时间戳行)计。
 */
export declare function chunkByCharBudget(messages: ConversationMessage[], budgetChars: number): ConversationMessage[][];
export declare function runExtraction(ctx: Context, cfg: MemoryConfig, store: L1Store, states: FamilyStates, pending: ConversationMessage[], background: ConversationMessage[], logger: MemoryLogger, mode: ExtractMode, 
/**
 * §E 当前工作区标识(由调用方经 `sessionWorkspaceIdOf` 解析;拿不到传 undefined)。
 * 传 undefined 时行为与改动前**逐字一致**——`cfg.scope='global'` 的既有部署
 * 永远走这条分支,这是零漂移的构造性保证。
 */
workspaceId?: string, 
/**
 * R7 锚点映射(`L0 消息 id → 会话坐标`),由调用方经 `buildAnchorMap` 构造。
 * **缺省时行为与改动前逐字一致**——传入的 `pending` 消息若不带锚点(老数据、
 * 未启用捕获侧打戳),`resolveSourceAnchors` 一律返回 undefined,不写 metadata 键。
 */
anchorMap?: ReadonlyMap<string, ConversationAnchor>, 
/**
 * 合并后的**派生数据搬运钩子**（P0-d）：旧 id → 新 id。使用史与人工标注存在
 * 另两个 sidecar 里，而 merge 每次新铸 id——不搬就等于每次合并把这条记忆的
 * `used`/人工打分清零，它会被当成“没用过”而沉底。缺省不搬（行为与改动前一致）。
 */
mergeRekey?: (oldId: string, newId: string) => void): Promise<ExtractionResult>;
