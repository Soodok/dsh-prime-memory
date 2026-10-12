/**
 * 类型目录骨架 + `_index.md`（pm-name-distill Phase 4 / task_4.1）。
 *
 * 投射根（`<dataDir>/memories/` 或 `cfg.memExport.root`）过去只有"库里出现过记录"的类型目录
 * （实测 6 个）；词表已扩到 37 类。空目录会被 git/压缩包吐掉，而"没这个目录"与"这类 0 条"
 * 在人眼里长得一样——所以每类目录固定放一个 `_index.md`（类名 + 库里条数），目录集合从
 * **词表真源** `memoryTypeDirs()` 派生，不再手抄。
 *
 * 三条纪律：
 * 1. **幂等**：内容不变就不重写（也不刷 mtime）。投射是"库 → 文件"的旁路，重刷 mtime 会让
 *    下一轮对账把"我们没动过"误判成"文件被改过"——与 `exportRecords` 的 mtime 纪律同口径。
 * 2. **失败只 warn 不抛**：旁路写挂不能弄挂记忆本体（照 `resolveMemoriesRoot` / 导出侧的降级口径）。
 * 3. **原子落盘**：临时文件 + rename，走仓内既有范式 `atomicWriteText`（带 fsync / 安全路径校验 /
 *    失败清理）；根不存在由它内部 `ensureDir` recursive 建出。
 *
 * `_index.md` 刻意**不是**投射文件：md-sync 只认 `.memory.md` / `.memory.md.disable` 后缀
 * （`listProjectionFiles`），孤儿扫描只遍历账本键（`sweepOrphanFiles`）——本模块从不把
 * `_index.md` 写进账本，故两条通路都不会碰它（防误伤用例把这两条钉成断言）。
 */
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { MEMORY_TYPE_LABELS, memoryTypeDirs } from '../memory-types.js';
import { atomicWriteText } from '../util/io.js';
import type { MemoryLogger } from '../types.js';

/** 每类目录下的索引文件名（不带 `.memory.md`，因此天然落在投射/扫描面之外）。 */
export const SKELETON_INDEX_FILE = '_index.md';

export interface SkeletonDeps {
  /** 要补骨架的投射根（绝对路径）列表。单根必补、workspace 根按需由调用方决定。 */
  roots: readonly string[];
  /** 目录名（= 类型）→ 库里条数；缺省按 0 计（0 也写，否则"没目录"与"0 条"仍无法区分）。 */
  countsByType: ReadonlyMap<string, number>;
  /** 诊断口：任何单目录写失败只走它留痕，绝不抛挂整轮。 */
  logger?: MemoryLogger;
}

/**
 * 渲染一个目录的索引文本（纯函数：同一 (dir,label,count) 永远同一字节，幂等判据靠它）。
 * 含类名标签、类型 id、条数三项——条数为 0 也如实写"0"。
 */
function renderIndex(dir: string, label: string, count: number): string {
  return `# ${label}\n\n- 类型: ${dir}\n- 条数: ${count}\n`;
}

/**
 * 往每个投射根补齐 37 类目录及各自的 `_index.md`。
 *
 * @param deps - 见 `SkeletonDeps`。
 * @returns 无（副作用为落盘）。任何单目录失败只 warn，不抛。
 */
export async function ensureTypeSkeleton(deps: SkeletonDeps): Promise<void> {
  const { roots, countsByType, logger } = deps;
  // 目录集合来自词表真源，杜绝手抄漂移（换词表不改这里也不会静默少目录）。
  const dirs = memoryTypeDirs();
  for (const root of roots) {
    for (const dir of dirs) {
      const abs = join(root, dir, SKELETON_INDEX_FILE);
      const count = countsByType.get(dir) ?? 0;
      const label = MEMORY_TYPE_LABELS[dir] ?? dir;
      const text = renderIndex(dir, label, count);
      try {
        // 读现内容比对：一致就跳过——既不重写，也不碰 mtime（atomicWriteText 会 rename 换 inode 刷 mtime）。
        const existing = await readFile(abs, 'utf8').catch(() => undefined);
        if (existing === text) continue;
        await atomicWriteText(abs, text, { logger });
      } catch (err) {
        logger?.warn(
          `[memory] 类型骨架写入失败(旁路，不影响投射本体): ${abs} - ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
