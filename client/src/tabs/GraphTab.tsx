/**
 * Tab:图谱 —— 全图星图(G6)与单点邻域(径向卡)双态。
 *
 * 定位:图谱是 L1 记录的可重建投影,本 Tab 消费它的"度数榜"与全图轻量块:
 * 起点推荐 = active 度数 + 因果边×2 加权(实机审计因果边占比 ~24%,因果链比
 * 共现邻接更值得画)——排序/合并/截断/可见性语义全在服务端 preview.ts,
 * 这里只管画。全图态交给 G6(物理+交互),邻域态仍是手写 SVG(零依赖)。
 *
 * 数据契约(冻结于 src/contract.ts GraphPreviewResponse):
 * - `mode:'full'` 请求一次拿到 种子榜 + 全图 full 块 + stats(同一 loadGraph);
 * - seedId 请求返回该节点唯一邻域(悬挂 id → seeds 空,不抛);
 * - pendingJobs>0 → 统计条"构建中 x/y"(x=jobsTotal-pendingJobs)。
 */
import { useCallback, useEffect, useState } from 'react';
import type { GraphPreviewResponse } from '../../../src/contract.js';
import type { RpcFn } from '../rpc.js';
import { S } from '../styles.js';
import { NButton } from '../ui/primitives.js';
import { GraphCanvas } from './GraphCanvas.js';

type SeedView = GraphPreviewResponse['seeds'][number];
/** 绘制态:全图星图(G6)/ 单点邻域(径向卡)。默认全图——进 Tab 先看全局。 */
type GraphView = 'full' | 'ego';

/** 画布尺寸与半径(viewBox 360;邻居环 120;节点圆 22——与 spec 模块 D 同值)。 */
const VB = 360;
const RING = 120;
const NODE_R = 22;
/** 名字截断字数(超出加 …;hover title 给全名)。 */
const NAME_CLIP = 8;

/** 五类实体色:直接映射既有图表调色板(CostTab 先例),不引入新色值。 */
const TYPE_COLORS: Record<string, string> = {
  person: 'var(--dsh-mem-chart-1)',
  project: 'var(--dsh-mem-chart-2)',
  organization: 'var(--dsh-mem-chart-3)',
  tool: 'var(--dsh-mem-chart-4)',
  place: 'var(--dsh-mem-chart-5)',
};
const FALLBACK_COLOR = 'var(--dsh-mem-chart-6)';

function clip(name: string): string {
  return name.length > NAME_CLIP ? `${name.slice(0, NAME_CLIP)}…` : name;
}

/**
 * 径向布局纯函数:中心画布正中,n 个邻居按输入序等角分布(首点 12 点方向)。
 * n=0 → pts 空(只画中心)。角度 i/n·2π − π/2:同输入同坐标,无随机源。
 */
export function radialLayout(n: number): { cx: number; cy: number; pts: Array<{ x: number; y: number }> } {
  const cx = VB / 2;
  const cy = VB / 2;
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: Math.round((cx + Math.cos(a) * RING) * 10) / 10, y: Math.round((cy + Math.sin(a) * RING) * 10) / 10 });
  }
  return { cx, cy, pts };
}

