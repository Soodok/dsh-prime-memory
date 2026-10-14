/**
 * 插件配置:Schemastery schema + 类型。
 *
 * 默认数据目录:$DSH_HOME/memory(用官方 dshHomePath 解析,DSH_HOME 缺省 ~/.dsh)。
 * 键名/默认值/取值范围是部署面契约(patch.yml 按"整行替换,不深合并"覆盖),不可更名。
 */
import Schema from '@deepseek-ai/schemastery';
/**
 * volatile 引用的本地结构声明——故意不从 cordis 输 `Volatile<T>`。
 *
 * 那个类型别名内部引用了 cosmokit 的私有名，拿它做导出成员的标注会让 d.ts 直接报
 * TS2742 “inferred type cannot be named”（实测：往 devDeps 加 cosmokit 也不消错，
 * 因为引用路径是 `.pnpm/@deepseek-ai+cosmokit@x` 这种私有目录）——整包 `npm run build`
 * 卡住，而 build 是 `tsc && build-client && copy-client`，tsc 一红就掐断前端产物。
 * 本插件只用 `.get()`，结构上兼容宿主给的真 `Volatile<T>`。
 */
export interface VolatileRef<T> {
  get(): T;
}
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import type { EffortChoice, LayerRouteKey, MemoryLiveSettings, StaticFallbackEntry } from './contract.js';
import type { ExtractMode, ScopeMode } from './types.js';
import type { WorkspaceRoute } from './workspace-route.js';
import { WING_DEFAULT_ENABLED, WING_FALLBACK } from './types.js';

/**
 * 蒸馏思考档位全词汇表(唯一事实源):'' = 自动(模型默认档 → high),
 * 其余为各适配器通用档位词汇(deepseek 认 'off',OpenAI 系是 'none')。
 * schema(config/settings)、运行时解析与 RPC 写入门共用,勿在别处再抄字面量表。
 */
