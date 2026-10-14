/**
 * md 投影长任务的**滚动执行**与进度面。
 *
 * 为什么要这一层：`exportRecords` / `convergeDisabledSuffix` 各自是"一次有界的一轮"
 * （护栏 `maxRecords` + 墙钟 `timeBudgetMs`），设计上就假定调用方会再点一次。真机反馈
 * 是"点三下才清干净，每次一秒多"——把"要不要继续"这个判断丢给人点是错的：任务自己知道
 * 有没有做完（`capped`），就该自己滚到完。形状照本包既有的两个长任务（`ruminate` /
 * `rebuild`）：一个后台任务 + 一个只读状态端点，面板拿状态画进度条。
 *
 * 三条纪律：
 * 1. **同一时刻只跑一个投影任务**：两个任务同时改同一批文件与同一本账，产生的差异
 *    连对账都解释不清。第二个进来直接抛，不排队（排队会让人以为"点了没反应"）。
 * 2. **总预算兜底**：单轮的墙钟护栏防的是"一条超大记录挂死一次点击"，跨轮还得有一道
 *    总闸（`totalBudgetMs`）+ 轮数上限（`maxPasses`），否则一个病态目录能让任务永远
 *    在滚。用尽时如实写进 `error`，人再点一次接着滚（游标语义幂等，不重复也不漏）。
 * 3. **进度只读不阻塞**：状态是模块级一份快照，端点读它就返回；执行侧只在轮与轮的
 *    边界更新它（不在内层循环里写，省掉上千次无意义赋值）。
 */
import { exportRecords } from './memory-md-export.js';
import { convergeDisabledSuffix } from './memory-md-disable.js';
/** 模块级唯一快照：投影是"同一时刻一个"的任务，不需要多路会话态。 */
const status = {
    running: false, phase: 'idle', pass: 0, done: 0, total: 0,
    written: 0, renamed: 0, detail: '', startedAt: '', endedAt: '',
};
/** 只读快照副本（防调用方改到执行中的那份）。 */
export function mdRunStatus() {
    return { ...status };
}
function blankSuffix() {
    return {
        scanned: 0, renamed: 0, revived: 0, edited: 0, already: 0, both: 0, absent: 0, skipped: 0, remaining: 0, capped: false,
    };
}
/** 让出事件循环一次：滚动期间不能独占 tick（进度端点要能挤进来应答）。 */
function tick() {
    return new Promise((resolveTick) => { setImmediate(resolveTick); });
}
/**
 * 滚到完：先把导出游标推到表尾，再把收敛游标推到表尾。
 *
 * 两阶段分开推进度，是因为收敛必须等导出把该写的文件写完——那时盘态最全，
 * 判"盘上没这份"才准（反过来会把它误报成 `absent`）。
 *
 * @throws 已有任务在跑时抛（不排队，见模块头纪律 1）。
 */
export async function runProjection(deps) {
    if (status.running)
        throw new Error('已有 md 投影任务在跑，请等它结束（进度见面板）');
    const clock = deps.now ?? Date.now;
    const maxPasses = deps.maxPasses ?? 12;
    const totalBudgetMs = deps.totalBudgetMs ?? 300_000;
    const started = clock();
    const total = deps.records.length;
    Object.assign(status, {
        running: true, phase: 'export', pass: 0, done: 0, total,
        written: 0, renamed: 0, detail: `开始投影 ${total} 条`, startedAt: new Date(started).toISOString(), endedAt: '',
    });
    const out = {
        root: '', inWorkspace: 0, scanned: 0, written: 0, unchanged: 0, skipped: 0,
        remaining: 0, capped: false, passes: 0, suffix: blankSuffix(), appliedMaxRecords: deps.maxRecords,
    };
    const agg = blankSuffix();
    try {
        // ── 阶段 A：导出游标 ──
        let cursor = 0;
        for (let pass = 1; cursor < total && pass <= maxPasses; pass++) {
            status.pass = pass;
            status.phase = 'export';
            const rep = await exportRecords({
                records: deps.records.slice(cursor),
                cfgRoot: deps.cfgRoot,
                dataDir: deps.dataDir,
                ledger: deps.ledger,
                maxRecords: deps.maxRecords,
                timeBudgetMs: deps.timeBudgetMs,
                logger: deps.logger,
                now: deps.now,
            });
            out.root = rep.root;
            out.inWorkspace += rep.inWorkspace;
            out.scanned += rep.scanned;
            out.written += rep.written;
            out.unchanged += rep.unchanged;
            out.skipped += rep.skipped;
            status.written = out.written;
            // `remaining` 是"这一轮的输入里没处理完的条数"，所以游标 = 表长 - 剩余。
            cursor = total - rep.remaining;
            status.done = cursor;
            status.detail = `导出第 ${pass} 轮：写 ${rep.written} · 未变 ${rep.unchanged} · 进度 ${cursor}/${total}`;
            out.passes = pass;
            out.capped = rep.capped;
            if (clock() - started >= totalBudgetMs)
                break;
            await tick();
        }
        out.remaining = Math.max(0, total - cursor);
        // ── 阶段 B：收敛游标（导出没滚完时也要跑：已写出的那批的后缀要先对上） ──
        if (out.remaining === 0) {
            let cur2 = 0;
            for (let pass = 1; cur2 < total && pass <= maxPasses; pass++) {
                status.pass = out.passes + pass;
                status.phase = 'converge';
                const s = await convergeDisabledSuffix({
                    records: deps.records.slice(cur2),
                    cfgRoot: deps.cfgRoot,
                    dataDir: deps.dataDir,
                    ledger: deps.ledger,
                    maxRecords: deps.maxRecords,
                    timeBudgetMs: deps.timeBudgetMs,
                    logger: deps.logger,
                    now: deps.now,
                });
                for (const k of ['scanned', 'renamed', 'revived', 'edited', 'already', 'both', 'absent', 'skipped'])
                    agg[k] += s[k];
                agg.remaining = s.remaining;
                agg.capped = s.capped;
                cur2 = total - s.remaining;
                status.renamed = agg.renamed;
                status.done = total + cur2;
                status.detail = `后缀对齐第 ${pass} 轮：改名 ${s.renamed} · 进度 ${cur2}/${total}`;
                out.passes += 1;
                out.capped = s.capped;
                if (clock() - started >= totalBudgetMs)
                    break;
                await tick();
            }
            out.remaining = Math.max(0, total - cur2);
        }
        out.suffix = agg;
        status.phase = out.remaining > 0 ? 'failed' : 'done';
        status.done = total + Math.max(0, Math.min(total, agg.scanned));
        status.detail = out.remaining > 0
            ? `总预算用尽：还剩 ${out.remaining} 个文件，再点一次续跑`
            : `投影完成：写 ${out.written} · 改名 ${agg.renamed} · 共 ${out.passes} 轮`;
        if (out.remaining > 0) {
            status.notice = `单次任务预算（${maxPasses} 轮 / ${totalBudgetMs}ms）用尽，还剩 ${out.remaining} 个文件未处理——再点一次从断点续跑`;
            out.capped = true;
        }
        return out;
    }
    catch (err) {
        status.phase = 'failed';
        status.notice = err instanceof Error ? err.message : String(err);
        throw err;
    }
    finally {
        status.running = false;
        status.endedAt = new Date(clock()).toISOString();
    }
}
