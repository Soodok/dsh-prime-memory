/** MMF v1.1 默认列序（缺 `#cols=` 时按此解析；v1 包缺 vf/vt/st 列按 -/-/? 补齐）。 */
export declare const DEFAULT_COLS: readonly ["type", "created", "updated", "vf", "vt", "st", "cf", "rw", "tags", "content"];
/** 类型码 → 运行时 type（与 memport.py TYPE_CODES 一字不差）。 */
export declare const TYPE_CODES: Record<string, string>;
/** 持续性取值域：p 时点 / s 已结束区间 / o 仍在持续 / t 无时间性 / ? 未判定。 */
export declare const PERSISTENCE: readonly ["p", "s", "o", "t", "?"];
export interface MemRecord {
    seq: number;
    type: string;
    typeFull: string;
    created: string;
    updated: string;
    vf: string;
    vt: string;
    st: string;
    cf: string;
    rw: string;
    tags: Record<string, string>;
    content: string;
    hash: string;
    createdMs: number | null;
    createdPrec: string;
    updatedMs: number | null;
    updatedPrec: string;
    vfMs: number | null;
    vfPrec: string;
    vtMs: number | null;
    vtPrec: string;
}
export interface Bundle {
    header: Record<string, string>;
    cols: string[];
    records: MemRecord[];
    errors: string[];
    warnings: string[];
    declaredCount: number | null;
    declaredSha: string | null;
    /** 记录体原始行（未去转义），用于校验和复算——与 Python `body` 对齐。 */
    bodyLines: string[];
}
/** NFKC + 空白折叠 + 去首尾（用于哈希与相似度，不改原文）。 */
export declare function normText(s: string): string;
/**
 * 内容哈希：sha256(normText + 小写)[:16]。
 * 注意：Python 用 casefold（激进大小写折叠），JS 用 toLowerCase；
 * 对 CJK/ASCII 记忆正文等价，仅极端 Unicode 有别——实际记忆集不含此类，
 * 跨实现金标准走包级 sha256（不逐条折叠），不受影响。
 */
export declare function contentHash(s: string): string;
/** 记录稳定 id：`mp_` + sha256(src|chash)[:16]。 */
export declare function recordId(src: string, chash: string): string;
/** 解码内容列：反斜杠+反斜杠 → 单反斜杠；反斜杠+n → 换行（其余反斜杠原样）。 */
export declare function unescapeContent(s: string): string;
/**
 * 编码内容列：反斜杠 → 双反斜杠、CRLF → LF、LF → 反斜杠+n。
 * 用 charCode 常量而非控制字符字面量，避免跨工具写盘时 CR/LF 被吞进正则/字符串字面量。
 */
export declare function escapeContent(s: string): string;
/** `k:v;k:v` → 对象（缺冒号的段忽略）。 */
export declare function parseTags(raw: string): Record<string, string>;
/** 时间串 → { ms|null, precision }（镜像 Python parse_time；naive 视为本地）。 */
export declare function parseTime(raw: string): {
    ms: number | null;
    precision: string;
};
/**
 * 解析整包文本 → Bundle（含结构校验）。镜像 memport.py parse_bundle。
 * 入参是字符串（调用方读文件时自带编码处理）；此处容错剥离 BOM。
 */
export declare function parseBundle(text: string): Bundle;