export const EFFORT_CHOICES = ['', 'off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly EffortChoice[];

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
   * 名字沿革：本面曾叫 `workspaceHints`。那是“hints 时代”的遗产——当时归属靠来源链
   * （session_id / 锚点 sessionId / 会话树路径反解）**猜**，证据弱所以只当提示。实测来源链三处
   * 断裂（见下），主判据已换成内容路由：路由表是**权威裁决**而不是提示，它直接决定写盘落点。
   * 硬改名不留兼容别名：`workspaceHints` 从未随任何发版外发，现网 profile 里不存在该键的已存值，
   * 加别名等于养第二个事实源。
   *
   * 为什么不用「产生它的会话」定位：实测 `l1_records.session_id` 恒为 `default`（废字段），
   * 锚点里的 sessionId 能在磁盘会话树里找到目录的只占 7.3%（树会被清理/隔离），
   * 而 L1 时间戳与 L0 两个时间列零命中——来路链不可依赖。内容路由不受锚点缺失影响。
   *
   * 默认**开**。开启后**只写 `workspace_id` 列、不改 `scope`**：可见性仍由 `scope` 决定
   * （`resolveRecordScope` 规则③ 的零漂移不破），所以对检索可见面零行为变化；
   * 但它**决定投射文件的落点根**（`targetFor` 按 workspace 优先生成 `<ws>/.agents/memory/`），
   * 这一点不像“提示”那样无害——也是当初叫 hints 名不副实的地方。
   */
  workspaceSource: {
    enabled: boolean;
    /** 路由表：按数组序取首个命中——dsh 侧在前，故双项目并存时归 dsh（用户口径）。 */
    routes: WorkspaceRoute[];
    /** 存量 re-link 的单次护栏。 */
    maxRecords: number;
    /** 存量 re-link 的墙钟预算(ms)。 */
    timeBudgetMs: number;
  };
  /**
   * md 投射与外部存档（N1/N8/N9）：**投射默认开**（用户定：“这个应该常开”）——
   * 整个 md 权威计划的前提就是“文件为内容权威 + 库为索引”，默认关就等于默认不用。
   * 会写盘：无 `workspace_id` 的落 `<dataDir>/memories/`，有归属的落 `<ws>/.agents/memory/`。
   * 但**反向同步（会写库的那一面）仍默认关**：风险不对称，且它需要先有一份导出跳过的基线。
   */
  memExport: {
    enabled: boolean;
    /** 投射根目录；空 = `<dataDir>/memories`。形状不合则回退默认并 warn，**不抛错**（投射是旁路，不能弄挂记忆）。 */
    root: string;
    /** 单次导出的**动作数**护栏（照 wing-backfill / workspace-relink 口径）：只数碰了磁盘的
     *  条（写入 / 补账 / 失败）。“未变且已记账”的不吃配额，否则第二次点击在同一批前 N 条上
     *  打转、`remaining` 永不递减；遍历总量由 `timeBudgetMs` 兜底。
     *
     *  默认 2000：本库量级就是 1000+ 条（真机 1210），旧的 300 意味着一次回填要点 4 次，
     *  而“再点一次继续”对人是隐形成本。面板上可经 `live.mdExportMaxRecords` 运行时改。 */
    maxRecords: number;
    /** 单次导出的墙钟预算(ms)。 */
    timeBudgetMs: number;
  };
  /**
   * P2 反向同步（md 文件 → 索引）：整面**默认关**。它与 `memExport` 分开开关是因为
   * **风险不对称**——导出只写文件，同步会写库。裁决全靠账本：账本为空（从没导出过）
   * 时同步什么都判不出来，所以必须先开 `memExport` 再开本项。
   */
  mdSync: {
    enabled: boolean;
    /** 单轮扫描文件数护栏。 */
    maxFiles: number;
    /** 单轮墙钟预算(ms)。 */
    timeBudgetMs: number;
  };
  /** 使用场景（G1）：抽取时产出“何时该浮现”数组落 metadata.dsh_usage_scenario。默认关，关时抽取产物逐字不变。 */
  usageScenario: {
    enabled: boolean;
  };
  /**
   * 关键词蒸馏回填（keyword 检索轴的产出方）：**独立回填批扫**，为缺 `metadata.dsh_keywords` 的
   * L1 记录批量补关键词，喂 `l1_fts` 的关键词轴（`ftsKeywordText` 读该键）。由
   * `dsh-memory/keyword-backfill` 端点触发，镜像 wing 回填（单飞/后台/有界）。
   *
   * **默认关**：关时不回填、不产该键、`l1_fts.keywords` 列逐字不变（零漂移）。护栏复用 `backfill`。
   * 注：写回走 `patchMetadata` 只改主表，回填会**额外重索引该记录的 fts 行**（见 keyword-backfill），
   * 否则关键词轴对存量记录不生效。
   */
  keyword: {
    enabled: boolean;
  };
  /**
   * 类型叙述模板（G2）：抽取时按 7 类型各自的“前因后果”骨架写 content。
   *
   * 默认从 false 改 **true**（用户定的可用性判据：“没有前因后果、写不全就不算可用”）。
   * 单开它还不够：`tools/ab-distill.mjs` 实测只给定义不给示例时，真会话 23 条产出
   * **骨架齐备 0 条**——定义本身不被遵守，所以必须与 `naming.fewShot` 同开。
   */
  narrativeTemplates: {
    enabled: boolean;
  };
  /**
   * 名称蒸馏（pm-name-distill Phase 3）：让抽取当场就产出 `title`（与 content 分离定义），
   * 而不是事后拿正则从正文剪。
   *
   * 两个开关都默认开，但**两者不对称**：关着时 prompt 与产物逐字不变（零漂移仍由
   * `tests/prompt-fewshot.test.ts` 的 `off === 常量` 断言钉住），而默认值本身是实测定的：
   * `tools/ab-distill.mjs` 在真会话上量到 无示例 0.000 vs 有示例 0.703 骨架齐备率
   * （title 出现率 0.565 → 0.730，整批解析失败 1/8 → 0/8）。
   * 注意示例段只对**抽取任务**有收益：`tools/ab-naming.mjs` 量到把它塞进存量改名
   * 那条命名提示反而 −0.113（模型开始漏答条目）。同一堆例子放错任务就是负收益。
   */
  naming: {
    /** 开=抽取与去重 merge 都要求产出 title，并把它当文件身份名候选入库（过不了闸仍交给起名器）。 */
    enabled: boolean;
    /**
     * 开=在系统提示尾部追加标准格式示例段。每轮蒸馏都付它（约 1.2–1.4k 字），
     * 默认开是因为实测显示“只给定义”的结构齐备率为 0；不想要结构时可以单关这一项。
     */
    fewShot: boolean;
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
    budgets?: Partial<{ extract: number; dedup: number; l2: number; l3: number; graph: number }>;
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
  live: VolatileRef<MemoryLiveSettings>;
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
export function liveSettingsSchema(): VolatileRef<MemoryLiveSettings> {
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
  const maybe = node as unknown as { volatile?: () => unknown };
  return (typeof maybe.volatile === 'function' ? maybe.volatile() : node) as VolatileRef<MemoryLiveSettings>;
}

/**
 * 导出面形状：宿主按 Standard Schema 接口消费它，测试把它当函数调（取默认值解算结果）。
 *
 * 为何不靠推断：`memorySchema` 的 `live` 节经 `.volatile()` 会把 schemastery 的 Mode 推成
 * 'volatile'，而 `SchemaOutput<…,'volatile'> = Volatile<T>` 里的那个 `Volatile` 来自 cordis
 * 私带的那份 cosmokit（只在 `.pnpm` 私有目录可寻址）⇒ 导出的 d.ts 无法命名该类型，tsc 报
 * TS2742，`npm run build` 与 `npm pack` 整链失败（实测 HEAD 亦然，本包并非这次才红）。
 * 显式标注成本包自己声明的形状，既保住「可调用 + 可挂属性」的实际用法，又让 d.ts 可移植。
 */
export type ConfigSchema = ((value: unknown) => MemoryConfig) & Record<string, unknown>;

export const memorySchema: ConfigSchema = Schema.object({
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
}) as unknown as ConfigSchema;

export function resolveDataDir(cfg: MemoryConfig): string {
  if (cfg.dataDir) return cfg.dataDir;
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
export function normWingEnabled(raw: unknown): string[] {
  const ids = Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
    : [];
  if (ids.length === 0) return [];
  if (ids.includes(WING_FALLBACK)) return [...WING_DEFAULT_ENABLED];
  return ids;
}
