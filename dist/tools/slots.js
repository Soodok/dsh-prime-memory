import { defineTool } from '@deepseek-ai/dsh-tools';
const MUTATE_OFF_NOTICE = '槽位写操作未开放:请在记忆库面板开启高权限模式(memoryMutate)后再试。';
const OFF_NOTICE = '本会话的记忆档位为"关闭":槽位读取不可用。';
const GLOBAL_OFF_NOTICE = '记忆召回已关闭:槽位读取不可用。';
export function registerSlotTools(ctx, cfg, slots, logger, modes, live, 
/** L1 存储句柄:close 的 refs→记忆勾连(解析/退场)依赖;缺省时 close 只关槽位不碰 L1。
 *  退场文件的跟随不在本模块点火：`l1.retire()` 已收口（`store/memory-md-sync.ts`）。 */
l1) {
    if (!cfg.tools)
        return;
    /** 解析有效归属会话(简化版,仅取自身 id;跨会话持久的槽位不依赖父链)。 */
    const ownerOf = (exec) => exec?.agent?.id;
    /** 读类工具档位门控:off / 召回关 → 返回 notice(与 memory_search 同语义)。 */
    const readBlockNotice = (exec) => {
        const owner = ownerOf(exec);
        if (owner === undefined)
            return undefined; // fail-open:缺 agent 标识不拒绝
        if (modes.get(owner) === 'off')
            return OFF_NOTICE;
        if (!modes.resolvedRecall(owner, live.get().recall))
            return GLOBAL_OFF_NOTICE;
        return undefined;
    };
    // ── memory_slot_list:列出槽位(读,档位门控) ──
    ctx.tools.register(defineTool({
        name: 'memory_slot_list',
        description: '列出当前所有激活槽位(active slot)。槽位是可跨会话持久化的结构化提示(规则/待办/锚点/指针);pinned 的 open 槽位会被常驻注入每轮对话上下文。' +
            '条目的 refs 是记忆指针:L1 record_id 类 refs 可用 memory_receipts / memory_search / memory_read_scene 勾连读取原文;路径与 URL 类 refs 按字面访问。',
        parameters: {
            status: { type: 'string', description: '按状态过滤:open / done / dropped / expired;留空返回全部' },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    slots: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                title: { type: 'string' },
                                kind: { type: 'string' },
                                status: { type: 'string' },
                                priority: { type: 'number' },
                                pinned: { type: 'boolean' },
                                body: { type: 'string' },
                                refs: { type: 'array', items: { type: 'string' } },
                                validUntil: { type: 'string' },
                                createdAt: { type: 'string' },
                                updatedAt: { type: 'string' },
                            },
                            additionalProperties: false,
                        },
                    },
                    notice: { type: 'string' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => {
                const slots = value.slots ?? [];
                const text = value.notice
                    ? value.notice
                    : `当前槽位 ${slots.length} 个:\n` +
                        slots
                            .map((s) => `- [${s.status}${s.pinned ? ',pinned' : ''}] ${s.title} (${s.kind}, p${s.priority})`)
                            .join('\n');
                return [{ type: 'text', text }];
            },
        },
        execute: async (args, exec) => {
            const notice = readBlockNotice(exec);
            if (notice)
                return { slots: [], notice };
            let all = slots.list();
            if (typeof args.status === 'string' && args.status.trim()) {
                const st = args.status.trim();
                all = all.filter((s) => s.status === st);
            }
            // 显式压成 output schema 声明的形状:
            // ① store 的 Slot 恒带 `validUntil: undefined` 键(归一化无条件写键,clone 展开保留)
            //   —— undefined 键经 JSON.stringify 会被丢掉,宿主无损往返校验报 "not lossless JSON";
            // ② Slot.origin 不在 schema(additionalProperties:false)里,透传会被 schema 校验拒。
            // 两个都要在工具边界剥掉,store 持久化形状不动。
            return {
                slots: all.map((s) => ({
                    id: s.id,
                    title: s.title,
                    kind: s.kind,
                    status: s.status,
                    priority: s.priority,
                    pinned: s.pinned,
                    body: s.body,
                    refs: [...s.refs],
                    ...(s.validUntil !== undefined ? { validUntil: s.validUntil } : {}),
                    createdAt: s.createdAt,
                    updatedAt: s.updatedAt,
                })),
            };
        },
    }));
    // ── memory_slot_write:写入新槽位(写,memoryMutate 门控) ──
    ctx.tools.register(defineTool({
        name: 'memory_slot_write',
        description: '写入一个激活槽位(active slot)。适合把跨会话需要持续生效的规则、待办、锚点或外部指针固化下来;pinned=true 的 open 槽位会常驻注入每轮对话上下文。需高权限模式开启。refs 中的 L1 record_id 必须真实存在(用 memory_search 返回的 id),否则写入被拒。',
        parameters: {
            title: { type: 'string', required: true, description: '槽位标题(≤60 字,一句话概括)' },
            kind: { type: 'string', description: '槽位类型:rule(规则)/todo(待办)/anchor(锚点)/pointer(指针,正文可空)' },
            body: { type: 'string', description: '槽位正文(≤512 字;pointer 类型可留空)' },
            priority: { type: 'number', description: '优先级 0-100(默认 50;常驻注入时高优先级优先)' },
            pinned: { type: 'boolean', description: '是否常驻注入每轮对话上下文(默认 false)' },
            refs: { type: 'string', description: '关联引用(L1 record_id / 文件路径 / URL),逗号分隔' },
            validUntil: { type: 'string', description: '有效期止(ISO 8601);留空表示长期有效' },
            status: { type: 'string', description: '初始状态(默认 open)' },
        },
        output: {
            schema: {
                type: 'object',
                properties: { id: { type: 'string' }, notice: { type: 'string' } },
                additionalProperties: false,
            },
            render: (_args, value) => [
                { type: 'text', text: value.notice ?? `已写入槽位 ${value.id ?? ''}` },
            ],
        },
        execute: async (args, _exec) => {
            if (!live.get().memoryMutate)
                return { notice: MUTATE_OFF_NOTICE };
            const input = {
                title: String(args.title ?? ''),
                kind: typeof args.kind === 'string' ? args.kind : undefined,
                body: typeof args.body === 'string' ? args.body : undefined,
                priority: typeof args.priority === 'number' ? args.priority : undefined,
                pinned: typeof args.pinned === 'boolean' ? args.pinned : undefined,
                refs: typeof args.refs === 'string'
                    ? args.refs
                        .split(',')
                        .map((r) => r.trim())
                        .filter(Boolean)
                    : undefined,
                validUntil: typeof args.validUntil === 'string' && args.validUntil.trim()
                    ? args.validUntil.trim()
                    : undefined,
                status: typeof args.status === 'string' ? args.status : undefined,
                origin: 'user',
            };
            // mem_ 引用必须真实存在(v0.21.0):保证"search 激活的记忆"进入引用的是
            // 真实 record_id——模型幻觉/拼错的 id 直接拒绝并给出修正路径,不让坏引用
            // 静默进槽位(否则 brief 侧解析不出名称简述)。文件路径/URL 类 refs 不校验。
            const memRefs = (input.refs ?? []).filter((r) => r.startsWith('mem_'));
            if (memRefs.length > 0 && l1) {
                const found = new Set(l1.getByIds([...memRefs]).map((r) => r.id));
                const missing = memRefs.filter((id) => !found.has(id));
                if (missing.length > 0) {
                    return {
                        notice: `写入被拒:refs 中的 L1 record_id 不存在(${missing.join(', ')})。` +
                            `请先用 memory_search 搜索,使用其返回的 id;文件路径/URL 类 refs 无需此校验。`,
                    };
                }
            }
            try {
                const slot = await slots.upsert(input);
                logger.info(`[memory] 写入激活槽位(${slot.kind},pinned=${slot.pinned}):${slot.title.slice(0, 60)}`);
                return { id: slot.id };
            }
            catch (err) {
                return { notice: err instanceof Error ? err.message : String(err) };
            }
        },
    }));
    // ── memory_slot_close:关闭槽位(写,memoryMutate 门控) ──
    ctx.tools.register(defineTool({
        name: 'memory_slot_close',
        description: '关闭一个激活槽位(标记 done 或 dropped)。关闭后不再常驻注入,但仍可在 memory_slot_list 中查看。需高权限模式开启。' +
            '槽位的 refs 是记忆指针(L1 record_id / 文件路径 / URL):关闭槽位不会自动处理被引用的记忆,' +
            '可用 retireRefs=true 把其中能解析到 L1 记录的条目一并退场(软删,可在记忆列表恢复)。',
        parameters: {
            id: { type: 'string', required: true, description: '要关闭的槽位 id(来自 memory_slot_list)' },
            status: { type: 'string', description: '关闭后的状态:done(完成)/dropped(放弃);默认 done' },
            retireRefs: {
                type: 'boolean',
                description: '联动退场:把 refs 中能解析到现存 L1 记录的条目一并软删退场(可恢复);不传或 false 只关槽位,返回 linked 列表由模型/人决定后续',
            },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    ok: { type: 'boolean' },
                    /** refs 中能解析到现存 L1 记录的条目(方案 A:回带给模型/人判定)。 */
                    linked: { type: 'array', items: { type: 'string' } },
                    /** 实际随本次关闭退场的 L1 记录 id(方案 B,仅 retireRefs=true 时非空)。 */
                    retired: { type: 'array', items: { type: 'string' } },
                    notice: { type: 'string' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => {
                if (value.notice && !value.ok)
                    return [{ type: 'text', text: value.notice }];
                const lines = [value.notice ?? (value.ok ? '已关闭槽位' : '槽位不存在或关闭失败')];
                // 局部收窄:schema 里 linked/retired 是可选字段,模板串里直接引用过不了 TS18048
                const retired = value.retired ?? [];
                const linked = value.linked ?? [];
                if (retired.length > 0) {
                    lines.push(`已随槽位关闭退场 ${retired.length} 条引用记忆(软删,可在记忆列表恢复):${retired.join('，')}`);
                }
                else if (linked.length > 0) {
                    lines.push(`该槽位引用 ${linked.length} 条 L1 记忆(${linked.join('，')})——正文仍在检索面。` +
                        '如确认已失效,可用 memory_delete 按 id 精确退场,或重新关闭并带 retireRefs=true。');
                }
                return [{ type: 'text', text: lines.join('\n') }];
            },
        },
        execute: async (args, _exec) => {
            if (!live.get().memoryMutate) {
                return { ok: false, linked: [], retired: [], notice: MUTATE_OFF_NOTICE };
            }
            const id = String(args.id ?? '').trim();
            if (!id)
                return { ok: false, linked: [], retired: [], notice: 'id 为空' };
            const status = args.status === 'dropped' ? 'dropped' : 'done';
            // 关闭前先取槽位:close 后 refs 仍可从 list 查到,但取一次副本语义最直白
            const slot = slots.get(id);
            const ok = await slots.close(id, status);
            if (!ok)
                return { ok: false, linked: [], retired: [], notice: '槽位不存在或关闭失败' };
            if (ok)
                logger.info(`[memory] 关闭激活槽位(${status}):${id}`);
            // ── 勾连记忆(读侧判定,写侧仅在 retireRefs=true 时执行) ──
            // refs 三类:L1 record_id / 文件路径 / URL。能被 l1.getByIds 解析到现存记录的
            // 才算"记忆引用"——路径与 URL 天然落空,自动跳过,不需要格式猜测。
            const refs = slot?.refs ?? [];
            let linked = [];
            if (l1 && refs.length > 0) {
                const found = l1.getByIds(refs);
                linked = found.map((r) => r.id);
            }
            let retired = [];
            if (args.retireRefs === true && l1 && linked.length > 0) {
                const n = l1.retire(linked, { at: new Date().toISOString(), reason: 'manual' });
                // retire 按存在行计数,理论上等于 linked.length;以返回数截取语义诚实
                retired = linked.slice(0, n);
                if (retired.length > 0) {
                    logger.info(`[memory] 随槽位关闭退场(软删)引用记忆 ${retired.length} 条(${retired.join('，')})`);
                }
            }
            return { ok: true, linked, retired };
        },
    }));
}
