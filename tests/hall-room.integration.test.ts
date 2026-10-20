/**
 * Hall·Room 集成测试(HTTP 面全链路 × 真实存储)。
 *
 * 与单测的分野:rooms-registry/room-merge/room-admin-endpoint 各管一段,
 * 这里走**用户旅程整链**——经 registerMemoryRpc 的 HTTP 分发(registerMemoryRpc
 * → rpcHandler → handleEndpoint,即 beta.9 修过的那道接缝)+ 真实 sqlite L1 +
 * 真实 rooms-registry.json sidecar:
 *   空表自生长计数 → 两级注册 / 非法 slug 拒绝 → 收编(source=grown)→ 导出三
 *   kind(rooms/orphans/records)→ merge dryRun 零写入 → 实跑(备份落盘 + 退场行
 *   重写 + metadata 保全 + 场景重算入队 source='room-merge')→ rename(aliases)
 *   → retire/恢复 → 大类 200 上限 / 小类不占额 → 损坏只读降级红线(rooms-get 不阻塞)。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerMemoryRpc } from '../src/stats.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { L0Store } from '../src/store/l0.js';
import { L1Store } from '../src/store/l1.js';
import { SceneStore } from '../src/store/scenes.js';
import { PersonaStore } from '../src/store/persona.js';
import { StateStore } from '../src/store/state.js';
import { SessionModeStore } from '../src/store/session-modes.js';
import { RoomRegistryStore } from '../src/store/rooms-registry.js';
import type { MemoryLiveSettings } from '../src/contract.js';
import type { MemoryConfig } from '../src/config.js';
import type { LiveSettingsHandle } from '../src/settings.js';
import type { MemoryLogger, MemoryRecord } from '../src/types.js';

let dir: string;
const dbs: MemoryDb[] = [];
afterAll(async () => {
  for (const db of dbs) db.close();
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

const noopLogger: MemoryLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function liveHandle(memoryMutate: boolean): LiveSettingsHandle {
  const s = { enabled: true, capture: true, distill: true, recall: true, memoryMutate } as MemoryLiveSettings;
  return { supported: true, get: () => s, update: async (patch: Partial<MemoryLiveSettings>) => { Object.assign(s, patch); } };
}

interface Env {
  call: (endpoint: string, payload?: unknown) => Promise<unknown>;
  l1: L1Store;
  registry: RoomRegistryStore;
  db: MemoryDb;
  dataDir: string;
}

/** HTTP 面全链夹具:webServer 捕获 + loopback req/res,与 rpc.test.ts 同口径。 */
async function mkEnv(opts: { corruptRegistry?: boolean } = {}): Promise<Env> {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'dsh-hallroom-'));
  const dataDir = join(dir, `hr-${Math.random().toString(36).slice(2)}`);
  await mkdir(dataDir, { recursive: true });
  if (opts.corruptRegistry) {
    await writeFile(join(dataDir, 'rooms-registry.json'), '{corrupt!!!', 'utf8');
  }
  const db = new MemoryDb(join(dataDir, 'memory.db'), 0);
  db.init();
  dbs.push(db);
  const l1 = new L1Store(dataDir, db, undefined, 'hybrid', noopLogger, 0);
  const l0 = new L0Store(db);
  await l1.init();
  const scenes = { chat: new SceneStore(dataDir, 'chat'), work: new SceneStore(dataDir, 'work') };
  await scenes.chat.init();
  await scenes.work.init();
  const persona = { chat: new PersonaStore(dataDir, 'chat'), work: new PersonaStore(dataDir, 'work') };
  await persona.chat.init();
  await persona.work.init();
  const state = new StateStore(join(dataDir, 'state.json'));
  await state.load();
  const modes = new SessionModeStore(dataDir, 'auto');
  await modes.init();
  const registry = new RoomRegistryStore(dataDir, noopLogger);
  await registry.init();

  let handler: ((req: unknown, res: unknown) => Promise<void>) | undefined;
  const ctx = {
    get: (name: string) => {
      if (name === 'webServer') {
        return {
          register: (route: { handler: (req: unknown, res: unknown) => Promise<void> }) => {
            handler = route.handler;
            return () => {};
          },
        };
      }
      return undefined;
    },
    on: () => () => {},
    effect: (fn: () => (() => void) | void) => {
      const d = fn();
      return typeof d === 'function' ? d : () => {};
    },
    llm: {} as never,
  } as unknown as Parameters<typeof registerMemoryRpc>[0];

  registerMemoryRpc(
    ctx, { dataDir } as MemoryConfig,
    { l0, l1, scenes, persona, state, graph: db.graphStore },
    noopLogger, undefined, liveHandle(true), modes, dataDir,
    undefined, undefined, undefined, undefined, registry,
  );
  return {
    registry,
    l1,
    db,
    dataDir,
    call: async (endpoint, payload) => {
      const req = new PassThrough() as PassThrough & { headers: Record<string, string>; method: string; url: string };
      req.headers = { host: 'localhost' };
      req.method = 'POST';
      req.url = `/dsh-memory/rpc/${endpoint.slice('dsh-memory/'.length)}`;
      req.end(JSON.stringify(payload ?? {}));
      const captured = { statusCode: 0, body: '' };
      const res = {
        writeHead(status: number) { captured.statusCode = status; },
        end(body?: string) { captured.body = body ?? ''; },
      };
      await handler!(req as unknown, res as unknown);
      const parsed = JSON.parse(captured.body) as { ok: boolean; value?: unknown; error?: { message: string } };
      if (captured.statusCode !== 200 || !parsed.ok) throw new Error(parsed.error?.message ?? `HTTP ${captured.statusCode}`);
      return parsed.value;
    },
  };
}

