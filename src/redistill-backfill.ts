/**
 * 存量记忆重蒸馏整形回填（redistill）。
 *
 * 职责：对**活跃**且 `scoreSkeleton` 判「骨架不齐备」的 L1 记录，**一条一个请求**送 LLM
 * 把正文重排成 G2 分类型的 `## 节名` 分节骨架，并顺带产 `dsh_keywords` / `dsh_usage_scenario`；
 * 只有**整形后骨架分严格更优且无空心标题**才写回（并盖当前整形版本戳），否则留原文**不打标记**——
 * 下轮仍可再试（用户定：「成功替换的」才不再进入重蒸馏）。
 *
 * 与 keyword-backfill 的关键差异（为什么它更重一档）：
 * - **改 content** ⇒ 写回必须走 `L1Store.appendNew`（追加 JSONL 事实源 + upsertL1 重嵌+FTS +
 *   fireFileSync 重导出），**不能**走 `MemoryBackend.patchMetadata*`（只改元数据、不动正文），
 *   也**不能**走 worker backend（`memory-backend.ts` 明示 upsert 会重嵌、worker 拿不到
 *   embedding service 会写零向量毁数据）。故本模块 deps 直取 `l1: L1Store`（进程内）。
 * - **入口 `vectorsReady()` 守卫**：`upsertL1InTx` 先删向量行、仅非零 embedding 才插回；
 *   embed 未就绪时改正文会静默丢该记录向量。故向量未就绪 ⇒ 整轮回跳过（整形是可选优化，不抢这个险）。
 *
 * 安全边界（继承 keyword/wing 回填）：
 * - 单飞：同时最多一个任务，重复触发返回 running（不排队不叠加）
 * - 后台执行：端点立即返回，逐条推进并**每条即时提交**，不阻塞 RPC/管线
 * - 失败可退：LLM 失败/输出非法/质量闸不过 ⇒ 原记录零改动（写回只发生在严格更优且 embed 就绪时）
 * - 有界：单次最多 cfg.backfill.maxRecords 条 + timeBudgetMs 墙钟；其余计入 deferred 可再触发
 * - 排除靠**版本戳**：成功写回盖 `dsh_reshape_ver = RESHAPE_SCHEMA_VERSION`；扫描只排「当前版本
 *   已整过」的（存量兼容：只有旧布尔 `dsh_reshape_tried` 且正文确为 `## 分节`式也算已整）。
 *   整形规则/提示词改变时把 `RESHAPE_SCHEMA_VERSION` 递增，旧产物即自动重新入列。
 * - 门控关（`cfg.redistill.enabled = false`）：入口立即跳过——不动 content、FTS、投射逐字不变
 *
 * 形状约定（用户定）：**按单元、串行、不合并**——一个请求只装一条记忆，跑完一条再发下一条。
 * 扫描期就用 SQL 退场判据 + 骨架判据筛出真目标（旧实现收 1221 条候选、每批 20 条只命中 ~4 条）。
 * `cfg.backfill.concurrency` 默认 1（串行）；拖高概览页滑块可临时多路在飞（上限 8）。
 * 注意：本任务直接调 `callLLM`、不进 runner 队列，拿不到“live 优先”的让位保护。
 */
import type { Context } from '@deepseek-ai/cordis';
import { callLLM, parseJsonLogged } from './llm.js';
import { normKeywords, normUsageScenario, KEYWORDS_METADATA_KEY } from './metadata-validators.js';
import { scoreSkeleton } from './prompts/examples.js';
import { normalizeContentMd } from './util/md-normalize.js';
import { yieldLoop } from './util/yield.js';
import type { L1Store } from './store/l1.js';
import type { MemoryConfig } from './config.js';
import type { MemoryLogger, MemoryRecord } from './types.js';

// 一次 LLM 调用只处理**一条**记忆（旧形状是 20 条/次，已改）。
// 为什么不批量：本任务的输出是「整条正文重写」，20 条一批意味着单请求要生 5000+ token——
// 真机实测因此把单请求拖到 200s+ 并在超时线上被掐死，而且主路由（小模型）一次空转
// 就带走整批 20 条。实测「每条一个请求」在 35B 端点上只要 ~2.6s（4 路并发 3.2s），
// 251 条 ≈ 3 分钟——批量在这里不省任何时间，只堆风险。

