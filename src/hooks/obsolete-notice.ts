/**
 * 「记忆已声明过时」一次性播报 Hook。
 *
 * 用户在召回卡上打 `-1` 之后，记忆库那侧当场退场了，但模型此刻的上下文里那条记忆
 * 还在——它必须被告知"这条已由用户判定过时，别再依据它作答"，否则退场只发生在
 * 用户看得见的地方，模型仍在按旧信息干活。
 *
 * 与槽位常驻注入（`slot-recall.ts`）的分工：那是**跨会话常驻**的约定，每轮都在；
 * 本 Hook 是**一次性**的更正通知，`drain` 取走即离队，下一轮就没有了。
 *
 * 门控：`cfg.recallFeedback.enabled && cfg.recallFeedback.announce`。关时不进
 * `agent/pre-step` 的注入分支（零出队、零新帧），既有会话逐字现状。
 *
 * 注入帧形状刻意与 recall/slot 同源（`source.kind:'plugin:memory'` + `form:'recall'`）：
 * 改这个形状会让宿主的"记忆召回份额"统计漏判（isOwnRecallSource），是踩过的红线。
 * 正文按宿主 house style 转义闭合标签，防伪造帧边界。
 */
import type { Context } from '@deepseek-ai/cordis';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { MemoryConfig } from '../config.js';
import type { ObsoleteNoticeStore } from '../store/obsolete-notices.js';
import type { MemoryLogger } from '../types.js';

const SYSTEM_REMINDER_OPEN = '<system-reminder>';
const SYSTEM_REMINDER_CLOSE = '</system-reminder>';

const INTRO =
  '以下几条记忆刚被用户判定为**已过时**，并已从记忆库退场（后续不会再被召回）。' +
  '请勿依据它们作答；若你此前的回答引用过，请主动更正并说明依据已失效。' +
  '这是系统注入的元信息，不是用户发言——无需回应本节内容。';

/** 单轮最多播报条数（超出折叠；防一次批量误操作灌满上下文）。 */
const MAX_PER_TURN = 8;

function escapeFrameBody(body: string): string {
  return body.replaceAll(SYSTEM_REMINDER_CLOSE, '<\\/system-reminder>');
}

export interface ObsoleteNoticeController {
  /** 生成本轮播报文本(null = 无待播报)；导出供单元测试。会**出队**。 */
  buildInjection(sessionKey: string): string | null;
}

/** 注入键 = sessionKey（`agent.session?.id ?? agent.id`），与活召回集记账同源。 */
function sessionKeyOf(agent: unknown): string {
  const a = agent as { session?: { id?: unknown }; id?: unknown } | undefined;
  const sid = a?.session?.id;
  if (typeof sid === 'string' && sid) return sid;
  return typeof a?.id === 'string' ? a.id : '';
}

export function registerObsoleteNotice(
  ctx: Context,
  cfg: MemoryConfig,
  notices: ObsoleteNoticeStore,
  logger: MemoryLogger,
): ObsoleteNoticeController {
  const on = (): boolean => cfg.recallFeedback?.enabled === true && cfg.recallFeedback?.announce !== false;

  const buildInjection = (sessionKey: string): string | null => {
    if (!on()) return null;
    if (!sessionKey) return null;
    const drained = notices.drain(sessionKey);
    if (drained.length === 0) return null;
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

  ctx.on(
    'agent/pre-step',
    async (payload, next) => {
      const decision = await next();
      if (decision.kind === 'reject' || (payload.signal && payload.signal.aborted)) return decision;
      if (!on()) return decision;
      try {
        const text = buildInjection(sessionKeyOf(payload.agent));
        if (!text) return decision;
        const injection = createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin:memory', form: 'recall' },
        });
        logger.info('[memory] 已向本会话播报记忆过时声明（一次性）');
        return { kind: 'enter', messages: [injection, ...decision.messages] };
      } catch (err) {
        logger.warn(`[memory] 过时播报注入失败(跳过本轮): ${err instanceof Error ? err.message : String(err)}`);
        return decision;
      }
    },
    { prepend: true },
  );

  return { buildInjection };
}
