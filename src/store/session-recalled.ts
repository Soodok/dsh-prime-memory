/**
 * 会话"活召回集"累积器（G-live）：ownerId → 本会话已注入、尚未被压缩覆盖的 L1 记录 id。
 *
 * 语义（对齐用户需求"当前会话召回后对 session 有影响的条目"）：
 * - 每次召回**实际注入**（recall.ts 注入成功点）按 **ownerId**（resolveModeOwner，与档位/pill 同源，
 *   非 agent.id——子代理归到父会话）记入；
 * - 上下文压缩/清空（agent/created source=compact|clear）按 ownerId **reset**——注入内容已离开模型上下文；
 * - **纯内存 volatile，不落盘**：这是"当前进程活上下文"视图，重启即空、随召回重新填充，
 *   刻意避开磁盘契约/快照哈希/版本分层那一整套（无持久化 = 无失配风险）。
 *
 * 供只读端点 `dsh-memory/session-recalled` 消费，喂侧栏"本会话召回"卡。
 */
import { RECALL_DEDUPE_IDS_CAP, RECALL_DEDUPE_SESSION_CAP } from './recall-dedupe.js';

interface RecalledEntry {
  ids: Set<string>;
  updatedAt: number;
}

export class SessionRecalledStore {
  private readonly entries = new Map<string, RecalledEntry>();

  /** 记入本 ownerId 本轮实际注入的记录 id（插入序淘汰最旧，防无界）。 */
  add(ownerId: string, recordIds: readonly string[]): void {
    if (!ownerId || recordIds.length === 0) return;
    let entry = this.entries.get(ownerId);
    if (!entry) {
      entry = { ids: new Set(), updatedAt: 0 };
      this.entries.set(ownerId, entry);
    }
    for (const id of recordIds) {
      entry.ids.add(id);
      while (entry.ids.size > RECALL_DEDUPE_IDS_CAP) {
        const oldest = entry.ids.values().next().value;
        if (oldest === undefined) break;
        entry.ids.delete(oldest);
      }
    }
    entry.updatedAt = Date.now();
    // 会话条目上限：按 updatedAt 淘汰最旧（防长跑进程内存无界）
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
  }

  /** 该 ownerId 当前的活召回集（插入序，最新在后）；无则空数组。 */
  list(ownerId: string): string[] {
    const entry = this.entries.get(ownerId);
    return entry ? [...entry.ids] : [];
  }

  /** 压缩/清空：该会话注入内容已离开上下文，清空其活召回集。 */
  reset(ownerId: string): void {
    this.entries.delete(ownerId);
  }

  /** 诊断/测试：当前跟踪的会话数。 */
  size(): number {
    return this.entries.size;
  }
}
