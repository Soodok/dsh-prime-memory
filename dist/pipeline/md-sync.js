/**
 * P2 反向同步：md 投射文件 → 索引（文件是人编辑的那一侧）。
 *
 * 与导出侧（`memory-md-export.ts`）共用同一份落点计算（`targetFor`）、同一个库侧指纹
 * 算法（`recordDigest`）和同一本账本，所以两侧看到的世界一致；写文件这条路**直接复用**
 * `exportRecords`（传单条记录），不另写一套落盘逻辑——两套写盘迟早漂移。
 *
 * 判定一律走**三方**：账本里存着上次投射时的库侧指纹与文件侧指纹，"谁变了"才是可判定的。
 * 四象限（spec P2 裁决表）：
 * - 只有文件变 → 回灌入库，然后把文件重写成规范渲染（正文仍是人写的那段，frontmatter 归一）。
 *   这一步同时消掉写回环：库和文件都回到账本记着的那个状态，下一轮判 `same`。
 * - 只有库变 → 重写文件。
 * - **两边都变 → 什么都不做**，只在报告里挂账。人不裁决机器不许动；两侧保持原样、账本也不动，
 *   所以下次对账还会报同样的 `both`（挂账是持久的，不会悄悄过期）。
 * - 都没变 → 跳过，不刷 mtime。
 *
 * 另有一条独立通道：`.memory.md.disable` 后缀 = 人在文件侧手工判过时 → 退场对应记录
 * （写 valid_to，不进任何检索通路）。这是 `recall-feedback -1` 的文件侧对偶。
 *
 * 两条边界：
 * - 没有账本、也认不出记录的文件 = 人新建的，**不入库**。导入一条新记忆必须过写入内核
 *   的判据面（归一/长度/预算/去重），在这里手搓一条等于绕过那些不变量。只计数。
 * - 遍历范围 = 从记录算出的落点根 ∪ 账本里记过的根。所以"没有任何记录指向的全新 workspace"
 *   不在本轮范围内——它还没有投射根，等它的第一条记忆落进去才可见。
 */
import { opendir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DISABLE_SUFFIX, digest, recordDigest, targetFor } from '../store/memory-md.js';
import { exportRecords } from '../store/memory-md-export.js';
import { parseMdFile } from '../store/memory-md-parse.js';
import { normalizeContentMd } from '../util/md-normalize.js';
/** 投射结构是 `<type>/<stem>.memory.md` 两层，3 层已足够宽容人的整理习惯，再深就是别人的目录。 */
const MAX_DEPTH = 3;
/** 样本上限：报告要进面板，全量路径会把面板撑爆；计数才是判据。 */
const SAMPLE_CAP = 12;
/** 列出一个根下的投射文件（含 `.disable`）。根不存在/没权限 → 空数组，不抛。 */
async function listProjectionFiles(root, budget) {
    const out = [];
    const walk = async (dir, depth) => {
        if (depth > MAX_DEPTH)
            return;
        let dh;
        try {
            dh = await opendir(dir);
        }
        catch {
            return; // 根不存在或不可读：范围本来就按已知根枚举，缺一个根不是错误
        }
        for await (const de of dh) {
            // 链接一律不跟随：越界防护不靠"事后检查解析结果"，靠根本不进链接。
            if (de.isSymbolicLink())
                continue;
            const abs = join(dir, de.name);
            if (de.isDirectory()) {
                // 护栏耗完也要继续走目录：否则"还剩多少个"就没人知道，静默截断等于谎报。
                await walk(abs, depth + 1);
                continue;
            }
            if (!de.isFile())
                continue;
            if (!de.name.endsWith('.memory.md') && !de.name.endsWith(DISABLE_SUFFIX))
                continue;
            if (budget.files <= 0) {
                budget.dropped += 1;
                continue;
            }
            budget.files -= 1;
            out.push(abs);
        }
    };
    await walk(root, 0);
    return out;
}
/**
 * 这条文件对哪条记录。
 *
 * 先按账本记的 id；id 找不到（merge 会重铸 id，F1/F21）就按文件名干找 `name`。
 * 两把钥匙都开不了才算找不到。
 */
function pickRecord(store, id, fileName) {
    const byId = id.length > 0 ? store.getByIds([id])[0] : undefined;
    if (byId !== undefined)
        return byId;
    const stem = fileName.replace(DISABLE_SUFFIX, '').replace(/\.memory\.md$/, '');
    if (stem.length === 0)
        return undefined;
    const byName = store.findIdByName(stem);
    return byName === undefined ? undefined : store.getByIds([byName])[0];
}
/** 写账（`.disable` 专用：那条路径不是 `targetFor` 会算出来的路径，所以只能手写字段）。 */
async function stampDisabled(ledger, rec, abs, text) {
    const st = await stat(abs).catch(() => undefined);
    const cut = abs.lastIndexOf('/');
    const back = abs.lastIndexOf('\\');
    const sepAt = Math.max(cut, back);
    const entry = {
        id: rec.id,
        extKey: rec.extKey ?? '',
        root: sepAt > 0 ? abs.slice(0, sepAt) : '',
        relPath: sepAt > 0 ? abs.slice(sepAt + 1) : abs,
        dbDigest: recordDigest(rec),
        fileDigest: digest(text),
        fileMtimeMs: st?.mtimeMs ?? 0,
        fileSize: st?.size ?? 0,
        syncedAt: new Date().toISOString(),
    };
    ledger.set(abs, entry);
}
/**
 * 反向同步一轮。
 *
 * @param deps - 见 `MdSyncDeps`。
 * @returns 同步报告（含挂账样本与剩余量）。任何单条失败只计数并留痕，绝不抛挂整轮。
 */
