/**
 * 外部导入预筛（轨3 宿主侧纯 TS）：把 memport.py 的确定性相似度判据下沉到宿主。
 *
 * 0 LLM / 0 token / 0 网络——纯本地 CPU。判据与阈值经真实语料标定，与
 * `skills/memport/scripts/memport.py` 一字对齐（金标准测试见
 * `tests/memport-ts-consistency.test.ts`）：score = max(3-gram Jaccard, 2-gram Dice)，
 * 真改写对 0.49~0.51 / 主题相关但不同 0.16~0.28，故
 *   score ≥ 0.62 → 同一事实的改写（near-dup）
 *   score ≥ 0.30 → 主题相关，交上层判定互补还是矛盾（conflict-candidate）
 * 宁可多判（代价低），不可漏判（漏判 = 冲突静默入库）。
 *
 * 刻意**不接嵌入做去重**：一旦引语义模型，就从"0-token 纯 CPU"变成"装运行时 + 逐条
 * 嵌入"的持续开销（对齐计划轨3 性能红线）。
 */
import { type MemRecord } from './format.js';
/** 相似度阈值（与 memport.py DEFAULT_* 一致）。 */
export declare const DEFAULT_DUP_T = 0.62;
export declare const DEFAULT_REL_T = 0.3;
/** n-gram 集合（按码点滑窗，unicode 安全；len≤n 时整体作单 gram）。镜像 gram_set。 */
export declare function gramSet(s: string, n?: number): Set<string>;
export declare function jaccard(a: Set<string>, b: Set<string>): number;
/** Dice 系数：对长度差异比 Jaccard 宽容，中文改写场景召回更好。 */
export declare function dice(a: Set<string>, b: Set<string>): number;
/** 一对（已预计算 gram）的相似度：max(3g Jaccard, 2g Dice)，round 4。镜像 score_pair。 */
export declare function scorePair(g3: Set<string>, g2: Set<string>, h3: Set<string>, h2: Set<string>): number;
/** 已有记忆的最小形状（来自 snapshot：content + hash + id）。 */
export interface ExistingLike {
    id: string;
    content: string;
    hash: string;
}
export type Verdict = 'new' | 'dup' | 'near-dup' | 'conflict-candidate';
export interface MatchedRef {
    id: string;
    score: number;
    hash: string;
    content: string;
}
export interface PlanRow {
    seq: number;
    id: string;
    hash: string;
    typeFull: string;
    content: string;
    verdict: Verdict;
    matched: MatchedRef[];
    reason: string;
}
export interface PlanResult {
    rows: PlanRow[];
    counts: Record<Verdict, number>;
}
/**
 * 四桶预筛：对每条待导入记录，先按内容哈希查 dup，再对基线取 top-3 相似按阈值分档；
 * 基线未命中时兜底比对本包内前序条目（导出侧应已合并，这里拦包内近重复）。
 * 镜像 cmd_plan 的分类段（不含 temporal_diff——那属上层裁决增强，非本层职责）。
 */
export declare function plan(records: MemRecord[], existing: ExistingLike[], opts?: {
    dupThreshold?: number;
    relThreshold?: number;
    srcTag?: string;
}): PlanResult;
