/**
 * 图谱管线测试:claim 上下文有界(≤80 节点/≤120 边/词法优先)、泵调度优先级
 * (live > graph > rebuild)、假 LLM 端到端投影(claim → LLM → 硬校验落库)、
 * 提示词防漂移三钉(常量内插/golden 样例过 apply 零丢弃)。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { applyGraphProjection } from '../src/graph/apply.js';
import type { GraphEdge, GraphNode } from '../src/graph/types.js';
import { GRAPH_PROJECTION_EXAMPLE, getGraphProjectionSystemPrompt } from '../src/prompts/graph-projection.js';
import {
  GRAPH_CONTEXT_EDGE_LIMIT,
  GRAPH_CONTEXT_NODE_LIMIT,
  isTransientGraphFailure,
  parseProjection,
  runGraphProjection,
  selectContextEdges,
  selectContextNodes,
} from '../src/pipeline/graph.js';
import { pickNextTaskIndex, type PipelineTask } from '../src/pipeline/runner.js';
import { snapshotDistillUsage } from '../src/llm-usage.js';
import { MemoryDb } from '../src/store/sqlite.js';
import type { MemoryRecord } from '../src/types.js';
import type { MemoryConfig } from '../src/config.js';
import type { MemoryLogger } from '../src/types.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-graphpipe-'));
});
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const noopLogger: MemoryLogger = { info: () => {}, warn: () => {}, error: () => {} };

function rec(id: string, content: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    content,
    type: 'episodic',
    priority: 60,
    scene_name: '默认',
    timestamps: [Date.parse('2026-09-06T07:00:00.000Z')],
    createdAt: Date.parse('2026-09-06T07:00:00.000Z'),
    updatedAt: Date.parse('2026-09-06T07:00:00.000Z'),
    ...overrides,
  };
}

function node(id: string, name: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    name,
    type: 'person',
    aliases: [],
    currentState: '',
    facts: [],
    status: 'active',
    confidence: 0.8,
    sourceRecordIds: ['r0'],
    families: ['chat'],
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    ...overrides,
  };
}

/** 假宿主 ctx:单次流式回包固定文本;记录 stream 入参供断言。 */
function fakeCtx(response: string, captured?: { streamArgs?: Record<string, unknown> }): Context {
  return {
    llm: {
      async *stream(args: Record<string, unknown>) {
        if (captured) captured.streamArgs = args;
        yield { type: 'block-end', block: { type: 'text', text: response } };
        yield { type: 'usage', usage: { outputTokens: 120, reasoningTokens: 0 } };
        yield { type: 'finish', reason: { kind: 'normal' } };
      },
    },
    get: () => undefined,
    effect: (fn: () => (() => void) | void) => {
      const d = fn();
      return typeof d === 'function' ? d : () => {};
    },
    on: () => () => {},
  } as unknown as Context;
}

function graphCfg(): MemoryConfig {
  return {
    llm: { provider: 'p', model: 'm', mode: 'host', baseURL: '', apiKey: '', maxTokens: 65536, reasoningEffort: '', temperature: 0.3, maxInputChars: 100000, timeoutMs: 1000 },
  } as unknown as MemoryConfig;
}

