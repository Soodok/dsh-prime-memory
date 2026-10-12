/**
 * MMF v1.1 记忆包解析 / 序列化（轨3 宿主侧纯 TS 实现，零 IO）。
 *
 * 与 `skills/memport/scripts/memport.py` 是**同一格式的两份实现**：Python 侧供无 DSH
 * 环境下导出用，本模块供 DSH 宿主侧导入 pre-check / 预筛用。二者必须产出一致的
 * 结构校验结论与哈希——`tests/memport-ts-consistency.test.ts` 用 `templates/example.mem`
 * 头部声明的 sha256(`af1247329ce5`) 做**跨实现金标准**钉死这一点。
 *
 * 刻意零 IO：解析入参是字符串（调用方自己读文件/请求体），便于单测且不碰文件系统。
 * 逐字段语义见 `references/format.md`；四轴时间(created/updated/vf/vt)、持续性 st
 * 的判定不可互相顶替（见 SKILL §四）。
 */
import { createHash } from 'node:crypto';
/** MMF v1.1 默认列序（缺 `#cols=` 时按此解析；v1 包缺 vf/vt/st 列按 -/-/? 补齐）。 */
export const DEFAULT_COLS = ['type', 'created', 'updated', 'vf', 'vt', 'st', 'cf', 'rw', 'tags', 'content'];
/**
 * 类型码 → 运行时 type（与 memport.py TYPE_CODES 一字不差）。
 *
 * 旧码（插件 7 类）不变；pm-name-distill task_1.7 补进宿主 29 类的新码，使外部包
 * 带来的宿主分类不再被写侧抹平——两实现同表是 `memport-ts-consistency` 的前提。
 */
export const TYPE_CODES = {
    pe: 'persona',
    ep: 'episodic',
    in: 'instruction',
    wf: 'work_fact',
    wt: 'work_task',
    wm: 'work_method',
    wa: 'work_artifact',
    // —— 宿主分类·个人轴 ——
    ui: 'user_info',
    uh: 'user_hobby',
    uc: 'user_communication',
    ub: 'user_behavior',
    // —— 宿主分类·项目轴 ——
    pi: 'project_introduction',
    pt: 'project_tech_stack',
    pg: 'project_architecture',
    pb: 'project_build_configuration',
    pq: 'project_dependency_configuration',
    po: 'project_ide_configuration',
    ps: 'project_scm_configuration',
    pw: 'project_environment_configuration',
    pl: 'project_rule',
    // —— 宿主分类·规范轴 ——
    ds: 'development_code_specification',
    dp: 'development_practice_specification',
    dv: 'development_test_specification',
    dn: 'development_comment_specification',
    // —— 宿主分类·经验轴 ——
    tm: 'task_summary_experience',
    dk: 'task_breakdown_experience',
    df: 'task_flow_experience',
    td: 'task_experience',
    tl: 'tool_experience',
    mp: 'mcp_experience',
    sl: 'skill_experience',
    lk: 'learned_skill_experience',
    ek: 'expert_experience',
    im: 'important_decision_experience',
    cp: 'common_pitfalls_experience',
    hf: 'history_task_reference_files',
};
const TYPE_FULL = Object.fromEntries(Object.entries(TYPE_CODES).map(([k, v]) => [v, k]));
/** 持续性取值域：p 时点 / s 已结束区间 / o 仍在持续 / t 无时间性 / ? 未判定。 */
export const PERSISTENCE = ['p', 's', 'o', 't', '?'];
/** 支持的包版本（其余报错）。 */
const KNOWN_VERSIONS = new Set(['1', 'v1', '1.1', 'v1.1']);
/** NFKC + 空白折叠 + 去首尾（用于哈希与相似度，不改原文）。 */
export function normText(s) {
    return s.normalize('NFKC').replace(/\s+/g, ' ').trim();
}
/**
 * 内容哈希：sha256(normText + 小写)[:16]。
 * 注意：Python 用 casefold（激进大小写折叠），JS 用 toLowerCase；
 * 对 CJK/ASCII 记忆正文等价，仅极端 Unicode 有别——实际记忆集不含此类，
 * 跨实现金标准走包级 sha256（不逐条折叠），不受影响。
 */
export function contentHash(s) {
    return createHash('sha256').update(normText(s).toLowerCase(), 'utf8').digest('hex').slice(0, 16);
}
/** 记录稳定 id：`mp_` + sha256(src|chash)[:16]。 */
export function recordId(src, chash) {
    return 'mp_' + createHash('sha256').update(`${src}|${chash}`, 'utf8').digest('hex').slice(0, 16);
}
/** 解码内容列：反斜杠+反斜杠 → 单反斜杠；反斜杠+n → 换行（其余反斜杠原样）。 */
export function unescapeContent(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '\\' && i + 1 < s.length) {
            const nxt = s[i + 1];
            if (nxt === '\\') {
                out += '\\';
                i++;
                continue;
            }
            if (nxt === 'n') {
                out += '\n';
                i++;
                continue;
            }
        }
        out += c;
    }
    return out;
}
/**
 * 编码内容列：反斜杠 → 双反斜杠、CRLF → LF、LF → 反斜杠+n。
 * 用 charCode 常量而非控制字符字面量，避免跨工具写盘时 CR/LF 被吞进正则/字符串字面量。
 */
