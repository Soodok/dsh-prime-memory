/**
 * 容错 JSON 解析:LLM 输出常带小语法毛刺,一次 JSON.parse 定生死会把整批记忆全丢。
 *
 * 三级链(见 #10):
 *   strict   → 原样 JSON.parse,零回归;
 *   repaired → 字符串态扫描,做四类**只动语法不动内容**的确定性修复:
 *              1) 内容里的裸 ASCII `"` → `\"`(判据:该 `"` 后第一个非空白字符不是 `,` `}` `]` `:` `"` EOF)
 *              2) 字符串里的裸 `\n` `\r` `\t` → 转义
 *              3) `,` 紧跟 `}` `]` 的尾逗号 → 删
 *              4) 结尾未闭合的字符串与括号 → 补齐(对应 finish=length 截断)
 *   salvaged → 整体修不动时按顶层元素边界逐个 parse,保住坏点前后已完整的对象,
 *              尾巴丢掉(不猜)。
 *
 * 修复/救援发生时会带上 `notes`,由调用方决定是否 warn 落盘(便于回溯:修复是兜底不是常态)。
 */

export interface RepairResult<T> {
  value: T;
  /** 命中的档位,便于日志追溯。 */
  level: 'strict' | 'repaired' | 'salvaged';
  /** 修复动作描述,strict 档为空数组。 */
  notes: string[];
}

/** 判断 idx 处的 `"` 是否是「真结束」:后一个非空白字符是结构字符或 EOF。 */
function isRealStringClose(src: string, idx: number): boolean {
  for (let j = idx + 1; j < src.length; j++) {
    const c = src[j];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') continue;
    return c === ',' || c === '}' || c === ']' || c === ':';
  }
  return true; // EOF
}

/**
 * 字符串态扫描修复:只动语法,字段名与值内容字节一个不改。
 * 返回 null 表示扫描中遇到无法处理的结构错误(交给上层救援)。
 */
export function repairJson(src: string): { out: string; notes: string[] } | null {
  const out: string[] = [];
  const notes: string[] = [];
  const stack: Array<'{' | '['> = [];
  let inStr = false;
  let escaped = false;
  let bareQuoteFixed = 0;
  let ctrlCharEscaped = 0;
  let trailingCommaDropped = 0;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inStr) {
      if (escaped) {
        // 上一个字符是 `\`,当前是转义内容的一部分,原样输出并复位
        out.push(c);
        escaped = false;
        continue;
      }
      if (c === '\\') {
        out.push(c);
        escaped = true;
        continue;
      }
      if (c === '"') {
        if (isRealStringClose(src, i)) {
          out.push(c);
          inStr = false;
        } else {
          out.push('\\"');
          bareQuoteFixed++;
        }
        continue;
      }
      if (c === '\n') { out.push('\\n'); ctrlCharEscaped++; continue; }
      if (c === '\r') { out.push('\\r'); ctrlCharEscaped++; continue; }
      if (c === '\t') { out.push('\\t'); ctrlCharEscaped++; continue; }
      out.push(c);
      continue;
    }

    // ── 结构态 ──
    if (c === '"') { inStr = true; out.push(c); continue; }
    if (c === '{' || c === '[') { stack.push(c as '{' | '['); out.push(c); continue; }
    if (c === '}' || c === ']') {
      // 弹出匹配的 opener;若不匹配也尽力弹一层(常见于模型写错一层)
      if (stack.length > 0) stack.pop();
      // 处理尾逗号:回删 out 末尾的 `,` 与其前面的空白
      const before = trimTrailingComma(out);
      if (before > 0) trailingCommaDropped += before;
      out.push(c);
      continue;
    }
    if (c === ',') {
      // 前瞻:下一个非空白字符若是 `}` `]` → 尾逗号,吞掉
      let j = i + 1;
      while (j < src.length && (src[j] === ' ' || src[j] === '\t' || src[j] === '\n' || src[j] === '\r')) j++;
      if (j < src.length && (src[j] === '}' || src[j] === ']')) {
        trailingCommaDropped++;
        continue; // 不输出这个逗号
      }
      out.push(c);
      continue;
    }
    out.push(c);
  }

  let tail = out.join('');
  // 结尾未闭合的字符串 → 补 `"`
  if (inStr) { tail += '"'; notes.push('补闭合未终止的字符串'); }
  // 结尾未闭合的括号 → 按栈反向补齐
  while (stack.length > 0) {
    const opener = stack.pop()!;
    tail += opener === '{' ? '}' : ']';
  }
  if (bareQuoteFixed > 0) notes.push(`转义裸引号 ${bareQuoteFixed} 处`);
  if (ctrlCharEscaped > 0) notes.push(`转义控制字符 ${ctrlCharEscaped} 处`);
  if (trailingCommaDropped > 0) notes.push(`删尾逗号 ${trailingCommaDropped} 处`);
  return { out: tail, notes };
}

