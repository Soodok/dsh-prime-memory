/**
 * 存量 `dsh_validity` 标注回填（expiry-tiering task_6.2 / 6.3 / 7.7）。
 *
 * 与 keyword/wing 回填同族但**零 LLM**——classifyValidity 是纯函数，本回填是
 * 本地派生：分批扫存量 L1，对"缺标注或标注与现算不符"的行写回 `dsh_validity`
 * 快照，每攒一批对被改记录调 `forceReprojectRecord` 让图谱保鲜（task_7.7 的接缝）。
 *
 * 安全边界（继承回填族四件套）：
 * - 单飞：同时最多一个任务（重复触发返回 running，不排队不叠加）；
 * - 后台执行 + 可中断：逐页推进、`shouldCancel`/墙钟预算/条数上限三闸，跑了多少算多少，
 *   其余 deferred 留待下次触发（低频周期或面板）；
 * - 失败可退：单行 patch 失败只计数，原记录零改动；
 * - 门控：`validity.tieringEnabled`（部署 ∨ 面板）关时不跑——标注面与消费面同开同关，
 *   功能关着时存量 metadata 逐字不变（零漂移）。
 */
import type { L1Store } from './store/l1.js';
import { readValidity, VALIDITY_METADATA_KEY, stampValidity, stateOfRecord } from './store/validity.js';
import type { MemoryLogger } from './types.js';
import { yieldLoop } from './util/yield.js';

/** 扫描页大小（轻量投影分页；与 keyword-backfill 一致）。 */
const PAGE = 200;
/** 单次任务默认处理上限（真机库 ~千级,一轮可清完大半;剩余 defer）。 */
const DEFAULT_MAX_RECORDS = 5_000;
/** 默认墙钟预算(ms)：纯本地派生 + 索引点查,比 LLM 回填便宜几个量级。 */
const DEFAULT_TIME_BUDGET_MS = 120_000;
/** 每攒多少条被改记录触发一次图谱重投（task_7.7 的"每批"）。 */
const REPROJECT_BATCH = 50;

export interface ValidityBackfillOutcome {
  started: boolean;
  running: boolean;
  scanned: number;
  updated: number;
  failed: number;
  /** 预算/上限用尽留下的条数（下次周期续跑）。 */
  deferred: number;
  cancelled: boolean;
  /** 累计因本次回填而被重投入队的记录数（图谱保鲜面）。 */
  reprojected: number;
}

interface RunState extends ValidityBackfillOutcome {
  scanned: number;
}

let current: RunState | null = null;
let abortRequested = false;

/** 当前进度快照（面板/日志读;无任务在跑返回 null）。 */
export function validityBackfillState(): RunState | null {
  return current === null ? null : { ...current };
}

/** 请求中止本轮（在跑的任务在下一个检查点收工;空闲时零效果）。 */
export function cancelValidityBackfill(): { cancelled: boolean; running: boolean } {
  if (current === null || !current.running) return { cancelled: false, running: false };
  abortRequested = true;
  return { cancelled: true, running: true };
}

export interface ValidityBackfillDeps {
  l1: L1Store;
  logger: MemoryLogger;
  /**
   * 强制重投缝（runner.reprojectGraph：图谱未启用时自己回零,本模块不碰图谱门）。
   * 只对被改过标注的记录调用——没动的记录不需要重投（图谱读时派生不吃 dsh_validity）。
   */
  reproject: (recordIds: readonly string[]) => void;
  maxRecords?: number;
  timeBudgetMs?: number;
  /** 外部中止判据（宿主 dispose / 面板取消）；每行前检查一次。 */
  shouldCancel?: () => boolean;
}

/**
 * 启动后台回填；已在运行返回 {started:false}（单飞）。
 * 完成状态留在 `validityBackfillState()` 供最后一次读取（下轮启动时重置）。
 */
export function startValidityBackfill(deps: ValidityBackfillDeps): { started: boolean; running: boolean } {
  if (current?.running) return { started: false, running: true };
  current = {
    started: true, running: true, scanned: 0, updated: 0, failed: 0,
    deferred: 0, cancelled: false, reprojected: 0,
  };
  abortRequested = false;
  void runValidityBackfillOnce(deps).finally(() => {
    if (current !== null) {
      current.running = false;
      deps.logger.info(
        `[memory] validity 回填结束:扫描 ${current.scanned} 行,补标 ${current.updated} 条` +
        (current.failed > 0 ? `,失败 ${current.failed} 条` : '') +
        (current.reprojected > 0 ? `,重投 ${current.reprojected} 条` : '') +
        (current.deferred > 0 ? `,留待下次 ${current.deferred} 条` : ''),
      );
    }
  });
  return { started: true, running: true };
}