export function escapeContent(s) {
    const CR = String.fromCharCode(13);
    const LF = String.fromCharCode(10);
    const BSL = String.fromCharCode(92);
    return s.split(BSL).join(BSL + BSL).split(CR + LF).join(LF).split(LF).join(BSL + 'n');
}
/** `k:v;k:v` → 对象（缺冒号的段忽略）。 */
export function parseTags(raw) {
    const out = {};
    for (const part of (raw || '').split(';')) {
        const p = part.trim();
        if (!p || !p.includes(':'))
            continue;
        const idx = p.indexOf(':');
        out[p.slice(0, idx).trim()] = p.slice(idx + 1).trim();
    }
    return out;
}
/** 时间串 → { ms|null, precision }（镜像 Python parse_time；naive 视为本地）。 */
export function parseTime(raw) {
    const s = (raw || '').trim();
    if (s === '' || s === '-' || s === '?' || s === 'null')
        return { ms: null, precision: 'unknown' };
    const patterns = [
        [/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/, 'exact'],
        [/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})?$/, 'minute'],
        [/^\d{4}-\d{2}-\d{2}[ ]\d{2}:\d{2}:\d{2}$/, 'exact'],
        [/^\d{4}-\d{2}-\d{2}[ ]\d{2}:\d{2}$/, 'minute'],
        [/^\d{4}-\d{2}-\d{2}$/, 'day'],
    ];
    for (const [re, prec] of patterns) {
        if (re.test(s)) {
            const iso = s.includes('T') ? s : s.replace(' ', 'T');
            const t = Date.parse(iso);
            if (Number.isFinite(t))
                return { ms: t, precision: prec };
        }
    }
    return { ms: null, precision: 'unknown' };
}
/** 按 Python str.split(sep, maxsplit) 语义切列：前 maxsplit 个分隔符切，剩余归最后一列。 */
function splitMax(line, maxSplit) {
    const out = [];
    let start = 0;
    for (let i = 0; i < maxSplit; i++) {
        const idx = line.indexOf('|', start);
        if (idx === -1)
            break;
        out.push(line.slice(start, idx));
        start = idx + 1;
    }
    out.push(line.slice(start));
    return out;
}
/**
 * 解析整包文本 → Bundle（含结构校验）。镜像 memport.py parse_bundle。
 * 入参是字符串（调用方读文件时自带编码处理）；此处容错剥离 BOM。
 */
