/**
 * 「记忆已声明过时」待播报队列（outbox，`obsolete-notices.json`）。
 *
 * 为什么需要它：用户在召回卡上打 `-1` 之后，**记忆库那一侧当场就改了**（退场），
 * 但模型此刻的上下文里那条记忆还在——它得被告知"这条已由用户判定过时、别再依据它
 * 作答"。这个告知是一次性的：下一轮注入即出队，不常驻（常驻是槽位的语义，见
 * `hooks/slot-recall.ts`）。
 *
 * 落盘而非纯内存：打 `-1` 到下一轮之间若进程重启，纯内存会**静默丢掉这一票**——
 * 记忆已经退场了，而模型从没被告知。所以 outbox 必须持久化（与 session-recalled
 * 同款纪律：写穿 + 版本 + 损坏只读降级，绝不抛进注入热路径）。
 *
 * 键 = sessionKey（`agent.session?.id ?? agent.id`），与活召回集、pill 的 sessionId
 * 同源；三处不同键会直接导致"播报错会话"，见 store/session-recalled.ts 头注。
 */
import * as path from 'node:path';
import { readJsonStrict, atomicWriteText, ensureDir } from '../util/io.js';
export const OBSOLETE_NOTICES_FILE_VERSION = 1;
/** 单会话待播报上限（超出丢最旧：模型只需知道"这些别再信"，不需历史）。 */
const PER_SESSION_CAP = 8;
/** 会话数上限，按最近写入时间淘汰。 */
const SESSION_CAP = 200;
const TITLE_MAX = 120;
export class ObsoleteNoticeStore {
    logger;
    file;
    buckets = new Map();
    loaded = false;
    degraded;
    degradedLogged = false;
    writeChain = Promise.resolve();
    rev = 0;
    constructor(dataDir, logger) {
        this.logger = logger;
        this.file = path.join(dataDir, 'obsolete-notices.json');
    }
    async init() {
        await ensureDir(path.dirname(this.file));
        const read = await readJsonStrict(this.file);
        if (!read.ok) {
            if (read.reason !== 'missing') {
                this.degraded = `${read.reason}${'detail' in read && read.detail ? `: ${read.detail}` : ''}`;
                this.logger?.warn(`[memory] 过时播报队列只读降级: ${this.degraded}`);
            }
            this.loaded = true;
            return;
        }
        const raw = read.value.sessions ?? {};
        for (const [sid, list] of Object.entries(raw)) {
            const kept = this.normalize(list);
            if (kept.length > 0)
                this.buckets.set(sid, kept);
        }
        this.loaded = true;
    }
    normalize(list) {
        if (!Array.isArray(list))
            return [];
        const out = [];
        for (const raw of list) {
            if (!raw || typeof raw !== 'object')
                continue;
            const e = raw;
            if (typeof e.id !== 'string' || !e.id || typeof e.title !== 'string' || typeof e.at !== 'number')
                continue;
            out.push({ id: e.id, title: e.title, at: e.at });
            if (out.length >= PER_SESSION_CAP)
                break;
        }
        return out;
    }
    ensureLoaded() {
        if (!this.loaded)
            throw new Error('过时播报队列未初始化(先 await init())');
    }
    /** 判脏序号(测试/观测用;注入侧靠 drain 的返回值判断有无)。 */
    revision() {
        return this.rev;
    }
    /** 入队一条(幂等由调用方保证:同 id 重复入队只会多播一行，故这里去重)。 */
    push(sessionKey, notice) {
        this.ensureLoaded();
        if (!sessionKey)
            return;
        const list = this.buckets.get(sessionKey) ?? [];
        if (list.some((n) => n.id === notice.id))
            return;
        const title = notice.title.length > TITLE_MAX ? `${notice.title.slice(0, TITLE_MAX)}…` : notice.title;
        const next = [...list, { ...notice, title }];
        this.buckets.set(sessionKey, next.slice(-PER_SESSION_CAP));
        this.rev += 1;
        this.prune();
        this.schedulePersist();
    }
    /** 出队并清空该会话的待播报(一次性语义:取走即离开 outbox)。 */
    drain(sessionKey) {
        this.ensureLoaded();
        const list = this.buckets.get(sessionKey);
        if (list === undefined || list.length === 0)
            return [];
        this.buckets.delete(sessionKey);
        this.rev += 1;
        this.schedulePersist();
        return list;
    }
    /** 只看不取(测试/诊断)。 */
    peek(sessionKey) {
        this.ensureLoaded();
        return [...(this.buckets.get(sessionKey) ?? [])];
    }
    size() {
        this.ensureLoaded();
        let n = 0;
        for (const list of this.buckets.values())
            n += list.length;
        return n;
    }
    prune() {
        if (this.buckets.size <= SESSION_CAP)
            return;
        const newestAt = (list) => list.reduce((m, n) => Math.max(m, n.at), 0);
        const byOldest = [...this.buckets.entries()].sort((a, b) => newestAt(a[1]) - newestAt(b[1]));
        for (const [sid] of byOldest.slice(0, this.buckets.size - SESSION_CAP))
            this.buckets.delete(sid);
    }
    schedulePersist() {
        if (this.degraded)
            return;
        this.writeChain = this.writeChain.then(() => this.persist(), () => this.persist());
    }
    async persist() {
        if (this.degraded)
            return;
        const body = {
            version: OBSOLETE_NOTICES_FILE_VERSION,
            sessions: Object.fromEntries(this.buckets),
        };
        try {
            await atomicWriteText(this.file, JSON.stringify(body, null, 2));
        }
        catch (err) {
            this.degraded = err instanceof Error ? err.message : String(err);
            if (!this.degradedLogged) {
                this.degradedLogged = true;
                this.logger?.warn(`[memory] 过时播报队列落盘失败,转只读降级: ${this.degraded}`);
            }
        }
    }
    /** 等待在途写完成(测试/停机用)。 */
    flush() {
        return this.writeChain;
    }
}
