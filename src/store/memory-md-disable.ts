/**
 * 失效联动（N11 / P1.5）：人在 brief 上点「声明过时」时，除了退场库记录，还要动到投射文件。
 *
 * 为什么这件事在服务端而不是在 brief：brief 只是发一个 RPC，它既不知道记录住在哪个
 * workspace，也不该拿到文件系统的写权限。**库是事实源，文件是投影**——所以退场先成立，
 * 文件侧只是把"人已处置"这件事也写到磁盘上。
 *
 * 后缀不变式（作者口径 2026-10-14）：文件后缀**只跟「这条记录在库里是否有效」有关**，
 * `name` 字段无感，「是谁把它退场的」也无感。所以不能只在一个退场按钮后面挂一刀——
 * 全仓有 8 处 `.retire()` 调用点（手动判过时 / 批量软删 / 合并取代 / 冲突判负 / slot 连带…），
 * 事件挂钩注定会漏。`convergeDisabledSuffix` 就是这个不变式的收敛器：每次导出后按
 * 「文件存在性 + 当前后缀 + 指纹一致性」三项检查重算一遍，与退场路径无关。
 *
 * 点火已由 `L1Store` 的汇流口接管（`store/memory-md-sync.ts`），本模块只供收敛器与
 * 单条凭证两个原件——曾经住在这里的旧「后缀点火器工厂」已退役，不留第二事实源。
 *
 * 单点失效联动（`disableProjectionFile`）的三种落点：
 * - 盘上有 `.memory.md`（**不再要求有 workspace**：无归属那条也要改，它的文件本来就在单根）→ **改名**成 `.memory.md.disable`；
 * - 盘上什么都没有、但**有** workspace → **创建** `.disable`（内容就是渲染结果，带 `retired: true`），
 *   人不点导出也有一份磁盘凭证，P2 与人都看得见；
 * - 盘上什么都没有、且没有 workspace → **什么都不写**。宁缺勿猜：为一个归属不明的记忆在单根凭空造文件，
 *   等于把"没路由上"伪装成"它属于默认根"。
 *
 * 三条硬约束：
 * 1. **绝不抛**：退场已经成功，文件侧失败不能把端点变成 500（那会让人以为标注没生效）。
 * 2. **幂等**：`.disable` 已在就返回 `already`，再点一次 `-1` 不会长出第二个凭证。
 * 3. **改名而不是删除**：`.disable` 是凭证，删了 P2 与人都无从对齐。
 */
import { dirname } from 'node:path';
import { readFile, rename, rm, stat } from 'node:fs/promises';
import { atomicWriteText, ensureDir } from '../util/io.js';
import { disablePathOf, digest, isRetiredRecord, recordDigest, renderRecord, targetFor } from './memory-md.js';
import type { SuffixReport } from './memory-md-types.js';
import type { MdLedgerStore } from './memory-md-ledger.js';
import type { MemoryLogger, MemoryRecord } from '../types.js';

/** 文件侧的结果，原样进端点响应（面板看得见"到底动没动文件"）。 */
export type DisableOutcome = 'renamed' | 'created' | 'already' | 'no-workspace' | 'failed';

/**
 * 退场判据的单一真源在 `memory-md.ts`（导出侧与这里必须共用一个），本模块只转发，
 * 免得既有调用方拿不到。另起一套（比如再叠上 `persistence`）只会让"列表说它退了、
 * 文件却没后缀"重新变成常态。
 */
export { isRetiredRecord };

export interface DisableDeps {
  /**
   * 刚被退场的那条记录。调用方应传**退场后**的快照（带 `dsh_superseded` 标记，
   * 门1 解耦后 md 层按 marker 判退场），这样渲染出的 frontmatter 自然包含
   * `retired: true`——凭证自己就说清了它为什么存在。
   */
  record: MemoryRecord;
  /** `cfg.memExport.root`（只管无 workspace 那批，这里用不到但落点函数要它）。 */
  cfgRoot: string | undefined;
  dataDir: string;
  ledger: MdLedgerStore;
  logger?: MemoryLogger;
}

