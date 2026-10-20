/**
 * Tab:图谱 —— 全图星图与邻域子图**共用同一张力导图**（G6 v5）。
 *
 * 两态只差数据裁剪，不再有两套画法：
 * - 全图：服务端 `mode:'full'` 下发的可见节点 × active 边一体渲染，可平移缩放、拖拽钉位、
 *   hover 点亮一度邻域、单击星点即以它为新起点展开邻域；
 * - 邻域：以 (起点, 跳数) 客户端 BFS 出子图喂同一个画布组件，起点强调一圈；
 *   隔离靠 React key=`起点|跳数`——换任一维度即重挂载新实例，布局态不互串。
 *
 * 起点推荐（服务端 preview.ts）：score = active 度数 + 因果边×2 加权——实机审计因果边
 * 占比 ~24%，因果链比共现邻接更值得画。排序/合并/截断/可见性语义全在服务端，这里只管画。
 *
 * 数据契约（src/contract.ts GraphPreviewResponse，已冻结）：
 * - `mode:'full'` 一次拿到 种子榜 + 全图块 + stats（同一 loadGraph）；
 * - pendingJobs>0 → 统计条"构建中 x/y"（x=jobsTotal-pendingJobs）。
 * - 邻域不再打 seedId 请求：子图与关系词都从 full 块本地算，少一次往返。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GraphPreviewResponse, GraphNodeGetResponse, RecordsMetaResponse, RecordMeta } from '../../../src/contract.js';
import type { GraphNode } from '../../../src/graph/types.js';
import type { RpcFn } from '../rpc.js';
import { S } from '../styles.js';
import { NButton } from '../ui/primitives.js';
import { MarkdownBody } from '../ui/MarkdownBody.js';
import { fmtTime, tagClass, typeLabel } from '../format.js';
import { EGO_HOPS_MAX, canGrow, clipName, egoSubgraph, groupNeighbors, type RawNeighbor } from './graph-ego-subgraph.js';
import { GraphCanvas } from './GraphCanvas.js';
import type { GraphFull } from './graph-canvas-data.js';

/** 绘制态:全图 / 邻域子图（同一画布组件，只差数据与取景）。 */
type GraphView = 'full' | 'ego';

/** 五类实体色:直接映射既有图表调色板(CostTab 先例),不引入新色值。 */
const TYPE_COLORS: Record<string, string> = {
  person: 'var(--dsh-mem-chart-1)',
  project: 'var(--dsh-mem-chart-2)',
  organization: 'var(--dsh-mem-chart-3)',
  tool: 'var(--dsh-mem-chart-4)',
  place: 'var(--dsh-mem-chart-5)',
};
const FALLBACK_COLOR = 'var(--dsh-mem-chart-6)';

/** 两态画布高度：全图给宽景，邻域留出下方关系清单的位置。 */
const FULL_H = 470;
const EGO_H = 400;
/** 关系清单最多列几行（超出给 +N，靠画布而不是列表承担浏览）。 */
const LIST_MAX = 40;

