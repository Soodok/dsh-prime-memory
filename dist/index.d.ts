import type { Context } from '@deepseek-ai/cordis';
import { type MemoryConfig } from './config.js';
export declare const name = "dsh-memory-plugin";
/**
 * 硬依赖:蒸馏要用 llm,工具注册要用 tools,召回注入要用 systemPrompt。
 * 0.1.5 起 connection.rpc.handle() 把 /rpc 路由登记到 webServer 时按**调用方
 * fiber** 校验 inject 授权(0.1.1/0.1.2 由 connection 服务自己持有 webServer,
 * 调用方无需声明)——缺失即 `cannot get property "webServer" without inject`
 * 致命失败。故声明 connection + webServer;两者在 0.1.1~0.1.5 均存在,
 * 额外授权在旧版无害(声明式注入只会等这两个服务就绪,不改装配顺序)。
 */
export declare const inject: string[];
/**
 * 插件配置 schema。导出名必须是 `Config`——cordis 运行时只读 plugin.Config
 * (Standard Schema 接口)做校验与默认值填充;导出 `schema` 会被静默忽略,
 * 导致 config 里嵌套对象为 undefined、apply 抛错、fiber FAILED 拖垮宿主启动。
 */
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
    dataDir: import("@deepseek-ai/schemastery").default<string, string, "defined">;
    family: import("@deepseek-ai/schemastery").default<"chat" | "work" | "auto", "chat" | "work" | "auto", "defined">;
    scope: import("@deepseek-ai/schemastery").default<string, string, "defined">;
    capture: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        stripCodeBlocks: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        maxMessageChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        redactSecrets: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        stripCodeBlocks: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        maxMessageChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        redactSecrets: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, "plain">;
    trace: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        retentionDays: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        captureContent: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        retentionDays: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        captureContent: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, "plain">;
    extract: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        minMessages: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        idleSeconds: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        backgroundMessages: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        candidatePool: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        minMessages: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        idleSeconds: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        backgroundMessages: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        candidatePool: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    l2: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        minNewMemories: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxScenes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        sceneContextLimit: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        minNewMemories: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxScenes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        sceneContextLimit: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    l3: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        interval: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        interval: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    graph: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, "plain">;
    conflictFreeze: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        maxPending: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        timeoutDays: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        maxPending: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        timeoutDays: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    memport: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        scanMaxRecords: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        scanMaxRecords: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    skills: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        inject: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        allowPromote: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        minSessions: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        minEvidence: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxPerTurnBytes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxSkillCatalogBytes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        excerptChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        idleArchiveDays: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        inject: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        allowPromote: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        minSessions: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        minEvidence: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxPerTurnBytes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxSkillCatalogBytes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        excerptChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        idleArchiveDays: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    backfill: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        maxRecords: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        timeBudgetMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        maxRecords: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        timeBudgetMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    usageScenario: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, "plain">;
    narrativeTemplates: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, "plain">;
    recall: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        maxResults: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxCharsPerMemory: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxTotalRecallChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        includePersona: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        includeSceneNav: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        strategy: import("@deepseek-ai/schemastery").default<"hybrid" | "keyword" | "embedding", "hybrid" | "keyword" | "embedding", "defined">;
        scoreThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        decayHalfLifeDays: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        scopeFence: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            crossRepoMultiplier: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            crossRepoMultiplier: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>, "plain">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        maxResults: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxCharsPerMemory: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxTotalRecallChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        includePersona: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        includeSceneNav: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        strategy: import("@deepseek-ai/schemastery").default<"hybrid" | "keyword" | "embedding", "hybrid" | "keyword" | "embedding", "defined">;
        scoreThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        decayHalfLifeDays: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        scopeFence: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            crossRepoMultiplier: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            crossRepoMultiplier: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>, "plain">;
    }>>, "plain">;
    embedding: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        baseUrl: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        apiKey: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        dimensions: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxInputChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        allowLocalModels: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        mirror: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        proxy: import("@deepseek-ai/schemastery").default<string, string, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        baseUrl: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        apiKey: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        dimensions: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxInputChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        allowLocalModels: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        mirror: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        proxy: import("@deepseek-ai/schemastery").default<string, string, "defined">;
    }>>, "plain">;
    llm: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        mode: import("@deepseek-ai/schemastery").default<"host" | "direct", "host" | "direct", "defined">;
        baseURL: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        apiKey: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        fallbacks: import("@deepseek-ai/schemastery").default<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        layerRoutes: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            l1: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            l1: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, "defined">;
        maxTokens: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        temperature: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxInputChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        mode: import("@deepseek-ai/schemastery").default<"host" | "direct", "host" | "direct", "defined">;
        baseURL: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        apiKey: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        fallbacks: import("@deepseek-ai/schemastery").default<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        layerRoutes: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            l1: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            l1: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, "defined">;
        maxTokens: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        temperature: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxInputChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    hall: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
    }>>, "plain">;
    tokenCost: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        retentionDays: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        retentionDays: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    slots: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        inject: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        maxSlots: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxAlwaysOnBytes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxBodyChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        inject: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        maxSlots: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxAlwaysOnBytes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxBodyChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    tools: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    benchControl: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    live: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        capture: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        distill: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        recall: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        distillProvider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        distillModel: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        distillChain: import("@deepseek-ai/schemastery").default<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        distillLayerChains: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            l1: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            l1: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, "defined">;
        distillBudgets: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            extract: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            dedup: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            l2: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            l3: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            graph: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            extract: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            dedup: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            l2: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            l3: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            graph: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>, "defined">;
        distillMaxInputChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        distillMode: import("@deepseek-ai/schemastery").default<"" | "host" | "direct", "" | "host" | "direct", "defined">;
        directBaseURL: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        directApiKey: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        embedRemoteBaseURL: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        embedRemoteApiKey: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        embedRemoteModel: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        embedRemoteDimensions: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        memoryMutate: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        conflictFreeze: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        skillsEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        toolRoom: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        toolGraph: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        toolRuminate: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        toolConflict: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        toolMutate: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        capture: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        distill: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        recall: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        distillProvider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        distillModel: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        distillChain: import("@deepseek-ai/schemastery").default<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        distillLayerChains: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            l1: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            l1: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, "defined">;
        distillBudgets: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            extract: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            dedup: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            l2: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            l3: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            graph: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            extract: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            dedup: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            l2: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            l3: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            graph: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>, "defined">;
        distillMaxInputChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        distillMode: import("@deepseek-ai/schemastery").default<"" | "host" | "direct", "" | "host" | "direct", "defined">;
        directBaseURL: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        directApiKey: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        embedRemoteBaseURL: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        embedRemoteApiKey: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        embedRemoteModel: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        embedRemoteDimensions: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        memoryMutate: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        conflictFreeze: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        skillsEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        toolRoom: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        toolGraph: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        toolRuminate: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        toolConflict: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        toolMutate: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>>, "volatile">;
}>>, Schemastery.ObjectT<NoInfer<{
    dataDir: import("@deepseek-ai/schemastery").default<string, string, "defined">;
    family: import("@deepseek-ai/schemastery").default<"chat" | "work" | "auto", "chat" | "work" | "auto", "defined">;
    scope: import("@deepseek-ai/schemastery").default<string, string, "defined">;
    capture: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        stripCodeBlocks: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        maxMessageChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        redactSecrets: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        stripCodeBlocks: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        maxMessageChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        redactSecrets: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, "plain">;
    trace: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        retentionDays: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        captureContent: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        retentionDays: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        captureContent: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, "plain">;
    extract: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        minMessages: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        idleSeconds: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        backgroundMessages: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        candidatePool: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        minMessages: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        idleSeconds: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        backgroundMessages: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        candidatePool: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    l2: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        minNewMemories: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxScenes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        sceneContextLimit: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        minNewMemories: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxScenes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        sceneContextLimit: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    l3: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        interval: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        interval: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    graph: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, "plain">;
    conflictFreeze: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        maxPending: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        timeoutDays: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        maxPending: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        timeoutDays: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    memport: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        scanMaxRecords: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        scanMaxRecords: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    skills: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        inject: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        allowPromote: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        minSessions: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        minEvidence: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxPerTurnBytes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxSkillCatalogBytes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        excerptChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        idleArchiveDays: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        inject: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        allowPromote: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        minSessions: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        minEvidence: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxPerTurnBytes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxSkillCatalogBytes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        excerptChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        idleArchiveDays: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    backfill: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        maxRecords: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        timeBudgetMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        maxRecords: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        timeBudgetMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    usageScenario: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, "plain">;
    narrativeTemplates: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, "plain">;
    recall: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        maxResults: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxCharsPerMemory: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxTotalRecallChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        includePersona: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        includeSceneNav: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        strategy: import("@deepseek-ai/schemastery").default<"hybrid" | "keyword" | "embedding", "hybrid" | "keyword" | "embedding", "defined">;
        scoreThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        decayHalfLifeDays: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        scopeFence: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            crossRepoMultiplier: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            crossRepoMultiplier: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>, "plain">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        maxResults: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxCharsPerMemory: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxTotalRecallChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        includePersona: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        includeSceneNav: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        strategy: import("@deepseek-ai/schemastery").default<"hybrid" | "keyword" | "embedding", "hybrid" | "keyword" | "embedding", "defined">;
        scoreThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        decayHalfLifeDays: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        scopeFence: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            crossRepoMultiplier: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            crossRepoMultiplier: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>, "plain">;
    }>>, "plain">;
    embedding: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        baseUrl: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        apiKey: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        dimensions: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxInputChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        allowLocalModels: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        mirror: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        proxy: import("@deepseek-ai/schemastery").default<string, string, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        baseUrl: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        apiKey: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        dimensions: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxInputChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        allowLocalModels: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        mirror: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        proxy: import("@deepseek-ai/schemastery").default<string, string, "defined">;
    }>>, "plain">;
    llm: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        mode: import("@deepseek-ai/schemastery").default<"host" | "direct", "host" | "direct", "defined">;
        baseURL: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        apiKey: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        fallbacks: import("@deepseek-ai/schemastery").default<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        layerRoutes: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            l1: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            l1: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, "defined">;
        maxTokens: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        temperature: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxInputChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        mode: import("@deepseek-ai/schemastery").default<"host" | "direct", "host" | "direct", "defined">;
        baseURL: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        apiKey: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        fallbacks: import("@deepseek-ai/schemastery").default<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        layerRoutes: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            l1: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            l1: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, "defined">;
        maxTokens: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        temperature: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxInputChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    hall: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
    }>>, "plain">;
    tokenCost: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        retentionDays: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        retentionDays: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    slots: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        inject: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        maxSlots: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxAlwaysOnBytes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxBodyChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        inject: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        maxSlots: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxAlwaysOnBytes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxBodyChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    tools: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    benchControl: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    live: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        capture: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        distill: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        recall: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        distillProvider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        distillModel: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        distillChain: import("@deepseek-ai/schemastery").default<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        distillLayerChains: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            l1: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            l1: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, "defined">;
        distillBudgets: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            extract: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            dedup: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            l2: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            l3: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            graph: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            extract: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            dedup: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            l2: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            l3: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            graph: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>, "defined">;
        distillMaxInputChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        distillMode: import("@deepseek-ai/schemastery").default<"" | "host" | "direct", "" | "host" | "direct", "defined">;
        directBaseURL: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        directApiKey: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        embedRemoteBaseURL: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        embedRemoteApiKey: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        embedRemoteModel: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        embedRemoteDimensions: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        memoryMutate: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        conflictFreeze: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        skillsEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        toolRoom: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        toolGraph: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        toolRuminate: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        toolConflict: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        toolMutate: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        capture: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        distill: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        recall: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        distillProvider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        distillModel: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        distillChain: import("@deepseek-ai/schemastery").default<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        distillLayerChains: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            l1: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            l1: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: import("@deepseek-ai/schemastery").default<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                reasoningEffort: import("@deepseek-ai/schemastery").default<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, "defined">;
        distillBudgets: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            extract: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            dedup: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            l2: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            l3: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            graph: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            extract: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            dedup: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            l2: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            l3: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            graph: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>, "defined">;
        distillMaxInputChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        distillMode: import("@deepseek-ai/schemastery").default<"" | "host" | "direct", "" | "host" | "direct", "defined">;
        directBaseURL: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        directApiKey: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        embedRemoteBaseURL: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        embedRemoteApiKey: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        embedRemoteModel: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        embedRemoteDimensions: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        memoryMutate: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        conflictFreeze: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        skillsEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        toolRoom: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        toolGraph: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        toolRuminate: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        toolConflict: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        toolMutate: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>>, "volatile">;
}>>, "plain">;
export declare function apply(ctx: Context, config: MemoryConfig): Promise<void>;
