import type { Context } from '@deepseek-ai/cordis';
import { type MemoryConfig } from './config.js';
import { type RecallSessionStats } from './hooks/recall.js';
import type { RebuildController } from './pipeline/rebuild.js';
import type { RuminateController } from './pipeline/ruminate.js';
import type { RoomRegistryStore } from './store/rooms-registry.js';
import type { MemorySourceStore } from './store/memory-sources.js';
import type { SkillStore } from './store/skill-store.js';
import type { RecallUsageStore } from './store/recall-usage.js';
import { type LiveSettingsHandle } from './settings.js';
import type { GraphStore } from './store/graph-store.js';
import type { L0Store } from './store/l0.js';
import type { L1Store } from './store/l1.js';
import type { PersonaStore } from './store/persona.js';
import type { SceneStore } from './store/scenes.js';
import type { SessionModeStore } from './store/session-modes.js';
import type { EmbeddingManager } from './store/embedding-source.js';
import type { StateStore } from './store/state.js';
import { type MemoryFamily, type MemoryLogger } from './types.js';
import { type MemoryBackend } from './store/memory-backend.js';
import type { SessionRecalledStore } from './store/session-recalled.js';
import { type RecallFeedbackStore } from './store/recall-feedback.js';
import type { ObsoleteNoticeStore } from './store/obsolete-notices.js';
export declare const PLUGIN_VERSION: string;
/** 运行态来源(index.ts 注入):避免 stats 撒谎字段。 */
export interface MemoryStatusSource {
    /** 存储是否处于降级态(数据目录/检索库不可用)。 */
    degraded(): boolean;
    /** L1 抽取待重试的消息条数。 */
    pending(): number;
}
/**
 * 端点全集运行时清单(与 tests/contract-keys.test.ts 的 ENDPOINTS 及
 * contract.ts 类型映射表三方对齐,漂移由键集 diff 测试暴露)。
 * 注意:本清单同时是 HTTP 前缀路由 `/dsh-memory/rpc/<短名>` 的**放行白名单**
 * (见下方 SHORT_ENDPOINTS),漏一条 = 该端点在面板里静默消失(404 被客户端
 * rpc 的 catch 吞掉,无任何报错),故必须与 contract.ts 的 DshMemoryRequestMap
 * 严格逐项一致。
 * 用途:0.1.5 共享通道 /api 的 interceptor 是单槽(多插件会抛 already has an
 * interceptor),精确 Fetch 路由按路径 key 可共存且分发优先于 interceptor——
 * 因此逐端点注册 `POST /api/<endpoint>` 精确路由,彻底绕开槽位竞争。
 */
export declare const MEMORY_ENDPOINTS: readonly string[];
/**
 * 会话级统计数据源(悬浮卡信息区;index.ts 注入)。
 * 硬规则:本端点按"打开期间 2~5s 轮询"设计,实现只允许内存注册表读取与
 * 索引化 SQL 点查——禁止任何文件读/目录扫描(scenes.list()/persona.read()
 * 级别的 I/O 会把每次轮询变成数十毫秒的全量读,见 slider-spec 数据策略节)。
 */
export interface SessionInfoSource {
    /** 召回统计(recall.ts 注册表;未发生检索的会话返回 undefined)。 */
    recallStats(sessionId: string): RecallSessionStats | undefined;
    /** 记忆上下文占用账本(context-occupancy 唯一权威实例;未注入过的会话返回 null)。 */
    memoryOccupancy(sessionId: string): MemoryOccupancy | null;
    /** 稳定区份额估算(旧会话回填用;缺省 = 装配未提供,回填隐藏)。 */
    profileEstimate?(sessionId: string): number;
    /** 召回份额回填(live surface 现扫,miss 读盘上日志;缺省 = null)。 */
    recallEstimate?(sessionId: string): Promise<number | null> | number | null;
    /** 蒸馏管线会话视图(runner:攒批进度/挂起切片/会话产出)。 */
    runnerView(sessionId: string, mode: string): {
        pendingSlice: number;
        parkedSlices: number;
        threshold: number | null;
        producedRecords: number;
        lastDistillAt: number | null;
    };
    /** L0 该会话已捕获消息数(索引 COUNT)。 */
    l0Count(sessionId: string): Promise<number>;
    /** 检索能力位(hybrid / keyword 降级判定)。 */
    capabilities(): {
        ftsSearch: boolean;
        vectorSearch: boolean;
    };
}
import type { MemoryOccupancy, UiRecord } from './contract.js';
export type { MemoryStats } from './contract.js';
/** registerMemoryRpc 形参中需要落入端点 deps 的部分。 */
interface MemoryRpcSources {
    status?: MemoryStatusSource;
    live?: LiveSettingsHandle;
    modes?: SessionModeStore;
    dataDir?: string;
    rebuild?: RebuildController;
    embedManager?: EmbeddingManager;
    sessionInfo?: SessionInfoSource;
    /** Room 注册表(未装配 = rooms-get 不带 registry,rooms-export 不可用)。 */
    roomRegistry?: RoomRegistryStore;
    /** 外部来源注册表（轨3 Connect；未装配 = memory-sources-* / memport-scan 不可用）。 */
    memorySources?: MemorySourceStore;
    /** 技能存储（轨2；未装配 = skills-* 不可用）。 */
    skillStore?: SkillStore;
}
/** 端点 deps 的注入面(ctx/cfg/stores/logger 由调用方绑定,其余由此处决定)。 */
export type EndpointDepsInput = Omit<EndpointDeps, 'ctx' | 'cfg' | 'stores' | 'logger'>;
/**
 * 组装端点 deps。抽成函数是为了让"哪个控制器落入哪个字段"成为可测接缝:
 * 反刍端点读 deps.ruminate,若此处漏注入,端点会静默恒返 {supported:false}(面板整块不渲染)。
 * @param controller - 反刍控制器;由 index.ts 在存储可用时装配,降级时为 undefined。
 */
