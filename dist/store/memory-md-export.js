/**
 * md 投射的导出与对账（P1 / N1 + N9）。
 *
 * 两个函数共享同一套路径纪律，但**权限面完全不同**：
 * - `exportRecords` 写文件、写账本，**一字不改库**（导出前后 `hashRecords` 必须相同，
 *   用例钉住这条）；
 * - `reconcileLedger` 什么都不写，只按账本与磁盘现状出四态报告——"看看差在哪"
 *   不该需要高权限，`memoryMutate` 的门留给 P2 的真同步。
 *
 * 有界性照 `wing-backfill` / `workspace-relink` 的既有口径，但**配额数的是「动作」不是「遍历」**：
 * `maxRecords` 只约束真碰了磁盘的条数（写入 / 补账 / 失败），判为「未变且已记账」的不吃配额。
 * 原来的写法把未变也计入配额，于是**第二次点击扫的还是同一批前 N 条**，`remaining` 恒等于
 * 同一个数——真机实测「已写 9 · 未变 291 · 剩余 866」点多少次都停在 300。扫描总量改由
 * `timeBudgetMs` 兜底（只数条数不看时间，一条超大记录就能把一次点击挂死，这条理由不变），
 * 剩余条数照旧如实回报 `remaining`。
 */
import { dirname } from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { digest, recordDigest, renderRecord, safeJoin, targetFor, resolveMemoriesRoot } from './memory-md.js';
// 路径纪律已收到 `memory-md.ts`（N10 后导出/对账/失效/归档四处共用）；这里再导一次
// 只为不拆已有调用方（stats.ts 与用例都从本模块拿它们）。
export { resolveMemoriesRoot, safeJoin };
/** 让出事件循环一次：投射是长任务，不能独占 tick（面板会僵）。 */
function tick() {
    return new Promise((resolveTick) => { setImmediate(resolveTick); });
}
/**
 * 单向导出：库 → 文件 + 账本。
 *
 * 每次**全量重写**该写的：增量 patch 与内容指纹判据互相打脸（patch 的前提是"我知道
 * 差在哪"，而那正是指纹要回答的）。指纹一致就跳过，不刷 mtime——刷了会让下一轮
 * 对账把"我们没动过"误判成"文件被改过"。
 */
