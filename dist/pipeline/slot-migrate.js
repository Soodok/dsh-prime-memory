import { errDetail } from '../util/filelog.js';
/** 判定 + 挑选可迁移槽位（纯读，无副作用；面板预览与反刍执行共用）。 */
export function pickMigratableSlots(slots, l1) {
    if (l1 === undefined)
        return [];
    const open = slots.filter((s) => s.status === 'open' && s.pinned === true && s.kind === 'rule');
    if (open.length === 0)
        return [];
    // 一次批量取全部 refs，避免 N 次查询。
    const allRefs = [...new Set(open.flatMap((s) => s.refs ?? []))];
    const alive = new Set(l1.getByIds(allRefs).filter((r) => r.validTo === undefined || r.validTo === null).map((r) => r.id));
    const out = [];
    for (const s of open) {
        const carrier = (s.refs ?? []).find((r) => alive.has(r));
        if (carrier !== undefined)
            out.push({ id: s.id, title: s.title, carrier });
    }
    return out;
}
/**
 * 执行迁移：软退场命中的槽位。
 * @returns 实际退场条数（close 返回 false 的不计）。
 */
export async function migrateLegacySlots(slots, l1, enabled, logger) {
    if (enabled !== true)
        return 0;
    const candidates = pickMigratableSlots(slots.list(), l1);
    if (candidates.length === 0)
        return 0;
    let done = 0;
    for (const c of candidates) {
        try {
            if (await slots.close(c.id, 'dropped')) {
                done++;
                logger?.info(`[memory] 旧槽位迁移:「${c.title}」常驻退场，内容改由召回承载(${c.carrier})`);
            }
        }
        catch (err) {
            logger?.warn(`[memory] 旧槽位迁移失败(${c.id}): ${errDetail(err)}`);
        }
    }
    if (done > 0)
        logger?.info(`[memory] 旧槽位迁移完成: 常驻约定退场 ${done} 条`);
    return done;
}