export async function syncFromFiles(deps) {
    const { store, ledger, cfgRoot, dataDir, logger } = deps;
    const now = deps.now ?? Date.now;
    const startedAt = now();
    const report = {
        roots: 0,
        scanned: 0,
        imported: 0,
        rendered: 0,
        same: 0,
        skipped: 0,
        pending: 0,
        retired: 0,
        newFiles: 0,
        orphan: 0,
        remaining: 0,
        capped: false,
        samples: [],
    };
    const sample = (path, action) => {
        if (report.samples.length < SAMPLE_CAP)
            report.samples.push({ path, action });
    };
    // 根集合：记录算出的落点根 ∪ 账本记过的根。后者让人改过 workspaceId、或记录已被
    // 裁撤之后，残留文件仍能被看见并挂账，而不是凭空蒸发。
    const roots = new Set();
    for (const r of store.all())
        roots.add(targetFor(r, cfgRoot, dataDir, logger).root);
    for (const e of ledger.all())
        if (e.root.length > 0)
            roots.add(e.root);
    report.roots = roots.size;
    const budget = { files: Math.max(0, Math.trunc(deps.maxFiles)), dropped: 0 };
    const files = [];
    for (const root of roots) {
        for (const f of await listProjectionFiles(root, budget))
            files.push(f);
    }
    // 护栏掉过文件 = 本轮结论只覆盖一部分，必须说出去（和墙钟截断同一个口径）。
    if (budget.dropped > 0) {
        report.capped = true;
        report.remaining = budget.dropped;
    }
    for (const abs of files) {
        // 两条护栏都在循环顶部查：写在末尾会被 continue 跳过（导出侧的测试抓过这个 bug）。
        if (now() - startedAt > deps.timeBudgetMs) {
            report.capped = true;
            report.remaining = files.length - report.scanned;
            break;
        }
        report.scanned += 1;
        let text = '';
        try {
            text = await readFile(abs, 'utf8');
        }
        catch (err) {
            report.skipped += 1;
            logger?.warn(`[memory] md 同步跳过（读不出）: ${abs} - ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }
        const fileName = abs.slice(Math.max(abs.lastIndexOf('/'), abs.lastIndexOf('\\')) + 1);
        const entry = ledger.get(abs);
        const rec = pickRecord(store, entry?.id ?? '', fileName);
        // ---- `.disable` → 退场（后缀本身就是裁决，不参与指纹比较） ----
        if (fileName.endsWith(DISABLE_SUFFIX)) {
            if (rec === undefined) {
                report.orphan += 1;
                sample(abs, 'disable: 找不到对应记录');
                continue;
            }
            if (rec.validTo !== undefined) {
                report.same += 1;
                if (entry === undefined)
                    await stampDisabled(ledger, rec, abs, text);
                continue;
            }
            store.retire([rec.id], { at: new Date().toISOString(), reason: 'obsolete' });
            const fresh = store.getByIds([rec.id])[0] ?? rec;
            await stampDisabled(ledger, fresh, abs, text);
            report.retired += 1;
            sample(abs, 'disable: 已退场');
            continue;
        }
        const parsed = parseMdFile(text);
        if (parsed === undefined) {
            report.skipped += 1;
            logger?.warn(`[memory] md 同步跳过（形状不符，不接受非投射格式）: ${abs}`);
            continue;
        }
        if (rec === undefined) {
            report.newFiles += 1;
            sample(abs, '新文件: 未入库（导入须过写入内核）');
            continue;
        }
        const dbChanged = entry === undefined || entry.dbDigest !== recordDigest(rec);
        const fileChanged = entry === undefined || entry.fileDigest !== digest(text);
        if (dbChanged && fileChanged) {
            report.pending += 1;
            sample(abs, 'both: 挂待裁决（两侧都不动）');
            logger?.warn(`[memory] md 同步挂账（两边都变，等人裁决）: ${abs} record=${rec.id}`);
            continue;
        }
        if (!dbChanged && !fileChanged) {
            report.same += 1;
            continue;
        }
        const one = (records) => exportRecords({
            records,
            cfgRoot,
            dataDir,
            ledger,
            maxRecords: 1,
            timeBudgetMs: Math.max(1, deps.timeBudgetMs),
            logger,
            now: deps.now,
        });
        if (dbChanged) {
            // 只有库变 → 重写文件（走导出侧同一条写盘路）。
            const sub = await one([rec]);
            if (sub.skipped > 0) {
                report.skipped += 1;
                continue;
            }
            report.rendered += 1;
            sample(abs, sub.written > 0 ? '库侧更新 → 重写文件' : '库侧更新 → 文件已一致');
            continue;
        }
        // 只有文件变 → 回灌入库，再把文件重写成规范渲染（消写回环）。
        // 入库前同样过一道版式归一：两头用同一个函数，才能保证“库里的内容”与“渲染出的正文”
        // 是同一个形状，下一轮才判得出 `same`（P4.2）。
        const updated = {
            ...rec,
            content: normalizeContentMd(parsed.content),
            updatedAt: now(),
            version: (rec.version ?? 0) + 1,
        };
        try {
            await store.appendNew([updated]);
        }
        catch (err) {
            report.skipped += 1;
            logger?.warn(`[memory] md 回灌失败（跳过，不动文件）: ${abs} - ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }
        const sub = await one([updated]);
        if (sub.skipped > 0) {
            // 入库成功但文件没回去：账本停在旧基线，下一轮会再报 fileOnly（文件其实已被我们
            // 的入库改成了新内容，但渲染落盘失败）。留痕，不静默。
            logger?.warn(`[memory] md 回灌后重渲染失败（下一轮仍会挂同一象限）: ${abs}`);
        }
        report.imported += 1;
        sample(abs, '文件侧更新 → 回灌入库');
    }
    await ledger.flush();
    return report;
}
