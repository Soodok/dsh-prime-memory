/** 名字干长度上限（字符）。取正文首行的前若干字，够认、够短、能在面板里读。 */
export declare const NAME_MAX = 24;
/**
 * 正文 → 名字干。
 *
 * 规则：取**首个非空行**（跳过 markdown 的 `#`/`>`/`-`/`*` 前缀符号）→ 截断到
 * {@link NAME_MAX} → 过 `sanitizeFilename` 的同一套字符纪律 → 剥掉它补的 `.md`。
 * 正文为空、或整行都是标点（洗完全空）→ 返回 `''`，调用方按"没有名字"处理
 * （投射器回落到 `mem-<id8>`），**不**在这里编一个看起来像名字的东西。
 *
 * @param content - 记忆正文。
 * @returns 文件名安全的名字干；无可用文字时 `''`。
 */
export declare function deriveName(content: string): string;
/**
 * 校验一个**人给的**名字是否可用（形状，不含唯一性）。
 *
 * 人从面板或 md 文件里改名字时，先过这道形状闸再谈唯一性：形状不合就拒，
 * 比"收下然后写不出文件"好。返回归一后的名字（可能与入参不同：洗掉了非法字符）。
 *
 * @param raw - 用户给的名字。
 * @returns `{ ok: true, name }` 或 `{ ok: false, reason }`。
 */
export declare function normalizeName(raw: string): {
    ok: true;
    name: string;
} | {
    ok: false;
    reason: string;
};
