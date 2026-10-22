/**
 * L1 蒸馏:抽取(情境切分 + 记忆提取)→ 去重(冲突检测 + 合并)→ 写入。
 *
 * 流程(官方管线语义):抽取 prompt 分块跑(按 llm.maxInputChars 预算,情境链式
 * 衔接)→ 去重候选按族召回 → 批量冲突检测 prompt → 决策应用:新记录追加进事实源,
 * 被替换目标只从检索库删除。 族隔离贯穿始终:去重候选只在同族内,合并产物保持
 * 新记忆的族标签。
 */
import { randomBytes } from 'node:crypto';
import { normWingEnabled } from '../config.js';
import { callLLM, parseJsonLogged, resolveLayerTokens } from '../llm.js';
import { buildReceipts, newRunId, persistReceiptsSafely } from '../store/receipts.js';
import { buildConflictPair, conflictRejectId, DEFER_MAX, normalizeClaimKey, normalizeConflictType, occupiesConflictQuota, pendingHardTotal, validateConflictPair, } from '../store/conflicts.js';
import { formatExtractionPrompt, getExtractMemoriesSystemPrompt } from '../prompts/l1-extraction.js';
import { normTags, normUsageScenario, readCognitiveHall, readWing } from '../metadata-validators.js';
import { acceptTitle } from '../util/md-name.js';
import { formatBatchConflictPrompt, getConflictDetectionSystemPrompt } from '../prompts/l1-dedup.js';
import { resolveSourceAnchors, withSourceAnchors } from './anchors.js';
import { stampValidity, validToSourceOf } from '../store/validity.js';
import { familyForType, normPersistence, normScope, resolveRecordFamily, resolveRecordScope, WING_FALLBACK } from '../types.js';
import { normApplicability, resolveRepoScope } from '../repo-scope.js';
import { routeWorkspace } from '../workspace-route.js';
/**
 * L1 抽取单块字符硬顶(修复 #10 分批过大)
 *
 * `cfg.llm.maxInputChars` 的语义是「单次 LLM 调用输入闸门」(默认 700k),被复用为
 * 分块预算时算出 658k/块——一次输出须在同一 JSON 数组写完全部抽出记忆,块越大字符串越多,
 * 任一处长中文里未转义 ASCII `"` 即整批 parse 失败、该块记忆全丢;慢模型更直接撞 120s 超时。
 * 砍到 24k 后输出 ≈2–4k tokens,仍远低于 LAYER_MAX_TOKENS_EXTRACT(16k),不会引入截断,
 * 单块失败半径从「几百条」缩到「几十条」。代价是多几次小调用,但每次 5–15s 完成。
 */
const MAX_EXTRACT_CHUNK_CHARS = 24_000;
/**
 * L1 去重单批发起上限(与抽取同精神)
 *
 * 旧版一次将整批 extracted[] 丢给 formatBatchConflictPrompt 发单次 LLM 调用,候选召回默认
 * 每新记忆 10 个 → batch=100 时 prompt 轻松上 500k 字符,同样命中 #10 的失败面。按
 * 固定条数切块(同族内不跨子集),失败半径缩到 ≤20 条,且每块上下文仍足够。
 * 上限 20 为工程默认,后续可提到配置。
 */
const MAX_DEDUP_BATCH_SIZE = 20;
/** 解析 ISO/epoch 时间证据,非法或非正值一律 undefined——不猜测。 */
function parseTimeEvidence(raw) {
    const t = typeof raw === 'string' ? Date.parse(raw) : typeof raw === 'number' ? raw : Number.NaN;
    return Number.isFinite(t) && t > 0 ? t : undefined;
}
/**
 * 抽取产出的 metadata → 记录的时间轴。
 *
 * `activity_start_time`/`activity_end_time` 是这两列的前身(prompt 已在产出),
 * 这里把它们提升为结构化字段;`persistence` 由 prompt 产出,缺省即未判定。
 * valid_to 源自 activity_* 证据链 → `validToSource='evidence'`(task_2.5 打标)。
 */
function temporalOf(meta) {
    const validTo = parseTimeEvidence(meta?.activity_end_time);
    return {
        validFrom: parseTimeEvidence(meta?.activity_start_time),
        validTo,
        persistence: normPersistence(meta?.persistence),
        ...(validTo !== undefined ? { validToSource: 'evidence' } : {}),
    };
}
/**
 * 合并(merge/update)时的有效期并集:
 * 起 = 两侧最早;止 = 任一侧未闭合则仍未闭合(undefined),否则取最晚。
 * 持续性以新记忆为准(合并产物描述的是当前认知),新记忆未判定时继承旧记录。
 * validToSource 随**胜出值**的来源走(task_2.5):最终 valid_to 取自哪一侧,
 * 证据等级就读哪一侧的(旧行取其 `dsh_validity` 标注,未标注算 'unknown'——
 * 宁判疑不判死,fail-open 与 classify 同向)。
 */
function mergeTemporal(self, targets) {
    const froms = [self.validFrom, ...targets.map((r) => r.validFrom)].filter((t) => t !== undefined);
    const tos = [
        { v: self.validTo, s: self.validToSource ?? 'unknown' },
        ...targets.map((r) => ({ v: r.validTo, s: validToSourceOf(r.metadata) })),
    ];
    const anyOpen = tos.some((e) => e.v === undefined);
    const closed = tos.filter((e) => e.v !== undefined);
    const winner = closed.length > 0 ? closed.reduce((a, b) => (b.v > a.v ? b : a)) : undefined;
    return {
        validFrom: froms.length > 0 ? Math.min(...froms) : undefined,
        validTo: anyOpen || winner === undefined ? undefined : winner.v,
        persistence: self.persistence ?? targets.find((r) => r.persistence)?.persistence,
        ...(!anyOpen && winner !== undefined ? { validToSource: winner.s } : {}),
    };
}
/**
 * 构造一条**全新**L1 记录(store 语义)。§C 冻结复用同一构造:
 * "新记忆照常入 L1"必须与既有 store 路径**逐字段一致**,否则冻结会引入
 * 一种只在开启开关时才出现的新记录形状。
 *
 * 第 4 个参数是 R7 的锚点映射(`L0 消息 id → 会话坐标`)。**传 undefined 时
 * 行为与改动前逐字一致**——老调用方与没有锚点的会话走这条分支。
 */
