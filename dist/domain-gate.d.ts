/** 8 条域锚文本(单一事实源):一段描述该域典型内容的短文本,供向量化。
 *  keywords 是嵌入关闭时的关键词降级匹配词表(命中任一 = 该域相关)。 */
export declare const WING_ANCHORS: ReadonlyArray<{
    id: string;
    anchor: string;
    keywords: readonly string[];
}>;
/** 软门禁权重下界:相关度 0 的域仍保留 0.4 的权重(降权而非消失——不硬排除)。 */
export declare const WING_GATE_WEIGHT_FLOOR = 0.4;
/** 无偏置权重(降级到头/无信号时全域恒 1,零干预)。 */
export declare const WING_GATE_NEUTRAL = 1;
export type DomainGateSource = 'embedding' | 'keyword' | 'none';
export interface DomainGateResult {
    /** 8 个域的召回权重(0.4~1;none 时全 1)。可解释:逐域读出。 */
    weights: Record<string, number>;
    source: DomainGateSource;
}
/** 余弦相似度(向量长度不等/零向量 → 0)。 */
export declare function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number;
/** 嵌入路径:查询向量 × 8 条锚向量 → 每域相关度(余弦 clamp 到 [0,1])→ 权重。 */
export declare function weightsFromVectors(queryVec: ArrayLike<number>, anchorVecs: ReadonlyArray<ArrayLike<number>>): Record<string, number>;
/** 关键词降级路径:查询文本命中某域任一关键词 → 该域权重 0.75;全无命中 → null(无偏置)。 */
export declare function weightsFromKeywords(query: string): Record<string, number> | null;
/**
 * 软门禁主入口(降级阶梯在此收敛)。`embed` 返回 undefined = 嵌入不可用。
 * 锚向量由调用方缓存后传入(`anchorVecs` 与 WING_ANCHORS 等长;缺省 = 嵌入路径不可用)。
 */
export declare function domainGate(query: string, embed?: {
    queryVec?: ArrayLike<number>;
    anchorVecs?: ReadonlyArray<ArrayLike<number>>;
}): DomainGateResult;
export declare function neutralWeights(): Record<string, number>;
/** 命中域归属:记录的 metadata.hall;未打标/兜底值返回 null(取中性权重)。 */
export declare function domainOfWing(hall: unknown): string | null;
/** 权重的可读日志形态(每次召回可解释:8 个域权重逐个读出)。 */
export declare function formatWeights(weights: Record<string, number>): string;
/** 归一化会话级域权重(拖动角点的写入面):只认 8 角 id,数值 clamp 到 [0, MAX],
 *  非数字/非法 id 一律丢弃;结果为空对象时返回 undefined(= 无用户偏置,不写盘)。 */
/** 手动挡硬过滤(纯函数,回归锚点):锁定集(多选,命中任一)= 只留锁定域;
 *  未打标/跨域按边界开关放行。验证口径:单主题咨询下其他域记忆零注入。 */
export declare function hardFilterByWingLock<T extends {
    id: string;
}>(hits: readonly T[], wingOf: (id: string) => unknown, locks: readonly string[], includeUnlabeled: boolean, includeGeneral: boolean): T[];
/** 软门禁加权排序(纯函数,回归锚点):按域权重降序(同权重按原相关度 score 降序)。
 *  低相关域被降权而非消失——排序 + 预算截断实现"每域配额",不硬排除。 */
export declare function sortByDomainWeight<T extends {
    id: string;
    score: number;
}>(hits: readonly T[], wingOf: (id: string) => unknown, weights: Record<string, number>): T[];
/**
 * G1 使用场景细排(纯函数、**score 不改写**、默认关时不进此路径):
 * 命中查询词的 usageScenario 记忆上浮；未命中/无场景的记录保持原序(fail-open)。
 * 保守：只按“命中强度”重排，不引入新相关性判断；无查询词时原样返回。
 */
export declare function sortByUsageScenario<T extends {
    id: string;
}>(hits: readonly T[], scenariosOf: (id: string) => readonly string[], query: string): T[];
/**
 * 人工打分参与排序（纯重排、**score 不改写**）：4/5 上浮、0/1/2 下沉。
 *
 * 三条约束：
 * - 同档内保持进入顺序（稳定排序），所以不会推翻 scopeFence / 场景细排的结果；
 * - **未打分与 3 分同为中性**（fail-open），全部未打分时输出与输入逐字同序；
 * - 判据是**最近一笔**而非均值——用户改主意的路径必须存在（先 5 后 0 应当下沉）。
 */
export declare function sortByHumanMark<T extends {
    id: string;
}>(hits: readonly T[], markOf: (id: string) => number | undefined): T[];