export async function exportRecords(deps) {
    const { records, cfgRoot, dataDir, ledger, logger } = deps;
    const startedAt = (deps.now ?? Date.now)();
    const root = resolveMemoriesRoot(cfgRoot, dataDir, logger);
    const report = { root, inWorkspace: 0, scanned: 0, written: 0, unchanged: 0, skipped: 0, remaining: 0, capped: false };
    // 吃配额的只有**碰过磁盘**的条数：写入、未变但补账、以及失败的那条（它已经碰过盘）。
    let worked = 0;
    for (let i = 0; i < records.length; i++) {
        // 两条护栏都在**循环顶部**查：写在末尾会被 `continue` 跳过（自家测试抓过这个 bug）。
        if (worked >= deps.maxRecords || (deps.now ?? Date.now)() - startedAt >= deps.timeBudgetMs) {
            report.capped = true;
            report.remaining = records.length - i;
            break;
        }
        const r = records[i];
        // 防御：`records` 来自 `store.all()`，类型上是满的，但 noUncheckedIndexedAccess
        // 下的 client 程序会把它当 `| undefined`——这里不猜，直接跳过。
        if (r === undefined) {
            report.skipped++;
            continue;
        }
        report.scanned++;
        // N10：落点由 `targetFor` 一个函数定（workspace 优先），账本键 = 绝对路径。
        const target = targetFor(r, cfgRoot, dataDir, logger);
        if (target.absPath === undefined) {
            report.skipped++;
            logger?.warn(`[memory] md 投射跳过（路径越界）: ${r.id} → ${target.relPath}`);
            continue;
        }
        const { text } = renderRecord(r);
        const abs = target.absPath;
        if (target.inWorkspace)
            report.inWorkspace++;
        const dbDg = recordDigest(r);
        const fileDg = digest(text);
        try {
            const existing = await readFile(abs, 'utf8').catch(() => undefined);
            if (existing !== undefined && digest(existing) === fileDg) {
                report.unchanged++;
                // 内容没变也要补账：首轮导出前账本是空的，不补就永远判不出"文件被改过"。
                // 补账要吃配额（它写盘），纯未变不吃——否则「再点一次」永远在同一批上打转。
                if (ledger.get(abs) === undefined) {
                    try {
                        await stamp(ledger, r, target.root, target.relPath, abs, dbDg, fileDg);
                        worked++;
                    }
                    catch (err) {
                        // 文件与库都没动，只是没记上账：不能算 skipped（它没失败），也不能反回退成未计。
                        logger?.warn(`[memory] md 投射补账失败(下轮仍会重补): ${abs} - ${err instanceof Error ? err.message : String(err)}`);
                    }
                }
                await tick();
                continue;
            }
            await mkdir(dirname(abs), { recursive: true });
            await writeFile(abs, text, 'utf8');
            report.written++;
            worked++;
            // 盘已经写成功了，之后记账失败**不能再算成 skipped**：同一条既 written 又 skipped
            // 会让三个计数加起来大于 scanned（自家基准测出 1200 条同时报「写 1200 跳 1200」），
            // 而报告是给人判断「这批要不要重来」的依据，自洽性比分类精细更要紧。
            try {
                await stamp(ledger, r, target.root, target.relPath, abs, dbDg, fileDg);
            }
            catch (err) {
                logger?.warn(`[memory] md 投射已落盘但记账失败(下轮仍会重写这条): ${abs} - ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        catch (err) {
            report.skipped++;
            worked++;
            logger?.warn(`[memory] md 投射单条失败(跳过，不影响其余): ${abs} - ${err instanceof Error ? err.message : String(err)}`);
        }
        await tick();
    }
    await ledger.flush();
    return report;
}
/** 写账：文件侧字段取**落盘后**的真实 stat，不取内存值（否则对账基线就是假的）。 */
async function stamp(ledger, r, root, relPath, absPath, dbDg, fileDg) {
    const st = await stat(absPath).catch(() => undefined);
    const entry = {
        id: r.id,
        extKey: r.extKey ?? '',
        root,
        relPath,
        dbDigest: dbDg,
        fileDigest: fileDg,
        fileMtimeMs: st?.mtimeMs ?? 0,
        fileSize: st?.size ?? 0,
        syncedAt: new Date().toISOString(),
    };
    ledger.set(absPath, entry);
}
/**
 * 只读对账：按账本基线判每条记录落在哪个象限。
 *
 * 判据是**三方**的（基线 = 账本里的两个 digest）：
 * `dbDigest ≠ 现在库内容` → 库动过；`fileDigest ≠ 现在文件内容` → 动过文件。
 * 两方比较必吃一边，这就是账本要同时存两个 digest 的原因。
 */
export async function reconcileLedger(deps) {
    const { records, cfgRoot, dataDir, ledger, logger } = deps;
    const startedAt = (deps.now ?? Date.now)();
    const root = resolveMemoriesRoot(cfgRoot, dataDir, logger);
    const counts = { firstTime: 0, same: 0, dbOnly: 0, fileOnly: 0, both: 0, missingFile: 0 };
    const samples = [];
    const sampleCap = deps.sampleCap ?? 10;
    let scanned = 0;
    // 与导出同口径：`maxRecords` 数的是**需要人处理差异**的条数，`same` 不吃配额。
    // 否则一个已经收敛的库会把配额全花在“确认没差”上，真正要看的差异反而被护到窗外。
    let worked = 0;
    let capped = false;
    for (let i = 0; i < records.length; i++) {
        if (worked >= deps.maxRecords || (deps.now ?? Date.now)() - startedAt >= deps.timeBudgetMs) {
            capped = true;
            break;
        }
        const r = records[i];
        scanned++;
        if (r === undefined)
            continue;
        // 与导出同一个 `targetFor`：否则“库侧算出的落点”与“导出时写的落点”会不一致，
        // 对账就只会报“文件缺失”。
        const target = targetFor(r, cfgRoot, dataDir, logger);
        const abs = target.absPath;
        const entry = abs === undefined ? undefined : ledger.get(abs);
        const push = (state) => {
            counts[state]++;
            if (state !== 'same')
                worked++;
            if (samples.length < sampleCap)
                samples.push({ relPath: target.relPath, id: r.id, state });
        };
        if (abs === undefined) {
            push('missingFile');
            logger?.warn(`[memory] 对账遇到越界路径: ${target.relPath}`);
            await tick();
            continue;
        }
        if (entry === undefined) {
            push('firstTime');
            await tick();
            continue;
        }
        const existing = await readFile(abs, 'utf8').catch(() => undefined);
        if (existing === undefined) {
            push('missingFile');
            await tick();
            continue;
        }
        // 两个“变了”都是**相对账本基线**判的，不能拿“与现在会渲染出的文本不同”当依据：
        // 库一变渲染就变，那会把纯粹的 dbOnly 误判成“文件也被人改了”，象限表全盘跑偏。
        const dbChanged = entry.dbDigest !== recordDigest(r);
        const fileChanged = digest(existing) !== entry.fileDigest;
        if (dbChanged && fileChanged)
            push('both');
        else if (dbChanged)
            push('dbOnly');
        else if (fileChanged)
            push('fileOnly');
        else
            push('same');
        await tick();
    }
    return { root, capped, scanned, ...counts, samples };
}
