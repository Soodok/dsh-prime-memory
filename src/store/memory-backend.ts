/**
 * 记忆后端边界(**后台批处理专用**)。
 *
 * ## 为什么有这一层
 *
 * `better-sqlite3` 是**同步 API**:任何一次 DB 调用都会占住宿主主事件循环。
 * 后台任务(反刍 / 回填 / 重标定)每次读写都在和面板 RPC 抢这根线程,
 * `yieldLoop()` 只是让位止痛药,不是解药。
 *
 * 本接口把后台路径的 DB 访问收敛成 5 个显式方法,于是:
 * - 当前:`InProcMemoryBackend`(包 L1Store 同步方法,行为与改造前等价);
 * - 将来:`WorkerMemoryBackend`(worker_threads 内自开连接)乃至进程外服务 / Rust 二进制
 *   —— **调用方一行不改**。这就是 C(独立进程)的"铺路"。
 *
 * ## 刻意不在这个接口里的东西
 *
 * - ❌ **`upsert`**:`L1Store.upsert()` 内部会通过 `EmbedHelper.batch()` **重算嵌入向量**。
 *   搬进 worker 后 worker 拿不到真实 embedding service,零向量会被 upsertL1 判定为
 *   "不可嵌入"而**删掉已有向量行** —— 静默毁数据。故 upsert 留在进程内。
 *   顺带:只改 metadata 的写回本来就不该重嵌,统一走 `patchMetadata`。
 * - ❌ **热路径**:`hooks/recall.ts` / `hooks/capture.ts` 每轮调 DB,
 *   线程/进程化会让每条消息都付一次 IPC 税。它们不走本接口。
 */
import type { L1Store } from './l1.js';
import type { L1MetaLite } from './sqlite.js';
import type { MemoryRecord } from '../types.js';

/** `list` 的入参(与 `L1Store.list` 同形,去掉必填的 limit/offset 由调用方给)。 */
export interface L1ListOpts {
  type?: string;
  scene?: string;
  family?: string;
  hall?: string;
  halls?: readonly string[];
  /** Room 过滤(自生长 slug tag)。 */
  tag?: string;
  workspaceId?: string;
  limit: number;
  offset: number;
}

export interface L1ListResult {
  items: MemoryRecord[];
  total: number;
}

export interface MemoryBackend {
  /** 游标分批取 L1 元信息(仅 id/type/metadata 三列)。 */
  allLite(limit: number, offset: number): Promise<L1MetaLite[]>;
  /** 按 id 精确取完整记录。 */
  getByIds(ids: string[]): Promise<MemoryRecord[]>;
  /** 浏览/筛选列表。 */
  list(opts: L1ListOpts): Promise<L1ListResult>;
  /** **只**更新 metadata_json(不动 content,不重算嵌入)。 */
  patchMetadata(id: string, metadata: Record<string, unknown>): Promise<boolean>;
  /** 写 metadata_json + 重索引该行的 `l1_fts`（关键词回填专用；新 `dsh_keywords` 要立刻进 BM25 轴）。 */
  patchMetadataAndReindex(id: string, metadata: Record<string, unknown>): Promise<boolean>;
  /** L1 记录总数(巡检进度分母)。 */
  size(): Promise<number>;
  /** 释放后端(worker 实现会 terminate 线程)。 */
  dispose(): Promise<void>;
}

/**
 * 进程内实现:直接包 `L1Store` 的既有同步方法。
 *
 * 行为与改造前**完全等价**(零 IPC),用于:① 默认路径 ② worker 不可用时的降级
 * ③ 单测。把"接口化"和"线程化"分成两步,是为了让回归可归因。
 */
export class InProcMemoryBackend implements MemoryBackend {
  constructor(private readonly l1: L1Store) {}

  async allLite(limit: number, offset: number): Promise<L1MetaLite[]> {
    return this.l1.allLite(limit, offset);
  }

  async getByIds(ids: string[]): Promise<MemoryRecord[]> {
    return this.l1.getByIds(ids);
  }

  async list(opts: L1ListOpts): Promise<L1ListResult> {
    return this.l1.list(opts);
  }

  async patchMetadata(id: string, metadata: Record<string, unknown>): Promise<boolean> {
    return this.l1.patchMetadata(id, metadata);
  }

  async patchMetadataAndReindex(id: string, metadata: Record<string, unknown>): Promise<boolean> {
    return this.l1.patchMetadataAndReindex(id, metadata);
  }

  async size(): Promise<number> {
    return this.l1.size;
  }

  async dispose(): Promise<void> {
    /* 进程内实现不持有资源:db 生命周期归插件所有 */
  }
}
