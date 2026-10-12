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
import { routeWorkspace } from '../workspace-route.js';
import { yieldLoop } from '../util/yield.js';

/** re-link 需要的存储面（结构化声明，便于单测注入）。 */
export interface RelinkStoreFace {
  list(opts: { limit: number; offset: number }): { items: MemoryRecord[]; total: number };
  setWorkspaceIds(items: ReadonlyArray<{ id: string; workspaceId: string }>): number;
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

const PAGE = 200;
/** 攒够一批再写：一批一个事务，避免逐条开事务的 fsync 开销。 */
const FLUSH = 500;

export async function relinkWorkspaces(deps: {
  l1: RelinkStoreFace;
  routes: readonly WorkspaceRoute[];
  dryRun?: boolean;
  maxRecords?: number;
  timeBudgetMs?: number;
  logger?: { info: (m: string) => void; warn: (m: string) => void };
}): Promise<RelinkReport> {
  const { l1, routes, logger } = deps;
  const dryRun = deps.dryRun !== false; // 缺省干跑：先看报告，再决定真写
  const maxRecords = Math.max(1, Math.floor(deps.maxRecords ?? 300));
  const budgetMs = Math.max(1000, Math.floor(deps.timeBudgetMs ?? 120_000));
  const started = Date.now();
  const overBudget = (): boolean => Date.now() - started > budgetMs;

  const report: RelinkReport = {
    dryRun, scanned: 0, matched: 0, unchanged: 0, toWrite: 0, written: 0, remaining: 0, byWorkspace: {},
  };
  if (routes.length === 0) return report;

  let offset = 0;
  let batch: Array<{ id: string; workspaceId: string }> = [];
  // 计数在此结算：`flush()` 会清空 batch，调用点再拿 `batch.length` 必然归零。
  const flush = (): void => {
    if (batch.length === 0) return;
    if (dryRun) report.toWrite += batch.length;
    else report.written += l1.setWorkspaceIds(batch);
    batch = [];
  };

  for (;;) {
    if (report.scanned >= maxRecords) break;
    // 扫描阶段本身也查墙钟：1279 条不慢，但同一个护栏要能扛住更大的库。
    if (overBudget()) break;
    const page = l1.list({ limit: PAGE, offset });
    if (page.items.length === 0) break;
    for (const rec of page.items) {
      // 上限检查必须在**循环顶部**：放在末尾时，未命中的记录会先 `continue` 掉，
      // 于是 maxRecords=1 实际能扫 2 条（实测翻出）——有界性得对所有分支都成立。
      if (report.scanned >= maxRecords) break;
      report.scanned++;
      const routed = routeWorkspace(`${rec.content}\n${rec.scene_name}`, routes);
      if (routed === undefined) continue;
      report.matched++;
      report.byWorkspace[routed] = (report.byWorkspace[routed] ?? 0) + 1;
      if (rec.workspaceId === routed) {
        report.unchanged++;
        continue;
      }
      batch.push({ id: rec.id, workspaceId: routed });
      if (batch.length >= FLUSH) flush();
    }
    offset += page.items.length;
    if (offset >= page.total) break;
    await yieldLoop(); // 让出事件循环：面板 RPC / 状态查询优先
  }

  flush();
  // 剩余 = 总数 - 实扫条数。**不能用 offset 算**：中途按 maxRecords/预算 break 时，
  // offset 已推进整个页（一页 PAGE 条），会把“还剩 2 条没扫”算成 0，
  // 于是报告谎称已扫完——下次也就不会再触发续扫了。
  const totalRows = l1.list({ limit: 1, offset: 0 }).total;
  report.remaining = Math.max(0, totalRows - report.scanned);
  logger?.info(
    `[memory] workspace re-link${dryRun ? '(干跑)' : ''}：扫 ${report.scanned} 条，命中 ${report.matched} 条，`
    + `待写 ${report.toWrite} 条，实写 ${report.written} 条，`
    + `剩 ${report.remaining} 条未扫(下次触发续)；分布 ${JSON.stringify(report.byWorkspace)}`,
  );
  return report;
}
