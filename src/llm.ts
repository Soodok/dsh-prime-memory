/**
 * LLM 桥:用 DSH 自身的 llm 服务跑蒸馏调用。
 *
 * 职责:蒸馏路由链(全局回退链 + 按层层链)、思考档位能力决策(跨供应商 effort
 * 兼容)、分层输出预算(思考档 ×4 防线)、direct 原生 HTTP 通道、流式调用与
 * 失败诊断、容错 JSON 解析。回退语义见 ADR-0004/0005。
 */
import type { Context } from '@deepseek-ai/cordis';
// 纯类型导入:拉入 dsh-agent-default-model 的 Context.agentDefaultModel 声明合并。
import type {} from '@deepseek-ai/dsh-agent-default-model';
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { MemoryConfig } from './config.js';
import type { MemoryLogger } from './types.js';
import { errDetail } from './util/filelog.js';
import { parseJsonTolerant } from './util/json-repair.js';
import { recordDistillCall, type DistillLayer } from './llm-usage.js';
import { recordCostCall } from './token-cost.js';

export interface LlmCallOptions {
  system: string;
  user: string;
  /** 蒸馏层标签(用量记账用;四层调用点都应传)。 */
  layer?: DistillLayer;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /**
   * **调用级思考档位覆盖**（可选）。非空时优先于路由/层链/全局解析出的档位。
   *
   * 为什么需要：回填批扫（整形/关键词/wing/room）是「重排 + 拎标识」的直答任务，
   * 不需要推理；而思考模型默认开思考，会把整个 maxTokens 预算烧在 reasoning 上、
   * 正文吐 0 字符（真机：156/162 次 `llm empty output` 都是这么来的）。
   * 显式传 `off` 后预算全留给答案。档位仍过一遍模型能力钳制：模型不支持 off 时不传。
   */
  reasoningEffort?: string;
  /** 诊断日志(缺失时静默,不影响调用) */
  logger?: MemoryLogger;
}

// ── 分层输出预算(规格 C 节):结构化蒸馏用不到总闸级预算,逐层设护栏;
//    模型跑偏时单次损失有界。数值"先试跑"状态,按线上截断率调整。
/** L1 抽取(大输入块的 JSON 记忆数组输出)。 */
export const LAYER_MAX_TOKENS_EXTRACT = 16_000;
/** L1 去重(合并决策数组,输出比抽取短)。 */
export const LAYER_MAX_TOKENS_DEDUP = 8_000;
/** L2 场景整合(完整场景 Markdown 文件输出,输出最重的层)。 */
export const LAYER_MAX_TOKENS_L2 = 32_000;
/** L3 画像(完整 persona 文档)。 */
export const LAYER_MAX_TOKENS_L3 = 16_000;
/** 图谱投影(节点/边提案 JSON;单批 ≤8 条记录,输出比 L1 抽取短)。 */
export const LAYER_MAX_TOKENS_GRAPH = 8_000;

/** 分层输出预算键(契约单一事实源在 src/contract.ts)。 */
import type { DistillBudgetLayer, LayerRouteKey, StaticFallbackEntry } from './contract.js';
export type { DistillBudgetLayer } from './contract.js';

/** 各层内置默认预算(设置页"0 = 跟随默认"的默认值来源)。 */
export const LAYER_DEFAULT_BUDGETS: Record<DistillBudgetLayer, number> = {
  extract: LAYER_MAX_TOKENS_EXTRACT,
  dedup: LAYER_MAX_TOKENS_DEDUP,
  l2: LAYER_MAX_TOKENS_L2,
  l3: LAYER_MAX_TOKENS_L3,
  graph: LAYER_MAX_TOKENS_GRAPH,
};

/** resolveLayerTokens/layerEffortTrigger 需要的最小 cfg 视图(决策表用窄对象即可构造)。 */
export interface LayerRouteCfgView {
  llm: {
    reasoningEffort: string;
    primaryEffort?: string;
    layerRoutes?: Partial<Record<LayerRouteKey, StaticFallbackEntry[]>>;
    layerChainsRuntime?: Partial<Record<LayerRouteKey, StaticFallbackEntry[]>>;
    budgets?: Partial<Record<DistillBudgetLayer, number>>;
  };
}

