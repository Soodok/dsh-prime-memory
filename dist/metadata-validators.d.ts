import { type CognitiveHall } from './cognitive-hall.js';
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
export declare function isWingId(v: unknown): boolean;
/**
 * 两级 Room slug(`major` 或 `major/minor`,各段满足 isTag;至多一个 slash)。
 * Room 注册表/归类写回的 tags 域;与 rooms-registry.ts 同一事实源(就近定义避免依赖环)。
 */
export declare function isRoomSlug(v: unknown): boolean;
/** 同为布尔谓词(理由见 isWingId 注释)。 */
export declare function isTag(v: unknown): boolean;
/**
 * 标签归一 + 校验 + 去重 + 上限。**所有 tags 写回点都必须过这里**——
 * 无论标签来自真实 LLM 还是注入桩,归一化都不能只靠调用方自觉。
 */
export declare function normTags(v: unknown, max?: number): string[];
export { isCognitiveHall, COGNITIVE_HALLS, type CognitiveHall } from './cognitive-hall.js';
/**
 * usageScenario 归一 + 去重 + 上限。**所有写回点必须过这里**。
 *
 * 与 normTags 的区别：usageScenario 是自然语言短语（如“修改 profile 配置时”），
 * 不是 slug，所以不做字符集校验，只做 trim/去重/长度钳制/上限。
 * 非数组或空→ `[]`（缺字段中性，不抛——防单条抽取失败波及整切片重试）。
 */
export declare function normUsageScenario(v: unknown, max?: number): string[];
/**
 * 读 **Wing（生活域）**。⚠️ 磁盘键是 `metadata.hall`——历史别名，存的其实是 **wing 值**。
 * 只认词表内的合法 wing（8 角 + general），否则 undefined。
 *
 * 用它取代裸读 `metadata.hall`：从入口上把“wing 轴”与“认知 hall 轴”分开，
 * 防止把认知 hall 值（facts/events/…）误当 wing 读——两轴不串。
 */
export declare function readWing(metadata: Record<string, unknown> | undefined | null): string | undefined;
/**
 * 读 **认知 hall（大类）**。磁盘键 `metadata.cogHall`，与 wing 的磁盘键 `hall` 正交。
 * 只认五个枚举值，否则 undefined（wing 值不当认知 hall 读）。
 */
export declare function readCognitiveHall(metadata: Record<string, unknown> | undefined | null): CognitiveHall | undefined;
