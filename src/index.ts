/**
 * dsh-memory-plugin — L0~L3 分层蒸馏记忆插件(持久组合插件)。
 *
 * 装配职责:数据目录与文件日志 → live 开关 → 会话档位 → 嵌入源三态解析 →
 * 检索引擎(memory.db)与分族存储 → 蒸馏 runner/重建控制器 → 捕获/召回钩子 →
 * 工具/RPC/bench 控制面 → 停机顺序。
 *
 * 存储架构(JSONL 事实源 + memory.db 主检索):见 README 与 store 层模块注释。
 * 降级铁律:存储初始化失败只停用捕获/蒸馏,绝不拖垮宿主启动。
 */
import * as path from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { memorySchema, resolveDataDir, type MemoryConfig } from './config.js';
import { registerBenchControl } from './bench-control.js';
import { registerCapture } from './hooks/capture.js';
import { registerRecall } from './hooks/recall.js';
import { SessionRecalledStore } from './store/session-recalled.js';
import { MemoryRunner } from './pipeline/runner.js';
import { RebuildController } from './pipeline/rebuild.js';
import { RuminateController } from './pipeline/ruminate.js';
import { registerMemoryRpc, PLUGIN_VERSION } from './stats.js';
import { registerLiveSettings, suppressAutoSettingsForm } from './settings.js';
import { NoopEmbeddingService, type EmbeddingProviderInfo } from './store/embedding.js';
import {
  EmbeddingManager,
  EmbeddingSourceStore,
  makeLocalServiceFactory,
  resolveInitialEmbedding,
  type InitialEmbedding,
} from './store/embedding-source.js';
import { ModelDownloadQueue } from './store/download-queue.js';
import { PINNED_TRANSFORMERS_VERSION, RuntimeInstaller } from './store/runtime-installer.js';
import { cleanupOrphanTmp, ensureDir } from './util/io.js';
import { L0Store } from './store/l0.js';
import { L1Store, type GraphLaneProvider } from './store/l1.js';
import { PersonaStore } from './store/persona.js';
import { MemoryDb, type StoreInitResult } from './store/sqlite.js';
import { InProcMemoryBackend, type MemoryBackend } from './store/memory-backend.js';
import { createMemoryBackend } from './store/memory-backend-worker.js';
import { SceneStore } from './store/scenes.js';
import { SessionModeStore } from './store/session-modes.js';
import { StateStore } from './store/state.js';
import { SlotStore } from './store/slots.js';
import { RouteHealthStore, routeHealthPathFor } from './store/route-health.js';
import { registerMemoryTools } from './tools/index.js';
import { registerSlotTools } from './tools/slots.js';
import { registerSlotRecall } from './hooks/slot-recall.js';
import { registerObsoleteNotice } from './hooks/obsolete-notice.js';
import { RoomRegistryStore } from './store/rooms-registry.js';
import { MemorySourceStore } from './store/memory-sources.js';
import { SkillStore } from './store/skill-store.js';
import { registerSkillRecall } from './hooks/skill-recall.js';
import { registerSkillTools } from './tools/skills.js';
import { RecallUsageStore } from './store/recall-usage.js';
import { RecallFeedbackStore } from './store/recall-feedback.js';
import { MdLedgerStore } from './store/memory-md-ledger.js';
import { makeFileSyncHook } from './store/memory-md-sync.js';
import { ObsoleteNoticeStore } from './store/obsolete-notices.js';
import { registerSlotsProjection } from './projection/slots.js';
import { registerRecallProjection } from './projection/recall.js';
import { DrscClient } from './clients/drsc.js';
import type { MemoryLogger } from './types.js';
import { errDetail, withFileLog } from './util/filelog.js';
import { buildRouteChain, resolveModelRoute, invalidateEffortCache } from './llm.js';
import { effectiveCfg } from './pipeline/runner.js';
import { pendingPathFor } from './store/pending.js';
import { initTokenCost, resetTokenCost } from './token-cost.js';
import { initTraceStore } from './store/trace.js';

export const name = 'dsh-memory-plugin';