/**
 * 把抽取侧的 `metadata.usageScenario` 归一到命名空间保留键 `dsh_usage_scenario`
 *（与 dsh_source_anchors 同范式）。**无该键时原样返回**——功能关时 LLM 不产出该键，
 * 记录 metadata 与改动前逐字一致（零漂移）。只随新蒸馏写，不回填存量。
 */
function withUsageScenario(meta) {
    if (!meta || !('usageScenario' in meta))
        return meta;
    const out = { ...meta };
    out.dsh_usage_scenario = normUsageScenario(out.usageScenario);
    delete out.usageScenario;
    return out;
}
/** 把“可能是数组的 metadata 值”读成字符串数组（不是数组就当空，不猜）。 */
function asStrings(v) {
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length > 0) : [];
}
/**
 * 合并时的检索轴并集（P0-c）。
 *
 * 此前合并产物只带新记忆的 metadata，targets 的 tags/hall/cogHall/使用场景全丢——
 * 一次合并就把这条记忆从它原来的 Room/Wing 里摘出去，而面板上看不出任何异常（F2）。
 * 这里只并**检索轴**：派生评价（maturity/usage/rating）与内容层字段不在其列。
 *
 * 单值轴（hall/cogHall）两侧互斥时**保留新记忆侧并留痕**，不拼成 `"a,b"`——那会
 * 造出一个不存在的域（与 `isWingId` 的值域约束相冲）。
 *
 * @param self - 新记忆自己的 metadata（可为 undefined）。
 * @param targets - 被合并掉的旧记录们的 metadata。
 * @returns 并集后的 metadata 与若干条“丢了什么”的留痕文案。
 */
export function mergeAxes(self, targets) {
    const out = { ...(self ?? {}) };
    const notes = [];
    const list = targets.filter((m) => m !== undefined);
    // tags 是 Room 的构成单元（自生长分类）：并集去重后**仍过 normTags**，
    // 长度与字符纪律不因合并而放宽。
    const tags = normTags([...asStrings(out.tags), ...list.flatMap((m) => asStrings(m.tags))], 6);
    if (tags.length > 0)
        out.tags = tags;
    // 使用场景：同样并集，但维持≤ 3 的既有上限（多了会灌 prompt）。
    const sc = normUsageScenario([...asStrings(out.dsh_usage_scenario), ...list.flatMap((m) => asStrings(m.dsh_usage_scenario))]);
    if (sc.length > 0)
        out.dsh_usage_scenario = sc;
    // Room 待评审状态要跟着走，否则合并把“待评审”洗成“未标注”、下轮反刍重新入队。
    const cands = normTags([...asStrings(out.roomCandidates), ...list.flatMap((m) => asStrings(m.roomCandidates))], 6);
    if (cands.length > 0)
        out.roomCandidates = cands;
    if (out.roomReview === undefined) {
        const review = list.find((m) => typeof m.roomReview === 'string' && m.roomReview.length > 0)?.roomReview;
        if (review !== undefined)
            out.roomReview = review;
    }
    // 单值轴：新记忆已打标则不抢；没打标且目标侧只一个结论才继承，互斥则留痕不猜。
    const wingMine = readWing(out);
    if (wingMine === undefined) {
        const theirs = [...new Set(list.map((m) => readWing(m)).filter((v) => v !== undefined))];
        if (theirs.length === 1)
            out.hall = theirs[0];
        else if (theirs.length > 1)
            notes.push(`hall 目标侧互斥(${theirs.join('|')})，不猜`);
    }
    else {
        const theirs = new Set(list.map((m) => readWing(m)).filter((v) => v !== undefined));
        theirs.delete(wingMine);
        if (theirs.size > 0)
            notes.push(`hall 保留新记忆侧 ${wingMine}，目标侧 ${[...theirs].join('|')} 被舍`);
    }
    const cogMine = readCognitiveHall(out);
    if (cogMine === undefined) {
        // 认知 hall 的值是固定枚举（不是 string），故用 Set 收集而不是 `v is string` 谓词。
        const seen = new Set();
        for (const m of list) {
            const v = readCognitiveHall(m);
            if (v !== undefined)
                seen.add(v);
        }
        if (seen.size === 1)
            out.cogHall = [...seen][0];
    }
    return { metadata: out, notes };
}
/**
 * 导出仅供用例：`title → name` 这一跳是本计划的风隙（模型给的名字能不能落成合法身份名），
 * 而驱动整条 LLM 管线会把断言埋进抽取/去重两段的噪声里。与 `mergeAxes` 同一先例。
 */
