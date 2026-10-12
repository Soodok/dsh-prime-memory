/**
 * 召回相关度反馈 sidecar（`recall-feedback.json`）。
 *
 * 口径（用户裁定）：概要侧栏「本会话召回」卡上，人对**这条被召回的记忆**做主动标注：
 * - `0..5` = 相关度评分（人给的、显式的，区别于系统算的 priority/usage/aging）；
 * - `-1`   = 声明这条记忆**已过时**（配套动作由调用方执行：退场 + 会话内声明）。
 *
 * 为什么单开一个 sidecar 而**不写进 L1 metadata**：metadata 进 `canonicalRecords`
 * 快照哈希（`store/l1-snapshot.ts`），往既有记录里塞新键 = 旧快照永久失配（conflicts
 * 列事故同款）。反馈是**关于**记忆的观察值，不是记忆内容，本就该另立面。
 *
 * 纪律与 recall-usage 同族：缺失 = 合法空表；损坏/不可读 → 只读降级（内存态照用、
 * 停止回写），绝不抛进读路径。差别只有一处：**打分是用户动作、低频**，所以
 * **立即落盘**而非去抖——点完就崩不该丢这一票。
 */
import * as path from 'node:path';
import { readJsonStrict, atomicWriteText, ensureDir } from '../util/io.js';
export const RECALL_FEEDBACK_FILE_VERSION = 1;
/** 合法打分：-1（声明过时）与 0..5（相关度）。 */
export const FEEDBACK_SCORES = [-1, 0, 1, 2, 3, 4, 5];
/** 条目上限(防已退场记忆的 id 无限累积):超限按 updatedAt 淘汰最旧。 */
const MAX_ENTRIES = 20_000;
/** 轨迹条数上限。 */
const HISTORY_CAP = 12;
/** 是否合法打分(供端点入参校验复用)。 */
export function isFeedbackScore(v) {
    return typeof v === 'number' && FEEDBACK_SCORES.includes(v);
}
export class RecallFeedbackStore {
    logger;
    file;
    entries = new Map();
    loaded = false;
    degraded;
    degradedLogged = false;
    writeChain = Promise.resolve();
    /** 判脏序号:每次有效写入 +1(投影 view 带 rating，靠它决定要不要重建)。 */
    rev = 0;
    constructor(dataDir, logger) {
        this.logger = logger;
        this.file = path.join(dataDir, 'recall-feedback.json');
    }
    async init() {
        await ensureDir(path.dirname(this.file));
        const read = await readJsonStrict(this.file);
        if (!read.ok) {
            if (read.reason !== 'missing') {
                this.degraded = `${read.reason}${'detail' in read && read.detail ? `: ${read.detail}` : ''}`;
                this.logger?.warn(`[memory] 召回反馈只读降级: ${this.degraded}`);
            }
            this.loaded = true;
            return;
        }
        const raw = read.value.entries ?? {};
        for (const [id, e] of Object.entries(raw)) {
            const parsed = this.normalize(e);
            if (parsed)
                this.entries.set(id, parsed);
        }
        this.loaded = true;
    }
    /** 读侧逐条收窄:形状不符的条目丢弃，不让一条坏数据拖垮整表。 */
    normalize(e) {
        if (!e || typeof e !== 'object')
            return undefined;
        const raw = e;
        if (!isFeedbackScore(raw.last) || typeof raw.updatedAt !== 'number')
            return undefined;
        const rated = typeof raw.rated === 'number' && raw.rated >= 0 ? Math.floor(raw.rated) : 0;
        const history = Array.isArray(raw.history)
            ? raw.history
                .filter((h) => isFeedbackScore(h.s) && typeof h.at === 'number')
                .slice(-HISTORY_CAP)
            : [];
        return {
            last: raw.last,
            rated,
            mean: typeof raw.mean === 'number' ? raw.mean : 0,
            obsolete: typeof raw.obsolete === 'number' && raw.obsolete >= 0 ? Math.floor(raw.obsolete) : 0,
            updatedAt: raw.updatedAt,
            history,
        };
    }
    ensureLoaded() {
        if (!this.loaded)
            throw new Error('召回反馈未初始化(先 await init())');
    }
    /** 判脏序号(供投影 O(1) 决定要不要重建 view)。 */
    revision() {
        return this.rev;
    }
    /**
     * 记一次打分。返回聚合后的条目(供端点回执)。
     * 只聚合不裁决:`-1` 进 obsolete 计数、不进均值(过时不是"不相关",两回事)。
     */
    rate(id, score, at = Date.now()) {
        this.ensureLoaded();
        const prev = this.entries.get(id);
        const history = [...(prev?.history ?? []), { s: score, at }].slice(-HISTORY_CAP);
        const rated = (prev?.rated ?? 0) + (score >= 0 ? 1 : 0);
        const sum = (prev?.mean ?? 0) * (prev?.rated ?? 0) + (score >= 0 ? score : 0);
        const next = {
            last: score,
            rated,
            mean: rated > 0 ? Math.round((sum / rated) * 100) / 100 : 0,
            obsolete: (prev?.obsolete ?? 0) + (score === -1 ? 1 : 0),
            updatedAt: at,
            history,
        };
        this.entries.set(id, next);
        this.rev += 1;
        this.prune();
        this.schedulePersist();
        return { ...next };
    }
    get(id) {
        this.ensureLoaded();
        const e = this.entries.get(id);
        return e ? { ...e, history: [...e.history] } : undefined;
    }
    /** 均值(0..5);无有效评分 → undefined(缺席 ≠ 0 分)。 */
    meanOf(id) {
        this.ensureLoaded();
        const e = this.entries.get(id);
        return e && e.rated > 0 ? e.mean : undefined;
    }
    /** 最近一次打分(-1..5);未标注 → undefined。 */
    lastOf(id) {
        this.ensureLoaded();
        return this.entries.get(id)?.last;
    }
    /**
     * 把一条记录的人工标注搬到新 id（merge 之后由管线调用，P0-d）。
     *
     * 不搬的后果比使用史更直接：成熟度只吃“人工最近一笔”，而 `last` 留在旧 id 上
     * 就等于新记录**看起来从没被人打过**；更坏的是旧 id 上那一笔 `-1`（已判过时）
     * 会跟着旧行一起沉进垃圾堆，新行反而以“未标注”的活状态回到召回里。
     *
     * 计数按相加、不按轨迹重算：`history` 截断到 12 条，拿它反推 `obsolete` 必然少算。
     * 两侧都有条目时取较新一侧的 `last`，轨迹按时间归并。
     */
    rekey(oldId, newId) {
        this.ensureLoaded();
        if (oldId === newId)
            return false;
        const from = this.entries.get(oldId);
        if (from === undefined)
            return false;
        const to = this.entries.get(newId);
        const ratedCount = (to?.rated ?? 0) + from.rated;
        const ratedSum = (to?.mean ?? 0) * (to?.rated ?? 0) + from.mean * from.rated;
        const newer = to !== undefined && to.updatedAt >= from.updatedAt ? to : from;
        const next = {
            last: newer.last,
            rated: ratedCount,
            mean: ratedCount > 0 ? Math.round((ratedSum / ratedCount) * 100) / 100 : 0,
            obsolete: (to?.obsolete ?? 0) + from.obsolete,
            updatedAt: Math.max(to?.updatedAt ?? 0, from.updatedAt),
            history: [...(to?.history ?? []), ...from.history].sort((a, b) => a.at - b.at).slice(-HISTORY_CAP),
        };
        this.entries.set(newId, next);
        this.entries.delete(oldId);
        this.rev += 1;
        this.prune();
        this.schedulePersist();
        return true;
    }
    summary() {
        this.ensureLoaded();
        let rated = 0;
        let obsolete = 0;
        for (const e of this.entries.values()) {
            rated += e.rated;
            obsolete += e.obsolete;
        }
        return { tracked: this.entries.size, rated, obsolete };
    }
    prune() {
        if (this.entries.size <= MAX_ENTRIES)
            return;
        const byOldest = [...this.entries.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
        for (const [id] of byOldest.slice(0, this.entries.size - MAX_ENTRIES))
            this.entries.delete(id);
    }
    /** 立即落盘(串行链上排队,不与在途写交错)。 */
    schedulePersist() {
        if (this.degraded)
            return;
        this.writeChain = this.writeChain.then(() => this.persist(), () => this.persist());
    }
    async persist() {
        if (this.degraded)
            return;
        const body = {
            version: RECALL_FEEDBACK_FILE_VERSION,
            entries: Object.fromEntries(this.entries),
        };
        try {
            await atomicWriteText(this.file, JSON.stringify(body, null, 2));
        }
        catch (err) {
            this.degraded = err instanceof Error ? err.message : String(err);
            if (!this.degradedLogged) {
                this.degradedLogged = true;
                this.logger?.warn(`[memory] 召回反馈落盘失败,转只读降级: ${this.degraded}`);
            }
        }
    }
    /** 等待在途写完成(测试/停机用)。 */
    flush() {
        return this.writeChain;
    }
}