/** 扫描页大小。 */
const PAGE = 200;
/** 单次任务默认处理上限（cfg.backfill.maxRecords 优先）。 */
const DEFAULT_MAX_RECORDS = 40;
/** 总墙钟默认预算（cfg.backfill.timeBudgetMs 优先）。 */
const DEFAULT_TIME_BUDGET_MS = 1_800_000;
/**
 * 默认并行度（cfg.backfill.concurrency 优先）：1 = 串行逐条（用户定的形状）。
 * 想临时提速就拖概览页滑块；本端点的实测标定是 conc=4 最优（再高因排队反而变慢）。
 */
const DEFAULT_CONCURRENCY = 1;
/**
 * 一次调用（含整条回退链）的默认超时（cfg.backfill.callTimeoutMs 优先）。
 *
 * 单条实测 ~2.6s，给 240s 不是为常规速度，而是为回退链留位：主路由（小模型）
 * 可能先空转一轮再降级，预算得按「路由数 × 单路由耗时」算，而不是按成功路径算。
 */
const DEFAULT_CALL_TIMEOUT_MS = 240_000;
/** 单条整形的输出预算（一条 ≤300 字正文 + 分节标题 + 5 关键词，实测 165-175 token）。 */
const RESHAPE_MAX_TOKENS = 1024;
/**
 * 整形**版本戳**：只在**成功替换**时写入，值为当前整形规则版本（`RESHAPE_SCHEMA_VERSION`）。
 * 扫描阶段据此排除「已按当前规则整过形」的记录——见 `isReshapedAtCurrentVersion`。
 */
export const RESHAPE_VER_KEY = 'dsh_reshape_ver';
/**
 * 当前整形规则版本。**改动整形骨架/提示词/输出契约时必须 +1**，否则旧产物不会重跑。
 * v1 = 行内标签式（`规则：/触发时机：`，已废）；v2 = `## 节名` 分节 + 空心标题闸。
 */
export const RESHAPE_SCHEMA_VERSION = 2;
/**
 * 旧版遗留的布尔「试过」标记（**不再新写**）：旧逻辑给「写回」与「留原文」都打上它，
 * 于是「没改成的」也被永久排除。现仅作存量兼容读取（见 `isReshapedAtCurrentVersion`）。
 */
const RESHAPE_TRIED_KEY = 'dsh_reshape_tried';
/** 分节标题判定（与 `hasHollowHeading` 同口径：`#`/`##` 后必须有非空标题字）。 */
const HEADING_RE = /^\s*#{1,6}\s+\S/;

export interface RedistillBackfillDeps {
  ctx: Context;
  cfg: MemoryConfig;
  /** 直取 L1Store（进程内）：改 content 要 appendNew 重嵌 + 追加 JSONL + 投射点火，不经 worker backend。 */
  l1: L1Store;
  logger: MemoryLogger;
  /**
   * 运行时**生效并发**读取器（可选）：给正在跑的任务即时改并发用——池子每完成一条重读一次。
   * 缺省 = 启动时读一次 `cfg.backfill.concurrency`（旧行为）。
   */
  concurrency?: () => number | undefined;
}

export interface RedistillBackfillState {
  running: boolean;
  /** 整形成功写回条数。 */
  updated: number;
  /** 质量闸判不写（留原文）条数。 */
  skipped: number;
  /** 失败/跳过（LLM 失败、id 配不上、embed 掉线）条数。 */
  failed: number;
  /** 分批进度（UI 轮询据此显示「扫描中 / 第几条」，否则运行期只有一个「整形中…」）： */
  /** 每个请求处理的条数——本任务已改成逐条，永远为 1（保留字段与 keyword 同形状）。 */
  chunk: number;
  /** 扫描阶段确定的**真目标**总数（骨架不齐备且未试过；扫描未完成时为已发现数）。 */
  candidates: number;
  /** 本次已完成（送过 LLM 且已提交结果）条数。**在请求完成时才自增**——
   *  在开始处加会让“全部超时失败”跟“全部成功”长得一模一样。 */
  processed: number;
  /** 仍在扫描阶段（此阶段 candidates 还在动，UI 应报「扫描中」而非「第 N 条」）。 */
  scanning: boolean;
  /** 已完成条数（与 processed 同值，保留为与 keyword 共用的进度形状）。 */
  batchesDone: number;
  /** 本次要处理的总条数。 */
  batchTotal: number;
  /** LLM 批调用并行度。 */
  concurrency: number;
  /** 预算/上限用尽未处理、留下次的条数。 */
  deferred: number;
  /** 本轮被人工中止（进端点 cancel）——与“预算用尽”分开报文案。 */
  cancelled: boolean;
  /**
   * 扫描期已扫行数（活跃集逐页扫）/ 总行数（本模块拿不到总数，恒 0 = 未知）。
   * 为何要暴露：扫描段原本在面板上只是一个静态「正在扫描…」，分不清在跑还是卡死。
   */
  scanned: number;
  scanTotal: number;
}

