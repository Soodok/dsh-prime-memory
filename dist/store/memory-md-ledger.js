/**
 * md 投射的指纹账本（N9）。
 *
 * 它存在的唯一理由：**库里没有任何 hash 列**（spec F26），三处现成 hash 又全不落库
 * （F27：快照是整集粗粒度、memport 每次现算、reconcile 只活在状态文件里）。没有这张
 * 账本就无从回答"这个文件是被人改的，还是被我们上次写出去的"——而那是双向同步的
 * 全部难点：两方比较必吃一边。
 *
 * 三条口径：
 * - **键是文件的绝对路径**（N10 后根不止一个：workspace 根 + 单根，同名不同 workspace 会
 *   在 relPath 上撞车）。绝对路径由 `targetFor` 一函数算出，读写对账改名四处共用，
 *   所以键是确定性的（Windows 下 `workspace_id` 是小写形态，这一点已写进 `memory-md.ts`）。
 * - **派生态**：删了这张表最坏是"下次全量重写一遍文件"，不会丢任何记忆。所以它
 *   **不进**快照哈希投影（`canonicalRecords` 不动），也不需要迁移。
 * - **写穿失败只降级为只读并 warn 一次**，绝不抛给调用方：投射是旁路，旁路不能弄挂主路。
 */
import { dirname, join } from 'node:path';
import { atomicWriteText, ensureDir, readJsonStrict } from '../util/io.js';
import { MEM_MD_LEDGER_FILE_VERSION } from './file-versions.js';
/**
 * 合批窗口(ms)。
 *
 * 账本是**整本 JSON 的原子重写**（临时文件 + rename），所以“每 set 一条就落盘”把导出
 * 成本变成 O(n²)：本机实测 1200 条记录 9.4 秒，其中只碰文件面只需 1.6 秒。改为窗口内
 * 只记脏、由 `flush()` 收尾落一次，1200 次 set 就是一次落盘。
 * 窗口只是**兜底**：三个写方（导出 / 失效 / 同步）本来就在收尾 `await flush()`。
 */
