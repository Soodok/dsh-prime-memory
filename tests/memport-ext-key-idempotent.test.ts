/**
 * ext_key 外部导入幂等（轨3-P0）存储层守卫。
 *
 * 钉住的是"重复导入结构性不可能"这条数据正确性不变量——它是本次 P0 里唯一
 * **越晚做越要清洗历史脏数据**的项，故优先级高于任何 UI。断言四条：
 *   1. 带 ext_key 的记录能按 ext_key 精确查回（memory_import 的 pre-check 依赖它）；
 *   2. 空 ext_key（内部蒸馏 / memory_add 记录）多条互不冲突——部分唯一索引只约束非空值；
 *   3. 同一 ext_key、不同 record_id 的第二条被唯一索引拒绝（upsertL1 返回 false，首条仍可查回，
 *      第二条不落库）——这是"重复导入必然产生重复记录"这一旧缺陷的反面；
 *   4. 同一 record_id 覆盖更新（ON CONFLICT record_id）不因 ext_key 相同而误报冲突。
 *
 * 与 tools 层的 deduped 计数互补：这里是**索引级**兜底，即便调用方漏做 pre-check 也不会写脏。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryDb } from '../src/store/sqlite.js';
import type { MemoryRecord } from '../src/types.js';

const dbs: MemoryDb[] = [];
const dirs: string[] = [];

async function freshDb(): Promise<MemoryDb> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-extkey-'));
  dirs.push(dir);
  const db = new MemoryDb(join(dir, 'memory.db'), 0);
  db.init();
  dbs.push(db);
  return db;
}

function rec(id: string, content: string, extKey?: string): MemoryRecord {
  const t = Date.now();
  return {
    id,
    content,
    type: 'work_method',
    priority: 80,
    scene_name: '__manual__',
    timestamps: [t],
    createdAt: t,
    updatedAt: t,
    metadata: {},
    family: 'work',
    extKey,
  };
}

afterEach(async () => {
  // Windows 上 sqlite WAL 句柄未关会 EBUSY，先 close 再删目录（同本仓 rebuild-preserve 约定）。
  for (const db of dbs.splice(0)) {
    try {
      db.close();
    } catch {
      /* 已关/降级则忽略 */
    }
  }
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe('ext_key 幂等（轨3-P0 存储层）', () => {
  it('带 ext_key 的记录可按 ext_key 精确查回', async () => {
    const db = await freshDb();
    expect(db.upsertL1(rec('r1', 'a durable fact', 'K1'))).toBe(true);
    expect(db.findRecordIdByExtKey('K1')).toBe('r1');
  });

  it('空 ext_key 多条互不冲突（部分索引只约束非空值）', async () => {
    const db = await freshDb();
    expect(db.upsertL1(rec('a', 'one'))).toBe(true);
    expect(db.upsertL1(rec('b', 'two'))).toBe(true);
    // 空键不做查询目标：pre-check 传空串一律 undefined
    expect(db.findRecordIdByExtKey('')).toBeUndefined();
  });

  it('同 ext_key 不同 record_id 的第二条被唯一索引拒绝，首条仍可查回', async () => {
    const db = await freshDb();
    expect(db.upsertL1(rec('r1', 'x', 'DUP'))).toBe(true);
    expect(db.upsertL1(rec('r2', 'x', 'DUP'))).toBe(false);
    expect(db.findRecordIdByExtKey('DUP')).toBe('r1');
    expect(db.getL1ByIds(['r2'])).toHaveLength(0); // 第二条未落库
    expect(db.getL1ByIds(['r1'])).toHaveLength(1);
  });

  it('同 record_id 覆盖更新（ON CONFLICT record_id）不因 ext_key 相同而误报', async () => {
    const db = await freshDb();
    expect(db.upsertL1(rec('r1', 'v1', 'E1'))).toBe(true);
    expect(db.upsertL1(rec('r1', 'v2', 'E1'))).toBe(true); // 同 id 同 ext_key → 走 DO UPDATE
    expect(db.findRecordIdByExtKey('E1')).toBe('r1');
    expect(db.getL1ByIds(['r1'])[0]?.content).toBe('v2');
  });
});
