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
/** 自检：示例本身是否合格（用例直接吃这两个函数，不另抄一份判据）。 */
export declare function auditFewShot(): {
    超预算: boolean;
    长度: number;
    不合格title: string[];
    抄content开头: string[];
};
export {};
