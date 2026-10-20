/**
 * 轨 B（D 系列）活召回集的路归因持久化 —— `session-recalled.json` 的 `lanes` 键。
 *
 * 钉死的性质（沿用 injectedBy/supersededIds 的加入纪律）：
 * ① **不升版本号**：老文件（无 lanes 键）必须正常读取（升版会让老文件整体只读降级）；
 * ② **零漂移序列化**：无归因的会话不写 lanes 键（文件形状与改动前逐字一致）；
 * ③ **宽容解析**：脏值（非对象/值非字符串）整键丢弃，绝不喂给展示层；
 * ④ **最后一次注入赢**：带归因注入覆盖旧值；无归因注入**不清旧值**（徽标宁可残留不闪无）；
 * ⑤ 淘汰联动：条目被上限挤掉时归因随行删除。
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SessionRecalledStore } from '../src/store/session-recalled.js';
import { RECALL_DEDUPE_IDS_CAP } from '../src/store/recall-dedupe.js';
import { SESSION_RECALLED_FILE_VERSION } from '../src/store/file-versions.js';

const dirs: string[] = [];
async function freshDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'dsh-srlanes-'));
  dirs.push(d);
  return d;
}
afterAll(async () => {
  for (const d of dirs) {
    // Windows 上 store 的延迟落盘与删除竞态会报 ENOTEMPTY(全量并行负载下必现):
    // 带退避重试;临时目录清不掉不得让套件变红(tmp 残留可接受,套件结果才是判据)
    try {
      await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* ignore */
    }
  }
});

const file = (d: string) => join(d, 'session-recalled.json');

describe('轨 B session-recalled lanes 持久化', () => {
  it('带归因注入 → lanes 键落盘为管道串;重载读回同一张表', async () => {
    const d = await freshDir();
    const s = new SessionRecalledStore(d);
    s.add('sess-1', ['a', 'b'], 'msg-1', new Map([['a', ['fts', 'graph'] as const]]));
    await s.flush();
    const raw = JSON.parse(await readFile(file(d), 'utf8'));
    expect(raw.sessions['sess-1'].lanes).toEqual({ a: 'fts|graph' });
    // b 无归因 → 不在表里（不是空串占位）
    expect('b' in raw.sessions['sess-1'].lanes).toBe(false);
    const s2 = new SessionRecalledStore(d);
    await s2.flush();
    expect(s2.lanesOf('sess-1').get('a')).toBe('fts|graph');
    expect(s2.lanesOf('sess-1').has('b')).toBe(false);
  });

  it('无归因的会话不写 lanes 键（零漂移:形状与改动前逐字一致）', async () => {
    const d = await freshDir();
    const s = new SessionRecalledStore(d);
    s.add('sess-2', ['a'], 'msg-1');
    await s.flush();
    const raw = JSON.parse(await readFile(file(d), 'utf8'));
    expect('lanes' in raw.sessions['sess-2']).toBe(false);
  });

  it('老文件（无 lanes 键、当前版本号）正常读取:lanesOf 空表、其余字段不丢', async () => {
    const d = await freshDir();
    await mkdir(d, { recursive: true });
    await writeFile(
      file(d),
      JSON.stringify({
        version: SESSION_RECALLED_FILE_VERSION,
        sessions: { 'sess-3': { recordIds: ['a'], injectedBy: { a: 'msg-1' }, updatedAt: Date.now() } },
      }),
      'utf8',
    );
    const s = new SessionRecalledStore(d);
    await s.flush();
    expect(s.list('sess-3')).toEqual(['a']);
    expect(s.lanesOf('sess-3').size).toBe(0);
  });

  it('脏 lanes 值宽容丢弃:非字符串值不进表', async () => {
    const d = await freshDir();
    await writeFile(
      file(d),
      JSON.stringify({
        version: SESSION_RECALLED_FILE_VERSION,
        sessions: { 'sess-4': { recordIds: ['a', 'b'], lanes: { a: 'fts|vec', b: 42 }, updatedAt: Date.now() } },
      }),
      'utf8',
    );
    const s = new SessionRecalledStore(d);
    await s.flush();
    expect(s.lanesOf('sess-4').get('a')).toBe('fts|vec');
    expect(s.lanesOf('sess-4').has('b')).toBe(false);
  });

  it('最后一次带归因注入赢;无归因注入不清旧值', async () => {
    const d = await freshDir();
    const s = new SessionRecalledStore(d);
    s.add('sess-5', ['a'], 'msg-1', new Map([['a', ['fts'] as const]]));
    s.add('sess-5', ['a'], 'msg-2', new Map([['a', ['graph', 'fts'] as const]]));
    expect(s.lanesOf('sess-5').get('a')).toBe('graph|fts');
    s.add('sess-5', ['a'], 'msg-3'); // 不带归因
    expect(s.lanesOf('sess-5').get('a')).toBe('graph|fts'); // 残留不清
  });

  it('上限淘汰联动:条目被挤掉时归因随行删除', async () => {
    const d = await freshDir();
    const s = new SessionRecalledStore(d);
    const ids: string[] = [];
    for (let i = 0; i < RECALL_DEDUPE_IDS_CAP + 1; i++) ids.push('id-' + i);
    s.add('sess-6', [ids[0]], 'msg-0', new Map([[ids[0], ['fts'] as const]]));
    s.add('sess-6', ids.slice(1), 'msg-1'); // 溢出 1 条 → 最旧(id-0)被淘汰
    expect(s.list('sess-6').length).toBe(RECALL_DEDUPE_IDS_CAP);
    expect(s.lanesOf('sess-6').has(ids[0])).toBe(false);
  });
});
