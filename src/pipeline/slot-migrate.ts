/**
 * 旧 slot 语义迁移（`cfg.slots.migrateLegacy`，默认关）。
 *
 * 背景：常驻槽位是"每轮硬注入"的 opt-in 约定。早期用法里有一类槽位其实是
 * **把一条已经存在的 L1 记忆钉成常驻**（`refs` 直指那条记录）——内容载体还在，
 * 却占了固定 token 预算、还在概要里显示成常驻清单。新取向是"记忆按相关性隐式
 * 浮现，除非手动提醒激活"，所以这类槽位应当退场，让那条记忆回到召回。
 *
 * 判据（四条同时满足，宁缺勿滥）：
 *  1. 开关显式开启（动的是用户手动建的约定，不自动生效）；
 *  2. `status='open'` 且 `pinned=true` 且 `kind='rule'`（todo/anchor/pointer 各有语义，一律不碰）；
 *  3. `refs` 至少一条解析到**未退场**的 L1 记录（退场不丢信息：正文仍在记忆里）；
 *  4. 记录本身可被召回（未退场即可检索，不再另设条件）。
 *
 * 动作：`close(id, 'dropped')` —— **软退场**，不删数据；记忆仍在，需要时可
 * 重新 `memory_slot_write`。逐条 info 日志，便于事后核对。
 */
import type { Slot } from '../store/slots.js';
import type { MemoryLogger } from '../types.js';
import { errDetail } from '../util/filelog.js';

/** 迁移需要的槽位面。 */
export interface SlotMigrateStoreFace {
  list(): Slot[];
  close(id: string, status: 'done' | 'dropped'): Promise<boolean>;
}

/** 迁移需要的 L1 只读面（validTo 非空 = 已退场（epoch ms），不作为信息载体）。 */
export interface SlotMigrateL1Face {
  getByIds(ids: string[]): Array<{ id: string; validTo?: number | null }>;
}

/** 一条可迁移槽位（预览用，执行前即可展示）。 */
export interface MigrateCandidate {
  id: string;
  title: string;
  /** 承载内容的活记录 id。 */
  carrier: string;
}

/** 判定 + 挑选可迁移槽位（纯读，无副作用；面板预览与反刍执行共用）。 */
export function pickMigratableSlots(slots: readonly Slot[], l1: SlotMigrateL1Face | undefined): MigrateCandidate[] {
  if (l1 === undefined) return [];
  const open = slots.filter((s) => s.status === 'open' && s.pinned === true && s.kind === 'rule');
  if (open.length === 0) return [];
  // 一次批量取全部 refs，避免 N 次查询。
  const allRefs = [...new Set(open.flatMap((s) => s.refs ?? []))];
  const alive = new Set(l1.getByIds(allRefs).filter((r) => r.validTo === undefined || r.validTo === null).map((r) => r.id));
  const out: MigrateCandidate[] = [];
  for (const s of open) {
    const carrier = (s.refs ?? []).find((r) => alive.has(r));
    if (carrier !== undefined) out.push({ id: s.id, title: s.title, carrier });
  }
  return out;
}

/**
 * 执行迁移：软退场命中的槽位。
 * @returns 实际退场条数（close 返回 false 的不计）。
 */
export async function migrateLegacySlots(
  slots: SlotMigrateStoreFace,
  l1: SlotMigrateL1Face | undefined,
  enabled: boolean,
  logger?: MemoryLogger,
): Promise<number> {
  if (enabled !== true) return 0;
  const candidates = pickMigratableSlots(slots.list(), l1);
  if (candidates.length === 0) return 0;
  let done = 0;
  for (const c of candidates) {
    try {
      if (await slots.close(c.id, 'dropped')) {
        done++;
        logger?.info(`[memory] 旧槽位迁移:「${c.title}」常驻退场，内容改由召回承载(${c.carrier})`);
      }
    } catch (err) {
      logger?.warn(`[memory] 旧槽位迁移失败(${c.id}): ${errDetail(err)}`);
    }
  }
  if (done > 0) logger?.info(`[memory] 旧槽位迁移完成: 常驻约定退场 ${done} 条`);
  return done;
}
