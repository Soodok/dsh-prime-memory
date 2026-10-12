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
  /** 单根（无 workspace 归属那批落这里）；workspace 优先的条目不反映在此字段。 */
  root: string;
  /** 落在各 workspace 根下的条数（N10）。 */
  inWorkspace: number;
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

/**
 * `dsh-memory/mem-export` 的响应 = 导出报告 + 命名回填计数。
 *
 * 为什么要单开一个类型：投射默认开后，导出这条路径现在会先做一步**写库**的命名回填
 * （给 `name` 为空的记录派生全库唯一的文件身份名）。它只改 `name`——内容/类型/退场态都不动，
 * 而 `name` 不在 `canonicalRecords` 的快照哈希字段表里，所以「导出不改检索面」依旧成立；
 * 但“导出什么都不写”这句话已经不成立了，把计数摆到响应上是让这笔写在面板上看得见。
 */
export interface MemExportResponse extends MemExportReport {
  /** 本轮新起了多少条名字（0 = 全都已有名）。 */
  named: number;
  /** 起名算出来但落库失败的条数（下轮会重试）。 */
  nameFailed: number;
}

/**
 * 孤儿投射文件扫描报告（P4.4）。
 *
 * “孤儿”只算**有账可查且没人认领**的路径：账本里没有的来路不明文件（人自己放进投射目录
 * 等着被同步的输入）一律不报也不动，所以这里没有“陌生文件”这一项——那个计数在同步侧。
 */
export interface OrphanSample {
  path: string;
  /** `orphan`（干跑时只报这个）/ `moved` / `failed` / `unsafe-relPath`。 */
  reason: string;
}

export interface OrphanReport {
  /** 本次是不是干跑（面板要知道这段数字是哪个模式出的，与 cleanup 同一个理由）。 */
  dryRun: boolean;
  /** 扫过的账本条目数。 */
  scanned: number;
  /** 仍被某条记录（含它的 `.disable` 兄弟）认领的。 */
  claimed: number;
  /** 无人认领的总数（干跑时就等于“将要搬走的数”）。 */
  orphans: number;
  moved: number;
  failed: number;
  /** 账本说有、盘上没：那是“文件缺失”，对账已经在报，这里不重复处理也不删账本。 */
  missing: number;
  /** 因护栏没扫完的剩余条目数。 */
  remaining: number;
  capped: boolean;
  /** 本批归档目录（干跑或什么都没做时为空串）。 */
  dir: string;
  samples: OrphanSample[];
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

/** 反向同步的单条挂账样本（只给路径与做了什么，不给内容——内容可能含敏感信息）。 */
export interface MdSyncSample {
  path: string;
  action: string;
}

/**
 * P2 反向同步报告（文件 → 库）。
 *
 * 与对账报告的区别：对账**只读**，同步会写。所以这里的每个计数都对应一次真实动作，
 * `pending` 那批除外——那批是刻意什么都不做。
 */
export interface MdSyncReport {
  /** 本轮遍历过的投射根数（workspace 根 + 单根，N10）。 */
  roots: number;
  scanned: number;
  /** 只有文件变 → 已回灌入库。 */
  imported: number;
  /** 只有库变 → 已重写文件。 */
  rendered: number;
  /** 两边都没变。 */
  same: number;
  /** 跳过（读不出/形状不符/写库失败）。 */
  skipped: number;
  /** **两边都变 → 挂待裁决**：两侧保持原样，等人裁决。 */
  pending: number;
  /** `.disable` → 已退场。 */
  retired: number;
  /** 没有账本、也认不出记录的新文件：本轮**不入库**（导入必须过写入内核）。 */
  newFiles: number;
  /** `.disable` 文件但找不到对应记录（改名后的 id 也追不到）。 */
  orphan: number;
  /** 因护栏没扫完的剩余文件数。 */
  remaining: number;
  capped: boolean;
  samples: MdSyncSample[];
}
