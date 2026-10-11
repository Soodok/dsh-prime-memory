/**
 * 技能结晶检测（轨2，纯规则 0 token 0 IO）。
 *
 * 从 `work_method` 记忆**派生技能候选**——技能不是 memory `type`（不碰 ADD_TYPES/prompt 词表，
 * S1/S2/S3 不触发），而是对"跨会话重复出现的工作方法"的聚合投影（对齐 ADR-0007 可重建投影）。
 *
 * 本轮定位：**只提供确定性检测函数 + 手动工具路径，不自动挂进 runner 每轮热路径**
 * （接入 runner 会给每轮蒸馏加活儿，且需与攒批/层链协调——留作显式 opt-in 的后续增强）。
 * 检测是纯规则：按 (hall, scene) 分组，够 distinct-session 且够条数才成候选；
 * 候选默认 `status:'candidate'`，晋升仍由 SkillStore.tryPromote（且 cfg.skills.allowPromote
 * 默认关）单独把关——检测与晋升解耦，和 conflictFreeze"不自动裁决"同哲学。
 */
export interface MethodRecord {
    id: string;
    content: string;
    sessionId: string;
    hall?: string;
    sceneName?: string;
}
export interface CandidateProposal {
    /** 稳定派生 id：`skx-` + groupKey 哈希前缀，便于幂等（同组重复检测得同 id）。 */
    id: string;
    title: string;
    body: string;
    steps: string[];
    hall?: string;
    sceneName?: string;
    evidenceRecordIds: string[];
    sessions: string[];
}
export interface DetectOptions {
    minSessions: number;
    minEvidence: number;
    /** 每候选最多收录的步骤数（防单组爆炸）。 */
    maxSteps?: number;
}
/**
 * 检测候选：按 groupKey 聚合 work_method 记录，distinct-session ≥ minSessions 且
 * 去重后内容条数 ≥ minEvidence 的组，产出一条 candidate 提案（按 groupKey 排序，确定性）。
 */
export declare function detectCandidates(records: MethodRecord[], opts: DetectOptions): CandidateProposal[];
