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
 *
 * 另有一条自校验：frontmatter 里的 `hash` 是投射时盖下的正文指纹（N13）。这里只**核对**它
 * 与正文本体是否一致（`hashValid`），不替调用方决定怎么处置——那属于同步侧的裁决。
 */
import { contentHash } from './memory-md.js';

/** 解析出的文件形状（值已按渲染时的类型还原）。 */
export interface MdParsed {
  /** 文件名干（= 渲染时写入的 `name` 键）。 */
  name: string;
  type: string;
  priority: number;
  /** ISO 串（渲染时就是 ISO；空串 = 没有）。 */
  createdAt: string;
  updatedAt: string;
  usageScenario: string[];
  extKey: string;
  /** 文件里记的 record_id，只当线索。 */
  id: string;
  /** 文件声明的正文指纹（`hash` 键原文）；空串 = 老文件没带（未签名）。 */
  hash: string;
  /**
   * 声明指纹与正文实算的比对：`true` 一致、`false` 不符、`undefined` = 文件没声明（无从判）。
   *
   * `false` **不是**拒收理由：正文被人改过恰恰是 P2 要回灌的正常输入；它只说明「文件不是
   * 我们上次写出去的那份字节」，交给调用方计入报告并重盖指纹。结构性拒收仍在更上面
   * （形状不符 / 正文为空）。
   */
  hashValid: boolean | undefined;
  /** frontmatter 带 `retired: true`。 */
  retired: boolean;
  /** 正文（已去首尾空白）。 */
  content: string;
}

/** 取 frontmatter 块：首行必须是 `---`，到下一个 `---` 为止。 */
function splitFrontmatter(text: string): { meta: string[]; body: string } | undefined {
  // BOM 与 CRLF 都要先吃掉：人在记事本里改一行就会引入 \r，而 `\r` 会让 key 匹配不上。
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length < 2 || lines[0].trim() !== '---') return undefined;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return undefined;
  return { meta: lines.slice(1, end), body: lines.slice(end + 1).join('\n').trim() };
}

/** 一行 `key: <JSON>` → [key, 值]；值解析失败则退回原始字符串。 */
function readLine(line: string): [string, unknown] | undefined {
  const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
  if (m === null) return undefined;
  const raw = m[2];
  if (raw.length === 0) return [m[1], ''];
  try {
    return [m[1], JSON.parse(raw)];
  } catch {
    return [m[1], raw];
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * 解析一个投射文件。
 *
 * @param text - 文件全文。
 * @returns 解析结果；形状不符（无 frontmatter / 无正文 / 键全不认识）时 `undefined`。
 */
export function parseMdFile(text: string): MdParsed | undefined {
  const parts = splitFrontmatter(text);
  if (parts === undefined) return undefined;
  const fields = new Map<string, unknown>();
  for (const line of parts.meta) {
    const kv = readLine(line);
    if (kv !== undefined) fields.set(kv[0], kv[1]);
  }
  // 正文为空 = 这条记忆没内容了。人手工清空正文不该被回灌成"一条空记忆"，
  // 那既不是有效输入，也会让对账以为文件是权威。
  if (parts.body.length === 0) return undefined;
  const scenario = Array.isArray(fields.get('usageScenario'))
    ? (fields.get('usageScenario') as unknown[]).filter((s): s is string => typeof s === 'string' && s.length > 0)
    : [];
  const prio = Number(fields.get('priority'));
  const declaredHash = str(fields.get('hash'));
  return {
    name: str(fields.get('name')),
    type: str(fields.get('type')),
    priority: Number.isFinite(prio) ? prio : 60,
    createdAt: str(fields.get('createdAt')),
    updatedAt: str(fields.get('updatedAt')),
    usageScenario: scenario,
    extKey: str(fields.get('extKey')),
    id: str(fields.get('id')),
    hash: declaredHash,
    hashValid: declaredHash.length === 0 ? undefined : declaredHash === contentHash(parts.body),
    retired: fields.get('retired') === true,
    content: parts.body,
  };
}
