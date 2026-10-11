/**
 * 技能结晶存储（轨2，程序性记忆）。**默认关**（config.skills.enabled）。
 *
 * 设计裁定（对齐计划轨2 + 三视角审计）：
 * - 技能**不是 memory `type`**，而是 L1 之上的**可重建派生投影**——因此完全不碰
 *   `ADD_TYPES` 白名单与蒸馏 prompt 词表，从根上规避 S1(白名单静默降级)/S2(词表产不出)/
 *   S3(family 前缀误归族) 三处静默腐化；证据来源 = 现有 `work_method` L1 记录。
 * - 落 **JSON sidecar**（仿 memory-sources/rooms-registry），不塞进 2691 行的 `sqlite.ts`：
 *   技能条目量小、distinct-session 计数内存聚合即可；缺失=合法空表、损坏=只读降级不阻塞。
 * - **`body`（人编辑）与 `steps`（机器聚合）分列**：机器侧可被重建投影覆盖，
 *   人编辑侧永久保留（对齐 rebuild-preserve 的"非派生内容不可被重建抹掉"不变量）。
 * - **只计数不晋升**（本轮）：`skill_evidence` 记录 distinct session，晋升需
 *   `count(distinct session) >= minSessions` 且功能开；新装库无历史即空转，符合预期。
 * - 归档 `archiveDue` 基于 `lastUsedAt` 闲置天数（机械比较，0 LLM、不引入 timer）。
 */
