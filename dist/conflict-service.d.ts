/**
 * §C 矛盾冻结的**裁决出口**(task_25)。
 *
 * 冻结把裁决权交还给人,那么必须有一个"人能把结论说回去"的出口:
 * 否则待裁决队列是只进不出的黑洞,安全阀(task_24)的自动了结会成为唯一出路——
 * 那等于把 opt-in 的冻结悄悄退回成"超时后机器自己判"。
 *
 * 工具层与 RPC 层共用本模块,保证两条出口的**语义与返回形状完全一致**
 * (与 `memory_receipts` 一样:同一份 `ReceiptsView` 供工具与端点共用)。
 */
import type { L1Store } from './store/l1.js';
import type { ConflictPairView, ConflictsResponse as ConflictsView, ConflictResolveResponse as ConflictResolutionView } from './contract.js';
export type { ConflictPairView, ConflictsView, ConflictResolutionView };
export interface ConflictResolveDeps {
    l1: Pick<L1Store, 'listConflictPending' | 'resolveConflictPending' | 'retire' | 'syncGraphDisputed' | 'markConflictReviewed'>;
    /** `conflictFreeze.enabled`。未开启时队列恒空,直接给出提示而非静默无操作。 */
    conflictFreezeEnabled: boolean;
}
/**
 * 裁决一条待裁决对。
 *
 * 顺序刻意如此:
 * ① **先打 `resolved_at` 再退场 loser**。反过来的话,退场成功但打标失败会留下
 *    "记录已退场、队列里那条仍在待裁决"的状态——人再点一次才发现无据可依。
 *    打标用 `WHERE resolved_at = ''`,天然防重复裁决:第二次调用拿到 0 行即中止。
 * ② 退场后才**重算**图谱 `disputed`(派生字段必须由当前事实重算,见 `syncDisputed`)。
 * ③ 退场是**软删**(`retire`,可恢复),不是物理删除:主表行留着,`valid_to` 闭合 +
 *    写取代标记,FTS/向量行撤掉。故"判错了"可以再恢复——裁决不可覆盖,但可以反悔。
 */
export declare function resolveConflictPair(deps: ConflictResolveDeps, pairId: string, outcome: string): Promise<ConflictResolutionView>;
/** 裁决结果的人类可读渲染(工具路径用)。schema 产出的是可选字段,故按部分取值渲染。 */
export declare function renderConflictResolution(v: Partial<ConflictResolutionView>): string;
/** 一条待裁决对的对外形状见 `contract.ts` 的 `ConflictPairView`(此处只引用)。 */
/** 队列读取的上限(与 `records-delete` 同量级:够人看,不把页面拖死)。 */
export declare const CONFLICT_LIST_LIMIT_MAX = 200;
/** 默认取多少条。 */
export declare const CONFLICT_LIST_LIMIT_DEFAULT = 50;
export interface ConflictListDeps {
    l1: Pick<L1Store, 'listConflictPending' | 'countConflictPendingUnresolved' | 'getByIds'>;
    /** `conflictFreeze.enabled`。 */
    conflictFreezeEnabled: boolean;
    /** G3 成熟度旁注用：召回使用统计（缺省按 0 强化）。 */
    usage?: {
        get(id: string): {
            used: number;
        } | null | undefined;
    };
    /** 时效半衰期（天）；≤0 = 衰减关 → aging 视为 null。 */
    decayHalfLifeDays?: number;
}
/**
 * 列出待裁决对。
 *
 * **正文必须带上**:人工裁决的对象就是"这两条到底说了什么",只给 id 等于让人盲判。
 * 取不到正文时留空串 —— 面板据此区分"记录已不在检索库"与"内容为空",
 * 而不是拿一句"（无内容）"把两种情形糊在一起。
 *
 * 未开启冻结时返回 `enabled:false` + 空列表 + `notice`,**不抛错**:开关没开是
 * 部署状态,不是调用错误(与 `resolveConflictPair` 对同一情形的处理一致)。
 */
export declare function listConflictPairs(deps: ConflictListDeps, opts?: {
    limit?: number;
}): ConflictsView;
/** 列表结果的人类可读渲染(工具路径用)。 */
export declare function renderConflicts(v: ConflictsView): string;
