/**
 * 孤儿记忆的 Room 候选预标记 + agent 逐个复查(长尾治理)。
 *
 * 背景:Room 由 metadata.tags 自生长,但 tags 只在反刍 relabel 段随 wing 补打
 * 顺带产出(每轮 ≤40 条、且只覆盖本轮补 wing 的记录)——「有 wing 无 tags」与
 * 「预算用尽被 deferred」的记录成为无 Room 绑定的孤儿,且标注器不参考现有
 * Room 词表,产出碎片化新 slug(81 个 Room 大多 1 条的成因)。
 *
 * 两段式:
 *  1. **预标记(annotateOrphanCandidates)**:抽取活跃孤儿,LLM 对照**现有 Room
 *     词表**产出候选(优先挂靠现有 Room,≤2 个新 slug 兜底),写
 *     `metadata.roomCandidates` + `roomReview:'pending'`——不动 tags、不进
 *     Room、不进召回,只是"待确认的建议"。
 *  2. **逐个复查(memory_room_review 工具)**:agent 取下一条待复查记录
 *     (带候选 + 现有 Room 词表),确认后 confirm 写入 tags(进 Room,高权限
 *     门控),或 skip 跳过。确认/跳过都是显式动作,预标记本身零行为面。
 *
 * 存储即 metadata 保留键(与 relabel 写 tags 同款 patchMetadata 合并纪律,
 * 写前重读):`roomCandidates` / `roomReview:'pending'|'confirmed'|'skipped'`。
 * 两键不在 rooms 聚合(rooms 只读 $.tags)、不在快照哈希投影关注的治理列——
 * 与既有 metadata 键同层,无 schema 变更。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { MemoryConfig } from './config.js';
import type { MemoryLogger, MemoryRecord } from './types.js';
export declare const ROOM_CANDIDATES_KEY = "roomCandidates";
export declare const ROOM_REVIEW_KEY = "roomReview";
export type RoomReviewState = 'pending' | 'confirmed' | 'skipped';
/** 复查与候选操作对 L1 的最小依赖面(便于测试注入)。 */
export interface RoomReviewStore {
    list(opts: {
        untagged?: boolean;
        retired?: boolean;
        limit: number;
        offset: number;
    }): {
        items: MemoryRecord[];
        total: number;
    };
    getByIds(ids: readonly string[]): MemoryRecord[];
    patchMetadata(id: string, metadata: Record<string, unknown>): boolean;
    listRooms(): Array<{
        room: string;
        count: number;
    }>;
    /** 确认写 tags 后失效 Room 计数缓存(30s TTL)。 */
    invalidateRooms(): void;
}
/** merge/rename 的 store 面(RoomReviewStore + 游标重写与备份;L1Store 已实现)。 */
export interface RoomMergeStore extends RoomReviewStore {
    listByTagAll(tag: string, cap?: number): MemoryRecord[];
    backupTagRecords(tag: string): {
        file: string;
        count: number;
    };
    rewriteTag(from: string, to: string, cap?: number): {
        rewritten: number;
        scanned: number;
        families: string[];
        scenes: string[];
        hasMore: boolean;
    };
}
/** Room 注册表最小面(merge 收尾;RoomRegistryStore 已满足)。 */
export interface RoomRegistryMerge {
    markMerged(fromSlug: string, toSlug: string): Promise<boolean>;
    renameSlug(oldSlug: string, newSlug: string): Promise<boolean>;
    /** rename 收尾恢复先前状态用(active 条目改名后不掉出标注词表)。 */
    bySlug?(slug: string): {
        status: 'active' | 'retired';
    } | undefined;
    setStatus?(slug: string, status: 'active' | 'retired'): Promise<boolean>;
}
export interface RoomCandidate {
    id: string;
    rooms: string[];
}
/** 解析标注器输出的逐条候选(容错:id 配对失败丢弃;isTag 校验;目录内优先,≤3)。 */
export declare function parseRoomCandidateItems(parsed: ReadonlyArray<{
    id: string;
    rooms: readonly string[];
}>, ids: ReadonlyArray<string>, roomCatalog: ReadonlyArray<{
    room: string;
    count: number;
}>): RoomCandidate[];
/** 候选标注系统 prompt:喂现有 Room 词表(带计数),优先挂靠、少量新建兜底(逐条)。 */
export declare function roomCandidateSystemPrompt(roomCatalog: ReadonlyArray<{
    room: string;
    count: number;
}>): string;
/**
 * 候选标注器:一条孤儿记录 → 候选 Room(优先现有词表;失败返回 null,调用方零改动)。
 *
 * **一个请求只装一条**(旧名 `roomCandidateChunk`,多条一次,已废)。
 */