/**
 * 解析某蒸馏层的生效输出预算:运行时覆盖(cfg.llm.budgets,0/缺省 = 跟随)
 * → 内置默认 → 思考档放大(high/xhigh/max ×4,reasoning 计入输出预算的历史事故
 * 防线)。放大触发档位跟层走:层链头档位候选 > 全局主路由档位候选;
 * graph 层无层链(不落 l1 路由),恒走全局候选。
 */
export function resolveLayerTokens(cfg: LayerRouteCfgView, layer: DistillBudgetLayer): number {
  const override = cfg.llm.budgets?.[layer];
  const key: LayerRouteKey | null = layer === 'l2' ? 'l2' : layer === 'l3' ? 'l3' : layer === 'graph' ? null : 'l1';
  return layerMaxTokens(override && override > 0 ? override : LAYER_DEFAULT_BUDGETS[layer], layerEffortTrigger(cfg, key));
}

/**
 * 高思考档集合(输出预算 ×4 的档位):阶段侧 layerMaxTokens 与 callLLM 的
 * 自动档防线共用同一张表——勿再在别处抄写该列表。
 */
export const HIGH_EFFORT_TIERS = ['high', 'xhigh', 'max'] as const;

/**
 * 思考档预算放大:reasoning 计入输出预算(v4-flash 事故:high 思考可吃光全部
 * 预算致正文 0 字符)——effort 为 high/xhigh/max 时分层预算 ×4。
 */
export function layerMaxTokens(base: number, reasoningEffort: string): number {
  return (HIGH_EFFORT_TIERS as readonly string[]).includes(reasoningEffort) ? base * 4 : base;
}

/** 解析蒸馏用的 provider/model:配置优先,其次当前默认选择。 */
export async function resolveModelRoute(
  ctx: Context,
  cfg: MemoryConfig,
): Promise<{ provider: string; model: string }> {
  if (cfg.llm.provider && cfg.llm.model) {
    return { provider: cfg.llm.provider, model: cfg.llm.model };
  }
  // agentDefaultModel 是可选服务,缺失时不得抛错。
  const defaults = ctx.get('agentDefaultModel');
  const sel = defaults?.currentSelection?.();
  if (sel?.provider && sel?.model) {
    return { provider: cfg.llm.provider || sel.provider, model: cfg.llm.model || sel.model };
  }
  throw new Error(
    '无法解析蒸馏模型路由:请在插件 config 中配置 llm.provider / llm.model,或确保存在默认模型选择',
  );
}

// ── 蒸馏回退链(ADR-0004)──
// 主路由失败(error/aborted finish、网络异常、空输出)按 llm.fallbacks 顺序降级,
// 每条路由各享全额 timeoutMs;调用方主动取消不降级;全部失败抛最后一个错误,
// 由 runner 的按会话指数退避接管重试节奏。

