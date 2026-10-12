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
 * 反向同步一轮。
 *
 * @param deps - 见 `MdSyncDeps`。
 * @returns 同步报告（含挂账样本与剩余量）。任何单条失败只计数并留痕，绝不抛挂整轮。
 */
export declare function syncFromFiles(deps: MdSyncDeps): Promise<MdSyncReport>;