export declare function buildEndpointDeps(base: Pick<EndpointDeps, 'ctx' | 'cfg' | 'stores' | 'logger'>, sources: MemoryRpcSources, controller: RuminateController | undefined): EndpointDeps;
export declare function registerMemoryRpc(ctx: Context, cfg: MemoryConfig, stores: {
    l0: L0Store;
    l1: L1Store;
    scenes: Record<MemoryFamily, SceneStore>;
    persona: Record<MemoryFamily, PersonaStore>;
    state: StateStore;
    /** 召回使用统计(可选)。 */
    usage?: RecallUsageStore;
    /** 记忆后端(后台边界);未装配时回退为包 l1 的进程内实现。 */
    backend?: MemoryBackend;
    /** 图谱存储(可选:未装配时图谱端点返空,不报错)。 */
    graph?: GraphStore;
}, logger: MemoryLogger, status?: MemoryStatusSource, live?: LiveSettingsHandle, modes?: SessionModeStore, dataDir?: string, rebuild?: RebuildController, embedManager?: EmbeddingManager, sessionInfo?: SessionInfoSource, 
/** 反刍控制器(存储降级时为 undefined):经 buildEndpointDeps 落入 deps.ruminate。 */
ruminate?: RuminateController, 
/** Room 分类管理依赖(注册表;缺省 = rooms-get 不带 registry、rooms-export 恒 404 语义)。 */
roomRegistry?: RoomRegistryStore, 
/** 外部来源注册表（轨3 Connect；经 buildEndpointDeps 落入 deps.memorySources）。 */
memorySources?: MemorySourceStore, 
/** 技能存储（轨2；经 buildEndpointDeps 落入 deps.skillStore）。 */
skillStore?: SkillStore): void;
export interface EndpointDeps {
    ctx: Context;
    cfg: MemoryConfig;
    stores: {
        l0: L0Store;
        l1: L1Store;
        /** 召回使用统计(可选:未装配 = 列表不带 usage/usageSummary)。 */
        usage?: RecallUsageStore;
        scenes: Record<MemoryFamily, SceneStore>;
        persona: Record<MemoryFamily, PersonaStore>;
        state: StateStore;
        /** 记忆后端(后台边界);未装配时回退为包 l1 的进程内实现。 */
        backend?: MemoryBackend;
        graph?: GraphStore;
        /** 会话“活召回集”累积器（G-live）；缺省 = 端点返回空。 */
        recalled?: SessionRecalledStore;
        /** 召回相关度反馈 sidecar（未装配 = recall-feedback 不可用、列表不带 userRelevance）。 */
        feedback?: RecallFeedbackStore;
        /** 「已声明过时」待播报队列（与 feedback 同进退）。 */
        notices?: ObsoleteNoticeStore;
    };
    status?: MemoryStatusSource;
    live?: LiveSettingsHandle;
    modes?: SessionModeStore;
    dataDir: string;
    logger: MemoryLogger;
    rebuild?: RebuildController;
    ruminate?: RuminateController;
    embedManager?: EmbeddingManager;
    sessionInfo?: SessionInfoSource;
    /** Room 注册表(未装配 = rooms-get 不带 registry,rooms-export 不可用)。 */
    roomRegistry?: RoomRegistryStore;
    /** 外部来源注册表（轨3 Connect；未装配 = memory-sources-* / memport-scan 不可用）。 */
    memorySources?: MemorySourceStore;
    /** 技能存储（轨2；未装配 = skills-* 不可用）。 */
    skillStore?: SkillStore;
}
/** 端点分发表(导出供测试直调:可精确注入 rebuild/ruminate 等可选控制器,验证 deps 接线)。 */
export declare function handleEndpoint(endpoint: string, payload: unknown, deps: EndpointDeps): Promise<unknown>;
/** 浏览器卡片字段(比 MemoryRecord 精简,去掉大 metadata;Hall 从 metadata 提取)。 */
/** 老化权重(与读路径 applyDecayWeight 同式):max(0.5, 0.5^(Δ天/半衰期));半衰期 ≤0 = 关 → null。 */
export declare function agingWeightOf(updatedAtMs: number | undefined, halfLifeDays: number, now?: number): number | null;
export declare function hitToUiRecord(r: {
    id: string;
    content: string;
    type: string;
    priority?: number;
    scene_name: string;
    timestamps?: number[];
    createdAt?: number;
    updatedAt?: number;
    version?: number;
    source_message_ids?: string[];
    metadata?: Record<string, unknown>;
    score?: number;
    family?: string;
    /** 退场判据:`valid_to` 闭合即已退场(软删)。由 `listL1`/`getByIds` 透传。 */
    validTo?: number;
}, extra?: {
    agingWeight?: number | null;
    usage?: {
        attempts: number;
        used: number;
        lastAttemptAt: number | null;
        lastUsedAt: number | null;
    } | null;
    /** 人给的相关度均值(0..5);未打分 = 不传(字段缺席,不是 0)。 */
    userRelevance?: number | null;
    /** 人给的**最近一笔**打分(-1..5);成熟度只吃这一笔,不吃均值。 */
    userMark?: number | null;
}): UiRecord;