export function GraphTab(props: { rpc: RpcFn }) {
  const rpc = props.rpc;
  /** 种子榜 + 全图块响应（mount/刷新时重取；stats 与 full 的唯一来源）。 */
  const [board, setBoard] = useState<GraphPreviewResponse | null>(null);
  const [view, setView] = useState<GraphView>('full');
  /** 邻域起点（null=用榜首；换起点不改 hops，换 hops 不改起点）。 */
  const [egoSeed, setEgoSeed] = useState<string | null>(null);
  /** 跳数（1..EGO_HOPS_MAX）。 */
  const [hops, setHops] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 实体详情卡数据(邻域态自动拉取 graph-node-get + records-meta)。 */
  const [entityDetail, setEntityDetail] = useState<GraphNode | null>(null);
  const [sourceRecords, setSourceRecords] = useState<RecordMeta[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const call = useCallback(
    (payload: Record<string, unknown>) =>
      rpc('dsh-memory/graph-preview', payload).then((r) => {
        if (r && r.ok) return r.value as GraphPreviewResponse;
        throw new Error(r && r.error ? r.error.message : 'RPC error');
      }),
    [rpc],
  );

  /** 拉种子榜与全图块（进 Tab / 刷新 / 错误重试共用）。 */
  const loadBoard = useCallback(() => {
    setLoading(true);
    setError(null);
    call({ mode: 'full' })
      .then((v) => {
        setBoard(v);
        // 起点存活校验：投影推进后原起点可能已被归档/取代而不在可见集里
        const still = v.full?.nodes.some((n) => n.id === egoSeed);
        if (egoSeed && !still) setEgoSeed(null);
      })
      .catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
      .finally(() => setLoading(false));
  }, [call, egoSeed]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  /** 以某节点为起点展开邻域（全图单击、清单点击、chip 共用同一路径）。 */
  const openEgo = useCallback((id: string) => {
    setEgoSeed(id);
    setView('ego');
  }, []);

  const stats = board?.stats ?? null;
  const fullBlock = board?.full;
  const seedId = egoSeed ?? board?.seeds[0]?.node.id ?? null;

  // ── 实体详情自动拉取(邻域态下随 seedId 变化刷新) ────────────────
  useEffect(() => {
    if (view !== 'ego' || !seedId) { setEntityDetail(null); setSourceRecords([]); return; }
    let cancelled = false;
    setDetailLoading(true);
    rpc('dsh-memory/graph-node-get', { id: seedId })
      .then((r) => {
        if (cancelled) return;
        const resp = (r?.ok ? r.value : null) as GraphNodeGetResponse | null;
        const node = resp?.node ?? null;
        setEntityDetail(node);
        // 拉来源记录元数据
        const ids = node?.sourceRecordIds?.slice(0, 50) ?? [];
        if (ids.length === 0) { setSourceRecords([]); return; }
        return rpc('dsh-memory/records-meta', { ids }).then((mr) => {
          if (cancelled) return;
          const metaResp = (mr?.ok ? mr.value : null) as RecordsMetaResponse | null;
          setSourceRecords(metaResp?.items ?? []);
        });
      })
      .catch(() => { /* 详情卡失败不拖垂主视图 */ })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [view, seedId, rpc]);

  const meta = useMemo(() => new Map((fullBlock?.nodes ?? []).map((n) => [n.id, n])), [fullBlock]);
  const sub = useMemo(() => egoSubgraph(fullBlock, seedId, hops), [fullBlock, seedId, hops]);
  /** 稳定身份：画布组件按它建实例，每次渲染新建对象会导致 G6 反复重建。 */
  const subFull = useMemo<GraphFull>(
    () => ({ nodes: sub.nodes, edges: sub.edges, truncated: sub.truncated }),
    [sub],
  );
  const seedNode = seedId ? (meta.get(seedId) ?? null) : null;

  /** 起点的直连关系（服务端按边下发，同对节点多条关系在此合并成一条清单行）。 */
  const direct = useMemo(() => {
    if (!fullBlock || !seedId) return [];
    const rows: RawNeighbor[] = [];
    for (const e of fullBlock.edges) {
      let otherId: string | undefined;
      if (e.from === seedId) otherId = e.to;
      else if (e.to === seedId) otherId = e.from;
      else continue;
      const o = meta.get(otherId);
      if (!o) continue;
      rows.push({ id: o.id, name: o.name, type: o.type, relation: e.relation, causal: e.causal });
    }
    return groupNeighbors(rows);
  }, [fullBlock, seedId, meta]);

  /** 清单行：按跳数由近及远、同跳按名序；只列 1 跳以上（起点在标题里）。 */
  const rows = useMemo(() => {
    const relOf = new Map(direct.map((d) => [d.id, d]));
    const out: Array<{ id: string; name: string; type: string; depth: number; relations: string[]; causal: boolean }> = [];
    for (const n of sub.nodes) {
      const d = sub.depth.get(n.id) ?? 0;
      if (d === 0) continue;
      const g = relOf.get(n.id);
      out.push({ id: n.id, name: n.name, type: n.type, depth: d, relations: g?.relations ?? [], causal: g?.causal ?? false });
    }
    out.sort((a, b) => (a.depth !== b.depth ? a.depth - b.depth : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return out;
  }, [sub, direct]);

  const growable = useMemo(() => canGrow(fullBlock, seedId, hops), [fullBlock, seedId, hops]);
  const seedDegree = seedId ? (stats ? direct.length : 0) : 0;

  return (
    <div>
      {/* 统计条:三数 + 构建中进度(pendingJobs>0 才显,x=jobsTotal-pendingJobs) */}
      <div style={{ ...S.flexRow, marginBottom: 10 }}>
        <span style={S.muted}>
          {loading && board === null
            ? '加载中…'
            : stats
              ? `节点 ${stats.nodes} · 边 ${stats.edges} · 因果 ${stats.causalEdges}` +
                (stats.pendingJobs > 0 || (stats.deadJobs ?? 0) > 0
                  ? (stats.deadJobs && stats.deadJobs > 0
                    ? ` · 投影 完成${stats.jobsTotal - stats.pendingJobs - stats.deadJobs}/失败${stats.deadJobs}/排队${stats.pendingJobs}`
                    : ` · 构建中 ${stats.jobsTotal - stats.pendingJobs}/${stats.jobsTotal}`)
                  : '')
              : '—'}
        </span>
        {/* 清理历史 dead 作业(仅当有失败时显示) */}
        {stats && (stats.deadJobs ?? 0) > 0 ? (
          <button
            style={{ ...S.segBtn, fontSize: 11, padding: '1px 8px', cursor: 'pointer', marginLeft: 6 }}
            title={`删除 ${stats.deadJobs} 行历史失败记录(它们覆盖的记录已在排队中，不影响投影)`}
            onClick={() => {
              rpc('dsh-memory/graph-cleanup-dead', {}).then(() => loadBoard()).catch(() => {});
            }}
          >
            清理失败
          </button>
        ) : null}
        <div style={S.grow} />
        {/* 双态切换 */}
        <div style={S.seg}>
          <button style={view === 'full' ? { ...S.segBtn, ...S.segBtnOn } : S.segBtn} title="全图星图：所有可见实体与关系一张图" onClick={() => setView('full')}>
            全图
          </button>
          <button style={view === 'ego' ? { ...S.segBtn, ...S.segBtnOn } : S.segBtn} title="邻域子图：以起点按跳数裁剪的浮动小图" onClick={() => setView('ego')}>
            邻域
          </button>
        </div>
        {/* 跳数档位（仅邻域态；起点与跳数共同决定这一片的隔离边界） */}
        {view === 'ego' ? (
          <div style={S.seg} title="从起点向外展开几跳">
            {Array.from({ length: EGO_HOPS_MAX }, (_, i) => i + 1).map((h) => (
              <button
                key={h}
                style={hops === h ? { ...S.segBtn, ...S.segBtnOn } : S.segBtn}
                title={`展开到 ${h} 跳`}
                onClick={() => setHops(h)}
              >
                {h} 跳
              </button>
            ))}
          </div>
        ) : null}
        {view === 'ego' ? (
          <NButton
            onClick={() => {
              setView('full');
              setEgoSeed(null);
            }}
            title="回全图并清掉起点"
          >
            回全图
          </NButton>
        ) : null}
        <NButton onClick={loadBoard}>刷新</NButton>
      </div>

      {error ? (
        <div style={S.error}>
          {error} {' '}
          <NButton onClick={loadBoard}>重试</NButton>
        </div>
      ) : null}

      {/* 空态:图域为零(未启用或未投影)——与"构建中"分开说,前者要去开开关 */}
      {stats && stats.nodes === 0 && !error ? (
        <p style={S.intro}>
          图谱还没有内容。它在设置里是独立开关(概览 → 图谱投影),开启后存量记忆会逐批投影成实体与关系。
        </p>
      ) : null}

      {/* 种子 chip 行(榜单态;点任一 chip = 以它为起点展开邻域) */}
      {board && board.seeds.length > 1 && view === 'full' ? (
        <div style={{ ...S.flexRow, marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
          {board.seeds.map((s) => (
            <button
              key={s.node.id}
              className={egoSeed === s.node.id ? 'dsh-mem-tab dsh-mem-tab-on' : 'dsh-mem-tab'}
              title={`度 ${s.node.degree}(因果 ${s.node.causalDegree})——点击展开它的邻域`}
              onClick={() => openEgo(s.node.id)}
            >
              {clipName(s.node.name)}
            </button>
          ))}
        </div>
      ) : null}

      {/* ── 全图态：一张力导图装下全部可见节点 ── */}
      {view === 'full' && fullBlock && fullBlock.nodes.length > 0 ? (
        <div style={{ marginBottom: 10 }}>
          <GraphCanvas full={fullBlock} onPick={openEgo} height={FULL_H} />
          <div style={{ ...S.muted, marginTop: 4 }}>
            拖动空白平移 · 滚轮缩放 · 拖节点可钉住 · 悬停点亮邻域并在浮层里看全名 · 单击星点即以它为中心展开邻域
            {fullBlock.truncated ? ` · 已达绘制上限,只画前 ${fullBlock.nodes.length} 个节点` : ''}
          </div>
        </div>
      ) : null}

      {/* ── 邻域态：同一画布组件，数据换成 (起点, 跳数) 裁出的子图 ── */}
      {view === 'ego' ? (
        !fullBlock ? (
          <p style={S.intro}>当前服务端未提供全图块（旧版本降级），邻域视图无法本地裁剪。请点刷新重试。</p>
        ) : !seedNode ? (
          <p style={S.intro}>
            起点不可见（可能已被取代或归档）。{board && board.seeds.length > 0 ? '可从上方种子榜另选起点，或回全图单击任一星点。' : '回全图看看。'}
          </p>
        ) : (
          <div style={{ marginBottom: 10 }}>
            <div style={{ ...S.muted, fontSize: 12, marginBottom: 4 }}>
              起点:<b>{seedNode.name}</b>({seedNode.type} · 直连 {seedDegree}) · {hops} 跳内 {sub.nodes.length} 个节点 /
              {sub.edges.length} 条边{sub.truncated ? ` · 已达子图上限,另有 ${sub.cutByCap} 个连通节点未画` : ''}
              {sub.seedFound && !growable && hops < EGO_HOPS_MAX ? ' · 再展开也没有新节点了' : ''}
            </div>
            {/* key = 起点|跳数：换任一维度都重挂载新实例，两片布局互不污染 */}
            <GraphCanvas
              key={`${seedId}|${hops}`}
              full={subFull}
              emphasisId={seedId ?? undefined}
              fit="view"
              onPick={openEgo}
              height={EGO_H}
            />
            <div style={{ ...S.muted, marginTop: 4, marginBottom: 8 }}>
              悬停星点 = 在浮层里看完整名称与类型 · 单击星点 = 改起点继续展开 · 拖拽钉位与全图一致
            </div>
            {/* 关系清单：把语义交给列表，画布只负责拓扑（重叠问题整类消失） */}
            {rows.length > 0 ? (
              <div>
                <div style={{ ...S.muted, fontSize: 12, marginBottom: 4 }}>关系清单（按跳数由近及远）</div>
                {rows.slice(0, LIST_MAX).map((r) => (
                  <div key={r.id} style={{ ...S.flexRow, gap: 6, padding: '2px 0', fontSize: 12.5 }}>
                    <span style={{ color: 'var(--dsh-mem-text-3)', minWidth: 30 }}>{r.depth} 跳</span>
                    <span
                      style={{ width: 9, height: 9, borderRadius: 9, background: TYPE_COLORS[r.type] ?? FALLBACK_COLOR, display: 'inline-block' }}
                    />
                    <button className="dsh-mem-tab" style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} onClick={() => openEgo(r.id)} title="以此为新起点">
                      {r.name}
                    </button>
                    <span style={{ color: 'var(--dsh-mem-text-3)' }}>{r.type}</span>
                    {r.relations.length > 0 ? (
                      <span style={{ color: r.causal ? 'var(--dsh-mem-accent)' : 'var(--dsh-mem-text-3)', fontWeight: r.causal ? 600 : 400 }}>
                        {r.relations.join('·')}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--dsh-mem-text-3)' }}>{hops > 1 ? '间接相连' : ''}</span>
                    )}
                  </div>
                ))}
                {rows.length > LIST_MAX ? <div style={S.muted}>另有 {rows.length - LIST_MAX} 个节点未列出。</div> : null}
              </div>
            ) : (
              <p style={S.intro}>这个起点在 {hops} 跳内没有其它可达节点（孤点，或关系还没投影出来）。</p>
            )}

            {/* ── 实体详情卡（自动拉取 graph-node-get + records-meta） ── */}
            {detailLoading ? (
              <div style={{ ...S.muted, marginTop: 12 }}>加载实体详情…</div>
            ) : entityDetail ? (
              <div style={{ marginTop: 12, padding: '10px 12px', border: '1px solid var(--dsh-mem-border)', borderRadius: 6, fontSize: 12.5, lineHeight: 1.6 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {entityDetail.name}
                  <span style={{ color: 'var(--dsh-mem-text-3)', marginLeft: 6 }}>({entityDetail.type})</span>
                  {entityDetail.aliases.length > 0 && (
                    <span style={{ color: 'var(--dsh-mem-text-3)', marginLeft: 6 }}>别名: {entityDetail.aliases.join(', ')}</span>
                  )}
                </div>
                <div><span style={{ color: 'var(--dsh-mem-text-3)' }}>状态:</span> {entityDetail.status} · <span style={{ color: 'var(--dsh-mem-text-3)' }}>置信度:</span> {(entityDetail.confidence * 100).toFixed(0)}%</div>
                {entityDetail.currentState && <div style={{ marginTop: 3 }}><span style={{ color: 'var(--dsh-mem-text-3)' }}>当前状态:</span> {entityDetail.currentState}</div>}
                {entityDetail.facts.length > 0 && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--dsh-mem-text-3)' }}>Facts ({entityDetail.facts.length})</summary>
                    {entityDetail.facts.filter((f) => f.status === 'active').map((f) => (
                      <div key={f.id} style={{ paddingLeft: 8 }}>{f.key}: {Array.isArray(f.value) ? f.value.join(', ') : f.value}</div>
                    ))}
                  </details>
                )}
                {sourceRecords.length > 0 && (
                  <details style={{ marginTop: 4 }} open>
                    <summary style={{ cursor: 'pointer', color: 'var(--dsh-mem-text-3)' }}>来源记录 ({sourceRecords.length})</summary>
                    {sourceRecords.map((r) => (
                      <div key={r.id} style={{ paddingLeft: 8, marginBottom: 10, borderBottom: '1px solid var(--dsh-mem-border, #eee)', paddingBottom: 8 }}>
                        {/* 标题 */}
                        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{r.name ?? '(无标题)'}</div>
                        {/* 标签行: type / scope / maturity / priority */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', marginBottom: 4 }}>
                          <span className={tagClass(r.type)}>{typeLabel(r.type)}</span>
                          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 999, border: '1px solid var(--dsh-mem-border)', color: 'var(--dsh-mem-text-2)', whiteSpace: 'nowrap' }}>
                            {r.scope === 'workspace' ? '工作区' : '全局'}
                          </span>
                          {r.maturity && (
                            <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 999, border: '1px solid var(--dsh-mem-border)', color: 'var(--dsh-mem-text-2)', whiteSpace: 'nowrap' }}>
                              {r.maturity === 'high' ? '成熟·高' : r.maturity === 'mid' ? '成熟·中' : '成熟·低'}
                            </span>
                          )}
                          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 999, border: '1px solid var(--dsh-mem-border)', color: 'var(--dsh-mem-text-2)', whiteSpace: 'nowrap' }}>
                            P{r.priority}
                          </span>
                        </div>
                        {/* 创建时间 */}
                        {r.createdAt && <div style={{ fontSize: 11.5, color: 'var(--dsh-mem-text-3)', marginBottom: 2 }}>创建: {fmtTime(r.createdAt)}</div>}
                        {/* 情境 */}
                        {r.scene && <div style={{ fontSize: 12, marginBottom: 2 }}><b>情境：</b>{r.scene}</div>}
                        {/* 范围 */}
                        <div style={{ fontSize: 12, marginBottom: 4 }}><b>范围：</b>{r.scope === 'workspace' ? '指定工作区' + (r.workspaceId ? ` (${r.workspaceId})` : '') : '用户默认 (global)'}</div>
                        {/* 关键词 pill 徽章 */}
                        {r.keywords && r.keywords.length > 0 && (
                          <div style={{ marginBottom: 4 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>关键词</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                              {r.keywords.map((kw, i) => (
                                <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--dsh-mem-border)', color: 'var(--dsh-mem-text-2)', whiteSpace: 'nowrap' }}>{kw}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* 正文 markdown 渲染 */}
                        <div style={{ fontSize: 12.5, marginTop: 4, maxHeight: 240, overflow: 'auto' }}>
                          <MarkdownBody text={r.content} />
                        </div>
                      </div>
                    ))}
                  </details>
                )}
              </div>
            ) : null}
          </div>
        )
      ) : null}

      {/* 有节点但无关系边:不是空图,是边还没投影出来 */}
      {stats && stats.nodes > 0 && stats.edges === 0 && !error ? (
        <p style={S.intro}>已有 {stats.nodes} 个实体节点,但还没有可连出的关系边(或投影未完成)。</p>
      ) : null}
    </div>
  );
}
