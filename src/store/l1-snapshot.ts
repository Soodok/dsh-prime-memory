/**
 * L1 全库快照与恢复路径(task_8c-1)——破坏性重建的**准入条件**。
 *
 * ## 为什么单独立项
 * `MemoryDb.clearL1()`(`store/sqlite.ts:1046-1069`)是**不可逆**的。它实际销毁的
 * 不止 `l1_records`:还含 `l1_fts`、`l1_vec`(DROP + 重建)与**图谱表族**
 * (`graphStore.resetAll()`)。测试与实机都可能跑在真实库上——**没有恢复路径就
 * 不允许动 `rebuild.ts`**,所以快照不是"附带产物",是前置。
 *
 * ## 代码事实(纠正计划里的旧表述)
 * 计划里写的是"清空 L1 三表(`l1_records` / `l1_receipts` / `conflict_pending`)"。
 * **读 `clearL1()` 的函数体**(`store/sqlite.ts:1046-1069`)得到的结论不是这样:它
 * 只 `DELETE FROM l1_records` + `l1_fts`,再加 `graphStore.resetAll()` 与 `l1_vec`
 * 的 DROP + 重建——**SQL 里没有 receipts 与 conflict_pending**。故本模块按**实际
 * 销毁面**分级:
 * - `l1_records`:**全量可恢复**(丢的就是它)
 * - `l1_receipts` / `conflict_pending`:快照**内容与哈希**。按当前代码不被清,故不
 *   需要恢复;快照它们的意义是"将来谁改了 `clearL1()` 的销毁面,这里能立刻看出来",
 *   同时给运维一份拷贝
 * - `l1_vec`:**不落快照**。它是 `l1_records` 的派生投影,体积大且可重算;只记行数
 *
 * > 口径说明:以上是**读代码**结论(附行号),不是运行时实测;若要把它变成实测,
 * > 需要构造 receipts / conflict_pending 行后跑一次 `clearL1()` 再比对——那需要
 * > 这两个表各自的写入入口,归其所有者,不在本模块范围内。
 *
 * ## 恢复为什么幂等
 * 恢复走既有 `upsertL1`(按 id upsert),**不是 INSERT**。所以恢复两遍与一遍等价,
 * 中断后重跑也安全。
 *
 * ## 红线:恢复必须保住锚点
 * 锚点在 `metadata_json` 的保留键 `dsh_source_anchors` 里(task_31)。记录过一遍
 * JSON 往返再 upsert,**锚点必须原样还在**——否则恢复出来的记忆再也无法取证,
 * 等于把证据链悄悄拆了。这条有专门用例。
 */
import { createHash } from 'node:crypto';
import { moveProjectionFiles, writeArchiveMarkdown, type ArchiveFileOutcome, type FilesByRecord } from './memory-md-archive.js';
import { readdir } from 'node:fs/promises';
import { atomicWriteJson, readJsonStrict } from '../util/io.js';
import type { MemoryLogger, MemoryRecord } from '../types.js';
import type { ConflictPair } from './conflicts.js';

export const SNAPSHOT_VERSION = 1;

/** 快照里的一节:行数 + 内容哈希。哈希是"内容有没有变"的判据,行数看不出来。 */
export interface SnapshotSection {
  count: number
  hash: string
}

/** 快照清单(可追溯:什么时候、为什么、各节多大)。 */
export interface L1SnapshotManifest {
  version: 1
  createdAt: string
  /** 为什么建这份快照(如 `pre-rebuild`),便于事后定位。 */
  reason: string
  sections: {
    records: SnapshotSection
    receipts: SnapshotSection
    conflicts: SnapshotSection
  }
  /** `l1_vec` 行数(只记数:它是派生投影,可重算,不落快照)。 */
  vecCount: number
}

/** 快照目录名:`l1-<时间戳>-<原因>`。**时间戳在前**,目录自然按时间排序。 */
export function snapshotDirName(createdAt: Date, reason: string): string {
  const stamp = createdAt.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const slug = reason.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'snapshot';
  return `l1-${stamp}-${slug}`;
}

/** 快照目录的绝对路径(与既有 `pendingPathFor` / `reconcileStatePathFor` 同风格)。 */
export function snapshotPathFor(dataDir: string, createdAt: Date, reason: string): string {
  return `${dataDir.replace(/[\\/]+$/, '')}/snapshots/${snapshotDirName(createdAt, reason)}`;
}

