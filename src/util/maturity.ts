/**
 * 成熟度（maturity）合成——G3，单一事实源的纯函数。
 *
 * 把三个**已存在**的信号合成一个可解释的置信档，供面板显示（后续可作召回排序/矛盾旁注）：
 * - `priority`（L1 真实列，0-100）：写入时的重要性先验；
 * - `usage.used`（recall-usage，进 topN 被注入才计）：被反复用到 = 越"确立"；
 * - `agingWeight`（读路径衰减系数 0.5~1，null=关）：新鲜度。
 *
 * 刻意**读时派生、不落库**（Agent B/C 结论）：落库会在每轮 recordAttempt 触发双写 + 值随时间陈旧，
 * 且顶层列不进快照哈希=隐形改写。三输入即时可得，纯函数零 IO。
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
}

const W_PRIORITY = 0.45;
const W_USAGE = 0.3;
const W_AGING = 0.25;
/** used 达到该数即满强化（再高不加分）。 */
const USAGE_SATURATE = 5;
const HIGH_THRESHOLD = 0.66;
const MID_THRESHOLD = 0.4;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** 合成分值（0~1），导出供测试与未来排序复用。 */
export function maturityScore(i: MaturityInput): number {
  const p = clamp01(i.priority / 100);
  const u = i.usage ? clamp01(i.usage.used / USAGE_SATURATE) : 0;
  const a = i.agingWeight == null ? 1 : clamp01(i.agingWeight);
  return W_PRIORITY * p + W_USAGE * u + W_AGING * a;
}

/** 三档成熟度：high ≥0.66、mid ≥0.40、否则 low。 */
export function computeMaturity(i: MaturityInput): Maturity {
  const s = maturityScore(i);
  if (s >= HIGH_THRESHOLD) return 'high';
  if (s >= MID_THRESHOLD) return 'mid';
  return 'low';
}
