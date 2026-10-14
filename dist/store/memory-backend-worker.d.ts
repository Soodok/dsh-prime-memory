import type { MemoryLogger, MemoryRecord } from '../types.js';
import type { L1MetaLite } from './sqlite.js';
import type { L1ListOpts, L1ListResult, MemoryBackend } from './memory-backend.js';
export interface WorkerMemoryBackendOpts {
    /** 与主线程同一个 db 文件路径(worker 内自开连接)。 */
    dbPath: string;
    /** 向量维度(0 = 纯 FTS);只影响建表,本 worker 不做检索。 */
    dimensions: number;
    logger?: MemoryLogger;
    /** 单命令超时(ms);超时只 reject 该命令,不杀线程。默认 30s。 */
    timeoutMs?: number;
    /** worker 资产路径覆盖(测试用:源码态下 dist 产物不存在)。 */
    workerPath?: string;
}
export declare class WorkerMemoryBackend implements MemoryBackend {
    private readonly worker;
    private readonly pending;
    private readonly logger?;
    private readonly timeoutMs;
    private nextId;
    private alive;
    private crashReason;
    constructor(opts: WorkerMemoryBackendOpts);
    /** 线程不可用(崩溃/已释放)时快速拒绝:postMessage 到死线程是静默无回应。 */
    private guard;
    private failAll;
    private call;
    allLite(limit: number, offset: number): Promise<L1MetaLite[]>;
    getByIds(ids: string[]): Promise<MemoryRecord[]>;
    list(opts: L1ListOpts): Promise<L1ListResult>;
    patchMetadata(id: string, metadata: Record<string, unknown>): Promise<boolean>;
    patchMetadataAndReindex(id: string, metadata: Record<string, unknown>): Promise<boolean>;
    size(): Promise<number>;
    dispose(): Promise<void>;
}
/**
 * 建后端:优先 worker,起不来就退回进程内。
 *
 * **隔离失败绝不能让后台处理失效** —— 所以这里 catch 掉一切并降级,
 * 只留一条 warn(与"静默丢弃"相反:降级是可观测的)。
 */
export declare function createMemoryBackend(workerOpts: WorkerMemoryBackendOpts, fallback: MemoryBackend): Promise<MemoryBackend>;
