/**
 * LLM 桥:用 DSH 自身的 llm 服务跑蒸馏调用。
 *
 * 职责:蒸馏路由链(全局回退链 + 按层层链)、思考档位能力决策(跨供应商 effort
 * 兼容)、分层输出预算(思考档 ×4 防线)、direct 原生 HTTP 通道、流式调用与
 * 失败诊断、容错 JSON 解析。回退语义见 ADR-0004/0005。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { MemoryConfig } from './config.js';
import type { MemoryLogger } from './types.js';
import { type DistillLayer } from './llm-usage.js';
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
/** L1 抽取(大输入块的 JSON 记忆数组输出)。 */
export declare const LAYER_MAX_TOKENS_EXTRACT = 16000;
/** L1 去重(合并决策数组,输出比抽取短)。 */
export declare const LAYER_MAX_TOKENS_DEDUP = 8000;
/** L2 场景整合(完整场景 Markdown 文件输出,输出最重的层)。 */
export declare const LAYER_MAX_TOKENS_L2 = 32000;
/** L3 画像(完整 persona 文档)。 */
export declare const LAYER_MAX_TOKENS_L3 = 16000;
/** 图谱投影(节点/边提案 JSON;单批 ≤8 条记录,输出比 L1 抽取短)。 */
export declare const LAYER_MAX_TOKENS_GRAPH = 8000;
/** 分层输出预算键(契约单一事实源在 src/contract.ts)。 */
import type { DistillBudgetLayer, LayerRouteKey, StaticFallbackEntry } from './contract.js';
export type { DistillBudgetLayer } from './contract.js';
/** 各层内置默认预算(设置页"0 = 跟随默认"的默认值来源)。 */
export declare const LAYER_DEFAULT_BUDGETS: Record<DistillBudgetLayer, number>;
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
export declare function resolveLayerTokens(cfg: LayerRouteCfgView, layer: DistillBudgetLayer): number;
/**
 * 高思考档集合(输出预算 ×4 的档位):阶段侧 layerMaxTokens 与 callLLM 的
 * 自动档防线共用同一张表——勿再在别处抄写该列表。
 */
export declare const HIGH_EFFORT_TIERS: readonly ["high", "xhigh", "max"];
/**
 * 思考档预算放大:reasoning 计入输出预算(v4-flash 事故:high 思考可吃光全部
 * 预算致正文 0 字符)——effort 为 high/xhigh/max 时分层预算 ×4。
 */
export declare function layerMaxTokens(base: number, reasoningEffort: string): number;
/** 无可用蒸馏路由(显式一线/二线/链皆缺且 requireExplicitRoute=true)：
 *  runner 据此 skip+顺延、不记退避——区别于"模型慢/超时"(那才退避)。R4。 */
export declare class NoDistillRouteError extends Error {
    constructor(msg?: string);
}
/** 解析蒸馏用的 provider/model:配置优先,其次当前默认选择。 */
export declare function resolveModelRoute(ctx: Context, cfg: MemoryConfig): Promise<{
    provider: string;
    model: string;
}>;
/**
 * 二线(大容量兜底)选路(R3)：单次调用输入字符 ≥ triggerChars 且二线已配 → 返回二线路由，
 * 否则 null（走一线/链）。二线未配（provider/model 任一空）→ 永不命中，不隐式改选任意模型。
 */
export declare function pickSecondary(cfg: MemoryConfig, inputChars: number): {
    provider: string;
    model: string;
    reasoningEffort?: string;
} | null;
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
export declare function buildRouteChain(primary: {
    provider: string;
    model: string;
    effort?: string;
}, fallbacks: FallbackRouteEntry[] | undefined, globalEffort: string): DistillRoute[];
/**
 * DistillLayer(调用点五键)→ 路由层键(三键):l1-extract/l1-dedup 同属 l1;
 * graph 无层路由键——返回 null,调用侧按"该层无层链"回全局解析,绝不落入 l1
 * (图谱投影误用 L1 抽取链是路由配置错误,静默错路由最难排查)。
 */
