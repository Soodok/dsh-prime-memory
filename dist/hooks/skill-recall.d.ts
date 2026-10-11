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
import type { MemoryConfig } from '../config.js';
import type { LiveSettingsHandle } from '../settings.js';
import type { Skill, SkillStore } from '../store/skill-store.js';
import type { MemoryLogger } from '../types.js';
/** 按档位现场组词：full=标题+正文+步骤；excerpt=标题+正文截断；hint=仅标题+读取指引。 */
export declare function renderSkill(s: Skill, excerptChars: number): string;
export interface SkillRecallController {
    buildInjection(): string | null;
}
export declare function registerSkillRecall(ctx: Context, cfg: MemoryConfig, skills: SkillStore, logger: MemoryLogger, live: LiveSettingsHandle): SkillRecallController;
