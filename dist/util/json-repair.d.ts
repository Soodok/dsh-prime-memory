/**
 * 容错 JSON 解析:LLM 输出常带小语法毛刺,一次 JSON.parse 定生死会把整批记忆全丢。
 *
 * 三级链(见 #10):
 *   strict   → 原样 JSON.parse,零回归;
 *   repaired → 字符串态扫描,做四类**只动语法不动内容**的确定性修复:
 *              1) 内容里的裸 ASCII `"` → `\"`(判据:该 `"` 后第一个非空白字符不是 `,` `}` `]` `:` `"` EOF)
 *              2) 字符串里的裸 `\n` `\r` `\t` → 转义
 *              3) `,` 紧跟 `}` `]` 的尾逗号 → 删
 *              4) 结尾未闭合的字符串与括号 → 补齐(对应 finish=length 截断)
 *   salvaged → 整体修不动时按顶层元素边界逐个 parse,保住坏点前后已完整的对象,
 *              尾巴丢掉(不猜)。
 *
 * 修复/救援发生时会带上 `notes`,由调用方决定是否 warn 落盘(便于回溯:修复是兜底不是常态)。
 */
export interface RepairResult<T> {
    value: T;
    /** 命中的档位,便于日志追溯。 */
    level: 'strict' | 'repaired' | 'salvaged';
    /** 修复动作描述,strict 档为空数组。 */
    notes: string[];
}
/**
 * 字符串态扫描修复:只动语法,字段名与值内容字节一个不改。
 * 返回 null 表示扫描中遇到无法处理的结构错误(交给上层救援)。
 */
export declare function repairJson(src: string): {
    out: string;
    notes: string[];
} | null;
/**
 * 顶层逐元素救援:仅当输入是 `[...]` 且整体 parse 失败时启用。
 * 按结构态(非字符串)找顶层逗号,切片成一个个元素,分别 JSON.parse,失败的丢掉。
 */
export declare function salvageTopLevelElements(src: string): {
    items: unknown[];
    dropped: number;
} | null;
/**
 * 预处理:剥 ```json```围栏 + 切到首个 `[`/`{` 直到末尾 `]`/`}`，兼容 LLM 前后附的散文。
 * 与旧版 parseJson 逐字行为一致（零回归）。
 */
export declare function preprocessLLMJson(raw: string): string;
/**
 * 三级容错入口。传入已通过「剥围栏 + 切片」的字符串,返回解析结果与档位说明。
 * 若三级皆失败,抛出 strict JSON.parse 的原始错误。
 */
export declare function parseJsonTolerant<T>(raw: string): RepairResult<T>;