/**
 * webStartup(0.2.1-a.2 起更名自 webRuntime)的 best-effort 读取:trustedHosts
 * 供 DrscClient 同源基址解析。宿主服务缺席/未声明 inject 时属性读会抛
 * (cordis Proxy 面),双名回退链 + 两层 try,安全返回 undefined(→ 缺省 8080 口)。
 */
function readStartupTrustedHosts(ctx: Context): readonly string[] | undefined {
  for (const name of ['webStartup', 'webRuntime'] as const) {
    try {
      const direct = (ctx as unknown as Record<string, unknown>)[name];
      const svc = (direct !== undefined
        ? direct
        : typeof ctx.get === 'function'
          ? ctx.get(name)
          : undefined) as { trustedHosts?: unknown } | undefined;
      if (svc !== null && typeof svc === 'object' && Array.isArray(svc.trustedHosts)) {
        return svc.trustedHosts as readonly string[];
      }
    } catch {
      /* 未声明服务的属性读抛:落下一名/缺省 */
    }
  }
  return undefined;
}

/**
 * 硬依赖:蒸馏要用 llm,工具注册要用 tools,召回注入要用 systemPrompt。
 * 0.1.5 起 connection.rpc.handle() 把 /rpc 路由登记到 webServer 时按**调用方
 * fiber** 校验 inject 授权(0.1.1/0.1.2 由 connection 服务自己持有 webServer,
 * 调用方无需声明)——缺失即 `cannot get property "webServer" without inject`
 * 致命失败。故声明 connection + webServer;两者在 0.1.1~0.1.5 均存在,
 * 额外授权在旧版无害(声明式注入只会等这两个服务就绪,不改装配顺序)。
 */
export const inject = ['llm', 'tools', 'systemPrompt', 'connection', 'webServer'];

/**
 * 插件配置 schema。导出名必须是 `Config`——cordis 运行时只读 plugin.Config
 * (Standard Schema 接口)做校验与默认值填充;导出 `schema` 会被静默忽略,
 * 导致 config 里嵌套对象为 undefined、apply 抛错、fiber FAILED 拖垮宿主启动。
 */
export const Config = memorySchema;

