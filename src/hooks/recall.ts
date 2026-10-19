/**
 * 召回 Hook(消息侧注入版,ADR-0001):
 * 1. agent/pre-step(waterfall,prepend 注册):有新的用户来源消息到达的步骤
 *    (轮首 claim 或 steering 插话)→ 检索 L1 → 以合成消息形式注入到用户消息之前。
 *    注入消息携带插件来源(form: 'recall'),对用户可见、随会话历史持久累积——
 *    这就是"记忆生效"的显式提示(dsh-time-context 同款官方范式)。
 *    纯工具步透传;召回超时(recall.timeoutMs 总预算)跳过本轮,绝不阻塞对话。
 * 2. agent/created:在 agent 作用域注册动态上下文 provider(L3 画像 + L2 场景导航 +
 *    工具指南——系统提示只保留稳定内容;指南三条件门控:工具开启 && 有内容)。
 *
 * 注入内容使用 <relevant-memories> 标签包裹(模型侧语义边界 + 助手回显剥离锚点),
 * 召回预算(单条/整轮)超限截断并引导模型用记忆工具查全文。
 * L0 防污染零成本:capture 侧只收 source.kind === 'user' 的消息,注入消息天然被排除。
 *
 * 注意:PromptContext.text 是同步函数,画像/场景导航这类异步文件读取必须走内存缓存,
 * 由定时刷新 + 管线更新后的主动失效来更新。
 */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-session'; // ctx.sessions 声明合并(回填读 live 会话)
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { Agent } from '@deepseek-ai/dsh-agent';
// §E:compaction/end 事件类型由本包的 SessionEventMap 模块扩充合并而来——
// 不引用则 event.type 联合不含 'compaction/end'(TS2367)。
import type {} from '@deepseek-ai/dsh-compaction';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { createHash } from 'node:crypto';
import { trace } from '../store/trace.js';
import type { MemoryConfig } from '../config.js';
import type { LiveSettingsHandle } from '../settings.js';
import type { L1Store } from '../store/l1.js';
import type { PersonaStore } from '../store/persona.js';
import { RecallDedupeStore } from '../store/recall-dedupe.js';
import type { SessionRecalledStore } from '../store/session-recalled.js';
import type { RecallFeedbackFace } from '../projection/recall.js';
import { OccupancyStore } from '../store/occupancy.js';
import {
  expirePendingInjections,
  registerPendingInjection,
  setInjectionMarker,
} from './recall-ack.js';
import type { SceneStore } from '../store/scenes.js';
import type { SessionModeStore } from '../store/session-modes.js';
import type { RecallUsageStore } from '../store/recall-usage.js';
import type { MemoryLogger } from '../types.js';
import { scopeFilterOf, workspaceIdOf } from '../workspace.js';
import { applyGovernanceWeights } from '../store/governance.js';
import { resolveRepoScope } from '../repo-scope.js';
import { applyRecallBudget, raceRecallTimeout, RECALL_EMBED_CAP_MS } from '../util/recall-budget.js';
import {
  clearProfileShare,
  emptyOccupancyLedger,
  estimateInjectedMessageTokens,
  estimateStableSectionTokens,
  recordProfileShare,
  recordRecallInjection,
  resetForCompaction,
  type OccupancyLedger,
} from '../util/context-occupancy.js';
import { errDetail } from '../util/filelog.js';
import { blocksToText } from '../util/text.js';
import { domainGate, formatWeights, hardFilterByWingLock, sortByDomainWeight, sortByHumanMark, sortByUsageScenario, WING_ANCHORS } from '../domain-gate.js';

const PROFILE_TTL = 60_000;

/* ── 召回回填的持久化服务兜底 ─────────────────────────────────────
 * 仅查看的旧会话不在 ctx.sessions live store(不发言就没有活 Session),surface
 * 路径拿不到。兜底走官方持久化服务 ctx.sessionPersistence.loadStored(id)——
 * "cwd 未知时跨项目目录读存储前缀",多帧 zstd / packed 行 / torn 尾 / 项目槽
 * 全部由官方后端处理。窗口近似:存储前缀没有派生 surface,遇 compaction 类
 * 事件把此前累计清零(与账本 resetForCompaction 同语义,宁低勿高)。
 * 结果按会话进程内缓存(查看态会话不再增长;一旦发言则由 live 路径接管);
 * 缓存有界(FIFO 上限)防逐会话查看慢泄漏。
 */
interface StoredLike {
  events?: ReadonlyArray<{
    type?: string;
    data?: { source?: Record<string, unknown>; content?: ReadonlyArray<{ type?: string; text?: string }> };
  }>;
}
/** 存储回填缓存上限(超过即按插入序淘汰最旧;查看会话数为百级,500 足够)。 */
const STORED_ESTIMATE_CACHE_CAP = 500;
const storedEstimateCache = new Map<string, number | null>();

function cacheStoredEstimate(sessionId: string, tokens: number | null): void {
  if (storedEstimateCache.size >= STORED_ESTIMATE_CACHE_CAP) {
    const oldest = storedEstimateCache.keys().next().value;
    if (oldest !== undefined) storedEstimateCache.delete(oldest);
  }
  storedEstimateCache.set(sessionId, tokens);
}

/** 召回查询只取会话末尾 N 条消息(长会话每步把全史拼进 FTS MATCH 会让检索成本线性上涨)。 */
const RECALL_QUERY_TAIL_MESSAGES = 8;
/** 召回查询总字符上限(保留末尾——最新语境权重最高)。 */
const RECALL_QUERY_MAX_CHARS = 2_000;

/**
 * 从会话消息构建召回查询(纯函数):末尾 N 条 + 总长截断,空输入返回空串。
 * 全史拼接会让 MATCH 表达式随会话长度线性膨胀(整会话累计二次方成本)。
 */
/**
 * 本插件 recall 注入的署名判据(v4 `plugin:memory` 与 v3 旧行双形状;宿主迁移负责
 * 升格旧行)。导出供双形状单测钉住——估算函数(estimateRecallFromStorage /
 * estimateRecallTokens)对旧形状漏判会让"记忆召回份额"静默归零。
 */
export function isOwnRecallSource(src: { kind?: unknown; plugin?: unknown; form?: unknown } | undefined | null): boolean {
  return !!src && src.form === 'recall' && (src.kind === 'plugin:memory' || (src.kind === 'plugin' && src.plugin === 'memory'));
}