describe('claim 上下文装配有界', () => {
  it('节点 ≤80:词法相关优先(新→旧),其余按最近更新补足', () => {
    const records = [rec('r1', '张三 参与了 GraphX 项目的联调')];
    const lexical = Array.from({ length: 40 }, (_, i) =>
      node(`lx-${i}`, `节点${i}`, { aliases: [], updatedAt: new Date(Date.parse('2026-09-01T00:00:00.000Z') + i * 1000).toISOString() }),
    );
    // 一个词法相关节点(name 与记录内容共现「张三」),更新时间较老
    const hit = node('hit', '张三', { updatedAt: '2026-08-01T00:00:00.000Z' });
    const filler = Array.from({ length: 120 }, (_, i) =>
      node(`f-${i}`, `填充${i}`, { updatedAt: new Date(Date.parse('2026-09-05T00:00:00.000Z') + i * 1000).toISOString() }),
    );
    const selected = selectContextNodes(records, [...filler, ...lexical, hit]);
    expect(selected).toHaveLength(GRAPH_CONTEXT_NODE_LIMIT);
    // 词法相关(含 hit)必须全部入选;hit 虽老但词法优先
    expect(selected.map((n) => n.id)).toContain('hit');
    // lx 节点与记录无词法交集:入选的是 hit(词法)+ 79 个最近更新的 filler
    const restCount = selected.filter((n) => n.id.startsWith('f-')).length;
    expect(restCount).toBe(GRAPH_CONTEXT_NODE_LIMIT - 1);
    expect(selected.filter((n) => n.id.startsWith('lx-'))).toHaveLength(0);
    // 补足的 filler 是最近更新的那批
    expect(selected.filter((n) => n.id.startsWith('f-')).map((n) => n.id)).toEqual(
      filler.slice(-restCount).reverse().map((n) => n.id),
    );
  });

  it('边 ≤120:只取 active 且两端都入选的边', () => {
    const nodes = [node('a', '甲'), node('b', '乙'), node('c', '丙')];
    // 显式标注 status 为 GraphRecordStatus 词汇(默认参数推断出的 string 收不进 GraphEdge)
    const edge = (id: string, from: string, to: string, status: GraphEdge['status'] = 'active') => ({
      id,
      fromNodeId: from,
      toNodeId: to,
      relation: '相关',
      status,
      confidence: 0.8,
      sourceRecordIds: ['r0'],
      createdAt: '2026-09-06T00:00:00.000Z',
      updatedAt: '2026-09-06T00:00:00.000Z',
    });
    const edges = [
      ...Array.from({ length: 130 }, (_, i) => edge(`e-${i}`, 'a', 'b')),
      edge('e-sup', 'a', 'b', 'superseded'), // 非 active 剔除
      edge('e-orphan', 'a', 'z', 'active'), // 端点未入选剔除
    ];
    const selected = selectContextEdges(nodes, edges);
    expect(selected).toHaveLength(GRAPH_CONTEXT_EDGE_LIMIT);
    expect(selected.every((e) => e.status === 'active' && e.toNodeId === 'b')).toBe(true);
    expect(selected.some((e) => e.id === 'e-sup' || e.id === 'e-orphan')).toBe(false);
  });
});

describe('泵调度优先级', () => {
  it('live > graph > rebuild', () => {
    const t = (kind: PipelineTask['kind']): PipelineTask => ({ kind, run: async () => {} });
    expect(pickNextTaskIndex([t('rebuild'), t('graph'), t('live')])).toBe(2);
    expect(pickNextTaskIndex([t('rebuild'), t('graph'), t('rebuild')])).toBe(1);
    expect(pickNextTaskIndex([t('rebuild'), t('rebuild')])).toBe(0);
  });
});

describe('提示词防漂移', () => {
  it('系统提示含全部节点类型与关键上限数字(与 constraints 内插)', () => {
    const prompt = getGraphProjectionSystemPrompt();
    for (const t of ['person', 'project', 'organization', 'tool', 'place']) expect(prompt).toContain(t);
    expect(prompt).toContain('160'); // name 上限
    expect(prompt).toContain('20'); // aliases 上限
    expect(prompt).toContain('12'); // tags 上限
    expect(prompt).toContain('使用'); // 关系词
    // G4 因果边：GRAPH_RELATION_WORDS 与 prompt 同源内插，四个因果词必须在提示词里。
    for (const causal of ['导致', '因为', '修复了', '取代']) expect(prompt).toContain(causal);
  });

  it('golden 样例(prompt 示例)过 apply 零丢弃——提示词与校验器同真值', () => {
    const records = [rec('rec-1', '张三参与 GraphX 项目,负责前端模块'), rec('rec-2', '张三用 VSCode 开发 GraphX')];
    let seq = 0;
    const outcome = applyGraphProjection({
      nodes: [],
      edges: [],
      records,
      result: { reason: '', nodes: GRAPH_PROJECTION_EXAMPLE.nodes as never, edges: GRAPH_PROJECTION_EXAMPLE.edges as never },
      allowedRecordIds: new Set(['rec-1', 'rec-2']),
      now: '2026-09-06T08:00:00.000Z',
      idFactory: (p) => `${p}-g${seq++}`,
    });
    expect(outcome.dropped).toBe(0);
    expect(outcome.nodeIds).toHaveLength(3);
    expect(outcome.edgeIds).toHaveLength(2);
  });

  it('parseProjection:缺数组字段归一为空;完全不可解析的输出抛错转 fail(可重试)', () => {
    expect(parseProjection('{"reason":"空"}')).toEqual({ reason: '空', nodes: [], edges: [] });
    expect(() => parseProjection('not json at all', noopLogger)).toThrow('JSON');
  });
});

