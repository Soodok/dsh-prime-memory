/**
 * md 投射的**纯类型**面（无 IO、无 node 依赖）。
 *
 * 为什么要单独一个文件：`src/contract.ts` 的头部纪律是"只允许 type/interface，
 * 不 import 任何运行时值"——它一旦被拉进 client 编译程序，就会连带把
 * `node:fs`/`node:crypto` 的依赖也拖进去（实测：`tsc -p tsconfig.client.json`
 * 立刻报 `Cannot find module 'node:path'`）。所以报告形状收在这里，
 * 存储层与契约层各自 import type，**单一事实源仍然成立**。
 */
/** 导出报告（库 → 文件 + 账本）。`skipped` 含"路径越界/写盘失败"两类，都各自留痕。 */
export interface MemExportReport {
    root: string;
    /** 本次真正遍历过的条数（含未命中/跳过）。 */
    scanned: number;
    written: number;
    /** 内容指纹一致、没重写的条数。 */
    unchanged: number;
    skipped: number;
    /** 因护栏未处理的条数（>0 时 UI 提示"再点一次继续"）。 */
    remaining: number;
    /** 是否因墙钟/条数护栏提前收工。 */
    capped: boolean;
}
/** 四态计数（外加两个边界态）。 */
export interface ReconcileCounts {
    /** 账本里没有这条文件（首次导出前，或人新加了文件）。 */
    firstTime: number;
    /** 两边都没变。 */
    same: number;
    /** 只有库变了 → 该重渲染文件。 */
    dbOnly: number;
    /** 只有文件变了 → P2 该回灌库。 */
    fileOnly: number;
    /** 两边都变 → P2 挂待裁决，绝不自动覆盖任何一边。 */
    both: number;
    /** 账本说有文件、磁盘上没有（被删/被移走）。 */
    missingFile: number;
}
/** 差异样本（人拿它决定要不要真同步）。 */
export interface ReconcileSample {
    relPath: string;
    id: string;
    state: keyof ReconcileCounts;
}
/** 对账报告。`capped` 时必须提醒"计数只覆盖已扫部分，不等于全库无差异"。 */
export interface ReconcileReport extends ReconcileCounts {
    root: string;
    capped: boolean;
    scanned: number;
    samples: ReconcileSample[];
}
