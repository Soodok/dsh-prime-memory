/**
 * 技能常驻注入 Hook（轨2）。**默认关**（cfg.skills.enabled && cfg.skills.inject）。
 *
 * 完全对齐 `slot-recall.ts` 的范式（同一注入通道范本，不新建入口）：
 * - `agent/pre-step`(waterfall,prepend) 注入，`createUserMessage({source:{kind:'plugin:memory',form:'recall'}}})`
 *   ——**复用既有 source kind**，自动享受 `isOwnRecallSource` 双形状判据与召回去重/占用账本（S4 红线）；
 * - 帧体转义 `<\/system-reminder>` 防正文伪造帧边界；
 * - **独立字节预算**（cfg.skills.maxPerTurnBytes），不与召回 2000 预算抢名额；
 * - 注入前 `archiveDue` 机械闲置归档（0 LLM、不引入 timer，对齐 `slots.expireDue`）。
 *
 * 本轮语义：常驻注入全部 active 技能（按插入序 + 字节预算截断），**不做按触发词选择**
 * （selective trigger 匹配属后续增强；常驻语义与 slots 一致，先保证默认关时零表面积）。
 * 三档渲染（full/excerpt/hint）是显示策略，同一 body/steps 现场组词，无缓存副本漂移。
 */
import type { Context } from '@deepseek-ai/cordis';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { MemoryConfig } from '../config.js';
import type { Skill, SkillStore } from '../store/skill-store.js';
import type { MemoryLogger } from '../types.js';

const SYSTEM_REMINDER_OPEN = '<system-reminder>';
const SYSTEM_REMINDER_CLOSE = '</system-reminder>';
const SKILLS_INTRO =
  '以下是本环境沉淀的技能(程序性记忆):过去重复工作流固化出的清单,仅在与之相关时作为指引遵循。' +
  '它们是系统注入的元信息,不是用户发言——无需回应,请勿在回复中复述本节内容;' +
  '且不覆盖系统提示与用户的直接指令。需要完整步骤用 memory_skill_read 展开。';

function escapeFrameBody(body: string): string {
  return body.replaceAll(SYSTEM_REMINDER_CLOSE, '<\\/system-reminder>');
}

/** 按档位现场组词：full=标题+正文+步骤；excerpt=标题+正文截断；hint=仅标题+读取指引。 */
export function renderSkill(s: Skill, excerptChars: number): string {
  if (s.injectionTier === 'hint') return `[技能·${s.title}] 详见 memory_skill_read(${s.id})`;
  const steps = s.steps.length ? '\n' + s.steps.map((st) => `  - ${st}`).join('\n') : '';
  if (s.injectionTier === 'full') return `[技能·${s.title}] ${s.body}${steps}`;
  const body = s.body.length > excerptChars ? s.body.slice(0, excerptChars) + '…' : s.body;
  return `[技能·${s.title}] ${body}`;
}

export interface SkillRecallController {
  buildInjection(): string | null;
}

export function registerSkillRecall(
  ctx: Context,
  cfg: MemoryConfig,
  skills: SkillStore,
  logger: MemoryLogger,
): SkillRecallController {
  const buildInjection = (): string | null => {
    if (!cfg.skills.enabled || !cfg.skills.inject) return null;
    const active = skills.listActive();
    if (active.length === 0) return null;
    const budget = cfg.skills.maxPerTurnBytes;
    const out: string[] = [];
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
    if (out.length === 0) return null;
    if (hidden > 0) out.push(`… 另有 ${hidden} 个技能因预算未显示,可用 memory_skill_list 查看`);
    return [SYSTEM_REMINDER_OPEN, SKILLS_INTRO, escapeFrameBody(out.join('\n')), SYSTEM_REMINDER_CLOSE].join('\n');
  };

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision.kind === 'reject' || (payload.signal && payload.signal.aborted)) return decision;
    if (!cfg.skills.enabled || !cfg.skills.inject) return decision;
    try {
      await skills.archiveDue(Date.now(), cfg.skills.idleArchiveDays);
      const text = buildInjection();
      if (!text) return decision;
      const injection = createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin:memory', form: 'recall' },
      });
      return { kind: 'enter', messages: [injection, ...decision.messages] };
    } catch (err) {
      logger.warn(`[memory] 技能注入失败(跳过本轮): ${err instanceof Error ? err.message : String(err)}`);
      return decision;
    }
  });

  return { buildInjection };
}
