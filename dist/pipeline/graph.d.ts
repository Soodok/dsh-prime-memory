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
import type { GraphStore } from '../store/graph-store.js';
import type { MemoryLogger, MemoryRecord } from '../types.js';
import type { GraphEdge, GraphNode, GraphProjectionResult } from '../graph/types.js';
/** claim 上下文装配的节点上限(词法相关 + 最近更新,总量封顶)。 */
export declare const GRAPH_CONTEXT_NODE_LIMIT = 80;
/** 保底携带的最近更新节点数(图谱冷启动后有"当前关注点"锚)。 */
export declare const GRAPH_CONTEXT_RECENT_NODES = 24;
/** claim 上下文装配的边上限。 */
export declare const GRAPH_CONTEXT_EDGE_LIMIT = 120;
/**
 * 选择进入投影上下文的已有节点:与批内记录词法相关(名称/别名/标签与记录内容
 * token 相交,归一去重)优先,再按更新时间新→旧补足最近节点,总量 ≤80。
 * 词法相关的判定复用 normalizeEntityName + tokenize,不 includes。
 */
export declare function selectContextNodes(records: readonly MemoryRecord[], nodes: readonly GraphNode[], limit?: number): GraphNode[];
/** 选择进入上下文的边:两端都入选节点的 active 边,按更新时间新→旧,≤120。 */
export declare function selectContextEdges(nodes: readonly GraphNode[], edges: readonly GraphEdge[], limit?: number): GraphEdge[];
/**
 * 瞬态失败判据(与永久错误分流,由 GraphStore.fail 选不同重试封顶)。
 *
 * 真机归因(2026-10-20 审计):14 个 dead 全是 `llm aborted: Request was aborted` ×13 +
 * `llm error: terminated` ×1——零校验类失败,全部是网关负载/超时把在飞请求掉断。
 * 这类错误与 prompt/数据无关,退避后重试即可恢复,不该和“模型真的产坏了”同封顶。
 * 匹配串源自 callLLM/callRoute/callDirect 的实际抛出形态(小写子串包含)。
 */
export declare function isTransientGraphFailure(msg: string): boolean;
/**
 * 节点向量化的嵌入文本(单一形态定义,读写两侧共用):
 * 实体名 + 别名 + 当前状态串。读侧种子查询用用户 query 的文本向量,
 * 两边同嵌入源同空间即可——不追求"同一句话",追求"同一语义面"。
 */
export declare function nodeEmbedText(node: GraphNode): string;
/**
 * 投影收尾的节点向量补写(G-vec 缺陷修:此前 upsertNodeVectors 生产零调用点,
 * 嵌入开着时 graph_node_vec 永远是 0 行,"向量种子"读路结构性空转)。
 *
 * 失败隔离:嵌入失败/未就绪只 warn——向量是召回增益,缺了它图谱词法路照常,
 * 绝不能把一个旁路补算弄挂投影主流程(与 L1 侧 restore 的向量纪律同向)。
 */
export declare function writeNodeVectorsAfterComplete(graphs: GraphStore, touched: readonly GraphNode[], embed: ((text: string) => Promise<Float32Array | undefined>) | undefined, logger: MemoryLogger): Promise<number>;
/**
 * 执行一次图谱投影(claim 一个 job → LLM → 校验落库;无 job 时静默返回)。
 * 返回是否实际认领了任务(泵据此决定是否续排)。失败转 fail(退避/封顶由
 * GraphStore 管),不向 runner 上抛。
 */
export declare function runGraphProjection(ctx: Context, cfg: MemoryConfig, graphs: GraphStore, logger: MemoryLogger, 
/** 节点向量补算的嵌入缝(runner 接 stores.l1.embedText;缺席/未就绪 = 不补)。 */
embedNode?: (text: string) => Promise<Float32Array | undefined>): Promise<boolean>;
/** 投影输出解析与形状归一:非对象/缺数组字段回空结构(校验侧再逐条把关)。 */
export declare function parseProjection(raw: string, logger?: MemoryLogger): GraphProjectionResult;
