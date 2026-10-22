/**
 * 投影提案硬校验与落库语义(纯函数,无 I/O)。
 *
 * 这是图谱最核心的守门代码,唯一不变量:**零无来源事实**——每个节点/fact/边的
 * sourceRecordIds 必须非空且全部属于本 job 认领的记录批次,否则整条提案静默丢弃。
 * 图谱里不存在无法回溯到 L1 记录(进而到 JSONL 事实源)的结论。
 *
 * 其余语义:
 * - 实体消歧:normalizeEntityName(NFKC + 小写 + 去空白/下划线/连字符)归一后同名
 *   且类型一致才合并(别名累积去重);子串包含不算同一实体;
 * - 状态历史:同 key 的新 fact 把旧 active fact 标 superseded 并闭合 validTo;
 *   同 (from,relation) 指向新目标的旧边同样 supersede——保留时间区间,不覆盖历史;
 * - currentState 只由 active facts 重建;
 * - 时间锚四级链:activity_start_time → activity_end_time → timestamps 最新 →
 *   createdAt,跨来源取最晚(ISO);无任何证据时才落到 now,不猜日期。
 *
 * 函数直接变异传入的 nodes/edges(merge scope),返回 touched id 集合——调用方
 * (GraphStore.complete)在单事务内 load scope → apply → 写回,LLM 调用永远
 * 不发生在该事务内。
 */
import { familyForType } from '../types.js';
import { GRAPH_CAP, GRAPH_NODE_TYPE_SET, GRAPH_SOURCE_RECORDS_CAP, GRAPH_STATUS_SET, } from './constraints.js';
/** 字符串字段归一:trim、折叠空白、截断;非字符串一律空串。 */
function textOf(value, limit) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : '';
}
/** 字符串数组字段归一:逐项截断去空、跨项去重、截到条数上限。 */
function stringsOf(value, itemCap, countCap) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const item of value) {
        const t = textOf(item, itemCap);
        if (t && !out.includes(t))
            out.push(t);
        if (out.length >= countCap)
            break;
    }
    return out;
}
/** 置信度钳制:非法值回到 0.8 中性档(提案没填 = 模型默认自信度)。 */
function clampConfidence(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.8;
}
/** 状态归一:非法值回 active(四态之外的表达一律不采信)。 */
function clampStatus(value) {
    return typeof value === 'string' && GRAPH_STATUS_SET.has(value) ? value : 'active';
}
/**
 * 实体名归一(NFKC + 小写 + 去空白/下划线/连字符):全角/半角、大小写、
 * "张 三"与"张三"、"AI-agent"与"aiagent"视作同一实体的拼写变体。
 * 归一后空串返回原串(防止空名互相合并)。
 */
export function normalizeEntityName(name) {
    const normalized = name.normalize('NFKC').toLowerCase().replace(/[\s_-]+/g, '');
    return normalized || name;
}
/** 记录族兜底(record.family 缺失时按 type 前缀推导,与写入侧同一兜底链)。 */
function recordFamily(r) {
    return r.family ?? familyForType(r.type);
}
/**
 * 时间锚:有效期为先,提及/入库时间为后。
 *
 * 逐条记录按六级证据取最晚,任何一级无法解析(缺字段/非法日期)即落到下一级:
 * validTo → validFrom(时间增强列,新写入路径)→ metadata.activity_end_time →
 * metadata.activity_start_time(列迁移前的存量数据)→ timestamps 最新 → createdAt。
 * 全部无证据才用 fallback(now),绝不猜测。
 *
 * task_2.6(expiry-tiering):兜底 now 分支回传 `'fallback_now'` 证据等级——供图谱侧
 * 同口径读时派生使用(落到 now 的 validFrom **不是**时间证据,与 activity_* 链的
 * 'evidence' 必须可区分;否则假过期与真过期同形)。
 */
