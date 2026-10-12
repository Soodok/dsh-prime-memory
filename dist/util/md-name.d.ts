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
/** 名字没洗出可用字符时的回落干：`mem-<id 后 8 位>`。 */
export declare function fallbackStem(id: string): string;
/**
 * 给一个名字求**全库唯一**的落名：基底 → `基底-2` → `基底-3` → … → 回落名。
 *
 * 为什么必须在这里消歧，而不是“谁先到谁写”：`deriveName` 只取正文首行前 24 字，
 * 同一段话的多条记录必然洗出同一个名字。真机实测 1166 条里 42 条挤进 17 个同名
 * 文件（最狠一个路径 6 条），后果是导出每轮都把被覆盖的那几条重写一遍（面板上那个
 * 永远不归零的「已写 9」）、而反向同步会把一份内容回灌给六条记录。
 *
 * 分配本身只取决于“基底 + 已占用集”，因此**调用方必须按 id 排序后再分配**：
 * 同一个基底碰上同一次分配时，谁先谁拿到裸名——顺序不钉死的话，两次导出会给同一条
 * 记录分到不同名字，文件在盘上跳来跳去。后缀要留位置：总长不超过 {@link NAME_MAX}，
 * 宁可截基底也不让它超长。
 *
 * @param base - 基底名（通常是 `deriveName(content)`，可以为空）。
 * @param id - 记录 id，基底不可用时落回 `mem-<id8>`。
 * @param isFree - 库侧查询：这个名字没被**其它**记录占着。
 * @param reserved - 本轮已分配出去的名字（调用方逐次加入，函数也会自己加）。
 * @returns 可用的名字；实在找不到就把 `id` 的回落名加上数字尾巴交出去（仍进 reserved）。
 */
export declare function allocUniqueName(base: string, id: string, isFree: (name: string) => boolean, reserved: Set<string>): string;
