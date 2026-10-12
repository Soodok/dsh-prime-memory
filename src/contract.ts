/**
 * RPC 契约单一事实源(types-only,零运行时代码)。
 *
 * host(stats 端点路由)与 client(浏览器侧)共用的全部 `dsh-memory/*` 端点
 * 请求/响应类型收敛于此,两端各自 `import type`,契约漂移在编译期暴露。
 *
 * 铁律:
 * - 本文件只允许 type/interface 与纯类型推导,不 import 任何运行时值
 *   (tsc 产出空 contract.js,client bundle 里 import type 被 esbuild 擦除);
 * - 响应类型按端点实际返回逐字段建模,含 `chain.current[].reasoningEffort` 与
 *   `chain.effectiveChain[].effort` 这对故意不同名的字段——链上两种条目形状
 *   不同,不合并;
 * - 端点全集为 26 个(含面板高权限删除 records-delete 与图谱两端点)。
 */
import type { MemoryFamily, MemoryMode, RoomCount } from './types.js';
// Room 是客户端也要用的领域形状(rooms-get 响应与 list-records 请求都涉及),
// 从 types 转出,client 只认 contract 这一处入口。
export type { RoomCount };
// 纯类型导入:图谱域形状(运行时常量在 graph/types.ts,import type 不会拉入)
import type { GraphEdge, GraphNode } from './graph/types.js';

// ── 基础词汇 ──

/** 蒸馏思考档位:'' = 自动(模型默认档 → high)。运行时词汇表源是 config.ts 的
 *  EFFORT_CHOICES(satisfies readonly EffortChoice[] 反向锁定防漂移)。 */
export type EffortChoice = '' | 'off' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** 蒸馏用量/成本记账的层标识(调用点口径)。graph = 知识图谱投影调用。 */
export type DistillLayer = 'l1-extract' | 'l1-dedup' | 'l2' | 'l3' | 'graph';

/** 分层输出预算的层键(与 DistillLayer 不同:预算按管线阶段,用量按调用点)。 */
export type DistillBudgetLayer = 'extract' | 'dedup' | 'l2' | 'l3' | 'graph';

/** 分层输出预算(token):0 = 跟随内置默认。 */
export type DistillBudgets = Record<DistillBudgetLayer, number>;

/**
 * 运行时统一路由链条目:[0] = 主路由(provider/model 双空 = 跟随默认模型),
 * [1..] = 回退链(按序降级);reasoningEffort 为该路由的档位覆盖('' = 跟随部署全局)。
 */
export interface DistillChainEntry {
  provider: string;
  model: string;
  reasoningEffort: EffortChoice;
}

/** 部署静态回退链条目(config.llm.fallbacks):reasoningEffort 可选——与运行时链
 *  DistillChainEntry(必填)形状不同,不共用类型。 */
