/**
 * 记忆正文的 markdown 版式归一（P4.2「格式需要标准化」）。
 *
 * 只做**版式**，不做**语义**：不 bullet 化散文、不插 H1、不往正文里塞元数据（元数据一律在
 * frontmatter）。三条理由：
 * - 散文转列表会把"因为/所以/但是"这类连接关系拆散，且拆完不可逆；
 * - 正文一旦带骨架，`parseMdFile` 的往返一致性（P2）就得反向剪枝，两套逻辑必然漂移；
 * - 归一结果要进 `renderRecord`（导出）与回灌（入库）两头，任何有损改写都会被写进库。
 *
 * **幂等是硬要求**：`f(f(x)) === f(x)`。不幂等的话账本 `fileDigest` 每轮都变，反向同步
 * 永远判"文件被改过"，写回环打不完——那正是 P2 用例钉死的那条性质。
 *
 * 刻意不用正则与转义写法：同仓产物里出现过 `\n` 被展开成真实换行、把正则字面量截断的事，
 * 所以这里全部走字符码与字符串切片，形状只依赖文件真实结构。
 */
const NL = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const FENCE_BACKTICK = String.fromCharCode(96, 96, 96);
const FENCE_TILDE = String.fromCharCode(126, 126, 126);
/** 无序列表的等价符号：统一成 `- `（有序列表**不动**，`1. 2. 3.` 自带语义顺序）。 */
const BULLETS = ['*', '+', '·', '•'];
/** 行首缩进宽度（只数空格；tab 缩进按 1 计，不做宽度换算——换算就不是幂等的了）。 */
function indentWidth(line) {
    let i = 0;
    while (i < line.length && (line.charAt(i) === ' ' || line.charAt(i) === TAB))
        i += 1;
    return i;
}
/** 行尾收口：尾部空白里空格 ≥2 视为 markdown 硬换行，压成恰好两个；单个尾随空格与所有尾随 tab 去掉。 */
function settleEol(line) {
    let i = line.length;
    while (i > 0 && (line.charAt(i - 1) === ' ' || line.charAt(i - 1) === TAB))
        i -= 1;
    const core = line.slice(0, i);
    const trail = line.slice(i);
    let spaces = 0;
    for (const c of trail)
        if (c === ' ')
            spaces += 1;
    return spaces >= 2 ? `${core}  ` : core;
}
/** 无序列表符号归一（只认"符号 + 一个空格"的规范写法，避免把 `*` 强调语法当列表改了）。 */
function settleBullet(line) {
    const w = indentWidth(line);
    const head = line.slice(0, w);
    const rest = line.slice(w);
    for (const b of BULLETS) {
        if (rest.startsWith(`${b} `) || rest.startsWith(b + TAB))
            return `${head}-${rest.slice(1)}`;
    }
    return line;
}
/** 标题行的前导空白去掉（`  # 标题` → `# 标题`）；列表项内的 `#` 不算标题（那多半是内容）。 */
function settleHeading(line) {
    if (indentWidth(line) === 0)
        return line;
    const rest = line.slice(indentWidth(line));
    return rest.startsWith('#') ? rest : line;
}
/**
 * 归一一段记忆正文。
 *
 * @param text - 原始正文（可含 CRLF、BOM、任意尾随空白）。
 * @returns 版式归一后的正文：**无**前导/尾随空行、段落间恰好一个空行、围栏内（含 delimiter）
 *          逐字保留、无末尾换行（渲染器自己控制）。
 */
export function normalizeContentMd(text) {
    // ① 换行统一：BOM 去掉，CRLF/CR → LF。这一步之后再按 LF 切。
    let src = text;
    // BOM
    if (src.charCodeAt(0) === 0xfeff)
        src = src.slice(1);
    // CRLF → LF（逐字符扫，避开转义写法）
    let flat = '';
    for (let i = 0; i < src.length; i += 1) {
        const c = src.charAt(i);
        if (c === String.fromCharCode(13)) {
            // CR 无论后面是不是 LF 都必须落一个 LF：只进 `i += 1` 不写 `flat` 会把换行直接吞掉
            // （自家幂等用例抓到的第一个真 bug：`甲\r\n乙` 变成 `甲乙`，段落边界就这么没了）。
            if (src.charAt(i + 1) === NL)
                i += 1; // CR LF → 吃掉 CR，只留下面那个 LF
            flat += NL;
            continue;
        }
        flat += c;
    }
    const lines = flat.split(NL);
    const out = [];
    let inFence = false;
    let fenceMark = '';
    let blanks = 0;
    for (const raw of lines) {
        const pre = raw.slice(indentWidth(raw));
        const isFence = pre.startsWith(FENCE_BACKTICK) || pre.startsWith(FENCE_TILDE);
        if (isFence) {
            const mark = pre.startsWith(FENCE_BACKTICK) ? FENCE_BACKTICK : FENCE_TILDE;
            if (!inFence) {
                inFence = true;
                fenceMark = mark;
            }
            else if (mark === fenceMark) {
                inFence = false;
                fenceMark = '';
            }
            // 围栏 delimiter 行就是版式的一部分：原样落盘，连行尾收口也不做
            blanks = 0;
            out.push(raw);
            continue;
        }
        if (inFence) {
            // 围栏内的行逐字保留：代码里的缩进、`*` 号、行尾双空格都可能是有意为之
            blanks = 0;
            out.push(raw);
            continue;
        }
        const line = settleBullet(settleHeading(settleEol(raw)));
        if (line.trim().length === 0) {
            blanks += 1;
            // 空行只在已有内容时才可能保留，且最多一个
            if (out.length > 0 && blanks === 1)
                out.push('');
            continue;
        }
        blanks = 0;
        out.push(line);
    }
    // ③ 末尾无换行：渲染器负责补，正文本体不带（否则 digest 会随写法抖动）。
    while (out.length > 0 && out[out.length - 1] === '')
        out.pop();
    return out.join(NL);
}
