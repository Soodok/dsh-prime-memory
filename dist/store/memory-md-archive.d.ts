/**
 * P3 归档面：退场批次被物理删除时，把它的人类可读归档正文与投射文件一起收进**快照目录**。
 *
 * 两个刻意的决定：
 *
 * ① **归档不另起目录树，就住在快照目录里**（`<dataDir>/snapshots/<name>/`）。计划里原本写
 *    `<dataDir>/archives/<name>/`，但那样一次清理就有两个"批次"事实源（快照一份、归档一份），
 *    名字对不上时没人能回答"这批到底删了什么"。住在一起之后：`manifest.json` 是库内容快照、
 *    `retired.md` 是给人读的归档正文、`files/` 是搬进来的投射文件——同一个批次名寻址，
 *    `snapshot-restore` 天然还能用得上。名字白名单也因此**直接继承** `isSnapshotName`
 *    （长度上限 / 固定前缀 / 禁 `/ \ ..`），不需要再造一个 `isArchiveName`，更不吃调用方的绝对路径。
 *
 * ② **搬运在物理删除之后**，且失败只 warn。库删了是既成事实，文件留在原地是可修的不对称
 *    （下一次导出会按 `retired` 把它们重写回去）；反过来先搬文件再删库，一旦删除中止就变成
 *    "记录还活着、文件已经不见了"，那才是真的说不清。
 */
import type { MemoryLogger, MemoryRecord } from '../types.js';
/** 归档正文文件名（人在归档目录里第一个该看见的东西）。 */
export declare const ARCHIVE_MD = "retired.md";
/** 投射文件在归档里的落点子目录。 */
export declare const ARCHIVE_FILES_DIR = "files";
/** 一次清理的归档元信息。 */
export interface ArchiveMeta {
    /** 批次原因（`cleanup-retired` / `pre-rebuild`）。 */
    reason: string;
    /** 归档时刻。 */
    at: Date;
    /** 操作者可选附的一句话（进正文头部，不参与任何判据）。 */
    note?: string;
}
/** 一个磁盘上真实存在的投射文件（侧别在收集时就算好，搬运时不猜）。 */
export interface ProjectionFile {
    absPath: string;
    /** 落在 workspace 根下（true）还是单根下（false）——N10 同一个 `targetFor` 的结论。 */
    inWorkspace: boolean;
}
/** 记录 id → 该记录在磁盘上真实存在的投射文件（含 `.disable` 兄弟）。 */
export type FilesByRecord = ReadonlyMap<string, ProjectionFile[]>;
/** 归档搬运的结果（进清理响应，便于人核对"文件到底动没动"）。 */
export interface ArchiveFileOutcome {
    moved: number;
    failed: number;
    /** 该记录在磁盘上没有投射文件（没开过投射/从没导出过）。 */
    absent: number;
}
/**
 * 收集这批记录在磁盘上存在的投射文件。
 *
 * 只 `stat`，不读内容——归档要的是"把原物搬走"，不是"按当前库重渲染一份"。
 *
 * @param records - 待清理的记录（已退场那批）。
 * @param cfgRoot - `cfg.memExport.root`。
 * @param dataDir - 插件数据目录。
 * @param logger - 宿主日志接口。
 * @returns `recordId → 文件[]`；没有任何文件时返回**空 Map**（调用方据此走旧行为）。
 */
export declare function collectProjectionFiles(records: readonly MemoryRecord[], cfgRoot: string | undefined, dataDir: string, logger?: MemoryLogger): Promise<FilesByRecord>;
/**
 * 渲染归档正文：按 `type` 分片的单一 Markdown，每条一节。
 *
 * frontmatter 与投射文件同构（同一份 `renderRecord`），只往里插两行退场信息——这样
 * "归档里读到的"和"当初磁盘上的"是同一个形状，人不需要在两套元数据格式之间换算。
 */
export declare function renderArchiveMarkdown(records: readonly MemoryRecord[], meta: ArchiveMeta): string;
/**
 * 写归档正文。失败**抛出**：正文是这批数据的唯一人可读物，写不成得让调用方知道
 * （搬运失败则相反——那只影响便利度，不影响事实）。
 */
export declare function writeArchiveMarkdown(dir: string, records: readonly MemoryRecord[], meta: ArchiveMeta): Promise<string>;
/**
 * 把这批记录的投射文件搬进归档目录。
 *
 * 目标形状 `<归档根>/files/<ws|home>/<type>/<原文件名>`（自顶向下建目录）。失败只计数并
 * 留痕——绝不因为文件搬不动而回滚库删除（不对称的方向是"文件可重生成，库删了不可逆"）。
 *
 * @param dir - 归档根（= 快照目录）。
 * @param records - 该批记录（用 id 与 `files` 配对）。
 * @param files - `collectProjectionFiles` 的产物。
 * @param logger - 只需要 warn（清理侧的 logger 形状比 MemoryLogger 狭，这里不装宽）。
 * @returns 搬运计数。
 */
export declare function moveProjectionFiles(dir: string, records: readonly MemoryRecord[], files: FilesByRecord, logger?: {
    warn: (m: string) => void;
}): Promise<ArchiveFileOutcome>;
