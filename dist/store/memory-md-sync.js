/**
 * 库 → 文件投射的**统一挂钩**（收口点）。
 *
 * 为什么收在 `L1Store` 而不是各个调用方：改变「记录有效性/身份」的写路径全部汇流到
 * `appendNew` / `retire` / `restore` / `rename` 四个方法，而上游有 8 处 `retire()` 调用点
 * （面板批量软删、Room 退役、`memory_delete` 工具、槽位连带、冲突裁决、合并取代、冲突自动
 * 判负、召回判过时）。事件挂钩已被真机证伪：920 条退场记录里只有 8 个 `.disable`，全部来自
 * 召回面板那一条路径。收在汇流口意味着——机器侧自动退场（合并取代、冲突判负）和模型侧
 * `memory_add` 都自动跟随，以后新增调用点不会漏。
 *
 * 一次 `sync` 的形状固定为「导出 → 后缀收敛」，顺序不可反：收敛器判「盘上没有这份」要靠
 * 导出先把这份写出来，反过来会把它算成 `absent` 而漏改名。调用方因此**不需要分辨自己
 * 是增还是删**。
 *
 * 一句话口径：**投射文件形状是库状态的函数，不是任何调用点的事件**（事件只是重算契机）。
 *
 * 四条契约（前三条与 `makeSuffixSync` 时期一致，收口没有放宽）：
 * 1. **不阻塞库**：钩子同步返回，文件侧在后台跑；磁盘满不能变成「记忆删不掉」。
 * 2. **绝不抛**：异常一律收敛成 warn（与 `disableProjectionFile` 同纪律）。
 * 3. **现读配置与账本**：`memExport` 是 volatile，快照会让「事后打开旋钮」一直到下次启动
 *    才生效；账本在 `stores.l1` 之后才装配，所以也只能现拿（见 `setFileSyncHook` 晚绑定）。
 * 4. **后台任务串行**：同一个文件树与同一本账不能被两个任务同时动，否则紧邻的两次点火
 *    （先写后退）会互踩，退场记录会停在 `.memory.md` 上（详 `makeFileSyncHook`）。
 *
 * 批量路径**禁止逐条 flush 账本**（账本是整本 JSON 的原子重写，逐条 flush = O(n²)）：
 * 统一走 `moveLedger(..., persist=false)` + 收尾一次 `flush()`。
 */
