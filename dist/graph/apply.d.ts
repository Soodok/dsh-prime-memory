import type { MemoryRecord } from '../types.js';
import type { GraphEdge, GraphNode, GraphProjectionResult } from './types.js';
export interface ApplyGraphProjectionOptions {
    /** 可变异的合并 scope(现有节点/边;调用方决定 scope 大小)。 */
    nodes: GraphNode[];
    edges: GraphEdge[];
    /** 本批认领的记录(族判定与时间锚的证据来源)。 */
    records: readonly MemoryRecord[];
    result: GraphProjectionResult;
    allowedRecordIds: ReadonlySet<string>;
    /** 本次投影时刻(ISO;时间锚兜底与 updatedAt 的时间基准)。 */
    now: string;
    idFactory: (prefix: 'node' | 'edge' | 'gfact') => string;
}
export interface ApplyGraphProjectionOutcome {
    nodeIds: string[];
    edgeIds: string[];
    /** 因无来源/形状非法被丢弃的提案条数(节点+fact+边;诊断日志用)。 */
    dropped: number;
}
/**
 * 实体名归一(NFKC + 小写 + 去空白/下划线/连字符):全角/半角、大小写、
 * "张 三"与"张三"、"AI-agent"与"aiagent"视作同一实体的拼写变体。
 * 归一后空串返回原串(防止空名互相合并)。
 */
export declare function normalizeEntityName(name: string): string;
/**
 * 时间锚:有效期为先,提及/入库时间为后。
 *
 * 逐条记录按六级证据取最晚,任何一级无法解析(缺字段/非法日期)即落到下一级:
 * validTo → validFrom(时间增强列,新写入路径)→ metadata.activity_end_time →
 * metadata.activity_start_time(列迁移前的存量数据)→ timestamps 最新 → createdAt。
 * 全部无证据才用 fallback(now),绝不猜测。
 *
 * task_2.6(expiry-tiering):兜底 now 分支回传 `'fallback_now'` 证据等级——供图谱侧
 * 同口径读时派生使用(落到 now 的 validFrom **不是**时间证据,与 activity_* 链的
 * 'evidence' 必须可区分;否则假过期与真过期同形)。
 */
export declare function anchorTimeFromRecordsDetailed(records: readonly MemoryRecord[], fallbackIso: string): {
    iso: string;
    source: 'evidence' | 'fallback_now';
};
/** {@link anchorTimeFromRecordsDetailed} 的旧签名封装(调用方只要时刻时的零改动通道)。 */
export declare function anchorTimeFromRecords(records: readonly MemoryRecord[], fallbackIso: string): string;
/** 应用一次投影提案(硬校验 + 消歧 + supersede + 状态重建)。 */
export declare function applyGraphProjection(options: ApplyGraphProjectionOptions): ApplyGraphProjectionOutcome;
