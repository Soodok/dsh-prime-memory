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
    /** 文件声明的正文指纹（`hash` 键原文）；空串 = 老文件没带（未签名）。 */
    hash: string;
    /**
     * 声明指纹与正文实算的比对：`true` 一致、`false` 不符、`undefined` = 文件没声明（无从判）。
     *
     * `false` **不是**拒收理由：正文被人改过恰恰是 P2 要回灌的正常输入；它只说明「文件不是
     * 我们上次写出去的那份字节」，交给调用方计入报告并重盖指纹。结构性拒收仍在更上面
     * （形状不符 / 正文为空）。
     */
    hashValid: boolean | undefined;
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
