/**
 * `l1_records.name`（文件身份键，P0-a/P0-b）的落地回归——真 MemoryDb + FTS。
 *
 * 钉住四件会静默坏掉的事：
 *   1. **建列不 degraded**（F7：schema 迁移失败 = 整库降级，比缺一个索引严重得多）；
 *   2. **部分唯一索引只约束非空值**（存量 name 恒 ''，若索引写成全表唯一，旧库首次
 *      迁移就当场炸；两条没名字的记录也必须能共存）；
 *   3. **撞名不能丢记录**（store 层把“名字不属于它”的行消歧重命；部分唯一索引是第二道，
 *      只对绕过 store 的裸写生效——只靠索引挡的话，代价是那条记忆直接进不了检索库）；
 *   4. **name 不进快照哈希投影**（F5：`canonicalRecords` 显式列举字段，加列安全、
 *      改投影危险）。这条用"同一集合改 name 前后哈希不变"来断言，而不是抄一个魔数——
 *      魔数只能证明"当时算出来是这样"，性质才能证明"以后也不会变"。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { L1Store } from '../src/store/l1.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { hashRecords } from '../src/store/l1-snapshot.js';
import type { EmbeddingService } from '../src/store/embedding.js';
import type { MemoryRecord } from '../src/types.js';

const DIM = 16;
const dirs: string[] = [];
const dbs: MemoryDb[] = [];
afterAll(async () => {
  // Windows 上不先关句柄就删不了目录（EBUSY）；其它套件靠这一下才收得干净。
  for (const db of dbs) db.close();
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

function vecFor(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (let i = 0; i < text.length; i++) v[text.charCodeAt(i) % DIM] += 1;
  return v;
}
function fakeEmbed(): EmbeddingService {
  return {
    getDimensions: () => DIM,
    getProviderInfo: () => ({ provider: 'probe', model: 'probe', dimensions: DIM }),
    isReady: () => true,
    embed: async (t: string) => vecFor(t),
    embedBatch: async (ts: string[]) => ts.map(vecFor),
  };
}

function rec(id: string, content: string, extra: Partial<MemoryRecord> = {}): MemoryRecord {
  const t = Date.now();
  return { id, content, type: 'work_fact', priority: 60, scene_name: 's', timestamps: [t], createdAt: t, updatedAt: t, ...extra };
}

async function setup(autoName = false) {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-l1name-'));
  dirs.push(dataDir);
  const db = new MemoryDb(join(dataDir, 'n.db'), DIM);
  db.init();
  dbs.push(db);
  const store = new L1Store(dataDir, db, fakeEmbed(), 'hybrid', undefined, 0, undefined, () => autoName);
  await store.init();
  return { db, store };
}

describe('l1_records.name 列', () => {
  it('建列成功且库不 degraded；不起名时记录形状与加列前逐字一致', async () => {
    const { db, store } = await setup();
    expect(db.isDegraded()).toBe(false);
    await store.appendNew([rec('a1', '上行必须走官方地址')]);
    const got = store.getByIds(['a1'])[0];
    expect(got).toBeDefined();
    // 没起名的两条都是 undefined（不是空串）：投射关着时“零动作”这条承诺不改。
    expect(got!.name).toBeUndefined();
  });

  it('起名器打开时 appendNew 会当场分名（同一个基底的两条拿 -2 后缀）', async () => {
    // 这一条是③的真机教训：1166 条 name 全空时，42 条挤进 17 个同名投射文件，
    // 导出每轮重刷被覆盖的那几条。名字必须在写库前就唯一。
    const { store } = await setup(true);
    await store.appendNew([
      rec('n1', '同一个基底的第一条'),
      rec('n2', '同一个基底的第二条'),
      rec('n3', '同一个基底的第三条'),
    ]);
    const names = store.getByIds(['n1', 'n2', 'n3']).map((r) => r.name);
    expect(new Set(names).size).toBe(3);
    expect(names.every((n) => typeof n === 'string' && n!.length > 0)).toBe(true);
  });

  it('【不丢数据】后继记录拿着“属于别人的名字”写库时，必须重命而不是撞索引丢掉', async () => {
    // 这不是假设：去重 merge / 取代路径就是 `{ ...旧记录, id: 新 id }` 这么写的，
    // 而旧记录刚被起名器填上 name。不重命的话 INSERT 撞部分唯一索引 →
    // `upsertL1Batch` 回退逐条仍失败 → **整条新记忆进不了检索库**（旧记录已退场，
    // 于是这次取代什么都没留下）。真机上这条由两个挂掉的用例供认。
    const { store } = await setup(true);
    const r = rec('s1', '初版事实');
    await store.appendNew([r]);
    expect(r.name).toBe('初版事实');

    await store.upsert({ ...r, id: 's2', content: '合并后事实', version: 2 });
    const [newest] = store.getByIds(['s2']);
    expect(newest, '后继记录必须存在').toBeDefined();
    expect(newest!.name).toBe('合并后事实');
    expect(store.getByIds(['s1'])[0]!.name).toBe('初版事实');
    // 两条都有名且不相等（= 两个投射文件，不互相覆盖）。
    expect(new Set([newest!.name, store.getByIds(['s1'])[0]!.name]).size).toBe(2);
  });

  it('两条 name 为空的记录可共存（部分索引不约束空串）', async () => {
    const { store } = await setup();
    await store.appendNew([rec('b1', '第一条没名字'), rec('b2', '第二条没名字')]);
    expect(store.getByIds(['b1', 'b2']).length).toBe(2);
  });

  it('写入时带 name 能读回；撞名不丢记录而是消歧，但库层索引仍拦裸写', async () => {
    const { db, store } = await setup();
    await store.appendNew([rec('c1', 'pnpm 需要 hoisted 布局', { name: 'pnpm-hoisted' })]);
    expect(store.getByIds(['c1'])[0]!.name).toBe('pnpm-hoisted');
    expect(store.findIdByName('pnpm-hoisted')).toBe('c1');

    // 第二条想用同一个名字。**旧行为是“整条丢”**（INSERT 撞唯一索引 → 批量写回退逐条
    // → 仍失败 → 这条记忆进不了检索库，而面板上什么都看不到）。现在 store 层先把它
    // 消歧到另一个名字：记录保住，两条也不共享同一个投射文件。
    await store.appendNew([rec('c2', '另一条也想叫这个', { name: 'pnpm-hoisted' })]);
    const [c2] = store.getByIds(['c2']);
    expect(c2, '撞名不能把记录弄丢').toBeDefined();
    expect(c2!.name).not.toBe('pnpm-hoisted');
    expect(c2!.name!.length).toBeGreaterThan(0);
    // 第一条的名字不会被抢走。
    expect(store.getByIds(['c1'])[0]!.name).toBe('pnpm-hoisted');

    // 第二道防线仍在：**绕过 store 直接写库**的裸重名依旧被部分唯一索引拦下。
    // 这条不是凑数：去掉它，“名字唯一”就只剩调用方自觉，一个漏的调用点就能长出两份同名文件。
    expect(db.upsertL1({ ...rec('c9', '裸写重名', { name: 'pnpm-hoisted' }), family: 'work' } as never)).toBe(false);
    expect(store.getByIds(['c9'])[0]).toBeUndefined();
    expect(store.findIdByName('pnpm-hoisted')).toBe('c1');
  });

  it('rename 生效、撞名返回 dup、且都不动 updated_time（快照哈希不漂）', async () => {
    const { store } = await setup();
    await store.appendNew([
      rec('d1', '第一条', { name: 'first' }),
      rec('d2', '第二条', { name: 'second' }),
    ]);
    const before = store.getByIds(['d1'])[0]!.updatedAt;

    expect(store.rename('d1', 'renamed').ok).toBe(true);
    expect(store.getByIds(['d1'])[0]!.name).toBe('renamed');
    expect(store.findIdByName('first')).toBeUndefined();
    expect(store.findIdByName('renamed')).toBe('d1');

    // 撞名：明确报 dup，**不自动加后缀**（那会静默长出语义重叠的第二条）。
    expect(store.rename('d1', 'second')).toEqual({ ok: false, reason: 'dup' });
    expect(store.getByIds(['d1'])[0]!.name).toBe('renamed');

    // 不存在的 id 不能凭空改名。
    expect(store.rename('nope', 'x')).toEqual({ ok: false, reason: 'missing' });

    // 改名不是"内容变了"：updated_time 一动，衰减/排序与快照哈希就都跟着漂。
    expect(store.getByIds(['d1'])[0]!.updatedAt).toBe(before);
  });

  it('name 在**每一条**读回路径上都在（新列最容易被某个 SELECT 清单漏掉）', async () => {
    // 这一条不是凑数：实现时 `getAllL1`/`listL1`/已退场列表三处 SELECT 都没加 name，
    // 导出测才把它抱出来——记录写进去有名字、读出来没名字，投射器就会给同一条
    // 记忆反复换文件名（回落链看的是 name）。四张读口一起钉，漏一个就红。
    const { db, store } = await setup();
    await store.appendNew([rec('f1', '四条读口都要带名字', { name: 'four-read-paths' })]);
    const byIds = store.getByIds(['f1'])[0]!;
    const viaAll = store.all().find((r) => r.id === 'f1')!;
    const viaList = store.list({ limit: 10, offset: 0 }).items.find((r) => r.id === 'f1')!;
    expect(byIds.name).toBe('four-read-paths');
    expect(viaAll.name).toBe('four-read-paths');
    expect(viaList.name).toBe('four-read-paths');
    // 退场后走“已退场列表”那条 SELECT，同样不能丢名字。
    store.retire(['f1'], { at: new Date().toISOString(), reason: 'manual' });
    const retired = db.listRetiredL1({ limit: 10, offset: 0 }).items.find((r) => r.id === 'f1')!;
    expect(retired.name).toBe('four-read-paths');
  });

  it('name 不进快照哈希投影：同一集合改名字前后 hashRecords 不变', async () => {
    const { store } = await setup();
    await store.appendNew([rec('e1', '要改名的记录'), rec('e2', '另一条记录')]);
    const h0 = hashRecords(store.all());
    expect(store.rename('e1', 'e1-name').ok).toBe(true);
    expect(hashRecords(store.all())).toBe(h0);
    // 反向对照：内容真的变了，哈希必须变（否则上面那条断言只是"函数没在算"）。
    await store.appendNew([rec('e3', '新内容', { name: 'e3-name' })]);
    expect(hashRecords(store.all())).not.toBe(h0);
  });

  it('存量回填：persist 真的落库，且名字属于自己时第二次跑零动作', async () => {
    // “导出前先把没名字的补上”那条路径就靠这里钉：不落库的话，投射文件永远
    // 靠临时现算的名字，下一轮又洗出同一个；幂等不钉的话，每次导出都在重命名。
    const { db, store } = await setup();
    await store.appendNew([rec('g1', '同一句正文'), rec('g2', '同一句正文'), rec('g3', '另一句正文')]);
    const hash = hashRecords(store.all());

    const list = store.all();
    expect(store.assignMissingNames(list, { persist: true, fillEmpty: true }).named).toBe(3);
    // 落库了：重开一次读（不靠内存里那些对象）才能拿到名字。
    const readBack = new Map(db.getAllL1().map((r) => [r.id, r.name]));
    expect(new Set(readBack.values()).size).toBe(3);
    expect(readBack.get('g3')).toBe('另一句正文');
    // 起名不得弄挂快照哈希（name 不在字段表里）。
    expect(hashRecords(store.all())).toBe(hash);

    // 第二次：全都已有名且属于自己 → 零动作。
    const again = store.assignMissingNames(store.all(), { persist: true, fillEmpty: true });
    expect(again).toEqual({ named: 0, failed: 0 });
  });

  it('回填不碰内容：只有 name 列动，其余逐字段不变', async () => {
    const { store } = await setup();
    await store.appendNew([rec('h1', '只许改名字'), rec('h2', '另一条也只许改名字')]);
    const before = store.all().map((r) => ({ ...r, name: '' }));
    store.assignMissingNames(store.all(), { persist: true, fillEmpty: true });
    const after = store.all().map((r) => ({ ...r, name: '' }));
    expect(after).toEqual(before);
  });
});
