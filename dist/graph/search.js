/**
 * 图谱节点检索(纯函数,无 I/O):字段加权重叠计分 + 可解释命中输出。
 *
 * 与 L1 检索(FTS5/向量)不同,图谱节点量级是"可重建投影"的百~千级,在此
 * 直接内存打分即可,不建倒排索引(>2k 节点再考虑预建)。
 *
 * ── 图谱演进阶梯(阈值触发,非按需猜测)──────────────────────────────
 * 图谱是 L0 → L1 → 图谱 链上的可重建派生投影(不是事实源),故存储引擎**可随时替换,
 * 且是重建而非迁移**——这是当前不引入图数据库不会锁死将来的核心依据。
 * 本阶梯把"何时才该升级"固化成可判定的阈值,避免提前引入重型方案:
 *
 *   Tier  能力                                          存储      触发阈值                  成本
 *   T0    邻接表 + 字段加权打分(即本文件)               SQLite    nodes 10²~10³(现状)      已有
 *   T1    TS 内存 BFS/DFS:k-hop/最短路径/连通分量       **不变**  nodes ≤ ~10k             纯 TS,零 schema 变更
 *                                                                edges ≤ ~100k(=T1 上限)
 *   T2    递归 CTE(不物化全图)                          **不变**  图装不进内存              复杂 SQL + 手工防环
 *   T3    闭包表/物化路径(传递闭包预计算)               **不变**  高频多跳重复查询          写放大,边变更需维护
 *   T4    嵌入式图引擎(Kuzu 优先,非 Neo4j)              换引擎    T1-T3 全部不足            原生依赖,破坏自包含
 *
 * **2k 节点** = 预建倒排索引的检查点(上方既有判断);**10k / 100k** = T1 内存遍历的上限。
 *
 * **注意**:10k 节点 / 100k 边是**按内存占用推算的估算值**(10 万边 × ~100 字节 ≈ 10 MB),
 * **非实测**,待真实规模数据校准。多跳遍历归 TS 纯函数层,**不使用 `WITH RECURSIVE`**。
 *
 * 设计要点:
 * - 分词与 L0/L1 共用 util/text.ts 的 tokenize(jieba 词 ∪ 拉丁词 ∪ CJK 二元组),
 *   查询与文档两侧同源;
 * - 字段加权:name×6 / aliases×5 / tags×5 / currentState×4 / facts×4 /
 *   relations×3 / type×2——名称是实体最强身份信号,关系词最弱(邻接噪声);
 * - facts 只拼 active(superseded 是历史,不该让旧状态把节点拉进结果);
 * - relations 只取 active 边(superseded 的旧关系同理);
 * - "仅关系词命中"的结果过滤丢弃:只命中关系名的节点通常是邻接噪声
 *   (type-only 命中仍保留,保证按"项目/工具"等类型搜索可用);
 * - score 只用于排序,不是事实置信度;无词法命中返回空,不兜底。
 */
