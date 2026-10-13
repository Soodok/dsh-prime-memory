/**
 * 名称蒸馏（Phase 3）的提示词面：零漂移、示例自检、反例真是反例。
 *
 * 三条判据各自对应一个会静默坏掉的形状：
 *   - **off 必须逐字不变**：`title`/`fewShot` 用追加条款实现就是为了这条。一旦有人改成
 *     "直接往 schema 常量里塞字段"，旧产物就悄悄变了形状，而五条 sha1 金标准会一起红。
 *   - **止例本身必须过闸**：示范一个会被自己闸门拒掉的名字，比不示范更糟。
 *   - **止例的 content 必须与 G2 骨架同源**：两个开关同时开时，模型会在一份提示里
 *     看到两套互相矛盾的示范（示例说这样写，条款说那样写）。
 */
import { describe, expect, it } from 'vitest';
import {
  EXTRACT_ALL_MEMORIES_SYSTEM_PROMPT,
  EXTRACT_MEMORIES_SYSTEM_PROMPT,
  EXTRACT_WORK_MEMORIES_SYSTEM_PROMPT,
  getExtractMemoriesSystemPrompt,
} from '../src/prompts/l1-extraction.js';
import {
  ALL_CONFLICT_DETECTION_SYSTEM_PROMPT,
  getConflictDetectionSystemPrompt,
} from '../src/prompts/l1-dedup.js';
import {
  EXTRACTION_FEW_SHOT,
  FEW_SHOT_BUDGET,
  TITLE_BAD_EXAMPLES,
  TITLE_GOOD_EXAMPLES,
  auditFewShot,
} from '../src/prompts/examples.js';
import { validateTitle } from '../src/util/md-name.js';

describe('naming 开关的零漂移（off 逐字不变）', () => {
  it('抽取三档在开关关着时逐字等于常量，开着才追加', () => {
    for (const mode of ['auto', 'chat', 'work'] as const) {
      const off = getExtractMemoriesSystemPrompt(mode, {});
      const base =
        mode === 'auto' ? EXTRACT_ALL_MEMORIES_SYSTEM_PROMPT
          : mode === 'work' ? EXTRACT_WORK_MEMORIES_SYSTEM_PROMPT
            : EXTRACT_MEMORIES_SYSTEM_PROMPT;
      expect(off).toBe(base);
      // 显式 false 也不许偷加东西（设置面可能传 false 而不是省略）。
      expect(getExtractMemoriesSystemPrompt(mode, { title: false, fewShot: false })).toBe(base);
      const on = getExtractMemoriesSystemPrompt(mode, { title: true });
      expect(on.startsWith(base)).toBe(true);
      expect(on).toContain('"title"');
      expect(on.length).toBeGreaterThan(base.length);
    }
  });

  it('fewShot 是独立成本：只开 title 时不许把示例段塞进去', () => {
    const only = getExtractMemoriesSystemPrompt('auto', { title: true });
    expect(only).not.toContain(EXTRACTION_FEW_SHOT);
    expect(only).not.toContain('【标准格式示例】');
    const both = getExtractMemoriesSystemPrompt('auto', { title: true, fewShot: true });
    expect(both).toContain(EXTRACTION_FEW_SHOT);
  });

  it('去重侧同理：conflictFreeze 单开时的产物与改动前逐字一致', () => {
    expect(getConflictDetectionSystemPrompt('auto', {})).toBe(ALL_CONFLICT_DETECTION_SYSTEM_PROMPT);
    const t = getConflictDetectionSystemPrompt('auto', { title: true });
    expect(t.startsWith(ALL_CONFLICT_DETECTION_SYSTEM_PROMPT)).toBe(true);
    expect(t).toContain('merged_title');
  });
});

describe('few-shot 示例集自检（判据来自示例模块本身，不在这里手抄）', () => {
  it('每个止例的 title 都过 validateTitle', () => {
    const audit = auditFewShot();
    expect(audit.不合格title).toEqual([]);
  });

  it('总长不超预算（示例每轮都付，超了该减条数而不是放宽）', () => {
    const audit = auditFewShot();
    // 两条分开断言：先报**实际长度**再报布尔，否则失败时只能看到"true!==false"去手算。
    expect(audit.长度).toBeLessThanOrEqual(FEW_SHOT_BUDGET);
    expect(audit.超预算).toBe(false);
  });

  it('止例没有照抄 content 开头，也没顶到 NAME_MAX（那正是旧坏味的形状）', () => {
    expect(auditFewShot().抄content开头).toEqual([]);
  });

  it('三条反例逐个被闸门拒（"不要这样"里的例子若其实合格，示范就是反的）', () => {
    for (const bad of TITLE_BAD_EXAMPLES) {
      expect(validateTitle(bad.title).ok, bad.title).toBe(false);
    }
  });

  it('止例覆盖的类型都在 G2 骨架里（两个开关同时开时不能有两套示范）', () => {
    const narrative = getExtractMemoriesSystemPrompt('auto', { narrative: true });
    for (const g of TITLE_GOOD_EXAMPLES) {
      expect(narrative.includes(`- ${g.type}：`), `骨架里缺 ${g.type}`).toBe(true);
      // title 与 content 必须并列可见——渲染块里两者都要出现。
      expect(EXTRACTION_FEW_SHOT).toContain(g.title);
      expect(EXTRACTION_FEW_SHOT).toContain(g.content.slice(0, 12));
    }
  });
});
