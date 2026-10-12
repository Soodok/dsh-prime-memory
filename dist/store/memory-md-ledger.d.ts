import type { MemoryLogger } from '../types.js';
/** 看起来就是绝对路径（Windows 盘符形状或 POSIX 以 `/` 开头）。归档侧也要用它挡坏数据。 */
export declare function looksAbsolute(p: string): boolean;
/**
 * 由「绝对键 + 条目记的 root」推出相对形状（正斜杠）。
 *
 * 这是 relPath 的唯一正确算法：键才是事实源（N10 以后它是绝对路径），root 只是
 * 其中一个字段。`root` 缺失、键不在 root 下、或推出 `..` 开头都返回 `undefined`——不猜。
 *
 * @param root - 投射根（绝对）。
 * @param key - 账本键 = 文件绝对路径。
 * @returns `<类型>/<名>` 的相对形状，推不出时 `undefined`。
 */
export declare function deriveRelPath(root: string, key: string): string | undefined;
/** 一条投射记录的指纹账。`db*` 是库侧、`file*` 是磁盘侧，两边成对才能判象限。 */
export interface MdLedgerEntry {
    /** 记录 id（写入时刻的那一个；merge 后可能变，故只当线索不当键）。 */
    id: string;
    /** 外部导入幂等键（有则可用于跨 id 认人）。 */
    extKey: string;
    /** 投射根（workspace 根或单根），绝对路径。 */
    root: string;
    /** 相对根的路径（正斜杠），展示与归档分目录用。 */
    relPath: string;
    /** 上次投射时**库侧**的内容指纹。 */
    dbDigest: string;
    /** 上次投射时**文件侧**的内容指纹。 */
    fileDigest: string;
    fileMtimeMs: number;
    fileSize: number;
    /** 写入时刻（ISO）。只作展示，不参与任何判据——参与就会让渲染不纯。 */
    syncedAt: string;
}
export declare class MdLedgerStore {
    private readonly logger?;
    private readonly file;
    private entries;
    private loaded;
    private degraded;
    private degradedLogged;
    private writeChain;
    /** 有未落盘的变更。 */
    private dirty;
    /** 已提醒过的 relPath 修正数（防上千条条目刷屏）。 */
    private mismatchWarned;
    /** 已发生的整本落盘次数（见 `writeCount`）。 */
    private writes;
    /** 已排上的合批定时器（undefined = 窗口外）。 */
    private timer;
    constructor(dataDir: string, logger?: MemoryLogger | undefined);
    init(): Promise<void>;
    /** 逐条收窄：形状不符的条目丢弃，不让一条坏数据拖垮整表。 */
    private normalize;
    private ensureLoaded;
    get(absPath: string): MdLedgerEntry | undefined;
    all(): MdLedgerEntry[];
    /**
     * 带键遍历：**账本的键（绝对路径）是唯一认身份的口径**，而 `all()` 把它抹掉了。
     *
     * 为什么需要这个口：孤儿扫描要回答“这个**路径**现在还有没有记录认领”，而条目里的
     * `root`/`relPath` 只是归档时恢复相对形状用的——手工编辑过账本时两者可以不一致，
     * 拿它们当路径就会把“键”与“内容”两套事实源弄混。只读，不暴露可变 Map。
     */
    allWithKeys(): Array<{
        path: string;
        entry: MdLedgerEntry;
    }>;
    set(absPath: string, entry: MdLedgerEntry): void;
    delete(absPath: string): boolean;
    /** 条目上限护栏：投射是"文件 ↔ 库"的一一对应，超量只可能是脏数据堆积。 */
    private prune;
    private schedulePersist;
    /** 串行落盘：并发 set 不能交叠写同一个临时文件。 */
    private enqueuePersist;
    private persistNow;
    /**
     * 已发生的整本落盘次数。
     *
     * 留着它是因为这个类的性能形状就是它的全部意义：账本每次落盘都重写整本 JSON，
     * 所以「这个数是不是跟 `set()` 次数一起涨」直接就能区分 O(n) 与 O(n²)。合批前 200 次
     * `set()` 会落盘 200 次；合批后应该恒为 1。没这个计数器就只能靠时间差或磁盘状态去猜，
     * 那种断言在旧实现上也能绿（自家刚踩过）。
     */
    get writeCount(): number;
    private persist;
    /**
     * 等待在途写完成（测试/停机/导出收尾）。
     *
     * 合批之后这一步是**语义上的“现在就要落盘”**：清掉定时器并强制一次写，所以写完
     * `set()` 不 `flush()` 就不能假设磁盘已经可信。`persistNow` 自带脏位判定，
     * 没变更时不会空写一轮。
     */
    flush(): Promise<void>;
}
