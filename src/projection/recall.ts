/**
 * 会话「活召回集」服务端投影(memoryRecall)。
 *
 * 语义：本会话**已注入、且目前仍在上下文里**的记忆（= 模型此刻真正看到的几条）。
 * 上下文被压缩/清空时注入内容离开模型，集合随之清空——数据源是
 * `SessionRecalledStore`（sessionKey 键、写穿持久化），所以**旧会话重开也读得到**。
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

export const MEMORY_RECALL_KEY = 'memoryRecall';

/** view 最多透出条数（最近在上；超出部分只计入 count，防 wire 体量失控）。 */
export const RECALL_VIEW_CAP = 20;
/** 单条标题（正文首行）最大长度。 */
const TITLE_MAX = 160;

/** 一条召回记录在 wire view 上的呈现。 */
export interface RecallItemView {
  id: string;
  type: string;
  /** 正文首行（截断至 TITLE_MAX）；全文由消费方按需走面板读。 */
  title: string;
  priority: number;
  /** 使用场景（metadata.dsh_usage_scenario）；无则缺席（附加字段，旧帧没有也整条通过）。 */
  scenario?: string[];
}

/** 持久态：本会话的活召回 id 集 + 判脏序号。 */
export interface RecallProjectionState {
  rev: number;
  sessionId: string;
  /** 注入序（旧→新），由 store 保证。 */
  ids: string[];
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
    return value as RecallProjectionState;
  },
};

/** view 校验（出网前调用；未知键容忍，同 slots 投影的语义边界）。 */
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
    });
    return value as RecallView;
  },
};

/** 投影需要的 L1 只读面（结构化声明，避免跨模块类型耦合）。 */
export interface RecallL1Face {
  getByIds(ids: string[]): Array<{ id: string; type: string; content: string; priority: number; metadata?: Record<string, unknown> }>;
}

/** 正文首行 → 标题（投影内不引 client 的 format 工具，保持服务端自足）。 */
function firstLine(content: string): string {
  const line = content.split('\n').find((l) => l.trim().length > 0) ?? content;
  const trimmed = line.trim();
  return trimmed.length > TITLE_MAX ? trimmed.slice(0, TITLE_MAX) : trimmed;
}

/** 读 store 建态；ids 与旧态一致时返回旧引用（避免无谓 republish）。 */
function buildState(
  sessionId: string,
  store: SessionRecalledStore,
  prev?: RecallProjectionState,
): RecallProjectionState {
  const ids = store.list(sessionId);
  if (prev !== undefined && prev.rev === store.revision() && sameIds(prev.ids, ids)) return prev;
  const next: RecallProjectionState = { rev: store.revision(), sessionId, ids };
  // rev 变了但本会话集合没变（别的会话写了）→ 仍复用旧引用，防跨会话 thrash。
  if (prev !== undefined && prev.sessionId === sessionId && sameIds(prev.ids, ids)) return prev;
  return next;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** view 引用稳定：同一 state 恒返回同一对象（registry 按 Object.is 判发布）。 */
const viewMemo = new WeakMap<RecallProjectionState, RecallView>();

function makeView(state: RecallProjectionState, l1: RecallL1Face | undefined): RecallView {
  const memoized = viewMemo.get(state);
  if (memoized !== undefined) return memoized;
  const recentFirst = [...state.ids].reverse();
  const picked = recentFirst.slice(0, RECALL_VIEW_CAP);
  const byId = new Map((l1?.getByIds(picked) ?? []).map((r) => [r.id, r] as const));
  const items: RecallItemView[] = [];
  for (const id of picked) {
    const r = byId.get(id);
    if (r === undefined) continue; // 记录已退场/被删：诚实跳过，不编造条目
    const scenario = Array.isArray(r.metadata?.dsh_usage_scenario)
      ? (r.metadata?.dsh_usage_scenario as string[])
      : undefined;
    items.push({
      id: r.id,
      type: r.type,
      title: firstLine(r.content),
      priority: r.priority,
      ...(scenario !== undefined && scenario.length > 0 ? { scenario } : {}),
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
 * apply 是 O(1) 判脏（store.revision() 比对），任意已提交事件都会带进来看一眼。
 */
export function registerRecallProjection(
  ctx: Context,
  store: SessionRecalledStore,
  l1?: RecallL1Face,
): void {
  ctx.inject(['sessionProjections'], (injected) => {
    const registry = (injected as unknown as { sessionProjections?: ProjectionRegistryLike }).sessionProjections;
    if (registry === undefined || typeof registry.register !== 'function') return;
    // 双代平面（同 slots 投影）：0.1.0-rc.8 的 registry 走平面 schema/view，0.1.1+ 走 wire。
    const definition = {
      key: MEMORY_RECALL_KEY,
      stateSchema,
      init: (header: unknown) => buildState(sessionIdOf(header), store),
      apply: (state: RecallProjectionState) => buildState(state.sessionId, store, state),
      wire: { viewSchema, view: (state: RecallProjectionState) => makeView(state, l1) },
      schema: viewSchema,
      view: (state: RecallProjectionState) => makeView(state, l1),
      stateVersion: 0,
    } as unknown as Parameters<ProjectionRegistryLike['register']>[0];
    registry.register(definition);
  });
}