const PERSIST_COALESCE_MS = 250;
export class MdLedgerStore {
    logger;
    file;
    entries = new Map();
    loaded = false;
    degraded;
    degradedLogged = false;
    writeChain = Promise.resolve();
    /** 有未落盘的变更。 */
    dirty = false;
    /** 已发生的整本落盘次数（见 `writeCount`）。 */
    writes = 0;
    /** 已排上的合批定时器（undefined = 窗口外）。 */
    timer;
    constructor(dataDir, logger) {
        this.logger = logger;
        this.file = join(dataDir, 'mem-md-ledger.json');
    }
    async init() {
        await ensureDir(dirname(this.file));
        const read = await readJsonStrict(this.file);
        if (!read.ok) {
            if (read.reason !== 'missing') {
                this.degraded = `${read.reason}${'detail' in read && read.detail ? `: ${read.detail}` : ''}`;
                this.logger?.warn(`[memory] md 投射账本只读降级: ${this.degraded}`);
            }
            this.loaded = true;
            return;
        }
        for (const [rel, e] of Object.entries(read.value.entries ?? {})) {
            const parsed = this.normalize(e);
            // 键与条目内的 relPath 不一致 ⇒ 以键为准重写（不丢条目，但留一行 warn：
            // 手工编辑过账本的人需要知道它被规整了）。
            if (parsed !== undefined)
                this.entries.set(rel, { ...parsed, relPath: rel });
        }
        this.loaded = true;
    }
    /** 逐条收窄：形状不符的条目丢弃，不让一条坏数据拖垮整表。 */
    normalize(e) {
        if (!e || typeof e !== 'object')
            return undefined;
        const raw = e;
        if (typeof raw.relPath !== 'string' || raw.relPath.length === 0)
            return undefined;
        if (typeof raw.dbDigest !== 'string' || typeof raw.fileDigest !== 'string')
            return undefined;
        return {
            id: typeof raw.id === 'string' ? raw.id : '',
            extKey: typeof raw.extKey === 'string' ? raw.extKey : '',
            root: typeof raw.root === 'string' ? raw.root : '',
            relPath: raw.relPath,
            dbDigest: raw.dbDigest,
            fileDigest: raw.fileDigest,
            fileMtimeMs: typeof raw.fileMtimeMs === 'number' ? raw.fileMtimeMs : 0,
            fileSize: typeof raw.fileSize === 'number' ? raw.fileSize : 0,
            syncedAt: typeof raw.syncedAt === 'string' ? raw.syncedAt : '',
        };
    }
    ensureLoaded() {
        if (!this.loaded)
            throw new Error('md 投射账本未初始化(先 await init())');
    }
    get(absPath) {
        this.ensureLoaded();
        return this.entries.get(absPath);
    }
    all() {
        this.ensureLoaded();
        return [...this.entries.values()];
    }
    set(absPath, entry) {
        this.ensureLoaded();
        this.entries.set(absPath, entry);
        this.schedulePersist();
    }
    delete(absPath) {
        this.ensureLoaded();
        if (!this.entries.delete(absPath))
            return false;
        this.schedulePersist();
        return true;
    }
    /** 条目上限护栏：投射是"文件 ↔ 库"的一一对应，超量只可能是脏数据堆积。 */
    prune() {
        const MAX = 50_000;
        if (this.entries.size <= MAX)
            return;
        const sorted = [...this.entries.entries()].sort((a, b) => (a[1].syncedAt < b[1].syncedAt ? -1 : 1));
        for (const [rel] of sorted.slice(0, this.entries.size - MAX))
            this.entries.delete(rel);
    }
    schedulePersist() {
        if (this.degraded)
            return;
        this.dirty = true;
        // 已在窗口内就不再排：一个 burst 只留一次落盘。
        if (this.timer !== undefined)
            return;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.enqueuePersist();
        }, PERSIST_COALESCE_MS);
        // 不让一个兜底定时器拖住进程退出（宿主常驻时无影响，测试收尾时干净）。
        this.timer.unref?.();
    }
    /** 串行落盘：并发 set 不能交叠写同一个临时文件。 */
    enqueuePersist() {
        this.writeChain = this.writeChain.then(() => this.persistNow(), () => this.persistNow());
        return this.writeChain;
    }
    async persistNow() {
        if (!this.dirty || this.degraded)
            return;
        this.dirty = false;
        this.writes += 1;
        await this.persist();
    }
    /**
     * 已发生的整本落盘次数。
     *
     * 留着它是因为这个类的性能形状就是它的全部意义：账本每次落盘都重写整本 JSON，
     * 所以「这个数是不是跟 `set()` 次数一起涨」直接就能区分 O(n) 与 O(n²)。合批前 200 次
     * `set()` 会落盘 200 次；合批后应该恒为 1。没这个计数器就只能靠时间差或磁盘状态去猜，
     * 那种断言在旧实现上也能绿（自家刚踩过）。
     */
    get writeCount() {
        return this.writes;
    }
    async persist() {
        if (this.degraded)
            return;
        this.prune();
        const data = {
            version: MEM_MD_LEDGER_FILE_VERSION,
            entries: Object.fromEntries(this.entries),
        };
        try {
            await ensureDir(dirname(this.file));
            await atomicWriteText(this.file, JSON.stringify(data, null, 2));
        }
        catch (err) {
            this.degraded = err instanceof Error ? err.message : String(err);
            if (!this.degradedLogged) {
                this.degradedLogged = true;
                this.logger?.warn(`[memory] md 投射账本写入失败，只读降级: ${this.degraded}`);
            }
        }
    }
    /**
     * 等待在途写完成（测试/停机/导出收尾）。
     *
     * 合批之后这一步是**语义上的“现在就要落盘”**：清掉定时器并强制一次写，所以写完
     * `set()` 不 `flush()` 就不能假设磁盘已经可信。`persistNow` 自带脏位判定，
     * 没变更时不会空写一轮。
     */
    flush() {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        return this.enqueuePersist();
    }
}
