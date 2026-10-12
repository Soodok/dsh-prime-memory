/** 一条路由规则。 */
export interface WorkspaceRoute {
    /** 命中后归到的 workspace（绝对路径；返回值已归一）。 */
    path: string;
    /** 命中任一关键词即归此路（大小写不敏感、已 NFKC 归一的子串匹配）。 */
    anyOf: readonly string[];
    /** 出现任一排除词则**此路**不命中（继续往下看下一条规则）。 */
    noneOf?: readonly string[];
}
/**
 * 按序取首个命中；全不命中返回 `undefined`（**宁缺勿猜**——归错 workspace 会让记忆在
 * 错误的工作区可见/不可见，比不归更难查）。
 *
 * 排序即优先级：调用方给的表里 dsh 侧在前，故"同一段内容既谈 Hanako 又谈 dsh"会归 dsh
 * 一侧（用户口径）；非 dsh 那条同时带 `noneOf: ['dsh']` 做二次保险。
 */
export declare function routeWorkspace(text: string, routes: readonly WorkspaceRoute[]): string | undefined;
/**
 * 路由结论与来源链结论**矛盾**时返回 true（来源链仅作交叉验证）。
 * 单独抽出是为了把"冲突要可观测"这条判据变成可测函数，而不是散在调用点的 if 里。
 */
export declare function routeConflictsWithProvenance(routed: string | undefined, provenance: string | undefined): boolean;
