/**
 * 关键词蒸馏回填（keyword axis 产出方）。
 *
 * 职责：从 L1 记录中找「缺 dsh_keywords」的存量记录，按 chunk 20 条一批送 LLM 提炼关键词
 * 与使用场景，归一后写 `metadata.dsh_keywords` + `metadata.dsh_usage_scenario`，
 * 并用 `patchMetadataAndReindex` 保证新关键词**立即进 FTS BM25 轴**。
 *
 * 安全边界（继承 wing-backfill）：
 * - 单飞：同时最多一个回填任务,重复触发直接返回 running(不排队不叠加)
 * - 后台执行：端点立即返回,逐块推进(每块 20 条),不阻塞 RPC/管线
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

/** 每块条数（一次 LLM 调用判定的记录数；与 wing-backfill 同口径）。 */
const CHUNK = 20;
/** 扫描页大小（轻量投影分页；与 wing-backfill 一致）。 */
const PAGE = 200;
/** 单次任务默认处理上限（cfg.backfill.maxRecords 优先）。 */
const DEFAULT_MAX_RECORDS = 300;
/** 墙钟默认预算（cfg.backfill.timeBudgetMs 优先）。 */
const DEFAULT_TIME_BUDGET_MS = 120_000;

export interface KeywordBackfillDeps {
  ctx: Context;
  cfg: MemoryConfig;
  backend: MemoryBackend;
  logger: MemoryLogger;
}

export interface KeywordBackfillState {
  running: boolean;
  updated: number;
  failed: number;
}

const state: KeywordBackfillState = { running: false, updated: 0, failed: 0 };

export function keywordBackfillState(): KeywordBackfillState {
  return { ...state };
}

// ── SYSTEM 提示词（定稿版，由 tools/keyword-distill.prompt.md 的 ```text 块迁移） ──
const SYSTEM_PROMPT = [
  '你是记忆库的关键词与情景标注器。给定若干条记忆（每条含 id、标题、正文摘要），为每条提炼：',
  '1) keywords：最能代表该记忆的检索词，用于精确命中；2) usage_scenario：未来「何时应当浮现这条记忆」的场景短语。',
  '',
  '严格规则：',
  '- keywords 的唯一判据：**用户未来会输入什么词把这条记忆捞出来**。优先具体名词性标识——项目/模块/文件/函数/配置项/命令/错误码/版本号/数字阈值/工具名/专有实体名。',
  '- **禁止**把正文里的动宾短语压缩成抽象黑话当关键词（反例：把"判定批量流量"压成"批量流量判定"、把"做窗口滑动归因"压成"窗口滑动归因"、把"保持只读约束"压成"只读约束"）——这类词没人会拿去搜，一律换成它指向的具体实体/标识，或直接删掉。',
  '- keywords：2–5 个（宁少勿滥，够区分即可）；每个 2–6 词或 1 个复合术语；不得与标题字面重复、不得互相近义堆叠、不收停用词/整句。',
  '- usage_scenario：1–3 条；每条 5–10 词的短场景描述（不是完整命令句）；彼此必须可区分，相似的合并成更泛化的一条。',
  '- 语言跟随该记忆正文：中文记忆产出中文（技术标识符、API 名、错误码原样保留），英文记忆产出英文。',
  '- id 必须原样照抄，不得改写、截断或改用序号；一条记忆只产一组，不要拆分。',
  '',
  '输出：只输出一个 JSON 数组，不要多余文字、不要解释。每项形如：',
  '{"id":"<原id>","keywords":["…","…"],"usage_scenario":["…","…"]}',
].join('\n');

/** 启动后台关键词回填；已在运行返回 false（单飞）。 */
export function startKeywordBackfill(deps: KeywordBackfillDeps): { started: boolean; running: boolean } {
  if (state.running) return { started: false, running: true };
  state.running = true;
  state.updated = 0;
  state.failed = 0;
  void runKeywordBackfillOnce(deps).finally(() => {
    state.running = false;
    deps.logger.info(`[memory] keyword 回填结束:成功 ${state.updated} 条,失败 ${state.failed} 条`);
  });
  return { started: true, running: true };
}

/**
 * 回填主体（导出供单测 await 到完成；生产走 `startKeywordBackfill` 的单飞后台包装）。
 * 门控关（`cfg.keyword.enabled = false`）时入口立即返回，不碰任何记录与 fts。
 */
