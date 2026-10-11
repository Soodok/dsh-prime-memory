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
import { normText, recordId } from './format.js';
/** 相似度阈值（与 memport.py DEFAULT_* 一致）。 */
export const DEFAULT_DUP_T = 0.62;
export const DEFAULT_REL_T = 0.30;
/** n-gram 集合（按码点滑窗，unicode 安全；len≤n 时整体作单 gram）。镜像 gram_set。 */
export function gramSet(s, n = 3) {
    const t = Array.from(normText(s).toLowerCase());
    if (t.length <= n)
        return t.length ? [t.join('')].reduce((acc, x) => acc.add(x), new Set()) : new Set();
    const out = new Set();
    for (let i = 0; i + n <= t.length; i++)
        out.add(t.slice(i, i + n).join(''));
    return out;
}
export function jaccard(a, b) {
    if (a.size === 0 || b.size === 0)
        return 0;
    let inter = 0;
    for (const x of a)
        if (b.has(x))
            inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
}
/** Dice 系数：对长度差异比 Jaccard 宽容，中文改写场景召回更好。 */
export function dice(a, b) {
    if (a.size === 0 || b.size === 0)
        return 0;
    let inter = 0;
    for (const x of a)
        if (b.has(x))
            inter++;
    return (2 * inter) / (a.size + b.size);
}
/** 一对（已预计算 gram）的相似度：max(3g Jaccard, 2g Dice)，round 4。镜像 score_pair。 */
export function scorePair(g3, g2, h3, h2) {
    return Math.round(Math.max(jaccard(g3, h3), dice(g2, h2)) * 1e4) / 1e4;
}
/**
 * 四桶预筛：对每条待导入记录，先按内容哈希查 dup，再对基线取 top-3 相似按阈值分档；
 * 基线未命中时兜底比对本包内前序条目（导出侧应已合并，这里拦包内近重复）。
 * 镜像 cmd_plan 的分类段（不含 temporal_diff——那属上层裁决增强，非本层职责）。
 */
export function plan(records, existing, opts = {}) {
    const dupT = opts.dupThreshold ?? DEFAULT_DUP_T;
    const relT = opts.relThreshold ?? DEFAULT_REL_T;
    const srcTag = opts.srcTag ?? '';
    const byHash = new Map();
    for (const r of existing)
        if (!byHash.has(r.hash))
            byHash.set(r.hash, r);
    const exGrams = existing.map((r) => ({ r, g3: gramSet(r.content, 3), g2: gramSet(r.content, 2) }));
    const rows = [];
    const counts = { new: 0, dup: 0, 'near-dup': 0, 'conflict-candidate': 0 };
    const bundleGrams = [];
    for (const rec of records) {
        const rid = recordId(srcTag, rec.hash);
        const hit = byHash.get(rec.hash);
        let verdict = 'new';
        let matched = [];
        let reason = '基线中无相关内容';
        if (hit) {
            verdict = 'dup';
            matched = [{ id: hit.id, score: 1, hash: hit.hash, content: hit.content }];
            reason = `内容哈希与现存 ${hit.id} 完全一致`;
        }
        else {
            const c3 = gramSet(rec.content, 3);
            const c2 = gramSet(rec.content, 2);
            const scored = exGrams
                .map(({ r, g3, g2 }) => ({ id: r.id, score: scorePair(c3, c2, g3, g2), hash: r.hash, content: r.content }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 3);
            const best = scored[0];
            if (best && best.score >= dupT) {
                verdict = 'near-dup';
                matched = scored.filter((s) => s.score >= relT);
                reason = `与现存 ${best.id} 相似度 ${best.score.toFixed(2)}，疑似同一事实的另一种表述`;
            }
            else if (best && best.score >= relT) {
                verdict = 'conflict-candidate';
                matched = scored.filter((s) => s.score >= relT);
                reason = `与现存 ${best.id} 主题相关（相似度 ${best.score.toFixed(2)}），需判定互补还是矛盾`;
            }
            // 包内近重复兜底
            if (verdict === 'new' && bundleGrams.length) {
                let ibest = null;
                let iscore = 0;
                for (const prev of bundleGrams) {
                    const sc = scorePair(c3, c2, prev.g3, prev.g2);
                    if (sc > iscore) {
                        iscore = sc;
                        ibest = prev.rec;
                    }
                }
                if (ibest && iscore >= relT) {
                    const near = iscore >= dupT;
                    verdict = near ? 'near-dup' : 'conflict-candidate';
                    matched = [{ id: `bundle#${ibest.seq}`, score: iscore, hash: ibest.hash, content: ibest.content }];
                    reason = `与本包第 ${ibest.seq} 条相似度 ${iscore.toFixed(2)}` + (near ? '（包内近重复，导出侧应先合并）' : '（包内相关条目，需判定）');
                }
            }
            bundleGrams.push({ rec, g3: gramSet(rec.content, 3), g2: gramSet(rec.content, 2) });
        }
        counts[verdict]++;
        rows.push({
            seq: rec.seq,
            id: rid,
            hash: rec.hash,
            typeFull: rec.typeFull,
            content: rec.content,
            verdict,
            matched,
            reason,
        });
    }
    return { rows, counts };
}
