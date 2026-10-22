/** 投影版本号:提示词/校验语义升级时 +1,旧版本 job 全部作废重投影。 */
export const GRAPH_PROJECTOR_VERSION = 1;
/** 单 job 认领的记录数上限(批内上下文规模可控)。 */
export const GRAPH_JOB_BATCH = 8;
/** 新蒸馏记录的投影优先级(存量补投影 ≤9999,永不倒挂)。 */
export const GRAPH_PRIORITY_NEW = 10000;
/** 存量补投影的优先级(启动/周期补齐;恒低于新蒸馏)。 */
export const GRAPH_PRIORITY_BACKFILL = 100;
/** 单 job 最大尝试次数(永久错误:校验/解析类——3 次不过就 dead)。
 *  瞬态错误(aborted/timeout/网络)走 GRAPH_JOB_TRANSIENT_MAX_ATTEMPTS。 */
export const GRAPH_JOB_MAX_ATTEMPTS = 3;
/** 瞬态错误(attempt 不消耗到 3 即 dead):网关负载或超时引起的 aborted、
 *  terminated、网络抖动、模型空输出——这些与 prompt/数据无关，退避后重试即恢复。
 *  6 次 ≈ 5 轮退避(~30 分钟)覆盖 local-35 负载低谷。 */
export const GRAPH_JOB_TRANSIENT_MAX_ATTEMPTS = 6;
/** 图谱投影 LLM 单次调用超时(含整条回退链):沿用 llm.timeoutMs(120s) 在 8-record
 *  批 + 上下文节点/边 + 12 关系词 prompt 下真机撞线(14 dead 全是 aborted×13 + terminated×1)。
 *  照 backfill callTimeoutMs 先例给 240s,按「路由数 × 单路由耗时」留余量。 */
export const GRAPH_PROJECTION_CALL_TIMEOUT_MS = 240_000;
/** 失败指数退避基数:第 n 次失败后 nextAttemptAt = now + base × 2^(n-1)。 */
export const GRAPH_JOB_BACKOFF_BASE_MS = 60_000;
/** 单次检索返回上限的硬钳制(工具与 RPC 两侧共用同一钳制值)。 */
export const GRAPH_SEARCH_LIMIT_MAX = 20;
/** §D 第 3 路路内向量种子的节点条数上限(种子只是联想起点,独立于词法路 limit)。 */
export const GRAPH_VEC_SEED_CAP = 10;
/** 1-hop 边扩展回链的新增记录数封顶(hop 段专用名额,直连段不占;防 hub 节点邻接爆量)。 */
export const GRAPH_HOP_RECORD_CAP = 64;
/** 面板图谱预览:种子榜上限(画布片数)。 */
export const GRAPH_PREVIEW_SEEDS = 6;
/** 面板图谱预览:单种子绘制的邻居上限(超出置 truncated)。 */
export const GRAPH_PREVIEW_NEIGHBORS = 10;
/** 面板图谱预览:种子评分中因果边的权重(score = degree + causal×此值)——
 *  因果链比共现邻接更值得画,预览侧单源读 GRAPH_CAUSAL_RELATIONS。 */
export const GRAPH_PREVIEW_CAUSAL_WEIGHT = 2;
/** 全图星图（mode:'full'）节点上限：超限截断并置 truncated（截断标记而非硬拒——
 *  星图是展示面，宁可少画几颗也不报错；G6 舒适区 <2000 留余量）。 */
export const GRAPH_PREVIEW_FULL_NODES = 1500;
/** 全图星图 active 边上限（同一 truncated 语义；悬挂边已在截断前剔除）。 */
export const GRAPH_PREVIEW_FULL_EDGES = 3000;
