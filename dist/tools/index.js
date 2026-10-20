/**
 * 模型可调用工具:memory_search(L1)、conversation_search(L0)、memory_read_scene(L2/L3)、
 * 高权限 memory_add / memory_delete。
 *
 * 会话档位联动:execute 的 exec.agent 即发起调用的 agent(agent.id === sessionId),
 * memory_search 按会话档位过滤族(auto 不过滤,纯档只查本族);off 档下读类工具统一
 * 返回提示(本会话已对记忆系统隐身)。conversation_search 检索范围保持全库。
 * 只写会话(注入覆盖=关)同款拒读,notice 区分文案——写入走捕获钩子不经工具,
 * 拒读不影响"只写"语义。
 *
 * 写删工具受 live.memoryMutate 高权限门控(默认 false):显式记忆指令语义——
 * 用户说"记得 X" → memory_add;说"忘了/删除该记忆" → memory_delete。
 */
import { createHash } from 'node:crypto';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { DOWNGRADE_TARGET, familyOf, isKnownType, typeEnumSep } from '../memory-types.js';
import { drscRoleOf } from '../clients/drsc.js';
import { RECEIPTS_QUERY_LIMIT_MAX, dimensionOf, toReceiptView } from '../store/receipts.js';
import { listConflictPairs, renderConflictResolution, renderConflicts, resolveConflictPair } from '../conflict-service.js';
import { WING_CATALOG, WING_FALLBACK, normPersistence, normScope, resolveRecordScope } from '../types.js';
import { scopeFilterOf, workspaceIdOf } from '../workspace.js';
import { annotateOrphanCandidates, confirmReview, mergeRoom, nextReview, pendingReviewCount, renameRoom, skipReview, } from '../room-review.js';
import { applyGovernanceWeights } from '../store/governance.js';
import { resolveRepoScope } from '../repo-scope.js';
import { GRAPH_STATUS_LABELS } from '../prompts/graph-projection.js';
import { redactSecrets } from '../util/redact.js';
const OFF_NOTICE = '本会话的记忆档位为"关闭":该会话对记忆系统完全隐身,不读取也不写入记忆。';
const WRITE_ONLY_NOTICE = '本会话为只写模式:记忆照常沉淀,但不读取。';
const GLOBAL_OFF_NOTICE = '记忆注入已全局停用:本会话不读取记忆(沉淀照常)。';
/** §C 一次性告警标记:手动写入路径的脱敏失败只提示一次(不阻断写入)。 */
let manualRedactWarnedOnce = false;
/**
 * §C 手动写入路径脱敏(memorax-absorb / task_18):memory_add / memory_import
 * 与捕获路径走同一 8 类词表,两条 L1 写入边界语义一致。
 * 红线:脱敏失败放行原文 + 一次性 warn(不阻断写入)。
 */
