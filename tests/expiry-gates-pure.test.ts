/**
 * 门2 注入过滤 + 图谱读时 as-of 的纯函数验收
 * （expiry-tiering task_3.6 / task_5.3 的数据侧；调用点门控由 recall 装配层保证）。
 */
import { describe, expect, it } from 'vitest';
import { filterInjectCandidates } from '../src/store/validity.js';
import { expandHitRecordIds, graphHitRecordIds, searchGraphNodes } from '../src/graph/search.js';
import type { GraphNodeSearchResult } from '../src/graph/types.js';
import type { GraphEdge, GraphNode } from '../src/graph/types.js';
import type { MemoryRecord } from '../src/types.js';

const NOW = Date.parse('2026-10-22T12:00:00Z');

function fake(id: string, extra: Partial<MemoryRecord>): MemoryRecord {
  return {
    id, content: 'c', type: 'work_fact', priority: 50, scene_name: 's',
    timestamps: [NOW], createdAt: NOW, updatedAt: NOW, ...extra,
  } as MemoryRecord;
}

const hit = (id: string) => ({ id });

describe('门2 filterInjectCandidates(task_3.6)', () => {
  const rows = new Map<string, MemoryRecord>([
    ['cur', fake('cur', { persistence: 'o' })],
    ['his', fake('his', { persistence: 'p' })],
    ['exp', fake('exp', { persistence: 'o', validTo: NOW - 1000, metadata: { dsh_validity: { state: 'expired', validToSource: 'evidence', basis: '', at: '' } } })],
    ['sus', fake('sus', { persistence: 'o', validTo: NOW - 1000 })], // 无标注 → unknown → expired_suspect
    ['gone', fake('gone', { metadata: { dsh_superseded: { at: '2026-10-01T00:00:00.000Z', reason: 'manual' } } })],
  ]);
  const all = ['cur', 'his', 'exp', 'sus', 'gone'].map(hit);

  it('剔除可信 expired;current/historical/expired_suspect 保留且 suspect 可标注', () => {
    const r = filterInjectCandidates(all, (id) => rows.get(id), NOW);
    expect(r.kept.map((k) => k.id)).toEqual(['cur', 'his', 'sus']);
    expect([...r.suspectIds]).toEqual(['sus']);
    expect(r.exited).toBe(1); // gone 现算为退场(防御档)
  });

  it('行缺失 fail-open(宁多注一条也不静默丢)', () => {
    const r = filterInjectCandidates([hit('ghost'), hit('cur')], (id) => rows.get(id), NOW);
    expect(r.kept.map((k) => k.id)).toEqual(['ghost', 'cur']);
  });

  it('全活跃集:kept 与入参逐项同序同集(灰度关时不进调用点,开时也不产生任何扰动)', () => {
    const r = filterInjectCandidates([hit('cur'), hit('his')], (id) => rows.get(id), NOW);
    expect(r.kept).toEqual([hit('cur'), hit('his')]);
    expect(r.suspectIds.size).toBe(0);
    expect(r.exited).toBe(0);
  });
});

// ── Phase 5:图谱读时 as-of(task_5.3)──────────────────────────────
function node(partial: Partial<GraphNode> & { id: string; name: string }): GraphNode {
  return {
    type: 'person', aliases: [], tags: [], currentState: '', facts: [],
    status: 'active', confidence: 0.8, sourceRecordIds: [], families: ['chat'],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  };
}
function edge(partial: Partial<GraphEdge> & { id: string; fromNodeId: string; toNodeId: string }): GraphEdge {
  return {
    relation: 'works_at', status: 'active', confidence: 0.8, sourceRecordIds: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  };
}

const nodes = [
  node({
    id: 'n1', name: 'ZhangSan',
    // 旧雇主 fact 已被取代(2026-03-01 闭);新雇主 fact active。
    // 词用拉丁专名:CJK 单字切分会让"甲司/乙司"互为子串,把隔离性测糊。
    facts: [
      { id: 'f1', key: 'employer', value: 'AlphaCorp', status: 'superseded', validFrom: '2025-01-01T00:00:00.000Z', validTo: '2026-03-01T00:00:00.000Z', confidence: 0.8, sourceRecordIds: ['s-old'], createdAt: '2025-01-01', updatedAt: '2026-03-01' },
      { id: 'f2', key: 'employer', value: 'BetaLabs', status: 'active', validFrom: '2026-03-01T00:00:00.000Z', confidence: 0.8, sourceRecordIds: ['s-new'], createdAt: '2026-03-01', updatedAt: '2026-03-01' },
    ],
  }),
  node({ id: 'n-old', name: 'AlphaCorp', type: 'organization', status: 'superseded', sourceRecordIds: ['s-old-node'] }),
];
const edges = [
  edge({ id: 'e-old', fromNodeId: 'n1', toNodeId: 'n-old', relation: 'works_at', status: 'superseded', validFrom: '2025-01-01T00:00:00.000Z', validTo: '2026-03-01T00:00:00.000Z', sourceRecordIds: ['s-edge'] }),
];

describe('Phase 5 图谱 as-of 读时派生(task_5.3)', () => {
  it('默认路径:superseded fact 不进检索文本(旧雇主搜不到,新雇主搜得到)', () => {
    expect(searchGraphNodes(nodes, edges, 'AlphaCorp', 8)).toHaveLength(0);
    const cur = searchGraphNodes(nodes, edges, 'BetaLabs', 8);
    expect(cur.map((h) => h.node.id)).toEqual(['n1']);
  });

  it('带 asOf=2026-01-15:当时成立的 superseded fact 进检索;区间外(superseded 已闭后)不可见', () => {
    const hits = searchGraphNodes(nodes, edges, 'AlphaCorp', 8, { asOf: '2026-01-15T00:00:00.000Z' });
    // 只命中 active 载体 n1(经旧 fact)；superseded 节点主体不复活(它没有 valid 区间列)
    expect(hits.map((h) => h.node.id)).toEqual(['n1']);
    // 闭区间后(asOf 晚于 validTo)旧 fact 不再成立;n-old 自身 superseded 也不复活
    expect(searchGraphNodes(nodes, edges, 'AlphaCorp', 8, { asOf: '2026-06-01T00:00:00.000Z' }))
      .toHaveLength(0);
  });

  it('expandHitRecordIds:默认只回 active 集;asOf 纳入当时成立的 superseded fact 与当时成立边的邻居来源', () => {
    const fake: GraphNodeSearchResult = { node: nodes[0]!, score: 1, matchedFields: ['name'], matchReason: 'test' };
    const cur = expandHitRecordIds([fake], nodes, edges);
    expect(cur).toContain('s-new');
    expect(cur).not.toContain('s-old'); // superseded fact 默认不回链
    expect(cur).not.toContain('s-old-node'); // superseded 邻居默认不回链
    const back = expandHitRecordIds([fake], nodes, edges, { asOf: '2026-01-15T00:00:00.000Z' });
    expect(back).toContain('s-old');
    // 既有纪律：hop 只取邻居节点的**身份来源**,边自身的来源从不入回链
    // ("hop 是联想不是证据,噪声从紧")——asOf 放宽的是"边可用"，不是"边来源可回链"。
    expect(back).toContain('s-old-node');
    expect(back).not.toContain('s-edge');
    // 直连回链的旧接口(graphHitRecordIds)保持零 hop 语义(只回 active 集身份来源)
    expect(graphHitRecordIds([fake])).toEqual(['s-new']);
  });
});
