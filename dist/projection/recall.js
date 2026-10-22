import { isRetired } from '../store/supersede.js';
import { stateOfRecord } from '../store/validity.js';
export const MEMORY_RECALL_KEY = 'memoryRecall';
/** view 最多透出条数（最近在上；超出部分只计入 count，防 wire 体量失控）。 */
export const RECALL_VIEW_CAP = 20;
/** 单条标题（正文首行）最大长度。 */
const TITLE_MAX = 160;
/** 单条全文最大长度（泡泡里显示的正文；超出截断并补省略号，防 wire 体量失控）。 */
const BODY_MAX = 700;
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
function requireString(value, what, field) {
    if (typeof value !== 'string')
        invalid(what, `${field} 必须是字符串`);
}
/** state 校验（registry 用它挡掉损坏/过期的 checkpoint 行）。 */
export const stateSchema = {
    parse: (value) => {
        const what = 'memoryRecall.state';
        const root = requireRecord(value, what);
        requireCounter(root.rev, what, 'rev');
        requireString(root.sessionId, what, 'sessionId');
        if (!Array.isArray(root.ids))
            invalid(what, 'ids 必须是字符串数组');
        root.ids.forEach((id, i) => requireString(id, `${what}.ids[${i}]`, 'id'));
        if (root.superseded !== undefined) {
            if (!Array.isArray(root.superseded))
                invalid(what, 'superseded 必须是字符串数组');
            root.superseded.forEach((id, i) => requireString(id, `${what}.superseded[${i}]`, 'id'));
        }
        return value;
    },
};
/** view 校验（出网前调用；未知键容忍，同 slots 投影的语义边界）。 */
const VALIDITY_STATES_VIEW = ['current', 'historical', 'expired', 'expired_suspect', 'superseded', 'retired'];
export const viewSchema = {
    parse: (value) => {
        const what = 'memoryRecall.view';
        const root = requireRecord(value, what);
        requireCounter(root.rev, what, 'rev');
        requireString(root.sessionId, what, 'sessionId');
        requireCounter(root.count, what, 'count');
        if (!Array.isArray(root.items))
            invalid(what, 'items 必须是数组');
        root.items.forEach((raw, i) => {
            const at = `${what}.items[${i}]`;
            const item = requireRecord(raw, at);
            requireString(item.id, at, 'id');
            requireString(item.type, at, 'type');
            requireString(item.title, at, 'title');
            requireCounter(item.priority, at, 'priority');
            if (item.scenario !== undefined) {
                if (!Array.isArray(item.scenario))
                    invalid(at, 'scenario 必须是字符串数组');
                item.scenario.forEach((s, j) => requireString(s, `${at}.scenario[${j}]`, 'scenario'));
            }
            if (item.rating !== undefined && typeof item.rating !== 'number')
                invalid(at, 'rating 必须是数字');
            // 附加字段：旧帧没有 → 容忍；有 → 必须成形状。retired 只认 true，false 视为脏帧。
            if (item.body !== undefined)
                requireString(item.body, at, 'body');
            if (item.retired !== undefined && item.retired !== true)
                invalid(at, 'retired 只能是 true 或缺席');
            if (item.superseded !== undefined && item.superseded !== true)
                invalid(at, 'superseded 只能是 true 或缺席');
            // 时效标注(task_3.5)：缺席=旧帧容忍；有则必须六态枚举内，validUntil 必字符串。
            if (item.validity !== undefined && VALIDITY_STATES_VIEW.indexOf(item.validity) < 0) {
                invalid(at, 'validity 必须是六态之一或缺席');
            }
            if (item.validUntil !== undefined)
                requireString(item.validUntil, at, 'validUntil');
        });
        return value;
    },
};
/**
 * 正文首行 → 标题（投影内不引 client 的 format 工具，保持服务端自足）。
 * 按 markdown 语义解析：
 * - H1（`# xxx`）是文档标题，直接作为记忆名称；
 * - H2+（`## xxx`）是正文分节标记，跳过它取第一个实质文本行。
 * 全部行都是 heading 时回落到第一个非空行。
 */