export function toStoreRecord(m, now, ts, anchorMap) {
    // 名称蒸馏（Phase 3）：模型当场给的 title 只是**名字候选**，必须过同一个形状闸；
    // 过不了就**不写键**，交给 `L1Store.assignMissingNames`——判据只留一份，
    // 不在这里养第二套“看起来差不多”的名字清洗。
    const titled = m.title === undefined ? undefined : acceptTitle(m.title);
    // 时间轴派生单独算：validToSource 不进记录形状(它不是 MemoryRecord 字段，随展开
    // 落库会改 JSONL 形状)，只喂给 stampValidity 盖进 dsh_validity(task_2.5/3.2 写侧标注)。
    const t = temporalOf(m.metadata);
    const rec = {
        id: m.record_id,
        content: m.content,
        type: m.type,
        priority: Number(m.priority) || 60,
        scene_name: m.scene_name,
        timestamps: [Number.isNaN(ts) ? now : ts],
        createdAt: now,
        updatedAt: now,
        version: 0,
        source_message_ids: m.source_message_ids ?? [],
        // R7:锚点与 source_message_ids 同源解析;解析不到就**不写键**(不是空数组),
        // 使无锚点记录与改动前的 metadata 逐字一致。
        metadata: withSourceAnchors(withUsageScenario(m.metadata), anchorMap === undefined ? undefined : resolveSourceAnchors(m.source_message_ids, anchorMap)),
        family: m.family,
        scope: m.scope,
        workspaceId: m.workspaceId,
        // 治理归属(ADR-0015 T1.9/T1.10):进管线时一次算定(I-21 不得事后补录)。
        // 缺省**不写键**——无治理归属的记录与改动前的 JSONL/DB 形状逐字一致
        // (零形状漂移,withSourceAnchors 同款纪律);DB 侧列 DEFAULT 即标注。
        ...(m.repoKeyName ? { repoKeyName: m.repoKeyName } : {}),
        ...(m.repoKeyOwner ? { repoKeyOwner: m.repoKeyOwner } : {}),
        ...(m.applicability ? { applicability: m.applicability } : {}),
        ...(titled === undefined ? {} : { name: titled }),
        // 文件身份键不在这里分：**起名只有一个真源**（`L1Store.assignMissingNames`）。
        // 以前这里自己分一份、库里再分一份，两套判据迟早漂移，而漂移的后果是同一个基底
        // 洗出两个名字（文件跳名）或两个记录抢一个名字（整条写不进去）。
        validFrom: t.validFrom,
        validTo: t.validTo,
        persistence: t.persistence,
    };
    // 写侧标注(task_3.2 派生时机之一):管线盖时源头已知 evidence(LLM 直填/工具路径另算)。
    stampValidity(rec, now, t.validToSource);
    return rec;
}
function newId(prefix) {
    return `${prefix}_${Date.now()}_${randomBytes(3).toString('hex')}`;
}
/**
 * 按字符预算把消息切成多块(保持顺序,单条超预算独占一块,由 callLLM 兜底截断)。
 * 每条消息按 content 长度 + 64 字符脚手架开销(id/时间戳行)计。
 */
