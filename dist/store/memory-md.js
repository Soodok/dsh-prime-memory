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
import { existsSync } from 'node:fs';
import { isAbsolute, normalize, resolve, sep } from 'node:path';
import { normText } from '../memport/format.js';
import { memoryTypeDirs, UNCLASSIFIED_DIR } from '../memory-types.js';
import { deriveName } from '../util/md-name.js';
import { normalizeContentMd } from '../util/md-normalize.js';
import { sanitizeFilename } from './scenes.js';
import { readSupersedeMarker } from './supersede.js';
/**
 * 允许当目录名的 type 值（pm-name-distill task_1.3：由词表单一真源派生，不再手抄）。
 *
 * 手抄的危害很具体：换词表不改这一处，新词表里的十余类会**静默落进兜底桶**——
 * 不报错、不同步失败，只少目录树。
 */
export const MEMORY_TYPE_DIRS = memoryTypeDirs();
/**
 * 不在词表的 type 落到这个目录（P4.1 的**默认类**）。
 *
 * 它是**目录层的投影**，不是库内事实：记录自己的 `type` 原值照旧写进 frontmatter，
 * 也绝不回填到 `rowToRecord`/upsert/metadata（F5 红线）。之所以不直接归进某个 `work_*`：
 * 那会把这批无类记录的 `family` 挑到 work 侧，而 family 决定共享面——等于静默改了可见性。
 */
export const UNSORTED_DIR = UNCLASSIFIED_DIR;
/** frontmatter 允许出现的键（用例断言键集**恰等于**它，防检索轴泄漏进文件）。 */
export const FRONTMATTER_KEYS = [
    'name', 'type', 'priority', 'createdAt', 'updatedAt', 'usageScenario', 'extKey', 'id', 'hash', 'retired',
];
/** 内容指纹长度（12 hex ≈ 48 bit；账本只用来判"变没变"，不当身份用）。 */
export const DIGEST_HEX = 12;
/** 失效后缀（N11）：`x.memory.md` → `x.memory.md.disable`。用户定名，取代原设计的 `.outdated`。 */
export const DISABLE_SUFFIX = '.disable';
/** workspace 优先时的子目录（N10）：`<workspace>/.agents/memory/…`。 */
export const WORKSPACE_SUBDIR = ['.agents', 'memory'];
/**
 * 解析单根（无 workspace 归属的记录落这里）。
 *
 * 给了 `cfgRoot` 就用它（必须绝对路径且不含 `..`），否则默认 `<dataDir>/memories`。
 * **不合法只回退默认并 warn，绝不抛错**：投射是旁路，旁路配置写错不能弄挂记忆本体。
 */
