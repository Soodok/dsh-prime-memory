/**
 * 状态面板数据通道(0.1.5 契约):Host 半直接向 webServer 注册 prefix 路由
 * `POST /dsh-memory/rpc/<method>`,Client 设置页用浏览器原生 fetch 拉取,
 * 信封即 RpcResult({ok,value} | {ok,error})——不经过 connection.rpc
 * (handle 前缀通道 0.1.5 静默 405;/api interceptor 单槽会被他插件抢占)。
 *
 * webServer 是可选服务且可能晚于本插件就绪:先探测一次,未就绪则监听
 * internal/service(事件携带 (name, impl),impl=undefined 即下线),服务
 * 上线、下线、替换实例三种迁移都会正确释放/重挂路由注册。
 *
 * 机密纪律:directApiKey / embedRemoteApiKey 永不出现在任何 RPC 响应与日志
 * (settings-get/set 走 sanitizeSettings 脱敏)。
 */
import { createRequire } from 'node:module';
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
// 同款:llm 服务(ctx.llm)与默认模型选择(ctx.get('agentDefaultModel'))的声明合并
import type {} from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-agent-default-model';
import { EFFORT_CHOICES, resolveDataDir, type MemoryConfig } from './config.js';
import { effectiveCfg } from './pipeline/runner.js';
import { emptyRecallStats, type RecallSessionStats } from './hooks/recall.js';
import { buildRouteChain, decideSendableEffort, LAYER_DEFAULT_BUDGETS, layerChainOrNull, resolveModelContextWindow, resolveModelEfforts, resolveModelRoute } from './llm.js';
import type { RebuildController } from './pipeline/rebuild.js';
import type { RuminateController } from './pipeline/ruminate.js';
import { mergeRoom, renameRoom } from './room-review.js';
import type { RoomRegistryStore } from './store/rooms-registry.js';
import type { MemorySourceStore, SourceKind } from './store/memory-sources.js';
import type { SkillStore } from './store/skill-store.js';
import { scanSources } from './memport/scan.js';
import type { RecallUsageStore } from './store/recall-usage.js';
import { projectDistillChain, validateDistillChain, type DistillChainEntry, type LiveSettingsHandle } from './settings.js';
import type { GraphStore } from './store/graph-store.js';
import type { L0Store } from './store/l0.js';
import type { L1Store } from './store/l1.js';
import { RECEIPTS_QUERY_LIMIT_MAX, dimensionOf, toReceiptView } from './store/receipts.js';
import { getTraceStore } from './store/trace.js';
import type { ReceiptQuery, ReceiptsView } from './store/receipts.js';
import { resolveConflictPair, listConflictPairs } from './conflict-service.js';
import { sourceAnchorLabels } from './pipeline/anchors.js';
import { readSupersedeMarker } from './store/supersede.js';
import { isSnapshotName } from './store/l1-snapshot.js';
import type { PersonaStore } from './store/persona.js';
import type { SceneStore } from './store/scenes.js';
import type { SessionModeStore } from './store/session-modes.js';
import type { EmbeddingManager } from './store/embedding-source.js';
import type { StateStore } from './store/state.js';
import { WING_CATALOG, WING_FALLBACK, type MemoryFamily, type MemoryLogger, type MemoryMode, type MemoryRecord } from './types.js';
import { isRoomSlug } from './metadata-validators.js';
import { InProcMemoryBackend, type MemoryBackend } from './store/memory-backend.js';
import { isWingCorner } from './store/session-modes.js';
import { startWingBackfill } from './wing-backfill.js';
import { errDetail } from './util/filelog.js';
import { snapshotTokenCost } from './token-cost.js';
import { computeMaturity } from './util/maturity.js';
import type { SessionRecalledStore } from './store/session-recalled.js';
import { isFeedbackScore, type RecallFeedbackStore } from './store/recall-feedback.js';
import type { ObsoleteNoticeStore } from './store/obsolete-notices.js';
import { relinkWorkspaces } from './pipeline/workspace-relink.js';
import { exportRecords, reconcileLedger } from './store/memory-md-export.js';
import { disableProjectionFile } from './store/memory-md-disable.js';

const require = createRequire(import.meta.url);
export const PLUGIN_VERSION = (require('../package.json') as { version: string }).version;

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
export const MEMORY_ENDPOINTS: readonly string[] = [
  'dsh-memory/stats',
  'dsh-memory/token-cost',
  'dsh-memory/session-mode-get',
  'dsh-memory/session-mode-set',
  'dsh-memory/wing-overview',
  'dsh-memory/rooms-get',
  'dsh-memory/rooms-export',
  'dsh-memory/room-register',
  'dsh-memory/room-admin',
  'dsh-memory/wing-backfill',
  'dsh-memory/session-stats',
  'dsh-memory/settings-get',
  'dsh-memory/settings-set',
  'dsh-memory/list-records',
  'dsh-memory/records-delete',
  'dsh-memory/receipts',
  'dsh-memory/conflicts',
  'dsh-memory/conflict-resolve',
  'dsh-memory/conflicts-rejected',
  'dsh-memory/graph-search',
  'dsh-memory/graph-node-get',
  'dsh-memory/scenes',
  'dsh-memory/persona',
  'dsh-memory/log-tail',
  'dsh-memory/trace-tail',
  'dsh-memory/rebuild-status',
  'dsh-memory/rebuild-start',
  'dsh-memory/rebuild-cancel',
  'dsh-memory/ruminate-status',
  'dsh-memory/ruminate-start',
  'dsh-memory/ruminate-cancel',
  'dsh-memory/llm-providers',
  'dsh-memory/llm-models',
  'dsh-memory/embedding-state-get',
  'dsh-memory/embedding-source-set',
  'dsh-memory/embedding-download-start',
  'dsh-memory/embedding-download-cancel',
  'dsh-memory/embedding-model-delete',
  'dsh-memory/embedding-runtime-cancel',
  'dsh-memory/embedding-reindex',
  'dsh-memory/embedding-reindex-cancel',
  'dsh-memory/records-retired',
  'dsh-memory/records-restore',
  'dsh-memory/cleanup-retired',
  'dsh-memory/snapshots-list',
  'dsh-memory/snapshot-restore',
  'dsh-memory/memory-sources-list',
  'dsh-memory/memory-sources-add',
  'dsh-memory/memory-sources-retire',
  'dsh-memory/memport-scan',
  'dsh-memory/skills-list',
  'dsh-memory/session-recalled',
  'dsh-memory/recall-feedback',
  'dsh-memory/workspace-relink',
  'dsh-memory/mem-export',
  'dsh-memory/mem-reconcile',
  'dsh-memory/skills-action',
];

/** HTTP 路由前缀(客户端 fetch `/dsh-memory/rpc/<短方法名>`)。 */
const RPC_ROUTE_PREFIX = '/dsh-memory/rpc';
/** 短方法名视图(MEMORY_ENDPOINTS 去掉 'dsh-memory/' 前缀,URL 段用)。 */
const SHORT_ENDPOINTS = MEMORY_ENDPOINTS.map((e) => e.slice('dsh-memory/'.length));

/** 本插件用到的 webServer 服务面(结构类型,不依赖宿主包类型导出)。 */
interface WebServerFace {
  register(route: {
    kind: 'prefix' | 'exact';
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
  }): void | (() => void | Promise<void>);
}

/** Host 头是否为 loopback 主机名(localhost / [::1] / 127.x.x.x)。 */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true;
  const parts = hostname.split('.');
  return parts.length === 4 && parts[0] === '127' && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/**
 * API 信任围栏:DNS-rebinding / 跨站防护(非用户鉴权),语义对齐 connection
 * /api 网关的 fence——Host 头必须指向 loopback。面板数据非机密(密钥字段
 * 宿主侧已脱敏),故 loopback 即放行;跨站浏览器标记随 Host 校验一并拒绝。
 */
function apiFence(req: IncomingMessage): boolean {
  const host = req.headers.host;
  if (typeof host !== 'string' || host.length === 0) return false;
  // 不写初值:catch 分支直接 return,初值在任何路径下都不会被读取
  // (原 `let hostname = host` 是死存储,eslint no-useless-assignment)。
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }
  return isLoopbackHostname(hostname);
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** 读取 JSON 请求体(上限 8MB:面板最大载荷为 list-records 分页与图谱检索)。 */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.length === 0) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

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
  runnerView(
    sessionId: string,
    mode: string,
  ): { pendingSlice: number; parkedSlices: number; threshold: number | null; producedRecords: number; lastDistillAt: number | null };
  /** L0 该会话已捕获消息数(索引 COUNT)。 */
  l0Count(sessionId: string): Promise<number>;
  /** 检索能力位(hybrid / keyword 降级判定)。 */
  capabilities(): { ftsSearch: boolean; vectorSearch: boolean };
}

// MemoryStats 与全部端点响应形状来自契约单一事实源(src/contract.ts)——
// host case 表与 client(浏览器侧)共享同一形状,契约漂移编译期暴露。
import type {
  EffortChoice,
  EmbeddingStateResponse,
  LayerChainView,
  ListRecordsResponse,
  CleanupRetiredResponse,
  RecordsRestoreResponse,
  RecordsRetiredResponse,
  RetiredRecordView,
  SnapshotsListResponse,
  SnapshotRestoreResponse,
  LlmModelsResponse,
  LlmProvidersResponse,
  DirectChannelView,
  MemoryLiveSettings,
  MemoryOccupancy,
  ModelWithEfforts,
  MemoryStats,
  RebuildStatusResponse,
  RecallDisabledReason,
  RuminateStatusResponse,
  ScenesResponse,
  WingOverviewResponse,
  RoomsGetResponse,
  SessionModeGetResponse,
  SessionModeSetResponse,
  SessionStatsResponse,
  SettingsGetResponse,
  SettingsSetResponse,
  UiRecord,
  RoomCount,
  RoomsExportResponse,
  RoomRegisterResponse,
  RoomAdminRequest,
  RoomAdminResponse,
  MemorySourcesListResponse,
  MemorySourcesAddResponse,
  MemorySourcesRetireResponse,
  MemportScanResponse,
  SkillsListResponse,
  SkillsActionResponse,
} from './contract.js';
export type { MemoryStats } from './contract.js';

/** 分族存储聚合(浏览器保持混合视图:两族拼接展示)。 */
type FamilyStores = {
  scenes: Record<MemoryFamily, SceneStore>;
  persona: Record<MemoryFamily, PersonaStore>;
};

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
export function buildEndpointDeps(
  base: Pick<EndpointDeps, 'ctx' | 'cfg' | 'stores' | 'logger'>,
  sources: MemoryRpcSources,
  controller: RuminateController | undefined,
): EndpointDeps {
  const injected: EndpointDepsInput = {
    status: sources.status,
    live: sources.live,
    modes: sources.modes,
    dataDir: sources.dataDir ?? resolveDataDir(base.cfg),
    rebuild: sources.rebuild,
    embedManager: sources.embedManager,
    sessionInfo: sources.sessionInfo,
    ruminate: controller,
    roomRegistry: sources.roomRegistry,
    memorySources: sources.memorySources,
    skillStore: sources.skillStore,
  };
  return { ...base, ...injected };
}

