/**
 * 孤儿记忆的 Room 候选预标记 + agent 逐个复查(长尾治理)。
 *
 * 背景:Room 由 metadata.tags 自生长,但 tags 只在反刍 relabel 段随 wing 补打
 * 顺带产出(每轮 ≤40 条、且只覆盖本轮补 wing 的记录)——「有 wing 无 tags」与
 * 「预算用尽被 deferred」的记录成为无 Room 绑定的孤儿,且标注器不参考现有
 * Room 词表,产出碎片化新 slug(81 个 Room 大多 1 条的成因)。
 *
 * 两段式:
 *  1. **预标记(annotateOrphanCandidates)**:抽取活跃孤儿,LLM 对照**现有 Room
 *     词表**产出候选(优先挂靠现有 Room,≤2 个新 slug 兜底),写
 *     `metadata.roomCandidates` + `roomReview:'pending'`——不动 tags、不进
 *     Room、不进召回,只是"待确认的建议"。
 *  2. **逐个复查(memory_room_review 工具)**:agent 取下一条待复查记录
 *     (带候选 + 现有 Room 词表),确认后 confirm 写入 tags(进 Room,高权限
 *     门控),或 skip 跳过。确认/跳过都是显式动作,预标记本身零行为面。
 *
 * 存储即 metadata 保留键(与 relabel 写 tags 同款 patchMetadata 合并纪律,
 * 写前重读):`roomCandidates` / `roomReview:'pending'|'confirmed'|'skipped'`。
 * 两键不在 rooms 聚合(rooms 只读 $.tags)、不在快照哈希投影关注的治理列——
 * 与既有 metadata 键同层,无 schema 变更。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { MemoryConfig } from './config.js';
import { isRoomSlug } from './metadata-validators.js';
import { callLLM, parseJsonLogged } from './llm.js';
import type { MemoryLogger, MemoryRecord } from './types.js';

export const ROOM_CANDIDATES_KEY = 'roomCandidates';
export const ROOM_REVIEW_KEY = 'roomReview';
export type RoomReviewState = 'pending' | 'confirmed' | 'skipped';

/** 复查与候选操作对 L1 的最小依赖面(便于测试注入)。 */
export interface RoomReviewStore {
  list(opts: {
    untagged?: boolean;
    retired?: boolean;
    limit: number;
    offset: number;
  }): { items: MemoryRecord[]; total: number };
  getByIds(ids: readonly string[]): MemoryRecord[];
  patchMetadata(id: string, metadata: Record<string, unknown>): boolean;
  listRooms(): Array<{ room: string; count: number }>;
    /** 确认写 tags 后失效 Room 计数缓存(30s TTL)。 */
  invalidateRooms(): void;
}

/** merge/rename 的 store 面(RoomReviewStore + 游标重写与备份;L1Store 已实现)。 */
export interface RoomMergeStore extends RoomReviewStore {
  listByTagAll(tag: string, cap?: number): MemoryRecord[];
  backupTagRecords(tag: string): { file: string; count: number };
  rewriteTag(
    from: string,
    to: string,
    cap?: number,
  ): { rewritten: number; scanned: number; families: string[]; scenes: string[]; hasMore: boolean };
}

/** Room 注册表最小面(merge 收尾;RoomRegistryStore 已满足)。 */
export interface RoomRegistryMerge {
  markMerged(fromSlug: string, toSlug: string): Promise<boolean>;
  renameSlug(oldSlug: string, newSlug: string): Promise<boolean>;
  /** rename 收尾恢复先前状态用(active 条目改名后不掉出标注词表)。 */
  bySlug?(slug: string): { status: 'active' | 'retired' } | undefined;
  setStatus?(slug: string, status: 'active' | 'retired'): Promise<boolean>;
}

export interface RoomCandidate {
  id: string;
  rooms: string[];
}

