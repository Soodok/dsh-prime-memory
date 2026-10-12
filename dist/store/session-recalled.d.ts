import type { MemoryLogger } from '../types.js';
export declare class SessionRecalledStore {
    private readonly logger?;
    private readonly file;
    private readonly entries;
    private degraded;
    private degradedLogged;
    private lastPersisted;
    private writeChain;
    /** 脏检序号：每次真实变更 +1，投影 apply 据此 O(1) 判断是否重建。 */
    private rev;
    constructor(dataDir: string, logger?: MemoryLogger | undefined);
    revision(): number;
    private init;
    /** 记入本 sessionKey 本轮实际注入的记录 id（写穿；插入序淘汰最旧）。 */
    add(sessionKey: string, recordIds: readonly string[]): void;
    list(sessionKey: string): string[];
    /** 压缩/清空：注入内容已离开上下文，清该会话活召回集（写穿）。 */
    reset(sessionKey: string): void;
    /**
     * 注：曾有 `remove(sessionKey, recordIds)` 供「声明过时」单条摘除，已删。
     * 理由：用户判过时后条目得留在召回列表里显示删除线（文本仍在上下文，直到压缩），
     * 所以**只有** `reset`（压缩/清空）能让条目离开这张列表。
     */
    size(): number;
    /** 等待在途持久化写完成（测试/停机）。 */
    flush(): Promise<void>;
    private persist;
    private serialize;
}
