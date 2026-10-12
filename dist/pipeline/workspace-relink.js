import { routeWorkspace } from '../workspace-route.js';
import { yieldLoop } from '../util/yield.js';
const PAGE = 200;
/** 攒够一批再写：一批一个事务，避免逐条开事务的 fsync 开销。 */
const FLUSH = 500;
export async function relinkWorkspaces(deps) {
    const { l1, routes, logger } = deps;
    const dryRun = deps.dryRun !== false; // 缺省干跑：先看报告，再决定真写
    const maxRecords = Math.max(1, Math.floor(deps.maxRecords ?? 300));
    const budgetMs = Math.max(1000, Math.floor(deps.timeBudgetMs ?? 120_000));
    const started = Date.now();
    const overBudget = () => Date.now() - started > budgetMs;
    const report = {
        dryRun, scanned: 0, matched: 0, unchanged: 0, toWrite: 0, written: 0, remaining: 0, byWorkspace: {},
    };
    if (routes.length === 0)
        return report;
    let offset = 0;
    let batch = [];
    // 计数在此结算：`flush()` 会清空 batch，调用点再拿 `batch.length` 必然归零。
    const flush = () => {
        if (batch.length === 0)
            return;
        if (dryRun)
            report.toWrite += batch.length;
        else
            report.written += l1.setWorkspaceIds(batch);
        batch = [];
    };
    for (;;) {
        if (report.scanned >= maxRecords)
            break;
        // 扫描阶段本身也查墙钟：1279 条不慢，但同一个护栏要能扛住更大的库。
        if (overBudget())
            break;
        const page = l1.list({ limit: PAGE, offset });
        if (page.items.length === 0)
            break;
        for (const rec of page.items) {
            // 上限检查必须在**循环顶部**：放在末尾时，未命中的记录会先 `continue` 掉，
            // 于是 maxRecords=1 实际能扫 2 条（实测翻出）——有界性得对所有分支都成立。
            if (report.scanned >= maxRecords)
                break;
            report.scanned++;
            const routed = routeWorkspace(`${rec.content}\n${rec.scene_name}`, routes);
            if (routed === undefined)
                continue;
            report.matched++;
            report.byWorkspace[routed] = (report.byWorkspace[routed] ?? 0) + 1;
            if (rec.workspaceId === routed) {
                report.unchanged++;
                continue;
            }
            batch.push({ id: rec.id, workspaceId: routed });
            if (batch.length >= FLUSH)
                flush();
        }
        offset += page.items.length;
        if (offset >= page.total)
            break;
        await yieldLoop(); // 让出事件循环：面板 RPC / 状态查询优先
    }
    flush();
    // 剩余 = 总数 - 实扫条数。**不能用 offset 算**：中途按 maxRecords/预算 break 时，
    // offset 已推进整个页（一页 PAGE 条），会把“还剩 2 条没扫”算成 0，
    // 于是报告谎称已扫完——下次也就不会再触发续扫了。
    const totalRows = l1.list({ limit: 1, offset: 0 }).total;
    report.remaining = Math.max(0, totalRows - report.scanned);
    logger?.info(`[memory] workspace re-link${dryRun ? '(干跑)' : ''}：扫 ${report.scanned} 条，命中 ${report.matched} 条，`
        + `待写 ${report.toWrite} 条，实写 ${report.written} 条，`
        + `剩 ${report.remaining} 条未扫(下次触发续)；分布 ${JSON.stringify(report.byWorkspace)}`);
    return report;
}