const now = Date.now();
async function seed(l1: L1Store, id: string, tags: string[], over: Partial<MemoryRecord> = {}): Promise<void> {
  l1.upsert({
    id,
    content: `内容 ${id}`,
    type: 'work_fact',
    priority: 60,
    scene_name: `scene-${id.slice(-1)}`,
    timestamps: [now],
    createdAt: now,
    updatedAt: now,
    version: 0,
    metadata: { tags: [...tags] },
    family: 'work',
    scope: 'global',
    workspaceId: '',
    ...over,
  });
}

/** CSV 文本按行拆(去表头),RFC4180 不含逗号的简单行可直接 split。 */
function csvRows(csv: string): string[][] {
  return csv.split('\r\n').slice(1).filter((l) => l.length > 0).map((l) => l.split(','));
}

let env: Env;

beforeAll(async () => {
  env = await mkEnv();
  // 自生长底料:3 条 alpha(其中 1 条带保全观测键)、1 条 beta、1 条退场 alpha、2 条孤儿
  await seed(env.l1, 'a1', ['alpha'], { metadata: { tags: ['alpha'], roomCandidates: ['x'], roomReview: 'pending', hall: 'work', cogHall: 'work' } });
  await seed(env.l1, 'a2', ['alpha']);
  await seed(env.l1, 'a3', ['alpha']);
  await seed(env.l1, 'b1', ['beta']);
  await seed(env.l1, 'r1', ['alpha'], { validTo: now + 1000 });
  await seed(env.l1, 'o1', []);
  await seed(env.l1, 'o2', []);
});

