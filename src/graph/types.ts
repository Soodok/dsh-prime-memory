/**
 * 知识图谱域模型与投影结果类型。
 *
 * 定位:图谱是 L1 记录的可重建投影,不是独立知识库——记录"发生过什么",
 * 图谱回答"人物/项目/组织/工具/地点现在是什么状态"。每个节点/fact/边都必须
 * 携带 sourceRecordIds 回链到 L1 记录,任何图谱结论都能沿
 * `节点/fact → sourceRecordIds → L1 记录 → JSONL 事实源` 追溯。
 *
 * 图谱三表(graph_nodes/graph_edges/graph_projection_jobs)可随时 drop 重造
 * (JSONL → L1 → 投影单向重建),因此这里的类型不承担磁盘契约职责——字段演进
 * 只要求投影作业重跑,不像 l1_records 的 DDL 那样逐字节冻结。
 */
import type { MemoryFamily, MemoryRecord } from '../types.js';

export type GraphNodeType = 'person' | 'project' | 'organization' | 'tool' | 'place';
export type GraphRecordStatus = 'active' | 'superseded' | 'disputed' | 'archived';

export interface GraphFact {
  id: string;
  key: string;
  value: string | string[];
  status: GraphRecordStatus;
  validFrom?: string;
  validTo?: string;
  confidence: number;
  sourceRecordIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GraphNode {
  id: string;
  name: string;
  type: GraphNodeType;
  aliases: string[];
  /** 语义角色标签(检索发现与展示用),只做附加元数据,不替代稳定 type。 */
  tags?: string[];
  /** 由全部 active facts 重建的状态串(key: value 逐行)。 */
  currentState: string;
  facts: GraphFact[];
  status: GraphRecordStatus;
  confidence: number;
  sourceRecordIds: string[];
  /** 来源记录的族并集(族过滤的唯一依据):纯档会话只见本族衍生节点,
   *  auto 会话不过滤。与记录侧 family 三级兜底同源(family ?? type 前缀推导)。 */
  families: MemoryFamily[];
  createdAt: string;
  updatedAt: string;
}

export interface GraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relation: string;
  status: GraphRecordStatus;
  validFrom?: string;
  validTo?: string;
  confidence: number;
  sourceRecordIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** 模型返回的节点提案(ref 是提案内临时引用,边靠它连线)。 */
export interface GraphNodeProjection {
  ref: string;
  name: string;
  type: GraphNodeType;
  aliases?: string[];
  tags?: string[];
  /** 单行状态描述(入库为 key='状态' 的 fact)。 */
  state?: string;
  facts?: Array<{ key: string; value: string | string[]; sourceRecordIds?: string[] }>;
  validFrom?: string;
  validTo?: string;
  status?: GraphRecordStatus;
  confidence?: number;
  sourceRecordIds: string[];
}

export interface GraphEdgeProjection {
  fromRef: string;
  toRef: string;
  relation: string;
  validFrom?: string;
  validTo?: string;
  status?: GraphRecordStatus;
  confidence?: number;
  sourceRecordIds: string[];
}

export interface GraphProjectionResult {
  reason: string;
  nodes: GraphNodeProjection[];
  edges: GraphEdgeProjection[];
}

/** 投影作业(持久化状态机 pending → running → completed/failed/dead)。 */
export interface GraphProjectionJob {
  id: string;
  /** 本批唯一事实来源(L1 record id);claim 后按 id 现查记录。 */
  sourceRecordIds: string[];
  /** 排序优先级:数值越大越先投(新蒸馏记录 > 存量补投影,见 GRAPH_PRIORITY_NEW)。 */
  priority: number;
  projectorVersion: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'dead';
  attempts: number;
  /** 指数退避的最早重试时刻(epoch ms;null = 立即可取)。 */
  nextAttemptAt: number | null;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** 图谱检索单条命中(score 只用于排序,不是事实置信度)。 */
export interface GraphNodeSearchResult {
  node: GraphNode;
  score: number;
  /** 命中发生在哪些字段(按权重降序;空数组不会出现——无命中不返回)。 */
  matchedFields: Array<'name' | 'aliases' | 'tags' | 'currentState' | 'facts' | 'relations' | 'type'>;
  /** 中文可解释匹配说明(面板/工具展示用)。 */
  matchReason: string;
}

/** 投影上下文(claim 时装配,LLM 调用与 complete 共用同一形状)。 */
export interface GraphProjectionContext {
  jobId: string;
  projectorVersion: number;
  /** 本批唯一事实来源(L1 记录)。 */
  records: MemoryRecord[];
  existingNodes: GraphNode[];
  existingEdges: GraphEdge[];
}

/** 投影版本号:提示词/校验语义升级时 +1,旧版本 job 全部作废重投影。 */
export const GRAPH_PROJECTOR_VERSION = 1;

/** 单 job 认领的记录数上限(批内上下文规模可控)。 */
export const GRAPH_JOB_BATCH = 8;

/** 新蒸馏记录的投影优先级(存量补投影 ≤9999,永不倒挂)。 */
export const GRAPH_PRIORITY_NEW = 10000;

/** 存量补投影的优先级(启动/周期补齐;恒低于新蒸馏)。 */
export const GRAPH_PRIORITY_BACKFILL = 100;

/** 单 job 最大尝试次数:claim 时 +1,达到即转 dead(不再重试)。 */
export const GRAPH_JOB_MAX_ATTEMPTS = 3;

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
