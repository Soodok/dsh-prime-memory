/**
 * Tab 内「全图星图」渲染层(G6 v5 声明式装配):星点背层 + canvas 图 + 两级气泡。
 *
 * 只装配不查数:数据由 GraphTab 传入(服务端 `mode:'full'` 已做可见性过滤与双上限截断),
 * 物理与交互全交给 G6(`d3-force` + behaviors)。
 *
 * 两级气泡设计(取代 G6 内置 tooltip)：
 * - L1（悬浮触发）：实体名 + 类型 + 关系数 + 「详情」按钮
 * - L2（点击详情）：展开实体元数据(facts/别名/状态) + 来源记录(type/name/date)
 * 气泡是绝对定位的 React overlay div，不受 G6 canvas 内部事件影响，
 * 鼠标移入气泡时取消隐藏计时器(桥接)。
 *
 * ⚙️ canvas 渲染不吃 CSS 变量：G6 里必须先 getComputedStyle 解成实色。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Graph } from '@antv/g6';
import type { EdgeData, NodeData } from '@antv/g6';
import {
  clipByWidth,
  hash32,
  nodeKeyOf,
  radiusForDegree,
  seededRandom,
  starField,
  toGraphData,
  type GraphFull,
} from './graph-canvas-data.js';

/** type → 既有图表系列令牌(与 GraphTab 径向卡同源五色)。 */
const TYPE_TOKENS: Record<string, string> = {
  person: '--dsh-mem-chart-1',
  project: '--dsh-mem-chart-2',
  organization: '--dsh-mem-chart-3',
  tool: '--dsh-mem-chart-4',
  place: '--dsh-mem-chart-5',
};
/** 未知 type 兜底(生产不该出现:apply 校验超集即丢弃)。 */
const FALLBACK_TOKEN = '--dsh-mem-chart-6';
/** 解析不到 CSS 变量时的最后兜底(面板样式还没挂上,别把整图画崩)。 */
const FALLBACK_COLOR = '#8a8f98';
/** 画布高度:面板宽度不固定,高度钉死避免 Tab 切换时布局跳动。 */
const CANVAS_H = 460;
/** 关系词全量下发的边数上限(再密就只标因果,否则字墙盖过图)。 */
const LABEL_ALL_EDGES_MAX = 220;

/** CSS 变量 → 实色(插件自注入的 theme 样式在容器上生效,读计算值即可)。 */
function resolveColor(host: HTMLElement, token: string): string {
  const v = getComputedStyle(host).getPropertyValue(token).trim();
  return v.length > 0 ? v : FALLBACK_COLOR;
}