/** 存在性判定：一次 `stat`，任何错误都当"不存在"（权限/竞态都不该让失效动作失败）。 */
async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 账本跟着换键。
 *
 * 键是绝对路径（N10），所以改名必须"删旧键、记新键"——只改文件不改账本，下一轮对账
 * 会同时报"旧键文件缺失"和"新文件是外人加的"，两边都错。
 * 没有旧条目（人从没导出过）时只记新键，不补造旧键。
 *
 * ⚠️ `fileDigest` **取磁盘上的真实字节**，不取我们手上那份渲染结果：改名分支里
 * 旧文件是“未退场时导出的那一版”（不带 `retired`），拿新渲染的摘要当基线，
 * 下一轮对账就会把“我们自己改的文件”报成“人改过文件”。
 *
 * @param persist - 默认 true（单条失效联动：写完就该落盘）。**批量收敛必须传 false**：
 * 账本是整本 JSON 的原子重写，每条都 `flush()` 就把「窗口内只记脏、收尾落一次」
 * 的设计退化成 O(n²)（真机 912 条回填会被墙钟 `timeBudgetMs` 拦成好几次点击）。
 *
 * 导出给 `memory-md-sync.ts` 的改名跟随用——「取磁盘真实字节当基线」这条纪律只该有一份。
 */
export async function moveLedger(
  ledger: MdLedgerStore,
  fromAbs: string,
  toAbs: string,
  r: MemoryRecord,
  fallbackText: string,
  persist = true,
): Promise<void> {
  const prev = ledger.get(fromAbs);
  const st = await stat(toAbs).catch(() => undefined);
  const actual = await readFile(toAbs, 'utf8').catch(() => fallbackText);
  ledger.set(toAbs, {
    id: r.id,
    extKey: r.extKey ?? '',
    root: prev?.root ?? '',
    relPath: prev?.relPath ?? '',
    dbDigest: recordDigest(r),
    fileDigest: digest(actual),
    fileMtimeMs: st?.mtimeMs ?? 0,
    fileSize: st?.size ?? 0,
    syncedAt: new Date().toISOString(),
  });
  if (prev !== undefined) ledger.delete(fromAbs);
  if (persist) await ledger.flush();
}

/**
 * 把一条已退场记忆的投射文件标成 `.disable`。
 *
 * @param deps - 记录、根配置、数据目录、账本与日志。
 * @returns 文件侧结果；**任何异常都收敛成 `'failed'`，不抛**。
 */
export async function disableProjectionFile(deps: DisableDeps): Promise<DisableOutcome> {
  const { record: r, ledger, logger } = deps;
  const ws = (r.workspaceId ?? '').trim();
  try {
    const target = targetFor(r, deps.cfgRoot, deps.dataDir, logger);
    const abs = target.absPath;
    if (abs === undefined) {
      logger?.warn(`[memory] 失效联动跳过（路径越界）: ${r.id} → ${target.relPath}`);
      return 'failed';
    }
    const dis = disablePathOf(abs);
    const { text } = renderRecord(r);
    if (await exists(dis)) {
      // 已经是 .disable：仍要确保账本认得它（上一轮可能改完文件就崩了）。
      if (ledger.get(dis) === undefined) await moveLedger(ledger, abs, dis, r, text);
      return 'already';
    }
    if (await exists(abs)) {
      try {
        await rename(abs, dis);
      } catch (err) {
        // 竞态兜底：存在性检查和改名之间，收口挂钩可能已经把这个文件改走了（同一批次
        // 双触发时两条路径都会走到这里）。改成功过的文件再改名报 ENOENT——盘上已经是
        // 想要的那份，该报 `already`，不该刷 warn（真机日志里噪声会淹掉真失败）。
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT' && await exists(dis)) {
          if (ledger.get(dis) === undefined) await moveLedger(ledger, abs, dis, r, text);
          return 'already';
        }
        throw err;
      }
      await moveLedger(ledger, abs, dis, r, text);
      logger?.info(`[memory] 声明过时 → 投射文件已改名: ${dis}`);
      return 'renamed';
    }
    // 盘上什么都没有：无归属时不凭空在单根造文件（原「宁缺勿猜」红线只保留在这一分支）。
    // 旧写法是在函数入头就早退，于是「导出能写进单根、退场却改不了名」——写得出收不回。
    if (ws.length === 0) return 'no-workspace';
    await ensureDir(dirname(dis));
    await atomicWriteText(dis, text);
    await moveLedger(ledger, abs, dis, r, text);
    logger?.info(`[memory] 声明过时 → 已创建失效凭证（此前未导出过）: ${dis}`);
    return 'created';
  } catch (err) {
    logger?.warn(
      `[memory] 失效联动文件侧失败（退场已完成，不回滚）: ${r.id} - ${err instanceof Error ? err.message : String(err)}`,
    );
    return 'failed';
  }
}

