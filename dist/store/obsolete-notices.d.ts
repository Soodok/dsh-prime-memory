import type { MemoryLogger } from '../types.js';
export declare const OBSOLETE_NOTICES_FILE_VERSION: 1;
/** 一条待播报的过时声明。 */
export interface ObsoleteNotice {
    /** 被退场的 L1 记录 id。 */
    id: string;
    /** 正文首行（注入时供模型定位是哪条；截断至 TITLE_MAX）。 */
    title: string;
    /** 用户声明时刻(epoch ms)。 */
    at: number;
}
export declare class ObsoleteNoticeStore {
    private readonly logger?;
    private readonly file;
    private buckets;
    private loaded;
    private degraded;
    private degradedLogged;
    private writeChain;
    private rev;
    constructor(dataDir: string, logger?: MemoryLogger | undefined);
    init(): Promise<void>;
    private normalize;
    private ensureLoaded;
    /** 判脏序号(测试/观测用;注入侧靠 drain 的返回值判断有无)。 */
    revision(): number;
    /** 入队一条(幂等由调用方保证:同 id 重复入队只会多播一行，故这里去重)。 */
    push(sessionKey: string, notice: ObsoleteNotice): void;
    /** 出队并清空该会话的待播报(一次性语义:取走即离开 outbox)。 */
    drain(sessionKey: string): ObsoleteNotice[];
    /** 只看不取(测试/诊断)。 */
    peek(sessionKey: string): ObsoleteNotice[];
    size(): number;
    private prune;
    private schedulePersist;
    private persist;
    /** 等待在途写完成(测试/停机用)。 */
    flush(): Promise<void>;
}