export function parseBundle(text) {
    const b = {
        header: {},
        cols: [],
        records: [],
        errors: [],
        warnings: [],
        declaredCount: null,
        declaredSha: null,
        bodyLines: [],
    };
    const clean = text.replace(/^﻿/, '');
    const rawLines = clean.split(/\r?\n/);
    const body = [];
    let seqLine = 0;
    for (const line of rawLines) {
        seqLine++;
        if (line.startsWith('#')) {
            const head = line.slice(1).trim();
            if (head.startsWith('memport')) {
                const rest = head.slice('memport'.length).trim();
                b.header.version = rest.split(';')[0].trim() || '1';
                continue;
            }
            for (const part of head.split(';')) {
                const p = part.trim();
                if (!p || !p.includes('='))
                    continue;
                const idx = p.indexOf('=');
                const k = p.slice(0, idx).trim();
                const v = p.slice(idx + 1).trim();
                if (k === 'cols')
                    b.cols = v.split('|').map((c) => c.trim());
                else if (k === 'count') {
                    const n = Number(v);
                    if (Number.isInteger(n))
                        b.declaredCount = n;
                    else
                        b.errors.push(`L${seqLine}: count 不是整数:${v}`);
                }
                else if (k === 'sha256')
                    b.declaredSha = v;
                else
                    b.header[k] = v;
            }
            continue;
        }
        if (line.trim() === '')
            continue;
        body.push(line);
    }
    b.bodyLines = body;
    if (b.cols.length === 0) {
        b.cols = [...DEFAULT_COLS];
        b.warnings.push('包未声明 #cols=，按 MMF 默认列序解析');
    }
    if (!b.cols.includes('content')) {
        b.errors.push('列声明缺少 content 列');
        return b;
    }
    const missingCols = ['vf', 'vt', 'st'].filter((c) => !b.cols.includes(c));
    if (missingCols.length) {
        b.warnings.push(`包缺 ${missingCols.join('/')} 列（MMF v1 包）；有效期与持续性将按 -/-/? 落库，无法参与时间定位，建议导出侧升级到 v1.1`);
    }
    const ci = {};
    b.cols.forEach((name, i) => (ci[name] = i));
    const contentIdx = ci.content;
    if (contentIdx !== b.cols.length - 1 && b.errors.length === 0) {
        b.warnings.push('content 不是最后一列；含 | 的内容可能被误切');
    }
    const col = (parts, name, def = '') => {
        const i = ci[name];
        return i === undefined ? def : (parts[i] ?? '').trim();
    };
    body.forEach((line, i) => {
        const seq = i + 1;
        const parts = splitMax(line, b.cols.length - 1);
        if (parts.length !== b.cols.length) {
            b.errors.push(`记录 ${seq}: 列数 ${parts.length} != 声明 ${b.cols.length}`);
            return;
        }
        const content = unescapeContent(parts[contentIdx] ?? '').trim();
        const typeRaw = col(parts, 'type');
        const rec = {
            seq,
            type: typeRaw,
            typeFull: TYPE_CODES[typeRaw] ?? typeRaw,
            created: col(parts, 'created'),
            updated: col(parts, 'updated'),
            vf: col(parts, 'vf', '-'),
            vt: col(parts, 'vt', '-'),
            st: col(parts, 'st', '?'),
            cf: col(parts, 'cf'),
            rw: col(parts, 'rw'),
            tags: 'tags' in ci ? parseTags(col(parts, 'tags')) : {},
            content,
            hash: contentHash(content),
            createdMs: null,
            createdPrec: 'unknown',
            updatedMs: null,
            updatedPrec: 'unknown',
            vfMs: null,
            vfPrec: 'unknown',
            vtMs: null,
            vtPrec: 'unknown',
        };
        const c = parseTime(rec.created);
        rec.createdMs = c.ms;
        rec.createdPrec = c.precision;
        const u = parseTime(rec.updated);
        rec.updatedMs = u.ms;
        rec.updatedPrec = u.precision;
        const vf = parseTime(rec.vf);
        rec.vfMs = vf.ms;
        rec.vfPrec = vf.precision;
        const vt = parseTime(rec.vt);
        rec.vtMs = vt.ms;
        rec.vtPrec = vt.precision;
        b.records.push(rec);
    });
    // ── 结构校验 ──
    const ver = b.header.version;
    if (ver !== undefined && !KNOWN_VERSIONS.has(ver)) {
        b.errors.push(`未知包版本：${ver}（本工具支持 1 / 1.1）`);
    }
    if (b.declaredCount !== null && b.declaredCount !== body.length) {
        b.errors.push(`条数不符：声明 ${b.declaredCount}，实际记录行 ${body.length}`);
    }
    if (b.declaredSha) {
        const digest = createHash('sha256').update(body.join('\n'), 'utf8').digest('hex');
        if (!digest.startsWith(b.declaredSha.slice(0, 12))) {
            b.errors.push(`校验和不符：声明 ${b.declaredSha.slice(0, 12)}，实算 ${digest.slice(0, 12)}`);
        }
    }
    const seen = {};
    for (const rec of b.records) {
        const p = `记录 ${rec.seq}`;
        if (!(rec.type in TYPE_CODES) && !(rec.type in TYPE_FULL)) {
            if (rec.type === '' || rec.type === '?')
                b.warnings.push(`${p}: 类型缺失，导入时将回落 episodic`);
            // 口径与写侧 `memory_add` 一致（旧文案承诺“按原样透传”，写侧却静默抹平——
            // 同一件事两套说法）。非词表值现在会被降级并留痕，不能再说是“透传”。
            else
                b.warnings.push(`${p}: 非词表类型 ${rec.type}，导入时将降级为 episodic（服务端记 warn）`);
        }
        for (const [fld, val] of [
            ['cf', rec.cf],
            ['rw', rec.rw],
        ]) {
            if (val !== '0' && val !== '1' && val !== '?')
                b.errors.push(`${p}: ${fld} 取值非法 ${val}（仅 0/1/?）`);
        }
        if (!PERSISTENCE.includes(rec.st)) {
            b.errors.push(`${p}: st 取值非法 ${rec.st}（仅 p/s/o/t/?）`);
        }
        if (rec.vfMs && rec.vtMs && rec.vtMs < rec.vfMs) {
            b.warnings.push(`${p}: vt 早于 vf，已按 vf 处理`);
            rec.vtMs = rec.vfMs;
        }
        if (rec.content.length < 4)
            b.errors.push(`${p}: content 过短，疑似空记录`);
        if (rec.content.length > 600)
            b.warnings.push(`${p}: content 超长（${rec.content.length} 字符），违反节省规则（≤100 字）`);
        if (rec.createdMs && rec.updatedMs && rec.updatedMs < rec.createdMs) {
            b.warnings.push(`${p}: updated 早于 created，已按 created 视为 updated`);
            rec.updatedMs = rec.createdMs;
        }
        if (rec.hash in seen)
            b.errors.push(`${p}: 与本包第 ${seen[rec.hash]} 条内容重复（应先在包内去重）`);
        else
            seen[rec.hash] = rec.seq;
    }
    if (b.records.length === 0)
        b.errors.push('包内没有任何记录');
    return b;
}
