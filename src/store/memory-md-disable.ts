/**
 * 失效联动（N11 / P1.5）：人在 brief 上点「声明过时」时，除了退场库记录，还要动到投射文件。
 *
 * 为什么这件事在服务端而不是在 brief：brief 只是发一个 RPC，它既不知道记录住在哪个
 * workspace，也不该拿到文件系统的写权限。**库是事实源，文件是投影**——所以退场先成立，
 * 文件侧只是把"人已处置"这件事也写到磁盘上。
 *
 * 三种落点（用户口径）：
 * - 有 workspace 且 `.memory.md` 存在 → **改名**成 `.memory.md.disable`；
 * - 有 workspace 但文件还没导出过 → **创建** `.disable`（内容就是渲染结果，带 `retired: true`），
 *   人不点导出也有一份磁盘凭证，P2 与人都看得见；
 * - 没有 workspace → **什么都不写**。宁缺勿猜：为一个归属不明的记忆在单根凭空造文件，
 *   等于把"没路由上"伪装成"它属于默认根"。
 *
 * 三条硬约束：
 * 1. **绝不抛**：退场已经成功，文件侧失败不能把端点变成 500（那会让人以为标注没生效）。
 * 2. **幂等**：`.disable` 已在就返回 `already`，再点一次 `-1` 不会长出第二个凭证。
 * 3. **改名而不是删除**：`.disable` 是凭证，删了 P2 与人都无从对齐。
 */
import { dirname } from 'node:path';
import { readFile, rename, stat } from 'node:fs/promises';
import { atomicWriteText, ensureDir } from '../util/io.js';
import { disablePathOf, digest, recordDigest, renderRecord, targetFor } from './memory-md.js';
import type { MdLedgerStore } from './memory-md-ledger.js';
import type { MemoryLogger, MemoryRecord } from '../types.js';

/** 文件侧的结果，原样进端点响应（面板看得见"到底动没动文件"）。 */
export type DisableOutcome = 'renamed' | 'created' | 'already' | 'no-workspace' | 'failed';

export interface DisableDeps {
  /**
   * 刚被退场的那条记录。调用方应传**退场后**的快照（带 `validTo`），这样渲染出的
   * frontmatter 自然包含 `retired: true`——凭证自己就说清了它为什么存在。
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
 */
async function moveLedger(
  ledger: MdLedgerStore,
  fromAbs: string,
  toAbs: string,
  r: MemoryRecord,
  fallbackText: string,
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
  await ledger.flush();
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
  if (ws.length === 0) return 'no-workspace';
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
      await rename(abs, dis);
      await moveLedger(ledger, abs, dis, r, text);
      logger?.info(`[memory] 声明过时 → 投射文件已改名: ${dis}`);
      return 'renamed';
    }
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