/** 会话事件里本插件可能关心的那几个字段（只读形状，不依赖宿主类型导出）。 */
export interface InjectionEventLike {
  /** 存储兜底路的事件形状宽松，`type` 也可能缺；缺即不是注入（下面的不等判定已覆盖 undefined）。 */
  type?: string;
  /** 存储兜底路（`sessionPersistence.loadStored`）的事件**不带 seq**，所以它是可选的。 */
  seq?: number;
  data?: {
    id?: unknown;
    source?: Record<string, unknown>;
    content?: ReadonlyArray<{ type?: string; text?: string }>;
  };
}

/** 一条本插件召回注入的事实。 */
export interface OwnInjectionFacts {
  /** 注入消息 id——稳定锚点。**不能用 seq 做键**：压缩的 `surfaceOp:{op:'replace'}` 会重排它。 */
  id: string;
  /**
   * 该消息此刻在日志里的 seq（拿去比 `surface.nodes`）。
   *
   * `undefined` = 这条来源根本没有 seq。**没有 seq 就不能声称“它可见”**——
   * 宁可算“不在可见集里”，也不拿一个臆测的默认值去判（哨兵值会把误标藏起来）。
   */
  seq: number | undefined;
  /** 注入正文字符数（token 估算用）。 */
  chars: number;
}

/**
 * 认出一条 `user/message` 事件是不是本插件的召回注入，并取出它的消息 id / seq / 正文字数。
 *
 * 这是**唯一的识别口径**：召份额估算（live 与存储两条路）与「正文已被摘要取代」对账都读它。
 * 两处各写一套判定迟早漂移，而漂移的后果是静默的（份额归零或误标取代）。
 * 署名判定走 `isOwnRecallSource`，同时吃 v4 `plugin:memory` 与 v3 旧行形状。
 */
export function ownInjectionFromEvent(ev: InjectionEventLike): OwnInjectionFacts | undefined {
  if (ev.type !== 'user/message') return undefined;
  const msg = ev.data;
  if (msg === undefined || !isOwnRecallSource(msg.source)) return undefined;
  let chars = 0;
  for (const b of msg.content ?? []) {
    if (b?.type === 'text' && typeof b.text === 'string') chars += b.text.length;
  }
  return {
    id: typeof msg.id === 'string' ? msg.id : '',
    seq: typeof ev.seq === 'number' ? ev.seq : undefined,
    chars,
  };
}

/**
 * 会话事件统一读形状（issue #8）：旧宿主 `session.events` 是数组属性；
 * 0.2.x 宿主已删该属性，官方访问器是 `snapshotEvents()`（全量日志，seq 与日志
 * 位置对齐，含 fork 前缀——与旧属性同口径）。两者都拿不到时返回 undefined，
 * 由调用点的既有退路处置（粗标记 / 存储回填）；不假设形状，不抛。
 * 导出供双形状单测钉住。
 */
export function readSessionEvents(session: {
  events?: readonly InjectionEventLike[];
  snapshotEvents?: () => readonly InjectionEventLike[];
}): readonly InjectionEventLike[] | undefined {
  if (Array.isArray(session.events)) return session.events;
  if (typeof session.snapshotEvents === 'function') return session.snapshotEvents();
  return undefined;
}

export function buildRecallQuery(
  messages: Array<{ content: unknown }>,
  tailMessages = RECALL_QUERY_TAIL_MESSAGES,
  maxChars = RECALL_QUERY_MAX_CHARS,
): string {
  const tail = messages.slice(-tailMessages);
  let text = tail.map((m) => blocksToText(m.content as never)).join(' ').trim();
  if (text.length > maxChars) text = text.slice(-maxChars);
  return text;
}

/**
 * §E 压缩感知标记器(memorax-absorb / task_24-26):记录刚完成压缩的会话,
 * pre-step 消费后做一次性增强召回。纯内存状态,CaptureBuffers 同款可单测导出。
 *
 * - `onCompactionEnd`:只认无 error 的 compaction/end(失败的压缩没有把内容逐出上下文);
 * - `consume`:消费即清(一次性增强);容量上限淘汰最旧(积压即异常,回退路径兜底)。
 */
export class PostCompactionTracker {
  private readonly map = new Map<string, boolean>();

  constructor(private readonly cap = 64) {}

