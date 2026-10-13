/**
 * 会话"活召回集"存储（G-live）：sessionKey → 本会话已注入、尚未被压缩覆盖的 L1 记录 id。
 *
 * 语义（对齐"当前会话召回后对 session 有影响的条目"，且**旧会话重开也有效**）：
 * - 每次召回**实际注入**（recall.ts 注入成功点）按 **sessionKey**（=agent.session?.id ?? agent.id，
 *   与 pill 的 sessionId、投影 header.id 同源）记入；
 * - 上下文压缩/清空（agent/created source=compact|clear）按 sessionKey 处理，**两者不同**：
 *   `clear`（用户主动清空会话）整表清；`compact`（摘要替换）**不清列表**——这张表是
 *   「本会话召回过什么」的历史，而不是「此刻上下文里还有什么」；尤其**已判过时的条目
 *   是人对这条记忆的裁决凭证**，随压缩消失等于把判定历史抹掉（2026-10-13 用户口径）。
 * - **写穿持久化到 `session-recalled.json`**（独立 sidecar，与 recall-dedupe 同款：串行原子写 +
 *   未知版本/损坏只读降级、失败绝不抛进召回热路径）→ 重启/旧会话重开时 `init()` 载回，卡不空。
 *
 * 供只读端点 `dsh-memory/session-recalled` 消费（client 浮层 SessionRecalledArea 展示）。
 * 不经 memorySlots 投影：那条路会把召回渲染成常驻槽位注册表，与召回的非常驻语义错位。
 */
import * as path from 'node:path';
import type { MemoryLogger } from '../types.js';
import { errDetail } from '../util/filelog.js';
import { ensureDir, readJsonStrict, rmwJson } from '../util/io.js';
import { SESSION_RECALLED_FILE_VERSION } from './file-versions.js';
import { RECALL_DEDUPE_IDS_CAP, RECALL_DEDUPE_SESSION_CAP } from './recall-dedupe.js';

interface RecalledEntry {
  ids: Set<string>;
  /**
   * 受保护条目（人已判过时/软退场的）：淘汰上限不得动它们。
   *
   * 为什么单独记一份而不是现场查库：这个存储只持有 id，退场态在 `l1_records.valid_to` 里；
   * 让存储去依赖 L1Store 会把一个 sidecar 存成检索层的下游。退场发生时由调用方
   * （`recall-feedback` 那条路径）`protect()` 一下，信息就在它手上。
   */
  protectedIds: Set<string>;
  updatedAt: number;
}

interface RecalledFile {
  version: typeof SESSION_RECALLED_FILE_VERSION;
  sessions: Record<string, { recordIds: string[]; protectedIds?: string[]; updatedAt: number }>;
}

/** 条目过期清理（90 天，与 recall-dedupe 同量级）。 */
const PRUNE_MS = 90 * 24 * 3600_000;

export class SessionRecalledStore {
  private readonly file: string;
  private readonly entries = new Map<string, RecalledEntry>();
  private degraded: string | undefined;
  private degradedLogged = false;
  private lastPersisted: string | undefined;
  private writeChain: Promise<void>;
  /** 脏检序号：每次真实变更 +1，投影 apply 据此 O(1) 判断是否重建。 */
  private rev = 0;

  constructor(dataDir: string, private readonly logger?: MemoryLogger) {
    this.file = path.join(dataDir, 'session-recalled.json');
    this.writeChain = this.init();
  }

  revision(): number {
    return this.rev;
  }

  private async init(): Promise<void> {
    const r = await readJsonStrict<Partial<RecalledFile>>(this.file, { expectedVersion: SESSION_RECALLED_FILE_VERSION });
    let data: Partial<RecalledFile> | undefined;
    if (r.ok) {
      data = r.value;
    } else if (r.reason === 'missing') {
      return;
    } else {
      const lenient = await readJsonStrict<Partial<RecalledFile>>(this.file);
      if (!lenient.ok) {
        this.degraded = lenient.reason;
        this.logger?.warn(`[memory] 活召回集文件${lenient.reason === 'corrupt' ? '损坏' : '不可读'}(${this.file})：按空起步且不回写`);
        return;
      }
      data = lenient.value;
      this.degraded = `未知版本(${lenient.version ?? '无 version 字段'})`;
      this.logger?.warn(`[memory] 活召回集文件版本未知(${lenient.version ?? '无'})：按当前形状读取并只读降级(不回写)`);
    }
    this.lastPersisted = JSON.stringify(data);
    if (!data?.sessions || typeof data.sessions !== 'object') return;
    const now = Date.now();
    for (const [sid, entry] of Object.entries(data.sessions)) {
      if (!Array.isArray(entry?.recordIds)) continue;
      if (now - (entry.updatedAt ?? 0) > PRUNE_MS) continue;
      this.entries.set(sid, {
        ids: new Set(entry.recordIds),
        // 旧文件没这个字段（不升版本号：升了会让老文件整体进只读降级），默认空集。
        protectedIds: new Set(Array.isArray(entry.protectedIds) ? entry.protectedIds : []),
        updatedAt: entry.updatedAt ?? now,
      });
    }
  }

