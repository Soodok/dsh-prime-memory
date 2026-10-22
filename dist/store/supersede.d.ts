/**
 * 记忆退场的**取代标记**(软删可恢复)——纯函数层。
 *
 * ## 为什么需要它
 *
 * 退场(裁决判负 / 去重取代 / 人工删除)此前一律 `deleteL1Batch` **物理删除**:
 * 主表、FTS、向量三处同清,记录直接消失。于是"删错了"只能靠 `records/*.jsonl`
 * 事实源捞回来——**检索库自身不可恢复**。
 *
 * 本模块承载"可恢复"里最纯的那一半:**标记的形状**。把它抽成独立纯函数层,
 * 与 `anchors.ts` 同一理由——读写都是"输入 → 输出",可以是单测直接验的,
 * 而不必起库、起宿主。
 *
 * ## 两条铁律
 *
 * 1. **不可变**:`with*` / `strip*` 一律返回**新对象**,绝不改入参。调用方的
 *    `record.metadata` 可能正被别处引用(检索命中、面板视图),就地改写会
 *    造成"读一次数据被改一次"的隐性副作用。
 * 2. **零漂移**:`strip` 在无标记时返回**原引用**;`with` 只在确有标记时才写键。
 *    既有记录的 `metadata_json` 不该因为本功能上线而多出任何字节。
 */
import type { MemoryRecord } from '../types.js';
/**
 * `l1_records.metadata_json` 里承载取代标记的**保留键**。
 *
 * 加 `dsh_` 前缀的理由与 `ANCHOR_METADATA_KEY` 完全相同:写库时本插件的保留键
 * 会与 LLM 产出的 metadata(`wing` / `artifact_type` 等)合并进同一个 JSON 对象,
 * 必须靠命名空间隔开,否则一次 LLM 幻觉输出 `superseded` 就能伪装成人工裁决。
 */
export declare const SUPERSEDE_METADATA_KEY = "dsh_superseded";
/**
 * 退场原因。**穷举**而非自由字符串:面板要按原因给不同文案与图标,
 * 自由字符串会让"未识别的原因"静默退化成无徽标。
 */
export type RetireReason = 'conflict' | 'superseded' | 'manual' | 'obsolete';
/** 取代标记(写进 metadata 的负载)。 */
export interface SupersedeInfo {
    /** 退场时刻(ISO 8601)。 */
    at: string;
    reason: RetireReason;
    /** 裁决结论 `winner` / `loser` / `both` / `auto`(仅 `reason='conflict'`)。 */
    verdict?: string;
    /** 产生该退场的待裁决对 id(仅 `reason='conflict'`,供交叉审计)。 */
    pairId?: string;
    /**
     * §C Phase 3(task_3.6):该对冲突的**类型轴**(`hard` / `conditional` / `supersession`)。
     *
     * 写在这里是为了让"退场"这一跳也带得走类型:否则人工裁决一条 `conditional`
     * 冲突后,只剩 `verdict` 能看出"判了谁赢",看不出"判的是哪一类矛盾"。
     */
    conflictType?: string;
    /** **取代它的**新记录 id(仅 `reason='superseded'`)。 */
    by?: string;
}
/**
 * 写入取代标记(返回**新对象**)。
 *
 * 与 `withSourceAnchors` 的差别:锚点"无锚点时不写键",而退场标记**永远写**——
 * 调用它的前提就是"这条记录正在退场",没有"空标记"这种合法输入。
 */
export declare function withSupersedeMarker(metadata: Record<string, unknown> | undefined, info: SupersedeInfo): Record<string, unknown>;
/**
 * 读回取代标记(读侧唯一入口)。
 *
 * 形状校验从严:缺 `at` 或 `reason` 非法 → 返回 `undefined`(当作**未退场**)。
 * 宁可把一条坏标记的记录当活动记录,也不把它当"已退场"而藏起来——
 * 后者会让记忆**悄悄消失**,正是本功能要根治的病。
 */
export declare function readSupersedeMarker(metadata: unknown): SupersedeInfo | undefined;
/**
 * 去标记(恢复时用)。返回**新对象**。
 *
 * 无标记时返回**原引用**——恢复一条从未退场的记录不该产生任何新对象,
 * 这条判据让"恢复"对活动记录是彻底的 no-op。
 */
export declare function stripSupersedeMarker(metadata: Record<string, unknown> | undefined): Record<string, unknown>;
/**
 * 该记录是否处于**已退场**状态(退场判据的唯一读侧封装)。
 *
 * 门1 解耦(expiry-tiering R1):只认 marker，**不再**把 `validTo !== undefined` 当退场——
 * valid_to 回归纯现实有效期(一条 2020 年结束的旅行记忆没有退场，只是成了历史)。
 * 旧口径把"过时""历史区间""软删"三件事塞进一根列，导致合法带 valid_to 的存量记录
 * 被检索面静默遮蔽——那是本计划要根治的病根(误遮蔽历史由升版回灌收敛，见迁移 task_6.1)。
 * `retiredL1Sql()`(sqlite.ts)与本函数是全仓同口径的一对，改动必须两处同步。
 */
export declare function isRetired(record: Pick<MemoryRecord, 'metadata'>): boolean;
