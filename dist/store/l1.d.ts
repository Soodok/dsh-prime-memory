import type { L1Hit, MemoryFamily, MemoryLogger, MemoryRecord, RoomCount } from '../types.js';
import type { GraphNodeSearchResult } from '../graph/types.js';
import type { L1Receipt, ReceiptQuery } from './receipts.js';
import type { ConflictClaimGroup, ConflictPair, ConflictRejected, ConflictResolution, ConflictType } from './conflicts.js';
import { type SupersedeInfo } from './supersede.js';
import { type ExportThenPurgeResult, type PurgeOptions, type RestoreResult, type SnapshotRestorePlan, type SnapshotSummary } from './l1-snapshot.js';
import { type EmbeddingService } from './embedding.js';
import { type L1MetaLite, type MemoryDb } from './sqlite.js';
export type RecallStrategy = 'keyword' | 'embedding' | 'hybrid';
/**
 * 图谱路提供者(§D 第 3 路):按查询返回图谱命中(已按 score 降序)。
 * 抽成注入式而非直接读 `db.graphStore`,是为了给 hybrid 融合留一个可替换的测试缝,
 * 并让「未接线 = 恰为 2 路」成为默认行为(既有调用方零行为变化)。
 */
export type GraphLaneProvider = (query: string, limit: number, family?: MemoryFamily) => readonly GraphNodeSearchResult[];
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
/** 快照回灌的结果(在 `RestoreResult` 之上补"从哪来"与"找回了多少")。 */
export interface SnapshotRestoreOutcome extends RestoreResult {
    /** 解析出的快照目录;名字非法或快照不存在时为空串。 */
    dir: string;
    /** 这个名字是否指向一份真实存在且清单合法的快照。 */
    found: boolean;
    /** 其中当前**不在库**、本次被找回的条数(写库前算出)。 */
    missing: number;
    /** 本次顺手放回检索面的条数(仅 `unretire: true` 时可能非零)。 */
    unretired: number;
    notFound: string[];
    /**
     * 回到主表但**仍未回到检索面**的 id(见 `SnapshotRestorePlan.stillRetired`)。
     * `unretire: true` 且放回成功时为空数组。
     */
    stillRetired: string[];
}
export declare class L1Store {
    private readonly db;
    private readonly strategy;
    /** 记忆库根目录(`records/` 与 `snapshots/` 都在它下面)。 */
    private readonly dataDir;
    private readonly recordsDir;
    private readonly legacyFile;
    private readonly helper;
    private embedSvc;
    private readonly logger?;
    /** 时效衰减半衰期(天;0=关)。 */
    private readonly decayHalfLifeDays;
    /** §D 第 3 路(图谱回链);缺省 = 不接,恰为 2 路。 */
    private readonly graphLaneProvider?;
    /** 孤儿记忆计数(没有任何 Room 的记录;rooms-get 面板「无绑定」chip 用)。 */
    untaggedL1Count(): number;
    /** Room 计数缓存(见 `listRooms()`:tags 仅随反刍变化,不必每次敲库)。 */
    private roomCache;
    constructor(dataDir: string, db: MemoryDb, embed?: EmbeddingService, strategy?: RecallStrategy, logger?: MemoryLogger, 
    /** 时效衰减半衰期(天;0=关)。缺省 30 与 config 默认一致。 */
    decayHalfLifeDays?: number, 
    /** 图谱路提供者(§D 第 3 路);不传则该路不存在,融合退回双路。 */
    graphLane?: GraphLaneProvider);
    /** 读路径时效半衰期(天;0=关)。老化权重展示与召回衰减同一事实源。 */
    get decayHalfLife(): number;
    init(): Promise<void>;
    /** 旧版单文件 records.jsonl 一次性导入检索库,成功后改名 .imported。 */
    private importLegacy;
    get size(): number;
    /** 全量读取(调试/迁移用;检索请走 search)。 */
    all(): MemoryRecord[];
    /**
     * 游标分批取元信息(**只三列**,不含 content):后台巡检专用。
     *
     * 与 `all()` 的区别是结构性的:`all()` 一次性全量同步反序列化(含正文),
     * 记录数随使用增长后会在事件循环里阻塞 RPC;巡检只需要 id/type/metadata。
     *
     * 配套写回必须用 `patchMetadata()` —— 本方法拿不到 content,用 upsert 会把正文清空。
     */
    allLite(limit: number, offset: number): L1MetaLite[];
    /**
     * 只更新 metadata_json 的最小写回(不动 content 与其它列)。
     * 返回 false 表示 id 不存在或写入失败——调用方须记账,不许静默。
     */
    patchMetadata(id: string, metadata: Record<string, unknown>): boolean;
    /** repo 归属修补(ADR-0015 T3.3;人工消歧用)。CAS:expectRepoKeyName 非空时要求当前值匹配。 */
    patchRepoKey(id: string, patch: {
        repoKeyName?: string;
        repoKeyOwner?: string;
    }, expectRepoKeyName?: string): number;
    /**
     * 批量写内容路由得出的 workspace 归属（不触发场景重聚类——归属变化不影响场景划分，
     * 与 repoKey 那条不一样）。具体约束（不碰 updated_time、同步改 l1_fts）在
     * `store/sqlite.ts` 的 `setL1WorkspaceIds` 里，那里是硬约束的**唯一**落点。
     */
    setWorkspaceIds(items: ReadonlyArray<{
        id: string;
        workspaceId: string;
    }>): number;
    /**
     * 改一条记忆的文件身份名（N1）。形状校验在调用方（`normalizeName`），唯一性由
     * 存储层的部分唯一索引挡——撞名就返 `{ ok: false, reason: 'dup' }`，**不自动加后缀**。
     * 改名不触发场景重聚类，也不动 `updated_time`（约束在 `renameL1` 里）。
     */
    rename(id: string, name: string): {
        ok: boolean;
        reason?: string;
    };
    /** 按名字反查 id（重名预检 / md 回灌）；未命中 ⇒ undefined。 */
    findIdByName(name: string): string | undefined;
    /**
     * repo 归属变化 → 受影响场景的重聚类作业(治理 W3,repo-change 触发源)。
     * 归属变了,记忆对场景的归属度就变了——受影响场景的摘要必须由当前事实重算
     * (I-20 投影哲学)。反查各 id 的 scene_name 入队(消费器在 ruminate 空闲档,
     * 每轮至多 1 个作业;内部只有文件级操作,无新增 LLM 通道)。
     */
    private enqueueRepoChangeRecluster;
    enqueueSceneRecluster(family: string, sceneNames: readonly string[], batchId: string, source?: string): string;
    claimSceneRecluster(): {
        jobId: string;
        family: string;
        sceneNames: string[];
        source: string;
    } | null;
    finishSceneRecluster(jobId: string, ok: boolean): void;
    /**
     * 收集某 Room 的全部匹配记录(含已退场行,口径与 Room 计数一致)。
     * 内部分页拉取,上限 cap 防跑飞;返回记录数组供备份与干跑预览。
     */
    listByTagAll(tag: string, cap?: number): MemoryRecord[];
    /**
     * 备份某 Room 的匹配记录到 `<dataDir>/rooms-merge-backups/<ts>-<tag>.json`
     * (执行前快照;破坏性重写前的唯一回滚物料)。返回备份文件路径与条数。
     */
    backupTagRecords(tag: string): {
        file: string;
        count: number;
    };
    /**
     * 游标重写:把 metadata.tags 里的 `from` 全部替换为 `to`(**含已退场行**,
     * 口径与 Room 计数一致)。写前重读-合并-写回(relabel 同款):只动 tags,
     * roomCandidates/roomReview/hall/cogHall/sourceAnchors 等其余键原样保全。
     *
     * 单次上限 cap(500)可续跑:再次调用同一 from 即继续处理剩余行。
     * 返回重写条数 + 受影响的 (family, scene) 集(供 recluster 'room-merge' 入队)。
     */
    rewriteTag(from: string, to: string, cap?: number): {
        rewritten: number;
        scanned: number;
        families: string[];
        scenes: string[];
        hasMore: boolean;
    };
    /** 按 id 精确取记录(去重决策的版本号查询用,避免全表扫描)。 */
    getByIds(ids: string[]): MemoryRecord[];
    /** 外部导入幂等 pre-check(轨3-P0):ext_key 命中已存在记录则返回其 id,否则 undefined。 */
    findIdByExtKey(extKey: string): string | undefined;
    /**
     * §B 决策凭证落盘(L1Store 的薄缝)。
     * 刻意放在 store 上:`runExtraction` 已经持有 L1Store,凭证写入因此无需新增
     * 构造参数或改动签名;同时它也是「写入失败不中断蒸馏」**可注入的测试缝**——
     * 测试只需替换这一个方法就能模拟落盘故障,不必伪造整个 store。
     */
    recordReceipts(rows: readonly L1Receipt[]): number;
    /**
     * §B 双维回溯的读缝(task_19)。与 `recordReceipts` 同理由:
     * 工具层与 RPC 层只认 L1Store,不直连 `db`——保持"检索库的入口只有一处"
     * 这一既有不变量,也让未来的读缓存/裁剪如需介入仍只有一个落点。
     */
    listReceipts(opts: ReceiptQuery & {
        limit: number;
    }): L1Receipt[];
    countReceipts(opts: ReceiptQuery): number;
    /**
     * §C 矛盾冻结落盘(thick 缝)。与 `recordReceipts` 同理由:管线已持有 L1Store,
     * 无需新增构造参数;同时它是「冻结写失败不得中断蒸馏」可注入的测试缝。
     */
    recordConflictPending(rows: readonly ConflictPair[]): number;
    /**
     * §C 丢弃留痕:登记被判为「配不成对」的 conflict 决策(薄包装)。
     * 与 `recordConflictPending` 同层同理由:管线已持有 L1Store,不新增构造参数;
     * 同时它是「留痕写失败不得中断蒸馏」可注入的测试缝。
     */
    recordConflictRejected(rows: readonly ConflictRejected[]): number;
    /** §C 读取丢弃留痕(为审计/诊断出口预留;薄包装)。 */
    listConflictRejected(opts?: {
        createdBefore?: string;
        limit?: number;
    }): ConflictRejected[];
    /**
     * §C Phase 2(task_2.0):写入「已复看」痕迹(薄包装)。
     * **不写 `resolved_at`** —— `defer` 不是裁决结论,该对必须留在待裁决队列里。
     */
    markConflictReviewed(pairId: string, next: {
        reviewedAt: string;
        deferredAt: string;
        deferCount: number;
    }): number;
    /**
     * §C 冻结的图谱侧同步:把 `disputed` 状态重算到给定冲突集(命中标记 / 不再命中复原)。
     * 经 store 而非直取 `db.graphStore`,与图谱路 provider 的注入式设计同一理由
     * (见本文件头部注释):图谱是**可选**的派生投影,开关关闭时必须是 no-op。
     */
    syncGraphDisputed(disputedRecordIds: readonly string[]): {
        marked: number;
        cleared: number;
    };
    /**
     * §C 待裁决队列的未裁决条数(task_24 队列上限判据)。
     * Phase 3(task_3.4):`conflictType` 可选过滤,只有额度判据传 `{ conflictType: 'hard' }`。
     */
    countConflictPendingUnresolved(opts?: {
        conflictType?: ConflictType;
    }): number;
    /** §C Phase 3(task_3.3):未裁决对按 `claim_key` 归并(薄包装)。 */
    listConflictGroupedByClaim(opts?: {
        limit?: number;
    }): ConflictClaimGroup[];
    /** §C 取未裁决冲突对(task_24 超时扫描 / task_25 裁决工具)。 */
    listConflictPending(opts?: {
        createdBefore?: string;
        limit?: number;
        excludeDeferExhausted?: boolean;
    }): ConflictPair[];
    /** §C 打上裁决结论(已裁决的不覆盖)。 */
    resolveConflictPending(pairId: string, resolution: ConflictResolution, resolvedAt: string): number;
    /** 新记忆落盘:JSONL 按天追加(事实源)+ 检索库 upsert + 向量。 */
    appendNew(records: MemoryRecord[]): Promise<void>;
    /** 去重 update/merge 产出的记录:只更新检索库(JSONL 事实源不改写,官方语义)。 */
    upsert(record: MemoryRecord): Promise<void>;
    /** 活切换嵌入源:同步换底层服务(嵌入源三态切换用)。 */
    setEmbeddingService(svc: EmbeddingService): void;
    /** 向量写入能力是否就绪。`reindex` 在未就绪时**静默短路**成 0/0/0
     *  (见本文件 `reindex` 首行),调用方必须自己问这里——否则"根本没跑"
     *  会长得和"跑完了、零条待补"一模一样。 */
    vectorsReady(): boolean;
    /**
     * **软删**(记忆退场):保留主表行 + 撤出检索面,可被 `restore` 找回。
     *
     * 三条退场路径 —— 裁决判负 / 去重取代(`update`/`merge`) / 人工删除 ——
     * **共用这一个入口**。分成三份实现迟早会出现"某条路径还在硬删"的不一致语义,
     * 而那种不一致只有在误删发生时才暴露。
     */
    retire(ids: string[], info: SupersedeInfo): number;
    /** 已退场(可恢复)记录列表(面板用)。 */
    listRetired(opts: {
        limit: number;
        offset: number;
    }): {
        items: MemoryRecord[];
        total: number;
    };
    /**
     * 恢复:清退场标记 → 重新 upsert 以重建 FTS(与向量)。
     *
     * 嵌入不可用/超时时**不抛**:向量补不上只是"暂时只能关键词召回",而"恢复失败"
     * 会让人以为记录丢了 —— 后者严重得多。记录先回到检索面,向量留给后续 `reindex`。
     */
    restore(ids: string[]): Promise<{
        restored: number;
        vectorsWritten: number;
    }>;
    /**
     * 已退场记录的**物理清理**(不可逆):先落快照 + 校验,门禁不过即中止。
     *
     * 门禁本体在 `l1-snapshot.exportThenPurge`(与"重建前必快照"同一套设施);
     * 这里只把 L1Store 已知的 dataDir 与 logger 接上去,避免端点层自己去推路径。
     */
    purgeRetired(ids: string[], reason: string, opts?: PurgeOptions): Promise<ExportThenPurgeResult>;
    /** 可用快照列表(按时间倒序;面板/工具据此选一份来恢复)。 */
    listSnapshots(opts?: {
        limit?: number;
    }): Promise<{
        items: SnapshotSummary[];
        total: number;
    }>;
    /**
     * 名字 → 真实快照。
     *
     * 两道判定合一:名字合法(`snapshotDirFor`)且**清单存在且版本相符**
     * (`readSnapshotManifest`)。只有前者会被"目录里有个同名空目录"骗过——
     * 而那正是半截写入的产物,选中它恢复会得到 0 条却报成功。
     */
    private resolveSnapshot;
    /**
     * 干跑:算出"这份快照恢复下去会发生什么",**不写库**。
     *
     * `missing` 才是真正被找回的条数——快照里绝大多数记录今天仍在库里(快照是
     * **全库**拷贝,而被清掉的只是其中几条)。只报 `targets` 会让人以为"要恢复 787 条",
     * 从而不敢按下去。
     */
    planSnapshotRestore(name: string, ids?: readonly string[]): Promise<SnapshotRestorePlan>;
    /**
     * 从快照恢复(不可逆动作的**回程票**;本身幂等,可安全重跑)。
     *
     * 向量按整批补算(`helper.batch`),失败即降级成"暂时只走关键词召回"而不中止——
     * 与 `restore` 同一条纪律:补不上向量是小事,让人以为记录丢了是大事。
     *
     * @param opts.unretire - 顺手把带退场标记的记录放回检索面(走既有 `restore`,
     *   不新开写路径)。默认 `false`:只回主表,与"恢复的是当时的状态"一致。
     */
    restoreFromSnapshot(name: string, opts?: {
        ids?: readonly string[];
        unretire?: boolean;
    }): Promise<SnapshotRestoreOutcome>;
    /** 这批 id 里当前**在库**的集合(分块查,避免一次 IN 太多参数)。 */
    private existingIds;
    /**
     * 三策略检索(自动召回与 memory_search 工具共用接缝)。
     * embedding 不可用时自动降级 keyword;type 后置过滤;
     * scoreThreshold 仅对 keyword/embedding 单路策略生效——hybrid 按官方语义
     * 融合完整列表(融合分已归一化 0~1,可直接用于展示/过滤)。
     */
    search(query: string, limit: number, opts?: L1SearchOptions): Promise<L1Hit[]>;
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
    private recencyLane;
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
    private graphLane;
    /**
     * 时效衰减加权(#29):三路共用的读路径后处理——阈值过滤之后、截断之前
     * (才能轮转名额,而不只是重排已截断的集合)。updated_at 经主表批量点查
     * 回填(FTS 表无该列;候选池 ≤ limit×3 条主键查询,微秒级)。关闭时零开销。
     */
    private applyDecay;
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
    }): {
        items: MemoryRecord[];
        total: number;
    };
    /** 场景名去重列表(UI 筛选器数据源)。 */
    distinctScenes(): string[];
    /** Hall 域计数(八边形角上"该域 N 条 / 未打标 M"数据源):按 metadata.hall 分组计数。 */
    wingCounts(): {
        counts: Record<string, number>;
        unlabeled: number;
    };
    /**
     * Room 计数(标签自生长分类):展开 metadata.tags 聚合,1 tag = 1 Room。
     *
     * tags 只在反刍的标签段变化,故带 30s TTL 缓存;反刍收尾显式 `invalidateRooms()`
     * 保证新涌现的 Room 立刻可见。降级时返回空数组(面板显示"暂无"而非报错)。
     */
    listRooms(): RoomCount[];
    /** 丢弃 Room 计数缓存(tags 写入侧调用:反刍标签段收尾 / 手工打标)。 */
    invalidateRooms(): void;
    /** 主表全量元数据扫描(单一所有者共享函数,供并行计划引用门禁复用;见 MemoryDb.scanL1Metadata)。 */
    scanAllMetadata(cb: (recordId: string, metadata: Record<string, unknown> | null) => void): number;
    /** 查询向量(域软门禁用):复用既有嵌入源;失败/未就绪返回 undefined,调用方降级。 */
    embedText(text: string, timeoutMs?: number): Promise<Float32Array | undefined>;
    /**
     * 去重候选召回(官方 3 级):空库跳过 → 向量优先 → FTS 兜底。
     * 传入 family 时只在同族记录里召回(去重永不跨族);传入 workspaceId 时
     * 只在**本工作区可见**的记录里召回(§E)——**去重也不跨工作区**。
     *
     * 这一层是 ADR-0008 特意点名的接缝:"scope 过滤必须落在与族隔离同一层"。
     * 理由:候选池决定**新的去重决策**,若此处跨工作区,产出的是「项目 B 里看不见、
     * 但已经决定了项目 A 记忆去向」的记录——比不隔离更糟。
     */
    searchCandidates(query: string, limit: number, family?: MemoryFamily, workspaceId?: string): Promise<MemoryRecord[]>;
    /**
     * 增量重嵌入(embedding 配置变化 / 周期性补齐用):只处理缺失向量的记录,
     * 排除已判定"当前 provider 不可嵌入"的 skip 集。返回写入/失败/跳过数——
     * failed > 0 时调用方不应标记 meta 同步完成;skipped(零向量)不算失败、
     * 不阻塞同步标记(否则补齐判据永不收敛,周期性全量重嵌死循环)。
     * onProgress/shouldCancel 供活切换的进度展示与取消。
     */
    reindex(opts?: {
        onProgress?: (done: number, total: number) => void;
        shouldCancel?: () => boolean;
    }): Promise<{
        written: number;
        failed: number;
        skipped: number;
        cancelled?: boolean;
    }>;
    private postProcess;
}