export declare function roomCandidateOne(ctx: Context, cfg: MemoryConfig, logger: MemoryLogger, rec: MemoryRecord, roomCatalog: ReadonlyArray<{
    room: string;
    count: number;
}>): Promise<string[] | null>;
export interface OrphanAnnotateIO {
    l1: RoomReviewStore;
    logger: MemoryLogger;
    /** Room 注册表(可选:未装配 = 词表只用自生长聚合,无注册条目)。 */
    registry?: {
        listActive(): Array<{
            slug: string;
            label?: string;
            description?: string;
        }>;
    };
}
/**
 * 预标记消费器:活跃孤儿(≤limit 条)批量产候选并写 pending。
 * 写前重读合并(与 relabel 同纪律);失败单条跳过、原记录零改动。
 */
export interface OrphanAnnotateOverrides {
    /** 测试注入口:替换 LLM 候选标注器(默认走真实 callLLM 路径);第二参为合并词表。
     *  **逐条**形状:返回该条的候选 slug(空数组 = 无法判断),失败返回 null。 */
    annotator?: (rec: MemoryRecord, catalog: ReadonlyArray<{
        room: string;
        count: number;
        label?: string;
        description?: string;
    }>) => Promise<string[] | null>;
}
export declare function annotateOrphanCandidates(ctx: Context, cfg: MemoryConfig, io: OrphanAnnotateIO, limit?: number, overrides?: OrphanAnnotateOverrides): Promise<{
    selected: number;
    candidates: number;
    written: number;
}>;
export interface MergeRoomResult {
    dryRun: boolean;
    /** 影响条数(dryRun=预览数;实跑=实际重写数)。 */
    affected: number;
    preview: string[];
    applied: number;
    hasMore: boolean;
    backupFile?: string;
    /** 实跑时回传:受影响的族与场景(调用方入队 recluster 'room-merge')。 */
    families?: string[];
    scenes?: string[];
}
/**
 * Room merge/rename 编排(破坏性动作,分类管理 beta.5):
 *  - dryRun(缺省 true):只统计 affected + 前 6 条预览,**零写入**;
 *  - 实跑:执行前备份(matching rows → rooms-merge-backups/)→ 游标重写
 *    (写前重读-合并-写回,其余 metadata 键保全)→ 注册表 markMerged/renameSlug
 *    → 返回受影响 (family, scene) 供调用方入队 recluster('room-merge');
 *  - 单飞:并发 merge 直接抛错;与 relabel/ruminate 的时间错开由调用方保证。
 * 抛错语义:非法参数/注册表冲突直接抛(调用方转 notice)。
 */
export declare function mergeRoom(io: {
    l1: RoomMergeStore;
    registry: RoomRegistryMerge;
    logger: MemoryLogger;
}, from: string, to: string, opts?: {
    dryRun?: boolean;
    cap?: number;
}): Promise<MergeRoomResult>;
/** rename = merge 1:1 + 注册表改名(冲突时抛错提示走 merge)。
 *  归类语义:改名**不是退役**——merge 编排的 markMerged 会把旧条目置 retired,
 *  这里在改名后恢复其先前状态(active 条目改名后仍 active,不掉出标注词表)。 */
export declare function renameRoom(io: {
    l1: RoomMergeStore;
    registry: RoomRegistryMerge;
    logger: MemoryLogger;
}, from: string, to: string, opts?: {
    dryRun?: boolean;
    cap?: number;
}): Promise<MergeRoomResult>;
/** 下一条待复查(供 agent 逐个过):记录摘要 + 候选 + 现有 Room 词表 + 剩余数。 */
export declare function nextReview(l1: RoomReviewStore): {
    id: string;
    content: string;
    type: string;
    sceneName: string;
    candidates: string[];
    roomCatalog: Array<{
        room: string;
        count: number;
    }>;
    remaining: number;
} | null;
/** 待复查剩余数(面板/工具兜底信息)。 */
export declare function pendingReviewCount(l1: RoomReviewStore): number;
/**
 * 确认复查结果:候选(或 agent 改写的)写入 metadata.tags(**进 Room**),
 * 清候选、标 confirmed。**高权限门控由调用方执行**(与 memory_delete 同款)。
 * 返回写入的 tags;id 不存在/状态非法返回 null。
 */
export declare function confirmReview(l1: RoomReviewStore, id: string, rooms: readonly string[]): {
    tags: string[];
} | null;
/** 跳过:标 skipped(不再进 pending 队列)。已 confirmed 的记录不受 skip 影响(挂了 Room 的不算长尾)。 */
export declare function skipReview(l1: RoomReviewStore, id: string): boolean;
