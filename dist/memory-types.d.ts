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
export declare const HOST_MEMORY_TYPES: readonly string[];
/** 插件早期 7 类（蒸馏管线现役词表；库里存量正带着，永久保留）。 */
export declare const LEGACY_MEMORY_TYPES: readonly string[];
/**
 * 兜底目录名（不是可赋值类型）：不在词表的 `type` 原值照旧写进 frontmatter，
 * 只在**目录层**归这里。归进某个 `work_*` 会静默把这批记录的 family 挑到 work 侧
 * （family 决定共享面），所以它自成一桶、族取 chat。
 */
export declare const UNCLASSIFIED_DIR = "unclassified";
/**
 * 非词表 type 进入写路径时的降级目标。旧代码在 `tools/index.ts` 里把 `'episodic'`
 * 当字面量散写；集中到这里，降级行为至少有一个可 grep 的名字。
 */
export declare const DOWNGRADE_TARGET = "episodic";
/** 可赋值类型全集（宿主 29 + 旧 7 = 36；`unclassified` 不在其中——它是目录，不是类型）。 */
export declare const MEMORY_TYPE_VOCABULARY: ReadonlySet<string>;
/**
 * 族映射（新旧同放）。旧 `familyForType` 靠 `type.startsWith('work')` 前缀猜族，
 * 新词表里 `project_*`/`development_*`/`*_experience` 都是 work 族却不带 work 前缀——
 * 前缀判定会把它们静默归进 chat，而 family 决定召回/浏览/去重的共享面。
 */
export declare const TYPE_FAMILY_MAP: Readonly<Record<string, TypeFamily>>;
/** 类型 → 面板中文标签（真源；client 侧经 `list-records` 的 `typeCatalog` 下发消费）。 */
export declare const MEMORY_TYPE_LABELS: Readonly<Record<string, string>>;
/** 投射目录全集 = 可赋值类型 + 兜底桶（37 个）。`memory-md.ts` 的白名单从这里派生。 */
export declare function memoryTypeDirs(): ReadonlySet<string>;
/** 是否为词表内类型（写路径白名单判据；`unclassified` 不算——没人该主动赋它）。 */
export declare function isKnownType(type: string): boolean;
/** 族查询：查表；未知值回落旧前缀规则并交给 `onUnknownFamily` 提醒一次。 */
export declare function familyOf(type: string): TypeFamily;
/**
 * CSS 类名用的 slug（`work_fact` → `work-fact`）。
 *
 * 面板标签类名以前直接拼 `type` 原值（下划线），而主题 CSS 定义的是连字符类——
 * `dsh-mem-tag-work_fact` 匹配不上 `.dsh-mem-tag-work-fact`，标签无色（F11 既有断裂）。
 * 拼接点统一走这里，判据只有一份。
 */
export declare function slugOf(type: string): string;
/** 面板词表目录（下发给 client 的 `typeCatalog`；含兜底桶，顺序 = 旧 7 → 宿主 29 → 兜底）。 */
export declare function typeCatalogEntries(): Array<{
    id: string;
    label: string;
}>;
/** chat / work 族的可赋值类型（prompt 枚举串从这里渲染，不再手抄）。 */
export declare function typesOfFamily(family: TypeFamily): string[];
/** prompt/工具描述用的枚举串（`|` 或 `/` 连接，顺序稳定：旧 7 在前）。 */
export declare function typeEnumSep(sep: string, family?: TypeFamily): string;
/** 测试/宿主接线用：替换未知族的提醒出口（传 undefined 恢复 console）。 */
export declare function setFamilyWarnSink(sink?: (msg: string) => void): void;
/** 清空"已提醒"集（用例要能反复断言只 warn 一次）。 */
export declare function resetFamilyWarned(): void;
