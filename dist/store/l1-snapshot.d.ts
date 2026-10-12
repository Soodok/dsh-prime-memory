import { type ArchiveFileOutcome, type FilesByRecord } from './memory-md-archive.js';
import type { MemoryLogger, MemoryRecord } from '../types.js';
import type { ConflictPair } from './conflicts.js';
export declare const SNAPSHOT_VERSION = 1;
/** 快照里的一节:行数 + 内容哈希。哈希是"内容有没有变"的判据,行数看不出来。 */
export interface SnapshotSection {
    count: number;
    hash: string;
}
/** 快照清单(可追溯:什么时候、为什么、各节多大)。 */
export interface L1SnapshotManifest {
    version: 1;
    createdAt: string;
    /** 为什么建这份快照(如 `pre-rebuild`),便于事后定位。 */
    reason: string;
    sections: {
        records: SnapshotSection;
        receipts: SnapshotSection;
        conflicts: SnapshotSection;
    };
    /** `l1_vec` 行数(只记数:它是派生投影,可重算,不落快照)。 */
    vecCount: number;
}
/** 快照目录名:`l1-<时间戳>-<原因>`。**时间戳在前**,目录自然按时间排序。 */
export declare function snapshotDirName(createdAt: Date, reason: string): string;
/** 快照目录的绝对路径(与既有 `pendingPathFor` / `reconcileStatePathFor` 同风格)。 */
export declare function snapshotPathFor(dataDir: string, createdAt: Date, reason: string): string;
/** 快照的**存放根**(所有 `snapshotPathFor` 产物都在它下面)。 */
export declare function snapshotsRootFor(dataDir: string): string;
/** 目录路径 → 目录名(与 `snapshotDirFor` 互为逆运算;兼容 `/` 与 `\`)。 */
export declare function snapshotNameOf(dir: string): string;
/**
 * 目录名是否是可寻址的快照名。
 *
 * **只接受"名字",不接受路径**——这是恢复入口的第一道门。若允许调用方传路径,
 * 恢复就变成了"把任意目录里的 JSON 灌进记忆库",而这条 RPC 的信任级别只到
 * "本机同用户",不该顺带获得读任意目录并把内容写进检索库的能力。
 * 故:长度受限、必须带 `l1-` 前缀(与 `snapshotDirName` 的产物一致)、
 * 且不含路径分隔符与 `..`。
 */
export declare function isSnapshotName(name: string): boolean;
/** 名字 → 绝对路径(仅当名字合法;否则返回 `undefined`,由调用方拒绝)。 */
export declare function snapshotDirFor(dataDir: string, name: string): string | undefined;
/** 一份可用快照的摘要(面板 / 工具选哪份来恢复)。 */
export interface SnapshotSummary {
    /** 目录名(恢复时传它,不传路径)。 */
    name: string;
    dir: string;
    createdAt: string;
    /** 建这份快照的原因(如 `cleanup-retired` / `pre-rebuild`)。 */
    reason: string;
    records: number;
    receipts: number;
    conflicts: number;
    /** `l1_vec` 行数(派生投影,只记数)。 */
    vecCount: number;
}
/**
 * 列出可用快照(按时间**倒序**:最新的在前)。
 *
 * 只认**带合法清单**的目录:清单缺失或版本不符的目录不算快照(半截写入的产物
 * 不能出现在"选一份来恢复"的列表里,否则人会选中一份根本恢复不了的东西)。
 * 目录不存在**不抛**,返回空列表——"还没建过快照"是部署状态,不是调用错误。
 */
export declare function listSnapshots(dataDir: string, opts?: {
    limit?: number;
    logger?: MemoryLogger;
}): Promise<{
    items: SnapshotSummary[];
    total: number;
}>;
/** 稳定内容哈希(与 `canonicalRecords` 配套:同内容恒同哈希)。 */
export declare function hashRecords(records: readonly MemoryRecord[]): string;
/** 任意对象的内容哈希(用于 receipts / conflicts 这类外来形状)。 */
export declare function hashJson(value: unknown): string;
/** `MemoryDb` 里本模块用到的最小面(便于单测注入)。 */
export interface SnapshotDbLike {
    listL1: (opts: {
        limit: number;
        offset: number;
    }) => {
        items: readonly MemoryRecord[];
        total: number;
    };
    countReceipts: (opts: Record<string, never>) => number;
    listReceipts: (opts: {
        limit: number;
    }) => readonly unknown[];
    countConflictPendingUnresolved: () => number;
    listConflictPending: (opts?: {
        limit?: number;
    }) => readonly ConflictPair[];
    countL1Vec: () => number;
    upsertL1: (record: MemoryRecord, embedding?: Float32Array) => boolean;
}
/** 分页取全量 L1(一次 500,避免大库一次性拉爆内存)。 */
export declare function listAllL1(db: SnapshotDbLike, hardLimit?: number): MemoryRecord[];
export interface CreateSnapshotResult {
    dir: string;
    /** 目录名——`snapshot-restore` 的寻址口径(调用方不必自己切路径)。 */
    name: string;
    manifest: L1SnapshotManifest;
    records: readonly MemoryRecord[];
}
/**
 * 建快照。**在任何清空动作之前调用。**
 *
 * @param db - 记忆库。
 * @param dir - 快照目录(调用方用 `snapshotPathFor` 生成)。
 * @param reason - 建快照的原因(写进清单,可追溯)。
 * @param now - 注入时钟(单测用)。
 */
