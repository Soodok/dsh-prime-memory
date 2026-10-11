/**
 * 会话"活召回集"存储（G-live）：sessionKey → 本会话已注入、尚未被压缩覆盖的 L1 记录 id。
 *
 * 语义（对齐"当前会话召回后对 session 有影响的条目"，且**旧会话重开也有效**）：
 * - 每次召回**实际注入**（recall.ts 注入成功点）按 **sessionKey**（=agent.session?.id ?? agent.id，
 *   与 pill 的 sessionId、投影 header.id 同源）记入；
 * - 上下文压缩/清空（agent/created source=compact|clear）按 sessionKey **reset**；
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
            this.entries.set(sid, { ids: new Set(entry.recordIds), updatedAt: entry.updatedAt ?? now });
        }
    }
    /** 记入本 sessionKey 本轮实际注入的记录 id（写穿；插入序淘汰最旧）。 */
    add(sessionKey, recordIds) {
        if (!sessionKey || recordIds.length === 0)
            return;
        let entry = this.entries.get(sessionKey);
        if (!entry) {
            entry = { ids: new Set(), updatedAt: 0 };
            this.entries.set(sessionKey, entry);
        }
        for (const id of recordIds) {
            entry.ids.add(id);
            while (entry.ids.size > RECALL_DEDUPE_IDS_CAP) {
                const oldest = entry.ids.values().next().value;
                if (oldest === undefined)
                    break;
                entry.ids.delete(oldest);
            }
        }
        entry.updatedAt = Date.now();
        this.rev++;
        this.writeChain = this.writeChain.then(() => this.persist());
    }
    list(sessionKey) {
        const entry = this.entries.get(sessionKey);
        return entry ? [...entry.ids] : [];
    }
    /** 压缩/清空：注入内容已离开上下文，清该会话活召回集（写穿）。 */
    reset(sessionKey) {
        if (!this.entries.has(sessionKey))
            return;
        this.entries.delete(sessionKey);
        this.rev++;
        this.writeChain = this.writeChain.then(() => this.persist());
    }
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
            sessions[sid] = { recordIds: [...e.ids], updatedAt: e.updatedAt };
        }
        return { version: SESSION_RECALLED_FILE_VERSION, sessions };
    }
}
