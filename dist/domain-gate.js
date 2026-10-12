/**
 * 智能档(中心)的按域软门禁 —— 域相关度驱动的召回权重(D2/R2/N1b)。
 *
 * 机制(findings.md 第七节,单一事实源):
 * 1. 域相关度 = 当前对话查询向量 × 8 条域锚文本向量(余弦,复用既有嵌入源,零额外 LLM);
 * 2. 相关度 → 每域召回权重(软门禁:低相关域降权,**不硬排除**);
 * 3. 降级阶梯:嵌入不可用 → 域标签关键词匹配 → 再退化为无偏置(全 1)。
 *
 * 可解释性:每次召回把 8 个域权重写进日志(可读出),权重计算是纯函数、可回归。
 */
import { WING_FALLBACK } from './types.js';
import { markSignal } from './util/maturity.js';
/** 8 条域锚文本(单一事实源):一段描述该域典型内容的短文本,供向量化。
 *  keywords 是嵌入关闭时的关键词降级匹配词表(命中任一 = 该域相关)。 */
export const WING_ANCHORS = [
    {
        id: 'work',
        anchor: '工作任务、项目进度、代码开发、部署运维、API 设计、供应商对接、客户沟通、团队流程与工程实践',
        keywords: ['项目', '代码', '部署', '接口', 'API', '需求', '上线', 'bug', '版本', '团队', '任务', '测试'],
    },
    {
        id: 'relationships',
        anchor: '人际关系、同事与团队协作、家人朋友、沟通风格、相处方式、情感互动',
        keywords: ['同事', '朋友', '家人', '老板', '客户关系', '沟通', '相处', '聚会', '恋爱', '家庭'],
    },
    {
        id: 'learning',
        anchor: '学习计划、研究课题、技能提升、语言学习、阅读书目、考证备考、课程笔记',
        keywords: ['学习', '课程', '考试', '考证', '阅读', '书', '教程', '练习', '论文', '技能', '复习'],
    },
    {
        id: 'creative',
        anchor: '摄影创作、写作、影视音乐、游戏、兴趣爱好、媒体消费与娱乐活动',
        keywords: ['摄影', '拍照', '写作', '电影', '剧', '音乐', '游戏', '动漫', '兴趣', '娱乐'],
    },
    {
        id: 'home',
        anchor: '居住与居家生活、宠物、日用品采购、证件办理、预约缴费、家政维修',
        keywords: ['房子', '租房', '物业', '宠物', '猫', '狗', '家具', '水电', '证件', '缴费', '快递', '维修'],
    },
    {
        id: 'health',
        anchor: '饮食控制、运动健身、身体状况、睡眠作息、就医问诊、体检与用药',
        keywords: ['健康', '运动', '健身', '睡眠', '体检', '医生', '医院', '药', '饮食', '减肥', '跑步'],
    },
    {
        id: 'finance',
        anchor: '收支记账、预算规划、投资理财、报销流程、消费购物、价格与优惠',
        keywords: ['钱', '预算', '记账', '投资', '基金', '股票', '报销', '发票', '工资', '账单', '购物', '价格'],
    },
    {
        id: 'journey',
        anchor: '旅行计划、行程安排、交通出行、酒店机票、异地活动、签证护照',
        keywords: ['旅行', '旅游', '行程', '航班', '机票', '酒店', '火车', '高铁', '签证', '出行', '景点'],
    },
];
/** 软门禁权重下界:相关度 0 的域仍保留 0.4 的权重(降权而非消失——不硬排除)。 */
export const WING_GATE_WEIGHT_FLOOR = 0.4;
/** 无偏置权重(降级到头/无信号时全域恒 1,零干预)。 */
export const WING_GATE_NEUTRAL = 1;
/** 余弦相似度(向量长度不等/零向量 → 0)。 */
export function cosine(a, b) {
    if (a.length !== b.length || a.length === 0)
        return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
        const x = a[i];
        const y = b[i];
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    if (na === 0 || nb === 0)
        return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
/** 嵌入路径:查询向量 × 8 条锚向量 → 每域相关度(余弦 clamp 到 [0,1])→ 权重。 */
export function weightsFromVectors(queryVec, anchorVecs) {
    const weights = {};
    for (let i = 0; i < WING_ANCHORS.length; i++) {
        const id = WING_ANCHORS[i].id;
        const rel = Math.max(0, Math.min(1, cosine(queryVec, anchorVecs[i])));
        weights[id] = WING_GATE_WEIGHT_FLOOR + (1 - WING_GATE_WEIGHT_FLOOR) * rel;
    }
    return weights;
}
/** 关键词降级路径:查询文本命中某域任一关键词 → 该域权重 0.75;全无命中 → null(无偏置)。 */
export function weightsFromKeywords(query) {
    const lower = query.toLowerCase();
    const weights = {};
    let any = false;
    for (const { id, keywords } of WING_ANCHORS) {
        const hit = keywords.some((k) => lower.includes(k.toLowerCase()));
        weights[id] = hit ? 0.75 : WING_GATE_WEIGHT_FLOOR;
        if (hit)
            any = true;
    }
    return any ? weights : null;
}
/**
 * 软门禁主入口(降级阶梯在此收敛)。`embed` 返回 undefined = 嵌入不可用。
 * 锚向量由调用方缓存后传入(`anchorVecs` 与 WING_ANCHORS 等长;缺省 = 嵌入路径不可用)。
 */
export function domainGate(query, embed) {
    if (embed?.queryVec && embed.anchorVecs && embed.anchorVecs.length === WING_ANCHORS.length) {
        return { weights: weightsFromVectors(embed.queryVec, embed.anchorVecs), source: 'embedding' };
    }
    const kw = weightsFromKeywords(query);
    if (kw)
        return { weights: kw, source: 'keyword' };
    return { weights: neutralWeights(), source: 'none' };
}
export function neutralWeights() {
    const weights = {};
    for (const { id } of WING_ANCHORS)
        weights[id] = WING_GATE_NEUTRAL;
    return weights;
}
/** 命中域归属:记录的 metadata.hall;未打标/兜底值返回 null(取中性权重)。 */
export function domainOfWing(hall) {
    if (typeof hall !== 'string')
        return null;
    return WING_ANCHORS.some((a) => a.id === hall) ? hall : null;
}
/** 权重的可读日志形态(每次召回可解释:8 个域权重逐个读出)。 */
export function formatWeights(weights) {
    return WING_ANCHORS.map(({ id }) => `${id}=${(weights[id] ?? WING_GATE_NEUTRAL).toFixed(2)}`).join(' ');
}
/** 归一化会话级域权重(拖动角点的写入面):只认 8 角 id,数值 clamp 到 [0, MAX],
 *  非数字/非法 id 一律丢弃;结果为空对象时返回 undefined(= 无用户偏置,不写盘)。 */
/** 手动挡硬过滤(纯函数,回归锚点):锁定集(多选,命中任一)= 只留锁定域;
 *  未打标/跨域按边界开关放行。验证口径:单主题咨询下其他域记忆零注入。 */
export function hardFilterByWingLock(hits, wingOf, locks, includeUnlabeled, includeGeneral) {
    return hits.filter((h) => {
        const wing = wingOf(h.id);
        if (typeof wing === 'string' && wing !== '') {
            return locks.includes(wing) || (wing === WING_FALLBACK && includeGeneral);
        }
        return includeUnlabeled;
    });
}
/** 软门禁加权排序(纯函数,回归锚点):按域权重降序(同权重按原相关度 score 降序)。
 *  低相关域被降权而非消失——排序 + 预算截断实现"每域配额",不硬排除。 */
export function sortByDomainWeight(hits, wingOf, weights) {
    const weightOf = (id) => {
        const w = weights[domainOfWing(wingOf(id)) ?? ''];
        return typeof w === 'number' ? w : WING_GATE_NEUTRAL;
    };
    return [...hits].sort((a, b) => weightOf(b.id) - weightOf(a.id) || b.score - a.score);
}
/** 分词(小写、按非字母数字/非 CJK 切、去长度<2 的碎片)。供场景词重叠用。 */
function normTokens(s) {
    return new Set(s.toLowerCase().split(/[^0-9a-z\u4e00-\u9fa5]+/).map((t) => t.trim()).filter((t) => t.length >= 2));
}
/**
 * G1 使用场景细排(纯函数、**score 不改写**、默认关时不进此路径):
 * 命中查询词的 usageScenario 记忆上浮；未命中/无场景的记录保持原序(fail-open)。
 * 保守：只按“命中强度”重排，不引入新相关性判断；无查询词时原样返回。
 */
export function sortByUsageScenario(hits, scenariosOf, query) {
    const q = normTokens(query);
    if (q.size === 0)
        return [...hits];
    const matchOf = (id) => {
        let best = 0;
        for (const s of scenariosOf(id)) {
            let ov = 0;
            for (const t of normTokens(s))
                if (q.has(t))
                    ov++;
            if (ov > best)
                best = ov;
        }
        return best;
    };
    return hits
        .map((h, i) => ({ h, i, m: matchOf(h.id) }))
        .sort((a, b) => b.m - a.m || a.i - b.i)
        .map((x) => x.h);
}
/**
 * 人工打分参与排序（纯重排、**score 不改写**）：4/5 上浮、0/1/2 下沉。
 *
 * 三条约束：
 * - 同档内保持进入顺序（稳定排序），所以不会推翻 scopeFence / 场景细排的结果；
 * - **未打分与 3 分同为中性**（fail-open），全部未打分时输出与输入逐字同序；
 * - 判据是**最近一笔**而非均值——用户改主意的路径必须存在（先 5 后 0 应当下沉）。
 */
export function sortByHumanMark(hits, markOf) {
    return hits
        .map((h, i) => ({ h, i, s: markSignal(markOf(h.id)) }))
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .map((x) => x.h);
}