/** 让出事件循环一次：收敛是长任务，不能独占 tick（面板会僵）。 */
function tick(): Promise<void> {
  return new Promise((resolveTick) => { setImmediate(resolveTick); });
}

/**
 * 盘上这份是不是被人改过：拿真实字节与账本的 `fileDigest` 比。
 *
 * 没账（从没导出过 / 首轮基线未建）时返回 false——“没基线”不等于“被改过”。
 * 注意这里只诊断不阻断：改名只动后缀、不动字节，所以人改的内容跟着文件一起走，
 * 丢不了；计数与重新记账是为了让下一遍对账能把这件事说清。
 */
async function looksEdited(ledger: MdLedgerStore, abs: string): Promise<boolean> {
  const prev = ledger.get(abs);
  if (prev === undefined) return false;
  const actual = await readFile(abs, 'utf8').catch(() => undefined);
  return actual !== undefined && digest(actual) !== prev.fileDigest;
}

export interface SuffixConvergeDeps {
  /** 全量记录（含退场的）——收敛是库→盘的形状对齐，不是增量事件。 */
  records: readonly MemoryRecord[];
  cfgRoot: string | undefined;
  dataDir: string;
  ledger: MdLedgerStore;
  /** 与 `exportRecords` 同口径：只约束**真碰了磁盘**的动作数，判为“形状已对”的不吃配额。 */
  maxRecords: number;
  timeBudgetMs: number;
  logger?: MemoryLogger;
  /** 注入时钟（测试用）。 */
  now?: () => number;
}

/**
 * 后缀不变式收敛：把「库里的有/无效」与「文件的 `.memory.md` / `.memory.md.disable`」对齐。
 *
 * 为什么挂在导出后面而不是各个退场调用点：那 8 处 `.retire()` 分布在手动软删、批量退场、
 * 合并取代、冲突判负、slot 连带等路径上，事件挂钩注定会漏（真机实测：920 条退场记录
 * 只有 8 个 `.disable`，全部来自召回面板那一条路径）。收敛器只依赖三个可观测事实：
 * 文件存在性、当前后缀、指纹一致性。
 *
 * 护栏与导出同一套（`maxRecords` 只数碰盘动作 + `timeBudgetMs` 墙钟），所以第一次点可能只
 * 收敛一部分，`capped`/`remaining` 会告诉你还要点几次。
 */