export async function runKeywordBackfillOnce(deps: KeywordBackfillDeps): Promise<void> {
  const { cfg, backend, logger } = deps;
  if (!cfg.keyword?.enabled) {
    logger.info('[memory] keyword 回填跳过：keyword.enabled = false（功能关，不回填）');
    return;
  }
  const MAX_RECORDS = cfg.backfill?.maxRecords ?? DEFAULT_MAX_RECORDS;
  const TIME_BUDGET_MS = cfg.backfill?.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const startedAt = Date.now();

  // ── 扫描阶段（轻量投影，不反序列化正文）──
  const total = await backend.size();
  const pendingIds: string[] = [];
  let scanned = 0;
  for (let offset = 0; ; offset += PAGE) {
    const page = await backend.allLite(PAGE, offset);
    if (page.length === 0) break;
    for (const r of page) {
      const kw = r.metadata?.[KEYWORDS_METADATA_KEY];
      if (!(Array.isArray(kw) && kw.length > 0)) pendingIds.push(r.id);
    }
    scanned += page.length;
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      logger.info(`[memory] keyword 回填：墙钟预算(${TIME_BUDGET_MS / 1000}s)在扫描阶段用尽(已扫 ${scanned}/${total}),留待再触发`);
      return;
    }
    await yieldLoop();
  }

  let budget = Math.min(pendingIds.length, MAX_RECORDS);
  logger.info(`[memory] keyword 回填启动：缺关键词 ${pendingIds.length} 条,本次上限 ${budget} 条`);

  // ── 标注阶段（补水→LLM→归一→写回）──
  for (let offset = 0; offset < pendingIds.length && budget > 0; offset += CHUNK) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      logger.info(`[memory] keyword 回填：墙钟预算用尽,剩余 ${pendingIds.length - offset} 条留待再触发`);
      break;
    }
    const hydrated = await backend.getByIds(pendingIds.slice(offset, offset + CHUNK));
    const chunk = hydrated.filter((r) => r.content && r.content.trim() !== '');
    if (chunk.length === 0) continue;
    budget -= chunk.length;
    const labeled = await labelKeywordChunk(deps.ctx, cfg, logger, chunk);
    for (const { record, keywords, usageScenario } of labeled) {
      const meta = { ...(record.metadata ?? {}) } as Record<string, unknown>;
      meta[KEYWORDS_METADATA_KEY] = keywords;
      if (usageScenario && usageScenario.length > 0) meta.dsh_usage_scenario = usageScenario;
      if (await backend.patchMetadataAndReindex(record.id, meta)) state.updated++;
      else state.failed++;
      await yieldLoop();
    }
  }
}

/** 关键词标注器（导出供单测）。 */
export async function labelKeywordChunk(
  ctx: Context,
  cfg: MemoryConfig,
  logger: MemoryLogger,
  chunk: MemoryRecord[],
): Promise<Array<{ record: MemoryRecord; keywords: string[]; usageScenario?: string[] }>> {
  const list = chunk.map((r, i) => `${i + 1}. id=${r.id}\n标题：${r.name ?? ''}\n正文：${r.content.slice(0, 300)}`).join('\n\n');
  const user = '记忆列表:\n' + list;
  try {
    const raw = await callLLM(ctx, cfg, {
      system: SYSTEM_PROMPT,
      user,
      maxTokens: 4096,
      layer: 'l1-extract',
      logger,
    });
    const parsed = parseJsonLogged<Array<{ id?: unknown; keywords?: unknown; usage_scenario?: unknown }>>(raw, 'keyword 回填', logger);
    if (!Array.isArray(parsed)) return [];
    const byId = new Map(chunk.map((r) => [r.id, r]));
    const out: Array<{ record: MemoryRecord; keywords: string[]; usageScenario?: string[] }> = [];
    for (const item of parsed) {
      const record = typeof item?.id === 'string' ? byId.get(item.id) : undefined;
      if (!record) {
        logger.warn(`[memory] keyword 回填:id 配对失败,已丢弃(id=${String(item?.id).slice(0, 40)})`);
        continue;
      }
      const keywords = normKeywords(item.keywords, 5);
      if (keywords.length === 0) {
        logger.warn(`[memory] keyword 回填:normKeywords 结果为空,已跳过(id=${record.id})`);
        continue;
      }
      const usageScenario = normUsageScenario(item.usage_scenario, 3);
      out.push({ record, keywords, usageScenario: usageScenario.length > 0 ? usageScenario : undefined });
    }
    return out;
  } catch (err) {
    logger.warn(`[memory] keyword 回填块失败(跳过 ${chunk.length} 条,原记录未改): ${err instanceof Error ? err.message : String(err)}`);
    state.failed += chunk.length;
    return [];
  }
}
