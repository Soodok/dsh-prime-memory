/**
 * P2 反向同步：md 投射文件 → 索引（文件是人编辑的那一侧）。
 *
 * 与导出侧（`memory-md-export.ts`）共用同一份落点计算（`targetFor`）、同一个库侧指纹
 * 算法（`recordDigest`）和同一本账本，所以两侧看到的世界一致；写文件这条路**直接复用**
 * `exportRecords`（传单条记录），不另写一套落盘逻辑——两套写盘迟早漂移。
 *
 * 判定一律走**三方**：账本里存着上次投射时的库侧指纹与文件侧指纹，"谁变了"才是可判定的。
 * 四象限（spec P2 裁决表）：
 * - 只有文件变 → 回灌入库，然后把文件重写成规范渲染（正文仍是人写的那段，frontmatter 归一）。
 *   这一步同时消掉写回环：库和文件都回到账本记着的那个状态，下一轮判 `same`。
 * - 只有库变 → 重写文件。
 * - **两边都变 → 什么都不做**，只在报告里挂账。人不裁决机器不许动；两侧保持原样、账本也不动，
 *   所以下次对账还会报同样的 `both`（挂账是持久的，不会悄悄过期）。
 * - 都没变 → 跳过，不刷 mtime。
 *
 * 另有一条独立通道：`.memory.md.disable` 后缀 = 人在文件侧手工判过时 → 退场对应记录
 * （写 valid_to，不进任何检索通路）。这是 `recall-feedback -1` 的文件侧对偶。
 *
 * 两条边界：
 * - 没有账本、也认不出记录的文件 = 人新建的，**不入库**。导入一条新记忆必须过写入内核
 *   的判据面（归一/长度/预算/去重），在这里手搓一条等于绕过那些不变量。只计数。
 * - 遍历范围 = 从记录算出的落点根 ∪ 账本里记过的根。所以"没有任何记录指向的全新 workspace"
 *   不在本轮范围内——它还没有投射根，等它的第一条记忆落进去才可见。
 *
 * 另有一条遍历防护（P2 缺口 task_3.7）：投射根下的"链接"在 win32 上不止 symlink 一种形状，
 * junction（目录联接，reparse point）也算，而 `Dirent.isSymbolicLink()` 对它的判定随 Node 版本
 * 与文件系统漂移。所以进任何子目录前再加一道 `realpath` 判据：解析出的真实路径必须仍在该投射根
 * 内，界外的一律不进并计入 `skippedLinks`。⚠️ 这个 realpath **只服务划界**——不参与账本键，也不
 * 参与落点计算（那边刻意不做 realpath，理由见 `store/memory-md.ts::targetFor` 的注释）。两处不一致
 * 是有意的，不是 bug。
 */