const state: RedistillBackfillState = {
  running: false, updated: 0, skipped: 0, failed: 0,
  chunk: 1, candidates: 0, processed: 0,
  scanning: false, batchesDone: 0, batchTotal: 0, concurrency: DEFAULT_CONCURRENCY, deferred: 0,
  cancelled: false, scanned: 0, scanTotal: 0,
};

/**
 * 人工中止信号。置位后：①池子不再派新活；②已发出的请求先拿**宽限**(cancelGraceMs)
 * 自然收工（token 不白费、已写回的全入账）；③**宽限到期强杀**在飞请求——
 * 没有③的话「中止」最坏要等满 callTimeoutMs(240s) 才生效，等于没中止。
 */
let abortRequested = false;
/** 本轮在飞请求的强杀器（runOnce 入口新建）。 */
let runAbort: AbortController | null = null;
/** 中止宽限计时器（一次性）。 */
let graceTimer: ReturnType<typeof setTimeout> | null = null;
/** 本轮生效的中止宽限（启动时从 cfg 读定，已钳位）。 */
let graceMs = 15_000;

/**
 * 中止宽限钳位。**硬界 30s**（用户定：中止必须在 30s 内强停）——无论 YAML 写了多少，
 * 都不会超过这个值；未配置/非法取默认 15s。
 */
function clampGraceMs(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : 15_000;
  return Math.min(30_000, Math.max(0, n));
}

/** 请求中止本轮（空闲时无副作用）；返回后中止是**有界**的：最多等 graceMs(≤60s)。 */
export function cancelRedistillBackfill(): { cancelled: boolean; running: boolean } {
  if (!state.running) return { cancelled: false, running: false };
  abortRequested = true;
  if (graceTimer === null) {
    graceTimer = setTimeout(() => {
      graceTimer = null;
      if (state.running) runAbort?.abort();
    }, Math.max(0, graceMs));
  }
  return { cancelled: true, running: true };
}

export function redistillBackfillState(): RedistillBackfillState {
  return { ...state };
}