import { tokenize } from '../util/text.js';
import { GRAPH_HOP_RECORD_CAP, GRAPH_SEARCH_LIMIT_MAX } from './types.js';
/** 字段权重(检索命中计分;名称最高、关系词最低)。 */
export const GRAPH_FIELD_WEIGHTS = {
    name: 6,
    aliases: 5,
    tags: 5,
    currentState: 4,
    facts: 4,
    relations: 3,
    type: 2,
};
/** matchedFields 的中文标签(matchReason 组装)。 */
const FIELD_LABELS = {
    name: '名称',
    aliases: '别名',
    tags: '标签',
    currentState: '当前状态',
    facts: '事实',
    relations: '关系',
    type: '类型',
};
const FIELD_ORDER = ['name', 'aliases', 'tags', 'currentState', 'facts', 'relations', 'type'];
/** fact 值渲染进检索文本(数组值空格连接)。 */
function factValueText(value) {
    return Array.isArray(value) ? value.join(' ') : value;
}
/** ISO 字符串区间覆盖判定(字典序=时间序;空串视作未闭合)。 */
function coversInterval(from, to, asOf) {
    if (from && from > asOf)
        return false;
    if (to && asOf >= to)
        return false;
    return true;
}
/** fact 在回放时刻是否成立(active 恒成立;superseded 看区间)。archived/disputed 不含。 */
function factValidAtAsOf(f, asOf) {
    if (f.status === 'active')
        return true;
    if (f.status === 'superseded')
        return coversInterval(f.validFrom, f.validTo, asOf);
    return false;
}
/** 节点新度序(updatedAt 新→旧,同值按 id 升序——与检索结果排序同式)。 */
function byNodeRecency(a, b) {
    return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1;
}
/**
 * 图谱命中 → L1 记录 id 序列(§D 第 3 路 RRF 的输入;纯函数,无 I/O)。
 *
 * 图谱是**可重建派生投影**,节点/fact 的 `sourceRecordIds` 是它回链 L1 的唯一凭证
 * (types.ts:6-7)。此处把"节点排名"翻译成"L1 记录排名",分两段:
 *
 * - **直连段**:命中节点自身 + 其 active facts 的来源(task_9 原语义、原顺序);
 * - **1-hop 段**:命中节点沿 **active 边**的双向邻居(邻居需 active|disputed)的
 *   节点自身来源,按邻居 updatedAt 新→旧追加,整段新增封顶
 *   `GRAPH_HOP_RECORD_CAP`——这是图路"关系可达"增量价值的兑现面。
 *   hop 段只取邻居节点自身来源,不取 fact 来源(hop 是联想不是证据,噪声从紧)。
 *
 * 两段共用纪律:
 * - **保序**:先出现的记录 = 更高排名(直连段恒先于 hop 段);已被直连段占位的
 *   id 不重复计入、也**不吃 hop 名额**(关联额度不被身份来源挤占);
 * - **去重**:同一 L1 记录被多个节点/fact 引用,只占首次出现的位置;
 * - **节点自身来源优先于其 fact 来源**:节点的 sourceRecordIds 是它的身份来源,
 *   而单个 fact 的来源可能引向与该查询无关的旁支记录;
 * - **只取 active fact**:superseded 是历史状态,不该把旧记录拉进当前检索结果;
 * - **不查库**:返回的 id 可能已被删除(墓碑边界),由调用方按"取不到的跳过"处理,
 *   不得补空占位(占位会在 RRF 里凭空加分)。
 *
 * edges/nodes 由调用方传入(loadGraph 结果,百~千量级全扫即可;>2k 再考虑预建索引,
 * 见文件头演进阶梯)。族过滤不在本函数:邻居节点可跨族,兜底在 graphLane 尾部的
 * 记录级 family/scope 双闸(宁可漏不可串落在记录上)。
 */
export function expandHitRecordIds(hits, nodes, edges, opts) {
    const asOf = typeof opts?.asOf === 'string' && opts.asOf.length > 0 ? opts.asOf : undefined;
    const seen = new Set();
    const out = [];
    const take = (id) => {
        if (seen.has(id))
            return;
        seen.add(id);
        out.push(id);
    };
    // 直连段(节点身份来源在前,有效 facts 在后;task_5.2:asOf 下额外纳入当时成立的 superseded fact)
    for (const h of hits) {
        for (const id of h.node.sourceRecordIds)
            take(id);
        for (const f of h.node.facts) {
            const ok = asOf === undefined ? f.status === 'active' : factValidAtAsOf(f, asOf);
            if (!ok)
                continue;
            for (const id of f.sourceRecordIds ?? [])
                take(id);
        }
    }
    if (edges.length === 0)
        return out;
    // hop 段:可用边的双向邻居 ∉ 命中集,邻居去重,状态需 active|disputed
    // (task_5.2:asOf 下"当时成立"的 superseded 边也可回链,邻居同理含当时成立的 superseded 节点)
    const hitNodeIds = new Set(hits.map((h) => h.node.id));
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const edgeUsable = (e) => e.status === 'active' || (asOf !== undefined && e.status === 'superseded' && coversInterval(e.validFrom, e.validTo, asOf));
    const neighborUsable = (n) => n.status === 'active' || n.status === 'disputed'
        || (asOf !== undefined && n.status === 'superseded' && coversInterval(n.createdAt, n.updatedAt, asOf));
    const seenNeighbor = new Set();
    const neighbors = [];
    for (const e of edges) {
        if (!edgeUsable(e))
            continue;
        const dirs = [
            [e.fromNodeId, e.toNodeId],
            [e.toNodeId, e.fromNodeId],
        ];
        for (const [self, other] of dirs) {
            if (!hitNodeIds.has(self) || hitNodeIds.has(other) || seenNeighbor.has(other))
                continue;
            const n = nodeById.get(other);
            if (!n || !neighborUsable(n))
                continue;
            seenNeighbor.add(other);
            neighbors.push(n);
        }
    }
    neighbors.sort(byNodeRecency);
    let hopTaken = 0;
    for (const n of neighbors) {
        if (hopTaken >= GRAPH_HOP_RECORD_CAP)
            break;
        for (const id of n.sourceRecordIds) {
            if (seen.has(id))
                continue; // 已被直连段占用:不计入、不吃名额
            if (hopTaken >= GRAPH_HOP_RECORD_CAP)
                break;
            take(id);
            hopTaken++;
        }
    }
    return out;
}
/**
 * 直连段回链(无 hop)——保留 task_9 的原语义形状(既有测试继续钉住);
 * 生产链路一律走 expandHitRecordIds(向量种子并集 + 1-hop)。
 */