export function GraphCanvas(props: {
  full: GraphFull;
  onPick: (id: string) => void;
  /** 起点强调（邻域态用：更大一圈 + 描边 + 粗体名，一眼看出从哪长出来）。 */
  emphasisId?: string;
  /** 取景：全图居中即可，子图小、需 fit 到画面内。 */
  fit?: 'center' | 'view';
  /** 画布高度（全图给宽景，子图可以矮一点留出详情区）。 */
  height?: number;
}) {
  const { full, emphasisId, fit = 'center', height: canvasH = CANVAS_H } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const pickRef = useRef(props.onPick);
  pickRef.current = props.onPick;

  // ── 悬浮气泡状态 ──────────────────────────────────────────
  /** 悬浮信息(id + 容器内坐标)；null=不显示。 */
  const [hovered, setHovered] = useState<{ id: string; x: number; y: number } | null>(null);
  /** 桥接计时器：鼠标从节点移向气泡时不立即隐藏。 */
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nodeKey = useMemo(() => nodeKeyOf(full), [full]);
  const stars = useMemo(() => starField(nodeKey), [nodeKey]);

  /** 气泡 L1 数据源(组件级,渲染层与 effect 内事件共用)。 */
  const tips = useMemo(() => {
    const m = new Map<string, { title: string; sub: string }>();
    const nameById = new Map(full.nodes.map((n) => [n.id, n.name]));
    for (const n of full.nodes) {
      m.set(n.id, {
        title: n.name,
        sub: `类型 ${n.type} · 关系数 ${n.id === emphasisId ? '(起点)' : ''}`,
      });
    }
    // 度数从 full.edges 算(与 toGraphData 同判据)
    const degMap = new Map<string, number>();
    for (const e of full.edges) {
      degMap.set(e.from, (degMap.get(e.from) ?? 0) + 1);
      degMap.set(e.to, (degMap.get(e.to) ?? 0) + 1);
    }
    for (const n of full.nodes) {
      const t = m.get(n.id);
      if (t) t.sub = `类型 ${n.type} · 关系数 ${degMap.get(n.id) ?? 0}${n.id === emphasisId ? ' · 当前起点' : ''}`;
    }
    for (const e of full.edges) {
      const eid = `${e.from}\x00${e.to}\x00${e.relation}`;
      m.set(eid, {
        title: e.relation,
        sub: `${nameById.get(e.from) ?? e.from} → ${nameById.get(e.to) ?? e.to}${e.causal ? ' · 因果边' : ''}`,
      });
    }
    return m;
  }, [full, emphasisId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const width = host.clientWidth || 640;
    const height = host.clientHeight || canvasH;

    const color = (type: string) => resolveColor(host, TYPE_TOKENS[type] ?? FALLBACK_TOKEN);
    const edgeColor = resolveColor(host, '--dsh-mem-border-strong');
    const causalColor = resolveColor(host, '--dsh-mem-accent');
    const textColor = resolveColor(host, '--dsh-mem-text-2');
    const dimColor = resolveColor(host, '--dsh-mem-text-3');
    const bgColor = resolveColor(host, '--dsh-mem-bg-card');
    const strongColor = resolveColor(host, '--dsh-mem-text-1');
    /** 小图每条边都写关系词;大图只写因果边(两者都是"线看不出语义"的修法,按密度分级)。 */
    const labelAll = full.edges.length <= LABEL_ALL_EDGES_MAX;
    /** 起点强调与否看它（邻域子图里靠强调圈区分中心）。 */
    const isSeed = (d: { id?: string }): boolean => emphasisId !== undefined && d.id === emphasisId;

    const data = toGraphData(full, width, height);

    const graph = new Graph({
      container: host,
      width,
      height,
      autoFit: fit === 'view' ? { type: 'view' } : { type: 'center' },
      zoomRange: [0.3, 3],
      data,
      node: {
        style: {
          // G6 的 size 是直径不是半径（按半径给值会把节点缩成针尖、箭头反而盖过点）
          size: (d: NodeData) => (radiusForDegree(Number(d.data?.degree ?? 0)) + (isSeed(d) ? 3 : 0)) * 2,
          fill: (d: NodeData) => color(String(d.data?.type ?? '')),
          fillOpacity: 0.9,
          stroke: (d: NodeData) => (isSeed(d) ? strongColor : 'transparent'),
          lineWidth: (d: NodeData) => (isSeed(d) ? 2.5 : 0),
          labelText: (d: NodeData) => clipByWidth(String(d.data?.name ?? '')),
          labelFill: textColor,
          labelFontSize: 10,
          labelFontWeight: (d: NodeData) => (isSeed(d) ? 'bold' : 'normal'),
          labelPlacement: 'bottom',
          labelOffsetY: 2,
        },
        // hover-activate 的点亮/暗化两态:激活者加光环,其余整体压暗
        state: {
          active: { halo: true, haloStroke: causalColor, haloLineWidth: 6, haloStrokeOpacity: 0.25, fillOpacity: 1 },
          inactive: { fillOpacity: 0.12, labelOpacity: 0.15 },
        },
      },
      edge: {
        style: {
          stroke: (d: EdgeData) => (d.data?.causal ? causalColor : edgeColor),
          lineWidth: (d: EdgeData) => (d.data?.causal ? 1.8 : 1),
          strokeOpacity: 0.5,
          labelText: (d: EdgeData) => (labelAll || d.data?.causal ? String(d.data?.relation ?? '') : ''),
          labelFill: (d: EdgeData) => (d.data?.causal ? causalColor : dimColor),
          labelFontSize: 9,
          // 字底垫一块半透背景:否则字压在弹簧线上、星点上一律读不出
          labelBackground: true,
          labelBackgroundFill: bgColor,
          labelBackgroundOpacity: 0.78,
          labelBackgroundRadius: 3,
          // 全部边都有方向(from→to),所以全部带箭头;因果边用强调色+稍大箭头区分
          // (v5 的 endArrow 不接受回调形态,按展平属性逐项给值;显式 size 不被线宽放大)
          endArrow: true,
          endArrowType: 'vee',
          endArrowSize: (d: EdgeData) => (d.data?.causal ? 7 : 4),
          endArrowFill: (d: EdgeData) => (d.data?.causal ? causalColor : edgeColor),
          endArrowStrokeOpacity: (d: EdgeData) => (d.data?.causal ? 1 : 0.55),
        },
        state: {
          active: { strokeOpacity: 1, lineWidth: 2.4, labelFill: causalColor, labelFontSize: 11 },
          inactive: { strokeOpacity: 0.06, labelOpacity: 0 },
        },
      },
      layout: {
        type: 'd3-force',
        // v5 实名 animation(v4 的 animated 在这儿不生效);true = 逐 tick 迭代过渡
        animation: true,
        iterations: 300,
        // 持续"漂浮"而非死寂:alphaMin 调小让模拟晚些收敛
        alphaMin: 0.005,
        alphaDecay: 0.02,
        link: { distance: 90, strength: 0.6 },
        collide: { radius: 14, strength: 0.8 },
        manyBody: { strength: -60 },
        center: { x: 0, y: 0 },
        randomSource: seededRandom(hash32(nodeKey)),
      },
      behaviors: [
        'drag-canvas',
        'zoom-canvas',
        // 钉位:拖完保持固定不再被力拽走(仅 d3-force 布局下可用)
        { type: 'drag-element-force', fixed: true },
        { type: 'hover-activate', degree: 1, inactiveState: 'inactive' },
      ],
      plugins: [],
    });
  
    // render 是异步方法;卸载竞态由 cleanup 的 destroyed 判据兆住
    void graph.render().catch(() => {});
  
    // ── 气泡事件绑定(取代 G6 tooltip) ────────────────────
    graph.on('node:pointerenter', (evt) => {
      const id = (evt as { target?: { id?: string } }).target?.id;
      if (!id) return;
      // 取消之前的隐藏计时
      if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
      // 计算容器内坐标
      const rect = host.getBoundingClientRect();
      const e = evt as { client?: { x: number; y: number }; viewport?: { x: number; y: number } };
      const cx = e.client?.x ?? e.viewport?.x ?? 0;
      const cy = e.client?.y ?? e.viewport?.y ?? 0;
      setHovered({ id, x: cx - rect.left, y: cy - rect.top });
    });
    graph.on('node:pointerleave', () => {
      // 延迟隐藏(桥接窗口 250ms)——给鼠标从节点移向气泡的时间
      hideTimerRef.current = setTimeout(() => setHovered(null), 250);
    });
    graph.on('node:click', (evt) => {
      const id = (evt as { target?: { id?: string } }).target?.id;
      if (typeof id === 'string' && id.length > 0) pickRef.current(id);
    });
    // 画布空白点击 = 收起气泡
    graph.on('canvas:click', () => { setHovered(null); });
  
    return () => {
      // 红线:实例必销毁,否则切 Tab/刷新会累积 canvas 与力模拟循环
      if (!graph.destroyed) graph.destroy();
    };
  }, [full, nodeKey, emphasisId, fit, canvasH]);

  /** 当前要显示的气泡数据(只有 hovered)。 */
  const bubbleTip = hovered ? tips.get(hovered.id) : null;

  return (
    <div style={{ position: 'relative', width: '100%', height: canvasH, overflow: 'hidden', borderRadius: 8 }}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="var(--dsh-mem-text-3)" opacity={s.o} />
        ))}
      </svg>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />

      {/* 悬浮气泡：只显全名（标签被截断时的补全视图） */}
      {hovered && bubbleTip && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(hovered.x + 12, (hostRef.current?.clientWidth ?? 600) - 240),
            top: Math.max(hovered.y - 8, 8),
            maxWidth: 300,
            padding: '4px 10px',
            background: 'var(--dsh-mem-bg-card, #fff)',
            border: '1px solid var(--dsh-mem-border, #ddd)',
            borderRadius: 5,
            boxShadow: '0 1px 6px rgba(0,0,0,.1)',
            fontSize: 12.5,
            fontWeight: 600,
            zIndex: 20,
            pointerEvents: 'none',
          }}
        >
          {bubbleTip.title}
        </div>
      )}
    </div>
  );
}
