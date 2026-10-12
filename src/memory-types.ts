/**
 * 记忆类型词表的**唯一事实源**（pm-name-distill A 节）。
 *
 * 在此之前，"类型全集"手抄在四处：`MEMORY_TYPE_DIRS`（投射目录）、`ADD_TYPES`（写入白名单）、
 * `TYPE_LABELS`（面板标签）、抽取/去重 prompt 的枚举串。四处各自演化过——宿主记忆分类
 * （29 类）与插件 7 类字面交集为空，`memory_add` 把外部分类**静默改写**成 `episodic`，
 * 而 memport 的警告文案却承诺"按原样透传"。同一件事两套口径，漂移只是时间问题。
 *
 * 词表内容 = **宿主 29 类原名**（与 memport 导入的分类字面一致，不再造 `dev_*`/`exp_*`
 * 那层映射——映射层每多一处就多一处漂移）+ 插件旧 7 类（库里 1166 条正带着它们，
 * 不许一夜之间全变 `unclassified`）+ `unclassified` 兜底目录。
 *
 * 本文件必须**零依赖运行**（不引 node: 模块）：client 侧与 server 侧同源消费，
 * prompt 渲染也从这里派生。
 */

/** 类型族（与 `types.ts` 的 `MemoryFamily` 同域；这里重述字面量以免运行时循环引用）。 */
export type TypeFamily = 'chat' | 'work';

/** 宿主记忆分类的 29 类原名（实测自宿主记忆目录树，条数分布见计划 findings 第一节）。 */
export const HOST_MEMORY_TYPES: readonly string[] = [
  // —— 个人可见（chat 族）：用户画像的四类 ——
  'user_info', 'user_hobby', 'user_communication', 'user_behavior',
  // —— 项目轴（work 族）——
  'project_introduction', 'project_tech_stack', 'project_architecture',
  'project_build_configuration', 'project_dependency_configuration', 'project_ide_configuration',
  'project_scm_configuration', 'project_environment_configuration', 'project_rule',
  // —— 开发规范轴（work 族）——
  'development_code_specification', 'development_practice_specification',
  'development_test_specification', 'development_comment_specification',
  // —— 经验轴（work 族）——
  'task_summary_experience', 'task_breakdown_experience', 'task_flow_experience', 'task_experience',
  'tool_experience', 'mcp_experience', 'skill_experience', 'learned_skill_experience',
  'expert_experience', 'important_decision_experience', 'common_pitfalls_experience',
  'history_task_reference_files',
];

/** 插件早期 7 类（蒸馏管线现役词表；库里存量正带着，永久保留）。 */
export const LEGACY_MEMORY_TYPES: readonly string[] = [
  'persona', 'episodic', 'instruction', 'work_fact', 'work_task', 'work_method', 'work_artifact',
];

/**
 * 兜底目录名（不是可赋值类型）：不在词表的 `type` 原值照旧写进 frontmatter，
 * 只在**目录层**归这里。归进某个 `work_*` 会静默把这批记录的 family 挑到 work 侧
 * （family 决定共享面），所以它自成一桶、族取 chat。
 */
export const UNCLASSIFIED_DIR = 'unclassified';

/**
 * 非词表 type 进入写路径时的降级目标。旧代码在 `tools/index.ts` 里把 `'episodic'`
 * 当字面量散写；集中到这里，降级行为至少有一个可 grep 的名字。
 */
export const DOWNGRADE_TARGET = 'episodic';

/** 可赋值类型全集（宿主 29 + 旧 7 = 36；`unclassified` 不在其中——它是目录，不是类型）。 */
export const MEMORY_TYPE_VOCABULARY: ReadonlySet<string> = new Set<string>([
  ...LEGACY_MEMORY_TYPES, ...HOST_MEMORY_TYPES,
]);

/**
 * 族映射（新旧同放）。旧 `familyForType` 靠 `type.startsWith('work')` 前缀猜族，
 * 新词表里 `project_*`/`development_*`/`*_experience` 都是 work 族却不带 work 前缀——
 * 前缀判定会把它们静默归进 chat，而 family 决定召回/浏览/去重的共享面。
 */
export const TYPE_FAMILY_MAP: Readonly<Record<string, TypeFamily>> = Object.freeze(
  (() => {
    const map: Record<string, TypeFamily> = {};
    for (const t of LEGACY_MEMORY_TYPES) map[t] = t.startsWith('work') ? 'work' : 'chat';
    for (const t of HOST_MEMORY_TYPES) map[t] = t.startsWith('user_') ? 'chat' : 'work';
    map[UNCLASSIFIED_DIR] = 'chat';
    return map;
  })(),
);

