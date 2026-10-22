import { readSupersedeMarker } from './supersede.js';
/** `l1_records.metadata_json` 里承载有效性标注的**保留键**。 */
export const VALIDITY_METADATA_KEY = 'dsh_validity';
const VALIDITY_STATES = [
    'current', 'historical', 'expired', 'expired_suspect', 'superseded', 'retired',
];
const VALID_TO_SOURCES = ['evidence', 'llm_inferred', 'fallback_now', 'unknown'];
/**
 * 写入有效性标注(返回**新对象**)。
 *
 * `info` 缺失或没有合法 `state` 时**不写键并原样返回**——"未判定"不是一种标注,
 * 不该产生一个空壳键占位(零漂移纪律,对齐 task_1.7 的字节断言)。
 */
export function withValidity(metadata, info) {
    const base = metadata ?? {};
    if (!info || typeof info.state !== 'string' || !VALIDITY_STATES.includes(info.state))
        return base;
    const marker = {
        state: info.state,
        validToSource: VALID_TO_SOURCES.includes(info.validToSource ?? 'unknown') ? (info.validToSource ?? 'unknown') : 'unknown',
        basis: typeof info.basis === 'string' ? info.basis : '',
        at: typeof info.at === 'string' ? info.at : '',
    };
    // 可选字段"有值才写键"(与 supersede.ts 同一语义:空串无法与"没有该字段"区分)
    if (info.by)
        marker.by = info.by;
    if (info.pairId)
        marker.pairId = info.pairId;
    if (typeof info.confidence === 'number' && Number.isFinite(info.confidence)) {
        marker.confidence = Math.max(0, Math.min(1, info.confidence));
    }
    return { ...base, [VALIDITY_METADATA_KEY]: marker };
}
/**
 * 读回有效性标注(读侧**唯一入口**,白名单投影)。
 *
 * 形状校验从严:`state` 缺失或不在六态枚举内 → 返回 `undefined`(当作**未标注**)。
 * 未标注的记录由调用方按 fail-open 处理,绝不让一个坏键把记忆判成"过时"而藏起来。
 */
export function readValidity(metadata) {
    if (metadata === null || typeof metadata !== 'object')
        return undefined;
    const raw = metadata[VALIDITY_METADATA_KEY];
    if (raw === null || typeof raw !== 'object')
        return undefined;
    const o = raw;
    if (typeof o.state !== 'string' || !VALIDITY_STATES.includes(o.state))
        return undefined;
    const info = {
        state: o.state,
        validToSource: typeof o.validToSource === 'string' && VALID_TO_SOURCES.includes(o.validToSource)
            ? o.validToSource
            : 'unknown',
        basis: typeof o.basis === 'string' ? o.basis : '',
        at: typeof o.at === 'string' ? o.at : '',
    };
    // 写读成对:写侧每个可选字段都必须在这里成对读回(漏读=静默丢字段,
    // supersede 的 conflictType 曾踩过这个坑)。
    if (typeof o.by === 'string' && o.by)
        info.by = o.by;
    if (typeof o.pairId === 'string' && o.pairId)
        info.pairId = o.pairId;
    if (typeof o.confidence === 'number' && Number.isFinite(o.confidence)) {
        info.confidence = Math.max(0, Math.min(1, o.confidence));
    }
    return info;
}
/**
 * 去标注(重判前清旧键用)。返回**新对象**;无键时返回**原引用**——
 * 对未标注记录做 strip 是彻底的 no-op,不产生任何新对象。
 */
export function stripValidity(metadata) {
    const base = metadata ?? {};
    if (!(VALIDITY_METADATA_KEY in base))
        return base;
    const next = { ...base };
    delete next[VALIDITY_METADATA_KEY];
    return next;
}
/**
 * 六态判据(spec §0 表,唯一真源)。
 *
 * 判定次序:退场标记 > 时间轴。marker 存在即 `superseded`/`retired`,
 * 不看 valid_to——"软删遮蔽"与"过时"是正交两轴,marker 是既成事实。
 * persistence 未判定时 **fail-open**:valid_to 未闭合 → `current`;
 * 已闭合(无论来源)→ `expired_suspect`(宁可标注疑,也不静默隐藏)。
 */
