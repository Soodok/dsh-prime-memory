/**
 * 会话「活召回集」服务端投影(memoryRecall)。
 *
 * 语义：本会话**已注入**的记忆，以及其中「此刻仍在上下文里」的那部分。
 * 数据源是 `SessionRecalledStore`（sessionKey 键、写穿持久化），所以**旧会话重开也读得到**。
 *
 * 压缩/清空对这张表的作用不同（2026-10-13 用户口径）：
 * - `clear`（主动清空）整表清，view 随之空；
 * - `compact`（摘要替换）**不删条目**，只把当时在列表里的那批标成 `superseded`（正文已被
 *   摘要取代、已不在上下文里）。读侧据此把旧召回与当前召回区分开，而不是继续谎报“还在”。
 *   已退场（`retired`）的条目必须留在列表里（人的裁决凭证），取代标记与它正交。
 *
 * 与 memorySlots 的分工（两条轴，互不替代）：
 * - `memorySlots` = 用户手动 pin 的**常驻约定**（每轮硬注入，注册表语义）；
 * - `memoryRecall` = 按相关性**隐式浮现**的召回结果（非常驻，本投影）。
 * 召回记录绝不灌进 memorySlots：那会把"非常驻"伪装成槽位注册表。
 *
 * 会话感知靠 `init(header)`：宿主在 `session/created` 与冷加载 restore 两处都传
 * `session.header`（`dsh-session/lib/index.js` 实证形状 `{ version, id, createdAt, … }`），
 * `header.id` 即会话 id，与召回记账的 sessionKey（`agent.session?.id ?? agent.id`）同源。
 * state 里带上 sessionId，apply 无 session 参数也能按本会话重读 store。
 *
 * 消费方是 dsh-brief-sidebar 的「本会话召回」分区（`useProjectionValue(ctx, sessionId, key)`）。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionRecalledStore } from '../store/session-recalled.js';
import type { MemoryRecord } from '../types.js';
import { isRetired } from '../store/supersede.js';
import { stateOfRecord } from '../store/validity.js';

export const MEMORY_RECALL_KEY = 'memoryRecall';

/** view 最多透出条数（最近在上；超出部分只计入 count，防 wire 体量失控）。 */
export const RECALL_VIEW_CAP = 20;
/** 单条标题（正文首行）最大长度。 */
const TITLE_MAX = 160;
/** 单条全文最大长度（泡泡里显示的正文；超出截断并补省略号，防 wire 体量失控）。 */
const BODY_MAX = 700;

/** 一条召回记录在 wire view 上的呈现。 */
export interface RecallItemView {
  id: string;
  type: string;
  /** 正文首行（截断至 TITLE_MAX）；全文由消费方按需走面板读。 */
  title: string;
  priority: number;
  /** 使用场景（metadata.dsh_usage_scenario）；无则缺席（附加字段，旧帧没有也整条通过）。 */
  scenario?: string[];
  /**
   * 人给的最近一次打分(-1..5)；未标注则缺席。
   * 卡片靠它把已打的那一笔显示成选中态；均值等细粒度数据走 `session-recalled` 端点。
   */
  rating?: number;
  /**
   * 正文全文（截断至 BODY_MAX）；消费方悬停泡泡直接读它，不再回查端点。
   * 缺席 = 旧帧（读侧退化成只显示 title）。
   */
  body?: string;
  /**
   * 该记录已被判定过时（`isRetired`）。只写 true：未退场时字段缺席，
   * 读侧按「缺席即活跃」处理，旧帧自然兼容。
   */
  retired?: true;
  /**
   * 该条目的正文**已被摘要取代**（压缩发生时时它就在列表里），即不在模型上下文里了。
   * 只写 true（同 `retired` 的兼容手法）；与 `retired` 正交，两者可共存。
   * 读侧据此把「已被摘要取代的旧召回」与「此刻仍在上下文里的召回」区分开。
   */
  superseded?: true;
  /**
   * 时效定性快照(task_3.5,expiry-tiering 门2 展示面)：仅在 `expired`/`expired_suspect`
   * 两档写键(泡泡如实标"已于 X 失效/疑似失效")；current/historical 等缺席=旧帧兼容。
   */
  validity?: import('../store/validity.js').ValidityState;
  /** 现实有效期(ISO)：与 `validity` 同进同退，只在写 validity 时带上。 */
  validUntil?: string;
}

