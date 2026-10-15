/**
 * 存量未打标记录的一键回填(task_15):从 WingWheel"未打标 M"入口触发,
 * 对 metadata 无 wing 的 L1 记录按 8 角词表**逐条**补打标签(复用 L1 抽取的打标路径:
 * 同一候选词表与措辞,经既有蒸馏 LLM 路由)。
 *
 * 安全边界:
 * - **单飞**:同时最多一个回填任务,重复触发直接返回 running(不排队不叠加);
 * - **后台执行**:端点立即返回,**逐条推进、跑完一条再发下一条**,不阻塞 RPC/管线;
 * - **失败可退**:LLM 失败/输出不合法只跳过当前条,原记录零改动(标签只写成功的);
 * - **有界**:单次任务最多处理 MAX_RECORDS 条,防止一次跑飞;其余可再次触发。
 *
 * 形状约定(用户定):**按单元、串行、不合并**——一个请求只装一条记忆。旧形状把 20 条
 * 合并进一个 prompt(一次截断/空输出就整批丢弃),逐条只把爆炸半径限制在 1 条。
 */
import type { Context } from '@deepseek-ai/cordis';
import { callLLM } from './llm.js';
import { normWingEnabled } from './config.js';
import { WING_FALLBACK, type MemoryLogger, type MemoryRecord } from './types.js';
import type { MemoryBackend } from './store/memory-backend.js';
import type { MemoryConfig } from './config.js';
import { parseJsonLogged } from './llm.js';
import { isWingId, normTags } from './metadata-validators.js';
import { yieldLoop } from './util/yield.js';

/** 单次任务处理上限默认值(可被 cfg.backfill.maxRecords 覆盖;分批触发,可重复执行)。 */
const DEFAULT_MAX_RECORDS = 40;
/** 墙钟预算默认值 ms(可被 cfg.backfill.timeBudgetMs 覆盖):超时剩留待再次触发。 */
const DEFAULT_TIME_BUDGET_MS = 1_800_000;
/** 单次 LLM 请求默认超时(可被 cfg.backfill.callTimeoutMs 覆盖)。 */
const DEFAULT_CALL_TIMEOUT_MS = 240_000;

export interface HallBackfillDeps {
  ctx: Context;
  cfg: MemoryConfig;
  /** 记忆后端(后台边界)。 */
  backend: MemoryBackend;
  logger: MemoryLogger;
}

export interface HallBackfillState {
  running: boolean;
  /** 本进程累计成功打标条数(重启归零;仅作观测,不作账)。 */
  updated: number;
  failed: number;
}

const state: HallBackfillState = { running: false, updated: 0, failed: 0 };

export function wingBackfillState(): HallBackfillState {
  return { ...state };
}

const SYSTEM_PROMPT =
  '你是记忆库的 Wing 标注器。给你一条记忆,判断其内容属于哪个 Wing,输出 JSON 对象:{"wing":"<域id>"}。' +
  'wing 只能从给定候选列表中选,且必须是列表里的原文 id;列表外的值一律无效(会被丢弃)。' +
  '横跨多域或确实无法归入任何角时选 general。只输出 JSON,不要多余文字。';

/** 启动后台回填;已在运行返回 false(单飞)。 */
export function startWingBackfill(deps: HallBackfillDeps): { started: boolean; running: boolean } {
  if (state.running) return { started: false, running: true };
  state.running = true;
  state.updated = 0;
  state.failed = 0;
  void run(deps).finally(() => {
    state.running = false;
    deps.logger.info(`[memory] wing 回填结束:成功 ${state.updated} 条,失败 ${state.failed} 条`);
  });
  return { started: true, running: true };
}

