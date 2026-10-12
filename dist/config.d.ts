/**
 * 插件配置:Schemastery schema + 类型。
 *
 * 默认数据目录:$DSH_HOME/memory(用官方 dshHomePath 解析,DSH_HOME 缺省 ~/.dsh)。
 * 键名/默认值/取值范围是部署面契约(patch.yml 按"整行替换,不深合并"覆盖),不可更名。
 */
import Schema from '@deepseek-ai/schemastery';
import type { Volatile } from '@deepseek-ai/cordis';
import type { LayerRouteKey, MemoryLiveSettings, StaticFallbackEntry } from './contract.js';
import type { ExtractMode, ScopeMode } from './types.js';
import type { WorkspaceRoute } from './workspace-route.js';
/**
 * 蒸馏思考档位全词汇表(唯一事实源):'' = 自动(模型默认档 → high),
 * 其余为各适配器通用档位词汇(deepseek 认 'off',OpenAI 系是 'none')。
 * schema(config/settings)、运行时解析与 RPC 写入门共用,勿在别处再抄字面量表。
 */
export declare const EFFORT_CHOICES: readonly ["", "off", "none", "minimal", "low", "medium", "high", "xhigh", "max"];
export interface MemoryConfig {
    /** 数据目录;留空则用 $DSH_HOME/memory。 */
    dataDir: string;
    /** 新会话的默认记忆档位:auto(双族自动)| chat(个人)| work(工作)。 */
    family: ExtractMode;
    /** §E 存储作用域(可见范围):`global`(默认,跨工作区可见)| `workspace`(按工作区隔离 work 族)。
     *  与 `family` **正交**——前者问"这是什么内容",后者问"它该在多大范围内可见"(ADR-0008 条 1)。
     *  默认 `global` 保证既有部署零漂移:检索侧"是否带工作区标识"即开关,不带即不过滤。 */
    scope: ScopeMode;
    capture: {
        enabled: boolean;
        /** 助手消息是否剥离代码块(减少嵌入噪声)。 */
        stripCodeBlocks: boolean;
        /** 单条消息内容最大字符数。 */
        maxMessageChars: number;
        /**
         * §C 载荷脱敏(memorax-absorb):捕获单点把 8 类密钥(PEM/Bearer/JWT/Cookie/
         * 厂商 API key/邮箱/长号/高熵 ID)替换为 `[REDACTED:<KIND>]` 占位符,覆盖
         * L0 JSONL/SQLite/蒸馏输入与手动 memory_add/import。**默认开启**——密钥被
         * 逐轮召回注入的危害大于偶发误脱敏;注意开启后 L0 原文自此改变(重建不可得原文)。
         * 决策记录见计划 spec §C;`false` 一键回到明文行为。 */
        redactSecrets?: boolean;
    };
    /** §F 结构化追踪(memorax-absorb):recall/distill 事件按天 JSONL。 */
    trace: {
        enabled: boolean;
        /** 事件文件保留天数(写入时切日清理;0 = 永久)。 */
        retentionDays: number;
        /** 默认 metadata-only(chars+sha);true 才存 query 原文(≤200 字符)。 */
        captureContent: boolean;
    };
    extract: {
        enabled: boolean;
        /** 稳态触发阈值:单会话攒够多少条新消息才跑一次 L1 抽取(省 token)。
         *  起步阶段生效阈值从 1 翻倍爬坡到此值(渐进阈值,ADR-0003)。 */
        minMessages: number;
        /** 闲置兜底:会话静默多少秒后把未蒸馏切片落袋;0 = 关闭。 */
        idleSeconds: number;
        /** L1 抽取时的背景消息条数(供上下文推断,不参与提取)。 */
        backgroundMessages: number;
        /** 去重候选池大小(每条新记忆的相似候选数)。 */
        candidatePool: number;
    };
    l2: {
        enabled: boolean;
        /** 距上次 L2 整合的新记忆达到该数量才触发。 */
        minNewMemories: number;
        /** 场景块数量上限。 */
        maxScenes: number;
        /** L2 prompt 里附带的相似场景全文数量上限。 */
        sceneContextLimit: number;
    };
    l3: {
        enabled: boolean;
        /** 距上次 L3 蒸馏的新记忆数量阈值。 */
        interval: number;
    };
    graph: {
        /** 知识图谱投影总开关(部署级,默认关):开启后还需运行时蒸馏开关(live.distill)
         *  同时为真才执行;图谱是 L1 的可重建投影,关闭不影响记忆主链路。 */
        enabled: boolean;
    };
    /** §C 矛盾冻结:去重判定"两边都像是对的、机器判不了"时不自动裁决,
     *  把冲突对停放到待人工裁决区(conflict_pending)。**默认关**——
     *  冻结消耗人的注意力,不可默认全开。 */
    conflictFreeze: {
        /** 总开关。关闭时去重 prompt 与改动前**逐字一致**,冲突分支结构性不可达。 */
        enabled: boolean;
        /** 待裁决队列上限(条)。未裁决数达上限时**不再停放**,直接按 LLM 的
         *  winner/loser 自动了结(仍写 conflict_pending,`resolution='auto'`)。
         *  语义是「不收新的」而非「偷偷删旧的」——有界性由此结构性成立。 */
        maxPending: number;
        /** 超时降级(天):停放超过该天数的待裁决对在下一轮蒸馏开头被自动了结。
         *  **0 = 不做超时降级**(显式关闭,而非"立刻全部超时")。 */
        timeoutDays: number;
    };
    /** 轨3 memport Connect:外部记忆来源登记与只读扫描。**默认关**——
     *  scan 仅预览(不写库)，写库仍走 memory_import；enabled 关时 memory-sources 与 memport-scan 端点均不可用。 */
    memport: {
        enabled: boolean;
        /** 单源扫描记录上限(0 = 不限;仍受总护栏)。 */
        scanMaxRecords: number;
    };
    /** 轨2 技能结晶(程序性记忆)。**默认关**：allowPromote 也默认关（上线先只计数不晋升，
     *  distinct-session 达阈后才开）；injectionTier 不用 union，消费侧归一。 */
    skills: {
        enabled: boolean;
        /** 开且 enabled 时，每轮 pre-step 才注入 active 技能。 */
        inject: boolean;
        /** candidate→active 自动晋升总闸（默认关，只计数）。 */
        allowPromote: boolean;
        /** 晋升需 distinct session 数。 */
        minSessions: number;
        /** 晋升需证据条数下限（与 minSessions 同时满足）。 */
        minEvidence: number;
        /** 每轮技能注入字节预算（独立于召回 2000 预算）。 */
        maxPerTurnBytes: number;
        /** 技能目录常驻字节预算。 */
        maxSkillCatalogBytes: number;
        /** excerpt 档每技能正文截断。 */
        excerptChars: number;
        /** active 技能闲置多少天后自动归档（0 = 不做闲置归档）。 */
        idleArchiveDays: number;
    };
    /** wing 存量回填护栏（默认 300 条/120s；想一次多跑点可调大，代价是后台占用更久）。 */
    backfill: {
        /** 单次回填处理条数上限。 */
        maxRecords: number;
        /** 单次回填墙钟预算(ms)，超时剩留待再次触发。 */
        timeBudgetMs: number;
    };
    /**
     * 内容路由（workspace 归属）：按「这条记忆**谈到**哪个项目」给记录补 `workspace_id`。
     *
     * 为什么不用「产生它的会话」定位：实测 `l1_records.session_id` 恒为 `default`（废字段），
     * 锚点里的 sessionId 能在磁盘会话树里找到目录的只占 7.3%（树会被清理/隔离），
     * 而 L1 时间戳与 L0 两个时间列零命中——来路链不可依赖。内容路由不受锚点缺失影响。
     *
     * 默认关。开启后**只写 `workspace_id` 列、不改 `scope`**：可见性仍由 `scope` 决定
     * （`resolveRecordScope` 规则③ 的零漂移不破），所以对现有部署零行为变化；
     * 将来真启用 workspace 围栏时，这个列已经是现成的正确依据。
     */
    workspaceHints: {
        enabled: boolean;
        /** 路由表：按数组序取首个命中——dsh 侧在前，故双项目并存时归 dsh（用户口径）。 */
        routes: WorkspaceRoute[];
        /** 存量 re-link 的单次护栏。 */
        maxRecords: number;
        /** 存量 re-link 的墙钟预算(ms)。 */
        timeBudgetMs: number;
    };
    /**
     * md 投射与外部存档（N1/N8/N9）：整面**默认关**，关时零动作——不派生 name、不写文件、
     * 不建账本，与改动前逐字一致。name 只随本开关写，因为它是文件身份键：没打算投射
     * 就给它起名，等于让存量库里多出一批没人用的非空列值。
     */
    memExport: {
        enabled: boolean;
        /** 投射根目录；空 = `<dataDir>/memories`。形状不合则回退默认并 warn，**不抛错**（投射是旁路，不能弄挂记忆）。 */
        root: string;
        /** 单次导出的条数护栏（照 wing-backfill / workspace-relink 口径）。 */
        maxRecords: number;
        /** 单次导出的墙钟预算(ms)。 */
        timeBudgetMs: number;
    };
    /** 使用场景（G1）：抽取时产出“何时该浮现”数组落 metadata.dsh_usage_scenario。默认关，关时抽取产物逐字不变。 */
    usageScenario: {
        enabled: boolean;
    };
    /** 类型叙述模板（G2）：抽取时按 7 类型各自的“前因后果”骨架写 content。默认关，关时 prompt 逐字不变。 */
    narrativeTemplates: {
        enabled: boolean;
    };
    /**
     * 召回相关度反馈（人在召回卡上打 -1..5）。
     *
     * 默认**开**，与 usageScenario/narrativeTemplates 的默认关不同——那两个改的是
     * 已发布的蒸馏产物，本项只新增一个写端点与一张卡；而播报只在用户显式打 -1
     * 之后才发生（动作即授权），不开这个开关不会凭空改变任何现有行为。
     */
    recallFeedback: {
        enabled: boolean;
        /** -1 之后下一轮向模型声明“这条已退场”(一次性注入，取走即离队)。 */
        announce: boolean;
        /**
         * 打分参与召回排序：4/5 上浮、0/1/2 下沉（纯重排，**score 不改写**，未打分保持原序）。
         * 这是 0/1/2 的常规出口：不相关就排到注不上，而不是从库里消失。
         */
        affectRank: boolean;
        /**
         * 硬门：最近一笔是 0 的记录**不再被注入**（不退场，再点 1..5 即回来）。
         * 默认关——低分已由上面的沉底表达；要“误点不致命”的口径就别开。
         */
        excludeZero: boolean;
    };
    recall: {
        enabled: boolean;
        /** 每步自动召回注入的 L1 条数。 */
        maxResults: number;
        /** 单条注入记忆的字符上限(超限截断并提示用工具查全文);0 = 不限。 */
        maxCharsPerMemory: number;
        /** 整轮注入总字符上限(超限按相关性丢尾部);0 = 不限。 */
        maxTotalRecallChars: number;
        /** 召回总预算(ms):超时跳过本轮注入、不阻塞对话;0 = 不限时。 */
        timeoutMs: number;
        includePersona: boolean;
        includeSceneNav: boolean;
        /** 检索策略:keyword(FTS5 BM25)| embedding(向量)| hybrid(双路 + RRF 融合)。 */
        strategy: 'keyword' | 'embedding' | 'hybrid';
        /** 召回路径分数阈值(0~1,低于该分不注入;工具路径不过滤)。 */
        scoreThreshold: number;
        /** 时效衰减半衰期(天,0=关):score × max(0.5, 0.5^(Δ天/半衰期)),
         *  只影响相关度相近候选间的名次(老记忆最多损失一半排序分,不淘汰)。 */
        decayHalfLifeDays: number;
        /** repo 软围栏(ADR-0015,默认关=不减权不围栏,零漂移)。 */
        scopeFence: {
            enabled: boolean;
            /** repo 不匹配时的乘子(与域门禁 0.4 叠乘 ≥0.08;软减权非硬排除)。 */
            crossRepoMultiplier: number;
        };
    };
    embedding: {
        /** 向量检索总开关;关闭时纯 FTS 运行。 */
        enabled: boolean;
        /** OpenAI 兼容 /embeddings 服务地址,如 https://api.siliconflow.cn/v1。 */
        baseUrl: string;
        apiKey: string;
        model: string;
        /** 向量维度(启用时必填,须与模型输出一致;vec0 建表需要固定维度)。 */
        dimensions: number;
        /** 单条文本最大字符数(超长截断)。 */
        maxInputChars: number;
        /** 单次调用超时(ms)。 */
        timeoutMs: number;
        /** 允许本地嵌入模型档(部署上限:公司环境可禁下载与本地推理)。 */
        allowLocalModels: boolean;
        /** 模型下载镜像根地址(默认国内可达的 hf-mirror.com)。 */
        mirror: string;
        /** 模型下载代理三态:''(默认)= 探测代理环境变量;'none' = 强制直连;其他 = 代理 URL。 */
        proxy: string;
    };
    llm: {
        /** 蒸馏用的 provider 路由;留空用当前默认选择。 */
        provider: string;
        /** 蒸馏用的模型;留空用当前默认选择。 */
        model: string;
        /** 压缩(蒸馏)调用通道:'host' = 复用宿主 ctx.llm(默认,零配置);'direct' =
         *  插件原生 HTTP 直连 llm.baseURL 指定的 OpenAI 兼容端点。direct 失败自动回退宿主
         *  路由作兜底;direct 未配置时静默回退 host。 */
        mode: 'host' | 'direct';
        /** direct 模式下的 OpenAI 兼容 /v1 端点根地址;host 模式忽略。 */
        baseURL: string;
        /** direct 模式下可选 API Key(本地免 key);host 模式忽略。 */
        apiKey: string;
        /** 回退链:主路由失败(报错/掐断/网络异常/空输出)后按序降级的备用路由,
         *  条目顺序即优先级。与主路由完全相同的条目自动跳过;provider/model 缺失的条目剔除;
         *  条目 reasoningEffort 非空时覆盖全局档位;空数组(缺省)= 单路由行为不变。 */
        fallbacks?: StaticFallbackEntry[];
        /** 按层静态路由链:层键 l1/l2/l3 各一条完整链(头行必须 provider+model 双显式)。
         *  非空即完整替换该层解析;空/缺省 = 该层跟随全局解析。被运行时层链压过;
         *  pin 不废静态层链。 */
        layerRoutes?: Partial<Record<LayerRouteKey, StaticFallbackEntry[]>>;
        /** 运行时层链(effectiveCfg 从设置页 distillLayerChains 注入,层内第一优先级);
         *  非静态 schema——运行时偏好,无部署上限语义。 */
        layerChainsRuntime?: Partial<Record<LayerRouteKey, StaticFallbackEntry[]>>;
        /** 单次蒸馏调用的输出 token 上限(推理模型的 reasoning 与正文共享该预算)。 */
        maxTokens: number;
        /** 蒸馏调用的思考档位;空串不传(跟随模型默认)。 */
        reasoningEffort: string;
        /** 运行时主路由显式档位(distillChain[0].reasoningEffort 经 effectiveCfg 注入);
         *  '' = 跟随全局静态 reasoningEffort。 */
        primaryEffort?: string;
        temperature: number;
        /** 单次蒸馏调用的用户 prompt 字符预算(≈token 数,按中文 1 字≈1 token 保守估算)。 */
        maxInputChars: number;
        /** 单次蒸馏调用超时(ms)。 */
        timeoutMs: number;
        /** 分层输出预算运行时覆盖(设置页 distillBudgets 经 effectiveCfg 注入;
         *  0/缺省 = 用内置默认。非静态 schema——预算无部署上限语义)。 */
        budgets?: Partial<{
            extract: number;
            dedup: number;
            l2: number;
            l3: number;
            graph: number;
        }>;
    };
    /** Hall(粗分类属性通道):参与 L1 自动打标与记忆库过滤的 Wing id 列表。
     *  空数组 = 关闭 Hall 功能(不自动打标)。 */
    hall: {
        enabled: string[];
    };
    tokenCost: {
        /** token_cost 明细保留天数;写入时滚动清理更早行。0 = 永久保留。 */
        retentionDays: number;
    };
    /** 激活槽位(active slot):可跨会话持久的结构化提示,pinned 的 open 槽位常驻注入每轮对话上下文。 */
    slots: {
        /** 总开关:读/注入是否开启(写仍由 live.memoryMutate 门控)。默认开。 */
        enabled: boolean;
        /** 常驻注入开关:pinned 槽位是否进 agent/pre-step 上下文。默认开。 */
        inject: boolean;
        /** 槽位数量上限(条)。 */
        maxSlots: number;
        /** 常驻注入字节预算(UTF-8)。 */
        maxAlwaysOnBytes: number;
        /** 槽位正文最大字符数。 */
        maxBodyChars: number;
        /**
         * 旧语义迁移（默认关）：反刍收尾时，把“钉成常驻、但内容已由一条活 L1 记忆承载”的
         * rule 槽位软退场（dropped），让那条记忆回到相关性召回而非每轮硬注入。
         * 需用户显式授权：动的是手动建的约定，不自动生效。
         */
        migrateLegacy: boolean;
    };
    /** 是否注册模型可调用的记忆工具。 */
    tools: boolean;
    /** 注册 bench 控制服务(dsh-memory-bench,进程内 rebuild 触发面)。
     *  仅供基准/调试部署,默认关——生产零表面积。 */
    benchControl: boolean;
    /** 运行时开关(0.1.7 起由 Config 的 volatile 字段承载,设置页自动成表;
     *  原为 settings 服务 `dsh-memory` 命名空间,见 src/settings.ts 头注)。
     *  读取走 `config.live.get()`(每次操作取一次),写入走设置页或
     *  settings-set RPC(经 `fiber.update` 持久化到 profile patch)。 */
    live: Volatile<MemoryLiveSettings>;
}
/**
 * 运行时开关节(0.1.7 声明式设置面的唯一事实源)。
 *
 * **整个对象一个 `.volatile()`**:宿主把它投影成设置表单,运行时变更只提交引用
 * (不 remount 插件),读侧用 `config.live.get()` 取冻结快照。键集与默认值是
 * v0.9.0 契约(含远程嵌入覆盖四键 embedRemote* 与写删门 memoryMutate,自 dist
 * 逆向补全——缺一个键 = 用户已存值被静默丢弃,红线,contract-keys.test.ts 守卫)。
 *
 * ⚠️ 不得在节内再标 `.volatile()`(volatile 嵌套 volatile 会被宿主拒绝)。
 */
