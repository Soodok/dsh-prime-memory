/**
 * 图谱投影管线:claim → 上下文装配 → LLM 投影 → 纯函数校验落库。
 *
 * LLM 调用发生在事务外(GraphStore 的 claim/complete 是两个独立事务缝)——
 * 单一 LLM 并发源仍是 runner 的串行泵,本文件不做任何并发控制。
 * 上下文装配的纯函数(selectContextNodes/selectContextEdges)独立导出,
 * 上下文有界性(节点 ≤80 / 边 ≤120 / 仅 active facts)是 G4 验收面。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { MemoryConfig } from '../config.js';
import { callLLM, parseJsonLogged, resolveLayerTokens } from '../llm.js';
import {
  buildGraphProjectionPrompt,
  getGraphProjectionSystemPrompt,
} from '../prompts/graph-projection.js';
import type { GraphStore } from '../store/graph-store.js';
import { normalizeEntityName } from '../graph/apply.js';
import { tokenize } from '../util/text.js';
import type { MemoryLogger, MemoryRecord } from '../types.js';
import type { GraphEdge, GraphNode, GraphProjectionResult } from '../graph/types.js';
import { GRAPH_PROJECTION_CALL_TIMEOUT_MS } from '../graph/types.js';
import { errDetail } from '../util/filelog.js';

/** claim 上下文装配的节点上限(词法相关 + 最近更新,总量封顶)。 */
export const GRAPH_CONTEXT_NODE_LIMIT = 80;
/** 保底携带的最近更新节点数(图谱冷启动后有"当前关注点"锚)。 */
export const GRAPH_CONTEXT_RECENT_NODES = 24;
/** claim 上下文装配的边上限。 */
export const GRAPH_CONTEXT_EDGE_LIMIT = 120;

/**
 * 选择进入投影上下文的已有节点:与批内记录词法相关(名称/别名/标签与记录内容
 * token 相交,归一去重)优先,再按更新时间新→旧补足最近节点,总量 ≤80。
 * 词法相关的判定复用 normalizeEntityName + tokenize,不 includes。
 */
export function selectContextNodes(
  records: readonly MemoryRecord[],
  nodes: readonly GraphNode[],
  limit: number = GRAPH_CONTEXT_NODE_LIMIT,
): GraphNode[] {
  if (nodes.length === 0 || limit <= 0) return [];
  // 批内记录的 token 集(小写已由 tokenize 统一)
  const recordTokens = new Set<string>();
  const names = new Set<string>();
  for (const r of records) {
    for (const t of tokenize(r.content)) recordTokens.add(t);
    for (const t of tokenize(r.scene_name)) recordTokens.add(t);
    for (const t of tokenize(r.type)) recordTokens.add(t);
  }
  const lexical: GraphNode[] = [];
  const rest: GraphNode[] = [];
  for (const node of nodes) {
    const keys = [node.name, ...node.aliases, ...(node.tags ?? [])].map(normalizeEntityName);
    if (keys.some((k) => names.has(k))) continue; // 已被更早节点覆盖的同名节点跳过
    for (const k of keys) names.add(k);
    const nodeTokens = new Set<string>();
    for (const t of tokenize(node.name)) nodeTokens.add(t);
    for (const t of node.aliases.flatMap((a) => tokenize(a))) nodeTokens.add(t);
    for (const t of (node.tags ?? []).flatMap((tag) => tokenize(tag))) nodeTokens.add(t);
    for (const t of tokenize(node.currentState)) nodeTokens.add(t);
    const related = [...nodeTokens].some((t) => recordTokens.has(t));
    (related ? lexical : rest).push(node);
  }
  // 词法相关优先(新→旧),其余按更新时间新→旧补足
  const byRecency = (a: GraphNode, b: GraphNode): number =>
    a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1;
  lexical.sort(byRecency);
  rest.sort(byRecency);
  return [...lexical, ...rest].slice(0, limit);
}

/** 选择进入上下文的边:两端都入选节点的 active 边,按更新时间新→旧,≤120。 */
export function selectContextEdges(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  limit: number = GRAPH_CONTEXT_EDGE_LIMIT,
): GraphEdge[] {
  if (edges.length === 0 || limit <= 0) return [];
  const ids = new Set(nodes.map((n) => n.id));
  return edges
    .filter((e) => e.status === 'active' && ids.has(e.fromNodeId) && ids.has(e.toNodeId))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, limit);
}

/**
 * 瞬态失败判据(与永久错误分流,由 GraphStore.fail 选不同重试封顶)。
 *
 * 真机归因(2026-10-20 审计):14 个 dead 全是 `llm aborted: Request was aborted` ×13 +
 * `llm error: terminated` ×1——零校验类失败,全部是网关负载/超时把在飞请求掉断。
 * 这类错误与 prompt/数据无关,退避后重试即可恢复,不该和“模型真的产坏了”同封顶。
 * 匹配串源自 callLLM/callRoute/callDirect 的实际抛出形态(小写子串包含)。
 */
export function isTransientGraphFailure(msg: string): boolean {
  const low = msg.toLowerCase();
  return (
    low.includes('aborted') ||
    low.includes('timeout') ||
    low.includes('timed out') ||
    low.includes('terminated') ||
    low.includes('empty output') ||
    low.includes('econn') ||
    low.includes('etimedout') ||
    low.includes('fetch failed') ||
    low.includes('socket hang') ||
    low.includes('network')
  );
}