async function run(deps: HallBackfillDeps): Promise<void> {
  const { ctx, cfg, backend, logger } = deps;
  const MAX_RECORDS = cfg.backfill?.maxRecords ?? DEFAULT_MAX_RECORDS;
  const TIME_BUDGET_MS = cfg.backfill?.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const callTimeoutMs = cfg.backfill?.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const halls = normWingEnabled(cfg.hall?.enabled);
  if (halls.length === 0) {
    logger.warn('[memory] wing 回填跳过:wing.enabled 为空(打标功能已关闭)');
    return;
  }
  // 墙钟预算(cfg.backfill.timeBudgetMs):超时即停,剩余留待再次触发(任务本身设计为可重复执行)。
  // 保证后台回填不长时间占据事件循环,设置面板的状态 RPC 始终优先。
  const startedAt = Date.now();
  const candidates = [...halls, WING_FALLBACK].join(' / ');
  // 未打标集:游标分批扫描轻量投影(不一次性全量反序列化含正文的记录)。
  // 口径与迁移一致:不做活性过滤——retired 行的 metadata_json 同样保留,restore 后可见。
  const PAGE = 200;
  const total = await backend.size();
  const pendingIds: string[] = [];
  let scanned = 0;
  for (let offset = 0; ; offset += PAGE) {
    const page = await backend.allLite(PAGE, offset);
    if (page.length === 0) break;
    for (const r of page) {
      const h = r.metadata?.hall;
      if (!(typeof h === 'string' && h !== '')) pendingIds.push(r.id);
    }
    scanned += page.length;
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      logger.info(
        `[memory] wing 回填:墙钟预算(${TIME_BUDGET_MS / 1000}s)在扫描阶段用尽(已扫 ${scanned}/${total} 条),留待再次触发`,
      );
      return;
    }
    await yieldLoop(); // 扫描批次间让位:面板状态 RPC 优先
  }

  const budget = Math.min(pendingIds.length, MAX_RECORDS);
  logger.info(`[memory] wing 回填启动:未打标 ${pendingIds.length} 条,本次上限 ${budget} 条(候选 ${candidates})`);
  // 逐条串行:取一条 → 送标 → 当场写回。不攒批、不合并(爆炸半径锁在 1 条)。
  const ids = pendingIds.slice(0, budget);
  for (let i = 0; i < ids.length; i++) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      logger.info(`[memory] wing 回填:墙钟预算(${TIME_BUDGET_MS / 1000}s)用尽,剩余 ${ids.length - i} 条留待再次触发`);
      break;
    }
    // 标注器需要 content 才能构造提示词,而扫描阶段只取了轻量投影 → 按 id 精确补水(主键索引)。
    const [rec] = await backend.getByIds([ids[i]]);
    if (!rec) {
      state.failed++;
      continue;
    }
    const wing = await labelWingOne(ctx, cfg, logger, rec, candidates, callTimeoutMs);
    if (wing === null) {
      state.failed++;
      continue;
    }
    // 最小写回:只改 metadata(hall 是磁盘兼容键,不改名)。
    // 这里**必须**用 patchMetadata 而非 upsert——巡检路径不持有正文,
    // 用 upsert 会把 content 写成空(数据静默丢失,已由 l1-paging 测试钉死)。
    const meta = { ...(rec.metadata ?? {}), hall: wing };
    if (await backend.patchMetadata(rec.id, meta)) state.updated++;
    else state.failed++;
    await yieldLoop(); // 写回间让位:面板状态 RPC 优先于后台逐条
  }
}

/**
 * Wing 标注器(导出):一键回填与反刍重标定共用同一 LLM 路径与措辞。
 *
 * **一个请求只装一条**(旧名 `labelWingChunk`,多条一次,已废)。返回该条的 wing,
 * 失败/字段缺失/值非法返回 null(记账归调用方,本函数不动全局状态)。
 */
