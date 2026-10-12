import type { MemoryLogger } from '../types.js';
export declare const RECALL_FEEDBACK_FILE_VERSION: 1;
/** 合法打分：-1（声明过时）与 0..5（相关度）。 */
export declare const FEEDBACK_SCORES: readonly [-1, 0, 1, 2, 3, 4, 5];
export type FeedbackScore = (typeof FEEDBACK_SCORES)[number];
/** 单条记忆的反馈聚合。 */
export interface RecallFeedbackEntry {
    /** 最近一次打分(-1..5)。 */
    last: FeedbackScore;
    /** 有效相关度评分次数(不含 -1)。 */
    rated: number;
    /** 0..5 评分均值(rated=0 时为 0)。 */
    mean: number;
    /** 被声明过时的次数(-1 计数)。 */
    obsolete: number;
    /** 最近一次打分时刻(epoch ms)。 */
    updatedAt: number;
    /** 最近若干条打分轨迹(旧→新，截断至 HISTORY_CAP)。 */
    history: Array<{
        s: FeedbackScore;
        at: number;
    }>;
}
/** 是否合法打分(供端点入参校验复用)。 */
export declare function isFeedbackScore(v: unknown): v is FeedbackScore;
export declare class RecallFeedbackStore {
    private readonly logger?;
    private readonly file;
    private entries;
    private loaded;
    private degraded;
    private degradedLogged;
    private writeChain;
    /** 判脏序号:每次有效写入 +1(投影 view 带 rating，靠它决定要不要重建)。 */
    private rev;
    constructor(dataDir: string, logger?: MemoryLogger | undefined);
    init(): Promise<void>;
    /** 读侧逐条收窄:形状不符的条目丢弃，不让一条坏数据拖垮整表。 */
    private normalize;
    private ensureLoaded;
    /** 判脏序号(供投影 O(1) 决定要不要重建 view)。 */
    revision(): number;
    /**
     * 记一次打分。返回聚合后的条目(供端点回执)。
     * 只聚合不裁决:`-1` 进 obsolete 计数、不进均值(过时不是"不相关",两回事)。
     */
    rate(id: string, score: FeedbackScore, at?: number): RecallFeedbackEntry;
    get(id: string): RecallFeedbackEntry | undefined;
    /** 均值(0..5);无有效评分 → undefined(缺席 ≠ 0 分)。 */
    meanOf(id: string): number | undefined;
    /** 最近一次打分(-1..5);未标注 → undefined。 */
    lastOf(id: string): FeedbackScore | undefined;
    /**
     * 把一条记录的人工标注搬到新 id（merge 之后由管线调用，P0-d）。
     *
     * 不搬的后果比使用史更直接：成熟度只吃“人工最近一笔”，而 `last` 留在旧 id 上
     * 就等于新记录**看起来从没被人打过**；更坏的是旧 id 上那一笔 `-1`（已判过时）
     * 会跟着旧行一起沉进垃圾堆，新行反而以“未标注”的活状态回到召回里。
     *
     * 计数按相加、不按轨迹重算：`history` 截断到 12 条，拿它反推 `obsolete` 必然少算。
     * 两侧都有条目时取较新一侧的 `last`，轨迹按时间归并。
     */
    rekey(oldId: string, newId: string): boolean;
    summary(): {
        tracked: number;
        rated: number;
        obsolete: number;
    };
    private prune;
    /** 立即落盘(串行链上排队,不与在途写交错)。 */
    private schedulePersist;
    private persist;
    /** 等待在途写完成(测试/停机用)。 */
    flush(): Promise<void>;
}
