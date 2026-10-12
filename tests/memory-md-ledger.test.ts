/**
 * md 投射账本的落盘纪律（N9 的写侧）。
 *
 * 钉的是**合批**这一条：账本是整本 JSON 的原子重写，`set()` 若每条都落盘，导出就变成
 * O(n²)——本机实测 1200 条记录里只文件面就要 1.6 秒，其中约 7.9 秒纯粹花在重复重写
 * 账本上。现在 `set()` 只标脏，落盘要么等合批窗口，要么由 `flush()` 强制。
 *
 * 两条断言方向相反，缺一条就是假修复：
 *   - 一批 `set()` 后 `flush()`：落盘次数必须恒为 1（旧写法会交出 200）；
 *   - 同一批后磁盘内容必须是全量 200 条（证明合批没丢写）。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MdLedgerStore, type MdLedgerEntry } from '../src/store/memory-md-ledger.js';
import { MEM_MD_LEDGER_FILE_VERSION } from '../src/store/file-versions.js';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

function entry(i: number): MdLedgerEntry {
  const rel = `work_fact/item-${i}.memory.md`;
  return {
    id: `r${i}`, extKey: '', root: '/root', relPath: rel,
    dbDigest: `db${i}`.padEnd(12, '0'), fileDigest: `fg${i}`.padEnd(12, '0'),
    fileMtimeMs: 0, fileSize: 100 + i, syncedAt: new Date(0).toISOString(),
  };
}

async function freshLedger() {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-mdledger-'));
  dirs.push(dataDir);
  const ledger = new MdLedgerStore(dataDir);
  await ledger.init();
  return { dataDir, ledger, file: join(dataDir, 'mem-md-ledger.json') };
}

const diskCount = async (file: string): Promise<number> => {
  try {
    const raw = await readFile(file, 'utf8');
    return Object.keys(((JSON.parse(raw) as { entries: Record<string, unknown> }).entries)).length;
  } catch {
    return -1; // 还没有落过盘
  }
};

describe('MdLedgerStore 合批落盘', () => {
  it('200 次 set 只落盘一次（旧实现会在 flush 时把 200 个排队的整本重写全跑完）', async () => {
    const { ledger, file } = await freshLedger();
    for (let i = 0; i < 200; i++) ledger.set(`/root/work_fact/item-${i}.memory.md`, entry(i));

    await ledger.flush();
    // 这一条就是 O(n²) 与 O(n) 的分界：`flush()` 等的是整条落盘链，所以旧写法
    // （每 set 排一个 persist）在这里会交回 200 次落盘。用 writeCount 而不是用时间差：
    // 时间断言在慢机上会飘，而这个数是确定性可观测的。
    expect(ledger.writeCount).toBe(1);
    expect(await diskCount(file)).toBe(200);
    expect(ledger.all().length).toBe(200);

    // 没变更时 flush 不得空写一轮（不然一次点两下就是两次整本重写）。
    await ledger.flush();
    expect(ledger.writeCount).toBe(1);

    ledger.set('/root/work_fact/item-200.memory.md', entry(200));
    await ledger.flush();
    expect(ledger.writeCount).toBe(2);
    expect(await diskCount(file)).toBe(201);
  });

  it('flush() 之后再改再 flush，旧条目不丢（不是每轮整本覆盖回初值）', async () => {
    const { ledger, file } = await freshLedger();
    for (let i = 0; i < 5; i++) ledger.set(`/root/work_fact/item-${i}.memory.md`, entry(i));
    await ledger.flush();
    expect(await diskCount(file)).toBe(5);

    ledger.set('/root/work_fact/item-5.memory.md', entry(5));
    await ledger.flush();
    expect(await diskCount(file)).toBe(6);

    // 重开一个 store 能从盘上原样读回（键=绝对路径）。
    const again = new MdLedgerStore(join(file, '..'));
    await again.init();
    expect(again.all().length).toBe(6);
    expect(again.get('/root/work_fact/item-5.memory.md')?.fileSize).toBe(105);
  });

  it('delete() 与 set() 共用同一条落盘链', async () => {
    const { ledger, file } = await freshLedger();
    ledger.set('/root/work_fact/item-0.memory.md', entry(0));
    ledger.set('/root/work_fact/item-1.memory.md', entry(1));
    await ledger.flush();
    expect(await diskCount(file)).toBe(2);

    expect(ledger.delete('/root/work_fact/item-0.memory.md')).toBe(true);
    expect(ledger.delete('/root/work_fact/item-0.memory.md')).toBe(false);
    await ledger.flush();
    expect(await diskCount(file)).toBe(1);
  });
});

describe('MdLedgerStore 加载时的 relPath 规整（N10 后键是绝对路径）', () => {
  /**
   * 直接落一份账本文件再用新实例读回 —— 被测的是**加载路径**，不是 set()。
   *
   * 钉的真缺陷：旧实现“键与 relPath 不一致就以键为准重写”，而 N10 后键是绝对路径、
   * relPath 是相对形状，两者永远不相等 → 每次加载都把相对形状覆写成绝对键（真机 1167/1241 条）。
   * 下游危害：孤儿归档拼出 `<批次>/home/C:\Users\...` 这种含冒号的非法目录，mkdir 直接 ENOENT。
   */
  async function seed(
    pickRelPath: (key: string, root: string) => string,
    rootOverride?: string,
  ): Promise<{ ledger: MdLedgerStore; key: string }> {
    const dataDir = await mkdtemp(join(tmpdir(), 'dsh-mdledger-seed-'));
    dirs.push(dataDir);
    const root = join(dataDir, 'memories');
    const key = join(root, 'work_fact', 'item-7.memory.md');
    const e: MdLedgerEntry = { ...entry(7), root: rootOverride ?? root, relPath: pickRelPath(key, root) };
    await writeFile(join(dataDir, 'mem-md-ledger.json'), JSON.stringify({ version: MEM_MD_LEDGER_FILE_VERSION, entries: { [key]: e } }), 'utf8');
    const ledger = new MdLedgerStore(dataDir);
    await ledger.init();
    return { ledger, key };
  }

  it('存的是相对形状时不得被绝对键覆写', async () => {
    const { ledger, key } = await seed(() => 'work_fact/item-7.memory.md');
    expect(ledger.get(key)?.relPath).toBe('work_fact/item-7.memory.md');
  });

  it('存下来的是绝对路径（被旧 bug 污染的数据）→ 按 root+键重推成相对形状', async () => {
    const { ledger, key } = await seed((k) => k);
    expect(ledger.get(key)?.relPath).toBe('work_fact/item-7.memory.md');
  });

  it('root 也丢了时退到文件名，绝不留下会拼出非法目录的形状', async () => {
    const { ledger, key } = await seed((k) => k, '');
    expect(ledger.get(key)?.relPath).toBe('item-7.memory.md');
  });
});
