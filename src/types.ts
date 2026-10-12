/**
 * 领域类型与词汇表(净室重写)。
 *
 * 覆盖:记忆族/档位、Hall 目录、L0/L1 记录形状、抽取产出与族判定三级兜底、
 * L2 场景摘要与 L1 检索命中。字段名与取值是磁盘/管线两侧的既定契约,不可更名。
 */
import { familyOf } from './memory-types.js';

/** 蒸馏 Prompt 家族:chat = 个人记忆(persona/episodic/instruction + 用户画像),work = 工作记忆(work_fact/work_task/work_method/work_artifact + Team Operating Doctrine)。 */
export type MemoryFamily = 'chat' | 'work';

/** 会话记忆档位:auto = 双族自动判定 | chat/work = 单族 | off = 本会话对记忆系统隐身。 */
export type MemoryMode = 'auto' | 'chat' | 'work' | 'off';

/** 蒸馏可用的档位(off 在捕获侧被拦截,永远到不了管线)。 */
export type ExtractMode = 'auto' | 'chat' | 'work';

/**
 * Hall(粗分类属性通道,与 family/type 正交):给 L1 记忆加一个跨族的可检索标签。
 * 8 角全为主线(experimental 字段已退休);`general` 不占角,降为中心专属兜底值
 * (WING_FALLBACK:跨域/无法归类时由智能档产出)。细粒度归属由 prompt 语义判断,
 * 跨域或实在无法归类时落 general(唯一允许的兜底)。
 */
export interface WingDef {
  id: string;
  label: string;
}

