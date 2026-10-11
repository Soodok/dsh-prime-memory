/**
 * 外部来源只读扫描（轨3 Connect，3.4）。
 *
 * **只读预览，绝不写库**：遍历已登记来源 → 找 `.mem` 包 → `parseBundle` → `prefilter.plan`
 * 与现存基线比对 → 产出四桶计数 + 新记录样本。真正的落库由上层（agent 调 `memory_import`，
 * 携 source_id 走 P0 的 ext_key 幂等 + 脱敏）完成——扫描本身不碰写入面，
 * 因此不重复 memory_import 的 `__manual__`/supersede/redact 门禁（那些在写侧强制）。
 *
 * 卫生边界：
 * - 单源/单包读失败**只记 error 不抛**，不阻断其余来源（对齐 sidecar 降级铁律）；
 * - `.mem` 才是 interchange 载体；非 .mem 路径记一条提示，引导先跑 `memport 导出`；
 * - 记录数受 `maxRecords` 上限（防极端大包在 RPC 事件循环里阻塞）；
 * - 预览正文**截断**，且不外传整文件内容——完整脱敏留给写侧 memory_import。
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { contentHash, parseBundle } from './format.js';
import { plan } from './prefilter.js';
const MEM_EXT = '.mem';
const MAX_FILES_PER_SOURCE = 50;
const SAMPLE_CAP = 8;
const SAMPLE_CHARS = 90;
async function collectMemFiles(root) {
    const st = await stat(root);
    if (st.isFile())
        return root.toLowerCase().endsWith(MEM_EXT) ? [root] : [];
    if (!st.isDirectory())
        return [];
    const names = await readdir(root);
    return names.filter((n) => n.toLowerCase().endsWith(MEM_EXT)).slice(0, MAX_FILES_PER_SOURCE).map((n) => join(root, n));
}
/** 扫描一批来源（只读）。返回每个来源的四桶预览（含失败原因）。 */
export async function scanSources(opts) {
    const { sources, l1, maxRecords } = opts;
    // 现存基线（id + content + 规范化哈希）——供 plan 做 dup/near-dup 比对。
    const existing = l1.all().map((r) => ({ id: r.id, content: r.content, hash: contentHash(r.content ?? '') }));
    const out = [];
    for (const src of sources) {
        const result = {
            sourceId: src.id,
            label: src.label,
            files: 0,
            total: 0,
            errors: [],
            counts: { dup: 0, 'near-dup': 0, 'conflict-candidate': 0, new: 0 },
            sampleNew: [],
        };
        out.push(result);
        if (!isAbsolute(src.path)) {
            result.errors.push(`来源 path 非绝对路径，已跳过：${src.path}`);
            continue;
        }
        let files;
        try {
            files = await collectMemFiles(src.path);
        }
        catch (err) {
            result.errors.push(`读取失败：${src.path}（${err instanceof Error ? err.message : String(err)}）`);
            continue;
        }
        if (files.length === 0) {
            result.errors.push(`${src.path} 下未发现 .mem 包（先用「memport 导出」在该工具侧生成，或把 .mem 落到此路径）`);
            continue;
        }
        const acc = [];
        for (const f of files) {
            if (acc.length >= maxRecords)
                break;
            let text;
            try {
                text = await readFile(f, 'utf8');
            }
            catch (err) {
                result.errors.push(`${f}: 读取失败（${err instanceof Error ? err.message : String(err)}）`);
                continue;
            }
            const b = parseBundle(text);
            if (b.errors.length) {
                result.errors.push(`${f}: 校验失败——${b.errors[0]}${b.errors.length > 1 ? `（共 ${b.errors.length} 项）` : ''}`);
                continue;
            }
            result.files++;
            for (const rec of b.records) {
                if (acc.length >= maxRecords)
                    break;
                acc.push(rec);
            }
        }
        result.total = acc.length;
        if (acc.length === 0)
            continue;
        const { rows, counts } = plan(acc, existing, { srcTag: src.id });
        result.counts = counts;
        result.sampleNew = rows
            .filter((r) => r.verdict === 'new')
            .slice(0, SAMPLE_CAP)
            .map((r) => ({ type: r.typeFull, content: r.content.length > SAMPLE_CHARS ? r.content.slice(0, SAMPLE_CHARS) + '…' : r.content }));
    }
    return out;
}
