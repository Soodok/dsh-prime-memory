/** 示例集总长预算（字符）。超了就该减条数，而不是悄悄放宽。 */
export declare const FEW_SHOT_BUDGET = 1400;
/** 一条止例：会话片段 → 模型该产出的 title/content 对。 */
interface GoodExample {
    /** 类型（与 G2 骨架同名，方便对照）。 */
    type: string;
    title: string;
    content: string;
}
/**
 * 止例集。每条的 content 都按 G2 骨架写成"前因后果"，title 是它的名词短语摘要。
 *
 * 刻意覆盖到 title 的四种难头：含英文标识符（吃字符额度）、含数字（容易被当 id 残片）、
 * 纯中文短语、以及"主语是团队/用户"的正当名词短语（这几个词作**短语**开头是合法的，
 * 只有叙述引子才算话头）。
 */
export declare const TITLE_GOOD_EXAMPLES: readonly GoodExample[];
/** 反例：模型最常犯的三种错，各给一条"不要这样"。 */
export declare const TITLE_BAD_EXAMPLES: ReadonlyArray<{
    title: string;
    why: string;
}>;
/** 供用例与提示词共用：把止例渲染成"输入 → 输出对象"的示范块。 */
export declare function renderGoodExample(g: GoodExample): string;
/**
 * 追加到抽取系统提示尾部的示例段。
 *
 * 只在 `cfg.naming.fewShot` 为真时拼上（默认关）：它每轮都收固定成本，值不值要靠
 * A/B 的 fallback 率说话，不能靠"看起来更专业"。
 */
export declare const EXTRACTION_FEW_SHOT: string;
/**
 * 各类型的"前因后果"要素表（照 G2 `NARRATIVE_CLAUSE` 写，不另造一套定义）。
 *
 * 为什么需要它：可用性判据是用户定的——"content 没前因后果、写不全就不算可用"。
 * 那句活若只留在提示词里就永远没法判定、也没法拿它定默认值，所以每个类型拆 3 个要素，
 * 每个要素给一组词元（命中任一即算在）。
 *
 * **这是关键词启发式，不是语义判定**：要素换个说法就接不住；G2 自己也允许"信息不足则省略该节"。
 * 因此它只能用于**同一输入下两臂相对比较**，不能当绝对质量分。
 */
export declare const SKELETON_ELEMENTS: Readonly<Record<string, ReadonlyArray<{
    name: string;
    anyOf: readonly string[];
}>>>;
/** 骨架打分结果。 */
export interface SkeletonScore {
    类型: string;
    要素数: number;
    命中数: number;
    缺: string[];
    /** 所有要素都命中（且正文非空）。 */
    齐备: boolean;
    /** 该类型不在要素表里（分数仅供参考，不拿它下结论）。 */
    无表可依: boolean;
}
/**
 * 按类型给 content 打骨架分（关键词启发式，局限见 {@link SKELETON_ELEMENTS}）。
 *
 * @param type - 记忆类型。
 * @param content - 模型产出的正文。
 * @returns 命中情况；空正文算 0 命中而不是"齐备"。
 */
export declare function scoreSkeleton(type: string, content: string): SkeletonScore;
/** 自检：示例本身是否合格（用例直接吃这个函数，不在用例里手抄判据）。 */
export declare function auditFewShot(): {
    超预算: boolean;
    长度: number;
    不合格title: string[];
    抄content开头: string[];
    止例骨架不全: string[];
};
export {};
