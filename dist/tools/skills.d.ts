/**
 * 技能工具面（轨2）。**整块仅在 cfg.skills.enabled 时注册**——默认关时零表面积
 * （对齐 benchControl"生产部署零表面积"先例，避免注册了却被门控的空壳工具污染模型工具列表）。
 *
 * 读工具 list/read；写工具 pin/archive 过 live.memoryMutate 高权限门（与 memory_add 同门）。
 * 技能不是 memory `type`，这些工具只操作 SkillStore sidecar，不触碰 l1_records / ADD_TYPES / prompt 词表。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { MemoryConfig } from '../config.js';
import type { LiveSettingsHandle } from '../settings.js';
import type { SkillStore } from '../store/skill-store.js';
import type { MemoryLogger } from '../types.js';
export declare function registerSkillTools(ctx: Context, cfg: MemoryConfig, skills: SkillStore, logger: MemoryLogger, live: LiveSettingsHandle): void;
