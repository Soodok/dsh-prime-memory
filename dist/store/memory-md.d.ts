import type { MemoryRecord } from '../types.js';
/** 允许当目录名的 type 值（与面板 `TYPE_LABELS` 同集合；P4 换类别树时一并改）。 */
export declare const MEMORY_TYPE_DIRS: ReadonlySet<string>;
/** 不在白名单的 type 落到这个目录（旧库/异常值不至于写不出文件，也不污染目录树）。 */
export declare const UNSORTED_DIR = "unsorted";
/** frontmatter 允许出现的键（用例断言键集**恰等于**它，防检索轴泄漏进文件）。 */
export declare const FRONTMATTER_KEYS: readonly string[];
/** 内容指纹长度（12 hex ≈ 48 bit；账本只用来判"变没变"，不当身份用）。 */
export declare const DIGEST_HEX = 12;
/**
 * 内容指纹。
 *
 * 刻意**不复用** `memport/format.ts` 的 `contentHash`：那个口径被 TS↔Python 跨实现
 * 金标准锁死（`tests/memport-ts-consistency`），改了就是让两边算出不同的包。这里只
 * 借它的 `normText`（NFKC + 换行归一），口径独立、且明确标注为"投射账本专用"。
 */
export declare function digest(text: string): string;
/** 记录内容指纹：正文字段（不含 metadata——轴变了不算内容变）。 */
export declare function recordDigest(r: Pick<MemoryRecord, 'content'>): string;
/**
 * 文件名干：有 `name` 用 `name`；没有则回落 `mem-<id 后 8 位>`。
 *
 * 回落是**必需**的：存量记录 name 恒空（零回填红线），不回落就没法投射第一批。
 * id 每轮新铸，所以回落名不稳定——这正是 P0 要先做 `name` 的原因，注释留在这里
 * 免得后来人以为"回落名也能双向"。
 */
export declare function fileStemFor(r: Pick<MemoryRecord, 'id' | 'name' | 'content'>): string;
/**
 * 渲染一条记录。
 *
 * @param r - L1 记录（含已退场的——退场也要有投影，否则人在文件树里看不到它）。
 * @returns `relPath`（相对投射根，已归一分隔符）与 `text`（全文）。
 */
export declare function renderRecord(r: MemoryRecord): {
    relPath: string;
    text: string;
};
