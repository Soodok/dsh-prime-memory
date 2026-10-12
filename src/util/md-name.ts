/**
 * 文件身份名（N1）：把一条 L1 记忆的正文折成一个**人可读、可编辑、全库唯一**的短名，
 * 直接当 `<root>/<type>/<name>.memory.md` 的文件名干。
 *
 * 为什么不用现成的键：
 * - `id` 每轮新铸、从不复用（merge = 旧行软删 + 新记录追加），拿它当文件名等于每天换名；
 * - `scene_name` 实测基数大于记录数，当不了唯一名；
 * - `ext_key` 是**导入幂等键**（机器算的、只在来源内唯一），语义与"人给这条记忆起的名字"不同。
 *
 * 名字纪律**复用** `sanitizeFilename`（`store/scenes.ts`）而不是另写一套：
 * 那里已经处理过非法字符、Windows 保留设备名（`CON`/`LPT1`…）、stem 超长截断。
 * 自己拼一份正则迟早和它漂移，而漂移的后果是"库里存的名字写不出文件"。
 *
 * Phase 2 重写：旧 `deriveName` 取首行前 24 字，正本是完整叙述句时天然是残句
 * （真机 1166 条里 96.7% 是句子残片）。现改为**分段流水线**：标题行优先 → 剥 markdown
 * 前缀 → 剥叙述引子 → 结构边界截断 → 词元边界收尾 → 截断纪律，每一步都可单测。
 */
import { sanitizeFilename } from '../store/scenes.js'

/**
 * 名字干长度上限（字符）。Phase 2 由 24 放宽到 28：目标区间 6–14，
 * 允许最长 28，够容纳一条完整短标题而不必腰斩词元。
 */
export const NAME_MAX = 28

/** 目标区间下界（推荐名短于此偏空），仅作注释性常量，不作硬闸。 */
export const NAME_TARGET_MIN = 6
/** 目标区间上界（推荐名长于此偏啰嗦），仅作注释性常量，不作硬闸。 */
export const NAME_TARGET_MAX = 14

/**
 * 叙述引子表：正文是"谁干了什么"的完整叙述句时，这些前缀只是话头，
 * 占了名字名额却不含信息量（真机坏味「用户要求将-...」「团队已完成-...」即此）。
 * 导出供 `validateTitle` 与 `deriveName` **共用同一份**，两处判据不许漂移。
 */
export const NARRATIVE_LEAD_INS: readonly string[] = [
  '用户要求', '用户规定', '用户需要', '用户确立', '用户',
  '团队已', '团队将', '团队完', '团队',
  '针对', '已生成', '生成了', '已为', '本次', '目前', '结论', '要点', '待推进',
]

/** 由长到短排序，保证「用户要求」优先于「用户」命中（前缀匹配不会被短项截胡）。 */
const LEAD_IN_SORTED = [...NARRATIVE_LEAD_INS].sort((a, b) => b.length - a.length)

/** 引子之后可能残留的单个话头连接词（「用户要求将…」的「将」），一并丢弃。 */
const LEAD_IN_CONNECTOR = '(?:将|把|要|需|做了|做|规定|需要|的)?'

/** 只吃引子后的空白与读点，不吃正文用字。 */
const LEAD_IN_PUNCT = '[\\s，,、：:]*'

