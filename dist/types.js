/**
 * 领域类型与词汇表(净室重写)。
 *
 * 覆盖:记忆族/档位、Hall 目录、L0/L1 记录形状、抽取产出与族判定三级兜底、
 * L2 场景摘要与 L1 检索命中。字段名与取值是磁盘/管线两侧的既定契约,不可更名。
 */
import { familyOf } from './memory-types.js';
export const WING_CATALOG = [
    { id: 'work', label: '工作' },
    { id: 'relationships', label: '人际' },
    { id: 'learning', label: '学习' },
    { id: 'creative', label: '创作娱乐' },
    // 居家在健康之前(八边形顺时针序,用户 2026-09-23 对调)
    { id: 'home', label: '居家' },
    { id: 'health', label: '健康' },
    { id: 'finance', label: '财务' },
    { id: 'journey', label: '出行' },
];
/** 跨域兜底值:移出角集,仅作为"无法归入任何角"的中心专属产出(不再进角集/门面)。 */
export const WING_FALLBACK = 'general';
/** 八边形角集 = 全目录(角集固定,不随 wing.enabled 开关改变形状;开关只把角画灰)。 */
export const HALL_CORNERS = WING_CATALOG;
/** 默认启用的 Hall id(打标候选集,默认 8 角全集;归一化规则见 config.normWingEnabled)。 */
export const WING_DEFAULT_ENABLED = WING_CATALOG.map((h) => h.id);
export function wingLabel(id) {
    if (id === WING_FALLBACK)
        return '跨域';
    const h = WING_CATALOG.find((x) => x.id === id);
    return h ? h.label : id;
}
/**
 * 记录族标签推断（pm-name-distill task_1.2）：查 `TYPE_FAMILY_MAP`（词表单一真源）。
 *
 * 旧实现是 `type.startsWith('work')` 前缀猜族——新词表里 `project_*`/`development_*`/
 * `*_experience` 都是 work 族却不带 work 前缀，前缀判定会把它们静默归进 chat，
 * 而 family 决定召回/浏览/去重的共享面。未知值仍回落旧前缀规则并 warn 一次（可观测，
 * 不静默）。
 */
export function familyForType(type) {
    return familyOf(type);
}
export const PERSISTENCE_VALUES = ['p', 's', 'o', 't'];
/** 持续性取值归一:只认 p/s/o/t,其余(缺省/非法)返回 undefined。 */
export function normPersistence(raw) {
    return typeof raw === 'string' && PERSISTENCE_VALUES.includes(raw)
        ? raw
        : undefined;
}
/** 抽取输出 family 字段归一:只认 chat|work,其余(缺省/非法值)交由调用方回落。 */
export function normExtractedFamily(raw) {
    return raw === 'chat' || raw === 'work' ? raw : undefined;
}
/** 记录族三级兜底链:会话档位强制(纯档)→ 抽取显式判定(auto)→ type 前缀推导(旧输出兜底)。 */
export function resolveRecordFamily(forced, extracted, type) {
    return forced ?? normExtractedFamily(extracted) ?? familyForType(type);
}
/** 作用域归一:非法/缺省一律归 `global`(ADR-0008 条 4:不抛错、不阻断启动)。 */
export function normScope(raw) {
    return typeof raw === 'string' && raw.toLowerCase() === 'workspace' ? 'workspace' : 'global';
}
/**
 * 可见性判定(§E **读取侧**,与 `resolveRecordScope` 是同一判据的两面)。
 * `global` 记录对任何工作区可见;`workspace` 记录只对**归属工作区相同**的调用可见。
 *
 * `want` 为空串表示"不做过滤"——调用方没传工作区标识(即 `cfg.scope='global'`)时
 * 必须**看不见这个函数存在**,而不是"过滤掉一切"。两条路径分开写死,
 * 免得日后有人把"没传"误当成"匹配空归属"。
 */
export function isScopeVisible(scope, workspaceId, want) {
    if (normScope(scope) === 'global')
        return true;
    return typeof workspaceId === 'string' && workspaceId !== '' && workspaceId === want;
}
/**
 * 记录级归属判定(§E 写入侧)。与 `resolveRecordFamily` 同构的三级链:
 * **记录显式覆盖 → 配置模式默认 → 兜底 global**。
 *
 * 三条刻意的规则:
 * ① `workspace` 模式下 **work 族默认归 workspace、chat 族默认仍 global**——
 *    个人记忆本就该跨项目("用户偏好简洁回答"不属于任何项目),而污染面恰在项目之间。
 *    注意这是**默认值不是推导规则**:`explicit` 能把它推翻(四象限)。
 * ② **工作区标识缺失时回落 `global`**——不抛、不阻断。宁可退化成"全局可见",
 *    也不能因为拿不到 cwd 就让记忆**写不进去**(fail-open,与本仓库既有降级同向)。
 * ③ `cfg='global'` 时**不写**工作区归属(清空 `workspaceId`)——保证既有部署零漂移:
 *    检索侧"是否传 workspaceId"就是开关,不传即不过滤。
 *
 * @param explicit 记录级显式声明(四象限的载体)。**当前无产品调用方**,
 *   存在的意义是把"正交"从文档里的一句话变成可测的语义;写入入口属未排期项。
 */
export function resolveRecordScope(cfgScope, family, workspaceId, explicit) {
    const wantWorkspace = explicit ?? (cfgScope === 'workspace' && family === 'work' ? 'workspace' : 'global');
    // 没有工作区标识就无从谈"本工作区"——无论请求来自默认还是显式,一律回落 global
    if (wantWorkspace === 'workspace' && workspaceId)
        return { scope: 'workspace', workspaceId };
    return { scope: 'global', workspaceId: '' };
}
