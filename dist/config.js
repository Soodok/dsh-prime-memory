/**
 * 插件配置:Schemastery schema + 类型。
 *
 * 默认数据目录:$DSH_HOME/memory(用官方 dshHomePath 解析,DSH_HOME 缺省 ~/.dsh)。
 * 键名/默认值/取值范围是部署面契约(patch.yml 按"整行替换,不深合并"覆盖),不可更名。
 */
import Schema from '@deepseek-ai/schemastery';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { WING_DEFAULT_ENABLED, WING_FALLBACK } from './types.js';
/**
 * 蒸馏思考档位全词汇表(唯一事实源):'' = 自动(模型默认档 → high),
 * 其余为各适配器通用档位词汇(deepseek 认 'off',OpenAI 系是 'none')。
 * schema(config/settings)、运行时解析与 RPC 写入门共用,勿在别处再抄字面量表。
 */
export const EFFORT_CHOICES = ['', 'off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
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
export function liveSettingsSchema() {
    const budget = () => Schema.number().min(0).max(1_000_000).default(0);
    // 层链条目形状与 distillChain 相同(档位必填、'' = 跟随);写入校验另在
    // settings-set 门做逐层 requireExplicitHead(schema 层只管形状默认,语义门在 host)
    const chainEntry = () => Schema.object({
        provider: Schema.string().default(''),
        model: Schema.string().default(''),
        reasoningEffort: Schema.union([...EFFORT_CHOICES]).default(''),
    });
    const node = Schema.object({
        enabled: Schema.boolean().default(true),
        capture: Schema.boolean().default(true),
        distill: Schema.boolean().default(true),
        recall: Schema.boolean().default(true),
        reasoningEffort: Schema.union([...EFFORT_CHOICES]).default(''),
        distillProvider: Schema.string().default(''),
        distillModel: Schema.string().default(''),
        distillChain: Schema.array(chainEntry()).default([]),
        distillLayerChains: Schema.object({
            l1: Schema.array(chainEntry()).default([]),
            l2: Schema.array(chainEntry()).default([]),
            l3: Schema.array(chainEntry()).default([]),
        }).default({ l1: [], l2: [], l3: [] }),
        distillBudgets: Schema.object({
            extract: budget(),
            dedup: budget(),
            l2: budget(),
            l3: budget(),
            // 图谱投影输出预算(投影 job 单批 ≤8 条记录,默认 8000)
            graph: budget(),
        }).default({ extract: 0, dedup: 0, l2: 0, l3: 0, graph: 0 }),
        distillMaxInputChars: Schema.number().min(0).max(1_000_000).default(0),
        // 蒸馏通道运行时覆盖:'' = 跟随部署 config / 'host' = 复用宿主 / 'direct' = 原生直连
        distillMode: Schema.union(['', 'host', 'direct']).default(''),
        directBaseURL: Schema.string().default(''),
        // 直连 apiKey 属机密:schema 只接受字符串,不回读到 UI、不落日志
        directApiKey: Schema.string().default(''),
        // 远程嵌入连接运行时覆盖(设置 UI 可编辑,替代部署 YAML;dimension 上限与部署 schema 一致)
        embedRemoteBaseURL: Schema.string().default(''),
        embedRemoteApiKey: Schema.string().default(''),
        embedRemoteModel: Schema.string().default(''),
        embedRemoteDimensions: Schema.number().min(0).max(8192).default(0),
        // 记忆写删权限门:默认 false(模型写删风险高,须显式在面板开启高权限模式)
        memoryMutate: Schema.boolean().default(false),
        /**
         * md 投射/后缀收敛的**单次文件更新预算**运行时覆盖（`0` = 跟随启动配置 `memExport.maxRecords`）。
         * 面板上就叫这个名字（设置页入口在 `client/src/tabs/ArchiveSection.tsx`）。
         *
         * 为什么要有这个键：投射面的量级随库增长（真机 1210 条），而它住在启动 YAML 里
         * 就要人改 `cordis.patch.yml` + 重启才能调大——一个只在“回填历史”时用一下的旋钮
         * 不该要求重启。生效路径在 `effectiveCfg`（与其他 live 键同一覆盖链）。
         */
        mdExportMaxRecords: Schema.number().min(0).max(10_000).default(0),
        // §C 人工冲突裁决总开关:默认 false(冻结消耗注意力,不可默认全开)
        conflictFreeze: Schema.boolean().default(false),
        // 轨2 技能结晶总开关(看板可拨):默认 false。开=注册 memory_skill_* 工具 + 注入 active 技能 + skills-* 端点可用。
        skillsEnabled: Schema.boolean().default(false),
        // 工具分组封印(v0.21.0):false = 该组工具不注册,从模型工具列表消失。
        // 核心读(memory_search/read_scene/receipts/conversation_search)与槽位三件不受控。
        toolRoom: Schema.boolean().default(true),
        toolGraph: Schema.boolean().default(true),
        toolRuminate: Schema.boolean().default(true),
        toolConflict: Schema.boolean().default(true),
        toolMutate: Schema.boolean().default(true),
    });
    // 探测后再标：`Schema.object(...).volatile()` 只在新版 schemastery 上有（格内实测：
    // cordis/schemastery 4.0.4 有、0.1.5-rc.3 解析到的 4.0.2 没有）。直接调用会让**整插件**
    // 在老线 load-failure——不是降级，是起不来。未标时读侧走 readLiveRef 的兜底路径：
    // 开关仍然生效（取宿主注入的冻结值），只是改值需要重启而不是热更。
    const maybe = node;
    return (typeof maybe.volatile === 'function' ? maybe.volatile() : node);
}
export const memorySchema = Schema.object({
    dataDir: Schema.string().default(''),
    family: Schema.union(['auto', 'chat', 'work']).default('auto'),
    // §E 可见范围:默认 global(既有部署不传该键 = 行为与改动前逐字一致)。
    // **实测**(schemastery):`Schema.union` 对非法值**抛错**——`$.x expected "a" | "b" but got "bogus"`;
    // `Schema.string()` 则原样透传。ADR-0008 条 4 要求「解析失败不阻断启动」
    // (历史上 `nullable` 崩溃整棵插件树的教训在案),故此处用 string + 消费侧 `normScope` 归一。
    // ⚠️ 既有 `family` 仍是 union,存在同款风险(传 'bogus' 会抛)——已登记 findings §17,不在本波修。
    scope: Schema.string().default('global'),
    capture: Schema.object({
        enabled: Schema.boolean().default(true),
        stripCodeBlocks: Schema.boolean().default(true),
        maxMessageChars: Schema.number().min(200).max(200_000).default(4000),
        // §C 默认开启:本地存储也不落明文密钥(决策记录见计划 spec §C)
        redactSecrets: Schema.boolean().default(true),
    }),
    trace: Schema.object({
        enabled: Schema.boolean().default(true),
        retentionDays: Schema.number().min(0).max(365).default(14),
        captureContent: Schema.boolean().default(false),
    }),
    extract: Schema.object({
        enabled: Schema.boolean().default(true),
        minMessages: Schema.number().min(1).max(100).default(6),
        idleSeconds: Schema.number().min(0).max(86_400).default(300),
        backgroundMessages: Schema.number().min(0).max(50).default(10),
        candidatePool: Schema.number().min(1).max(20).default(5),
    }),
    l2: Schema.object({
        enabled: Schema.boolean().default(true),
        minNewMemories: Schema.number().min(1).max(100).default(5),
        maxScenes: Schema.number().min(1).max(100).default(12),
        sceneContextLimit: Schema.number().min(0).max(20).default(3),
    }),
    l3: Schema.object({
        enabled: Schema.boolean().default(true),
        interval: Schema.number().min(1).max(200).default(20),
    }),
    // 知识图谱投影:默认关(新功能默认关,用户显式开启;开启后受运行时蒸馏门约束)
    graph: Schema.object({
        enabled: Schema.boolean().default(false),
    }),
    // §C 矛盾冻结:默认关。开启后去重决策词表多出 conflict 动作,冲突对停放待人工裁决。
    conflictFreeze: Schema.object({
        enabled: Schema.boolean().default(false),
        // 上限给"人会看"留出余量:100 条待裁决 ≈ 连续 5~20 轮蒸馏全在冲突,
        // 远超正常使用强度;真达到说明该调 prompt 而不是加容量。
        maxPending: Schema.number().min(0).max(10_000).default(100),
        // 30 天:足够跨过假期与项目间歇,又不至于让互相矛盾的两条记忆长期并列召回。
        timeoutDays: Schema.number().min(0).max(3650).default(30),
    }),
    // 轨3 memport Connect:默认关(新功能默认关)。scan 为**只读预览**，写库仍走 memory_import。
    memport: Schema.object({
        enabled: Schema.boolean().default(false),
        // 单源扫描上限（防极端大包在事件循环里阻塞 RPC；scan 是手动触发，仍留护栏）。
        scanMaxRecords: Schema.number().min(0).max(20_000).default(5000),
    }),
    // 轨2 技能结晶：默认关 + allowPromote 关（先只计数不晋升）。
    skills: Schema.object({
        enabled: Schema.boolean().default(false),
        inject: Schema.boolean().default(true),
        allowPromote: Schema.boolean().default(false),
        minSessions: Schema.number().min(1).max(100).default(3),
        minEvidence: Schema.number().min(1).max(1000).default(5),
        maxPerTurnBytes: Schema.number().min(0).max(8192).default(600),
        maxSkillCatalogBytes: Schema.number().min(0).max(8192).default(2048),
        excerptChars: Schema.number().min(0).max(4000).default(240),
        idleArchiveDays: Schema.number().min(0).max(3650).default(90),
    }),
    // wing 回填护栏：默认与旧行为一致(300 条 / 120s)，需一次多跑点时调大。
    backfill: Schema.object({
        maxRecords: Schema.number().min(1).max(10_000).default(300),
        timeBudgetMs: Schema.number().min(1000).max(1_800_000).default(120_000),
    }),
    /**
     * 内容路由：默认**开**（用户口径：谈到本仓/dsh 生态的记忆要归到本仓 workspace，
     * 而不是全托底到 `<dataDir>/memories`）。默认路由表就是用户给的两条归类规则（路径可改，不需改码）。
     */
    workspaceSource: Schema.object({
        enabled: Schema.boolean().default(true),
        routes: Schema.array(Schema.object({
            /**
             * 归到哪个 workspace（**workspace 根**，绝对路径；写入前过 normalizeWorkspacePath）。
             *
             * 存的不包含 `.agents/memory`：投射落点由 `targetFor` 算，它会在本值后拼上
             * `WORKSPACE_SUBDIR = ['.agents','memory']`。旧默认值把它写成了
             * `E:\test\rewrite-agently\.agents`，于是落点变成 `.agents\.agents\memory\`——
             * 而 `.agents` 目录确实存在，"目录不存在则退回单根"的护栏救不了这种形状，
             * 等于在仓里挂一棵没人认领的孤儿树。新增用例钉住这个不变式。
             */
            path: Schema.string().default(''),
            /** 命中任一关键词即归此路（小写子串匹配，已 NFKC 归一）。 */
            anyOf: Schema.array(Schema.string()).default([]),
            /** 出现任一排除词则此路不命中（用于「无 dsh 才算非 dsh 项目」）。 */
            noneOf: Schema.array(Schema.string()).default([]),
        })).default([
            {
                path: 'E:\\test\\rewrite-agently',
                // 'dsh' 子串已覆盖 mine-dsh-plugins 下所有插件名；把目录名单列出来是因为
                // 有些记忆只写了"某个插件"而没写 dsh- 前缀，那时这一项才顶用。
                anyOf: ['dsh', 'mine-dsh-plugins', 'cordis', 'prime-memory', 'brief-sidebar', 'host farm', 'inferglow-dsh'],
                noneOf: [],
            },
            {
                path: 'E:\\test\\agent-no-dsh',
                anyOf: ['hanako', 'hanaagent', 'openhanako', 'inferglow', 'pi-agent'],
                // 同一段内容又谈到 dsh 时属于 dsh 生态（如 Hanako 逆向用于反推 dsh 机制），归 dsh 侧。
                noneOf: ['dsh'],
            },
        ]),
        maxRecords: Schema.number().min(1).max(10_000).default(300),
        timeBudgetMs: Schema.number().min(1000).max(1_800_000).default(120_000),
    }),
    // md 投射与外部存档：**默认开**（写盘不影响检索，关掉只会让人看不到任何投影文件）。root 空串 = 用默认根（<dataDir>/memories），形状校验在投射器里做。
    memExport: Schema.object({
        enabled: Schema.boolean().default(true),
        root: Schema.string().default(''),
        maxRecords: Schema.number().min(1).max(10_000).default(2000),
        timeBudgetMs: Schema.number().min(1000).max(1_800_000).default(120_000),
    }),
    // P2 反向同步：默认关。文件数护栏比导出的条数护栏宽一些——一次目录扫描的代价
    // 低于一次全库渲染，但时间预算照同一口径（面板不能被卡住）。
    mdSync: Schema.object({
        enabled: Schema.boolean().default(false),
        maxFiles: Schema.number().min(1).max(20_000).default(2_000),
        timeBudgetMs: Schema.number().min(1000).max(1_800_000).default(120_000),
    }),
    // 使用场景（G1）：默认关；开时抽取 prompt 追加 usageScenario 指令（off 逐字不变）。
    usageScenario: Schema.object({
        enabled: Schema.boolean().default(false),
    }),
    // 关键词蒸馏回填：默认关（关时不回填、不产 dsh_keywords、FTS 逐字不变）；护栏复用 backfill。
    keyword: Schema.object({
        enabled: Schema.boolean().default(false),
    }),
    // 类型叙述模板（G2）：默认**开**；开时抽取 prompt 追加分类型 content 骨架（关时仍逐字不变）。
    // 默认值从关改开的理由写在上方接口注释：只给定义实测骨架齐备 0/23，
    // 而"没前因后果就不算可用"是用户定的判据，所以默认值要按可用性定而不是按保守定。
    narrativeTemplates: Schema.object({
        enabled: Schema.boolean().default(true),
    }),
    // 名称蒸馏（Phase 3）。两个开关的默认值都来自 A/B 实测，不是审美偏好：
    // `ab-distill.mjs`（真会话）+0.703 骨架齐备 → 默认开；`ab-naming.mjs`（存量改名）
    // −0.113 → 证明示例不能跨任务复用，所以抽取提示里的那段不注入命名脚本。
    naming: Schema.object({
        enabled: Schema.boolean().default(true),
        fewShot: Schema.boolean().default(true),
    }),
    // 召回相关度反馈：默认开（只新增写端点与播报，不改任何既有产物；播报需用户显式打 -1）。
    recallFeedback: Schema.object({
        enabled: Schema.boolean().default(true),
        announce: Schema.boolean().default(true),
        // 低分沉底/高分上浮默认开（这是打分的常规出口）；0 分硬剔除默认关。
        affectRank: Schema.boolean().default(true),
        excludeZero: Schema.boolean().default(false),
    }),
    recall: Schema.object({
        enabled: Schema.boolean().default(true),
        maxResults: Schema.number().min(1).max(20).default(5),
        // 截断是引流——工具路径返回全文(注入形态契约见 ADR-0001)
        maxCharsPerMemory: Schema.number().min(0).max(100_000).default(500),
        maxTotalRecallChars: Schema.number().min(0).max(100_000).default(2000),
        timeoutMs: Schema.number().min(0).max(60_000).default(5000),
        includePersona: Schema.boolean().default(true),
        includeSceneNav: Schema.boolean().default(true),
        strategy: Schema.union(['keyword', 'embedding', 'hybrid']).default('hybrid'),
        scoreThreshold: Schema.number().min(0).max(1).default(0.3),
        // 时效衰减:乘法软加权 + 地板 0.5;0=关(bench 基线可比性可 pin 0)
        decayHalfLifeDays: Schema.number().min(0).max(3650).default(30),
        // repo 软围栏(治理 W1):默认关=零漂移。开启也只是软减权非硬排除(P0-7:
        // cross-project 绝不围栏,四象限不塌缩)
        scopeFence: Schema.object({
            enabled: Schema.boolean().default(false),
            crossRepoMultiplier: Schema.number().min(0).max(1).default(0.2),
        }),
    }),
    embedding: Schema.object({
        enabled: Schema.boolean().default(false),
        baseUrl: Schema.string().default(''),
        apiKey: Schema.string().default(''),
        model: Schema.string().default(''),
        // 0 = 纯 FTS 模式(合法值,勿设 min>0)
        dimensions: Schema.number().min(0).max(8192).default(0),
        maxInputChars: Schema.number().min(100).max(100_000).default(5000),
        timeoutMs: Schema.number().min(1000).max(300_000).default(10_000),
        allowLocalModels: Schema.boolean().default(true),
        mirror: Schema.string().default('https://hf-mirror.com'),
        proxy: Schema.string().default(''),
    }),
    llm: Schema.object({
        provider: Schema.string().default(''),
        model: Schema.string().default(''),
        // 压缩通道:'host' 复用宿主(默认);'direct' 插件原生直连,失败回退宿主路由
        mode: Schema.union(['host', 'direct']).default('host'),
        baseURL: Schema.string().default(''),
        apiKey: Schema.string().default(''),
        // 回退链:每条路由各享全额 timeoutMs(慢 TTFT 模型的回退位要留足首包时间);
        // 条目档位经能力钳制后发送
        fallbacks: Schema.array(Schema.object({
            provider: Schema.string().default(''),
            model: Schema.string().default(''),
            reasoningEffort: Schema.union([...EFFORT_CHOICES]).default(''),
        })).default([]),
        // 按层静态路由链:每层一条完整链(头行须双显式——启动侧只做形状默认,
        // 语义校验在解析侧防御 + 设置页写入门;空数组 = 该层跟随全局)
        layerRoutes: Schema.object({
            l1: Schema.array(Schema.object({
                provider: Schema.string().default(''),
                model: Schema.string().default(''),
                reasoningEffort: Schema.union([...EFFORT_CHOICES]).default(''),
            })).default([]),
            l2: Schema.array(Schema.object({
                provider: Schema.string().default(''),
                model: Schema.string().default(''),
                reasoningEffort: Schema.union([...EFFORT_CHOICES]).default(''),
            })).default([]),
            l3: Schema.array(Schema.object({
                provider: Schema.string().default(''),
                model: Schema.string().default(''),
                reasoningEffort: Schema.union([...EFFORT_CHOICES]).default(''),
            })).default([]),
        }).default({ l1: [], l2: [], l3: [] }),
        // 推理模型的 reasoning 计入输出预算:各蒸馏层显式传分层预算,本值为未分层调用的兜底总闸
        maxTokens: Schema.number().min(1024).max(1_000_000).default(65_536),
        // 蒸馏思考档位:'' = 自动(按模型能力解析);显式值仅在该模型声明支持时发送。
        // 旧默认 'off' 在非 deepseek 模型上必炸(400/本地拒绝)
        reasoningEffort: Schema.union([...EFFORT_CHOICES]).default(''),
        temperature: Schema.number().min(0).max(2).default(0.3),
        // 模型上下文 1M token,日常压到 ~700k 使用(中文按 1 字≈1 token 保守折算)
        maxInputChars: Schema.number().min(1000).max(1_000_000).default(700_000),
        timeoutMs: Schema.number().min(1000).max(600_000).default(120_000),
    }),
    hall: Schema.object({
        enabled: Schema.array(Schema.string()).default([...WING_DEFAULT_ENABLED]),
    }),
    // token_cost 明细保留期(写入时滚动清理;0 = 永久保留)。成本看板「近 N 天」窗口上限同源
    tokenCost: Schema.object({
        retentionDays: Schema.number().min(0).max(3650).default(365),
    }),
    // 激活槽位(active slot):默认开(读/注入),但写路径受 live.memoryMutate 门控。
    // 全部 boolean/number,禁用 union —— 对齐 ADR-0008 条 4(解析失败不阻断启动);
    // 非法值不抛错(实测 Schema.union 对非法值抛错,会拖垮整棵插件树)。
    slots: Schema.object({
        enabled: Schema.boolean().default(true),
        inject: Schema.boolean().default(true),
        maxSlots: Schema.number().min(1).max(32).default(8),
        maxAlwaysOnBytes: Schema.number().min(128).max(16_384).default(2048),
        maxBodyChars: Schema.number().min(32).max(2048).default(512),
        // 旧 slot 语义迁移：默认关（不自动碰用户手动 pin 的常驻约定）。
        migrateLegacy: Schema.boolean().default(false),
    }),
    tools: Schema.boolean().default(true),
    benchControl: Schema.boolean().default(false),
    // 运行时开关:整个 volatile 节,设置页自动成表(0.1.7 起,见 liveSettingsSchema)
    live: liveSettingsSchema(),
});
export function resolveDataDir(cfg) {
    if (cfg.dataDir)
        return cfg.dataDir;
    return dshHomePath('memory');
}
/**
 * `wing.enabled` 归一化(R14 三条规则,唯一实现点):
 * ① **空数组保持为空** = 关闭 wing 打标(既有语义,`pipeline/l1.ts` 据此整段省略打标指令)
 *    ——不得被归一化补全吃掉,否则用户显式关闭的意图被静默撤销;
 * ② **含退休 id `general` → 补全 8 角全集**:含 `general` 的配置必然是旧默认
 *    (v0.12 词表),按子集解读会被静默缩到 2 角,故补全而非过滤;
 * ③ **不含 `general` 的其他子集原样保留**(尊重显式配置,不悄悄扩写)。
 */
export function normWingEnabled(raw) {
    const ids = Array.isArray(raw)
        ? raw.filter((x) => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
        : [];
    if (ids.length === 0)
        return [];
    if (ids.includes(WING_FALLBACK))
        return [...WING_DEFAULT_ENABLED];
    return ids;
}
