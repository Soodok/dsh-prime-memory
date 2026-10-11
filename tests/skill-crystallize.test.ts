/**
 * 轨2 检测/注入的纯逻辑单测（不拉宿主）：
 * - crystallize.detectCandidates：跨会话够阈才成候选，且按 groupKey 确定性排序；
 * - renderSkill：full/excerpt/hint 三档现场组词；
 * - registerSkillRecall.buildInjection：enabled=false 恒 null（零表面积）；开时按字节预算装填。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectCandidates } from '../src/skills/crystallize.js';
import { registerSkillRecall, renderSkill } from '../src/hooks/skill-recall.js';
import { SkillStore, type Skill } from '../src/store/skill-store.js';
import type { MemoryConfig } from '../src/config.js';
import type { Context } from '@deepseek-ai/cordis';

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'dsh-sk2-'));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe('crystallize.detectCandidates', () => {
  it('跨 ≥minSessions 会话、够 minEvidence 条 → 成候选；不足 → 无', () => {
    const recs = [
      { id: 'r1', content: '先跑 lint 再 test', sessionId: 's1', hall: 'work' },
      { id: 'r2', content: '提交前 rebase 主干', sessionId: 's2', hall: 'work' },
    ];
    const c = detectCandidates(recs, { minSessions: 2, minEvidence: 2 });
    expect(c).toHaveLength(1);
    expect(c[0]?.hall).toBe('work');
    expect(c[0]?.sessions.sort()).toEqual(['s1', 's2']);
    expect(c[0]?.id.startsWith('skx-')).toBe(true);

    // 只 1 个会话 → 不够
    const single = detectCandidates([recs[0]!, recs[0]!], { minSessions: 2, minEvidence: 2 });
    expect(single).toHaveLength(0);
  });

  it('同会话重复内容去重后不计入 evidence 条数', () => {
    const recs = [
      { id: 'a', content: 'X', sessionId: 's1', hall: 'work' },
      { id: 'b', content: 'X ', sessionId: 's1', hall: 'work' }, // 规范化后同内容
    ];
    expect(detectCandidates(recs, { minSessions: 1, minEvidence: 2 })).toHaveLength(0);
  });
});

describe('renderSkill 三档', () => {
  const base: Skill = {
    id: 'sk1', title: '跑测试', body: '装依赖然后 vitest', steps: ['装依赖', 'vitest'],
    trigger: { keywords: [] }, injectionTier: 'full', status: 'active', pinned: false, confidence: 0,
    family: 'work', scope: 'global', evidenceRecordIds: [], createdAt: '', updatedAt: '', lastUsedAt: '',
  };
  it('full 带步骤；hint 只给读取指引；excerpt 截断正文', () => {
    expect(renderSkill({ ...base, injectionTier: 'full' }, 240)).toContain('- vitest');
    expect(renderSkill({ ...base, injectionTier: 'hint' }, 240)).toContain('memory_skill_read(sk1)');
    expect(renderSkill({ ...base, injectionTier: 'excerpt', body: 'x'.repeat(500) }, 10)).toContain('…');
  });
});

describe('registerSkillRecall.buildInjection 门控与预算', () => {
  const ctxStub = { on: () => {} } as unknown as Context;
  const logger = { warn: () => {}, info: () => {}, error: () => {} } as never;
  const mkCfg = (skills: Partial<MemoryConfig['skills']>): MemoryConfig =>
    ({ skills: { enabled: false, inject: true, allowPromote: false, minSessions: 3, minEvidence: 5, maxPerTurnBytes: 600, maxSkillCatalogBytes: 2048, excerptChars: 240, idleArchiveDays: 90, ...skills } }) as unknown as MemoryConfig;

  it('enabled=false → buildInjection 恒 null（零表面积）', async () => {
    const store = new SkillStore(await tmp());
    await store.init();
    await store.create({ title: 't', body: 'b', status: 'active' });
    const ctrl = registerSkillRecall(ctxStub, mkCfg({ enabled: false }), store, logger);
    expect(ctrl.buildInjection()).toBeNull();
  });

  it('enabled+inject 开 → 注入 active 技能；candidate/archived 不注入；帧体转义', async () => {
    const dir = await tmp();
    const store = new SkillStore(dir);
    await store.init();
    await store.create({ title: 'Alpha', body: 'aaa', status: 'active' });
    await store.create({ title: 'Beta', body: 'bbb', status: 'candidate' });
    const ctrl = registerSkillRecall(ctxStub, mkCfg({ enabled: true }), store, logger);
    const text = ctrl.buildInjection();
    expect(text).toContain('<system-reminder>');
    expect(text).toContain('Alpha');
    expect(text).not.toContain('Beta');
  });

  it('字节预算装填：超预算的技能被省略并给出计数', async () => {
    const store = new SkillStore(await tmp());
    await store.init();
    for (let i = 0; i < 30; i++) await store.create({ title: 'long-title-' + i, body: 'x'.repeat(80), status: 'active', injectionTier: 'full' });
    const ctrl = registerSkillRecall(ctxStub, mkCfg({ enabled: true, maxPerTurnBytes: 200 }), store, logger);
    const text = ctrl.buildInjection();
    expect(text).toContain('因预算未显示');
  });
});
