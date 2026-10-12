/**
 * `l1_records.metadata_json` 里承载取代标记的**保留键**。
 *
 * 加 `dsh_` 前缀的理由与 `ANCHOR_METADATA_KEY` 完全相同:写库时本插件的保留键
 * 会与 LLM 产出的 metadata(`wing` / `artifact_type` 等)合并进同一个 JSON 对象,
 * 必须靠命名空间隔开,否则一次 LLM 幻觉输出 `superseded` 就能伪装成人工裁决。
 */
export const SUPERSEDE_METADATA_KEY = 'dsh_superseded';
const REASONS = ['conflict', 'superseded', 'manual', 'obsolete'];
/**
 * 写入取代标记(返回**新对象**)。
 *
 * 与 `withSourceAnchors` 的差别:锚点"无锚点时不写键",而退场标记**永远写**——
 * 调用它的前提就是"这条记录正在退场",没有"空标记"这种合法输入。
 */
export function withSupersedeMarker(metadata, info) {
    const base = metadata ?? {};
    const marker = { at: info.at, reason: info.reason };
    // 可选字段缺省即不写键:空串会让"没有 pairId"与"pairId 是空串"无法区分
    if (info.verdict)
        marker.verdict = info.verdict;
    if (info.pairId)
        marker.pairId = info.pairId;
    // Phase 3(task_3.6):「有值才写键」的既有语义照旧——无条件写键会破
    // `tests/l1-retire.test.ts` 与 `tests/supersede-marker.test.ts` 的精确断言。
    if (info.conflictType)
        marker.conflictType = info.conflictType;
    if (info.by)
        marker.by = info.by;
    return { ...base, [SUPERSEDE_METADATA_KEY]: marker };
}
/**
 * 读回取代标记(读侧唯一入口)。
 *
 * 形状校验从严:缺 `at` 或 `reason` 非法 → 返回 `undefined`(当作**未退场**)。
 * 宁可把一条坏标记的记录当活动记录,也不把它当"已退场"而藏起来——
 * 后者会让记忆**悄悄消失**,正是本功能要根治的病。
 */
export function readSupersedeMarker(metadata) {
    if (metadata === null || typeof metadata !== 'object')
        return undefined;
    const raw = metadata[SUPERSEDE_METADATA_KEY];
    if (raw === null || typeof raw !== 'object')
        return undefined;
    const o = raw;
    const at = o.at;
    const reason = o.reason;
    if (typeof at !== 'string' || !at)
        return undefined;
    if (typeof reason !== 'string' || !REASONS.includes(reason))
        return undefined;
    const info = { at, reason: reason };
    if (typeof o.verdict === 'string' && o.verdict)
        info.verdict = o.verdict;
    if (typeof o.pairId === 'string' && o.pairId)
        info.pairId = o.pairId;
    // Phase 3(task_3.6):读侧是**白名单投影**——漏了这一行,写侧新加的 conflictType
    // 会被静默丢弃(写进去了、读不回来,而 round-trip 断言才会发现)。写读成对改。
    if (typeof o.conflictType === 'string' && o.conflictType)
        info.conflictType = o.conflictType;
    if (typeof o.by === 'string' && o.by)
        info.by = o.by;
    return info;
}
/**
 * 去标记(恢复时用)。返回**新对象**。
 *
 * 无标记时返回**原引用**——恢复一条从未退场的记录不该产生任何新对象,
 * 这条判据让"恢复"对活动记录是彻底的 no-op。
 */
export function stripSupersedeMarker(metadata) {
    const base = metadata ?? {};
    if (!(SUPERSEDE_METADATA_KEY in base))
        return base;
    const next = { ...base };
    delete next[SUPERSEDE_METADATA_KEY];
    return next;
}
/** 该记录是否处于**已退场**状态(读主表 `valid_to` 的语义封装)。 */
export function isRetired(record) {
    return record.validTo !== undefined || readSupersedeMarker(record.metadata) !== undefined;
}
