/**
 * 技能工具面（轨2）。**整块仅在 cfg.skills.enabled 时注册**——默认关时零表面积
 * （对齐 benchControl"生产部署零表面积"先例，避免注册了却被门控的空壳工具污染模型工具列表）。
 *
 * 读工具 list/read；写工具 pin/archive 过 live.memoryMutate 高权限门（与 memory_add 同门）。
 * 技能不是 memory `type`，这些工具只操作 SkillStore sidecar，不触碰 l1_records / ADD_TYPES / prompt 词表。
 */
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { MemoryConfig } from '../config.js';
import type { LiveSettingsHandle } from '../settings.js';
import type { SkillStore } from '../store/skill-store.js';
import type { MemoryLogger } from '../types.js';

const MUTATE_OFF_NOTICE = '记忆写删未开放：请在记忆库面板开启「高权限模式」后，模型才能改动技能。';

export function registerSkillTools(
  ctx: Context,
  cfg: MemoryConfig,
  skills: SkillStore,
  logger: MemoryLogger,
  live: LiveSettingsHandle,
): void {
  if (!cfg.skills.enabled) return; // 默认关：一个工具都不注册

  // memory_skill_list：列全部技能摘要（含 status/sessionCount，candidate 也列出供审阅）。
  ctx.tools.register(
    defineTool({
      name: 'memory_skill_list',
      description: '列出已沉淀的技能(程序性记忆)摘要：id/标题/状态/档位/覆盖会话数。用于查看技能库现状与候选晋升情况。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          properties: {
            skills: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  status: { type: 'string' },
                  tier: { type: 'string' },
                  pinned: { type: 'boolean' },
                  sessionCount: { type: 'number' },
                },
                additionalProperties: false,
              },
            },
            notice: { type: 'string' },
          },
          additionalProperties: false,
        },
        render: (_a, v) => [{ type: 'text', text: v.notice ?? `共 ${v.skills?.length ?? 0} 个技能` }],
      },
      execute: async () => {
        const list = skills.list().map((s) => ({
          id: s.id,
          title: s.title,
          status: s.status,
          tier: s.injectionTier,
          pinned: s.pinned,
          sessionCount: skills.sessionCount(s.id),
        }));
        return { skills: list, notice: `共 ${list.length} 个技能` };
      },
    }),
  );

  // memory_skill_read：取某技能完整正文 + 步骤。
  ctx.tools.register(
    defineTool({
      name: 'memory_skill_read',
      description: '读取一条技能的完整正文与步骤清单（按 id）。用于展开注入里被截断/excerpt 档的技能细节。',
      parameters: { id: { type: 'string', required: true, description: '技能 id（来自 memory_skill_list 或注入头）' } },
      output: {
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            body: { type: 'string' },
            steps: { type: 'array', items: { type: 'string' } },
            notice: { type: 'string' },
          },
          additionalProperties: false,
        },
        render: (_a, v) => [
          {
            type: 'text',
            text: v.notice ?? [`【${v.title}】`, v.body, ...(v.steps || []).map((s) => `  - ${s}`)].join('\n'),
          },
        ],
      },
      execute: async (args: { id?: string }) => {
        const id = String(args?.id ?? '').trim();
        const s = skills.get(id);
        if (!s) return { id, title: '', body: '', steps: [], notice: `未找到技能 ${id}` };
        return { id: s.id, title: s.title, body: s.body, steps: s.steps };
      },
    }),
  );

  // memory_skill_pin：pin/unpin（高权限门）。pinned 技能不受闲置归档影响。
  ctx.tools.register(
    defineTool({
      name: 'memory_skill_pin',
      description: '固定/取消固定一条技能（按 id）。固定后不参与闲置自动归档。仅用户显式要求时用；需高权限模式。',
      parameters: {
        id: { type: 'string', required: true, description: '技能 id' },
        pinned: { type: 'boolean', required: true, description: 'true=固定，false=取消固定' },
      },
      output: {
        schema: {
          type: 'object',
          properties: { notice: { type: 'string' } },
          additionalProperties: false,
        },
        render: (_a, v) => [{ type: 'text', text: v.notice ?? '' }],
      },
      execute: async (args: { id?: string; pinned?: boolean }) => {
        if (!live.get().memoryMutate) return { notice: MUTATE_OFF_NOTICE };
        const id = String(args?.id ?? '').trim();
        const changed = await skills.update(id, { pinned: args?.pinned === true });
        return { notice: changed ? `已${args?.pinned === true ? '固定' : '取消固定'}技能 ${id}` : `未找到技能 ${id} 或无变化` };
      },
    }),
  );

  // memory_skill_archive：归档（高权限门）；走 sidecar 生命周期，不触碰 l1_records 退场。
  ctx.tools.register(
    defineTool({
      name: 'memory_skill_archive',
      description: '归档一条技能（按 id，可给原因）。归档后不再注入，但记录保留可恢复。仅用户显式要求时用；需高权限模式。',
      parameters: {
        id: { type: 'string', required: true, description: '技能 id' },
        reason: { type: 'string', description: '归档原因（可选，供审计）' },
      },
      output: {
        schema: {
          type: 'object',
          properties: { notice: { type: 'string' } },
          additionalProperties: false,
        },
        render: (_a, v) => [{ type: 'text', text: v.notice ?? '' }],
      },
      execute: async (args: { id?: string; reason?: string }) => {
        if (!live.get().memoryMutate) return { notice: MUTATE_OFF_NOTICE };
        const id = String(args?.id ?? '').trim();
        const done = await skills.archive(id, String(args?.reason ?? 'manual').slice(0, 120) || 'manual');
        if (done) logger.info(`[memory] 技能归档 ${id}`);
        return { notice: done ? `已归档技能 ${id}` : `未找到技能 ${id} 或已归档` };
      },
    }),
  );
}