export function resolveMemoriesRoot(cfgRoot, dataDir, logger) {
    const raw = (cfgRoot ?? '').trim();
    if (raw.length === 0)
        return resolve(dataDir, 'memories');
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
export function safeJoin(root, relPath) {
    if (relPath.length === 0 || isAbsolute(relPath))
        return undefined;
    const parent = resolve(root);
    const target = resolve(parent, relPath);
    if (target === parent)
        return undefined;
    // 前缀判定必须带分隔符结尾，否则 `/a/memoriesX` 会被 `/a/memories` 误认包含。
    const withSep = parent.endsWith('/') || parent.endsWith('\\') ? parent : `${parent}${sep}`;
    return target.startsWith(withSep) ? target : undefined;
}
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
export function targetFor(r, cfgRoot, dataDir, logger) {
    const { relPath } = renderRecord(r);
    const ws = (r.workspaceId ?? '').trim();
    if (ws.length > 0 && isAbsolute(ws) && !ws.includes('..')) {
        // 护栏（默认开，不给开关）：workspace 目录不存在时不往它下面写。worktree 被删、
        // 盘符变了、或 `workspace_id` 是脏值时，写盘会凭空造出一棵
        // `<已消失的项目>/.agents/memory/` 孤儿树——那比落回单根难查得多（单根里的文件
        // 仍然可见、可导出、可同步；孤儿树没人知道它属于哪个项目）。
        // 判据用 **workspace 根本身**而不是投射根：后者不存在是常态（首次导出会 mkdir）。
        if (existsSync(ws)) {
            const root = resolve(ws, ...WORKSPACE_SUBDIR);
            return { root, relPath, absPath: safeJoin(root, relPath), inWorkspace: true };
        }
        warnMissingWorkspace(logger, ws);
    }
    const root = resolveMemoriesRoot(cfgRoot, dataDir, logger);
    return { root, relPath, absPath: safeJoin(root, relPath), inWorkspace: false };
}
/**
 * 已提醒过的缺失 workspace（同一个根只 warn 一次）。
 *
 * 不设上限就会在 1280 条记录上刷屏；集子封到 64 个就不再记录新条目（宁可漏提醒，
 * 也不让一个诊断集无限吃内存）。放在 `targetFor` 之后：函数声明提升，`const` 集子在
 * 模块求值后才被调用，所以顺序不影响可用性——影响的是文档块跟谁。
 */
const warnedMissingWs = new Set();
function warnMissingWorkspace(logger, ws) {
    if (logger === undefined)
        return;
    if (warnedMissingWs.has(ws))
        return;
    if (warnedMissingWs.size < 64)
        warnedMissingWs.add(ws);
    logger.warn(`[memory] workspace 目录不存在，该条投射落点退回单根: ${ws}`);
}
/**
 * 退场判据：与库侧同口径（门1 解耦后**只认 marker**，与 `supersede.isRetired`/
 * `retiredL1Sql` 一致；valid_to 回归现实有效期，不再拿它判退场）。
 *
 * 为什么住在本文件：导出（要不要把文件放回非退场路径）与失效联动（后缀该不该带）
 * 两侧都得用同一个判据，否则“列表说它退了、文件却没后缀”会回来。放 `memory-md-disable.ts`
 * 会让 `memory-md-export.ts` 反向 import 它形成循环（那边已经 import 这边）。
 */
export function isRetiredRecord(r) {
    return readSupersedeMarker(r.metadata) !== undefined;
}
/**
 * 投射文件的失效路径：`x.memory.md` → `x.memory.md.disable`。
 * 已带后缀的原样返回（幂等靠这个性质，而不是靠调用方记住判重）。
 */
export function disablePathOf(absPath) {
    return absPath.endsWith(DISABLE_SUFFIX) ? absPath : `${absPath}${DISABLE_SUFFIX}`;
}
/**
 * 内容指纹。
 *
 * 刻意**不复用** `memport/format.ts` 的 `contentHash`：那个口径被 TS↔Python 跨实现
 * 金标准锁死（`tests/memport-ts-consistency`），改了就是让两边算出不同的包。这里只
 * 借它的 `normText`（NFKC + 换行归一），口径独立、且明确标注为"投射账本专用"。
 */
export function digest(text) {
    return createHash('sha1').update(normText(text), 'utf8').digest('hex').slice(0, DIGEST_HEX);
}
/**
 * 投射文件自带 `hash` 键的**规范口径**（导出写、读入核，两侧都必须走它）。
 *
 * 定义 = `digest(归一后的正文)`：与 `renderRecord` 写进 `hash` 的值、以及读侧拿解析出的
 * `content` 实算的值三处同源。只覆盖正文、不含任何 frontmatter 字段——所以换 id、换文件名、
 * 退场标记都不改变它，它只回答「正文有没有被改过」这一件事。
 *
 * 走 `digest`（内含 NFKC + 空白折叠）而非裸 sha1：CRLF/BOM/尾随空白这类搬运噪声不该触发
 * 假不符（搬文件、换编辑器、git autocrlf 都会引入它们）。
 */
export function contentHash(content) {
    return digest(normalizeContentMd(content));
}
/** 记录内容指纹：正文字段（不含 metadata——轴变了不算内容变）。 */
export function recordDigest(r) {
    return digest(r.content);
}
/**
 * 文件名干：有 `name` 用 `name`；没有则回落 `mem-<id 后 8 位>`。
 *
 * 回落是**必需**的：存量记录 name 恒空（零回填红线），不回落就没法投射第一批。
 * id 每轮新铸，所以回落名不稳定——这正是 P0 要先做 `name` 的原因，注释留在这里
 * 免得后来人以为"回落名也能双向"。
 */
export function fileStemFor(r) {
    const named = (r.name ?? '').length > 0 ? r.name : deriveName(r.content);
    const base = named.length > 0 ? named : `mem-${r.id.slice(-8)}`;
    // 借 sanitizeFilename 的字符/保留名纪律，再剥掉它补的 .md（我们后面统一补）。
    return sanitizeFilename(base).replace(/\.md$/i, '') || `mem-${r.id.slice(-8)}`;
}
/**
 * 一条记录的投射相对路径 `<dir>/<stem>.memory.md`（分隔符恒 `/`）。
 *
 * 单一事实源：`renderRecord` 写盘、`dsh-memory/records-meta` 端点、槽位投影的
 * `refViews.filePath` 都走这里。各自抄一份清洗规则必然漂移——漂移之后「投影给的地址」
 * 和「磁盘上的真文件」对不上，而这三处本来就是给人核对同一个事实用的。
 */
export function relPathFor(r) {
    const dir = MEMORY_TYPE_DIRS.has(r.type) ? r.type : UNSORTED_DIR;
    return `${dir}/${fileStemFor(r)}.memory.md`;
}
/** 把值写成可解析回读的 frontmatter 标量/数组（JSON 编码，转义由它负责）。 */
function fmLine(key, value) {
    return `${key}: ${JSON.stringify(value)}`;
}
/**
 * 渲染一条记录。
 *
 * @param r - L1 记录（含已退场的——退场也要有投影，否则人在文件树里看不到它）。
 * @returns `relPath`（相对投射根，已归一分隔符）与 `text`（全文）。
 */
export function renderRecord(r) {
    const relPath = normalize(relPathFor(r)).replace(/\\/g, '/');
    // frontmatter 的 `name` 必须与文件名干同一值，所以单独再取一次（同一纯函数，不会漂）。
    const stem = fileStemFor(r);
    const scenario = Array.isArray(r.metadata?.dsh_usage_scenario)
        ? (r.metadata?.dsh_usage_scenario).filter((s) => typeof s === 'string')
        : [];
    // 正文只归一一次：`hash` 键与正文行必须落在**同一份正文**上，否则读入侧的
    // 「声明 vs 实算」核对会因两次归一是否完全一致而变得可疑（归一虽幂等，复用同一变量最稳）。
    const body = normalizeContentMd(r.content);
    const lines = ['---'];
    lines.push(fmLine('name', stem));
    lines.push(fmLine('type', r.type));
    lines.push(fmLine('priority', r.priority));
    lines.push(fmLine('createdAt', r.createdAt ? new Date(r.createdAt).toISOString() : ''));
    lines.push(fmLine('updatedAt', r.updatedAt ? new Date(r.updatedAt).toISOString() : ''));
    lines.push(fmLine('usageScenario', scenario));
    lines.push(fmLine('extKey', r.extKey ?? ''));
    lines.push(fmLine('id', r.id));
    // 正文自校验指纹（N13）：写在 frontmatter 里的 `hash`，只覆盖**渲染后的正文**（与下面那行
    // 正文同源）。读入侧据此确认文件未被外部改动/损坏，且**不依赖账本**——文件搬到别的机器、
    // 账本丢失时仍可自证。刻意不含 frontmatter：`id` 会随 merge 重铸（F1），把 id 算进去会让
    // 「换了 id、正文没动」也误报被改。
    lines.push(fmLine('hash', contentHash(r.content)));
    // 退场标记只在真退场时写：不留 `retired: false` 这种噪声键（键集越稳，人越不容易改错）。
    // 判据走本文件的 `isRetiredRecord`（门1 解耦后只认 marker，与库侧同口径）。
    if (isRetiredRecord(r))
        lines.push(fmLine('retired', true));
    lines.push('---', '');
    // 正文过一道版式归一（P4.2）：无结构存量文本出口就是标准形状。归一是**幂等**的，
    // 所以不会把账本 `fileDigest` 每轮推得变一下（不幂等 = 反向同步永远判“文件被改过”）。
    lines.push(body);
    lines.push('');
    return { relPath, text: lines.join('\n') };
}
