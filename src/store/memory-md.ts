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
import { normalize } from 'node:path';
import { normText } from '../memport/format.js';
import { deriveName } from '../util/md-name.js';
import { sanitizeFilename } from './scenes.js';
import type { MemoryRecord } from '../types.js';

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
export function renderRecord(r: MemoryRecord): { relPath: string; text: string } {
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
