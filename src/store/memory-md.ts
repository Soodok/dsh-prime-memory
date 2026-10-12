/**
 * L1 记录 → markdown 投射（P1 / N1）。
 *
 * 三条设计约束，都是被"文件要能双向"逼出来的：
 *
 * 1. **渲染必须是纯函数**：同一个记录永远渲染出同一份字节。否则每次导出都会重写
 *    每个文件，账本里的 `fileDigest` 每轮都变，"文件被人改过"就永远判不出来。
 *    所以文件里**不写导出时刻**、不写任何非记录字段。
 * 2. **只写内容层，不写检索轴**（N6 口径）：`hall`/`tags`/`room*`/`cogHall` 留在库里
 *    ——写进文件就是一份会过期的副本，还会诱导人改它（而改了又不生效）。派生评价
 *    （`maturity`/`usage`/`rating`）同理：它们是算出来的，不是事实。
 * 3. **文件名走 `sanitizeFilename` 那一套**（与 `util/md-name.ts` 同源），type 目录名
 *    走**枚举白名单**（不 sanitize——不在白名单的 type 直接归 `unsorted`，而不是
 *    洗出一个没人认识的新目录）。
 */
import { createHash } from 'node:crypto';
import { isAbsolute, normalize, resolve, sep } from 'node:path';
import { normText } from '../memport/format.js';
import { deriveName } from '../util/md-name.js';
import { sanitizeFilename } from './scenes.js';
import type { MemoryLogger, MemoryRecord } from '../types.js';

/** 允许当目录名的 type 值（与面板 `TYPE_LABELS` 同集合；P4 换类别树时一并改）。 */
export const MEMORY_TYPE_DIRS: ReadonlySet<string> = new Set([
  'persona', 'episodic', 'instruction', 'work_fact', 'work_task', 'work_method', 'work_artifact',
]);

/** 不在白名单的 type 落到这个目录（旧库/异常值不至于写不出文件，也不污染目录树）。 */
export const UNSORTED_DIR = 'unsorted';

/** frontmatter 允许出现的键（用例断言键集**恰等于**它，防检索轴泄漏进文件）。 */
export const FRONTMATTER_KEYS: readonly string[] = [
  'name', 'type', 'priority', 'createdAt', 'updatedAt', 'usageScenario', 'extKey', 'id', 'retired',
];

/** 内容指纹长度（12 hex ≈ 48 bit；账本只用来判"变没变"，不当身份用）。 */
export const DIGEST_HEX = 12;

/** 失效后缀（N11）：`x.memory.md` → `x.memory.md.disable`。用户定名，取代原设计的 `.outdated`。 */
export const DISABLE_SUFFIX = '.disable';

/** workspace 优先时的子目录（N10）：`<workspace>/.agents/memory/…`。 */
export const WORKSPACE_SUBDIR: readonly string[] = ['.agents', 'memory'];

/**
 * 解析单根（无 workspace 归属的记录落这里）。
 *
 * 给了 `cfgRoot` 就用它（必须绝对路径且不含 `..`），否则默认 `<dataDir>/memories`。
 * **不合法只回退默认并 warn，绝不抛错**：投射是旁路，旁路配置写错不能弄挂记忆本体。
 */
export function resolveMemoriesRoot(cfgRoot: string | undefined, dataDir: string, logger?: MemoryLogger): string {
  const raw = (cfgRoot ?? '').trim();
  if (raw.length === 0) return resolve(dataDir, 'memories');
  if (!isAbsolute(raw) || raw.includes('..')) {
    logger?.warn(`[memory] memExport.root 不是无 .. 的绝对路径，回退默认根: ${raw}`);
    return resolve(dataDir, 'memories');
  }
  return resolve(raw);
}

/**
 * 把渲染出的相对路径安全地拼到根下。
 *
 * 越界（绝对路径、`..` 跳出、盘符切换）一律返回 `undefined` 由调用方跳过并 warn——
 * 记录内容是人/模型写的，它可能包含 `../../`，这里必须是结构性挡死而不是"应该不会有"。
 */
export function safeJoin(root: string, relPath: string): string | undefined {
  if (relPath.length === 0 || isAbsolute(relPath)) return undefined;
  const parent = resolve(root);
  const target = resolve(parent, relPath);
  if (target === parent) return undefined;
  // 前缀判定必须带分隔符结尾，否则 `/a/memoriesX` 会被 `/a/memories` 误认包含。
  const withSep = parent.endsWith('/') || parent.endsWith('\\') ? parent : `${parent}${sep}`;
  return target.startsWith(withSep) ? target : undefined;
}

/** 一个记录该落到哪。`absPath` 为 `undefined` = 越界，调用方必须跳过而不是写。 */
export interface MdTarget {
  /** 投射根（workspace 根或单根），绝对路径。 */
  root: string;
  /** 相对根的路径（正斜杠），展示与归档分目录用。 */
  relPath: string;
  /** 绝对路径——**账本键与文件操作都用它**。undefined = 越界。 */
  absPath: string | undefined;
  /** 是否落在 workspace 下（区分两个根，面板与归档路径都要看）。 */
  inWorkspace: boolean;
}

/** 渲染一条记录所需的最小字段集（也是算落点所需的全部）。 */
export type MdRecordInput = Pick<
  MemoryRecord,
  'id' | 'content' | 'type' | 'priority' | 'createdAt' | 'updatedAt' | 'metadata' | 'validTo' | 'extKey' | 'name' | 'workspaceId'
>;

