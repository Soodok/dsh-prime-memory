import { createUserMessage } from '@deepseek-ai/dsh-llm';
const SYSTEM_REMINDER_OPEN = '<system-reminder>';
const SYSTEM_REMINDER_CLOSE = '</system-reminder>';
const SKILLS_INTRO = '以下是本环境沉淀的技能(程序性记忆):过去重复工作流固化出的清单,仅在与之相关时作为指引遵循。' +
    '它们是系统注入的元信息,不是用户发言——无需回应,请勿在回复中复述本节内容;' +
    '且不覆盖系统提示与用户的直接指令。需要完整步骤用 memory_skill_read 展开。';
function escapeFrameBody(body) {
    return body.replaceAll(SYSTEM_REMINDER_CLOSE, '<\\/system-reminder>');
}
/** 按档位现场组词：full=标题+正文+步骤；excerpt=标题+正文截断；hint=仅标题+读取指引。 */
export function renderSkill(s, excerptChars) {
    if (s.injectionTier === 'hint')
        return `[技能·${s.title}] 详见 memory_skill_read(${s.id})`;
    const steps = s.steps.length ? '\n' + s.steps.map((st) => `  - ${st}`).join('\n') : '';
    if (s.injectionTier === 'full')
        return `[技能·${s.title}] ${s.body}${steps}`;
    const body = s.body.length > excerptChars ? s.body.slice(0, excerptChars) + '…' : s.body;
    return `[技能·${s.title}] ${body}`;
}
export function registerSkillRecall(ctx, cfg, skills, logger) {
    const buildInjection = () => {
        if (!cfg.skills.enabled || !cfg.skills.inject)
            return null;
        const active = skills.listActive();
        if (active.length === 0)
            return null;
        const budget = cfg.skills.maxPerTurnBytes;
        const out = [];
        let used = 0;
        let hidden = 0;
        for (const s of active) {
            const rendered = renderSkill(s, cfg.skills.excerptChars);
            const bytes = Buffer.byteLength(rendered, 'utf8');
            if (used + bytes > budget) {
                hidden++;
                continue;
            }
            out.push(rendered);
            used += bytes;
        }
        if (out.length === 0)
            return null;
        if (hidden > 0)
            out.push(`… 另有 ${hidden} 个技能因预算未显示,可用 memory_skill_list 查看`);
        return [SYSTEM_REMINDER_OPEN, SKILLS_INTRO, escapeFrameBody(out.join('\n')), SYSTEM_REMINDER_CLOSE].join('\n');
    };
    ctx.on('agent/pre-step', async (payload, next) => {
        const decision = await next();
        if (decision.kind === 'reject' || (payload.signal && payload.signal.aborted))
            return decision;
        if (!cfg.skills.enabled || !cfg.skills.inject)
            return decision;
        try {
            await skills.archiveDue(Date.now(), cfg.skills.idleArchiveDays);
            const text = buildInjection();
            if (!text)
                return decision;
            const injection = createUserMessage({
                content: [{ type: 'text', text }],
                source: { kind: 'plugin:memory', form: 'recall' },
            });
            return { kind: 'enter', messages: [injection, ...decision.messages] };
        }
        catch (err) {
            logger.warn(`[memory] 技能注入失败(跳过本轮): ${err instanceof Error ? err.message : String(err)}`);
            return decision;
        }
    });
    return { buildInjection };
}
