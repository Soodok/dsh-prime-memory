import type { MemoryLogger } from '../types.js';
/** 一条投射记录的指纹账。`db*` 是库侧、`file*` 是磁盘侧，两边成对才能判象限。 */
export interface MdLedgerEntry {
    /** 记录 id（写入时刻的那一个；merge 后可能变，故只当线索不当键）。 */
    id: string;
    /** 外部导入幂等键（有则可用于跨 id 认人）。 */
    extKey: string;
    /** 相对投射根的路径（正斜杠），账本的键。 */
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
    constructor(dataDir: string, logger?: MemoryLogger | undefined);
    init(): Promise<void>;
    /** 逐条收窄：形状不符的条目丢弃，不让一条坏数据拖垮整表。 */
    private normalize;
    private ensureLoaded;
    get(relPath: string): MdLedgerEntry | undefined;
    all(): MdLedgerEntry[];
    set(entry: MdLedgerEntry): void;
    delete(relPath: string): boolean;
    /** 条目上限护栏：投射是"文件 ↔ 库"的一一对应，超量只可能是脏数据堆积。 */
    private prune;
    private schedulePersist;
    private persist;
    /** 等待在途写完成（测试/停机/导出收尾）。 */
    flush(): Promise<void>;
}