export function GraphTab(props: { rpc: RpcFn }) {
  const rpc = props.rpc;
  /** 种子榜 + 全图块响应(mount/回榜单/刷新时重取;stats 与 full 的唯一来源)。 */
  const [board, setBoard] = useState<GraphPreviewResponse | null>(null);
  /** 当前绘制态(全图 / 邻域)。 */
  const [view, setView] = useState<GraphView>('full');
  /** 邻域态的中心(榜内首种子或点进去的邻居;null=无邻域可画)。 */
  const [focus, setFocus] = useState<SeedView | null>(null);
  /** 全图态下单击星点选中的详情（null=未选：不在全图下预挂一张邻域卡）。 */
  const [picked, setPicked] = useState<SeedView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(
    (payload: Record<string, unknown>) =>
      rpc('dsh-memory/graph-preview', payload).then((r) => {
        if (r && r.ok) return r.value as GraphPreviewResponse;
        throw new Error(r && r.error ? r.error.message : 'RPC error');
      }),
    [rpc],
  );

  /** 拉种子榜与全图块(进 Tab / 回榜单 / 错误重试共用)。 */
  const loadBoard = useCallback(() => {
    setLoading(true);
    setError(null);
    call({ mode: 'full' })
      .then((v) => {
        setBoard(v);
        setFocus(v.seeds[0] ?? null);
        setPicked(null);
      })
      .catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
      .finally(() => setLoading(false));
  }, [call]);

  /**
   * 以指定节点为中心重画邻域(点 chip / 点邻居 / 全图态点星点)。
   * 全图态结果落 `picked`(下挂详情卡),邻域态结果落 `focus`(换中心);悬挂 id 不拆态。
   */
  const drill = (nodeId: string) => {
    const inFull = view === 'full';
    setLoading(true);
    setError(null);
    call({ seedId: nodeId })
      .then((v) => {
        const next = v.seeds[0] ?? null;
        if (inFull) {
          if (next) setPicked(next);
        } else if (next) {
          setFocus(next);
        } else {
          setFocus(board?.seeds[0] ?? null);
        }
      })
      .catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  const stats = board?.stats ?? null;
  /** 当下要画邻域卡的中心:全图态=点选的星,邻域态=focus。 */
  const center = view === 'full' ? picked : focus;
  const layout = center ? radialLayout(center.neighbors.length) : null;
  const hidden = center ? Math.max(0, center.node.degree - center.neighbors.length) : 0;
  /** 全图块可用性:服务端未带 full(旧版降级)则静默留在邻域态,不显空 canvas。 */
  const full = view === 'full' ? board?.full : undefined;

  return (
    <div>
      {/* 统计条:三数 + 构建中进度(pendingJobs>0 才显,x=jobsTotal-pendingJobs) */}
      <div style={{ ...S.flexRow, marginBottom: 10 }}>
        <span style={S.muted}>
          {loading && board === null
            ? '加载中…'
            : stats
              ? `节点 ${stats.nodes} · 边 ${stats.edges} · 因果 ${stats.causalEdges}` +
                (stats.pendingJobs > 0 ? ` · 构建中 ${stats.jobsTotal - stats.pendingJobs}/${stats.jobsTotal}` : '')
              : '—'}
        </span>
        <div style={S.grow} />
        {/* 双态切换:全图一体展示 / 单点邻域展开 */}
        <div style={S.seg}>
          <button
            style={view === 'full' ? { ...S.segBtn, ...S.segBtnOn } : S.segBtn}
            title="全图星图：所有可见实体与关系一张图"
            onClick={() => setView('full')}
          >
            全图
          </button>
          <button
            style={view === 'ego' ? { ...S.segBtn, ...S.segBtnOn } : S.segBtn}
            title="单点邻域：以一个节点为中心展开"
            onClick={() => setView('ego')}
          >
            邻域
          </button>
        </div>
        {center ? (
          <NButton
            onClick={() => {
              if (view === 'full') {
                setPicked(null);
              } else if (board) {
                setFocus(board.seeds[0] ?? null);
              } else {
                loadBoard();
              }
            }}
            title={view === 'full' ? '收起下挂的邻域详情' : '回到推荐种子榜'}
          >
            {view === 'full' ? '清选择' : '回榜单'}
          </NButton>
        ) : null}
        <NButton onClick={loadBoard}>刷新</NButton>
      </div>

      {error ? (
        <div style={S.error}>
          {error}
          {' '}
          <NButton onClick={loadBoard}>重试</NButton>
        </div>
      ) : null}

      {/* 空态:图域为零(未启用或未投影)——与"构建中"分开说,前者要去开开关 */}
      {stats && stats.nodes === 0 && !error ? (
        <p style={S.intro}>
          图谱还没有内容。它在设置里是独立开关(概览 → 图谱投影),开启后存量记忆会逐批投影成实体与关系。
        </p>
      ) : null}

      {/* 种子 chip 行(榜单态;drill 后 seeds 只剩 1 条,自然不出现) */}
      {board && board.seeds.length > 1 ? (
        <div style={{ ...S.flexRow, marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
          {board.seeds.map((s) => (
            <button
              key={s.node.id}
              className={center?.node.id === s.node.id ? 'dsh-mem-tab dsh-mem-tab-on' : 'dsh-mem-tab'}
              title={`度 ${s.node.degree}(因果 ${s.node.causalDegree})`}
              onClick={() => drill(s.node.id)}
            >
              {clip(s.node.name)}
            </button>
          ))}
        </div>
      ) : null}

      {/* 全图星图(G6 d3-force 一体展示):物理与交互全在库里,本层只馈数据与选星回调 */}
      {full && full.nodes.length > 0 ? (
        <div style={{ marginBottom: 10 }}>
          <GraphCanvas full={full} onPick={drill} />
          <div style={{ ...S.muted, marginTop: 4 }}>
            拖动空白平移 · 滚轮缩放 · 拖节点可钉住 · 悬停点亮邻域 · 单击星点看它的邻域
            {full.truncated ? ` · 已达绘制上限,只画前 ${full.nodes.length} 个节点` : ''}
          </div>
        </div>
      ) : null}

      {center && layout ? (
        <div>
          <div style={{ ...S.muted, fontSize: 12, marginBottom: 4 }}>
            中心:<b>{center.node.name}</b>({center.node.type} · 度 {center.node.degree})
            {center.truncated ? ` · 另有 ${hidden} 条关系未画` : ''}
            {loading ? ' · 加载中…' : ''}
          </div>
          <svg viewBox={`0 0 ${VB} ${VB}`} width="100%" style={{ maxWidth: 460, display: 'block' }}>
            {/* 边层(先画,垫在节点下):因果边加粗 + 强调色;关系词在边中点 */}
            {center.neighbors.map((nb, i) => {
              const p = layout.pts[i]!;
              const causal = nb.causal;
              return (
                <g key={`e-${nb.id}-${i}`}>
                  <line
                    x1={layout.cx}
                    y1={layout.cy}
                    x2={p.x}
                    y2={p.y}
                    stroke={causal ? 'var(--dsh-mem-accent)' : 'var(--dsh-mem-border)'}
                    strokeWidth={causal ? 3 : 1.5}
                  />
                  <text
                    x={(layout.cx + p.x) / 2}
                    y={(layout.cy + p.y) / 2 - 4}
                    textAnchor="middle"
                    fontSize={causal ? 12 : 10}
                    fontWeight={causal ? 700 : 400}
                    fill={causal ? 'var(--dsh-mem-accent)' : 'var(--dsh-mem-text-3)'}
                  >
                    {nb.relation}
                  </text>
                </g>
              );
            })}
            {/* 邻居节点层:点击=换中心 */}
            {center.neighbors.map((nb, i) => {
              const p = layout.pts[i]!;
              return (
                <g
                  key={`n-${nb.id}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => drill(nb.id)}
                >
                  {/* SVG hover 提示的正确形状:<title> 子元素(g 不吃 title 属性,tsc 钉过) */}
                  <title>{`${nb.name}(${nb.type})——点击以此为中心`}</title>
                  <circle cx={p.x} cy={p.y} r={NODE_R - 6} fill={TYPE_COLORS[nb.type] ?? FALLBACK_COLOR} opacity={0.9} />
                  <text x={p.x} y={p.y + NODE_R + 2} textAnchor="middle" fontSize={11} fill="var(--dsh-mem-text-2)">
                    {clip(nb.name)}
                  </text>
                </g>
              );
            })}
            {/* 中心节点 */}
            <circle cx={layout.cx} cy={layout.cy} r={NODE_R} fill={TYPE_COLORS[center.node.type] ?? FALLBACK_COLOR} stroke="var(--dsh-mem-border-strong)" />
            <text x={layout.cx} y={layout.cy + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--dsh-mem-text-1)">
              {clip(center.node.name)}
            </text>
          </svg>
        </div>
      ) : null}

      {/* 有节点但无关系边:不是空图,是边还没投影出来(用 stats.edges 判,不拿“有没有选中心”当凭据) */}
      {stats && stats.nodes > 0 && stats.edges === 0 && !error ? (
        <p style={S.intro}>已有 {stats.nodes} 个实体节点,但还没有可连出的关系边(或投影未完成)。</p>
      ) : null}
    </div>
  );
}
