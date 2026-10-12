/**
 * 存量记忆的 workspace re-link（内容路由回填）。
 *
 * 为什么需要它：新写入的路由只覆盖此后产生的记忆，而库里已有的记录归属列全空
 * （实测 1279 条活跃记录里 `workspace_id` 非空为 0）。不回填，「按项目看记忆」这件事
 * 就永远只有增量、没有存量。
 *
 * 三条设计约束：
 * 1. **只写 `workspace_id`，不动 `scope`、不动 `updated_time`**。前者保可见性零变化
 *    （`cfg.scope='global'` 下 `isScopeVisible` 直接放行），后者保快照哈希零失配
 *    （见 `store/sqlite.ts` 的 `setL1WorkspaceIds` 注释，三条硬约束都在那儿）。
 * 2. **宁缺勿猜**：路由不命中的记录保持原样，绝不给一个"默认归属"。归错项目会让记忆
 *    在错误的工作区可见/不可见，比不归难查得多。
 * 3. **有界可重入**：照 `wing-backfill` 的双护栏 + 扫描阶段也查墙钟 + 剩余留待再次触发；
 *    且因不写 `updated_time`，按更新时间倒序分页**不会边扫边漂**。
 */
import type { MemoryRecord } from '../types.js';
import type { WorkspaceRoute } from '../workspace-route.js';
/** re-link 需要的存储面（结构化声明，便于单测注入）。 */
export interface RelinkStoreFace {
    list(opts: {
        limit: number;
        offset: number;
    }): {
        items: MemoryRecord[];
        total: number;
    };
    setWorkspaceIds(items: ReadonlyArray<{
        id: string;
        workspaceId: string;
    }>): number;
}
export interface RelinkReport {
    dryRun: boolean;
    /** 扫过的记录数（含未命中）。 */
    scanned: number;
    /** 路由命中的记录数。 */
    matched: number;
    /** 归属已是目标值、无需写的记录数（幂等重跑时等于 matched）。 */
    unchanged: number;
    /** 干跑时“若真跑会写多少条”；真写时恒为 0（那一步看 written）。 */
    toWrite: number;
    /** 实际写入条数（dryRun 时恒为 0）。 */
    written: number;
    /** 因预算未处理、留待下次触发的条数。 */
    remaining: number;
    /** 命中记录按归属的分布（先看这个数就知道路由表合不合口味）。 */
    byWorkspace: Record<string, number>;
}
export declare function relinkWorkspaces(deps: {
    l1: RelinkStoreFace;
    routes: readonly WorkspaceRoute[];
    dryRun?: boolean;
    maxRecords?: number;
    timeBudgetMs?: number;
    logger?: {
        info: (m: string) => void;
        warn: (m: string) => void;
    };
}): Promise<RelinkReport>;
