import type { MemoryLogger } from '../types.js';
/** sidecar 版本常量（file-versions 同款集中纪律）。 */
export declare const MEMORY_SOURCES_FILE_VERSION: 1;
/** 已知外部 agent 来源类别（与 memport foreign-agent.md 对齐）；'file' = 任意路径。 */
export declare const SOURCE_KINDS: readonly ["trae", "qoder", "codex", "claude", "workbuddy", "golutra", "cursor", "file"];
export type SourceKind = (typeof SOURCE_KINDS)[number];
export interface MemorySourceEntry {
    /** 稳定 id（小写字母数字连字符）；扫描/导入按此归类、支持按来源撤销。 */
    id: string;
    kind: SourceKind;
    /** 路径指针（绝对路径/目录），正文永不复制进来。 */
    path: string;
    label?: string;
    /** 最近一次扫描时间（ISO）；未扫为空。 */
    lastScanAt: string;
    /** 最近一次导入时间（ISO）；未导入为空。 */
    lastImportAt: string;
    /** 用户临时停用（保留条目但不参与自动扫描；≠ 删除）。 */
    disabled: boolean;
    status: 'active' | 'retired';
    createdAt: string;
    updatedAt: string;
}
export type MemorySourceInput = Pick<MemorySourceEntry, 'id' | 'kind' | 'path'> & Partial<Pick<MemorySourceEntry, 'label'>>;
export declare class MemorySourceStore {
    private readonly logger?;
    private readonly file;
    private entries;
    private rev;
    private loaded;
    private degraded;
    private degradedLogged;
    private writeChain;
    constructor(dataDir: string, logger?: MemoryLogger | undefined);
    /** 载入（启动 await 一次）。缺失 = 合法空表；损坏 = 只读降级（回退"无来源"）。 */
    init(): Promise<void>;
    private ensureLoaded;
    /** 全量条目（含 retired；副本返回，活引用纪律）。 */
    list(): MemorySourceEntry[];
    /** active 且未停用的来源（扫描/导入遍历用）。 */
    listEnabled(): MemorySourceEntry[];
    byId(id: string): MemorySourceEntry | undefined;
    /** 登记来源（幂等：同 id 已存在则原地补全 kind/path/label，不新建）。上限防刷。 */
    register(input: MemorySourceInput): Promise<{
        entry: MemorySourceEntry;
        created: boolean;
    }>;
    /** 记一次扫描时间。 */
    markScanned(id: string, at: string): Promise<boolean>;
    /** 记一次导入时间。 */
    markImported(id: string, at: string): Promise<boolean>;
    /** 启用/停用（停用保留条目、只是不参与自动扫描）。 */
    setDisabled(id: string, disabled: boolean): Promise<boolean>;
    /** 退役/恢复（status 迁移）。 */
    setStatus(id: string, status: 'active' | 'retired'): Promise<boolean>;
    private patch;
    /** 写穿持久化（串行链；失败降级内存态并告警一次，绝不抛出阻塞调用方）。 */
    private persist;
}