export interface StaticFallbackEntry {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

/** 按层路由的层键:l1 同管 l1-extract + l1-dedup 两个调用点(与成本看板按层归并同源);
 *  graph 投影不配层链(回全局解析);预算键(DistillBudgetLayer)是另一套五键词表,不混用。 */
export type LayerRouteKey = 'l1' | 'l2' | 'l3';

/** 记忆模式运行时开关(settings-get/set 的 settings 载荷)。 */
export interface MemoryLiveSettings {
  /** 总开关:关 = 捕获/蒸馏/召回注入全停(数据保留) */
  enabled: boolean;
  /** 工具分组封印:false = 该组工具不注册,从模型工具列表消失。核心读(memory_search/read_scene/receipts/conversation_search)与槽位三件不受控 */
  toolRoom: boolean;
  toolGraph: boolean;
  toolRuminate: boolean;
  toolConflict: boolean;
  toolMutate: boolean;
  /** L0 捕获(原始对话落盘) */
  capture: boolean;
  /** L1 抽取 + L2/L3 蒸馏 */
  distill: boolean;
  /** 召回注入(画像/记忆上下文) */
  recall: boolean;
  /** 蒸馏思考档位运行时覆盖:'' = 跟随静态 config(llm.reasoningEffort) */
  reasoningEffort: EffortChoice;
  /** 蒸馏模型运行时覆盖(供应商 id):'' = 跟随静态 config/默认选择。
   *  与 distillModel 成对生效(单字段不算);部署静态 pin(provider+model 双字段)优先。 */
  distillProvider: string;
  /** 蒸馏模型运行时覆盖(模型 id):'' = 跟随静态 config/默认选择。 */
  distillModel: string;
  /** 运行时统一路由链;非空即权威(旧 distillProvider/distillModel/reasoningEffort 不再参与),
   *  空数组 = 跟随部署静态配置与默认模型。 */
  distillChain: DistillChainEntry[];
  /** 分层输出预算运行时覆盖(token):extract/dedup/l2/l3/graph 五层,0 = 跟随内置默认;
   *  思考档 high/max 的 ×4 放大在覆盖值之上照常生效。 */
  distillBudgets: DistillBudgets;
  /** 输入预算运行时覆盖(字符,≈token):单次蒸馏调用的输入上限,L1 按此分块、
   *  超限截断;0 = 跟随静态配置 llm.maxInputChars。 */
  distillMaxInputChars: number;
  /** 运行时按层路由链:层键 l1/l2/l3 各一条完整链;非空即完整接管该层解析
   *  (压过静态 layerRoutes,层内第一优先级);空数组 = 该层跟随(静态层链 → 全局解析逐级兜底)。
   *  写入经 settings-set 逐层校验(头行必须显式)。 */
  distillLayerChains: Record<LayerRouteKey, DistillChainEntry[]>;
  /** 蒸馏通道运行时覆盖:'' = 跟随部署 config(llm.mode);'host' = 复用宿主 ctx.llm;
   *  'direct' = 插件原生直连 llm.baseURL。经 effectiveCfg 注入 cfg.llm.mode。 */
  distillMode: '' | 'host' | 'direct';
  /** 运行时直连端点覆盖(OpenAI 兼容 /v1,'direct' 用):经 effectiveCfg 注入 cfg.llm.baseURL。
   *  非机密,可原样回显。 */
  directBaseURL: string;
  /** 运行时直连 API Key 覆盖(仅 'direct' 用,可空 = 本地免 key):
   *  经 effectiveCfg 注入 cfg.llm.apiKey。属机密,任何回读/日志须脱敏。 */
  directApiKey: string;
  /** 远程嵌入端点运行时覆盖:注入 cfg.embedding.baseUrl。
   *  (远程嵌入连接从部署 YAML 改为可在设置 UI 编辑——D 系列评审的 UX 缺口。) */
  embedRemoteBaseURL: string;
  /** 远程嵌入 API Key 运行时覆盖:注入 cfg.embedding.apiKey。属机密,不回读明文、不落日志。 */
  embedRemoteApiKey: string;
  /** 远程嵌入模型名运行时覆盖:注入 cfg.embedding.model。 */
  embedRemoteModel: string;
  /** 远程嵌入维度运行时覆盖:注入 cfg.embedding.dimensions;0 = 未配置/跟随部署。 */
  embedRemoteDimensions: number;
  /** 记忆写删权限门:true 才允许写删记忆工具(memory_add/memory_delete)与面板高权限删除
   *  (records-delete)。默认 false(模型写删风险高,须显式在面板开启高权限模式)。 */
  memoryMutate: boolean;
  /** §C 人工冲突裁决总开关:true = 去重判定"两边都像对的"时冻结冲突对,停放到待人工裁决区;
   *  false = 默认,冲突按 LLM 的 winner/loser 自动了结。运行时覆盖静态 config 的 conflictFreeze.enabled。 */
  conflictFreeze: boolean;
  /** 轨2 技能结晶总开关（看板可拨）:true = 注册 memory_skill_* 工具、注入 active 技能、skills-* 端点可用。
   *  默认 false（新功能默认关）；与部署 cfg.skills.enabled 取或（任一开则生效）。 */
  skillsEnabled: boolean;
}

/** 召回停用原因(session-stats recall.enabled=false 时带出;短路序第一个为假的因子)。 */
export type RecallDisabledReason = 'deploy' | 'global' | 'session' | 'mode';

/** 单会话召回统计(悬浮卡信息区数据源)。 */
export interface RecallSessionStats {
  /** 发生过召回检索的轮次数(含零命中、全量压制与超时)。 */
  injectedTurns: number;
  /** 命中(≥1 条实际注入,或有命中但被去重全量压制)轮次数。 */
  hitTurns: number;
  /** 累计注入条数(去重过滤后、预算截断前)。 */
  totalHits: number;
  /** 总预算超时跳过次数。 */
  timeouts: number;
  /** 累计被去重压制的命中条数(同会话已注入过,不重复注入)。 */
  suppressedRecalls: number;
  /** 最近一轮实际注入条数(0 = 零命中/超时/全量压制;工具指南门控沿用此信号)。 */
  lastHits: number;
  /** 最近一轮检索耗时 ms。 */
  lastDurationMs: number;
  /** 最近一次记账时间(LRU 清理依据)。 */
  updatedAt: number;
}

/**
 * 单会话记忆上下文占用(session-stats.memoryOccupancy;悬浮卡与输入栏占用指示器共用)。
 * 形状与算术的唯一来源是 util/context-occupancy 的 OccupancyLedger,禁止任何一侧另写换算。
 * null = 本会话从未注入过。
 */
export type MemoryOccupancy = import('./util/context-occupancy.js').OccupancyLedger;

/** 重建阶段。 */
export type RebuildPhase = 'idle' | 'preparing' | 'distilling' | 'finalizing' | 'done' | 'cancelled' | 'failed';

/** 重建状态(rebuild-status/start/cancel 端点返回值)。 */
export interface RebuildStatus {
  running: boolean;
  phase: RebuildPhase;
  /** 已完成的会话块数 / 总块数。 */
  done: number;
  total: number;
  /** L0 体量(idle 时为实时预估,运行中为快照值)。 */
  sessionCount: number;
  messageCount: number;
  /** 预计 LLM 抽取调用次数(下界估算:块数与字符预算取大)。 */
  estCalls: number;
  /** 重建产出的 L1 记录累计条数。 */
  recordsBuilt: number;
  cancelRequested: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  /** 归档产物名(提示用户可手工找回)。 */
  archiveNote: string | null;
  /**
   * 保留集说明(无 L0 来源、清空前被保全的记忆;task_8c)。
   *
   * 与 `archiveNote` 并列暴露,是因为"重建后导入记忆还在不在"必须**可观测** ——
   * 只写日志的话,用户看到"重建完成"根本无从得知那些外部记忆是被保住了还是被清掉了。
   * null 表示尚未进入准备阶段。
   */
  preserveNote: string | null;
}

/** 反刍阶段。 */
export type RuminatePhase = 'idle' | 'refreshing' | 'distilling' | 'consolidating' | 'updating' | 'relabeling' | 'done' | 'cancelled' | 'failed';

/** 反刍状态(ruminate-status/start/cancel 端点返回值)。 */
export interface RuminateStatus {
  running: boolean;
  phase: RuminatePhase;
  /** 已完成的会话数(反刍中为已完成蒸馏的切片数,轻量刷新为已完成步骤数)。 */
  done: number;
  /** 待处理会话数(distilling 阶段为会话组数;轻量刷新为待执行步骤数)。 */
  total: number;
  /** 反刍产出的 L1 记录累计条数(反刍控制器追踪)。 */
  recordsBuilt: number;
  /** 当前动作的人类可读描述(L2/L3 单次调用可达分钟级,无此字段界面只能显示"运行中")。 */
  detail?: string | null;
  /** 标注校验/重标定结果(relabeling 阶段的产出;未执行或旧版省略)。 */
  relabel?: {
    checked: number;
    cogHallFixed: number;
    wingInvalidFixed: number;
    wingLabeled: number;
    tagged: number;
    llmSkipped: number;
    /** 时间预算用尽未处理、留待下次反刍的条数。 */
    deferred: number;
  } | null;
  /** 子进度:非会话阶段(relabeling)的批次进度;离开阶段即清空,旧版/其他阶段省略。 */
  sub?: { done: number; total: number; label: string } | null;
  cancelRequested: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
}

/** 反刍结果(含按族分组摘要)。 */
export interface RuminateResult {
  status: RuminateStatus;
  byFamily: {
    chat: { l1Extracted: number; l2Scenes: number; l3Updated: boolean };
    work: { l1Extracted: number; l2Scenes: number; l3Updated: boolean };
  };
}

/** 概览统计(dsh-memory/stats 端点返回值)。 */
export interface MemoryStats {
  ok: boolean;
  dataDir: string;
  /** 新会话默认记忆档位(auto/chat/work)。 */
  family: string;
  version: string;
  l0Today: number;
  l1Count: number;
  l1TotalExtracted: number;
  sceneCount: number;
  personaChars: number;
  hasPersona: boolean;
  lastExtractAt: string | null;
  lastL2At: string | null;
  lastL3At: string | null;
  memoriesSinceL2: number;
  memoriesSinceL3: number;
  pendingExtract: number;
  message: string;
  /** 实际生效的阈值(概览进度分母用,避免 UI 硬编码与部署配置脱节)。 */
  thresholds: { l2MinNewMemories: number; l3Interval: number };
}

// ── 成本看板(token-cost 端点) ──

/** 成本看板时间粒度(趋势图 + 统计口径共用)。 */
export type Granularity = 'day' | 'week' | 'month';

/** 成本看板单个时间窗口(day/week/month/all)。 */
export interface CostWindow {
  range: 'day' | 'week' | 'month' | 'all';
  /** 窗口起点(毫秒;all 为 0)。 */
  since: number;
  calls: number;
  inputChars: number;
  outputTokens: number;
  reasoningTokens: number;
  avgOutputTokens: number;
  medianOutputTokens: number;
}

/** 每模型统计指标(层级表格行;均值/中位数按 since=0 全量历史的活跃桶口径)。 */
export interface ModelMetrics {
  model: string;
  dayCalls: number;
  weekCalls: number;
  monthCalls: number;
  dayOutput: number;
  dayMedian: number;
  weekOutput: number;
  weekMedian: number;
  monthOutput: number;
  monthMedian: number;
}

/** 每层级(l1/l2/l3)的模型统计(层级表格)。 */
export interface LayerMetrics {
  layer: 'l1' | 'l2' | 'l3';
  models: ModelMetrics[];
}

/** 层级 × 窗口矩阵里的单个窗口格子。 */
export interface LayerWindow {
  range: 'day' | 'week' | 'month' | 'all';
  calls: number;
  inputChars: number;
  outputTokens: number;
  reasoningTokens: number;
  avgOutputTokens: number;
  medianOutputTokens: number;
}

/** 单个层级在四个窗口的聚合(层级×窗口表格行)。 */
export interface LayerCost {
  layer: 'l1' | 'l2' | 'l3';
  windows: LayerWindow[];
}

/** 趋势单桶。 */
export interface TrendBucket {
  ts: number;
  total: number;
  byModel: Record<string, number>;
}

/** 趋势快照:三个层级各一份连续桶序列。 */
export interface TrendSnapshot {
  granularity: Granularity;
  byLayer: Record<'l1' | 'l2' | 'l3', TrendBucket[]>;
}

/** 按 model 分组的成本行(成本看板用)。 */
export interface CostByModel {
  provider: string;
  model: string;
  calls: number;
  inputChars: number;
  outputTokens: number;
  reasoningTokens: number;
}

/** 成本快照(dsh-memory/token-cost 端点返回值)。 */
export interface CostSnapshot {
  /** day/week/month/all 四窗口聚合。 */
  windows: CostWindow[];
  /** 全量窗口(all)按 model 分组。 */
  byModel: CostByModel[];
  /** 按层级(l1/l2/l3 归并)在四个窗口的聚合(层级×窗口表格)。 */
  byLayer: LayerCost[];
  /** 每层级的模型统计指标(层级表格)。 */
  byLayerStats: LayerMetrics[];
  /** 趋势图数据。 */
  trend: TrendSnapshot;
}

// ── 嵌入源三态(embedding-* 端点) ──

/** 嵌入源:远程 / 本地 / 关闭。 */
export type EmbeddingSourceKind = 'remote' | 'local' | 'off';

/** 嵌入运行时安装进度(runtime-installer)。 */
export interface RuntimeProgress {
  phase: 'idle' | 'installing' | 'ready' | 'error' | 'cancelled';
  /** 插件钉死的目标版本。 */
  targetVersion: string;
  /** runtime 里实际就位的版本(未安装为 null)。 */
  installedVersion: string | null;
  startedAt: number;
  /** 已运行毫秒(读时计算)。 */
  elapsedMs: number;
  /** npm 输出尾行(最近 5 行,让用户看到 npm 在干什么)。 */
  lastLines: string[];
  error?: string;
}

/** 下载阶段。 */
export type DownloadPhase = 'downloading' | 'verifying' | 'done' | 'cancelled' | 'error';

/** 模型下载进度(下载器 getProgress;无活动下载为 null)。 */
export interface DownloadProgress {
  modelId: string;
  phase: DownloadPhase;
  /** 当前文件序号(1-based)。 */
  fileIndex: number;
  fileCount: number;
  /** 当前文件已收字节(含续传基线)。 */
  fileReceived: number;
  fileTotal: number;
  /** 整模型累计字节(含已完成文件;分母 = 目录总大小)。 */
  overallReceived: number;
  overallTotal: number;
  /** EMA 平滑速度(字节/秒)。 */
  speedBps: number;
  startedAt: number;
  /** phase=error 时的原因。 */
  error?: string;
}

/** 嵌入源活切换阶段。 */
export type ApplyPhase = 'idle' | 'installing-runtime' | 'warming' | 'switching' | 'reindexing' | 'done' | 'error';

/** 重嵌入进度。 */
export interface ReindexProgressState {
  running: boolean;
  l1Done: number;
  l1Total: number;
  l0Done: number;
  l0Total: number;
  startedAt: number;
  cancelled: boolean;
  error?: string;
}

/** 嵌入源状态视图(embedding-state-get 端点的主体)。 */
export interface EmbeddingStateView {
  source: EmbeddingSourceKind;
  activeModel: string | null;
  ceilings: { remote: boolean; local: boolean };
  /** 生效的远程嵌入连接(运行时覆盖优先于部署;key 明文不回传只给布尔)。 */
  remote: {
    baseURL: string;
    model: string;
    dimensions: number;
    apiKeySet: boolean;
  };
  runtime: RuntimeProgress;
  models: Array<{
    id: string;
    name: string;
    dims: number;
    contextTokens: number;
    tags: string[];
    description: string;
    totalBytes: number;
    bytesOnDisk: number;
    state: 'none' | 'partial' | 'downloaded';
  }>;
  download: DownloadProgress | null;
  apply: { phase: ApplyPhase; message: string; startedAt: number; busy: boolean };
  local: { state: 'idle' | 'loading' | 'ready' | 'failed' | 'terminated'; error: string | null } | null;
  reindex: ReindexProgressState;
  /** 向量索引概况（"已嵌入 X / 总 Y"的数据源）。 */
  vectors: VectorIndexView;
  activeNote?: string;
}

/** 单层（L1 / L0）的向量索引计数。
 *  不可用哨兵统一为 **-1**（沿用 db 层 `countL1Vec` / `countL1VecMissing` 的约定），
 *  与"真的是 0 条"区分——`嵌入能力挂掉` 和 `一条都没嵌` 在 UI 上是两句不同的话。 */
export interface VectorCountView {
  /** 向量表行数（已嵌入）。 */
  embedded: number;
  /** 元数据行数（嵌入分母）。 */
  total: number;
  /** 缺向量且可补齐的条数（已排除 skip 集）。 */
  missing: number;
  /** 内容不可嵌入、已进 skip 集的条数（重试无意义）。 */
  skipped: number;
}

export interface VectorIndexView {
  l1: VectorCountView;
  l0: VectorCountView;
}

// ── 端点请求/响应形状 ──

/** dsh-memory/stats */
export interface StatsResponse extends MemoryStats {}

/** dsh-memory/token-cost */
export interface TokenCostRequest {
  granularity?: Granularity;
  /** 正整数且 ≤ 明细保留期(0/非法回退全量窗口)。 */
  rangeDays?: number;
}
export interface TokenCostResponse extends CostSnapshot {}

/** dsh-memory/session-mode-get | set */
export interface SessionModeGetRequest {
  sessionId: string;
}
export interface SessionModeGetResponse {
  sessionId: string;
  mode: MemoryMode;
  defaultMode: MemoryMode;
  /** 会话级注入覆盖:null = 未覆盖(跟随全局)——线上 JSON 用 null 不用 undefined(序列化丢包)。 */
  recall: boolean | null;
  /** host 解析后的注入生效值(会话覆盖 ?? 全局开关):pill 面文直接消费。 */
  recallResolved: boolean;
  /** 会话级域锁定(wing 八边形手动挡):角 id = 锁定单域;null = 中心(智能档)。
   *  Phase 2 多选:完整选择集在 halls,本字段取第一个锁定域(兼容)。 */
  hall: string | null;
  /** 多选域锁定:命中任一锁定域即通过硬过滤;空数组 = 中心。 */
  halls: string[];
  /** 锁定域边界开关:未打标记忆是否参与召回(默认包含)。 */
  hallIncludeUnlabeled: boolean;
  /** 锁定域边界开关:跨域兜底 general 是否参与召回(默认不含)。 */
  hallIncludeGeneral: boolean;
}
export interface SessionModeSetRequest {
  sessionId: string;
  /** 档位(必传)。 */
  mode: MemoryMode;
  /** 会话级注入覆盖:布尔 = 设置覆盖;显式 null = 清除(跟随全局);缺省 = 不动
   *  (旧 client 纯切档兼容,覆盖不丢)。mode 与 recall 可独立设置。 */
  recall?: boolean | null;
  /** 会话级域锁定:角 id = 锁定;显式 null = 回中心(清除锁定);缺省 = 不动。
   *  单值保留兼容;多选传 halls。 */
  hall?: string | null;
  /** 多选域锁定:角 id 数组(去重,非法 id 整体拒绝);显式 null/空数组 = 回中心;缺省 = 不动。 */
  halls?: readonly string[] | null;
  /** 锁定域边界开关(缺省 = 不动)。 */
  hallIncludeUnlabeled?: boolean;
  hallIncludeGeneral?: boolean;
}
export interface SessionModeSetResponse {
  sessionId: string;
  mode: MemoryMode;
  /** 设置后的覆盖态(null = 跟随全局)。 */
  recall: boolean | null;
  /** 设置后的注入生效值(client 面文直接消费;清除覆盖后由 host 告知解析结果)。 */
  recallResolved: boolean;
  /** 设置后的域锁定(null = 中心);多选完整集在 halls。 */
  hall: string | null;
  halls: string[];
  hallIncludeUnlabeled: boolean;
  hallIncludeGeneral: boolean;
}

/** dsh-memory/wing-overview(八边形角计数;WingWheel 打开时拉取,非热路径)。 */
export interface WingOverviewResponse {
  /** 8 角逐域计数(词表顺序)。 */
  corners: Array<{ id: string; label: string; count: number }>;
  /** 跨域兜底值(general)计数。 */
  general: number;
  /** 未打标(metadata 无 wing)计数——角上"另有 N 条未打标"与一键回填的数据源。 */
  unlabeled: number;
}

/**
 * dsh-memory/rooms-get(Room 分类计数)。
 *
 * Room = 标签类**自生长**分类:由 `metadata.tags` 直接派生,1 个 slug tag = 1 个 Room。
 * 无枚举、无注册表、无 schema —— 反刍涌现出新 tag 即自动出现新 Room。
 *
 * 降级/无 tags 时 `rooms` 为空数组(面板显示"暂无"),不报错。
 */
export interface RoomsGetResponse {
  /** Room 列表(按记录数降序,同数按名升序;注册表条目 count=0 并带 source/label)。
   *  条目可选字段 source/label 由端点层合并注册表后附带(客户端可选读,零断裂)。 */
  rooms: RoomCount[];
  /** Room 总数(= rooms.length,冗余只为前端少写一次 .length)。 */
  total: number;
  /** 孤儿记忆数:没有任何 Room(tags 为空/缺失)的记录条数(与 rooms 同口径含已退场)。 */
  orphanCount: number;
  /** 注册表条目(全量含 retired;分类管理面板用;未装配 = undefined)。 */
  registry?: Array<{
    slug: string;
    label?: string;
    description?: string;
    source: 'pre-registered' | 'grown';
    aliases?: string[];
    status: 'active' | 'retired';
  }>;
}

/** dsh-memory/room-register(预注册 Room;高权限:面板 memoryMutate 开启才生效)。 */
export interface RoomRegisterRequest {
  slug: string;
  label?: string;
  description?: string;
  /** 收编自生长 slug 时传 grown(缺省 pre-registered;已存在条目忽略此字段)。 */
  source?: 'pre-registered' | 'grown';
}
export interface RoomRegisterResponse {
  slug: string;
  created: boolean;
  /** 幂等补全时的提示(如「已存在,只补全缺失字段」)。 */
  notice?: string;
}

/** dsh-memory/rooms-export(分类数据导出,CSV 直出)。 */
export interface RoomsExportRequest {
  /** rooms = 词表+计数;orphans = 无 Room 绑定的记录清单;records = 按 Room 的记录清单(tag 必传)。 */
  kind: 'rooms' | 'orphans' | 'records';
  /** 各 kind 通用上限(1..10000,默认 2000)。 */
  limit?: number;
  /** kind=records 的目标 Room slug。 */
  tag?: string;
}
export interface RoomsExportResponse {
  kind: 'rooms' | 'orphans' | 'records';
  /** CSV 文本(首行表头;
 行尾;RFC 4180 转义)。 */
  csv: string;
  /** 数据行数(不含表头)。 */
  total: number;
  /** truncated = 达到 limit 上限,结果可能不完整。 */
  truncated: boolean;
}

/** dsh-memory/room-admin(Room 破坏性面管理;高权限:面板 memoryMutate 开启才生效)。 */
export interface RoomAdminRequest {
  /** merge/rename:from→to(mergeRoom/renameRoom 编排:预览→实跑+自动备份+入队场景重算);retire:slug 退役/恢复;update:改写 label/description。 */
  action: 'merge' | 'rename' | 'retire' | 'update';
  /** update 的显示名(可中文;非空才改写)。 */
  label?: string;
  /** update 的归类说明(喂标注器;非空才改写)。 */
  description?: string;
  /** merge/rename 的源 Room slug。 */
  from?: string;
  /** merge/rename 的目标 Room slug。 */
  to?: string;
  /** retire 的目标 Room slug。 */
  slug?: string;
  /** retire:true=恢复 active;缺省/false=退役。 */
  active?: boolean;
  /** retire:同时把该 room 下全部**活跃**记录退场(软删,可在「已退场」区恢复)。 */
  withRecords?: boolean;
  /** merge/rename:缺省 true 只返预览;实跑需显式 false。 */
  dryRun?: boolean;
}
export interface RoomAdminResponse {
  notice: string;
  /** merge/rename 本次是否 dryRun(预览)。 */
  dryRun?: boolean;
  /** merge/rename 影响的记录条数(实跑 = 已改写条数)。 */
  affected?: number;
  /** 预览样例(受影响记录 id 的前几条)。 */
  preview?: string[];
  /** true = 超过单次上限,需续跑。 */
  hasMore?: boolean;
  /** 实跑时改写前备份文件名(rooms-merge-backups/)。 */
  backupFile?: string;
  /** retire withRecords 实际退场的记录条数(软删,可恢复)。 */
  retiredRecords?: number;
}

/** dsh-memory/wing-backfill(一键回填,后台任务;端点立即返回,进度以 wing-overview 轮询)。 */
export interface WingBackfillResponse {
  /** true = 本次触发启动了新任务;false = 已有任务在跑(单飞,不叠加)。 */
  started: boolean;
  running: boolean;
}

/** dsh-memory/session-stats(悬浮卡信息区;热路径端点)。 */
export interface SessionStatsRequest {
  sessionId: string;
}
/** 蒸馏管线会话视图(runner 投影,lastDistillAt 已转 ISO)。 */
export interface SessionDistillView {
  pendingSlice: number;
  parkedSlices: number;
  threshold: number | null;
  producedRecords: number;
  lastDistillAt: string | null;
}
export type SessionStatsResponse =
  | { supported: false }
  | {
      supported: true;
      sessionId: string;
      mode: MemoryMode;
      defaultMode: MemoryMode;
      /** 注入统计 + 生效位;enabled=false 时 reason 带短路序第一个为假因子
       *  (deploy 部署上限 / global 全局开关 / session 会话只写 / mode 档位关闭)。 */
      recall: { enabled: boolean; reason?: RecallDisabledReason } & RecallSessionStats;
      /** 记忆上下文占用账本(未注入过的会话为 null)。 */
      memoryOccupancy: MemoryOccupancy | null;
      /** 旧会话回填:host 侧估出的双通道份额——召回按 live 会话 surface 现扫
       *  (null = 会话不在 store),稳定区按当前组词折算。账本存在时客户端取两者较大值。 */
      occupancyBackfill: { recallTokens: number | null; profileTokens: number } | null;
      /** 主对话模型的官方声明上下文窗口(占用占比分母;null = 未声明/解析失败,UI 降级隐藏占比)。 */
      contextWindowTokens: number | null;
      distill: SessionDistillView;
      l0Count: number;
      retrieval: 'hybrid' | 'vector' | 'keyword' | 'none';
      global: { degraded: boolean; pendingTotal: number; lastExtractAt: string | null };
    };

/** dsh-memory/settings-get */
export interface SettingsGetResponse {
  supported: boolean;
  settings: MemoryLiveSettings;
  /** 静态部署上限(cordis.patch.yml):运行时开关与它取 AND。 */
  ceilings: { capture: boolean; distill: boolean; recall: boolean };
  effort: {
    current: EffortChoice;
    effective: EffortChoice;
    fallback: EffortChoice;
    options: string[];
    route?: { provider: string; model: string };
  };
  budgets: { current: DistillBudgets; defaults: DistillBudgets; effective: DistillBudgets };
  inputBudget: { current: number; fallback: number; effective: number };
}

/** dsh-memory/settings-set(patch 语义:只带要改的键)。 */
export interface SettingsSetRequest {
  enabled?: boolean;
  capture?: boolean;
  distill?: boolean;
  recall?: boolean;
  distillChain?: DistillChainEntry[];
  /** 运行时按层路由链:逐层 patch(只带要改的层;空数组 = 该层回到跟随)。 */
  distillLayerChains?: Partial<Record<LayerRouteKey, DistillChainEntry[]>>;
  reasoningEffort?: EffortChoice;
  distillProvider?: string;
  distillModel?: string;
  distillBudgets?: { extract: number; dedup: number; l2: number; l3: number; graph: number };
  distillMaxInputChars?: number;
  /** 蒸馏通道运行时覆盖:'' = 跟随部署 config;'host' = 复用宿主;'direct' = 插件原生直连。 */
  distillMode?: '' | 'host' | 'direct';
  /** 运行时直连端点覆盖('direct' 用;非机密,可回显)。 */
  directBaseURL?: string;
  /** 运行时直连 API Key 覆盖('direct' 用;属机密,写入后不回读、不落日志)。 */
  directApiKey?: string;
  /** 远程嵌入端点/模型运行时覆盖(非机密可回显)。 */
  embedRemoteBaseURL?: string;
  embedRemoteModel?: string;
  /** 远程嵌入维度运行时覆盖(0 = 未配置)。 */
  embedRemoteDimensions?: number;
  /** 远程嵌入 API Key 运行时覆盖(属机密,写入后不回读、不落日志)。 */
  embedRemoteApiKey?: string;
  /** 记忆写删权限门(true = 允许写删工具与面板高权限删除)。 */
  memoryMutate?: boolean;
  /** §C 人工冲突裁决总开关(true = 冻结冲突对,停放到待人工裁决区)。 */
  conflictFreeze?: boolean;
}
export interface SettingsSetResponse {
  ok: true;
  settings: MemoryLiveSettings;
}

/** dsh-memory/list-records(记忆浏览器;hitToUiRecord 投影)。 */
export interface ListRecordsRequest {
  query?: string;
  type?: string;
  scene?: string;
  /** Wing 过滤(metadata.hall == 该值;空 = 不过滤)。单值保留兼容;多选走 halls。 */
  hall?: string;
  /** Wing 过滤多值(R13):命中任一即可;查询可多选,记录打标仍单值。 */
  halls?: readonly string[];
  /**
   * Room 过滤(metadata.tags 含该 slug;空 = 不过滤)。
   *
   * Room 由 tags 派生(自生长),故这里传的是**具体 tag 名**而非枚举 id。
   */
  tag?: string;
  /**
   * 孤儿记忆筛选:true = 只列**没有任何 Room(tags 为空/缺失)**的记录。
   * 与 `tag` 互斥;同传时 `tag` 优先(客户端保证不同传)。
   */
  untagged?: boolean;
  /**
   * 退场(软删)筛查:三态。省略 = 全部(活跃+已退场混排,靠 `UiRecord.retired`
   * 徽标区分);`false` = 仅活跃;`true` = 仅已退场。
   * **仅浏览路径生效**:关键词检索只覆盖检索面,已退场记录本就不在其中。
   */
  retired?: boolean;
  /** 1~200,默认 50。 */
  limit?: number;
  /** 0~1_000_000。 */
  offset?: number;
}
/** 浏览器卡片字段(比 MemoryRecord 精简,去掉大 metadata;epoch→ISO、snake→camel)。 */
export interface UiRecord {
  id: string;
  content: string;
  type: string;
  priority: number;
  scene: string;
  family: MemoryFamily | null;
  /** Wing 标签(metadata.hall,可空)。 */
  hall: string | null;
  timestamps: string[];
  createdAt: string | null;
  updatedAt: string | null;
  version: number;
  /**
   * 来源锚点(R7):形如 `t12 s3`(无 step 时为 `t12`),来自
   * `metadata.dsh_source_anchors`。**空数组 = 该记忆无锚点**(老数据 / 捕获侧
   * 未打戳 / 解析不到坐标),不是"没有来源"。
   *
   * 2026-09-17 替换原 `sourceMessageIds`:`l1_records` 从不存该列,原字段
   * 永远是 `[]`(死字段,UI 因此从未显示过来源行)。锚点是同一意图的**活实现**。
   */
  sourceAnchors: string[];
  /** 检索相关度(列表路径无 score → null)。 */
  score: number | null;
  /** 老化权重:读路径衰减系数 max(0.5, 0.5^(Δ天/半衰期))(Δ=updatedAt;半衰期 0=关 → null)。 */
  agingWeight?: number | null;
  /** 召回使用统计:**进 topN(被注入)才算 used**;参与尝试未进 = 仅 attempts。缺省 = 未装配。 */
  usage?: { attempts: number; used: number; lastAttemptAt: number | null; lastUsedAt: number | null } | null;
  /**
   * 是否已退场(软删)。`true` 时该记录在活动列表里仍以「已退场」态呈现(置灰 + 徽标),
   * 可被 `records-restore` 找回——这正是设计要的「不静默消失、可恢复」,而非真删。
   * 缺省/ `false` 表示活跃。
   */
  retired?: boolean;
  /** 退场原因:`conflict`(裁决) / `superseded`(取代) / `manual`(人工) / `unknown`。未退场为 null。 */
  retiredReason?: string | null;
  /**
   * 成熟度(G3 读时派生):priority + 被用次数 + 老化权重合成。
   * 可选字段——旧 client 忽略=向后兼容；不参与存储/快照（纯投影）。
   */
  maturity?: 'low' | 'mid' | 'high';
  /** 使用场景（G1）：从 metadata.dsh_usage_scenario 读出；功能关/无则 undefined。 */
  usageScenario?: string[];
  /**
   * 人给的相关度均值(0..5)；从未被 0..5 打过分为 undefined（**缺席 ≠ 0 分**）。
   * 读时从 recall-feedback sidecar 派生，不进存储/快照。
   */
  userRelevance?: number;
}
export interface ListRecordsResponse {
  items: UiRecord[];
  hasMore: boolean;
  /** 列表路径给总数;检索路径无法便宜计数 → null。 */
  total: number | null;
  /** 检索单次上限截断(结果可能不完整)。 */
  truncated: boolean;
  /** 场景筛选下拉选项(仅 offset===0 时附带)。 */
  scenes?: string[];
  /** 召回使用汇总(老化权重效果口径:进 topN 才算 used)。未装配 = undefined。 */
  usageSummary?: { tracked: number; attempted: number; used: number; rate: number } | null;
  /**
   * Wing 词表(R8 单一事实源:服务端随 list-records 下发,client 不再手抄;仅 offset===0 时附带)。
   * 含 8 角 + `general`(跨域兜底,存量大 reserved 值仍可筛)。缺省(旧服务端)时 client
   * 降级为从已加载记录的 wing 值派生选项。
   */
  wingCatalog?: Array<{ id: string; label: string }>;
}

/** dsh-memory/records-delete(面板高权限退场指定记忆;须 memoryMutate 开启)。 */
export interface RecordsDeleteRequest {
  /** 要**退场(软删)**的 L1 record id 列表(≤200)。不是物理删除,可恢复。 */
  ids: string[];
}
export interface RecordsDeleteResponse {
  deleted: number;
}

// ── 记忆退场(软删)与清理:已退场列表 / 恢复 / 物理清理 ──

/**
 * 已退场记录的一条(在浏览卡片之上补退场信息)。
 *
 * `retiredReason` 用宽松 `string` 而非字面量联合:契约要能在**客户端**那一档
 * (`types: []`)独立编译,不该反向依赖宿主 store 的类型;严格联合留在 store 侧,
 * 面板只做展示。新增原因时面板不认识也能照常显示,不会编译失败。
 */
export interface RetiredRecordView extends UiRecord {
  /** 退场时刻(ISO 8601)。 */
  retiredAt: string;
  /** 退场原因:`conflict`(裁决) / `superseded`(去重取代) / `manual`(人工)。 */
  retiredReason: string;
  /** 裁决结论(仅 reason=conflict)。 */
  verdict?: string;
  /** 取代它的新记录 id(仅 reason=superseded)。 */
  supersededBy?: string;
}

/** dsh-memory/records-retired(已退场列表;面板据此展示"可恢复"区)。 */
export interface RecordsRetiredRequest {
  limit?: number;
  offset?: number;
}
export interface RecordsRetiredResponse {
  items: RetiredRecordView[];
  total: number;
}

/** dsh-memory/records-restore(把已退场记录送回检索面)。 */
export interface RecordsRestoreRequest {
  /** 要恢复的 record id 列表(≤200)。 */
  ids: string[];
}
export interface RecordsRestoreResponse {
  restored: number;
  /** 成功补回向量的条数(嵌入不可用时可能小于 `restored`)。 */
  vectorsWritten: number;
}

/**
 * dsh-memory/cleanup-retired(物理清理已退场记录)。
 *
 * **默认干跑**:`dryRun` 省略即视为 `true`,只报"将要清理多少条"。
 * 真要物理删除必须显式 `dryRun:false` —— 这是本插件唯一不可逆的动作。
 * 即便显式执行,也要先落快照并校验通过,否则中止(`aborted:true`)。
 */
export interface CleanupRetiredRequest {
  /** 限定要清理的 id;省略 = 全部已退场记录。 */
  ids?: string[];
  /** 默认 true(干跑)。显式 false 才真正删除。 */
  dryRun?: boolean;
}
export interface CleanupRetiredResponse {
  dryRun: boolean;
  /** 本次涉及(干跑)或实际处理(真跑)的条数。 */
  targets: number;
  /** 真正物理删除的条数(干跑恒为 0;中止恒为 0)。 */
  purged: number;
  /** 门禁未通过而中止。 */
  aborted: boolean;
  /** 快照目录(真跑时非空)。 */
  dir: string;
  /**
   * 快照**目录名**(真跑时非空)。
   *
   * `dir` 是给人看的绝对路径;`name` 是给 `snapshot-restore` 用的**唯一寻址口径**
   * ——恢复入口只收名字、不收路径(见 `isSnapshotName`)。没有它,调用方就得自己
   * 从 `dir` 里切最后一段,还要同时兼容 `/` 与 `\` 两种分隔符。
   */
  name: string;
  /** 中止原因(仅 aborted 时非空)。 */
  diffs: string[];
}

// ── 快照(清单 / 回灌):`cleanup-retired` 不可逆动作的**回程票** ──

/** dsh-memory/snapshots-list(可用快照清单;恢复前先看有哪些)。 */
export interface SnapshotsListRequest {
  /** 最多返回几份(1~200,默认 50)。 */
  limit?: number;
}
/** 一份快照的摘要(与 `l1-snapshot.SnapshotSummary` 同形)。 */
export interface SnapshotSummaryView {
  /** 目录名——恢复时传它。 */
  name: string;
  /** 绝对路径(给人看/给运维定位)。 */
  dir: string;
  createdAt: string;
  /** 建它的原因(如 `cleanup-retired` / `pre-rebuild`)。 */
  reason: string;
  /** `l1_records` 条数。 */
  records: number;
  receipts: number;
  conflicts: number;
  /** `l1_vec` 行数(派生投影,不落快照,只记数)。 */
  vecCount: number;
}
export interface SnapshotsListResponse {
  /** 按时间**倒序**(最新的在前)。 */
  items: SnapshotSummaryView[];
  total: number;
}

/**
 * dsh-memory/snapshot-restore(从快照把已物理删除的记录灌回检索库)。
 *
 * **默认干跑**:`dryRun` 省略即视为 `true`。恢复本身是幂等的 upsert(不删任何东西),
 * 但它是"把历史状态写回当前库",仍须调用方显式要求才做——与 `cleanup-retired` 同一条纪律。
 */
export interface SnapshotRestoreRequest {
  /** 快照**目录名**(见 snapshots-list)。**不接受路径**。 */
  name: string;
  /** 只恢复这些 id(≤2000);省略 = 快照内全部。 */
  ids?: string[];
  /** 默认 true(干跑)。显式 false 才真正写库。 */
  dryRun?: boolean;
  /**
   * 顺手把带回的记录**放回检索面**(清退场标记 + 重建索引)。默认 `false`。
   *
   * 为什么默认关:`cleanup-retired` 只清理**已退场**记录,快照又拍在删除**之前**
   * ——所以清理快照找回的每一条都带退场标记,只回主表、不回召回。默认关 = 恢复
   * 的是"当时的状态";要一步到位(真正的回滚)再显式打开。两种情形都会在
   * `stillRetired` / `unretired` 里如实报出,不存在"悄悄复活"。
   */
  unretire?: boolean;
}
export interface SnapshotRestoreResponse {
  name: string;
  dir: string;
  dryRun: boolean;
  /** 快照里的记录总数(过滤前)。 */
  inSnapshot: number;
  /** 本次涉及(过滤后)的条数。 */
  targets: number;
  /** 其中当前**不在库**的条数——真正被找回的条数。 */
  missing: number;
  /** 实际写回条数(干跑恒为 0)。 */
  restored: number;
  failed: number;
  /** 成功补回向量的条数(干跑恒为 0;嵌入不可用时可能为 0)。 */
  vectorsWritten: number;
  /** 本次顺手放回检索面的条数(仅 `unretire:true` 时可能非零)。 */
  unretired: number;
  /** 回到主表但**仍不在检索面**的 id(再调 `records-restore` 可放回)。 */
  stillRetired: string[];
  /** 请求了但该快照里没有的 id。 */
  notFound: string[];
  /** 提示(如名字非法/快照不存在,或"还有记录没回到检索面")。 */
  notice?: string;
}

// ── 知识图谱(graph-search / graph-node-get;面板图谱视图) ──

/** dsh-memory/graph-search(图谱节点检索;紧凑节点卡)。 */
export interface GraphSearchRequest {
  /** 自然语言查询(≤4096 字符;空查询返回空)。 */
  query?: string;
  /** 1~20,默认 8。 */
  limit?: number;
}
export interface GraphSearchResponse {
  items: Array<{
    node: GraphNode;
    /** 排序分(仅排序语义,非事实置信度)。 */
    score: number;
    matchedFields: string[];
    matchReason: string;
  }>;
}

/** dsh-memory/graph-node-get(节点详情展开;悬挂 id 返回 node=null 不解析)。 */
export interface GraphNodeGetRequest {
  id: string;
}
export interface GraphNodeGetResponse {
  node: GraphNode | null;
  /** 与该节点相连的 active 边。 */
  edges: GraphEdge[];
}

/** dsh-memory/scenes(两族拼接的混合视图)。 */
export interface ScenesResponse {
  items: Array<{
    path: string;
    family: MemoryFamily;
    summary: string;
    updated: string;
    heat: number;
    content: string;
  }>;
}

/** dsh-memory/persona(两族以 family 注释 + 分隔线拼接)。 */
export interface PersonaResponse {
  content: string;
}

/** dsh-memory/log-tail */
export interface LogTailRequest {
  /** 1~1000,默认 200。 */
  lines?: number;
}
export interface LogTailResponse {
  lines: string[];
}

/** dsh-memory/trace-tail(§F 追踪事件流,memorax-absorb Wave 4) */
export interface RecallTraceEvent {
  kind: 'recall_turn';
  ts: number;
  sessionId: string;
  turn?: number;
  /** metadata-only 默认:query 长度 + sha256 前 16 位;captureContent 才存原文(≤200)。 */
  queryChars: number;
  querySha?: string;
  queryText?: string;
  hitIds: string[];
  hitScores: number[];
  injectedIds: string[];
  suppressedCount: number;
  durationMs: number;
  outcome: 'injected' | 'suppressed' | 'timeout' | 'off';
}

export interface DistillTraceEvent {
  kind: 'distill_run';
  ts: number;
  layer: 'l1' | 'l2' | 'l3';
  sessionId: string;
  /** 仅 l1 有(与 l1_receipts 同一 runId,可交叉审计)。 */
  runId?: string;
  inputChars: number;
  /** 仅 l1:决策六值词表聚合(store/update/merge/skip/conflict/skip_missing)。 */
  byKind?: Record<string, number>;
  newRecords?: number;
  durationMs: number;
  provider?: string;
  model?: string;
  ok: boolean;
  errorKind?: string;
}

export type TraceEvent = RecallTraceEvent | DistillTraceEvent;

export interface TraceTailRequest {
  /** 1~500,默认 100。 */
  lines?: number;
  /** 缺省 = 两类都取(按时间混合)。 */
  kind?: 'recall_turn' | 'distill_run';
}
export interface TraceTailResponse {
  events: TraceEvent[];
}

/** dsh-memory/rebuild-* */
export type RebuildStatusResponse = { supported: false; running: false; phase: 'idle' } | RebuildStatus;

/** dsh-memory/ruminate-* */
export type RuminateStatusResponse = { supported: false; running: false; phase: 'idle' } | RuminateStatus;

/** dsh-memory/llm-providers(蒸馏路由链编辑器数据源)。 */
/** 生效链条目:effort 与 DistillChainEntry.reasoningEffort 不同名不合并(链上两种条目形状的事实)。 */
export interface EffectiveChainRoute {
  provider: string;
  model: string;
  effort: string;
}
/** 按层层链视图:runtime = 设置页运行时层链(pinned 下不生效,视图照实返回存量);
 *  static = 部署 YAML layerRoutes;effectiveChain = 该层实际链(层链完整替换,或跟随全局时
 *  与全局链同值);source 三态:runtime 接管 / static 生效 / global 跟随全局解析。 */
export interface LayerChainView {
  runtime: DistillChainEntry[];
  static: StaticFallbackEntry[];
  effectiveChain: EffectiveChainRoute[];
  source: 'runtime' | 'static' | 'global';
}
export interface LlmProvidersResponse {
  supported: true;
  providers: Array<{ id: string; name: string }>;
  default: { provider: string; model: string } | null;
  /** 部署静态 pin(provider+model 双字段)优先于运行时选择,UI 据此禁用选择器。 */
  pinned: boolean;
  current: { provider: string; model: string };
  /** 所选供应商是否仍在已注册路由中(用户删掉供应商后提示回退)。 */
  currentRegistered: boolean;
  effective: { provider: string; model: string } | null;
  chain: {
    current: DistillChainEntry[];
    static: StaticFallbackEntry[];
    effectiveChain: EffectiveChainRoute[];
    source: 'runtime' | 'static';
  };
  /** 按层层链(l1/l2/l3;l1 同管抽取+去重两个调用点)。 */
  layerChains: Record<LayerRouteKey, LayerChainView>;
  /** 蒸馏通道视图(direct 解耦通道的运行时/部署态)。apiKey 不回传明文,只给布尔。 */
  channel: DirectChannelView;
}

/** 蒸馏通道视图(llm-providers 的 channel 块数据源)。 */
export interface DirectChannelView {
  /** 运行时覆盖档:'' = 跟随部署 config;'host'/'direct' = 运行时锁定。 */
  runtime: '' | 'host' | 'direct';
  /** 实际生效档(runtime override → 部署 cfg.llm.mode,缺省 'host')。 */
  effective: 'host' | 'direct';
  /** 运行时直连端点覆盖值(settings 存;非机密可回显)。 */
  runtimeBaseURL: string;
  /** 部署直连端点(cfg.llm.baseURL,供「跟随部署」预览)。 */
  deployedBaseURL: string;
  /** 部署通道档(cfg.llm.mode)。 */
  deployed: 'host' | 'direct';
  /** 运行时直连 apiKey 是否已填(明文不回传)。 */
  runtimeApiKeySet: boolean;
  /** 部署直连 apiKey 是否已配置(cfg.llm.apiKey 非空?)。 */
  deployedApiKeySet: boolean;
  /** 生效为 direct 时是否配置齐(directBaseURL+model 都非空);未齐时给 tooltip 提示。 */
  directReady: boolean;
}

/** dsh-memory/llm-models */
export interface LlmModelsRequest {
  provider: string;
}
/** 模型条目(附思考档位能力表,探询失败/未声明 → 空表)。 */
export interface ModelWithEfforts {
  id: string;
  name: string;
  description: string | null;
  efforts: string[];
}
export interface LlmModelsResponse {
  provider: string;
  models: ModelWithEfforts[];
}

/** dsh-memory/embedding-state-get */
export type EmbeddingStateResponse = { supported: false } | ({ supported: true } & EmbeddingStateView);

/** dsh-memory/embedding-source-set */
export interface EmbeddingSourceSetRequest {
  source: EmbeddingSourceKind;
  activeModel?: string | null;
}
export interface EmbeddingSourceSetResponse {
  accepted: true;
}

/** dsh-memory/embedding-download-start */
export interface EmbeddingDownloadStartRequest {
  modelId: string;
}
export interface EmbeddingDownloadStartResponse {
  accepted: true;
}

/** dsh-memory/embedding-download-cancel | runtime-cancel | reindex-cancel */
export interface EmbeddingCancelResponse {
  cancelled: boolean;
}

/** dsh-memory/embedding-reindex（手动触发重建）。
 *  受理即返回，**不在此回传进度**——客户端照旧轮询 embedding-state-get 的 reindex 字段，
 *  否则"受理响应"与"进度快照"会各有一套进度语义，两边迟早对不上。 */
export interface EmbeddingReindexStartResponse {
  accepted: true;
}

/** dsh-memory/embedding-model-delete */
export interface EmbeddingModelDeleteRequest {
  modelId: string;
}
export interface EmbeddingModelDeleteResponse {
  ok: boolean;
  error?: string;
}

// ── §C 矛盾冻结:待裁决队列(读)与裁决(写) ──
//
// 形状定义在 contract 这一侧而不是 `conflict-service.ts`,是为了让
// **契约保持单一事实源**:contract.ts 不 import 任何东西(客户端类型检查会以
// `types: []` 拉它),而宿主模块反向 import 这里的类型。反过来做的话,
// contract 就得去拉 `conflict-service` → `store/*` → node 内置模块,
// 客户端那一档类型检查会被 node 类型污染。

/** 一条待裁决冲突对(与 `ConflictPair` 同源,但只暴露人要看的那几个字段)。 */
export interface ConflictPairView {
  pair_id: string;
  /** 产生该冻结的 L1 蒸馏批次 id(接 §B 凭证链)。 */
  run_id: string;
  /** LLM 建议的胜方 id。**只是进入队列时的排序位,不代表结论**。 */
  winner_id: string;
  /** 胜方正文;**空串 = 该记录已不在检索库**(被合并/删掉了),不是"内容为空"。 */
  winner_content: string;
  loser_id: string;
  loser_content: string;
  created_at: string;
  // §C 三轴(conflict-3axis):胜/败双方的有效期与持续性,供人工裁决时对比。
  // 可选且向后兼容——旧面板/客户端忽略新字段不报错。
  winner_valid_from_ms?: number | null;
  winner_valid_to_ms?: number | null;
  winner_persistence?: string | null;
  loser_valid_from_ms?: number | null;
  loser_valid_to_ms?: number | null;
  loser_persistence?: string | null;
  /** G3 成熟度旁注（读时派生，仅帮人工看“哪条更确立”，不参与自动裁决）。 */
  winner_maturity?: 'low' | 'mid' | 'high';
  loser_maturity?: 'low' | 'mid' | 'high';
  // R1 未决态(task_2.4):把「没人看过」与「看过但未裁决」在读取面分开。
  // `unseen` = `reviewed_at` 为空;`deferred` = 有人复看过、但仍未给出结论。
  // 派生字段(不存在独立列):该区分必须由读取面算出来,否则"人看了没判"这件事
  // 在界面上与"还没人看"长得一模一样 —— 那正是 R1 要消灭的混淆。
  review_state?: 'unseen' | 'deferred';
  /** R1:复看次数(面板据此显示"已复看 N 次");达 `DEFER_MAX` 即钉子户。 */
  defer_count?: number;
  // Phase 3(task_3.5):轴 2/3 在读取面可见 —— 三类冲突必须能区分,
  // 否则"额度只按 hard 计"这件事在界面上无从解释(人只会看到"有些对没占额度")。
  // 可选且带兜底:旧客户端忽略新字段不报错;读取面缺值时按 'hard' / '' 呈现。
  conflict_type?: 'hard' | 'conditional' | 'supersession';
  /** Phase 3:同一 claim 的多对冲突共用的稳定标识;空串 = 未分组。 */
  claim_key?: string;
}

/** `dsh-memory/conflicts` 请求(读待裁决队列)。 */
export interface ConflictsRequest {
  /** 最多返回多少对(默认 50,上限 200)。 */
  limit?: number;
}

/** `dsh-memory/conflicts` 响应。 */
export interface ConflictsResponse {
  /**
   * `conflictFreeze.enabled`。**必须与 `items: []` 分开呈现** ——
   * "开关没开"与"开了但没有待裁决"在面板上是两件不同的事。
   */
  enabled: boolean;
  /** 未裁决总数(可能大于 `items.length`)。 */
  total: number;
  items: ConflictPairView[];
  notice?: string;
}

/** `dsh-memory/conflict-resolve` 请求。 */
export interface ConflictResolveRequest {
  pairId: string;
  /** `winner` | `loser` | `both`。 */
  outcome: string;
}

/** `dsh-memory/conflict-resolve` 响应(与 `memory_resolve_conflict` 工具同形状)。 */
export interface ConflictResolveResponse {
  pair_id: string;
  outcome: string;
  /** 裁决时刻(ISO);空串 = 未生效。 */
  resolved_at: string;
  /** 因裁决从检索中退场的记录 id(无则空串)。 */
  removed_record_id: string;
  notice?: string;
}

// ── §C 丢弃留痕 ──

/** 一条被丢弃的冲突决策(task_1.1: LLM 输出不满足 pair 格式、已被记录为"不合法")。 */
export interface ConflictRejectedView {
  reject_id: string;
  run_id: string;
  record_id: string;
  winner_raw: string;
  loser_raw: string;
  reason: string;
  created_at: string;
}

/** `dsh-memory/conflicts-rejected` 请求。 */
export interface ConflictRejectedRequest {
  /** 最多返回多少条(默认 50,上限 200)。 */
  limit?: number;
  /** 排他上界:created_at < 此值的记录(ISO);不给则从最新开始。 */
  created_before?: string;
}

/** `dsh-memory/conflicts-rejected` 响应。 */
export interface ConflictRejectedResponse {
  items: ConflictRejectedView[];
  notice?: string;
}

// ── §B 决策凭证回溯 ──

/** `dsh-memory/receipts` 请求(两维回溯,至少给一个)。 */
export interface ReceiptsRequest {
  recordId?: string;
  runId?: string;
  limit?: number;
}

/** 一条决策凭证(与 `memory_receipts` 工具同形状)。 */
export interface ReceiptItemView {
  receipt_id: string;
  run_id: string;
  record_id: string;
  /** `store` / `update` / `merge` / `skip` / `conflict` / `skip_missing`。 */
  kind: string;
  input_digest: string;
  decided_at: string;
}

/** `dsh-memory/receipts` 响应。 */
export interface ReceiptsResponse {
  /** `record` / `run` / `both` / `none`。 */
  dimension: string;
  items: ReceiptItemView[];
  total: number;
}

// ── 端点 → 请求/响应映射(client rpc.ts 泛型 call 的查表依据) ──

/** 外部来源视图（轨3 Connect；路径指针，不含正文）。 */
export interface MemorySourceView {
  id: string;
  kind: string;
  path: string;
  label?: string;
  lastScanAt: string;
  lastImportAt: string;
  disabled: boolean;
  status: 'active' | 'retired';
}
export interface MemorySourcesListResponse {
  sources: MemorySourceView[];
  /** 写门/启用态提示（面板据它显示“导入需开高权限”）。 */
  memoryMutate: boolean;
}
export interface MemorySourcesAddRequest {
  id: string;
  kind: string;
  path: string;
  label?: string;
}
export interface MemorySourcesAddResponse {
  id: string;
  created: boolean;
  notice: string;
}
export interface MemorySourcesRetireRequest {
  id: string;
  /** true = 恢复为 active；缺省/ false = 退役（不删数据，来源仍可重放）。 */
  active?: boolean;
}
export interface MemorySourcesRetireResponse {
  changed: boolean;
  notice: string;
}
export interface MemportScanRequest {
  /** 省略 = 扫描全部启用来源；指定 = 只扫该 id。 */
  sourceId?: string;
}
export interface MemportScanCounts {
  dup: number;
  'near-dup': number;
  'conflict-candidate': number;
  new: number;
}
export interface MemportScanSourceResult {
  sourceId: string;
  label?: string;
  /** 命中的 .mem 包数（只读，未写库）。 */
  files: number;
  /** 解析出的总条数（受 scanMaxRecords 上限）。 */
  total: number;
  /** 每包校验失败原因（不阻断其余来源）。 */
  errors: string[];
  counts: MemportScanCounts;
  /** 新记录样本预览（正文截断；实际写库走 memory_import，那里才做脱敏）。 */
  sampleNew: Array<{ type: string; content: string }>;
}
export interface MemportScanResponse {
  /** cfg.memport.enabled——关时 sources 为空并附 notice。 */
  enabled: boolean;
  sources: MemportScanSourceResult[];
  notice?: string;
}

/** 技能摘要（轨2 SkillsTab；供人工审阅/晋升/pin/归档）。 */
export interface SkillView {
  id: string;
  title: string;
  status: 'candidate' | 'active' | 'archived';
  tier: 'full' | 'excerpt' | 'hint';
  pinned: boolean;
  sessionCount: number;
  updatedAt: string;
}
export interface SkillsListResponse {
  enabled: boolean;
  /** 自动晋升总闸（allowPromote）；关时 promote 动作会被拒。 */
  allowPromote: boolean;
  memoryMutate: boolean;
  skills: SkillView[];
}
export interface SkillsActionRequest {
  id: string;
  action: 'promote' | 'archive' | 'pin' | 'unpin' | 'set-tier';
  tier?: 'full' | 'excerpt' | 'hint';
  reason?: string;
}
export interface SkillsActionResponse {
  changed: boolean;
  notice: string;
}

/** dsh-memory/session-recalled (G-live)：本会话已注入、未被压缩覆盖的召回集。 */
export interface SessionRecalledRequest {
  sessionId: string;
}
export interface SessionRecalledResponse {
  sessionId: string;
  /** 按召回插入序（旧→新）；复用 UiRecord（含 maturity/usageScenario）。 */
  records: UiRecord[];
}

/**
 * dsh-memory/recall-feedback（人在召回卡上打分）。
 *
 * 语义边界：`0..5` = 人给的相关度（只聚合、不改写任何排序分）；`-1` = 声明过时，
 * 服务端会顺手做三件事——退场该记录（软删，可 `records-restore` 恢复）、从本会话
 * 活召回集摘掉、把“已向模型播报”入队（下一轮一次性告知）。
 */
export interface RecallFeedbackRequest {
  sessionId: string;
  /** 被打分的那条召回记录 id（必须是本会话活召回集里的，否则拒）。 */
  id: string;
  /** -1 或 0..5。 */
  score: number;
}
export interface RecallFeedbackResponse {
  id: string;
  score: number;
  /** 聚合后的反馈条目。 */
  rating: {
    last: number;
    rated: number;
    mean: number;
    obsolete: number;
  };
  /** 本次是否触发了退场(仅 score=-1)。 */
  retired: boolean;
  /** 退场后是否已排入下一轮向模型播报(仅 score=-1 且 cfg.recallFeedback.announce)。 */
  announced: boolean;
}

/**
 * dsh-memory/workspace-relink：按内容路由把存量记忆归到 workspace。
 *
 * 只写 `workspace_id` 列——**不改 `scope`**，所以可见性今天一行不变
 * （`isScopeVisible` 先看 scope，global 即全可见）；`workspace_id` 不在
 * `canonicalRecords` 快照哈希字段表里，因此回填不会让旧快照失配。
 */
export interface WorkspaceRelinkRequest {
  /** 缺省 true（干跑）：只看报告不写库。给 `false` 才真写（需高权限）。 */
  dryRun?: boolean;
}
export interface WorkspaceRelinkResponse {
  dryRun: boolean;
  /** 本次扫过的记录数（含未命中）。 */
  scanned: number;
  /** 路由命中的记录数。 */
  matched: number;
  /** 归属已是目标值（幂等重跑时等于 matched）。 */
  unchanged: number;
  /** 干跑时“若真跑会写多少条”；真写时恒为 0。 */
  toWrite: number;
  /** 实际写入条数（干跑恒 0）。 */
  written: number;
  /** 未扫到、下次触发续扫的条数。 */
  remaining: number;
  /** 命中记录按归属分布——拿它判断路由表合不合口味。 */
  byWorkspace: Record<string, number>;
}

export interface DshMemoryRequestMap {
  'dsh-memory/stats': Record<string, never>;
  'dsh-memory/token-cost': TokenCostRequest;
  'dsh-memory/session-mode-get': SessionModeGetRequest;
  'dsh-memory/session-mode-set': SessionModeSetRequest;
  'dsh-memory/wing-overview': Record<string, never>;
  'dsh-memory/rooms-get': Record<string, never>;
  'dsh-memory/rooms-export': RoomsExportRequest;
  'dsh-memory/room-register': RoomRegisterRequest;
  'dsh-memory/room-admin': RoomAdminRequest;
  'dsh-memory/wing-backfill': Record<string, never>;
  'dsh-memory/session-stats': SessionStatsRequest;
  'dsh-memory/settings-get': Record<string, never>;
  'dsh-memory/settings-set': SettingsSetRequest;
  'dsh-memory/list-records': ListRecordsRequest;
  'dsh-memory/records-delete': RecordsDeleteRequest;
  'dsh-memory/receipts': ReceiptsRequest;
  'dsh-memory/conflicts': ConflictsRequest;
  'dsh-memory/conflict-resolve': ConflictResolveRequest;
  'dsh-memory/conflicts-rejected': ConflictRejectedRequest;
  'dsh-memory/graph-search': GraphSearchRequest;
  'dsh-memory/graph-node-get': GraphNodeGetRequest;
  'dsh-memory/scenes': Record<string, never>;
  'dsh-memory/persona': Record<string, never>;
  'dsh-memory/log-tail': LogTailRequest;
  'dsh-memory/trace-tail': TraceTailRequest;
  'dsh-memory/rebuild-status': Record<string, never>;
  'dsh-memory/rebuild-start': Record<string, never>;
  'dsh-memory/rebuild-cancel': Record<string, never>;
  'dsh-memory/ruminate-status': Record<string, never>;
  'dsh-memory/ruminate-start': Record<string, never>;
  'dsh-memory/ruminate-cancel': Record<string, never>;
  'dsh-memory/llm-providers': Record<string, never>;
  'dsh-memory/llm-models': LlmModelsRequest;
  'dsh-memory/embedding-state-get': Record<string, never>;
  'dsh-memory/embedding-source-set': EmbeddingSourceSetRequest;
  'dsh-memory/embedding-download-start': EmbeddingDownloadStartRequest;
  'dsh-memory/embedding-download-cancel': Record<string, never>;
  'dsh-memory/embedding-model-delete': EmbeddingModelDeleteRequest;
  'dsh-memory/embedding-runtime-cancel': Record<string, never>;
  'dsh-memory/embedding-reindex': Record<string, never>;
  'dsh-memory/embedding-reindex-cancel': Record<string, never>;
  'dsh-memory/records-retired': RecordsRetiredRequest;
  'dsh-memory/records-restore': RecordsRestoreRequest;
  'dsh-memory/cleanup-retired': CleanupRetiredRequest;
  'dsh-memory/snapshots-list': SnapshotsListRequest;
  'dsh-memory/snapshot-restore': SnapshotRestoreRequest;
  'dsh-memory/memory-sources-list': Record<string, never>;
  'dsh-memory/memory-sources-add': MemorySourcesAddRequest;
  'dsh-memory/memory-sources-retire': MemorySourcesRetireRequest;
  'dsh-memory/memport-scan': MemportScanRequest;
  'dsh-memory/skills-list': Record<string, never>;
  'dsh-memory/session-recalled': SessionRecalledRequest;
  'dsh-memory/recall-feedback': RecallFeedbackRequest;
  'dsh-memory/workspace-relink': WorkspaceRelinkRequest;
  'dsh-memory/skills-action': SkillsActionRequest;
}

export interface DshMemoryResponseMap {
  'dsh-memory/stats': StatsResponse;
  'dsh-memory/token-cost': TokenCostResponse;
  'dsh-memory/session-mode-get': SessionModeGetResponse;
  'dsh-memory/session-mode-set': SessionModeSetResponse;
  'dsh-memory/wing-overview': WingOverviewResponse;
  'dsh-memory/rooms-get': RoomsGetResponse;
  'dsh-memory/rooms-export': RoomsExportResponse;
  'dsh-memory/room-register': RoomRegisterResponse;
  'dsh-memory/room-admin': RoomAdminResponse;
  'dsh-memory/wing-backfill': WingBackfillResponse;
  'dsh-memory/session-stats': SessionStatsResponse;
  'dsh-memory/settings-get': SettingsGetResponse;
  'dsh-memory/settings-set': SettingsSetResponse;
  'dsh-memory/list-records': ListRecordsResponse;
  'dsh-memory/records-delete': RecordsDeleteResponse;
  'dsh-memory/receipts': ReceiptsResponse;
  'dsh-memory/conflicts': ConflictsResponse;
  'dsh-memory/conflict-resolve': ConflictResolveResponse;
  'dsh-memory/conflicts-rejected': ConflictRejectedResponse;
  'dsh-memory/graph-search': GraphSearchResponse;
  'dsh-memory/graph-node-get': GraphNodeGetResponse;
  'dsh-memory/scenes': ScenesResponse;
  'dsh-memory/persona': PersonaResponse;
  'dsh-memory/log-tail': LogTailResponse;
  'dsh-memory/trace-tail': TraceTailResponse;
  'dsh-memory/rebuild-status': RebuildStatusResponse;
  'dsh-memory/rebuild-start': RebuildStatus;
  'dsh-memory/rebuild-cancel': RebuildStatus;
  'dsh-memory/ruminate-status': RuminateStatusResponse;
  'dsh-memory/ruminate-start': RuminateStatus;
  'dsh-memory/ruminate-cancel': RuminateStatus;
  'dsh-memory/llm-providers': LlmProvidersResponse;
  'dsh-memory/llm-models': LlmModelsResponse;
  'dsh-memory/embedding-state-get': EmbeddingStateResponse;
  'dsh-memory/embedding-source-set': EmbeddingSourceSetResponse;
  'dsh-memory/embedding-download-start': EmbeddingDownloadStartResponse;
  'dsh-memory/embedding-download-cancel': EmbeddingCancelResponse;
  'dsh-memory/embedding-model-delete': EmbeddingModelDeleteResponse;
  'dsh-memory/embedding-runtime-cancel': EmbeddingCancelResponse;
  'dsh-memory/embedding-reindex': EmbeddingReindexStartResponse;
  'dsh-memory/embedding-reindex-cancel': EmbeddingCancelResponse;
  'dsh-memory/records-retired': RecordsRetiredResponse;
  'dsh-memory/records-restore': RecordsRestoreResponse;
  'dsh-memory/cleanup-retired': CleanupRetiredResponse;
  'dsh-memory/snapshots-list': SnapshotsListResponse;
  'dsh-memory/snapshot-restore': SnapshotRestoreResponse;
  'dsh-memory/memory-sources-list': MemorySourcesListResponse;
  'dsh-memory/memory-sources-add': MemorySourcesAddResponse;
  'dsh-memory/memory-sources-retire': MemorySourcesRetireResponse;
  'dsh-memory/memport-scan': MemportScanResponse;
  'dsh-memory/skills-list': SkillsListResponse;
  'dsh-memory/session-recalled': SessionRecalledResponse;
  'dsh-memory/recall-feedback': RecallFeedbackResponse;
  'dsh-memory/workspace-relink': WorkspaceRelinkResponse;
  'dsh-memory/skills-action': SkillsActionResponse;
}

/** 全部端点名(client 调用与 host case 表的共用字面量来源)。 */
export type DshMemoryEndpoint = keyof DshMemoryResponseMap;
