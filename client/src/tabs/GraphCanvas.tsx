/**
 * Tab 内「全图星图」渲染层(G6 v5 声明式装配):星点背层 + canvas 图 + 实例生命周期。
 *
 * 只装配不查数:数据由 GraphTab 传入(服务端 `mode:'full'` 已做可见性过滤与双上限截断),
 * 物理与交互全交给 G6(`d3-force` + behaviors)——自研引擎案已按 spike 结论作废。
 * 纯数据面(度数/坐标/伪随机)在 graph-canvas-data.ts,本文件只留 DOM 侧。
 *
 * ⚠️ canvas 渲染不吃 CSS 变量:@antv/g 把颜色交给 canvas 解析,`var(--dsh-mem-chart-1)`
 * 这种字符串在 SVG 里成立(GraphTab 径向卡就是 SVG),在 G6 里必须先用 getComputedStyle
 * 解析成实色,否则整片画不出来。皮肤切换后需重挂载才换色(刷新即可,未做热跟随)。
 */
import { useEffect, useMemo, useRef } from 'react';
import { Graph } from '@antv/g6';
import type { EdgeData, NodeData } from '@antv/g6';
import {
  NAME_CLIP,
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

/** CSS 变量 → 实色(插件自注入的 theme 样式在容器上生效,读计算值即可)。 */
function resolveColor(host: HTMLElement, token: string): string {
  const v = getComputedStyle(host).getPropertyValue(token).trim();
  return v.length > 0 ? v : FALLBACK_COLOR;
}

export function GraphCanvas(props: { full: GraphFull; onPick: (id: string) => void }) {
  const { full } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  /** 回调存 ref:点击回调身份变化不该重建实例(重建 = 丢掉钉位与收敛态)。 */
  const pickRef = useRef(props.onPick);
  pickRef.current = props.onPick;

  const nodeKey = useMemo(() => nodeKeyOf(full), [full]);
  const stars = useMemo(() => starField(nodeKey), [nodeKey]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const width = host.clientWidth || 640;
    const height = host.clientHeight || CANVAS_H;

    const color = (type: string) => resolveColor(host, TYPE_TOKENS[type] ?? FALLBACK_TOKEN);
    const edgeColor = resolveColor(host, '--dsh-mem-border-strong');
    const causalColor = resolveColor(host, '--dsh-mem-accent');
    const textColor = resolveColor(host, '--dsh-mem-text-2');

    const graph = new Graph({
      container: host,
      width,
      height,
      autoFit: { type: 'center' },
      zoomRange: [0.3, 3],
      data: toGraphData(full, width, height),
      node: {
        style: {
          size: (d: NodeData) => radiusForDegree(Number(d.data?.degree ?? 0)),
          fill: (d: NodeData) => color(String(d.data?.type ?? '')),
          fillOpacity: 0.9,
          lineWidth: 0,
          labelText: (d: NodeData) => {
            const name = String(d.data?.name ?? '');
            return name.length > NAME_CLIP ? `${name.slice(0, NAME_CLIP)}…` : name;
          },
          labelFill: textColor,
          labelFontSize: 10,
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
          // 只在因果边上标关系词:全标会糊成一片(千级边时更甚)
          labelText: (d: EdgeData) => (d.data?.causal ? String(d.data?.relation ?? '') : ''),
          labelFill: causalColor,
          labelFontSize: 10,
        },
        state: {
          active: { strokeOpacity: 1, lineWidth: 2.4 },
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
    });

    // render 是异步方法;卸载竞态由 cleanup 的 destroyed 判据兜住
    void graph.render().catch(() => {
      /* 渲染失败不弹栈:展示面降级成空图即可,数据已由服务端过滤截断 */
    });

    graph.on('node:click', (evt) => {
      const id = (evt as { target?: { id?: string } }).target?.id;
      if (typeof id === 'string' && id.length > 0) pickRef.current(id);
    });

    return () => {
      // 红线:实例必销毁,否则切 Tab/刷新会累积 canvas 与力模拟循环
      if (!graph.destroyed) graph.destroy();
    };
  }, [full, nodeKey]);

  return (
    <div style={{ position: 'relative', width: '100%', height: CANVAS_H, overflow: 'hidden', borderRadius: 8 }}>
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
    </div>
  );
}