/** 结构边界截断点：第一个命中的分隔标记处断开（'，' '、' 不在此列，只走长度收尾）。 */
const STRUCTURAL_BOUNDARIES: RegExp[] = [
  /[：。；]/, // 全角句读
  /[（(]/, // 括号：整块丢弃括号内容
  /`/, // 反引号：内联代码前后都算边界
  /[A-Za-z]:[\\/]/, // Windows 盘符路径
  /session-[0-9a-f-]{8,}/i, // 会话 id
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i, // uuid 片段
]

/**
 * 正文 → 名字干（分段流水线）。
 *
 * 保持签名 `(content) => string` 与"洗不出可用文字返回空串"的承诺。步骤：
 *  1. 标题行优先：正文有 `^#{1,3} ` 行用它，否则取首个非空行；
 *  2. 剥 markdown 前缀；
 *  3. 剥叙述引子（{@link NARRATIVE_LEAD_INS}）连同其后标点/残留话头；
 *  4. 结构边界截断（第一个句读 / 括号 / 反引号 / 路径 / session / uuid 处断开，
 *     括号内整块丢弃——除非主句因此被丢空）；
 *  5. 词元边界收尾：CJK 逐字、ASCII 逐词，绝不切半单词；
 *  6. 截断纪律：过 `sanitizeFilename`，剥尾随 `.` `-` 空格。
 *
 * @param content - 记忆正文。
 * @returns 文件名安全的名字干；无可用文字时 `''`。
 */
export function deriveName(content: string): string {
  let s = pickTitleLine(content)
  if (s.length === 0) return ''
  s = stripLeadIn(s)
  s = structuralTruncate(s)
  s = clipAtTokenBoundary(s, NAME_MAX)
  if (s.length === 0) return ''
  return applyTrailingDiscipline(s)
}

/**
 * 步骤 1+2：选出标题行并剥掉 markdown 前缀。
 * markdown 标题（`#`/`##`/`###` + 空格）优先；否则首个非空行去掉 `#>*-+` 与空白前缀。
 */
function pickTitleLine(content: string): string {
  const lines = (content ?? '').split('\n')
  const heading = lines.find((l) => /^#{1,3} \S/.test(l.trim()))
  if (heading) return heading.trim().replace(/^#{1,3}\s+/, '').trim()
  const line = lines.find((l) => l.trim().length > 0) ?? ''
  return line.trim().replace(/^[#>\-*+\s]+/, '').trim()
}

/**
 * 步骤 3：剥叙述引子。命中引子就把引子 + 其后标点 + 单个残留话头一起丢，
 * 直到剩不下引子为止（只剥一次最外层，避免把正文首词也吃掉）。
 */
function stripLeadIn(raw: string): string {
  let s = raw.trim()
  for (const lead of LEAD_IN_SORTED) {
    const re = new RegExp(`^${escapeRe(lead)}${LEAD_IN_CONNECTOR}${LEAD_IN_PUNCT}`)
    const m = re.exec(s)
    if (m && m[0].length > lead.length - 1) {
      s = s.slice(m[0].length).trim()
      break
    }
  }
  return s
}

/**
 * 步骤 4：结构边界截断。取所有标记里**最靠前**的断点；若断点是括号，
 * 括号内整块丢弃（保留括号前的主句），仅当主句被丢空时才跳过这个括号继续找下一断点。
 */
function structuralTruncate(raw: string): string {
  let s = raw.trim()
  // 反复处理：命中括号且主句非空 → 截到括号前；命中其它标记 → 截到标记前。
  for (let guard = 0; guard < 8; guard++) {
    let cut = -1
    for (const re of STRUCTURAL_BOUNDARIES) {
      const m = re.exec(s)
      if (m && (cut === -1 || m.index < cut)) cut = m.index
    }
    if (cut === -1) return s
    const head = s.slice(0, cut).trim()
    const marker = s[cut]
    const isParen = marker === '(' || marker === '（'
    if (head.length === 0 && isParen) {
      // 主句被丢空：丢掉这个左括号，保留其后内容继续处理。
      s = s.slice(cut + 1).trim()
      continue
    }
    return head
  }
  return s
}

/**
 * 步骤 5：截到 maxLen，且绝不切半 ASCII 单词。
 * 若刚好落在 ASCII 词元中间（末字符与被丢字符都是 `[A-Za-z0-9]`），回删整个残词。
 * CJK 逐字，无需回退。
 */
function clipAtTokenBoundary(raw: string, maxLen: number): string {
  if (raw.length <= maxLen) return raw
  let clipped = raw.slice(0, maxLen)
  const lastKept = clipped.slice(-1)
  const firstDropped = raw[maxLen] ?? ''
  if (/[A-Za-z0-9]/.test(lastKept) && /[A-Za-z0-9]/.test(firstDropped)) {
    clipped = clipped.replace(/[A-Za-z0-9]+$/, '')
  }
  return clipped
}

/**
 * 步骤 6：截断纪律。过 `sanitizeFilename` 的字符白名单 → 剥它补的 `.md`
 * → 剥尾随 `.` `-` `_` 空格（尾点是真机 12 条坏味的直接来源）。
 */
function applyTrailingDiscipline(raw: string): string {
  const safe = sanitizeFilename(raw).replace(/\.md$/i, '')
  return safe.replace(/[.\-_\s]+$/, '')
}

/**
 * 校验一个**人给的或模型给的**名字是否可用（形状，不含唯一性）。
 *
 * Phase 3 的 few-shot 判据会拿它当门禁，因此签名与 reason 取值必须稳定。
 * 命中任一硬规则即拒；全部通过返回 `{ ok: true, name }`（name 为过字符白名单后的归一值）。
 *
 * @param raw - 候选名字。
 * @returns `{ ok: true, name }` 或 `{ ok: false, reason }`。
 */
export function validateTitle(raw: string): { ok: true; name: string } | { ok: false; reason: string } {
  const s = (raw ?? '').trim()
  if (s.length === 0) return { ok: false, reason: 'empty' }
  if (/[\r\n]/.test(s)) return { ok: false, reason: 'has-newline' }
  if (s.length < 4) return { ok: false, reason: 'too-short' }
  if (s.length > 28) return { ok: false, reason: 'too-long' }
  if (/[。！？!?.]$/.test(s)) return { ok: false, reason: 'ends-with-punctuation' }
  if (/[A-Za-z]:[\\/]/.test(s)) return { ok: false, reason: 'has-drive-path' }
  if (s.includes('/')) return { ok: false, reason: 'has-slash' }
  if (/http/i.test(s)) return { ok: false, reason: 'has-url' }
  if (/session-/i.test(s)) return { ok: false, reason: 'has-session-id' }
  if (/[0-9a-fA-F]{32,36}/.test(s)) return { ok: false, reason: 'has-hex-id' }
  if (/-\d{4}/.test(s)) return { ok: false, reason: 'has-id-fragment' }
  if (startsNarrativeLeadIn(s)) return { ok: false, reason: 'starts-with-lead-in' }
  if (isBareCodeIdentifier(s)) return { ok: false, reason: 'code-identifier' }
  const safe = sanitizeFilename(s).replace(/\.md$/i, '')
  if (safe.length === 0) return { ok: false, reason: 'no-usable-char' }
  return { ok: true, name: safe }
}

/** 是否以叙述引子开头（与 deriveName 共用 {@link NARRATIVE_LEAD_INS}）。 */
function startsNarrativeLeadIn(s: string): boolean {
  return LEAD_IN_SORTED.some((lead) => s.startsWith(lead))
}

/**
 * 是否为"裸代码标识符"——纯 ASCII、无任何分隔符（空格/-/_）、且含词中大小写翻转
 * （camelCase 边界），读起来像被原样抓来的函数/变量名，而非人给短标题。
 * 真机坏味 `buildTurnCompactSystemPr`（ASCII 函数名硬切腰斩）即此类。
 */
function isBareCodeIdentifier(s: string): boolean {
  if (/[^\x00-\x7F]/.test(s)) return false // 含非 ASCII（CJK 等）不算
  if (/[\s\-_]/.test(s)) return false // 有分隔符即为短语，放行
  return /[a-z][A-Z]/.test(s) // 词中大写翻转 = 驼峰标识符
}

/**
 * 校验一个**人给的**名字是否可用（形状，不含唯一性）。
 *
 * 人从面板或 md 文件里改名字时，先过这道形状闸再谈唯一性：形状不合就拒，
 * 比"收下然后写不出文件"好。返回归一后的名字（可能与入参不同：洗掉了非法字符）。
 *
 * @param raw - 用户给的名字。
 * @returns `{ ok: true, name }` 或 `{ ok: false, reason }`。
 */
export function normalizeName(raw: string): { ok: true; name: string } | { ok: false, reason: string } {
  const trimmed = (raw ?? '').trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }
  if (trimmed.length > NAME_MAX * 2) return { ok: false, reason: 'too-long' }
  const safe = sanitizeFilename(trimmed).replace(/\.md$/i, '')
  if (safe.length === 0) return { ok: false, reason: 'no-usable-char' }
  if (safe !== trimmed) return { ok: false, reason: 'illegal-chars' }
  return { ok: true, name: safe }
}

/** 名字没洗出可用字符时的回落干：`mem-<id 后 8 位>`。 */
export function fallbackStem(id: string): string {
  return `mem-${(id ?? '').slice(-8)}`
}

/**
 * 给一个名字求**全库唯一**的落名：基底 → `基底-2` → `基底-3` → … → 回落名。
 *
 * 为什么必须在这里消歧，而不是"谁先到谁写"：同一段话的多条记录必然洗出同一个名字。
 * 真机实测 1166 条里 42 条挤进 17 个同名文件（最狠一个路径 6 条），后果是导出每轮都把
 * 被覆盖的那几条重写一遍（面板上那个永远不归零的「已写 9」）、而反向同步会把一份内容
 * 回灌给六条记录。
 *
 * 分配本身只取决于"基底 + 已占用集"，因此**调用方必须按 id 排序后再分配**：
 * 同一个基底碰上同一次分配时，谁先谁拿到裸名——顺序不钉死的话，两次导出会给同一条
 * 记录分到不同名字，文件在盘上跳来跳去。后缀要留位置：总长不超过 {@link NAME_MAX}，
 * 宁可截基底也不让它超长。
 *
 * @param base - 基底名（通常是 `deriveName(content)`，可以为空）。
 * @param id - 记录 id，基底不可用时落回 `mem-<id8>`。
 * @param isFree - 库侧查询：这个名字没被**其它**记录占着。
 * @param reserved - 本轮已分配出去的名字（调用方逐次加入，函数也会自己加）。
 * @returns 可用的名字；实在找不到就把 `id` 的回落名加上数字尾巴交出去（仍进 reserved）。
 */
export function allocUniqueName(
  base: string,
  id: string,
  isFree: (name: string) => boolean,
  reserved: Set<string>,
): string {
  const usable = (n: string): boolean => n.length > 0 && !reserved.has(n) && isFree(n)
  const fallback = fallbackStem(id)
  // 基底没洗出名字时，回落名就是基底（先试裸名，再试 `-N`）。
  const stem = base.length > 0 ? base : fallback
  if (usable(stem)) {
    reserved.add(stem)
    return stem
  }
  // 后缀从 2 起（-1 留给裸名，读起来不像"第二个"）。
  for (let n = 2; n <= 999; n++) {
    const tail = `-${n}`
    const room = Math.max(1, NAME_MAX - tail.length)
    const candidate = `${stem.slice(0, room)}${tail}`
    if (usable(candidate)) {
      reserved.add(candidate)
      return candidate
    }
  }
  // 理论上到不了这里（999 个尾巴不够用 = 同一个 28 字基底已经有 1000 条记录）；
  // 真到了就用 id 尾巴加数字，至少能保证写得出文件。
  for (let n = 1; n <= 999; n++) {
    const candidate = n === 1 ? fallback : `${fallback}-${n}`
    if (usable(candidate)) {
      reserved.add(candidate)
      return candidate
    }
  }
  const last = `${fallback}-${Date.now().toString(36)}`
  reserved.add(last)
  return last
}

/** 正则元字符转义，供动态构造引子匹配。 */
function escapeRe(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