// ── SYSTEM 提示词（定稿版，由 tools/redistill.prompt.md 的 ```text 块迁移） ──
const SYSTEM_PROMPT = [
  '你是记忆库的存量记忆整形器。给定**一条**已有记忆（含类型、标题、当前正文），为它做两件事：',
  '1) 把正文按该记忆的类型重排成**带 markdown 小标题的分节陈述**；2) 提炼 keywords 与 usage_scenario。',
  '',
  '【分节格式硬要求】每个要素写成一个 `## 节名` 小节，节名**逐字**用在下面列出的类型要素名（如 `## 规则`、`## 触发时机`），节名后换行写正文：',
  '- 判定器按这些要素词认骨架，自拟同义词会被判缺。',
  '- **绝不允许空节**：`## 节名` 下面必须有实质正文；信息不足以填满某节时**整节省略该标题**（连标题一起不写），绝不编造。',
  '',
  '【内容骨架】按类型写成对应要素链（让记忆自带因果链而非零散一句）：',
  '- work_method：目标 → 步骤(每步带为什么) → 前置/注意',
  '- work_fact：结论/事实 → 依据(谁在何时确认) → 适用范围/失效条件',
  '- work_task：任务 → 当前状态 → 下一步/阻塞(负责人·截止)',
  '- work_artifact：交付物 → 位置(路径/链接) → 用途/结论',
  '- instruction：规则 → 触发时机 → 反例/边界',
  '- episodic：事件 → 时间/参与者 → 结果',
  '- persona：偏好/习惯 → 表现/例子 → 强度',
  '正文整形硬约束：',
  '- 只重排、不新增事实、不删既有事实——原文里的具体标识（文件名/函数/配置项/命令/错误码/版本号/数字阈值/日期/路径）必须原样保留。',
  '- 信息不足以填满某节时省略该节，绝不编造；保持精炼、不堆砌、不写空话套话。',
  '- 用与原文相同的语言；技术标识符、API 名、错误码原样保留。',
  '- 若原文已具备该类型骨架、无需整形，就把 content 原样返回（不要为改而改）。',
  '',
  '【keywords】唯一判据：用户未来会输入什么词把这条记忆捞出来。优先具体名词性标识（项目/模块/文件/函数/配置项/命令/错误码/版本号/数字阈值/工具名/专有实体名）。禁止把正文里的动宾短语压缩成抽象黑话当关键词。2–5 个（宁少勿滥）；每个 2–6 词或 1 个复合术语；不得与标题字面重复、不得互相近义堆叠。',
  '【usage_scenario】1–3 条；每条 5–10 词的短场景描述（不是完整命令句）；彼此必须可区分，相似的合并成更泛化的一条。',
  '',
  '输出：只输出**一个 JSON 对象**（不是数组），不要多余文字、不要解释。形如：',
  '{"content":"<整形后正文>","keywords":["…"],"usage_scenario":["…"]}',
].join('\n');

/**
 * 空心标题检测：某个 `## 节名` 到下一标题之间没有实质文字。
 *
 * 为什么需要它：判定器（`scoreSkeleton`）按子串命中认骨架，而标题词本身就是那个子串——
 * 只写 `## 触发时机` 不写内容就能白得一个命中。不堵这个闸，“加分才写回”会退化成
 * “加空标题就写回”，正文反而被掏空了。
 */
export function hasHollowHeading(content: string): boolean {
  const lines = content.split('\n');
  const isHeading = (s: string): boolean => /^\s*#{1,6}\s+\S/.test(s);
  for (let i = 0; i < lines.length; i++) {
    if (!isHeading(lines[i])) continue;
    let body = '';
    for (let j = i + 1; j < lines.length && !isHeading(lines[j]); j++) body += lines[j];
    // 只剩空白/标点/项目符的节 = 空节
    if (body.replace(/[\s\-–—*·:：、.,;]/g, '') === '') return true;
  }
  return false;
}

/** 质量闸：整形后骨架命中数严格上升（或旧不齐备且新齐备）且正文非空、无空心标题 → 判可写。 */
export function reshapePassesGate(type: string, oldContent: string, newContent: string): boolean {
  const body = typeof newContent === 'string' ? newContent.trim() : '';
  if (body.length === 0) return false;
  if (hasHollowHeading(body)) return false;
  const o = scoreSkeleton(type, oldContent || '');
  const n = scoreSkeleton(type, body);
  return (n.齐备 && !o.齐备) || n.命中数 > o.命中数;
}

/**
 * 是否已按**当前版本**整理过 → 扫描阶段排除（用户定：「成功替换的」才不再进入）。
 *
 * 判据：
 * - 带当前版本戳（`dsh_reshape_ver === RESHAPE_SCHEMA_VERSION`）⇒ 已成功替换，排除；
 * - 旧存量兼容：只有布尔 `dsh_reshape_tried`（成功与留原文都打过，无法区分）+ 正文确实是
 *   `## 分节`式 ⇒ 视为已整形排除；**不带标题的则重新入列**（它们是「试过但没改成」的，
 *   或首轮行内标签式产物，都该重跑）。
 */
export function isReshapedAtCurrentVersion(
  meta: Record<string, unknown> | undefined,
  content: string,
): boolean {
  if (meta?.[RESHAPE_VER_KEY] === RESHAPE_SCHEMA_VERSION) return true;
  if (meta?.[RESHAPE_TRIED_KEY] === true) return content.split('\n').some((l) => HEADING_RE.test(l));
  return false;
}

/** 并发度钳位（与 schema 的 min1/max8 同口径，但解析路径上不能假设 schema 跑过）。 */
function clampConcurrency(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : DEFAULT_CONCURRENCY;
  return Math.min(8, Math.max(1, n));
}