export async function labelWingOne(
  ctx: Context,
  cfg: MemoryConfig,
  logger: MemoryLogger,
  rec: MemoryRecord,
  candidates: string,
  callTimeoutMs: number = DEFAULT_CALL_TIMEOUT_MS,
): Promise<string | null> {
  const user = `候选 Wing:${candidates}\n\n记忆:\n${rec.content.slice(0, 600)}`;
  try {
    const raw = await callLLM(ctx, cfg, {
      system: SYSTEM_PROMPT,
      user,
      maxTokens: 1024,
      layer: 'l1-extract',
      logger,
      signal: AbortSignal.timeout(callTimeoutMs > 0 ? callTimeoutMs : DEFAULT_CALL_TIMEOUT_MS),
    });
    const parsed = parseJsonLogged<Record<string, unknown> | Array<Record<string, unknown>>>(raw, 'wing 回填', logger);
    // 通吃两种形状:模型偶尔无视“只输出一个对象”而回单元素数组(或带 id 的旧形状)。
    const obj = Array.isArray(parsed) ? parsed[0] : parsed;
    // 字段名必须与提示词一致读 `wing`。历史上此处误读 `item.hall`(提示词早已是 wing),
    // 导致整批静默丢弃——日志只增长 llmSkipped 而 wingLabeled 恒为 0,排查代价极高。
    const rawWing = typeof obj?.wing === 'string' ? obj.wing.trim() : '';
    // 字段缺失与值非法分开报:否则模型若又换了字段名,日志只会显示"非法值「」",
    // 看不出真实原因是**读不到字段**——这正是上次事故难以定位的原因。
    if (rawWing === '') {
      logger.warn(
        `[memory] wing 回填:返回缺少 wing 字段,已丢弃(id=${rec.id};实际键=${Object.keys(obj ?? {}).join('|')})`,
      );
      return null;
    }
    // 枚举校验:非法值不写入(含认知 hall 值如 facts/events —— 两者值域不相交)
    if (!isWingId(rawWing)) {
      logger.warn(`[memory] wing 回填:非法 wing 值「${rawWing.slice(0, 32)}」已丢弃(id=${rec.id})`);
      return null;
    }
    return rawWing;
  } catch (err) {
    logger.warn(`[memory] wing 回填单条失败(id=${rec.id},原记录未改): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

const TAGGER_SYSTEM_PROMPT =
  '你是记忆库的标签标注器。给你一条记忆,为它提炼 1-3 个能概括其主题的英文 slug 标签' +
  '(小写字母/数字/连字符,如 graphql-switch、riley-college-apps)。标签从内容中涌现,不从预定义列表选;' +
  '输出 JSON 对象:{"tags":["slug1","slug2"]}。只输出 JSON,不要多余文字。';

/**
 * 涌现标签标注器(导出):为**一条**记录提炼 slug 标签(tags)——Room 的前身。
 * 一个请求只装一条(旧名 `tagChunk`,多条一次,已废)。失败返回 null;合法但为空返回 []。
 */
export async function tagOne(
  ctx: Context,
  cfg: MemoryConfig,
  logger: MemoryLogger,
  rec: MemoryRecord,
  callTimeoutMs: number = DEFAULT_CALL_TIMEOUT_MS,
): Promise<string[] | null> {
  const user = `记忆:\n${rec.content.slice(0, 600)}`;
  try {
    const raw = await callLLM(ctx, cfg, {
      system: TAGGER_SYSTEM_PROMPT,
      user,
      maxTokens: 1024,
      layer: 'l1-extract',
      logger,
      signal: AbortSignal.timeout(callTimeoutMs > 0 ? callTimeoutMs : DEFAULT_CALL_TIMEOUT_MS),
    });
    const parsed = parseJsonLogged<Record<string, unknown> | Array<Record<string, unknown>>>(raw, 'tags 标注', logger);
    const obj = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!obj || typeof obj !== 'object') return null;
    // 归一 + 校验在标注器内部就做一遍(写回点仍会再过一次,双保险)
    return normTags(obj.tags);
  } catch (err) {
    logger.warn(`[memory] tags 标注单条失败(id=${rec.id},原记录未改): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