/** 解析标注器输出的逐条候选(容错:id 配对失败丢弃;isRoomSlug 校验(两级制);目录内优先,≤3)。 */
export function parseRoomCandidateItems(
  parsed: ReadonlyArray<{ id: string; rooms: readonly string[] }>,
  ids: ReadonlyArray<string>,
  roomCatalog: ReadonlyArray<{ room: string; count: number }>,
): RoomCandidate[] {
  const idSet = new Set(ids);
  const catalogSet = new Set(roomCatalog.map((r) => r.room));
  const byId = new Map<string, string[]>();
  for (const item of parsed) {
    if (!idSet.has(item.id)) continue;
    const cleaned: string[] = [];
    for (const r of item.rooms) {
      const slug = typeof r === 'string' ? r.trim().toLowerCase() : '';
      // 两级制(`major` 或 `major/minor`)：与 rooms-registry 同一判据。用 isTag 会把
      // `mpu/qos` 这类合法子类静默丢掉——注册表收得下、写回却挂不上(issue #12)。
      if (!slug || !isRoomSlug(slug)) continue;
      if (!cleaned.includes(slug)) cleaned.push(slug);
    }
    // 目录内优先排前,其余兜底;截断到 3
    cleaned.sort((a, b) => Number(catalogSet.has(b)) - Number(catalogSet.has(a)));
    byId.set(item.id, cleaned.slice(0, 3));
  }
  return [...byId.entries()].map(([id, rooms]) => ({ id, rooms }));
}

/** 候选标注系统 prompt:喂现有 Room 词表(带计数),优先挂靠、少量新建兜底(逐条)。 */
export function roomCandidateSystemPrompt(roomCatalog: ReadonlyArray<{ room: string; count: number }>): string {
  const catalog =
    roomCatalog.length > 0
      ? roomCatalog
          .slice(0, 40)
          .map((r) => `- ${r.room}(现有 ${r.count} 条)`)
          .join('\n')
      : '(暂无现有 Room)';
  return (
    '你是记忆库的 Room 归类器。给你一条记忆与现有 Room 词表(带计数),' +
    '为这条记忆选出它最可能归属的 1-3 个 Room slug。规则:\n' +
    '1. **优先从现有 Room 词表里选**(保持分类收敛,避免碎片化);\n' +
    '2. 词表确实没有合适主题时,才提议最多 2 个新 slug(小写字母/数字/连字符);\n' +
    '3. 完全无法判断时返回空数组(宁缺毋滥,不硬猜)。\n' +
    `现有 Room 词表:\n${catalog}\n\n` +
    '输出 JSON 对象:{"rooms":["slug1","slug2"]}。只输出 JSON,不要多余文字。'
  );
}

/**
 * 候选标注器:一条孤儿记录 → 候选 Room(优先现有词表;失败返回 null,调用方零改动)。
 *
 * **一个请求只装一条**(旧名 `roomCandidateChunk`,多条一次,已废)。
 */
