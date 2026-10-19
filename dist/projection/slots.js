import { SLOT_KINDS, SLOT_STATUSES } from '../store/slots.js';
import { relPathFor } from '../store/memory-md.js';
export const MEMORY_SLOTS_KEY = 'memorySlots';
function invalid(what, detail) {
    throw new Error(`${what}: ${detail}`);
}
function requireRecord(value, what) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        invalid(what, '期望普通对象');
    }
    return value;
}
function requireCounter(value, what, field) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        invalid(what, `${field} 必须是非负整数`);
    }
}
function requireMember(value, allowed, what, field) {
    if (typeof value !== 'string' || !allowed.includes(value)) {
        invalid(what, `${field} 必须是 ${allowed.join('/')} 之一`);
    }
}
/** 校验槽位投影载荷(state 与 wire view 同形)。 */
function parseSlotsPayload(value, what) {
    const root = requireRecord(value, what);
    requireCounter(root.rev, what, 'rev');
    requireCounter(root.count, what, 'count');
    requireCounter(root.openCount, what, 'openCount');
    if (!Array.isArray(root.slots))
        invalid(what, 'slots 必须是数组');
    root.slots.forEach((raw, index) => {
        const at = `${what}.slots[${index}]`;
        const item = requireRecord(raw, at);
        if (typeof item.id !== 'string' || item.id.length === 0)
            invalid(at, 'id 必须是非空字符串');
        if (typeof item.title !== 'string')
            invalid(at, 'title 必须是字符串');
        requireMember(item.kind, SLOT_KINDS, at, 'kind');
        requireMember(item.status, SLOT_STATUSES, at, 'status');
        const priority = item.priority;
        if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < 0 || priority > 100) {
            invalid(at, 'priority 必须是 0-100 的整数');
        }
        // refs / refViews:存在才校验(附加字段,旧 checkpoint 行没有也必须整条通过)
        if (item.refs !== undefined) {
            if (!Array.isArray(item.refs))
                invalid(at, 'refs 必须是字符串数组');
            item.refs.forEach((r, i) => {
                if (typeof r !== 'string')
                    invalid(at + '.refs[' + i + ']', '必须是字符串');
            });
        }
        if (item.refViews !== undefined) {
            if (!Array.isArray(item.refViews))
                invalid(at, 'refViews 必须是数组');
            item.refViews.forEach((v, i) => {
                const at2 = at + '.refViews[' + i + ']';
                const view = requireRecord(v, at2);
                if (typeof view.ref !== 'string' || typeof view.title !== 'string') {
                    invalid(at2, 'ref/title 必须是字符串');
                }
            });
        }
    });
    return value;
}
/** 持久态校验:registry 用它挡掉损坏/过期的 checkpoint 行(row 不合法即整条丢弃)。 */
export const stateSchema = {
    parse: (value) => parseSlotsPayload(value, 'memorySlots.state'),
};
/** wire view 校验:registry 在 view 出网前调用(也覆盖 live drive 的发布路径)。 */
export const viewSchema = {
    parse: (value) => parseSlotsPayload(value, 'memorySlots.view'),
};
/** L1 record_id 的引用形态(newId('mem') 生成)。 */
const RECORD_REF_PREFIX = 'mem_';
/** refView 名称简述的截断上限(展示用,全文走 memory_receipts / memory_read_scene)。 */
const REF_TITLE_MAX = 80;
/**
 * 把槽位 refs 里的 L1 record_id 解析成名称简述([type] content 首行截断)。
 * 只解析 record_id 类引用;路径/URL 保持字面。缺失/已退场记录不产生条目。
 */
function resolveRefViews(refs, l1) {
    const recordRefs = refs.filter((r) => r.startsWith(RECORD_REF_PREFIX));
    if (recordRefs.length === 0 || l1 === undefined)
        return undefined;
    try {
        return resolveRefViewsUnsafe(recordRefs, l1);
    }
    catch {
        // L1 查询失败(sqlite 忙/后端降级/记录态异常)绝不能让投影 apply 抛错——
        // registry 的 drive 无异常保护,一抛整条会话事件驱动(乃至宿主)跟着倒。
        // 降级:本次帧不带 refViews,前端回落显示原始 refs。
        return undefined;
    }
}
function resolveRefViewsUnsafe(recordRefs, l1) {
    const byId = new Map(l1.getByIds([...recordRefs]).map((r) => [r.id, r]));
    const views = [];
    for (const ref of recordRefs) {
        const record = byId.get(ref);
        if (record === undefined)
            continue;
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
function buildState(store, l1) {
    const snap = store.projectionSnapshot();
    const slots = snap.slots.map((slot) => {
        if (slot.refs === undefined)
            return slot;
        const refViews = resolveRefViews(slot.refs, l1);
        return refViews === undefined ? { ...slot } : { ...slot, refViews };
    });
    return { rev: store.revision(), count: snap.count, openCount: snap.openCount, slots };
}
/**
 * view 引用稳定:同一 state 连续两次 view() 满足 Object.is(注册表据此判脏,
 * 否则每帧 republish)。state 是不可变引用,WeakMap 按 state 复用到同一 view。
 */
const viewMemo = new WeakMap();
function view(state) {
    const memoized = viewMemo.get(state);
    if (memoized !== undefined)
        return memoized;
    const next = {
        rev: state.rev,
        count: state.count,
        openCount: state.openCount,
        slots: state.slots,
    };
    viewMemo.set(state, next);
    return next;
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
function applySlotsEvent(state, event, store, l1) {
    if (store.revision() === state.rev)
        return state;
    return buildState(store, l1);
}
export function registerSlotsProjection(ctx, store, l1) {
    ctx.inject(['sessionProjections'], (injected) => {
        const registry = injected
            .sessionProjections;
        if (registry === undefined || typeof registry.register !== 'function')
            return;
        // 双代平面（TL beta.29 同款判别式）：0.1.0-rc.8 的 registry 是唯一的平面契约
        // （def.schema.parse(def.view(state))），0.1.1+ 消费 wire:{viewSchema,view}。
        // wire 形状镜像成平面键挂上，两代 registry 各取所需；一个缺 schema 的注册
        // 单元会毒化旧 registry 的全部冷会话历史加载。
        const definition = {
            key: MEMORY_SLOTS_KEY,
            stateSchema,
            init: () => buildState(store, l1),
            apply: (state, event) => applySlotsEvent(state, event, store, l1),
            wire: { viewSchema, view },
            schema: viewSchema,
            view,
            stateVersion: 0,
        };
        registry.register(definition);
    });
}