export function graphHitRecordIds(hits) {
    return expandHitRecordIds(hits, [], []);
}
/**
 * 图谱节点检索:返回按 score 降序的命中(最多 limit 条;limit 钳制 1~20)。
 * 候选节点 = active | disputed(superseded/archived 不进检索)。
 */
export function searchGraphNodes(nodes, edges, query, limit, opts) {
    const asOf = typeof opts?.asOf === 'string' && opts.asOf.length > 0 ? opts.asOf : undefined;
    const tokens = [...new Set(tokenize(query))];
    const cappedLimit = Math.min(Math.max(Math.floor(limit) || 5, 1), GRAPH_SEARCH_LIMIT_MAX);
    if (tokens.length === 0)
        return [];
    // nodeId → 可用关系词 token 集(先建邻接表,防逐节点全量扫边;
    // task_5.1:asOf 下纳入"当时成立"的 superseded 边)
    const relationTokensByNode = new Map();
    for (const edge of edges) {
        if (edge.status !== 'active'
            && !(asOf !== undefined && edge.status === 'superseded' && coversInterval(edge.validFrom, edge.validTo, asOf)))
            continue;
        let set = relationTokensByNode.get(edge.fromNodeId);
        if (!set) {
            set = new Set();
            relationTokensByNode.set(edge.fromNodeId, set);
        }
        for (const t of tokenize(edge.relation))
            set.add(t);
        let set2 = relationTokensByNode.get(edge.toNodeId);
        if (!set2) {
            set2 = new Set();
            relationTokensByNode.set(edge.toNodeId, set2);
        }
        for (const t of tokenize(edge.relation))
            set2.add(t);
    }
    const results = [];
    for (const node of nodes) {
        // 候选状态闸保持 active|disputed:task_5.1 的放宽面在 **fact/边**("纳入 superseded 且
        // 区间覆盖 T 的 fact/edge")——GraphNode 没有 valid 区间列,节点主体复活无判据；
        // 历史实体经"当时成立边"的邻居回链(task_5.2)重新可达,不需要翻状态。
        if (node.status !== 'active' && node.status !== 'disputed')
            continue;
        const fieldTokens = {
            name: new Set(tokenize(node.name)),
            aliases: new Set(node.aliases.flatMap((a) => tokenize(a))),
            tags: new Set((node.tags ?? []).flatMap((t) => tokenize(t))),
            currentState: new Set(tokenize(node.currentState)),
            facts: new Set(node.facts
                .filter((f) => (asOf === undefined ? f.status === 'active' : factValidAtAsOf(f, asOf)))
                .flatMap((f) => tokenize(`${f.key} ${factValueText(f.value)}`))),
            relations: relationTokensByNode.get(node.id) ?? new Set(),
            type: new Set(tokenize(node.type)),
        };
        let score = 0;
        const matchedFields = [];
        const matchedTokens = new Set();
        for (const field of FIELD_ORDER) {
            let hits = 0;
            for (const t of tokens) {
                if (fieldTokens[field].has(t)) {
                    hits++;
                    matchedTokens.add(t);
                }
            }
            if (hits > 0) {
                score += GRAPH_FIELD_WEIGHTS[field] * hits;
                matchedFields.push(field);
            }
        }
        // 无命中跳过;仅关系词命中 = 邻接噪声,过滤丢弃(type-only 保留)
        if (matchedFields.length === 0)
            continue;
        if (matchedFields.length === 1 && matchedFields[0] === 'relations')
            continue;
        const matchReason = `命中${matchedFields.map((f) => FIELD_LABELS[f]).join('/')}「${[...matchedTokens].slice(0, 4).join('、')}」`;
        results.push({ node, score, matchedFields, matchReason });
    }
    results.sort((a, b) => b.score - a.score || (a.node.updatedAt < b.node.updatedAt ? 1 : a.node.updatedAt > b.node.updatedAt ? -1 : a.node.id < b.node.id ? -1 : 1));
    return results.slice(0, cappedLimit);
}