/** 类型 → 面板中文标签（真源；client 侧经 `list-records` 的 `typeCatalog` 下发消费）。 */
export const MEMORY_TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  persona: '画像偏好',
  episodic: '客观事件',
  instruction: '全局指令',
  work_fact: '工作事实',
  work_task: '工作任务',
  work_method: '工作方法',
  work_artifact: '工作资产',
  user_info: '用户信息',
  user_hobby: '用户爱好',
  user_communication: '沟通风格',
  user_behavior: '行为规范',
  project_introduction: '项目介绍',
  project_tech_stack: '技术栈',
  project_architecture: '架构设计',
  project_build_configuration: '构建配置',
  project_dependency_configuration: '依赖配置',
  project_ide_configuration: 'IDE 配置',
  project_scm_configuration: '版本控制配置',
  project_environment_configuration: '环境配置',
  project_rule: '项目规则',
  development_code_specification: '代码规范',
  development_practice_specification: '实践规范',
  development_test_specification: '测试规范',
  development_comment_specification: '注释规范',
  task_summary_experience: '任务总结',
  task_breakdown_experience: '任务拆解',
  task_flow_experience: '任务流程',
  task_experience: '任务经验',
  tool_experience: '工具经验',
  mcp_experience: 'MCP 经验',
  skill_experience: '技能经验',
  learned_skill_experience: '习得技能',
  expert_experience: '专家经验',
  important_decision_experience: '重要决策',
  common_pitfalls_experience: '常见陷阱',
  history_task_reference_files: '历史参考文件',
  [UNCLASSIFIED_DIR]: '未分类',
} as Record<string, string>);

/** 投射目录全集 = 可赋值类型 + 兜底桶（37 个）。`memory-md.ts` 的白名单从这里派生。 */
export function memoryTypeDirs(): ReadonlySet<string> {
  return new Set<string>([...MEMORY_TYPE_VOCABULARY, UNCLASSIFIED_DIR]);
}

/** 是否为词表内类型（写路径白名单判据；`unclassified` 不算——没人该主动赋它）。 */
export function isKnownType(type: string): boolean {
  return MEMORY_TYPE_VOCABULARY.has(type);
}

/** 族查询：查表；未知值回落旧前缀规则并交给 `onUnknownFamily` 提醒一次。 */
export function familyOf(type: string): TypeFamily {
  const f = TYPE_FAMILY_MAP[type];
  if (f !== undefined) return f;
  noteUnknown(type);
  return type.startsWith('work') ? 'work' : 'chat';
}

/**
 * CSS 类名用的 slug（`work_fact` → `work-fact`）。
 *
 * 面板标签类名以前直接拼 `type` 原值（下划线），而主题 CSS 定义的是连字符类——
 * `dsh-mem-tag-work_fact` 匹配不上 `.dsh-mem-tag-work-fact`，标签无色（F11 既有断裂）。
 * 拼接点统一走这里，判据只有一份。
 */
export function slugOf(type: string): string {
  return type.replace(/_/g, '-');
}

/** 面板词表目录（下发给 client 的 `typeCatalog`；含兜底桶，顺序 = 旧 7 → 宿主 29 → 兜底）。 */
export function typeCatalogEntries(): Array<{ id: string; label: string }> {
  return [...LEGACY_MEMORY_TYPES, ...HOST_MEMORY_TYPES, UNCLASSIFIED_DIR].map((id) => ({
    id,
    label: MEMORY_TYPE_LABELS[id] ?? id,
  }));
}

/** chat / work 族的可赋值类型（prompt 枚举串从这里渲染，不再手抄）。 */
export function typesOfFamily(family: TypeFamily): string[] {
  return [...MEMORY_TYPE_VOCABULARY].filter((t) => TYPE_FAMILY_MAP[t] === family);
}

/** prompt/工具描述用的枚举串（`|` 或 `/` 连接，顺序稳定：旧 7 在前）。 */
export function typeEnumSep(sep: string, family?: TypeFamily): string {
  const list = family === undefined ? [...LEGACY_MEMORY_TYPES, ...HOST_MEMORY_TYPES] : typesOfFamily(family);
  return list.join(sep);
}

// —— 未知类型的"只提醒一次"：诊断集封到 64 个就不再记录（宁可漏提醒，不让集合无限吃内存）。
const warnedUnknownFamilies = new Set<string>();
let warnSink: (msg: string) => void = (msg) => console.warn(msg);

/** 测试/宿主接线用：替换未知族的提醒出口（传 undefined 恢复 console）。 */
export function setFamilyWarnSink(sink?: (msg: string) => void): void {
  warnSink = sink ?? ((msg) => console.warn(msg));
}

/** 清空"已提醒"集（用例要能反复断言只 warn 一次）。 */
export function resetFamilyWarned(): void {
  warnedUnknownFamilies.clear();
}

function noteUnknown(type: string): void {
  if (warnedUnknownFamilies.has(type)) return;
  if (warnedUnknownFamilies.size < 64) warnedUnknownFamilies.add(type);
  warnSink(`[memory] type '${type}' 不在词表，family 按旧前缀规则回落（请核对来源）`);
}