export function classifyValidity(input) {
    const { marker, persistence, validTo, validToSource = 'unknown', now } = input;
    if (marker) {
        return marker.reason === 'manual' || marker.reason === 'obsolete' ? 'retired' : 'superseded';
    }
    const hasValidTo = typeof validTo === 'number' && Number.isFinite(validTo) && validTo > 0;
    const past = hasValidTo && validTo <= now;
    if (persistence === undefined) {
        // 未判定不参与取代/闭合判定,只当普通事实:能判疑,不能判死。
        return past ? 'expired_suspect' : 'current';
    }
    if (persistence === 'o') {
        if (!hasValidTo || !past)
            return 'current';
        return validToSource === 'evidence' ? 'expired' : 'expired_suspect';
    }
    // p(时点)/ s(已结束区间)/ t(无时间性):未退场即"有效-历史",照常可检可注入。
    return 'historical';
}
/** 六态里是否属于**退场态**(撤出检索面的那两档)。 */
export function isExitedState(state) {
    return state === 'superseded' || state === 'retired';
}
/** 从记录 metadata 推 validToSource(未标注一律 'unknown',判不出可信过时)。 */
export function validToSourceOf(metadata) {
    return readValidity(metadata)?.validToSource ?? 'unknown';
}
/**
 * 检索出口的时效可见性谓词(门3，工具与面板 RPC 共用一份——防两处漂移)。
 *
 * 存在理由:门1 解除索引遮蔽后，带合法历史/过期 valid_to 的行会进检索命中；
 * "默认只给有效"由出口层这刀维持(与改前"索引天然遮蔽 expired"的输出逐字等价)。
 * 退场两档(superseded/retired)已被门1 索引层挡在命中之外，这里再查一道
 * 只为 `asOf` 回放路径("不复活退场"的显式兑现)，不是重复过滤。
 */
export function passesValidityGate(record, now, opts = {}) {
    // 退场行永不可见(asOf 不复活;命中面本已不含它们,防御性兑现语义)。
    if (readSupersedeMarker(record.metadata) !== undefined)
        return false;
    const asOf = typeof opts.asOf === 'number' && Number.isFinite(opts.asOf) && opts.asOf > 0 ? opts.asOf : undefined;
    if (asOf !== undefined) {
        const from = record.validFrom ?? record.createdAt;
        if (Number.isFinite(from) && from > asOf)
            return false;
        if (record.validTo !== undefined && asOf >= record.validTo)
            return false;
        return true;
    }
    if (opts.includeExpired === true)
        return true;
    // 默认与 includeExpired 两档都只剔"可信 expired";expired_suspect 保留(疑而不隐)。
    return stateOfRecord(record, now) !== 'expired';
}
/**
 * 记录现态的**读侧**定性(expiry-tiering 门2/门3 与图谱传播共用):
 * 六态由记录现值 + 当下墙钟**查询期谓词**算出,不吃落库快照——
 * `expired` 随时间自然成立,拿写入时缓存的 state 会把"当时还没过时"当成永真。
 * 标注(`dsh_validity`)只为面板/审计留一份"写当时怎么判的",不是判据本身。
 */
export function stateOfRecord(record, now) {
    return classifyValidity({
        marker: readSupersedeMarker(record.metadata),
        persistence: record.persistence,
        validTo: record.validTo,
        validToSource: validToSourceOf(record.metadata),
        now,
    });
}
/**
 * 被动注入候选的时效过滤(门2 主体,纯函数供单测;调用点在 `hooks/recall.ts`,
 * 仅 `tieringEnabled` 为真时进入——关时逐字现状由调用点门保证)。
 *
 * 判据单源 `classifyValidity`(经 stateOfRecord 现算),不另写 valid_to/marker 比较(计划 §4 约束)。
 * 行缺失 fail-open 保留:宁多注一条也不静默丢记忆。
 */
export function filterInjectCandidates(candidates, recordOf, now) {
    const kept = [];
    const suspectIds = new Set();
    let exited = 0;
    for (const c of candidates) {
        const r = recordOf(c.id);
        if (r === undefined) {
            kept.push(c);
            continue;
        }
        const state = stateOfRecord(r, now);
        if (state === 'expired')
            continue;
        if (isExitedState(state)) {
            exited++;
            continue;
        }
        if (state === 'expired_suspect')
            suspectIds.add(c.id);
        kept.push(c);
    }
    return { kept, suspectIds, exited };
}
/**
 * 写侧标注钩子(expiry-tiering 门2/门3 的写入时机,spec §2.1"派生时机"):
 * 对**新建/重写**的记录就地盖一份 `dsh_validity` 快照(供面板/审计/反查展示,
 * 判定仍以 `stateOfRecord` 现算为准——本快照不是判据)。
 *
 * 直接变异传入 record(与 `familyForType` 兜底同位:写侧拥有刚建的记录对象;
 * 检索命中等共享对象绝不得经本函数改写)。`sourceHint` 只在尚无标注时生效:
 * 管线/工具在源头就知道 valid_to 的证据链,盖得越早越准;汇流口补盖拿不到
 * 源头信息时留 'unknown'(fail-open,只能判疑不能判死)。
 */
export function stampValidity(record, now, sourceHint) {
    const existing = readValidity(record.metadata);
    const marker = readSupersedeMarker(record.metadata);
    const source = existing?.validToSource ?? sourceHint ?? 'unknown';
    const state = classifyValidity({ marker, persistence: record.persistence, validTo: record.validTo, validToSource: source, now });
    record.metadata = withValidity(record.metadata, {
        state,
        validToSource: source,
        basis: marker ? `marker:${marker.reason}` : `persistence:${record.persistence ?? '?'} validToSource:${source}`,
        at: new Date(now).toISOString(),
        ...(marker?.by ? { by: marker.by } : {}),
        ...(marker?.pairId ? { pairId: marker.pairId } : {}),
    });
}
