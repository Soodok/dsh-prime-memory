import type { MemoryLogger } from '../types.js';
/** 每类目录下的索引文件名（不带 `.memory.md`，因此天然落在投射/扫描面之外）。 */
export declare const SKELETON_INDEX_FILE = "_index.md";
export interface SkeletonDeps {
    /** 要补骨架的投射根（绝对路径）列表。单根必补、workspace 根按需由调用方决定。 */
    roots: readonly string[];
    /** 目录名（= 类型）→ 库里条数；缺省按 0 计（0 也写，否则"没目录"与"0 条"仍无法区分）。 */
    countsByType: ReadonlyMap<string, number>;
    /** 诊断口：任何单目录写失败只走它留痕，绝不抛挂整轮。 */
    logger?: MemoryLogger;
}
/**
 * 往每个投射根补齐 37 类目录及各自的 `_index.md`。
 *
 * @param deps - 见 `SkeletonDeps`。
 * @returns 无（副作用为落盘）。任何单目录失败只 warn，不抛。
 */
export declare function ensureTypeSkeleton(deps: SkeletonDeps): Promise<void>;
