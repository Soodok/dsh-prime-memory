/**
 * md 投射的导出与对账（P1 / N1 + N9）。
 *
 * 两个函数共享同一套路径纪律，但**权限面完全不同**：
 * - `exportRecords` 写文件、写账本，**一字不改库**（导出前后 `hashRecords` 必须相同，
 *   用例钉住这条）；
 * - `reconcileLedger` 什么都不写，只按账本与磁盘现状出四态报告——"看看差在哪"
 *   不该需要高权限，`memoryMutate` 的门留给 P2 的真同步。
 *
 * 有界性照 `wing-backfill` / `workspace-relink` 的既有口径：`maxRecords` 与
 * `timeBudgetMs` 双护栏，**扫描阶段也查墙钟**（只数条数不看时间，一条超大记录就能
 * 把一次点击挂死），剩余条数如实回报 `remaining`，由用户再点一次继续。
 */
import { isAbsolute, relative, resolve } from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { digest, recordDigest, renderRecord } from './memory-md.js';
/** 让出事件循环一次：投射是长任务，不能独占 tick（面板会僵）。 */
function tick() {
    return new Promise((resolveTick) => { setImmediate(resolveTick); });
}
/**
 * 解析投射根目录。
 *
 * 给了 `cfgRoot` 就用它（必须是绝对路径且不含 `..`），否则默认 `<dataDir>/memories`。
 * **不合法只回退默认并 warn，绝不抛错**：投射是旁路，旁路配置写错不能弄挂记忆本体。
 */
export function resolveMemoriesRoot(cfgRoot, dataDir, logger) {
    const raw = (cfgRoot ?? '').trim();
    if (raw.length === 0)
        return resolve(dataDir, 'memories');
    if (!isAbsolute(raw) || raw.includes('..')) {
        logger?.warn(`[memory] mdExport.root 不是无 .. 的绝对路径，回退默认根: ${raw}`);
        return resolve(dataDir, 'memories');
    }
    return resolve(raw);
}
/**
 * 把渲染出的相对路径安全地拼到根下。
 *
 * 越界（绝对路径、`..` 跳出、盘符切换）一律返回 `undefined` 由调用方跳过并 warn——
 * 记录内容是人/模型写的，它可能包含 `../../`，这里必须是结构性挡死而不是"应该不会有"。
 */
export function safeJoin(root, relPath) {
    if (relPath.length === 0 || isAbsolute(relPath))
        return undefined;
    const target = resolve(root, relPath);
    const rel = relative(root, target);
    if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel))
        return undefined;
    return target;
}
/**
 * 单向导出：库 → 文件 + 账本。
 *
 * 每次**全量重写**该写的：增量 patch 与内容指纹判据互相打脸（patch 的前提是"我知道
 * 差在哪"，而那正是指纹要回答的）。指纹一致就跳过，不刷 mtime——刷了会让下一轮
 * 对账把"我们没动过"误判成"文件被改过"。
 */
export async function exportRecords(deps) {
    const { records, root, ledger, logger } = deps;
    const startedAt = (deps.now ?? Date.now)();
    const report = { root, scanned: 0, written: 0, unchanged: 0, skipped: 0, remaining: 0, capped: false };
    for (let i = 0; i < records.length; i++) {
        // 两条护栏都在**循环顶部**查：写在末尾会被 `continue` 跳过（自家测试抓过这个 bug）。
        if (report.scanned >= deps.maxRecords || (deps.now ?? Date.now)() - startedAt >= deps.timeBudgetMs) {
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
        const { relPath, text } = renderRecord(r);
        const target = safeJoin(root, relPath);
        if (target === undefined) {
            report.skipped++;
            logger?.warn(`[memory] md 投射跳过（路径越界）: ${r.id} → ${relPath}`);
            continue;
        }
        const dbDg = recordDigest(r);
        const fileDg = digest(text);
        try {
            const existing = await readFile(target, 'utf8').catch(() => undefined);
            if (existing !== undefined && digest(existing) === fileDg) {
                report.unchanged++;
                // 内容没变也要补账：首轮导出前账本是空的，不补就永远判不出"文件被改过"。
                if (ledger.get(relPath) === undefined)
                    await stamp(ledger, r, relPath, dbDg, fileDg, target);
                await tick();
                continue;
            }
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, text, 'utf8');
            report.written++;
            await stamp(ledger, r, relPath, dbDg, fileDg, target);
        }
        catch (err) {
            report.skipped++;
            logger?.warn(`[memory] md 投射单条失败(跳过，不影响其余): ${relPath} - ${err instanceof Error ? err.message : String(err)}`);
        }
        await tick();
    }
    await ledger.flush();
    return report;
}
/** 写账：文件侧字段取**落盘后**的真实 stat，不取内存值（否则对账基线就是假的）。 */
async function stamp(ledger, r, relPath, dbDg, fileDg, target) {
    const st = await stat(target).catch(() => undefined);
    const entry = {
        id: r.id,
        extKey: r.extKey ?? '',
        relPath,
        dbDigest: dbDg,
        fileDigest: fileDg,
        fileMtimeMs: st?.mtimeMs ?? 0,
        fileSize: st?.size ?? 0,
        syncedAt: new Date().toISOString(),
    };
    ledger.set(entry);
}
/**
 * 只读对账：按账本基线判每条记录落在哪个象限。
 *
 * 判据是**三方**的（基线 = 账本里的两个 digest）：
 * `dbDigest ≠ 现在库内容` → 库动过；`fileDigest ≠ 现在文件内容` → 动过文件。
 * 两方比较必吃一边，这就是账本要同时存两个 digest 的原因。
 */
export async function reconcileLedger(deps) {
    const { records, root, ledger, logger } = deps;
    const startedAt = (deps.now ?? Date.now)();
    const counts = { firstTime: 0, same: 0, dbOnly: 0, fileOnly: 0, both: 0, missingFile: 0 };
    const samples = [];
    const sampleCap = deps.sampleCap ?? 10;
    let scanned = 0;
    let capped = false;
    for (let i = 0; i < records.length; i++) {
        if (scanned >= deps.maxRecords || (deps.now ?? Date.now)() - startedAt >= deps.timeBudgetMs) {
            capped = true;
            break;
        }
        const r = records[i];
        scanned++;
        if (r === undefined)
            continue;
        const { relPath } = renderRecord(r);
        const entry = ledger.get(relPath);
        const push = (state) => {
            counts[state]++;
            if (samples.length < sampleCap)
                samples.push({ relPath, id: r.id, state });
        };
        if (entry === undefined) {
            push('firstTime');
            await tick();
            continue;
        }
        const target = safeJoin(root, relPath);
        if (target === undefined) {
            push('missingFile');
            logger?.warn(`[memory] 对账遇到越界路径: ${relPath}`);
            await tick();
            continue;
        }
        const existing = await readFile(target, 'utf8').catch(() => undefined);
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
