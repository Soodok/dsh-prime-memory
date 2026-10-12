import type { MemoryLogger, MemoryRecord } from '../types.js';
/** 允许当目录名的 type 值（与面板 `TYPE_LABELS` 同集合；P4 换类别树时一并改）。 */
export declare const MEMORY_TYPE_DIRS: ReadonlySet<string>;
/**
 * 不在词表的 type 落到这个目录（P4.1 的**默认类**）。
 *
 * 它是**目录层的投影**，不是库内事实：记录自己的 `type` 原值照旧写进 frontmatter，
 * 也绝不回填到 `rowToRecord`/upsert/metadata（F5 红线）。之所以不直接归进某个 `work_*`：
 * 那会把这批无类记录的 `family` 挑到 work 侧，而 family 决定共享面——等于静默改了可见性。
 */
export declare const UNSORTED_DIR = "unclassified";
/** frontmatter 允许出现的键（用例断言键集**恰等于**它，防检索轴泄漏进文件）。 */
export declare const FRONTMATTER_KEYS: readonly string[];
/** 内容指纹长度（12 hex ≈ 48 bit；账本只用来判"变没变"，不当身份用）。 */
export declare const DIGEST_HEX = 12;
/** 失效后缀（N11）：`x.memory.md` → `x.memory.md.disable`。用户定名，取代原设计的 `.outdated`。 */
export declare const DISABLE_SUFFIX = ".disable";
/** workspace 优先时的子目录（N10）：`<workspace>/.agents/memory/…`。 */
export declare const WORKSPACE_SUBDIR: readonly string[];
/**
 * 解析单根（无 workspace 归属的记录落这里）。
 *
 * 给了 `cfgRoot` 就用它（必须绝对路径且不含 `..`），否则默认 `<dataDir>/memories`。
 * **不合法只回退默认并 warn，绝不抛错**：投射是旁路，旁路配置写错不能弄挂记忆本体。
 */
export declare function resolveMemoriesRoot(cfgRoot: string | undefined, dataDir: string, logger?: MemoryLogger): string;
/**
 * 把渲染出的相对路径安全地拼到根下。
 *
 * 越界（绝对路径、`..` 跳出、盘符切换）一律返回 `undefined` 由调用方跳过并 warn——
 * 记录内容是人/模型写的，它可能包含 `../../`，这里必须是结构性挡死而不是"应该不会有"。
 */
export declare function safeJoin(root: string, relPath: string): string | undefined;
/** 一个记录该落到哪。`absPath` 为 `undefined` = 越界，调用方必须跳过而不是写。 */
export interface MdTarget {
    /** 投射根（workspace 根或单根），绝对路径。 */
    root: string;
    /** 相对根的路径（正斜杠），展示与归档分目录用。 */
    relPath: string;
    /** 绝对路径——**账本键与文件操作都用它**。undefined = 越界。 */
    absPath: string | undefined;
    /** 是否落在 workspace 下（区分两个根，面板与归档路径都要看）。 */
    inWorkspace: boolean;
}
/** 渲染一条记录所需的最小字段集（也是算落点所需的全部）。 */
export type MdRecordInput = Pick<MemoryRecord, 'id' | 'content' | 'type' | 'priority' | 'createdAt' | 'updatedAt' | 'metadata' | 'validTo' | 'extKey' | 'name' | 'workspaceId'>;
/**
 * 投射落点（N10）：**workspace 优先**。
 *
 * 有 `workspaceId` ⇒ `<workspace>/.agents/memory/<type>/<stem>.memory.md`；
 * 没有 ⇒ 单根（`cfg.memExport.root` 或 `<dataDir>/memories`）。
 *
 * ⚠️ **导出/对账/失效改名/归档四处必须共用本函数**。库里的 `workspace_id` 在 Windows 上是
 * 小写形态（`normalizeWorkspacePath` 会 `.toLowerCase()`），任何一处自己拼路径、或者自己
 * 转一下大小写，就会把“刚写进去的文件”算成另一个账本键 → 对账永远报“文件缺失”。
 * 同理：**不**在这里做 `fs.realpath` 归一——那会让目录创建前后的键漂移，反而造出假缺失；
 * Windows 路径大小写不敏感，同一逻辑路径的两种写法解析到同一个文件，键自洽即可。
 */
export declare function targetFor(r: MdRecordInput, cfgRoot: string | undefined, dataDir: string, logger?: MemoryLogger): MdTarget;
/**
 * 投射文件的失效路径：`x.memory.md` → `x.memory.md.disable`。
 * 已带后缀的原样返回（幂等靠这个性质，而不是靠调用方记住判重）。
 */
export declare function disablePathOf(absPath: string): string;
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
export declare function renderRecord(r: MdRecordInput): {
    relPath: string;
    text: string;
};
