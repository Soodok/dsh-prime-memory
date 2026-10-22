/**
 * L1 游标分批与最小写回测试。
 *
 * 钉的核心不变量:**`patchL1Metadata` 绝不触碰 content**。
 *
 * 背景:把后台巡检从「全量 `all()`」改为「游标 `allLite()`」后,调用方手里**没有 content**;
 * 若沿用 `upsert({...lite, metadata})` 就会把正文写成空 —— 这是分页改造最危险的坑,
 * 且症状是"数据静默丢失",必须在测试里钉死。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MemoryDb } from '../src/store/sqlite.js';
import { L1Store } from '../src/store/l1.js';
import { NoopEmbeddingService } from '../src/store/embedding.js';

const dbs: MemoryDb[] = [];
let dir: string;

async function mkL1(): Promise<L1Store> {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'dsh-l1-page-'));
  const db = new MemoryDb(join(dir, `m-${Math.random().toString(36).slice(2)}.db`), 0);
  db.init();
  dbs.push(db); // afterAll 显式关句柄:Windows 上不关会导致 tmp 清理 EBUSY
  return new L1Store(dir, db, new NoopEmbeddingService());
}

afterAll(async () => {
  for (const db of dbs) db.close();
  if (!dir) return;
  for (let i = 0; i < 3; i++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
});

const now = Date.now();
const base = { priority: 60, scene_name: 's', timestamps: [now], createdAt: now, updatedAt: now };

describe('getAllL1Lite 游标分批', () => {
  it('分页覆盖全部记录且不重不漏(按 record_id 稳定排序)', async () => {
    const l1 = await mkL1();
    const ids = Array.from({ length: 25 }, (_, i) => `r${String(i).padStart(3, '0')}`);
    await l1.appendNew(ids.map((id) => ({ id, content: `正文-${id}`, type: 'work_fact', ...base, metadata: {} })));

    const seen: string[] = [];
    for (let offset = 0; ; offset += 10) {
      const page = l1.allLite(10, offset);
      if (page.length === 0) break;
      seen.push(...page.map((r) => r.id));
    }
    expect(seen).toEqual([...ids].sort()); // 无重复、无遗漏、顺序稳定
    expect(new Set(seen).size).toBe(25);
  });

  it('只返回 id/type/metadata 三列(不带 content)', async () => {
    const l1 = await mkL1();
    await l1.appendNew([{ id: 'x1', content: '正文', type: 'work_method', ...base, metadata: { hall: 'work' } }]);
    const [row] = l1.allLite(10, 0);
    expect(Object.keys(row).sort()).toEqual(['id', 'metadata', 'type']);
    expect(row.type).toBe('work_method');
    // 写侧标注汇流口(task_3.2)会在落库前盖 dsh_validity 快照——它就在 metadata 里。
    expect(row.metadata).toMatchObject({ hall: 'work' });
    expect((row.metadata as Record<string, unknown>).dsh_validity).toBeDefined();
  });

  it('limit<=0 或 offset 越界返回空数组(不报错)', async () => {
    const l1 = await mkL1();
    await l1.appendNew([{ id: 'y1', content: 'c', type: 'work_fact', ...base, metadata: {} }]);
    expect(l1.allLite(0, 0)).toEqual([]);
    expect(l1.allLite(-1, 0)).toEqual([]);
    expect(l1.allLite(10, 999)).toEqual([]);
  });

  it('坏 metadata_json 退化为空对象(不抛)', async () => {
    const l1 = await mkL1();
    await l1.appendNew([{ id: 'z1', content: 'c', type: 'work_fact', ...base, metadata: {} }]);
    const db = dbs[dbs.length - 1];
    db['db'].prepare("UPDATE l1_records SET metadata_json = '{坏' WHERE record_id = 'z1'").run();
    expect(l1.allLite(10, 0)[0]?.metadata).toEqual({});
  });
});

describe('patchL1Metadata 最小写回', () => {
  it('**不碰 content**:patch 前后正文逐字节一致(分页改造的红线)', async () => {
    const l1 = await mkL1();
    const content = '这段正文必须完好无损 —— 包含中文、换行与符号\n第二行 {json:1}';
    await l1.appendNew([{ id: 'p1', content, type: 'work_fact', ...base, metadata: { hall: 'work' } }]);

    const before = l1.getByIds(['p1'])[0];
    expect(before?.content).toBe(content);
    const versionBefore = before?.version;

    expect(l1.patchMetadata('p1', { hall: 'health', cogHall: 'facts' })).toBe(true);

    const after = l1.getByIds(['p1'])[0];
    expect(after?.content).toBe(content); // ← 红线:正文未被清空
    expect(after?.metadata).toEqual({ hall: 'health', cogHall: 'facts' });
    expect(after?.type).toBe('work_fact'); // 其它列也不动
    expect(after?.version).toBe(versionBefore); // metadata 补写不递增版本
  });

  it('只替换 metadata 整体,不合并旧键(调用方负责基线)', async () => {
    const l1 = await mkL1();
    await l1.appendNew([{ id: 'p2', content: 'c', type: 'work_fact', ...base, metadata: { keep: 1, drop: 2 } }]);
    l1.patchMetadata('p2', { hall: 'work' });
    expect(l1.getByIds(['p2'])[0]?.metadata).toEqual({ hall: 'work' });
  });

  it('id 不存在返回 false(调用方据此记账,不静默)', async () => {
    const l1 = await mkL1();
    expect(l1.patchMetadata('nope', { hall: 'work' })).toBe(false);
  });

  it('连写多键不污染正文,且可重复调用(幂等结果)', async () => {
    const l1 = await mkL1();
    await l1.appendNew([{ id: 'p3', content: '正文三', type: 'episodic', ...base, metadata: {} }]);
    l1.patchMetadata('p3', { cogHall: 'events' });
    l1.patchMetadata('p3', { cogHall: 'events', hall: 'creative' });
    expect(l1.getByIds(['p3'])[0]?.metadata).toEqual({ cogHall: 'events', hall: 'creative' });
    expect(l1.getByIds(['p3'])[0]?.content).toBe('正文三');
  });
});

describe('L1Store 薄缝', () => {
  it('size 与 allLite 总量一致(进度分母可信)', async () => {
    const l1 = await mkL1();
    await l1.appendNew(
      Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, content: 'c', type: 'work_fact' as const, ...base, metadata: {} })),
    );
    expect(l1.size).toBe(7);
    expect(l1.allLite(100, 0)).toHaveLength(7);
  });
});
