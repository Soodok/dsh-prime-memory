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
function keyOf(provider, model) {
    return `${provider}/${model}`;
}
/** 学习值默认过期(ms)：超此龄视为陈旧、读侧应重探（换模型/网关不至于被历史最小值锁死）。 */
export const ROUTE_HEALTH_STALE_MS = 7 * 24 * 60 * 60_000;
export function routeHealthPathFor(dataDir) {
    return path.join(dataDir, 'distill-route-health.json');
}
export class RouteHealthStore {
    file;
    routes = new Map();
    dirty = false;
    constructor(file) {
        this.file = file;
    }
    /** 读盘 fail-open：缺/坏/未知版本 → 空表、不抛。 */
    async load() {
        const r = await readJsonStrict(this.file, { expectedVersion: ROUTE_HEALTH_FILE_VERSION });
        this.routes = new Map();
        if (!r.ok)
            return; // missing / corrupt / unreadable / unknown_version 一律空起步
        const raw = r.value?.routes;
        if (!raw || typeof raw !== 'object')
            return;
        for (const [k, v] of Object.entries(raw)) {
            if (!v || typeof v !== 'object')
                continue;
            const e = v;
            if (typeof e.lastGoodChunkChars !== 'number' || !Number.isFinite(e.lastGoodChunkChars))
                continue;
            this.routes.set(k, {
                lastGoodChunkChars: Math.max(0, Math.floor(e.lastGoodChunkChars)),
                latencyEmaMs: typeof e.latencyEmaMs === 'number' && Number.isFinite(e.latencyEmaMs) ? e.latencyEmaMs : 0,
                updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : '',
            });
        }
    }
    /** 该路由已学到、且未过期的跑通块长；0 = 无可用学习值（未学到或已陈旧）。 */
    lastGoodChunkChars(provider, model, now = Date.now(), staleMs = ROUTE_HEALTH_STALE_MS) {
        const e = this.routes.get(keyOf(provider, model));
        if (!e || e.lastGoodChunkChars <= 0)
            return 0;
        const t = Date.parse(e.updatedAt);
        if (Number.isFinite(t) && now - t > staleMs)
            return 0; // 陈旧 → 交读侧重探
        return e.lastGoodChunkChars;
    }
    /** 该路由延迟 EMA(ms)；0 = 未记。 */
    latencyEma(provider, model) {
        return this.routes.get(keyOf(provider, model))?.latencyEmaMs ?? 0;
    }
    /**
     * 记一次「跑通」的块长：只降不升（更小块长才覆盖 lastGood），并更新延迟 EMA。
     * @param chunkChars 本次成功的块长(字符)
     * @param latencyMs  本次成功调用耗时(可选，用于 EMA)
     */
    recordGood(provider, model, chunkChars, latencyMs) {
        if (!(chunkChars > 0) || !Number.isFinite(chunkChars))
            return;
        const k = keyOf(provider, model);
        const cur = this.routes.get(k);
        const next = {
            lastGoodChunkChars: cur && cur.lastGoodChunkChars > 0
                ? Math.min(cur.lastGoodChunkChars, Math.floor(chunkChars))
                : Math.floor(chunkChars),
            latencyEmaMs: latencyMs !== undefined && Number.isFinite(latencyMs) && latencyMs >= 0
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
    reset(provider, model) {
        if (provider && model)
            this.routes.delete(keyOf(provider, model));
        else
            this.routes.clear();
        this.dirty = true;
    }
    /** 全量快照（面板回显用）。 */
    snapshot() {
        return [...this.routes.entries()].map(([key, v]) => ({ key, ...v }));
    }
    /** 有变更才落盘；失败由调用方兜底（不抛穿蒸馏）。@returns 是否写了盘 */
    async save() {
        if (!this.dirty)
            return false;
        const routes = {};
        for (const [k, v] of this.routes)
            routes[k] = v;
        const payload = { version: ROUTE_HEALTH_FILE_VERSION, routes };
        await atomicWriteJson(this.file, payload);
        this.dirty = false;
        return true;
    }
}
