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
export function markSignal(mark) {
    switch (mark) {
        case 5: return 1;
        case 4: return 0.5;
        case 2: return -0.4;
        case 1: return -0.7;
        case 0: return -1;
        default: return 0; // 3 / -1 / 未打分 / 越界值
    }
}
function clamp01(x) {
    return Math.max(0, Math.min(1, x));
}
/** 合成分值（0~1），导出供测试与未来排序复用。 */
export function maturityScore(i) {
    const p = clamp01(i.priority / 100);
    const u = i.usage ? clamp01(i.usage.used / USAGE_SATURATE) : 0;
    const a = i.agingWeight == null ? 1 : clamp01(i.agingWeight);
    return clamp01(W_PRIORITY * p + W_USAGE * u + W_AGING * a + W_MARK * markSignal(i.mark));
}
/** 三档成熟度：high ≥0.66、mid ≥0.40、否则 low。 */
export function computeMaturity(i) {
    const s = maturityScore(i);
    if (s >= HIGH_THRESHOLD)
        return 'high';
    if (s >= MID_THRESHOLD)
        return 'mid';
    return 'low';
}
