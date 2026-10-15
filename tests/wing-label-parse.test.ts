/**
 * wing/tags 标注器的**解析契约**回归测试。
 *
 * 这里钉的是一个真实线上事故:提示词要求返回 `"wing"`,但解析读的是 `item.hall`
 * → 每批 20 条全部配对失败 → `out` 恒空 → 反刍日志只增长 llmSkipped 而 wingLabeled 恒为 0,
 * 且**一条错误日志都没有**,排查代价极高(靠 LLM 输出 961 字符反推才定位)。
 *
 * 因此本文件同时钉两件事:
 *   1. 字段名必须是 `wing`(`hall` 是**另一个维度**,其值域与 Wing 不相交);
 *   2. 任何丢弃都必须留痕 —— 静默丢弃是这次事故放大伤害的主因。
 *
 * 形状:标注器已改**逐条**(一个请求只装一条),故这里是单条进单条出的契约。
 */
import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import type { MemoryLogger, MemoryRecord } from '../src/types.js';
import type { MemoryConfig } from '../src/config.js';

/** LLM 桩:按序吐出预设回复,并记录每次调用的 layer/user/system(供断言提示词内容)。 */
const llmReplies: string[] = [];
const llmCalls: Array<{ layer?: string; user?: string; system?: string }> = [];

vi.mock('../src/llm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/llm.js')>();
  return {
    ...actual,
    callLLM: vi.fn(async (_ctx: unknown, _cfg: unknown, opts: { layer?: string; user?: string; system?: string }) => {
      llmCalls.push({ layer: opts?.layer, user: opts?.user, system: opts?.system });
      return llmReplies.shift() ?? '[]';
    }),
  };
});

const { labelWingOne, tagOne } = await import('../src/wing-backfill.js');

const warned: string[] = [];
const logger = {
  info: () => {},
  warn: (m: string) => warned.push(m),
  error: () => {},
  debug: () => {},
} as unknown as MemoryLogger;

const cfg = {} as MemoryConfig;
const ctx = {} as Context;
const CANDIDATES = 'work / relationships / learning / creative / home / health / finance / journey / general';

/** 构造最小可用记录(标注器只用到 id / content)。 */
function rec(id: string, content = '内容'): MemoryRecord {
  return { id, content } as unknown as MemoryRecord;
}

describe('labelWingOne 解析契约(一个请求只装一条)', () => {
  it('读 `wing` 字段:单对象正常返回被接受', async () => {
    warned.length = 0;
    llmReplies.push(JSON.stringify({ wing: 'work' }));
    expect(await labelWingOne(ctx, cfg, logger, rec('m1'), CANDIDATES)).toBe('work');
    expect(warned).toEqual([]);
  });

  it('模型偶发回单元素数组也能解(容错旧形状)', async () => {
    warned.length = 0;
    llmReplies.push(JSON.stringify([{ id: 'm1', wing: 'health' }]));
    expect(await labelWingOne(ctx, cfg, logger, rec('m1'), CANDIDATES)).toBe('health');
  });

  it('回归:`hall` 字段必须被拒(线上事故的原始形态)', async () => {
    warned.length = 0;
    // 历史 bug:提示词要 wing,解析读 hall。此回复在旧代码下会被「接受」(因为读 hall),
    // 在新代码下 wing 缺失 → 丢弃 —— 这是刻意的:字段名错配不允许被兜底掩盖。
    llmReplies.push(JSON.stringify({ id: 'm1', hall: 'work' }));
    expect(await labelWingOne(ctx, cfg, logger, rec('m1'), CANDIDATES)).toBeNull();
    // 必须报「缺少 wing 字段」而非「非法值」——否则下次再换字段名,日志看不出真实原因
    expect(warned.filter((w) => w.includes('缺少 wing 字段'))).toHaveLength(1);
    expect(warned.some((w) => w.includes('实际键=id|hall'))).toBe(true);
  });

  it('认知 hall 的值(facts/events)被枚举校验拒绝', async () => {
    warned.length = 0;
    llmReplies.push(JSON.stringify({ wing: 'facts' }));
    expect(await labelWingOne(ctx, cfg, logger, rec('m1'), CANDIDATES)).toBeNull();
    expect(warned.filter((w) => w.includes('非法 wing 值'))).toHaveLength(1);
  });

  it('空数组与非法 JSON 结构不抛异常', async () => {
    warned.length = 0;
    llmReplies.push('[]');
    expect(await labelWingOne(ctx, cfg, logger, rec('m1'), CANDIDATES)).toBeNull();
    llmReplies.push('{"not":"a wing"}');
    expect(await labelWingOne(ctx, cfg, logger, rec('m1'), CANDIDATES)).toBeNull();
  });

  it('提示词要求返回 wing 且候选词表原样出现(字段名与解析必须同源)', async () => {
    llmCalls.length = 0;
    llmReplies.push('[]');
    await labelWingOne(ctx, cfg, logger, rec('m1'), CANDIDATES);
    const sys = llmCalls[0]?.system ?? '';
    expect(sys).toContain('"wing"');
    expect(sys).not.toContain('"hall"');
    // 候选词表必须原样出现在 user 提示里(模型只能从其中选)
    expect(llmCalls[0]?.user).toContain(CANDIDATES);
  });
});

describe('tagOne 解析契约(一个请求只装一条)', () => {
  it('归一 + 校验:大写/非法项被清理', async () => {
    warned.length = 0;
    llmReplies.push(JSON.stringify({ tags: [' GraphQL-Switch ', 'graphql-switch', 'Has Space'] }));
    expect(await tagOne(ctx, cfg, logger, rec('m1'))).toEqual(['graphql-switch']);
  });

  it('归一后仍全部非法时不产出该条(返回空数组,不写入空标签)', async () => {
    warned.length = 0;
    // 注意 `UPPER` 会被归一成 `upper` 而合法 —— 归一(转小写)发生在校验之前。
    // 这里刻意用归一后依然非法的输入。
    llmReplies.push(JSON.stringify({ tags: ['-bad', 'Has Space', '', 42, 'under_score'] }));
    expect(await tagOne(ctx, cfg, logger, rec('m1'))).toEqual([]);
  });
});