describe('Hall·Room 集成(HTTP 面全链 × 真实存储)', () => {
  it('① 空表起步:rooms-get 只见自生长计数与孤儿数,registry 为空数组', async () => {
    const g = (await env.call('dsh-memory/rooms-get', {})) as { rooms: Array<{ room: string; count: number; source?: string }>; orphanCount: number; registry: unknown[] };
    const alpha = g.rooms.find((r) => r.room === 'alpha');
    expect(alpha?.count).toBe(4); // 含退场行(口径一致)
    expect(g.rooms.find((r) => r.room === 'beta')?.count).toBe(1);
    expect(g.orphanCount).toBe(2);
    expect(g.registry).toEqual([]);
  });

  it('② 两级注册 + 非法 slug 拒绝', async () => {
    const hall = (await env.call('dsh-memory/room-register', { slug: 'dsh-plugin', label: 'dsh插件', description: 'dsh 插件相关项目' })) as { created: boolean };
    expect(hall.created).toBe(true);
    const minor = (await env.call('dsh-memory/room-register', { slug: 'dsh-plugin/merge' })) as { created: boolean };
    expect(minor.created).toBe(true); // 小类不占大类额度
    await expect(env.call('dsh-memory/room-register', { slug: '新主题' })).rejects.toThrow('非法 Room slug');
    await expect(env.call('dsh-memory/room-register', { slug: 'a/b/c' })).rejects.toThrow('非法 Room slug');
    const g = (await env.call('dsh-memory/rooms-get', {})) as { registry: Array<{ slug: string; label?: string; source: string }> };
    const hallRow = g.registry.find((e) => e.slug === 'dsh-plugin');
    expect(hallRow?.label).toBe('dsh插件');
    expect(hallRow?.source).toBe('pre-registered');
    expect(g.registry.some((e) => e.slug === 'dsh-plugin/merge')).toBe(true);
  });

  it('③ 收编自生长(source=grown)', async () => {
    const r = (await env.call('dsh-memory/room-register', { slug: 'beta', source: 'grown' })) as { created: boolean };
    expect(r.created).toBe(true);
    const g = (await env.call('dsh-memory/rooms-get', {})) as { rooms: Array<{ room: string; source?: string }> };
    expect(g.rooms.find((x) => x.room === 'beta')?.source).toBe('grown');
  });

  it('④ 导出三 kind:词表 / 孤儿清单 / 按 Room 记录', async () => {
    const rooms = (await env.call('dsh-memory/rooms-export', { kind: 'rooms' })) as { csv: string; total: number };
    const roomRows = csvRows(rooms.csv);
    expect(roomRows.some((r) => r[0] === 'dsh-plugin' && r[2] === 'pre-registered' && r[3] === 'dsh插件')).toBe(true);
    expect(roomRows.some((r) => r[0] === 'beta' && r[2] === 'grown')).toBe(true);
    expect(roomRows.some((r) => r[0] === 'alpha' && r[2] === 'grown')).toBe(true);

    const orphans = (await env.call('dsh-memory/rooms-export', { kind: 'orphans' })) as { csv: string; total: number };
    expect(orphans.total).toBe(2);
    expect(orphans.csv.split('\r\n')[0]).toContain('room_candidates');

    const recs = (await env.call('dsh-memory/rooms-export', { kind: 'records', tag: 'alpha' })) as { csv: string; total: number };
    expect(recs.total).toBe(4); // 含退场行
    expect(recs.csv).toContain('a1');
  });

  it('⑤ merge:dryRun 零写入 → 实跑(备份/退场行/保全/场景重算入队)', async () => {
    const preview = (await env.call('dsh-memory/room-admin', { action: 'merge', from: 'alpha', to: 'dsh-plugin/merge' })) as {
      dryRun?: boolean; affected?: number; preview?: string[]; hasMore?: boolean;
    };
    expect(preview.dryRun).toBe(true);
    expect(preview.affected).toBe(4);
    expect(preview.preview).toContain('a1');
    expect(preview.hasMore).toBe(false);
    expect(env.l1.getByIds(['a1'])[0]!.metadata?.tags).toEqual(['alpha']); // 零写入

    const r = (await env.call('dsh-memory/room-admin', { action: 'merge', from: 'alpha', to: 'dsh-plugin/merge', dryRun: false })) as {
      dryRun?: boolean; affected?: number; backupFile?: string; notice?: string;
    };
    expect(r.dryRun).toBe(false);
    expect(r.affected).toBe(4);
    expect(r.backupFile).toBeTruthy();
    expect(await readFile(r.backupFile!, 'utf8')).toContain('alpha'); // 备份落盘
    // tags 重写(含退场行)+ 其余 metadata 键保全
    const m = env.l1.getByIds(['a1'])[0]!;
    expect(m.metadata?.tags).toEqual(['dsh-plugin/merge']);
    expect(m.metadata?.roomCandidates).toEqual(['x']);
    expect(m.metadata?.roomReview).toBe('pending');
    expect(m.metadata?.hall).toBe('work');
    expect(env.l1.getByIds(['r1'])[0]!.metadata?.tags).toEqual(['dsh-plugin/merge']);
    // 场景重算入队(source='room-merge')
    const claimed = env.l1.claimSceneRecluster();
    expect(claimed).not.toBeNull();
    expect(claimed!.source).toBe('room-merge');
    if (claimed) env.l1.finishSceneRecluster(claimed.jobId, true);
  });

  it('⑥ rename:记录 1:1 重写 + 注册表收旧名为别名', async () => {
    const r = (await env.call('dsh-memory/room-admin', { action: 'rename', from: 'beta', to: 'gamma', dryRun: false })) as { affected?: number };
    expect(r.affected).toBe(1);
    expect(env.l1.getByIds(['b1'])[0]!.metadata?.tags).toEqual(['gamma']);
    expect(env.registry.bySlug('gamma')!.aliases).toContain('beta');
    // 别名命中:旧名查得到同一条目
    expect(env.registry.bySlug('beta')!.slug).toBe('gamma');
  });

  it('归类:standalone room 经 rename(拖拽归类的后端)归入已有 hall,记录随迁', async () => {
    await env.call('dsh-memory/room-register', { slug: 'dsh-bash-terminal' });
    await seed(env.l1, 't1', ['dsh-bash-terminal']);
    const preview = (await env.call('dsh-memory/room-admin', { action: 'rename', from: 'dsh-bash-terminal', to: 'dsh-plugin/bash-terminal' })) as {
      dryRun?: boolean; affected?: number;
    };
    expect(preview.dryRun).toBe(true);
    expect(preview.affected).toBe(1);
    const r = (await env.call('dsh-memory/room-admin', { action: 'rename', from: 'dsh-bash-terminal', to: 'dsh-plugin/bash-terminal', dryRun: false })) as {
      affected?: number;
    };
    expect(r.affected).toBe(1);
    expect(env.l1.getByIds(['t1'])[0]!.metadata?.tags).toEqual(['dsh-plugin/bash-terminal']);
    expect(env.registry.bySlug('dsh-plugin/bash-terminal')!.aliases).toContain('dsh-bash-terminal');
    expect(env.registry.bySlug('dsh-plugin/bash-terminal')!.status).toBe('active'); // 归类不是退役
    // rooms-get 分组视图:该 room 现挂在 dsh-plugin hall 下
    const g = (await env.call('dsh-memory/rooms-get', {})) as { rooms: Array<{ room: string; count: number }> };
    expect(g.rooms.find((x) => x.room === 'dsh-plugin/bash-terminal')?.count).toBe(1);
  });

  it('收编+归类一步(grown-only 拖到 hall 下的后端组合):先 grown 注册目标,再 rename', async () => {
    // 未注册自生长 slug:记录带 git-commits 标签,注册表无条目
    await seed(env.l1, 'gc1', ['git-commits']);
    expect(env.registry.bySlug('git-commits')).toBeUndefined();
    // 客户端组合 = ①grown 注册目标(H/G)→ ②rename G→H/G(dryRun 预览零写入)
    const preview = (await env.call('dsh-memory/room-admin', { action: 'rename', from: 'git-commits', to: 'dsh-plugin/git-commits' })) as { dryRun?: boolean; affected?: number };
    expect(preview.dryRun).toBe(true);
    expect(preview.affected).toBe(1);
    expect((await env.call('dsh-memory/rooms-export', { kind: 'records', tag: 'git-commits' }) as { total: number }).total).toBe(1); // 预览未动
    // 实跑组合 = ①原地收编 from(source=grown;markMered 对未注册 from 会早退)→ ②rename(from 条目随后改名,别名由 renameSlug 挂)
    await env.call('dsh-memory/room-register', { slug: 'git-commits', source: 'grown' });
    await env.call('dsh-memory/room-admin', { action: 'rename', from: 'git-commits', to: 'dsh-plugin/git-commits', dryRun: false });
    expect(env.l1.getByIds(['gc1'])[0]!.metadata?.tags).toEqual(['dsh-plugin/git-commits']);
    const e = env.registry.bySlug('dsh-plugin/git-commits')!;
    expect(e.source).toBe('grown'); // 收编身份,不戴 ⭐
    expect(e.status).toBe('active');
    expect(e.aliases).toContain('git-commits'); // markMerged 把旧名收进目标别名
    // 分组视图:已挂到 dsh-plugin hall 下
    const g = (await env.call('dsh-memory/rooms-get', {})) as { rooms: Array<{ room: string; count: number }> };
    expect(g.rooms.find((x) => x.room === 'dsh-plugin/git-commits')?.count).toBe(1);
    // 两级 tag 过滤(list-records 的 tagSel 不得用 isTag 误拒)
    const lr = (await env.call('dsh-memory/list-records', { tag: 'dsh-plugin/git-commits' })) as { items: unknown[] };
    expect(lr.items).toHaveLength(1);
  });

  it('⑥b 编辑:room-admin update 改写 label/description(注册后可重编辑)', async () => {
    const r = (await env.call('dsh-memory/room-admin', { action: 'update', slug: 'dsh-plugin', label: 'dsh 插件家族', description: 'dsh 系列插件工作记忆' })) as { notice?: string };
    expect(r.notice).toContain('已更新');
    const g = (await env.call('dsh-memory/rooms-get', {})) as { registry: Array<{ slug: string; label?: string; description?: string }> };
    const e = g.registry.find((x) => x.slug === 'dsh-plugin')!;
    expect(e.label).toBe('dsh 插件家族');
    expect(e.description).toBe('dsh 系列插件工作记忆');
  });

  it('⑥c 退役带记录(retire withRecords):词表退役 + 该 room 下活跃记录全部软删(可恢复)', async () => {
    await env.call('dsh-memory/room-register', { slug: 'doomed' });
    await seed(env.l1, 'd1', ['doomed']);
    await seed(env.l1, 'd2', ['doomed']);
    const r = (await env.call('dsh-memory/room-admin', { action: 'retire', slug: 'doomed', withRecords: true })) as { notice?: string; retiredRecords?: number };
    expect(env.registry.bySlug('doomed')!.status).toBe('retired');
    expect(r.retiredRecords).toBe(2);
    // 软删:退场名单可见,活跃列表不可见
    const retired = (await env.call('dsh-memory/records-retired', { limit: 100, offset: 0 })) as { items: Array<{ id: string }> };
    const ids = retired.items.map((x) => x.id);
    expect(ids).toContain('d1');
    expect(ids).toContain('d2');
  });

  it('⑥d 自生长未注册 room 退场:自动补 retired 注册条目(按钮即刻变恢复)', async () => {
    await seed(env.l1, 'gone1', ['ghost-room']);
    // 未注册 slug 直接退场
    const r = (await env.call('dsh-memory/room-admin', { action: 'retire', slug: 'ghost-room', withRecords: true })) as { notice?: string; retiredRecords?: number };
    expect(r.retiredRecords).toBe(1);
    // 注册表出现条目(status=retired)→ 面板行即时变「已退役/恢复」
    expect(env.registry.bySlug('ghost-room')!.status).toBe('retired');
    expect(env.registry.bySlug('ghost-room')!.source).toBe('grown');
    // 恢复:active=true → 词表回归(active,grown 身份)
    await env.call('dsh-memory/room-admin', { action: 'retire', slug: 'ghost-room', active: true });
    expect(env.registry.bySlug('ghost-room')!.status).toBe('active');
  });

  it('⑦ retire / 恢复往返(HTTP 面)', async () => {
    await env.call('dsh-memory/room-admin', { action: 'retire', slug: 'dsh-plugin/merge' });
    expect(env.registry.bySlug('dsh-plugin/merge')!.status).toBe('retired');
    let g = (await env.call('dsh-memory/rooms-get', {})) as { registry: Array<{ slug: string; status: string }> };
    expect(g.registry.find((e) => e.slug === 'dsh-plugin/merge')?.status).toBe('retired');
    await env.call('dsh-memory/room-admin', { action: 'retire', slug: 'dsh-plugin/merge', active: true });
    expect(env.registry.bySlug('dsh-plugin/merge')!.status).toBe('active');
    g = (await env.call('dsh-memory/rooms-get', {})) as { registry: Array<{ slug: string; status: string }> };
    expect(g.registry.find((e) => e.slug === 'dsh-plugin/merge')?.status).toBe('active');
  });
});