/** 持久态：本会话的活召回 id 集 + 判脏序号。 */
export interface RecallProjectionState {
  rev: number;
  /**
   * 反馈 sidecar 的序号（打分也会让 view 变：条目要显示已打的那一笔）。
   * 可选：旧 checkpoint 帧里没这个字段，读侧必须容忍。
   */
  fb?: number;
  sessionId: string;
  /** 注入序（旧→新），由 store 保证。 */
  ids: string[];
  /**
   * 已被摘要取代的 id（压缩水位之上的那批）。可选：旧 checkpoint 没有这个字段，
   * 读侧必须容忍（缺席 = 无取代，与改动前逐字一致）。
   */
  superseded?: string[];
}

/** wire view：count 是总数，items 是**最近在上**的截断视图。 */
export interface RecallView {
  rev: number;
  sessionId: string;
  count: number;
  items: RecallItemView[];
}

/** 零依赖 schema（同 slots 投影的理由：registry 只调 `parse`，且按 Object.is 比较引用）。 */
interface SchemaLike<T> {
  parse(value: unknown): T;
}

function invalid(what: string, detail: string): never {
  throw new Error(`${what}: ${detail}`);
}

function requireRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(what, '期望普通对象');
  }
  return value as Record<string, unknown>;
}

function requireCounter(value: unknown, what: string, field: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalid(what, `${field} 必须是非负整数`);
  }
}

function requireString(value: unknown, what: string, field: string): void {
  if (typeof value !== 'string') invalid(what, `${field} 必须是字符串`);
}

/** state 校验（registry 用它挡掉损坏/过期的 checkpoint 行）。 */
export const stateSchema: SchemaLike<RecallProjectionState> = {
  parse: (value) => {
    const what = 'memoryRecall.state';
    const root = requireRecord(value, what);
    requireCounter(root.rev, what, 'rev');
    requireString(root.sessionId, what, 'sessionId');
    if (!Array.isArray(root.ids)) invalid(what, 'ids 必须是字符串数组');
    (root.ids as unknown[]).forEach((id, i) => requireString(id, `${what}.ids[${i}]`, 'id'));
    if (root.superseded !== undefined) {
      if (!Array.isArray(root.superseded)) invalid(what, 'superseded 必须是字符串数组');
      (root.superseded as unknown[]).forEach((id, i) => requireString(id, `${what}.superseded[${i}]`, 'id'));
    }
    return value as RecallProjectionState;
  },
};

/** view 校验（出网前调用；未知键容忍，同 slots 投影的语义边界）。 */
const VALIDITY_STATES_VIEW: readonly string[] = ['current', 'historical', 'expired', 'expired_suspect', 'superseded', 'retired'];
export const viewSchema: SchemaLike<RecallView> = {
  parse: (value) => {
    const what = 'memoryRecall.view';
    const root = requireRecord(value, what);
    requireCounter(root.rev, what, 'rev');
    requireString(root.sessionId, what, 'sessionId');
    requireCounter(root.count, what, 'count');
    if (!Array.isArray(root.items)) invalid(what, 'items 必须是数组');
    (root.items as unknown[]).forEach((raw, i) => {
      const at = `${what}.items[${i}]`;
      const item = requireRecord(raw, at);
      requireString(item.id, at, 'id');
      requireString(item.type, at, 'type');
      requireString(item.title, at, 'title');
      requireCounter(item.priority, at, 'priority');
      if (item.scenario !== undefined) {
        if (!Array.isArray(item.scenario)) invalid(at, 'scenario 必须是字符串数组');
        item.scenario.forEach((s, j) => requireString(s, `${at}.scenario[${j}]`, 'scenario'));
      }
      if (item.rating !== undefined && typeof item.rating !== 'number') invalid(at, 'rating 必须是数字');
      // 附加字段：旧帧没有 → 容忍；有 → 必须成形状。retired 只认 true，false 视为脏帧。
      if (item.body !== undefined) requireString(item.body, at, 'body');
      if (item.retired !== undefined && item.retired !== true) invalid(at, 'retired 只能是 true 或缺席');
      if (item.superseded !== undefined && item.superseded !== true) invalid(at, 'superseded 只能是 true 或缺席');
      // 时效标注(task_3.5)：缺席=旧帧容忍；有则必须六态枚举内，validUntil 必字符串。
      if (item.validity !== undefined && VALIDITY_STATES_VIEW.indexOf(item.validity as string) < 0) {
        invalid(at, 'validity 必须是六态之一或缺席');
      }
      if (item.validUntil !== undefined) requireString(item.validUntil, at, 'validUntil');
    });
    return value as RecallView;
  },
};

