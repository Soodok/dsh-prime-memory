import { cognitiveHallOf, COG_HALL_METADATA_KEY } from '../cognitive-hall.js';
import { normWingEnabled } from '../config.js';
import { WING_FALLBACK } from '../types.js';
import { labelWingOne, tagOne } from '../wing-backfill.js';
import { isWingId, normTags } from '../metadata-validators.js';
import { yieldLoop } from '../util/yield.js';
/** 机械写回上限(首次全量巡检可能上千条待补 cogHall;分次反刍消化,防单次跑飞)。 */
const MECH_CAP = 800;
/** LLM 重标定批上限(本次最多处理多少条待重标记录)。 */
const LLM_CAP = 60;
export async function relabelPass(deps, overrides = {}, opts = {}) {
    const { ctx, cfg, backend, logger } = deps;
    const timeBudgetMs = opts.timeBudgetMs ?? 180_000;
    const stats = {
        checked: 0,
        cogHallFixed: 0,
        wingInvalidFixed: 0,
        wingLabeled: 0,
        tagged: 0,
        llmSkipped: 0,
        deferred: 0,
    };
    // ── 机械校验 + 修正(游标分批 + 有界写回) ──
    //
    // 分批而非全量:轻量投影只取 id/type/metadata,不拉 content(巡检用不到正文)。
    // 每批后 yieldLoop 让位 → 巡检不会饿死面板 RPC,因此无需另设墙钟预算;
    // 写回上限仍由 MECH_CAP 兜底(超限的记录留给下次反刍,不入账)。
    const PAGE = 200;
    const total = await backend.size();
    const needWingIds = [];
    const needWingSeen = new Set();
    let scanned = 0;
    let offset = 0;
    let mechWrites = 0;
    let mechCapWarned = false;
    for (;;) {
        const page = await backend.allLite(PAGE, offset);
        if (page.length === 0)
            break;
        for (const r of page) {
            const meta = { ...r.metadata };
            let changed = false;
            let stripped = false;
            let cogFixed = false;
            // Wing 合法性:非法值剥离,转入 LLM 重标队列(词表校验统一走 metadata-validators)
            const wing = meta.hall;
            if (typeof wing === 'string' && wing !== '' && !isWingId(wing)) {
                delete meta.hall;
                changed = true;
                stripped = true;
            }
            // 认知 hall:type 可派生而未写/不一致 → 修正
            const expected = cognitiveHallOf(r.type);
            if (expected && meta[COG_HALL_METADATA_KEY] !== expected) {
                meta[COG_HALL_METADATA_KEY] = expected;
                changed = true;
                cogFixed = true;
            }
            if (changed) {
                // 计数只记**已落盘**的条数(超上限或写失败都不入账,面板数字才对得上库)
                if (mechWrites < MECH_CAP && await backend.patchMetadata(r.id, meta)) {
                    mechWrites++;
                    if (stripped)
                        stats.wingInvalidFixed++;
                    if (cogFixed)
                        stats.cogHallFixed++;
                }
                else if (mechWrites >= MECH_CAP) {
                    // 达上限:本轮不再写,留待下次反刍(静默跳过会让人误以为已处理完,故留痕一次)
                    if (!mechCapWarned) {
                        mechCapWarned = true;
                        logger.info(`[memory] 反刍重标定:机械写回达上限 ${MECH_CAP} 条,其余留待下次反刍`);
                    }
                }
                else {
                    logger.warn(`[memory] 反刍重标定机械写回失败(id=${r.id},跳过)`);
                }
            }
            // 未打标 wing(含刚剥离非法值的)进 LLM 队列。
            // 只记 id:批上限只有 60 条,内容在进入 LLM 段时按 id 补水即可,
            // 没必要把上千条完整记录(含正文)全揣在内存里。
            const after = meta.hall;
            if (typeof after !== 'string' || after === '') {
                if (!needWingSeen.has(r.id)) {
                    needWingSeen.add(r.id);
                    needWingIds.push(r.id);
                }
            }
        }
        scanned += page.length;
        offset += PAGE;
        opts.progress?.(`标注校验:机械巡检 ${scanned}/${total} 条`, scanned, total, '机械巡检');
        await yieldLoop(); // 每批让位:面板状态 RPC 优先于后台巡检
    }
    stats.checked = scanned;
    // ── LLM 重标定(有界;wing.enabled 关闭则跳过) ──
    const wingEnabled = normWingEnabled(cfg.hall?.enabled);
    if (wingEnabled.length === 0 || needWingIds.length === 0)
        return stats;
    // 按需补水:标注器需要 content 才能构造提示词,而巡检只取了轻量投影。
    // 只给有界批(LLM_CAP 条)按 id 精确取(主键索引),不做全量回填。
    const batch = await backend.getByIds(needWingIds.slice(0, LLM_CAP));
    if (batch.length === 0)
        return stats;
    logger.info(`[memory] 反刍重标定:未打标/待重标 ${needWingIds.length} 条,本次 LLM 处理 ${batch.length} 条(候选 ${[...wingEnabled, WING_FALLBACK].join(' / ')})`);
    const wingLabeler = overrides.wingLabeler ??
        ((rec) => labelWingOne(ctx, cfg, logger, rec, [...wingEnabled, WING_FALLBACK].join(' / ')));
    // ── LLM wing 重标定:逐条推进,条间让位 + 墙钟预算 + 条序进度回显 ──
    const startedAt = Date.now();
    const overBudget = () => Date.now() - startedAt > timeBudgetMs;
    let doneCount = 0;
    const taggedPool = [];
    for (let i = 0; i < batch.length; i++) {
        if (overBudget()) {
            stats.deferred += batch.length - doneCount;
            opts.progress?.(`重标定:时间预算(${Math.round(timeBudgetMs / 1000)}s)用尽,剩余 ${batch.length - doneCount} 条留待下次反刍`, doneCount, batch.length);
            logger.info(`[memory] 反刍重标定:时间预算用尽,deferred ${stats.deferred} 条`);
            return stats;
        }
        opts.progress?.(`重标定:LLM 补 wing 第 ${i + 1}/${batch.length} 条(已完成 ${doneCount}/${batch.length} 条)`, doneCount, batch.length, '补 Wing');
        let wing;
        try {
            wing = await wingLabeler(batch[i]);
        }
        catch (err) {
            // labelWingOne 自身已兜底(不向调用方抛);能走到这里只可能是注入桩抛错。
            // 即便如此也必须留痕——静默吞掉批次是本次「整批丢弃却无日志」的直接教训。
            stats.llmSkipped++;
            doneCount++;
            logger.warn(`[memory] 重标定第 ${i + 1}/${batch.length} 条标注器抛错,跳过: ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }
        if (wing === null) {
            // 标注器已 warn(字段缺失/非法值/单条失败),这里只记账。
            stats.llmSkipped++;
            doneCount++;
            continue;
        }
        // 写前重读:机械阶段可能已写过 cogHall,标注器持有旧副本——以库内最新为基线合并
        const [fresh] = await backend.getByIds([batch[i].id]);
        const current = fresh ?? batch[i];
        const meta = { ...(current.metadata ?? {}) };
        meta.hall = wing;
        try {
            await backend.patchMetadata(current.id, meta);
            stats.wingLabeled++;
            taggedPool.push(current);
        }
        catch {
            stats.llmSkipped++;
        }
        doneCount++;
        await yieldLoop();
    }
    // ── 涌现标签(tags,Room 前身):同批有界 40 条,同样逐条 + 预算 + 进度 ──
    const tagBatch = taggedPool.slice(0, 40);
    const tagger = overrides.tagger ?? ((rec) => tagOne(ctx, cfg, logger, rec));
    for (let i = 0; i < tagBatch.length; i++) {
        if (overBudget())
            break;
        opts.progress?.(`重标定:提炼涌现标签 第 ${i + 1}/${tagBatch.length} 条`, doneCount, batch.length, '提炼标签');
        let rawTags;
        try {
            rawTags = await tagger(tagBatch[i]);
        }
        catch (err) {
            logger.warn(`[memory] 重标定 tags 第 ${i + 1}/${tagBatch.length} 条标注器抛错,跳过: ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }
        if (!rawTags)
            continue;
        const tags = normTags(rawTags); // 归一+校验在写回点强制:无论标签来自真实 LLM 还是注入桩
        if (tags.length === 0)
            continue;
        const [fresh] = await backend.getByIds([tagBatch[i].id]);
        const current = fresh ?? tagBatch[i];
        const meta = { ...(current.metadata ?? {}) };
        meta.tags = tags;
        try {
            await backend.patchMetadata(current.id, meta);
            stats.tagged++;
            await yieldLoop();
        }
        catch {
            /* 标签写失败不影响主流程 */
        }
    }
    return stats;
}