/** 启动后台重蒸馏回填；已在运行返回 false（单飞）。 */
export function startRedistillBackfill(deps: RedistillBackfillDeps): { started: boolean; running: boolean } {
  if (state.running) return { started: false, running: true };
  state.running = true;
  state.updated = 0;
  state.skipped = 0;
  state.failed = 0;
  state.candidates = 0;
  state.processed = 0;
  state.scanning = true;
  state.batchesDone = 0;
  state.batchTotal = 0;
  state.deferred = 0;
  state.cancelled = false;
  abortRequested = false;
  state.concurrency = clampConcurrency(deps.cfg.backfill?.concurrency);
  void runRedistillBackfillOnce(deps).finally(() => {
    state.running = false;
    state.scanning = false;
    deps.logger.info(
      `[memory] redistill 回填结束:写回 ${state.updated} 条,留原文 ${state.skipped} 条,失败 ${state.failed} 条`
      + (state.deferred > 0 ? `,留待下次 ${state.deferred} 条` : ''),
    );
  });
  return { started: true, running: true };
}

/**
 * 回填主体（导出供单测 await 到完成；生产走 `startRedistillBackfill` 的单飞后台包装）。
 * 门控关或向量未就绪 ⇒ 入口即返回，不碰任何记录、FTS、投射。
 *
 * 阶段划分对齐反刍重标定（`pipeline/relabel.ts`）：**机械扫描期把筛子下推到底**，
 * LLM 期只吃真目标、逐条推进、**每条即时提交**、条间受墙钟预算约束。
 * 形状约定（用户定）：**按单元、串行、不合并**——`concurrency` 默认 1（跑完一条再发下一条），
 * 拖高概览页滑块只是临时提速。旧形状（20 条一批）真机把单请求拖到 200s+ 并在超时线上被掐。
 */
