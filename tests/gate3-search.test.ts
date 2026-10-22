/**
 * 门3 工具反查验收（expiry-tiering task_4.6）：
 * - 默认路径输出与改前逐字一致（item 键恰为 5 个基础字段，可信 expired 被出口过滤）；
 * - include_expired 放行 expired 并带 state/有效期字段；
 * - as_of 按 valid 区间回放，不复活退场；
 * - follow_supersede 反查"本条取代了谁"。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { registerMemoryTools } from '../src/tools/index.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { L1Store } from '../src/store/l1.js';
import { SceneStore } from '../src/store/scenes.js';
import { PersonaStore } from '../src/store/persona.js';
import { SessionModeStore } from '../src/store/session-modes.js';
import type { LiveSettingsHandle } from '../src/settings.js';
import type { MemoryLiveSettings } from '../src/contract.js';
import type { MemoryConfig } from '../src/config.js';
import type { MemoryLogger, MemoryRecord } from '../src/types.js';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';

const noopLogger: MemoryLogger = { info: () => {}, warn: () => {}, error: () => {} };

const dirs: string[] = [];
const dbs: MemoryDb[] = [];
afterAll(async () => {
  for (const d of dbs) { try { d.close(); } catch { /* 已关 */ } }
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

const NOW = Date.now();
const DAY = 86_400_000;

function rec(id: string, content: string, extra: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id, content, type: 'work_fact', priority: 60, scene_name: 's',
    timestamps: [NOW], createdAt: NOW, updatedAt: NOW, ...extra,
  };
}

async function setupStores(seed: MemoryRecord[]) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-gate3-'));
  dirs.push(dir);
  const db = new MemoryDb(join(dir, 'g3.db'), 0);
  db.init();
  dbs.push(db);
  const l1 = new L1Store(dir, db, undefined, 'keyword', noopLogger, 0);
  await l1.init();
  await l1.appendNew(seed);
  const scenes = { chat: new SceneStore(dir, 'chat'), work: new SceneStore(dir, 'work') };
  const persona = { chat: new PersonaStore(dir, 'chat'), work: new PersonaStore(dir, 'work') };
  return { db, l1, scenes, persona };
}

function harness() {
  const live = {
    enabled: true, capture: true, distill: true, recall: true,
    memoryMutate: false, toolSkills: true,
  } as unknown as MemoryLiveSettings;
  const liveHandle: LiveSettingsHandle = { supported: true, get: () => live, update: async () => {} };
  const modes = new SessionModeStore('/nonexistent', 'auto');
  const registered: Array<{ name: string; execute: (args: Record<string, unknown>, exec?: unknown) => Promise<unknown> }> = [];
  const ctx = {
    tools: { register: (t: ToolDefinition) => { registered.push(t as never); return () => {}; } },
  } as unknown as Parameters<typeof registerMemoryTools>[0];
  const cfg = { tools: true, recall: { maxResults: 5 } } as unknown as MemoryConfig;
  return { ctx, cfg, modes, liveHandle, registered };
}

const search = (h: ReturnType<typeof harness>) => {
  const t = h.registered.find((x) => x.name === 'memory_search');
  if (!t) throw new Error('memory_search 未注册');
  return t;
};

interface OutRow { [k: string]: unknown }
interface Out { items: OutRow[]; notice?: string }

