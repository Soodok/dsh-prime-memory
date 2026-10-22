import type { MemoryLogger, RecallLane } from '../types.js';
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
    /** 记入本 sessionKey 本轮实际注入的记录 id（写穿；插入序淘汰最旧）。
     *  laneById 只带真正有归因的条目（hybrid 融合才挂 lanes；单路/旧路不传）。 */
    add(sessionKey: string, recordIds: readonly string[], injectionId?: string, laneById?: ReadonlyMap<string, readonly RecallLane[]>): void;
    /**
     * 标为受保护（判过时/软退场）：条目留在列表里，且不受上限淘汰与压缩清理影响。
     * id 不在本会话列表里时忽略（不凭这个调用新建条目）。
     */
    protect(sessionKey: string, recordIds: readonly string[]): void;
    list(sessionKey: string): string[];
    /**
     * 上下文事件：按原因区分。`'clear'`（用户主动清空）整表清；`'compact'`（摘要替换）**只打取代标记**。
     *
     * 旧实现两种都整表清，于是“压缩过一次”就把本会话召回历史（含已判过时的裁决凭证）抹平；
     * 改成“压缩什么都不做”又让列表谎报“这些正文还在上下文里”。现在压缩只动一维：
     * 把**此刻在列表里的**标为「已被摘要取代」（已在标记里的不再推序号）。
     * 压缩仍然重置**去重与占用账本**（那两者关心的是“能不能重新注入”，与这张展示表无关）。
     */
    reset(sessionKey: string, reason?: 'compact' | 'clear'): void;
    /**
     * 本会话「正文已被摘要取代」的 id 集（投影与端点用；只读共享。
     * 未出现过取代的会话返回共享空集，不每次新建）。
     */
    supersededOf(sessionKey: string): ReadonlySet<string>;
    /**
     * 本会话的路归因表（record id → 管道串；只读共享，投影/端点用）。
     * 不在表里 = 无从归因（单路检索/旧文件条目），展示层不渲染徽标。
     */
    lanesOf(sessionKey: string): ReadonlyMap<string, string>;
    /**
     * 用会话日志的可见性事实**对账**取代标记（Phase 0B）。
     *
     * 判据来自宿主官方服务的 `surface.nodes`（模型可见节点集），而不是“有没有收到一条压缩事件”：
     * 事件会漏、换代形状还会漂移，而且漏一次就永久错、无法补算。本函数每轮从事实源重算，
     * 所以既能**标上**也能**撤销**（重新注入、或上一轮粗标记误伤的，都能自愈）。
     *
     * @param visible 当前仍在上下文里的注入消息 id 集
     * @param known   会话日志里出现过的本插件注入消息 id 集。**不在 known 里的 = 该注入从未落日志**
     *                （被宿主取消/覆盖），属“无从判”——不动它，绝不猜成“已被取代”。
     * @returns 是否真的改动了状态（无改动不推 rev、不写盘）
     */
    reconcileSuperseded(sessionKey: string, visible: ReadonlySet<string>, known: ReadonlySet<string>): boolean;
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