/** 快照的**存放根**(所有 `snapshotPathFor` 产物都在它下面)。 */
export function snapshotsRootFor(dataDir: string): string {
  return `${dataDir.replace(/[\\/]+$/, '')}/snapshots`;
}

/** 目录路径 → 目录名(与 `snapshotDirFor` 互为逆运算;兼容 `/` 与 `\`)。 */
export function snapshotNameOf(dir: string): string {
  return dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
}

/**
 * 目录名是否是可寻址的快照名。
 *
 * **只接受"名字",不接受路径**——这是恢复入口的第一道门。若允许调用方传路径,
 * 恢复就变成了"把任意目录里的 JSON 灌进记忆库",而这条 RPC 的信任级别只到
 * "本机同用户",不该顺带获得读任意目录并把内容写进检索库的能力。
 * 故:长度受限、必须带 `l1-` 前缀(与 `snapshotDirName` 的产物一致)、
 * 且不含路径分隔符与 `..`。
 */
export function isSnapshotName(name: string): boolean {
  if (typeof name !== 'string') return false;
  const n = name.trim();
  if (n.length === 0 || n.length > 200) return false;
  if (!n.startsWith('l1-')) return false;
  if (n.includes('/') || n.includes('\\') || n.includes('..')) return false;
  return true;
}

/** 名字 → 绝对路径(仅当名字合法;否则返回 `undefined`,由调用方拒绝)。 */
export function snapshotDirFor(dataDir: string, name: string): string | undefined {
  return isSnapshotName(name) ? `${snapshotsRootFor(dataDir)}/${name.trim()}` : undefined;
}

/** 一份可用快照的摘要(面板 / 工具选哪份来恢复)。 */
export interface SnapshotSummary {
  /** 目录名(恢复时传它,不传路径)。 */
  name: string
  dir: string
  createdAt: string
  /** 建这份快照的原因(如 `cleanup-retired` / `pre-rebuild`)。 */
  reason: string
  records: number
  receipts: number
  conflicts: number
  /** `l1_vec` 行数(派生投影,只记数)。 */
  vecCount: number
}

/**
 * 列出可用快照(按时间**倒序**:最新的在前)。
 *
 * 只认**带合法清单**的目录:清单缺失或版本不符的目录不算快照(半截写入的产物
 * 不能出现在"选一份来恢复"的列表里,否则人会选中一份根本恢复不了的东西)。
 * 目录不存在**不抛**,返回空列表——"还没建过快照"是部署状态,不是调用错误。
 */