/**
 * 节点向量化的嵌入文本(单一形态定义,读写两侧共用):
 * 实体名 + 别名 + 当前状态串。读侧种子查询用用户 query 的文本向量,
 * 两边同嵌入源同空间即可——不追求"同一句话",追求"同一语义面"。
 */
export function nodeEmbedText(node: GraphNode): string {
  return [node.name, ...node.aliases, node.currentState].filter((s) => s && s.trim()).join(' ');
}

/**
 * 投影收尾的节点向量补写(G-vec 缺陷修:此前 upsertNodeVectors 生产零调用点,
 * 嵌入开着时 graph_node_vec 永远是 0 行,"向量种子"读路结构性空转)。
 *
 * 失败隔离:嵌入失败/未就绪只 warn——向量是召回增益,缺了它图谱词法路照常,
 * 绝不能把一个旁路补算弄挂投影主流程(与 L1 侧 restore 的向量纪律同向)。
 */
export async function writeNodeVectorsAfterComplete(
  graphs: GraphStore,
  touched: readonly GraphNode[],
  embed: ((text: string) => Promise<Float32Array | undefined>) | undefined,
  logger: MemoryLogger,
): Promise<number> {
  if (!graphs.nodeVecReady || !embed || touched.length === 0) return 0;
  const rows: Array<{ nodeId: string; embedding: Float32Array; updatedAt?: string }> = [];
  for (const n of touched) {
    if (n.status !== 'active' && n.status !== 'disputed') continue;
    try {
      const v = await embed(nodeEmbedText(n));
      if (v && v.length > 0) rows.push({ nodeId: n.id, embedding: v, updatedAt: n.updatedAt });
    } catch (err) {
      logger.warn(`[memory] 节点向量计算失败(该节点跳过,词法路不受影响): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (rows.length === 0) return 0;
  const written = graphs.upsertNodeVectors(rows);
  if (written > 0) logger.debug?.(`[memory] 节点向量随投影写入 ${written} 条`);
  return written;
}

/**
 * 执行一次图谱投影(claim 一个 job → LLM → 校验落库;无 job 时静默返回)。
 * 返回是否实际认领了任务(泵据此决定是否续排)。失败转 fail(退避/封顶由
 * GraphStore 管),不向 runner 上抛。
 */
export async function runGraphProjection(
  ctx: Context,
  cfg: MemoryConfig,
  graphs: GraphStore,
  logger: MemoryLogger,
  /** 节点向量补算的嵌入缝(runner 接 stores.l1.embedText;缺席/未就绪 = 不补)。 */
  embedNode?: (text: string) => Promise<Float32Array | undefined>,
): Promise<boolean> {
  const claim = graphs.claimNext();
  if (!claim) return false;
  const { job, records } = claim;
  try {
    const graph = graphs.loadGraph();
    const ctxNodes = selectContextNodes(records, graph.nodes);
    const ctxEdges = selectContextEdges(ctxNodes, graph.edges);
    const raw = await callLLM(ctx, cfg, {
      system: getGraphProjectionSystemPrompt(),
      user: buildGraphProjectionPrompt({ records, nodes: ctxNodes, edges: ctxEdges }),
      maxTokens: resolveLayerTokens(cfg, 'graph'),
      layer: 'graph',
      logger,
      // 自带宽超时信号:不传则沿用 cfg.llm.timeoutMs(120s)——图谱批 prompt 在本地网关上
      // 实测 ~2min/job,正好撞线(14 dead 根因);照 backfill callTimeoutMs 先例给 240s。
      signal: AbortSignal.timeout(GRAPH_PROJECTION_CALL_TIMEOUT_MS),
    });
    const touched = graphs.complete(job.id, parseProjection(raw, logger), { now: new Date().toISOString() });
    // 投影落库后的向量收尾(G-vec 缺陷修):事务外做——嵌入是网络/推理调用,
    // LLM 与嵌入永不进事务缝是本文件头注释写死的既有纪律。
    await writeNodeVectorsAfterComplete(graphs, touched, embedNode, logger);
  } catch (err) {
    const detail = errDetail(err);
    logger.warn(`[memory] 图谱投影失败(job=${job.id},attempts=${job.attempts}): ${detail}`);
    // 瞬态(网关掉断/超时/空输出)与永久(校验/解析)分档——前者多给 3 次退避重试机会。
    graphs.fail(job.id, detail, { transient: isTransientGraphFailure(detail) });
  }
  return true;
}

/** 投影输出解析与形状归一:非对象/缺数组字段回空结构(校验侧再逐条把关)。 */
export function parseProjection(raw: string, logger?: MemoryLogger): GraphProjectionResult {
  const parsed = parseJsonLogged<Partial<GraphProjectionResult>>(raw, '图谱投影', logger);
  return {
    reason: typeof parsed?.reason === 'string' ? parsed.reason : '',
    nodes: Array.isArray(parsed?.nodes) ? parsed.nodes : [],
    edges: Array.isArray(parsed?.edges) ? parsed.edges : [],
  };
}