  /** 记入本 sessionKey 本轮实际注入的记录 id（写穿；插入序淘汰最旧）。 */
  add(sessionKey: string, recordIds: readonly string[]): void {
    if (!sessionKey || recordIds.length === 0) return;
    let entry = this.entries.get(sessionKey);
    if (!entry) {
      entry = { ids: new Set(), protectedIds: new Set(), updatedAt: 0 };
      this.entries.set(sessionKey, entry);
    }
    for (const id of recordIds) {
      entry.ids.add(id);
      // 淘汰只能淘汰**没被判过时的**：受保护条目数本身超顶时宁可超顶，也不能把人的裁决
      // 凭证挤掉（那等于“因为后面又召回了几条，所以之前那条的判定历史丢了”）。
      while (entry.ids.size > RECALL_DEDUPE_IDS_CAP) {
        const oldest = [...entry.ids].find((x) => !entry!.protectedIds.has(x));
        if (oldest === undefined) break;
        entry.ids.delete(oldest);
        entry.protectedIds.delete(oldest);
      }
    }
    entry.updatedAt = Date.now();
    this.rev++;
    this.writeChain = this.writeChain.then(() => this.persist());
  }

  /**
   * 标为受保护（判过时/软退场）：条目留在列表里，且不受上限淘汰与压缩清理影响。
   * id 不在本会话列表里时忽略（不凭这个调用新建条目）。
   */
  protect(sessionKey: string, recordIds: readonly string[]): void {
    const entry = this.entries.get(sessionKey);
    if (!entry) return;
    let touched = false;
    for (const id of recordIds) {
      if (!entry.ids.has(id) || entry.protectedIds.has(id)) continue;
      entry.protectedIds.add(id);
      touched = true;
    }
    if (!touched) return;
    entry.updatedAt = Date.now();
    this.rev++;
    this.writeChain = this.writeChain.then(() => this.persist());
  }

  list(sessionKey: string): string[] {
    const entry = this.entries.get(sessionKey);
    return entry ? [...entry.ids] : [];
  }

  /**
   * 上下文事件：按原因区分。`'clear'`（用户主动清空）整表清；`'compact'`（摘要替换）**不动**。
   *
   * 旧实现两种都整表清，于是“压缩过一次”就把本会话召回历史（含已判过时的裁决凭证）抹平，
   * 而列表上那些条目本来就是为了让人看见“这条我判过”才保留删除线的。
   * 压缩仍然重置**去重与占用账本**（那两者关心的是“能不能重新注入”，与这张展示表无关）。
   */
  reset(sessionKey: string, reason: 'compact' | 'clear' = 'clear'): void {
    if (reason !== 'clear') return;
    if (!this.entries.has(sessionKey)) return;
    this.entries.delete(sessionKey);
    this.rev++;
    this.writeChain = this.writeChain.then(() => this.persist());
  }

  /**
   * 注：曾有 `remove(sessionKey, recordIds)` 供「声明过时」单条摘除，已删。
   * 理由：用户判过时后条目得留在召回列表里显示删除线，所以**只有** `reset(…, 'clear')`
   * 能让条目离开这张列表（判过时的还受 `protectedIds` 保护，连淘汰都走不到它）。
   */

  size(): number {
    return this.entries.size;
  }

  /** 等待在途持久化写完成（测试/停机）。 */
  flush(): Promise<void> {
    return this.writeChain;
  }

  private async persist(): Promise<void> {
    if (this.degraded !== undefined) {
      if (!this.degradedLogged) {
        this.degradedLogged = true;
        this.logger?.warn(`[memory] 活召回集处于只读降级(${this.degraded})，已停止回写`);
      }
      return;
    }
    try {
      await ensureDir(path.dirname(this.file));
      await rmwJson<RecalledFile, void>(
        this.file,
        async (cur) => {
          const diskRaw = cur.ok ? JSON.stringify(cur.value) : undefined;
          if (this.lastPersisted !== undefined && diskRaw !== undefined && diskRaw !== this.lastPersisted) {
            throw new Error('活召回集文件已被其它进程更新，本次写入取消以避免覆盖');
          }
          const next = this.serialize();
          this.lastPersisted = JSON.stringify(next);
          return { next, result: undefined };
        },
        { logger: this.logger, purpose: 'session-recalled-rmw' },
      );
    } catch (err) {
      this.logger?.warn(`[memory] 活召回集持久化失败(降级内存态): ${errDetail(err)}`);
    }
  }

  private serialize(): RecalledFile {
    const now = Date.now();
    for (const [sid, e] of this.entries) {
      if (now - e.updatedAt > PRUNE_MS && e.updatedAt > 0) this.entries.delete(sid);
    }
    while (this.entries.size > RECALL_DEDUPE_SESSION_CAP) {
      let oldestKey: string | undefined;
      let oldestAt = Infinity;
      for (const [k, e] of this.entries) {
        if (e.updatedAt < oldestAt) {
          oldestAt = e.updatedAt;
          oldestKey = k;
        }
      }
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
    const sessions: RecalledFile['sessions'] = {};
    for (const [sid, e] of this.entries) {
      if (e.ids.size === 0) continue;
      // 不落这个字段 = 保护只活在内存里，重启后判过时的条目又变回可被淘汰的普通条目。
      // 空集不写键：让没保护条目的会话与改动前的文件形状逐字一致（零漂移）。
      sessions[sid] = e.protectedIds.size > 0
        ? { recordIds: [...e.ids], protectedIds: [...e.protectedIds], updatedAt: e.updatedAt }
        : { recordIds: [...e.ids], updatedAt: e.updatedAt };
    }
    return { version: SESSION_RECALLED_FILE_VERSION, sessions };
  }
}