/**
 * 回填主体（导出供单测 await 到完成；生产走 `startValidityBackfill` 的单飞包装）。
 * 同步扫描 + 同步写回（L1Store 的读面都是同步的），只在页间 `yieldLoop` 让位——
 * 没有 LLM 的回填不需要并发池，串行就是最快且最不会打脏的形状。
 */
export async function runValidityBackfillOnce(deps: ValidityBackfillDeps): Promise<ValidityBackfillOutcome> {
  const { l1, logger } = deps;
  abortRequested = false;
  const maxRecords = Math.max(1, deps.maxRecords ?? DEFAULT_MAX_RECORDS);
  const timeBudgetMs = Math.max(1_000, deps.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);
  const startedAt = Date.now();
  // 新一轮必须重置计数:上一轮的 current 只置 running=false 不清空(留面板终读)——
  // 直接调 runOnce(不经 start 的重置)若复用旧对象,scanned/updated 会跨轮累加。
  const st: RunState = (current === null || current.running === false)
    ? {
      started: true, running: true, scanned: 0, updated: 0, failed: 0, deferred: 0, cancelled: false, reprojected: 0,
    }
    : current;
  current = st;
  const flushReproject = (ids: string[]): void => {
    if (ids.length === 0) return;
    // task_7.7：每批标注写完即保鲜——forceReprojectRecord 自身的 PK 去重保证
    // "在途不堆重"，回填重复跑同一批也只会多投一次凭证删除，不会堆 job。
    try {
      deps.reproject(ids);
      st.reprojected += ids.length;
    } catch (err) {
      logger.warn(`[memory] validity 回填补投失败(忽略,图谱由周期 sweep 兜底): ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const dirty: string[] = [];
  let offset = 0;
  let hitCeil = false;
  for (;;) {
    if (abortRequested || deps.shouldCancel?.() === true) { st.cancelled = true; break; }
    if (st.scanned >= maxRecords) { hitCeil = true; break; }
    if (Date.now() - startedAt > timeBudgetMs) { hitCeil = true; break; }
    const page = l1.allLite(PAGE, offset);
    if (page.length === 0) break;
    offset += page.length;
    // allLite 只有 id/type/metadata——classify 要吃 validTo/persistence,整页 hydrate
    const byId = new Map(l1.getByIds(page.map((p) => p.id)).map((r) => [r.id, r]));
    const now = Date.now();
    for (const lite of page) {
      // 逐行检查点("可中断"承诺的粒度):页间检查在千行页上形同虚设。
      if (abortRequested || deps.shouldCancel?.() === true) { st.cancelled = true; break; }
      const rec = byId.get(lite.id);
      if (rec === undefined) continue; // 行在扫描瞬间被删:回填不追墓碑
      st.scanned++;
      const existing = readValidity(rec.metadata);
      const state = stateOfRecord(rec, now);
      // 需要写回的两种情形:①从没标过;②state 变了(时间流逝把 current 熬成 expired 等)。
      // validToSource 只在"从没标过"时按现算补;已标过的保留源头证据链(不就地升级证据等级)。
      const needs = existing === undefined || existing.state !== state;
      if (!needs) continue;
      const copy = { ...rec, metadata: { ...(rec.metadata ?? {}) } };
      stampValidity(copy, now);
      try {
        if (l1.patchMetadata(copy.id, copy.metadata)) {
          st.updated++;
          dirty.push(copy.id);
          if (dirty.length >= REPROJECT_BATCH) { flushReproject(dirty.splice(0, dirty.length)); }
        } else {
          st.failed++;
        }
      } catch (err) {
        st.failed++;
        logger.warn(`[memory] validity 回填单行失败(id=${copy.id},原记录未改): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await yieldLoop();
  }
  flushReproject(dirty.splice(0, dirty.length));
  if (!st.cancelled && hitCeil) {
    const total = l1.size;
    st.deferred = Math.max(0, total - st.scanned);
  } else if (st.cancelled) {
    st.deferred = Math.max(0, l1.size - st.scanned);
  }
  st.running = false;
  // 让最后一次状态可被面板读到：current 不在这里清，下轮 start 重置。
  return { ...st };
}

/** 单行是否需要补标/重标（导出供单测钉判据；生产路径走 runValidityBackfillOnce）。 */
export function validityBackfillNeeds(metadata: unknown, record: Parameters<typeof stateOfRecord>[0], now: number): boolean {
  const existing = readValidity(metadata);
  if (existing === undefined) return true;
  return existing.state !== stateOfRecord(record, now);
}

/** 内部常量导出（测试钉预算/批形）。 */
export const VALIDITY_BACKFILL_TUNING = { PAGE, DEFAULT_MAX_RECORDS, DEFAULT_TIME_BUDGET_MS, REPROJECT_BATCH, VALIDITY_METADATA_KEY } as const;
