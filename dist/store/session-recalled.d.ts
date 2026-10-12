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
     * 摘除该会话活召回集里的**指定几条**（写穿）。
     *
     * 与 `reset` 的差别：reset 是"上下文整段离开"（压缩/清空），remove 是"这一条已被
     * 用户判定过时"——其余召回条目仍在上下文里，不该跟着一起消失。
     * 无命中时零写盘（免得一次无效点击刷一次 updatedAt、把会话留在盘上）。
     */
    remove(sessionKey: string, recordIds: readonly string[]): number;
    size(): number;
    /** 等待在途持久化写完成（测试/停机）。 */
    flush(): Promise<void>;
    private persist;
    private serialize;
}
