/**
 * metadata 枚举值的**唯一校验源**。
 *
 * 三套枚举彼此正交且值域不相交,但校验函数此前散落三处、Wing 侧还完全缺失:
 *  - Wing(生活域,metadata.hall)         → isWingId
 *  - 认知 hall(类型轴,metadata.cogHall)   → isCognitiveHall(定义在 cognitive-hall.ts,此处统一出口)
 *  - 标签(Room 的构成单元,metadata.tags)  → isTag / normTags
 *
 * 集中在此的目的:消灭重复词表(改词表只改一处)+ 让所有写回点走同一套校验。
 * 历史上 Wing 侧零校验,非法值先入库、再由下游剥离,形成无谓的写入-剥离循环。
 */
import { WING_CATALOG, WING_FALLBACK } from './types.js';
import { isCognitiveHall, COG_HALL_METADATA_KEY, type CognitiveHall } from './cognitive-hall.js';

/** Wing 词表(8 域 + general 兜底):与 relabel 机械校验、提示词候选集同源。 */
const WING_ID_SET: ReadonlySet<string> = new Set<string>([
  ...WING_CATALOG.map((w) => w.id),
  WING_FALLBACK,
]);

/**
 * Wing 严格校验:只认 8 域 + general 兜底。
 *
 * 注意与认知 hall 的**值域不相交**:`isWingId('facts')` 必须为 false —— 认知 hall 的值
 * 若被误当 Wing 写入 `metadata.hall`,会污染生活域轴。
 *
 * 刻意声明为 `boolean` 而非类型守卫 `v is WingValue`:词表的事实源是**运行期**的
 * `WING_ID_SET`,而 `WingId` 类型因 `WING_CATALOG` 标注为 `WingDef[]`(`id: string`)
 * 实际退化为 `string` ——守卫会变成 `v is string`,使 `!isWingId(x)` 的否定分支把
 * 已是 string 的变量收窄成 `never`(该分支内无法再 `.slice`,已在 wing-backfill 踩过)。
 */
export function isWingId(v: unknown): boolean {
  return typeof v === 'string' && WING_ID_SET.has(v);
}

/** 标签(Room 的构成单元)校验:小写字母数字连字符,1-32 字符。 */
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * 两级 Room slug(`major` 或 `major/minor`,各段满足 isTag;至多一个 slash)。
 * Room 注册表/归类写回的 tags 域;与 rooms-registry.ts 同一事实源(就近定义避免依赖环)。
 */
export function isRoomSlug(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const parts = v.split('/');
  return parts.length <= 2 && parts.every((p) => TAG_RE.test(p));
}

/** 同为布尔谓词(理由见 isWingId 注释)。 */
export function isTag(v: unknown): boolean {
  return typeof v === 'string' && TAG_RE.test(v);
}

/**
 * 标签归一 + 校验 + 去重 + 上限。**所有 tags 写回点都必须过这里**——
 * 无论标签来自真实 LLM 还是注入桩,归一化都不能只靠调用方自觉。
 */
export function normTags(v: unknown, max = 3): string[] {
  if (!Array.isArray(v) || max <= 0) return [];
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim().toLowerCase();
    if (!(isTag(t) || isRoomSlug(t)) || out.includes(t)) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export { isCognitiveHall, COGNITIVE_HALLS, type CognitiveHall } from './cognitive-hall.js';

/** usageScenario 单条最大长度(“何时该浮现”的短语，非 slug，故不校 isTag 字符集)。 */
const USAGE_SCENARIO_MAX_CHARS = 60;

/**
 * usageScenario 归一 + 去重 + 上限。**所有写回点必须过这里**。
 *
 * 与 normTags 的区别：usageScenario 是自然语言短语（如“修改 profile 配置时”），
 * 不是 slug，所以不做字符集校验，只做 trim/去重/长度钳制/上限。
 * 非数组或空→ `[]`（缺字段中性，不抛——防单条抽取失败波及整切片重试）。
 */
export function normUsageScenario(v: unknown, max = 3): string[] {
  if (!Array.isArray(v) || max <= 0) return [];
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim();
    if (!t || out.includes(t)) continue;
    out.push(t.slice(0, USAGE_SCENARIO_MAX_CHARS));
    if (out.length >= max) break;
  }
  return out;
}

/** 关键词检索轴的磁盘保留键（喂 `l1_fts.keywords` 列，读取侧见 `sqlite.ftsKeywordText`）。 */
export const KEYWORDS_METADATA_KEY = 'dsh_keywords';

/** 单个关键词最大字符数：按“词”太主观，用字符上限兜住整句泄漏（CJK 复合术语通常 ≤12）。 */
const KEYWORD_MAX_CHARS = 24;

/**
 * 关键词归一 + 去重（忽略大小写）+ 长度钳 + 上限。**所有 `dsh_keywords` 写回点必须过这里**。
 *
 * 与 `normUsageScenario` 同范式（关键词是自然语言术语/标识符，非 slug，不做字符集校验），
 * 只是上限更紧（≤5）、单条更短。非数组/空→`[]`（缺字段中性，不抛——防单条产出失败波及整批）。
 */
export function normKeywords(v: unknown, max = 5): string[] {
  if (!Array.isArray(v) || max <= 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t.slice(0, KEYWORD_MAX_CHARS));
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 读 **Wing（生活域）**。⚠️ 磁盘键是 `metadata.hall`——历史别名，存的其实是 **wing 值**。
 * 只认词表内的合法 wing（8 角 + general），否则 undefined。
 *
 * 用它取代裸读 `metadata.hall`：从入口上把“wing 轴”与“认知 hall 轴”分开，
 * 防止把认知 hall 值（facts/events/…）误当 wing 读——两轴不串。
 */
export function readWing(metadata: Record<string, unknown> | undefined | null): string | undefined {
  const v = metadata?.hall;
  return typeof v === 'string' && isWingId(v) ? v : undefined;
}

/**
 * 读 **认知 hall（大类）**。磁盘键 `metadata.cogHall`，与 wing 的磁盘键 `hall` 正交。
 * 只认五个枚举值，否则 undefined（wing 值不当认知 hall 读）。
 */
export function readCognitiveHall(metadata: Record<string, unknown> | undefined | null): CognitiveHall | undefined {
  const v = metadata?.[COG_HALL_METADATA_KEY];
  return isCognitiveHall(v) ? v : undefined;
}
