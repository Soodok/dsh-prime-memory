/**
 * md 投射文件的解析（P2 反向同步的读侧）。
 *
 * 只认 `memory-md.ts` 自己渲染出来的那种 frontmatter：`key: <JSON 值>`，正文在第二个
 * `---` 之后。**不做通用 YAML**——通用解析器会接受我们从不产出的形状，那些形状进到
 * 回灌路径就是"看起来能读、读回来是垃圾"。解析不出来就返回 `undefined`，调用方跳过并
 * 计数；绝不猜、绝不抛。
 *
 * 一条刻意的不对称：文件里的 `id` 只当**线索**，不当身份。id 每轮新铸（F1），一次合并
 * 就换；真正认人靠账本键（绝对路径）与 `name`。
 */
/** 取 frontmatter 块：首行必须是 `---`，到下一个 `---` 为止。 */
function splitFrontmatter(text) {
    // BOM 与 CRLF 都要先吃掉：人在记事本里改一行就会引入 \r，而 `\r` 会让 key 匹配不上。
    const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    if (lines.length < 2 || lines[0].trim() !== '---')
        return undefined;
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (end < 0)
        return undefined;
    return { meta: lines.slice(1, end), body: lines.slice(end + 1).join('\n').trim() };
}
/** 一行 `key: <JSON>` → [key, 值]；值解析失败则退回原始字符串。 */
function readLine(line) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (m === null)
        return undefined;
    const raw = m[2];
    if (raw.length === 0)
        return [m[1], ''];
    try {
        return [m[1], JSON.parse(raw)];
    }
    catch {
        return [m[1], raw];
    }
}
function str(v) {
    return typeof v === 'string' ? v : '';
}
/**
 * 解析一个投射文件。
 *
 * @param text - 文件全文。
 * @returns 解析结果；形状不符（无 frontmatter / 无正文 / 键全不认识）时 `undefined`。
 */
export function parseMdFile(text) {
    const parts = splitFrontmatter(text);
    if (parts === undefined)
        return undefined;
    const fields = new Map();
    for (const line of parts.meta) {
        const kv = readLine(line);
        if (kv !== undefined)
            fields.set(kv[0], kv[1]);
    }
    // 正文为空 = 这条记忆没内容了。人手工清空正文不该被回灌成"一条空记忆"，
    // 那既不是有效输入，也会让对账以为文件是权威。
    if (parts.body.length === 0)
        return undefined;
    const scenario = Array.isArray(fields.get('usageScenario'))
        ? fields.get('usageScenario').filter((s) => typeof s === 'string' && s.length > 0)
        : [];
    const prio = Number(fields.get('priority'));
    return {
        name: str(fields.get('name')),
        type: str(fields.get('type')),
        priority: Number.isFinite(prio) ? prio : 60,
        createdAt: str(fields.get('createdAt')),
        updatedAt: str(fields.get('updatedAt')),
        usageScenario: scenario,
        extKey: str(fields.get('extKey')),
        id: str(fields.get('id')),
        retired: fields.get('retired') === true,
        content: parts.body,
    };
}
