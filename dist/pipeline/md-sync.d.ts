/**
 * P2 反向同步：md 投射文件 → 索引（文件是人编辑的那一侧）。
 *
 * 与导出侧（`memory-md-export.ts`）共用同一份落点计算（`targetFor`）、同一个库侧指纹
 * 算法（`recordDigest`）和同一本账本，所以两侧看到的世界一致；写文件这条路**直接复用**
 * `exportRecords`（传单条记录），不另写一套落盘逻辑——两套写盘迟早漂移。
 *
 * 判定一律走**三方**：账本里存着上次投射时的库侧指纹与文件侧指纹，"谁变了"才是可判定的。
 * 四象限（spec P2 裁决表）：
 * - 只有文件变 → 回灌入库，然后把文件重写成规范渲染（正文仍是人写的那段，frontmatter 归一）。
 *   这一步同时消掉写回环：库和文件都回到账本记着的那个状态，下一轮判 `same`。
 * - 只有库变 → 重写文件。
 * - **两边都变 → 什么都不做**，只在报告里挂账。人不裁决机器不许动；两侧保持原样、账本也不动，
 *   所以下次对账还会报同样的 `both`（挂账是持久的，不会悄悄过期）。
 * - 都没变 → 跳过，不刷 mtime。
 *
 * 另有一条独立通道：`.memory.md.disable` 后缀 = 人在文件侧手工判过时 → 退场对应记录
 * （写 valid_to，不进任何检索通路）。这是 `recall-feedback -1` 的文件侧对偶。
 *
 * 两条边界：
 * - 没有账本、也认不出记录的文件 = 人新建的，**不入库**。导入一条新记忆必须过写入内核
 *   的判据面（归一/长度/预算/去重），在这里手搓一条等于绕过那些不变量。只计数。
 * - 遍历范围 = 从记录算出的落点根 ∪ 账本里记过的根。所以"没有任何记录指向的全新 workspace"
 *   不在本轮范围内——它还没有投射根，等它的第一条记忆落进去才可见。
 *
 * 另有一条遍历防护（P2 缺口 task_3.7）：投射根下的"链接"在 win32 上不止 symlink 一种形状，
 * junction（目录联接，reparse point）也算，而 `Dirent.isSymbolicLink()` 对它的判定随 Node 版本
 * 与文件系统漂移。所以进任何子目录前再加一道 `realpath` 判据：解析出的真实路径必须仍在该投射根
 * 内，界外的一律不进并计入 `skippedLinks`。⚠️ 这个 realpath **只服务划界**——不参与账本键，也不
 * 参与落点计算（那边刻意不做 realpath，理由见 `store/memory-md.ts::targetFor` 的注释）。两处不一致
 * 是有意的，不是 bug。
 */
import type { MdLedgerStore } from '../store/memory-md-ledger.js';
import type { MdSyncReport } from '../store/memory-md-types.js';
import type { L1Store } from '../store/l1.js';
import type { MemoryLogger } from '../types.js';
export interface MdSyncDeps {
    store: L1Store;
    ledger: MdLedgerStore;
    /** `cfg.memExport.root`（空 = 默认单根）；与导出侧同一个值。 */
    cfgRoot: string | undefined;
    dataDir: string;
    maxFiles: number;
    timeBudgetMs: number;
    logger?: MemoryLogger;
    /** 注入时钟（测试用）。 */
    now?: () => number;
}
/**
 * 越界判据：`resolved` 必须就是根，或者是根的子目录。
 *
 * 前缀比较带 `sep`：少了那个分隔符，兄弟目录 `<root>2` 会被判成界内（经典越界陷阱）。
 * 两侧都出自 `realpath`，同一卷上大小写与 8.3 短名都已归一，所以这里做**严格字符串**比较；
 * win32 上再折叠大小写只会放松判据（把真越界说成合法），不做。
 * 导出只为把判据本身钉成用例：造不出链接的机器上，判据仍要有测试可跑。
 */
export declare function isWithinRoot(rootReal: string, resolved: string): boolean;
/**
 * 反向同步一轮。
 *
 * @param deps - 见 `MdSyncDeps`。
 * @returns 同步报告（含挂账样本、剩余量、以及遍历防护拦下的条目数 `skippedLinks`）。
 *   任何单条失败只计数并留痕，绝不抛挂整轮。
 */
export declare function syncFromFiles(deps: MdSyncDeps): Promise<MdSyncReport>;
