/** 单条路由健康记录。 */
export interface RouteHealthEntry {
    /** 退避后实测跑通的最小块长(字符)；0 = 未学到。 */
    lastGoodChunkChars: number;
    /** 该路由延迟 EMA(ms)；0 = 未记。R5 自适应可据此调初值。 */
    latencyEmaMs: number;
    /** 最近一次记录时刻(ISO)。 */
    updatedAt: string;
}
/** 学习值默认过期(ms)：超此龄视为陈旧、读侧应重探（换模型/网关不至于被历史最小值锁死）。 */
export declare const ROUTE_HEALTH_STALE_MS: number;
export declare function routeHealthPathFor(dataDir: string): string;
export declare class RouteHealthStore {
    private readonly file;
    private routes;
    private dirty;
    constructor(file: string);
    /** 读盘 fail-open：缺/坏/未知版本 → 空表、不抛。 */
    load(): Promise<void>;
    /** 该路由已学到、且未过期的跑通块长；0 = 无可用学习值（未学到或已陈旧）。 */
    lastGoodChunkChars(provider: string, model: string, now?: number, staleMs?: number): number;
    /** 该路由延迟 EMA(ms)；0 = 未记。 */
    latencyEma(provider: string, model: string): number;
    /**
     * 记一次「跑通」的块长：只降不升（更小块长才覆盖 lastGood），并更新延迟 EMA。
     * @param chunkChars 本次成功的块长(字符)
     * @param latencyMs  本次成功调用耗时(可选，用于 EMA)
     */
    recordGood(provider: string, model: string, chunkChars: number, latencyMs?: number): void;
    /** 清除学习值：传 provider+model 清单条，否则清全部（面板「重置学习值」一键）。 */
    reset(provider?: string, model?: string): void;
    /** 全量快照（面板回显用）。 */
    snapshot(): Array<{
        key: string;
    } & RouteHealthEntry>;
    /** 有变更才落盘；失败由调用方兜底（不抛穿蒸馏）。@returns 是否写了盘 */
    save(): Promise<boolean>;
}
