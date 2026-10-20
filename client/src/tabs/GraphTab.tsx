/**
 * Tab:图谱预览 —— 推荐起点 + 径向邻域绘制(点击邻居换中心)。
 *
 * 定位:图谱是 L1 记录的可重建投影,本 Tab 消费它的"度数榜":
 * 起点推荐 = active 度数 + 因果边×2 加权(实机审计因果边占比 ~24%,因果链比
 * 共现邻接更值得画)——排序/合并/截断语义全在服务端 preview.ts,
 * 这里只管画;客户端零依赖(SVG 手写径向,无 d3)。
 *
 * 数据契约(冻结于 src/contract.ts GraphPreviewResponse):
 * - 缺省请求返回种子榜(seeds 至多 6,相邻种子已合并)+ 全图 stats;
 * - seedId 请求返回该节点唯一邻域(悬挂 id → seeds 空,不抛);
 * - pendingJobs>0 → 统计条"构建中 x/y"(x=jobsTotal-pendingJobs)。
 */
import { useCallback, useEffect, useState } from 'react';
import type { GraphPreviewResponse } from '../../../src/contract.js';
import type { RpcFn } from '../rpc.js';
import { S } from '../styles.js';
import { NButton } from '../ui/primitives.js';

type SeedView = GraphPreviewResponse['seeds'][number];

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
  /** 种子榜响应(mount/回榜单时刷新;stats 唯一来源)。 */
  const [board, setBoard] = useState<GraphPreviewResponse | null>(null);
  /** 当前绘制中心(榜内首种子或点进去的邻居;null=无邻域可画)。 */
  const [focus, setFocus] = useState<SeedView | null>(null);
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

  /** 拉种子榜并画首种子(进 Tab / 回榜单 / 错误重试共用)。 */
  const loadBoard = useCallback(() => {
    setLoading(true);
    setError(null);
    call({})
      .then((v) => {
        setBoard(v);
        setFocus(v.seeds[0] ?? null);
      })
      .catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
      .finally(() => setLoading(false));
  }, [call]);

  /** 以指定节点为中心重画(点邻居/点 chip;悬挂 id 回退榜单首种子)。 */
  const drill = (nodeId: string) => {
    setLoading(true);
    setError(null);
    call({ seedId: nodeId })
      .then((v) => {
        if (v.seeds.length > 0) setFocus(v.seeds[0]!);
        else setFocus(board?.seeds[0] ?? null);
      })
      .catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  const stats = board?.stats ?? null;
  const layout = focus ? radialLayout(focus.neighbors.length) : null;
  const hidden = focus ? Math.max(0, focus.node.degree - focus.neighbors.length) : 0;

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
        {focus ? (
          <NButton
            onClick={() => {
              if (board) {
                setFocus(board.seeds[0] ?? null);
              } else {
                loadBoard();
              }
            }}
            title="回到推荐种子榜"
          >
            回榜单
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
              className={focus?.node.id === s.node.id ? 'dsh-mem-tab dsh-mem-tab-on' : 'dsh-mem-tab'}
              title={`度 ${s.node.degree}(因果 ${s.node.causalDegree})`}
              onClick={() => drill(s.node.id)}
            >
              {clip(s.node.name)}
            </button>
          ))}
        </div>
      ) : null}

      {focus && layout ? (
        <div>
          <div style={{ ...S.muted, fontSize: 12, marginBottom: 4 }}>
            中心:<b>{focus.node.name}</b>({focus.node.type} · 度 {focus.node.degree})
            {focus.truncated ? ` · 另有 ${hidden} 条关系未画` : ''}
            {loading ? ' · 加载中…' : ''}
          </div>
          <svg viewBox={`0 0 ${VB} ${VB}`} width="100%" style={{ maxWidth: 460, display: 'block' }}>
            {/* 边层(先画,垫在节点下):因果边加粗 + 强调色;关系词在边中点 */}
            {focus.neighbors.map((nb, i) => {
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
            {focus.neighbors.map((nb, i) => {
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
            <circle cx={layout.cx} cy={layout.cy} r={NODE_R} fill={TYPE_COLORS[focus.node.type] ?? FALLBACK_COLOR} stroke="var(--dsh-mem-border-strong)" />
            <text x={layout.cx} y={layout.cy + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--dsh-mem-text-1)">
              {clip(focus.node.name)}
            </text>
          </svg>
        </div>
      ) : null}

      {/* 有节点但无邻域(种子榜为空/全孤点):不是空图,是还没有边 */}
      {stats && stats.nodes > 0 && !focus && !error ? (
        <p style={S.intro}>已有 {stats.nodes} 个实体节点,但还没有可连出的关系边(或投影未完成)。</p>
      ) : null}
    </div>
  );
}