/**
 * 冻结历史输入的**列投影**(task_2.8)。
 *
 * 为何需要它:`conflict_pending` 在 Phase 2/3 会新增列(`reviewed_at` / `deferred_at` /
 * `defer_count`,以及 Phase 3 的 `conflict_type` / `claim_key`)。而快照 manifest 里的
 * `sections.conflicts.hash` 是 `hashJson(listConflictPending())`——**投影一扩,哈希输入就变**,
 * 于是**升级前写下的旧快照会永久失配**,`exportThenPurge` 每次都中止在"内容与快照不一致"。
 *
 * 判据(第 3 轮复查 R3-N1,**必须逐字段复刻升级前 `toConflictPair` 的输出**):
 * 7 字段、**camelCase**、固定键序
 * `pairId → runId → winnerId → loserId → createdAt → resolvedAt → resolution`,
 * 仅剔除新增列。**不是**"另挑参与语义的列"——兼容性要求的是**冻结旧输入**:
 * 漏 `runId`、或改成 snake_case,都会让新旧哈希不等,于是
 * 「旧快照仍通过」这件事**不可达**。
 *
 * 机械护栏:`tests/l1-snapshot.test.ts` 的 `GOLDEN_CONFLICTS_HASH`(取自升级前实跑),
 * 且该用例做过反向验证(漏 `runId` / 改 snake_case ⇒ 必红)。
 */
export declare function projectConflictsForHash(rows: readonly ConflictPair[]): Array<Record<string, unknown>>;
export declare function createL1Snapshot(db: SnapshotDbLike, dir: string, reason: string, now?: Date): Promise<CreateSnapshotResult>;
/**
 * 读快照清单。
 *
 * **读侧分类**(文件层加固 T2.7):
 * - 缺失 / 版本不符 → `undefined`(沿用既有"这份快照不可用"的语义);
 * - **损坏 / 不可读 → 抛错**:旧实现把损坏也压成 `undefined`,于是"清单坏了"和
 *   "没有清单"在调用方眼里一样——恢复时会选中一个半截快照却报 0 条成功。
 */
export declare function readSnapshotManifest(dir: string): Promise<L1SnapshotManifest | undefined>;
/**
 * 读回快照里的记录(与 `createL1Snapshot` 的写入格式必须成对)。
 *
 * **损坏不再返回空数组**:空数组会让"记录文件坏了"表现成"这份快照有 0 条记录",
 * 恢复下去就是静默丢数据。缺文件同样抛错——建快照时正文与清单是成对写入的,
 * 只缺其一说明这份快照本身不完整。
 */
export declare function readSnapshotRecords(dir: string): Promise<MemoryRecord[]>;
/** 快照与当前库的差异。 */
export interface SnapshotVerification {
    ok: boolean;
    diffs: string[];
}
/** 比对快照与当前库(**按内容哈希**,不是按行数)。 */
export declare function verifySnapshot(db: SnapshotDbLike, dir: string): Promise<SnapshotVerification>;
export interface RestoreResult {
    /** 快照里的记录总数(按 `ids` 过滤**之前**)。 */
    inSnapshot: number;
    /** 本次实际要恢复的条数(过滤**之后**)。 */
    targets: number;
    restored: number;
    failed: number;
    /** 成功补上向量的条数(未提供 `vectorize` 时恒为 0)。 */
    vectorsWritten: number;
    /** 请求了但快照里没有的 id(仅传 `ids` 时可能非空)。 */
    notFound: string[];
}
export interface RestoreOptions {
    /** 日志出口(缺省静默)。 */
    logger?: {
        info: (m: string) => void;
        warn: (m: string) => void;
    };
    /** 只恢复这些 id;省略 = 快照内全部。 */
    ids?: readonly string[];
    /**
     * 可选向量补算钩子。
     *
     * 为何是**注入的函数**而不是直接 import 嵌入模块:快照模块刻意不依赖嵌入栈
     * (见模块头——`l1_vec` 是派生投影,不落快照)。把向量能力做成参数,单向依赖
     * 就保住了:快照模块提供"从 JSON 回到检索库"的事实,调用方提供"怎么算向量"。
     * 实现方在嵌入不可用时应返回 `undefined` 而**不是抛**——见 `restore` 的同款理由。
     */
    vectorize?: (records: readonly MemoryRecord[]) => Promise<readonly (Float32Array | undefined)[]>;
}
/** 干跑结论:这份快照恢复下去**会发生什么**(不写库)。 */
export interface SnapshotRestorePlan {
    name: string;
    /** 解析出的绝对路径;名字非法或清单缺失时为空串。 */
    dir: string;
    /** 这个名字是否指向一份**真实存在且清单合法**的快照。 */
    found: boolean;
    inSnapshot: number;
    /** 本次实际要恢复的条数(按 `ids` 过滤后)。 */
    targets: number;
    /** 其中当前**不在库**的条数——这才是真正被找回的条数。 */
    missing: number;
    /**
     * 目标里**仍处于退场态**的 id。
     *
     * 为什么这个字段是必需的:`cleanup-retired` 只清理**已退场**记录,而快照拍在删除
     * **之前** ——所以清理快照能找回的每一条都带着退场标记。于是"回到主表"≠"回到
     * 检索面":记录行在,但仍不出现在召回里,还要 `records-restore` 才放得回去。
     * 不报这个,调用方会以为恢复完了、而记忆其实还是不可见的。
     */
    stillRetired: string[];
    notFound: string[];
}
/** 按 id 过滤快照记录,并报出请求了却没找到的 id(人工恢复要能看到"没找到哪条")。 */
export declare function selectSnapshotTargets(records: readonly MemoryRecord[], ids?: readonly string[]): {
    targets: MemoryRecord[];
    notFound: string[];
};
/**
 * 从快照恢复 L1。
 *
 * **幂等**:走 `upsertL1`(按 id upsert),恢复两遍与一遍等价,中断后重跑安全。
 * 只恢复 `l1_records`——receipts / conflicts 今天不被 `clearL1()` 销毁(见模块头),
 * 且它们的写入口不归本模块所有(单一所有者)。
 *
 * **向量一次算完再逐条写**:`vectorize` 收的是整批记录,而不是每条回调一次——
 * 否则恢复 787 条就是 787 次嵌入往返。
 */
