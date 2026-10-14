/**
 * L1 原子记忆存储(双写架构):
 * - records/YYYY-MM-DD.jsonl:追加式事实源(只增不改,备份/恢复用);
 * - MemoryDb(SQLite):主检索引擎,upsert/delete 只动这里;
 * - 检索三策略:keyword(FTS5 BM25)/ embedding(vec0 余弦)/ hybrid(双路 + RRF k=60)。
 *
 * 去重/合并的更新记录走 upsert(新 record id + 版本递增),不再全量重写文件。
 */
import { existsSync, mkdirSync, promises as fs, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import type { L1Hit, MemoryFamily, MemoryLogger, MemoryRecord, RoomCount } from '../types.js';
import { familyForType, isScopeVisible } from '../types.js';
import type { GraphNodeSearchResult } from '../graph/types.js';
import { graphHitRecordIds } from '../graph/search.js';
import type { L1Receipt, ReceiptQuery } from './receipts.js';
import type { ConflictClaimGroup, ConflictPair, ConflictRejected, ConflictResolution, ConflictType } from './conflicts.js';
import { isRetired, type SupersedeInfo } from './supersede.js';
import { exportThenPurge, readSnapshotManifest, readSnapshotRecords, restoreL1Snapshot, selectSnapshotTargets, snapshotDirFor, listSnapshots as listSnapshotsIn, type ExportThenPurgeResult, type PurgeOptions, type RestoreResult, type SnapshotRestorePlan, type SnapshotSummary } from './l1-snapshot.js';
import { EmbedHelper, NoopEmbeddingService, type EmbeddingService } from './embedding.js';
import { appendJsonl, dayKey, ensureDir, readJsonl } from '../util/io.js';
import { allocUniqueName, deriveName } from '../util/md-name.js';
import { applyDecayWeight, normalizeRrf, rrfMerge , markDedupPath } from './search-utils.js';
import { isZeroVector, type L1MetaLite, type MemoryDb } from './sqlite.js';
import type { L1FileSyncHook } from './memory-md-sync.js';

export type RecallStrategy = 'keyword' | 'embedding' | 'hybrid';

/** Room 计数缓存 TTL(tags 只在反刍标签段变化;面板常开也不必每次敲库)。 */
const ROOM_CACHE_TTL_MS = 30_000;

/**
 * 图谱路提供者(§D 第 3 路):按查询返回图谱命中(已按 score 降序)。
 * 抽成注入式而非直接读 `db.graphStore`,是为了给 hybrid 融合留一个可替换的测试缝,
 * 并让「未接线 = 恰为 2 路」成为默认行为(既有调用方零行为变化)。
 */
export type GraphLaneProvider = (
  query: string,
  limit: number,
  family?: MemoryFamily,
) => readonly GraphNodeSearchResult[];

export interface L1SearchOptions {
  /** 按记忆类型精确过滤(后置过滤,官方做法)。 */
  type?: string;
  /** 按族过滤(undefined = 不过滤,即 auto 档与浏览路径;检索唯一缝的族语义)。 */
  family?: MemoryFamily;
  /**
   * §E 当前工作区标识(undefined = **不做可见范围过滤**,与改动前逐字一致)。
   * 与 `family` 落在**同一条 SQL / 同一层回查**里(ADR-0008 组合关系):
   * 若只在检索出口过滤而放任去重候选跨工作区相互污染,会产出「看不见但已影响决策」的记忆。
   */
  workspaceId?: string;
  /** 分数阈值(仅召回路径传;keyword/embedding 策略生效,FTS 含小语料例外;
   *  hybrid 按官方语义在 RRF 融合前不过滤)。 */
  scoreThreshold?: number;
  /** 嵌入查询内层钳制(ms,只缩短不放大;召回路径传入给 FTS 降级留时间)。 */
  embeddingTimeoutMs?: number;
}

/** 官方过度召回倍数:候选池 = limit × 3(官方 tool 路径同款)。 */
const CANDIDATE_MULTIPLIER = 3;

/** 快照回灌的结果(在 `RestoreResult` 之上补"从哪来"与"找回了多少")。 */
export interface SnapshotRestoreOutcome extends RestoreResult {
  /** 解析出的快照目录;名字非法或快照不存在时为空串。 */
  dir: string
  /** 这个名字是否指向一份真实存在且清单合法的快照。 */
  found: boolean
  /** 其中当前**不在库**、本次被找回的条数(写库前算出)。 */
  missing: number
  /** 本次顺手放回检索面的条数(仅 `unretire: true` 时可能非零)。 */
  unretired: number
  notFound: string[]
  /**
   * 回到主表但**仍未回到检索面**的 id(见 `SnapshotRestorePlan.stillRetired`)。
   * `unretire: true` 且放回成功时为空数组。
   */
  stillRetired: string[]
}

export class L1Store {
  /** 记忆库根目录(`records/` 与 `snapshots/` 都在它下面)。 */
  private readonly dataDir: string;
  private readonly recordsDir: string;
  private readonly legacyFile: string;
  private readonly helper: EmbedHelper;
  private embedSvc: EmbeddingService;
  private readonly logger?: MemoryLogger;
  /** 时效衰减半衰期(天;0=关)。 */
  private readonly decayHalfLifeDays: number;
  /** §D 第 3 路(图谱回链);缺省 = 不接,恰为 2 路。 */
  private readonly graphLaneProvider?: GraphLaneProvider;
  /** 孤儿记忆计数(没有任何 Room 的记录;rooms-get 面板「无绑定」chip 用)。 */
  untaggedL1Count(): number {
    return this.db.untaggedL1Count();
  }

  /** Room 计数缓存(见 `listRooms()`:tags 仅随反刍变化,不必每次敲库)。 */
  private roomCache: { at: number; list: RoomCount[] } | null = null;

  /**
   * 库→文件投射的跟随钩子(收口点;未注入 = 零文件动作)。
   *
   * 为什么不放在调用方:改变记录有效性/身份的写路径全部汇流在本类的 `appendNew` /
   * `retire` / `restore` / `rename` 四个方法上,而上游有 8 处 `retire()` 调用点——事件挂钩
   * 已被真机证伪(920 条退场只有 8 个 `.disable`)。放这里意味着新增调用点不会漏。
   * 与构造函数里的 `autoName: () => cfg.memExport.enabled` 同一先例:只拿判据,不拿配置快照。
   */
  private fileSync?: L1FileSyncHook;

  constructor(
    dataDir: string,
    private readonly db: MemoryDb,
    embed: EmbeddingService = new NoopEmbeddingService(),
    private readonly strategy: RecallStrategy = 'hybrid',
    logger?: MemoryLogger,
    /** 时效衰减半衰期(天;0=关)。缺省 30 与 config 默认一致。 */
    decayHalfLifeDays?: number,
    /** 图谱路提供者(§D 第 3 路);不传则该路不存在,融合退回双路。 */
    graphLane?: GraphLaneProvider,
    /**
     * “该不该给没名字的新记录起名”的实时判据（装配层递 `() => cfg.memExport.enabled`）。
     *
     * 用函数而不是布尔：设置面可热改，存下快照就会与当前开关漂移。
     * 不传 = 不主动起名（“投射关着时零动作”这条既有承诺不改），但**别人占着的名字照样修**
     * ——那是防丢数据，与开关无关。
     */
    private readonly autoName?: () => boolean,
  ) {
    this.dataDir = dataDir;
    this.recordsDir = path.join(dataDir, 'records');
    this.legacyFile = path.join(dataDir, 'l1', 'records.jsonl');
    this.embedSvc = embed;
    this.helper = new EmbedHelper(embed, logger);
    this.logger = logger;
    this.decayHalfLifeDays = decayHalfLifeDays ?? 30;
    this.graphLaneProvider = graphLane;
  }

  /** 读路径时效半衰期(天;0=关)。老化权重展示与召回衰减同一事实源。 */
  get decayHalfLife(): number {
    return this.decayHalfLifeDays;
  }

  /**
   * 装配层晚绑定投射跟随钩子。
   *
   * 必须晚于构造:`stores.l1` 先建,md 账本(`stores.mdLedger`)后装,构造期拿不到 ledger。
   * 未注入时四个汇流口行为与注入前逐字一致(投射面关着也是这条)。
   */
  setFileSyncHook(hook: L1FileSyncHook): void {
    this.fileSync = hook;
  }

  /** 有效性变更点火(增/退场/恢复共用一个入口:钩子内部自己跑「导出→后缀收敛」)。 */
  private fireFileSync(ids: readonly string[], why: string): void {
    if (this.fileSync === undefined || ids.length === 0) return;
    this.fileSync.sync(ids, why);
  }

  async init(): Promise<void> {
    await ensureDir(this.recordsDir);
    await this.importLegacy();
  }

  /** 旧版单文件 records.jsonl 一次性导入检索库,成功后改名 .imported。 */
  private async importLegacy(): Promise<void> {
    if (!existsSync(this.legacyFile)) return;
    try {
      const records = await readJsonl<MemoryRecord>(this.legacyFile);
      const valid = records.filter((r) => r && typeof r.id === 'string' && r.content);
      const badCount = records.length - valid.length;
      let n = 0;
      if (valid.length > 0 && this.db.upsertL1Batch(valid)) n = valid.length;
      // 只有确实导入成功才改名,避免把未入库的数据改名带走;判据按 valid 数——
      // 坏行已在读取时过滤,按 records.length 判会让混入坏行的文件迁移永不完成
      if (n === valid.length) {
        const renamed = await fs
          .rename(this.legacyFile, `${this.legacyFile}.imported`)
          .then(
            () => true,
            () => false,
          );
        if (renamed) {
          this.logger?.info(
            `[memory] 旧版 L1 数据已导入检索库 ${n} 条${badCount > 0 ? `(另丢弃 ${badCount} 条坏行)` : ''}(l1/records.jsonl → .imported)`,
          );
        } else {
          this.logger?.warn('[memory] 旧版 L1 导入完成但改名失败,下次启动会重复导入(upsert 幂等,无害)');
        }
      } else {
        this.logger?.warn(`[memory] 旧版 L1 导入不完整(${n}/${valid.length}),保留原文件下次重试`);
      }
    } catch (err) {
      this.logger?.warn(`[memory] 旧版 L1 数据导入失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  get size(): number {
    return this.db.countL1();
  }

  /** 全量读取(调试/迁移用;检索请走 search)。 */
  all(): MemoryRecord[] {
    return this.db.getAllL1();
  }

  /**
   * 游标分批取元信息(**只三列**,不含 content):后台巡检专用。
   *
   * 与 `all()` 的区别是结构性的:`all()` 一次性全量同步反序列化(含正文),
   * 记录数随使用增长后会在事件循环里阻塞 RPC;巡检只需要 id/type/metadata。
   *
   * 配套写回必须用 `patchMetadata()` —— 本方法拿不到 content,用 upsert 会把正文清空。
   */
  allLite(limit: number, offset: number): L1MetaLite[] {
    return this.db.getAllL1Lite(limit, offset);
  }

  /**
   * 只更新 metadata_json 的最小写回(不动 content 与其它列)。
   * 返回 false 表示 id 不存在或写入失败——调用方须记账,不许静默。
   */
  patchMetadata(id: string, metadata: Record<string, unknown>): boolean {
    return this.db.patchL1Metadata(id, metadata);
  }

  /** repo 归属修补(ADR-0015 T3.3;人工消歧用)。CAS:expectRepoKeyName 非空时要求当前值匹配。 */
  patchRepoKey(
    id: string,
    patch: { repoKeyName?: string; repoKeyOwner?: string },
    expectRepoKeyName?: string,
  ): number {
    const changed = this.db.patchRepoKey(id, patch, expectRepoKeyName);
    if (changed > 0) this.enqueueRepoChangeRecluster([id]);
    return changed;
  }

  /**
   * 批量写内容路由得出的 workspace 归属（不触发场景重聚类——归属变化不影响场景划分，
   * 与 repoKey 那条不一样）。具体约束（不碰 updated_time、同步改 l1_fts）在
   * `store/sqlite.ts` 的 `setL1WorkspaceIds` 里，那里是硬约束的**唯一**落点。
   */
  setWorkspaceIds(items: ReadonlyArray<{ id: string; workspaceId: string }>): number {
    return this.db.setL1WorkspaceIds(items);
  }

  /**
   * 改一条记忆的文件身份名（N1）。形状校验在调用方（`normalizeName`），唯一性由
   * 存储层的部分唯一索引挡——撞名就返 `{ ok: false, reason: 'dup' }`，**不自动加后缀**。
   * 改名不触发场景重聚类，也不动 `updated_time`（约束在 `renameL1` 里）。
   */
  rename(id: string, name: string): { ok: boolean; reason?: string } {
    // 改名前的身份要先把住：投射文件名就是 `name`（`targetFor` 算路径），库里改了而盘上
    // 没跟进就会长期对不上，后缀收敛器也修不了（它按**当前** name 算路径）。
    const oldName = this.db.getL1ByIds([id])[0]?.name;
    const r = this.db.renameL1(id, name);
    if (r === 'ok') {
      if (oldName !== undefined && oldName !== '' && oldName !== name && this.fileSync !== undefined) {
        this.fileSync.renamed(new Map([[id, oldName]]), 'rename');
      }
      return { ok: true };
    }
    return { ok: false, reason: r };
  }

  /** 按名字反查 id（重名预检 / md 回灌）；未命中 ⇒ undefined。 */
  findIdByName(name: string): string | undefined {
    return this.db.findRecordIdByName(name);
  }

  /**
   * 给一批**名字缺失或被别人占着**的记录分配文件身份名（N1 的机器起名，全库唯一判据的唯一真源）。
   *
   * 为什么必须做：`deriveName` 只取正文首行前 24 字，同一段话的多条记录必然洗出同名。
   * 真机实测 1166 条记录 `name` 全空、42 条挤进 17 个同名投射文件（最狠一个路径 6 条），
   * 后果是导出每轮重刷被覆盖的那几条、反向同步会把一份内容回灌给六条记录。不回填 name，
   * P0 加的这一列与部分唯一索引就一直是空转。
   *
   * “要起名”的判据不是“name 为空”，而是两种都要管：
   * - **空名**（存量与“抽取时没起名”的新行）——只在 `autoName()` 为真时补；
   * - **名字属于库里另一条**——无条件重命。这一类不是想象：调用方拿 `{ ...旧记录, id: 新 id }`
   *   复制新记录（去重 merge / 取代路径就这么写），旧记录刚被本函数填上 name；不重命的话
   *   新记录拿着别人占着的名字去写库，**撞部分唯一索引 → 整条写不进检索库**（旧记录已退场、
   *   取代者根本不存，两个自家用例就是这么挂的）。
   *
   * 三条约束：
   * - **不覆写属于它自己的名字**：人的命名是权威；
   * - **只改 name**：不碰内容/类型/退场态，也不进快照哈希字段表（`canonicalRecords` 里没有
   *   `name`），所以这一步不会弄挂「导出不改检索面」的护栏；
   * - **按 id 排序后再分配**：同一个基底谁先拿到裸名由顺序决定，不钉死会给同一条记录
   *   两次分到不同名字，文件在盘上跳来跳去。
   *
   * @param records - 待起名的记录（**就地改 `.name`**，内存与库保持一致）。
   * @param opts.persist - true 走 `renameL1Batch` 落库（存量回填）；false 只算名不落库
   *   （新增记录还没进库，名字由随后的 upsert 一并写）。
   * @param opts.fillEmpty - 是否给**空名**起名（默认按 `autoName()` 判）。“名字属于别人”那类
   *   不受此参数影响，永远修。
   * @returns `named` 本轮起名条数，`failed` 落库失败条数（persist=false 时恒为 0）。
   */
  assignMissingNames(
    records: MemoryRecord[],
    opts: { persist?: boolean; fillEmpty?: boolean } = {},
  ): { named: number; failed: number } {
    const fillEmpty = opts.fillEmpty ?? (this.autoName?.() === true);
    // 名字属于库里另一条的（含被 `{...旧记录}` 复制走的），一律重新分配。
    const foreignName = (r: MemoryRecord): boolean => {
      const n = (r.name ?? '').trim();
      if (n.length === 0) return false;
      const owner = this.db.findRecordIdByName(n);
      return owner !== undefined && owner !== r.id;
    };
    const emptyName = (r: MemoryRecord): boolean => (r.name ?? '').trim().length === 0;
    const needSet = new Set<MemoryRecord>();
    for (const r of records) {
      if (foreignName(r) || (fillEmpty && emptyName(r))) needSet.add(r);
    }
    const need = records.filter((r) => needSet.has(r)).sort((a, b) => a.id.localeCompare(b.id));
    if (need.length === 0) return { named: 0, failed: 0 };

    // 占用集：本批里**不需要重新分配**的那些名字（它们确实是自己的）+ 本轮刚分出去的。
    const reserved = new Set<string>();
    for (const r of records) {
      if (needSet.has(r)) continue;
      const n = (r.name ?? '').trim();
      if (n.length > 0) reserved.add(n);
    }
    const needIds = new Set(need.map((r) => r.id));
    const isFree = (name: string): boolean => {
      const owner = this.db.findRecordIdByName(name);
      // 持者是本轮正要起名的某条自己（存量回填时它们已在库里），不算占。
      return owner === undefined || needIds.has(owner);
    };

    const items: Array<{ id: string; name: string }> = [];
    for (const r of need) {
      // 基底始终取正文，而不是取那个“属于别人的旧名字”。
      const name = allocUniqueName(deriveName(r.content), r.id, isFree, reserved);
      r.name = name;
      items.push({ id: r.id, name });
    }
    if (opts.persist !== true) return { named: items.length, failed: 0 };
    const { done, failed } = this.db.renameL1Batch(items);
    // 落库失败的条目把内存侧名字收回：否则内存与库不一致，下一轮又当“已有名字”而永不重试。
    if (failed.length > 0) {
      const bad = new Set(failed);
      for (const r of need) if (bad.has(r.id)) r.name = '';
    }
    return { named: done.length, failed: failed.length };
  }

  /**
   * repo 归属变化 → 受影响场景的重聚类作业(治理 W3,repo-change 触发源)。
   * 归属变了,记忆对场景的归属度就变了——受影响场景的摘要必须由当前事实重算
   * (I-20 投影哲学)。反查各 id 的 scene_name 入队(消费器在 ruminate 空闲档,
   * 每轮至多 1 个作业;内部只有文件级操作,无新增 LLM 通道)。
   */
  private enqueueRepoChangeRecluster(ids: readonly string[]): void {
    try {
      const records = this.db.getL1ByIds([...ids]);
      const byFamilyScene = new Map<string, Set<string>>();
      for (const r of records) {
        if (!r.scene_name) continue;
        const family = r.family ?? 'chat';
        const set = byFamilyScene.get(family) ?? new Set<string>();
        set.add(r.scene_name);
        byFamilyScene.set(family, set);
      }
      const batchId = `repo:${Date.now()}`;
      for (const [family, scenes] of byFamilyScene) {
        if (scenes.size > 0) this.enqueueSceneRecluster(family, [...scenes], batchId, 'repo-change');
      }
    } catch {
      /* 反查失败 = 不入队;重算由下一次任何触发兜底(消费器幂等) */
    }
  }

  // ── L2 场景重聚类作业队列(治理 W3 T3.10;ruminate 空闲档消费)──────────────

  enqueueSceneRecluster(family: string, sceneNames: readonly string[], batchId: string, source = 'demote'): string {
    return this.db.enqueueSceneRecluster(family, sceneNames, batchId, source);
  }

  claimSceneRecluster(): { jobId: string; family: string; sceneNames: string[]; source: string } | null {
    return this.db.claimSceneRecluster();
  }

  finishSceneRecluster(jobId: string, ok: boolean): void {
    this.db.finishSceneRecluster(jobId, ok);
  }

  // ── Room merge/rename 的游标重写(分类管理 beta.5;破坏性面)──────────────

  /**
   * 收集某 Room 的全部匹配记录(含已退场行,口径与 Room 计数一致)。
   * 内部分页拉取,上限 cap 防跑飞;返回记录数组供备份与干跑预览。
   */
  listByTagAll(tag: string, cap = 500): MemoryRecord[] {
    const out: MemoryRecord[] = [];
    for (let offset = 0; offset < cap; offset += 200) {
      const page = this.list({ tag, retired: undefined, limit: Math.min(200, cap - out.length), offset });
      out.push(...page.items);
      if (page.items.length < 200 || out.length >= cap) break;
    }
    return out;
  }

  /**
   * 备份某 Room 的匹配记录到 `<dataDir>/rooms-merge-backups/<ts>-<tag>.json`
   * (执行前快照;破坏性重写前的唯一回滚物料)。返回备份文件路径与条数。
   */
  backupTagRecords(tag: string): { file: string; count: number } {
    const records = this.listByTagAll(tag, 2000);
    const backupDir = path.join(this.dataDir, 'rooms-merge-backups');
    if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
    const file = path.join(backupDir, `${Date.now()}-${tag.replace(/[^a-z0-9-]/gi, '_')}.json`);
    writeFileSync(file, JSON.stringify({ tag, exportedAt: new Date().toISOString(), records }, null, 2), 'utf8');
    return { file, count: records.length };
  }

  /**
   * 游标重写:把 metadata.tags 里的 `from` 全部替换为 `to`(**含已退场行**,
   * 口径与 Room 计数一致)。写前重读-合并-写回(relabel 同款):只动 tags,
   * roomCandidates/roomReview/hall/cogHall/sourceAnchors 等其余键原样保全。
   *
   * 单次上限 cap(500)可续跑:再次调用同一 from 即继续处理剩余行。
   * 返回重写条数 + 受影响的 (family, scene) 集(供 recluster 'room-merge' 入队)。
   */
  rewriteTag(from: string, to: string, cap = 500): {
    rewritten: number;
    scanned: number;
    families: string[];
    scenes: string[];
    hasMore: boolean;
  } {
    const rows = this.listByTagAll(from, cap + 1);
    const hasMore = rows.length > cap;
    const batch = rows.slice(0, cap);
    let rewritten = 0;
    const families = new Set<string>();
    const scenes = new Set<string>();
    for (const r of batch) {
      const meta = { ...(r.metadata ?? {}) } as Record<string, unknown>;
      const tags = Array.isArray(meta.tags) ? (meta.tags as unknown[]).map(String) : [];
      if (!tags.includes(from)) continue; // 命中是 json_each 判等,数组缺失即无可改
      const next = tags.map((t) => (t === from ? to : t));
      meta.tags = [...new Set(next)];
      if (this.patchMetadata(r.id, meta)) {
        rewritten++;
        families.add(r.family ?? 'chat');
        if (r.scene_name) scenes.add(r.scene_name);
      }
    }
    return { rewritten, scanned: batch.length, families: [...families], scenes: [...scenes], hasMore };
  }

  /** 按 id 精确取记录(去重决策的版本号查询用,避免全表扫描)。 */
  getByIds(ids: string[]): MemoryRecord[] {
    return this.db.getL1ByIds(ids);
  }

  /** 外部导入幂等 pre-check(轨3-P0):ext_key 命中已存在记录则返回其 id,否则 undefined。 */
  findIdByExtKey(extKey: string): string | undefined {
    return this.db.findRecordIdByExtKey(extKey);
  }

  /**
   * §B 决策凭证落盘(L1Store 的薄缝)。
   * 刻意放在 store 上:`runExtraction` 已经持有 L1Store,凭证写入因此无需新增
   * 构造参数或改动签名;同时它也是「写入失败不中断蒸馏」**可注入的测试缝**——
   * 测试只需替换这一个方法就能模拟落盘故障,不必伪造整个 store。
   */
  recordReceipts(rows: readonly L1Receipt[]): number {
    return this.db.recordReceipts(rows);
  }

  /**
   * §B 双维回溯的读缝(task_19)。与 `recordReceipts` 同理由:
   * 工具层与 RPC 层只认 L1Store,不直连 `db`——保持"检索库的入口只有一处"
   * 这一既有不变量,也让未来的读缓存/裁剪如需介入仍只有一个落点。
   */
  listReceipts(opts: ReceiptQuery & { limit: number }): L1Receipt[] {
    return this.db.listReceipts(opts);
  }

  countReceipts(opts: ReceiptQuery): number {
    return this.db.countReceipts(opts);
  }

  /**
   * §C 矛盾冻结落盘(thick 缝)。与 `recordReceipts` 同理由:管线已持有 L1Store,
   * 无需新增构造参数;同时它是「冻结写失败不得中断蒸馏」可注入的测试缝。
   */
  recordConflictPending(rows: readonly ConflictPair[]): number {
    return this.db.recordConflictPending(rows);
  }

  /**
   * §C 丢弃留痕:登记被判为「配不成对」的 conflict 决策(薄包装)。
   * 与 `recordConflictPending` 同层同理由:管线已持有 L1Store,不新增构造参数;
   * 同时它是「留痕写失败不得中断蒸馏」可注入的测试缝。
   */
  recordConflictRejected(rows: readonly ConflictRejected[]): number {
    return this.db.recordConflictRejected(rows);
  }

  /** §C 读取丢弃留痕(为审计/诊断出口预留;薄包装)。 */
  listConflictRejected(opts: { createdBefore?: string; limit?: number } = {}): ConflictRejected[] {
    return this.db.listConflictRejected(opts);
  }

  /**
   * §C Phase 2(task_2.0):写入「已复看」痕迹(薄包装)。
   * **不写 `resolved_at`** —— `defer` 不是裁决结论,该对必须留在待裁决队列里。
   */
  markConflictReviewed(
    pairId: string,
    next: { reviewedAt: string; deferredAt: string; deferCount: number },
  ): number {
    return this.db.markConflictReviewed(pairId, next);
  }

  /**
   * §C 冻结的图谱侧同步:把 `disputed` 状态重算到给定冲突集(命中标记 / 不再命中复原)。
   * 经 store 而非直取 `db.graphStore`,与图谱路 provider 的注入式设计同一理由
   * (见本文件头部注释):图谱是**可选**的派生投影,开关关闭时必须是 no-op。
   */
  syncGraphDisputed(disputedRecordIds: readonly string[]): { marked: number; cleared: number } {
    return this.db.syncGraphDisputed(disputedRecordIds);
  }

  /**
   * §C 待裁决队列的未裁决条数(task_24 队列上限判据)。
   * Phase 3(task_3.4):`conflictType` 可选过滤,只有额度判据传 `{ conflictType: 'hard' }`。
   */
  countConflictPendingUnresolved(opts: { conflictType?: ConflictType } = {}): number {
    return this.db.countConflictPendingUnresolved(opts);
  }

  /** §C Phase 3(task_3.3):未裁决对按 `claim_key` 归并(薄包装)。 */
  listConflictGroupedByClaim(opts: { limit?: number } = {}): ConflictClaimGroup[] {
    return this.db.listConflictGroupedByClaim(opts);
  }

  /** §C 取未裁决冲突对(task_24 超时扫描 / task_25 裁决工具)。 */
  listConflictPending(opts: {
    createdBefore?: string;
    limit?: number;
    excludeDeferExhausted?: boolean;
  } = {}): ConflictPair[] {
    return this.db.listConflictPending(opts);
  }

  /** §C 打上裁决结论(已裁决的不覆盖)。 */
  resolveConflictPending(pairId: string, resolution: ConflictResolution, resolvedAt: string): number {
    return this.db.resolveConflictPending(pairId, resolution, resolvedAt);
  }

  /** 新记忆落盘:JSONL 按天追加(事实源)+ 检索库 upsert + 向量。 */
  async appendNew(records: MemoryRecord[]): Promise<void> {
    if (records.length === 0) return;
    for (const r of records) {
      if (!r.family) r.family = familyForType(r.type);
    }
    // 起名必须在**追加事实源之前**：名字是文件身份键，进了 JSONL 才能跟记录一起重生。
    // 这批还没进库，所以只算名字不落库（persist=false），由下面的 upsert 一并写。
    this.assignMissingNames(records, { persist: false });
    const byDay = new Map<string, MemoryRecord[]>();
    for (const r of records) {
      const k = dayKey(r.createdAt || Date.now());
      const arr = byDay.get(k) ?? [];
      arr.push(r);
      byDay.set(k, arr);
    }
    for (const [day, list] of byDay) {
      await appendJsonl(path.join(this.recordsDir, `${day}.jsonl`), list);
    }
    const vecs = await this.helper.batch(records.map((r) => r.content));
    // 单事务批量写:逐条开事务在 WAL FULL 下每条一次 fsync。
    // 双写失败闭环:JSONL 事实源已先行追加,DB 缺行 = 这批记忆检索不可见、
    // 去重候选缺失(重复记忆会累积)。upsert 内部已有逐条 warn,这里升 error
    // 并给出自愈指引——检索库可由「重建记忆」从事实源全量重导修复。
    if (!this.db.upsertL1Batch(records, vecs)) {
      this.logger?.error(
        `[memory] L1 检索库批量写入失败(${records.length} 条,JSONL 事实源完好),` +
          '这批记忆暂不可检索;可在设置页运行「重建记忆」修复',
      );
    }
    // 写对称:新增也即时上盘(不阻塞、失败只 warn)——否则「文件树 = 库当前状态」只对删成立。
    this.fireFileSync(records.map((r) => r.id), 'appendNew');
  }

  /** 去重 update/merge 产出的记录:只更新检索库(JSONL 事实源不改写,官方语义)。 */
  async upsert(record: MemoryRecord): Promise<void> {
    if (!record.family) record.family = familyForType(record.type);
    // merge 分支会继承胜方的 name；两边都没名字时在这里补上，别让新铸的行继续带空名。
    this.assignMissingNames([record], { persist: false });
    const vec = (await this.helper.batch([record.content]))[0];
    if (!this.db.upsertL1(record, vec)) {
      this.logger?.error(
        `[memory] L1 检索库写入失败 id=${record.id}(JSONL 事实源完好),该记忆暂不可检索,重建可修复`,
      );
    }
  }

  /** 活切换嵌入源:同步换底层服务(嵌入源三态切换用)。 */
  setEmbeddingService(svc: EmbeddingService): void {
    this.embedSvc = svc;
    this.helper.setService(svc);
  }

  /** 向量写入能力是否就绪。`reindex` 在未就绪时**静默短路**成 0/0/0
   *  (见本文件 `reindex` 首行),调用方必须自己问这里——否则"根本没跑"
   *  会长得和"跑完了、零条待补"一模一样。 */
  vectorsReady(): boolean {
    return this.helper.vectorReady();
  }

  // 这里**刻意没有** `deleteBatch`:物理删除(L1 三表同清)是不可逆的,
  // 故它只能经由 `purgeRetired` → `exportThenPurge`(先落快照 + 校验通过)抵达。
  // 曾经的 `deleteBatch(ids)` 是个无门禁的硬删入口,裁决 / 取代 / 面板删除都直接
  // 调它 —— 那正是"删错了只能去 records/*.jsonl 手工捞"的根源。
  // 若将来确需新增强删路径,请复用它下面的门禁,而不是重新暴露一个裸入口。

  /**
   * **软删**(记忆退场):保留主表行 + 撤出检索面,可被 `restore` 找回。
   *
   * 三条退场路径 —— 裁决判负 / 去重取代(`update`/`merge`) / 人工删除 ——
   * **共用这一个入口**。分成三份实现迟早会出现"某条路径还在硬删"的不一致语义,
   * 而那种不一致只有在误删发生时才暴露。
   */
  retire(ids: string[], info: SupersedeInfo): number {
    const n = this.db.retireL1Batch(ids, info);
    // 退场汇流口(人工软删 / 合并取代 / 冲突判负 都经这里)——所以机器侧自动退场也自动有文件跟随。
    // 不 await:库侧结果先成立,投射是旁路(见 `setFileSyncHook` 的注释)。
    this.fireFileSync(ids, 'retire');
    return n;
  }

  /** 已退场(可恢复)记录列表(面板用)。 */
  listRetired(opts: { limit: number; offset: number }): { items: MemoryRecord[]; total: number } {
    return this.db.listRetiredL1(opts);
  }

  /**
   * 恢复:清退场标记 → 重新 upsert 以重建 FTS(与向量)。
   *
   * 嵌入不可用/超时时**不抛**:向量补不上只是"暂时只能关键词召回",而"恢复失败"
   * 会让人以为记录丢了 —— 后者严重得多。记录先回到检索面,向量留给后续 `reindex`。
   */
  async restore(ids: string[]): Promise<{ restored: number; vectorsWritten: number }> {
    const records = this.db.clearRetireMarker(ids);
    let vectorsWritten = 0;
    for (const rec of records) {
      if (!rec.family) rec.family = familyForType(rec.type);
      let vec: Float32Array | undefined;
      try {
        vec = (await this.helper.batch([rec.content]))[0];
      } catch (err) {
        this.logger?.warn(
          `[memory] 恢复时向量计算失败,先回关键词检索面(日后重建可补齐): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (vec && !isZeroVector(vec)) vectorsWritten++;
      this.db.upsertL1(rec, vec);
    }
    // 恢复活跃 = 有效性变更,后缀该从 `.disable` 掉回去(与 `retire` 对称的那一半)。
    this.fireFileSync(records.map((r) => r.id), 'restore');
    return { restored: records.length, vectorsWritten };
  }

  /**
   * 已退场记录的**物理清理**(不可逆):先落快照 + 校验,门禁不过即中止。
   *
   * 门禁本体在 `l1-snapshot.exportThenPurge`(与"重建前必快照"同一套设施);
   * 这里只把 L1Store 已知的 dataDir 与 logger 接上去,避免端点层自己去推路径。
   */
  async purgeRetired(ids: string[], reason: string, opts: PurgeOptions = {}): Promise<ExportThenPurgeResult> {
    // **只清理确实处于退场态的记录**。这道复核必须在删除发生的地方(而不是调用方):
    // 否则任何调用方传一个 id 列表就能绕过软删、把活动记忆直接物理抹掉——
    // 那等于给"先导出后清理"留了一条硬删后门。
    const known = new Map(this.db.getL1ByIds(ids).map((r) => [r.id, r]));
    const retiredIds = ids.filter((id) => known.get(id)?.validTo !== undefined);
    return exportThenPurge(this.db, this.dataDir, retiredIds, reason, this.logger, new Date(), opts);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 快照的**读与回灌**(task_27):`purgeRetired` 会先落快照,但只落不接等于
  // 后悔药只做了一半——"清理不可逆"这句话必须配一条能走回去的路,否则
  // `exportThenPurge` 的导出物就只是给人手工解析的 JSON。
  //
  // 恢复走 `restoreL1Snapshot`(本文件的 `restore` 管的是**软删**退场,
  // 两者不是一件事:软删的行一直在主表里,快照恢复要管的是**已被物理删除**的行)。
  // ───────────────────────────────────────────────────────────────────────────

  /** 可用快照列表(按时间倒序;面板/工具据此选一份来恢复)。 */
  listSnapshots(opts: { limit?: number } = {}): Promise<{ items: SnapshotSummary[]; total: number }> {
    return listSnapshotsIn(this.dataDir, { ...opts, logger: this.logger });
  }

  /**
   * 名字 → 真实快照。
   *
   * 两道判定合一:名字合法(`snapshotDirFor`)且**清单存在且版本相符**
   * (`readSnapshotManifest`)。只有前者会被"目录里有个同名空目录"骗过——
   * 而那正是半截写入的产物,选中它恢复会得到 0 条却报成功。
   */
  private async resolveSnapshot(name: string): Promise<{ dir: string; records: MemoryRecord[] } | undefined> {
    const dir = snapshotDirFor(this.dataDir, name);
    if (dir === undefined) return undefined;
    if ((await readSnapshotManifest(dir)) === undefined) return undefined;
    return { dir, records: await readSnapshotRecords(dir) };
  }

  /**
   * 干跑:算出"这份快照恢复下去会发生什么",**不写库**。
   *
   * `missing` 才是真正被找回的条数——快照里绝大多数记录今天仍在库里(快照是
   * **全库**拷贝,而被清掉的只是其中几条)。只报 `targets` 会让人以为"要恢复 787 条",
   * 从而不敢按下去。
   */
  async planSnapshotRestore(name: string, ids?: readonly string[]): Promise<SnapshotRestorePlan> {
    const resolved = await this.resolveSnapshot(name);
    if (resolved === undefined) {
      return { name, dir: '', found: false, inSnapshot: 0, targets: 0, missing: 0, stillRetired: [], notFound: [] };
    }
    const { targets, notFound } = selectSnapshotTargets(resolved.records, ids);
    const targetIds = targets.filter((r) => typeof r?.id === 'string').map((r) => r.id);
    const current = this.existingIds(targetIds);
    return {
      name,
      dir: resolved.dir,
      found: true,
      inSnapshot: resolved.records.length,
      targets: targets.length,
      missing: targetIds.filter((id) => !current.has(id)).length,
      // 目标里带退场标记的那些:它们即便回到主表也仍不在检索面(见字段说明)。
      stillRetired: targets.filter((r) => isRetired(r)).map((r) => r.id),
      notFound,
    };
  }

  /**
   * 从快照恢复(不可逆动作的**回程票**;本身幂等,可安全重跑)。
   *
   * 向量按整批补算(`helper.batch`),失败即降级成"暂时只走关键词召回"而不中止——
   * 与 `restore` 同一条纪律:补不上向量是小事,让人以为记录丢了是大事。
   *
   * @param opts.unretire - 顺手把带退场标记的记录放回检索面(走既有 `restore`,
   *   不新开写路径)。默认 `false`:只回主表,与"恢复的是当时的状态"一致。
   */
  async restoreFromSnapshot(name: string, opts: { ids?: readonly string[]; unretire?: boolean } = {}): Promise<SnapshotRestoreOutcome> {
    const resolved = await this.resolveSnapshot(name);
    if (resolved === undefined) {
      return { dir: '', found: false, inSnapshot: 0, targets: 0, missing: 0, unretired: 0, stillRetired: [], restored: 0, failed: 0, vectorsWritten: 0, notFound: [] };
    }
    // `missing` 必须在写库**之前**算:写完再算恒为 0,那这个字段就废了。
    const { targets } = selectSnapshotTargets(resolved.records, opts.ids);
    const targetIds = targets.filter((r) => typeof r?.id === 'string').map((r) => r.id);
    const current = this.existingIds(targetIds);
    const missing = targetIds.filter((id) => !current.has(id)).length;
    const retired = targets.filter((r) => isRetired(r)).map((r) => r.id);
    const r = await restoreL1Snapshot(this.db, resolved.dir, {
      logger: this.logger,
      ids: opts.ids,
      vectorize: async (records) => {
        const vecs = await this.helper.batch(records.map((x) => x.content));
        // 零向量 = "嵌入其实没算出来",按未补上计(与 `restore` 的判据一致)。
        return vecs.map((v) => (v && !isZeroVector(v) ? v : undefined));
      },
    });
    let unretired = 0;
    let stillRetired = retired;
    if (opts.unretire && retired.length > 0) {
      // 复用已验收的 `restore`(清标记 + 重算向量 + 重建 FTS),不另开一条写路径。
      const back = await this.restore(retired);
      unretired = back.restored;
      stillRetired = [];
    }
    // 回到主表就等于“库里多一份可投射的份”：无论带不带退场标记都要上盘
    // （带标记的那批由钩子内部的收敛器接成 `.disable`）。走 `restore` 的那批已点火，不重发。
    if (r.restored > 0 && unretired === 0) {
      this.fireFileSync(targetIds, 'restoreFromSnapshot');
    }
    return { ...r, dir: resolved.dir, found: true, missing, unretired, stillRetired };
  }

  /** 这批 id 里当前**在库**的集合(分块查,避免一次 IN 太多参数)。 */
  private existingIds(ids: readonly string[]): Set<string> {
    const out = new Set<string>();
    for (let i = 0; i < ids.length; i += 400) {
      for (const r of this.db.getL1ByIds(ids.slice(i, i + 400))) out.add(r.id);
    }
    return out;
  }

  /**
   * 三策略检索(自动召回与 memory_search 工具共用接缝)。
   * embedding 不可用时自动降级 keyword;type 后置过滤;
   * scoreThreshold 仅对 keyword/embedding 单路策略生效——hybrid 按官方语义
   * 融合完整列表(融合分已归一化 0~1,可直接用于展示/过滤)。
   */
  async search(query: string, limit: number, opts?: L1SearchOptions): Promise<L1Hit[]> {
    const caps = this.db.getCapabilities();
    const canVec = caps.vectorSearch && this.helper.vectorReady();
    let strategy: RecallStrategy | 'none' = this.strategy;
    if (strategy !== 'keyword' && !canVec) strategy = caps.ftsSearch ? 'keyword' : 'none';

    const candidateK = limit * CANDIDATE_MULTIPLIER;
    const threshold = opts?.scoreThreshold ?? 0;

    if (strategy === 'none') return [];
    if (strategy === 'keyword') {
      const fts = this.db.searchL1Fts(query, candidateK, opts?.family, opts?.workspaceId);
      return this.postProcess(this.applyDecay(applyFtsThreshold(fts, threshold, limit)), opts?.type, limit);
    }
    if (strategy === 'embedding') {
      const vec = await this.helper.query(query, opts?.embeddingTimeoutMs);
      if (!vec) {
        // embedding 调用失败:降级 FTS,不阻断
        const fts = this.db.searchL1Fts(query, candidateK, opts?.family, opts?.workspaceId);
        return this.postProcess(this.applyDecay(applyFtsThreshold(fts, threshold, limit)), opts?.type, limit);
      }
      const vecHits = this.db.searchL1Vector(vec, candidateK, opts?.family, opts?.workspaceId);
      return this.postProcess(this.applyDecay(filterScore(vecHits, threshold)), opts?.type, limit);
    }

    // hybrid(官方语义):多路并行 → 完整列表 RRF 融合(融合前不过滤阈值)
    // → 融合分按**实际路数**归一化:全路 rank1 命中 = 1.0,双路单列表命中 ≤ 0.5
    const [ftsList, vecRaw] = await Promise.all([
      Promise.resolve(this.db.searchL1Fts(query, candidateK, opts?.family, opts?.workspaceId)),
      this.helper.query(query, opts?.embeddingTimeoutMs),
    ]);
    const vecList = vecRaw ? this.db.searchL1Vector(vecRaw, candidateK, opts?.family, opts?.workspaceId) : [];
    // 第 3 路(图谱)仅在接线时**结构性存在**:未接线不占路数名额,故既有调用方
    // 仍走 2 路、得分与改动前逐位一致(见 findings.md §12.1 的路数语义)
    const lanes: L1Hit[][] = [ftsList, vecList];
    if (this.graphLaneProvider) lanes.push(this.graphLane(query, candidateK, opts?.family, opts?.workspaceId));
    // 第 4 路(时效)在衰减开启时**结构性存在**;关掉衰减 = 该路不存在
    if (this.decayHalfLifeDays > 0) lanes.push(this.recencyLane([...ftsList, ...vecList]));
    const merged = rrfMerge(lanes, (h) => h.id);
    return this.postProcess(
      this.applyDecay(merged.map(({ rrfScore, ...h }) => ({ ...h, score: normalizeRrf(rrfScore, lanes.length) }))),
      opts?.type,
      limit,
    );
  }

  /**
   * §D 第 4 路(时效路,hybrid 专用):把候选池按 `applyDecayWeight` 加权后的
   * 顺序作为第 4 条**已排序**列表,复用与后处理同源的加权函数(不新增独立逻辑)。
   *
   * **时效是排序信号,不是召回信号**:本路只重排 `ftsList ∪ vecList` 里的既有
   * 候选,**不引入任何新记录**。若让"无关但很新"的记忆靠时效进结果,会直接损害
   * 检索精度——这条性质由 `tests/recency-lane.test.ts` 的 id 集合不变量钉住。
   *
   * **严禁进入 `searchCandidates`**(`search-utils.ts:26-27` 约定):写路径找同语义
   * 旧记录必须**无视新旧**——一旦被时效加权,老的同义记录会被漏检,导致同事实双记录
   * 累积。故本方法只被 `search()` 调用,去重候选路径不得引用。
   */
  private recencyLane(candidates: L1Hit[]): L1Hit[] {
    if (!(this.decayHalfLifeDays > 0) || candidates.length === 0) return [];
    const seen = new Set<string>();
    const deduped: L1Hit[] = [];
    for (const h of candidates) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      deduped.push(h);
    }
    return this.applyDecay(deduped);
  }

  /**
   * §D 第 3 路(图谱路径,hybrid 专用):图谱命中 → `sourceRecordIds` 回链 →
   * L1 记录,作为第 3 条**已排序**列表参与 RRF。
   *
   * 为什么值得:图谱是按实体/关系组织的**可重建派生投影**,能召回词法与向量
   * 都命不中的记录(同义表述、关系可达)——这正是本路相对双路的增量。
   *
   * 三条边界:
   * - **异常降级**:图谱是派生投影,不得因它失败而拖垮主检索 → 记 warn、返回空路,
   *   融合退回双路(路数随之降为 2,分数回到既有量纲);
   * - **族隔离**:图谱节点已按族过滤,但其来源记录可能跨族 → 这里再按 `family`
   *   过滤一次。宁可漏不可串(与档位隔离同源,§A 的 P0 关注点);
   * - **墓碑边界**:图谱行可能回链到已被删除的 L1 记录 → 取不到就跳过,
   *   不补空占位(占位会在 RRF 里凭空加分)。
   */
  private graphLane(query: string, limit: number, family?: MemoryFamily, workspaceId?: string): L1Hit[] {
    const provider = this.graphLaneProvider;
    if (!provider) return [];
    let hits: readonly GraphNodeSearchResult[];
    try {
      hits = provider(query, limit, family);
    } catch (err) {
      this.logger?.warn(
        `[memory] 图谱路检索失败,本轮退回双路: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
    const ids = graphHitRecordIds(hits);
    if (ids.length === 0) return [];
    const byId = new Map(this.db.getL1ByIds(ids).map((r) => [r.id, r]));
    const out: L1Hit[] = [];
    for (const id of ids) {
      const r = byId.get(id);
      if (!r) continue;
      if (family !== undefined && r.family !== family) continue;
      // §E:与族隔离**同一层**再过滤一次。图谱节点自身没有 scope——归属由**来源记录**
      // 决定(节点是 L1 的派生投影,它不该有独立于来源的可见范围)。
      if (workspaceId !== undefined && !isScopeVisible(r.scope, r.workspaceId, workspaceId)) continue;
      out.push({
        id: r.id,
        content: r.content,
        type: r.type,
        scene_name: r.scene_name,
        priority: r.priority,
        family: r.family,
        // 占位分:RRF 只用 rank,此字段在融合时会被归一化分覆盖
        score: 0,
      });
    }
    return out;
  }

  /**
   * 时效衰减加权(#29):三路共用的读路径后处理——阈值过滤之后、截断之前
   * (才能轮转名额,而不只是重排已截断的集合)。updated_at 经主表批量点查
   * 回填(FTS 表无该列;候选池 ≤ limit×3 条主键查询,微秒级)。关闭时零开销。
   */
  private applyDecay(hits: L1Hit[]): L1Hit[] {
    if (!(this.decayHalfLifeDays > 0) || hits.length === 0) return hits;
    const updatedAtById = new Map<string, number>();
    for (const r of this.db.getL1ByIds(hits.map((h) => h.id))) {
      if (Number.isFinite(r.updatedAt)) updatedAtById.set(r.id, r.updatedAt);
    }
    return applyDecayWeight(hits, this.decayHalfLifeDays, (h) => updatedAtById.get(h.id));
  }

  /** 浏览列表(UI 用):无关键词时按更新时间倒序分页,支持 Hall / 可见范围过滤。 */
  list(opts: {
    type?: string;
    scene?: string;
    family?: string;
    hall?: string;
    halls?: readonly string[];
    /** Room 过滤(metadata.tags 含该 slug)。 */
    tag?: string;
    /** 孤儿记忆筛选(true = 只列没有 Room 的记录;与 tag 互斥,tag 优先)。 */
    untagged?: boolean;
    workspaceId?: string;
    /** 退场筛查:三态(`undefined` 全部 / `false` 仅活跃 / `true` 仅已退场)。 */
    retired?: boolean;
    limit: number;
    offset: number;
  }): { items: MemoryRecord[]; total: number } {
    return this.db.listL1(opts);
  }

  /** 场景名去重列表(UI 筛选器数据源)。 */
  distinctScenes(): string[] {
    return this.db.distinctL1Scenes();
  }

  /** Hall 域计数(八边形角上"该域 N 条 / 未打标 M"数据源):按 metadata.hall 分组计数。 */
  wingCounts(): { counts: Record<string, number>; unlabeled: number } {
    return this.db.wingL1Counts();
  }

  /**
   * Room 计数(标签自生长分类):展开 metadata.tags 聚合,1 tag = 1 Room。
   *
   * tags 只在反刍的标签段变化,故带 30s TTL 缓存;反刍收尾显式 `invalidateRooms()`
   * 保证新涌现的 Room 立刻可见。降级时返回空数组(面板显示"暂无"而非报错)。
   */
  listRooms(): RoomCount[] {
    const now = Date.now();
    if (this.roomCache && now - this.roomCache.at < ROOM_CACHE_TTL_MS) return this.roomCache.list;
    const list = this.db.l1RoomCounts();
    this.roomCache = { at: now, list };
    return list;
  }

  /** 丢弃 Room 计数缓存(tags 写入侧调用:反刍标签段收尾 / 手工打标)。 */
  invalidateRooms(): void {
    this.roomCache = null;
  }

  /** 主表全量元数据扫描(单一所有者共享函数,供并行计划引用门禁复用;见 MemoryDb.scanL1Metadata)。 */
  scanAllMetadata(cb: (recordId: string, metadata: Record<string, unknown> | null) => void): number {
    return this.db.scanL1Metadata(cb);
  }

  /** 查询向量(域软门禁用):复用既有嵌入源;失败/未就绪返回 undefined,调用方降级。 */
  embedText(text: string, timeoutMs?: number): Promise<Float32Array | undefined> {
    return this.helper.query(text, timeoutMs);
  }

  /**
   * 去重候选召回(官方 3 级):空库跳过 → 向量优先 → FTS 兜底。
   * 传入 family 时只在同族记录里召回(去重永不跨族);传入 workspaceId 时
   * 只在**本工作区可见**的记录里召回(§E)——**去重也不跨工作区**。
   *
   * 这一层是 ADR-0008 特意点名的接缝:"scope 过滤必须落在与族隔离同一层"。
   * 理由:候选池决定**新的去重决策**,若此处跨工作区,产出的是「项目 B 里看不见、
   * 但已经决定了项目 A 记忆去向」的记录——比不隔离更糟。
   */
  async searchCandidates(query: string, limit: number, family?: MemoryFamily, workspaceId?: string): Promise<MemoryRecord[]> {
    // 治理哨兵(治理 W0 T0.2):标记去重候选路径;治理权重误入即抛(dev/test)。
    return markDedupPath(async () => {
    if (this.db.countL1() === 0) return [];
    const caps = this.db.getCapabilities();
    if (caps.vectorSearch && this.helper.vectorReady()) {
      try {
        const vec = await this.helper.query(query);
        if (vec) {
          const hits = this.db.searchL1Vector(vec, limit, family, workspaceId);
          if (hits.length > 0) return this.db.getL1ByIds(hits.map((h) => h.id));
        }
      } catch (err) {
        this.logger?.warn(`[memory] 向量候选召回失败,降级 FTS: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const fts = this.db.searchL1Fts(query, limit * 2, family, workspaceId);
    return this.db.getL1ByIds(fts.map((h) => h.id));
    });
  }

  /**
   * 增量重嵌入(embedding 配置变化 / 周期性补齐用):只处理缺失向量的记录,
   * 排除已判定"当前 provider 不可嵌入"的 skip 集。返回写入/失败/跳过数——
   * failed > 0 时调用方不应标记 meta 同步完成;skipped(零向量)不算失败、
   * 不阻塞同步标记(否则补齐判据永不收敛,周期性全量重嵌死循环)。
   * onProgress/shouldCancel 供活切换的进度展示与取消。
   */
  async reindex(opts?: {
    onProgress?: (done: number, total: number) => void;
    shouldCancel?: () => boolean;
  }): Promise<{ written: number; failed: number; skipped: number; cancelled?: boolean }> {
    if (!this.helper.vectorReady()) return { written: 0, failed: 0, skipped: 0 };
    const items = this.db.getL1ForReindex(this.db.getVecSkipSet('l1'));
    const total = items.length;
    let done = 0;
    let written = 0;
    let failed = 0;
    let skipped = 0;
    let cancelled = false;
    const skippedNow: string[] = [];
    const CHUNK = 16;
    for (let i = 0; i < items.length; i += CHUNK) {
      if (opts?.shouldCancel?.()) {
        cancelled = true;
        break;
      }
      const chunk = items.slice(i, i + CHUNK);
      let vecs: Float32Array[];
      try {
        vecs = await this.embedSvc.embedBatch(chunk.map((c) => c.content));
      } catch {
        failed += chunk.length;
        done += chunk.length;
        opts?.onProgress?.(done, total);
        continue;
      }
      const pending: Array<{ id: string; embedding: Float32Array }> = [];
      chunk.forEach((c, j) => {
        if (isZeroVector(vecs[j])) {
          skipped++;
          skippedNow.push(c.id);
          return;
        }
        pending.push({ id: c.id, embedding: vecs[j] });
      });
      if (pending.length > 0) {
        const ok = this.db.updateL1VecBatch(pending);
        written += ok;
        failed += pending.length - ok;
      }
      done += chunk.length;
      opts?.onProgress?.(done, total);
    }
    if (skippedNow.length > 0) this.db.addVecSkippedIds('l1', skippedNow);
    return { written, failed, skipped, cancelled };
  }

  private postProcess(hits: L1Hit[], type: string | undefined, limit: number): L1Hit[] {
    const filtered = type ? hits.filter((h) => h.type === type) : hits;
    return filtered.slice(0, limit);
  }
}

/** FTS 阈值过滤(含官方小语料例外:全部低于阈值但结果数 ≤ maxResults 时保留)。 */
function applyFtsThreshold(hits: L1Hit[], threshold: number, maxResults: number): L1Hit[] {
  if (threshold <= 0) return hits;
  const filtered = hits.filter((h) => h.score >= threshold);
  if (filtered.length === 0 && hits.length > 0 && hits.length <= maxResults) return hits;
  return filtered;
}

function filterScore(hits: L1Hit[], threshold: number): L1Hit[] {
  if (threshold <= 0) return hits;
  return hits.filter((h) => h.score >= threshold);
}