export async function roomCandidateOne(
  ctx: Context,
  cfg: MemoryConfig,
  logger: MemoryLogger,
  rec: MemoryRecord,
  roomCatalog: ReadonlyArray<{ room: string; count: number }>,
): Promise<string[] | null> {
  const user = `记忆:\n${rec.content.slice(0, 900)}`;
  try {
    const raw = await callLLM(ctx, cfg, {
      system: roomCandidateSystemPrompt(roomCatalog),
      user,
      maxTokens: 1024,
      layer: 'l1-extract',
      // 归类是直答任务：显式关思考（不然思考模型把预算烧在 reasoning 上吐 0 字符）。
      reasoningEffort: 'off',
      logger,
    });
    const parsed = parseJsonLogged<Record<string, unknown> | Array<Record<string, unknown>>>(raw, 'Room 候选标注', logger);
    // 通吃两种形状:模型偶尔回单元素数组(或带 id 的旧形状)。
    const obj = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!obj || typeof obj !== 'object') return [];
    const roomsRaw = Array.isArray((obj as { rooms?: unknown }).rooms)
      ? ((obj as { rooms: unknown[] }).rooms as string[])
      : [];
    // 复用既有清洗(目录内优先排前、去重、截断 3):用单元素数组喂它(忽略模型回的自报 id)。
    const cleaned = parseRoomCandidateItems([{ id: rec.id, rooms: roomsRaw }], [rec.id], roomCatalog);
    return cleaned[0]?.rooms ?? [];
  } catch (err) {
    logger.warn(
      `[memory] Room 候选标注单条失败(id=${rec.id},原记录未改): ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export interface OrphanAnnotateIO {
  l1: RoomReviewStore;
  logger: MemoryLogger;
  /** Room 注册表(可选:未装配 = 词表只用自生长聚合,无注册条目)。 */
  registry?: { listActive(): Array<{ slug: string; label?: string; description?: string }> };
}

/** 活跃孤儿的选择器:untagged + 未退场,跳过已 skipped 的。 */
function selectPendingOrphans(
  l1: RoomReviewStore,
  limit: number,
): MemoryRecord[] {
  const out: MemoryRecord[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset < 2000; offset += 200) {
    const page = l1.list({ untagged: true, retired: false, limit: 200, offset });
    for (const r of page.items) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      if ((r.metadata as Record<string, unknown>)?.[ROOM_REVIEW_KEY] === 'skipped') continue;
      out.push(r);
      if (out.length >= limit) return out;
    }
    if (page.items.length < 200) break;
  }
  return out;
}

/**
 * 预标记消费器:活跃孤儿(≤limit 条)批量产候选并写 pending。
 * 写前重读合并(与 relabel 同纪律);失败单条跳过、原记录零改动。
 */
export interface OrphanAnnotateOverrides {
  /** 测试注入口:替换 LLM 候选标注器(默认走真实 callLLM 路径);第二参为合并词表。
   *  **逐条**形状:返回该条的候选 slug(空数组 = 无法判断),失败返回 null。 */
  annotator?: (
    rec: MemoryRecord,
    catalog: ReadonlyArray<{ room: string; count: number; label?: string; description?: string }>,
  ) => Promise<string[] | null>;
}

export async function annotateOrphanCandidates(
  ctx: Context,
  cfg: MemoryConfig,
  io: OrphanAnnotateIO,
  limit = 40,
  overrides: OrphanAnnotateOverrides = {},
): Promise<{ selected: number; candidates: number; written: number }> {
  const selected = selectPendingOrphans(io.l1, limit);
  if (selected.length === 0) return { selected: 0, candidates: 0, written: 0 };
  // 合并词表:注册表条目排前(附 description,对 LLM 归类价值最高),封顶 120;
  // 无注册表 = 纯自生长聚合(计数降序)。整批共享一张词表(一次 LLM 调用)。
  const grown = io.l1.listRooms();
  const regActive = io.registry?.listActive() ?? [];
  const regSet = new Set(regActive.map((e) => e.slug));
  const merged = [
    ...regActive.map((e) => ({ room: e.slug, count: 0, label: e.label, description: e.description })),
    ...grown.filter((r) => !regSet.has(r.room)).map((r) => ({ room: r.room, count: r.count })),
  ].slice(0, 120);
  const annotate =
    overrides.annotator ??
    ((rec: MemoryRecord) => roomCandidateOne(ctx, cfg, io.logger, rec, merged));
  let written = 0;
  let candidates = 0;
  // 逐条串行:取一条 → 产候选 → 当场写 pending。不攒批、不合并。
  for (const rec of selected) {
    const rooms = await annotate(rec, merged);
    if (!rooms || rooms.length === 0) continue;
    candidates++;
    const fresh = io.l1.getByIds([rec.id])[0];
    if (!fresh) continue;
    const meta = { ...(fresh.metadata ?? {}) } as Record<string, unknown>;
    meta[ROOM_CANDIDATES_KEY] = rooms;
    meta[ROOM_REVIEW_KEY] = 'pending';
    if (io.l1.patchMetadata(rec.id, meta)) written++;
  }
  io.logger.info(
    `[memory] 孤儿候选预标记:选中 ${selected.length},产候选 ${candidates},写 pending ${written} 条(待 agent 复查)`,
  );
  return { selected: selected.length, candidates, written };
}

/** 待复查队列:pending 且有候选的活跃孤儿,按更新时间升序(最旧的先复查)。 */
function pendingQueue(l1: RoomReviewStore): MemoryRecord[] {
  const out: MemoryRecord[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset < 2000; offset += 200) {
    const page = l1.list({ untagged: true, retired: false, limit: 200, offset });
    for (const r of page.items) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      if (meta[ROOM_REVIEW_KEY] === 'pending' && Array.isArray(meta[ROOM_CANDIDATES_KEY])) out.push(r);
    }
    if (page.items.length < 200) break;
  }
  return out.sort((a, b) => a.updatedAt - b.updatedAt);
}

/** merge 单飞哨兵(模块级;与 ruminate/wing-backfill 的时间错开由调用方保证)。 */
let roomMergeRunning = false;

export interface MergeRoomResult {
  dryRun: boolean;
  /** 影响条数(dryRun=预览数;实跑=实际重写数)。 */
  affected: number;
  preview: string[];
  applied: number;
  hasMore: boolean;
  backupFile?: string;
  /** 实跑时回传:受影响的族与场景(调用方入队 recluster 'room-merge')。 */
  families?: string[];
  scenes?: string[];
}

/**
 * Room merge/rename 编排(破坏性动作,分类管理 beta.5):
 *  - dryRun(缺省 true):只统计 affected + 前 6 条预览,**零写入**;
 *  - 实跑:执行前备份(matching rows → rooms-merge-backups/)→ 游标重写
 *    (写前重读-合并-写回,其余 metadata 键保全)→ 注册表 markMerged/renameSlug
 *    → 返回受影响 (family, scene) 供调用方入队 recluster('room-merge');
 *  - 单飞:并发 merge 直接抛错;与 relabel/ruminate 的时间错开由调用方保证。
 * 抛错语义:非法参数/注册表冲突直接抛(调用方转 notice)。
 */
export async function mergeRoom(
  io: { l1: RoomMergeStore; registry: RoomRegistryMerge; logger: MemoryLogger },
  from: string,
  to: string,
  opts: { dryRun?: boolean; cap?: number } = {},
): Promise<MergeRoomResult> {
  const dryRun = opts.dryRun !== false;
  const cap = Math.min(Math.max(opts.cap ?? 500, 1), 2000);
  if (from === to) throw new Error('from 与 to 相同');
  if (!from.trim()) throw new Error('from 不能为空');
  if (roomMergeRunning) throw new Error('Room merge 已在进行中(单飞)');
  const previewRows = io.l1.listByTagAll(from, 7);
  const affected = io.l1.listByTagAll(from, cap + 1).length;
  const preview = previewRows.slice(0, 6).map((r) => r.id);
  if (dryRun) return { dryRun: true, affected, preview, applied: 0, hasMore: affected > cap };
  if (roomMergeRunning) throw new Error('Room merge 已在进行中(单飞)');
  roomMergeRunning = true;
  try {
    const backup = io.l1.backupTagRecords(from);
    io.logger.info(`[memory] Room merge 备份:${from} → ${to},${backup.count} 条 → ${backup.file}`);
    let applied = 0;
    const hasMore = false; // 循环到收敛,单次调用内 hasMore 恒 false(重写返回值沿用结果形状)
    const families = new Set<string>();
    const scenes = new Set<string>();
    // 游标重写:上限 cap/次,r.hasMore 时继续(总量受 cap×轮次约束,单飞内收敛)
    for (;;) {
      const r = io.l1.rewriteTag(from, to, cap);
      applied += r.rewritten;
      for (const f of r.families) families.add(f);
      for (const sc of r.scenes) scenes.add(sc);
      if (!r.hasMore || r.rewritten === 0) break;
    }
    await io.registry.markMerged(from, to);
    io.l1.invalidateRooms();
    io.logger.info(`[memory] Room merge 完成:${from} → ${to},重写 ${applied} 条;受影响场景 ${scenes.size} 个`);
    return {
      dryRun: false,
      affected,
      preview,
      applied,
      hasMore,
      backupFile: backup.file,
      ...(families.size > 0 || scenes.size > 0 ? { families: [...families], scenes: [...scenes] } : {}),
    };
  } finally {
    roomMergeRunning = false;
  }
}

/** rename = merge 1:1 + 注册表改名(冲突时抛错提示走 merge)。
 *  归类语义:改名**不是退役**——merge 编排的 markMerged 会把旧条目置 retired,
 *  这里在改名后恢复其先前状态(active 条目改名后仍 active,不掉出标注词表)。 */
export async function renameRoom(
  io: { l1: RoomMergeStore; registry: RoomRegistryMerge; logger: MemoryLogger },
  from: string,
  to: string,
  opts: { dryRun?: boolean; cap?: number } = {},
): Promise<MergeRoomResult> {
  const priorStatus = io.registry.bySlug?.(from)?.status ?? 'active';
  const r = await mergeRoom(io, from, to, opts);
  if (!r.dryRun && r.applied > 0) {
    await io.registry.renameSlug(from, to);
    if (priorStatus === 'active') await io.registry.setStatus?.(to, 'active');
  }
  return r;
}

/** 下一条待复查(供 agent 逐个过):记录摘要 + 候选 + 现有 Room 词表 + 剩余数。 */
export function nextReview(
  l1: RoomReviewStore,
): {
  id: string;
  content: string;
  type: string;
  sceneName: string;
  candidates: string[];
  roomCatalog: Array<{ room: string; count: number }>;
  remaining: number;
} | null {
  const queue = pendingQueue(l1);
  if (queue.length === 0) return null;
  const r = queue[0];
  const meta = (r.metadata ?? {}) as Record<string, unknown>;
  return {
    id: r.id,
    content: r.content.slice(0, 600),
    type: r.type,
    sceneName: r.scene_name,
    candidates: (meta[ROOM_CANDIDATES_KEY] as string[] | undefined) ?? [],
    roomCatalog: l1.listRooms().slice(0, 40),
    remaining: queue.length,
  };
}

/** 待复查剩余数(面板/工具兜底信息)。 */
export function pendingReviewCount(l1: RoomReviewStore): number {
  return pendingQueue(l1).length;
}

/**
 * 确认复查结果:候选(或 agent 改写的)写入 metadata.tags(**进 Room**),
 * 清候选、标 confirmed。**高权限门控由调用方执行**(与 memory_delete 同款)。
 * 返回写入的 tags;id 不存在/状态非法返回 null。
 */
export function confirmReview(
  l1: RoomReviewStore,
  id: string,
  rooms: readonly string[],
): { tags: string[] } | null {
  const found = l1.getByIds([id])[0];
  if (!found) return null;
  const meta = { ...(found.metadata ?? {}) } as Record<string, unknown>;
  // 已确认/已跳过的不允许重复确认(防止 agent 循环空转)
  if (meta[ROOM_REVIEW_KEY] === 'confirmed') return null;
  const cleaned: string[] = [];
  for (const r of rooms) {
    if (typeof r !== 'string') continue;
    const slug = r.trim().toLowerCase();
    // 同 parseRoomCandidateItems：走两级制判据，否则 `mpu/qos` 会被判非法、
    // confirm 返回 null 且错误文案误导成"id 不存在"(issue #12)。
    if (!slug || !isRoomSlug(slug) || cleaned.includes(slug)) continue;
    cleaned.push(slug);
  }
  if (cleaned.length === 0) return null;
  meta.tags = cleaned;
  delete meta[ROOM_CANDIDATES_KEY];
  meta[ROOM_REVIEW_KEY] = 'confirmed';
  if (!l1.patchMetadata(id, meta)) return null;
  l1.invalidateRooms();
  return { tags: cleaned };
}

/** 跳过:标 skipped(不再进 pending 队列)。已 confirmed 的记录不受 skip 影响(挂了 Room 的不算长尾)。 */
export function skipReview(l1: RoomReviewStore, id: string): boolean {
  const found = l1.getByIds([id])[0];
  if (!found) return false;
  const meta = { ...(found.metadata ?? {}) } as Record<string, unknown>;
  if (meta[ROOM_REVIEW_KEY] === 'confirmed') return false;
  meta[ROOM_REVIEW_KEY] = 'skipped';
  return l1.patchMetadata(id, meta);
}