/**
 * 投射落点（N10）：**workspace 优先**。
 *
 * 有 `workspaceId` ⇒ `<workspace>/.agents/memory/<type>/<stem>.memory.md`；
 * 没有 ⇒ 单根（`cfg.memExport.root` 或 `<dataDir>/memories`）。
 *
 * ⚠️ **导出/对账/失效改名/归档四处必须共用本函数**。库里的 `workspace_id` 在 Windows 上是
 * 小写形态（`normalizeWorkspacePath` 会 `.toLowerCase()`），任何一处自己拼路径、或者自己
 * 转一下大小写，就会把“刚写进去的文件”算成另一个账本键 → 对账永远报“文件缺失”。
 * 同理：**不**在这里做 `fs.realpath` 归一——那会让目录创建前后的键漂移，反而造出假缺失；
 * Windows 路径大小写不敏感，同一逻辑路径的两种写法解析到同一个文件，键自洽即可。
 */
export function targetFor(
  r: MdRecordInput,
  cfgRoot: string | undefined,
  dataDir: string,
  logger?: MemoryLogger,
): MdTarget {
  const { relPath } = renderRecord(r);
  const ws = (r.workspaceId ?? '').trim();
  if (ws.length > 0 && isAbsolute(ws) && !ws.includes('..')) {
    const root = resolve(ws, ...WORKSPACE_SUBDIR);
    return { root, relPath, absPath: safeJoin(root, relPath), inWorkspace: true };
  }
  const root = resolveMemoriesRoot(cfgRoot, dataDir, logger);
  return { root, relPath, absPath: safeJoin(root, relPath), inWorkspace: false };
}

/**
 * 投射文件的失效路径：`x.memory.md` → `x.memory.md.disable`。
 * 已带后缀的原样返回（幂等靠这个性质，而不是靠调用方记住判重）。
 */
export function disablePathOf(absPath: string): string {
  return absPath.endsWith(DISABLE_SUFFIX) ? absPath : `${absPath}${DISABLE_SUFFIX}`;
}

/**
 * 内容指纹。
 *
 * 刻意**不复用** `memport/format.ts` 的 `contentHash`：那个口径被 TS↔Python 跨实现
 * 金标准锁死（`tests/memport-ts-consistency`），改了就是让两边算出不同的包。这里只
 * 借它的 `normText`（NFKC + 换行归一），口径独立、且明确标注为"投射账本专用"。
 */
export function digest(text: string): string {
  return createHash('sha1').update(normText(text), 'utf8').digest('hex').slice(0, DIGEST_HEX);
}

/** 记录内容指纹：正文字段（不含 metadata——轴变了不算内容变）。 */
export function recordDigest(r: Pick<MemoryRecord, 'content'>): string {
  return digest(r.content);
}

/**
 * 文件名干：有 `name` 用 `name`；没有则回落 `mem-<id 后 8 位>`。
 *
 * 回落是**必需**的：存量记录 name 恒空（零回填红线），不回落就没法投射第一批。
 * id 每轮新铸，所以回落名不稳定——这正是 P0 要先做 `name` 的原因，注释留在这里
 * 免得后来人以为"回落名也能双向"。
 */
export function fileStemFor(r: Pick<MemoryRecord, 'id' | 'name' | 'content'>): string {
  const named = (r.name ?? '').length > 0 ? r.name! : deriveName(r.content);
  const base = named.length > 0 ? named : `mem-${r.id.slice(-8)}`;
  // 借 sanitizeFilename 的字符/保留名纪律，再剥掉它补的 .md（我们后面统一补）。
  return sanitizeFilename(base).replace(/\.md$/i, '') || `mem-${r.id.slice(-8)}`;
}

/** 把值写成可解析回读的 frontmatter 标量/数组（JSON 编码，转义由它负责）。 */
function fmLine(key: string, value: string | number | boolean | string[]): string {
  return `${key}: ${JSON.stringify(value)}`;
}

/**
 * 渲染一条记录。
 *
 * @param r - L1 记录（含已退场的——退场也要有投影，否则人在文件树里看不到它）。
 * @returns `relPath`（相对投射根，已归一分隔符）与 `text`（全文）。
 */
export function renderRecord(r: MdRecordInput): { relPath: string; text: string } {
  const dir = MEMORY_TYPE_DIRS.has(r.type) ? r.type : UNSORTED_DIR;
  const stem = fileStemFor(r);
  const relPath = normalize(`${dir}/${stem}.memory.md`).replace(/\\/g, '/');
  const scenario = Array.isArray(r.metadata?.dsh_usage_scenario)
    ? (r.metadata?.dsh_usage_scenario as string[]).filter((s) => typeof s === 'string')
    : [];
  const lines: string[] = ['---'];
  lines.push(fmLine('name', stem));
  lines.push(fmLine('type', r.type));
  lines.push(fmLine('priority', r.priority));
  lines.push(fmLine('createdAt', r.createdAt ? new Date(r.createdAt).toISOString() : ''));
  lines.push(fmLine('updatedAt', r.updatedAt ? new Date(r.updatedAt).toISOString() : ''));
  lines.push(fmLine('usageScenario', scenario));
  lines.push(fmLine('extKey', r.extKey ?? ''));
  lines.push(fmLine('id', r.id));
  // 退场标记只在真退场时写：不留 `retired: false` 这种噪声键（键集越稳，人越不容易改错）。
  if (r.validTo !== undefined) lines.push(fmLine('retired', true));
  lines.push('---', '');
  lines.push(r.content.trim());
  lines.push('');
  return { relPath, text: lines.join('\n') };
}