describe('Hall·Room 集成:额度与降级', () => {
  it('⑧ 大类 200 上限;小类不占大类额度;总量保险另算', async () => {
    const c = await mkEnv();
    for (let i = 0; i < 200; i++) {
      await c.call('dsh-memory/room-register', { slug: `cap-${i}` });
    }
    await expect(c.call('dsh-memory/room-register', { slug: 'cap-overflow' })).rejects.toThrow('大类已达上限');
    // 满额下小类仍可细分(不占大类额度,只受总量保险约束)
    const minor = (await c.call('dsh-memory/room-register', { slug: 'cap-0/sub' })) as { created: boolean };
    expect(minor.created).toBe(true);
    c.db.close();
  });

  it('⑨ 损坏降级红线:registry 损坏 → 只读降级,rooms-get / register 不阻塞、磁盘不回写', async () => {
    const d = await mkEnv({ corruptRegistry: true });
    await seed(d.l1, 'g1', ['grown-tag']);
    // R2 红线:分类读路径永不阻塞——损坏只降级注册表自身
    const g = (await d.call('dsh-memory/rooms-get', {})) as { rooms: Array<{ room: string }>; registry: unknown[] };
    expect(g.rooms.some((r) => r.room === 'grown-tag')).toBe(true);
    expect(g.registry).toEqual([]);
    // 降级 = 内存态照常生效(停止回写):register 返回 created,但磁盘文件保持损坏原样
    const r = (await d.call('dsh-memory/room-register', { slug: 'after-corrupt' })) as { created: boolean };
    expect(r.created).toBe(true);
    const g2 = (await d.call('dsh-memory/rooms-get', {})) as { registry: Array<{ slug: string }> };
    expect(g2.registry.some((e) => e.slug === 'after-corrupt')).toBe(true);
    expect(await readFile(join(d.dataDir, 'rooms-registry.json'), 'utf8')).toBe('{corrupt!!!');
    d.db.close();
  });
});