import { dirname } from 'node:path';
import { rename, stat } from 'node:fs/promises';
import { ensureDir } from '../util/io.js';
import { exportRecords } from './memory-md-export.js';
import { convergeDisabledSuffix, moveLedger } from './memory-md-disable.js';
import { disablePathOf, isRetiredRecord, renderRecord, targetFor } from './memory-md.js';
/** 存在性判定：一次 `stat`，任何错误都当「不存在」（与 `memory-md-disable.ts` 同口径）。 */
async function exists(p) {
    try {
        await stat(p);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * 该批记录的投射跟随：导出 → 后缀收敛。**不打日志**（调用方自己的口径不同：钩子说
 * “联动”，反刍说“增量”，统一格式反而把两者都稀释）；也不抛，异常由调用方收敛。
 *
 * @returns 两个报告；投射面关着或账本未装配时返回 `undefined`（调用方据此不打日志）。
 */
export async function syncFiles(deps, records) {
    if (records.length === 0)
        return undefined;
    const cfg = deps.exportCfg();
    const ledger = deps.ledger();
    if (!cfg.enabled || ledger === undefined)
        return undefined;
    const base = { cfgRoot: cfg.root, dataDir: deps.dataDir, ledger, maxRecords: cfg.maxRecords, timeBudgetMs: cfg.timeBudgetMs, logger: deps.logger };
    const exported = await exportRecords({ records, ...base });
    const suffix = await convergeDisabledSuffix({ records, ...base });
    return { exported, suffix };
}
/** 按 id 取快照后跑一轮 `syncFiles`（钩子走这个入口，判据只有一份）。 */
export async function syncFilesByIds(deps, ids, why) {
    if (ids.length === 0)
        return undefined;
    const out = await syncFiles(deps, deps.getByIds(ids));
    if (out !== undefined) {
        deps.logger?.info(`[memory] 投射联动(${why}): ${ids.length} 条,写 ${out.exported.written},未变 ${out.exported.unchanged},改名 ${out.suffix.renamed},改回 ${out.suffix.revived}`);
    }
    return out;
}
/**
 * 改名跟随：把 `name` 变更的那批文件搬到新路径（含 `.disable` 兄弟）。
 *
 * 三种盘态：
 * - 旧路径有文件 → 改名到新路径 + 账本换键（键是绝对路径，不换下一轮对账两边都错）；
 * - 旧路径没文件 → 不报错，交给导出按新名补写（这条记录可能从没导出过）；
 * - 新路径已被占用 → 只 warn 不动盘：`rename` 到已存在路径在 Windows 上会 EEXIST，
 *   覆盖等于揉掉别人的投射文件，而 name 唯一性由写入侧管，这里不越权裁决。
 */
async function relocateRenamed(deps, oldNameById, why) {
    const cfg = deps.exportCfg();
    const ledger = deps.ledger();
    if (!cfg.enabled || ledger === undefined || oldNameById.size === 0)
        return;
    const needExport = [];
    let moved = 0;
    for (const [id, oldName] of oldNameById) {
        const r = deps.getByIds([id])[0];
        if (r === undefined || r.name === undefined || r.name === oldName)
            continue;
        const oldTarget = targetFor({ ...r, name: oldName }, cfg.root, deps.dataDir, deps.logger);
        const newTarget = targetFor(r, cfg.root, deps.dataDir, deps.logger);
        if (oldTarget.absPath === undefined || newTarget.absPath === undefined)
            continue;
        // 退场记录的文件住在 `.disable` 上：后缀跟着走，别把无效态搬成有效态。
        const retire = isRetiredRecord(r);
        const from = retire ? disablePathOf(oldTarget.absPath) : oldTarget.absPath;
        const to = retire ? disablePathOf(newTarget.absPath) : newTarget.absPath;
        if (from === to)
            continue;
        if (!(await exists(from))) {
            needExport.push(r);
            continue;
        }
        if (await exists(to)) {
            deps.logger?.warn(`[memory] 改名跟随跳过（目标已存在，不覆盖他人投射）: ${to}`);
            continue;
        }
        try {
            await ensureDir(dirname(to));
            await rename(from, to);
            await moveLedger(ledger, from, to, r, renderRecord(r).text, false);
            moved++;
        }
        catch (err) {
            deps.logger?.warn(`[memory] 改名跟随失败(下轮导出/收敛重试): ${from} → ${to} - ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    // 收尾落一次账：循环里只记脏（逐条 flush 会把整本 JSON 重写 N 次）。
    await ledger.flush();
    if (needExport.length > 0)
        await syncFiles(deps, needExport);
    if (moved > 0)
        deps.logger?.info(`[memory] 改名跟随(${why}): 搬运 ${moved} 个投射文件,补写 ${needExport.length} 条`);
}
/**
 * 造注入给 `L1Store` 的挂钩。契约与 `disableProjectionFile` 一致：同步返回、异常只落日志。
 *
 * 双触发是**允许的**（`recall-feedback(-1)` 仍直接调 `disableProjectionFile` 拿确定性凭证）：
 * 两条路径落到同一形状，第二次要么 ENOENT 兜底、要么 `already` 幂等。
 *
 * **串行队列（真机测出来的，不是洁癖）**：同一批文件与同一本账不能被两个后台任务同时
 * 动。旧写法每次点火就自己开一个 promise，于是「先 `appendNew` 再 `retire`」这种紧邻的两次
 * 点火会重叠：第二个任务的收敛器在第一个还没写出文件时判「盘上没这份」(`absent`)，
 * 什么都不做——退场记录就永久停在 `.memory.md` 上，直到下次全量导出才被抬回来。
 * 串成一条链后，后一个任务看到的是前一个的终态；执行时再按 id 回查快照，拿到的也是最新有效性。
 */
export function makeFileSyncHook(deps) {
    let chain = Promise.resolve();
    const fire = (task, why) => {
        chain = chain
            .then(task)
            .catch((err) => {
            deps.logger?.warn(`[memory] 投射联动失败(${why}，不影响库侧结果，下轮导出重试): ${err instanceof Error ? err.message : String(err)}`);
        });
    };
    return {
        sync: (ids, why) => fire(() => syncFilesByIds(deps, ids, why), why),
        renamed: (oldNameById, why) => fire(() => relocateRenamed(deps, oldNameById, why), why),
    };
}