import { opendir, readFile, realpath, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { DISABLE_SUFFIX, digest, recordDigest, targetFor } from '../store/memory-md.js';
import { exportRecords } from '../store/memory-md-export.js';
import { parseMdFile } from '../store/memory-md-parse.js';
import { normalizeContentMd } from '../util/md-normalize.js';
import type { MdLedgerEntry, MdLedgerStore } from '../store/memory-md-ledger.js';
import type { MemExportReport, MdSyncReport, MdSyncSample } from '../store/memory-md-types.js';
import type { L1Store } from '../store/l1.js';
import type { MemoryLogger, MemoryRecord } from '../types.js';

/** 投射结构是 `<type>/<stem>.memory.md` 两层，3 层已足够宽容人的整理习惯，再深就是别人的目录。 */
const MAX_DEPTH = 3;

/** 样本上限：报告要进面板，全量路径会把面板撑爆；计数才是判据。 */
const SAMPLE_CAP = 12;

export interface MdSyncDeps {
  store: L1Store;
  ledger: MdLedgerStore;
  /** `cfg.memExport.root`（空 = 默认单根）；与导出侧同一个值。 */
  cfgRoot: string | undefined;
  dataDir: string;
  maxFiles: number;
  timeBudgetMs: number;
  logger?: MemoryLogger;
  /** 注入时钟（测试用）。 */
  now?: () => number;
}

/**
 * 越界判据：`resolved` 必须就是根，或者是根的子目录。
 *
 * 前缀比较带 `sep`：少了那个分隔符，兄弟目录 `<root>2` 会被判成界内（经典越界陷阱）。
 * 两侧都出自 `realpath`，同一卷上大小写与 8.3 短名都已归一，所以这里做**严格字符串**比较；
 * win32 上再折叠大小写只会放松判据（把真越界说成合法），不做。
 * 导出只为把判据本身钉成用例：造不出链接的机器上，判据仍要有测试可跑。
 */
export function isWithinRoot(rootReal: string, resolved: string): boolean {
  return resolved === rootReal || resolved.startsWith(rootReal + sep);
}

/** 文件护栏与遍历防护的共享状态（一轮一份，跨根累计）。 */
interface WalkGuard {
  /** `maxFiles` 护栏余额。 */
  files: number;
  /** 护栏耗尽后被丢下的合格文件数 → 如实报成 `capped` + `remaining`。 */
  dropped: number;
  /** 被防护拦下的条目数 → `skippedLinks`。 */
  links: number;
  /** 拦下时的路径样本（自带上限，最后挂进报告）。 */
  linkSamples: MdSyncSample[];
  logger?: MemoryLogger;
}

/** 记一笔拦截：计数、样本、日志三样都要有——只给数字，人分不清是"外面真有东西"还是"边界划错了"。 */
function noteLink(guard: WalkGuard, path: string, reason: string): void {
  guard.links += 1;
  if (guard.linkSamples.length < SAMPLE_CAP) guard.linkSamples.push({ path, action: `link: ${reason}` });
  guard.logger?.warn(`[memory] md 同步遍历防护拦下: ${path} - ${reason}`);
}

/** errno 取码（Node 把系统错误码挂在 `code` 上）。 */
function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

/** 列出一个根下的投射文件（含 `.disable`）。根不存在/没权限 → 空数组，不抛。 */
async function listProjectionFiles(root: string, guard: WalkGuard): Promise<string[]> {
  const out: string[] = [];
  // 边界基线 = 投射根自己的真实路径，一轮只解析一次。
  // ⚠️ 与 `targetFor` 的刻意不对称：落点/账本键那边**不**做 realpath（目录创建前后结果会变 →
  // 键漂移 → 对账永远报"文件缺失"，见 memory-md.ts::targetFor 注释）；这里的 realpath 只用来
  // 判断"还在不在根内"，往下记进 `out` 和账本的路径仍然是拼出来的 `abs`。别把它当成同一件事。
  // '' = 根本来不存在（走下面 opendir 同语义的正常缺席）；undefined = 解析失败但根并非缺席。
  const resolvedRoot = await realpath(root).catch((err: unknown) => (errCode(err) === 'ENOENT' ? '' : undefined));
  if (resolvedRoot === undefined) {
    // 划不出边界 = 无法判断界内界外 = 整根不进（安全方向），并计数留痕——静默少扫一整个根等于谎报。
    noteLink(guard, root, '根的真实路径解析失败，无法划界，整根未扫');
    return out;
  }
  if (resolvedRoot.length === 0) return out;
  const rootReal: string = resolvedRoot; // 显式落成 string，闭包里取值不靠推断运气

  const walk = async (dir: string, depth: number): Promise<void> => {
    // 深度护栏是**结构边界**（投射只有 `<type>/<stem>.memory.md` 两层），不是资源截断，
    // 所以它不动 `capped`/`remaining`——那两个只归 maxFiles 与墙钟算账，两条护栏各记各的。
    if (depth > MAX_DEPTH) return;
    let dh;
    try {
      dh = await opendir(dir);
    } catch {
      return; // 根不存在或不可读：范围本来就按已知根枚举，缺一个根不是错误
    }
    for await (const de of dh) {
      const abs = join(dir, de.name);
      // 第一道（零额外 syscall）：dirent 报链接就不进。
      if (de.isSymbolicLink()) {
        noteLink(guard, abs, 'dirent 报链接，未进入');
        continue;
      }
      if (de.isDirectory()) {
        // 第二道：win32 的链接形状不止 symlink，junction/目录联接是 reparse point，而它的 dirent
        // 判定随 Node 版本与文件系统漂移（本机 Node 22.22.1 实测报 true，但不能把边界押在一个
        // 会漂移的布尔上）。一次漏掉的目录链接就能把整棵外部树吞进扫描，或让遍历顺着链接绕出根。
        // 拦下来的那个目录里的文件**不**计入 `remaining`：那是"本来就不在范围内"，不是护栏截断。
        const resolved = await realpath(abs).catch(() => undefined);
        if (resolved === undefined) {
          noteLink(guard, abs, '真实路径解析失败，无法划界，未进入');
        } else if (!isWithinRoot(rootReal, resolved)) {
          noteLink(guard, abs, `真实路径在投射根外，未进入: ${resolved}`);
        } else {
          // 护栏耗完也要继续走目录：否则"还剩多少个"就没人知道，静默截断等于谎报。
          await walk(abs, depth + 1);
        }
        continue;
      }
      if (!de.isFile()) continue;
      if (!de.name.endsWith('.memory.md') && !de.name.endsWith(DISABLE_SUFFIX)) continue;
      if (guard.files <= 0) {
        guard.dropped += 1;
        continue;
      }
      guard.files -= 1;
      out.push(abs);
    }
  };
  await walk(root, 0);
  return out;
}

/**
 * 这条文件对哪条记录。
 *
 * 先按账本记的 id；id 找不到（merge 会重铸 id，F1/F21）就按文件名干找 `name`。
 * 两把钥匙都开不了才算找不到。
 */
function pickRecord(store: L1Store, id: string, fileName: string): MemoryRecord | undefined {
  const byId = id.length > 0 ? store.getByIds([id])[0] : undefined;
  if (byId !== undefined) return byId;
  const stem = fileName.replace(DISABLE_SUFFIX, '').replace(/\.memory\.md$/, '');
  if (stem.length === 0) return undefined;
  const byName = store.findIdByName(stem);
  return byName === undefined ? undefined : store.getByIds([byName])[0];
}

/** 写账（`.disable` 专用：那条路径不是 `targetFor` 会算出来的路径，所以只能手写字段）。 */
async function stampDisabled(
  ledger: MdLedgerStore,
  rec: MemoryRecord,
  abs: string,
  text: string,
): Promise<void> {
  const st = await stat(abs).catch(() => undefined);
  const cut = abs.lastIndexOf('/');
  const back = abs.lastIndexOf('\\');
  const sepAt = Math.max(cut, back);
  const entry: MdLedgerEntry = {
    id: rec.id,
    extKey: rec.extKey ?? '',
    root: sepAt > 0 ? abs.slice(0, sepAt) : '',
    relPath: sepAt > 0 ? abs.slice(sepAt + 1) : abs,
    dbDigest: recordDigest(rec),
    fileDigest: digest(text),
    fileMtimeMs: st?.mtimeMs ?? 0,
    fileSize: st?.size ?? 0,
    syncedAt: new Date().toISOString(),
  };
  ledger.set(abs, entry);
}

/**
 * 反向同步一轮。
 *
 * @param deps - 见 `MdSyncDeps`。
 * @returns 同步报告（含挂账样本、剩余量、以及遍历防护拦下的条目数 `skippedLinks`）。
 *   任何单条失败只计数并留痕，绝不抛挂整轮。
 */
export async function syncFromFiles(deps: MdSyncDeps): Promise<MdSyncReport> {
  const { store, ledger, cfgRoot, dataDir, logger } = deps;
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const report: MdSyncReport = {
    roots: 0,
    scanned: 0,
    imported: 0,
    rendered: 0,
    same: 0,
    skipped: 0,
    pending: 0,
    retired: 0,
    newFiles: 0,
    orphan: 0,
    remaining: 0,
    capped: false,
    skippedLinks: 0,
    staleRootFiles: 0,
    samples: [] as MdSyncSample[],
  };
  const sample = (path: string, action: string): void => {
    if (report.samples.length < SAMPLE_CAP) report.samples.push({ path, action });
  };

  // 根集合：记录算出的落点根 ∪ 账本记过的根。后者让人改过 workspaceId、或记录已被
  // 裁撤之后，残留文件仍能被看见并挂账，而不是凭空蒸发。
  const roots = new Set<string>();
  for (const r of store.all()) roots.add(targetFor(r, cfgRoot, dataDir, logger).root);
  for (const e of ledger.all()) if (e.root.length > 0) roots.add(e.root);
  report.roots = roots.size;

  const guard: WalkGuard = {
    files: Math.max(0, Math.trunc(deps.maxFiles)),
    dropped: 0,
    links: 0,
    linkSamples: [],
    logger,
  };
  const files: Array<{ root: string; abs: string }> = [];
  for (const root of roots) {
    for (const f of await listProjectionFiles(root, guard)) files.push({ root, abs: f });
  }
  report.skippedLinks = guard.links;
  // 护栏掉过文件 = 本轮结论只覆盖一部分，必须说出去（和墙钟截断同一个口径）。
  // 链接拦截不算在这里：那些文件本就在投射根外，不是"被护栏截断的范围内文件"。
  if (guard.dropped > 0) {
    report.capped = true;
    report.remaining = guard.dropped;
  }

  for (const item of files) {
    const abs = item.abs;
    // 两条护栏都在循环顶部查：写在末尾会被 continue 跳过（导出侧的测试抓过这个 bug）。
    if (now() - startedAt > deps.timeBudgetMs) {
      report.capped = true;
      report.remaining = files.length - report.scanned;
      break;
    }
    report.scanned += 1;
    let text = '';
    try {
      text = await readFile(abs, 'utf8');
    } catch (err) {
      report.skipped += 1;
      logger?.warn(`[memory] md 同步跳过（读不出）: ${abs} - ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const fileName = abs.slice(Math.max(abs.lastIndexOf('/'), abs.lastIndexOf('\\')) + 1);
    const entry = ledger.get(abs);
    const rec = pickRecord(store, entry?.id ?? '', fileName);

    // ---- 只挡"跳根重复"：文件所在根不是这条记录当前的落点根 ----
    // 根集合是「记录算出的落点根 ∪ 账本记过的根」，所以换过 `memExport.root`、迁库、
    // workspace 根与单根并存留残片时，同一条记录会在**两个根**下各有一份文件。旧那份不是
    // 无足轻重的：它带着自己的账本条目进循环，而象限判定拿它跟库比，**写盘却走
    // `targetFor` 算出的新根那份**（`exportRecords` 不读扫描到的路径）。结果是旧根里人写的
    // 编辑能绕过“两边都变就不动”把新根那份覆盖掉——而报告里看起来一切合规。
    // 刻意只比**根**不比全路径：人手在同一个根里的嵌套目录放文件（或放 `.disable`）仍是
    // 既有语义，不能在本修复里顺手收窄掉。非当前根的那份本质是孤儿，交给 `mem-orphans` 归档。
    // 比较用 `resolve` 不折叠大小写：判错时只会多拦不拦（stale = 什么都不做），方向安全。
    if (rec !== undefined) {
      const authRoot = targetFor(rec, cfgRoot, dataDir, logger).root;
      if (resolve(authRoot) !== resolve(item.root)) {
        report.staleRootFiles += 1;
        sample(abs, 'stale: 所在根不是该记录当前的落点根（两侧都不动，交给孤儿归档）');
        continue;
      }
    }

    // ---- `.disable` → 退场（后缀本身就是裁决，不参与指纹比较） ----
    if (fileName.endsWith(DISABLE_SUFFIX)) {
      if (rec === undefined) {
        report.orphan += 1;
        sample(abs, 'disable: 找不到对应记录');
        continue;
      }
      if (rec.validTo !== undefined) {
        report.same += 1;
        if (entry === undefined) await stampDisabled(ledger, rec, abs, text);
        continue;
      }
      store.retire([rec.id], { at: new Date().toISOString(), reason: 'obsolete' });
      const fresh = store.getByIds([rec.id])[0] ?? rec;
      await stampDisabled(ledger, fresh, abs, text);
      report.retired += 1;
      sample(abs, 'disable: 已退场');
      continue;
    }

    const parsed = parseMdFile(text);
    if (parsed === undefined) {
      report.skipped += 1;
      logger?.warn(`[memory] md 同步跳过（形状不符，不接受非投射格式）: ${abs}`);
      continue;
    }
    if (rec === undefined) {
      report.newFiles += 1;
      sample(abs, '新文件: 未入库（导入须过写入内核）');
      continue;
    }

    const dbChanged = entry === undefined || entry.dbDigest !== recordDigest(rec);
    const fileChanged = entry === undefined || entry.fileDigest !== digest(text);

    if (dbChanged && fileChanged) {
      report.pending += 1;
      sample(abs, 'both: 挂待裁决（两侧都不动）');
      logger?.warn(`[memory] md 同步挂账（两边都变，等人裁决）: ${abs} record=${rec.id}`);
      continue;
    }
    if (!dbChanged && !fileChanged) {
      report.same += 1;
      continue;
    }
    const one = (records: readonly MemoryRecord[]): Promise<MemExportReport> =>
      exportRecords({
        records,
        cfgRoot,
        dataDir,
        ledger,
        maxRecords: 1,
        timeBudgetMs: Math.max(1, deps.timeBudgetMs),
        logger,
        now: deps.now,
      });

    if (dbChanged) {
      // 只有库变 → 重写文件（走导出侧同一条写盘路）。
      const sub = await one([rec]);
      if (sub.skipped > 0) {
        report.skipped += 1;
        continue;
      }
      report.rendered += 1;
      sample(abs, sub.written > 0 ? '库侧更新 → 重写文件' : '库侧更新 → 文件已一致');
      continue;
    }

    // 只有文件变 → 回灌入库，再把文件重写成规范渲染（消写回环）。
    // 入库前同样过一道版式归一：两头用同一个函数，才能保证“库里的内容”与“渲染出的正文”
    // 是同一个形状，下一轮才判得出 `same`（P4.2）。
    const updated: MemoryRecord = {
      ...rec,
      content: normalizeContentMd(parsed.content),
      updatedAt: now(),
      version: (rec.version ?? 0) + 1,
    };
    try {
      await store.appendNew([updated]);
    } catch (err) {
      report.skipped += 1;
      logger?.warn(`[memory] md 回灌失败（跳过，不动文件）: ${abs} - ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const sub = await one([updated]);
    if (sub.skipped > 0) {
      // 入库成功但文件没回去：账本停在旧基线，下一轮会再报 fileOnly（文件其实已被我们
      // 的入库改成了新内容，但渲染落盘失败）。留痕，不静默。
      logger?.warn(`[memory] md 回灌后重渲染失败（下一轮仍会挂同一象限）: ${abs}`);
    }
    report.imported += 1;
    sample(abs, '文件侧更新 → 回灌入库');
  }

  // 链接拦截样本压到最后挂：`pending`/`orphan` 那批是等人裁决的，优先占面板那 12 个样本位；
  // 但它们仍要出现——只有计数没有路径，人无法判断该去查哪个目录。
  for (const s of guard.linkSamples) sample(s.path, s.action);

  await ledger.flush();
  return report;
}
