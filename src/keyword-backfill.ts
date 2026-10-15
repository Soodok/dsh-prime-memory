/**
 * 关键词蒸馏回填（keyword axis 产出方）。
 *
 * 职责：从 L1 记录中找「缺 dsh_keywords」的存量记录，**一条一个请求**送 LLM 提炼关键词
 * 与使用场景，归一后写 `metadata.dsh_keywords` + `metadata.dsh_usage_scenario`，
 * 并用 `patchMetadataAndReindex` 保证新关键词**立即进 FTS BM25 轴**。
 *
 * 安全边界（继承 wing-backfill）：
 * - 单飞：同时最多一个回填任务,重复触发直接返回 running(不排队不叠加)
 * - 后台执行：端点立即返回,**逐条推进、跑完一条再发下一条**,不阻塞 RPC/管线
 * - 失败可退：LLM 失败/输出不合法只跳过当前块,原记录零改动(标签只写成功的)
 * - 有界：单次任务最多处理 cfg.backfill.maxRecords 条,防止一次跑飞;其余可再次触发
 * - 门控关（`cfg.keyword.enabled = false`）：run() 入口立即跳过——无回填、FTS 逐字不变
 */
import type { Context } from '@deepseek-ai/cordis';
import { callLLM, parseJsonLogged } from './llm.js';
import { normKeywords, normUsageScenario, KEYWORDS_METADATA_KEY } from './metadata-validators.js';
import type { MemoryLogger, MemoryRecord } from './types.js';
import type { MemoryBackend } from './store/memory-backend.js';
import type { MemoryConfig } from './config.js';
import { yieldLoop } from './util/yield.js';

// 一个请求只装**一条**记忆（旧形状是 20 条/次，已改）。与 redistill 同口径：
// 合并请求把爆炸半径从 1 条放大到 20 条（一次截断/空输出就整批丢弃），而实测单条
// 在本地端点上只是秒级，合并并不省时间。

/** 扫描页大小（轻量投影分页；与 wing-backfill 一致）。 */
const PAGE = 200;
/** 单次任务默认处理上限（cfg.backfill.maxRecords 优先）。 */
const DEFAULT_MAX_RECORDS = 40;
/** 总墙钟默认预算（cfg.backfill.timeBudgetMs 优先）。 */
const DEFAULT_TIME_BUDGET_MS = 1_800_000;
/** 默认并行度（cfg.backfill.concurrency 优先）：1 = 串行逐条（用户定的形状）。 */
const DEFAULT_CONCURRENCY = 1;
/**
 * 一次调用（含整条回退链）的默认超时（cfg.backfill.callTimeoutMs 优先）。
 * 不能沿用 `llm.timeoutMs`（120s）：它是整次调用的预算而不是每条路由各享一份，
 * 主路由空转一轮再降级就会撞线。
 */
const DEFAULT_CALL_TIMEOUT_MS = 240_000;
/** 单条关键词标注的输出预算（5 关键词 + 3 情景，实测远低于此）。 */
const LABEL_MAX_TOKENS = 512;

/** 并发度钳位（与 schema 的 min1/max8 同口径）。 */
function clampConcurrency(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : DEFAULT_CONCURRENCY;
  return Math.min(8, Math.max(1, n));
}

export interface KeywordBackfillDeps {
  ctx: Context;
  cfg: MemoryConfig;
  backend: MemoryBackend;
  logger: MemoryLogger;
  /**
   * 运行时**生效并发**读取器（可选）：给正在跑的任务即时改并发用——池子每完成一条重读一次。
   * 缺省 = 启动时读一次 `cfg.backfill.concurrency`（旧行为）。
   */
  concurrency?: () => number | undefined;
}