export async function convergeDisabledSuffix(deps: SuffixConvergeDeps): Promise<SuffixReport> {
  const { records, ledger, logger } = deps;
  const startedAt = (deps.now ?? Date.now)();
  const rep: SuffixReport = {
    scanned: 0, renamed: 0, revived: 0, edited: 0, already: 0, both: 0, absent: 0, skipped: 0, remaining: 0, capped: false,
  };
  let worked = 0;
  for (let i = 0; i < records.length; i++) {
    // 两条护栏都在循环顶部查：写在末尾会被 `continue` 跳过（exportRecords 自家测试抓过）。
    if (worked >= deps.maxRecords || (deps.now ?? Date.now)() - startedAt >= deps.timeBudgetMs) {
      rep.capped = true;
      rep.remaining = records.length - i;
      break;
    }
    const r = records[i];
    if (r === undefined) continue;
    rep.scanned++;
    const target = targetFor(r, deps.cfgRoot, deps.dataDir, logger);
    const abs = target.absPath;
    if (abs === undefined) {
      rep.skipped++;
      logger?.warn(`[memory] 后缀收敛跳过（路径越界）: ${r.id} → ${target.relPath}`);
      continue;
    }
    const dis = disablePathOf(abs);
    try {
      const hasDis = await exists(dis);
      const hasAbs = await exists(abs);
      if (isRetiredRecord(r)) {
        if (hasDis && hasAbs) {
          // 两份都在：可能是上一遍改名中途崩了，也可能是人复制了一份。删哪份都是不可逆判断，
          // 所以只报账，交孤儿归档/人裁决。
          rep.both++;
          continue;
        }
        if (hasDis) {
          // 后缀已对上；仍要保证账本认得它（改完文件就崩的残留态）。
          if (ledger.get(dis) === undefined) {
            await moveLedger(ledger, abs, dis, r, renderRecord(r).text, false);
            worked++;
          }
          rep.already++;
          continue;
        }
        if (!hasAbs) { rep.absent++; continue; }
        if (await looksEdited(ledger, abs)) rep.edited++;
        try {
          await rename(abs, dis);
        } catch (err) {
          // 与 `disableProjectionFile` 同一条竞态兜底：双触发时另一条路径可能已把这份改走了。
          // 盘上已是想要的那份 → 算 `already`，不刷 warn（否则噪声会淹掉真失败）。
          if (err instanceof Error && 'code' in err && err.code === 'ENOENT' && await exists(dis)) {
            if (ledger.get(dis) === undefined) await moveLedger(ledger, abs, dis, r, renderRecord(r).text, false);
            rep.already++;
            continue;
          }
          throw err;
        }
        await moveLedger(ledger, abs, dis, r, renderRecord(r).text, false);
        rep.renamed++;
        worked++;
        await tick();
        continue;
      }
      // 有效记录：后缀应该是 `.memory.md`。
      if (hasDis && !hasAbs) {
        const entry = ledger.get(dis);
        if (entry === undefined || entry.id !== r.id) {
          // 人手造的 `.disable` 是文件侧退场凭证（recall-feedback 的文件侧对偶）。
          // P2 关着时库里不知道这件事，自动改回去等于揉掉人的裁决 → 只报账不动盘。
          rep.both++;
          continue;
        }
        await rename(dis, abs);
        await moveLedger(ledger, dis, abs, r, renderRecord(r).text, false);
        rep.revived++;
        worked++;
        await tick();
        continue;
      }
      if (hasDis && hasAbs) {
        // 有效记录两份都在。多数不是人手复制，而是「恢复后导出补写了非退场路径，
        // `.disable` 那份还留着」——不收这一格，恢复一轮就会永久多出双份。
        // 删得同时满足三个条件才算“机器自己造的陈年标记”，不丢任何信息：
        // ① 凭证确实是我们给**这条记录**写的（账本同 id）；② 它自我们写下后没被人改过
        //（磁盘字节 == 账本 fileDigest）；③ `.memory.md` 这份就是我们当前渲染的那份
        //（人手放的一份不会正好等于渲染结果）。任一不成立 → 只报账，交人裁决。
        const entry = ledger.get(dis);
        const disText = await readFile(dis, 'utf8').catch(() => undefined);
        const absText = await readFile(abs, 'utf8').catch(() => undefined);
        if (entry !== undefined && entry.id === r.id
          && disText !== undefined && digest(disText) === entry.fileDigest
          && absText !== undefined && absText === renderRecord(r).text) {
          await rm(dis);
          ledger.delete(dis);
          rep.revived++;
          worked++;
          await tick();
          continue;
        }
        rep.both++;
        continue;
      }
      if (hasAbs) { rep.already++; continue; }
      rep.absent++;
    } catch (err) {
      // 单条失败不阻断整批：下一遍还会重算（收敛是无状态的）。
      rep.skipped++;
      logger?.warn(`[memory] 后缀收敛失败(下轮重试): ${abs} - ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // 收尾落一次账：循环里只记脏（`moveLedger` 的 `persist=false`）。中途崩了就丢本轮账，
  // 但收敛器无状态且幂等——下一遍重算即可，所以不值得为它每条写一次整本 JSON。
  await ledger.flush();
  if (rep.renamed + rep.revived + rep.both + rep.edited > 0) {
    logger?.info(`[memory] 后缀收敛：改名 ${rep.renamed}（其中人改过 ${rep.edited}）· 改回 ${rep.revived} · 已对 ${rep.already} · 冲突 ${rep.both} · 无文件 ${rep.absent}${rep.capped ? ` · 剩余 ${rep.remaining}` : ''}`);
  }
  return rep;
}

