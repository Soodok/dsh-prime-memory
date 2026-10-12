import { createUserMessage } from '@deepseek-ai/dsh-llm';
const SYSTEM_REMINDER_OPEN = '<system-reminder>';
const SYSTEM_REMINDER_CLOSE = '</system-reminder>';
const INTRO = '以下几条记忆刚被用户判定为**已过时**，并已从记忆库退场（后续不会再被召回）。' +
    '请勿依据它们作答；若你此前的回答引用过，请主动更正并说明依据已失效。' +
    '这是系统注入的元信息，不是用户发言——无需回应本节内容。';
/** 单轮最多播报条数（超出折叠；防一次批量误操作灌满上下文）。 */
const MAX_PER_TURN = 8;
function escapeFrameBody(body) {
    return body.replaceAll(SYSTEM_REMINDER_CLOSE, '<\\/system-reminder>');
}
/** 注入键 = sessionKey（`agent.session?.id ?? agent.id`），与活召回集记账同源。 */
function sessionKeyOf(agent) {
    const a = agent;
    const sid = a?.session?.id;
    if (typeof sid === 'string' && sid)
        return sid;
    return typeof a?.id === 'string' ? a.id : '';
}
export function registerObsoleteNotice(ctx, cfg, notices, logger) {
    const on = () => cfg.recallFeedback?.enabled === true && cfg.recallFeedback?.announce !== false;
    const buildInjection = (sessionKey) => {
        if (!on())
            return null;
        if (!sessionKey)
            return null;
        const drained = notices.drain(sessionKey);
        if (drained.length === 0)
            return null;
        const lines = drained.slice(0, MAX_PER_TURN).map((n) => `- ${n.title || n.id}`);
        if (drained.length > MAX_PER_TURN) {
            lines.push(`… 另有 ${drained.length - MAX_PER_TURN} 条同批声明过时的记忆未列出`);
        }
        return [
            SYSTEM_REMINDER_OPEN,
            INTRO,
            escapeFrameBody(lines.join('\n')),
            SYSTEM_REMINDER_CLOSE,
        ].join('\n');
    };
    ctx.on('agent/pre-step', async (payload, next) => {
        const decision = await next();
        if (decision.kind === 'reject' || (payload.signal && payload.signal.aborted))
            return decision;
        if (!on())
            return decision;
        try {
            const text = buildInjection(sessionKeyOf(payload.agent));
            if (!text)
                return decision;
            const injection = createUserMessage({
                content: [{ type: 'text', text }],
                source: { kind: 'plugin:memory', form: 'recall' },
            });
            logger.info('[memory] 已向本会话播报记忆过时声明（一次性）');
            return { kind: 'enter', messages: [injection, ...decision.messages] };
        }
        catch (err) {
            logger.warn(`[memory] 过时播报注入失败(跳过本轮): ${err instanceof Error ? err.message : String(err)}`);
            return decision;
        }
    }, { prepend: true });
    return { buildInjection };
}