export async function apply(ctx: Context, config: MemoryConfig): Promise<void> {
  let logger: MemoryLogger = {
    debug: (m) => ctx.logger.debug(m),
    info: (m) => ctx.logger.info(m),
    warn: (m) => ctx.logger.warn(m),
    error: (m) => ctx.logger.error(m),
  };

  const dataDir = resolveDataDir(config);
  // dsh 宿主无持久化日志,镜像 info+ 到数据目录 memory.log 供蒸馏问题诊断
  const fileLogger = withFileLog(dataDir, logger);
  logger = fileLogger;

  // 供应商拓扑变化(增删/改配置)→ 思考档位能力缓存失效,下次调用重新探询
  ctx.on('llm/adapters-updated', () => invalidateEffortCache());

  // 存储初始化失败只降级(禁用捕获/蒸馏),绝不拖垮宿主——
  // 记忆是增强能力,数据目录不可写时 dsh 本体必须照常启动。
  let storageOk = true;
  try {
    await ensureDir(dataDir);
  } catch (err) {
    storageOk = false;
    logger.error(
      `[memory] 数据目录不可写,记忆功能停用: ${dataDir} (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  // 孤儿 tmp 扫描:进程被 kill -9 / 断电时原子写会留下 tmp(写失败路径已 unlink,
  // 只在硬中断下残留)。放在 store 载入之前——此刻还没有任何写者,清不掉"正在写"的文件。
  // 清理失败绝不影响启动(残留 tmp 不参与任何读路径)。
  if (storageOk) {
    try {
      await cleanupOrphanTmp(dataDir, logger);
    } catch (err) {
      logger.warn(
        `[memory] 孤儿临时文件扫描失败(忽略): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── 记忆模式运行时开关(0.1.7 声明式:Config 的 live volatile 节;缺失时恒开) ──
  const live = registerLiveSettings(ctx, config, logger);
  // 自带自定义设置页(client 半 settings.section「记忆」分节)→ 关掉宿主按
  // volatile 字段自动生成的表单页,避免同一插件出现两份设置入口。
  suppressAutoSettingsForm(ctx);

  /** 插件停机标志:置位后不再发起后台 embeddings 调用(dispose 序最先设置)。 */
  let disposed = false;

  // ── 会话档位存储(sessionId → auto/chat/work/off;默认档 = config.family) ──
  const modes = new SessionModeStore(dataDir, config.family, logger);
  if (storageOk) {
    try {
      await modes.init();
    } catch (err) {
      logger.warn(`[memory] 会话档位载入失败(降级为默认档内存态): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── 嵌入源三态(远程/本地/关闭)——状态文件优先于静态配置 ──
  const sourceStore = new EmbeddingSourceStore(dataDir, logger);
  const installer = new RuntimeInstaller(dataDir, PINNED_TRANSFORMERS_VERSION, { logger });
  const downloader = new ModelDownloadQueue(dataDir, {
    mirror: config.embedding.mirror,
    logger,
    proxy: config.embedding.proxy,
  });
  const makeLocalService = makeLocalServiceFactory(installer, downloader, logger, config.embedding.maxInputChars);
  let initial: InitialEmbedding = { svc: new NoopEmbeddingService(), dims: 0 };
  /** 管理器引用:启动重嵌链/backfill 闭包在运行期解引用(声明早于创建避免 TDZ)。 */
  // eslint-disable-next-line prefer-const -- 声明早于创建,后续单点赋值(TS 不允许 const 无初值)
  let embedManagerRef: EmbeddingManager | undefined;
  if (storageOk) {
    try {
      await sourceStore.init();
      initial = await resolveInitialEmbedding(config, sourceStore, downloader, makeLocalService, logger);
    } catch (err) {
      logger.warn(`[memory] 嵌入源初始解析失败(降级纯 FTS): ${errDetail(err)}`);
    }
  }
  /** meta 写入永远用当前目标(杜绝启动期闭包里的陈旧 providerInfo 腐蚀 embedding_meta)。 */
  const currentProviderInfo = (): EmbeddingProviderInfo | undefined =>
    embedManagerRef?.currentProviderInfo() ?? initial.providerInfo;

  // ── 检索引擎(memory.db)与向量服务 ──
  const embed = initial.svc;
  const db = new MemoryDb(path.join(dataDir, 'memory.db'), initial.dims, logger);
  initTokenCost(db, config.tokenCost.retentionDays);
  // §F 追踪(trace.enabled=false 时保持未初始化,埋点零副作用)
  if (config.trace?.enabled) initTraceStore(dataDir, { retentionDays: config.trace.retentionDays });
  // 插件卸载时关闭连接(WAL 落盘),注册一次即可
  ctx.effect(() => () => db.close());

  let dbInit: StoreInitResult = { needsReindex: false };
  if (storageOk) {
    try {
      dbInit = db.init(initial.providerInfo);
      if (db.isDegraded()) {
        storageOk = false;
        logger.error('[memory] 检索库初始化失败(schema/FTS 不可用),记忆功能停用');
      }
    } catch (err) {
      storageOk = false;
      logger.error(
        `[memory] 检索库打开失败,记忆功能停用: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // §D 第 3 路装配(回链 + 路内向量种子 + 1-hop,见 graph-store.searchLaneRecords):
  // embed 查询惰性接 stores.l1.embedText(嵌入源运行时活切换不被钉死在启动 service 上,
  // 且复用其超时/失败吞并语义——未就绪/失败 = undefined = 纯词法路,与旧 searchNodes
  // 表达式逐位一致)。图谱不可用时 searchLaneRecords 自带空返回,不影响双路。
  // eslint-disable-next-line prefer-const -- 声明早于创建,后续单点赋值(与 embedManagerRef 同款惰性缝;TS 不允许 const 无初值)
  let laneEmbedQuery: ((q: string) => Promise<Float32Array | undefined>) | undefined;
  const graphLaneProvider: GraphLaneProvider = async (query, limit, family) => {
    const vec = laneEmbedQuery ? await laneEmbedQuery(query).catch(() => undefined) : undefined;
    return db.graphStore.searchLaneRecords(query, vec, limit, family ? [family] : undefined);
  };

  const stores = {
    usage: undefined as RecallUsageStore | undefined, // 装配于下方(依赖 dataDir 就绪)
    routeHealth: undefined as RouteHealthStore | undefined, // R9 路由健康学习，装配于下方
    // DRSC 客户端(T8.4 读切):蒸馏背景窗 + conversation_search 工具面的历史供给。
    // 硬依赖无本地回退(l0 表退役);trustedHosts 惰性读取(webStartup 可能晚到)。
    drsc: new DrscClient({ trustedHosts: () => readStartupTrustedHosts(ctx) }),
    l0: new L0Store(db),
    l1: new L1Store(
      dataDir,
      db,
      embed,
      config.recall.strategy,
      logger,
      config.recall.decayHalfLifeDays,
      // §D 第 3 路:图谱回链(声明于 stores 之前,embed 查询在下方接线)。
      graphLaneProvider,
      // 投射开着才给没名字的新记录起名（“关时零动作”这条承诺不改）。
      // 传函数而不是布尔：读的是当前配置对象，不把启动那一刻的值钉进 store。
      () => config.memExport?.enabled === true,
    ),
    // L2/L3 分族隔离:各自目录与文件(scenes/chat|work、persona-chat|work.md)
    scenes: {
      chat: new SceneStore(dataDir, 'chat', logger),
      work: new SceneStore(dataDir, 'work', logger),
    },
    persona: {
      chat: new PersonaStore(dataDir, 'chat', logger),
      work: new PersonaStore(dataDir, 'work', logger),
    },
    state: new StateStore(StateStore.pathFor(dataDir), logger),
    // 会话“活召回集”（G-live）：sessionKey → 本会话已注入未压缩的记录 id；持久化，旧会话重开载回。
    recalled: new SessionRecalledStore(dataDir, logger),
    // 召回相关度反馈与过时播报队列（装配于下方，需 await init）。
    feedback: undefined as RecallFeedbackStore | undefined,
    notices: undefined as ObsoleteNoticeStore | undefined,
    // md 投射指纹账本（N9；装配于下方，需 await init）。
    mdLedger: undefined as MdLedgerStore | undefined,
    // 激活槽位(active slot):独立 slots.json,高频小改不拖累 checkpoint 原子写
    slots: new SlotStore(
      SlotStore.pathFor(dataDir),
      logger,
      {
        maxSlots: config.slots.maxSlots,
        maxBodyChars: config.slots.maxBodyChars,
        maxTitleChars: 60,
      },
    ),
    // 图谱存储(MemoryDb 内自治:初始化失败仅图谱 no-op,不影响主链路)
    graph: db.graphStore,
    // 后台记忆后端:初始化完成后填充(worker 隔离,失败则进程内)
    backend: undefined as MemoryBackend | undefined,
  };
  // 惰性缝接线:provider 在检索时才解引用(l1 已就绪);声明序上的"先声明后赋值"
  // 只影响装配期,而装配期不会有检索在飞(启动未完就没有 agent 回合)。
  laneEmbedQuery = (q) => stores.l1.embedText(q);
  if (storageOk) {
    try {
      await Promise.all([
        stores.l1.init(),
        stores.scenes.chat.init(),
        stores.scenes.work.init(),
        stores.persona.chat.init(),
        stores.persona.work.init(),
        stores.slots.load(),
      ]);
    } catch (err) {
      storageOk = false;
      logger.error(
        `[memory] 存储初始化失败,记忆功能停用: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 检索能力与策略说明(能力位由降级结果决定)
  const caps = db.getCapabilities();
  if (storageOk && config.recall.strategy !== 'keyword' && !caps.vectorSearch) {
    logger.warn(
      `[memory] 检索策略 ${config.recall.strategy} 需要向量能力(embedding 未启用/不可用),本次运行按 keyword(FTS5 BM25)检索`,
    );
  }
  logger.info(
    `[memory] 数据目录: ${dataDir}(v${PLUGIN_VERSION},默认档=${config.family},检索: FTS=${caps.ftsSearch} 向量=${caps.vectorSearch}${storageOk ? '' : ',存储不可用已停用捕获/蒸馏'})`,
  );
  // 蒸馏模型路由:启动期解析一次并记录(路由错误是最难事后排查的问题之一);
  // 用运行时调参视图解析——用户已用 UI 覆盖蒸馏模型时,日志反映实际路由
  try {
    const cfgView = effectiveCfg(config, live);
    const route = await resolveModelRoute(ctx, cfgView);
    // 链长度按同一解析口径计(相同条目会被去重),排障时无需 --dump-config 即可确认回退链生效
    const chain = buildRouteChain(route, cfgView.llm.fallbacks, cfgView.llm.reasoningEffort);
    logger.info(
      `[memory] 蒸馏模型路由: ${route.provider}/${route.model}${chain.length > 1 ? `(+${chain.length - 1} 回退)` : ''}`,
    );
  } catch (err) {
    logger.warn(`[memory] 蒸馏模型路由解析失败: ${errDetail(err)}`);
  }

  // embedding 配置变化 → 后台全量重嵌入(不阻塞启动)。
  // meta 标记条件 = 失败为 0 且缺失复查为 0(服务未就绪的空转不算成功)。
  if (storageOk && initial.providerInfo && !db.isDegraded()) {
    const info = initial.providerInfo;
    if (dbInit.needsReindex) {
      if (caps.vectorSearch) {
        void (async () => {
          try {
            if (disposed || embedManagerRef?.isBusy()) return;
            // 增量:配置变化路径向量表已被 drop,全部记录均"缺失",等效全量;
            // 活切换发起时让路(swap 会 drop 表,并发跑只是白烧嵌入调用)
            const shouldCancel = () => disposed || !!embedManagerRef?.isBusy();
            // T8.4:l0 向量腿随写停退役(表清空后无缺失,无需重建)
            const r1 = await stores.l1.reindex({ shouldCancel });
            // missing 复查:嵌入服务未就绪时 reindex 短路 0/0/0——那是"没跑"不是"成功",
            // 不得标记 meta(否则启动链不再补,补齐被无限推迟到 backfill)
            const missingAfter = db.countL1VecMissing(db.getVecSkipSet('l1'));
            if (r1.failed === 0 && missingAfter === 0) {
              db.markEmbeddingSynced(currentProviderInfo() ?? info);
              const skipNote = r1.skipped > 0 ? `,跳过不可嵌入 ${r1.skipped} 条` : '';
              logger.info(
                `[memory] 向量重建完成:L1 ${r1.written} 条${skipNote}(原因:${dbInit.reason ?? '配置变化'})`,
              );
            } else {
              logger.warn(
                `[memory] 向量重建未完成(L1 失败 ${r1.failed},剩缺 ${Math.max(missingAfter, 0)} 条),下次启动/补齐周期重试`,
              );
            }
          } catch (err) {
            logger.warn(`[memory] 向量重建失败: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            embedManagerRef?.invalidateVecCache();
          }
        })();
      }
    } else {
      // meta 已匹配或空库(initSchema 已写入),幂等重写一次
      db.markEmbeddingSynced(currentProviderInfo() ?? info);
    }

    // 周期性向量补齐:嵌入失败的批次/漏网记录自动补上(30 分钟一次)。
    // 判据 = 排除 skip 集后的缺失数(增量语义):缺 1 条只补 1 条,
    // 零向量记录进 skip 集后不再触发——否则补齐永不收敛、每 30 分钟全量重嵌。
    // 注册不依赖启动期 caps/providerInfo(off 起步后活切回旧源也要能补),
    // 执行期动态查当前目标与能力位。
    {
      const backfill = (): void => {
        void (async () => {
          try {
            if (disposed) return;
            const infoNow = currentProviderInfo();
            const capsNow = db.getCapabilities();
            if (!infoNow || !capsNow.vectorSearch) return;
            // 活切换链(安装/下载/重嵌)进行中让路——增量 reindex 天然幂等,
            // 但并发跑只是白烧一次嵌入调用
            if (embedManagerRef?.isBusy()) return;
            const l1Missing = db.countL1VecMissing(db.getVecSkipSet('l1')) > 0;
            if (!l1Missing) return;
            const shouldCancel = () => disposed || !!embedManagerRef?.isBusy();
            // T8.4:l0 向量腿随写停退役
            const r1 = await stores.l1.reindex({ shouldCancel });
            const missingAfter = db.countL1VecMissing(db.getVecSkipSet('l1'));
            if (r1.failed === 0 && missingAfter === 0) {
              db.markEmbeddingSynced(infoNow);
              logger.info(
                `[memory] 向量补齐完成:L1 ${r1.written} 条(跳过不可嵌入 ${r1.skipped} 条)`,
              );
            } else if (r1.failed > 0) {
              logger.warn(`[memory] 向量补齐未完成(L1 失败 ${r1.failed}),下个周期重试`);
            }
          } catch (err) {
            logger.warn(`[memory] 向量补齐失败: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            // 补齐走了 store 层写路径,管理器的计数缓存拿不到回调 → 显式失效
            embedManagerRef?.invalidateVecCache();
          }
        })();
      };
      ctx.effect(() => {
        const timer = setInterval(backfill, 30 * 60_000);
        const first = setTimeout(backfill, 60_000);
        return () => {
          clearInterval(timer);
          clearTimeout(first);
        };
      });
    }
  }

  // 嵌入管理器(活切换/下载/运行时安装;存储降级时不建——RPC 走 supported=false)
  const embedManager =
    storageOk && !db.isDegraded()
      ? new EmbeddingManager({
          dataDir,
          cfg: config,
          db,
          l1: stores.l1,
          sourceStore,
          installer,
          downloader,
          initial,
          logger,
          makeLocal: makeLocalService,
        })
      : undefined;
  embedManagerRef = embedManager;

  const runner = new MemoryRunner(ctx, config, stores, logger, live, modes);
  await runner.init();
  // 档位切换同步(ADR-0003):切走按捕获档位落袋 / 切 off 挂起 / 切回清挂起
  modes.setModeChangeHandler((sessionId, oldMode, newMode) => runner.onModeChange(sessionId, oldMode, newMode));
  // 闲置兜底:静默达标会话的未蒸馏切片自动落袋(idleSeconds=0 关闭)
  runner.startIdleTimer();
  // 图谱周期补投影(cfg.graph.enabled 门控;30 分钟一次低速收敛)
  runner.startGraphBackfillTimer();
  // 时效标注存量回填(expiry-tiering task_6.3:tieringEnabled 门控,低频、让位蒸馏)
  runner.startValidityBackfillTimer();

  // 重建控制器(存储降级时不建——RPC 端点走 supported=false 分支)
  const rebuild =
    storageOk && !db.isDegraded()
      ? new RebuildController(ctx, config, stores, db, runner, logger, live)
      : undefined;

  // 反刍控制器(与重建共用数据,但更轻量;存储降级时不建)
  const ruminateFile = storageOk ? pendingPathFor(resolveDataDir(config)) : '';

  // 后台记忆后端:优先 worker 线程隔离(后台批处理的同步 SQL 不再占主事件循环),
  // 起不来就退回进程内(功能不受影响,只留一条 warn)。
  let backend: MemoryBackend = new InProcMemoryBackend(stores.l1);
  if (storageOk && !db.isDegraded()) {
    backend = await createMemoryBackend(
      { dbPath: path.join(dataDir, 'memory.db'), dimensions: initial.dims, logger },
      backend,
    );
  }
  stores.backend = backend;

  // Room 注册表(分类管理 beta.4;损坏降级为纯自生长目录)
  const roomRegistry = new RoomRegistryStore(dataDir, logger);
  await roomRegistry.init();
  // 外部记忆来源注册表（轨3 Connect；默认由 cfg.memport.enabled 关门控，sidecar 本身无条件加载）
  const memorySources = new MemorySourceStore(dataDir, logger);
  await memorySources.init();
  // 技能存储（轨2；sidecar 无条件加载，但工具/注入均由 cfg.skills.enabled 默认关自 no-op）
  const skillStore = new SkillStore(dataDir, logger);
  await skillStore.init();
  const ruminate =
    storageOk && !db.isDegraded() && ruminateFile
      ? new RuminateController(ctx, config, runner, stores, logger, live, ruminateFile, roomRegistry)
      : undefined;

  let flushL0: (() => Promise<void>) | undefined;
  if (storageOk) {
    flushL0 = registerCapture(ctx, config, runner, db.l0Watermark, logger, live, modes);
  }
  // 召回使用统计(进 topN 才算 used;热路径只碰内存,去抖落盘)
  const recallUsage = new RecallUsageStore(dataDir, logger);
  await recallUsage.init();
  stores.usage = recallUsage;
  // R9 路由健康学习：跨进程留存"退避后跑通的最小块长"，供 runExtraction 收紧 perChunk。
  const routeHealth = new RouteHealthStore(routeHealthPathFor(dataDir));
  await routeHealth.load();
  stores.routeHealth = routeHealth;
  // 召回相关度反馈（人在召回卡上打 -1..5）与「已声明过时」待播报队列。
  // 两个都是低频用户动作 → 立即落盘；sidecar 缺席/损坏只降级为只读，不阻断任何读路径。
  const recallFeedback = new RecallFeedbackStore(dataDir, logger);
  await recallFeedback.init();
  stores.feedback = recallFeedback;
  const obsoleteNotices = new ObsoleteNoticeStore(dataDir, logger);
  await obsoleteNotices.init();
  stores.notices = obsoleteNotices;
  // md 投射指纹账本（N9）：派生态，缺席/损坏只降级为只读，不弄挂任何读路径。
  // 它与 feedback/notices 同属“库外 sidecar”，不进快照哈希投影。
  const mdLedger = new MdLedgerStore(dataDir, logger);
  await mdLedger.init();
  stores.mdLedger = mdLedger;
  // 库→文件投射的跟随钩子：**收口在 `L1Store` 的四个汇流口**（appendNew / retire / restore / rename），
  // 不在这里往调用方分发。不变式本体在 `store/memory-md-sync.ts`。
  // 为什么只能装配层建：工具面/冲突裁决各自看不到 cfg + ledger + dataDir 的完整视野。
  const fileSync = makeFileSyncHook({
    getByIds: (list) => stores.l1.getByIds([...list]),
    // 现读生效配置（volatile 热更后不必重启）：与 RPC 分发用同一个 `effectiveCfg` 口径。
    exportCfg: () => {
      const exp = effectiveCfg(config, live).memExport;
      return {
        enabled: exp?.enabled === true,
        root: exp?.root,
        maxRecords: exp?.maxRecords ?? 2000,
        timeBudgetMs: exp?.timeBudgetMs ?? 120_000,
      };
    },
    dataDir,
    ledger: () => stores.mdLedger,
    logger,
  });
  // 晚绑定：`stores.l1` 在 md 账本之前就建好了，这里只把钩子接上去。
  stores.l1.setFileSyncHook(fileSync);
  const recall = registerRecall(ctx, config, stores, logger, live, modes, dataDir, recallUsage);
  runner.setAfterRun(recall.invalidateProfile);
  const toolSeals = registerMemoryTools(ctx, config, stores, logger, modes, live, ruminate, storageOk ? roomRegistry : undefined, {
    // 确定性写面钩子(graph-write-plane R2/R3):runner 公开方法直连,工具三路径与
    // distill 分支共用同一个入队实现,不存在第二套优先级/去重逻辑。
    enqueueGraph: (ids) => runner.enqueueGraphFor(ids),
    reprojectGraph: (ids) => runner.reprojectGraph(ids),
  });
  // 激活槽位(active slot):工具面 + 常驻注入 + 服务端投影(均走 ctx.effect,可撤销)
  registerSlotTools(ctx, config, stores.slots, logger, modes, live, stores.l1);
  const slotRecall = registerSlotRecall(ctx, config, stores.slots, logger, live);
  // 轨2 技能：工具面经宿主封印机制(seals)登记，与常驻注入分离（默认关时自 no-op，零表面积）。
  registerSkillTools(ctx, skillStore, logger, live, toolSeals);
  registerSkillRecall(ctx, config, skillStore, logger, live);
  // memorySlots 投影：常驻槽位（手动 pin 的约定）的展示契约，消费方是 dsh-brief-sidebar。
  // 宿主契约（dsh-session-projection/lib/index.js）：插件不注册时 key 从快照消失、
  // 客户端读作 capability absence（不会毒化历史加载），所以“摘注册”技术上可行；
  // 但那是把跨插件展示契约直接抽掉，旧版 brief-sidebar 会默默丢分区——隐藏请走它自己的
  // 「记忆槽位分区」开关。本包另提供一个会话感知的 memoryRecall 投影。
  registerSlotsProjection(ctx, stores.slots, stores.l1);
  // memoryRecall 投影：本会话“已注入且未被压缩覆盖”的召回集（会话感知，init 取 header.id），
  // 与常驻槽位是两条轴：那个是手动 pin 的硬注入约定，这个是非常驻的相关性浮现结果。
  // 带上反馈面：条目要显示人已经打过的那一笔（rating）。
  registerRecallProjection(ctx, stores.recalled, stores.l1, recallFeedback);
  // 人打 -1 声明过时后，下一轮向模型一次性播报“这条已退场、别再依据它作答”。
  registerObsoleteNotice(ctx, config, obsoleteNotices, logger);
  void slotRecall;
  registerMemoryRpc(
    ctx,
    config,
    stores,
    logger,
    {
      degraded: () => !storageOk || db.isDegraded(),
      pending: () => runner.pendingCount,
    },
    live,
    modes,
    dataDir,
    rebuild,
    embedManager,
    // 悬浮卡信息区数据源(session-stats 热路径端点;全部内存读 + 索引 COUNT,零文件 I/O)
    {
      recallStats: (sid) => recall.stats(sid),
      memoryOccupancy: (sid) => recall.occupancy(sid),
      profileEstimate: (sid) => recall.estimateProfileTokens(sid),
      recallEstimate: (sid) => recall.estimateRecallTokens(sid),
      runnerView: (sid, mode) => runner.sessionView(sid, mode),
      l0Count: (sid) => stores.l0.countBySession(sid),
      capabilities: () => db.getCapabilities(),
    },
    ruminate,
    storageOk ? roomRegistry : undefined,
    storageOk ? memorySources : undefined,
    skillStore,
  );

  // bench 控制服务(config.benchControl 门控,默认关):仅基准/调试部署注册,
  // 供同进程的 bench-runner lifecycle 赛道触发 rebuild / 设置会话档位
  // (宿主侧 RPC 无 call(),见 bench-control.ts)
  if (config.benchControl && rebuild) {
    const disposeBench = registerBenchControl(ctx, rebuild, modes, logger);
    ctx.effect(() => () => disposeBench());
  }

  logger.info(
    `[memory] L0~L3 分层蒸馏记忆插件就绪(L1 记忆 ${storageOk ? stores.l1.size : 0} 条 | 捕获=${
      storageOk && config.capture.enabled
    } | 蒸馏=${storageOk && config.extract.enabled} | 召回=${config.recall.enabled})`,
  );

  // 停机顺序:置停机标志(后台 embeddings 不再发起)→ 停蒸馏取新任务 →
  // 冲刷 L0 串行链(排队消息先落盘)→ 关库。cordis disposer 为 LIFO 逐个 await,
  // 本 effect 晚注册故先执行;apply 中途失败时由上方早注册的 db.close 兜底(双关安全)。
  ctx.effect(() => () => {
    disposed = true;
    runner.stop();
    embedManager?.dispose();
    downloader.dispose();
    // 后台记忆后端:worker 实现要 terminate 线程,否则宿主关不掉(process 挂住)。
    // 必须在 db.close() **之前**——worker 还持有自己的连接。
    void stores.backend?.dispose();
    return (async () => {
      await flushL0?.();
      db.close();
      db.graphStore.close();
      resetTokenCost();
    })();
  });
}