export function anchorTimeFromRecordsDetailed(records, fallbackIso) {
    let latest = Number.NaN;
    const consider = (raw) => {
        const t = typeof raw === 'number' ? raw : typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
        if (Number.isFinite(t) && t > 0 && (Number.isNaN(latest) || t > latest))
            latest = t;
    };
    for (const r of records) {
        // 时间增强列优先(新写入路径),再回落 metadata.activity_*(列迁移前的存量数据)
        consider(r.validTo);
        consider(r.validFrom);
        const meta = r.metadata;
        consider(meta?.activity_start_time);
        consider(meta?.activity_end_time);
        for (const t of r.timestamps ?? [])
            consider(t);
        consider(r.createdAt);
    }
    return Number.isNaN(latest)
        ? { iso: fallbackIso, source: 'fallback_now' }
        : { iso: new Date(latest).toISOString(), source: 'evidence' };
}
/** {@link anchorTimeFromRecordsDetailed} 的旧签名封装(调用方只要时刻时的零改动通道)。 */
export function anchorTimeFromRecords(records, fallbackIso) {
    return anchorTimeFromRecordsDetailed(records, fallbackIso).iso;
}
/** 来源集并集封顶(保最新:新引用追加在尾部,溢出丢头部最老引用)。 */
function unionSourcesCapped(old, add) {
    const merged = [...new Set([...old, ...add])];
    return merged.length > GRAPH_SOURCE_RECORDS_CAP ? merged.slice(-GRAPH_SOURCE_RECORDS_CAP) : merged;
}
/** 同一实体判定:类型一致 + 名称/别名归一后的集合相交(子串包含不算)。 */
function isSameEntity(node, name, aliases, type) {
    if (node.type !== type)
        return false;
    const keys = new Set([normalizeEntityName(name), ...aliases.map(normalizeEntityName)]);
    return [node.name, ...node.aliases].some((candidate) => keys.has(normalizeEntityName(candidate)));
}
/** 应用一次投影提案(硬校验 + 消歧 + supersede + 状态重建)。 */
export function applyGraphProjection(options) {
    const { nodes, edges, records, allowedRecordIds, now, idFactory } = options;
    const refs = new Map();
    const touchedNodes = new Set();
    const touchedEdges = new Set();
    let dropped = 0;
    /** 来源引用校验:非空且全部属于本批(任一越批 = 整条提案不可信,返回空)。 */
    const validSources = (value) => {
        const requested = stringsOf(value, GRAPH_CAP.ref, GRAPH_CAP.proposalSources);
        return requested.length > 0 && requested.every((id) => allowedRecordIds.has(id)) ? requested : [];
    };
    const recordById = new Map(records.map((r) => [r.id, r]));
    const familiesOf = (sourceIds) => {
        const families = new Set();
        for (const id of sourceIds) {
            const r = recordById.get(id);
            if (r)
                families.add(recordFamily(r));
        }
        return [...families];
    };
    // ── 节点提案 ──
    for (const raw of Array.isArray(options.result.nodes) ? options.result.nodes : []) {
        const ref = textOf(raw?.ref, GRAPH_CAP.ref);
        const name = textOf(raw?.name, GRAPH_CAP.name);
        const sources = validSources(raw?.sourceRecordIds);
        if (!ref || !name || !GRAPH_NODE_TYPE_SET.has(raw?.type) || sources.length === 0) {
            dropped++;
            continue;
        }
        const aliases = stringsOf(raw?.aliases, GRAPH_CAP.alias, GRAPH_CAP.aliases).filter((alias) => normalizeEntityName(alias) !== normalizeEntityName(name));
        const tags = stringsOf(raw?.tags, GRAPH_CAP.tag, GRAPH_CAP.tags);
        const validFrom = textOf(raw?.validFrom, GRAPH_CAP.date) || anchorTimeFromRecords(sources.map((id) => recordById.get(id)).filter(Boolean), now);
        const validTo = textOf(raw?.validTo, GRAPH_CAP.date) || undefined;
        const status = clampStatus(raw?.status);
        const confidence = clampConfidence(raw?.confidence);
        // 消歧合并:同名同型已有节点就地更新;否则新建
        let node = nodes.find((candidate) => isSameEntity(candidate, name, aliases, raw.type));
        if (!node) {
            node = {
                id: idFactory('node'),
                name,
                type: raw.type,
                aliases: [],
                currentState: '',
                facts: [],
                status,
                confidence,
                sourceRecordIds: [],
                families: [],
                createdAt: now,
                updatedAt: now,
            };
            nodes.push(node);
        }
        node.aliases = [...new Set([...node.aliases, ...aliases])];
        if (tags.length > 0)
            node.tags = [...new Set([...(node.tags ?? []), ...tags])].slice(0, GRAPH_CAP.tags);
        node.status = status;
        node.confidence = confidence;
        node.sourceRecordIds = unionSourcesCapped(node.sourceRecordIds, sources);
        node.families = [...new Set([...node.families, ...familiesOf(sources)])];
        // 事实集:单行状态(state)归一为「状态」fact + 显式 facts 数组
        const stateLine = textOf(raw?.state, GRAPH_CAP.state);
        const explicitFacts = Array.isArray(raw?.facts) ? raw.facts : [];
        const factProposals = [
            ...(stateLine ? [{ key: '状态', value: stateLine }] : []),
            ...explicitFacts,
        ];
        for (const fp of factProposals) {
            const key = textOf(fp?.key, GRAPH_CAP.factKey);
            const value = Array.isArray(fp?.value)
                ? stringsOf(fp.value, GRAPH_CAP.factValue, GRAPH_CAP.factValueItems)
                : textOf(fp?.value, GRAPH_CAP.factValue);
            if (!key || (Array.isArray(value) ? value.length === 0 : !value))
                continue;
            // fact 级来源可选:未带则继承节点提案的来源(同样过批校验)
            const factSources = fp && 'sourceRecordIds' in fp && fp.sourceRecordIds !== undefined
                ? validSources(fp.sourceRecordIds)
                : sources;
            if (factSources.length === 0) {
                dropped++;
                continue;
            }
            // supersede:同 key 的旧 active fact 闭合(保留完整时间区间)
            for (const old of node.facts) {
                if (old.status === 'active' && old.key === key) {
                    old.status = 'superseded';
                    if (!old.validTo)
                        old.validTo = validFrom;
                    old.updatedAt = now;
                }
            }
            const fact = {
                id: idFactory('gfact'),
                key,
                value,
                status,
                validFrom,
                ...(validTo ? { validTo } : {}),
                confidence,
                sourceRecordIds: unionSourcesCapped([], factSources),
                createdAt: now,
                updatedAt: now,
            };
            node.facts.push(fact);
        }
        // currentState 只由 active facts 重建(superseded/disputed/archived 不进状态串)
        node.currentState = node.facts
            .filter((f) => f.status === 'active')
            .map((f) => `${f.key}: ${Array.isArray(f.value) ? f.value.join('、') : f.value}`)
            .join('\n');
        node.updatedAt = now;
        refs.set(ref, node);
        touchedNodes.add(node.id);
    }
    // ── 边提案 ──
    for (const raw of Array.isArray(options.result.edges) ? options.result.edges : []) {
        const from = refs.get(textOf(raw?.fromRef, GRAPH_CAP.ref));
        const to = refs.get(textOf(raw?.toRef, GRAPH_CAP.ref));
        const relation = textOf(raw?.relation, GRAPH_CAP.relation);
        const sources = validSources(raw?.sourceRecordIds);
        if (!from || !to || from.id === to.id || !relation || sources.length === 0) {
            dropped++;
            continue;
        }
        const status = clampStatus(raw?.status);
        const confidence = clampConfidence(raw?.confidence);
        const validFrom = textOf(raw?.validFrom, GRAPH_CAP.date) || anchorTimeFromRecords(sources.map((id) => recordById.get(id)).filter(Boolean), now);
        const validTo = textOf(raw?.validTo, GRAPH_CAP.date) || undefined;
        // supersede:同 (from,relation) 指向新目标 → 旧 active 边闭合
        for (const old of edges) {
            if (old.status === 'active' && old.fromNodeId === from.id && old.relation === relation && old.toNodeId !== to.id) {
                old.status = 'superseded';
                if (!old.validTo)
                    old.validTo = validFrom;
                old.updatedAt = now;
                touchedEdges.add(old.id);
            }
        }
        // 同 (from,to,relation,status) 已有边 → 合并来源;否则新建
        const existing = edges.find((e) => e.fromNodeId === from.id && e.toNodeId === to.id && e.relation === relation && e.status === status);
        if (existing) {
            existing.sourceRecordIds = unionSourcesCapped(existing.sourceRecordIds, sources);
            existing.confidence = confidence;
            existing.updatedAt = now;
            touchedEdges.add(existing.id);
        }
        else {
            const edge = {
                id: idFactory('edge'),
                fromNodeId: from.id,
                toNodeId: to.id,
                relation,
                status,
                validFrom,
                ...(validTo ? { validTo } : {}),
                confidence,
                sourceRecordIds: unionSourcesCapped([], sources),
                createdAt: now,
                updatedAt: now,
            };
            edges.push(edge);
            touchedEdges.add(edge.id);
        }
    }
    return { nodeIds: [...touchedNodes], edgeIds: [...touchedEdges], dropped };
}
