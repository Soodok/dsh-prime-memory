export declare class SessionRecalledStore {
    private readonly entries;
    /** 记入本 ownerId 本轮实际注入的记录 id（插入序淘汰最旧，防无界）。 */
    add(ownerId: string, recordIds: readonly string[]): void;
    /** 该 ownerId 当前的活召回集（插入序，最新在后）；无则空数组。 */
    list(ownerId: string): string[];
    /** 压缩/清空：该会话注入内容已离开上下文，清空其活召回集。 */
    reset(ownerId: string): void;
    /** 诊断/测试：当前跟踪的会话数。 */
    size(): number;
}
