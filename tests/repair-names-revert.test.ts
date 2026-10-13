/**
 * 改名脚本的回滚路径（`tools/repair-names.mjs::revertPlan`）。
 *
 * 钉的是真翻过车的地方：`runCli` 调 revert 时**不传 hooks**，而 `findArchivedOld` 直接摸
 * `deps.hooks.exists` → 74 条全报 `Cannot read properties of undefined (reading 'exists')`。
 * apply 侧有 `deps.hooks ?? defaultHooks`，revert 侧漏了。这条用例故意**只传 runCli 那一组参数**，
 * 所以任何"给 revert 另配一套必填依赖"的改动都会在这里变红。
 *
 * 走的是真 fs（mkdtemp）+ 假 store：这里要验的是执行序与兜底，不是 SQL。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { revertPlan } from '../tools/repair-names.mjs';
import { digest } from '../src/store/memory-md.js';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

/** 最小账本替身：revertPlan 只用 get/set/delete/flush。 */
function fakeLedger() {
  const map = new Map<string, unknown>();
  return {
    map,
    get: (p: string) => map.get(p),
    set: (p: string, e: unknown) => { map.set(p, e); },
    delete: (p: string) => map.delete(p),
    flush: async () => {},
  };
}

/** 最小 L1 替身：现名放在 byId 里，rename 记录调用序。 */
function fakeL1(rows: Array<{ id: string; name: string }>) {
  const cur = new Map(rows.map((r) => [r.id, r.name]));
  const renames: Array<[string, string]> = [];
  return {
    cur,
    renames,
    all: () => rows.map((r) => ({ id: r.id, name: cur.get(r.id) ?? '' })),
    rename: (id: string, name: string) => {
      renames.push([id, name]);
      cur.set(id, name);
      return { ok: true };
    },
  };
}

async function sandbox() {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-rename-revert-'));
  dirs.push(dataDir);
  return dataDir;
}

const OLD_REL = 'work_fact/旧名.memory.md';
const NEW_REL = 'work_fact/新名.memory.md';

describe('revertPlan 的 hooks 兜底与回滚执行序', () => {
  it('不传 hooks（runCli 的真实调用形状）也必须跑完，且旧文件从归档搬回', async () => {
    const dataDir = await sandbox();
    const oldAbs = join(dataDir, 'memories', OLD_REL);
    const newAbs = join(dataDir, 'memories', NEW_REL);
    const newText = '---\nid: r1\n---\n\n新名内容\n';
    await mkdir(dirname(newAbs), { recursive: true });
    await writeFile(newAbs, newText, 'utf8');
    // 旧文件已被孤儿扫描归档走（真机就是这个形状：apply → sweep → 才发现 revert 需要找回它）。
    const archived = join(dataDir, 'memories-orphans', 'BATCH', 'home', OLD_REL);
    await mkdir(dirname(archived), { recursive: true });
    await writeFile(archived, '旧文件正文\n', 'utf8');

    const row = {
      v: 1, recordId: 'r1', oldName: '旧名', newName: '新名', type: 'work_fact',
      side: 'home', oldRelPath: OLD_REL, newRelPath: NEW_REL,
      oldAbs, newAbs, oldRoot: join(dataDir, 'memories'), newRoot: join(dataDir, 'memories'),
      oldEntry: { id: 'r1', extKey: '', root: join(dataDir, 'memories'), relPath: OLD_REL, dbDigest: 'd'.repeat(12), fileDigest: 'f'.repeat(12), fileMtimeMs: 0, fileSize: 1, syncedAt: '' },
      newFileDigest: digest(newText),
    };
    const l1 = fakeL1([{ id: 'r1', name: '新名' }]);
    const ledger = fakeLedger();

    const rep = await revertPlan({ rows: [row], l1, ledger, dataDir, cfgRoot: undefined, logger: undefined });

    expect(rep.failed).toEqual([]);
    expect(rep.reverted).toBe(1);
    expect(rep.moved).toBe(1);
    // 旧文件回位、新文件按指纹核对后拆除；账本两侧都回到改名前。
    expect(await readFile(oldAbs, 'utf8')).toBe('旧文件正文\n');
    expect(await readFile(newAbs, 'utf8').then(() => true, () => false)).toBe(false);
    expect(l1.renames).toEqual([['r1', '旧名']]);
    expect(ledger.map.has(oldAbs)).toBe(true);
    expect(ledger.map.has(newAbs)).toBe(false);
  });

  it('幂等：已是旧形状且新侧已清时零动作', async () => {
    const dataDir = await sandbox();
    const oldAbs = join(dataDir, 'memories', OLD_REL);
    const newAbs = join(dataDir, 'memories', NEW_REL);
    await mkdir(dirname(oldAbs), { recursive: true });
    await writeFile(oldAbs, '旧文件正文\n', 'utf8');
    const ledger = fakeLedger();
    ledger.set(oldAbs, { relPath: OLD_REL });
    const row = { recordId: 'r1', oldName: '旧名', newName: '新名', oldAbs, newAbs, oldEntry: null, newFileDigest: '' };
    const l1 = fakeL1([{ id: 'r1', name: '旧名' }]);

    const rep = await revertPlan({ rows: [row], l1, ledger, dataDir, cfgRoot: undefined });
    expect(rep.skippedAlready).toBe(1);
    expect(rep.reverted).toBe(0);
    expect(l1.renames).toEqual([]);
  });
});