import * as path from 'node:path';
import { readJsonStrict, atomicWriteText, ensureDir } from '../util/io.js';
export const SKILL_STORE_FILE_VERSION = 1;
const SKILLS_CAP = 500;
const EVIDENCE_CAP = 20_000;
const TITLE_MAX = 120;
const BODY_MAX = 8000;
const STEP_MAX = 40;
const KEYWORDS_MAX = 16;
const TIER_SET = new Set(['full', 'excerpt', 'hint']);
const STATUS_SET = new Set(['candidate', 'active', 'archived']);
function str(v, def = '') {
    return typeof v === 'string' ? v : def;
}
function normTier(v) {
    return TIER_SET.has(v) ? v : 'excerpt';
}
function normStatus(v) {
    return STATUS_SET.has(v) ? v : 'candidate';
}
/** 规整一条技能（读取侧 fail-soft：非法值归一到合法域，绝不因单条脏数据拖垮整表）。 */
function coerceSkill(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const r = raw;
    const id = str(r.id);
    const title = str(r.title).slice(0, TITLE_MAX);
    if (!id || !title)
        return null;
    return {
        id,
        title,
        body: str(r.body).slice(0, BODY_MAX),
        steps: Array.isArray(r.steps) ? r.steps.filter((s) => typeof s === 'string').slice(0, STEP_MAX) : [],
        trigger: {
            hall: typeof r.trigger?.hall === 'string' ? str(r.trigger.hall) : undefined,
            sceneName: typeof r.trigger?.sceneName === 'string' ? str(r.trigger.sceneName) : undefined,
            keywords: Array.isArray(r.trigger?.keywords)
                ? r.trigger.keywords.filter((k) => typeof k === 'string' && k !== '').slice(0, KEYWORDS_MAX)
                : [],
            workspaceId: typeof r.trigger?.workspaceId === 'string' ? str(r.trigger.workspaceId) : undefined,
        },
        injectionTier: normTier(r.injectionTier),
        status: normStatus(r.status),
        pinned: r.pinned === true,
        confidence: typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? Math.max(0, Math.min(1, r.confidence)) : 0,
        family: r.family === 'work' ? 'work' : 'chat',
        scope: r.scope === 'workspace' ? 'workspace' : 'global',
        evidenceRecordIds: Array.isArray(r.evidenceRecordIds) ? r.evidenceRecordIds.filter((x) => typeof x === 'string').slice(0, 200) : [],
        createdAt: str(r.createdAt),
        updatedAt: str(r.updatedAt),
        lastUsedAt: str(r.lastUsedAt),
        archivedReason: typeof r.archivedReason === 'string' ? r.archivedReason : undefined,
    };
}
export class SkillStore {
    logger;
    file;
    skills = [];
    evidence = [];
    rev = 0;
    loaded = false;
    degraded;
    degradedLogged = false;
    writeChain = Promise.resolve();
    seq = 0;
    constructor(dataDir, logger) {
        this.logger = logger;
        this.file = path.join(dataDir, 'skills.json');
    }
    async init() {
        await ensureDir(path.dirname(this.file));
        const read = await readJsonStrict(this.file);
        if (!read.ok) {
            if (read.reason !== 'missing') {
                this.degraded = `${read.reason}${'detail' in read && read.detail ? `: ${read.detail}` : ''}`;
                this.logger?.warn(`[memory] 技能存储只读降级（内存态照常，停止回写）: ${this.degraded}`);
            }
            this.loaded = true;
            return;
        }
        if (read.value.version !== SKILL_STORE_FILE_VERSION) {
            this.logger?.warn(`[memory] 技能存储版本 ${String(read.value.version)} 未知，按当前形状读取`);
        }
        if (Array.isArray(read.value.skills)) {
            for (const raw of read.value.skills) {
                const s = coerceSkill(raw);
                if (s)
                    this.skills.push(s);
            }
        }
        if (Array.isArray(read.value.evidence)) {
            for (const e of read.value.evidence) {
                if (e && typeof e.skillId === 'string' && typeof e.sessionId === 'string')
                    this.evidence.push(e);
            }
        }
        this.rev = typeof read.value.rev === 'number' ? read.value.rev : 0;
        // 序号续接：避免重启后铸出重复 skill id。
        this.seq = this.skills.length;
        this.loaded = true;
    }
    ensureLoaded() {
        if (!this.loaded)
            throw new Error('技能存储未初始化（先 await init()）');
    }
    list() {
        this.ensureLoaded();
        return this.skills.map((s) => ({ ...s, steps: [...s.steps], trigger: { ...s.trigger, keywords: [...s.trigger.keywords] }, evidenceRecordIds: [...s.evidenceRecordIds] }));
    }
    /** active 技能（注入候选）。 */
    listActive() {
        return this.list().filter((s) => s.status === 'active');
    }
    get(id) {
        this.ensureLoaded();
        const s = this.skills.find((x) => x.id === id);
        return s ? { ...s, steps: [...s.steps], trigger: { ...s.trigger, keywords: [...s.trigger.keywords] }, evidenceRecordIds: [...s.evidenceRecordIds] } : undefined;
    }
    newId() {
        this.seq++;
        return 'sk-' + Date.now().toString(36) + '-' + this.seq.toString(36);
    }
    /** 新建技能（幂等：显式传 id 且已存在 → 走 updateBody 语义由调用方决定，这里仅拒绝重复 id）。 */
    async create(input) {
        this.ensureLoaded();
        if (this.skills.length >= SKILLS_CAP)
            throw new Error(`技能数已达上限（${SKILLS_CAP}），请归档部分`);
        const id = (input.id ?? '').trim() || this.newId();
        if (this.skills.some((s) => s.id === id))
            throw new Error(`技能 id 已存在: ${id}`);
        const title = String(input.title ?? '').trim().slice(0, TITLE_MAX);
        if (!title)
            throw new Error('技能 title 不能为空');
        const now = new Date().toISOString();
        const skill = {
            id,
            title,
            body: String(input.body ?? '').slice(0, BODY_MAX),
            steps: (input.steps ?? []).filter((x) => typeof x === 'string').slice(0, STEP_MAX),
            trigger: {
                hall: input.trigger?.hall?.trim() || undefined,
                sceneName: input.trigger?.sceneName?.trim() || undefined,
                keywords: (input.trigger?.keywords ?? []).filter((k) => k).slice(0, KEYWORDS_MAX),
                workspaceId: input.trigger?.workspaceId || undefined,
            },
            injectionTier: normTier(input.injectionTier),
            status: normStatus(input.status),
            pinned: false,
            confidence: 0,
            family: input.family === 'chat' ? 'chat' : 'work',
            scope: input.scope === 'workspace' ? 'workspace' : 'global',
            evidenceRecordIds: (input.evidenceRecordIds ?? []).slice(0, 200),
            createdAt: now,
            updatedAt: now,
            lastUsedAt: '',
        };
        this.skills.push(skill);
        this.rev++;
        await this.persist();
        return { ...skill };
    }
    /** 编辑人可读正文（body/title/steps/injectionTier/pinned）；只动提供的字段。 */
    async update(id, patch) {
        this.ensureLoaded();
        const s = this.skills.find((x) => x.id === id);
        if (!s)
            return false;
        let changed = false;
        if (typeof patch.title === 'string' && patch.title.trim()) {
            s.title = patch.title.trim().slice(0, TITLE_MAX);
            changed = true;
        }
        if (typeof patch.body === 'string') {
            s.body = patch.body.slice(0, BODY_MAX);
            changed = true;
        }
        if (Array.isArray(patch.steps)) {
            s.steps = patch.steps.filter((x) => typeof x === 'string').slice(0, STEP_MAX);
            changed = true;
        }
        if (patch.injectionTier !== undefined && TIER_SET.has(patch.injectionTier)) {
            s.injectionTier = patch.injectionTier;
            changed = true;
        }
        if (patch.pinned !== undefined && patch.pinned !== s.pinned) {
            s.pinned = patch.pinned;
            changed = true;
        }
        if (!changed)
            return false;
        s.updatedAt = new Date().toISOString();
        this.rev++;
        await this.persist();
        return true;
    }
    /** 追加一条证据（只追加）；返回该技能当前的 distinct-session 数。 */
    async appendEvidence(ev) {
        this.ensureLoaded();
        if (!this.skills.some((s) => s.id === ev.skillId))
            return 0;
        this.evidence.push(ev);
        if (this.evidence.length > EVIDENCE_CAP)
            this.evidence.splice(0, this.evidence.length - EVIDENCE_CAP);
        this.rev++;
        await this.persist();
        return this.sessionCount(ev.skillId);
    }
    /** 某技能的 distinct session 计数（晋升判据的唯一来源，与 LLM 判断解耦）。 */
    sessionCount(skillId) {
        this.ensureLoaded();
        const s = new Set();
        for (const e of this.evidence)
            if (e.skillId === skillId && e.sessionId)
                s.add(e.sessionId);
        return s.size;
    }
    /**
     * 晋升：candidate→active，仅当功能开且该技能 distinct-session ≥ minSessions。
     * 返回是否发生晋升。不批量、不依赖 LLM（可解释性结构保证，同 conflictFreeze"不自动裁决"哲学）。
     */
    async tryPromote(skillId, minSessions, opts) {
        this.ensureLoaded();
        if (!opts.allowPromote)
            return false;
        const s = this.skills.find((x) => x.id === skillId);
        if (!s || s.status !== 'candidate')
            return false;
        if (this.sessionCount(skillId) < minSessions)
            return false;
        s.status = 'active';
        s.updatedAt = new Date().toISOString();
        this.rev++;
        await this.persist();
        return true;
    }
    /** 记一次使用（刷新 lastUsedAt，供闲置归档与"只用才强化"）。 */
    async touchUsed(skillId, at) {
        return this.patchOne(skillId, (s) => {
            s.lastUsedAt = at;
        });
    }
    /** 归档（active/candidate→archived）；记录原因。走本表独立生命周期，不触碰 l1_records 退场。 */
    async archive(skillId, reason) {
        this.ensureLoaded();
        const s = this.skills.find((x) => x.id === skillId);
        if (!s || s.status === 'archived')
            return false;
        s.status = 'archived';
        s.archivedReason = reason;
        s.updatedAt = new Date().toISOString();
        this.rev++;
        await this.persist();
        return true;
    }
    /**
     * 闲置归档：active 且未 pinned 且（now - lastUsedAt）> idleDays 的技能自动归档。
     * 机械比较、0 LLM、不引入 timer（对齐 slots.expireDue 范式）。返回归档条数。
     */
    async archiveDue(now, idleDays) {
        this.ensureLoaded();
        if (idleDays <= 0)
            return 0;
        const cutoff = now - idleDays * 86_400_000;
        let n = 0;
        for (const s of this.skills) {
            if (s.status !== 'active' || s.pinned)
                continue;
            const last = s.lastUsedAt ? Date.parse(s.lastUsedAt) : Date.parse(s.updatedAt || s.createdAt);
            if (Number.isFinite(last) && last < cutoff) {
                s.status = 'archived';
                s.archivedReason = `idle>${idleDays}d`;
                s.updatedAt = new Date(now).toISOString();
                n++;
            }
        }
        if (n) {
            this.rev++;
            await this.persist();
        }
        return n;
    }
    async patchOne(id, mut) {
        this.ensureLoaded();
        const s = this.skills.find((x) => x.id === id);
        if (!s)
            return false;
        mut(s);
        s.updatedAt = new Date().toISOString();
        this.rev++;
        await this.persist();
        return true;
    }
    /** 写穿持久化（串行链；失败降级内存态并告警一次，绝不抛出阻塞调用方）。 */
    async persist() {
        if (this.degraded)
            return;
        this.writeChain = this.writeChain.then(async () => {
            const data = { version: SKILL_STORE_FILE_VERSION, rev: this.rev + 1, skills: this.skills, evidence: this.evidence };
            try {
                await ensureDir(path.dirname(this.file));
                await atomicWriteText(this.file, JSON.stringify(data, null, 2));
                this.rev = data.rev;
            }
            catch (err) {
                this.degraded = err instanceof Error ? err.message : String(err);
                if (!this.degradedLogged) {
                    this.degradedLogged = true;
                    this.logger?.warn(`[memory] 技能存储写入失败，只读降级: ${this.degraded}`);
                }
            }
        });
        await this.writeChain;
    }
}