function firstLine(content) {
    const lines = content.split('\n');
    // 优先取 H1（文档级标题）
    const h1 = lines.find((l) => /^#\s/.test(l.trim()));
    if (h1)
        return clampTitle(h1.trim());
    // 无 H1 时跳过 H2+ 分节 heading，取第一个实质文本行
    const body = lines.find((l) => {
        const t = l.trim();
        return t.length > 0 && !/^#{2,6}\s/.test(t);
    });
    if (body)
        return clampTitle(body.trim());
    // 全是 heading 的极端情况：回落第一个非空行
    const fallback = lines.find((l) => l.trim().length > 0) ?? content;
    return clampTitle(fallback.trim());
}
function clampTitle(s) {
    return s.length > TITLE_MAX ? s.slice(0, TITLE_MAX) : s;
}
/** 正文全文 → 泡泡用（去首尾空白，超长截断补省略号）。 */
function clampBody(content) {
    const s = content.trim();
    return s.length > BODY_MAX ? `${s.slice(0, BODY_MAX)}…` : s;
}
/** 读 store 建态；ids 与旧态一致时返回旧引用（避免无谓 republish）。 */
function buildState(sessionId, store, feedbackRev, prev) {
    const ids = store.list(sessionId);
    const superseded = [...store.supersededOf(sessionId)];
    const sameCounters = prev !== undefined && prev.rev === store.revision() && (prev.fb ?? 0) === feedbackRev;
    if (sameCounters && sameIds(prev.ids, ids) && sameIds(prev.superseded ?? [], superseded))
        return prev;
    const next = { rev: store.revision(), fb: feedbackRev, sessionId, ids, superseded };
    // rev 变了但本会话集合、取代集与反馈都没变（别的会话写了）→ 仍复用旧引用，防跨会话 thrash。
    if (prev !== undefined && prev.sessionId === sessionId && sameIds(prev.ids, ids)
        && sameIds(prev.superseded ?? [], superseded) && (prev.fb ?? 0) === feedbackRev)
        return prev;
    return next;
}
function sameIds(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++)
        if (a[i] !== b[i])
            return false;
    return true;
}
/** view 引用稳定：同一 state 恒返回同一对象（registry 按 Object.is 判发布）。 */
const viewMemo = new WeakMap();
function makeView(state, l1, feedback) {
    const memoized = viewMemo.get(state);
    if (memoized !== undefined)
        return memoized;
    const recentFirst = [...state.ids].reverse();
    const picked = recentFirst.slice(0, RECALL_VIEW_CAP);
    const byId = new Map((l1?.getByIds(picked) ?? []).map((r) => [r.id, r]));
    const superseded = new Set(state.superseded ?? []);
    const items = [];
    for (const id of picked) {
        const r = byId.get(id);
        if (r === undefined)
            continue; // 记录已退场/被删：诚实跳过，不编造条目
        const scenario = Array.isArray(r.metadata?.dsh_usage_scenario)
            ? r.metadata?.dsh_usage_scenario
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
            ...(isRetired(r) ? { retired: true } : {}),
            // 已被摘要取代：正文已不在上下文里。与 retired 正交，两者可同时在。
            ...(superseded.has(id) ? { superseded: true } : {}),
            ...(showValidity ? { validity: vState, validUntil: r.validTo === undefined ? '' : new Date(r.validTo).toISOString() } : {}),
        });
    }
    const next = { rev: state.rev, sessionId: state.sessionId, count: state.ids.length, items };
    viewMemo.set(state, next);
    return next;
}
/** 从宿主 header 取会话 id；形状不符 → 空串（读不到任何桶，view 自然为空，不抛）。 */
function sessionIdOf(header) {
    if (typeof header !== 'object' || header === null)
        return '';
    const id = header.id;
    return typeof id === 'string' ? id : '';
}
/**
 * 注册 memoryRecall 投影。
 *
 * 缺席降级同 slots 投影：`ctx.inject` 在服务未提供时不回调；形状不符静默不注册。
 * apply 是 O(1) 判脏（store.revision() 与反馈序号比对），任意已提交事件都会带进来看一眼。
 * @param feedback - 相关度反馈只读面；缺席时 view 不带 rating（旧行为）。
 */
export function registerRecallProjection(ctx, store, l1, feedback) {
    ctx.inject(['sessionProjections'], (injected) => {
        const registry = injected.sessionProjections;
        if (registry === undefined || typeof registry.register !== 'function')
            return;
        const fbRev = () => feedback?.revision() ?? 0;
        // 双代平面（同 slots 投影）：0.1.0-rc.8 的 registry 走平面 schema/view，0.1.1+ 走 wire。
        const definition = {
            key: MEMORY_RECALL_KEY,
            stateSchema,
            init: (header) => buildState(sessionIdOf(header), store, fbRev()),
            apply: (state) => buildState(state.sessionId, store, fbRev(), state),
            wire: { viewSchema, view: (state) => makeView(state, l1, feedback) },
            schema: viewSchema,
            view: (state) => makeView(state, l1, feedback),
            stateVersion: 0,
        };
        registry.register(definition);
    });
}