/** 投影需要的 L1 只读面（结构化声明，避免跨模块类型耦合）。
 *  判退场要 `validTo`/`metadata`，时效定性还要 `persistence`/`validFrom`，
 *  故直接 Pick 自 MemoryRecord，不在投影里自写时间比较。
 *  `name` 是名称蒸馏产出的短标题，优先作为展示标题。 */
export interface RecallL1Face {
  getByIds(ids: string[]): Array<Pick<MemoryRecord, 'id' | 'type' | 'content' | 'priority' | 'metadata' | 'validFrom' | 'validTo' | 'persistence' | 'name'>>;
}

/** 投影需要的反馈只读面（缺席 = view 不带 rating，旧行为）。 */
export interface RecallFeedbackFace {
  revision(): number;
  lastOf(id: string): number | undefined;
}

/**
 * 正文首行 → 标题（投影内不引 client 的 format 工具，保持服务端自足）。
 * 按 markdown 语义解析：
 * - H1（`# xxx`）是文档标题，直接作为记忆名称；
 * - H2+（`## xxx`）是正文分节标记，跳过它取第一个实质文本行。
 * 全部行都是 heading 时回落到第一个非空行。
 */
function firstLine(content: string): string {
  const lines = content.split('\n');
  // 优先取 H1（文档级标题）
  const h1 = lines.find((l) => /^#\s/.test(l.trim()));
  if (h1) return clampTitle(h1.trim());
  // 无 H1 时跳过 H2+ 分节 heading，取第一个实质文本行
  const body = lines.find((l) => {
    const t = l.trim();
    return t.length > 0 && !/^#{2,6}\s/.test(t);
  });
  if (body) return clampTitle(body.trim());
  // 全是 heading 的极端情况：回落第一个非空行
  const fallback = lines.find((l) => l.trim().length > 0) ?? content;
  return clampTitle(fallback.trim());
}

function clampTitle(s: string): string {
  return s.length > TITLE_MAX ? s.slice(0, TITLE_MAX) : s;
}

/** 正文全文 → 泡泡用（去首尾空白，超长截断补省略号）。 */
function clampBody(content: string): string {
  const s = content.trim();
  return s.length > BODY_MAX ? `${s.slice(0, BODY_MAX)}…` : s;
}

/** 读 store 建态；ids 与旧态一致时返回旧引用（避免无谓 republish）。 */
function buildState(
  sessionId: string,
  store: SessionRecalledStore,
  feedbackRev: number,
  prev?: RecallProjectionState,
): RecallProjectionState {
  const ids = store.list(sessionId);
  const superseded = [...store.supersededOf(sessionId)];
  const sameCounters = prev !== undefined && prev.rev === store.revision() && (prev.fb ?? 0) === feedbackRev;
  if (sameCounters && sameIds(prev.ids, ids) && sameIds(prev.superseded ?? [], superseded)) return prev;
  const next: RecallProjectionState = { rev: store.revision(), fb: feedbackRev, sessionId, ids, superseded };
  // rev 变了但本会话集合、取代集与反馈都没变（别的会话写了）→ 仍复用旧引用，防跨会话 thrash。
  if (prev !== undefined && prev.sessionId === sessionId && sameIds(prev.ids, ids)
    && sameIds(prev.superseded ?? [], superseded) && (prev.fb ?? 0) === feedbackRev) return prev;
  return next;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** view 引用稳定：同一 state 恒返回同一对象（registry 按 Object.is 判发布）。 */
const viewMemo = new WeakMap<RecallProjectionState, RecallView>();

function makeView(state: RecallProjectionState, l1: RecallL1Face | undefined, feedback?: RecallFeedbackFace): RecallView {
  const memoized = viewMemo.get(state);
  if (memoized !== undefined) return memoized;
  const recentFirst = [...state.ids].reverse();
  const picked = recentFirst.slice(0, RECALL_VIEW_CAP);
  const byId = new Map((l1?.getByIds(picked) ?? []).map((r) => [r.id, r] as const));
  const superseded = new Set(state.superseded ?? []);
  const items: RecallItemView[] = [];
  for (const id of picked) {
    const r = byId.get(id);
    if (r === undefined) continue; // 记录已退场/被删：诚实跳过，不编造条目
    const scenario = Array.isArray(r.metadata?.dsh_usage_scenario)
      ? (r.metadata?.dsh_usage_scenario as string[])
      : undefined;
    const rating = feedback?.lastOf(id);
    // 时效标注(task_3.5)：只对"过时两档"写键——current/historical 不必让人看见时效噪声；
    // 旧帧无此键，读侧缺席即活跃。判定现算（stateOfRecord），不吃落库快照；
    // 未退场行才会真判过时两档（退场行由 retired 键表达，validity 不再叠加）。
    const vState = isRetired(r) ? undefined : stateOfRecord(r, Date.now());
    const showValidity = vState === 'expired' || vState === 'expired_suspect';
    items.push({
      id: r.id,
      type: r.type,
      title: r.name || firstLine(r.content),
      priority: r.priority,
      body: clampBody(r.content),
      ...(scenario !== undefined && scenario.length > 0 ? { scenario } : {}),
      ...(typeof rating === 'number' ? { rating } : {}),
      // 退场记录仍留在列表里（文本曾是上下文的一部分，且判过时是人的裁决凭证），只是该打上删除线。
      ...(isRetired(r) ? { retired: true as const } : {}),
      // 已被摘要取代：正文已不在上下文里。与 retired 正交，两者可同时在。
      ...(superseded.has(id) ? { superseded: true as const } : {}),
      ...(showValidity ? { validity: vState, validUntil: r.validTo === undefined ? '' : new Date(r.validTo).toISOString() } : {}),
    });
  }
  const next: RecallView = { rev: state.rev, sessionId: state.sessionId, count: state.ids.length, items };
  viewMemo.set(state, next);
  return next;
}

interface ProjectionRegistryLike {
  register(definition: {
    key: string;
    stateSchema: { parse(value: unknown): unknown };
    init(header: unknown, inheritedEventCount?: number): RecallProjectionState;
    apply(state: RecallProjectionState, event: { type: string; data: unknown }): RecallProjectionState;
    wire: { viewSchema: { parse(value: unknown): unknown }; view(state: RecallProjectionState): RecallView };
    stateVersion: number;
  }): () => void;
}

/** 从宿主 header 取会话 id；形状不符 → 空串（读不到任何桶，view 自然为空，不抛）。 */
function sessionIdOf(header: unknown): string {
  if (typeof header !== 'object' || header === null) return '';
  const id = (header as { id?: unknown }).id;
  return typeof id === 'string' ? id : '';
}

/**
 * 注册 memoryRecall 投影。
 *
 * 缺席降级同 slots 投影：`ctx.inject` 在服务未提供时不回调；形状不符静默不注册。
 * apply 是 O(1) 判脏（store.revision() 与反馈序号比对），任意已提交事件都会带进来看一眼。
 * @param feedback - 相关度反馈只读面；缺席时 view 不带 rating（旧行为）。
 */
export function registerRecallProjection(
  ctx: Context,
  store: SessionRecalledStore,
  l1?: RecallL1Face,
  feedback?: RecallFeedbackFace,
): void {
  ctx.inject(['sessionProjections'], (injected) => {
    const registry = (injected as unknown as { sessionProjections?: ProjectionRegistryLike }).sessionProjections;
    if (registry === undefined || typeof registry.register !== 'function') return;
    const fbRev = () => feedback?.revision() ?? 0;
    // 双代平面（同 slots 投影）：0.1.0-rc.8 的 registry 走平面 schema/view，0.1.1+ 走 wire。
    const definition = {
      key: MEMORY_RECALL_KEY,
      stateSchema,
      init: (header: unknown) => buildState(sessionIdOf(header), store, fbRev()),
      apply: (state: RecallProjectionState) => buildState(state.sessionId, store, fbRev(), state),
      wire: { viewSchema, view: (state: RecallProjectionState) => makeView(state, l1, feedback) },
      schema: viewSchema,
      view: (state: RecallProjectionState) => makeView(state, l1, feedback),
      stateVersion: 0,
    } as unknown as Parameters<ProjectionRegistryLike['register']>[0];
    registry.register(definition);
  });
}