export declare function restoreL1Snapshot(db: SnapshotDbLike, dir: string, opts?: RestoreOptions): Promise<RestoreResult>;
/**
 * 清空前必须调用的守门函数:先建快照,再允许清空。
 *
 * 抽出来是为了让"先快照后清空"成为**调用方无法绕过的一步**,而不是一段注释。
 *
 * @returns 快照目录与清单;调用方拿到后才可以继续清空。
 */
export declare function snapshotBeforeClear(db: SnapshotDbLike, dataDir: string, reason: string, now?: Date): Promise<CreateSnapshotResult>;
/** 物理清理面(比快照面多一个删除能力)。 */
export interface PurgeDbLike extends SnapshotDbLike {
    deleteL1Batch: (ids: string[]) => number;
}
export interface ExportThenPurgeResult {
    /** 清理是否真的执行了。 */
    ok: boolean;
    /** 门禁未通过而**中止**(`purged` 必为 0)。 */
    aborted: boolean;
    /** 快照目录(中止时也给,便于人工查看失败现场)。 */
    dir: string;
    /** 快照**目录名**(供 `snapshot-restore` 直接寻址;中止且未建快照时为空串)。 */
    name: string;
    purged: number;
    /** 校验差异(仅 aborted 时非空)。 */
    diffs: string[];
    /**
     * 本批之外发生漂移的记录数(仅计数、**不中止**)。
     *
     * 旧实现拿整库哈希当门禁：并发蒸馏/另一处写入改过任何一条与本批无关的记录，
     * 本次清理就会永远中止（而它要删的那批逐字未动、完全可恢复）。漂移信息仍要报，
     * 但它不是删除本批的安全障碍。
     */
    otherChanged: number;
    /** 归档正文路径（未写 = 空串）。 */
    archiveMd: string;
    /** 投射文件搬运计数（N12）。 */
    files: ArchiveFileOutcome;
}
/** 清理时的可选动作（P3）。 */
export interface PurgeOptions {
    /**
     * 投射文件映射（由 `collectProjectionFiles` 产出）。
     *
     * **不传 = 只删库，行为与改动前逐字一致**——投射面默认关，归档搬运不能变成它的前置条
     * 件。传了就在全部门禁通过后把文件搬进快照目录，失败只 warn。
     */
    files?: FilesByRecord;
    /** 是否写 `retired.md` 归档正文（默认 true）。 */
    archiveMd?: boolean;
}
/**
 * **先导出,后清理**——把这句话变成调用方绕不过去的一步。
 *
 * 顺序与理由:
 * ① 建快照(写正文 + 清单);**写盘失败即中止**,绝不"先删了再说";
 * ② `verifySnapshot` 按**内容哈希**比对快照与当前库。不一致说明两者之间有别的写入
 *    发生(并发蒸馏、另一次清理),此时快照**不代表**将要被删的那批数据 → 中止;
 * ③ 只有 ①② 都通过,才 `deleteL1Batch` 做物理删除。
 *
 * 为什么值得这么严:物理删除是本插件唯一**不可逆**的动作。软删(退场)可以恢复,
 * 而清理一旦没有可信的导出物,就只剩 `records/*.jsonl` 事实源这一条后路,
 * 且那条路只覆盖 L1 记录、不覆盖 receipts/conflicts 的当时快照。
 */
export declare function exportThenPurge(db: PurgeDbLike, dataDir: string, ids: readonly string[], reason: string, logger?: {
    info: (m: string) => void;
    warn: (m: string) => void;
}, now?: Date, opts?: PurgeOptions): Promise<ExportThenPurgeResult>;