export function chunkByCharBudget(messages, budgetChars) {
    if (messages.length === 0)
        return [];
    const chunks = [];
    let cur = [];
    let curChars = 0;
    for (const m of messages) {
        const len = m.content.length + 64;
        if (cur.length > 0 && curChars + len > budgetChars) {
            chunks.push(cur);
            cur = [];
            curChars = 0;
        }
        cur.push(m);
        curChars += len;
    }
    if (cur.length > 0)
        chunks.push(cur);
    return chunks;
}
export async function runExtraction(ctx, cfg, store, states, pending, background, logger, mode, 
/**
 * §E 当前工作区标识(由调用方经 `sessionWorkspaceIdOf` 解析;拿不到传 undefined)。
 * 传 undefined 时行为与改动前**逐字一致**——`cfg.scope='global'` 的既有部署
 * 永远走这条分支,这是零漂移的构造性保证。
 */
workspaceId, 
/**
 * R7 锚点映射(`L0 消息 id → 会话坐标`),由调用方经 `buildAnchorMap` 构造。
 * **缺省时行为与改动前逐字一致**——传入的 `pending` 消息若不带锚点(老数据、
 * 未启用捕获侧打戳),`resolveSourceAnchors` 一律返回 undefined,不写 metadata 键。
 */
anchorMap, 
/**
 * 合并后的**派生数据搬运钩子**（P0-d）：旧 id → 新 id。使用史与人工标注存在
 * 另两个 sidecar 里，而 merge 每次新铸 id——不搬就等于每次合并把这条记忆的
 * `used`/人工打分清零，它会被当成“没用过”而沉底。缺省不搬（行为与改动前一致）。
 */
mergeRekey) {
    if (!cfg.extract.enabled)
        return { stored: 0, skipped: true, sceneName: chainHead(states, mode), newRecords: [] };
    // 触发阈值(渐进爬坡 + 按会话切片计数)由 runner 判定(trigger.ts);
    // 此处不再重复 gate——重建轮 force 与 warmup 早期轮次都会传入小于稳态值的切片。
    // 纯档强制族 = 档位族;auto 档抽取后的记录族按 type 前缀判定
    const forcedFamily = mode === 'auto' ? undefined : mode;
    // §E 归属模式(归一:非法/缺省值 → global,ADR-0008 条 4)
    const scopeMode = normScope(cfg.scope);
    // 候选池过滤值**只在 workspace 模式生效**——判断收在这一处,调用方无需自己判。
    // 若让它漏出去(比如调用方无条件传),`scope='global'` 的部署会被误过滤而破坏零漂移。
    const wsFilter = scopeMode === 'workspace' ? workspaceId : undefined;
    // 情境链锚点桶:纯档用本族;auto 用最近活跃的族(chainHead 同源)
    const chainState = mode === 'auto' ? activeState(states) : states[mode];
    // ── §C 安全阀(task_24):队列上限 + 超时降级 ──
    // 冻结的代价是消耗人的注意力。没有安全阀,队列会无界增长,且"新记忆与旧记忆
    // 长期并列召回"的状态会**永久**留在库里——比它想解决的问题更糟。
    // 语义是**回落自动裁决**(按 LLM 给出的 winner/loser 了结),而**不是**丢掉
    // 待裁决对:被自动了结的对仍写进 conflict_pending,只是 resolved_at 非空、
    // resolution='auto'。痕迹必须留下,否则"机器替人裁决"会以"悄悄发生"的形式回来。
    const freezeEnabled = cfg.conflictFreeze?.enabled === true;
    const maxPending = cfg.conflictFreeze?.maxPending ?? 0;
    const timeoutDays = cfg.conflictFreeze?.timeoutDays ?? 0;
    /** LLM 的 loser,将在新增记录写完后从检索库退场(自动裁决的执行面)。 */
    const autoLosers = new Set();
    if (freezeEnabled && timeoutDays > 0) {
        const cutoff = new Date(Date.now() - timeoutDays * 86_400_000).toISOString();
        try {
            // R1(task_2.3):超时扫描**排除钉子户**(复看已达上限的对不再被静默 auto)。
            // 未 defer 过的行走 `COALESCE` 退化路径 ⇒ 行为与升级前等价。
            const stale = store.listConflictPending({ createdBefore: cutoff, excludeDeferExhausted: true });
            for (const p of stale) {
                if (store.resolveConflictPending(p.pairId, 'auto', new Date().toISOString()) > 0) {
                    autoLosers.add(p.loserId);
                }
            }
            if (stale.length > 0) {
                logger.info(`[memory] 矛盾冻结:${stale.length} 对待裁决对超时 ${timeoutDays} 天,已自动了结`);
            }
        }
        catch (err) {
            logger.warn(`[memory] 矛盾冻结:超时扫描失败(忽略): ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    // ── Step 1: 抽取(输入按 llm.maxInputChars 预算分块,情境链式衔接,不丢消息) ──
    const backgroundMsgs = background.slice(-cfg.extract.backgroundMessages);
    // 预留:背景消息(≤10 条 ×4000 字)+ prompt 脚手架
    // 硬顶 24k(见 MAX_EXTRACT_CHUNK_CHARS 注释);若配置更小则跟随配置
    const perChunk = Math.min(MAX_EXTRACT_CHUNK_CHARS, Math.max(20_000, cfg.llm.maxInputChars - 42_000));
    const chunks = chunkByCharBudget(pending, perChunk);
    if (chunks.length > 1) {
        logger.info(`[memory] L1 输入超预算(${pending.length} 条消息),分 ${chunks.length} 块抽取(每块 ≤${perChunk} 字符)`);
    }
    const extracted = [];
    let lastScene = chainState.lastSceneName;
    let sceneCount = 0;
    // 治理归属(ADR-0015 T1.7/T1.9):repoKey=basename(归一 cwd),**进管线时一次算定**
    // (I-21 不得事后补录)。纯字符串派生,识别失败 = ''(不围栏 fail-open)。
    const repoScope = resolveRepoScope(workspaceId);
    // wing 打标候选(R14 归一化后的启用列表);general(跨域兜底)仅在 auto 档追加进候选
    const hallCandidates = normWingEnabled(cfg.hall?.enabled);
    const halls = mode === 'auto' && !hallCandidates.includes(WING_FALLBACK)
        ? [...hallCandidates, WING_FALLBACK]
        : hallCandidates;
    for (const chunk of chunks) {
        const userPrompt = formatExtractionPrompt({
            newMessages: chunk,
            backgroundMessages: backgroundMsgs,
            previousSceneName: lastScene || '无',
            halls,
        });
        const raw = await callLLM(ctx, cfg, {
            system: getExtractMemoriesSystemPrompt(mode, {
                usageScenario: cfg.usageScenario?.enabled === true,
                narrative: cfg.narrativeTemplates?.enabled === true,
                // 名称蒸馏（Phase 3）：示例段只在总开关开着时付（它与 title 是两层成本，
                // 分开开关才能 A/B）。关着时这份 opts 产出的提示与改动前逐字相同。
                title: cfg.naming?.enabled === true,
                fewShot: cfg.naming?.enabled === true && cfg.naming.fewShot === true,
            }),
            user: userPrompt,
            maxTokens: resolveLayerTokens(cfg, 'extract'),
            layer: 'l1-extract',
            logger,
        });
        const scenes = parseJsonLogged(raw, 'L1 抽取', logger);
        if (!Array.isArray(scenes))
            throw new Error('L1 抽取输出不是 JSON 数组');
        for (const scene of scenes) {
            if (!scene || typeof scene.scene_name !== 'string')
                continue;
            lastScene = scene.scene_name;
            sceneCount++;
            for (const m of scene.memories ?? []) {
                if (!m || typeof m.content !== 'string' || !m.content.trim())
                    continue;
                const family = resolveRecordFamily(forcedFamily, m.family, m.type ?? '');
                // 内容路由（`cfg.workspaceSource`，默认开）：按内容谈到哪个项目定归属。
                // 不走「来源会话反查」：session_id 恒为 default、锚点仅 7.3% 能定位到会话树，
                // 而内容自己说它属于哪个项目——不受这些缺失影响。见 `src/workspace-route.ts`。
                const routed = cfg.workspaceSource?.enabled === true
                    ? routeWorkspace(`${m.content}\n${scene.scene_name}`, cfg.workspaceSource.routes)
                    : undefined;
                extracted.push({
                    ...m,
                    // 开关关着时**不把 title 带进管线**：旧记录形状逐字不变（不新增键、不参与任何判据）。
                    ...(cfg.naming?.enabled === true && m.title !== undefined && m.title !== null
                        ? { title: m.title }
                        : {}),
                    record_id: newId('mem'),
                    scene_name: scene.scene_name,
                    family,
                    // §E 归属在**进管线时**一次算定,下游(store / conflict / update / merge 各分支)
                    // 一律复用它——四个分支各算一次是漏判的温床。
                    ...resolveRecordScope(scopeMode, family, workspaceId),
                    // 路由值只覆盖 `workspaceId`、**不动 `scope`**：`resolveRecordScope` 规则③ 在
                    // cfg.scope='global' 时故意把归属清成 ''(零漂移保证)，这里在其后补一个事实列。
                    // 可见性判据 `isScopeVisible` 先看 scope，global 即全可见 → 今天一行行为不变；
                    // 将来启用 workspace 围栏时这列已经是现成的正确依据。
                    ...(routed === undefined ? {} : { workspaceId: routed }),
                    // 治理归属(ADR-0015 T1.9/T1.10):repoKey 一次算定;applicability 由抽取
                    // prompt 显式产出、经归一收窄——**绝不从 family 推导**(P0-7 四象限),
                    // 未声明/非法 = ''(不围栏)。
                    repoKeyName: repoScope.repoKey,
                    repoKeyOwner: '',
                    applicability: normApplicability(m.applicability),
                });
            }
        }
    }
    if (extracted.length === 0) {
        logger.info(`[memory] L1 抽取完成:无可提取记忆(mode=${mode},${pending.length} 条消息,${sceneCount} 个情境)`);
        // 成功但零产出:同样推进时间戳/场景,与失败(lastExtractAt 保持 0)区分开
        markExtracted(states, mode, lastScene);
        return { stored: 0, skipped: false, sceneName: lastScene, newRecords: [] };
    }
    // ── Step 2: 去重(batch 冲突检测;候选只在本族内召回,去重永不跨族) ──
    const matches = await Promise.all(extracted.map(async (m) => ({
        newMemory: m,
        candidates: await store.searchCandidates(m.content, cfg.extract.candidatePool, m.family, wsFilter),
    })));
    // 按固定条数切块发送,失败半径与上下文同时可控(#10 去重侧同精)
    const dedupBatches = [];
    for (let i = 0; i < matches.length; i += MAX_DEDUP_BATCH_SIZE) {
        dedupBatches.push(matches.slice(i, i + MAX_DEDUP_BATCH_SIZE));
    }
    if (dedupBatches.length > 1) {
        logger.info(`[memory] L1 去重分为 ${dedupBatches.length} 批发送(每批 ≤${MAX_DEDUP_BATCH_SIZE} 条候选记忆)`);
    }
    const decisionsFlat = [];
    for (const [bi, batch] of dedupBatches.entries()) {
        const batchPrompt = formatBatchConflictPrompt(batch, {
            conflictFreeze: cfg.conflictFreeze.enabled,
        });
        const batchRaw = await callLLM(ctx, cfg, {
            system: getConflictDetectionSystemPrompt(mode, { conflictFreeze: cfg.conflictFreeze.enabled, title: cfg.naming?.enabled === true }),
            user: batchPrompt,
            maxTokens: resolveLayerTokens(cfg, 'dedup'),
            layer: 'l1-dedup',
            logger,
        });
        const batchDecisions = parseJsonLogged(batchRaw, `L1 去重判定${dedupBatches.length > 1 ? `(批 ${bi + 1}/${dedupBatches.length})` : ''}`, logger);
        if (Array.isArray(batchDecisions))
            decisionsFlat.push(...batchDecisions);
    }
    const byRecord = new Map();
    for (const d of decisionsFlat) {
        if (d && typeof d.record_id === 'string')
            byRecord.set(d.record_id, d);
    }
    // 去重决策统计:无决策的记录按 skip 处理,聚合成单行日志便于排查
    const actionCount = {};
    for (const m of extracted) {
        const action = byRecord.get(m.record_id)?.action ?? 'skip(未返回)';
        actionCount[action] = (actionCount[action] ?? 0) + 1;
    }
    const candidateTotal = matches.reduce((n, m) => n + m.candidates.length, 0);
    logger.info(`[memory] L1 去重判定:${extracted.length} 条候选记忆召回 ${candidateTotal} 条已有记录,决策 ${Object.entries(actionCount)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')}`);
    // ── §B 决策凭证:在应用决策前留痕(旁路设施,写失败绝不中断蒸馏) ──
    // 覆盖**全部** extracted:包括 skip 与"模型没返回决策"——回溯"这条为什么没进记忆"
    // 与"为什么进了"同等重要,而 skip 恰好是现有代码里唯一完全不留痕的分支
    // (下方应用循环 `if (!decision || action === 'skip') continue` 直接跳过)。
    // matches 与 extracted 同长同序(Promise.all 按数组序),故按下标取候选池。
    // 注:本轮不开配置开关——新增开关要连带改 config schema / contract / 设置页,
    // 属范围蔓延;凭证本身是纯旁路且幂等,先落地,需要时再加 kill-switch。
    // runId 提到块外:§C 冻结对要沿用同一批次 id,使「这一轮判了什么」与
    // 「这一轮冻结了哪一对」在记忆库侧可交叉审计(findings.md §3 / §9)。
    const runId = newRunId();
    let byKind;
    {
        const items = extracted.map((m, i) => ({
            recordId: m.record_id,
            candidateIds: (matches[i]?.candidates ?? []).map((c) => c.id),
            action: byRecord.get(m.record_id)?.action,
        }));
        const rows = buildReceipts(runId, new Date().toISOString(), items);
        persistReceiptsSafely((rows) => store.recordReceipts(rows), rows, logger);
        // §F 追踪捎带:六值决策词表聚合(与凭证同源,runner 侧并入 distill_run 事件)
        byKind = rows.reduce((acc, r) => {
            acc[r.kind] = (acc[r.kind] ?? 0) + 1;
            return acc;
        }, {});
    }
    // ── Step 3: 应用决策(官方语义:新记录追加进事实源,被替换目标只从检索库删除) ──
    // 只按需取决策涉及的记录(候选 + 目标 id 并集),避免每轮全表扫描
    const relatedIds = new Set();
    for (const d of byRecord.values()) {
        for (const id of d.target_ids ?? [])
            relatedIds.add(id);
    }
    for (const m of matches) {
        for (const c of m.candidates)
            relatedIds.add(c.id);
    }
    const byId = new Map(store.getByIds([...relatedIds]).map((r) => [r.id, r]));
    /**
     * 本批次**全部**新记忆的 record_id。两个用途:
     * ① 作为 `validateConflictPair` 的对手集之一 —— 同批次两条新记忆互相矛盾时,
     *    对方的 id 不在候选池里(本轮刚生成、尚未入库),没有这个集合就**必然被判
     *    不成对而回落 store**(2026-09-18 取证确认,见 findings R6 / Agent A);
     * ② 队满自动了结的护栏 —— 败方若属本批新记忆,不得自动退场(见下方分支)。
     */
    const batchIds = new Set(extracted.map((e) => e.record_id));
    /**
     * update/merge 取代掉的旧记录 → **取代它的**新记录 id。
     * 用 Map 而非 Set:退场标记要带 `by`,否则"被谁取代"只能靠时间猜。
     */
    const supersededBy = new Map();
    const added = [];
    /** §C 本轮新冻结的冲突对(应用完新增记录后统一落盘)。 */
    const frozen = [];
    /**
     * §C 本轮被**丢弃**的 conflict 决策(配不成对,见 task_1.4)。
     * 关闭态恒为空:收集处有 `freezeEnabled` 前置守卫 ⇒ 结构性不可达,
     * 不是"落了但读不到"。
     */
    const rejected = [];
    const now = Date.now();
    for (const m of extracted) {
        const decision = byRecord.get(m.record_id);
        if (!decision || decision.action === 'skip')
            continue;
        const action = decision.action;
        const ts = m.metadata?.activity_start_time ? Date.parse(String(m.metadata.activity_start_time)) : now;
        if (action === 'store') {
            added.push(toStoreRecord(m, now, ts, anchorMap));
            continue;
        }
        // ── §C 矛盾冻结:不自动裁决 ──
        // 走这里意味着**不覆盖、不合并、不删除**——新记忆按 store 语义照常入 L1,
        // 旧记忆原样留下,两者作为**一对**停放待人工裁决。
        // 开关关闭时 prompt 里根本没有 conflict 动作(零漂移见 task_23),但模型仍可能
        // 凭惯性输出它。此时**回落 store 而非落到下面的 update/merge 分支**:
        // 一个显式声明了"拿不准"的决策,绝不能被静默当成"新记忆更优"去覆盖旧记忆。
        if (action === 'conflict') {
            const pair = freezeEnabled
                ? validateConflictPair(m.record_id, decision.winner, decision.loser, new Set(byId.keys()), batchIds)
                : null;
            if (pair) {
                added.push(toStoreRecord(m, now, ts, anchorMap));
                // Phase 3(task_3.2):两轴**先归一后落库**。畸形输入(非字符串 / 空 / 不在枚举内)
                // 一律落 'hard' + 空键 —— **绝不**因此回落 store:类型与键是辅助轴,
                // 它们没有权力否决主轴(这条 conflict 决策是否成立)。
                const conflictType = normalizeConflictType(decision.conflict_type);
                const claimKey = normalizeClaimKey(decision.claim_key);
                const built = buildConflictPair({
                    runId,
                    winnerId: pair.winnerId,
                    loserId: pair.loserId,
                    createdAt: new Date(now).toISOString(),
                    conflictType,
                    claimKey,
                });
                // 队列上限:达上限即**不再停放**,改为当场按 LLM 的 winner/loser 了结。
                // 判据含 frozen 中本轮已停放的未裁决数,否则同一轮内多条冲突会一起越界。
                // Phase 3(task_3.4):额度**只按 'hard' 计** —— conditional / supersession 是
                // 「前提不同」与「新旧取代」两类,不消耗人的注意力预算,故不走上限分支。
                // 两条判据(占不占额度 / 已占多少)都抽在 conflicts.ts 的纯函数里:管线端到端
                // 需要可注入 LLM 的夹具(本项目没有),藏在分支里的条件等于没有护栏。
                const pendingHard = pendingHardTotal(store.countConflictPendingUnresolved({ conflictType: 'hard' }), frozen);
                if (occupiesConflictQuota(conflictType) && pendingHard >= maxPending) {
                    // fail-loud(审计 S10):队列满时若存在「钉子户」(复看已达上限、不会再被超时了结),
                    // 必须**说出来**——它们持续占额度,新冲突因此全部回落自动了结。
                    // 静默回落等于「冻结」在这一路径上实质失效,而库里看不出任何异常。
                    const exhausted = store
                        .listConflictPending({ limit: 1000 })
                        .filter((p) => (p.deferCount ?? 0) >= DEFER_MAX).length;
                    if (exhausted > 0) {
                        logger.warn(`[memory] 矛盾冻结:队列已满(${pendingHard}/${maxPending}),其中 ${exhausted} 对复看已达上限(${DEFER_MAX})` +
                            `——它们只能由人工裁决收口(winner / loser / both);新冲突将按 LLM 结论自动了结,请优先处理这些钉子户`);
                    }
                    // 护栏(2026-09-18 随同批次冻结一起加):**败方是本轮新记忆时不做自动了结**。
                    // 自动了结 = `retire(loser)`,而本轮的 `added` 里刚把这条新记忆写入 ——
                    // 那等于"刚抽取出来的产出立刻退场",且没有任何人被告知。
                    // 改为不停放这一对(该条已在上方 added 中照常入库,记忆不丢),
                    // 只放弃这条裁决请求;队列有界性因此仍然成立。
                    if (batchIds.has(built.loserId)) {
                        logger.warn(`[memory] 矛盾冻结:队列已满(${pendingHard}/${maxPending}),且该对的败方是本轮新记忆` +
                            `(${built.loserId})——不做自动了结(避免新记忆立即退场),改为不停放、照常入库`);
                        continue;
                    }
                    built.resolvedAt = new Date(now).toISOString();
                    built.resolution = 'auto';
                    autoLosers.add(pair.loserId);
                    logger.warn(`[memory] 矛盾冻结:待裁决队列已满(${pendingHard}/${maxPending}),第 ${m.record_id} 条改为自动了结`);
                }
                else if (conflictType !== 'hard') {
                    // Phase 3(task_3.4)fail-loud 兜底:非 hard **不占额度** ⇒ 它们不触发上面那段
                    // 有界性逻辑(既不被自动了结、也不 retire 任何一方——那两件事都必须留给人)。
                    // 代价是它们可以把**总数**推过 `maxPending` 而不被任何机制收口,故一旦越界
                    // 就必须**说出来**:静默越界等于"队列有界"这一条在这一路径上失效,
                    // 而库里只看得到"队列很长",看不出是哪种冲突堆的(与 S10 同类)。
                    const totalNow = store.countConflictPendingUnresolved() + frozen.filter((p) => p.resolvedAt === '').length;
                    if (totalNow >= maxPending) {
                        logger.warn(`[memory] 矛盾冻结:非 hard 冲突(${conflictType})不占额度,未裁决总数已达` +
                            `${totalNow}/${maxPending}——这类对不会被超时之外的机制自动了结,也不会退场任何一方,` +
                            `只能人工收口(winner / loser / both)`);
                    }
                }
                frozen.push(built);
            }
            else {
                logger.warn(`[memory] 矛盾冻结:第 ${m.record_id} 条的 conflict 决策无法构成冻结对` +
                    `(winner=${String(decision.winner)} loser=${String(decision.loser)}),已回落 store`);
                added.push(toStoreRecord(m, now, ts, anchorMap));
                // §C 丢弃留痕(task_1.4):这一跳此前**完全静默**——模型明确说了"判不了",
                // 而它既不停放、也不落库,只在日志留一行 warn,事后在库里查不到。
                // **关闭态不落痕**:关闭时 prompt 里根本没有 conflict 动作,模型凭惯性输出它
                // 属无关噪声,落痕只会把默认关闭的库灌满无效行。
                if (freezeEnabled) {
                    rejected.push({
                        rejectId: conflictRejectId(runId, m.record_id, decision.winner, decision.loser),
                        runId,
                        recordId: m.record_id,
                        winnerRaw: decision.winner === undefined ? '' : String(decision.winner),
                        loserRaw: decision.loser === undefined ? '' : String(decision.loser),
                        reason: 'not-pair',
                        createdAt: new Date(now).toISOString(),
                    });
                }
            }
            continue;
        }
        // update / merge:目标记录**退场(软删)**,合并结果作为新记录追加(版本 +1)
        // 候选召回按族隔离,合并产物保持新记忆的族标签
        const targets = (decision.target_ids ?? []).filter((id) => byId.has(id));
        // 同一目标被多条新记录取代时保留**首个**取代者:与 retire 的幂等语义一致
        // (已退场记录不重复写标记),故先到先得而不是被后者覆盖
        for (const id of targets)
            if (!supersededBy.has(id))
                supersededBy.set(id, m.record_id);
        const targetVersion = targets.reduce((max, id) => Math.max(max, byId.get(id)?.version ?? 0), 0);
        const mergedTs = (decision.merged_timestamps ?? [])
            .map((t) => Date.parse(t))
            .filter((t) => !Number.isNaN(t))
            .concat([now]);
        const targetRecords = targets
            .map((id) => byId.get(id))
            .filter((r) => r !== undefined);
        const mergedContent = decision.merged_content && decision.merged_content.trim()
            ? decision.merged_content
            : m.content;
        // 合并产物的身份与检索轴必须从 targets 继承（P0-c）。此前这里只带新记忆的
        // metadata：`ext_key` 被写成空 ⇒ 幂等保护随合并消失（而它是“文件↔库”的唯一锚）；
        // `name` 同理 ⇒ 文件身份随合并漂移；tags/hall/使用场景全丢 ⇒ 一次合并就把这条
        // 记忆从它原来的 Room/Wing 摘出去，且全程无日志（F2）。
        const inheritedName = targetRecords.find((r) => typeof r.name === 'string' && r.name.length > 0)?.name;
        const inheritedExtKey = targetRecords.find((r) => typeof r.extKey === 'string' && r.extKey.length > 0)?.extKey;
        const axes = mergeAxes(m.metadata, targetRecords.map((r) => r.metadata));
        // 名字优先继承（保持文件身份连续）；没得继承就留空，由写库前的起名器按**合并后的正文**分。
        // 继承来的名字如果已被库里另一条占着（典型：本轮正要退场的那条旧记录），
        // `assignMissingNames` 会把它重命到一个带后缀的变体——不能直接写，写了就是撞唯一索引、
        // 整条合并产物丢进不了检索库。
        const mergedName = inheritedName;
        // 丢东西必须说话：静默合并是这一整期要结的账。
        for (const note of axes.notes) {
            logger.info(`[memory] merge 轴冲突(${m.record_id} ← ${targets.join(',')}): ${note}`);
        }
        logger.info(`[memory] merge 传播身份(${m.record_id} ← ${targets.length} 条): `
            + `name=${mergedName ?? '(本轮没继承到，由起名器分配)'} extKey=${inheritedExtKey ?? '(无)'} `
            + `tags=${Array.isArray(axes.metadata.tags) ? axes.metadata.tags.length : 0}`);
        // 名字优先级：继承旧身份（保持文件连续）> 模型当场给的 merged_title > 交给起名器。
        // 顺序反了会让每次合并都把新语义挂在旧名字上，而旧名字描述的正是被合并掉的那批内容。
        const mergedTitle = mergedName === undefined || mergedName.length === 0
            ? acceptTitle(decision.merged_title)
            : mergedName;
        // 合并的有效期取并集:起 = 两侧最早;止 = 任一侧未闭合则仍未闭合(undefined)。
        // validToSource 随胜出侧走(task_2.5)，同样不进记录形状、只喂标注。
        const mt = mergeTemporal(temporalOf(m.metadata), targets.map((id) => byId.get(id)).filter((r) => r !== undefined));
        const mergedRec = {
            id: m.record_id,
            content: mergedContent,
            type: decision.merged_type || m.type,
            priority: Number(decision.merged_priority) || Number(m.priority) || 60,
            scene_name: m.scene_name,
            timestamps: Array.from(new Set(mergedTs)).sort((a, b) => a - b),
            createdAt: now,
            updatedAt: now,
            version: targetVersion + 1,
            source_message_ids: m.source_message_ids ?? [],
            // R7:合并/更新产出的记录同样带锚点——否则"合并一次就丢坐标",
            // 而合并恰恰是长会话里最常发生的动作。无映射时传空表 →
            // resolveSourceAnchors 返回 undefined → 不写 metadata 键(零漂移)。
            metadata: withSourceAnchors(axes.metadata, resolveSourceAnchors(m.source_message_ids, anchorMap ?? new Map())),
            family: m.family,
            // 身份两键：从 targets 继承（没得继承且开关开着才现分）。
            ...(inheritedExtKey === undefined ? {} : { extKey: inheritedExtKey }),
            ...(mergedTitle === undefined || mergedTitle.length === 0 ? {} : { name: mergedTitle }),
            // 归属五字段必须带上：这里此前**一个都没写**，等于每次合并都把 scope/
            // workspaceId/repoKey/applicability 打回默认——cfg.scope='global' 时看不出来，
            // 一旦启用围栏，一条记忆归过哪个项目就在合并后静默丢了。
            scope: m.scope,
            workspaceId: m.workspaceId,
            repoKeyName: m.repoKeyName,
            repoKeyOwner: m.repoKeyOwner,
            applicability: m.applicability,
            validFrom: mt.validFrom,
            validTo: mt.validTo,
            persistence: mt.persistence,
        };
        // 写侧标注(task_3.2):merge 产物的证据链随胜出侧透传。
        stampValidity(mergedRec, now, mt.validToSource);
        added.push(mergedRec);
    }
    await store.appendNew(added);
    if (supersededBy.size > 0) {
        // **软删**(取代):不是物理删除——主表行保留 + 取代标记(marker 单源，门1 解耦后
        // 不再闭合 valid_to)，FTS/向量撤出检索面。于是"合并错了"也能恢复,而不必去
        // `records/*.jsonl` 手工捞。
        // 按取代者分组落盘(一次事务一组),避免逐条开事务。
        const retiredAt = new Date(now).toISOString();
        const byNewRecord = new Map();
        for (const [targetId, newId] of supersededBy) {
            const arr = byNewRecord.get(newId) ?? [];
            arr.push(targetId);
            byNewRecord.set(newId, arr);
        }
        for (const [newId, ids] of byNewRecord) {
            store.retire(ids, { at: retiredAt, reason: 'superseded', by: newId });
            // 旧行退场后它的派生数据不能留在死 id 上：按“每个被合并者 → 新行”搬一次。
            if (mergeRekey !== undefined)
                for (const oldId of ids)
                    mergeRekey(oldId, newId);
        }
    }
    // §C 自动裁决的执行面:LLM 的 loser 从检索面退场(winner 存活),同为**软删**。
    // 排在 appendNew 之后——若 loser 恰是**本轮新记忆**(LLM 判定新记忆更差),
    // 也必须先让它进库再退场,以保证"本轮新增"与"本轮退场"的账面一致。
    if (autoLosers.size > 0) {
        store.retire([...autoLosers], { at: new Date(now).toISOString(), reason: 'conflict', verdict: 'auto' });
    }
    // ── §C 冻结对落盘(排在 appendNew 之后) ──
    // 顺序有讲究:先让新记忆真正进 L1,再登记"它和谁构成待裁决对"。反过来的话,
    // 落盘失败会留下一条指向**不存在记录**的裁决请求,人工打开队列只会看到悬空 id。
    // 写失败与 §B 凭证同策略:记 warn、不中断蒸馏——冻结是旁路设施,
    // 让它有权打断一轮蒸馏是本末倒置。
    if (frozen.length > 0) {
        try {
            store.recordConflictPending(frozen);
        }
        catch (err) {
            logger.warn(`[memory] 矛盾冻结:${frozen.length} 对落盘失败(忽略): ${err instanceof Error ? err.message : String(err)}`);
        }
        // 图谱侧:`disputed` 是"照常召回、但状态可见"的中间态(graph/search.ts 仍在候选内)。
        // **重算**而非增量标记:队列里现在还剩哪些未裁决对,就是此刻的争议集;
        // 本轮之前已被裁决的节点因此会**自动复原 active**(派生字段由当前事实重算)。
        // 图谱是可选派生投影,未启用时 syncGraphDisputed 内部即 no-op。
        try {
            const ids = new Set();
            for (const p of store.listConflictPending()) {
                ids.add(p.winnerId);
                ids.add(p.loserId);
            }
            store.syncGraphDisputed([...ids]);
        }
        catch (err) {
            logger.warn(`[memory] 矛盾冻结:图谱 disputed 同步失败(忽略): ${err instanceof Error ? err.message : String(err)}`);
        }
        logger.info(`[memory] 矛盾冻结:本轮停放 ${frozen.length} 对待人工裁决(run_id=${runId})`);
    }
    // ── §C 丢弃留痕落盘(与冻结对同策略:记 warn、不中断蒸馏) ──
    // 留痕是**旁路设施**:它无权打断一轮蒸馏,但也不能静默失败——
    // 「丢弃本身就是我们要审计的事」,连留痕都丢了就必须在日志里说出来。
    if (rejected.length > 0) {
        try {
            store.recordConflictRejected(rejected);
            logger.info(`[memory] 矛盾冻结:${rejected.length} 条 conflict 决策配不成对,已留痕(conflict_rejected,run_id=${runId})`);
        }
        catch (err) {
            logger.warn(`[memory] 矛盾冻结:${rejected.length} 条丢弃留痕落盘失败(忽略): ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    // 状态按记录族分桶推进(阈值计数各自独立)
    const addedByFamily = { chat: 0, work: 0 };
    for (const r of added)
        addedByFamily[r.family ?? familyForType(r.type)]++;
    for (const f of ['chat', 'work']) {
        if (addedByFamily[f] === 0)
            continue;
        states[f].totalExtracted += addedByFamily[f];
        states[f].newMemoriesSinceL2 += addedByFamily[f];
        states[f].memoriesSinceL3 += addedByFamily[f];
    }
    markExtracted(states, mode, lastScene);
    logger.info(`[memory] L1 抽取完成(mode=${mode}):消息 ${pending.length} 条,抽取 ${extracted.length} 条,去重后新增 ${added.length} 条(取代退场 ${supersededBy.size} 条,chat=${addedByFamily.chat}/work=${addedByFamily.work}),累计 chat=${states.chat.totalExtracted}/work=${states.work.totalExtracted}`);
    return { stored: added.length, skipped: false, sceneName: lastScene, newRecords: added, runId, byKind };
}
/** auto 档取最近活跃的族 checkpoint(情境链/计数锚点)。 */
function activeState(states) {
    return states.chat.lastExtractAt >= states.work.lastExtractAt ? states.chat : states.work;
}
/** 情境链读取:auto → 最近活跃族;纯档 → 本族。 */
function chainHead(states, mode) {
    return (mode === 'auto' ? activeState(states) : states[mode]).lastSceneName;
}
/** 抽取成功后推进时间戳/情境链:auto → 两族都推进(链只写锚点桶);纯档 → 本族。 */
function markExtracted(states, mode, lastScene) {
    const now = Date.now();
    if (mode === 'auto') {
        // 两族的 lastExtractAt 都推进(去重候选各自族内判断"新消息");情境链只维护锚点桶
        states.chat.lastExtractAt = now;
        states.work.lastExtractAt = now;
        activeState(states).lastSceneName = lastScene;
    }
    else {
        states[mode].lastExtractAt = now;
        states[mode].lastSceneName = lastScene;
    }
}
