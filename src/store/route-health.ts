/**
 * 蒸馏路由健康学习(R9)：按 `provider/model` 记「自适应退避后实测跑通的最小块长」，
 * 跨进程留存，令下次 perChunk 初值直接取跑通过的值、不必每进程重付退避风暴；
 * 面板可回显「实测最小可用块长 / 最后退避长度」。
 *
 * 运行时学习值、非磁盘契约：
 * - 读 **fail-open**（缺文件/损坏/未知版本 → 空表起步，绝不抛、不阻蒸馏——学习值丢了最多少一次优化）；
 * - 写走 `atomicWriteJson`（原子 + 覆盖保护）；
 * - **只降不升**：更小的跑通块长才覆盖 lastGood（换 provider/过期由读侧决定重探，见 R5 接线）。
 *
 * 本模块 Phase 1 仅落地存储与纯逻辑，尚未接线到 runExtraction（接线在 Phase 4 R5/R9）。
 */
import * as path from 'node:path';
import { atomicWriteJson, readJsonStrict } from '../util/io.js';
import { ROUTE_HEALTH_FILE_VERSION } from './file-versions.js';

/** 单条路由健康记录。 */
export interface RouteHealthEntry {
  /** 退避后实测跑通的最小块长(字符)；0 = 未学到。 */
  lastGoodChunkChars: number;
  /** 该路由延迟 EMA(ms)；0 = 未记。R5 自适应可据此调初值。 */
  latencyEmaMs: number;
  /** 最近一次记录时刻(ISO)。 */
  updatedAt: string;
}

interface RouteHealthFile {
  version: number;
  routes: Record<string, RouteHealthEntry>;
}

function keyOf(provider: string, model: string): string {
  return `${provider}/${model}`;
}

/** 学习值默认过期(ms)：超此龄视为陈旧、读侧应重探（换模型/网关不至于被历史最小值锁死）。 */
export const ROUTE_HEALTH_STALE_MS = 7 * 24 * 60 * 60_000;

export function routeHealthPathFor(dataDir: string): string {
  return path.join(dataDir, 'distill-route-health.json');
}

export class RouteHealthStore {
  private routes = new Map<string, RouteHealthEntry>();
  private dirty = false;

  constructor(private readonly file: string) {}

  /** 读盘 fail-open：缺/坏/未知版本 → 空表、不抛。 */
  async load(): Promise<void> {
    const r = await readJsonStrict<RouteHealthFile>(this.file, { expectedVersion: ROUTE_HEALTH_FILE_VERSION });
    this.routes = new Map();
    if (!r.ok) return; // missing / corrupt / unreadable / unknown_version 一律空起步
    const raw = r.value?.routes;
    if (!raw || typeof raw !== 'object') return;
    for (const [k, v] of Object.entries(raw)) {
      if (!v || typeof v !== 'object') continue;
      const e = v as Partial<RouteHealthEntry>;
      if (typeof e.lastGoodChunkChars !== 'number' || !Number.isFinite(e.lastGoodChunkChars)) continue;
      this.routes.set(k, {
        lastGoodChunkChars: Math.max(0, Math.floor(e.lastGoodChunkChars)),
        latencyEmaMs: typeof e.latencyEmaMs === 'number' && Number.isFinite(e.latencyEmaMs) ? e.latencyEmaMs : 0,
        updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : '',
      });
    }
  }

  /** 该路由已学到、且未过期的跑通块长；0 = 无可用学习值（未学到或已陈旧）。 */
  lastGoodChunkChars(provider: string, model: string, now = Date.now(), staleMs = ROUTE_HEALTH_STALE_MS): number {
    const e = this.routes.get(keyOf(provider, model));
    if (!e || e.lastGoodChunkChars <= 0) return 0;
    const t = Date.parse(e.updatedAt);
    if (Number.isFinite(t) && now - t > staleMs) return 0; // 陈旧 → 交读侧重探
    return e.lastGoodChunkChars;
  }

  /** 该路由延迟 EMA(ms)；0 = 未记。 */
  latencyEma(provider: string, model: string): number {
    return this.routes.get(keyOf(provider, model))?.latencyEmaMs ?? 0;
  }

  /**
   * 记一次「跑通」的块长：只降不升（更小块长才覆盖 lastGood），并更新延迟 EMA。
   * @param chunkChars 本次成功的块长(字符)
   * @param latencyMs  本次成功调用耗时(可选，用于 EMA)
   */
  recordGood(provider: string, model: string, chunkChars: number, latencyMs?: number): void {
    if (!(chunkChars > 0) || !Number.isFinite(chunkChars)) return;
    const k = keyOf(provider, model);
    const cur = this.routes.get(k);
    const next: RouteHealthEntry = {
      lastGoodChunkChars:
        cur && cur.lastGoodChunkChars > 0
          ? Math.min(cur.lastGoodChunkChars, Math.floor(chunkChars))
          : Math.floor(chunkChars),
      latencyEmaMs:
        latencyMs !== undefined && Number.isFinite(latencyMs) && latencyMs >= 0
          ? cur && cur.latencyEmaMs > 0
            ? cur.latencyEmaMs * 0.7 + latencyMs * 0.3
            : latencyMs
          : (cur?.latencyEmaMs ?? 0),
      updatedAt: new Date().toISOString(),
    };
    this.routes.set(k, next);
    this.dirty = true;
  }

  /** 清除学习值：传 provider+model 清单条，否则清全部（面板「重置学习值」一键）。 */
  reset(provider?: string, model?: string): void {
    if (provider && model) this.routes.delete(keyOf(provider, model));
    else this.routes.clear();
    this.dirty = true;
  }

  /** 全量快照（面板回显用）。 */
  snapshot(): Array<{ key: string } & RouteHealthEntry> {
    return [...this.routes.entries()].map(([key, v]) => ({ key, ...v }));
  }

  /** 有变更才落盘；失败由调用方兜底（不抛穿蒸馏）。@returns 是否写了盘 */
  async save(): Promise<boolean> {
    if (!this.dirty) return false;
    const routes: Record<string, RouteHealthEntry> = {};
    for (const [k, v] of this.routes) routes[k] = v;
    const payload: RouteHealthFile = { version: ROUTE_HEALTH_FILE_VERSION, routes };
    await atomicWriteJson(this.file, payload);
    this.dirty = false;
    return true;
  }
}
