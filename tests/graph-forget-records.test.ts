/**
 * `forgetRecords`（task_4.4 / F19）：记录被物理删除后，图投影的两张索引表必须跟着忘。
 *
 * 这条路径在此之前**全仓只增不减**。危害不是脏行本身，而是那两个静默后果：
 * - 从快照恢复回来的记录因为投影行还在而被当成"已投影"，**永不重投影**（检索图缺一条，不报错）；
 * - 去重查询按 `graph_job_records` / `graph_projected_records` 点查，挂着死 id 就是永久占位。
 *
 * 只断索引行，图节点/边不动——那是图自己的生命周期。
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphStore } from '../src/store/graph-store.js';

const dbs: DatabaseSync[] = [];

afterEach(() => {
  // 内存库逐个关掉：不关就会拖住进程，vitest 收工报悬空 handle
  for (const db of dbs.splice(0)) db.close();
});

/** 建一个只装图自己那套表的库（`init` 会建表，DDL 不在测试里重抄一遍）。 */
function makeGraph(): { g: GraphStore; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  dbs.push(raw);
  const g = new GraphStore();
  g.init(raw, undefined, undefined);
  return { g, raw };
}

function projectRow(raw: DatabaseSync, id: string, version: number): void {
  raw.prepare('INSERT OR REPLACE INTO graph_projected_records (record_id, projector_version) VALUES (?, ?)').run(id, version);
}

describe('GraphStore.forgetRecords', () => {
  it('两张索引表里指向该 id 的行一起消失，别的 id 一行不动', () => {
    const { g, raw } = makeGraph();
    projectRow(raw, 'dead', 1);
    projectRow(raw, 'alive', 1);
    raw.prepare('INSERT OR REPLACE INTO graph_job_records (record_id, job_id) VALUES (?, ?)').run('dead', 'j1');
    raw.prepare('INSERT OR REPLACE INTO graph_job_records (record_id, job_id) VALUES (?, ?)').run('alive', 'j2');

    const removed = g.forgetRecords(['dead']);

    expect(removed).toBe(1);
    const leftProjected = raw.prepare('SELECT record_id FROM graph_projected_records').all() as Array<{ record_id: string }>;
    const leftJob = raw.prepare('SELECT record_id FROM graph_job_records').all() as Array<{ record_id: string }>;
    expect(leftProjected.map((r) => r.record_id)).toEqual(['alive']);
    expect(leftJob.map((r) => r.record_id)).toEqual(['alive']);
  });

  it('删过的记录可以重新投影（这正是 F19 的实际危害）', () => {
    const { g, raw } = makeGraph();
    projectRow(raw, 'r1', 1);
    g.forgetRecords(['r1']);
    // 索引行没了 → 去重查询不再把它当"已完成投影"，重投影才可能发起
    const still = raw.prepare('SELECT record_id FROM graph_projected_records WHERE record_id = ?').all('r1') as unknown[];
    expect(still).toHaveLength(0);
  });

  it('空数组与未初始化都返回 0，绝不抛', () => {
    const { g } = makeGraph();
    expect(g.forgetRecords([])).toBe(0);
    const cold = new GraphStore();
    expect(cold.forgetRecords(['r1'])).toBe(0);
  });

  it('超过一批的 id 全部清掉（分批 IN，不能只删前 500 条就宣称清了）', () => {
    const { g, raw } = makeGraph();
    const ids: string[] = [];
    for (let i = 0; i < 1_200; i += 1) {
      const id = `r${i}`;
      ids.push(id);
      projectRow(raw, id, 1);
    }
    expect(g.forgetRecords(ids)).toBe(1_200);
    const left = raw.prepare('SELECT COUNT(*) AS n FROM graph_projected_records').get() as { n: number };
    expect(Number(left.n)).toBe(0);
  });
});