export async function listSnapshots(
  dataDir: string,
  opts: { limit?: number; logger?: MemoryLogger } = {},
): Promise<{ items: SnapshotSummary[]; total: number }> {
  const root = snapshotsRootFor(dataDir);
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return { items: [], total: 0 };
  }
  // 目录名里时间戳在前(`l1-<时间戳>-<原因>`),故字典序倒序即时间倒序。
  names.sort((a, b) => b.localeCompare(a));
  const items: SnapshotSummary[] = [];
  for (const name of names) {
    if (!isSnapshotName(name)) continue;
    const dir = `${root}/${name}`;
    let manifest: L1SnapshotManifest | undefined;
    try {
      manifest = await readSnapshotManifest(dir);
    } catch (err) {
      // 单个快照清单损坏不该让整个列表拿不到:跳过它,但**必须留诊断**
      // (旧实现把损坏当"没有清单"静默略过,用户永远不知道坏了一份)
      opts.logger?.warn(
        `[memory] 快照清单损坏,已从列表中排除: ${dir} — ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (manifest === undefined) continue;
    items.push({
      name,
      dir,
      createdAt: manifest.createdAt,
      reason: manifest.reason,
      records: manifest.sections.records.count,
      receipts: manifest.sections.receipts.count,
      conflicts: manifest.sections.conflicts.count,
      vecCount: manifest.vecCount,
    });
  }
  const raw = Math.floor(Number(opts.limit));
  const limit = Number.isFinite(raw) && raw > 0 ? raw : items.length;
  return { items: items.slice(0, limit), total: items.length };
}

/** 记录数组的规范序列化:键序固定 + 按 id 排序,保证**同一内容恒得同一哈希**。 */
function canonicalRecords(records: readonly MemoryRecord[]): string {
  return JSON.stringify(
    records
      .map((r) => ({
        id: r.id,
        content: r.content,
        type: r.type,
        priority: r.priority,
        scene_name: r.scene_name,
        timestamps: r.timestamps,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        version: r.version,
        metadata: r.metadata ?? {},
        sessionId: r.sessionId,
        family: r.family,
        // 时间演进字段(R3)也进哈希:它们改了同样是"静默改写",必须被 verify 抓到
        validFrom: r.validFrom,
        validTo: r.validTo,
        persistence: r.persistence,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

/** 稳定内容哈希(与 `canonicalRecords` 配套:同内容恒同哈希)。 */
export function hashRecords(records: readonly MemoryRecord[]): string {
  return createHash('sha1').update(canonicalRecords(records), 'utf8').digest('hex');
}

/** 任意对象的内容哈希(用于 receipts / conflicts 这类外来形状)。 */
export function hashJson(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value), 'utf8').digest('hex');
}

/** `MemoryDb` 里本模块用到的最小面(便于单测注入)。 */
export interface SnapshotDbLike {
  listL1: (opts: { limit: number; offset: number }) => { items: readonly MemoryRecord[]; total: number }
  countReceipts: (opts: Record<string, never>) => number
  listReceipts: (opts: { limit: number }) => readonly unknown[]
  countConflictPendingUnresolved: () => number
  listConflictPending: (opts?: { limit?: number }) => readonly ConflictPair[]
  countL1Vec: () => number
  upsertL1: (record: MemoryRecord, embedding?: Float32Array) => boolean
}

const PAGE = 500;

/** 分页取全量 L1(一次 500,避免大库一次性拉爆内存)。 */
export function listAllL1(db: SnapshotDbLike, hardLimit = 100_000): MemoryRecord[] {
  const out: MemoryRecord[] = [];
  for (let offset = 0; offset < hardLimit; offset += PAGE) {
    const page = db.listL1({ limit: PAGE, offset });
    out.push(...page.items);
    if (page.items.length < PAGE) break;
  }
  return out;
}

export interface CreateSnapshotResult {
  dir: string
  /** 目录名——`snapshot-restore` 的寻址口径(调用方不必自己切路径)。 */
  name: string
  manifest: L1SnapshotManifest
  records: readonly MemoryRecord[]
}

/**
 * 建快照。**在任何清空动作之前调用。**
 *
 * @param db - 记忆库。
 * @param dir - 快照目录(调用方用 `snapshotPathFor` 生成)。
 * @param reason - 建快照的原因(写进清单,可追溯)。
 * @param now - 注入时钟(单测用)。
 */
/**
 * 冻结历史输入的**列投影**(task_2.8)。
 *
 * 为何需要它:`conflict_pending` 在 Phase 2/3 会新增列(`reviewed_at` / `deferred_at` /
 * `defer_count`,以及 Phase 3 的 `conflict_type` / `claim_key`)。而快照 manifest 里的
 * `sections.conflicts.hash` 是 `hashJson(listConflictPending())`——**投影一扩,哈希输入就变**,
 * 于是**升级前写下的旧快照会永久失配**,`exportThenPurge` 每次都中止在"内容与快照不一致"。
 *
 * 判据(第 3 轮复查 R3-N1,**必须逐字段复刻升级前 `toConflictPair` 的输出**):
 * 7 字段、**camelCase**、固定键序
 * `pairId → runId → winnerId → loserId → createdAt → resolvedAt → resolution`,
 * 仅剔除新增列。**不是**"另挑参与语义的列"——兼容性要求的是**冻结旧输入**:
 * 漏 `runId`、或改成 snake_case,都会让新旧哈希不等,于是
 * 「旧快照仍通过」这件事**不可达**。
 *
 * 机械护栏:`tests/l1-snapshot.test.ts` 的 `GOLDEN_CONFLICTS_HASH`(取自升级前实跑),
 * 且该用例做过反向验证(漏 `runId` / 改 snake_case ⇒ 必红)。
 */
export function projectConflictsForHash(rows: readonly ConflictPair[]): Array<Record<string, unknown>> {
  return rows.map(({ pairId, runId, winnerId, loserId, createdAt, resolvedAt, resolution }) => ({
    pairId,
    runId,
    winnerId,
    loserId,
    createdAt,
    resolvedAt,
    resolution,
  }));
}

export async function createL1Snapshot(
  db: SnapshotDbLike,
  dir: string,
  reason: string,
  now: Date = new Date(),
): Promise<CreateSnapshotResult> {
  const records = listAllL1(db);
  const receipts = db.listReceipts({ limit: 100_000 });
  const conflicts = db.listConflictPending({ limit: 100_000 });
  const manifest: L1SnapshotManifest = {
    version: SNAPSHOT_VERSION,
    createdAt: now.toISOString(),
    reason,
    sections: {
      records: { count: records.length, hash: hashRecords(records) },
      receipts: { count: receipts.length, hash: hashJson(receipts) },
      conflicts: { count: conflicts.length, hash: hashJson(projectConflictsForHash(conflicts)) },
    },
    vecCount: db.countL1Vec(),
  };
  // 先写正文再写清单:清单存在即代表正文完整(反过来的话,清单会指向半截快照)
  await atomicWriteJson(`${dir}/l1-records.json`, records);
  await atomicWriteJson(`${dir}/l1-receipts.json`, receipts);
  await atomicWriteJson(`${dir}/l1-conflicts.json`, conflicts);
  await atomicWriteJson(`${dir}/manifest.json`, manifest);
  return { dir, name: snapshotNameOf(dir), manifest, records };
}

/**
 * 读快照清单。
 *
 * **读侧分类**(文件层加固 T2.7):
 * - 缺失 / 版本不符 → `undefined`(沿用既有"这份快照不可用"的语义);
 * - **损坏 / 不可读 → 抛错**:旧实现把损坏也压成 `undefined`,于是"清单坏了"和
 *   "没有清单"在调用方眼里一样——恢复时会选中一个半截快照却报 0 条成功。
 */
export async function readSnapshotManifest(dir: string): Promise<L1SnapshotManifest | undefined> {
  const r = await readJsonStrict<Partial<L1SnapshotManifest>>(`${dir}/manifest.json`, {
    expectedVersion: SNAPSHOT_VERSION,
  });
  if (r.ok) return r.value as L1SnapshotManifest;
  if (r.reason === 'missing' || r.reason === 'unknown_version') return undefined;
  throw new Error(
    `快照清单${r.reason === 'corrupt' ? '已损坏' : '不可读'}(${dir})${r.detail ? ` — ${r.detail}` : ''};` +
      `原文件未改动,请人工确认后再恢复`,
  );
}

/**
 * 读回快照里的记录(与 `createL1Snapshot` 的写入格式必须成对)。
 *
 * **损坏不再返回空数组**:空数组会让"记录文件坏了"表现成"这份快照有 0 条记录",
 * 恢复下去就是静默丢数据。缺文件同样抛错——建快照时正文与清单是成对写入的,
 * 只缺其一说明这份快照本身不完整。
 */
export async function readSnapshotRecords(dir: string): Promise<MemoryRecord[]> {
  const r = await readJsonStrict<MemoryRecord[]>(`${dir}/l1-records.json`);
  if (!r.ok) {
    const why = r.reason === 'missing' ? '缺失' : r.reason === 'corrupt' ? '已损坏' : '不可读';
    throw new Error(`快照记录${why}(${dir})${r.detail ? ` — ${r.detail}` : ''}`);
  }
  return Array.isArray(r.value) ? r.value : [];
}

/** 快照与当前库的差异。 */
export interface SnapshotVerification {
  ok: boolean
  diffs: string[]
}

/** 比对快照与当前库(**按内容哈希**,不是按行数)。 */
export async function verifySnapshot(db: SnapshotDbLike, dir: string): Promise<SnapshotVerification> {
  const manifest = await readSnapshotManifest(dir);
  if (manifest === undefined) return { ok: false, diffs: ['快照清单缺失或版本不符'] };
  const now = listAllL1(db);
  const diffs: string[] = [];
  const currentHash = hashRecords(now);
  if (currentHash !== manifest.sections.records.hash) {
    diffs.push(`l1_records 内容不一致:快照 ${manifest.sections.records.hash.slice(0, 8)} / 当前 ${currentHash.slice(0, 8)}(快照 ${manifest.sections.records.count} 条,当前 ${now.length} 条)`);
  }
  const receipts = hashJson(db.listReceipts({ limit: 100_000 }));
  if (receipts !== manifest.sections.receipts.hash) diffs.push('l1_receipts 内容与快照不一致');
  // **与建快照侧同投影**(task_2.8,第 2 轮复查 R-N1):这里只改一处会让
  // "建快照存整对象哈希、校验算另一种投影"变成**永久失配**,比原问题更糟。
  const conflicts = hashJson(projectConflictsForHash(db.listConflictPending({ limit: 100_000 })));
  if (conflicts !== manifest.sections.conflicts.hash) diffs.push('conflict_pending 内容与快照不一致');
  return { ok: diffs.length === 0, diffs };
}

export interface RestoreResult {
  /** 快照里的记录总数(按 `ids` 过滤**之前**)。 */
  inSnapshot: number
  /** 本次实际要恢复的条数(过滤**之后**)。 */
  targets: number
  restored: number
  failed: number
  /** 成功补上向量的条数(未提供 `vectorize` 时恒为 0)。 */
  vectorsWritten: number
  /** 请求了但快照里没有的 id(仅传 `ids` 时可能非空)。 */
  notFound: string[]
}

export interface RestoreOptions {
  /** 日志出口(缺省静默)。 */
  logger?: { info: (m: string) => void; warn: (m: string) => void }
  /** 只恢复这些 id;省略 = 快照内全部。 */
  ids?: readonly string[]
  /**
   * 可选向量补算钩子。
   *
   * 为何是**注入的函数**而不是直接 import 嵌入模块:快照模块刻意不依赖嵌入栈
   * (见模块头——`l1_vec` 是派生投影,不落快照)。把向量能力做成参数,单向依赖
   * 就保住了:快照模块提供"从 JSON 回到检索库"的事实,调用方提供"怎么算向量"。
   * 实现方在嵌入不可用时应返回 `undefined` 而**不是抛**——见 `restore` 的同款理由。
   */
  vectorize?: (records: readonly MemoryRecord[]) => Promise<readonly (Float32Array | undefined)[]>
}

/** 干跑结论:这份快照恢复下去**会发生什么**(不写库)。 */
export interface SnapshotRestorePlan {
  name: string
  /** 解析出的绝对路径;名字非法或清单缺失时为空串。 */
  dir: string
  /** 这个名字是否指向一份**真实存在且清单合法**的快照。 */
  found: boolean
  inSnapshot: number
  /** 本次实际要恢复的条数(按 `ids` 过滤后)。 */
  targets: number
  /** 其中当前**不在库**的条数——这才是真正被找回的条数。 */
  missing: number
  /**
   * 目标里**仍处于退场态**的 id。
   *
   * 为什么这个字段是必需的:`cleanup-retired` 只清理**已退场**记录,而快照拍在删除
   * **之前** ——所以清理快照能找回的每一条都带着退场标记。于是"回到主表"≠"回到
   * 检索面":记录行在,但仍不出现在召回里,还要 `records-restore` 才放得回去。
   * 不报这个,调用方会以为恢复完了、而记忆其实还是不可见的。
   */
  stillRetired: string[]
  notFound: string[]
}

/** 按 id 过滤快照记录,并报出请求了却没找到的 id(人工恢复要能看到"没找到哪条")。 */
export function selectSnapshotTargets(
  records: readonly MemoryRecord[],
  ids?: readonly string[],
): { targets: MemoryRecord[]; notFound: string[] } {
  if (!ids || ids.length === 0) return { targets: [...records], notFound: [] };
  const wanted = new Set(ids);
  const targets = records.filter((r) => typeof r?.id === 'string' && wanted.has(r.id));
  const found = new Set(targets.map((r) => r.id));
  return { targets, notFound: [...wanted].filter((id) => !found.has(id)) };
}

/**
 * 从快照恢复 L1。
 *
 * **幂等**:走 `upsertL1`(按 id upsert),恢复两遍与一遍等价,中断后重跑安全。
 * 只恢复 `l1_records`——receipts / conflicts 今天不被 `clearL1()` 销毁(见模块头),
 * 且它们的写入口不归本模块所有(单一所有者)。
 *
 * **向量一次算完再逐条写**:`vectorize` 收的是整批记录,而不是每条回调一次——
 * 否则恢复 787 条就是 787 次嵌入往返。
 */
export async function restoreL1Snapshot(
  db: SnapshotDbLike,
  dir: string,
  opts: RestoreOptions = {},
): Promise<RestoreResult> {
  const { logger, ids, vectorize } = opts;
  const all = await readSnapshotRecords(dir);
  const { targets, notFound } = selectSnapshotTargets(all, ids);
  let vectors: readonly (Float32Array | undefined)[] = [];
  if (vectorize && targets.length > 0) {
    try {
      vectors = await vectorize(targets);
    } catch (err) {
      // 向量补算失败**不中止恢复**:记录先回到检索面(关键词仍可召回)比"一条都没恢复"
      // 严重程度低得多。缺失的向量留给后续 `embedding-reindex`。
      logger?.warn(`[memory] 快照恢复:向量补算失败,先回关键词检索面(日后重建可补齐): ${err instanceof Error ? err.message : String(err)}`);
      vectors = [];
    }
  }
  let restored = 0;
  let failed = 0;
  let vectorsWritten = 0;
  for (let i = 0; i < targets.length; i++) {
    const record = targets[i];
    if (typeof record?.id !== 'string' || typeof record.content !== 'string') {
      failed += 1;
      continue;
    }
    const vec = vectors[i];
    if (vec !== undefined) vectorsWritten += 1;
    if (db.upsertL1(record, vec)) restored += 1;
    else failed += 1;
  }
  if (failed > 0) logger?.warn(`[memory] 快照恢复:${restored} 条成功,${failed} 条失败`);
  else logger?.info(`[memory] 快照恢复:${restored} 条`);
  return { inSnapshot: all.length, targets: targets.length, restored, failed, vectorsWritten, notFound };
}

/**
 * 清空前必须调用的守门函数:先建快照,再允许清空。
 *
 * 抽出来是为了让"先快照后清空"成为**调用方无法绕过的一步**,而不是一段注释。
 *
 * @returns 快照目录与清单;调用方拿到后才可以继续清空。
 */
export async function snapshotBeforeClear(
  db: SnapshotDbLike,
  dataDir: string,
  reason: string,
  now: Date = new Date(),
): Promise<CreateSnapshotResult> {
  const dir = snapshotPathFor(dataDir, now, reason);
  return createL1Snapshot(db, dir, reason, now);
}

/** 物理清理面(比快照面多一个删除能力)。 */
export interface PurgeDbLike extends SnapshotDbLike {
  deleteL1Batch: (ids: string[]) => number
}

export interface ExportThenPurgeResult {
  /** 清理是否真的执行了。 */
  ok: boolean
  /** 门禁未通过而**中止**(`purged` 必为 0)。 */
  aborted: boolean
  /** 快照目录(中止时也给,便于人工查看失败现场)。 */
  dir: string
  /** 快照**目录名**(供 `snapshot-restore` 直接寻址;中止且未建快照时为空串)。 */
  name: string
  purged: number
  /** 校验差异(仅 aborted 时非空)。 */
  diffs: string[]
  /**
   * 本批之外发生漂移的记录数(仅计数、**不中止**)。
   *
   * 旧实现拿整库哈希当门禁：并发蒸馏/另一处写入改过任何一条与本批无关的记录，
   * 本次清理就会永远中止（而它要删的那批逐字未动、完全可恢复）。漂移信息仍要报，
   * 但它不是删除本批的安全障碍。
   */
  otherChanged: number
  /** 归档正文路径（未写 = 空串）。 */
  archiveMd: string
  /** 投射文件搬运计数（N12）。 */
  files: ArchiveFileOutcome
}

/** 清理时的可选动作（P3）。 */
export interface PurgeOptions {
  /**
   * 投射文件映射（由 `collectProjectionFiles` 产出）。
   *
   * **不传 = 只删库，行为与改动前逐字一致**——投射面默认关，归档搬运不能变成它的前置条
   * 件。传了就在全部门禁通过后把文件搬进快照目录，失败只 warn。
   */
  files?: FilesByRecord
  /** 是否写 `retired.md` 归档正文（默认 true）。 */
  archiveMd?: boolean
}

/**
 * **先导出,后清理**——把这句话变成调用方绕不过去的一步。
 *
 * 顺序与理由:
 * ① 建快照(写正文 + 清单);**写盘失败即中止**,绝不"先删了再说";
 * ② `verifySnapshot` 按**内容哈希**比对快照与当前库。不一致说明两者之间有别的写入
 *    发生(并发蒸馏、另一次清理),此时快照**不代表**将要被删的那批数据 → 中止;
 * ③ 只有 ①② 都通过,才 `deleteL1Batch` 做物理删除。
 *
 * 为什么值得这么严:物理删除是本插件唯一**不可逆**的动作。软删(退场)可以恢复,
 * 而清理一旦没有可信的导出物,就只剩 `records/*.jsonl` 事实源这一条后路,
 * 且那条路只覆盖 L1 记录、不覆盖 receipts/conflicts 的当时快照。
 */
export async function exportThenPurge(
  db: PurgeDbLike,
  dataDir: string,
  ids: readonly string[],
  reason: string,
  logger?: { info: (m: string) => void; warn: (m: string) => void },
  now: Date = new Date(),
  opts: PurgeOptions = {},
): Promise<ExportThenPurgeResult> {
  const empty: ArchiveFileOutcome = { moved: 0, failed: 0, absent: 0 };
  if (ids.length === 0) return { ok: true, aborted: false, dir: '', name: '', purged: 0, diffs: [], otherChanged: 0, archiveMd: '', files: empty };

  let dir = '';
  let name = '';
  try {
    const snap = await snapshotBeforeClear(db, dataDir, reason, now);
    dir = snap.dir;
    name = snap.name;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.warn(`[memory] 清理中止:快照写入失败(${msg})——未删除任何记录`);
    return { ok: false, aborted: true, dir, name, purged: 0, diffs: [`快照写入失败:${msg}`], otherChanged: 0, archiveMd: '', files: empty };
  }

  // 门禁第二半——**批次级投影**。不再拿整库哈希当门禁：那会把“本批逐字未动、但库里有
  // 别的东西被并发改过”误判成不安全，而事实恰好相反——要删的那批在快照里完整可信，
  // 删错了能原样回灌。整库漂移仍计数（它是要给人看的信息），但它不拦住删除。
  let subset: MemoryRecord[]; // try 内先赋值后读，初始空数组从未被用
  let otherChanged = 0;
  try {
    const want = new Set(ids);
    const snapAll = await readSnapshotRecords(dir);
    subset = snapAll.filter((r) => want.has(r.id));
    const current = listAllL1(db);
    const curSubset = current.filter((r) => want.has(r.id));
    const snapRest = snapAll.filter((r) => !want.has(r.id));
    const curRest = current.filter((r) => !want.has(r.id));
    otherChanged = hashRecords(snapRest) === hashRecords(curRest) ? 0 : curRest.length;
    const diffs: string[] = [];
    if (subset.length !== want.size) diffs.push(`快照里本批只有 ${subset.length}/${want.size} 条`);
    if (hashRecords(subset) !== hashRecords(curSubset)) diffs.push('本批内容与快照不一致(快照后这批被改过)');
    if (diffs.length > 0) {
      logger?.warn(`[memory] 清理中止:批次校验未通过(${diffs.join(';')})——未删除任何记录`);
      return { ok: false, aborted: true, dir, name, purged: 0, diffs, otherChanged, archiveMd: '', files: empty };
    }
    if (otherChanged > 0) logger?.warn(`[memory] 清理放行:本批之外有 ${otherChanged} 条处于差异状态(不影响本批可恢复性)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.warn(`[memory] 清理中止:快照读回失败(${msg})——未删除任何记录`);
    return { ok: false, aborted: true, dir, name, purged: 0, diffs: [`快照读回失败:${msg}`], otherChanged, files: empty, archiveMd: '' };
  }

  const purged = db.deleteL1Batch([...ids]);
  logger?.info(`[memory] 已物理清理 ${purged} 条已退场记录(快照:${dir})`);

  // 归档两面：先写给人读的正文，再搬投射文件。两者失败都**不回滚已完成的删除**
  // （不对称的方向特别重要：文件可重生成，库删了不可逆，而快照已经先落盘了）。
  let archiveMd = '';
  if (opts.archiveMd !== false) {
    try {
      archiveMd = await writeArchiveMarkdown(dir, subset, { reason, at: now });
    } catch (err) {
      logger?.warn(`[memory] 归档正文写入失败(记录已删，快照仍在): ${dir} - ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const files = opts.files === undefined
    ? empty
    : await moveProjectionFiles(dir, subset, opts.files, logger).catch((err: unknown) => {
        logger?.warn(`[memory] 归档搬运异常(文件留在原地): ${err instanceof Error ? err.message : String(err)}`);
        return empty;
      });
  return { ok: true, aborted: false, dir, name, purged, diffs: [], otherChanged, archiveMd, files };
}