describe('端到端投影(假 LLM)', () => {
  it('claim → LLM(graph 层记账)→ 硬校验落库', async () => {
    const db = new MemoryDb(join(dir, 'e2e.db'), 0);
    db.init();
    db.upsertL1(rec('rec-1', '张三参与 GraphX 项目,负责前端模块'));
    db.upsertL1(rec('rec-2', '张三用 VSCode 开发 GraphX'));
    expect(db.graphStore.queueGraphProjection(['rec-1', 'rec-2'], 10000)).toBe(1);
    const captured: { streamArgs?: Record<string, unknown> } = {};
    await runGraphProjection(
      fakeCtx(JSON.stringify(GRAPH_PROJECTION_EXAMPLE), captured),
      graphCfg(),
      db.graphStore,
      noopLogger,
    );
    // 落库:3 节点 2 边,零丢弃;job 完成、台账登记
    const { nodes, edges } = db.graphStore.loadGraph();
    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(2);
    const zhang = nodes.find((n) => n.name === '张三')!;
    expect(zhang.families).toEqual(['chat']); // 来源记录族并集
    expect(zhang.currentState).toContain('负责 GraphX');
    expect(db.graphStore.listJobs()[0]!.status).toBe('completed');
    expect(db.graphStore.queueGraphProjection(['rec-1', 'rec-2'], 10000)).toBe(0);
    // LLM 调用走 graph 层(maxTokens = 默认 8000,档位空 = 不传)
    expect(captured.streamArgs?.maxTokens).toBe(8000);
    expect(snapshotDistillUsage().layers.graph?.calls).toBe(1);
    db.close();
  });

  it('LLM 失败 → fail 退避,job 不消失不抛错', async () => {
    const db = new MemoryDb(join(dir, 'e2e-fail.db'), 0);
    db.init();
    db.upsertL1(rec('rec-1', '张三参与 GraphX 项目'));
    db.graphStore.queueGraphProjection(['rec-1'], 100);
    // 空输出 = callLLM 抛错(路由链走完后上抛)
    const emptyCtx = fakeCtx('');
    await runGraphProjection(emptyCtx, graphCfg(), db.graphStore, noopLogger);
    const job = db.graphStore.listJobs()[0]!;
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(1);
    expect(job.nextAttemptAt!).toBeGreaterThan(Date.now());
    db.close();
  });
});

describe('瞬态失败分类(isTransientGraphFailure)', () => {
  it('网关掉断/超时/网络/空输出判瞬态', () => {
    expect(isTransientGraphFailure('llm aborted: Request was aborted')).toBe(true);
    expect(isTransientGraphFailure('llm error: terminated')).toBe(true);
    expect(isTransientGraphFailure('direct empty output: http://x/m 端点返回 0 字符')).toBe(true);
    expect(isTransientGraphFailure('AbortError: This operation was aborted')).toBe(true);
    expect(isTransientGraphFailure('fetch failed: ECONNREFUSED')).toBe(true);
    expect(isTransientGraphFailure('socket hang up')).toBe(true);
  });
  it('校验/解析类判永久(不占瞬态重试位)', () => {
    expect(isTransientGraphFailure('invalid node type: foo')).toBe(false);
    expect(isTransientGraphFailure('JSON parse failed')).toBe(false);
    expect(isTransientGraphFailure('sourceRecordIds 引用了批外记录')).toBe(false);
  });
});