export async function runRedistillBackfillOnce(deps: RedistillBackfillDeps): Promise<void> {
  const { cfg, l1, logger } = deps;
  // 新一轮入口清中止信号：abortRequested 是模块级，直调 runOnce 的路径（单测/未来调用方）
  // 不经过 startX 的复位，上一轮的中止信号会粘住这一轮。
  abortRequested = false;
  state.cancelled = false;
  if (graceTimer !== null) { clearTimeout(graceTimer); graceTimer = null; }
  runAbort = new AbortController();
  if (!cfg.redistill?.enabled) {
    logger.info('[memory] redistill 回填跳过：redistill.enabled = false（功能关，不整形）');
    return;
  }
  if (!l1.vectorsReady()) {
    logger.info('[memory] redistill 回填跳过：向量未就绪（改正文会静默丢向量，等嵌入就绪后再触发）');
    return;
  }
  const MAX_RECORDS = cfg.backfill?.maxRecords ?? DEFAULT_MAX_RECORDS;
  const TIME_BUDGET_MS = cfg.backfill?.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  graceMs = clampGraceMs(cfg.backfill?.cancelGraceMs);
  const LIMIT = clampConcurrency(cfg.backfill?.concurrency);
  state.concurrency = LIMIT;
  const startedAt = Date.now();

  // ── 扫描阶段（分页 + 每页让位，**不设墙钟**：轻量 SQL 扫描不是 LLM 调用的对手）──
  // 退场判据在 SQL 里（`retiredL1Sql`），骨架判据在这里——两关都过才进真目标集。
  // 旧实现只按“未打 tried 标记”收候选（真机 1221 条），到 hydrate 后才筛，结果
  // 每批 20 条里只有 ~4 条是真目标——现在反过来：只送要整形的。
  const targets: string[] = [];
  let scanned = 0;
  state.scanning = true;
  for (let offset = 0; ; offset += PAGE) {
    if (abortRequested) break; // 中止：扫描段也当场退出（不把最后一页白扫完）
    const page = l1.activeForSkeleton(PAGE, offset);
    if (page.length === 0) break;
    scanned += page.length;
    for (const r of page) {
      if (isReshapedAtCurrentVersion(r.metadata, r.content)) continue;
      if (r.content.trim() === '') continue;
      if (scoreSkeleton(r.type, r.content).齐备) continue;
      targets.push(r.id);
    }
    state.candidates = targets.length;
    state.scanned = scanned;
    await yieldLoop();
  }
  state.scanning = false;
  logger.info(
    `[memory] redistill 回填启动：活跃 ${scanned} 条中真目标 ${targets.length} 条,本次上限 ${MAX_RECORDS} 条,并行度 ${LIMIT}`,
  );

  const batch = targets.slice(0, MAX_RECORDS);
  state.candidates = batch.length;
  state.batchTotal = batch.length;
  state.deferred = Math.max(0, targets.length - batch.length);
  const callTimeoutMs = cfg.backfill?.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;

  /** 一条一个请求：取一条 → 送整形 → 质量闸 → **当场提交**（不攒批、不合并）。 */
  const reshapeAndCommit = async (id: string): Promise<void> => {
    const [rec] = l1.getByIds([id]);
    if (!rec || !rec.content || rec.content.trim() === '') {
      state.processed++;
      state.batchesDone++;
      return;
    }
    // 扫描与执行之间可能已被反刍/手动路径改好，再判一次齐备就跳过（不白烧 token）。
    if (scoreSkeleton(rec.type, rec.content).齐备) {
      state.processed++;
      state.batchesDone++;
      return;
    }
    const item = await reshapeOne(deps.ctx, cfg, logger, rec, callTimeoutMs, runAbort?.signal);
    if (!item) {
      // 中止强杀导致的失败不计入 failed（不是模型/网络的错，是中止信号）
      if (!abortRequested) state.failed++;
    } else if (reshapePassesGate(rec.type, rec.content, item.content)) {
      const meta = { ...(rec.metadata ?? {}) } as Record<string, unknown>;
      if (item.keywords.length > 0) meta[KEYWORDS_METADATA_KEY] = item.keywords;
      if (item.usageScenario.length > 0) meta.dsh_usage_scenario = item.usageScenario;
      // 成功替换 ⇒ 盖当前版本戳（下轮不再入列）；不再写旧的 tried 布尔。
      meta[RESHAPE_VER_KEY] = RESHAPE_SCHEMA_VERSION;
      const updated: MemoryRecord = {
        ...rec,
        content: normalizeContentMd(item.content),
        metadata: meta,
        updatedAt: Date.now(),
        version: (rec.version ?? 0) + 1,
      };
      try {
        await l1.appendNew([updated]); // JSONL 追加 + upsertL1(重嵌+FTS) + fireFileSync 重导出
        state.updated++;
      } catch (err) {
        state.failed++;
        logger.warn(`[memory] redistill 写回失败(原记录未改): id=${rec.id} - ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      // 质量闸不过：留原文，**不动任何标记**（「试过就排除」已废——用户定：只有成功替换的才不再进入）。
      // 于是下轮它仍会入列、可再试；重试次数上界由 maxRecords 与人工触发控制，不会自转。
      state.skipped++;
    }
    state.processed++;
    state.batchesDone++;
    await yieldLoop();
  };

  /**
   * 弹性工作池：每完成一条就重读一次**生效并发**（拖概览页滑块即时生效，不必重开一轮）。
   * - 拖高：外层循环立刻补 worker（不必等当前条跑完）；
   * - 拖低：多出的 worker 各自干完手头那条后自然收工（不挖断已烧 token 的请求）。
   * 缺省 getter 时等同启动值（`cfg.backfill.concurrency`，默认 1 = 串行）。
   * 预算只在**条前**检查：中途挖断会让已烧 token 的那条无成果，不如让它提交。
   */
  const readLimit = (): number => {
    const raw = deps.concurrency ? deps.concurrency() : undefined;
    return clampConcurrency(raw ?? cfg.backfill?.concurrency);
  };
  let cursor = 0;
  let budgetHit = false;
  const work = async (): Promise<void> => {
    for (;;) {
      if (abortRequested) return; // 中止：不再取新活（在飞的那条自然跑完）
      if (budgetHit || Date.now() - startedAt > TIME_BUDGET_MS) {
        budgetHit = true;
        return;
      }
      const i = cursor++;
      if (i >= batch.length) return;
      await reshapeAndCommit(batch[i]);
    }
  };
  const inFlight = new Set<Promise<void>>();
  const spawn = (): void => {
    const p = work().finally(() => inFlight.delete(p));
    inFlight.add(p);
  };
  for (;;) {
    const target = Math.max(1, Math.min(readLimit(), batch.length));
    state.concurrency = target; // 面板「并行 N」跟着实时值走，不再停在启动值上骗人
    while (!budgetHit && !abortRequested && inFlight.size < target && cursor < batch.length) spawn();
    if (inFlight.size === 0) break;
    await Promise.race(inFlight);
  }

  if (abortRequested) {
    state.cancelled = true;
    state.deferred += Math.max(0, batch.length - state.processed);
    logger.info(
      `[memory] redistill 回填：已按请求中止（在飞请求跑完即收工）,本轮完成 ${state.processed} 条,剩 ${state.deferred} 条留待再触发`,
    );
  }

  if (budgetHit) {
    state.deferred += Math.max(0, batch.length - state.processed);
    logger.info(`[memory] redistill 回填：墙钟预算(${Math.round(TIME_BUDGET_MS / 1000)}s)用尽,累计留待再触发 ${state.deferred} 条`);
  }
}

/** 单条整形结果。 */
export interface ReshapeOneResult {
  content: string;
  keywords: string[];
  usageScenario: string[];
}

/**
 * 整形**一条**记忆（一个请求只装一条）。失败/输出非法返回 null（原记录不动）。
 *
 * 导出不带 ctx/cfg 以外的参数，供单测注入桩 LLM。旧名 `reshapeChunk`（多条一次）已废：
 * 合并请求把爆炸半径从 1 条放大到 20 条，而实测逐条只花 2.6s，合并毫无收益。
 */
export async function reshapeOne(
  ctx: Context,
  cfg: MemoryConfig,
  logger: MemoryLogger,
  rec: MemoryRecord,
  callTimeoutMs: number = DEFAULT_CALL_TIMEOUT_MS,
  /** 本轮中止信号（可选）：与单次超时**取或**，宽限到期后由它当场掐断请求。 */
  externalSignal?: AbortSignal,
): Promise<ReshapeOneResult | null> {
  const user = `记忆:\n类型：${rec.type}\n标题：${rec.name ?? ''}\n当前正文：${rec.content.slice(0, 1200)}`;
  // 每条都记耗时：本轮排查的就是“单条到底要多久”，没这个数就只能猜并发/超时该怎么配。
  const t0 = Date.now();
  const secs = (): number => Math.round((Date.now() - t0) / 1000);
  try {
    const raw = await callLLM(ctx, cfg, {
      system: SYSTEM_PROMPT,
      user,
      maxTokens: RESHAPE_MAX_TOKENS,
      layer: 'l1-extract',
      // 整形是「重排 + 拎标识」的直答任务：显式关思考，否则思考模型会把预算烧在
      // reasoning 上吐 0 字符（真机 156/162 次 `llm empty output` 皆为此）。
      reasoningEffort: 'off',
      logger,
      // 自己给超时信号：沿用 cfg.llm.timeoutMs(120s) 会在回退链上被掐死；
      // 再与「本轮中止」取或——宽限到期后由它当场掐断。
      signal: (() => {
        const t = AbortSignal.timeout(callTimeoutMs > 0 ? callTimeoutMs : DEFAULT_CALL_TIMEOUT_MS);
        return externalSignal ? AbortSignal.any([t, externalSignal]) : t;
      })(),
    });
    logger.info(`[memory] redistill 单条耗时 ${secs()}s(id=${rec.id})`);
    const parsed = parseJsonLogged<Record<string, unknown> | Array<Record<string, unknown>>>(raw, 'redistill 回填', logger);
    // 通吃两种形状：模型偶尔无视“只输出一个对象”而回一个单元素数组。
    const obj = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!obj || typeof obj !== 'object') return null;
    const content = typeof obj.content === 'string' ? obj.content : '';
    if (content.trim() === '') return null;
    return {
      content,
      keywords: normKeywords(obj.keywords, 5),
      usageScenario: normUsageScenario(obj.usage_scenario, 3),
    };
  } catch (err) {
    logger.warn(`[memory] redistill 单条失败(id=${rec.id},已等 ${secs()}s,原记录未改): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