export function registerMemoryRpc(
  ctx: Context,
  cfg: MemoryConfig,
  stores: {
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
  },
  logger: MemoryLogger,
  status?: MemoryStatusSource,
  live?: LiveSettingsHandle,
  modes?: SessionModeStore,
  dataDir?: string,
  rebuild?: RebuildController,
  embedManager?: EmbeddingManager,
  sessionInfo?: SessionInfoSource,
  /** 反刍控制器(存储降级时为 undefined):经 buildEndpointDeps 落入 deps.ruminate。 */
  ruminate?: RuminateController,
  /** Room 分类管理依赖(注册表;缺省 = rooms-get 不带 registry、rooms-export 恒 404 语义)。 */
  roomRegistry?: RoomRegistryStore,
  /** 外部来源注册表（轨3 Connect；经 buildEndpointDeps 落入 deps.memorySources）。 */
  memorySources?: MemorySourceStore,
  /** 技能存储（轨2；经 buildEndpointDeps 落入 deps.skillStore）。 */
  skillStore?: SkillStore,
): void {
  /** 当前是否持有一段有效注册(dispose 完成后清空,允许服务重上线时重注册)。 */
  let holding = false;
  /** 当前 handle 绑定的 connection 实例(internal/service 第二参;用于识别实例替换)。 */
  let registeredImpl: unknown;

  const tryRegister = (): void => {
    if (holding) return;
    const webServer = ctx.get('webServer') as WebServerFace | undefined;
    if (!webServer || typeof webServer.register !== 'function') return;
    let dispose: () => Promise<void> | void = () => {};
    try {
      holding = true;
      let active = true;
      // 端点处理器:HTTP 层与旧 connection.rpc 的 handler 共用同一分发。
      const rpcHandler = async (endpoint: string, payload: unknown) => {
        try {
          const value = await handleEndpoint(endpoint, payload, buildEndpointDeps(
            { ctx, cfg, stores, logger },
            // roomRegistry 必须随 sources 下发——漏带 = 面板侧 room-* 恒"未装配"
            // (工具面直传不受影响;2026-10-02 beta.9 实测回归)
            { status, live, modes, dataDir, rebuild, embedManager, sessionInfo, roomRegistry, memorySources, skillStore },
            ruminate,
          ));
          return { ok: true, value };
        } catch (err) {
          return {
            ok: false,
            error: { code: 'internal', message: err instanceof Error ? err.message : String(err), details: {} },
          };
        }
      };
      // 0.1.5 契约(参考 better-sidebar main 分支的已验证实现):不再经过
      // connection.rpc —— handle 前缀通道在 0.1.5 webServer 分发层静默 405
      // (讨论区 #6337),/api 共享通道 interceptor 是单槽、会被其他 0.1.5 插件
      // (如 dsh-live-token-stats)抢占。直接在插件自己的 fiber 上向 webServer
      // 注册 prefix 路由(plain req/res + 自有 RpcResult 信封)。
      // 鉴权面:同源浏览器的 DNS-rebinding 防护(Host 须 loopback),与
      // connection /api 网关的 fence 语义一致;不做用户鉴权——面板数据非机密,
      // 机密字段(directApiKey 等)在 settings-get 已由 sanitizeSettings 脱敏。
      const registered = webServer.register({
        kind: 'prefix',
        path: RPC_ROUTE_PREFIX,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          if (!apiFence(req)) return writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } });
          if (req.method !== 'POST') {
            return writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } });
          }
          const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
          if (!pathname.startsWith(`${RPC_ROUTE_PREFIX}/`)) {
            return writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown api path' } });
          }
          const method = pathname.slice(RPC_ROUTE_PREFIX.length + 1);
          if (method.includes('/') || !(SHORT_ENDPOINTS as readonly string[]).includes(method)) {
            return writeJson(res, 404, { ok: false, error: { code: 'not-found', message: `unknown api method "${method}"` } });
          }
          try {
            const payload = await readJsonBody(req);
            const result = await rpcHandler(`dsh-memory/${method}`, payload);
            writeJson(res, 200, result);
          } catch (err) {
            writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: err instanceof Error ? err.message : String(err) } });
          }
        },
      });
      dispose = typeof registered === 'function' ? registered : () => {};
      registeredImpl = webServer;
      if (!active) {
        void dispose();
        holding = false;
        return;
      }
      logger.info('[memory] 状态 API 已注册(POST /dsh-memory/rpc/<method>)');
      disposers.push(() => {
        active = false;
        holding = false;
        void dispose();
      });
    } catch (err) {
      holding = false;
      logger.warn(
        `[memory] 状态 API 注册失败(设置面板将不可用,其余功能不受影响): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  /** 释放全部持有注册(handle 随旧服务实例失效,holding 复位以允许重挂)。 */
  const release = (): void => {
    for (const dispose of disposers.splice(0)) dispose();
  };

  const disposers: Array<() => void> = [];

  ctx.effect(() => {
    tryRegister();
    const off = ctx.on('internal/service', (name: string, impl: unknown) => {
      if (name !== 'webServer') return;
      if (!impl) {
        // 服务下线:旧路由注册已随旧服务实例失效——主动释放并复位,
        // 服务恢复时本事件再触发即可重挂(否则 holding 恒真 → API 永久失联)
        release();
        registeredImpl = undefined;
        logger.debug?.('[memory] webServer 服务下线,状态 API 注册已释放(待恢复重挂)');
        return;
      }
      if (impl !== registeredImpl) {
        // 实例替换:旧 handle 失效,换新实例重挂
        release();
        registeredImpl = undefined;
      }
      tryRegister();
    });
    return () => {
      off();
      release();
    };
  });
}

async function buildStats(
  cfg: MemoryConfig,
  stores: { l0: L0Store; l1: L1Store; state: StateStore } & FamilyStores,
  status?: MemoryStatusSource,
): Promise<MemoryStats> {
  // 两族 checkpoint 聚合(浏览器混合视图:总量求和、时间取最新)
  const chat = stores.state.forFamily('chat');
  const work = stores.state.forFamily('work');
  const [chatScenes, workScenes, chatPersona, workPersona] = await Promise.all([
    stores.scenes.chat.list(),
    stores.scenes.work.list(),
    stores.persona.chat.read(),
    stores.persona.work.read(),
  ]);
  const degraded = status?.degraded() ?? false;
  const personaChars = (chatPersona?.length ?? 0) + (workPersona?.length ?? 0);
  const max = (a: number, b: number): number => Math.max(a, b);
  const iso = (t: number): string | null => (t ? new Date(t).toISOString() : null);
  return {
    ok: true,
    dataDir: resolveDataDir(cfg),
    family: cfg.family,
    version: PLUGIN_VERSION,
    l0Today: await stores.l0.countToday(),
    l1Count: stores.l1.size,
    l1TotalExtracted: chat.totalExtracted + work.totalExtracted,
    sceneCount: chatScenes.length + workScenes.length,
    personaChars,
    hasPersona: chat.hasPersona || work.hasPersona,
    lastExtractAt: iso(max(chat.lastExtractAt, work.lastExtractAt)),
    lastL2At: iso(max(chat.lastL2At, work.lastL2At)),
    lastL3At: iso(max(chat.lastL3At, work.lastL3At)),
    memoriesSinceL2: chat.newMemoriesSinceL2 + work.newMemoriesSinceL2,
    memoriesSinceL3: chat.memoriesSinceL3 + work.memoriesSinceL3,
    pendingExtract: status?.pending() ?? 0,
    message: degraded ? 'degraded:存储不可用,记忆功能已停用' : 'running',
    thresholds: { l2MinNewMemories: cfg.l2.minNewMemories, l3Interval: cfg.l3.interval },
  };
}

// ============================================================
// 端点分发(记忆浏览器 + 开关面板数据通道)
// ============================================================

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
    /** 「已声明过时」待播报队列（与 feedback 同进退）。*/
    notices?: ObsoleteNoticeStore;
    /** md 投射指纹账本（N9；未装配 = mem-export / mem-reconcile 不可用）。*/
    mdLedger?: import('./store/memory-md-ledger.js').MdLedgerStore;
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

/** RPC 字符串入参上限校验:防 loopback 面畸形超长载荷
 *  (超长 sessionId 持久化进 session-modes.json / 超长 query 触发 jieba 全量分词 CPU 峰值)。 */
function expectSessionId(v: unknown): string {
  if (typeof v !== 'string' || !v) throw new Error('sessionId 缺失');
  if (v.length > 512) throw new Error('sessionId 过长(≤512 字符)');
  return v;
}

/** 机密脱敏:两个 API key(直连蒸馏/远程嵌入)明文永不出宿主。 */
function sanitizeSettings(s: MemoryLiveSettings): MemoryLiveSettings {
  if (!s.directApiKey && !s.embedRemoteApiKey) return s;
  return { ...s, directApiKey: '', embedRemoteApiKey: '' };
}

/** 端点分发表(导出供测试直调:可精确注入 rebuild/ruminate 等可选控制器,验证 deps 接线)。 */
export async function handleEndpoint(endpoint: string, payload: unknown, deps: EndpointDeps): Promise<unknown> {
  const { cfg, stores, status, live, modes, dataDir, rebuild, ruminate, embedManager, sessionInfo, roomRegistry, memorySources, skillStore } = deps;
  switch (endpoint) {
    case 'dsh-memory/stats':
      return buildStats(cfg, stores, status);

    case 'dsh-memory/token-cost': {
      const p = (payload ?? {}) as { granularity?: string; rangeDays?: number };
      const granularity: 'day' | 'week' | 'month' =
        p.granularity === 'week' || p.granularity === 'month' ? p.granularity : 'day';
      // rangeDays 须为正整数且不超过明细保留期(tokenCost.retentionDays,0=永久保留则放行 1~3650),否则回退默认窗口
      const retention = cfg.tokenCost.retentionDays;
      const upper = retention > 0 ? retention : 3650;
      const rawDays = p.rangeDays;
      const rangeDays = typeof rawDays === 'number' && Number.isInteger(rawDays) && rawDays > 0 && rawDays <= upper ? rawDays : 0;
      return snapshotTokenCost(granularity, rangeDays);
    }

    case 'dsh-memory/session-mode-get': {
      if (!modes) throw new Error('档位存储未初始化');
      const p = (payload ?? {}) as { sessionId?: string };
      const sessionId = expectSessionId(p.sessionId);
      // 注入解析权威在 host:recall 是原始覆盖(null=跟随全局),recallResolved 是生效值
      const s = live?.get();
      const globalRecall = s?.recall ?? true;
      const bounds = modes.wingBoundaries(sessionId);
      const locked = modes.getWings(sessionId);
      const v: SessionModeGetResponse = {
        sessionId,
        mode: modes.get(sessionId),
        defaultMode: modes.default,
        recall: modes.getRecall(sessionId) ?? null,
        recallResolved: modes.resolvedRecall(sessionId, globalRecall),
        hall: locked[0] ?? null,
        halls: locked,
        hallIncludeUnlabeled: bounds.includeUnlabeled,
        hallIncludeGeneral: bounds.includeGeneral,
      };
      return v;
    }

    case 'dsh-memory/session-recalled': {
      // G-live：返回本会话（按 sessionKey，与投影 header.id / pill sessionId 同源）已注入、
      // 尚未被压缩覆盖的召回记忆。
      const p = (payload ?? {}) as { sessionId?: string };
      const sessionId = expectSessionId(p.sessionId);
      const ids = stores.recalled?.list(sessionId) ?? [];
      if (ids.length === 0) return { sessionId, records: [] };
      const halfLife = effectiveCfg(cfg, live).recall?.decayHalfLifeDays ?? 0;
      const byId = new Map(stores.l1.getByIds(ids).map((r) => [r.id, r] as const));
      const records = ids
        .map((id) => byId.get(id))
        .filter((r): r is NonNullable<typeof r> => r !== undefined)
        .map((r) => hitToUiRecord(r, {
          agingWeight: agingWeightOf(r.updatedAt, halfLife),
          usage: stores.usage?.get(r.id) ?? null,
          userRelevance: stores.feedback?.meanOf(r.id) ?? null,
          userMark: stores.feedback?.lastOf(r.id) ?? null,
        }));
      return { sessionId, records };
    }

    case 'dsh-memory/recall-feedback': {
      // 人在召回卡上给一条召回记忆打分：0..5 = 相关度（只聚合，不改写任何排序分）；
      // -1 = 声明过时，做两件事：退场该记录（软删可恢复）+ 排一条下一轮向模型的播报
      //（取走即离队，不常驻）。条目**不**从本会话活召回集摘掉——它得留在列表里显示删除线。
      if (cfg.recallFeedback?.enabled !== true) throw new Error('召回反馈未开启（cfg.recallFeedback.enabled）');
      const feedback = stores.feedback;
      if (feedback === undefined) throw new Error('召回反馈存储未装配');
      const p = (payload ?? {}) as { sessionId?: unknown; id?: unknown; score?: unknown };
      const sessionId = expectSessionId(typeof p.sessionId === 'string' ? p.sessionId : undefined);
      if (typeof p.id !== 'string' || p.id.length === 0) throw new Error('id 缺失');
      if (p.id.length > 512) throw new Error('id 过长(≤512 字符)');
      const id = p.id;
      if (!isFeedbackScore(p.score)) throw new Error('score 必须是 -1 或 0..5');
      // 结构性护栏（代替全局高权限模式）：只能给**本会话真召回过、且还活着**的记录打分。
      // 否则一个面对 web 的写端点就能退场任意 id；而这张卡上本来也只列得出这些。
      const alive = stores.recalled?.list(sessionId) ?? [];
      if (!alive.includes(id)) throw new Error('该记忆不在本会话的召回集里（可能已被压缩覆盖）');
      const entry = feedback.rate(id, p.score);
      let retired = false;
      let announced = false;
      // 退场**前**的记录快照（带 workspaceId/name）——失效联动要靠它算落点，
      // 而 `retire` 只改 `valid_to`，不会动这两列，所以取在退场前后等价，取在前更直白。
      let rec: MemoryRecord | undefined;
      let fileDisabled: string | undefined;
      if (p.score === -1) {
        rec = stores.l1.getByIds([id])[0];
        const retiredAt = new Date().toISOString();
        retired = stores.l1.retire([id], { at: retiredAt, reason: 'obsolete' }) > 0;
        // 不再摘除：条目要留在列表里显示删除线（文本仍在上下文，直到压缩）；
        // 检索侧已由 detachL1FromRetrieval 阻断再注入。
        if (cfg.recallFeedback?.announce !== false && stores.notices !== undefined && rec !== undefined) {
          const title = (rec.content.split('\n').find((l) => l.trim().length > 0) ?? rec.content).trim().slice(0, 120);
          stores.notices.push(sessionId, { id, title, at: Date.now() });
          announced = true;
        }
        deps.logger.info(`[memory] 用户声明记忆过时并退场(session=${sessionId}, ${retired ? '已退场' : '本已退场'}): ${id}`);
        // 失效联动（N11）：退场成立后才去动投射文件；它失败只影响“磁盘凭证”，
        // 绝不回滚退场、也绝不抛（`disableProjectionFile` 内部收敛成 'failed'）。
        if (retired && rec !== undefined && cfg.memExport?.enabled === true && stores.mdLedger !== undefined) {
          fileDisabled = await disableProjectionFile({
            // 传退场**后**的快照：渲染出的 frontmatter 才带 `retired: true`，
            // 凭证自己就能说清它为什么存在。
            record: { ...rec, validTo: Date.parse(retiredAt) || Date.now() },
            cfgRoot: cfg.memExport.root,
            dataDir: deps.dataDir,
            ledger: stores.mdLedger,
            logger: deps.logger,
          });
        }
      }
      return {
        id,
        score: p.score,
        rating: { last: entry.last, rated: entry.rated, mean: entry.mean, obsolete: entry.obsolete },
        retired,
        announced,
        ...(fileDisabled === undefined ? {} : { fileDisabled }),
      };
    }

    case 'dsh-memory/workspace-relink': {
      // 存量记忆的 workspace 回填（内容路由）。**缺省干跑**：先看命中率与分布报告，再决定真写。
      // 真写额外要求高权限门（它改的是库里的列，虽然只改 `workspace_id`）。
      const hints = effectiveCfg(cfg, live).workspaceHints;
      if (hints?.enabled !== true) throw new Error('内容路由未开启（cfg.workspaceHints.enabled）');
      const p = (payload ?? {}) as { dryRun?: unknown };
      const dryRun = p.dryRun !== false;
      if (!dryRun && live?.get().memoryMutate !== true) throw new Error('真写归属列需要高权限模式（memoryMutate）');
      return relinkWorkspaces({
        l1: {
          list: (o) => stores.l1.list(o),
          setWorkspaceIds: (items) => stores.l1.setWorkspaceIds(items),
        },
        routes: hints.routes,
        dryRun,
        maxRecords: hints.maxRecords,
        timeBudgetMs: hints.timeBudgetMs,
        logger: deps.logger,
      });
    }

    case 'dsh-memory/mem-export': {
      // 单向导出：库 → md 文件 + 账本。**不写库**（用例钉住：导出前后 hashRecords 相同）。
      // 先查配置门再查装配门：“整面默认关”时该听到的是“没开”，不是“没装配”。
      const exp = cfg.memExport;
      if (exp?.enabled !== true) throw new Error('md 投射未开启（cfg.memExport.enabled）');
      const md = stores.mdLedger;
      if (md === undefined) throw new Error('md 投射账本未装配');
      return exportRecords({
        records: stores.l1.all(),
        cfgRoot: exp.root,
        dataDir: deps.dataDir,
        ledger: md,
        maxRecords: exp.maxRecords,
        timeBudgetMs: exp.timeBudgetMs,
        logger: deps.logger,
      });
    }

    case 'dsh-memory/mem-reconcile': {
      // 只读对账：不写库、不写文件，只按账本基线出四态报告（所以不需高权限门）。
      const exp = cfg.memExport;
      if (exp?.enabled !== true) throw new Error('md 投射未开启（cfg.memExport.enabled）');
      const md = stores.mdLedger;
      if (md === undefined) throw new Error('md 投射账本未装配');
      return reconcileLedger({
        records: stores.l1.all(),
        cfgRoot: exp.root,
        dataDir: deps.dataDir,
        ledger: md,
        maxRecords: exp.maxRecords,
        timeBudgetMs: exp.timeBudgetMs,
        logger: deps.logger,
      });
    }

    case 'dsh-memory/session-mode-set': {
      if (!modes) throw new Error('档位存储未初始化');
      const p = (payload ?? {}) as {
        sessionId?: string;
        mode?: string;
        recall?: boolean | null;
        hall?: string | null;
        halls?: readonly string[] | null;
        hallIncludeUnlabeled?: boolean;
        hallIncludeGeneral?: boolean;
      };
      const sessionId = expectSessionId(p.sessionId);
      const allowed: MemoryMode[] = ['auto', 'chat', 'work', 'off'];
      if (p.mode === undefined) {
        throw new Error('session-mode-set 需要 mode');
      }
      if (p.mode !== undefined && (typeof p.mode !== 'string' || !allowed.includes(p.mode as MemoryMode))) {
        throw new Error(`非法档位: ${String(p.mode)}(允许 ${allowed.join('/')})`);
      }
      // 注入覆盖可选同车:布尔 = 设置覆盖;显式 null = 清除覆盖(跟随全局);
      // 缺省(undefined)= 仅切档、覆盖保持不动(旧 client 永不传 recall,行为不变)。
      // 校验前置:非法 recall 在任何写穿发生前拒绝(不做部分提交)
      if (p.recall !== undefined && typeof p.recall !== 'boolean' && p.recall !== null) {
        throw new Error(`非法注入覆盖: ${String(p.recall)}(允许 true/false/null)`);
      }
      // 域锁定可选同车:角 id = 锁定;显式 null/空数组 = 回中心;缺省 = 不动。
      // 只认 8 角 id(general 是兜底值不是角,不可锁定),非法值整体拒绝(不做部分提交)
      if (p.hall !== undefined && p.hall !== null && !isWingCorner(p.hall)) {
        throw new Error(`非法 Wing 锁定: ${String(p.hall)}(允许 ${WING_CATALOG.map((h) => h.id).join('/')}/null)`);
      }
      if (p.halls !== undefined && p.halls !== null) {
        const bad = Array.from(p.halls).find((x) => !isWingCorner(x));
        if (bad !== undefined) {
          throw new Error(`非法 Wing 锁定: ${String(bad)}(允许 ${WING_CATALOG.map((h) => h.id).join('/')}/null)`);
        }
      }
      if (p.mode !== undefined) modes.set(sessionId, p.mode as MemoryMode);
      if (typeof p.recall === 'boolean') {
        modes.setRecall(sessionId, p.recall);
      } else if (p.recall === null) {
        modes.setRecall(sessionId, undefined);
      }
      if (
        p.hall !== undefined ||
        p.halls !== undefined ||
        p.hallIncludeUnlabeled !== undefined ||
        p.hallIncludeGeneral !== undefined
      ) {
        // wing/halls 都没传 = 只改边界开关 → 传 undefined，由 store 保留现锁域
        //（旧写法在这条分支算出 undefined 并在 store 侧被当"回中心"，会静默清掉锁定）
        const nextWings =
          p.hall === undefined && p.halls === undefined
            ? undefined
            : p.halls === null || p.hall === null
              ? []
              : p.halls !== undefined
                ? p.halls
                : [p.hall as string];
        modes.setWing(sessionId, nextWings, {
          includeUnlabeled: p.hallIncludeUnlabeled,
          includeGeneral: p.hallIncludeGeneral,
        });
      }
      deps.logger.info(
        `[memory] 会话档位设置 session=${sessionId} mode=${p.mode} recall=${JSON.stringify(modes.getRecall(sessionId) ?? null)} wing=${JSON.stringify(modes.getWing(sessionId) ?? null)}`,
      );
      const s = live?.get();
      const bounds = modes.wingBoundaries(sessionId);
      const locked = modes.getWings(sessionId);
      const v: SessionModeSetResponse = {
        sessionId,
        mode: modes.get(sessionId),
        recall: modes.getRecall(sessionId) ?? null,
        recallResolved: modes.resolvedRecall(sessionId, s?.recall ?? true),
        hall: locked[0] ?? null,
        halls: locked,
        hallIncludeUnlabeled: bounds.includeUnlabeled,
        hallIncludeGeneral: bounds.includeGeneral,
      };
      return v;
    }

    // ── Hall 八边形角计数(WingWheel 打开时拉取;非热路径,组查询一条 SQL) ──
    case 'dsh-memory/wing-overview': {
      const { counts, unlabeled } = stores.l1.wingCounts();
      const v: WingOverviewResponse = {
        corners: WING_CATALOG.map((h) => ({ id: h.id, label: h.label, count: counts[h.id] ?? 0 })),
        general: counts[WING_FALLBACK] ?? 0,
        unlabeled,
      };
      return v;
    }

    // ── Room 分类计数(标签自生长分类;展开 metadata.tags 聚合,零 schema) ──
    case 'dsh-memory/rooms-get': {
      const rooms = stores.l1.listRooms();
      // 端点层合并注册表(Agent A 设计):注册表 active 条目 count=0 补齐并带
      // source/label(source 用条目真实来源——收编 grown ≠ 预注册,⭐角标靠它区分);
      // 自生长条目标 source='grown'。不动 listRooms() 的缓存语义。
      const merged: Array<RoomCount & { label?: string }> = rooms.map((r) => ({ ...r, source: 'grown' }));
      const registry = roomRegistry?.listActive() ?? [];
      for (const e of registry) {
        const idx = merged.findIndex((r) => r.room === e.slug);
        if (idx === -1) {
          merged.push({ room: e.slug, count: 0, source: e.source, label: e.label });
        } else {
          merged[idx] = { ...merged[idx], source: e.source, label: e.label ?? merged[idx].label };
        }
      }
      const v: RoomsGetResponse = {
        rooms: merged,
        total: merged.length,
        orphanCount: stores.l1.untaggedL1Count(),
        registry: roomRegistry?.list().map((e) => ({
          slug: e.slug,
          label: e.label,
          description: e.description,
          source: e.source,
          aliases: e.aliases,
          status: e.status,
        })),
      };
      return v;
    }

    // ── 轨3 外部记忆来源（Connect）：登记/列表/退役/只读扫描。整面默认关（cfg.memport.enabled）。
    case 'dsh-memory/memory-sources-list': {
      const enabled = cfg.memport?.enabled === true;
      const v: MemorySourcesListResponse = {
        sources:
          enabled && memorySources
            ? memorySources.list().map((e) => ({
                id: e.id,
                kind: e.kind,
                path: e.path,
                label: e.label,
                lastScanAt: e.lastScanAt,
                lastImportAt: e.lastImportAt,
                disabled: e.disabled,
                status: e.status,
              }))
            : [],
        memoryMutate: live?.get().memoryMutate === true,
      };
      return v;
    }

    case 'dsh-memory/memory-sources-add': {
      if (cfg.memport?.enabled !== true) throw new Error('外部记忆来源未启用（config memport.enabled）。');
      if (!memorySources) throw new Error('外部来源注册表未装配（需要插件重载以初始化）。');
      if (!live?.get().memoryMutate) throw new Error('记忆写删未开放：请在记忆库面板开启「高权限模式」后才能登记外部来源。');
      const p = (payload ?? {}) as { id?: string; kind?: string; path?: string; label?: string };
      const r = await memorySources.register({
        id: String(p.id ?? '').trim(),
        kind: (String(p.kind ?? 'file') as SourceKind) ?? 'file',
        path: String(p.path ?? '').trim(),
        label: typeof p.label === 'string' ? p.label : undefined,
      });
      const v: MemorySourcesAddResponse = {
        id: r.entry.id,
        created: r.created,
        notice: r.created ? '已登记来源。' : '来源已存在（已按新 path/label 原地更新）。',
      };
      return v;
    }

    case 'dsh-memory/memory-sources-retire': {
      if (cfg.memport?.enabled !== true) throw new Error('外部记忆来源未启用（config memport.enabled）。');
      if (!memorySources) throw new Error('外部来源注册表未装配（需要插件重载以初始化）。');
      if (!live?.get().memoryMutate) throw new Error('记忆写删未开放：请在记忆库面板开启「高权限模式」后才能管理外部来源。');
      const p = (payload ?? {}) as { id?: string; active?: boolean };
      const changed = await memorySources.setStatus(String(p.id ?? '').trim(), p.active === true ? 'active' : 'retired');
      const v: MemorySourcesRetireResponse = {
        changed,
        notice: !changed
          ? '未找到该来源。'
          : p.active === true
            ? '已恢复来源。'
            : '已退役来源（不删已导入数据；来源路径与 ext_key 仍在，可重放）。',
      };
      return v;
    }

    case 'dsh-memory/memport-scan': {
      if (cfg.memport?.enabled !== true) {
        const v: MemportScanResponse = { enabled: false, sources: [], notice: '外部记忆扫描未启用（config memport.enabled）。' };
        return v;
      }
      if (!memorySources) {
        const v: MemportScanResponse = { enabled: true, sources: [], notice: '外部来源注册表未装配。' };
        return v;
      }
      const p = (payload ?? {}) as { sourceId?: string };
      const all = memorySources.listEnabled();
      const targets = p.sourceId ? all.filter((e) => e.id === p.sourceId) : all;
      const maxRecords = cfg.memport?.scanMaxRecords ?? 5000;
      // 只读扫描：不写库（写走 memory_import）。逐个标扫描时间（失败不影响预览）。
      const sources = await scanSources({ sources: targets, l1: stores.l1, maxRecords });
      const nowIso = new Date().toISOString();
      for (const s of targets) await memorySources.markScanned(s.id, nowIso);
      const v: MemportScanResponse = { enabled: true, sources };
      return v;
    }

    // ── 轨2 技能（SkillsTab）：列表 + 人工审阅动作（晋升/归档/pin/改档）。整面默认关（cfg.skills.enabled）。
    case 'dsh-memory/skills-list': {
      const enabled = cfg.skills?.enabled === true || live?.get().skillsEnabled === true;
      const v: SkillsListResponse = {
        enabled,
        allowPromote: cfg.skills?.allowPromote === true,
        memoryMutate: live?.get().memoryMutate === true,
        skills:
          enabled && skillStore
            ? skillStore.list().map((s) => ({
                id: s.id,
                title: s.title,
                status: s.status,
                tier: s.injectionTier,
                pinned: s.pinned,
                sessionCount: skillStore.sessionCount(s.id),
                updatedAt: s.updatedAt,
              }))
            : [],
      };
      return v;
    }

    case 'dsh-memory/skills-action': {
      if (!(cfg.skills?.enabled === true || live?.get().skillsEnabled === true)) throw new Error('技能功能未启用（在概览页开启「技能」开关，或 config skills.enabled）。');
      if (!skillStore) throw new Error('技能存储未装配。');
      if (!live?.get().memoryMutate) throw new Error('记忆写删未开放：请在记忆库面板开启「高权限模式」后才能管理技能。');
      const p = (payload ?? {}) as { id?: string; action?: string; tier?: string; reason?: string };
      const id = String(p.id ?? '').trim();
      if (!id) throw new Error('id 不能为空');
      const minSessions = cfg.skills.minSessions;
      const v: SkillsActionResponse = { changed: false, notice: '' };
      if (p.action === 'promote') {
        // 人工审阅晋升：不受自动闸 allowPromote 约束，但仍需证据达阈（不凭空的晋升）。
        if (skillStore.sessionCount(id) < minSessions) return { changed: false, notice: `证据会话数不足（<${minSessions}），暂不能晋升。` };
        const ok = await skillStore.tryPromote(id, minSessions, { allowPromote: true });
        return { changed: ok, notice: ok ? '已晋升为 active。' : '未找到候选或状态已变。' };
      }
      if (p.action === 'archive') {
        const ok = await skillStore.archive(id, String(p.reason ?? 'manual').slice(0, 120) || 'manual');
        return { changed: ok, notice: ok ? '已归档（不再注入，可恢复）。' : '未找到或已归档。' };
      }
      if (p.action === 'pin') {
        const ok = await skillStore.update(id, { pinned: true });
        return { changed: ok, notice: ok ? '已固定。' : '未找到技能。' };
      }
      if (p.action === 'unpin') {
        const ok = await skillStore.update(id, { pinned: false });
        return { changed: ok, notice: ok ? '已取消固定。' : '未找到技能。' };
      }
      if (p.action === 'set-tier') {
        const tier = p.tier === 'full' || p.tier === 'excerpt' || p.tier === 'hint' ? p.tier : null;
        if (!tier) throw new Error('tier 非法（仅 full/excerpt/hint）');
        const ok = await skillStore.update(id, { injectionTier: tier });
        return { changed: ok, notice: ok ? `已设为 ${tier} 档。` : '未找到技能。' };
      }
      void v;
      throw new Error(`未知 action: ${String(p.action)}`);
    }

    case 'dsh-memory/room-register': {
      if (!roomRegistry) throw new Error('Room 注册表未装配(需要插件重载以初始化)。');
      if (!live?.get().memoryMutate) throw new Error('记忆写删未开放:请在记忆库面板开启「高权限模式」后,模型才能预注册 Room。');
      const p = (payload ?? {}) as { slug?: string; label?: string; description?: string; source?: string };
      const slug = String(p.slug ?? '').trim();
      if (!slug) throw new Error('slug 不能为空');
      const r = await roomRegistry.register({
        slug,
        label: typeof p.label === 'string' ? p.label : undefined,
        description: typeof p.description === 'string' ? p.description : undefined,
        source: p.source === 'grown' ? 'grown' : undefined,
      });
      const v: RoomRegisterResponse = {
        slug: r.entry.slug,
        created: r.created,
        notice: r.created ? '已预注册。' : '已存在(只补全了缺失的 label/description)。',
      };
      return v;
    }

    // ── Room 破坏性面管理(merge/rename/retire;与 memory_room_admin 工具同编排) ──
    case 'dsh-memory/room-admin': {
      if (!roomRegistry) throw new Error('Room 注册表未装配(需要插件重载以初始化)。');
      if (!live?.get().memoryMutate) throw new Error('记忆写删未开放:请在记忆库面板开启「高权限模式」后,才能执行 Room 管理。');
      const p = (payload ?? {}) as RoomAdminRequest;
      if (p.action === 'update') {
        const slug = String(p.slug ?? '').trim();
        if (!slug) throw new Error('update 需要 slug');
        const changed = await roomRegistry.update(slug, {
          label: typeof p.label === 'string' ? p.label : undefined,
          description: typeof p.description === 'string' ? p.description : undefined,
        });
        const v: RoomAdminResponse = {
          notice: changed
            ? `已更新:${slug}(显示名/归类说明,标注器下次即用新词)`
            : `无变化:${slug} 未找到或未提供任何非空字段`,
        };
        return v;
      }
      if (p.action === 'retire') {
        const slug = String(p.slug ?? '').trim();
        if (!slug) throw new Error('retire 需要 slug');
        const active = p.active === true;
        // 自生长未注册 slug 退场:自动补一条 grown 注册条目再置 retired——
        // 否则词表无物可变,面板按钮无法切换为「恢复」(用户实测反馈)
        if (!active && p.withRecords === true && !roomRegistry.bySlug(slug)) {
          await roomRegistry.register({ slug, source: 'grown' });
        }
        const changed = await roomRegistry.setStatus(slug, active ? 'active' : 'retired');
        // 带记录退场(软删,可恢复):该 room 下全部**活跃**记录分批 retire(每批 ≤200,与 records-delete 同原语)
        let retiredRecords = 0;
        if (p.withRecords === true && !active) {
          for (let offset = 0; ; offset += 200) {
            const page = stores.l1.list({ tag: slug, retired: false, limit: 200, offset });
            if (page.items.length === 0) break;
            const n = stores.l1.retire(page.items.map((r) => r.id), { at: new Date().toISOString(), reason: 'manual' });
            retiredRecords += n;
            if (page.items.length < 200) break;
          }
          deps.logger.info(`[memory] Room 退役带记录:${slug},退场 ${retiredRecords} 条(软删,可恢复)`);
        }
        const v: RoomAdminResponse = {
          retiredRecords: retiredRecords > 0 ? retiredRecords : undefined,
          notice: changed
            ? active
              ? `已恢复:${slug}`
              : `已退役:${slug}(存量记录的 tags 不动,仅词表不再推荐)。${retiredRecords > 0 ? `已连同退场 ${retiredRecords} 条记录(软删,可在「已退场」区恢复)。` : ''}`
            : `未找到注册条目或状态无变化:${slug}。${retiredRecords > 0 ? `已退场 ${retiredRecords} 条记录(软删,可恢复)。` : ''}`,
        };
        return v;
      }
      if (p.action === 'merge' || p.action === 'rename') {
        const from = String(p.from ?? '').trim();
        const to = String(p.to ?? '').trim();
        if (!from || !to) throw new Error('merge/rename 需要 from 与 to 两个 slug');
        const dryRun = p.dryRun !== false;
        const r = await (p.action === 'merge' ? mergeRoom : renameRoom)(
          { l1: stores.l1, registry: roomRegistry, logger: deps.logger },
          from,
          to,
          { dryRun },
        );
        if (r.dryRun) {
          const v: RoomAdminResponse = {
            notice:
              `[dryRun 预览] ${from} → ${to}:影响 ${r.affected} 条${r.hasMore ? '(超过单次上限,需续跑)' : ''}。` +
              `样例:${r.preview.join(', ') || '无'}。确认无误后以 dryRun=false 执行(执行前自动备份,完成后自动入队场景重算)。`,
            dryRun: true,
            affected: r.affected,
            preview: r.preview,
            hasMore: r.hasMore,
          };
          return v;
        }
        // 实跑:受影响场景入队重算(source='room-merge';与工具同口径)
        let requeued = 0;
        for (const family of r.families ?? []) {
          for (const scene of r.scenes ?? []) {
            stores.l1.enqueueSceneRecluster(family, [scene], `room-merge:${Date.now()}`, 'room-merge');
            requeued++;
          }
        }
        const v: RoomAdminResponse = {
          notice:
            `${p.action === 'merge' ? '合并' : '改名'}完成:${from} → ${to},重写 ${r.applied} 条` +
            `(备份:${r.backupFile ?? '无'})${requeued > 0 ? `;已入队 ${requeued} 个场景重算` : ''}。`,
          dryRun: false,
          affected: r.applied,
          backupFile: r.backupFile,
        };
        return v;
      }
      throw new Error(`非法 action:${String(p.action)}(允许 merge/rename/retire)`);
    }

    case 'dsh-memory/rooms-export': {
      const p = (payload ?? {}) as { kind?: string; limit?: number; tag?: string };
      const kind =
        p.kind === 'orphans' ? 'orphans' : p.kind === 'rooms' ? 'rooms' : p.kind === 'records' ? 'records' : '';
      if (!kind) throw new Error(`非法 kind: ${String(p.kind)}(允许 rooms/orphans/records)`);
      const limit = Math.min(Math.max(Number(p.limit) || 2000, 1), 10_000);
      const esc = (v: unknown): string => {
        const t = String(v ?? '');
        return /[,\r\n"]/ .test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
      };
      if (kind === 'rooms') {
        const registry = roomRegistry?.list() ?? [];
        const counts = new Map(stores.l1.listRooms().map((r) => [r.room, r.count]));
        const lines = ['slug,count,source,label,description,status,aliases'];
        let n = 0;
        const seen = new Set<string>();
        for (const e of registry) {
          lines.push([e.slug, String(counts.get(e.slug) ?? 0), e.source, e.label ?? '', e.description ?? '', e.status, (e.aliases ?? []).join('|')].map(esc).join(','));
          seen.add(e.slug);
          n++;
        }
        for (const r of stores.l1.listRooms()) {
          if (seen.has(r.room)) continue;
          lines.push([r.room, String(r.count), 'grown', '', '', 'active', ''].map(esc).join(','));
          n++;
        }
        const v: RoomsExportResponse = { kind, csv: lines.join('\r\n'), total: n, truncated: false };
        return v;
      }
      if (kind === 'records') {
        const tag = String(p.tag ?? '').trim();
        if (!tag) throw new Error('kind=records 需要 tag(目标 Room slug)');
        const header = 'id,type,scene_name,updated_at,tags,content';
        const lines: string[] = [header];
        let n = 0;
        let truncated2 = false;
        for (let offset = 0; offset < limit; offset += 200) {
          const page = stores.l1.list({ tag, retired: undefined, limit: 200, offset });
          for (const r of page.items) {
            if (n >= limit) {
              truncated2 = true;
              break;
            }
            const meta = (r.metadata ?? {}) as Record<string, unknown>;
            const tags = Array.isArray(meta.tags) ? (meta.tags as string[]).join('|') : '';
            lines.push(
              [r.id, r.type, r.scene_name, new Date(r.updatedAt).toISOString(), tags, r.content].map(esc).join(','),
            );
            n++;
          }
          if (truncated2 || page.items.length < 200) break;
        }
        const v: RoomsExportResponse = { kind, csv: lines.join('\r\n'), total: n, truncated: truncated2 };
        return v;
      }
      // orphans:无 Room 绑定的活跃记录清单(id/type/scene/updated/content/候选/状态)
      const header = 'id,type,scene_name,updated_at,content,room_candidates,room_review';
      const lines: string[] = [header];
      let n = 0;
      let truncated = false;
      for (let offset = 0; offset < limit; offset += 200) {
        const page = stores.l1.list({ untagged: true, retired: false, limit: 200, offset });
        for (const r of page.items) {
          if (n >= limit) {
            truncated = true;
            break;
          }
          const meta = (r.metadata ?? {}) as Record<string, unknown>;
          lines.push(
            [r.id, r.type, r.scene_name, new Date(r.updatedAt).toISOString(), r.content,
             Array.isArray(meta.roomCandidates) ? (meta.roomCandidates as string[]).join('|') : '',
             String(meta.roomReview ?? '')].map(esc).join(','),
          );
          n++;
        }
        if (truncated || page.items.length < 200) break;
      }
      const v: RoomsExportResponse = { kind, csv: lines.join('\r\n'), total: n, truncated };
      return v;
    }
    case 'dsh-memory/wing-backfill': {
      const r = startWingBackfill({
        ctx: deps.ctx,
        cfg: deps.cfg,
        backend: stores.backend ?? new InProcMemoryBackend(stores.l1),
        logger: deps.logger,
      });
      return r;
    }

    // ── 会话级统计(悬浮卡信息区;热路径端点,见 SessionInfoSource 的零 I/O 硬规则) ──
    case 'dsh-memory/session-stats': {
      if (!sessionInfo) return { supported: false };
      const p = (payload ?? {}) as { sessionId?: string };
      const sessionId = expectSessionId(p.sessionId);
      const mode: MemoryMode = modes ? modes.get(sessionId) : 'auto';
      const caps = sessionInfo.capabilities();
      const l0Count = await sessionInfo.l0Count(sessionId);
      const s = live?.get();
      // 注入生效四因子短路序:部署上限 → 全局开关 → 会话覆盖 → 档位;
      // disabled 时 reason 带第一个为假因子(悬浮卡停用文案的数据源)
      const globalRecall = s?.recall ?? true;
      const sessionRecall = modes ? modes.resolvedRecall(sessionId, globalRecall) : true;
      let recallReason: RecallDisabledReason | undefined;
      if (!cfg.recall.enabled) recallReason = 'deploy';
      else if (!globalRecall) recallReason = 'global';
      else if (!sessionRecall) recallReason = 'session';
      else if (mode === 'off') recallReason = 'mode';
      const recallOn = recallReason === undefined;
      const view = sessionInfo.runnerView(sessionId, mode);
      // lastDistillAt 统一转 ISO(与 global.lastExtractAt 口径一致,client 直接 fmtAgo)
      const distillView = { ...view, lastDistillAt: view.lastDistillAt ? new Date(view.lastDistillAt).toISOString() : null };
      const chat = stores.state.forFamily('chat');
      const work = stores.state.forFamily('work');
      const lastAt = Math.max(chat.lastExtractAt, work.lastExtractAt);
      // 主对话模型的官方声明窗口(占用指示器分母;advisory 查询读本地快照且有缓存,
      // 轮询热路径下稳态为 Map 命中。race 封顶防第三方适配器 resolveModelInfo 挂起拖死轮询)
      let contextWindowTokens: number | null = null;
      try {
        const sel = deps.ctx.get('agentDefaultModel')?.currentSelection?.();
        if (sel?.provider && sel?.model) {
          contextWindowTokens = await Promise.race([
            resolveModelContextWindow(deps.ctx, sel.provider, sel.model),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000)),
          ]);
        }
      } catch {
        /* 可选服务缺失/解析失败 = 分母未知,UI 降级 */
      }
      const v: SessionStatsResponse = {
        supported: true,
        sessionId,
        mode,
        defaultMode: modes?.default ?? cfg.family,
        recall: {
          enabled: recallOn,
          ...(recallReason ? { reason: recallReason } : {}),
          ...(sessionInfo.recallStats(sessionId) ?? emptyRecallStats()),
        },
        memoryOccupancy: sessionInfo.memoryOccupancy(sessionId),
        occupancyBackfill: sessionInfo.profileEstimate
          ? {
              recallTokens: sessionInfo.recallEstimate ? await sessionInfo.recallEstimate(sessionId) : null,
              profileTokens: sessionInfo.profileEstimate(sessionId),
            }
          : null,
        contextWindowTokens,
        distill: distillView,
        l0Count,
        retrieval: caps.vectorSearch ? (caps.ftsSearch ? 'hybrid' : 'vector') : caps.ftsSearch ? 'keyword' : 'none',
        global: {
          degraded: status?.degraded() ?? false,
          pendingTotal: status?.pending() ?? 0,
          lastExtractAt: lastAt ? new Date(lastAt).toISOString() : null,
        },
      };
      return v;
    }

    case 'dsh-memory/settings-get': {
      const s = live?.get();
      const budgets = s?.distillBudgets ?? { extract: 0, dedup: 0, l2: 0, l3: 0, graph: 0 };
      // 蒸馏思考档位:current 是运行时值('' = 自动);effective 是能力探询后实际发送值
      // ('' = 不传,跟随模型默认);options 是当前生效模型声明的档位表(空声明 → 只显示
      // high,用户规则:无声明默认 high),fallback 是静态部署值。
      let effortEffective = s?.reasoningEffort || cfg.llm.reasoningEffort;
      let effortOptions: string[] = ['high'];
      let effortRoute: { provider: string; model: string } | null = null;
      try {
        const ecfg = effectiveCfg(cfg, live);
        effortRoute = await resolveModelRoute(deps.ctx, ecfg);
        const cap = await resolveModelEfforts(deps.ctx, effortRoute.provider, effortRoute.model);
        if (cap) {
          effortEffective = decideSendableEffort(cap, ecfg.llm.reasoningEffort).effort;
          if (cap.efforts.length > 0) effortOptions = cap.efforts;
        }
      } catch {
        /* 路由解析/探询失败保持占位(effective 用运行时||静态值) */
      }
      const resp: SettingsGetResponse = {
        supported: live?.supported ?? false,
        settings: sanitizeSettings(s ?? {
          enabled: true, capture: true, distill: true, recall: true,
          toolRoom: true, toolGraph: true, toolRuminate: true, toolConflict: true, toolMutate: true,
          reasoningEffort: '', distillProvider: '', distillModel: '', distillChain: [],
          distillBudgets: { extract: 0, dedup: 0, l2: 0, l3: 0, graph: 0 }, distillMaxInputChars: 0,
          distillLayerChains: { l1: [], l2: [], l3: [] },
          distillMode: '', directBaseURL: '', directApiKey: '',
          embedRemoteBaseURL: '', embedRemoteApiKey: '', embedRemoteModel: '', embedRemoteDimensions: 0,
          memoryMutate: false,
          conflictFreeze: live?.get()?.conflictFreeze === true,
          skillsEnabled: live?.get()?.skillsEnabled === true,
        }),
        // 静态部署上限(cordis.patch.yml):运行时开关与它取 AND
        ceilings: { capture: cfg.capture.enabled, distill: cfg.extract.enabled, recall: cfg.recall.enabled },
        effort: {
          current: s?.reasoningEffort ?? '',
          // 静态 schema 与 settings-set 写入门都以 EFFORT_CHOICES 白名单校验,这里断言回窄类型
          effective: effortEffective as EffortChoice,
          fallback: cfg.llm.reasoningEffort as EffortChoice,
          options: effortOptions,
          ...(effortRoute ? { route: effortRoute } : {}),
        },
        // 分层输出预算:current 是运行时覆盖(0 = 跟随默认),defaults 是内置默认(UI 占位/提示用)
        budgets: {
          current: budgets,
          defaults: { ...LAYER_DEFAULT_BUDGETS },
          effective: {
            extract: budgets.extract > 0 ? budgets.extract : LAYER_DEFAULT_BUDGETS.extract,
            dedup: budgets.dedup > 0 ? budgets.dedup : LAYER_DEFAULT_BUDGETS.dedup,
            l2: budgets.l2 > 0 ? budgets.l2 : LAYER_DEFAULT_BUDGETS.l2,
            l3: budgets.l3 > 0 ? budgets.l3 : LAYER_DEFAULT_BUDGETS.l3,
            graph: budgets.graph > 0 ? budgets.graph : LAYER_DEFAULT_BUDGETS.graph,
          },
        },
        // 输入预算(字符):current 是运行时覆盖(0 = 跟随配置),fallback 是静态配置值
        inputBudget: {
          current: s?.distillMaxInputChars ?? 0,
          fallback: cfg.llm.maxInputChars,
          effective: s && s.distillMaxInputChars > 0 ? s.distillMaxInputChars : cfg.llm.maxInputChars,
        },
      };
      return resp;
    }

    case 'dsh-memory/settings-set': {
      if (!live) throw new Error('开关通道未初始化');
      const patch = (payload ?? {}) as Record<string, unknown>;
      const clean: Record<string, boolean | string | number | DistillChainEntry[] | { extract: number; dedup: number; l2: number; l3: number; graph: number } | { l1: DistillChainEntry[]; l2: DistillChainEntry[]; l3: DistillChainEntry[] }> = {};
      // 布尔开关组:memoryMutate(高权限写删门)与主开关同列;conflictFreeze(§C 人工冲突裁决)
      for (const key of ['enabled', 'capture', 'distill', 'recall', 'memoryMutate', 'conflictFreeze', 'skillsEnabled', 'toolRoom', 'toolGraph', 'toolRuminate', 'toolConflict', 'toolMutate'] as const) {
        if (typeof patch[key] === 'boolean') clean[key] = patch[key] as boolean;
      }
      // 运行时统一路由链:结构校验后整体写入(空数组 = 回到跟随部署配置)
      if (patch.distillChain !== undefined) {
        const err = validateDistillChain(patch.distillChain);
        if (err) throw new Error(err);
        clean.distillChain = patch.distillChain as DistillChainEntry[];
      }
      // 运行时按层路由链:逐层校验(头行必须显式——层覆盖不支持跟随默认模型);
      // patch 语义只带要改的层,写入侧与存量层合并后落盘(空数组 = 该层回到跟随)
      if (patch.distillLayerChains !== undefined) {
        const rawLC = (patch.distillLayerChains ?? {}) as Record<string, unknown>;
        const prev = (live.get().distillLayerChains ?? {}) as Record<string, DistillChainEntry[]>;
        const merged: Record<string, DistillChainEntry[]> = {
          l1: prev.l1 ?? [],
          l2: prev.l2 ?? [],
          l3: prev.l3 ?? [],
        };
        for (const key of ['l1', 'l2', 'l3'] as const) {
          if (rawLC[key] === undefined) continue;
          const err = validateDistillChain(rawLC[key], { requireExplicitHead: true });
          if (err) throw new Error(`层路由 ${key}:${err}`);
          merged[key] = rawLC[key] as DistillChainEntry[];
        }
        clean.distillLayerChains = merged as { l1: DistillChainEntry[]; l2: DistillChainEntry[]; l3: DistillChainEntry[] };
      }
      if (patch.reasoningEffort !== undefined) {
        const v = String(patch.reasoningEffort);
        // 白名单与 schema/settings 同源(config.ts EFFORT_CHOICES)
        if (!(EFFORT_CHOICES as readonly string[]).includes(v)) {
          throw new Error(`非法思考档位: ${v}(允许 '' 或 ${EFFORT_CHOICES.filter((x) => x !== '').join('/')})`);
        }
        clean.reasoningEffort = v;
      }
      // 蒸馏模型运行时覆盖:供应商/模型 id 原样接受(不在此校验存在性——
      // 供应商可被用户随后删除,解析侧按存在性回退并提示)
      for (const key of ['distillProvider', 'distillModel'] as const) {
        if (patch[key] !== undefined) {
          const v = String(patch[key]);
          if (v.length > 200) throw new Error(`${key} 过长(≤200 字符)`);
          clean[key] = v;
        }
      }
      // 分层输出预算:五键一起校验,非负整数 ≤ 100 万;0 = 跟随内置默认
      // (键表与 DistillBudgetLayer 同步——漏白名单键 = 静默丢预算,C 节坑①)
      if (patch.distillBudgets !== undefined) {
        const raw = (patch.distillBudgets ?? {}) as Record<string, unknown>;
        const budgets: Record<string, number> = {};
        for (const key of ['extract', 'dedup', 'l2', 'l3', 'graph'] as const) {
          const n = Number(raw[key] ?? 0);
          if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
            throw new Error(`distillBudgets.${key} 须为 0~1000000 的整数(0 = 跟随默认)`);
          }
          budgets[key] = n;
        }
        clean.distillBudgets = budgets as { extract: number; dedup: number; l2: number; l3: number; graph: number };
      }
      // 输入预算(字符):0 = 跟随静态配置;正值须落在静态 schema 同款范围(1000~100 万)
      if (patch.distillMaxInputChars !== undefined) {
        const n = Number(patch.distillMaxInputChars);
        if (!Number.isInteger(n) || n < 0 || n > 1_000_000 || (n > 0 && n < 1000)) {
          throw new Error('distillMaxInputChars 须为 0 或 1000~1000000 的整数(0 = 跟随配置)');
        }
        clean.distillMaxInputChars = n;
      }
      // 蒸馏通道运行时覆盖(direct 解耦):mode 白名单;endpoint 可回显;apiKey 属机密——
      // 写入后存 settings,但不回读到 UI、不落本条日志(下方日志先剔除后记录)
      if (patch.distillMode !== undefined) {
        const m = String(patch.distillMode);
        if (m !== '' && m !== 'host' && m !== 'direct') {
          throw new Error("distillMode 须为 '' | 'host' | 'direct'('' = 跟随部署配置)");
        }
        clean.distillMode = m;
      }
      if (patch.directBaseURL !== undefined) {
        const base = String(patch.directBaseURL);
        if (base.length > 2000) throw new Error('directBaseURL 过长(≤2000 字符)');
        clean.directBaseURL = base;
      }
      if (patch.directApiKey !== undefined) {
        const key = String(patch.directApiKey);
        if (key.length > 2000) throw new Error('directApiKey 过长(≤2000 字符)');
        clean.directApiKey = key;
      }
      // 远程嵌入连接运行时覆盖(设置 UI 可编辑):baseURL/model 回显;apiKey 属机密→脱敏;
      // dimensions 0 = 未配置,须落在 schema 同款范围(0~8192)
      if (patch.embedRemoteBaseURL !== undefined) {
        const base = String(patch.embedRemoteBaseURL);
        if (base.length > 2000) throw new Error('embedRemoteBaseURL 过长(≤2000 字符)');
        clean.embedRemoteBaseURL = base;
      }
      if (patch.embedRemoteModel !== undefined) {
        const m = String(patch.embedRemoteModel);
        if (m.length > 200) throw new Error('embedRemoteModel 过长(≤200 字符)');
        clean.embedRemoteModel = m;
      }
      if (patch.embedRemoteDimensions !== undefined) {
        const dim = Number(patch.embedRemoteDimensions);
        if (!Number.isInteger(dim) || dim < 0 || dim > 8192) {
          throw new Error('embedRemoteDimensions 须为 0~8192 的整数(0 = 未配置)');
        }
        clean.embedRemoteDimensions = dim;
      }
      if (patch.embedRemoteApiKey !== undefined) {
        const key = String(patch.embedRemoteApiKey);
        if (key.length > 2000) throw new Error('embedRemoteApiKey 过长(≤2000 字符)');
        clean.embedRemoteApiKey = key;
      }
      if (Object.keys(clean).length === 0) throw new Error('开关更新载荷为空');
      // 日志脱敏:直连/远程 API key 永不出现在日志
      const logSafe = { ...clean } as Record<string, unknown>;
      delete logSafe.directApiKey;
      delete logSafe.embedRemoteApiKey;
      await live.update(clean);
      deps.logger.info(`[memory] 设置更新:${JSON.stringify(logSafe)}`);
      const v: SettingsSetResponse = { ok: true, settings: sanitizeSettings(live.get()) };
      return v;
    }

    case 'dsh-memory/list-records': {
      const p = (payload ?? {}) as { query?: string; type?: string; scene?: string; hall?: string; halls?: unknown; tag?: string; untagged?: boolean; retired?: unknown; limit?: number; offset?: number };
      if (p.query !== undefined && p.query.length > 4096) throw new Error('query 过长(≤4096 字符)');
      // 退场筛查:三态(缺省=全部混排/false=仅活跃/true=仅已退场)。显式布尔才透传,
      // 其余值(字符串/数字等)一律视为缺省——宁可宽看,不可静默筛掉一半。
      const retiredSel = typeof p.retired === 'boolean' ? p.retired : undefined;
      // Room 过滤:tag 是**自生长**的 slug(无枚举),只做形状与长度校验(SQL 侧参数化)
      const tagSel = typeof p.tag === 'string' ? p.tag.trim().slice(0, 64) : '';
      if (tagSel && !isRoomSlug(tagSel)) throw new Error('tag 非法(两级制:major 或 major/minor,各段小写字母数字连字符)');
      // 孤儿记忆筛选(与 tag 互斥,tag 优先):只认显式布尔,其余视为缺省。
      const untaggedSel = p.untagged === true && !tagSel;
      // R13 多值归一: halls 数组只留非空字符串(≤40 字符),去重,上限 8(角数);
      // wing 单值保留兼容,归一后与 halls 合并
      const wingSel = Array.from(
        new Set(
          [
            ...(Array.isArray(p.halls) ? p.halls.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim().slice(0, 40)) : []),
            ...(p.hall ? [p.hall.trim().slice(0, 40)] : []),
          ].slice(0, WING_CATALOG.length + 1),
        ),
      );
      const limit = Math.min(Math.max(Number(p.limit) || 50, 1), 200);
      const offset = Math.min(Math.max(Number(p.offset) || 0, 0), 1_000_000);
      // Wing 词表随首屏下发(R8 单一事实源,client 不手抄);常量拼接,零 I/O,不触碰热路径规则
      const wingCatalog =
        offset === 0
          ? [...WING_CATALOG.map((h) => ({ id: h.id, label: h.label })), { id: WING_FALLBACK, label: '跨域' }]
          : undefined;
      // 关键词路径:复用检索唯一缝(与召回同源),取回后做场景/Wing 过滤 + 手工分页。
      // 检索侧单次上限 200:分页窗口触达上限时显式标记 truncated(结果可能不完整)。
      if (p.query && p.query.trim()) {
        const SEARCH_CAP = 200;
        const wanted = offset + limit + 1;
        const hits = await stores.l1.search(p.query, Math.min(wanted, SEARCH_CAP), { type: p.type || undefined });
        let filtered = p.scene ? hits.filter((h) => h.scene_name === p.scene) : hits;
        // Wing / Room 过滤(检索命中不含 metadata):按 id 批量取回元数据后过滤
        let metaById: Map<string, Record<string, unknown>> | null = null;
        if ((wingSel.length > 0 || tagSel) && filtered.length > 0) {
          const meta = new Map<string, Record<string, unknown>>();
          for (const r of stores.l1.getByIds(filtered.map((h) => h.id))) {
            if (r.metadata) meta.set(r.id, r.metadata);
          }
          metaById = meta;
          filtered = filtered.filter((h) => {
            const m = meta.get(h.id);
            if (wingSel.length > 0) {
              const wing = m?.hall;
              if (!(typeof wing === 'string' && wing !== '' && wingSel.includes(wing))) return false;
            }
            if (tagSel) {
              const tags = m?.tags;
              if (!Array.isArray(tags) || !tags.some((t) => t === tagSel)) return false;
            }
            if (untaggedSel) {
              // 孤儿:tags 缺失/非数组/全部空串均算无 Room
              const tags = m?.tags;
              const hasRoom = Array.isArray(tags) && tags.some((t) => typeof t === 'string' && t !== '');
              if (hasRoom) return false;
            }
            return true;
          });
        }
        const pageIds = filtered.slice(offset, offset + limit).map((h) => h.id);
        const updatedById = new Map(stores.l1.getByIds(pageIds).map((r) => [r.id, r.updatedAt]));
        const resp: ListRecordsResponse = {
          items: filtered.slice(offset, offset + limit).map((h) =>
            hitToUiRecord(
              { ...h, metadata: metaById?.get(h.id) },
              {
                agingWeight: agingWeightOf(updatedById.get(h.id), stores.l1.decayHalfLife),
                usage: stores.usage?.get(h.id) ?? null,
                userRelevance: stores.feedback?.meanOf(h.id) ?? null,
                userMark: stores.feedback?.lastOf(h.id) ?? null,
              },
            ),
          ),
          hasMore: filtered.length > offset + limit,
          total: null,
          truncated: wanted > SEARCH_CAP,
          scenes: offset === 0 ? stores.l1.distinctScenes() : undefined,
          wingCatalog,
          usageSummary: stores.usage?.summary() ?? null,
        };
        return resp;
      }
      // 退场筛查仅浏览路径透传;检索路径不接——FTS/向量里本就没有已退场行,
      // 接了只会让「仅退场+关键词」永远空结果,不如如实不筛。
      const { items, total } = stores.l1.list({ type: p.type || undefined, scene: p.scene || undefined, hall: p.hall || undefined, halls: wingSel.length > 0 ? wingSel : undefined, tag: tagSel || undefined, untagged: untaggedSel || undefined, retired: retiredSel, limit, offset });
      const resp: ListRecordsResponse = {
        items: items.map((r) =>
          hitToUiRecord(
            r,
            {
              agingWeight: agingWeightOf(r.updatedAt, stores.l1.decayHalfLife),
              usage: stores.usage?.get(r.id) ?? null,
              userRelevance: stores.feedback?.meanOf(r.id) ?? null,
              userMark: stores.feedback?.lastOf(r.id) ?? null,
            },
          ),
        ),
        hasMore: offset + items.length < total,
        total,
        truncated: false,
        scenes: offset === 0 ? stores.l1.distinctScenes() : undefined,
        wingCatalog,
        usageSummary: stores.usage?.summary() ?? null,
      };
      return resp;
    }

    // ── §B 决策凭证回溯(task_19):与 memory_receipts 工具共用同一形状 ──
    // 端点层**不给"提示文案"这个出口**:工具是给模型用的,拒答必须变成可读的一句话;
    // 端点是给程序/面板用的,缺参就是调用错误,静默返回空会让调用方以为"确实没有"。
    case 'dsh-memory/receipts': {
      const p = (payload ?? {}) as { recordId?: unknown; runId?: unknown; limit?: unknown };
      const query: ReceiptQuery = {
        recordId: typeof p.recordId === 'string' && p.recordId.trim() ? p.recordId.trim() : undefined,
        runId: typeof p.runId === 'string' && p.runId.trim() ? p.runId.trim() : undefined,
      };
      const dimension = dimensionOf(query);
      if (dimension === 'none') throw new Error('需要 recordId 或 runId 至少一个(不支持查全部凭证)');
      const limit = Math.min(Math.max(Math.floor(Number(p.limit)) || 20, 1), RECEIPTS_QUERY_LIMIT_MAX);
      const rows = stores.l1.listReceipts({ ...query, limit });
      const resp: ReceiptsView = {
        dimension,
        items: rows.map(toReceiptView),
        total: stores.l1.countReceipts(query),
      };
      return resp;
    }

    // ── §C 矛盾冻结的**读**方向:与 memory_conflicts 工具共用同一形状 ──
    // 裁决端点(conflict-resolve)早就在,但只有"写"没有"读" —— 于是 pair_id
    // 无处可得:模型被指到不存在的 memory_conflicts 工具,人也没有面板。
    // 未开启冻结时同样走返回体(enabled:false + notice)而非抛错,理由同上。
    case 'dsh-memory/conflicts': {
      const p = (payload ?? {}) as { limit?: unknown };
      // 冻结开关只有**一个**事实源:与去重管线同一套 effectiveCfg 解析
      // (live.conflictFreeze 覆盖静态 cfg.conflictFreeze.enabled)。此前这里直接读
      // cfg.conflictFreeze.enabled —— 面板开关写的是 live,而部署静态值恒 false,
      // 于是开关已开、settings.yaml 已落 true,本页仍报"矛盾冻结未开启"。
      return listConflictPairs(
        { l1: stores.l1, conflictFreezeEnabled: effectiveCfg(cfg, live).conflictFreeze?.enabled === true, usage: stores.usage, decayHalfLifeDays: effectiveCfg(cfg, live).recall?.decayHalfLifeDays, feedback: stores.feedback },
        { limit: Number(p.limit) || undefined },
      );
    }

    // ── §C 矛盾冻结裁决(task_25):与 memory_resolve_conflict 工具共用同一形状 ──
    // 端点层同样不给"提示文案"出口的例外只有一条:**队列未开启**不是调用错误而是
    // 部署状态,故它走返回体(带 notice)而非抛错;pair_id/outcome 缺参才抛。
    // 开关判定与上面 conflicts 同源(effectiveCfg):读端与写端必须看同一份状态,
    // 否则会出现"列表说开着、裁决说没开"的自相矛盾。
    case 'dsh-memory/conflict-resolve': {
      const p = (payload ?? {}) as { pairId?: unknown; outcome?: unknown };
      const pairId = typeof p.pairId === 'string' ? p.pairId.trim() : '';
      const outcome = typeof p.outcome === 'string' ? p.outcome.trim() : '';
      if (!pairId) throw new Error('需要 pairId(待裁决对的 pair_id)');
      if (!outcome) throw new Error('需要 outcome(winner | loser | both | defer)');
      return await resolveConflictPair(
        { l1: stores.l1, conflictFreezeEnabled: effectiveCfg(cfg, live).conflictFreeze?.enabled === true },
        pairId,
        outcome,
      );
    }

    // ── §C 丢弃留痕:被 LLM 输出不合法的冲突决策记录(task_1.1) ──
    // 与 `dsh-memory/conflicts` 同模式:读方向,不涉及裁决。
    case 'dsh-memory/conflicts-rejected': {
      const p = (payload ?? {}) as { limit?: unknown; created_before?: unknown };
      const limit = typeof p.limit === 'number' ? p.limit : undefined;
      const createdBefore = typeof p.created_before === 'string' ? p.created_before : undefined;
      const items = stores.l1.listConflictRejected({ limit, createdBefore });
      return {
        items: items.map((r) => ({
          reject_id: r.rejectId,
          run_id: r.runId,
          record_id: r.recordId,
          winner_raw: r.winnerRaw,
          loser_raw: r.loserRaw,
          reason: r.reason,
          created_at: r.createdAt,
        })),
      };
    }

    case 'dsh-memory/records-delete': {
      // 面板高权限删除指定记忆;写入删权限门(memoryMutate)防御。
      //
      // **软删**(退场),不是物理删除:与裁决 / 取代共用同一原语。面板上的"删除"
      // 因此可撤销;真要抹掉数据只能走 `cleanup-retired`(先落快照 + 校验通过才删)。
      // 这样 `deleteL1Batch` 在整个代码里**只有一个调用方**(exportThenPurge),
      // "物理删除必须先有可信导出物"就成了结构性事实,而不是一句约定。
      if (!live?.get().memoryMutate) {
        throw new Error('记忆写删未开放:请在记忆库面板开启高权限模式');
      }
      const p = (payload ?? {}) as { ids?: unknown };
      const ids = (Array.isArray(p.ids) ? p.ids : []).filter((x): x is string => typeof x === 'string').slice(0, 200);
      if (ids.length === 0) throw new Error('ids 缺失');
      const n = stores.l1.retire(ids, { at: new Date().toISOString(), reason: 'manual' });
      deps.logger.info(`[memory] 高权限退场(软删)记忆 ${n} 条(${ids.join('，')})`);
      return { deleted: n };
    }

    // ── 记忆退场(软删)与清理:已退场列表 / 恢复 / 物理清理 ──
    // 读方向**不开**权限门(与 conflicts 一致:看得见才知道要不要恢复);
    // 恢复与物理清理由 memoryMutate 门控。
    case 'dsh-memory/records-retired': {
      const p = (payload ?? {}) as { limit?: unknown; offset?: unknown };
      const limit = Math.min(Math.max(Math.floor(Number(p.limit)) || 50, 1), 200);
      const offset = Math.min(Math.max(Math.floor(Number(p.offset)) || 0, 0), 1_000_000);
      const { items, total } = stores.l1.listRetired({ limit, offset });
      const resp: RecordsRetiredResponse = {
        items: items.map((r) => {
          const mark = readSupersedeMarker(r.metadata);
          const view = hitToUiRecord(r) as RetiredRecordView;
          return {
            ...view,
            // 标记缺失时退回 `valid_to`(软删的两条判据任一成立即算已退场)
            retiredAt: mark?.at ?? (r.validTo !== undefined ? new Date(r.validTo).toISOString() : ''),
            retiredReason: mark?.reason ?? 'unknown',
            ...(mark?.verdict ? { verdict: mark.verdict } : {}),
            ...(mark?.by ? { supersededBy: mark.by } : {}),
          };
        }),
        total,
      };
      return resp;
    }

    case 'dsh-memory/records-restore': {
      if (!live?.get().memoryMutate) {
        throw new Error('记忆写删未开放:请在记忆库面板开启高权限模式');
      }
      const p = (payload ?? {}) as { ids?: unknown };
      const ids = (Array.isArray(p.ids) ? p.ids : [])
        .filter((x): x is string => typeof x === 'string' && x !== '')
        .slice(0, 200);
      if (ids.length === 0) throw new Error('ids 缺失');
      const r = await stores.l1.restore(ids);
      deps.logger.info(`[memory] 恢复已退场记忆 ${r.restored} 条(补向量 ${r.vectorsWritten} 条)`);
      const resp: RecordsRestoreResponse = r;
      return resp;
    }

    case 'dsh-memory/cleanup-retired': {
      if (!live?.get().memoryMutate) {
        throw new Error('记忆写删未开放:请在记忆库面板开启高权限模式');
      }
      const p = (payload ?? {}) as { ids?: unknown; dryRun?: unknown };
      // **默认干跑**:省略 `dryRun` 即视为 true。物理删除是本插件唯一不可逆的动作,
      // 必须由调用方显式要求才做(与"所有破坏性动作必须默认可回滚"同一条纪律)。
      const dryRun = p.dryRun !== false;
      const explicit = (Array.isArray(p.ids) ? p.ids : [])
        .filter((x): x is string => typeof x === 'string' && x !== '')
        .slice(0, 500);
      let targets: string[];
      if (explicit.length > 0) {
        // 显式 id 也要**复核**是否真的处于已退场态:防止调用方用一个 id 列表
        // 把活动记忆绕过软删直接物理抹掉(那等于给了一条硬删后门)。
        targets = explicit.filter((id) => stores.l1.getByIds([id]).some((r) => r.validTo !== undefined));
      } else {
        targets = [];
        for (let offset = 0; ; offset += 200) {
          const page = stores.l1.listRetired({ limit: 200, offset });
          targets.push(...page.items.map((r) => r.id));
          if (page.items.length < 200) break;
        }
      }
      if (dryRun) {
        const resp: CleanupRetiredResponse = {
          dryRun: true,
          targets: targets.length,
          purged: 0,
          aborted: false,
          dir: '',
          name: '',
          diffs: [],
        };
        return resp;
      }
      if (targets.length === 0) {
        const resp: CleanupRetiredResponse = { dryRun: false, targets: 0, purged: 0, aborted: false, dir: '', name: '', diffs: [] };
        return resp;
      }
      const r = await stores.l1.purgeRetired(targets, 'cleanup-retired');
      const resp: CleanupRetiredResponse = {
        dryRun: false,
        targets: targets.length,
        purged: r.purged,
        aborted: r.aborted,
        dir: r.dir,
        name: r.name,
        diffs: r.diffs,
      };
      return resp;
    }

    // ── 快照(清单 / 回灌):`cleanup-retired` 与「重建」的**回程票** ──
    // 在此之前 `restoreL1Snapshot` 只有测试调用:导出物会落盘,却没有任何出口能
    // 装回去 —— "清理是本插件唯一不可逆的动作"这句话因此只成立了一半。
    // 读方向(列表)不开权限门(看得见才知道要不要恢复);回灌由 memoryMutate 门控。
    case 'dsh-memory/snapshots-list': {
      const p = (payload ?? {}) as { limit?: unknown };
      const raw = Math.floor(Number(p.limit));
      const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 200) : 50;
      const { items, total } = await stores.l1.listSnapshots({ limit });
      const resp: SnapshotsListResponse = { items, total };
      return resp;
    }

    case 'dsh-memory/snapshot-restore': {
      if (!live?.get().memoryMutate) {
        throw new Error('记忆写删未开放:请在记忆库面板开启高权限模式');
      }
      const p = (payload ?? {}) as { name?: unknown; ids?: unknown; dryRun?: unknown; unretire?: unknown };
      const name = typeof p.name === 'string' ? p.name.trim() : '';
      if (!name) throw new Error('需要 name(快照目录名,见 dsh-memory/snapshots-list)');
      // 只收名字、不收路径:恢复入口若接受任意路径,就等于顺带给这条 RPC 开放了
      // "读任意目录并把内容写进检索库"的能力。非法名一律拒绝而不是静默返零。
      if (!isSnapshotName(name)) {
        throw new Error('name 非法:只接受快照目录名(形如 l1-<时间戳>-<原因>),不接受路径');
      }
      // **默认干跑**:省略 `dryRun` 即视为 true(与 cleanup-retired 同一条纪律)。
      const dryRun = p.dryRun !== false;
      const unretire = p.unretire === true;
      const ids = (Array.isArray(p.ids) ? p.ids : [])
        .filter((x): x is string => typeof x === 'string' && x !== '')
        .slice(0, 2000);
      if (dryRun) {
        const plan = await stores.l1.planSnapshotRestore(name, ids);
        const resp: SnapshotRestoreResponse = {
          name,
          dir: plan.dir,
          dryRun: true,
          inSnapshot: plan.inSnapshot,
          targets: plan.targets,
          missing: plan.missing,
          restored: 0,
          failed: 0,
          vectorsWritten: 0,
          unretired: 0,
          stillRetired: unretire ? [] : plan.stillRetired,
          notFound: plan.notFound,
          ...(plan.found ? {} : { notice: `找不到快照 ${name}:snapshots/ 下没有同名目录,或它的 manifest.json 缺失/版本不符` }),
        };
        return resp;
      }
      const r = await stores.l1.restoreFromSnapshot(name, { ids, unretire });
      if (!r.found) {
        const resp: SnapshotRestoreResponse = {
          name,
          dir: '',
          dryRun: false,
          inSnapshot: 0,
          targets: 0,
          missing: 0,
          restored: 0,
          failed: 0,
          vectorsWritten: 0,
          unretired: 0,
          stillRetired: [],
          notFound: [],
          notice: `找不到快照 ${name}:snapshots/ 下没有同名目录,或它的 manifest.json 缺失/版本不符`,
        };
        return resp;
      }
      deps.logger.info(
        `[memory] 快照恢复 ${name}:写回 ${r.restored} 条(补向量 ${r.vectorsWritten} 条,失败 ${r.failed} 条,放回检索面 ${r.unretired} 条)`,
      );
      const resp: SnapshotRestoreResponse = {
        name,
        dir: r.dir,
        dryRun: false,
        inSnapshot: r.inSnapshot,
        targets: r.targets,
        missing: r.missing,
        restored: r.restored,
        failed: r.failed,
        vectorsWritten: r.vectorsWritten,
        unretired: r.unretired,
        stillRetired: r.stillRetired,
        notFound: r.notFound,
        // 写回主表 ≠ 回到检索面:清理快照里的记录都带退场标记,不明说会让人以为
        // "恢复完了"而记忆其实仍不可见。这是本次接线最容易漏掉的一跳。
        ...(r.stillRetired.length > 0
          ? {
              notice:
                `已写回主表,但其中 ${r.stillRetired.length} 条仍处于退场态、不会出现在召回里` +
                `(清理只清理已退场记录,快照拍在删除之前)。要放回检索面:` +
                `再调 dsh-memory/records-restore(或本次改用 unretire:true)。`,
            }
          : {}),
      };
      return resp;
    }

    // ── 知识图谱(面板图谱视图;graph 未装配时返空不报错) ──
    case 'dsh-memory/graph-search': {
      const p = (payload ?? {}) as { query?: string; limit?: number };
      const query = typeof p.query === 'string' ? p.query : '';
      if (query.length > 4096) throw new Error('query 过长(≤4096 字符)');
      const limit = Math.min(Math.max(Math.floor(Number(p.limit)) || 8, 1), 20);
      const graph = stores.graph;
      if (!graph) return { items: [] };
      const hits = graph.searchNodes(query, limit);
      return {
        items: hits.map((h) => ({
          node: h.node,
          score: Math.round(h.score * 100) / 100,
          matchedFields: h.matchedFields,
          matchReason: h.matchReason,
        })),
      };
    }

    case 'dsh-memory/graph-node-get': {
      const p = (payload ?? {}) as { id?: string };
      const id = typeof p.id === 'string' ? p.id : '';
      if (!id || id.length > 200) throw new Error('id 缺失或过长(≤200 字符)');
      const graph = stores.graph;
      if (!graph) return { node: null, edges: [] };
      // 悬挂 id(已归档/不存在)不解析:node=null,调用方展示"节点不存在"
      const node = graph.getNode(id);
      if (!node) return { node: null, edges: [] };
      return { node, edges: graph.edgesOf(id) };
    }

    case 'dsh-memory/scenes': {
      // 两族拼接展示(浏览器保持混合视图;路径冲突时后写入的族覆盖显示名,读取仍各自独立)
      const items: ScenesResponse['items'] = [];
      for (const family of ['chat', 'work'] as const) {
        const summaries = await stores.scenes[family].list();
        for (const s of summaries) {
          items.push({ path: s.path, family, summary: s.summary, updated: s.updated, heat: s.heat, content: (await stores.scenes[family].read(s.path)) ?? '' });
        }
      }
      items.sort((a, b) => (a.updated < b.updated ? 1 : -1));
      return { items };
    }

    case 'dsh-memory/persona': {
      const [chat, work] = await Promise.all([stores.persona.chat.read(), stores.persona.work.read()]);
      const parts: string[] = [];
      if (chat) parts.push(`<!-- family: chat -->\n${chat}`);
      if (work) parts.push(`<!-- family: work -->\n${work}`);
      return { content: parts.join('\n\n---\n\n') };
    }

    case 'dsh-memory/log-tail': {
      const p = (payload ?? {}) as { lines?: number };
      return { lines: readLogTail(join(dataDir, 'memory.log'), Math.min(Math.max(Number(p.lines) || 200, 1), 1000)) };
    }

    case 'dsh-memory/trace-tail': {
      // §F 追踪尾读:未初始化(trace.enabled=false)回空集;坏行已在 store 侧跳过
      const p = (payload ?? {}) as { lines?: number; kind?: 'recall_turn' | 'distill_run' };
      const store = getTraceStore();
      const events = store ? await store.tail(Math.min(Math.max(Number(p.lines) || 100, 1), 500), p.kind) : [];
      return { events };
    }

    case 'dsh-memory/rebuild-status': {
      if (!rebuild) {
        const v: RebuildStatusResponse = { supported: false, running: false, phase: 'idle' };
        return v;
      }
      return rebuild.getStatus();
    }

    case 'dsh-memory/rebuild-start': {
      if (!rebuild) throw new Error('重建控制器未初始化(存储不可用)');
      if (status?.degraded()) throw new Error('存储处于降级状态,无法重建');
      const s = live?.get();
      if (s && (!s.enabled || !s.distill)) throw new Error('蒸馏开关已关闭,请先开启蒸馏再重建');
      if (!cfg.extract.enabled) throw new Error('部署配置已停用蒸馏(extract.enabled=false),无法重建');
      const result = rebuild.start();
      deps.logger.info('[memory] 收到重建指令(设置页按钮)');
      return result;
    }

    case 'dsh-memory/rebuild-cancel': {
      if (!rebuild) throw new Error('重建控制器未初始化');
      return rebuild.requestCancel();
    }

    // ── 反刍(记忆消化:按需消化未蒸馏缓冲) ──
    case 'dsh-memory/ruminate-status': {
      if (!ruminate) {
        const v: RuminateStatusResponse = { supported: false, running: false, phase: 'idle' };
        return v;
      }
      return ruminate.getStatus();
    }

    case 'dsh-memory/ruminate-start': {
      if (!ruminate) throw new Error('反刍控制器未初始化(存储不可用)');
      if (status?.degraded()) throw new Error('存储处于降级状态,无法反刍');
      const s = live?.get();
      if (s && (!s.enabled || !s.distill)) throw new Error('蒸馏开关已关闭,请先开启蒸馏再反刍');
      if (!cfg.extract.enabled) throw new Error('部署配置已停用蒸馏(extract.enabled=false),无法反刍');
      const result = await ruminate.start();
      deps.logger.info('[memory] 收到反刍指令(设置页按钮)');
      return result;
    }

    case 'dsh-memory/ruminate-cancel': {
      if (!ruminate) throw new Error('反刍控制器未初始化');
      return ruminate.requestCancel();
    }

    // ── 蒸馏模型选择器(用户已配置的供应商路由) ──
    case 'dsh-memory/llm-providers': {
      // 供应商目录(已注册适配器的活动路由)+ 默认选择 + 当前覆盖与实际生效路由
      // ——蒸馏路由链编辑器的数据源(供应商下拉/默认模型展示/链状态 chain 块)
      let providers: Array<{ id: string; name: string }> = [];
      try {
        providers = deps.ctx.llm.listProviders();
      } catch (err) {
        deps.logger.warn(`[memory] 供应商列表读取失败: ${errDetail(err)}`);
      }
      let def: { provider: string; model: string } | null = null;
      try {
        const sel = deps.ctx.get('agentDefaultModel')?.currentSelection?.();
        if (sel?.provider && sel?.model) def = { provider: sel.provider, model: sel.model };
      } catch {
        /* 可选服务缺失 = 无默认选择 */
      }
      const s = live?.get();
      const current = { provider: s?.distillProvider ?? '', model: s?.distillModel ?? '' };
      // 统一路由链块:current = 运行时链(含旧键投影);static = 部署静态回退链;
      // effective = buildRouteChain 语义的实际链(主路由 + 有效条目去重,每条带档位候选);
      // source 标记当前链来自运行时还是部署静态(UI 的跟随态/接管态判定)
      const chainCurrent = projectDistillChain(s);
      let effectiveChain: Array<{ provider: string; model: string; effort: string }> = [];
      let effective: { provider: string; model: string } | null;
      let cfgView = cfg;
      try {
        cfgView = effectiveCfg(cfg, live);
        effective = await resolveModelRoute(deps.ctx, cfgView);
        effectiveChain = buildRouteChain(
          { provider: effective.provider, model: effective.model, effort: cfgView.llm.primaryEffort || '' },
          cfgView.llm.fallbacks,
          cfgView.llm.reasoningEffort,
        );
      } catch {
        effective = null; // 无法解析(无默认选择且未覆盖)时 UI 显示占位
      }
      const pinned = Boolean(cfg.llm.provider && cfg.llm.model);
      // 蒸馏通道视图(direct 解耦编辑器数据源):runtime = settings 覆盖档('' = 跟随
      // 部署);effective = effectiveCfg 注入后的实际档;endpoint/密钥只回显非机密部分
      // (apiKey 明文不回传,只给布尔);directReady 供 UI 在 effective=direct 时提示
      // "未配置全(baseURL/model)"
      const cfgChannel = cfgView.llm;
      const effectiveMode: 'host' | 'direct' = cfgChannel.mode === 'direct' ? 'direct' : 'host';
      const deployedMode: 'host' | 'direct' = cfg.llm.mode === 'direct' ? 'direct' : 'host';
      const effBase = (s?.directBaseURL || cfg.llm.baseURL || '').trim();
      const effModel = (cfgChannel.model || cfg.llm.model || '').trim();
      const channel: DirectChannelView = {
        runtime: s?.distillMode === 'host' || s?.distillMode === 'direct' ? s.distillMode : '',
        effective: effectiveMode,
        runtimeBaseURL: s?.directBaseURL ?? '',
        deployedBaseURL: cfg.llm.baseURL ?? '',
        deployed: deployedMode,
        runtimeApiKeySet: Boolean(s?.directApiKey),
        deployedApiKeySet: Boolean(cfg.llm.apiKey),
        directReady: effectiveMode === 'direct' ? effBase !== '' && effModel !== '' : true,
      };
      // 按层层链视图:与解析真值同径(layerChainOrNull 吃 effectiveCfg 之后的 cfgView,
      // pinned 时运行时层链未注入、静态层链胜出;跟随层直接复用全局 effectiveChain)
      const mkLayerView = (key: 'l1' | 'l2' | 'l3'): LayerChainView => {
        const rt = s?.distillLayerChains?.[key] ?? [];
        const lr = layerChainOrNull(cfgView, key);
        const rtLive = !pinned && rt.length > 0 && !!rt[0].provider && !!rt[0].model;
        return {
          runtime: rt,
          static: cfg.llm.layerRoutes?.[key] ?? [],
          effectiveChain: lr ?? effectiveChain,
          source: rtLive ? 'runtime' : lr ? 'static' : 'global',
        };
      };
      const resp: LlmProvidersResponse = {
        supported: true,
        providers,
        default: def,
        // 部署静态 pin(provider+model 双字段)优先于运行时选择,UI 据此禁用选择器
        pinned,
        current,
        // 所选供应商是否仍在已注册路由中(用户删掉供应商后提示回退)
        currentRegistered: current.provider === '' || providers.some((p) => p.id === current.provider),
        effective,
        chain: {
          current: chainCurrent,
          static: cfg.llm.fallbacks ?? [],
          effectiveChain,
          source: chainCurrent.length ? ('runtime' as const) : ('static' as const),
        },
        // 按层层链:source 三态与解析真值同径(layerChainOrNull)——pinned 下
        // 运行时层链不生效(与 effectiveCfg 注入条件一致),存量照实返回供 UI 展示
        layerChains: {
          l1: mkLayerView('l1'),
          l2: mkLayerView('l2'),
          l3: mkLayerView('l3'),
        },
        channel,
      };
      return resp;
    }

    case 'dsh-memory/llm-models': {
      const p = (payload ?? {}) as { provider?: string };
      if (typeof p.provider !== 'string' || !p.provider) throw new Error('provider 缺失');
      if (p.provider.length > 200) throw new Error('provider 过长(≤200 字符)');
      // 内置适配器的 listModels 都读本地快照不触网;仍加超时兜底,
      // 防第三方适配器实现为远端查询拖死 RPC 轮询
      const models = await Promise.race([
        deps.ctx.llm.listModels(p.provider),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('模型列表查询超时')), 8000)),
      ]);
      // 每个模型附思考档位能力表(resolveModelInfo 复用 effortCache,本地快照不触网):
      // 统一路由链编辑器的逐行档位下拉数据源。整体限时限流,超时降级空表
      const baseModels = models.map((m) => ({ id: m.id, name: m.name, description: m.description ?? null, efforts: [] as string[] }));
      const providerId = p.provider;
      const withEfforts = await Promise.race([
        (async (): Promise<ModelWithEfforts[]> => {
          const out: ModelWithEfforts[] = [];
          for (const m of models) {
            let efforts: string[];
            try {
              efforts = (await resolveModelEfforts(deps.ctx, providerId, m.id))?.efforts ?? [];
            } catch {
              efforts = [];
            }
            out.push({ id: m.id, name: m.name, description: m.description ?? null, efforts });
          }
          return out;
        })(),
        new Promise<ModelWithEfforts[]>((resolve) => setTimeout(() => resolve(baseModels), 4000)),
      ]);
      const resp: LlmModelsResponse = { provider: p.provider, models: withEfforts };
      return resp;
    }

    // ── 嵌入源(远程/本地/关闭 三态)与模型管理 ──
    case 'dsh-memory/embedding-state-get': {
      if (!embedManager) {
        const v: EmbeddingStateResponse = { supported: false };
        return v;
      }
      const v: EmbeddingStateResponse = { supported: true, ...(await embedManager.snapshot()) };
      return v;
    }

    case 'dsh-memory/embedding-source-set': {
      if (!embedManager) throw new Error('嵌入管理器未初始化(存储不可用)');
      const p = (payload ?? {}) as { source?: string; activeModel?: string | null };
      if (p.source !== 'remote' && p.source !== 'local' && p.source !== 'off') {
        throw new Error('source 必须是 remote | local | off');
      }
      if (typeof p.activeModel === 'string' && p.activeModel.length > 200) {
        throw new Error('activeModel 过长(≤200 字符)');
      }
      const r = embedManager.requestSource({ source: p.source, activeModel: p.activeModel ?? null });
      if (!r.accepted) throw new Error(r.error ?? '切换请求被拒绝');
      deps.logger.info(`[memory] 收到嵌入源切换指令(source=${p.source}${p.activeModel ? ',model=' + p.activeModel : ''})`);
      return { accepted: true };
    }

    case 'dsh-memory/embedding-download-start': {
      if (!embedManager) throw new Error('嵌入管理器未初始化(存储不可用)');
      const p = (payload ?? {}) as { modelId?: string };
      if (typeof p.modelId !== 'string' || !p.modelId) throw new Error('modelId 缺失');
      const r = embedManager.startDownload(p.modelId);
      if (!r.ok) throw new Error(r.error ?? '下载请求被拒绝');
      deps.logger.info(`[memory] 收到模型下载指令(${p.modelId})`);
      return { accepted: true };
    }

    case 'dsh-memory/embedding-download-cancel': {
      if (!embedManager) throw new Error('嵌入管理器未初始化');
      return { cancelled: embedManager.cancelDownload() };
    }

    case 'dsh-memory/embedding-model-delete': {
      if (!embedManager) throw new Error('嵌入管理器未初始化');
      const p = (payload ?? {}) as { modelId?: string };
      if (typeof p.modelId !== 'string' || !p.modelId) throw new Error('modelId 缺失');
      return embedManager.deleteModel(p.modelId);
    }

    case 'dsh-memory/embedding-runtime-cancel': {
      if (!embedManager) throw new Error('嵌入管理器未初始化');
      return { cancelled: embedManager.cancelRuntimeInstall() };
    }

    case 'dsh-memory/embedding-reindex': {
      // 手动触发重建(契约:`EmbeddingReindexStartResponse`,受理即返回,进度照旧轮询
      // embedding-state-get 的 reindex 字段)。此前只登记了 -cancel:start 既不在白名单
      // 也没有 case,于是 startReindex() 成了够不着的死代码,端点在面板上静默 404
      // (契约门禁 tests/contract-keys.test.ts 早已为此标红)。
      // 拒绝语义交给 startReindex 自己抛(已卸载/在跑/切源占锁/源未就绪),不在端点层复述。
      if (!embedManager) throw new Error('嵌入管理器未初始化(存储不可用)');
      const r = embedManager.startReindex();
      deps.logger.info('[memory] 收到嵌入重建指令(设置页按钮)');
      return r;
    }

    case 'dsh-memory/embedding-reindex-cancel': {
      if (!embedManager) throw new Error('嵌入管理器未初始化');
      return { cancelled: embedManager.cancelReindex() };
    }

    default:
      throw new Error(`unknown endpoint: ${endpoint}`);
  }
}

/** 浏览器卡片字段(比 MemoryRecord 精简,去掉大 metadata;Hall 从 metadata 提取)。 */
/** 老化权重(与读路径 applyDecayWeight 同式):max(0.5, 0.5^(Δ天/半衰期));半衰期 ≤0 = 关 → null。 */
export function agingWeightOf(updatedAtMs: number | undefined, halfLifeDays: number, now: number = Date.now()): number | null {
  if (!(halfLifeDays > 0)) return null;
  const ageDays = Math.max(0, (now - (updatedAtMs ?? 0)) / 86_400_000);
  return Math.max(0.5, Math.pow(0.5, ageDays / halfLifeDays));
}

export function hitToUiRecord(
  r: {
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
  usage?: { attempts: number; used: number; lastAttemptAt: number | null; lastUsedAt: number | null } | null;
  /** 人给的相关度均值(0..5);未打分 = 不传(字段缺席,不是 0)。 */
  userRelevance?: number | null;
  /** 人给的**最近一笔**打分(-1..5);成熟度只吃这一笔,不吃均值。 */
  userMark?: number | null;
}): UiRecord {
  const retired = r.validTo !== undefined;
  const mark = retired ? readSupersedeMarker(r.metadata) : undefined;
  return {
    id: r.id,
    content: r.content,
    type: r.type,
    priority: r.priority ?? 60,
    scene: r.scene_name,
    family: (r.family as MemoryFamily | undefined) ?? null,
    hall: r.metadata && typeof r.metadata.hall === 'string' ? r.metadata.hall : null,
    timestamps: (r.timestamps ?? []).map((t) => new Date(t).toISOString()),
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
    updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
    version: r.version ?? 0,
    // R7 来源锚点:契约字段是**标签数组**(`t12 s3`),由 metadata 的保留键读出。
    // 此前这里仍在填已废弃的 `sourceMessageIds`——`l1_records` 从不存那一列,
    // 该字段恒为 `[]`(死字段),而契约早已换成 `sourceAnchors`,于是
    // `sourceAnchors` 永远缺失、来源行在 UI 上从未显示过。
    sourceAnchors: sourceAnchorLabels(r.metadata),
    score: r.score ?? null,
    // 退场态透传:活动列表据此渲染「已退场」徽标 + 行内恢复,而非让记录静默停留在
    // 原样(那样用户会以为「点了删除没反应」)。面板浏览路径**仍列出**退场记录(软删可恢复),
    // 但必须给出可见差异。
    retired,
    retiredReason: retired ? (mark?.reason ?? 'unknown') : null,
    agingWeight: extra?.agingWeight ?? null,
    usage: extra?.usage ?? null,
    // G3 成熟度：读时派生（priority + used + 老化 + 人工最近一笔），无额外端点/存储。
    maturity: computeMaturity({
      priority: r.priority ?? 60,
      usage: extra?.usage ?? null,
      agingWeight: extra?.agingWeight ?? null,
      mark: extra?.userMark ?? null,
    }),
    // G1 使用场景：从命名空间保留键读出（功能关/无键 → undefined）。
    usageScenario: Array.isArray(r.metadata?.dsh_usage_scenario) ? (r.metadata?.dsh_usage_scenario as string[]) : undefined,
    // 人给相关度均值：读时从 sidecar 派生（不进存储/快照）；未打分 → 字段缺席。
    userRelevance: extra?.userRelevance ?? undefined,
  };
}

/**
 * 从文件尾反向分块读取最后 N 行:不整读全文件(轮转上限 2MB,整读会
 * 阻塞事件循环数毫秒)。原始 Buffer 拼接后再解码——分块边界可能切在
 * UTF-8 多字节字符中间,先 toString 再拼接会产生乱码替换符。
 */
function readLogTail(logPath: string, maxLines: number): string[] {
  let fd: number | undefined;
  try {
    fd = openSync(logPath, 'r');
    const { size } = statSync(logPath);
    const CHUNK = 64 * 1024;
    const bufs: Buffer[] = [];
    let newlines = 0;
    let pos = size;
    while (pos > 0) {
      const read = Math.min(CHUNK, pos);
      pos -= read;
      const buf = Buffer.alloc(read);
      readSync(fd, buf, 0, read, pos);
      bufs.unshift(buf);
      // \n 是完整单字节,绝不会出现在 UTF-8 续字节里——按字节计数跨块安全
      for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) newlines++;
      if (newlines > maxLines) break;
    }
    const lines = Buffer.concat(bufs).toString('utf8').split('\n').filter((l) => l.length > 0);
    return lines.slice(-maxLines);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}