function applyManualRedaction(record, cfg, logger) {
    if (cfg.capture?.redactSecrets === false)
        return;
    try {
        record.content = redactSecrets(record.content).text;
    }
    catch (err) {
        if (!manualRedactWarnedOnce) {
            manualRedactWarnedOnce = true;
            logger.warn(`[memory] 手动写入脱敏失败,放行原文(一次性提示): ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
export function registerMemoryTools(ctx, cfg, stores, logger, modes, live, 
/** 反刍控制器(可选:未装配时 ruminate 工具返回未启用提示)。 */
ruminate, 
/** Room 注册表(分类管理 beta.4;缺省 = memory_room_admin 返回未装配提示)。 */
roomRegistry) {
    if (!cfg.tools)
        return { reg: () => { } };
    // ── 工具分组封印(v0.21.0):sealable 组的注册经 reg() 登记,按 live 开关动态
    // 注册/反注册。封印 = 从模型工具列表消失(反注册),不是执行期拒绝;开关经
    // 设置页 volatile 热更(loader/volatile-update)即时生效,无需重启。
    // 核心读(memory_search / conversation_search / memory_read_scene /
    // memory_receipts)与槽位三件(slots.ts)不参与封印。
    const toolDisposers = new Map();
    const toolMakers = new Map();
    // 技能组是「功能开关 + 封印」双条件:功能关(部署 cfg.skills.enabled 与 live.skillsEnabled 取或)或
    // 封印(toolSkills===false)任一满足即不注册——功能关时保持零表面积,开门后仍可单独封印。
    const skillsFeatureOn = () => cfg.skills.enabled === true || live.get().skillsEnabled === true;
    const toolSealed = (group) => {
        const snap = live.get();
        switch (group) {
            case 'room': return snap.toolRoom === false;
            case 'graph': return snap.toolGraph === false;
            case 'ruminate': return snap.toolRuminate === false;
            case 'conflict': return snap.toolConflict === false;
            case 'mutate': return snap.toolMutate === false;
            case 'skills': return !skillsFeatureOn() || snap.toolSkills === false;
            default: return false;
        }
    };
    const reg = (group, make) => {
        const makers = toolMakers.get(group) ?? [];
        makers.push(make);
        toolMakers.set(group, makers);
        if (!toolSealed(group)) {
            const disposers = toolDisposers.get(group) ?? [];
            disposers.push(make());
            toolDisposers.set(group, disposers);
        }
    };
    const applyToolSeals = () => {
        for (const [group, disposers] of [...toolDisposers]) {
            if (!toolSealed(group))
                continue;
            disposers.forEach((dispose) => dispose());
            toolDisposers.delete(group);
            logger.warn(`[memory] 工具组已封印: ${group}`);
        }
        for (const [group, makers] of [...toolMakers]) {
            if (toolSealed(group) || toolDisposers.has(group))
                continue;
            toolDisposers.set(group, makers.map((make) => make()));
            logger.warn(`[memory] 工具组已解封: ${group}`);
        }
    };
    /**
     * 沿父链解析**有效档位归属会话**(§A 修复)。
     *
     * 子代理以新 session id 调用工具时,其自身通常不在档位表里——原实现直接回落
     * 全局默认档(auto),于是父会话被用户显式设为 `off`/只写时,**子代理仍能读到
     * 用户明确关闭的记忆**,构成"用户显式指令被绕过"(P0)。
     *
     * 现改为沿 `session.header.parentSession` 上溯至**首个有显式档位的祖先**。
     * 同步通路由 task_4 spike 实测确认(`findings.md §8`):子代理会话的 header
     * **无条件**携带父会话 id(`dsh-subagent/.../child-agent.js:111-125`)。
     *
     * 多级链(孙代理等)需要按 id 取某个会话的 header → 走 `ctx.get('agents')`
     * 的**宽容路径**(cordis 属性访问对未 inject 的服务会抛 "without inject";
     * 同款先例见 `src/hooks/recall.ts:402-407,461`)。
     *
     * 降级(全部不抛错、不新增拒绝路径):
     * - `exec.agent` 缺失 → 返回 undefined(保持既有 fail-open);
     * - 服务缺失 / 链断 → 停止上溯,用自身 id(= 默认档,与修复前一致);
     * - 链上做环检测,自环或成环都能终止。
     */
    const resolveModeOwner = (exec) => {
        const agent = exec.agent;
        const selfId = agent?.id;
        if (selfId === undefined)
            return undefined;
        // 自身有显式档位 → 自己说了算(子代理会话也可被单独设置)
        if (modes.hasEntry(selfId))
            return selfId;
        const seen = new Set([selfId]);
        let cur = agent?.session?.header?.parentSession;
        while (cur !== undefined && !seen.has(cur)) {
            if (modes.hasEntry(cur))
                return cur;
            seen.add(cur);
            // 继续上溯:取该会话的 header(服务缺失时返回 undefined → 循环自然结束)
            const upstream = ctx.get?.('agents');
            cur = upstream?.get?.(cur)?.session?.header?.parentSession;
        }
        return selfId; // 无祖先设过 → 自身(= 默认档,行为与修复前一致)
    };
    /**
     * 调用会话的检索族(auto → undefined 不过滤;off/只写 → null 表示整体禁用)。
     * fail-open:exec.agent 缺失(宿主调用路径未带 agent 标识)按全族检索放行——
     * 档位隔离依赖宿主正确传递 exec.agent.id,缺失只告警一次不拒绝工具调用。
     */
    let warnedNoAgent = false;
    const familyOfCaller = (exec) => {
        const owner = resolveModeOwner(exec);
        if (owner === undefined) {
            if (!warnedNoAgent) {
                warnedNoAgent = true;
                logger.warn('[memory] 工具调用缺少 agent 标识(exec.agent 未传递),档位过滤退化为全族检索');
            }
            return undefined;
        }
        const mode = modes.get(owner);
        if (mode === 'off')
            return null;
        // 只写会话拒读:与注入同属读维度,不拒则"不注入"从工具路径漏风
        if (!modes.resolvedRecall(owner, live.get().recall))
            return null;
        return mode === 'auto' ? undefined : mode;
    };
    /** 拒读时的归因文案(familyOfCaller 判 null 后重查内存 Map,成本可忽略):
     *  off 完全隐身 / 会话只写覆盖 / 全局召回关——三种停用各说各话,不谎报只写。
     *  **注意按"有效档位归属会话"归因**:子代理拒读时文案取的是其祖先的档位,
     *  而非子代理自身(后者未设置,会谎报成 off)。 */
    const blockNoticeOf = (exec) => {
        const owner = resolveModeOwner(exec);
        if (owner !== undefined) {
            if (modes.get(owner) === 'off')
                return OFF_NOTICE;
            if (modes.getRecall(owner) === false)
                return WRITE_ONLY_NOTICE;
            if (!modes.resolvedRecall(owner, live.get().recall))
                return GLOBAL_OFF_NOTICE;
        }
        return OFF_NOTICE;
    };
    // ── memory_search: L1 结构化记忆 ──
    ctx.tools.register(defineTool({
        name: 'memory_search',
        description: '搜索结构化记忆(L1 原子记忆)。返回与查询相关的记忆片段:用户偏好、历史事件、项目事实、任务、规则、工作方法等。',
        parameters: {
            query: { type: 'string', required: true, description: '搜索查询文本(自然语言)' },
            limit: { type: 'number', description: '最大返回条数(默认 5)' },
            type: { type: 'string', description: `按记忆类型过滤(词表 ${typeEnumSep('/')})` },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string', description: 'L1 record_id:可写入槽位 refs 或喂给 memory_receipts' },
                                content: { type: 'string' },
                                type: { type: 'string' },
                                scene_name: { type: 'string' },
                                score: { type: 'number' },
                            },
                            additionalProperties: false,
                        },
                    },
                    notice: { type: 'string', description: '非搜索结果的状态提示(如本会话记忆已关闭)' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [
                { type: 'text', text: value.notice ?? renderMemoryItems(value.items ?? []) },
            ],
        },
        execute: async (args, exec) => {
            const family = familyOfCaller(exec);
            if (family === null)
                return { items: [], notice: blockNoticeOf(exec) };
            const limit = Math.min(Math.max(args.limit ?? 5, 1), 20);
            const hits = await stores.l1.search(args.query, limit, {
                type: args.type || undefined,
                family: family ?? undefined,
                // §E 可见范围:`cfg.scope` 非 workspace 时恒为 undefined(= 不过滤)，
                // 零漂移由 `scopeFilterOf` 一处收口保证，不靠各调用点各自判断。
                workspaceId: scopeFilterOf(cfg.scope, exec),
            });
            // ── 治理权重(ADR-0015 T1.10b):工具出口与召回出口同一函数、同一 cfg 门;
            // 软减权重排(score 不改写),默认关时逐字现状。
            let items = hits;
            if (cfg.recall.scopeFence?.enabled === true && hits.length > 1) {
                const currentRepoKey = resolveRepoScope(workspaceIdOf({ agent: exec.agent })).repoKey;
                const recordsById = new Map(stores.l1.getByIds(hits.map((h) => h.id)).map((r) => [r.id, r]));
                items = applyGovernanceWeights(hits, recordsById, {
                    enabled: true,
                    currentRepoKey,
                    crossRepoMultiplier: cfg.recall.scopeFence?.crossRepoMultiplier ?? 0.2,
                });
            }
            return {
                items: items.map((h) => ({
                    id: h.id,
                    content: h.content,
                    type: h.type,
                    scene_name: h.scene_name,
                    score: Math.round(h.score * 100) / 100,
                })),
            };
        },
    }));
    // ── memory_room_admin: Room 粒度目录治理(分类管理 beta.4;beta.5 起 merge/rename/retire 已注册) ──
    // list 免预算零风险;merge/rename/retire 走 dryRun 预览→实跑,执行前自动备份,完成入队场景重算。
    reg('room', () => ctx.tools.register(defineTool({
        name: 'memory_room_admin',
        description: 'Room 分类管理(目录粒度)。action="list" 列出注册表条目与自生长 Room 计数;' +
            'action="register" 预注册一个 Room(高权限;两级制——大类上限 200,小类用「大类/小类」细分不占额度,如 dsh-plugin/merge;' +
            'action="merge" 合并两个 Room(高权限;dryRun 默认 true 只返预览,实跑改写全部匹配记录的 tags 并入队场景重算,执行前自动备份);' +
            'action="rename" 改名(= merge 1:1 + 注册表改名);action="retire" 退役一个注册 Room(高权限;存量记录不动)。' +
            'merge/rename 与反刍并发会相互覆盖,请在反刍空闲时执行。',
        parameters: {
            action: { type: 'string', required: true, description: 'list | register(高权限) | merge(高权限) | rename(高权限) | retire(高权限)' },
            slug: { type: 'string', description: 'register 的 Room slug(小写字母数字连字符)' },
            label: { type: 'string', description: 'register 的人类可读名(可选,可中文)' },
            description: { type: 'string', description: 'register 的归类说明(可选;喂给标注器帮助归类)' },
            from: { type: 'string', description: 'merge/rename 的源 Room slug' },
            to: { type: 'string', description: 'merge/rename 的目标 Room slug' },
            dryRun: { type: 'string', description: 'merge/rename:默认 true 只返预览;"false" 才实际执行' },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    notice: { type: 'string' },
                    rooms: { type: 'string' },
                    slug: { type: 'string' },
                    created: { type: 'boolean' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [{ type: 'text', text: value.notice ?? JSON.stringify(value) }],
        },
        execute: async (args) => {
            const action = String(args.action ?? '');
            if (action === 'list') {
                if (!roomRegistry)
                    return { notice: 'Room 注册表未装配(需要插件重载以初始化)。' };
                const registry = roomRegistry.list();
                const counts = stores.l1.listRooms();
                const countOf = (slug) => counts.find((r) => r.room === slug)?.count ?? 0;
                const regLines = registry.map((e) => `- ${e.slug}${e.label ? `(${e.label})` : ''} [${e.source}/${e.status}] 现有 ${countOf(e.slug)} 条${e.description ? ` — ${e.description}` : ''}`);
                const grownOnly = counts.filter((r) => !registry.some((e) => e.slug === r.room));
                return {
                    notice: `注册表 ${registry.length} 条(上限 200),自生长未注册 ${grownOnly.length} 个。\n` +
                        (regLines.join('\n') || '(注册表为空——用 action=register 预注册)') +
                        `\n自生长未注册:${grownOnly.map((r) => `${r.room}(${r.count})`).join(", ") || "无"}`,
                    rooms: `${registry.length}+${grownOnly.length}`,
                };
            }
            if (action === 'register') {
                if (!roomRegistry)
                    return { notice: 'Room 注册表未装配(需要插件重载以初始化)。' };
                if (!live.get().memoryMutate)
                    return { notice: MUTATE_OFF_NOTICE };
                const slug = String(args.slug ?? '').trim();
                try {
                    const r = await roomRegistry.register({
                        slug,
                        label: typeof args.label === 'string' ? args.label : undefined,
                        description: typeof args.description === 'string' ? args.description : undefined,
                    });
                    return {
                        notice: r.created
                            ? `已预注册 Room:${r.entry.slug}${r.entry.label ? `(${r.entry.label})` : ''}。候选标注器将优先把相关记忆挂到它上面。`
                            : `Room 已存在:${r.entry.slug}(本次只补全了缺失的 label/description)。`,
                        slug: r.entry.slug,
                        created: r.created,
                    };
                }
                catch (err) {
                    return { notice: `注册失败: ${err instanceof Error ? err.message : String(err)}` };
                }
            }
            if (action === 'update') {
                if (!roomRegistry)
                    return { notice: 'Room 注册表未装配(需要插件重载以初始化)。' };
                if (!live.get().memoryMutate)
                    return { notice: MUTATE_OFF_NOTICE };
                const slug = String(args.slug ?? '').trim();
                if (!slug)
                    return { notice: 'update 需要 slug。' };
                try {
                    const ok = await roomRegistry.update(slug, {
                        label: typeof args.label === 'string' ? args.label : undefined,
                        description: typeof args.description === 'string' ? args.description : undefined,
                    });
                    return { notice: ok ? `已更新:${slug}(显示名/归类说明)。` : `无变化:${slug} 未找到或未提供非空字段。`, slug };
                }
                catch (err) {
                    return { notice: `更新失败: ${err instanceof Error ? err.message : String(err)}` };
                }
            }
            if (action === 'merge' || action === 'rename') {
                if (!roomRegistry)
                    return { notice: 'Room 注册表未装配(需要插件重载以初始化)。' };
                if (!live.get().memoryMutate)
                    return { notice: MUTATE_OFF_NOTICE };
                const from = String(args.from ?? '').trim();
                const to = String(args.to ?? '').trim();
                if (!from || !to)
                    return { notice: 'merge/rename 需要 from 与 to 两个 slug。' };
                const dryRun = String(args.dryRun ?? 'true').toLowerCase() !== 'false';
                try {
                    const fn = action === 'merge' ? mergeRoom : renameRoom;
                    const r = await fn({ l1: stores.l1, registry: roomRegistry, logger }, from, to, { dryRun });
                    if (r.dryRun) {
                        return {
                            notice: `[dryRun 预览] ${from} → ${to}:影响 ${r.affected} 条${r.hasMore ? '(超过单次上限,需续跑)' : ''}。` +
                                `样例:${r.preview.join(', ') || '无'}。确认无误后以 dryRun="false" 执行(执行前自动备份,重写含已退场行,完成后自动入队场景重算)。`,
                            affected: r.affected,
                        };
                    }
                    // 实跑:受影响场景入队重算(source='room-merge')
                    let requeued = 0;
                    for (const family of r.families ?? []) {
                        for (const scene of r.scenes ?? []) {
                            stores.l1.enqueueSceneRecluster(family, [scene], `room-merge:${Date.now()}`, 'room-merge');
                            requeued++;
                        }
                    }
                    return {
                        notice: `${action === 'merge' ? '合并' : '改名'}完成:${from} → ${to},重写 ${r.applied} 条` +
                            `(备份:${r.backupFile ?? '无'})${requeued > 0 ? `;已入队 ${requeued} 个场景重算` : ''}。`,
                        applied: r.applied,
                        id: to,
                    };
                }
                catch (err) {
                    return { notice: `${action} 失败: ${err instanceof Error ? err.message : String(err)}` };
                }
            }
            if (action === 'retire') {
                if (!roomRegistry)
                    return { notice: 'Room 注册表未装配(需要插件重载以初始化)。' };
                if (!live.get().memoryMutate)
                    return { notice: MUTATE_OFF_NOTICE };
                const slug = String(args.slug ?? '').trim();
                try {
                    const ok = await roomRegistry.setStatus(slug, 'retired');
                    return { notice: ok ? `已退役 Room:${slug}(存量记录的 tags 不动,仅词表不再推荐)。` : `未找到注册条目:${slug}(自生长 Room 无需退役,会随 tags 自然消失)。`, slug };
                }
                catch (err) {
                    return { notice: `退役失败: ${err instanceof Error ? err.message : String(err)}` };
                }
            }
            return { notice: `非法 action:${action}(允许 list/register/merge/rename/retire)。` };
        },
    })));
    // ── conversation_search: L0 原始对话 ──
    ctx.tools.register(defineTool({
        name: 'conversation_search',
        description: '搜索原始对话历史。返回带时间戳的原始消息节选(已脱敏),适用于查找具体消息原文、时间线、上下文细节。',
        parameters: {
            query: { type: 'string', required: true, description: '搜索查询文本' },
            limit: { type: 'number', description: '最大返回条数(默认 5)' },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                session_id: { type: 'string' },
                                role: { type: 'string' },
                                content: { type: 'string' },
                                timestamp: { type: 'number' },
                            },
                            additionalProperties: false,
                        },
                    },
                    notice: { type: 'string', description: '非搜索结果的状态提示(如本会话记忆已关闭)' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [
                { type: 'text', text: value.notice ?? renderConversationItems(value.items ?? []) },
            ],
        },
        execute: async (args, exec) => {
            if (familyOfCaller(exec) === null)
                return { items: [], notice: blockNoticeOf(exec) };
            const limit = Math.min(Math.max(args.limit ?? 5, 1), 20);
            // T8.4 读切(spec R7):检索命中走 DRSC 原文 fts,返回文本取 redact=1 脱敏列。
            // 硬依赖无本地回退(l0 本地检索已退役)——collector 缺席/故障显式报错给模型,
            // 与「空结果」口径分清,不抛穿主流程。
            const drsc = stores.drsc;
            if (!drsc) {
                return { items: [], notice: '历史对话检索不可用:DRSC collector 未装配(本地 L0 检索已退役,无回退)。' };
            }
            try {
                const hits = await drsc.search(args.query, limit);
                return {
                    items: hits
                        .map((h) => ({ h, role: drscRoleOf(h.kind) }))
                        .filter((e) => e.role !== undefined)
                        .map(({ h, role }) => ({
                        session_id: h.session_id,
                        role,
                        content: h.snippet,
                        timestamp: h.time,
                    })),
                };
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                return { items: [], notice: `历史对话检索暂不可用(DRSC collector: ${detail})。` };
            }
        },
    }));
    // ── memory_read_scene: 读取 L2 场景块 / L3 画像 ──
    ctx.tools.register(defineTool({
        name: 'memory_read_scene',
        description: '读取记忆文件详情:L2 场景块(场景目录下的 .md 文件)或 L3 画像(persona-chat.md / persona-work.md)。返回文件完整内容。',
        parameters: {
            path: { type: 'string', required: true, description: '场景文件名,或 persona-chat.md / persona-work.md' },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    content: { type: 'string', description: '文件内容(不存在则为空字符串)' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [
                { type: 'text', text: value.content ? `\`\`\`markdown\n${value.content}\n\`\`\`` : '(文件不存在或为空)' },
            ],
        },
        execute: async (args, exec) => {
            if (familyOfCaller(exec) === null)
                return { content: blockNoticeOf(exec) };
            const p = args.path.trim();
            let content;
            if (p === 'persona.md' || p === 'persona-chat.md' || p === 'persona' || p === 'persona-chat') {
                content = await stores.persona.chat.read();
            }
            else if (p === 'persona-work.md' || p === 'persona-work') {
                content = await stores.persona.work.read();
            }
            else {
                // 场景文件在两族目录里按名查找(先本族后另一族)
                const primary = familyOfCaller(exec) ?? 'chat';
                const other = primary === 'chat' ? 'work' : 'chat';
                content =
                    (await stores.scenes[primary].read(p)) ?? (await stores.scenes[other].read(p));
            }
            return { content: content ?? '' };
        },
    }));
    // ── 写删工具(高权限门控):memory_add / memory_delete ──
    const MUTATE_OFF_NOTICE = '记忆写删未开放:请在记忆库面板开启「高权限模式」后,模型才能写入/删除记忆。';
    /**
     * 非词表 type 的降级台账（pm-name-distill task_1.4）。旧实现把外部分类**静默改写**成
     * `episodic`，而 memport 文案却承诺“按原样透传”——两套口径对同一件事相反。
     * 现在降级仍发生（写入面需要一个合法值），但**可观测**：每个不同值 warn 一次并计数。
     */
    const addTypeDowngrades = new Set();
    const newMemId = () => 'mem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    // ── 工具刷写的公共装配(时间轴 + 溯源 + 冲突标记) ──
    //
    // 时间被拆成三条**互不替代**的轴:created_at/updated_at(进库/变更时刻)、
    // valid_from/valid_to(事实在真实世界成立的时间区间)、persistence(是否会随时间失效)。
    // 把事件发生时间填进 created_at 是最常见的误用——那会让时效衰减与"目前是否成立"
    // 同时失准,所以两者在入参层面就分开。
    const MAX_IMPORT = 200;
    const DEFAULT_IMPORT_SCENE = '外部导入';
    /** ISO/epoch → epoch ms;非法或非正一律 undefined(不猜测时间)。 */
    const parseTime = (raw) => {
        if (typeof raw !== 'string' && typeof raw !== 'number')
            return undefined;
        const t = typeof raw === 'number' ? raw : Date.parse(raw);
        return Number.isFinite(t) && t > 0 ? t : undefined;
    };
    const toIsoOrNull = (ms) => ms === undefined ? null : new Date(ms).toISOString();
    /**
     * 入参 → L1 记录。
     *
     * 时间轴同时写顶层字段(时间增强列)与 metadata(列迁移前的兼容层,
     * 也是面板与图谱时间锚的读取点);`cf`/`rw` 落在 metadata.conflict/rewritten。
     */
    /** 外部导入幂等键:sha1(source_id \0 稳定身份)。身份取 dedupe_key,缺省用内容规范化。 */
    const computeExtKey = (sourceId, item, content) => {
        const identity = typeof item.dedupe_key === 'string' && item.dedupe_key.trim()
            ? item.dedupe_key.trim()
            : content.replace(/\s+/g, ' ').toLowerCase();
        return createHash('sha1').update(`${sourceId}\u0000${identity}`, 'utf8').digest('hex');
    };
    function buildRecord(item, sceneName, now, workspaceId, sourceId) {
        const content = String(item.content ?? '').trim();
        const rawType = String(item.type ?? '').trim();
        // 白名单判据来自词表单一真源；非词表值降级为 DOWNGRADE_TARGET 并留痕（不静默）。
        let type = rawType;
        if (!isKnownType(rawType)) {
            type = DOWNGRADE_TARGET;
            if (rawType.length > 0 && !addTypeDowngrades.has(rawType)) {
                addTypeDowngrades.add(rawType);
                logger.warn(`[memory] memory_add/import type '${rawType}' 不在词表,已降级为 '${DOWNGRADE_TARGET}'(同值不再重复提醒)`);
            }
        }
        // 族判定不再 `startsWith('work')` 内联猜——`project_*`/`development_*`/`*_experience`
        // 都是 work 族却不带 work 前缀，猜错的族会静默改这批记录的共享面。
        const family = familyOf(type);
        const validFrom = parseTime(item.valid_from);
        const validTo = parseTime(item.valid_to);
        const persistence = normPersistence(item.persistence);
        const createdAt = parseTime(item.created_at) ?? now;
        const updatedAt = parseTime(item.updated_at) ?? createdAt;
        const wing = typeof item.hall === 'string' && item.hall.trim() ? item.hall.trim().slice(0, 40) : undefined;
        const origin = typeof item.origin === 'string' && item.origin.trim() ? item.origin.trim().slice(0, 200) : undefined;
        const metadata = {
            temporal: { st: persistence ?? '?', vf: toIsoOrNull(validFrom), vt: toIsoOrNull(validTo) },
        };
        if (wing)
            metadata.hall = wing;
        if (origin)
            metadata.origin = origin;
        if (validFrom !== undefined)
            metadata.activity_start_time = toIsoOrNull(validFrom);
        if (validTo !== undefined)
            metadata.activity_end_time = toIsoOrNull(validTo);
        if (item.conflict === true)
            metadata.conflict = true;
        if (item.rewritten === true)
            metadata.rewritten = true;
        const priority = Number(item.priority);
        return {
            id: newMemId(),
            content,
            type,
            priority: Number.isFinite(priority) && priority >= 0 ? Math.min(priority, 100) : 80,
            scene_name: sceneName,
            timestamps: Array.from(new Set([validFrom ?? createdAt, createdAt, updatedAt])).sort((a, b) => a - b),
            createdAt,
            updatedAt,
            version: 0,
            metadata,
            family,
            // §E 归属：与抽取管线**同一判据**（`resolveRecordScope`）。写入路径不止一条
            // （pipeline / 本工具 / 批量导入），共用同一函数才不会有"某条路径忘了标归属"。
            ...resolveRecordScope(normScope(cfg.scope), family, workspaceId),
            ...(validFrom !== undefined ? { validFrom } : {}),
            ...(validTo !== undefined ? { validTo } : {}),
            ...(persistence !== undefined ? { persistence } : {}),
            ...(sourceId && sourceId.trim() ? { extKey: computeExtKey(sourceId.trim(), item, content) } : {}),
        };
    }
    /** 时间轴/溯源字段的可选入参(两个写工具共用同一形状)。 */
    const writeFields = {
        type: {
            type: 'string',
            description: `记忆类型(${typeEnumSep('/')};缺省 ${DOWNGRADE_TARGET})`,
        },
        hall: {
            type: 'string',
            description: `可选的粗分类 Wing(${[...WING_CATALOG.map((h) => h.id), WING_FALLBACK].join('/')};general = 跨域兜底)`,
        },
        persistence: {
            type: 'string',
            description: '持续性:t 无时间性(规则/偏好/恒真事实)、o 仍在持续、s 已结束的区间、p 时点事件;缺省=未判定',
        },
        valid_from: { type: 'string', description: '有效期起(ISO 8601):该事实在真实世界开始成立的时间' },
        valid_to: { type: 'string', description: '有效期止(ISO 8601):留空表示尚未结束或无时间性' },
        created_at: { type: 'string', description: '记录时间(ISO 8601):缺省为当前时刻' },
        updated_at: { type: 'string', description: '变更时间(ISO 8601):缺省等于记录时间' },
        origin: { type: 'string', description: '溯源:这条记忆来自哪里(文件路径/工具名/会话)' },
        conflict: { type: 'boolean', description: '是否与库内既有记忆存在未裁决的冲突' },
        rewritten: { type: 'boolean', description: '是否已被后续条目改写/取代' },
    };
    // memory_add:显式"记得X"直接落库一条 L1 记忆(绕过抽取管线,需高权限)。
    reg('mutate', () => ctx.tools.register(defineTool({
        name: 'memory_add',
        description: '直接写入一条结构化记忆(L1)。仅当用户显式要求"记住/记下 X"时用;需高权限模式开启。内容须是待记忆的事实/偏好/任务/规则,不应包含对话过程。',
        parameters: {
            content: { type: 'string', required: true, description: '要记忆的完整内容(一句话事实,语义完整)' },
            ...writeFields,
            scene: {
                type: 'string',
                description: '归属场景名(缺省 __manual__;导入外部记忆建议填"外部导入/<来源>")',
            },
            priority: { type: 'number', description: '优先级 0-100(缺省 80)' },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    notice: { type: 'string' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [{ type: 'text', text: value.notice ?? ('已记录记忆 ' + (value.id ?? '')) }],
        },
        execute: async (args, exec) => {
            if (!live.get().memoryMutate)
                return { notice: MUTATE_OFF_NOTICE };
            const content = String(args.content ?? '').trim();
            if (!content)
                return { notice: 'content 为空,未写入' };
            const scene = typeof args.scene === 'string' && args.scene.trim() ? args.scene.trim().slice(0, 120) : '__manual__';
            const record = buildRecord(args, scene, Date.now(), workspaceIdOf(exec));
            applyManualRedaction(record, cfg, logger);
            await stores.l1.appendNew([record]);
            // 新增的投射落盘由 `appendNew` 里的 store 钩子承接（写删对称，这里不双写）。
            logger.info(`[memory] 高权限写入记忆(${record.type}${record.metadata?.hall ? '/' + String(record.metadata.hall) : ''},时间轴 ${record.persistence ?? '?'}):${record.content.slice(0, 120)}`);
            return { id: record.id };
        },
    })));
    // memory_import:批量写入(工具刷写通道——外部记忆包导入/迁移,免逐条调用)。
    reg('mutate', () => ctx.tools.register(defineTool({
        name: 'memory_import',
        description: '批量写入多条记忆(L1)。用于把已整理好的外部记忆(其他 AI 工具导出的记忆包)一次性导入;需高权限模式开启。去重与冲突判定由调用方先行完成(见 memport Skill):本工具只做结构校验与批内重复拦截,不替调用方裁决语义冲突。单次上限 200 条。',
        parameters: {
            records: {
                type: 'array',
                required: true,
                description: '待写入的记录数组(content 必填,其余字段语义同 memory_add)',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        content: {
                            type: 'string',
                            required: true,
                            description: '要记忆的完整内容(一句话事实,语义完整)',
                        },
                        ...writeFields,
                        priority: { type: 'number', description: '优先级 0-100(缺省 80)' },
                        dedupe_key: {
                            type: 'string',
                            description: '可选稳定身份(外部包内该条的稳定 id);与顶层 source_id 组合算幂等键,缺省用内容规范化哈希',
                        },
                    },
                },
            },
            scene: {
                type: 'string',
                description: `归属场景名(缺省 ${DEFAULT_IMPORT_SCENE};建议用"${DEFAULT_IMPORT_SCENE}/<来源>")`,
            },
            source_id: {
                type: 'string',
                description: '来源标识(如 "workbuddy"/"claude-code"/外部包名);非空时启用幂等——同一来源重复导入相同 dedupe_key/内容会被跳过并计入 deduped',
            },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    written: { type: 'number' },
                    deduped: { type: 'number' },
                    ids: { type: 'array', items: { type: 'string' } },
                    skipped: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                index: { type: 'number' },
                                reason: { type: 'string' },
                            },
                            additionalProperties: false,
                        },
                    },
                    notice: { type: 'string' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [
                { type: 'text', text: value.notice ?? `已导入 ${value.written ?? 0} 条记忆` },
            ],
        },
        execute: async (args, exec) => {
            if (!live.get().memoryMutate) {
                return { written: 0, deduped: 0, ids: [], skipped: [], notice: MUTATE_OFF_NOTICE };
            }
            const raw = Array.isArray(args.records) ? args.records : [];
            if (raw.length === 0) {
                return { written: 0, deduped: 0, ids: [], skipped: [], notice: 'records 为空,未写入' };
            }
            if (raw.length > MAX_IMPORT) {
                return {
                    written: 0,
                    deduped: 0,
                    ids: [],
                    skipped: [],
                    notice: `单次上限 ${MAX_IMPORT} 条(收到 ${raw.length} 条),请拆批导入`,
                };
            }
            const scene = typeof args.scene === 'string' && args.scene.trim()
                ? args.scene.trim().slice(0, 120)
                : DEFAULT_IMPORT_SCENE;
            const sourceId = typeof args.source_id === 'string' ? args.source_id.trim() : '';
            const now = Date.now();
            const seen = new Set();
            const seenExt = new Set();
            const records = [];
            const skipped = [];
            let deduped = 0;
            raw.forEach((item, index) => {
                const content = String(item?.content ?? '').trim();
                if (!content) {
                    skipped.push({ index, reason: 'content 为空' });
                    return;
                }
                const key = content.replace(/\s+/g, ' ').toLowerCase();
                if (seen.has(key)) {
                    skipped.push({ index, reason: '与本批前面的记录内容重复' });
                    return;
                }
                seen.add(key);
                // 幂等(轨3-P0):带 source_id 时按 ext_key 拦截重复——先查库内、再查本批，
                // 命中即计入 deduped 并跳过(不写 JSONL、不写检索库)。无 source_id 保持既有逐字行为。
                if (sourceId) {
                    const extKey = computeExtKey(sourceId, item, content);
                    if (seenExt.has(extKey)) {
                        deduped++;
                        skipped.push({ index, reason: '与本批前面的记录外部键重复(幂等跳过)' });
                        return;
                    }
                    if (stores.l1.findIdByExtKey(extKey)) {
                        deduped++;
                        skipped.push({ index, reason: '库内已存在同外部键记录(幂等跳过)' });
                        return;
                    }
                    seenExt.add(extKey);
                }
                const record = buildRecord(item, scene, now, workspaceIdOf(exec), sourceId);
                applyManualRedaction(record, cfg, logger);
                records.push(record);
            });
            if (records.length > 0)
                await stores.l1.appendNew(records); // 同上：批量导入也由钩子上盘
            logger.info(`[memory] 批量导入 ${records.length} 条(幂等跳过 ${deduped} 条,场景 ${scene}${sourceId ? `,来源 ${sourceId}` : ''})`);
            return { written: records.length, deduped, ids: records.map((r) => r.id), skipped };
        },
    })));
    // memory_delete:显式"忘了 X"——按语义检索命中后删除(高权限门控)。
    reg('mutate', () => ctx.tools.register(defineTool({
        name: 'memory_delete',
        description: '退场(软删)与查询相关的记忆(L1)。仅当用户显式要求"忘记/删除某条记忆"时用;需高权限模式开启。' +
            '默认只退场**最贴近的 1 条**;可用 limit 放大(上限 10)。' +
            '退场是**软删**:记录移出检索面但保留在主表,可在记忆列表恢复,不是物理删除。' +
            '已知确切 record_id 时应走 ids 参数(精确退场,不做语义匹配)。',
        parameters: {
            query: { type: 'string', description: '要退场的记忆描述(自然语言,匹配最贴近的现存记忆);给出 ids 时可省略' },
            ids: {
                type: 'array',
                items: { type: 'string' },
                description: '确切的 record_id 列表(给了它就不做语义匹配,只退场这些 id;上限同 limit)',
            },
            limit: { type: 'number', description: '最多退场条数(默认 1,上限 10)' },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    deleted: { type: 'number' },
                    ids: { type: 'array', items: { type: 'string' } },
                    notice: { type: 'string' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [
                {
                    type: 'text',
                    text: value.notice ??
                        `已退场(软删)${value.deleted ?? 0} 条记忆` +
                            (value.ids && value.ids.length ? `:${value.ids.join('，')}` : '') +
                            '——它们仍在主表,可在记忆列表恢复',
                },
            ],
        },
        execute: async (args, exec) => {
            if (!live.get().memoryMutate)
                return { deleted: 0, ids: [], notice: MUTATE_OFF_NOTICE };
            const family = familyOfCaller(exec);
            // 默认 1(原为 3):"忘记某条记忆"是一对一的意图,而 limit=3 会顺带退场
            // 两条语义邻近但无关的记忆 —— 实测已发生过一次真实误删。
            const limit = Math.min(Math.max(args.limit ?? 1, 1), 10);
            // 精确路径优先:给了 ids 就**不做语义匹配**。语义匹配的"顺带多删几条"
            // 正是误删的来源,而调用方一旦能给出 id,就没有理由再走模糊匹配。
            const explicit = Array.isArray(args.ids)
                ? args.ids.filter((x) => typeof x === 'string' && x.trim() !== '').slice(0, limit)
                : [];
            let ids;
            if (explicit.length > 0) {
                ids = explicit;
            }
            else {
                const query = String(args.query ?? '').trim();
                if (!query)
                    return { deleted: 0, ids: [], notice: 'query 与 ids 均为空,未删除' };
                const hits = await stores.l1.search(query, limit, {
                    family: family && family !== null ? family : undefined,
                    workspaceId: scopeFilterOf(cfg.scope, exec),
                });
                ids = hits.map((h) => h.id);
            }
            if (ids.length === 0)
                return { deleted: 0, ids: [], notice: '未找到匹配的记忆,未删除' };
            // **软删**(退场),不是物理删除:与裁决 / 取代共用同一原语,故"删错了"
            // 可以在记忆列表里恢复,而不必去 records/*.jsonl 事实源手工捞。
            const n = stores.l1.retire(ids, { at: new Date().toISOString(), reason: 'manual' });
            logger.info(`[memory] 高权限退场(软删)记忆 ${n} 条(${ids.join('，')})`);
            // 投射文件跟随不在这里点火：`l1.retire()` 是汇流口，钩子在那里（`store/memory-md-sync.ts`）。
            return { deleted: n, ids };
        },
    })));
    // ── 图谱工具(读;受与 memory_search 同款的档位/注入拒读门 + 族过滤) ──
    const GRAPH_OFF_NOTICE = '图谱功能未启用:部署配置 graph.enabled 未开启,当前没有可用的知识图谱。';
    // memory_search_graph: 图谱节点检索(紧凑节点卡)
    reg('graph', () => ctx.tools.register(defineTool({
        name: 'memory_search_graph',
        description: '搜索知识图谱(实体节点:人物/项目/组织/工具/地点)。返回实体的当前状态摘要与匹配说明,适用于查"某人/某项目现在什么状态"这类问题;需要完整属性与关系时再用 memory_expand_graph_node 展开。',
        parameters: {
            query: { type: 'string', required: true, description: '搜索查询文本(实体名、别名、标签或状态关键词)' },
            limit: { type: 'number', description: '最大返回条数(默认 8,上限 20)' },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                name: { type: 'string' },
                                type: { type: 'string' },
                                status: { type: 'string' },
                                current_state: { type: 'string' },
                                score: { type: 'number' },
                                match_reason: { type: 'string' },
                            },
                            additionalProperties: false,
                        },
                    },
                    notice: { type: 'string' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [{ type: 'text', text: value.notice ?? renderGraphCards(value.items ?? []) }],
        },
        execute: async (args, exec) => {
            const family = familyOfCaller(exec);
            if (family === null)
                return { items: [], notice: blockNoticeOf(exec) };
            const graph = stores.graph;
            if (!graph)
                return { items: [], notice: GRAPH_OFF_NOTICE };
            const query = String(args.query ?? '').trim();
            if (!query)
                return { items: [], notice: 'query 为空' };
            const limit = Math.min(Math.max(args.limit ?? 8, 1), 20);
            // 族过滤:纯档会话只见本族衍生节点(auto/fail-open 不过滤)
            const hits = graph.searchNodes(query, limit, family ? [family] : undefined);
            return {
                items: hits.map((h) => ({
                    id: h.node.id,
                    name: h.node.name,
                    type: h.node.type,
                    status: h.node.status,
                    current_state: h.node.currentState,
                    score: Math.round(h.score * 100) / 100,
                    match_reason: h.matchReason,
                })),
            };
        },
    })));
    // memory_expand_graph_node: 展开单个节点(facts 全量含历史 + 关系边)
    reg('graph', () => ctx.tools.register(defineTool({
        name: 'memory_expand_graph_node',
        description: '展开一个图谱节点的完整详情:全部属性(facts,含已被更新的历史值与生效区间)、关联关系边与来源记忆 id。先用 memory_search_graph 拿到节点 id。',
        parameters: {
            id: { type: 'string', required: true, description: '节点 id(memory_search_graph 返回的 id)' },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    node: { type: 'string', description: '节点详情文本(不存在为空串)' },
                    notice: { type: 'string' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [{ type: 'text', text: value.notice ?? (value.node || '(节点不存在)') }],
        },
        execute: async (args, exec) => {
            const family = familyOfCaller(exec);
            if (family === null)
                return { notice: blockNoticeOf(exec) };
            const graph = stores.graph;
            if (!graph)
                return { notice: GRAPH_OFF_NOTICE };
            const id = String(args.id ?? '').trim();
            if (!id || id.length > 200)
                return { notice: 'id 缺失或过长' };
            const node = graph.getNode(id);
            // 悬挂 id 与跨族节点一律"不解析":纯档会话探测不到他族节点的存在
            if (!node || (family && !node.families.includes(family)))
                return { notice: '(节点不存在)' };
            const lines = [
                `[${node.name}](类型 ${node.type},${GRAPH_STATUS_LABELS[node.status]})`,
                ...(node.aliases.length > 0 ? [`别名: ${node.aliases.join('、')}`] : []),
                ...(node.tags?.length ? [`标签: ${node.tags.join('、')}`] : []),
                ...(node.currentState ? [`当前状态:\n${node.currentState}`] : []),
                '',
                '属性(含历史):',
            ];
            for (const f of node.facts) {
                const value = Array.isArray(f.value) ? f.value.join('、') : f.value;
                const span = [f.validFrom ? `自 ${f.validFrom}` : '', f.validTo ? `至 ${f.validTo}` : ''].filter(Boolean).join(' ');
                lines.push(`- ${f.key}: ${value}(${GRAPH_STATUS_LABELS[f.status]}${span ? `,${span}` : ''})`);
            }
            const edges = graph.edgesOf(id);
            if (edges.length > 0) {
                lines.push('', '关系:');
                for (const e of edges) {
                    const other = e.fromNodeId === id ? e.toNodeId : e.fromNodeId;
                    const arrow = e.fromNodeId === id ? '→' : '←';
                    lines.push(`- ${arrow} ${other}(${e.relation},${GRAPH_STATUS_LABELS[e.status]})`);
                }
            }
            lines.push('', `来源记忆: ${node.sourceRecordIds.join('、') || '(无)'}`);
            return { node: lines.join('\n') };
        },
    })));
    // ── 反刍工具(按需触发 L1→L2→L3 消化,受蒸馏开关门控) ──
    const RUMINATE_OFF_NOTICE = '反刍功能未开放:请在记忆库面板开启「蒸馏」开关后使用。';
    const RUMINATE_UNAVAIL_NOTICE = '反刍未初始化:存储处于降级态,无法反刍。';
    const RUMINATE_RUNNING_NOTICE = '反刍已在进行中,请稍后再试。';
    reg('ruminate', () => ctx.tools.register(defineTool({
        name: 'memory_ruminate',
        description: '触发记忆反刍:把未蒸馏的对话缓冲冲刷出来,跑一轮 L1 抽取 → L2 场景整合 → L3 画像更新。与重建不同,不清库不改 L0,仅消化攒而未蒸馏的切片;无缓冲时做轻量 L2/L3 刷新。',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                properties: {
                    running: { type: 'boolean' },
                    phase: { type: 'string' },
                    done: { type: 'number' },
                    total: { type: 'number' },
                    recordsBuilt: { type: 'number' },
                    startedAt: { type: 'string' },
                    notice: { type: 'string' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [
                { type: 'text', text: value.notice ?? renderRuminateStatus(value) },
            ],
        },
        execute: async () => {
            if (!ruminate)
                return { notice: RUMINATE_UNAVAIL_NOTICE, running: false, phase: 'idle', done: 0, total: 0, recordsBuilt: 0, startedAt: undefined };
            const s = live.get();
            if (!s.enabled || !s.distill)
                return { notice: RUMINATE_OFF_NOTICE, running: false, phase: 'idle', done: 0, total: 0, recordsBuilt: 0, startedAt: undefined };
            try {
                const result = await ruminate.start();
                return {
                    running: result.running,
                    phase: result.phase,
                    done: result.done,
                    total: result.total,
                    recordsBuilt: result.recordsBuilt,
                    startedAt: result.startedAt ? new Date(result.startedAt).toISOString() : undefined,
                };
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes('已在进行中'))
                    return { notice: RUMINATE_RUNNING_NOTICE, running: true, phase: err.phase ?? 'distilling', done: 0, total: 0, recordsBuilt: 0, startedAt: undefined };
                return { notice: `反刍启动失败: ${msg}`, running: false, phase: 'failed', done: 0, total: 0, recordsBuilt: 0, startedAt: undefined };
            }
        },
    })));
    // ── 取消反刍(按需取消正在进行的反刍) ──
    reg('ruminate', () => ctx.tools.register(defineTool({
        name: 'memory_ruminate_cancel',
        description: '取消正在进行的记忆反刍。已蒸馏部分保留,pending 切片中未被消费的部分维持原状。',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                properties: {
                    notice: { type: 'string' },
                    phase: { type: 'string' },
                    running: { type: 'boolean' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [{ type: 'text', text: value.notice ?? `反刍已取消(当前阶段:${value.phase})` }],
        },
        execute: async () => {
            if (!ruminate)
                return { notice: RUMINATE_UNAVAIL_NOTICE, phase: 'idle', running: false };
            try {
                const result = ruminate.requestCancel();
                return {
                    notice: result.phase === 'cancelled' ? '反刍已取消' : '取消请求已发送',
                    phase: result.phase,
                    running: result.running,
                };
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return { notice: msg, phase: 'idle', running: false };
            }
        },
    })));
    // ── 反刍状态查询(查看当前反刍进度) ──
    // ── memory_room_review:孤儿记忆的 Room 候选逐个复查(agent 长尾治理)──────
    // next/annotate 只读或预算内标注(无需门);confirm/skip 改写 metadata,
    // confirm 吃 live.memoryMutate 高权限门(与 memory_delete 同款)。
    reg('room', () => ctx.tools.register(defineTool({
        name: 'memory_room_review',
        description: '孤儿记忆(无 Room 绑定)的逐个复查:action="next" 取下一条待复查记录(带系统预标记的候选 Room 与现有词表,agent 依据记录内容判定);' +
            'action="confirm" 按 id 把 1-3 个 Room slug 写入该记忆(高权限);action="skip" 跳过(不再进队列);' +
            'action="annotate" 立即对一批孤儿做候选预标记(平时由反刍自动推进)。建议长会话空闲时逐个过,保持分类收敛——优先挂靠现有 Room。',
        parameters: {
            action: { type: 'string', required: true, description: 'next(取下一条)| confirm(确认写入)| skip(跳过)| annotate(批量预标记)' },
            id: { type: 'string', description: 'confirm/skip 的目标记录 id(action=next 返回的 id)' },
            rooms: { type: 'string', description: 'confirm 的 Room slug 列表(逗号分隔,1-3 个,小写字母数字连字符;可含词表外新 slug)' },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    notice: { type: 'string' },
                    id: { type: 'string' },
                    content: { type: 'string' },
                    candidates: { type: 'string' },
                    roomCatalog: { type: 'string' },
                    remaining: { type: 'number' },
                    confirmedTags: { type: 'string' },
                    annotated: { type: 'number' },
                    deferred: { type: 'number' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [{ type: 'text', text: value.notice ?? JSON.stringify(value) }],
        },
        execute: async (args) => {
            const action = String(args.action ?? '');
            const io = { l1: stores.l1, logger };
            if (action === 'next') {
                const item = nextReview(io.l1);
                if (!item)
                    return { notice: '没有待复查的孤儿记忆(roomCandidates 队列为空)。可用 action=annotate 先做一轮候选预标记。' };
                return {
                    id: item.id,
                    content: item.content,
                    candidates: item.candidates.join(', '),
                    roomCatalog: item.roomCatalog.map((r) => `${r.room}(${r.count})`).join(', '),
                    remaining: item.remaining,
                };
            }
            if (action === 'annotate') {
                const r = await annotateOrphanCandidates(ctx, cfg, { ...io, registry: roomRegistry }, 40);
                return {
                    notice: `候选预标记完成:选中 ${r.selected} 条,产候选 ${r.candidates} 条,写 pending ${r.written} 条。用 action=next 逐个复查。`,
                    annotated: r.candidates,
                    deferred: r.selected - r.written,
                };
            }
            if (action === 'confirm') {
                if (!live.get().memoryMutate)
                    return { notice: MUTATE_OFF_NOTICE };
                const id = String(args.id ?? '').trim();
                if (!id)
                    return { notice: 'confirm 需要 id(action=next 返回的 id)。' };
                const rooms = String(args.rooms ?? '')
                    .split(/[,,、]/)
                    .map((x) => x.trim())
                    .filter(Boolean);
                if (rooms.length === 0)
                    return { notice: 'confirm 需要 rooms(逗号分隔的 1-3 个 Room slug)。' };
                const r = confirmReview(io.l1, id, rooms);
                if (!r)
                    return { notice: `确认失败:id=${id} 不存在、已被确认过、或 rooms 全部非法(需 1-3 个合法 slug)。` };
                return { notice: `已挂到 Room:${r.tags.join(', ')}(面板下一次刷新即可见)。`, confirmedTags: r.tags.join(', '), id };
            }
            if (action === 'skip') {
                const id = String(args.id ?? '').trim();
                if (!id)
                    return { notice: 'skip 需要 id。' };
                const ok = skipReview(io.l1, id);
                return { notice: ok ? `已跳过 ${id}(不再进复查队列)。` : `跳过失败:id=${id} 不存在。`, id };
            }
            return { notice: `非法 action:${action}(允许 next/confirm/skip/annotate)。剩余待复查 ${pendingReviewCount(stores.l1)} 条。` };
        },
    })));
    reg('ruminate', () => ctx.tools.register(defineTool({
        name: 'memory_ruminate_status',
        description: '查询当前记忆反刍的状态与进度(是否运行中、当前阶段、已完成/总会话数等)。\n\n注意:在 DSH Web GUI 的对话中无法直接调用此工具,因为模型可调用工具列表不包含 ruminate_status。如需查询进度,请在记忆库面板的蒸馏面板查看。',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                properties: {
                    running: { type: 'boolean' },
                    phase: { type: 'string' },
                    done: { type: 'number' },
                    total: { type: 'number' },
                    recordsBuilt: { type: 'number' },
                    cancelRequested: { type: 'boolean' },
                    startedAt: { type: 'string' },
                    finishedAt: { type: 'string' },
                    error: { type: 'string' },
                    notice: { type: 'string' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [
                { type: 'text', text: value.notice ?? renderRuminateStatus(value) },
            ],
        },
        execute: async () => {
            if (!ruminate)
                return { notice: RUMINATE_UNAVAIL_NOTICE, running: false, phase: 'idle', done: 0, total: 0, recordsBuilt: 0, cancelRequested: false, startedAt: undefined, finishedAt: undefined, error: undefined };
            const result = ruminate.getStatus();
            return {
                running: result.running,
                phase: result.phase,
                done: result.done,
                total: result.total,
                recordsBuilt: result.recordsBuilt,
                cancelRequested: result.cancelRequested,
                startedAt: result.startedAt ? new Date(result.startedAt).toISOString() : undefined,
                finishedAt: result.finishedAt ? new Date(result.finishedAt).toISOString() : undefined,
                error: result.error ?? undefined,
            };
        },
    })));
    // ── memory_receipts: §B 决策凭证回溯(读;受与 memory_search 同款档位门) ──
    // 为什么给它一个模型可见的工具:凭证链的价值全在"事后能问"。若只有 RPC 端点,
    // 用户得自己去浏览器/curl 才能回溯,而真正会问「这条记忆怎么来的」的场合
    // 恰恰是在对话里。工具是这条链唯一的**用户可见出口**。
    ctx.tools.register(defineTool({
        name: 'memory_receipts',
        description: '回溯 L1 记忆的**去重决策出处**(决策凭证链)。按 record_id 问"这条记忆出自哪一轮蒸馏、当时看到什么候选池、被判定成了什么";按 run_id 问"那一轮蒸馏都判了什么"(跨多条记录)。两者同给即问"这条记录在那一轮里被判成了什么"。返回决策当时的结论与输入指纹,**不含记忆正文**。注意:由于记录 id 每轮新铸,按 record_id 查询目前通常只返回一条——它回答的是"出自哪",不是"历次变更"。',
        parameters: {
            record_id: { type: 'string', description: '按记忆记录 id 回溯(与 run_id 至少给一个)' },
            run_id: { type: 'string', description: '按某轮蒸馏的 run id 回溯(与 record_id 至少给一个)' },
            limit: { type: 'number', description: `最大返回条数(默认 20,上限 ${RECEIPTS_QUERY_LIMIT_MAX})` },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    dimension: { type: 'string', description: '命中的维度:record / run / both / none' },
                    items: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                receipt_id: { type: 'string' },
                                run_id: { type: 'string' },
                                record_id: { type: 'string' },
                                kind: { type: 'string', description: 'store / update / merge / skip / conflict / skip_missing' },
                                input_digest: { type: 'string' },
                                decided_at: { type: 'string' },
                            },
                            additionalProperties: false,
                        },
                    },
                    total: { type: 'number' },
                    notice: { type: 'string', description: '非结果的状态提示(如本会话记忆已关闭)' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [
                { type: 'text', text: value.notice ?? renderReceipts(value.dimension, value.items ?? [], value.total ?? 0) },
            ],
        },
        execute: async (args, exec) => {
            // 档位拒读门与 memory_search 同款:off 会话对记忆系统完全隐身,不该反过来
            // 能内省记忆系统的判定史(凭证虽不含正文,但泄漏"存在哪些记录/判了什么")。
            const family = familyOfCaller(exec);
            if (family === null)
                return { dimension: 'none', items: [], total: 0, notice: blockNoticeOf(exec) };
            const query = {
                recordId: typeof args.record_id === 'string' && args.record_id.trim() ? args.record_id.trim() : undefined,
                runId: typeof args.run_id === 'string' && args.run_id.trim() ? args.run_id.trim() : undefined,
            };
            const dimension = dimensionOf(query);
            if (dimension === 'none') {
                return {
                    dimension,
                    items: [],
                    total: 0,
                    notice: '需要至少一个维度:record_id(这条记忆出自哪一轮、当时候选池是什么)或 run_id(某一轮蒸馏的全部决策)。' +
                        '不提供"查全部凭证"——那等于把整库判定史一次性导出。',
                };
            }
            const limit = Math.min(Math.max(args.limit ?? 20, 1), RECEIPTS_QUERY_LIMIT_MAX);
            const rows = stores.l1.listReceipts({ ...query, limit });
            return { dimension, items: rows.map(toReceiptView), total: stores.l1.countReceipts(query) };
        },
    }));
    // ── memory_conflicts: §C 待裁决队列的**读**出口 ──
    // `memory_resolve_conflict` 的描述里早就写着"待裁决对可用 memory_conflicts 查看",
    // 但那个工具**一直不存在** —— 模型照着描述调用只会拿到"工具不存在"。
    // 裁决端点在、读端点与读工具两端都缺,队列于是成了只进不出的黑洞
    // (安全阀超时自动了结会成为唯一出路,那正是 §C 想避免的)。
    reg('conflict', () => ctx.tools.register(defineTool({
        name: 'memory_conflicts',
        description: '列出**矛盾冻结**的待裁决对(§C)。冻结不自动裁决:新记忆照常入库,与它冲突的旧记忆作为**一对**停在队列里,双方内容都不被改写,直到人给出结论。返回每对的 pair_id、**双方正文**与 LLM 建议的胜负方(id 只是进入队列时的排序位,不代表结论)。看完用 memory_resolve_conflict 给出结论:winner / loser / both。',
        parameters: {
            limit: { type: 'number', description: '最多返回多少对(默认 50,上限 200)' },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    enabled: { type: 'boolean', description: '矛盾冻结是否开启;关闭时队列恒空,与"开启但没有待裁决"是两回事' },
                    total: { type: 'number', description: '未裁决总数(可能大于 items.length)' },
                    items: {
                        type: 'array',
                        description: '待裁决对(最多 limit 条)',
                        items: {
                            type: 'object',
                            properties: {
                                pair_id: { type: 'string' },
                                run_id: { type: 'string', description: '产生该冻结的蒸馏批次 id(可交给 memory_receipts 追该轮判了什么)' },
                                winner_id: { type: 'string' },
                                winner_content: { type: 'string', description: 'LLM 建议胜方的正文;空串 = 该记录已不在检索库' },
                                loser_id: { type: 'string' },
                                loser_content: { type: 'string', description: '同上' },
                                created_at: { type: 'string' },
                                // 以下 10 项与 conflict-service.listConflictPairs 视图逐一对齐(task 三轴/R1/Phase3):
                                // execute 直接返回该视图,additionalProperties:false 下少声明任何一个,
                                // 宿主无损校验即拒("not a declared property"),整工具读不出——schema 必须跟视图同步。
                                winner_valid_from_ms: { oneOf: [{ type: 'number' }, { type: 'null' }] },
                                winner_valid_to_ms: { oneOf: [{ type: 'number' }, { type: 'null' }] },
                                winner_persistence: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                                loser_valid_from_ms: { oneOf: [{ type: 'number' }, { type: 'null' }] },
                                loser_valid_to_ms: { oneOf: [{ type: 'number' }, { type: 'null' }] },
                                loser_persistence: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                                review_state: { type: 'string', enum: ['unseen', 'deferred'], description: '没看过 / 看过未决(R1:两者必须可区分)' },
                                defer_count: { type: 'number', description: '复看次数(defer 上限 3)' },
                                conflict_type: { type: 'string', description: '冲突类型(默认 hard)' },
                                claim_key: { type: 'string', description: '同主题多对冲突的归并键(空串=未分组)' },
                            },
                            additionalProperties: false,
                        },
                    },
                    notice: { type: 'string', description: '非结果的状态提示(如冻结未开启 / 本会话记忆已关闭)' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [{ type: 'text', text: value.notice ?? renderConflicts(value) }],
        },
        execute: async (args, exec) => {
            // 档位拒读门与 memory_receipts 同款:off 会话对记忆系统完全隐身,
            // 不该反过来能内省"库里有哪些自相矛盾的记忆"。
            const family = familyOfCaller(exec);
            if (family === null) {
                return { enabled: false, total: 0, items: [], notice: blockNoticeOf(exec) };
            }
            return listConflictPairs({ l1: stores.l1, conflictFreezeEnabled: live.get().conflictFreeze === true, decayHalfLifeDays: cfg.recall?.decayHalfLifeDays, feedback: stores.feedback }, { limit: typeof args.limit === 'number' ? args.limit : undefined });
        },
    })));
    // ── memory_conflicts_rejected: §C 丢弃留痕的读出口 ──
    // LLM 输出不满足 pair 格式的冲突决策会被记入 `conflict_rejected` 表,
    // 但此前只有写入没有读取——人无法知道"哪些冲突被判定为不合法"。
    // 本工具补上读方向,与 `dsh-memory/conflicts-rejected` RPC 端点共用同一形状。
    reg('conflict', () => ctx.tools.register(defineTool({
        name: 'memory_conflicts_rejected',
        description: '列出被**丢弃**的冲突决策(§C 丢弃留痕)。LLM 输出不满足 pair 格式(缺 winner/loser id、无法配对等)时,该决策会被记入丢弃表而非停到待裁决队列。返回每条的 reject_id、原始正文、丢弃原因与所属蒸馏批次。可用 limit / created_before 分页。',
        parameters: {
            limit: { type: 'number', description: '最多返回多少条(默认 50,上限 200)' },
            created_before: { type: 'string', description: '排他上界:created_at < 此值(ISO);不给则从最新开始' },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        description: '被丢弃的冲突决策',
                        items: {
                            type: 'object',
                            properties: {
                                reject_id: { type: 'string' },
                                run_id: { type: 'string', description: '所属蒸馏批次 id' },
                                record_id: { type: 'string' },
                                winner_raw: { type: 'string', description: 'LLM 原始输出的胜方正文' },
                                loser_raw: { type: 'string', description: 'LLM 原始输出的败方正文' },
                                reason: { type: 'string', description: '丢弃原因(如 not-pair)' },
                                created_at: { type: 'string' },
                            },
                            additionalProperties: false,
                        },
                    },
                    notice: { type: 'string', description: '非结果的状态提示' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => {
                const v = value;
                if (v.notice)
                    return [{ type: 'text', text: v.notice }];
                const items = v.items ?? [];
                if (items.length === 0)
                    return [{ type: 'text', text: '没有被丢弃的冲突决策。' }];
                const rows = items.map((r, i) => `${i + 1}. ${r.reject_id}  (${r.created_at}) · 原因 ${r.reason}`);
                return [{ type: 'text', text: `被丢弃的冲突决策 ${items.length} 条\n\n${rows.join('\n')}` }];
            },
        },
        execute: async (args, exec) => {
            const family = familyOfCaller(exec);
            if (family === null) {
                return { items: [], notice: blockNoticeOf(exec) };
            }
            const limit = typeof args.limit === 'number' ? args.limit : undefined;
            const createdBefore = typeof args.created_before === 'string' ? args.created_before : undefined;
            const items = stores.l1.listConflictRejected({ limit, createdBefore });
            return {
                items: items.map((r) => ({
                    reject_id: r.rejectId,
                    run_id: r.runId,
                    record_id: r.recordId,
                    winner_raw: r.winnerRaw,
                    loser_raw: r.loserRaw,
                    reason: r.reason,
                    created_at: r.createdAt,
                })),
            };
        },
    })));
    // ── memory_resolve_conflict: §C 矛盾冻结的人工裁决出口 ──
    // 冻结把裁决权交还给人,那么**必须**有一个"人能把结论说回去"的出口——
    // 否则待裁决队列是个只进不出的黑洞,安全阀(task_24)会成为唯一出路,
    // 那等于把 opt-in 的冻结悄悄退回成"超时后机器自己判"。
    reg('conflict', () => ctx.tools.register(defineTool({
        name: 'memory_resolve_conflict',
        description: '裁决一条**矛盾冻结**的待裁决对(§C)。冻结产生的冲突对停放在待裁决队列里,双方记忆都不被改写,直到你在这里给出结论:winner(判 LLM 建议的胜方为真,败方从检索中退场)、loser(判败方为真)、both(判定两者其实是各自独立的事实,都保留)、defer(看过但**暂不裁决**——它不关闭冲突,该对仍在待裁决队列里,会重置超时计时并累计复看次数)。需先开启 conflictFreeze 配置;待裁决对可用 memory_conflicts 查看。',
        parameters: {
            pair_id: { type: 'string', description: '待裁决对的 pair_id(来自待裁决队列)' },
            outcome: {
                type: 'string',
                description: '裁决结论:winner | loser | both | defer。defer = **看过但暂不裁决**:不关闭冲突、重置超时计时、累计复看次数(达上限后不再被超时自动了结,只能人工收口)。',
            },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    pair_id: { type: 'string' },
                    outcome: { type: 'string' },
                    resolved_at: { type: 'string', description: '裁决时刻(ISO);空串表示未生效' },
                    removed_record_id: { type: 'string', description: '因裁决从检索中退场的记录 id(无则空串)' },
                    notice: { type: 'string', description: '非结果的状态提示(如未开启冻结 / 该对不存在或已裁决)' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [{ type: 'text', text: renderConflictResolution(value) }],
        },
        execute: async (args, exec) => {
            const family = familyOfCaller(exec);
            if (family === null) {
                return { pair_id: '', outcome: '', resolved_at: '', removed_record_id: '', notice: blockNoticeOf(exec) };
            }
            const empty = { pair_id: '', outcome: '', resolved_at: '', removed_record_id: '' };
            const pairId = typeof args.pair_id === 'string' ? args.pair_id.trim() : '';
            const outcome = typeof args.outcome === 'string' ? args.outcome.trim() : '';
            if (!pairId)
                return { ...empty, notice: '需要 pair_id:待裁决对没有"全部裁决"这种用法。' };
            return resolveConflictPair({ l1: stores.l1, conflictFreezeEnabled: live.get().conflictFreeze === true }, pairId, outcome);
        },
    })));
    applyToolSeals();
    // 设置页翻开关 → volatile 热更 → 重新应用封印(反注册/重注册)。
    // 守卫:测试 fake ctx / 极老宿主没有事件面时静默跳过(封印仅失去热更,
    // 重启后仍生效)。
    if (typeof ctx.on === 'function') {
        ctx.on('loader/volatile-update', () => applyToolSeals());
    }
    logger.info('[memory] 工具已注册: memory_search / conversation_search / memory_read_scene / memory_receipts / memory_search_graph / memory_expand_graph_node,及高权限 memory_add/memory_import/memory_delete / memory_resolve_conflict / memory_ruminate / memory_ruminate_cancel / memory_ruminate_status');
    // 技能组(registerSkillTools)在注册期经本面登记,随 volatile 热更重放封印。
    return { reg };
}
/** 凭证回溯的人类可读渲染(含"还有多少条没显示")。 */
function renderReceipts(dimension, items, total) {
    const what = dimension === 'record' ? '该记录出自哪一轮' : dimension === 'run' ? '该批次的全部决策' : '该记录在该批次中的决策';
    if (items.length === 0)
        return `(${what}:没有查到凭证——该 id 可能从未走过 L1 去重,或凭证已超出保留窗口)`;
    const lines = items.map((it, i) => `${i + 1}. [${it.kind ?? ''}] run=${it.run_id ?? ''} record=${it.record_id ?? ''}` +
        `\n   时刻: ${it.decided_at ?? ''}\n   输入指纹: ${(it.input_digest ?? '').slice(0, 16)}…`);
    const more = total > items.length ? `\n…共 ${total} 条,已显示 ${items.length} 条` : '';
    return `${what}(${items.length} 条):\n${lines.join('\n')}${more}`;
}
function renderGraphCards(items) {
    if (!items || items.length === 0)
        return '(图谱中没有找到相关实体)';
    return items
        .map((it, i) => {
        const state = it.current_state ? `\n   状态: ${it.current_state.replaceAll('\n', ' / ')}` : '';
        return `${i + 1}. ${it.name ?? ''}(类型 ${it.type ?? ''},id=${it.id ?? ''})${state}\n   匹配: ${it.match_reason ?? ''}`;
    })
        .join('\n');
}
function renderMemoryItems(items) {
    if (!items || items.length === 0)
        return '(没有找到相关记忆)';
    // id 必须进渲染文本:模型看到的是 render 产物而非原始 JSON——漏了它,
    // "search 返回 record_id" 对模型等于没返回(真机教训,v0.20.3)。
    return items
        .map((it, i) => {
        const head = `${i + 1}. [${it.type ?? ''}]${it.scene_name ? ` (${it.scene_name})` : ''} ${it.content ?? ''}`;
        return it.id ? `${head} — id: ${it.id}` : head;
    })
        .join('\n');
}
function renderConversationItems(items) {
    if (!items || items.length === 0)
        return '(没有找到相关对话)';
    return items
        .map((it, i) => {
        const time = it.timestamp ? new Date(it.timestamp).toISOString() : '';
        return `${i + 1}. [${it.role ?? ''}]${time ? ` ${time}` : ''} (session=${it.session_id ?? ''})\n${it.content ?? ''}`;
    })
        .join('\n\n');
}
function renderRuminateStatus(v) {
    const running = v.running ?? false;
    const status = running ? `🔄 反刍运行中` : '✅ 反刍已完成';
    const phaseMap = {
        idle: '空闲',
        distilling: 'L1 蒸馏中',
        consolidating: 'L2 场景整合中',
        updating: 'L3 画像更新中',
        done: '完成',
        cancelled: '已取消',
        failed: '失败',
    };
    const phase = phaseMap[v.phase ?? 'idle'] ?? v.phase ?? 'idle';
    const total = v.total ?? 0;
    const done = v.done ?? 0;
    const parts = [`${status} [${phase}]`];
    if (running || total > 0) {
        parts.push(`进度: ${done}/${total} 会话`);
    }
    if ((v.recordsBuilt ?? 0) > 0) {
        parts.push(`产出: ${v.recordsBuilt} 条记忆`);
    }
    if (v.startedAt) {
        parts.push(`开始: ${v.startedAt}`);
    }
    if (v.finishedAt) {
        parts.push(`结束: ${v.finishedAt}`);
    }
    if (v.error) {
        parts.push(`错误: ${v.error}`);
    }
    if (v.cancelRequested) {
        parts.push('⚠️ 已请求取消');
    }
    return parts.join(' | ');
}
