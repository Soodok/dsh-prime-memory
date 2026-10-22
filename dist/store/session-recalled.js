/**
 * 会话"活召回集"存储（G-live）：sessionKey → 本会话已注入、尚未被压缩覆盖的 L1 记录 id。
 *
 * 语义（对齐"当前会话召回后对 session 有影响的条目"，且**旧会话重开也有效**）：
 * - 每次召回**实际注入**（recall.ts 注入成功点）按 **sessionKey**（=agent.session?.id ?? agent.id，
 *   与 pill 的 sessionId、投影 header.id 同源）记入；
 * - 上下文压缩/清空（agent/created source=compact|clear）按 sessionKey 处理，**两者不同**：
 *   `clear`（用户主动清空会话）整表清；`compact`（摘要替换）**不删条目**，而是把**此刻在列表里
 *   的那批**标成「正文已被摘要取代」（`supersededIds`）——它们的正文确实离开了模型上下文，
 *   但**已判过时的条目是人对这条记忆的裁决凭证**，删了就没了（2026-10-13 用户口径）。
 *   所以压缩只改「这条还在不在上下文里」这一维，不动「本会话召回过什么」这条历史。
 *   重新被注入时取代标记应当撤销（正文又回到上下文了）。
 * - **写穿持久化到 `session-recalled.json`**（独立 sidecar，与 recall-dedupe 同款：串行原子写 +
 *   未知版本/损坏只读降级、失败绝不抛进召回热路径）→ 重启/旧会话重开时 `init()` 载回，卡不空。
 *
 * 供只读端点 `dsh-memory/session-recalled` 消费（client 浮层 SessionRecalledArea 展示）。
 * 不经 memorySlots 投影：那条路会把召回渲染成常驻槽位注册表，与召回的非常驻语义错位。
 */
import * as path from 'node:path';
import { errDetail } from '../util/filelog.js';
import { ensureDir, readJsonStrict, rmwJson } from '../util/io.js';
import { SESSION_RECALLED_FILE_VERSION } from './file-versions.js';
import { RECALL_DEDUPE_IDS_CAP, RECALL_DEDUPE_SESSION_CAP } from './recall-dedupe.js';
/** 共享空集（未出现过取代的会话重复取用，不必每次新建）。 */
const EMPTY_SET = new Set();
/** 共享空归因表（同 EMPTY_SET 口径）。 */
const EMPTY_LANES = new Map();
/**
 * 读 `Record<string, string>` 型字段的宽容解析（injectedBy/lanes 共用）：
 * 非对象/值非字符串一律丢弃。
 * 宁可让那条记录“无从判”（对账不动它/徽标不渲染），也不把脏值喂给下游判定——
 * 一个错的 message id 会把仍在本上下文里的正文误标成“已被摘要取代”。
 */