/** out buffer 尾部若为 `,...` 结构(已推入的字符),移除尾部逗号与空白,返回删除的逗号数。 */
function trimTrailingComma(out: string[]): number {
  let dropped = 0;
  while (out.length > 0) {
    const top = out[out.length - 1];
    if (top === ' ' || top === '\t' || top === '\n' || top === '\r') { out.pop(); continue; }
    if (top === ',') { out.pop(); dropped++; continue; }
    break;
  }
  // 处理 `,,}` 双逗号:递归检查
  if (dropped > 0) dropped += trimTrailingComma(out);
  return dropped;
}

/**
 * 顶层逐元素救援:仅当输入是 `[...]` 且整体 parse 失败时启用。
 * 按结构态(非字符串)找顶层逗号,切片成一个个元素,分别 JSON.parse,失败的丢掉。
 */
export function salvageTopLevelElements(src: string): { items: unknown[]; dropped: number } | null {
  const first = src.indexOf('[');
  if (first < 0) return null;
  const items: unknown[] = [];
  let dropped = 0;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  let segStart = first + 1;
  for (let i = first; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '[' || c === '{') { depth++; continue; }
    if (c === ']' || c === '}') { depth--; if (depth === 0 && i === src.length - 1) { /* 数组收尾 */ } continue; }
    if (c === ',' && depth === 1) {
      const seg = src.slice(segStart, i).trim();
      if (seg) {
        try { items.push(JSON.parse(seg)); } catch { dropped++; }
      }
      segStart = i + 1;
    }
  }
  // 最后一段(到 `]` 前)
  const closing = src.lastIndexOf(']');
  const lastSeg = src.slice(segStart, closing > segStart ? closing : src.length).trim();
  if (lastSeg) {
    try { items.push(JSON.parse(lastSeg)); } catch { dropped++; }
  }
  if (items.length === 0) return null;
  return { items, dropped };
}

/**
 * 预处理:剥 ```json```围栏 + 切到首个 `[`/`{` 直到末尾 `]`/`}`，兼容 LLM 前后附的散文。
 * 与旧版 parseJson 逐字行为一致（零回归）。
 */
export function preprocessLLMJson(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  }
  const start = s.indexOf('[');
  const brace = s.indexOf('{');
  let begin: number;
  if (start === -1) begin = brace;
  else if (brace === -1) begin = start;
  else begin = Math.min(start, brace);
  if (begin > 0) s = s.slice(begin);
  const end = s.lastIndexOf(']') > s.lastIndexOf('}') ? s.lastIndexOf(']') + 1 : s.lastIndexOf('}') + 1;
  if (end > 0) s = s.slice(0, end);
  return s;
}

/**
 * 三级容错入口。传入已通过「剥围栏 + 切片」的字符串,返回解析结果与档位说明。
 * 若三级皆失败,抛出 strict JSON.parse 的原始错误。
 */
export function parseJsonTolerant<T>(raw: string): RepairResult<T> {
  const s = preprocessLLMJson(raw);
  // L1 strict
  try {
    return { value: JSON.parse(s) as T, level: 'strict', notes: [] };
  } catch (strictErr) {
    // L2 repaired
    const rep = repairJson(s);
    if (rep) {
      try {
        return { value: JSON.parse(rep.out) as T, level: 'repaired', notes: rep.notes };
      } catch { /* fall through */ }
    }
    // L3 salvaged(仅当形如数组时启用)
    if (s.trim().startsWith('[')) {
      // 先试修复后再救援
      const salv = salvageTopLevelElements(rep?.out ?? s);
      if (salv) {
        const notes = [`逐元素救援成功,保住 ${salv.items.length} 条、丢弃 ${salv.dropped} 条`];
        if (rep?.notes.length) notes.unshift(...rep.notes);
        return { value: salv.items as T, level: 'salvaged', notes };
      }
    }
    throw strictErr;
  }
}
