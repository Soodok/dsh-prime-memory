/**
 * 孤儿投射文件的归档（P4.4）。
 *
 * 孤儿是怎么长出来的：投射路径 = `<type>/<name>.memory.md`，而 `name` 会变——本轮的
 * 撞车消歧（42 条挤 17 个同名文件）、下一次的身份改名、以及记录被物理删除，都会让
 * **磁盘上的旧路径不再属于任何记录**。它们既不报错也不碍事，只是越积越多，而人无法分辨
 * 哪份是历史、哪份是刚被覆盖的。
 *
 * 只归档**有账可查**的那部分，判据是一条硬边界：
 * - 账本里记着这个绝对路径（= 确认是我们自己写出去的），且**现在没有记录映射到它** → 孤儿，搬走；
 * - 账本里没有 = 来路不明。那可能是人自己放进投射目录、等着被同步进来的输入，
 *   **绝对不许动**（md 同步侧对这类文件只计数不入库，同一个纪律）。
 *
 * 搬 ≠ 删：整批进 `<dataDir>/memories-orphans/<批次时间戳>/`，保留 `<ws|home>/<类型>/<名>` 的
 * 相对形状。删是 cleanup 的活，这里只负责别再挡在活档案里。账本条目跟着删——文件已经搬走，
 * 留着基线下一轮对账就会一直报「文件缺失」。
 */
import { mkdir, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { disablePathOf, resolveMemoriesRoot, safeJoin, targetFor } from './memory-md.js';
import type { MdLedgerStore } from './memory-md-ledger.js';
import type { MemoryLogger, MemoryRecord } from '../types.js';
import type { OrphanReport, OrphanSample } from './memory-md-types.js';

/** 样本条数上限：孤儿可能上千，面板不需要全量。 */
const SAMPLE_CAP = 20;

export interface OrphanDeps {
  /** 当前全部记录（含退场行——退场行仍认领自己的文件，那不是孤儿）。 */
  records: readonly MemoryRecord[];
  /** `cfg.memExport.root`（空 = 默认单根）。 */
  cfgRoot: string | undefined;
  dataDir: string;
  ledger: MdLedgerStore;
  /** true = 只报告不搬（默认值由端点侧兜死，这里不设默认）。 */
  dryRun: boolean;
  maxFiles: number;
  timeBudgetMs: number;
  logger?: MemoryLogger;
  /** 归档根；缺省 `<dataDir>/memories-orphans`。测试注入临时目录用。 */
  archiveRoot?: string;
  /** 注入时钟（测试用）。 */
  now?: () => number;
}

/**
 * 扫一遍账本，把无人认领的投射文件搬进归档目录。
 *
 * @param deps - 见 `OrphanDeps`。
 * @returns 报告；`dir` 在干跑时是空串（还没建批次目录）。任何单条失败只计数并留痕，绝不抛挂整轮。
 */
export async function sweepOrphanFiles(deps: OrphanDeps): Promise<OrphanReport> {
  const { records, cfgRoot, dataDir, ledger, logger } = deps;
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const report: OrphanReport = {
    dryRun: deps.dryRun,
    scanned: 0,
    claimed: 0,
    orphans: 0,
    moved: 0,
    failed: 0,
    missing: 0,
    remaining: 0,
    capped: false,
    dir: '',
    samples: [] as OrphanSample[],
  };
  const sample = (path: string, reason: string): void => {
    if (report.samples.length < SAMPLE_CAP) report.samples.push({ path, reason });
  };

  // 认领集：每条记录现在的路径 + 它的 `.disable` 兄弟。后者必须在集合里，否则 N11 的失效
  // 凭证会被当成孤儿搬走——那个后缀就是“这条已被判过时”的唯一文件侧表达。
  const claimed = new Set<string>();
  for (const r of records) {
    const abs = targetFor(r, cfgRoot, dataDir, logger).absPath;
    if (abs === undefined) continue;
    claimed.add(abs);
    claimed.add(disablePathOf(abs));
  }

  const homeRoot = resolveMemoriesRoot(cfgRoot, dataDir, logger);
  const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
  const archiveBase = deps.archiveRoot ?? join(dataDir, 'memories-orphans');
  const archiveDir = join(archiveBase, stamp);

  // 走的是**带键**的遍历：账本的键才是绝对路径，条目里的 root/relPath 只供恢复归档形状。
  const rows = ledger.allWithKeys();
  // 配额只数**动作**（搬走/失败的孤儿），确认过“仍被认领”的不吃配额——与导出侧同一口径。
  // 旧写法在这里会把配额花在“翻了一页全是认领”上，于是后面的孤儿永远扫不到，
  // 报告却说“没孤儿”：那是把谎报写进了护栏。
  let worked = 0;
  for (let i = 0; i < rows.length; i++) {
    // 两条护栏都在循环顶部查（写在末尾会被 continue 跳过，导出侧栽过）。
    if (worked >= deps.maxFiles || now() - startedAt >= deps.timeBudgetMs) {
      report.capped = true;
      report.remaining = rows.length - i;
      break;
    }
    const { path, entry: e } = rows[i]!;
    report.scanned++;
    if (path.length === 0) { report.failed++; worked++; continue; }
    if (claimed.has(path)) { report.claimed++; continue; }
    report.orphans++;

    if (deps.dryRun) {
      // 干跑里“报出一个孤儿”就是本轮将要做的一个动作，所以它吃配额。
      worked++;
      sample(path, 'orphan');
      continue;
    }
    // 账本说有文件、盘上没有：那是“文件缺失”，对账已经在报了，这里不重复处理，
    // 也**不删账本条目**（删了就把“人把文件移走了”这个事实一起抹掉）。
    if ((await stat(path).catch(() => undefined)) === undefined) {
      report.missing++;
      continue;
    }
    const side = e.root === homeRoot ? 'home' : 'ws';
    const dest = safeJoin(archiveDir, `${side}/${e.relPath}`);
    if (dest === undefined) {
      // 账本被人手工编辑过（relPath 越界）：宁可不动，也不要借这道手续把文件写到目录外。
      report.failed++;
      worked++;
      sample(path, 'unsafe-relPath');
      logger?.warn(`[memory] 孤儿投射跳过（账本 relPath 越界）: ${path} → ${e.relPath}`);
      continue;
    }
    try {
      await mkdir(dirname(dest), { recursive: true });
      await rename(path, await freeSlot(dest));
      ledger.delete(path);
      report.moved++;
      worked++;
      sample(path, 'moved');
    } catch (err) {
      report.failed++;
      worked++;
      sample(path, 'failed');
      logger?.warn(`[memory] 孤儿投射搬家失败: ${path} - ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!deps.dryRun && (report.moved > 0 || report.failed > 0)) report.dir = archiveDir;
  await ledger.flush();
  return report;
}

/**
 * 目标位已被占用时加数字尾巴。
 *
 * 正常不会撞（每次跑都用新的批次目录），但账本里可能有两条指向同一 relPath 的不同绝对路径
 * （不同 workspace 根），落进同一个 `ws/<类型>/<名>` 就会叠。叠了也不能覆盖——
 * 那些文件是彼此不同的历史版本。
 */
async function freeSlot(dest: string): Promise<string> {
  if ((await stat(dest).catch(() => undefined)) === undefined) return dest;
  for (let n = 2; n <= 999; n++) {
    const candidate = `${dest}.${n}`;
    if ((await stat(candidate).catch(() => undefined)) === undefined) return candidate;
  }
  return `${dest}.${Date.now()}`;
}
