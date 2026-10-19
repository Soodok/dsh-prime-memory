/**
 * 激活槽位服务端投影(memorySlots)。
 *
 * 展示契约：本 key 由 **dsh-brief-sidebar** 消费（「记忆槽位分区」）。宿主契约说明
 * 不注册时 key 会从快照消失、客户端读作 capability absence（降级优雅，不致加载失败），
 * 所以摘注册不会弄坏会话，但会让旧版消费方默默丢分区——要隐藏那张卡请走它的开关。
 * 另：会话召回的展示走 `memoryRecall` 投影与 client 浮层（SessionRecalledArea），不得灌进本投影。
 *
 * 只注册服务端单元,绝不做 client——前端展示由未来 brief-sidebar 消费(下一轮)。
 * 注册经 ctx.inject(['sessionProjections'], …):服务缺席时静默不注册、不抛错
 * (注册表里没有 key 时客户端读 faceOf(key) 恒为 undefined,侧边栏栏位自然隐藏)。
 *
 * apply 同步、闭包 SlotStore:tool/result(settled)时同步读 revision() 判脏,rev 未变
 * 返回同引用(避免每帧 republish),rev 变才重建快照。view 用 WeakMap 保引用稳定。
 */
import type { Context } from '@deepseek-ai/cordis';
import { SLOT_KINDS, SLOT_STATUSES } from '../store/slots.js';
import type { SlotStore } from '../store/slots.js';
import { relPathFor } from '../store/memory-md.js';

export const MEMORY_SLOTS_KEY = 'memorySlots';

export interface SlotsViewSlot {
  id: string;
  title: string;
  kind: string;
  status: string;
  priority: number;
  /** 原始引用(L1 record_id / 文件路径 / URL);存在才校验,旧 checkpoint 无此字段照常通过。 */
  refs?: string[];
  /**
   * L1 record_id 类引用的解析视图(v0.20.2):ref → 名称简述(content 首行截断)。
   * 前端展示用;解析发生在投影帧构建时(帧随 slots rev 刷新,L1 记录后续编辑
   * 不回灌旧帧——引用集在写入时即冻结,可接受)。缺失/已退场记录不产生条目,
   * 前端回落显示原始 ref。
   */
  refViews?: SlotRefView[];
}

/** 一条 record_id 引用的展示解析。 */
export interface SlotRefView {
  ref: string;
  title: string;
  /**
   * 记忆文件相对路径（`<type>/<name>.memory.md`）。
   * 拼接绝对地址：
   * - 有 workspaceId → `<workspaceId>/.agents/memory/<filePath>`
   * - 无 workspaceId → `<memoriesRoot>/<filePath>`（由消费方自行解析根目录）
   */
  filePath?: string;
  /** 记忆归属的工作区绝对路径；空串/undefined = global（无 workspace）。 */
  workspaceId?: string;
}

export interface SlotsProjectionState {
  rev: number;
  count: number;
  openCount: number;
  slots: SlotsViewSlot[];
}

export interface SlotsView {
  rev: number;
  count: number;
  openCount: number;
  slots: SlotsViewSlot[];
}

/**
 * 零依赖 schema:`sessionProjections` 契约在类型层写的是 zod 的 `ZodType`,但运行时
 * **只调用 `parse(value)`** 一个方法(实测 registry `viewCheckpoint`/`restore`/`drive`/
 * `viewCell` 四处)。本插件不新增依赖(不引 zod —— package.json/锁文件不在本轮改动白名单,
 * 且声明式依赖缺失会在严格 node_modules 布局下解析失败),改为自实现等价校验器。
 *
 * 语义边界(有意为之,非"占位"):
 * - 合法 → **原样返回同一引用**(不 clone、不 strip):registry 按 `Object.is` 比较 view,
 *   clone 会破坏引用稳定契约;
 * - 非法 → **抛错**:`parse` 是 registry 的校验闸(状态回放前 / wire 出网前),
 *   静默透传会让损坏的持久态与越界 view 一路带进客户端;
 * - **未知键容忍**(不拒绝):`drive` 期 `viewSchema.parse` 无 try/catch,若新增字段即抛错
 *   会打断整条会话事件驱动;view 的字段集由构造函数固定 + 单测断言(F9)保证。
 */
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

function requireMember(value: unknown, allowed: readonly string[], what: string, field: string): void {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    invalid(what, `${field} 必须是 ${allowed.join('/')} 之一`);
  }
}

