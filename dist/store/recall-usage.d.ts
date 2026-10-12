import type { MemoryLogger } from '../types.js';
export declare const RECALL_USAGE_FILE_VERSION: 1;
export interface RecallUsageEntry {
    attempts: number;
    used: number;
    lastAttemptAt: number | null;
    lastUsedAt: number | null;
}
export interface RecallUsageSummary {
    /** 有统计的记忆条数。 */
    tracked: number;
    /** 尝试总次数(Σ attempts)。 */
    attempted: number;
    /** 使用总次数(Σ used)。 */
    used: number;
    /** 使用率(百分比整数;attempted=0 时 0)。 */
    rate: number;
}
export declare class RecallUsageStore {
    private readonly logger?;
    private readonly file;
    private entries;
    private loaded;
    private degraded;
    private degradedLogged;
    private writeTimer;
    private writeChain;
    constructor(dataDir: string, logger?: MemoryLogger | undefined);
    init(): Promise<void>;
    private ensureLoaded;
    /** 一轮召回:候选集 attempts++/lastAttemptAt=now;used 子集额外 used++/lastUsedAt=now
     *  (used 不在候选内 = 防御路径,同样算一次尝试——用了就是被尝试过)。 */
    recordAttempt(candidateIds: readonly string[], usedIds: readonly string[]): void;
    get(id: string): RecallUsageEntry | undefined;
    /**
     * 把一条记录的使用史搬到新 id（merge 之后由管线调用，P0-d）。
     *
     * 必须搬的理由：成熟度 = `priority + used + 老化 + 人工最近一笔` 的合成，而 merge
     * 每次新铸 id——不搬就等于**每次合并把这条记忆的使用史清零**，它会被系统当成
     * “没用过”而沉底，而且从面板上看不出来（统计仍挂在已退场的旧 id 上）。
     *
     * 两侧都有条目时按“次数相加、时刻取新”合并：这是纯计数，不存在语义冲突。
     * 没条目（旧 id 从未被召回过）时返回 false，**不造零条目**——那会把表灌满噪声行。
     */
    rekey(oldId: string, newId: string): boolean;
    summary(): RecallUsageSummary;
    /** 立即落盘(去抖窗口内的兜底;测试/停机用)。 */
    flush(): Promise<void>;
    /** 同步等待在途写(测试用;无在途写时立即返回)。 */
    flushSync(): void;
    private prune;
    private schedulePersist;
    private persist;
}
