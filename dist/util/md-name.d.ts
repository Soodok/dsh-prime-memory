/**
 * 入库闸门的长度上限（字符）。人/模型**有意给**的名字允许到这里。
 *
 * 历史：24 → 28 → **40**。放宽的理由不是“名字长点好看”，是**计数把 ASCII 与汉字同价**：
 * 本项目记忆标题里 `dsh-agent-teams`、`Python-3.13`、`NeatDownloader` 这类标识符很常见，
 * 一个词就吃掉 13–16 个额度，于是语义上只有一两个词的正当名在字符上“超长”
 * （真机 13 条 fallback 里 3 条属此类）。28 的代价不是难看，是把已经拿到的语义丢掉重算。
 * 仍钉在 40 而不是更松：投射路径要留在 Windows `MAX_PATH` 里，而且超过 40 的名
 * 几乎必然是句子而不是标题。
 */
export declare const NAME_MAX = 40;
/**
 * 规则兜底名（{@link deriveName}）的截断上限，**故意比闸门紧**。
 *
 * 两者不能合为一个数（实测过：统一放 40 后，`buildTurnCompactSystemPrompt` 会拖出
 * 「负责组装每一轮的系统提示」这种句子尾巴）：`deriveName` 吃的是**叙述句**，多给的额度
 * 只会被句子吃掉；而闸门吃的是**人/模型写的标题**，那里长度是语义而不是噪声。
 * 28 仍是兜底名不至于变成句子的上限。
 */
export declare const NAME_CLIP_MAX = 28;
/** 目标区间下界（推荐名短于此偏空），仅作注释性常量，不作硬闸。 */
export declare const NAME_TARGET_MIN = 6;
/** 目标区间上界（推荐名长于此偏啰嗦），仅作注释性常量，不作硬闸。 */
export declare const NAME_TARGET_MAX = 14;
/**
 * 叙述引子表：正文是"谁干了什么"的完整叙述句时，这些前缀只是话头，
 * 占了名字名额却不含信息量（真机坏味「用户要求将-...」「团队已完成-...」即此）。
 * 导出供 `validateTitle` 与 `deriveName` **共用同一份**，两处判据不许漂移。
 */
export declare const NARRATIVE_LEAD_INS: readonly string[];
/**
 * 正文 → 名字干（分段流水线）。
 *
 * 保持签名 `(content) => string` 与"洗不出可用文字返回空串"的承诺。步骤：
 *  1. 标题行优先：正文有 `^#{1,3} ` 行用它，否则取首个非空行；
 *  2. 剥 markdown 前缀；
 *  3. 剥叙述引子（{@link NARRATIVE_LEAD_INS}）连同其后标点/残留话头；
 *  4. 结构边界截断（第一个句读 / 括号 / 反引号 / 路径 / session / uuid 处断开，
 *     括号内整块丢弃——除非主句因此被丢空）；
 *  5. 词元边界收尾：CJK 逐字、ASCII 逐词，绝不切半单词；
 *  6. 截断纪律：过 `sanitizeFilename`，剥尾随 `.` `-` 空格。
 *
 * @param content - 记忆正文。
 * @returns 文件名安全的名字干；无可用文字时 `''`。
 */
export declare function deriveName(content: string): string;
/**
 * 步骤 5：截到 maxLen，且绝不切半 ASCII 单词。
 * 若刚好落在 ASCII 词元中间（末字符与被丢字符都是 `[A-Za-z0-9]`），回删整个残词。
 * CJK 逐字，无需回退。
 *
 * 导出是因为**改名侧也要同一个收梢算法**：模型给的 title 只是超长（`too-long`）时，
 * 按词元边界收一刀仍是好名字，直接回落 `deriveName` 等于把已经拿到的语义扔掉重算。
 * 两处共用一份，截断形状才不会分头演化。
 */
export declare function clipAtTokenBoundary(raw: string, maxLen: number): string;
/**
 * 校验一个**人给的或模型给的**名字是否可用（形状，不含唯一性）。
 *
 * Phase 3 的 few-shot 判据会拿它当门禁，因此签名与 reason 取值必须稳定。
 * 命中任一硬规则即拒；全部通过返回 `{ ok: true, name }`（name 为过字符白名单后的归一值）。
 *
 * @param raw - 候选名字。
 * @returns `{ ok: true, name }` 或 `{ ok: false, reason }`。
 */
export declare function validateTitle(raw: string): {
    ok: true;
    name: string;
} | {
    ok: false;
    reason: string;
};
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
 * 为什么必须在这里消歧，而不是"谁先到谁写"：同一段话的多条记录必然洗出同一个名字。
 * 真机实测 1166 条里 42 条挤进 17 个同名文件（最狠一个路径 6 条），后果是导出每轮都把
 * 被覆盖的那几条重写一遍（面板上那个永远不归零的「已写 9」）、而反向同步会把一份内容
 * 回灌给六条记录。
 *
 * 分配本身只取决于"基底 + 已占用集"，因此**调用方必须按 id 排序后再分配**：
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