/** 校验槽位投影载荷(state 与 wire view 同形)。 */
function parseSlotsPayload<T>(value: unknown, what: string): T {
  const root = requireRecord(value, what);
  requireCounter(root.rev, what, 'rev');
  requireCounter(root.count, what, 'count');
  requireCounter(root.openCount, what, 'openCount');
  if (!Array.isArray(root.slots)) invalid(what, 'slots 必须是数组');
  (root.slots as unknown[]).forEach((raw, index) => {
    const at = `${what}.slots[${index}]`;
    const item = requireRecord(raw, at);
    if (typeof item.id !== 'string' || item.id.length === 0) invalid(at, 'id 必须是非空字符串');
    if (typeof item.title !== 'string') invalid(at, 'title 必须是字符串');
    requireMember(item.kind, SLOT_KINDS, at, 'kind');
    requireMember(item.status, SLOT_STATUSES, at, 'status');
    const priority = item.priority;
    if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < 0 || priority > 100) {
      invalid(at, 'priority 必须是 0-100 的整数');
    }
    // refs / refViews:存在才校验(附加字段,旧 checkpoint 行没有也必须整条通过)
    if (item.refs !== undefined) {
      if (!Array.isArray(item.refs)) invalid(at, 'refs 必须是字符串数组');
      item.refs.forEach((r, i) => {
        if (typeof r !== 'string') invalid(at + '.refs[' + i + ']', '必须是字符串');
      });
    }
    if (item.refViews !== undefined) {
      if (!Array.isArray(item.refViews)) invalid(at, 'refViews 必须是数组');
      item.refViews.forEach((v, i) => {
        const at2 = at + '.refViews[' + i + ']';
        const view = requireRecord(v, at2);
        if (typeof view.ref !== 'string' || typeof view.title !== 'string') {
          invalid(at2, 'ref/title 必须是字符串');
        }
      });
    }
  });
  return value as T;
}

/** 持久态校验:registry 用它挡掉损坏/过期的 checkpoint 行(row 不合法即整条丢弃)。 */
export const stateSchema: SchemaLike<SlotsProjectionState> = {
  parse: (value) => parseSlotsPayload<SlotsProjectionState>(value, 'memorySlots.state'),
};

/** wire view 校验:registry 在 view 出网前调用(也覆盖 live drive 的发布路径)。 */
export const viewSchema: SchemaLike<SlotsView> = {
  parse: (value) => parseSlotsPayload<SlotsView>(value, 'memorySlots.view'),
};

/** 投影需要的 L1 只读面(结构化声明,避免跨模块类型耦合)。 */
export interface L1LookupFace {
  getByIds(ids: string[]): Array<{ id: string; content: string; type: string; name?: string; workspaceId?: string }>;
}

/** L1 record_id 的引用形态(newId('mem') 生成)。 */
const RECORD_REF_PREFIX = 'mem_';
/** refView 名称简述的截断上限(展示用,全文走 memory_receipts / memory_read_scene)。 */
const REF_TITLE_MAX = 80;

/**
 * 把槽位 refs 里的 L1 record_id 解析成名称简述([type] content 首行截断)。
 * 只解析 record_id 类引用;路径/URL 保持字面。缺失/已退场记录不产生条目。
 */
function resolveRefViews(refs: readonly string[], l1: L1LookupFace | undefined): SlotRefView[] | undefined {
  const recordRefs = refs.filter((r) => r.startsWith(RECORD_REF_PREFIX));
  if (recordRefs.length === 0 || l1 === undefined) return undefined;
  try {
    return resolveRefViewsUnsafe(recordRefs, l1);
  } catch {
    // L1 查询失败(sqlite 忙/后端降级/记录态异常)绝不能让投影 apply 抛错——
    // registry 的 drive 无异常保护,一抛整条会话事件驱动(乃至宿主)跟着倒。
    // 降级:本次帧不带 refViews,前端回落显示原始 refs。
    return undefined;
  }
}

function resolveRefViewsUnsafe(recordRefs: readonly string[], l1: L1LookupFace): SlotRefView[] | undefined {
  const byId = new Map(l1.getByIds([...recordRefs]).map((r) => [r.id, r]));
  const views: SlotRefView[] = [];
  for (const ref of recordRefs) {
    const record = byId.get(ref);
    if (record === undefined) continue;
    // 优先用 name 字段（名称蒸馏产出的短标题），无 name 时回落 content 首行截断。
    const raw = record.name || (record.content.split('\n', 1)[0] ?? '');
    const summary = raw.length > REF_TITLE_MAX ? raw.slice(0, REF_TITLE_MAX) + '…' : raw;
    // 投射相对路径走单一事实源 `relPathFor`，与写盘/records-meta 端点同算法。
    const filePath = relPathFor(record);
    const ws = (record.workspaceId ?? '').trim();
    views.push({
      ref,
      title: '[' + record.type + '] ' + summary,
      filePath,
      ...(ws.length > 0 ? { workspaceId: ws } : {}),
    });
  }
  return views.length > 0 ? views : undefined;
}

