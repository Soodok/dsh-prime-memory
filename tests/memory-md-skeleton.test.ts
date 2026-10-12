/**
 * 类型目录骨架 `_index.md`（pm-name-distill Phase 4 / task_4.1）——真磁盘临时目录。
 *
 * 每条用例钉一个会坏掉的形状：
 *   - 目录集合恰等于词表真源（37 类），不多抄、不少抄；
 *   - 每类目录就一个 `_index.md`，含类名标签 + 条数，条数为 0 也写（否则"没目录"与"0 条"仍分不出）；
 *   - 幂等：第二次调用零写入，且不刷 mtime（刷了会让下一轮对账把"我们没动过"误判成"文件被改过"）；
 *   - 内容变化才原子重写；
 *   - 失败只 warn 不抛（投射是旁路，旁路写挂不能弄挂本体）。
 */
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ensureTypeSkeleton, SKELETON_INDEX_FILE } from '../src/store/memory-md-skeleton.js';
import { MEMORY_TYPE_LABELS, memoryTypeDirs } from '../src/memory-types.js';
import { resolveMemoriesRoot } from '../src/store/memory-md.js';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

async function tmpBase(prefix: string): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(base);
  return base;
}

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };

describe('ensureTypeSkeleton', () => {
  it('目录集合恰等于词表 37 类，每类目录只放一个 _index.md', async () => {
    const base = await tmpBase('dsh-memskeleton-set-');
    const root = resolveMemoriesRoot(undefined, base);
    const vocab = [...memoryTypeDirs()];
    expect(vocab.length).toBe(37);

    await ensureTypeSkeleton({ roots: [root], countsByType: new Map([['work_fact', 3]]), logger: noopLogger });

    const listing = await readdir(root);
    expect(new Set(listing)).toEqual(new Set(vocab));
    for (const d of vocab) {
      expect(await readdir(join(root, d))).toEqual([SKELETON_INDEX_FILE]);
    }
  });

  it('_index.md 含类名标签与条数；缺省类计 0（0 也写）', async () => {
    const base = await tmpBase('dsh-memskeleton-content-');
    const root = resolveMemoriesRoot(undefined, base);
    await ensureTypeSkeleton({ roots: [root], countsByType: new Map([['work_fact', 5]]), logger: noopLogger });

    const counted = await readFile(join(root, 'work_fact', SKELETON_INDEX_FILE), 'utf8');
    expect(counted).toContain(MEMORY_TYPE_LABELS.work_fact);
    expect(counted).toContain('work_fact');
    expect(counted).toContain('5');

    const zero = await readFile(join(root, 'episodic', SKELETON_INDEX_FILE), 'utf8');
    expect(zero).toContain(MEMORY_TYPE_LABELS.episodic);
    expect(zero).toContain('条数: 0');
  });

  it('幂等：两次调用第二次零写入且不刷 mtime（写前记录 statMs 对比）', async () => {
    const base = await tmpBase('dsh-memskeleton-idem-');
    const root = resolveMemoriesRoot(undefined, base);
    const counts = new Map([['work_fact', 2]]);
    await ensureTypeSkeleton({ roots: [root], countsByType: counts, logger: noopLogger });

    const probe = join(root, 'work_fact', SKELETON_INDEX_FILE);
    const mtime1 = (await stat(probe)).mtimeMs;
    // 隔一小段再调第二次：若实现错误地重写，mtime 会明显前移；内容不变应跳过写入、mtime 原地不动。
    await sleep(20);
    await ensureTypeSkeleton({ roots: [root], countsByType: counts, logger: noopLogger });

    const st2 = await stat(probe);
    expect(st2.mtimeMs).toBe(mtime1);
    // 二次调用不该新增任何目录。
    expect((await readdir(root)).length).toBe(37);
  });

  it('内容变化才重写：条数变了 → 反映新条数', async () => {
    const base = await tmpBase('dsh-memskeleton-change-');
    const root = resolveMemoriesRoot(undefined, base);
    await ensureTypeSkeleton({ roots: [root], countsByType: new Map([['work_fact', 2]]), logger: noopLogger });
    const probe = join(root, 'work_fact', SKELETON_INDEX_FILE);
    const before = (await stat(probe)).mtimeMs;

    await sleep(20);
    await ensureTypeSkeleton({ roots: [root], countsByType: new Map([['work_fact', 9]]), logger: noopLogger });

    const text = await readFile(probe, 'utf8');
    expect(text).toContain('条数: 9');
    expect(text).not.toContain('条数: 2');
    expect((await stat(probe)).mtimeMs).toBeGreaterThanOrEqual(before);
  });

  it('多根都补齐（workspace 根按需由调用方传入）', async () => {
    const base = await tmpBase('dsh-memskeleton-multi-');
    const rootA = join(base, 'a', 'memories');
    const rootB = join(base, 'b', '.agents', 'memory');
    await ensureTypeSkeleton({ roots: [rootA, rootB], countsByType: new Map(), logger: noopLogger });
    for (const root of [rootA, rootB]) {
      expect(new Set(await readdir(root))).toEqual(new Set([...memoryTypeDirs()]));
    }
  });

  it('失败只 warn 不抛（投射是旁路，写挂不能弄挂本体）', async () => {
    const base = await tmpBase('dsh-memskeleton-fail-');
    // 造一个"根路径的某一段是普通文件"的形状：mkdir recursive 会失败，骨架应吞掉并留痕。
    const blocker = join(base, 'blocked');
    await writeFile(blocker, '我不是目录', 'utf8');
    const root = join(blocker, 'memories');

    const warns: string[] = [];
    const logger = { info: () => {}, warn: (m: string) => { warns.push(m); }, error: () => {} };
    await expect(ensureTypeSkeleton({ roots: [root], countsByType: new Map(), logger })).resolves.toBeUndefined();
    expect(warns.some((w) => w.includes('类型骨架写入失败'))).toBe(true);
  });
});
