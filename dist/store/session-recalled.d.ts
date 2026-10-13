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
    /**
     * 标为受保护（判过时/软退场）：条目留在列表里，且不受上限淘汰与压缩清理影响。
     * id 不在本会话列表里时忽略（不凭这个调用新建条目）。
     */
    protect(sessionKey: string, recordIds: readonly string[]): void;
    list(sessionKey: string): string[];
    /**
     * 上下文事件：按原因区分。`'clear'`（用户主动清空）整表清；`'compact'`（摘要替换）**不动**。
     *
     * 旧实现两种都整表清，于是“压缩过一次”就把本会话召回历史（含已判过时的裁决凭证）抹平，
     * 而列表上那些条目本来就是为了让人看见“这条我判过”才保留删除线的。
     * 压缩仍然重置**去重与占用账本**（那两者关心的是“能不能重新注入”，与这张展示表无关）。
     */
    reset(sessionKey: string, reason?: 'compact' | 'clear'): void;
    /**
     * 注：曾有 `remove(sessionKey, recordIds)` 供「声明过时」单条摘除，已删。
     * 理由：用户判过时后条目得留在召回列表里显示删除线，所以**只有** `reset(…, 'clear')`
     * 能让条目离开这张列表（判过时的还受 `protectedIds` 保护，连淘汰都走不到它）。
     */
    size(): number;
    /** 等待在途持久化写完成（测试/停机）。 */
    flush(): Promise<void>;
    private persist;
    private serialize;
}