  /** @returns 是否真的置了标记(false = 非 compaction/end 或带 error)。 */
  onCompactionEnd(sessionId: string, data?: { error?: unknown }): boolean {
    if (!sessionId || data?.error) return false;
    this.map.delete(sessionId); // 置尾刷新
    this.map.set(sessionId, true);
    while (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
    return true;
  }

  /** 消费该会话的增强标记(存在即清,返回是否存在)。 */
  consume(sessionId: string): boolean {
    if (!this.map.delete(sessionId)) return false;
    return true;
  }

  get size(): number {
    return this.map.size;
  }
}

const MEMORY_TOOLS_GUIDE = `<memory-tools-guide>
## 记忆工具调用指南

当上方注入的记忆片段不足以回答用户问题时，可主动调用以下工具获取更多信息：

- **memory_search**：搜索结构化记忆（L1），适用于回忆用户偏好、历史事件、项目事实、任务、规则等。
- **conversation_search**：搜索原始对话（L0），适用于查找具体消息原文、时间线、上下文细节。
- **memory_read_scene**：读取记忆文件详情（L2 场景块，如场景目录下的 .md 文件；也可读 persona.md）。

### ⚠️ 调用次数限制
每轮对话中，memory_search 和 conversation_search **合计最多调用 3 次**。
- 首次搜索无结果时，可换关键词或换工具重试，但总调用次数不要超过 3 次。
- 若 3 次搜索后仍无结果，说明该信息不在记忆中，请直接根据已有信息回复用户。

注：若当前环境限制直接调用工具（如仅允许代码执行入口），请经由该环境的工具调用机制
（如 run_code 程序内）使用以上记忆工具。
</memory-tools-guide>`;

/** 单会话召回统计(悬浮卡信息区数据源;每轮 O(1) 记账,agent/disposed 清理)。
 *  口径声明:这是"注入统计"而非 bench 的离线 recall@k——运行时没有 ground truth,
 *  命中率 = hitTurns / injectedTurns。去重语义:全量压制轮计入 hitTurns
 *  (相关记忆已在模型上下文里,本质是命中而非未命中),injectedTurns 仍计全部
 *  发生过检索的轮次(保住分母语义与悬浮卡口径连续性)。 */
// RecallSessionStats 来自契约单一事实源——host 悬浮卡端点与 client 悬浮卡共享同一形状。
import type { RecallSessionStats } from '../contract.js';
export type { RecallSessionStats } from '../contract.js';

/** 新建零值统计(首次出现的会话)。 */
export function emptyRecallStats(now = Date.now()): RecallSessionStats {
  return {
    injectedTurns: 0,
    hitTurns: 0,
    totalHits: 0,
    timeouts: 0,
    suppressedRecalls: 0,
    lastHits: 0,
    lastDurationMs: 0,
    updatedAt: now,
  };
}

export interface RecallHooks {
  /** 管线更新后调用:画像/场景缓存立即失效并异步刷新。 */
  invalidateProfile(): void;
  /** 会话召回统计只读视图(未发生过检索的会话返回 undefined)。 */
  stats(sessionId: string): RecallSessionStats | undefined;
  /** 记忆占用账本只读出口:内存优先,miss 时从流水复生(重启后历史会话);从未注入返回 null。 */
  occupancy(sessionId: string): OccupancyLedger | null;
  /**
   * 稳定区份额估算(旧会话回填):按当前画像/导航/指南组词折算 token,
   * 纯读不记账——旧会话系统提示里"现在大约坐着多少稳定区"的最佳可得估计。
   */
  estimateProfileTokens(agentId: string): number;
  /** 召回份额回填:live 会话 surface 现扫本插件注入,miss 时读盘上日志兜底;
   *  均不可得返回 null。 */
  estimateRecallTokens(sessionId: string): Promise<number | null>;
}

export function registerRecall(
  ctx: Context,
  cfg: MemoryConfig,
  stores: { l1: L1Store; scenes: Record<'chat' | 'work', SceneStore>; persona: Record<'chat' | 'work', PersonaStore>; recalled?: SessionRecalledStore; feedback?: RecallFeedbackFace },
  logger: MemoryLogger,
  live: LiveSettingsHandle,
  modes: SessionModeStore,
  dataDir: string,
  /** 召回使用统计(可选;未装配 = 零成本旁路):进 topN(注入)才算 used。 */
  usage?: RecallUsageStore,
): RecallHooks {
  /** 召回去重存储(同会话已注入的记忆不再重复注入;写穿持久化,重启不丢)。 */
  const dedupe = new RecallDedupeStore(dataDir, logger);
  /** 记忆占用流水(账本迁移写穿;重启后历史会话账目由此复生)。 */
  const occupancyStore = new OccupancyStore(dataDir, logger);
  /** 每 agent 召回统计(工具指南门控读 lastHits;悬浮卡信息区读全量计数)。 */
  const recallStats = new Map<string, RecallSessionStats>();
  const statFor = (id: string): RecallSessionStats => {
    let s = recallStats.get(id);
    if (!s) {
      s = emptyRecallStats();
      recallStats.set(id, s);
    }
    return s;
  };
  /** 每 agent 记忆占用账本(权威账本的唯一宿主实例;占用指示器与悬浮卡同源消费)。 */
  const occupancyByAgent = new Map<string, OccupancyLedger>();
  const ledgerFor = (id: string): OccupancyLedger => {
    let led = occupancyByAgent.get(id);
    if (!led) {
      // 进程重启/agent 重建后回看:从流水复生(新迁移在持久值上继续累加)
      led = occupancyStore.load(id) ?? emptyOccupancyLedger();
      occupancyByAgent.set(id, led);
    }
    return led;
  };
  // 画像/场景导航按族缓存(分族隔离:注入时按会话档位选族)
  const profileCache: Record<'chat' | 'work', ProfileParts> = {
    chat: { persona: '', nav: '' },
    work: { persona: '', nav: '' },
  };

  // ── 域软门禁(task_19)的锚向量缓存:8 条锚文本静态不变,进程内嵌一次 ──
  // 嵌入未就绪/失败 → null(降级关键词路径),不重试以免每轮付出失败代价
  let anchorVecs: Float32Array[] | null = null;
  let anchorVecsTried = false;
  const ensureAnchorVecs = async (): Promise<Float32Array[] | null> => {
    if (anchorVecsTried) return anchorVecs;
    anchorVecsTried = true;
    if (!stores.l1.vectorsReady()) return anchorVecs;
    try {
      const vecs: Array<Float32Array | undefined> = [];
      for (const a of WING_ANCHORS) vecs.push(await stores.l1.embedText(a.anchor));
      anchorVecs = vecs.every((v) => v !== undefined && v.length > 0) ? (vecs as Float32Array[]) : null;
    } catch {
      anchorVecs = null;
    }
    return anchorVecs;
  };

  /** hits 的 wing 归属表(检索命中不含 metadata,按 id 批量取回一次)。 */
  const wingByIdOf = (hits: Array<{ id: string }>): Map<string, unknown> => {
    const map = new Map<string, unknown>();
    if (hits.length === 0) return map;
    for (const r of stores.l1.getByIds(hits.map((h) => h.id))) map.set(r.id, r.metadata?.hall);
    return map;
  };

  const refreshProfile = async (): Promise<void> => {
    try {
      const [chat, work] = await Promise.all([
        loadProfileParts(stores, cfg, 'chat'),
        loadProfileParts(stores, cfg, 'work'),
      ]);
      profileCache.chat = chat;
      profileCache.work = work;
    } catch (err) {
      logger.warn(`[memory] 画像/场景缓存刷新失败: ${errDetail(err)}`);
    }
  };

  // 初始刷新 + 定时刷新(TTL)
  void refreshProfile();
  ctx.effect(() => {
    const timer = setInterval(() => void refreshProfile(), PROFILE_TTL);
    return () => clearInterval(timer);
  });

  const invalidateProfile = (): void => {
    void refreshProfile();
  };

  // agent 销毁时清掉召回统计槽(去重记录不随 agent 清——持久化语义:会话恢复后继续压制)
  ctx.on('agent/disposed', (payload) => {
    recallStats.delete(payload.agent.id);
    occupancyByAgent.delete(payload.agent.id);
  });

  // §D:绑定实际标记动作 + 超时清扫挂到 pre-step 入口(见注入点注释)。
  setInjectionMarker((agentId, recordIds) => dedupe.mark(agentId, recordIds));
  let ackDegradeWarned = false;

  // §E 压缩感知(memorax-absorb):宿主 `compaction/end`(无 error)→ 该会话下一轮
  // 做一次"定向增强召回"——跳过去重压制、画像立即重注入、占用账本归零;消费即清。
  // 会话级回退路径保留(下方 agent/created source='compact' 全量重置),两者幂等。
  // 宿主无压缩计数器(compactionId 为 per-transaction UUID),故不做 generation 对账。
  const postCompaction = new PostCompactionTracker();
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'compaction/end') return;
    const sid = String(session.id ?? session);
    if (postCompaction.onCompactionEnd(sid)) {
      logger.info(`[memory] compaction/end:下一轮将做一次增强召回(session=${sid})`);
    }
    // Phase 0B：压缩完成的**权威**信号。取代标记不再只靠 agent/created 的粗标，而是从
    // surface.nodes 逐条对账；即使那条事件根本没发，这里也能把状态算对（并可撤销误标）。
    void reconcileSupersededFromSession(sid);
  });

  // 上下文压缩/清空 → 已注入内容从模型上下文丢失,重置该会话的去重压制
  // (resume/startup 不重置:历史仍在,已注入的记忆模型还持有)。
  // 占用账本同步全量归零(宁低勿高;轮级粒度近似)。
  ctx.on('agent/created', async (payload) => {
    if (payload.source === 'compact' || payload.source === 'clear') {
      dedupe.reset(payload.agent.id);
      // 压缩与清空**不同对待**：摘要替换不得抹掉本会话的召回历史（尤其已判过时的裁决凭证），
      // 只有用户主动清空才整表清。去重与占用账本仍按原样重置（那两者关心“能不能重新注入”）。
      stores.recalled?.reset(
        String((payload.agent as { session?: { id?: unknown } }).session?.id ?? payload.agent.id),
        payload.source === 'compact' ? 'compact' : 'clear',
      );
      const led = ledgerFor(payload.agent.id);
      resetForCompaction(led);
      occupancyStore.save(payload.agent.id, led); // stock 归零 ⇒ 流水条目删除
      logger.info(`[memory] 召回去重与占用账本重置(agent=${payload.agent.id},source=${payload.source})`);
    }
  });

  /** 取某个 agent 的父会话 id(结构鸭子类型,服务/字段缺失一律 undefined)。 */
  const parentSessionOf = (agent: unknown): string | undefined =>
    (agent as { session?: { header?: { parentSession?: string } } } | undefined)?.session?.header
      ?.parentSession;

  /**
   * **档位/锁域的会话所有者**解析:子代理会话自身没设过显式条目时,沿
   * `session.header.parentSession` 上溯到最近的祖先——与 `src/tools/index.ts` 的
   * `resolveModeOwner` **同一套语义**。
   *
   * 为什么必须上溯:修复前召回路直接读 `payload.agent.id`,于是父会话显式设的
   * `off` 档 / 锁定域 / 注入覆盖在**子代理的 pre-step 里全部不生效**(工具路修过
   * "用户显式 off 被绕过",召回与注入路漏了同一修) —— 表现为子代理照旧跨域召回。
   *
   * 降级(全 fail-open,不新增拒绝路径):`agents` 服务缺失 / 链断 → 用自身 id
   * (与修复前一致);环检测保证自环与成环都能终止。
   */
  const resolveModeOwner = (agentId: string, agent: unknown): string => {
    if (modes.hasEntry(agentId)) return agentId;
    const seen = new Set<string>([agentId]);
    let cur = parentSessionOf(agent);
    while (cur !== undefined && !seen.has(cur)) {
      if (modes.hasEntry(cur)) return cur;
      seen.add(cur);
      const upstream = ctx.get?.('agents') as
        | { get?: (id: string) => unknown }
        | undefined;
      cur = parentSessionOf(upstream?.get?.(cur));
    }
    return agentId;
  };

  // ── 1. pre-step 消息侧注入:记忆先行于每一条新的用户输入(ADR-0001) ──
  // prepend 注册 + 先 next() 再改写:不劫持其他监听器(dsh-time-context 官方范式)。
  if (cfg.recall.enabled) {
    ctx.on(
      'agent/pre-step',
      async (payload, next) => {
        // §D 超时清扫:超时未确认的注入照旧标记(降级保连续,防 dedupe 失效回归);
        // 正常确认在秒级完成,这里只是兜底。一次性提示。
        const expiredAcks = expirePendingInjections();
        if (expiredAcks > 0 && !ackDegradeWarned) {
          ackDegradeWarned = true;
          logger.warn(`[memory] 注入确认:${expiredAcks} 条 pending 超时未回执,已降级为照常标记(一次性提示)`);
        }
        const decision = await next();
        if (decision.kind === 'reject' || payload.signal.aborted) return decision;
        try {
          const s = live.get();
          // 档位/锁域读**所有者**(子代理上溯父链);统计与去重仍按各自 agent(上下文独立)
          const ownerId = resolveModeOwner(payload.agent.id, payload.agent);
          const mode = modes.get(ownerId);
          // 三级读闸:主闸 → off 档(完全隐身)→ 注入开关(会话覆盖 ?? 全局)
          if (!s.enabled || mode === 'off' || !modes.resolvedRecall(ownerId, s.recall)) return decision;
          // 只在有新的用户来源消息的步骤注入(轮首 claim 或 steering 插话);纯工具步透传
          const hasNewUserMessage = decision.messages.some(
            (m) => (m as { source?: { kind?: string } }).source?.kind === 'user',
          );
          if (!hasNewUserMessage) return decision;
          // §E 消费增强标记:压缩后下一轮跳过去重压制(预算/档位/门控照常),
          // 画像 TTL 失效立即重注入,占用账本归零。消费即清(一次性)。
          const sessionKey = String(
            (payload.agent as { session?: { id?: unknown } }).session?.id ?? payload.agent.id,
          );
          const boosted = postCompaction.consume(sessionKey);
          if (boosted) {
            invalidateProfile();
            const led = ledgerFor(payload.agent.id);
            resetForCompaction(led);
            occupancyStore.save(payload.agent.id, led);
            logger.info(`[memory] 压缩后增强召回:本轮跳过去重压制 + 画像重注入(session=${sessionKey})`);
          }
          const query = buildRecallQuery(payload.messages as Array<{ content: unknown }>);
          // 空查询是退化轮(无用户文本),重置命中信号但不计入统计
          if (!query) {
            const degenerate = statFor(payload.agent.id);
            degenerate.lastHits = 0;
            return decision;
          }
          // §F 追踪字段:metadata-only 默认(chars+sha256 前 16),captureContent 才存原文
          const queryChars = query.length;
          const querySha = createHash('sha256').update(query).digest('hex').slice(0, 16);
          const queryText = cfg.trace?.captureContent === true ? query.slice(0, 200) : undefined;
          const st = statFor(payload.agent.id);
          st.injectedTurns++;
          st.lastHits = 0;
          st.updatedAt = Date.now();
          const searchStart = Date.now();
          const hits = await raceRecallTimeout(
            stores.l1.search(query, cfg.recall.maxResults, {
              scoreThreshold: cfg.recall.scoreThreshold,
              family: mode === 'auto' ? undefined : mode,
              // §E 可见范围:自动召回是"最没人在看"的一条路径——它静默地往模型上下文里
              // 注入记忆。若这里漏了隔离,跨工作区泄漏会发生在每一次对话里而不留痕迹。
              workspaceId: scopeFilterOf(cfg.scope, { agent: payload.agent }),
              // 嵌入内层钳制:给 FTS 降级留出总预算内的时间(远程限 HTTP fetch;本地经 worker 代理 race 放弃)
              embeddingTimeoutMs: RECALL_EMBED_CAP_MS,
            }),
            cfg.recall.timeoutMs,
          );
          st.updatedAt = Date.now();
          if (hits === undefined) {
            st.timeouts++;
            logger.warn('[memory] 召回超时,跳过本轮注入(不阻塞对话)');
            trace({
              kind: 'recall_turn', ts: Date.now(), sessionId: sessionKey, queryChars, querySha, queryText,
              hitIds: [], hitScores: [], injectedIds: [], suppressedCount: 0,
              durationMs: Date.now() - searchStart, outcome: 'timeout',
            });
            return decision;
          }
          st.lastDurationMs = Date.now() - searchStart;
          // ── wing 域范围(Phase 1c,R2/R12):锁角 = 硬过滤(手动挡);
          // 中心 = 软门禁(域相关度加权,task_19)。写侧零感知(蒸馏/打标不过此路)。 ──
          let scoped = hits;
          const wingLocks = modes.getWings(ownerId);
          if (wingLocks.length > 0) {
            // 手动挡:只召回锁定域;未打标默认包含(524/994,默认排除会静默丢一半),
            // general(跨域)默认不含;两个边界均可由会话开关切换
            const { includeUnlabeled, includeGeneral } = modes.wingBoundaries(ownerId);
            scoped = hardFilterByWingLock(hits, (id) => wingByIdOf(hits).get(id), wingLocks, includeUnlabeled, includeGeneral);
            logger.debug?.(
              `[memory] 域硬过滤 wing=${wingLocks.join('+')}:${hits.length} → ${scoped.length} 条(未打标${includeUnlabeled ? '含' : '不含'}/跨域${includeGeneral ? '含' : '不含'})`,
            );
          } else {
            // 智能档(中心):域相关度 → 每域权重,加权排序 + 预算截断实现"低相关域降权
            // 而非消失";嵌入不可用降级关键词,再退化为无偏置(零干预)。零额外 LLM。
            const anchorVecsReady = await ensureAnchorVecs();
            const queryVec =
              anchorVecsReady && stores.l1.vectorsReady()
                ? await stores.l1.embedText(query, RECALL_EMBED_CAP_MS)
                : undefined;
            const gate = domainGate(query, { queryVec, anchorVecs: anchorVecsReady ?? undefined });
            if (gate.source !== 'none' && scoped.length > 1) {
              const wingById = wingByIdOf(scoped);
              scoped = sortByDomainWeight(scoped, (id) => wingById.get(id), gate.weights);
              logger.info(
                `[memory] 域软门禁(source=${gate.source}) ${formatWeights(gate.weights)} agent=${payload.agent.id}`,
              );
            }
          }
          // ── 治理权重(ADR-0015 T1.10b):repo 软围栏,纯函数重排(score 不改写,I-1)。
          // 挂在域软门禁**之后**(组合语义:既有调用点不动);默认关,关闭时不进本分支,
          // 召回路径逐字现状(I-10);读不到归属的记录乘 1(fail-open)。
          if (cfg.recall.scopeFence?.enabled === true && scoped.length > 1) {
            const currentRepoKey = resolveRepoScope(workspaceIdOf({ agent: payload.agent })).repoKey;
            const recordsById = new Map(stores.l1.getByIds(scoped.map((h) => h.id)).map((r) => [r.id, r]));
            scoped = applyGovernanceWeights(scoped, recordsById, {
              enabled: true,
              currentRepoKey,
              crossRepoMultiplier: cfg.recall.scopeFence?.crossRepoMultiplier ?? 0.2,
            });
            logger.info(
              `[memory] repo 软围栏:currentRepo=${currentRepoKey || '(未识别)'} 跨仓乘子=${cfg.recall.scopeFence.crossRepoMultiplier} agent=${payload.agent.id}`,
            );
          }
          // ── G1 使用场景细排(默认关):命中 usageScenario 的记忆上浮,纯函数重排,score 不改写。
          // 关闭时不进本分支(零 getByIds、零重排,召回逐字现状);无场景/未命中保持原序(fail-open)。
          if (cfg.usageScenario?.enabled === true && scoped.length > 1) {
            const scenarioById = new Map(
              stores.l1.getByIds(scoped.map((h) => h.id)).map((r) => [
                r.id,
                Array.isArray((r.metadata as Record<string, unknown> | undefined)?.dsh_usage_scenario)
                  ? ((r.metadata as Record<string, unknown>).dsh_usage_scenario as string[])
                  : ([] as string[]),
              ]),
            );
            const before = scoped.map((h) => h.id).join(',');
            scoped = sortByUsageScenario(scoped, (id) => scenarioById.get(id) ?? [], query);
            if (scoped.map((h) => h.id).join(',') !== before) {
              logger.info(`[memory] 使用场景细排生效:agent=${payload.agent.id}`);
            }
          }
          // ── 人工打分参与排序（默认开）：4/5 上浮、0/1/2 下沉。纯重排、**score 不改写**、
          // 同档内保持进入顺序（不推翻上面的围栏/场景细排）。这就是 0/1/2 的常规出口：
          // 不相关就排到注不上，而不是从记忆里消失。未装配反馈面 / 全未打分 → 逐字同序。
          if (
            cfg.recallFeedback?.enabled === true
            && cfg.recallFeedback.affectRank !== false
            && stores.feedback !== undefined
            && scoped.length > 1
          ) {
            const fb = stores.feedback;
            const before = scoped.map((h) => h.id).join(',');
            scoped = sortByHumanMark(scoped, (id) => fb.lastOf(id));
            if (scoped.map((h) => h.id).join(',') !== before) {
              logger.info(`[memory] 人工打分排序生效(agent=${payload.agent.id})`);
            }
          }
          // ── 可选硬门 excludeZero（**默认关**）：最近一笔是 0 → 本轮不注入（不退场，
          // 再点 1..5 即回来）。开着它=“误点一次就完全不再浮现”，所以默认只靠上面的沉底。
          if (
            cfg.recallFeedback?.enabled === true
            && cfg.recallFeedback.excludeZero === true
            && stores.feedback !== undefined
            && scoped.length > 0
          ) {
            const fb = stores.feedback;
            const kept = scoped.filter((h) => fb.lastOf(h.id) !== 0);
            if (kept.length !== scoped.length) {
              logger.info(`[memory] 相关度 0 分剔除 ${scoped.length - kept.length} 条(agent=${payload.agent.id})`);
              scoped = kept;
            }
          }
          // 召回去重:同会话已注入过的记录不再重复注入(模型上下文已持有,省 token)。
          // 纯过滤——剩几条注几条,全量压制(0 条新鲜命中)是正确状态而非未命中。
          // §E:压缩后增强轮跳过压制(压缩把已注入内容逐出了模型上下文)。
          const seen = boosted ? new Set<string>() : dedupe.seen(payload.agent.id);
          const fresh = scoped.filter((h) => !seen.has(h.id));
          const suppressed = scoped.length - fresh.length;
          st.suppressedRecalls += suppressed;
          if (suppressed > 0) {
            logger.debug?.(
              `[memory] 召回去重:压制 ${suppressed} 条已注入记忆(agent=${payload.agent.id},余 ${fresh.length} 条新鲜命中)`,
            );
          }
          if (scoped.length > 0) {
            // 全量压制轮也计入命中:相关记忆已在模型上下文里,本质是命中
            st.hitTurns++;
            st.totalHits += fresh.length;
          }
          if (fresh.length === 0) {
            // §F 追踪:全量压制轮——零注入是正确状态,如实记录
            trace({
              kind: 'recall_turn', ts: Date.now(), sessionId: sessionKey, queryChars, querySha, queryText,
              hitIds: scoped.map((h) => h.id), hitScores: scoped.map((h) => Number(h.score.toFixed(4))),
              injectedIds: [], suppressedCount: scoped.length - fresh.length,
              durationMs: Date.now() - searchStart, outcome: 'suppressed',
            });
            usage?.recordAttempt(scoped.map((h) => h.id), []);
            return decision;
          }
          const lines = applyRecallBudget(
            fresh.map((h) => `- [${h.scene_name ? `${h.type}|${h.scene_name}` : h.type}] ${h.content}`),
            { maxCharsPerMemory: cfg.recall.maxCharsPerMemory, maxTotalRecallChars: cfg.recall.maxTotalRecallChars },
          );
          if (lines.length === 0) {
            // §F 追踪:预算清零轮(截断后无完整行)
            trace({
              kind: 'recall_turn', ts: Date.now(), sessionId: sessionKey, queryChars, querySha, queryText,
              hitIds: fresh.map((h) => h.id), hitScores: fresh.map((h) => Number(h.score.toFixed(4))),
              injectedIds: [], suppressedCount: scoped.length - fresh.length,
              durationMs: Date.now() - searchStart, outcome: 'suppressed',
            });
            usage?.recordAttempt(fresh.map((h) => h.id), []);
            return decision;
          }
          st.lastHits = lines.length;
          const text = [
            '<relevant-memories>',
            '以下是当前对话召回的相关记忆，不代表当前任务进程，仅作为参考：',
            '',
            ...lines,
            '',
            '</relevant-memories>',
          ].join('\n');
          logger.info(
            `[memory] 召回注入 ${lines.length} 条 L1(mode=${mode},query="${query.slice(0, 30).replace(/\n/g, ' ')}…",agent=${payload.agent.id},消息侧)`,
          );
          const injection = createUserMessage({
            content: [{ type: 'text', text }],
            // v4（宿主 ≥0.1.7-rc.1）署名为 producer-owned kind：plugin:<子系统名>。
            // 用展示友好的子系统名 memory,不用 cordis id(dsh-memory);宿主 UI 标题
            // 规则随之变化(不再有 catch-all 'plugin' 的通用"上下文注入"标题)。
            // v3 旧行(kind:'plugin'+plugin 字段)由宿主 v3→v4 迁移升格,读侧双形状兼容。
            source: { kind: 'plugin:memory', form: 'recall' },
          });
          // §D 注入确认(memorax-absorb):宿主接受 enter 后,注入消息以原样
          // `user/message` 进入会话日志(message.id 稳定保留)——capture 侧观察到
          // 该 id 才真正 dedupe.mark(recall-ack 两段式)。这里只登记 pending,
          // 未确认不标记:被覆盖/取消的注入不该压制这些记忆(下轮可重注)。
          registerPendingInjection(
            payload.agent.id,
            injection.id,
            fresh.slice(0, lines.length).map((h) => h.id),
          );
          // §F 追踪:注入轮
          trace({
            kind: 'recall_turn', ts: Date.now(), sessionId: sessionKey, queryChars, querySha, queryText,
            hitIds: scoped.map((h) => h.id), hitScores: scoped.map((h) => Number(h.score.toFixed(4))),
            injectedIds: fresh.slice(0, lines.length).map((h) => h.id), suppressedCount: scoped.length - fresh.length,
            durationMs: Date.now() - searchStart, outcome: 'injected',
          });
          // 使用统计:候选=scoped(尝试),进 topN(注入)=used
          usage?.recordAttempt(scoped.map((h) => h.id), fresh.slice(0, lines.length).map((h) => h.id));
          // G-live:按 **sessionKey**(=agent.session?.id ?? agent.id，与 pill 的 sessionId / 投影 header.id 同源，
          // 非 ownerId)记入本会话“活召回集”，供侧栏卡读取；压缩时同键 reset。
          stores.recalled?.add(sessionKey, fresh.slice(0, lines.length).map((h) => h.id), injection.id);
          // 入账在成功构造注入消息之后、返回 enter 之前——任何前置抛错路径账目零扰动
          const led = ledgerFor(payload.agent.id);
          recordRecallInjection(led, text.length);
          occupancyStore.save(payload.agent.id, led);
          // 注入消息排在用户新消息之前(原版 prepend 语义:先线索后问题)
          return { kind: 'enter', messages: [injection, ...decision.messages] };
        } catch (err) {
          logger.warn(`[memory] 召回注入失败(跳过本轮): ${errDetail(err)}`);
          return decision;
        }
      },
      { prepend: true },
    );
  }

  // ── 2. agent 作用域上下文 provider(系统提示稳定区:画像 + 导航 + 门控指南) ──
  // 插件可能在默认 agent 创建之后才加载(组合顺序由依赖决定),
  // 因此除了监听 agent/created,还要给已存在的 agent 补注册。
  /**
   * 稳定区当前组词(纯读,不记账):text() 的取词部分单独成函数,
   * 供旧会话回填估算(RecallHooks.estimateProfileTokens)复用同一口径。
   */
  const composeStableText = (agentId: string): string => {
    const s = live.get();
    const mode = modes.get(agentId);
    // 与 pre-step 同款三级读闸:主闸 → off 档 → 注入开关;空串即物理离场
    if (!s.enabled || mode === 'off' || !modes.resolvedRecall(agentId, s.recall)) return '';
    // auto 档:两族按类别归组(画像/导航各一个标签,域内 <domain> 分块);纯档:单族原格式
    const body =
      mode === 'auto'
        ? formatProfileAuto(profileCache.chat, profileCache.work)
        : formatProfileSingle(profileCache[mode]);
    const hasRecallHit = (recallStats.get(agentId)?.lastHits ?? 0) > 0;
    // 指南三条件门控:工具已注册(cfg.tools)&&(稳定内容 ∥ 本轮召回命中)——
    // 空库用户与关闭工具的用户不付这份固定 token(原版 auto-recall 同款语义)
    if (!cfg.tools) return body;
    if (!body && !hasRecallHit) return '';
    return body ? `${body}\n\n${MEMORY_TOOLS_GUIDE}` : MEMORY_TOOLS_GUIDE;
  };

  /**
   * Phase 0B：从宿主官方会话服务对账「正文已被摘要取代」。
   *
   * 为什么不再靠“收到一条压缩事件”：事件会漏（压缩不重建 agent 的宿主线、含 CCI compat 摘要
   * 路径，根本不发 `agent/created{source:'compact'}`），漏一次就永久错且无法补算。这里每轮从
   * `surface.nodes` 重算，所以既能标上也能撤销（误标与重新注入都会自愈）。
   *
   * @returns true = 会话在 live store 且已对账；false = 不在（调用方回退到粗标记）。
   */
  const reconcileSupersededFromSession = async (sessionId: string): Promise<boolean> => {
    const recalled = stores.recalled;
    if (recalled === undefined || sessionId.length === 0) return false;
    try {
      // 可选服务一律走 ctx.get() 的宽容路径（属性访问对未 inject 的服务会抛）
      // events 形状双面：旧宿主数组属性 / 0.2.x snapshotEvents() 方法（issue #8）
      const sessions = ctx.get?.('sessions') as
        | { get?: (id: SessionId) => { surface: { nodes: readonly number[] }; events?: readonly InjectionEventLike[]; snapshotEvents?: () => readonly InjectionEventLike[] } | undefined }
        | undefined;
      const session = typeof sessions?.get === 'function' ? sessions.get(sessionId as SessionId) : undefined;
      if (session === undefined) return false;
      const events = readSessionEvents(session);
      if (events === undefined) return false; // 事件面不可得：调用方回退粗标记
      const visibleSeqs = new Set(session.surface.nodes);
      const visibleIds = new Set<string>();
      const knownIds = new Set<string>();
      for (const ev of events) {
        const own = ownInjectionFromEvent(ev);
        if (own === undefined || own.id.length === 0) continue;
        knownIds.add(own.id);
        // 只有“确实拿到了 seq 且 seq 在 surface.nodes 里”才算可见；
        // seq 缺失时宁可不撤销（保持原状），也不拿臆测值去改动人的可见性判定。
        if (own.seq !== undefined && visibleSeqs.has(own.seq)) visibleIds.add(own.id);
      }
      return recalled.reconcileSuperseded(sessionId, visibleIds, knownIds);
    } catch (err) {
      // 对账是旁路：失败只能“本轮不动”，绝不能弄挂召回或面板。
      logger.warn(`[memory] 取代对账失败(本轮跳过): ${errDetail(err)}`);
      return false;
    }
  };

  async function estimateRecallFromStorage(sessionId: string): Promise<number | null> {
    if (storedEstimateCache.has(sessionId)) return storedEstimateCache.get(sessionId) ?? null;
    let tokens: number | null = null;
    try {
      // 可选服务(JSONL 后端注册名);缺失/其它实现 → 回填隐藏
      const persistence = (await (ctx as unknown as { get?: (name: string) => unknown }).get?.('sessionPersistence')) as
        | { loadStored?: (id: never, signal?: AbortSignal) => Promise<StoredLike | undefined> }
        | undefined;
      const stored = typeof persistence?.loadStored === 'function' ? await persistence.loadStored(sessionId as never) : undefined;
      if (stored?.events) {
        tokens = 0;
        for (const ev of stored.events) {
          // 存储路没有 surface，只能沿用“遇到压缩就归零”的启发式（粗近似，不伪装成精确判定）。
          if (typeof ev.type === 'string' && ev.type.startsWith('compaction')) tokens = 0;
          const own = ownInjectionFromEvent(ev);
          if (own === undefined || own.chars === 0) continue;
          tokens += estimateInjectedMessageTokens(own.chars);
        }
      }
    } catch {
      tokens = null;
    }
    cacheStoredEstimate(sessionId, tokens);
    return tokens;
  }

  /**
   * 召回份额回填(旧会话):live 会话的 surface(模型可见序号集)∩ 全事件日志
   * 里本插件的 recall 注入,官方同式折算。窗口语义天然正确——被压缩折叠的注入不在
   * surface.nodes 上,自动出局。会话不在 live store(未打开)返回 null。
   */
  const estimateRecallTokens = async (sessionId: string): Promise<number | null> => {
    try {
      // cordis 属性访问(ctx.sessions)对未 inject 的服务抛 "without inject";
      // 可选服务一律走 ctx.get() 的宽容路径
      // events 形状双面：旧宿主数组属性 / 0.2.x snapshotEvents() 方法（issue #8）
      const sessions = ctx.get?.('sessions') as
        | { get?: (id: SessionId) => { surface: { nodes: readonly number[] }; events?: readonly InjectionEventLike[]; snapshotEvents?: () => readonly InjectionEventLike[] } | undefined }
        | undefined;
      const session = typeof sessions?.get === 'function' ? sessions.get(sessionId as SessionId) : undefined;
      if (session) {
        const events = readSessionEvents(session);
        // 事件形状不可得：与「不在 live store」同一退路，走存储回填，不再静默归 null
        if (events === undefined) return estimateRecallFromStorage(sessionId);
        const visible = new Set(session.surface.nodes);
        let total = 0;
        for (const ev of events) {
          const own = ownInjectionFromEvent(ev);
          // 无 seq = 无法证明它可见，就不能算进份额（与原行为一致：原来它必须 visible.has(seq)）。
          if (own === undefined || own.chars === 0 || own.seq === undefined || !visible.has(own.seq)) continue;
          total += estimateInjectedMessageTokens(own.chars);
        }
        return total;
      }
      // 仅查看的旧会话不在 live store:官方持久化服务读存储前缀兜底(见函数头)
      return estimateRecallFromStorage(sessionId);
    } catch {
      return null; // 服务缺失/形状异常:回填隐藏,不扰动主流程
    }
  };

  const registered = new WeakSet<object>();
  // context() 的 disposer 必须挂到插件自身生命周期:agent.ctx 比插件实例活得久,
  // 不主动清理会导致热重载后旧注册泄漏、新实例撞名("already registered")
  const contextDisposers: Array<() => void> = [];
  const registerForAgent = (agent: Agent): void => {
    if (registered.has(agent)) return;
    registered.add(agent);
    try {
      contextDisposers.push(
        agent.ctx.systemPrompt.context({
          name: 'memory:profile',
          order: 510,
          text: () => {
            const final = composeStableText(agent.id);
            const ledger = ledgerFor(agent.id);
            // 空串即物理离场(停用/OFF/门控全空):份额同边界清零;否则按实际长度入账
            if (final === '') clearProfileShare(ledger);
            else recordProfileShare(ledger, final.length);
            occupancyStore.save(agent.id, ledger);
            return final;
          },
        }),
      );
    } catch (err) {
      logger.warn(`[memory] 召回上下文注册失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const agents = ctx.get('agents');
  if (agents) {
    for (const agent of agents.list()) registerForAgent(agent);
  }
  ctx.on('agent/created', async (payload) => {
    registerForAgent(payload.agent);
  });
  ctx.effect(() => () => {
    for (const dispose of contextDisposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* agent 可能已先一步销毁 */
      }
    }
  });

  return {
    invalidateProfile,
    stats: (id) => recallStats.get(id),
    /** 占用账本只读出口:内存优先,miss 时从流水复生(重启后历史会话);从未注入返回 null。 */
    occupancy: (id): OccupancyLedger | null => {
      const led = occupancyByAgent.get(id) ?? occupancyStore.load(id);
      if (led) occupancyByAgent.set(id, led);
      return led ?? null;
    },
    estimateProfileTokens: (id: string): number =>
      estimateStableSectionTokens(composeStableText(id).length),
    estimateRecallTokens,
  };
}

/** 单族画像/导航片段(注入侧按档位组装,纯档与 auto 档格式不同)。 */
interface ProfileParts {
  persona: string;
  nav: string;
}

/** auto 档 <user-persona> 内的域说明:让模型理解分块结构与两域的独立性。 */
const DOMAIN_HINT =
  '以下内容按记忆域分块：chat=用户个人画像（User Narrative Profile），work=团队工作准则（Team Operating Doctrine）。' +
  '两域独立蒸馏与更新，请按当前对话语境参考对应域，不要把一域的内容当作另一域的事实。';

function wrapDomain(family: 'chat' | 'work', content: string): string {
  const label = family === 'chat' ? '用户个人画像' : '团队工作准则';
  return `<domain family="${family}" label="${label}">\n${content.trim()}\n</domain>`;
}

/** 纯档注入:单族画像 + 场景导航(沿用原有格式)。 */
function formatProfileSingle(parts: ProfileParts): string {
  const segments: string[] = [];
  if (parts.persona) segments.push(`<user-persona>\n${parts.persona}\n</user-persona>`);
  if (parts.nav) segments.push(`<scene-navigation>\n${parts.nav}\n</scene-navigation>`);
  return segments.join('\n\n');
}

/** auto 档注入:两族按类别归组——画像共用一个 <user-persona>、导航共用一个 <scene-navigation>,域内 <domain> 分块。 */
function formatProfileAuto(chat: ProfileParts, work: ProfileParts): string {
  const segments: string[] = [];
  const personas: Array<['chat' | 'work', string]> = [
    ['chat', chat.persona],
    ['work', work.persona],
  ];
  const personaBlocks = personas.filter(([, p]) => p.trim()).map(([f, p]) => wrapDomain(f, p));
  if (personaBlocks.length > 0) {
    segments.push(`<user-persona>\n${DOMAIN_HINT}\n\n${personaBlocks.join('\n\n')}\n</user-persona>`);
  }
  const navs: Array<['chat' | 'work', string]> = [
    ['chat', chat.nav],
    ['work', work.nav],
  ];
  const navBlocks = navs.filter(([, n]) => n.trim()).map(([f, n]) => wrapDomain(f, n));
  if (navBlocks.length > 0) {
    segments.push(`<scene-navigation>\n${navBlocks.join('\n\n')}\n</scene-navigation>`);
  }
  // 注意:工具指南由注入侧统一附加一次(auto 档不重复)
  return segments.join('\n\n');
}

async function loadProfileParts(
  stores: { scenes: Record<'chat' | 'work', SceneStore>; persona: Record<'chat' | 'work', PersonaStore> },
  cfg: MemoryConfig,
  family: 'chat' | 'work',
): Promise<ProfileParts> {
  const persona = cfg.recall.includePersona ? ((await stores.persona[family].read()) ?? '') : '';
  const nav = cfg.recall.includeSceneNav ? ((await stores.scenes[family].navigation()) ?? '').trim() : '';
  return { persona, nav };
}