export declare function layerKeyFor(layer: DistillLayer): LayerRouteKey | null;
/** 该层的预算放大触发档位:层链头档位候选 > 全局主路由档位候选(primaryEffort > 静态全局)。
 *  key=null(graph 层无层链)→ 恒走全局候选。 */
export declare function layerEffortTrigger(cfg: LayerRouteCfgView, key: LayerRouteKey | null): string;
/**
 * 解析某次蒸馏调用的实际路由链(callLLM 入口):有层标签且该层配了层链 → 层链
 * 完整替换(buildRouteChain 复用:头行在前、条目去重、档位三级候选);否则现行
 * 全局解析。layer 缺省(bench/测试缝)= 全局解析。
 */
export declare function resolveLayerRoutes(ctx: Context, cfg: MemoryConfig, layer?: DistillLayer): Promise<DistillRoute[]>;
/** 层链解析的同步半边(llm-providers 视图与 resolveLayerRoutes 共用一条真值路径):
 *  该层配了有效层链 → 完整链;null = 该层跟随全局解析。 */
export declare function layerChainOrNull(cfg: LayerRouteCfgView, key: LayerRouteKey): DistillRoute[] | null;
export interface ModelEffortInfo {
    /** 模型可设置的思考档位 id(适配器声明;空 = 未声明/不可设置) */
    efforts: string[];
    /** 适配器配置的默认档位(省略 effort 时的请求值) */
    defaultEffort?: string;
}
/** 清空能力缓存(llm/adapters-updated 时调用:供应商增删/改配置后重新探询)。 */
export declare function invalidateEffortCache(): void;
/** 探询某模型的思考档位能力;失败返回 null(调用方保持旧发送行为,不改判)。 */
export declare function resolveModelEfforts(ctx: Context, provider: string, model: string): Promise<ModelEffortInfo | null>;
/**
 * 探询某模型的上下文窗口容量(adapter 声明的 provider-owned capacity)。
 * 与 effortCache 同源同失效策略;仅用于占用指示器的分母展示——分母必须与官方环
 * 同源(模型声明值),禁止 client 自估。
 */
export declare function resolveModelContextWindow(ctx: Context, provider: string, model: string): Promise<number | null>;
export type EffortDecisionReason = 'supported' | 'auto-default' | 'auto-high' | 'alias-none' | 'unsupported' | 'no-efforts' | 'no-capability';
export interface EffortDecision {
    /** 实际发送的档位;'' = 不发送(跟随模型默认) */
    effort: string;
    reason: EffortDecisionReason;
}
/** 纯决策:配置档位 + 模型能力 → 实际发送值(callLLM 与 settings-get 共用)。 */
export declare function decideSendableEffort(cap: ModelEffortInfo | null, cfgEffort: string): EffortDecision;
/** 探询 + 决策 + 一次性告警(不支持/未声明时提示降级,不刷屏)。 */
export declare function planDistillEffort(ctx: Context, provider: string, model: string, cfgEffort: string, logger?: MemoryLogger): Promise<EffortDecision>;
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
export declare function callLLM(ctx: Context, cfg: MemoryConfig, opts: LlmCallOptions): Promise<string>;
/** 带诊断日志的 parseJson:解析失败时记录原始输出摘录(模型输出异常排查的关键信息);修复/救援命中时 warn 一行。 */
export declare function parseJsonLogged<T>(raw: string, what: string, logger?: MemoryLogger): T;
/**
 * 容错地解析 LLM 输出的 JSON。
 *
 * 旧版行为：剥 ```json``` 围栏 + 切到首个 `[`/`{` 到末尾 `]`/`}`,一次 JSON.parse。
 * 新版同路径 + 三级容错(strict → repaired → salvaged),内部实现见 util/json-repair.ts。
 */
export declare function parseJson<T>(raw: string): T;
