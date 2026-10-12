/**
 * 记忆的 **内容路由**（workspace 归属）：按「这条记忆谈到哪个项目」给出归属路径。
 *
 * ## 为什么不是「来源会话反查」
 * 直觉做法是顺着 L1 → 来源会话 → 会话的工作目录往回推。实测三处都断：
 * - `l1_records.session_id` 恒为 `'default'`（蒸馏写入时用的是后台自己的会话标识，
 *   与来源对话无关）；
 * - `metadata.dsh_source_anchors` 里确实带 `sessionId`，但锚点覆盖率仅 69%，且其中
 *   能在磁盘会话树（`~/.dsh/sessions/<slug>/<uuid>`）找到目录的只有 **7.3%**——
 *   会话树会被清理/隔离，不能当持久事实源；
 * - L1 的 `timestamp_str` 与 L0 的 `recorded_at` / `timestamp` 两列**零命中**
 *   （L1 时间戳来自抽取回显，不是消息元数据）。
 *
 * 内容路由不受这些缺失影响：**内容自己说它属于哪个项目**。这也与人的归类习惯一致
 * （谈 dsh 生态的收到 dsh 项目下，谈 Hanako/inferglow 且与 dsh 无关的收到另一个项目）。
 *
 * ## 只写归属列，不动可见性
 * 返回值只用于填 `l1_records.workspace_id`；**`scope` 一律不改**。
 * 理由：`resolveRecordScope` 规则③ 刻意在 `cfg.scope='global'` 时不写归属，以保证既有
 * 部署零漂移；而检索可见性判据是 `scope` + `workspace_id` 的组合（`isScopeVisible`），
 * 单改 `workspace_id` 在 `scope='global'` 下不产生任何过滤差异。
 * 所以本路由是「**先把事实存下来**」：将来真启用 workspace 围栏时它是现成的正确依据，
 * 今天则一行行为都不改变。
 */
import { normalizeWorkspacePath } from './workspace.js';
/** 归一：NFKC + 小写 + 空白折叠（与 `memport/format.normText` 同口径，不另造一套）。 */
function norm(s) {
    return s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}
/**
 * 按序取首个命中；全不命中返回 `undefined`（**宁缺勿猜**——归错 workspace 会让记忆在
 * 错误的工作区可见/不可见，比不归更难查）。
 *
 * 排序即优先级：调用方给的表里 dsh 侧在前，故"同一段内容既谈 Hanako 又谈 dsh"会归 dsh
 * 一侧（用户口径）；非 dsh 那条同时带 `noneOf: ['dsh']` 做二次保险。
 */
export function routeWorkspace(text, routes) {
    const hay = norm(text);
    if (hay.length === 0)
        return undefined;
    for (const route of routes) {
        const target = typeof route.path === 'string' ? route.path.trim() : '';
        if (target.length === 0)
            continue;
        const excluded = (route.noneOf ?? []).some((word) => word.length > 0 && hay.includes(norm(word)));
        if (excluded)
            continue;
        const hit = (route.anyOf ?? []).some((word) => word.length > 0 && hay.includes(norm(word)));
        if (!hit)
            continue;
        // 归一失败（空串/非法路径）时**不写**：路由表写错不该污染归属列。
        const normalized = normalizeWorkspacePath(target);
        if (normalized)
            return normalized;
    }
    return undefined;
}
/**
 * 路由结论与来源链结论**矛盾**时返回 true（来源链仅作交叉验证）。
 * 单独抽出是为了把"冲突要可观测"这条判据变成可测函数，而不是散在调用点的 if 里。
 */
export function routeConflictsWithProvenance(routed, provenance) {
    if (!routed || !provenance)
        return false;
    return normalizeWorkspacePath(routed) !== normalizeWorkspacePath(provenance);
}