/** 回退链条目(配置形态;reasoningEffort 为该路由的档位覆盖,'' = 跟随全局)。 */
export interface FallbackRouteEntry {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

/** 链上单条路由(档位候选已解析:条目非空 > 全局静态;发送前仍过能力钳制)。 */
export interface DistillRoute {
  provider: string;
  model: string;
  effort: string;
}

/**
 * 组装蒸馏路由链(纯决策,决策表缝):主路由在前、回退条目按配置顺序在后。
 * provider/model 缺失的条目剔除;与主路由或先前条目完全相同(provider+model)的
 * 条目跳过——注定失败的重复尝试不值得占位。每条路由携带生效档位候选:
 * 主路由可带显式档位(运行时统一链注入 primaryEffort),条目档位非空覆盖全局。
 */
export function buildRouteChain(
  primary: { provider: string; model: string; effort?: string },
  fallbacks: FallbackRouteEntry[] | undefined,
  globalEffort: string,
): DistillRoute[] {
  const routes: DistillRoute[] = [{ ...primary, effort: primary.effort || globalEffort }];
  const seen = new Set([`${primary.provider}::${primary.model}`]);
  for (const f of fallbacks ?? []) {
    if (!f.provider || !f.model) continue;
    const key = `${f.provider}::${f.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ provider: f.provider, model: f.model, effort: f.reasoningEffort || globalEffort });
  }
  return routes;
}

// ── 按层独立路由(ADR-0005):层内三级 运行时层链 > 静态层链 > 全局解析 ──
// 层链非空即完整替换该层解析(该层主路由与回退都归层链管,全局链对该层不参与);
// 档位是全局偏好轴:层链空档位条目/头行仍回退全局档位。pin 只废运行时侧
// (effectiveCfg 不注入),静态层链天然穿透。

/**
 * DistillLayer(调用点五键)→ 路由层键(三键):l1-extract/l1-dedup 同属 l1;
 * graph 无层路由键——返回 null,调用侧按"该层无层链"回全局解析,绝不落入 l1
 * (图谱投影误用 L1 抽取链是路由配置错误,静默错路由最难排查)。
 */
export function layerKeyFor(layer: DistillLayer): LayerRouteKey | null {
  return layer === 'l2' ? 'l2' : layer === 'l3' ? 'l3' : layer === 'graph' ? null : 'l1';
}

/**
 * 取某层的生效层链(运行时优先)。头行残缺(provider/model 缺失——手写 YAML 错误
 * 或防御性解析后的空链头)视为该层未配置、回退全局解析:路由配置错误不致该层
 * 蒸馏失产,与回退链"条目缺失剔除"同一防御姿态。
 */
function layerChainOf(cfg: LayerRouteCfgView, key: LayerRouteKey): StaticFallbackEntry[] | undefined {
  const rt = cfg.llm.layerChainsRuntime?.[key];
  if (rt?.length && rt[0].provider && rt[0].model) return rt;
  const st = cfg.llm.layerRoutes?.[key];
  if (st?.length && st[0].provider && st[0].model) return st;
  return undefined;
}

/** 该层的预算放大触发档位:层链头档位候选 > 全局主路由档位候选(primaryEffort > 静态全局)。
 *  key=null(graph 层无层链)→ 恒走全局候选。 */
export function layerEffortTrigger(cfg: LayerRouteCfgView, key: LayerRouteKey | null): string {
  const chain = key ? layerChainOf(cfg, key) : undefined;
  return chain
    ? chain[0].reasoningEffort || cfg.llm.primaryEffort || cfg.llm.reasoningEffort
    : cfg.llm.primaryEffort || cfg.llm.reasoningEffort;
}

/**
 * 解析某次蒸馏调用的实际路由链(callLLM 入口):有层标签且该层配了层链 → 层链
 * 完整替换(buildRouteChain 复用:头行在前、条目去重、档位三级候选);否则现行
 * 全局解析。layer 缺省(bench/测试缝)= 全局解析。
 */
export async function resolveLayerRoutes(ctx: Context, cfg: MemoryConfig, layer?: DistillLayer): Promise<DistillRoute[]> {
  const key = layer ? layerKeyFor(layer) : undefined;
  const lr = key ? layerChainOrNull(cfg, key) : null;
  if (lr) return lr;
  const primary = await resolveModelRoute(ctx, cfg);
  return buildRouteChain(
    // 主路由显式档位来自运行时统一链(primaryEffort,'' = 跟随全局静态)
    { provider: primary.provider, model: primary.model, effort: cfg.llm.primaryEffort || '' },
    cfg.llm.fallbacks,
    cfg.llm.reasoningEffort,
  );
}

/** 层链解析的同步半边(llm-providers 视图与 resolveLayerRoutes 共用一条真值路径):
 *  该层配了有效层链 → 完整链;null = 该层跟随全局解析。 */
export function layerChainOrNull(cfg: LayerRouteCfgView, key: LayerRouteKey): DistillRoute[] | null {
  const chain = layerChainOf(cfg, key);
  if (!chain) return null;
  return buildRouteChain(
    { provider: chain[0].provider, model: chain[0].model, effort: chain[0].reasoningEffort || '' },
    chain.slice(1),
    cfg.llm.reasoningEffort,
  );
}

/** 单路由持续失败的一次性告警去重表(拓扑变化随能力缓存一起失效)。 */
const routeDeadWarned = new Set<string>();

function warnRouteDeadOnce(route: DistillRoute, logger?: MemoryLogger): void {
  if (!logger) return;
  const key = `${route.provider}::${route.model}`;
  if (routeDeadWarned.has(key)) return;
  routeDeadWarned.add(key);
  logger.warn(
    `[memory] 蒸馏路由 ${route.provider}/${route.model} 失败(每路由仅告警一次;逐次失败原因与降级去向见后续日志)`,
  );
}

// ── 思考档位能力探询(跨供应商 effort 兼容)──
// dsh-llm 契约对不支持的显式档位不做 clamp/aliasing:pi-ai 本地抛
// UNSUPPORTED_REASONING_EFFORT,openai-responses 网关则把 'off' 等值透传上游吃 400。
// 因此发送前按模型实际能力决策;resolveModelInfo 是 advisory 查询(读本地快照不触网),
// 结果按 (provider, model) 缓存,拓扑变化(llm/adapters-updated)时统一失效。
export interface ModelEffortInfo {
  /** 模型可设置的思考档位 id(适配器声明;空 = 未声明/不可设置) */
  efforts: string[];
  /** 适配器配置的默认档位(省略 effort 时的请求值) */
  defaultEffort?: string;
}

const effortCache = new Map<string, ModelEffortInfo>();

/** 清空能力缓存(llm/adapters-updated 时调用:供应商增删/改配置后重新探询)。 */
export function invalidateEffortCache(): void {
  effortCache.clear();
  contextWindowCache.clear();
  effortWarned.clear();
  routeDeadWarned.clear();
}

/** 探询某模型的思考档位能力;失败返回 null(调用方保持旧发送行为,不改判)。 */
export async function resolveModelEfforts(
  ctx: Context,
  provider: string,
  model: string,
): Promise<ModelEffortInfo | null> {
  const key = `${provider}::${model}`;
  const hit = effortCache.get(key);
  if (hit) return hit;
  try {
    if (typeof ctx.llm?.resolveModelInfo !== 'function') return null;
    const info = await ctx.llm.resolveModelInfo(provider, model);
    const efforts = (info.reasoning?.efforts ?? [])
      .map((e) => String(e.id))
      .filter((id) => id.length > 0);
    const cap: ModelEffortInfo = {
      efforts,
      ...(info.reasoning?.defaultEffort ? { defaultEffort: String(info.reasoning.defaultEffort) } : {}),
    };
    effortCache.set(key, cap);
    return cap;
  } catch {
    return null; // 不缓存失败:路由尚未注册等瞬时态,下次调用重试
  }
}

/** (provider, model) → 上下文窗口 token 数;advisory,未声明/失败为 null。 */
const contextWindowCache = new Map<string, number | null>();

/**
 * 探询某模型的上下文窗口容量(adapter 声明的 provider-owned capacity)。
 * 与 effortCache 同源同失效策略;仅用于占用指示器的分母展示——分母必须与官方环
 * 同源(模型声明值),禁止 client 自估。
 */
export async function resolveModelContextWindow(
  ctx: Context,
  provider: string,
  model: string,
): Promise<number | null> {
  const key = `${provider}::${model}`;
  if (contextWindowCache.has(key)) return contextWindowCache.get(key) ?? null;
  try {
    if (typeof ctx.llm?.resolveModelInfo !== 'function') return null;
    const info = await ctx.llm.resolveModelInfo(provider, model);
    const win = info.context?.contextWindow;
    const val = typeof win === 'number' && Number.isFinite(win) && win > 0 ? Math.floor(win) : null;
    contextWindowCache.set(key, val);
    return val;
  } catch {
    return null; // 不缓存失败:下次调用重试
  }
}

export type EffortDecisionReason =
  | 'supported'        // 配置档位被模型支持,照发
  | 'auto-default'     // 空配置 → 模型默认档
  | 'auto-high'        // 空配置且无默认档 → high(用户规则)
  | 'alias-none'       // off 在 OpenAI 系词汇表里的等价物 none
  | 'unsupported'      // 模型声明了档位但不含配置值 → 不传
  | 'no-efforts'       // 模型未声明任何档位 → 不传
  | 'no-capability';   // 探不到能力(旧宿主/路由缺失)→ 保持旧行为照发

export interface EffortDecision {
  /** 实际发送的档位;'' = 不发送(跟随模型默认) */
  effort: string;
  reason: EffortDecisionReason;
}

/** 纯决策:配置档位 + 模型能力 → 实际发送值(callLLM 与 settings-get 共用)。 */
export function decideSendableEffort(cap: ModelEffortInfo | null, cfgEffort: string): EffortDecision {
  if (!cap) return { effort: cfgEffort, reason: 'no-capability' };
  if (cfgEffort) {
    if (cap.efforts.includes(cfgEffort)) return { effort: cfgEffort, reason: 'supported' };
    if (cfgEffort === 'off' && cap.efforts.includes('none')) return { effort: 'none', reason: 'alias-none' };
    if (cap.efforts.length === 0) return { effort: '', reason: 'no-efforts' };
    return { effort: '', reason: 'unsupported' };
  }
  // 空配置 = 自动:模型默认档 → 无默认取 high(未声明/无默认一律 high)→ 仍无则不传
  if (cap.defaultEffort && cap.efforts.includes(cap.defaultEffort)) {
    return { effort: cap.defaultEffort, reason: 'auto-default' };
  }
  if (cap.efforts.includes('high')) return { effort: 'high', reason: 'auto-high' };
  return { effort: '', reason: 'no-efforts' };
}

const effortWarned = new Set<string>();

/** 探询 + 决策 + 一次性告警(不支持/未声明时提示降级,不刷屏)。 */
export async function planDistillEffort(
  ctx: Context,
  provider: string,
  model: string,
  cfgEffort: string,
  logger?: MemoryLogger,
): Promise<EffortDecision> {
  const cap = await resolveModelEfforts(ctx, provider, model);
  const d = decideSendableEffort(cap, cfgEffort);
  if ((d.reason === 'unsupported' || d.reason === 'no-efforts') && logger) {
    const key = `${provider}::${model}::${cfgEffort}::${d.reason}`;
    if (!effortWarned.has(key)) {
      effortWarned.add(key);
      logger.warn(
        `[memory] 蒸馏思考档位 ${cfgEffort || '(auto)'} 不被 ${provider}/${model} 支持` +
          (d.reason === 'no-efforts'
            ? '(模型未声明思考档位)'
            : `(支持: ${cap?.efforts.join('/')})`) +
          ',本次调用不传档位(跟随模型默认)',
      );
    }
  }
  return d;
}

// ── 直接压缩通道(llm.mode='direct'):与付费供应商解耦 ──
// 插件原生 HTTP 直连 OpenAI 兼容 /chat/completions 端点(可指向本地 ollama、私有网关、
// 免费档等),不依赖宿主 provider 注册表。direct 失败自动回退宿主路由链
// (callLLM 内处理),本地端点故障不致压缩失产。

/** direct 通道是否就绪(baseURL 与 model 齐才算配置完整)。 */
function directReady(cfg: MemoryConfig): boolean {
  return !!cfg.llm.baseURL && !!cfg.llm.model;
}

/**
 * 插件原生 HTTP 的一次压缩调用(OpenAI 兼容)。非流式单请求回包,足够压缩场景;
 * 超时/网络/非 2xx/空输出均按失败抛错(交由 callLLM 回退宿主路由)。
 */
async function callDirect(cfg: MemoryConfig, opts: LlmCallOptions): Promise<string> {
  const model = cfg.llm.model;
  const base = cfg.llm.baseURL.replace(/\/+$/, '');
  const url = `${base}/chat/completions`;
  const layer = opts.layer;
  // 输入预算兜底(与宿主路径同口径:单次蒸馏用户 prompt 不超过 maxInputChars)
  const user =
    opts.user.length > cfg.llm.maxInputChars
      ? `${opts.user.slice(0, cfg.llm.maxInputChars)}\n\n[输入超出 ${cfg.llm.maxInputChars} 字符预算,已截断]`
      : opts.user;
  const signal = opts.signal ?? AbortSignal.timeout(cfg.llm.timeoutMs);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // 本地免 key 端点不设 Authorization 头;直连跨供应商不发送 reasoning_effort
  // (openai-completions 风格端点无统一 effort 词汇表,交给端点默认行为)
  if (cfg.llm.apiKey) headers.Authorization = `Bearer ${cfg.llm.apiKey}`;

  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: user },
        ],
        temperature: opts.temperature ?? cfg.llm.temperature,
        max_tokens: opts.maxTokens ?? cfg.llm.maxTokens,
      }),
    });
  } catch (err) {
    if (layer) recordDistillCall(layer, user.length, 0, 0, true);
    if (layer) recordCostCall('direct', model, layer, user.length, 0, 0);
    opts.logger?.warn(
      `[memory] direct 压缩调用网络失败 ${base}(${((Date.now() - startedAt) / 1000).toFixed(1)}s): ${errDetail(err)}`,
    );
    throw err;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    if (layer) recordDistillCall(layer, user.length, 0, 0, true);
    if (layer) recordCostCall('direct', model, layer, user.length, 0, 0);
    opts.logger?.warn(
      `[memory] direct 压缩端点 HTTP ${res.status}(${base}): ${detail.slice(0, 400)}`,
    );
    throw new Error(`direct ${res.status}: ${detail.slice(0, 400)}`);
  }
  let data: { choices?: Array<{ message?: { content?: string } }>; usage?: { completion_tokens?: number; output_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } };
  try {
    data = (await res.json()) as typeof data;
  } catch (err) {
    if (layer) recordDistillCall(layer, user.length, 0, 0, true);
    if (layer) recordCostCall('direct', model, layer, user.length, 0, 0);
    opts.logger?.warn(`[memory] direct 压缩端点 JSON 解析失败(${base}): ${errDetail(err)}`);
    throw err;
  }
  const outputTokens = data?.usage?.completion_tokens ?? data?.usage?.output_tokens ?? 0;
  const reasoningTokens =
    data?.usage?.completion_tokens_details?.reasoning_tokens ??
    (data?.usage && 'reasoning_tokens' in data.usage ? (data.usage as { reasoning_tokens?: number }).reasoning_tokens ?? 0 : 0);
  const out = (data?.choices?.[0]?.message?.content ?? '').trim();
  if (out.length === 0) {
    if (layer) recordDistillCall(layer, user.length, outputTokens, reasoningTokens, true);
    if (layer) recordCostCall('direct', model, layer, user.length, outputTokens, reasoningTokens);
    opts.logger?.warn(`[memory] direct 压缩空输出(${base}/${model},输出 tokens=${outputTokens})`);
    throw new Error(`direct empty output: ${base}/${model} 端点返回 0 字符`);
  }
  if (layer) recordDistillCall(layer, user.length, outputTokens, reasoningTokens, false);
  if (layer) recordCostCall('direct', model, layer, user.length, outputTokens, reasoningTokens);
  opts.logger?.info(
    `[memory] direct 压缩 ${base}/${model}:输入 ${user.length} 字符 → 输出 ${out.length} 字符(${((Date.now() - startedAt) / 1000).toFixed(1)}s)`,
  );
  return out;
}

/**
 * 一次完整蒸馏调用(带回退链,ADR-0004):按路由链(主路由 + llm.fallbacks)逐条
 * 尝试,返回首个成功路由的输出。失败(error/aborted finish、网络异常、空输出)
 * 降级下一条;调用方主动取消(signal 已中止)原样上抛不降级;全部失败抛最后一个
 * 错误,由调用方兜底(runner 的按会话指数退避接管重试节奏)。
 *
 * llm.mode='direct' 时压缩首选走插件原生 HTTP(callDirect)——与付费 API 解耦;
 * direct 失败(含未配置 baseURL/model)自动回退下方宿主路由链作兜底安全网。
 *
 * 文本只从 block-end(协议保证携带组装完成的整块)取;text-delta 仅在
 * 适配器异常地没有发 block-end 时兜底。两者都累计会把输出翻倍。
 */
export async function callLLM(ctx: Context, cfg: MemoryConfig, opts: LlmCallOptions): Promise<string> {
  let lastErr: unknown;
  // direct 通道(plugin-native HTTP):压缩首选,失败落 host 兜底。
  if (cfg.llm.mode === 'direct') {
    if (directReady(cfg)) {
      try {
        return await callDirect(cfg, opts);
      } catch (err) {
        // 调用方主动取消(重建取消/进程关闭)不是通道失败——不降级,原样上抛
        if (opts.signal?.aborted) throw err;
        lastErr = err;
        opts.logger?.warn(`[memory] direct 压缩失败,回退宿主路由(${errDetail(err)})`);
      }
    } else {
      opts.logger?.warn('[memory] llm.mode=direct 但未配置 llm.baseURL/llm.model,回退宿主路由');
    }
  }
  // 宿主路由链:opts.layer 配了层链的层走层链完整替换,其余走全局解析;
  // direct 模式下这一段充当付费/默认模型的兜底安全网。
  const routes = await resolveLayerRoutes(ctx, cfg, opts.layer);
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    try {
      return await callRoute(ctx, cfg, opts, route);
    } catch (err) {
      // 调用方主动取消不是路由失败——不降级,原样上抛
      if (opts.signal?.aborted) throw err;
      lastErr = err;
      warnRouteDeadOnce(route, opts.logger);
      const next = routes[i + 1];
      if (next) {
        opts.logger?.info(
          `[memory] 蒸馏路由降级 ${route.provider}/${route.model} → ${next.provider}/${next.model}(${errDetail(err)})`,
        );
      }
    }
  }
  throw lastErr;
}

/** 单路由一次尝试(callLLM 循环体;每路由新建超时信号 = 各享全额 timeoutMs)。 */
async function callRoute(ctx: Context, cfg: MemoryConfig, opts: LlmCallOptions, route: DistillRoute): Promise<string> {
  const { provider, model } = route;
  const signal = opts.signal ?? AbortSignal.timeout(cfg.llm.timeoutMs);
  // 档位按模型能力决策(跨供应商 effort 兼容):不支持的档位不传 + 告警一次,
  // 空配置 = 自动(模型默认 → high);路由的档位候选已在链解析时定好(条目 > 全局)。
  // 调用级覆盖(opts.reasoningEffort)优先——批扫靠它关掉思考，避免预算被 reasoning 吃光。
  const routeEffort = opts.reasoningEffort ?? route.effort;
  const effort = await planDistillEffort(ctx, provider, model, routeEffort, opts.logger);

  // 输入预算兜底:任何蒸馏调用的用户 prompt 不超过 maxInputChars
  // (L1 已在数据层分块,这里是 L2/L3 与异常场景的最后一道网)
  const user =
    opts.user.length > cfg.llm.maxInputChars
      ? `${opts.user.slice(0, cfg.llm.maxInputChars)}\n\n[输入超出 ${cfg.llm.maxInputChars} 字符预算,已截断]`
      : opts.user;

  // 输出预算 ×4 防线跟随【实际发送】的档位:阶段侧已按该层放大触发档位
  // (layerEffortTrigger:层链头候选 > 全局主路由候选)放大过,这里只补自动档
  // 解析出高档时的欠放大缺口——两侧共用一张表与同一触发值,
  // 配置本身就是高档时不再放大(防 ×16 双乘)
  const baseMaxTokens = opts.maxTokens ?? cfg.llm.maxTokens;
  const highTiers = HIGH_EFFORT_TIERS as readonly string[];
  // 触发档位也跟调用级覆盖走：显式 off 时不得被配置里的高档触发而 ×4。
  const triggerEffort = opts.reasoningEffort ?? (opts.layer
    ? layerEffortTrigger(cfg, layerKeyFor(opts.layer))
    : cfg.llm.primaryEffort || cfg.llm.reasoningEffort);
  const maxTokens =
    highTiers.includes(effort.effort) && !highTiers.includes(triggerEffort)
      ? layerMaxTokens(baseMaxTokens, 'high')
      : baseMaxTokens;

  const stream = ctx.llm.stream({
    provider,
    model,
    system: opts.system,
    messages: [createUserMessage({ content: [{ type: 'text', text: user }], source: { kind: 'user' } })],
    temperature: opts.temperature ?? cfg.llm.temperature,
    maxTokens,
    // 档位只在能力决策给出非空值时传;空串不传(跟随模型默认)
    ...(effort.effort ? { reasoningEffort: ReasoningEffortId(effort.effort) } : {}),
    signal,
  });

  const startedAt = Date.now();
  let deltaText = '';
  let blockText = '';
  // 块级统计:空输出诊断的唯一现场(finish reason / token 计数 / reasoning 是否吃光预算)
  let finishKind = '';
  let outputTokens = 0;
  let reasoningTokens = 0;
  let deltaBlocks = 0;
  let reasoningChars = 0;
  let reasoningHead = '';
  const blockEndTypes = new Map<string, number>();
  try {
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') {
        deltaBlocks++;
        deltaText += chunk.text;
      } else if (chunk.type === 'reasoning-delta') {
        reasoningChars += chunk.text.length;
        if (reasoningHead.length < 300) reasoningHead += chunk.text.slice(0, 300 - reasoningHead.length);
      } else if (chunk.type === 'block-end') {
        blockEndTypes.set(chunk.block.type, (blockEndTypes.get(chunk.block.type) ?? 0) + 1);
        if (chunk.block.type === 'text') blockText += chunk.block.text;
      } else if (chunk.type === 'usage') {
        outputTokens = chunk.usage.outputTokens;
        reasoningTokens = chunk.usage.reasoningTokens ?? 0;
      } else if (chunk.type === 'finish') {
        finishKind = chunk.reason.kind;
        if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
          const failure = (chunk.reason as { failure?: { message?: string } }).failure;
          throw new Error(`llm ${chunk.reason.kind}: ${failure?.message ?? 'unknown failure'}`);
        }
      }
    }
  } catch (err) {
    // 记账含失败路径(failures 计数;tokens 尽当时流内已到的 usage)
    if (opts.layer) recordDistillCall(opts.layer, user.length, outputTokens, reasoningTokens, true);
    if (opts.layer) recordCostCall(provider, model, opts.layer, user.length, outputTokens, reasoningTokens);
    opts.logger?.warn(
      `[memory] LLM 调用失败 ${provider}/${model}(${((Date.now() - startedAt) / 1000).toFixed(1)}s): ${errDetail(err)}`,
    );
    throw err;
  }
  const out = (blockText || deltaText).trim();
  if (out.length === 0) {
    // 空输出是最难排查的失败:流正常结束但一个字没吐。必须记录 finish 原因、
    // token 计数与块分布,才能区分"模型只产出了 reasoning"vs"服务端返回空响应"。
    if (opts.layer) recordDistillCall(opts.layer, user.length, outputTokens, reasoningTokens, true);
    if (opts.layer) recordCostCall(provider, model, opts.layer, user.length, outputTokens, reasoningTokens);
    opts.logger?.warn(
      `[memory] LLM 空输出 ${provider}/${model}(${((Date.now() - startedAt) / 1000).toFixed(1)}s,finish=${finishKind || '无 finish 块'}` +
        `,输出 tokens=${outputTokens}${reasoningTokens > 0 ? `/reasoning ${reasoningTokens}` : ''},` +
        `text-delta ${deltaBlocks} 块/${deltaText.length} 字符,reasoning ${reasoningChars} 字符,` +
        `block-end: ${[...blockEndTypes.entries()].map(([t, n]) => `${t}×${n}`).join(', ') || '无'})` +
        (reasoningHead ? `,reasoning 摘录: ${reasoningHead}…` : ''),
    );
    // 空输出按路由失败处理:交给回退链降级或上抛——返回空串只是把失败
    // 推迟到下游 JSON/Markdown 解析,诊断信息更差
    throw new Error(`llm empty output: ${provider}/${model} 流正常结束但输出 0 字符`);
  }
  if (opts.layer) recordDistillCall(opts.layer, user.length, outputTokens, reasoningTokens, false);
  if (opts.layer) recordCostCall(provider, model, opts.layer, user.length, outputTokens, reasoningTokens);
  opts.logger?.info(
    `[memory] LLM 调用 ${provider}/${model}:输入 ${user.length} 字符 → 输出 ${out.length} 字符(${((Date.now() - startedAt) / 1000).toFixed(1)}s,finish=${finishKind || '无'})`,
  );
  return out;
}

/** 带诊断日志的 parseJson:解析失败时记录原始输出摘录(模型输出异常排查的关键信息);修复/救援命中时 warn 一行。 */
export function parseJsonLogged<T>(raw: string, what: string, logger?: MemoryLogger): T {
  try {
    const { value, level, notes } = parseJsonTolerant<T>(raw);
    if (level !== 'strict') {
      logger?.warn(
        `[memory] ${what} JSON 已容错处理(${level}: ${notes.join('、') || '无动作'}),原文 ${raw.length} 字符`,
      );
    }
    return value;
  } catch (err) {
    logger?.error(
      `[memory] ${what} JSON 解析失败(${errDetail(err)}),原始输出前 400 字符: ${raw.slice(0, 400)}`,
    );
    throw new Error(`${what} 输出无法解析为 JSON`);
  }
}

/**
 * 容错地解析 LLM 输出的 JSON。
 *
 * 旧版行为：剥 ```json``` 围栏 + 切到首个 `[`/`{` 到末尾 `]`/`}`,一次 JSON.parse。
 * 新版同路径 + 三级容错(strict → repaired → salvaged),内部实现见 util/json-repair.ts。
 */
export function parseJson<T>(raw: string): T {
  return parseJsonTolerant<T>(raw).value;
}
