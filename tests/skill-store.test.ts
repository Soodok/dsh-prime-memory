/**
 * 技能结晶存储（轨2）单测——纯 node + tmp，不拉宿主。
 * 钉住轨2 的核心不变量：技能**不是 memory type**、body/steps 分列、晋升只读 distinct-session
 * 且**默认关（allowPromote=false 时永不晋升）**、闲置归档机械、损坏只读降级、上限防刷。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillStore, type SkillEvidence } from '../src/store/skill-store.js';

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'dsh-skill-'));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

function ev(skillId: string, sessionId: string, recordId = 'r'): SkillEvidence {
  return { skillId, runId: 'run1', recordId, sessionId, at: new Date().toISOString(), kind: 'work_method' };
}

describe('SkillStore', () => {
  it('缺失 = 合法空表', async () => {
    const s = new SkillStore(await tmp());
    await s.init();
    expect(s.list()).toHaveLength(0);
  });

  it('create 后持久化往返；body 与 steps 分列各自保留', async () => {
    const dir = await tmp();
    const s = new SkillStore(dir);
    await s.init();
    const created = await s.create({ title: '跑测试', body: '人写的说明', steps: ['装依赖', '跑 vitest'], trigger: { hall: 'work', keywords: ['test'] } });
    expect(created.status).toBe('candidate');
    expect(created.body).toBe('人写的说明');
    expect(created.steps).toEqual(['装依赖', '跑 vitest']);

    const s2 = new SkillStore(dir);
    await s2.init();
    const back = s2.get(created.id);
    expect(back?.body).toBe('人写的说明');
    expect(back?.steps).toEqual(['装依赖', '跑 vitest']);
    expect(back?.trigger.keywords).toEqual(['test']);
  });

  it('sessionCount 按 distinct session 计；重复 session 不增', async () => {
    const s = new SkillStore(await tmp());
    await s.init();
    const sk = await s.create({ title: 'x', body: 'b' });
    await s.appendEvidence(ev(sk.id, 'sess-1'));
    await s.appendEvidence(ev(sk.id, 'sess-1', 'r2'));
    await s.appendEvidence(ev(sk.id, 'sess-2'));
    expect(s.sessionCount(sk.id)).toBe(2);
  });

  it('tryPromote：allowPromote=false（默认）永不晋升；true 且 distinct-session 达阈才 candidate→active', async () => {
    const s = new SkillStore(await tmp());
    await s.init();
    const sk = await s.create({ title: 'x', body: 'b' });
    await s.appendEvidence(ev(sk.id, 'a'));
    await s.appendEvidence(ev(sk.id, 'b'));
    await s.appendEvidence(ev(sk.id, 'c'));
    // 门控关
    expect(await s.tryPromote(sk.id, 3, { allowPromote: false })).toBe(false);
    expect(s.get(sk.id)?.status).toBe('candidate');
    // 门控开 + 3 session 达阈
    expect(await s.tryPromote(sk.id, 3, { allowPromote: true })).toBe(true);
    expect(s.get(sk.id)?.status).toBe('active');
  });

  it('tryPromote：distinct-session 未达阈不晋升', async () => {
    const s = new SkillStore(await tmp());
    await s.init();
    const sk = await s.create({ title: 'x', body: 'b' });
    await s.appendEvidence(ev(sk.id, 'only-one'));
    expect(await s.tryPromote(sk.id, 3, { allowPromote: true })).toBe(false);
    expect(s.get(sk.id)?.status).toBe('candidate');
  });

  it('archiveDue：pinned 不归档；active 超闲置归档；idleDays=0 不动', async () => {
    const s = new SkillStore(await tmp());
    await s.init();
    const old = await s.create({ title: 'old', body: 'b', status: 'active' });
    const pinned = await s.create({ title: 'pin', body: 'b', status: 'active' });
    await s.update(pinned.id, { pinned: true });
    // 把 old 的 updatedAt 推到很久以前
    const now = Date.now();
    // create 写入的是当前时间，用 touchUsed 造一个远古 lastUsedAt
    await s.touchUsed(old.id, new Date(now - 200 * 86_400_000).toISOString());
    expect(await s.archiveDue(now, 90)).toBe(1);
    expect(s.get(old.id)?.status).toBe('archived');
    expect(s.get(pinned.id)?.status).toBe('active'); // pinned 保留
    expect(await s.archiveDue(now, 0)).toBe(0); // idleDays=0 关
  });

  it('损坏 JSON → 只读降级，不抛；create 仍返回内存态', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'skills.json'), '{ broken', 'utf8');
    const s = new SkillStore(dir);
    await s.init();
    expect(s.list()).toHaveLength(0);
    const sk = await s.create({ title: 'mem', body: 'b' });
    expect(s.get(sk.id)).toBeDefined();
  });

  it('重复 id 被拒', async () => {
    const s = new SkillStore(await tmp());
    await s.init();
    await s.create({ id: 'dup', title: 'x', body: 'b' });
    await expect(s.create({ id: 'dup', title: 'y', body: 'b' })).rejects.toThrow(/已存在/);
  });
});
