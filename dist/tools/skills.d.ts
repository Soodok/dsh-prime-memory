/**
 * 技能工具面（轨2）。**经宿主封印机制登记**（`seals.reg('skills', …)`），不再自行判门——
 * 是否真正注册由 `registerMemoryTools` 的 `toolSealed('skills')` 决定：
 *   - 功能关（部署 `cfg.skills.enabled` 与 live `skillsEnabled` 取或为 false）⇒ 封印，零表面积；
 *   - 功能开但 `live.toolSkills === false` ⇒ 封印，从模型工具列表移除。
 * 两者都随 `loader/volatile-update` 热更（面板拨开关即时注册/反注册，无需重启）。
 *
 * 读工具 list/read；写工具 pin/archive 过 live.memoryMutate 高权限门（与 memory_add 同门）。
 * 技能不是 memory `type`，这些工具只操作 SkillStore sidecar，不触碰 l1_records / ADD_TYPES / prompt 词表。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { LiveSettingsHandle } from '../settings.js';
import type { SkillStore } from '../store/skill-store.js';
import type { MemoryLogger } from '../types.js';
import type { ToolSealRegistry } from './index.js';
export declare function registerSkillTools(ctx: Context, skills: SkillStore, logger: MemoryLogger, live: LiveSettingsHandle, seals: ToolSealRegistry): void;
