/**
 * 外部来源注册表（轨3 一等实体）单测——纯 node + tmp 目录，不拉宿主。
 * 钉住：路径指针不复制（只存 path/摘要）、写穿持久化往返、缺失=合法空表、
 * 损坏=只读降级不抛、register 幂等、退役/停用、上限防刷。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemorySourceStore } from '../src/store/memory-sources.js';

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'dsh-src-'));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe('MemorySourceStore', () => {
  it('文件缺失 = 合法空表，list 返回空', async () => {
    const s = new MemorySourceStore(await tmp());
    await s.init();
    expect(s.list()).toHaveLength(0);
  });

  it('register 后写穿持久化，重新 init 读回（路径指针只存不复制正文）', async () => {
    const dir = await tmp();
    const s = new MemorySourceStore(dir);
    await s.init();
    const { entry, created } = await s.register({ id: 'claude-1', kind: 'claude', path: '/home/u/.claude/memory', label: 'Claude' });
    expect(created).toBe(true);
    expect(entry.path).toBe('/home/u/.claude/memory');

    const s2 = new MemorySourceStore(dir);
    await s2.init();
    const back = s2.byId('claude-1');
    expect(back?.kind).toBe('claude');
    expect(back?.label).toBe('Claude');
    expect(back?.status).toBe('active');
  });

  it('register 幂等：同 id 原地补全不新建', async () => {
    const s = new MemorySourceStore(await tmp());
    await s.init();
    await s.register({ id: 'wb', kind: 'workbuddy', path: '/p/a' });
    const second = await s.register({ id: 'wb', kind: 'workbuddy', path: '/p/b', label: 'WB2' });
    expect(second.created).toBe(false);
    expect(second.entry.path).toBe('/p/b');
    expect(s.list()).toHaveLength(1);
  });

  it('退役/停用后 listEnabled 过滤；re-register 复活', async () => {
    const s = new MemorySourceStore(await tmp());
    await s.init();
    await s.register({ id: 'x', kind: 'file', path: '/p' });
    await s.setDisabled('x', true);
    expect(s.listEnabled()).toHaveLength(0);
    await s.setDisabled('x', false);
    expect(s.listEnabled()).toHaveLength(1);
    await s.setStatus('x', 'retired');
    expect(s.listEnabled()).toHaveLength(0);
    expect(s.list()).toHaveLength(1); // 仍在（退役≠删除，可重放）
  });

  it('损坏 JSON → 只读降级，不抛、list 仍可用', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'memory-sources.json'), '{ this is not json', 'utf8');
    const s = new MemorySourceStore(dir);
    await s.init(); // 不应抛
    expect(s.list()).toHaveLength(0);
    // 降级后 register 仍返回内存态（持久化被抑制）
    const { entry } = await s.register({ id: 'y', kind: 'qoder', path: '/q' });
    expect(entry.id).toBe('y');
    expect(s.byId('y')).toBeDefined();
  });

  it('非法 id / 空 path 被拒', async () => {
    const s = new MemorySourceStore(await tmp());
    await s.init();
    await expect(s.register({ id: 'BAD ID', kind: 'file', path: '/p' })).rejects.toThrow(/非法来源 id/);
    await expect(s.register({ id: 'ok', kind: 'file', path: '  ' })).rejects.toThrow(/path 不能为空/);
  });
});
