/**
 * 库→文件投射挂钩的收口（`store/memory-md-sync.ts` + `L1Store.setFileSyncHook`）。
 *
 * 为什么单独一个文件：`memory-md-suffix.test.ts` 钉的是**收敛器本体**（状态不变式），
 * 这里钉的是**接线**——四个汇流口是否都点火、未注入时是否零动作、钩子炸了会不会回头
 * 影响库侧。这批性质此前靠 8 处事件挂钩维持，真机结果是 920 条退场只有 8 个 `.disable`，
 * 所以「谁能触发」本身就是需要被钉住的契约，而不只是「改名对不对」。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { L1Store } from '../src/store/l1.js';
import { MemoryDb } from '../src/store/sqlite.js';
import { MdLedgerStore } from '../src/store/memory-md-ledger.js';
import { disableProjectionFile } from '../src/store/memory-md-disable.js';
import { makeFileSyncHook, syncFiles } from '../src/store/memory-md-sync.js';
import type { FileSyncDeps } from '../src/store/memory-md-sync.js';
import type { EmbeddingService } from '../src/store/embedding.js';
import type { MemoryRecord } from '../src/types.js';

const DIM = 16;
const RETIRED_AT = '2026-10-12T09:00:00.000Z';
const dirs: string[] = [];
const dbs: MemoryDb[] = [];

/**
 * Windows 上刚 `close()` 完的 sqlite 目录会被 wal 短暂握着（EBUSY: resource busy or locked, unlink …db-wal）。
 * 这不会弄坏任何断言（全部断言已在用例里做完），但会**把整个文件标成失败**（afterAll 报错算 suite 级失败），
 * 所以清理必须可重试——而不是当 flake 供着。
 */