export interface KeywordBackfillState {
  running: boolean;
  updated: number;
  failed: number;
  /** 分批进度（UI 轮询据此显示「扫描中 / 第几条」，否则运行期只有一个「回填中…」）： */
  /** 每个请求处理的条数——已改逐条，永远为 1（与 redistill 同形状）。 */
  chunk: number;
  /** 扫描阶段确定的真目标总数（缺关键词；扫描未完成时为已发现数）。 */
  candidates: number;
  /** 本次已完成（送过 LLM 且已写回）**在请求完成时才自增**，否则“全失败”跟“全成功”看起来一样。 */
  processed: number;
  /** 仍在扫描阶段。 */
  scanning: boolean;
  /** 已完成条数（与 processed 同值）。 */
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
   * 扫描期已扫行数 / 总行数（`scanTotal=0` = 总数未知）。
   * 为何要暴露：扫描段原本在面板上只是一个静态「正在扫描…」，存量上千行时
   * 用户分不清“在跑”还是“卡死”——真机就是因为这个把它当成“不开始”。
   */
  scanned: number;
  scanTotal: number;
}

const state: KeywordBackfillState = {
  running: false, updated: 0, failed: 0,
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

/** 请求中止本轮（空闲时无副作用）；返回后中止是**有界**的：最多等 graceMs。 */
export function cancelKeywordBackfill(): { cancelled: boolean; running: boolean } {
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

export function keywordBackfillState(): KeywordBackfillState {
  return { ...state };
}

// ── SYSTEM 提示词（定稿版，由 tools/keyword-distill.prompt.md 的 ```text 块迁移） ──
const SYSTEM_PROMPT = [
  '你是记忆库的关键词与情景标注器。给定**一条**记忆（含标题与正文），为它提炼：',
  '1) keywords：最能代表该记忆的检索词，用于精确命中；2) usage_scenario：未来「何时应当浮现这条记忆」的场景短语。',
  '',
  '严格规则：',
  '- keywords 的唯一判据：**用户未来会输入什么词把这条记忆捞出来**。优先具体名词性标识——项目/模块/文件/函数/配置项/命令/错误码/版本号/数字阈值/工具名/专有实体名。',
  '- **禁止**把正文里的动宾短语压缩成抽象黑话当关键词（反例：把"判定批量流量"压成"批量流量判定"、把"做窗口滑动归因"压成"窗口滑动归因"、把"保持只读约束"压成"只读约束"）——这类词没人会拿去搜，一律换成它指向的具体实体/标识，或直接删掉。',
  '- keywords：2–5 个（宁少勿滥，够区分即可）；每个 2–6 词或 1 个复合术语；不得与标题字面重复、不得互相近义堆叠、不收停用词/整句。',
  '- usage_scenario：1–3 条；每条 5–10 词的短场景描述（不是完整命令句）；彼此必须可区分，相似的合并成更泛化的一条。',
  '- 语言跟随该记忆正文：中文记忆产出中文（技术标识符、API 名、错误码原样保留），英文记忆产出英文。',
  '',
  '输出：只输出**一个 JSON 对象**（不是数组），不要多余文字、不要解释。形如：',
  '{"keywords":["…","…"],"usage_scenario":["…","…"]}',
].join('\n');

/** 启动后台关键词回填；已在运行返回 false（单飞）。 */
export function startKeywordBackfill(deps: KeywordBackfillDeps): { started: boolean; running: boolean } {
  if (state.running) return { started: false, running: true };
  state.running = true;
  state.updated = 0;
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
  void runKeywordBackfillOnce(deps).finally(() => {
    state.running = false;
    state.scanning = false;
    deps.logger.info(`[memory] keyword 回填结束:成功 ${state.updated} 条,失败 ${state.failed} 条`
      + (state.deferred > 0 ? `,留待下次 ${state.deferred} 条` : ''));
  });
  return { started: true, running: true };
}

/**
 * 回填主体（导出供单测 await 到完成；生产走 `startKeywordBackfill` 的单飞后台包装）。
 * 门控关（`cfg.keyword.enabled = false`）时入口立即返回，不碰任何记录与 fts。
 */
export async function runKeywordBackfillOnce(deps: KeywordBackfillDeps): Promise<void> {
  const { cfg, backend, logger } = deps;
  // 新一轮入口清中止信号（同 redistill：直调 runOnce 的路径不经过 startX 的复位）。
  abortRequested = false;
  state.cancelled = false;
  if (graceTimer !== null) { clearTimeout(graceTimer); graceTimer = null; }
  runAbort = new AbortController();
  if (!cfg.keyword?.enabled) {
    logger.info('[memory] keyword 回填跳过：keyword.enabled = false（功能关，不回填）');
    return;
  }
  const MAX_RECORDS = cfg.backfill?.maxRecords ?? DEFAULT_MAX_RECORDS;
  const TIME_BUDGET_MS = cfg.backfill?.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  graceMs = clampGraceMs(cfg.backfill?.cancelGraceMs);
  const LIMIT = clampConcurrency(cfg.backfill?.concurrency);
  state.concurrency = LIMIT;
  const startedAt = Date.now();

  // ── 扫描阶段（轻量投影，不反序列化正文；分页 + 每页让位，不设墙钟）──
  const total = await backend.size();
  const pendingIds: string[] = [];
  let scanned = 0;
  state.scanning = true;
  for (let offset = 0; ; offset += PAGE) {
    if (abortRequested) break; // 中止：扫描段也当场退出（不把最后一页白扫完）
    const page = await backend.allLite(PAGE, offset);
    if (page.length === 0) break;
    for (const r of page) {
      const kw = r.metadata?.[KEYWORDS_METADATA_KEY];
      if (!(Array.isArray(kw) && kw.length > 0)) pendingIds.push(r.id);
    }
    scanned += page.length;
    state.candidates = pendingIds.length;
    state.scanned = scanned;
    state.scanTotal = total;
    await yieldLoop();
  }
  state.scanning = false;

  const batch = pendingIds.slice(0, MAX_RECORDS);
  state.candidates = batch.length;
  state.batchTotal = batch.length;
  state.deferred = Math.max(0, pendingIds.length - batch.length);
  const callTimeoutMs = cfg.backfill?.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  logger.info(`[memory] keyword 回填启动：已扫 ${scanned}/${total} 行,缺关键词 ${pendingIds.length} 条,本次处理 ${batch.length} 条,并行度 ${LIMIT}`);

  /** 一条一个请求：取一条 → 标注 → **即时写回**（含 fts 重索引）。 */
  const labelAndCommit = async (id: string): Promise<void> => {
    const [rec] = await backend.getByIds([id]);
    if (!rec || !rec.content || rec.content.trim() === '') {
      state.processed++;
      state.batchesDone++;
      return;
    }
    const labeled = await labelKeywordOne(deps.ctx, cfg, logger, rec, callTimeoutMs, runAbort?.signal);
    if (!labeled) {
      // 中止强杀导致的失败不计入 failed（不是模型/网络的错，是中止信号）
      if (!abortRequested) state.failed++;
    } else {
      const meta = { ...(rec.metadata ?? {}) } as Record<string, unknown>;
      meta[KEYWORDS_METADATA_KEY] = labeled.keywords;
      if (labeled.usageScenario.length > 0) meta.dsh_usage_scenario = labeled.usageScenario;
      if (await backend.patchMetadataAndReindex(rec.id, meta)) state.updated++;
      else state.failed++;
    }
    // 完成才计数（同 redistill）：否则“全失败”在面板上跟“全成功”长得一样。
    state.processed++;
    state.batchesDone++;
    await yieldLoop();
  };

  /**
   * 弹性工作池（与 redistill 同构）：每完成一条重读一次**生效并发**，拖概览页滑块即时生效。
   * 拖高立刻补 worker；拖低则各自干完手头那条后自然收工。缺省 getter = 启动值。
   * 预算只在**条前**检查，中途不挖已烧 token 的那条。
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
      await labelAndCommit(batch[i]);
    }
  };
  const inFlight = new Set<Promise<void>>();
  const spawn = (): void => {
    const p = work().finally(() => inFlight.delete(p));
    inFlight.add(p);
  };
  for (;;) {
    const target = Math.max(1, Math.min(readLimit(), batch.length));
    state.concurrency = target; // 面板「并行 N」跟实时值走
    while (!budgetHit && !abortRequested && inFlight.size < target && cursor < batch.length) spawn();
    if (inFlight.size === 0) break;
    await Promise.race(inFlight);
  }

  if (abortRequested) {
    state.cancelled = true;
    state.deferred += Math.max(0, batch.length - state.processed);
    logger.info(
      `[memory] keyword 回填：已按请求中止（在飞请求跑完即收工）,本轮完成 ${state.processed} 条,剩 ${state.deferred} 条留待再触发`,
    );
  }

  if (budgetHit) {
    state.deferred += Math.max(0, batch.length - state.processed);
    logger.info(`[memory] keyword 回填：墙钟预算(${Math.round(TIME_BUDGET_MS / 1000)}s)用尽,累计留待再触发 ${state.deferred} 条`);
  }
}

/** 单条标注结果。 */
export interface KeywordOneResult {
  keywords: string[];
  usageScenario: string[];
}

/**
 * 标注**一条**记忆的关键词与情景（一个请求只装一条）。失败/无合法关键词返回 null。
 *
 * 旧名 `labelKeywordChunk`（多条一次）已废：合并请求下一次截断/空输出就整批丢弃，
 * 而逐条只花秒级。记账（state.failed 等）全部归调用方——标注器不再动全局状态，
 * 否则同一条会被两处各计一次。
 */
export async function labelKeywordOne(
  ctx: Context,
  cfg: MemoryConfig,
  logger: MemoryLogger,
  rec: MemoryRecord,
  callTimeoutMs: number = DEFAULT_CALL_TIMEOUT_MS,
  /** 本轮中止信号（可选）：与单次超时**取或**，宽限到期后由它当场掐断请求。 */
  externalSignal?: AbortSignal,
): Promise<KeywordOneResult | null> {
  const user = `记忆:\n标题：${rec.name ?? ''}\n正文：${rec.content.slice(0, 900)}`;
  const t0 = Date.now();
  const secs = (): number => Math.round((Date.now() - t0) / 10);
  try {
    const raw = await callLLM(ctx, cfg, {
      system: SYSTEM_PROMPT,
      user,
      maxTokens: LABEL_MAX_TOKENS,
      layer: 'l1-extract',
      // 关键词/情景标注是直答任务：显式关思考，否则思考模型会把 512 预算烧在
      // reasoning 上、正文吐 0 字符（真机 156/162 次 `llm empty output` 皆为此）。
      reasoningEffort: 'off',
      logger,
      signal: (() => {
        const t = AbortSignal.timeout(callTimeoutMs > 0 ? callTimeoutMs : DEFAULT_CALL_TIMEOUT_MS);
        return externalSignal ? AbortSignal.any([t, externalSignal]) : t;
      })(),
    });
    logger.debug?.(`[memory] keyword 单条耗时 ${(Date.now() - t0) / 1000}s(id=${rec.id})`);
    const parsed = parseJsonLogged<Record<string, unknown> | Array<Record<string, unknown>>>(raw, 'keyword 回填', logger);
    const obj = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!obj || typeof obj !== 'object') return null;
    const keywords = normKeywords(obj.keywords, 5);
    if (keywords.length === 0) {
      logger.warn(`[memory] keyword 回填:normKeywords 结果为空,已跳过(id=${rec.id})`);
      return null;
    }
    return { keywords, usageScenario: normUsageScenario(obj.usage_scenario, 3) };
  } catch (err) {
    logger.warn(`[memory] keyword 单条失败(id=${rec.id},已等 ${secs() / 10}s,原记录未改): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
