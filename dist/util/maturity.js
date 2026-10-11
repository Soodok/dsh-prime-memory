const W_PRIORITY = 0.45;
const W_USAGE = 0.3;
const W_AGING = 0.25;
/** used 达到该数即满强化（再高不加分）。 */
const USAGE_SATURATE = 5;
const HIGH_THRESHOLD = 0.66;
const MID_THRESHOLD = 0.4;
function clamp01(x) {
    return Math.max(0, Math.min(1, x));
}
/** 合成分值（0~1），导出供测试与未来排序复用。 */
export function maturityScore(i) {
    const p = clamp01(i.priority / 100);
    const u = i.usage ? clamp01(i.usage.used / USAGE_SATURATE) : 0;
    const a = i.agingWeight == null ? 1 : clamp01(i.agingWeight);
    return W_PRIORITY * p + W_USAGE * u + W_AGING * a;
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
