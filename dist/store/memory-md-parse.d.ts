/**
 * md 投射文件的解析（P2 反向同步的读侧）。
 *
 * 只认 `memory-md.ts` 自己渲染出来的那种 frontmatter：`key: <JSON 值>`，正文在第二个
 * `---` 之后。**不做通用 YAML**——通用解析器会接受我们从不产出的形状，那些形状进到
 * 回灌路径就是"看起来能读、读回来是垃圾"。解析不出来就返回 `undefined`，调用方跳过并
 * 计数；绝不猜、绝不抛。
 *
 * 一条刻意的不对称：文件里的 `id` 只当**线索**，不当身份。id 每轮新铸（F1），一次合并
 * 就换；真正认人靠账本键（绝对路径）与 `name`。
 */
/** 解析出的文件形状（值已按渲染时的类型还原）。 */
export interface MdParsed {
    /** 文件名干（= 渲染时写入的 `name` 键）。 */
    name: string;
    type: string;
    priority: number;
    /** ISO 串（渲染时就是 ISO；空串 = 没有）。 */
    createdAt: string;
    updatedAt: string;
    usageScenario: string[];
    extKey: string;
    /** 文件里记的 record_id，只当线索。 */
    id: string;
    /** frontmatter 带 `retired: true`。 */
    retired: boolean;
    /** 正文（已去首尾空白）。 */
    content: string;
}
/**
 * 解析一个投射文件。
 *
 * @param text - 文件全文。
 * @returns 解析结果；形状不符（无 frontmatter / 无正文 / 键全不认识）时 `undefined`。
 */
export declare function parseMdFile(text: string): MdParsed | undefined;
