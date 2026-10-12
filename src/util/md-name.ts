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
 * 入库闸门的长度上限（字符）。人/模型**有意给**的名字允许到这里。
 *
 * 历史：24 → 28 → **40**。放宽的理由不是“名字长点好看”，是**计数把 ASCII 与汉字同价**：
 * 本项目记忆标题里 `dsh-agent-teams`、`Python-3.13`、`NeatDownloader` 这类标识符很常见，
 * 一个词就吃掉 13–16 个额度，于是语义上只有一两个词的正当名在字符上“超长”
 * （真机 13 条 fallback 里 3 条属此类）。28 的代价不是难看，是把已经拿到的语义丢掉重算。
 * 仍钉在 40 而不是更松：投射路径要留在 Windows `MAX_PATH` 里，而且超过 40 的名
 * 几乎必然是句子而不是标题。
 */
export const NAME_MAX = 40

/**
 * 规则兜底名（{@link deriveName}）的截断上限，**故意比闸门紧**。
 *
 * 两者不能合为一个数（实测过：统一放 40 后，`buildTurnCompactSystemPrompt` 会拖出
 * 「负责组装每一轮的系统提示」这种句子尾巴）：`deriveName` 吃的是**叙述句**，多给的额度
 * 只会被句子吃掉；而闸门吃的是**人/模型写的标题**，那里长度是语义而不是噪声。
 * 28 仍是兜底名不至于变成句子的上限。
 */
export const NAME_CLIP_MAX = 28

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

/**
 * 闸门用的引子表 = 剥引子表**去掉裸主语**（`用户` / `团队`）。
 *
 * 两张表本来就该是两个用途，之前共用一份是误杀源：
 * - `deriveName` 吃的是**完整叙述句**，句首裸「用户」只是话头、不含信息量，该剥；
 * - `validateTitle` 吃的是**人/模型给的名词短语**，「用户npm账号用户名」「团队profile配置」里的
 *   「用户/团队」是正当的所属主语，当成叙述引子拒掉就是误杀（真机改名计划 13 条 fallback 里 10 条栽在这两个词）。
 * 所以这不是把闸门调松，是把「剥话头」与「拒名字」分开——短语类引子（用户要求/团队已/针对/本次…）照旧拒。
 */
const GATE_LEAD_IN_SORTED = LEAD_IN_SORTED.filter((lead) => lead !== '用户' && lead !== '团队')

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
  s = clipAtTokenBoundary(s, NAME_CLIP_MAX)
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
 *
 * 导出是因为**改名侧也要同一个收梢算法**：模型给的 title 只是超长（`too-long`）时，
 * 按词元边界收一刀仍是好名字，直接回落 `deriveName` 等于把已经拿到的语义扔掉重算。
 * 两处共用一份，截断形状才不会分头演化。
 */
export function clipAtTokenBoundary(raw: string, maxLen: number): string {
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
  if (s.length > NAME_MAX) return { ok: false, reason: 'too-long' }
  if (/[。！？!?.]$/.test(s)) return { ok: false, reason: 'ends-with-punctuation' }
  if (/[A-Za-z]:[\\/]/.test(s)) return { ok: false, reason: 'has-drive-path' }
  if (s.includes('/')) return { ok: false, reason: 'has-slash' }
  if (/http/i.test(s)) return { ok: false, reason: 'has-url' }
  // 只拒**真 id 形状**（session-44332549…）：宽判 `session-` 子串会把
  // `dsh-session-steward` 这类正当词组名误拒（真机改名计划实测 4/20 的误杀源）。
  if (/session-[0-9a-f]{6,}/i.test(s)) return { ok: false, reason: 'has-session-id' }
  if (/[0-9a-fA-F]{32,36}/.test(s)) return { ok: false, reason: 'has-hex-id' }
  // 数字尾巴**只在它不属于某个标识符名字**时才算残片：`记录-12345-号` 是截断产物（数字前是 CJK），
  // 而 `ADR-0006`、`Han-1413141` 里数字前面是 ASCII 字母——那是名字本体（`[^ -~]` = 非可打印 ASCII）。
  // 旧判据一律拒 `-\d{4}`，真机把 4 条 ADR 记录的正当 LLM 标题全打进 fallback（反而掉回 `ADR-0006` 这种半截名）。
  if (/[^ -~]-\d{4}/.test(s)) return { ok: false, reason: 'has-id-fragment' }
  if (startsNarrativeLeadIn(s)) return { ok: false, reason: 'starts-with-lead-in' }
  if (isBareCodeIdentifier(s)) return { ok: false, reason: 'code-identifier' }
  const safe = sanitizeFilename(s).replace(/\.md$/i, '')
  if (safe.length === 0) return { ok: false, reason: 'no-usable-char' }
  return { ok: true, name: safe }
}

/** 是否以叙述引子开头（用 {@link GATE_LEAD_IN_SORTED}：剥引子与拒名字两张表用途不同，见其注释）。 */
function startsNarrativeLeadIn(s: string): boolean {
  return GATE_LEAD_IN_SORTED.some((lead) => s.startsWith(lead))
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