function toIdMap(raw) {
    const out = new Map();
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        return out;
    for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string' && v.length > 0)
            out.set(k, v);
    }
    return out;
}
/** 条目过期清理（90 天，与 recall-dedupe 同量级）。 */
const PRUNE_MS = 90 * 24 * 3600_000;
export class SessionRecalledStore {
    logger;
    file;
    entries = new Map();
    degraded;
    degradedLogged = false;
    lastPersisted;
    writeChain;
    /** 脏检序号：每次真实变更 +1，投影 apply 据此 O(1) 判断是否重建。 */
    rev = 0;
    constructor(dataDir, logger) {
        this.logger = logger;
        this.file = path.join(dataDir, 'session-recalled.json');
        this.writeChain = this.init();
    }
    revision() {
        return this.rev;
    }
    async init() {
        const r = await readJsonStrict(this.file, { expectedVersion: SESSION_RECALLED_FILE_VERSION });
        let data;
        if (r.ok) {
            data = r.value;
        }
        else if (r.reason === 'missing') {
            return;
        }
        else {
            const lenient = await readJsonStrict(this.file);
            if (!lenient.ok) {
                this.degraded = lenient.reason;
                this.logger?.warn(`[memory] 活召回集文件${lenient.reason === 'corrupt' ? '损坏' : '不可读'}(${this.file})：按空起步且不回写`);
                return;
            }
            data = lenient.value;
            this.degraded = `未知版本(${lenient.version ?? '无 version 字段'})`;
            this.logger?.warn(`[memory] 活召回集文件版本未知(${lenient.version ?? '无'})：按当前形状读取并只读降级(不回写)`);
        }
        this.lastPersisted = JSON.stringify(data);
        if (!data?.sessions || typeof data.sessions !== 'object')
            return;
        const now = Date.now();
        for (const [sid, entry] of Object.entries(data.sessions)) {
            if (!Array.isArray(entry?.recordIds))
                continue;
            if (now - (entry.updatedAt ?? 0) > PRUNE_MS)
                continue;
            this.entries.set(sid, {
                ids: new Set(entry.recordIds),
                // 旧文件没这个字段（不升版本号：升了会让老文件整体进只读降级），默认空集。
                protectedIds: new Set(Array.isArray(entry.protectedIds) ? entry.protectedIds : []),
                supersededIds: new Set(Array.isArray(entry.supersededIds) ? entry.supersededIds : []),
                injectedBy: toIdMap(entry.injectedBy),
                laneOf: toIdMap(entry.lanes),
                updatedAt: entry.updatedAt ?? now,
            });
        }
    }
    /** 记入本 sessionKey 本轮实际注入的记录 id（写穿；插入序淘汰最旧）。
     *  laneById 只带真正有归因的条目（hybrid 融合才挂 lanes；单路/旧路不传）。 */
    add(sessionKey, recordIds, injectionId, laneById) {
        if (!sessionKey || recordIds.length === 0)
            return;
        let entry = this.entries.get(sessionKey);
        if (!entry) {
            entry = { ids: new Set(), protectedIds: new Set(), supersededIds: new Set(), injectedBy: new Map(), laneOf: new Map(), updatedAt: 0 };
            this.entries.set(sessionKey, entry);
        }
        const stamp = typeof injectionId === 'string' && injectionId.length > 0 ? injectionId : undefined;
        for (const id of recordIds) {
            entry.ids.add(id);
            // 重新注入 = 正文又回到模型上下文，取代标记随之撤销（否则一条记忆只能被取代一次）。
            entry.supersededIds.delete(id);
            // 记下这次注入落在哪条消息上：没有它，对账就无从判“这条正文还在不在”。
            if (stamp !== undefined)
                entry.injectedBy.set(id, stamp);
            // 路归因：最后一次注入赢；本轮无归因时**不清旧值**（徽标宁可残留一轮
            // 也不要闪无——真实路集在下一次带归因注入时自然覆盖）。
            const laneArr = laneById?.get(id);
            if (laneArr !== undefined && laneArr.length > 0)
                entry.laneOf.set(id, laneArr.join('|'));
            // 淘汰只能淘汰**没被判过时的**：受保护条目数本身超顶时宁可超顶，也不能把人的裁决
            // 凭证挤掉（那等于“因为后面又召回了几条，所以之前那条的判定历史丢了”）。
            while (entry.ids.size > RECALL_DEDUPE_IDS_CAP) {
                const oldest = [...entry.ids].find((x) => !entry.protectedIds.has(x));
                if (oldest === undefined)
                    break;
                entry.ids.delete(oldest);
                entry.protectedIds.delete(oldest);
                entry.supersededIds.delete(oldest);
                entry.injectedBy.delete(oldest);
                entry.laneOf.delete(oldest);
            }
        }
        entry.updatedAt = Date.now();
        this.rev++;
        this.writeChain = this.writeChain.then(() => this.persist());
    }
    /**
     * 标为受保护（判过时/软退场）：条目留在列表里，且不受上限淘汰与压缩清理影响。
     * id 不在本会话列表里时忽略（不凭这个调用新建条目）。
     */
    protect(sessionKey, recordIds) {
        const entry = this.entries.get(sessionKey);
        if (!entry)
            return;
        let touched = false;
        for (const id of recordIds) {
            if (!entry.ids.has(id) || entry.protectedIds.has(id))
                continue;
            entry.protectedIds.add(id);
            touched = true;
        }
        if (!touched)
            return;
        entry.updatedAt = Date.now();
        this.rev++;
        this.writeChain = this.writeChain.then(() => this.persist());
    }
    list(sessionKey) {
        const entry = this.entries.get(sessionKey);
        return entry ? [...entry.ids] : [];
    }
    /**
     * 上下文事件：按原因区分。`'clear'`（用户主动清空）整表清；`'compact'`（摘要替换）**只打取代标记**。
     *
     * 旧实现两种都整表清，于是“压缩过一次”就把本会话召回历史（含已判过时的裁决凭证）抹平；
     * 改成“压缩什么都不做”又让列表谎报“这些正文还在上下文里”。现在压缩只动一维：
     * 把**此刻在列表里的**标为「已被摘要取代」（已在标记里的不再推序号）。
     * 压缩仍然重置**去重与占用账本**（那两者关心的是“能不能重新注入”，与这张展示表无关）。
     */
    reset(sessionKey, reason = 'clear') {
        const entry = this.entries.get(sessionKey);
        if (reason !== 'clear') {
            if (entry === undefined)
                return;
            let touched = false;
            for (const id of entry.ids) {
                // 正文已经离开上下文（它就是摘要替掉的那一批）。
                if (entry.supersededIds.has(id))
                    continue;
                entry.supersededIds.add(id);
                touched = true;
            }
            // 无变更不推序号：否则每次压缩都白写一遍盘、白推一次投影。
            if (!touched)
                return;
            entry.updatedAt = Date.now();
            this.rev++;
            this.writeChain = this.writeChain.then(() => this.persist());
            return;
        }
        if (entry === undefined)
            return;
        this.entries.delete(sessionKey);
        this.rev++;
        this.writeChain = this.writeChain.then(() => this.persist());
    }
    /**
     * 本会话「正文已被摘要取代」的 id 集（投影与端点用；只读共享。
     * 未出现过取代的会话返回共享空集，不每次新建）。
     */
    supersededOf(sessionKey) {
        return this.entries.get(sessionKey)?.supersededIds ?? EMPTY_SET;
    }
    /**
     * 本会话的路归因表（record id → 管道串；只读共享，投影/端点用）。
     * 不在表里 = 无从归因（单路检索/旧文件条目），展示层不渲染徽标。
     */
    lanesOf(sessionKey) {
        return this.entries.get(sessionKey)?.laneOf ?? EMPTY_LANES;
    }
    /**
     * 用会话日志的可见性事实**对账**取代标记（Phase 0B）。
     *
     * 判据来自宿主官方服务的 `surface.nodes`（模型可见节点集），而不是“有没有收到一条压缩事件”：
     * 事件会漏、换代形状还会漂移，而且漏一次就永久错、无法补算。本函数每轮从事实源重算，
     * 所以既能**标上**也能**撤销**（重新注入、或上一轮粗标记误伤的，都能自愈）。
     *
     * @param visible 当前仍在上下文里的注入消息 id 集
     * @param known   会话日志里出现过的本插件注入消息 id 集。**不在 known 里的 = 该注入从未落日志**
     *                （被宿主取消/覆盖），属“无从判”——不动它，绝不猜成“已被取代”。
     * @returns 是否真的改动了状态（无改动不推 rev、不写盘）
     */
    reconcileSuperseded(sessionKey, visible, known) {
        const entry = this.entries.get(sessionKey);
        if (entry === undefined || entry.injectedBy.size === 0)
            return false;
        let touched = false;
        for (const [id, messageId] of entry.injectedBy) {
            if (!entry.ids.has(id))
                continue;
            if (!known.has(messageId))
                continue;
            if (visible.has(messageId)) {
                if (entry.supersededIds.delete(id))
                    touched = true;
            }
            else if (!entry.supersededIds.has(id)) {
                entry.supersededIds.add(id);
                touched = true;
            }
        }
        if (!touched)
            return false;
        entry.updatedAt = Date.now();
        this.rev++;
        this.writeChain = this.writeChain.then(() => this.persist());
        return true;
    }
    /**
     * 注：曾有 `remove(sessionKey, recordIds)` 供「声明过时」单条摘除，已删。
     * 理由：用户判过时后条目得留在召回列表里显示删除线，所以**只有** `reset(…, 'clear')`
     * 能让条目离开这张列表（判过时的还受 `protectedIds` 保护，连淘汰都走不到它）。
     */
    size() {
        return this.entries.size;
    }
    /** 等待在途持久化写完成（测试/停机）。 */
    flush() {
        return this.writeChain;
    }
    async persist() {
        if (this.degraded !== undefined) {
            if (!this.degradedLogged) {
                this.degradedLogged = true;
                this.logger?.warn(`[memory] 活召回集处于只读降级(${this.degraded})，已停止回写`);
            }
            return;
        }
        try {
            await ensureDir(path.dirname(this.file));
            await rmwJson(this.file, async (cur) => {
                const diskRaw = cur.ok ? JSON.stringify(cur.value) : undefined;
                if (this.lastPersisted !== undefined && diskRaw !== undefined && diskRaw !== this.lastPersisted) {
                    throw new Error('活召回集文件已被其它进程更新，本次写入取消以避免覆盖');
                }
                const next = this.serialize();
                this.lastPersisted = JSON.stringify(next);
                return { next, result: undefined };
            }, { logger: this.logger, purpose: 'session-recalled-rmw' });
        }
        catch (err) {
            this.logger?.warn(`[memory] 活召回集持久化失败(降级内存态): ${errDetail(err)}`);
        }
    }
    serialize() {
        const now = Date.now();
        for (const [sid, e] of this.entries) {
            if (now - e.updatedAt > PRUNE_MS && e.updatedAt > 0)
                this.entries.delete(sid);
        }
        while (this.entries.size > RECALL_DEDUPE_SESSION_CAP) {
            let oldestKey;
            let oldestAt = Infinity;
            for (const [k, e] of this.entries) {
                if (e.updatedAt < oldestAt) {
                    oldestAt = e.updatedAt;
                    oldestKey = k;
                }
            }
            if (oldestKey === undefined)
                break;
            this.entries.delete(oldestKey);
        }
        const sessions = {};
        for (const [sid, e] of this.entries) {
            if (e.ids.size === 0)
                continue;
            // 不落这个字段 = 保护只活在内存里，重启后判过时的条目又变回可被淘汰的普通条目。
            // 空集不写键：让没保护条目的会话与改动前的文件形状逐字一致（零漂移）。
            // 两个可选键同口径；都为空时形状仍是 {recordIds, updatedAt}。
            sessions[sid] = {
                recordIds: [...e.ids],
                ...(e.protectedIds.size > 0 ? { protectedIds: [...e.protectedIds] } : {}),
                ...(e.supersededIds.size > 0 ? { supersededIds: [...e.supersededIds] } : {}),
                ...(e.injectedBy.size > 0 ? { injectedBy: Object.fromEntries(e.injectedBy) } : {}),
                ...(e.laneOf.size > 0 ? { lanes: Object.fromEntries(e.laneOf) } : {}),
                updatedAt: e.updatedAt,
            };
        }
        return { version: SESSION_RECALLED_FILE_VERSION, sessions };
    }
}
