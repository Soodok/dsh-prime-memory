/**
 * 成熟度（maturity）合成——G3，单一事实源的纯函数。
 *
 * 把四个**已存在**的信号合成一个可解释的置信档，供面板显示与召回排序：
 * - `priority`（L1 真实列，0-100）：写入时的重要性先验；
 * - `usage.used`（recall-usage，进 topN 被注入才计）：被反复用到 = 越"确立"；
 * - `agingWeight`（读路径衰减系数 0.5~1，null=关）：新鲜度；
 * - `mark`（人在召回卡上打的 -1..5，**只看最近一笔**）：显式的人工裁决。
 *
 * 人工标记是**加性**项（±W_MARK），不是权重再分配：未打分时贡献恒为 0，
 * 与三输入时代的分值**逐字相等**（旧回归断言不会因新增一项而漂）。
 * 档位设计（用户口径：0/1/2 拉低、4/5 抬高）：0/1/2 为负、3 中性、4/5 为正；
 * `-1`（声明过时）**不在此计分**——它走退场，若再计一次罚就是同一件事罚两遍。
 *
 * 刻意**读时派生、不落库**（Agent B/C 结论）：落库会在每轮 recordAttempt 触发双写 + 值随时间陈旧，
 * 且顶层列不进快照哈希=隐形改写。各输入即时可得，纯函数零 IO。
 *
 * 权重/阈值集中为常量，便于回归与调参；缺 usage（未装配）按 0 强化处理（不虚构成熟度）。
 */
export type Maturity = 'low' | 'mid' | 'high';

export interface MaturityUsage {
  used: number;
}

export interface MaturityInput {
  priority: number;
  usage?: MaturityUsage | null;
  /** 读路径老化权重（0.5~1）；null = 衰减关闭 → 视为 1（不惩罚）。 */
  agingWeight?: number | null;
  /**
   * 人给的最近一笔打分（-1..5）；未打分 = undefined/null → 贡献 0（逐字旧行为）。
   * `-1` 也按 0 处理：那条记录已经退场，不该在成熟度上再罚一次。
   */
  mark?: number | null;
}

const W_PRIORITY = 0.45;
const W_USAGE = 0.3;
const W_AGING = 0.25;
/** 人工标记的加性幅度（±0.3）：够让一档在强先验上被推翻，又不足以一票定生死。 */
const W_MARK = 0.3;
/** used 达到该数即满强化（再高不加分）。 */
const USAGE_SATURATE = 5;
const HIGH_THRESHOLD = 0.66;
const MID_THRESHOLD = 0.4;

/**
 * 打分 → 归一化人工信号（-1..1）。3 分与未打分同为中性。
 * 正侧只分两档（4 半、5 满）；负侧分三档渐次加重（2 轻罚 -0.4、1 中罚 -0.7、0 重罚 -1）——
 * “不相关”是个需要区分程度的否定，而“相关”不必分那么细。
 */
export function markSignal(mark: number | null | undefined): number {
  switch (mark) {
    case 5: return 1;
    case 4: return 0.5;
    case 2: return -0.4;
    case 1: return -0.7;
    case 0: return -1;
    default: return 0; // 3 / -1 / 未打分 / 越界值
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** 合成分值（0~1），导出供测试与未来排序复用。 */
export function maturityScore(i: MaturityInput): number {
  const p = clamp01(i.priority / 100);
  const u = i.usage ? clamp01(i.usage.used / USAGE_SATURATE) : 0;
  const a = i.agingWeight == null ? 1 : clamp01(i.agingWeight);
  return clamp01(W_PRIORITY * p + W_USAGE * u + W_AGING * a + W_MARK * markSignal(i.mark));
}

/** 三档成熟度：high ≥0.66、mid ≥0.40、否则 low。 */
export function computeMaturity(i: MaturityInput): Maturity {
  const s = maturityScore(i);
  if (s >= HIGH_THRESHOLD) return 'high';
  if (s >= MID_THRESHOLD) return 'mid';
  return 'low';
}