async function rmRetry(p: string, tries = 6): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      await rm(p, { recursive: true, force: true });
      return;
    } catch (err) {
      if (i === tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
}

afterAll(async () => {
  // sqlite 句柄必须先全关（抛错也不能中断后面的清理）。
  for (const db of dbs) {
    try { db.close(); } catch { /* 已关或重复关：清理任务，不是断言 */ }
  }
  for (const d of dirs) await rmRetry(d);
});

function vecFor(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (let i = 0; i < text.length; i++) v[text.charCodeAt(i) % DIM] += 1;
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (mag > 1e-10) for (let i = 0; i < DIM; i++) v[i] /= mag;
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

function rec(id: string, name: string, content = `记忆 ${id}`): MemoryRecord {
  const t = Date.parse('2026-10-12T00:00:00Z');
  return { id, name, content, type: 'work_fact', priority: 60, scene_name: 's', timestamps: [t], createdAt: t, updatedAt: t };
}

/** 单根落点（这批用例都不带 workspaceId）。 */
const mdFile = (dataDir: string, name: string): string => join(resolve(dataDir, 'memories'), 'work_fact', `${name}.memory.md`);

interface Harness {
  store: L1Store;
  ledger: MdLedgerStore;
  dataDir: string;
  deps: FileSyncDeps;
}

async function harness(opts: { enabled?: boolean; withHook?: boolean; countFlush?: boolean } = {}): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-hk-'));
  dirs.push(dataDir);
  const db = new MemoryDb(join(dataDir, 'hk.db'), DIM);
  db.init();
  dbs.push(db);
  const store = new L1Store(dataDir, db, fakeEmbed(), 'keyword', undefined, 0);
  await store.init();
  const ledger = new MdLedgerStore(dataDir);
  await ledger.init();
  if (opts.countFlush === true) {
    // 数落盘次数而不是计时间：“整本重写 N 次”这个缺陷本身是确定的，计时在 CI 上只会飘。
    let n = 0;
    const orig = ledger.flush.bind(ledger);
    ledger.flush = async () => { n += 1; return orig(); };
    (ledger as { flushCount?: () => number }).flushCount = () => n;
  }
  const deps: FileSyncDeps = {
    getByIds: (ids) => store.getByIds([...ids]),
    exportCfg: () => ({ enabled: opts.enabled !== false, root: undefined, maxRecords: 2000, timeBudgetMs: 600_000 }),
    dataDir,
    ledger: () => ledger,
  };
  if (opts.withHook !== false) store.setFileSyncHook(makeFileSyncHook(deps));
  return { store, ledger, dataDir, deps };
}

const flushCount = (ledger: MdLedgerStore): number => (ledger as { flushCount?: () => number }).flushCount?.() ?? 0;

/**
 * 挂钩是 fire-and-forget，测试只能等盘上真出现结果。
 *
 * 预算给到 15s：整套跑时 153 个文件并发抢磁盘，后台那一轮「导出+收敛」就是会比单文件跑慢
 * 一个量级（实测：4s 预算在全量门禁下会假红）。这不会拖慢成功路径——命中即返。
 */
async function until(pred: () => boolean, ms = 15_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return pred();
}

describe('未注入钩子 = 零文件动作（既有承诺不改）', () => {
  it('无钩子时 appendNew / retire 都不碰磁盘', async () => {
    const h = await harness({ withHook: false });
    await h.store.appendNew([rec('n1', 'no-hook-add')]);
    h.store.retire(['n1'], { at: RETIRED_AT, reason: 'manual' });
    // 留一点时间：真有后台动作的话这会儿该落盘了
    await new Promise((r) => setTimeout(r, 120));
    expect(existsSync(mdFile(h.dataDir, 'no-hook-add'))).toBe(false);
    expect(existsSync(`${mdFile(h.dataDir, 'no-hook-add')}.disable`)).toBe(false);
    expect(flushCount(h.ledger)).toBe(0);
  });

  it('钩子在但投射面关着 ⇒ 同样零动作（现读判据，不是启动快照）', async () => {
    let enabled = false;
    const dataDir = await mkdtemp(join(tmpdir(), 'dsh-hk-off-'));
    dirs.push(dataDir);
    const db = new MemoryDb(join(dataDir, 'hk.db'), DIM);
    db.init();
    dbs.push(db);
    const store = new L1Store(dataDir, db, fakeEmbed(), 'keyword', undefined, 0);
    await store.init();
    const ledger = new MdLedgerStore(dataDir);
    await ledger.init();
    store.setFileSyncHook(makeFileSyncHook({
      getByIds: (ids) => store.getByIds([...ids]),
      exportCfg: () => ({ enabled, root: undefined, maxRecords: 2000, timeBudgetMs: 600_000 }),
      dataDir,
      ledger: () => ledger,
    }));
    await store.appendNew([rec('o1', 'off-switch')]);
    await new Promise((r) => setTimeout(r, 120));
    expect(existsSync(mdFile(dataDir, 'off-switch'))).toBe(false);
    // 打开旋钮后不必重建 store：下一次点火就生效（volatile 热更的语义）
    enabled = true;
    store.retire(['o1'], { at: RETIRED_AT, reason: 'manual' });
    expect(await until(() => existsSync(`${mdFile(dataDir, 'off-switch')}.disable`))).toBe(true);
  });
}, 30_000); // 后台那一轮在全量门禁下会比单文件跑慢；vitest 默认 5s 会先超时

describe('四个汇流口都点火', () => {
  it('appendNew（写对称：新增即时上盘）', async () => {
    const h = await harness();
    await h.store.appendNew([rec('w1', 'hook-add')]);
    expect(await until(() => existsSync(mdFile(h.dataDir, 'hook-add')))).toBe(true);
  });

  it('retire(机器侧 superseded) → 文件改名 .disable（此前只有召回面板那条路径会动盘）', async () => {
    const h = await harness();
    await h.store.appendNew([rec('w2', 'hook-supersede')]);
    expect(await until(() => existsSync(mdFile(h.dataDir, 'hook-supersede')))).toBe(true);
    h.store.retire(['w2'], { at: RETIRED_AT, reason: 'superseded', by: 'mem_new_x' });
    expect(await until(() => existsSync(`${mdFile(h.dataDir, 'hook-supersede')}.disable`))).toBe(true);
    expect(existsSync(mdFile(h.dataDir, 'hook-supersede'))).toBe(false);
  });

  it('restore（恢复活跃）→ 掉后缀', async () => {
    // 反向对照（本文件每一例都是）：把 `l1.ts` 里对应的 `fireFileSync` 注掉，这一例必须红。
    // 已实测：注掉 restore 那一处 → 本例 `expected false to be true`（文件停在 `.disable` 上）。
    const h = await harness();
    await h.store.appendNew([rec('w3', 'hook-restore')]);
    h.store.retire(['w3'], { at: RETIRED_AT, reason: 'manual' });
    expect(await until(() => existsSync(`${mdFile(h.dataDir, 'hook-restore')}.disable`))).toBe(true);
    await h.store.restore(['w3']);
    expect(await until(() => existsSync(mdFile(h.dataDir, 'hook-restore')))).toBe(true);
    expect(existsSync(`${mdFile(h.dataDir, 'hook-restore')}.disable`)).toBe(false);
  });

  it('rename → 投射文件搬到新名，账本跟着换键', async () => {
    const h = await harness();
    await h.store.appendNew([rec('w4', 'hook-old-name')]);
    expect(await until(() => existsSync(mdFile(h.dataDir, 'hook-old-name')))).toBe(true);
    const r = h.store.rename('w4', 'hook-new-name');
    expect(r.ok).toBe(true);
    const oldAbs = mdFile(h.dataDir, 'hook-old-name');
    const newAbs = mdFile(h.dataDir, 'hook-new-name');
    expect(await until(() => existsSync(newAbs))).toBe(true);
    expect(existsSync(oldAbs)).toBe(false);
    expect(await until(() => h.ledger.get(oldAbs) === undefined)).toBe(true);
    expect(h.ledger.get(newAbs)?.id).toBe('w4');
  });

  it('rename 的退场记录带着 `.disable` 一起走（不把无效态搬成有效态）', async () => {
    const h = await harness();
    await h.store.appendNew([rec('w5', 'hook-retired-name')]);
    expect(await until(() => existsSync(mdFile(h.dataDir, 'hook-retired-name')))).toBe(true);
    h.store.retire(['w5'], { at: RETIRED_AT, reason: 'manual' });
    expect(await until(() => existsSync(`${mdFile(h.dataDir, 'hook-retired-name')}.disable`))).toBe(true);
    expect(h.store.rename('w5', 'hook-retired-renamed').ok).toBe(true);
    expect(await until(() => existsSync(`${mdFile(h.dataDir, 'hook-retired-renamed')}.disable`))).toBe(true);
    expect(existsSync(`${mdFile(h.dataDir, 'hook-retired-name')}.disable`)).toBe(false);
    // 改名之后仍没有「有效态」的那份，否则一条退场记忆会以活跃姿态出现在文件树里
    expect(existsSync(mdFile(h.dataDir, 'hook-retired-renamed'))).toBe(false);
  });

  it('旧路径本就没有文件 ⇒ 不报错，按新名补写', async () => {
    const h = await harness();
    await h.store.appendNew([rec('w7', 'hook-v7')]);
    expect(await until(() => existsSync(mdFile(h.dataDir, 'hook-v7')))).toBe(true);
    // 盘上没有 `hook-v7` 那一份了（当人手删过），改名后应补写新名而不是抛
    await rm(mdFile(h.dataDir, 'hook-v7'), { force: true });
    expect(h.store.rename('w7', 'hook-v7-new').ok).toBe(true);
    expect(await until(() => existsSync(mdFile(h.dataDir, 'hook-v7-new')))).toBe(true);
  });
}, 30_000); // 同上：本组几乎全部在等后台落盘

describe('批量与失败面', () => {
  /**
   * 等后台那一轮彻底静下来（持续 3 拍没新 flush 就算落定），再取总数。
   *
   * 为什么不能拿「点火前快照 + 固定增量」当尺子：`appendNew` 那个后台任务自己会收尾
   * flush，它的第二次 flush（收敛阶段）完全可能落在我取快照之后——那是在测竞态，不是在测配额。
   */
  async function settleFlushes(ledger: MdLedgerStore, tickMs = 120): Promise<number> {
    let last = -1;
    let quiet = 0;
    while (quiet < 3) {
      const c = flushCount(ledger);
      if (c === last) quiet++;
      else { quiet = 0; last = c; }
      await new Promise((r) => setTimeout(r, tickMs));
    }
    return last;
  }

  it('批量 300 条退场只落几次账（逐条 flush = 整本 JSON 重写 N 次）', async () => {
    const h = await harness({ countFlush: true });
    const list = Array.from({ length: 300 }, (_, i) => rec(`b${i}`, `bulk-${i}`));
    await h.store.appendNew(list);
    expect(await until(() => existsSync(mdFile(h.dataDir, 'bulk-0')))).toBe(true);
    h.store.retire(list.map((r) => r.id), { at: RETIRED_AT, reason: 'manual' });
    expect(await until(() => existsSync(`${mdFile(h.dataDir, 'bulk-0')}.disable`))).toBe(true);
    const total = await settleFlushes(h.ledger);
    // 两次点火×（导出收尾 1 + 收敛收尾 1）= 理应 4 次量级；给 10 的余量。
    // 旧写法（每条 moveLedger 都 flush）在这一批上是 ≥600 次，不在这个量级上。
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(10);
  });

  it('钩子内部抛异常 ⇒ 库侧结果不受影响（retire 照常计数，不外抛）', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'dsh-hk-boom-'));
    dirs.push(dataDir);
    const db = new MemoryDb(join(dataDir, 'hk.db'), DIM);
    db.init();
    dbs.push(db);
    const store = new L1Store(dataDir, db, fakeEmbed(), 'keyword', undefined, 0);
    await store.init();
    const ledger = new MdLedgerStore(dataDir);
    await ledger.init();
    store.setFileSyncHook(makeFileSyncHook({
      getByIds: (): readonly MemoryRecord[] => {
        throw new Error('取快照炸了');
      },
      exportCfg: () => ({ enabled: true, root: undefined, maxRecords: 2000, timeBudgetMs: 600_000 }),
      dataDir,
      ledger: () => ledger,
    }));
    await store.appendNew([rec('x1', 'boom-case')]);
    expect(store.retire(['x1'], { at: RETIRED_AT, reason: 'manual' })).toBe(1);
    expect(store.listRetired({ limit: 10, offset: 0 }).total).toBe(1);
  });

  it('双触发幂等：disableProjectionFile 之后钩子再跑一轮，形状与字节都不变', async () => {
    const h = await harness();
    const r = rec('d1', 'dual-fire');
    await h.store.appendNew([r]);
    expect(await until(() => existsSync(mdFile(h.dataDir, 'dual-fire')))).toBe(true);
    h.store.retire(['d1'], { at: RETIRED_AT, reason: 'manual' });
    const abs = mdFile(h.dataDir, 'dual-fire');
    const dis = `${abs}.disable`;
    expect(await until(() => existsSync(dis))).toBe(true);
    const before = await readFileSafe(dis);
    // 面板那条路径仍在直接调它（确定性凭证语义），钩子那条也已经跑过 → 第二次必须 `already`
    const outcome = await disableProjectionFile({ record: { ...r, validTo: Date.parse(RETIRED_AT) }, cfgRoot: undefined, dataDir: h.dataDir, ledger: h.ledger });
    expect(outcome).toBe('already');
    await syncFiles(h.deps, h.store.getByIds(['d1']));
    expect(existsSync(dis)).toBe(true);
    expect(existsSync(abs)).toBe(false);
    expect(await readFileSafe(dis)).toBe(before);
  });

  it('人手造的 `.disable` 不被钩子改回（只报 both，不动盘）', async () => {
    const h = await harness();
    const abs = mdFile(h.dataDir, 'hand-made');
    await putFile(abs, '---\nid: "d2"\n---\n\n库里还活着\n');
    await putFile(`${abs}.disable`, '人手写的失效凭证\n');
    const rep = await syncFiles(h.deps, [rec('d2', 'hand-made')]);
    expect(rep?.suffix.both).toBe(1);
    expect(existsSync(abs)).toBe(true);
    expect(existsSync(`${abs}.disable`)).toBe(true);
  });

  it('连跑两轮零动作（幂等，第二遍不来回倒腾）', async () => {
    const h = await harness();
    const live = rec('p1', 'two-passes');
    await h.store.appendNew([live]);
    expect(await until(() => existsSync(mdFile(h.dataDir, 'two-passes')))).toBe(true);
    const a = await syncFiles(h.deps, [live]);
    expect(a?.exported.written).toBe(0);
    expect(a?.suffix.renamed).toBe(0);
  });
}, 30_000); // 同上：批量那一例 300 条要跑两轮导出+收敛

/** 读文件（不存在返回 undefined，免得断言处 try/catch）。 */
async function readFileSafe(p: string): Promise<string | undefined> {
  try {
    const { readFile } = await import('node:fs/promises');
    return await readFile(p, 'utf8');
  } catch {
    return undefined;
  }
}

/** 人造文件得先建目录。 */
async function putFile(p: string, text: string): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(join(p, '..'), { recursive: true });
  await writeFile(p, text, 'utf8');
}