export declare function liveSettingsSchema(): Schema<NoInfer<Schemastery.ObjectS<NoInfer<{
    enabled: Schema<boolean, boolean, "defined">;
    capture: Schema<boolean, boolean, "defined">;
    distill: Schema<boolean, boolean, "defined">;
    recall: Schema<boolean, boolean, "defined">;
    reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
    distillProvider: Schema<string, string, "defined">;
    distillModel: Schema<string, string, "defined">;
    distillChain: Schema<({
        provider?: string | null | undefined;
        model?: string | null | undefined;
        reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
        provider: Schema<string, string, "defined">;
        model: Schema<string, string, "defined">;
        reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
    }>>[], "defined">;
    distillLayerChains: Schema<Schemastery.ObjectS<NoInfer<{
        l1: Schema<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: Schema<string, string, "defined">;
            model: Schema<string, string, "defined">;
            reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        l2: Schema<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: Schema<string, string, "defined">;
            model: Schema<string, string, "defined">;
            reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        l3: Schema<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: Schema<string, string, "defined">;
            model: Schema<string, string, "defined">;
            reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        l1: Schema<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: Schema<string, string, "defined">;
            model: Schema<string, string, "defined">;
            reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        l2: Schema<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: Schema<string, string, "defined">;
            model: Schema<string, string, "defined">;
            reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        l3: Schema<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: Schema<string, string, "defined">;
            model: Schema<string, string, "defined">;
            reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
    }>>, "defined">;
    distillBudgets: Schema<Schemastery.ObjectS<NoInfer<{
        extract: Schema<number, number, "defined">;
        dedup: Schema<number, number, "defined">;
        l2: Schema<number, number, "defined">;
        l3: Schema<number, number, "defined">;
        graph: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        extract: Schema<number, number, "defined">;
        dedup: Schema<number, number, "defined">;
        l2: Schema<number, number, "defined">;
        l3: Schema<number, number, "defined">;
        graph: Schema<number, number, "defined">;
    }>>, "defined">;
    distillMaxInputChars: Schema<number, number, "defined">;
    distillMode: Schema<"" | "host" | "direct", "" | "host" | "direct", "defined">;
    directBaseURL: Schema<string, string, "defined">;
    directApiKey: Schema<string, string, "defined">;
    embedRemoteBaseURL: Schema<string, string, "defined">;
    embedRemoteApiKey: Schema<string, string, "defined">;
    embedRemoteModel: Schema<string, string, "defined">;
    embedRemoteDimensions: Schema<number, number, "defined">;
    memoryMutate: Schema<boolean, boolean, "defined">;
    conflictFreeze: Schema<boolean, boolean, "defined">;
    skillsEnabled: Schema<boolean, boolean, "defined">;
    toolRoom: Schema<boolean, boolean, "defined">;
    toolGraph: Schema<boolean, boolean, "defined">;
    toolRuminate: Schema<boolean, boolean, "defined">;
    toolConflict: Schema<boolean, boolean, "defined">;
    toolMutate: Schema<boolean, boolean, "defined">;
}>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
    enabled: Schema<boolean, boolean, "defined">;
    capture: Schema<boolean, boolean, "defined">;
    distill: Schema<boolean, boolean, "defined">;
    recall: Schema<boolean, boolean, "defined">;
    reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
    distillProvider: Schema<string, string, "defined">;
    distillModel: Schema<string, string, "defined">;
    distillChain: Schema<({
        provider?: string | null | undefined;
        model?: string | null | undefined;
        reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
        provider: Schema<string, string, "defined">;
        model: Schema<string, string, "defined">;
        reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
    }>>[], "defined">;
    distillLayerChains: Schema<Schemastery.ObjectS<NoInfer<{
        l1: Schema<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: Schema<string, string, "defined">;
            model: Schema<string, string, "defined">;
            reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        l2: Schema<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: Schema<string, string, "defined">;
            model: Schema<string, string, "defined">;
            reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        l3: Schema<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: Schema<string, string, "defined">;
            model: Schema<string, string, "defined">;
            reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        l1: Schema<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: Schema<string, string, "defined">;
            model: Schema<string, string, "defined">;
            reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        l2: Schema<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: Schema<string, string, "defined">;
            model: Schema<string, string, "defined">;
            reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        l3: Schema<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: Schema<string, string, "defined">;
            model: Schema<string, string, "defined">;
            reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
    }>>, "defined">;
    distillBudgets: Schema<Schemastery.ObjectS<NoInfer<{
        extract: Schema<number, number, "defined">;
        dedup: Schema<number, number, "defined">;
        l2: Schema<number, number, "defined">;
        l3: Schema<number, number, "defined">;
        graph: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        extract: Schema<number, number, "defined">;
        dedup: Schema<number, number, "defined">;
        l2: Schema<number, number, "defined">;
        l3: Schema<number, number, "defined">;
        graph: Schema<number, number, "defined">;
    }>>, "defined">;
    distillMaxInputChars: Schema<number, number, "defined">;
    distillMode: Schema<"" | "host" | "direct", "" | "host" | "direct", "defined">;
    directBaseURL: Schema<string, string, "defined">;
    directApiKey: Schema<string, string, "defined">;
    embedRemoteBaseURL: Schema<string, string, "defined">;
    embedRemoteApiKey: Schema<string, string, "defined">;
    embedRemoteModel: Schema<string, string, "defined">;
    embedRemoteDimensions: Schema<number, number, "defined">;
    memoryMutate: Schema<boolean, boolean, "defined">;
    conflictFreeze: Schema<boolean, boolean, "defined">;
    skillsEnabled: Schema<boolean, boolean, "defined">;
    toolRoom: Schema<boolean, boolean, "defined">;
    toolGraph: Schema<boolean, boolean, "defined">;
    toolRuminate: Schema<boolean, boolean, "defined">;
    toolConflict: Schema<boolean, boolean, "defined">;
    toolMutate: Schema<boolean, boolean, "defined">;
}>>>, "volatile">;
export declare const memorySchema: Schema<Schemastery.ObjectS<NoInfer<{
    dataDir: Schema<string, string, "defined">;
    family: Schema<"chat" | "work" | "auto", "chat" | "work" | "auto", "defined">;
    scope: Schema<string, string, "defined">;
    capture: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        stripCodeBlocks: Schema<boolean, boolean, "defined">;
        maxMessageChars: Schema<number, number, "defined">;
        redactSecrets: Schema<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        stripCodeBlocks: Schema<boolean, boolean, "defined">;
        maxMessageChars: Schema<number, number, "defined">;
        redactSecrets: Schema<boolean, boolean, "defined">;
    }>>, "plain">;
    trace: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        retentionDays: Schema<number, number, "defined">;
        captureContent: Schema<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        retentionDays: Schema<number, number, "defined">;
        captureContent: Schema<boolean, boolean, "defined">;
    }>>, "plain">;
    extract: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        minMessages: Schema<number, number, "defined">;
        idleSeconds: Schema<number, number, "defined">;
        backgroundMessages: Schema<number, number, "defined">;
        candidatePool: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        minMessages: Schema<number, number, "defined">;
        idleSeconds: Schema<number, number, "defined">;
        backgroundMessages: Schema<number, number, "defined">;
        candidatePool: Schema<number, number, "defined">;
    }>>, "plain">;
    l2: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        minNewMemories: Schema<number, number, "defined">;
        maxScenes: Schema<number, number, "defined">;
        sceneContextLimit: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        minNewMemories: Schema<number, number, "defined">;
        maxScenes: Schema<number, number, "defined">;
        sceneContextLimit: Schema<number, number, "defined">;
    }>>, "plain">;
    l3: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        interval: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        interval: Schema<number, number, "defined">;
    }>>, "plain">;
    graph: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
    }>>, "plain">;
    conflictFreeze: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        maxPending: Schema<number, number, "defined">;
        timeoutDays: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        maxPending: Schema<number, number, "defined">;
        timeoutDays: Schema<number, number, "defined">;
    }>>, "plain">;
    memport: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        scanMaxRecords: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        scanMaxRecords: Schema<number, number, "defined">;
    }>>, "plain">;
    skills: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        inject: Schema<boolean, boolean, "defined">;
        allowPromote: Schema<boolean, boolean, "defined">;
        minSessions: Schema<number, number, "defined">;
        minEvidence: Schema<number, number, "defined">;
        maxPerTurnBytes: Schema<number, number, "defined">;
        maxSkillCatalogBytes: Schema<number, number, "defined">;
        excerptChars: Schema<number, number, "defined">;
        idleArchiveDays: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        inject: Schema<boolean, boolean, "defined">;
        allowPromote: Schema<boolean, boolean, "defined">;
        minSessions: Schema<number, number, "defined">;
        minEvidence: Schema<number, number, "defined">;
        maxPerTurnBytes: Schema<number, number, "defined">;
        maxSkillCatalogBytes: Schema<number, number, "defined">;
        excerptChars: Schema<number, number, "defined">;
        idleArchiveDays: Schema<number, number, "defined">;
    }>>, "plain">;
    backfill: Schema<Schemastery.ObjectS<NoInfer<{
        maxRecords: Schema<number, number, "defined">;
        timeBudgetMs: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        maxRecords: Schema<number, number, "defined">;
        timeBudgetMs: Schema<number, number, "defined">;
    }>>, "plain">;
    workspaceHints: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        routes: Schema<({
            path?: string | null | undefined;
            anyOf?: string[] | null | undefined;
            noneOf?: string[] | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            /** 归到哪个 workspace（绝对路径；写入前过 normalizeWorkspacePath）。 */
            path: Schema<string, string, "defined">;
            /** 命中任一关键词即归此路（小写子串匹配，已 NFKC 归一）。 */
            anyOf: Schema<string[], string[], "defined">;
            /** 出现任一排除词则此路不命中（用于「无 dsh 才算非 dsh 项目」）。 */
            noneOf: Schema<string[], string[], "defined">;
        }>>[], "defined">;
        maxRecords: Schema<number, number, "defined">;
        timeBudgetMs: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        routes: Schema<({
            path?: string | null | undefined;
            anyOf?: string[] | null | undefined;
            noneOf?: string[] | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            /** 归到哪个 workspace（绝对路径；写入前过 normalizeWorkspacePath）。 */
            path: Schema<string, string, "defined">;
            /** 命中任一关键词即归此路（小写子串匹配，已 NFKC 归一）。 */
            anyOf: Schema<string[], string[], "defined">;
            /** 出现任一排除词则此路不命中（用于「无 dsh 才算非 dsh 项目」）。 */
            noneOf: Schema<string[], string[], "defined">;
        }>>[], "defined">;
        maxRecords: Schema<number, number, "defined">;
        timeBudgetMs: Schema<number, number, "defined">;
    }>>, "plain">;
    memExport: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        root: Schema<string, string, "defined">;
        maxRecords: Schema<number, number, "defined">;
        timeBudgetMs: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        root: Schema<string, string, "defined">;
        maxRecords: Schema<number, number, "defined">;
        timeBudgetMs: Schema<number, number, "defined">;
    }>>, "plain">;
    usageScenario: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
    }>>, "plain">;
    narrativeTemplates: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
    }>>, "plain">;
    recallFeedback: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        announce: Schema<boolean, boolean, "defined">;
        affectRank: Schema<boolean, boolean, "defined">;
        excludeZero: Schema<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        announce: Schema<boolean, boolean, "defined">;
        affectRank: Schema<boolean, boolean, "defined">;
        excludeZero: Schema<boolean, boolean, "defined">;
    }>>, "plain">;
    recall: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        maxResults: Schema<number, number, "defined">;
        maxCharsPerMemory: Schema<number, number, "defined">;
        maxTotalRecallChars: Schema<number, number, "defined">;
        timeoutMs: Schema<number, number, "defined">;
        includePersona: Schema<boolean, boolean, "defined">;
        includeSceneNav: Schema<boolean, boolean, "defined">;
        strategy: Schema<"hybrid" | "keyword" | "embedding", "hybrid" | "keyword" | "embedding", "defined">;
        scoreThreshold: Schema<number, number, "defined">;
        decayHalfLifeDays: Schema<number, number, "defined">;
        scopeFence: Schema<Schemastery.ObjectS<NoInfer<{
            enabled: Schema<boolean, boolean, "defined">;
            crossRepoMultiplier: Schema<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: Schema<boolean, boolean, "defined">;
            crossRepoMultiplier: Schema<number, number, "defined">;
        }>>, "plain">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        maxResults: Schema<number, number, "defined">;
        maxCharsPerMemory: Schema<number, number, "defined">;
        maxTotalRecallChars: Schema<number, number, "defined">;
        timeoutMs: Schema<number, number, "defined">;
        includePersona: Schema<boolean, boolean, "defined">;
        includeSceneNav: Schema<boolean, boolean, "defined">;
        strategy: Schema<"hybrid" | "keyword" | "embedding", "hybrid" | "keyword" | "embedding", "defined">;
        scoreThreshold: Schema<number, number, "defined">;
        decayHalfLifeDays: Schema<number, number, "defined">;
        scopeFence: Schema<Schemastery.ObjectS<NoInfer<{
            enabled: Schema<boolean, boolean, "defined">;
            crossRepoMultiplier: Schema<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: Schema<boolean, boolean, "defined">;
            crossRepoMultiplier: Schema<number, number, "defined">;
        }>>, "plain">;
    }>>, "plain">;
    embedding: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        baseUrl: Schema<string, string, "defined">;
        apiKey: Schema<string, string, "defined">;
        model: Schema<string, string, "defined">;
        dimensions: Schema<number, number, "defined">;
        maxInputChars: Schema<number, number, "defined">;
        timeoutMs: Schema<number, number, "defined">;
        allowLocalModels: Schema<boolean, boolean, "defined">;
        mirror: Schema<string, string, "defined">;
        proxy: Schema<string, string, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        baseUrl: Schema<string, string, "defined">;
        apiKey: Schema<string, string, "defined">;
        model: Schema<string, string, "defined">;
        dimensions: Schema<number, number, "defined">;
        maxInputChars: Schema<number, number, "defined">;
        timeoutMs: Schema<number, number, "defined">;
        allowLocalModels: Schema<boolean, boolean, "defined">;
        mirror: Schema<string, string, "defined">;
        proxy: Schema<string, string, "defined">;
    }>>, "plain">;
    llm: Schema<Schemastery.ObjectS<NoInfer<{
        provider: Schema<string, string, "defined">;
        model: Schema<string, string, "defined">;
        mode: Schema<"host" | "direct", "host" | "direct", "defined">;
        baseURL: Schema<string, string, "defined">;
        apiKey: Schema<string, string, "defined">;
        fallbacks: Schema<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: Schema<string, string, "defined">;
            model: Schema<string, string, "defined">;
            reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        layerRoutes: Schema<Schemastery.ObjectS<NoInfer<{
            l1: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            l1: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, "defined">;
        maxTokens: Schema<number, number, "defined">;
        reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        temperature: Schema<number, number, "defined">;
        maxInputChars: Schema<number, number, "defined">;
        timeoutMs: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        provider: Schema<string, string, "defined">;
        model: Schema<string, string, "defined">;
        mode: Schema<"host" | "direct", "host" | "direct", "defined">;
        baseURL: Schema<string, string, "defined">;
        apiKey: Schema<string, string, "defined">;
        fallbacks: Schema<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: Schema<string, string, "defined">;
            model: Schema<string, string, "defined">;
            reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        layerRoutes: Schema<Schemastery.ObjectS<NoInfer<{
            l1: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            l1: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, "defined">;
        maxTokens: Schema<number, number, "defined">;
        reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        temperature: Schema<number, number, "defined">;
        maxInputChars: Schema<number, number, "defined">;
        timeoutMs: Schema<number, number, "defined">;
    }>>, "plain">;
    hall: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<string[], string[], "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<string[], string[], "defined">;
    }>>, "plain">;
    tokenCost: Schema<Schemastery.ObjectS<NoInfer<{
        retentionDays: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        retentionDays: Schema<number, number, "defined">;
    }>>, "plain">;
    slots: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        inject: Schema<boolean, boolean, "defined">;
        maxSlots: Schema<number, number, "defined">;
        maxAlwaysOnBytes: Schema<number, number, "defined">;
        maxBodyChars: Schema<number, number, "defined">;
        migrateLegacy: Schema<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        inject: Schema<boolean, boolean, "defined">;
        maxSlots: Schema<number, number, "defined">;
        maxAlwaysOnBytes: Schema<number, number, "defined">;
        maxBodyChars: Schema<number, number, "defined">;
        migrateLegacy: Schema<boolean, boolean, "defined">;
    }>>, "plain">;
    tools: Schema<boolean, boolean, "defined">;
    benchControl: Schema<boolean, boolean, "defined">;
    live: Schema<NoInfer<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        capture: Schema<boolean, boolean, "defined">;
        distill: Schema<boolean, boolean, "defined">;
        recall: Schema<boolean, boolean, "defined">;
        reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        distillProvider: Schema<string, string, "defined">;
        distillModel: Schema<string, string, "defined">;
        distillChain: Schema<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: Schema<string, string, "defined">;
            model: Schema<string, string, "defined">;
            reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        distillLayerChains: Schema<Schemastery.ObjectS<NoInfer<{
            l1: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            l1: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, "defined">;
        distillBudgets: Schema<Schemastery.ObjectS<NoInfer<{
            extract: Schema<number, number, "defined">;
            dedup: Schema<number, number, "defined">;
            l2: Schema<number, number, "defined">;
            l3: Schema<number, number, "defined">;
            graph: Schema<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            extract: Schema<number, number, "defined">;
            dedup: Schema<number, number, "defined">;
            l2: Schema<number, number, "defined">;
            l3: Schema<number, number, "defined">;
            graph: Schema<number, number, "defined">;
        }>>, "defined">;
        distillMaxInputChars: Schema<number, number, "defined">;
        distillMode: Schema<"" | "host" | "direct", "" | "host" | "direct", "defined">;
        directBaseURL: Schema<string, string, "defined">;
        directApiKey: Schema<string, string, "defined">;
        embedRemoteBaseURL: Schema<string, string, "defined">;
        embedRemoteApiKey: Schema<string, string, "defined">;
        embedRemoteModel: Schema<string, string, "defined">;
        embedRemoteDimensions: Schema<number, number, "defined">;
        memoryMutate: Schema<boolean, boolean, "defined">;
        conflictFreeze: Schema<boolean, boolean, "defined">;
        skillsEnabled: Schema<boolean, boolean, "defined">;
        toolRoom: Schema<boolean, boolean, "defined">;
        toolGraph: Schema<boolean, boolean, "defined">;
        toolRuminate: Schema<boolean, boolean, "defined">;
        toolConflict: Schema<boolean, boolean, "defined">;
        toolMutate: Schema<boolean, boolean, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        capture: Schema<boolean, boolean, "defined">;
        distill: Schema<boolean, boolean, "defined">;
        recall: Schema<boolean, boolean, "defined">;
        reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        distillProvider: Schema<string, string, "defined">;
        distillModel: Schema<string, string, "defined">;
        distillChain: Schema<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: Schema<string, string, "defined">;
            model: Schema<string, string, "defined">;
            reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        distillLayerChains: Schema<Schemastery.ObjectS<NoInfer<{
            l1: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            l1: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, "defined">;
        distillBudgets: Schema<Schemastery.ObjectS<NoInfer<{
            extract: Schema<number, number, "defined">;
            dedup: Schema<number, number, "defined">;
            l2: Schema<number, number, "defined">;
            l3: Schema<number, number, "defined">;
            graph: Schema<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            extract: Schema<number, number, "defined">;
            dedup: Schema<number, number, "defined">;
            l2: Schema<number, number, "defined">;
            l3: Schema<number, number, "defined">;
            graph: Schema<number, number, "defined">;
        }>>, "defined">;
        distillMaxInputChars: Schema<number, number, "defined">;
        distillMode: Schema<"" | "host" | "direct", "" | "host" | "direct", "defined">;
        directBaseURL: Schema<string, string, "defined">;
        directApiKey: Schema<string, string, "defined">;
        embedRemoteBaseURL: Schema<string, string, "defined">;
        embedRemoteApiKey: Schema<string, string, "defined">;
        embedRemoteModel: Schema<string, string, "defined">;
        embedRemoteDimensions: Schema<number, number, "defined">;
        memoryMutate: Schema<boolean, boolean, "defined">;
        conflictFreeze: Schema<boolean, boolean, "defined">;
        skillsEnabled: Schema<boolean, boolean, "defined">;
        toolRoom: Schema<boolean, boolean, "defined">;
        toolGraph: Schema<boolean, boolean, "defined">;
        toolRuminate: Schema<boolean, boolean, "defined">;
        toolConflict: Schema<boolean, boolean, "defined">;
        toolMutate: Schema<boolean, boolean, "defined">;
    }>>>, "volatile">;
}>>, Schemastery.ObjectT<NoInfer<{
    dataDir: Schema<string, string, "defined">;
    family: Schema<"chat" | "work" | "auto", "chat" | "work" | "auto", "defined">;
    scope: Schema<string, string, "defined">;
    capture: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        stripCodeBlocks: Schema<boolean, boolean, "defined">;
        maxMessageChars: Schema<number, number, "defined">;
        redactSecrets: Schema<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        stripCodeBlocks: Schema<boolean, boolean, "defined">;
        maxMessageChars: Schema<number, number, "defined">;
        redactSecrets: Schema<boolean, boolean, "defined">;
    }>>, "plain">;
    trace: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        retentionDays: Schema<number, number, "defined">;
        captureContent: Schema<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        retentionDays: Schema<number, number, "defined">;
        captureContent: Schema<boolean, boolean, "defined">;
    }>>, "plain">;
    extract: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        minMessages: Schema<number, number, "defined">;
        idleSeconds: Schema<number, number, "defined">;
        backgroundMessages: Schema<number, number, "defined">;
        candidatePool: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        minMessages: Schema<number, number, "defined">;
        idleSeconds: Schema<number, number, "defined">;
        backgroundMessages: Schema<number, number, "defined">;
        candidatePool: Schema<number, number, "defined">;
    }>>, "plain">;
    l2: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        minNewMemories: Schema<number, number, "defined">;
        maxScenes: Schema<number, number, "defined">;
        sceneContextLimit: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        minNewMemories: Schema<number, number, "defined">;
        maxScenes: Schema<number, number, "defined">;
        sceneContextLimit: Schema<number, number, "defined">;
    }>>, "plain">;
    l3: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        interval: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        interval: Schema<number, number, "defined">;
    }>>, "plain">;
    graph: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
    }>>, "plain">;
    conflictFreeze: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        maxPending: Schema<number, number, "defined">;
        timeoutDays: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        maxPending: Schema<number, number, "defined">;
        timeoutDays: Schema<number, number, "defined">;
    }>>, "plain">;
    memport: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        scanMaxRecords: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        scanMaxRecords: Schema<number, number, "defined">;
    }>>, "plain">;
    skills: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        inject: Schema<boolean, boolean, "defined">;
        allowPromote: Schema<boolean, boolean, "defined">;
        minSessions: Schema<number, number, "defined">;
        minEvidence: Schema<number, number, "defined">;
        maxPerTurnBytes: Schema<number, number, "defined">;
        maxSkillCatalogBytes: Schema<number, number, "defined">;
        excerptChars: Schema<number, number, "defined">;
        idleArchiveDays: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        inject: Schema<boolean, boolean, "defined">;
        allowPromote: Schema<boolean, boolean, "defined">;
        minSessions: Schema<number, number, "defined">;
        minEvidence: Schema<number, number, "defined">;
        maxPerTurnBytes: Schema<number, number, "defined">;
        maxSkillCatalogBytes: Schema<number, number, "defined">;
        excerptChars: Schema<number, number, "defined">;
        idleArchiveDays: Schema<number, number, "defined">;
    }>>, "plain">;
    backfill: Schema<Schemastery.ObjectS<NoInfer<{
        maxRecords: Schema<number, number, "defined">;
        timeBudgetMs: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        maxRecords: Schema<number, number, "defined">;
        timeBudgetMs: Schema<number, number, "defined">;
    }>>, "plain">;
    workspaceHints: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        routes: Schema<({
            path?: string | null | undefined;
            anyOf?: string[] | null | undefined;
            noneOf?: string[] | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            /** 归到哪个 workspace（绝对路径；写入前过 normalizeWorkspacePath）。 */
            path: Schema<string, string, "defined">;
            /** 命中任一关键词即归此路（小写子串匹配，已 NFKC 归一）。 */
            anyOf: Schema<string[], string[], "defined">;
            /** 出现任一排除词则此路不命中（用于「无 dsh 才算非 dsh 项目」）。 */
            noneOf: Schema<string[], string[], "defined">;
        }>>[], "defined">;
        maxRecords: Schema<number, number, "defined">;
        timeBudgetMs: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        routes: Schema<({
            path?: string | null | undefined;
            anyOf?: string[] | null | undefined;
            noneOf?: string[] | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            /** 归到哪个 workspace（绝对路径；写入前过 normalizeWorkspacePath）。 */
            path: Schema<string, string, "defined">;
            /** 命中任一关键词即归此路（小写子串匹配，已 NFKC 归一）。 */
            anyOf: Schema<string[], string[], "defined">;
            /** 出现任一排除词则此路不命中（用于「无 dsh 才算非 dsh 项目」）。 */
            noneOf: Schema<string[], string[], "defined">;
        }>>[], "defined">;
        maxRecords: Schema<number, number, "defined">;
        timeBudgetMs: Schema<number, number, "defined">;
    }>>, "plain">;
    memExport: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        root: Schema<string, string, "defined">;
        maxRecords: Schema<number, number, "defined">;
        timeBudgetMs: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        root: Schema<string, string, "defined">;
        maxRecords: Schema<number, number, "defined">;
        timeBudgetMs: Schema<number, number, "defined">;
    }>>, "plain">;
    usageScenario: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
    }>>, "plain">;
    narrativeTemplates: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
    }>>, "plain">;
    recallFeedback: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        announce: Schema<boolean, boolean, "defined">;
        affectRank: Schema<boolean, boolean, "defined">;
        excludeZero: Schema<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        announce: Schema<boolean, boolean, "defined">;
        affectRank: Schema<boolean, boolean, "defined">;
        excludeZero: Schema<boolean, boolean, "defined">;
    }>>, "plain">;
    recall: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        maxResults: Schema<number, number, "defined">;
        maxCharsPerMemory: Schema<number, number, "defined">;
        maxTotalRecallChars: Schema<number, number, "defined">;
        timeoutMs: Schema<number, number, "defined">;
        includePersona: Schema<boolean, boolean, "defined">;
        includeSceneNav: Schema<boolean, boolean, "defined">;
        strategy: Schema<"hybrid" | "keyword" | "embedding", "hybrid" | "keyword" | "embedding", "defined">;
        scoreThreshold: Schema<number, number, "defined">;
        decayHalfLifeDays: Schema<number, number, "defined">;
        scopeFence: Schema<Schemastery.ObjectS<NoInfer<{
            enabled: Schema<boolean, boolean, "defined">;
            crossRepoMultiplier: Schema<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: Schema<boolean, boolean, "defined">;
            crossRepoMultiplier: Schema<number, number, "defined">;
        }>>, "plain">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        maxResults: Schema<number, number, "defined">;
        maxCharsPerMemory: Schema<number, number, "defined">;
        maxTotalRecallChars: Schema<number, number, "defined">;
        timeoutMs: Schema<number, number, "defined">;
        includePersona: Schema<boolean, boolean, "defined">;
        includeSceneNav: Schema<boolean, boolean, "defined">;
        strategy: Schema<"hybrid" | "keyword" | "embedding", "hybrid" | "keyword" | "embedding", "defined">;
        scoreThreshold: Schema<number, number, "defined">;
        decayHalfLifeDays: Schema<number, number, "defined">;
        scopeFence: Schema<Schemastery.ObjectS<NoInfer<{
            enabled: Schema<boolean, boolean, "defined">;
            crossRepoMultiplier: Schema<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: Schema<boolean, boolean, "defined">;
            crossRepoMultiplier: Schema<number, number, "defined">;
        }>>, "plain">;
    }>>, "plain">;
    embedding: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        baseUrl: Schema<string, string, "defined">;
        apiKey: Schema<string, string, "defined">;
        model: Schema<string, string, "defined">;
        dimensions: Schema<number, number, "defined">;
        maxInputChars: Schema<number, number, "defined">;
        timeoutMs: Schema<number, number, "defined">;
        allowLocalModels: Schema<boolean, boolean, "defined">;
        mirror: Schema<string, string, "defined">;
        proxy: Schema<string, string, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        baseUrl: Schema<string, string, "defined">;
        apiKey: Schema<string, string, "defined">;
        model: Schema<string, string, "defined">;
        dimensions: Schema<number, number, "defined">;
        maxInputChars: Schema<number, number, "defined">;
        timeoutMs: Schema<number, number, "defined">;
        allowLocalModels: Schema<boolean, boolean, "defined">;
        mirror: Schema<string, string, "defined">;
        proxy: Schema<string, string, "defined">;
    }>>, "plain">;
    llm: Schema<Schemastery.ObjectS<NoInfer<{
        provider: Schema<string, string, "defined">;
        model: Schema<string, string, "defined">;
        mode: Schema<"host" | "direct", "host" | "direct", "defined">;
        baseURL: Schema<string, string, "defined">;
        apiKey: Schema<string, string, "defined">;
        fallbacks: Schema<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: Schema<string, string, "defined">;
            model: Schema<string, string, "defined">;
            reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        layerRoutes: Schema<Schemastery.ObjectS<NoInfer<{
            l1: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            l1: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, "defined">;
        maxTokens: Schema<number, number, "defined">;
        reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        temperature: Schema<number, number, "defined">;
        maxInputChars: Schema<number, number, "defined">;
        timeoutMs: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        provider: Schema<string, string, "defined">;
        model: Schema<string, string, "defined">;
        mode: Schema<"host" | "direct", "host" | "direct", "defined">;
        baseURL: Schema<string, string, "defined">;
        apiKey: Schema<string, string, "defined">;
        fallbacks: Schema<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: Schema<string, string, "defined">;
            model: Schema<string, string, "defined">;
            reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        layerRoutes: Schema<Schemastery.ObjectS<NoInfer<{
            l1: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            l1: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, "defined">;
        maxTokens: Schema<number, number, "defined">;
        reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        temperature: Schema<number, number, "defined">;
        maxInputChars: Schema<number, number, "defined">;
        timeoutMs: Schema<number, number, "defined">;
    }>>, "plain">;
    hall: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<string[], string[], "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<string[], string[], "defined">;
    }>>, "plain">;
    tokenCost: Schema<Schemastery.ObjectS<NoInfer<{
        retentionDays: Schema<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        retentionDays: Schema<number, number, "defined">;
    }>>, "plain">;
    slots: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        inject: Schema<boolean, boolean, "defined">;
        maxSlots: Schema<number, number, "defined">;
        maxAlwaysOnBytes: Schema<number, number, "defined">;
        maxBodyChars: Schema<number, number, "defined">;
        migrateLegacy: Schema<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        inject: Schema<boolean, boolean, "defined">;
        maxSlots: Schema<number, number, "defined">;
        maxAlwaysOnBytes: Schema<number, number, "defined">;
        maxBodyChars: Schema<number, number, "defined">;
        migrateLegacy: Schema<boolean, boolean, "defined">;
    }>>, "plain">;
    tools: Schema<boolean, boolean, "defined">;
    benchControl: Schema<boolean, boolean, "defined">;
    live: Schema<NoInfer<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        capture: Schema<boolean, boolean, "defined">;
        distill: Schema<boolean, boolean, "defined">;
        recall: Schema<boolean, boolean, "defined">;
        reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        distillProvider: Schema<string, string, "defined">;
        distillModel: Schema<string, string, "defined">;
        distillChain: Schema<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: Schema<string, string, "defined">;
            model: Schema<string, string, "defined">;
            reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        distillLayerChains: Schema<Schemastery.ObjectS<NoInfer<{
            l1: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            l1: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, "defined">;
        distillBudgets: Schema<Schemastery.ObjectS<NoInfer<{
            extract: Schema<number, number, "defined">;
            dedup: Schema<number, number, "defined">;
            l2: Schema<number, number, "defined">;
            l3: Schema<number, number, "defined">;
            graph: Schema<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            extract: Schema<number, number, "defined">;
            dedup: Schema<number, number, "defined">;
            l2: Schema<number, number, "defined">;
            l3: Schema<number, number, "defined">;
            graph: Schema<number, number, "defined">;
        }>>, "defined">;
        distillMaxInputChars: Schema<number, number, "defined">;
        distillMode: Schema<"" | "host" | "direct", "" | "host" | "direct", "defined">;
        directBaseURL: Schema<string, string, "defined">;
        directApiKey: Schema<string, string, "defined">;
        embedRemoteBaseURL: Schema<string, string, "defined">;
        embedRemoteApiKey: Schema<string, string, "defined">;
        embedRemoteModel: Schema<string, string, "defined">;
        embedRemoteDimensions: Schema<number, number, "defined">;
        memoryMutate: Schema<boolean, boolean, "defined">;
        conflictFreeze: Schema<boolean, boolean, "defined">;
        skillsEnabled: Schema<boolean, boolean, "defined">;
        toolRoom: Schema<boolean, boolean, "defined">;
        toolGraph: Schema<boolean, boolean, "defined">;
        toolRuminate: Schema<boolean, boolean, "defined">;
        toolConflict: Schema<boolean, boolean, "defined">;
        toolMutate: Schema<boolean, boolean, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "defined">;
        capture: Schema<boolean, boolean, "defined">;
        distill: Schema<boolean, boolean, "defined">;
        recall: Schema<boolean, boolean, "defined">;
        reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        distillProvider: Schema<string, string, "defined">;
        distillModel: Schema<string, string, "defined">;
        distillChain: Schema<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: Schema<string, string, "defined">;
            model: Schema<string, string, "defined">;
            reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
        }>>[], "defined">;
        distillLayerChains: Schema<Schemastery.ObjectS<NoInfer<{
            l1: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            l1: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l2: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
            l3: Schema<({
                provider?: string | null | undefined;
                model?: string | null | undefined;
                reasoningEffort?: "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                provider: Schema<string, string, "defined">;
                model: Schema<string, string, "defined">;
                reasoningEffort: Schema<"" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "" | "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", "defined">;
            }>>[], "defined">;
        }>>, "defined">;
        distillBudgets: Schema<Schemastery.ObjectS<NoInfer<{
            extract: Schema<number, number, "defined">;
            dedup: Schema<number, number, "defined">;
            l2: Schema<number, number, "defined">;
            l3: Schema<number, number, "defined">;
            graph: Schema<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            extract: Schema<number, number, "defined">;
            dedup: Schema<number, number, "defined">;
            l2: Schema<number, number, "defined">;
            l3: Schema<number, number, "defined">;
            graph: Schema<number, number, "defined">;
        }>>, "defined">;
        distillMaxInputChars: Schema<number, number, "defined">;
        distillMode: Schema<"" | "host" | "direct", "" | "host" | "direct", "defined">;
        directBaseURL: Schema<string, string, "defined">;
        directApiKey: Schema<string, string, "defined">;
        embedRemoteBaseURL: Schema<string, string, "defined">;
        embedRemoteApiKey: Schema<string, string, "defined">;
        embedRemoteModel: Schema<string, string, "defined">;
        embedRemoteDimensions: Schema<number, number, "defined">;
        memoryMutate: Schema<boolean, boolean, "defined">;
        conflictFreeze: Schema<boolean, boolean, "defined">;
        skillsEnabled: Schema<boolean, boolean, "defined">;
        toolRoom: Schema<boolean, boolean, "defined">;
        toolGraph: Schema<boolean, boolean, "defined">;
        toolRuminate: Schema<boolean, boolean, "defined">;
        toolConflict: Schema<boolean, boolean, "defined">;
        toolMutate: Schema<boolean, boolean, "defined">;
    }>>>, "volatile">;
}>>, "plain">;
export declare function resolveDataDir(cfg: MemoryConfig): string;
/**
 * `wing.enabled` 归一化(R14 三条规则,唯一实现点):
 * ① **空数组保持为空** = 关闭 wing 打标(既有语义,`pipeline/l1.ts` 据此整段省略打标指令)
 *    ——不得被归一化补全吃掉,否则用户显式关闭的意图被静默撤销;
 * ② **含退休 id `general` → 补全 8 角全集**:含 `general` 的配置必然是旧默认
 *    (v0.12 词表),按子集解读会被静默缩到 2 角,故补全而非过滤;
 * ③ **不含 `general` 的其他子集原样保留**(尊重显式配置,不悄悄扩写)。
 */
export declare function normWingEnabled(raw: unknown): string[];
