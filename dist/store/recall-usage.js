/**
 * 召回使用统计 sidecar(老化权重效果统计的数据面)。
 *
 * 口径(用户裁定):**进 topN(被注入上下文)才算被使用**;参与尝试未进 = 只有
 * attempts。每轮召回 recordAttempt(候选集, 注入集)——内存即时、去抖原子持久化
 * (召回是热路径,统计只碰内存 Map)。
 *
 * 存储:`recall-usage.json` slots 式 sidecar,与 rooms-registry/session-modes 同族
 * 纪律:缺失 = 合法空表;损坏/不可读 → 只读降级(内存态照常,停止回写),绝不阻塞
 * 召回读路径(R2 红线)。
 */
import * as path from 'node:path';
import { readJsonStrict, atomicWriteText, ensureDir } from '../util/io.js';
export const RECALL_USAGE_FILE_VERSION = 1;
/** 条目上限(防已退场/被取代记忆的 id 无限累积):超限按 lastAttemptAt 淘汰最旧。 */
const MAX_ENTRIES = 50_000;
/** 去抖持久化间隔(召回热路径;窗口内断电最多丢最近统计,不影响记忆本体)。 */
const PERSIST_DEBOUNCE_MS = 5_000;
export class RecallUsageStore {
    logger;
    file;
    entries = new Map();
    loaded = false;
    degraded;
    degradedLogged = false;
    writeTimer;
    writeChain = Promise.resolve();
    constructor(dataDir, logger) {
        this.logger = logger;
        this.file = path.join(dataDir, 'recall-usage.json');
    }
    async init() {
        await ensureDir(path.dirname(this.file));
        const read = await readJsonStrict(this.file);
        if (!read.ok) {
            if (read.reason !== 'missing') {
                this.degraded = `${read.reason}${'detail' in read && read.detail ? `: ${read.detail}` : ''}`;
                this.logger?.warn(`[memory] 召回使用统计只读降级: ${this.degraded}`);
            }
            this.loaded = true;
            return;
        }
        const raw = read.value.entries ?? {};
        for (const [id, e] of Object.entries(raw)) {
            if (!e || typeof e.attempts !== 'number')
                continue;
            this.entries.set(id, {
                attempts: e.attempts,
                used: typeof e.used === 'number' ? e.used : 0,
                lastAttemptAt: typeof e.lastAttemptAt === 'number' ? e.lastAttemptAt : null,
                lastUsedAt: typeof e.lastUsedAt === 'number' ? e.lastUsedAt : null,
            });
        }
        this.loaded = true;
    }
    ensureLoaded() {
        if (!this.loaded)
            throw new Error('召回使用统计未初始化(先 await init())');
    }
    /** 一轮召回:候选集 attempts++/lastAttemptAt=now;used 子集额外 used++/lastUsedAt=now
     *  (used 不在候选内 = 防御路径,同样算一次尝试——用了就是被尝试过)。 */
    recordAttempt(candidateIds, usedIds) {
        this.ensureLoaded();
        if (candidateIds.length === 0 && usedIds.length === 0)
            return;
        const now = Date.now();
        const cand = new Set(candidateIds);
        for (const id of cand) {
            const e = this.entries.get(id) ?? { attempts: 0, used: 0, lastAttemptAt: null, lastUsedAt: null };
            e.attempts += 1;
            e.lastAttemptAt = now;
            this.entries.set(id, e);
        }
        for (const id of usedIds) {
            const e = this.entries.get(id) ?? { attempts: 0, used: 0, lastAttemptAt: null, lastUsedAt: null };
            e.used += 1;
            if (!cand.has(id)) {
                e.attempts += 1;
                e.lastAttemptAt = now;
            }
            e.lastUsedAt = now;
            this.entries.set(id, e);
        }
        this.prune();
        this.schedulePersist();
    }
    get(id) {
        this.ensureLoaded();
        const e = this.entries.get(id);
        return e ? { ...e } : undefined;
    }
    /**
     * 把一条记录的使用史搬到新 id（merge 之后由管线调用，P0-d）。
     *
     * 必须搬的理由：成熟度 = `priority + used + 老化 + 人工最近一笔` 的合成，而 merge
     * 每次新铸 id——不搬就等于**每次合并把这条记忆的使用史清零**，它会被系统当成
     * “没用过”而沉底，而且从面板上看不出来（统计仍挂在已退场的旧 id 上）。
     *
     * 两侧都有条目时按“次数相加、时刻取新”合并：这是纯计数，不存在语义冲突。
     * 没条目（旧 id 从未被召回过）时返回 false，**不造零条目**——那会把表灌满噪声行。
     */
    rekey(oldId, newId) {
        this.ensureLoaded();
        if (oldId === newId)
            return false;
        const from = this.entries.get(oldId);
        if (from === undefined)
            return false;
        const to = this.entries.get(newId);
        this.entries.set(newId, {
            attempts: (to?.attempts ?? 0) + from.attempts,
            used: (to?.used ?? 0) + from.used,
            lastAttemptAt: Math.max(to?.lastAttemptAt ?? 0, from.lastAttemptAt ?? 0) || null,
            lastUsedAt: Math.max(to?.lastUsedAt ?? 0, from.lastUsedAt ?? 0) || null,
        });
        this.entries.delete(oldId);
        this.prune();
        this.schedulePersist();
        return true;
    }
    summary() {
        this.ensureLoaded();
        let attempted = 0;
        let used = 0;
        for (const e of this.entries.values()) {
            attempted += e.attempts;
            used += e.used;
        }
        return { tracked: this.entries.size, attempted, used, rate: attempted > 0 ? Math.round((used / attempted) * 100) : 0 };
    }
    /** 立即落盘(去抖窗口内的兜底;测试/停机用)。 */
    flush() {
        if (this.writeTimer) {
            clearTimeout(this.writeTimer);
            this.writeTimer = undefined;
        }
        return this.persist();
    }
    /** 同步等待在途写(测试用;无在途写时立即返回)。 */
    flushSync() {
        void this.flush();
    }
    prune() {
        if (this.entries.size <= MAX_ENTRIES)
            return;
        const byOldest = [...this.entries.entries()].sort((a, b) => (a[1].lastAttemptAt ?? 0) - (b[1].lastAttemptAt ?? 0));
        for (const [id] of byOldest.slice(0, this.entries.size - MAX_ENTRIES))
            this.entries.delete(id);
    }
    schedulePersist() {
        if (this.degraded || this.writeTimer)
            return;
        this.writeTimer = setTimeout(() => {
            this.writeTimer = undefined;
            void this.persist();
        }, PERSIST_DEBOUNCE_MS);
        this.writeTimer.unref?.(); // 不为统计写hold进程(停机即丢窗口内统计,可接受)
    }
    async persist() {
        if (this.degraded)
            return;
        this.writeChain = this.writeChain.then(async () => {
            try {
                await ensureDir(path.dirname(this.file));
                const data = { version: RECALL_USAGE_FILE_VERSION, entries: Object.fromEntries(this.entries) };
                await atomicWriteText(this.file, JSON.stringify(data));
            }
            catch (err) {
                this.degraded = err instanceof Error ? err.message : String(err);
                if (!this.degradedLogged) {
                    this.degradedLogged = true;
                    this.logger?.warn(`[memory] 召回使用统计写入失败,只读降级: ${this.degraded}`);
                }
            }
        });
        await this.writeChain;
    }
}
