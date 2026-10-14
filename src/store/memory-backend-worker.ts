/**
 * 后台记忆 worker:在自己的线程里**自开一条 SQLite 连接**,
 * 让后台批处理(反刍/回填/重标定)的同步 SQL 不再占住宿主主事件循环。
 *
 * ## 为什么安全
 *
 * - 只执行**读**与**纯 metadata 写**四个方法,不碰嵌入(见 `memory-backend.ts` 的说明)。
 * - `sqlite.ts:161` 已设 `PRAGMA busy_timeout = 5000` + WAL 已开 → 多连接并发读写安全。
 * - 崩溃 / 退出 → 在途请求全部 **reject 并留日志**(不静默挂起,与 R3 同一约束)。
 *
 * ## 降级
 *
 * 起线程失败(宿主禁 worker / 资产缺失)或线程崩溃时,调用方应退回
 * `InProcMemoryBackend`。**后台路径不允许因为隔离失败而失效。**
 */
import { Worker } from 'node:worker_threads';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MemoryLogger, MemoryRecord } from '../types.js';
import type { L1MetaLite } from './sqlite.js';
import type { L1ListOpts, L1ListResult, MemoryBackend } from './memory-backend.js';

/** worker 资产路径:dist/store/ → dist/store/memory-worker.js(tsc 产出)。 */
function defaultWorkerPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'memory-worker.js');
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export interface WorkerMemoryBackendOpts {
  /** 与主线程同一个 db 文件路径(worker 内自开连接)。 */
  dbPath: string;
  /** 向量维度(0 = 纯 FTS);只影响建表,本 worker 不做检索。 */
  dimensions: number;
  logger?: MemoryLogger;
  /** 单命令超时(ms);超时只 reject 该命令,不杀线程。默认 30s。 */
  timeoutMs?: number;
  /** worker 资产路径覆盖(测试用:源码态下 dist 产物不存在)。 */
  workerPath?: string;
}

export class WorkerMemoryBackend implements MemoryBackend {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private readonly logger?: MemoryLogger;
  private readonly timeoutMs: number;
  private nextId = 1;
  private alive = true;
  private crashReason: string | undefined;

  constructor(opts: WorkerMemoryBackendOpts) {
    this.logger = opts.logger;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.worker = new Worker(opts.workerPath ?? defaultWorkerPath(), {
      workerData: { dbPath: opts.dbPath, dimensions: opts.dimensions },
    });
    this.worker.on('message', (msg: { id?: number; ok?: boolean; value?: unknown; error?: string }) => {
      if (!msg || typeof msg.id !== 'number') return;
      const entry = this.pending.get(msg.id);
      if (!entry) return; // 迟到回复(调用方已超时放弃)
      this.pending.delete(msg.id);
      if (msg.ok) entry.resolve(msg.value);
      else entry.reject(new Error(msg.error ?? 'memory worker 调用失败'));
    });
    this.worker.on('error', (err) => this.failAll(`记忆 worker 线程错误: ${err.message}`));
    this.worker.on('exit', (code) => {
      if (this.alive) this.failAll(`记忆 worker 线程退出(code=${code})`);
    });
  }

  /** 线程不可用(崩溃/已释放)时快速拒绝:postMessage 到死线程是静默无回应。 */
  private guard(): void {
    if (!this.alive) throw new Error(this.crashReason ?? '记忆 worker 已释放');
  }

  private failAll(reason: string): void {
    this.alive = false;
    this.crashReason = reason;
    this.logger?.warn(`[memory] ${reason};在途 ${this.pending.size} 个后台请求已拒绝(退回进程内后端)`);
    for (const [, entry] of this.pending) entry.reject(new Error(reason));
    this.pending.clear();
  }

  private call<T>(method: string, args: unknown[]): Promise<T> {
    this.guard();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`记忆 worker 调用超时(${method}, ${this.timeoutMs}ms)`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.worker.postMessage({ id, method, args });
    });
  }

  async allLite(limit: number, offset: number): Promise<L1MetaLite[]> {
    return this.call<L1MetaLite[]>('allLite', [limit, offset]);
  }

  async getByIds(ids: string[]): Promise<MemoryRecord[]> {
    if (ids.length === 0) return [];
    return this.call<MemoryRecord[]>('getByIds', [ids]);
  }

  async list(opts: L1ListOpts): Promise<L1ListResult> {
    return this.call<L1ListResult>('list', [opts]);
  }

  async patchMetadata(id: string, metadata: Record<string, unknown>): Promise<boolean> {
    return this.call<boolean>('patchMetadata', [id, metadata]);
  }

  async patchMetadataAndReindex(id: string, metadata: Record<string, unknown>): Promise<boolean> {
    return this.call<boolean>('patchMetadataAndReindex', [id, metadata]);
  }

  async size(): Promise<number> {
    return this.call<number>('size', []);
  }

  async dispose(): Promise<void> {
    this.alive = false;
    this.failAll('记忆 worker 已释放');
    await this.worker.terminate();
  }
}

/**
 * 建后端:优先 worker,起不来就退回进程内。
 *
 * **隔离失败绝不能让后台处理失效** —— 所以这里 catch 掉一切并降级,
 * 只留一条 warn(与"静默丢弃"相反:降级是可观测的)。
 */
export async function createMemoryBackend(
  workerOpts: WorkerMemoryBackendOpts,
  fallback: MemoryBackend,
): Promise<MemoryBackend> {
  try {
    const backend = new WorkerMemoryBackend(workerOpts);
    // 探活:起线程成功不代表连库成功(路径/权限/互斥),先真跑一次最廉价的读
    await backend.allLite(1, 0);
    workerOpts.logger?.info('[memory] 后台记忆后端:worker 隔离已启用');
    return backend;
  } catch (err) {
    workerOpts.logger?.warn(
      `[memory] 后台记忆 worker 不可用,退回进程内(不影响功能): ${err instanceof Error ? err.message : String(err)}`,
    );
    return fallback;
  }
}