describe('门3 memory_search 反查参数(task_4.6)', () => {
  async function seeded() {
    const stores = await setupStores([
      // 可信过期:五天前开始晨跑(persistence=o)，昨天 valid_to 闭合，证据链 evidence
      rec('x1', '用户每天晨跑五公里', {
        createdAt: NOW - 5 * DAY,
        persistence: 'o',
        validTo: NOW - DAY,
        metadata: { dsh_validity: { state: 'expired', validToSource: 'evidence', basis: 'seed', at: new Date(NOW).toISOString() } },
      }),
      rec('x2', '用户周末爬山', {}),
    ]);
    const h = harness();
    registerMemoryTools(h.ctx, h.cfg, stores, noopLogger, h.modes, h.liveHandle);
    return { stores, h };
  }

  it('默认路径:item 键恰为改前五字段,可信 expired 被出口过滤(与改前"索引天然遮蔽"逐字等价)', async () => {
    const { h } = await seeded();
    const def = (await search(h).execute({ query: '晨跑', limit: 5 }, { agent: { id: 'a' } })) as Out;
    expect(def.items).toHaveLength(0); // expired 默认不给
    const act = (await search(h).execute({ query: '爬山', limit: 5 }, { agent: { id: 'a' } })) as Out;
    expect(act.items).toHaveLength(1);
    expect(Object.keys(act.items[0]!).sort()).toEqual(['content', 'id', 'scene_name', 'score', 'type']);
  });

  it('include_expired=true 放行 expired 并带 state/valid_to/valid_to_source', async () => {
    const { h } = await seeded();
    const r = (await search(h).execute({ query: '晨跑', limit: 5, include_expired: true }, { agent: { id: 'a' } })) as Out;
    expect(r.items.map((x) => x.id)).toEqual(['x1']);
    expect(r.items[0]!.state).toBe('expired');
    expect(typeof r.items[0]!.valid_to).toBe('string');
    expect(r.items[0]!.valid_to_source).toBe('evidence');
  });

  it('as_of 回放:区间内可见、区间外不可见;不复活退场行', async () => {
    const { h, stores } = await seeded();
    const t3 = new Date(NOW - 2 * DAY).toISOString();
    const inWindow = (await search(h).execute({ query: '晨跑', limit: 5, as_of: t3 }, { agent: { id: 'a' } })) as Out;
    expect(inWindow.items.map((x) => x.id)).toEqual(['x1']); // createdAt≤T<validTo
    const after = (await search(h).execute({ query: '晨跑', limit: 5, as_of: new Date(NOW).toISOString() }, { agent: { id: 'a' } })) as Out;
    expect(after.items).toHaveLength(0);
    // 退场不复活:x2 被取代退场后,任意 as_of 都不该把它带回
    stores.l1.retire(['x2'], { at: new Date(NOW).toISOString(), reason: 'superseded', by: 'x1' });
    const replay = (await search(h).execute({ query: '爬山', limit: 5, as_of: new Date(NOW).toISOString() }, { agent: { id: 'a' } })) as Out;
    expect(replay.items).toHaveLength(0);
  });

  it('follow_supersede:命中行反查"它取代了谁"(取代链旧行不在检索面,链由 metadata.by 定位)', async () => {
    const { h, stores } = await seeded();
    // 让 x1 取代 x2:x2 retire marker.by=x1。命中 expired 的 x1 时,反向链应带出被它取代的 x2。
    stores.l1.retire(['x2'], { at: new Date(NOW).toISOString(), reason: 'superseded', by: 'x1' });
    const withFollow = (await search(h).execute(
      { query: '晨跑', limit: 5, include_expired: true, follow_supersede: 2 },
      { agent: { id: 'a' } },
    )) as Out;
    const x1row = withFollow.items.find((x) => x.id === 'x1')!;
    expect((x1row.superseded_by_me as string[]) ?? [], 'by=x1 的退场行应被反查出').toContain('x2');
    // 反向:活跃行 c 取代了旧行 b → 命中 c 时 superseded_by_me 含 b
    // (词用"游泳"这类 jieba 必切双字常用词,不拿"健身习惯"四连串赌切分对齐)
    await stores.l1.appendNew([rec('c1', '用户新的游泳约定')]);
    stores.l1.retire(['x2'], { at: new Date().toISOString(), reason: 'superseded', by: 'c1' });
    // x2 已退场(上一段)不能再改;用新旧对验证:先写 b 再 retire by=c1
    await stores.l1.appendNew([rec('b1', '旧的游泳约定')]);
    stores.l1.retire(['b1'], { at: new Date().toISOString(), reason: 'superseded', by: 'c1' });
    // 探针:先看 store 层命中集,再看工具出口集(定位失败在检索/出口哪一层)
    const raw = await stores.l1.search('游泳约定', 5, {});
    expect(
      raw.map((r) => r.id),
      'raw=' + JSON.stringify(raw.map((r) => r.id))
      + ' fts=' + JSON.stringify(stores.db.searchL1Fts('游泳', 5).map((r) => r.id))
      + ' all=' + JSON.stringify(stores.l1.all().map((r) => r.id)),
    ).toContain('c1');
    const got = (await search(h).execute(
      { query: '游泳约定', limit: 5, follow_supersede: 1 },
      { agent: { id: 'a' } },
    )) as Out;
    const crow = got.items.find((x) => x.id === 'c1');
    expect(got.items.map((x) => x.id), 'items=' + JSON.stringify(got.items)).toContain('c1');
    expect((crow!.superseded_by_me as string[]) ?? []).toContain('b1');
    expect(crow!.state).toBeDefined(); // follow>0 也算显式反查 → 附状态字段
  });
});