function buildState(store: SlotStore, l1: L1LookupFace | undefined): SlotsProjectionState {
  const snap = store.projectionSnapshot();
  const slots = snap.slots.map((slot) => {
    if (slot.refs === undefined) return slot;
    const refViews = resolveRefViews(slot.refs, l1);
    return refViews === undefined ? { ...slot } : { ...slot, refViews };
  });
  return { rev: store.revision(), count: snap.count, openCount: snap.openCount, slots };
}

/**
 * view 引用稳定:同一 state 连续两次 view() 满足 Object.is(注册表据此判脏,
 * 否则每帧 republish)。state 是不可变引用,WeakMap 按 state 复用到同一 view。
 */
const viewMemo = new WeakMap<SlotsProjectionState, SlotsView>();
function view(state: SlotsProjectionState): SlotsView {
  const memoized = viewMemo.get(state);
  if (memoized !== undefined) return memoized;
  const next: SlotsView = {
    rev: state.rev,
    count: state.count,
    openCount: state.openCount,
    slots: state.slots,
  };
  viewMemo.set(state, next);
  return next;
}

interface ProjectionRegistryLike {
  register(definition: {
    key: string;
    stateSchema: { parse(value: unknown): unknown };
    init(): SlotsProjectionState;
    apply(state: SlotsProjectionState, event: { type: string; data: unknown }): SlotsProjectionState;
    wire: { viewSchema: { parse(value: unknown): unknown }; view(state: SlotsProjectionState): SlotsView };
    stateVersion: number;
  }): () => void;
}

/**
 * apply(state, event):同步。
 * - **任意已提交事件都判脏**(v0.18.4 起):此前仅在 tool/result(settled、非 error)
 *   时检查,实际运行中暴露出脆弱性——写入后的投影帧依赖"该会话恰好再来一条
 *   tool/result"才刷新;跨会话场景(会话 A 写、会话 B 看)更是要等 B 自己的下一次
 *   工具调用。改为对所有事件做 O(1) revision 比较:rev 未变 → 同引用(满足 I1b,
 *   无 republish thrash);rev 变 → 立即重建。写入后的下一条任意事件(用户消息、
 *   turn 边界、其他工具结果)都会把新帧推给客户端。
 * - isError 守卫一并移除:rev 只在 store 真实变更后递增(persist 内联 RMW),
 *   事件成败与否不影响"store 是否变了"这一事实;错误事件后重建读到的仍是
 *   当前真实快照,不会引入错误数据。
 */
function applySlotsEvent(
  state: SlotsProjectionState,
  event: { type: string; data: unknown },
  store: SlotStore,
  l1: L1LookupFace | undefined,
): SlotsProjectionState {
  if (store.revision() === state.rev) return state;
  return buildState(store, l1);
}

export function registerSlotsProjection(ctx: Context, store: SlotStore, l1?: L1LookupFace): void {
  ctx.inject(['sessionProjections'], (injected) => {
    const registry = (injected as unknown as { sessionProjections?: ProjectionRegistryLike })
      .sessionProjections;
    if (registry === undefined || typeof registry.register !== 'function') return;
    // 双代平面（TL beta.29 同款判别式）：0.1.0-rc.8 的 registry 是唯一的平面契约
    // （def.schema.parse(def.view(state))），0.1.1+ 消费 wire:{viewSchema,view}。
    // wire 形状镜像成平面键挂上，两代 registry 各取所需；一个缺 schema 的注册
    // 单元会毒化旧 registry 的全部冷会话历史加载。
    const definition = {
      key: MEMORY_SLOTS_KEY,
      stateSchema,
      init: () => buildState(store, l1),
      apply: (state: SlotsProjectionState, event: { type: string; data: unknown }) => applySlotsEvent(state, event, store, l1),
      wire: { viewSchema, view },
      schema: viewSchema,
      view,
      stateVersion: 0,
    } as unknown as Parameters<ProjectionRegistryLike['register']>[0];
    registry.register(definition);
  });
}
