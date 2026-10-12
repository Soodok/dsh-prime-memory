/**
 * P3 归档面：退场批次被物理删除时，把它的人类可读归档正文与投射文件一起收进**快照目录**。
 *
 * 两个刻意的决定：
 *
 * ① **归档不另起目录树，就住在快照目录里**（`<dataDir>/snapshots/<name>/`）。计划里原本写
 *    `<dataDir>/archives/<name>/`，但那样一次清理就有两个"批次"事实源（快照一份、归档一份），
 *    名字对不上时没人能回答"这批到底删了什么"。住在一起之后：`manifest.json` 是库内容快照、
 *    `retired.md` 是给人读的归档正文、`files/` 是搬进来的投射文件——同一个批次名寻址，
 *    `snapshot-restore` 天然还能用得上。名字白名单也因此**直接继承** `isSnapshotName`
 *    （长度上限 / 固定前缀 / 禁 `/ \ ..`），不需要再造一个 `isArchiveName`，更不吃调用方的绝对路径。
 *
 * ② **搬运在物理删除之后**，且失败只 warn。库删了是既成事实，文件留在原地是可修的不对称
 *    （下一次导出会按 `retired` 把它们重写回去）；反过来先搬文件再删库，一旦删除中止就变成
 *    "记录还活着、文件已经不见了"，那才是真的说不清。
 */
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { disablePathOf, renderRecord, targetFor } from './memory-md.js';
/** 归档正文文件名（人在归档目录里第一个该看见的东西）。 */
export const ARCHIVE_MD = 'retired.md';
/** 投射文件在归档里的落点子目录。 */
export const ARCHIVE_FILES_DIR = 'files';
/** 换行符（取字符码，避开任何转义写法）。 */
const NL = String.fromCharCode(10);
/**
 * 收集这批记录在磁盘上存在的投射文件。
 *
 * 只 `stat`，不读内容——归档要的是"把原物搬走"，不是"按当前库重渲染一份"。
 *
 * @param records - 待清理的记录（已退场那批）。
 * @param cfgRoot - `cfg.memExport.root`。
 * @param dataDir - 插件数据目录。
 * @param logger - 宿主日志接口。
 * @returns `recordId → 文件[]`；没有任何文件时返回**空 Map**（调用方据此走旧行为）。
 */
export async function collectProjectionFiles(records, cfgRoot, dataDir, logger) {
    const map = new Map();
    for (const r of records) {
        const target = targetFor(r, cfgRoot, dataDir, logger);
        if (target.absPath === undefined)
            continue;
        // `.disable` 优先：退场记录在文件侧的标准形态就是它（N11）。两个都在就都搬。
        const candidates = [
            { absPath: disablePathOf(target.absPath), inWorkspace: target.inWorkspace },
            { absPath: target.absPath, inWorkspace: target.inWorkspace },
        ];
        const found = [];
        for (const c of candidates) {
            try {
                const st = await stat(c.absPath);
                if (st.isFile())
                    found.push(c);
            }
            catch {
                // 没文件是常态（没开过投射、或这条从没导出过）：静默跳过，不刷日志
            }
        }
        if (found.length > 0)
            map.set(r.id, found);
    }
    return map;
}
/**
 * 渲染归档正文：按 `type` 分片的单一 Markdown，每条一节。
 *
 * frontmatter 与投射文件同构（同一份 `renderRecord`），只往里插两行退场信息——这样
 * "归档里读到的"和"当初磁盘上的"是同一个形状，人不需要在两套元数据格式之间换算。
 */
export function renderArchiveMarkdown(records, meta) {
    const head = [
        `# 退场记忆归档（${records.length} 条）`,
        '',
        `- 批次原因：${meta.reason}`,
        `- 归档时刻：${meta.at.toISOString()}`,
    ];
    if (meta.note !== undefined && meta.note.trim().length > 0)
        head.push(`- 备注：${meta.note.trim()}`);
    head.push('');
    const byType = new Map();
    for (const r of records) {
        const key = r.type.length > 0 ? r.type : 'unsorted';
        const bucket = byType.get(key);
        if (bucket === undefined)
            byType.set(key, [r]);
        else
            bucket.push(r);
    }
    const sections = [];
    for (const type of [...byType.keys()].sort()) {
        const rows = [`## ${type}`, ''];
        for (const r of byType.get(type) ?? []) {
            const retiredAt = r.validTo === undefined ? meta.at.toISOString() : new Date(r.validTo).toISOString();
            // 只往开栏后插两行，闭栏与正文一律不动：插进闭栏之后就成了正文的一部分。
            // 这里刻意不用转义写法拼字符串（同一份产物里换行被展开过一次，正则字面量直接断法），
            // 改成找第一个换行位置做切片——形状依赖的是文件真实结构，不是写法。
            const { text } = renderRecord(r);
            const at = text.indexOf(NL);
            const extra = `retiredAt: ${JSON.stringify(retiredAt)}${NL}retireReason: ${JSON.stringify(meta.reason)}`;
            rows.push(at < 0 ? text : `${text.slice(0, at)}${NL}${extra}${text.slice(at)}`);
            rows.push('');
        }
        sections.push(rows.join('\n'));
    }
    return `${head.join('\n')}\n${sections.join('\n')}`;
}
/**
 * 写归档正文。失败**抛出**：正文是这批数据的唯一人可读物，写不成得让调用方知道
 * （搬运失败则相反——那只影响便利度，不影响事实）。
 */
export async function writeArchiveMarkdown(dir, records, meta) {
    const path = join(dir, ARCHIVE_MD);
    await mkdir(dir, { recursive: true });
    await writeFile(path, renderArchiveMarkdown(records, meta), 'utf8');
    return path;
}
/**
 * 把这批记录的投射文件搬进归档目录。
 *
 * 目标形状 `<归档根>/files/<ws|home>/<type>/<原文件名>`（自顶向下建目录）。失败只计数并
 * 留痕——绝不因为文件搬不动而回滚库删除（不对称的方向是"文件可重生成，库删了不可逆"）。
 *
 * @param dir - 归档根（= 快照目录）。
 * @param records - 该批记录（用 id 与 `files` 配对）。
 * @param files - `collectProjectionFiles` 的产物。
 * @param logger - 只需要 warn（清理侧的 logger 形状比 MemoryLogger 狭，这里不装宽）。
 * @returns 搬运计数。
 */
export async function moveProjectionFiles(dir, records, files, logger) {
    const out = { moved: 0, failed: 0, absent: 0 };
    if (files.size === 0)
        return out;
    for (const r of records) {
        const entry = files.get(r.id);
        if (entry === undefined) {
            out.absent += 1;
            continue;
        }
        const type = r.type.length > 0 ? r.type : 'unsorted';
        for (const f of entry) {
            const side = f.inWorkspace ? 'ws' : 'home';
            const toDir = join(dir, ARCHIVE_FILES_DIR, side, type);
            try {
                await mkdir(toDir, { recursive: true });
                await rename(f.absPath, join(toDir, basename(f.absPath)));
                out.moved += 1;
            }
            catch (err) {
                out.failed += 1;
                logger?.warn(`[memory] 归档搬运失败（库已删，文件留在原地）: ${f.absPath} - ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
    return out;
}
