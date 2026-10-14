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
 * 后缀不变式收敛报告（库里的“是否有效” ⇄ 文件后缀）。
 *
 * 口径：投射文件的后缀**只由这条记录在库里是否退场决定**，与 `name` 字段无关、
 * 与“是哪条路径把它退场的”也无关。所以这个计数面不挂在某个按钮的事件后面，
 * 而是每次导出都按「文件存在性 + 当前后缀 + 指纹一致性」重算一遍。
 */
export interface SuffixReport {
  /** 本次遍历过的记录数（含什么都不做的）。 */
  scanned: number;
  /** 已退场但盘上还是 `.memory.md` → 已改名。 */
  renamed: number;
  /** 在库但只剩 `.disable`（且账本认得是我们写的）→ 已改回。 */
  revived: number;
  /** 改名前发现文件与账本指纹不符（人动过正文）；**仍照改**，改名不丢字节。 */
  edited: number;
  /** 后缀已经对上，没碰盘。 */
  already: number;
  /** 两份都在（或 `.disable` 不是我们写的）：语义相冲，**保守不动**，交人裁决。 */
  both: number;
  /** 盘上根本没有对应文件（从没导出过）：不凭空造。 */
  absent: number;
  /** 路径越界 / 单条失败（都各自留痕，不阻断整批）。 */
  skipped: number;
  /** 因护栏未处理到的剩余条数。 */
  remaining: number;
  /** 是否因墙钟/条数护栏提前收工（>0 时 UI 提示“再点一次继续”）。 */
  capped: boolean;
}

/**
 * `dsh-memory/mem-export` 的响应 = 导出报告 + 命名回填计数 + 后缀收敛计数。
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
  /** 导出后紧跟的后缀收敛结果（退场记录的文件该带 `.disable`）。 */
  suffix: SuffixReport;
  /**
   * 本次实际滚了几轮（一轮 = 一次有界遍历）。
   *
   * 要报这个：`written`/`renamed` 是各轮累加的，人得知道“一次点击背后跑了 4 轮”
   * 才不会把面板上的时长误读成“一次只能做这么多”。
   */
  passes: number;
  /**
   * 本次**实际生效**的单次动作护栏（包了 `live.mdExportMaxRecords` 覆盖后的值）。
   *
   * 为什么报而不是让人自己算：面板上那个旋钮经 `effectiveCfg` 落地，人看到的数字
   * 必须是被应用过的那个，否则“改了但没生效”与“改了且生效”在报告上长得一样。
   */
  appliedMaxRecords: number;
}

/**
 * 投影长任务的进度快照（`dsh-memory/mem-run-status` 的响应）。
 *
 * 形状住在这里而不是执行侧：`contract.ts` 要 import 它但不能把 `node:fs` 拖进
 * client 编译程序（同本文件头的纪律）。
 */
export interface MdRunStatus {
  running: boolean;
  /** 当前阶段：导出（库→文件）/ 收敛（后缀对齐）/ 已结束。 */
  phase: 'idle' | 'export' | 'converge' | 'done' | 'failed';
  /** 第几轮（一轮 = 一次有界遍历）。 */
  pass: number;
  /** 两阶段合计已推进的条数（分母 = `total`×2，两阶段各算一遍全表）。 */
  done: number;
  total: number;
  written: number;
  renamed: number;
  /** 人读的一行进度说明。 */
  detail: string;
  startedAt: string;
  endedAt: string;
  /** 出错或总预算用尽的说明（非空 = 需要再点一次续跑）。 */
  notice?: string;
}

/**
 * 孤儿投射文件遍历报告（P4.4）。
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
  /**
   * 遍历防护拦下的条目数（task_3.7）：dirent 报链接的条目、真实路径落在投射根外的目录、
   * 以及 realpath 解析失败因而无法验证的目录（含整根划不出边界那一种）。
   * 与 `skipped` 的区别：那是“进来了但不合格式”，这里是**根本没进**——两者混在一个数里
   * 就分不清“文件写得不对”和“目录拓扑越界”，而后者的代价是扫描被链接吞掉整棵外部树。
   */
  skippedLinks: number;
  /**
   * 扫到了但**所在根不是这条记录当前的落点根**的文件数（换过 `memExport.root`、迁库、
   * workspace 根与单根并存时会出现：同一条记录在两个根下各一份）。
   *
   * 它们一律**不参与象限判定、不回灌、不被重写**——拿旧根那份判“谁变了”、却往新根那份写，
   * 会绕过“两边都变就不动”把新根覆盖掉（真机双向往返实测出的形状）。
   * 这些文件本质是孤儿，处置归 `mem-orphans` 归档，不归同步。
   * 注意判据只看**根**不看全路径：同根内嵌套目录里的人手文件仍是既有语义。
   */
  staleRootFiles: number;
  /**
   * 同一条记录被两份以上投射文件认领，且**多于一份被改过** → 这些文件本轮一律不动的件数。
   *
   * 成因是改名（撞车消歧 / 人改 `name` / 命名回填）后旧路径文件与旧账本条目都还留着——
   * 搬走它们的是 `mem-orphans`，不是同步。两份各自独立判象限就会变成两次「仅文件变」回灌，
   * **后跑的赢**，前一份人写的编辑被静默丢掉；而「两边都变就不动」是按单条账本条目判的，
   * 看不见对面那份（真机沙箱实测：旧路径被改 → `imported 1`，库里正文来自已改名那一侧）。
   * 这里把同记录的多路径当成一个裁决单元：只要多于一份有改动就全部挂账不动，等人自己定留哪份
   * （把旧残片交给孤儿归档后，下一轮就只剩一份，判定回到正常轨道）。
   */
  multiPath: number;
  /**
   * 声明 `hash` 与正文实算**不符**的文件数（N13 自校验）：文件被外部改动或损坏，内容已不是
   * 我们上次写出去的那份字节。它**不阻断**任何裁决——正文被人改过恰是 P2 要回灌的正常输入；
   * 这里只把它从“静默按文件侧处理”变成“看得见地处理”。
   */
  hashMismatch: number;
  /**
   * 没带 `hash` 键的老投射文件数（升级前导出的产物）：本身无自校验能力，按兼容放行；
   * 下一轮导出会补盖指纹，因此这个数会随同步推进自然收敛到 0。
   */
  unsigned: number;
  /** 因护栏没扫完的剩余文件数。 */
  remaining: number;
  capped: boolean;
  samples: MdSyncSample[];
}
