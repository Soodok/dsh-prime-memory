import type { MemoryFamily, MemoryLogger } from '../types.js';
export declare const SKILL_STORE_FILE_VERSION: 1;
export type SkillStatus = 'candidate' | 'active' | 'archived';
export type InjectionTier = 'full' | 'excerpt' | 'hint';
export interface SkillTrigger {
    /** 归属 wing/hall（粗分类）；缺省 = 不参与按域过滤。 */
    hall?: string;
    sceneName?: string;
    keywords: string[];
    workspaceId?: string;
}
export interface Skill {
    id: string;
    title: string;
    /** 人可编辑正文；进 preserve 白名单，重建不覆盖。 */
    body: string;
    /** 机器聚合的 checklist 步骤；重建投影可覆盖。 */
    steps: string[];
    trigger: SkillTrigger;
    injectionTier: InjectionTier;
    status: SkillStatus;
    pinned: boolean;
    confidence: number;
    family: MemoryFamily;
    scope: 'global' | 'workspace';
    /** 支撑该技能的证据记录 id（指向 l1_records.record_id，仅作溯源，不强约束外键）。 */
    evidenceRecordIds: string[];
    createdAt: string;
    updatedAt: string;
    lastUsedAt: string;
    archivedReason?: string;
}
export interface SkillEvidence {
    skillId: string;
    runId: string;
    recordId: string;
    sessionId: string;
    at: string;
    kind: string;
}
export interface NewSkillInput {
    id?: string;
    title: string;
    body?: string;
    steps?: string[];
    trigger?: Partial<SkillTrigger>;
    injectionTier?: InjectionTier;
    status?: SkillStatus;
    family?: MemoryFamily;
    scope?: 'global' | 'workspace';
    evidenceRecordIds?: string[];
}
export declare class SkillStore {
    private readonly logger?;
    private readonly file;
    private skills;
    private evidence;
    private rev;
    private loaded;
    private degraded;
    private degradedLogged;
    private writeChain;
    private seq;
    constructor(dataDir: string, logger?: MemoryLogger | undefined);
    init(): Promise<void>;
    private ensureLoaded;
    list(): Skill[];
    /** active 技能（注入候选）。 */
    listActive(): Skill[];
    get(id: string): Skill | undefined;
    private newId;
    /** 新建技能（幂等：显式传 id 且已存在 → 走 updateBody 语义由调用方决定，这里仅拒绝重复 id）。 */
    create(input: NewSkillInput): Promise<Skill>;
    /** 编辑人可读正文（body/title/steps/injectionTier/pinned）；只动提供的字段。 */
    update(id: string, patch: Partial<Pick<Skill, 'title' | 'body' | 'steps' | 'injectionTier' | 'pinned'>>): Promise<boolean>;
    /** 追加一条证据（只追加）；返回该技能当前的 distinct-session 数。 */
    appendEvidence(ev: SkillEvidence): Promise<number>;
    /** 某技能的 distinct session 计数（晋升判据的唯一来源，与 LLM 判断解耦）。 */
    sessionCount(skillId: string): number;
    /**
     * 晋升：candidate→active，仅当功能开且该技能 distinct-session ≥ minSessions。
     * 返回是否发生晋升。不批量、不依赖 LLM（可解释性结构保证，同 conflictFreeze"不自动裁决"哲学）。
     */
    tryPromote(skillId: string, minSessions: number, opts: {
        allowPromote: boolean;
    }): Promise<boolean>;
    /** 记一次使用（刷新 lastUsedAt，供闲置归档与"只用才强化"）。 */
    touchUsed(skillId: string, at: string): Promise<boolean>;
    /** 归档（active/candidate→archived）；记录原因。走本表独立生命周期，不触碰 l1_records 退场。 */
    archive(skillId: string, reason: string): Promise<boolean>;
    /**
     * 闲置归档：active 且未 pinned 且（now - lastUsedAt）> idleDays 的技能自动归档。
     * 机械比较、0 LLM、不引入 timer（对齐 slots.expireDue 范式）。返回归档条数。
     */
    archiveDue(now: number, idleDays: number): Promise<number>;
    private patchOne;
    /** 写穿持久化（串行链；失败降级内存态并告警一次，绝不抛出阻塞调用方）。 */
    private persist;
}