export const WING_CATALOG: WingDef[] = [
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
export const HALL_CORNERS: readonly WingDef[] = WING_CATALOG;

/** 默认启用的 Hall id(打标候选集,默认 8 角全集;归一化规则见 config.normWingEnabled)。 */
export const WING_DEFAULT_ENABLED = WING_CATALOG.map((h) => h.id);

export type WingId = (typeof WING_CATALOG)[number]['id'];

export function wingLabel(id: string): string {
  if (id === WING_FALLBACK) return '跨域';
  const h = WING_CATALOG.find((x) => x.id === id);
  return h ? h.label : id;
}

/**
 * Room(房间)= **标签类自生长分类**的构成单元:1 个 slug tag = 1 个 Room。
 *
 * MemPalace 五层映射里 Room 位于 Wing/Hall 之下、Closet/Drawer 之上:
 * Wing(生活域)与认知 hall(类型轴)都是**固定枚举**,而 Room **没有枚举**——
 * 它由记录上涌现的 `metadata.tags` 直接派生,新 tag 落库即成为新 Room(零注册、零迁移)。
 */
export interface RoomCount {
  /** Room 名 = 归一化后的 slug tag(小写字母数字连字符)。 */
  room: string;
  /** 该 Room 下的记录数(与 `wingL1Counts()` 同口径:含 retired 行)。 */
  count: number;
  /** 来源标示(rooms-get 端点层合并注册表后附带;'grown' = 自生长,可缺省)。 */
  source?: 'pre-registered' | 'grown';
  /** 人类可读名(注册表条目才有;面板 chip 可用 label 展示)。 */
  label?: string;
}

/**
 * 记录族标签推断（pm-name-distill task_1.2）：查 `TYPE_FAMILY_MAP`（词表单一真源）。
 *
 * 旧实现是 `type.startsWith('work')` 前缀猜族——新词表里 `project_*`/`development_*`/
 * `*_experience` 都是 work 族却不带 work 前缀，前缀判定会把它们静默归进 chat，
 * 而 family 决定召回/浏览/去重的共享面。未知值仍回落旧前缀规则并 warn 一次（可观测，
 * 不静默）。
 */
export function familyForType(type: string): MemoryFamily {
  return familyOf(type);
}

/**
 * 记忆的持续性(时间轴第三维,与 createdAt/updatedAt 正交):
 * - 'p' point     时点事件(某事在某刻发生)——历史事实,永不被"取代"
 * - 's' span      已结束的持续区间——validTo 是关键信息,不可被后来者改写
 * - 'o' open      仍在持续——被矛盾事实取代时应闭合 validTo 并标 rw
 * - 't' timeless  无时间性(规则/偏好/恒真事实)——不随时间失效
 *
 * 缺省(undefined)= 未判定:不参与取代/闭合判定,只当普通事实。
 */
export type Persistence = 'p' | 's' | 'o' | 't';

export const PERSISTENCE_VALUES: readonly Persistence[] = ['p', 's', 'o', 't'];

/** 持续性取值归一:只认 p/s/o/t,其余(缺省/非法)返回 undefined。 */
export function normPersistence(raw: unknown): Persistence | undefined {
  return typeof raw === 'string' && (PERSISTENCE_VALUES as readonly string[]).includes(raw)
    ? (raw as Persistence)
    : undefined;
}

/** 日志接口(适配 ctx.logger)。 */
export interface MemoryLogger {
  debug?(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/**
 * 会话位置锚点(R7):一条 L0 消息在内核会话日志里的精确坐标。
 *
 * 与 `source_message_ids` 的区别是本类型的**存在理由**:后者是 L0 消息 id
 * (`msg_<epoch_ms>_<hex>`),而 L0 表没有 turn/step 列 → 从一条记忆**跳不到**
 * 会话里的位置。锚点直接记录内核给出的 `(turn, step)`,与会话日志同一坐标系。
 *
 * **降级语义(红线)**:`turn` 拿不到时**整个锚点不成立**(`turn` 非可选);
 * `step` 拿不到(如 `user/message` 事件本身不带 step)时留空,**不得推算**。
 */
export interface ConversationAnchor {
  sessionId: string;
  /** 内核轮次号。缺它则该锚点无意义 → 由调用方直接不构造锚点。 */
  turn: number;
  /** 内核步骤号;`user/message` 等事件不带该字段时为 undefined(显式留空,不推算)。 */
  step?: number;
}

/** L0 会话消息(管线内的运行时形态)。 */
export interface ConversationMessage {
  /** 唯一消息 ID(L1 prompt 的 source_message_ids 追踪用)。 */
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** epoch ms */
  timestamp: number;
  /** 会话位置锚点(R7;捕获侧带上,老数据/无锚点场景缺省)。 */
  anchor?: ConversationAnchor;
}

/** L0 JSONL 记录(一条消息一行,磁盘事实源形状)。 */
export interface L0MessageRecord {
  sessionId: string;
  recordedAt: string;
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** 内核轮次(= anchor.turn);旧数据缺省。 */
  turn?: number;
  /** 内核步骤(= anchor.step);`user/message` 无 step 时缺省,不推算。 */
  step?: number;
}

/** L1 抽取产出(LLM 返回的记忆条目,尚未分配 record id)。 */
export interface ExtractedMemory {
  content: string;
  type: string;
  priority: number;
  source_message_ids: string[];
  metadata: Record<string, unknown>;
  /** 所属情境名(L1 抽取的情境切分结果)。 */
  scene_name: string;
  /** auto 档抽取输出的显式族判定(chat|work;纯档 Prompt 无此字段)。
   *  语境归族、形状不归族——避免"个人计划性事实被 work_* 形状吸走"的族错标。 */
  family?: string;
}

/** 抽取输出 family 字段归一:只认 chat|work,其余(缺省/非法值)交由调用方回落。 */
export function normExtractedFamily(raw: unknown): MemoryFamily | undefined {
  return raw === 'chat' || raw === 'work' ? raw : undefined;
}

/** 记录族三级兜底链:会话档位强制(纯档)→ 抽取显式判定(auto)→ type 前缀推导(旧输出兜底)。 */
export function resolveRecordFamily(
  forced: MemoryFamily | undefined,
  extracted: unknown,
  type: string,
): MemoryFamily {
  return forced ?? normExtractedFamily(extracted) ?? familyForType(type);
}

/**
 * 存储作用域(§E):**可见范围**,与 family(内容类型)正交(ADR-0008 条 1)。
 * - `global`    —— 跨工作区可见(默认;既有单根数据全部归此档);
 * - `workspace` —— 仅在本工作区可见。
 *
 * 正交的含义是**四象限都存在**。把这条轴与 family 合并(如"work 族一律 workspace")
 * 会把二维决策压成一维偏好,日后任何一格需要例外时都要返工。
 */
export type MemoryScope = 'global' | 'workspace';

/** 配置侧的作用域**模式**取值(与记录级归属同词汇,但语义是「新记忆默认归哪档」)。 */
export type ScopeMode = MemoryScope;

/** 作用域归一:非法/缺省一律归 `global`(ADR-0008 条 4:不抛错、不阻断启动)。 */
export function normScope(raw: unknown): MemoryScope {
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
export function isScopeVisible(scope: unknown, workspaceId: unknown, want: string): boolean {
  if (normScope(scope) === 'global') return true;
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
export function resolveRecordScope(
  cfgScope: ScopeMode,
  family: MemoryFamily,
  workspaceId?: string,
  explicit?: MemoryScope,
): { scope: MemoryScope; workspaceId: string } {
  const wantWorkspace = explicit ?? (cfgScope === 'workspace' && family === 'work' ? 'workspace' : 'global');
  // 没有工作区标识就无从谈"本工作区"——无论请求来自默认还是显式,一律回落 global
  if (wantWorkspace === 'workspace' && workspaceId) return { scope: 'workspace', workspaceId };
  return { scope: 'global', workspaceId: '' };
}

/** L1 持久化记录(磁盘与 DB 的权威形状;version/source_message_ids/metadata 由写入侧补默认)。 */
export interface MemoryRecord {
  id: string;
  content: string;
  type: string;
  priority: number;
  scene_name: string;
  /** 合并/更新时保留的时间戳并集。 */
  timestamps: number[];
  createdAt: number;
  updatedAt: number;
  /** 每条 update/merge 合并 +1。 */
  version?: number;
  /** 来源消息 id(JSONL 事实源保留;检索库不存该列)。 */
  source_message_ids?: string[];
  /**
   * 来源锚点集合(R7):本记忆**由哪些会话位置**蒸馏而来。
   *
   * 取值 = 该批 `source_message_ids` 逐个映射到的 `ConversationAnchor`,去重后按
   * `(turn, step)` 升序 —— 由 `pipeline/anchors.ts::resolveSourceAnchors` 计算。
   *
   * **落库位置**:与 `source_message_ids` 一样,检索库**不加列**;写入侧把它放进
   * `metadata_json` 的保留键 `dsh_source_anchors`(见 `ANCHOR_METADATA_KEY`),
   * 因为锚点是**派生元数据**而非事实列,而 `l1_records` 的 DDL 是磁盘契约。
   */
  sourceAnchors?: ConversationAnchor[];
  /** 类型附加信息(episodic 的活动起止时间等)。 */
  metadata?: Record<string, unknown>;
  /** 来源会话(缺省 default;跨会话记忆共享)。 */
  sessionId?: string;
  /** 所属族(写入缺省由 familyForType(type) 回填;召回/浏览/去重候选按族过滤的唯一依据)。 */
  family?: MemoryFamily;
  /** 可见范围(§E;写入缺省由 `resolveRecordScope` 回填,缺省 `global`)。
   *  与 family 正交:family 问"这是什么内容",scope 问"它该在多大范围内可见"。 */
  scope?: MemoryScope;
  /** 工作区标识(仅 `scope='workspace'` 时非空;`global` 记录恒为空串)。
   *  取值为会话 cwd 的归一形态——"哪个工作区"由会话本身回答,不做额外配置。 */
  workspaceId?: string;
  /**
   * 有效期起(epoch ms):该事实在**真实世界**开始成立的时间。
   * 与 createdAt(入库时间)是两条不同的轴——"2026-03 在 A 项目"这条事实,
   * createdAt 是它进库的时刻,validFrom 才是 2026-03。缺省 = 未知。
   */
  validFrom?: number;
  /**
   * 有效期止(epoch ms):该事实停止成立的时间。
   * 为空(undefined)表示**仍在持续**(persistence='o')或**无时间性**(persistence='t'),
   * 二者由 persistence 区分——这正是不能用"空值"当"已结束"的原因。
   */
  validTo?: number;
  /** 持续性(见 Persistence);缺省 = 未判定。 */
  persistence?: Persistence;
  /** repo 归属(basename(归一 cwd) 派生,ADR-0015 T1.9 写时算定):'' = 未归属 = 不围栏。 */
  repoKeyName?: string;
  /** repo 归属的人工消歧标注(同名不同仓;首版仅人工写)。 */
  repoKeyOwner?: string;
  /** 记录级 applicability(ADR-0015 T1.10):'' 未声明(不围栏)| 'this-repo' | 'cross-project';显式不从 family 推导。 */
  applicability?: string;
  /**
   * 外部导入幂等键(轨3-P0):`sha1(source_id \0 身份)`;非外部导入(内部蒸馏/add)= undefined/''。
   * 非空值受 `l1_records` 上部分唯一索引约束——同一 (来源, 内容/稳定身份) 重复导入结构性不可能。
   * 与 `scene_name`/`metadata.origin` 不同:这是**存储层强制去重键**,不是展示用的溯源标签。
   */
  extKey?: string;
  /**
   * 文件身份键（md 投射相，N1）：人可读、可编辑、全库唯一，直接当
   * `<root>/<type>/<name>.memory.md` 的文件名。与 `extKey` 的分工：extKey 是
   * **导入幂等键**（机器算的、来源内唯一），name 是**文件身份**（人写的、全库唯一）。
   * 不用 id 当身份：id 每轮新铸、从不复用；不用 scene_name：它的基数大于记录数。
   * undefined = 还没名字（存量记录），投射器则回落 `mem-<id8>`。
   * 非空值受 `l1_records` 上的部分唯一索引约束；该列**不进**快照哈希投影。
   */
  name?: string;
}

/** L2 场景块摘要(META 解析结果)。 */
export interface SceneSummary {
  path: string;
  created: string;
  updated: string;
  summary: string;
  heat: number;
}

/** L1 检索命中。 */
export interface L1Hit {
  id: string;
  content: string;
  type: string;
  scene_name: string;
  score: number;
  priority?: number;
  family?: MemoryFamily;
}

/**
 * dsh-llm ≥0.1.7-rc.1(会话格式 v4)的 producer-owned source kind 登记。
 *
 * v4 移除了 `MessageSourceMap` 的 catch-all `plugin` kind(message.d.ts 注释明言
 * "each producer declares its own `kind` in its own module"),各生产者须在自己的
 * 模块里以 declaration merging 登记自有 kind;未登记则 `createUserMessage({ source })`
 * 在类型层报 TS2345(封闭联合,无 index signature)。本仓两处写侧(recall 注入 /
 * 槽位常驻注入)使用 `plugin:memory` + `form:'recall'`(ContextFormed 的 recall
 * 变体无伴随字段,0.1.7-rc.2 message.d.ts:75-93 实证)。
 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    // ContextFormed 经包入口的类型导出(dsh-llm index re-export message.ts)以
    // import() 类型位置引用;本文件无顶层 import,直接写 `ContextFormed` 会报 TS2304。
    'plugin:memory': { kind: 'plugin:memory' } & import('@deepseek-ai/dsh-llm').ContextFormed;
  }
}

/**
 * 宿主 todo/write 事件的类型登记(运行时注册于 dsh-session 的
 * known-event-types;包类型到 0.2.0-rc.1 仍未声明,插件自扩充——
 * 同 §E 的 dsh-compaction 先例,declare module 合并 SessionEventMap)。
 *
 * 数据是全量快照 `{ todos: [{content,status}] }`(dsh-commands typert.host.js
 * 实证):每次写入都是整份清单,不做增量。
 */
// augmentation 目标须先进入程序(import 触发解析),否则 TS2664。
import type {} from '@deepseek-ai/dsh-session/types';

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'todo/write': {
      todos: Array<{ content: string; status: string }>;
    };
  }
}
