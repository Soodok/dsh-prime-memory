/**
 * 邻域态（单点径向卡）的纯几何层：邻居分组 + 自适应环布局 + 标签锚点。
 *
 * 为什么从 GraphTab.tsx 里拆出来（循 graph-canvas-data.ts 先例）：这几条是可单测的
 * 几何判据，混在 JSX 里就只能靠人眼验收——而它恰好是本轮四个显示缺陷的共同根因层。
 *
 * 修的四件事：
 * ① 服务端 neighbors 是**按边**生成的（同一邻居有多条关系就会出现多条），旧版直接
 *    按条目画圈 + key 用 `n-${id}` ⇒ 重复 key 让 React 残留 DOM（叠字）且第二条不展开。
 *    这里按 id 合并成"一个邻居 · 多条关系词"，key 天然唯一，关系一条不丢。
 * ② 环半径写死 120：8 字 CJK 标签宽 ≈ 88 单位，n≥9 时弧长间距 < 标签宽 ⇒ 必然压字。
 *    改成按"最宽标签 + 条数"反推环径，n≥8 再错开半环（双带）把角向拥挤度减半。
 * ③ 标签一律画在圆心正下方，左右两侧的邻居会把字压进自己的圆里 ⇒ 按角度分锚点
 *    （右侧 start / 左侧 end / 正上正下 middle 外推）。
 * ④ 因果边有方向（from→to），旧版画成无向线 ⇒ 线段端点按圆半径内缩并留出箭头位，
 *    方向由 marker 表达（渲染层负责画箭头，这里只给准端点）。
 */

/** 中心节点圆半径（viewBox 单位，与旧值同）。 */
export const EGO_CENTER_R = 22;
/** 邻居节点圆半径。 */
export const EGO_NEIGHBOR_R = 16;
/** 环半径下限（邻居少时不至于缩成一团）。 */
export const EGO_RING_MIN = 120;
/** 环半径上限（再大就出画面了，交给 SVG 缩放）。 */
export const EGO_RING_MAX = 420;
/** 标签字号（与渲染层 fontSize 必须同值，宽度估算按它算）。 */
export const EGO_LABEL_FS = 11;
/** 错带（双环）外推量：n≥8 时奇偶交替，同带内角向名额减半。 */
export const EGO_STAGGER_BAND = 34;
/** 因果箭头占位长度（线段末端要多让出这么多，箭头才不会压在圆里）。 */
export const EGO_ARROW_GAP = 9;
/** 名字截断字数（与径向卡旧值同口径）。 */
export const EGO_NAME_CLIP = 8;

/** 服务端下发的按边邻居条目（契约 GraphPreviewResponse.seeds[].neighbors 的元素）。 */
export interface RawNeighbor {
  id: string;
  name: string;
  type: string;
  relation: string;
  causal: boolean;
}

/** 合并后的邻居：一个节点一条，关系词全部保留。 */
export interface EgoNeighbor {
  id: string;
  name: string;
  type: string;
  /** 该邻居与中心之间的全部关系词（去重、保持服务端排序：因果先、度数高先）。 */
  relations: string[];
  /** 任一条关系是因果边即为真（画箭头 + 强调色）。 */
  causal: boolean;
}

/**
 * 按 id 合并邻居（①）。首次出现顺序即服务端排序序（因果→度数→新度→id），
 * 不重排；同对节点的多条关系并成一个 relations，一条都不丢。
 */
export function groupNeighbors(neighbors: readonly RawNeighbor[]): EgoNeighbor[] {
  const out: EgoNeighbor[] = [];
  const index = new Map<string, number>();
  for (const nb of neighbors) {
    const at = index.get(nb.id);
    if (at === undefined) {
      index.set(nb.id, out.length);
      out.push({
        id: nb.id,
        name: nb.name,
        type: nb.type,
        relations: [nb.relation],
        causal: nb.causal,
      });
      continue;
    }
    const cur = out[at]!;
    if (!cur.relations.includes(nb.relation)) cur.relations.push(nb.relation);
    if (nb.causal) cur.causal = true;
  }
  return out;
}

/** 截断显示名（CJK/latin 同口径，hover title 给全名）。 */
export function clipName(name: string): string {
  return name.length > EGO_NAME_CLIP ? `${name.slice(0, EGO_NAME_CLIP)}…` : name;
}

/**
 * 标签宽度估算：CJK 满宽（1em），其余按 0.6em。
 * 只用于"环要多大才挤得下"，宁大勿小（估小了就会压字）。
 */
export function labelWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += ch.codePointAt(0)! > 0x2e80 ? EGO_LABEL_FS : EGO_LABEL_FS * 0.6;
  return Math.round(w * 10) / 10;
}

export interface EgoPt {
  /** 圆心。 */
  x: number;
  y: number;
  /** 该点的实际环半径（错带后与 layout.ring 不同）。 */
  radius: number;
  /** 线段端点：起点已让开中心圆，终点已让开邻居圆（因果边再让开箭头位）。 */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 关系词落点（线段中段偏外，避开中心圆与邻居圆）。 */
  midX: number;
  midY: number;
  /** 标签锚点与位置（③）。 */
  anchor: 'start' | 'middle' | 'end';
  labelX: number;
  labelY: number;
}

export interface EgoLayout {
  /** 正方形 viewBox 边长。 */
  size: number;
  cx: number;
  cy: number;
  /** 基准环半径（错带前的内带）。 */
  ring: number;
  /** 是否启用错带（n≥8）。 */
  staggered: boolean;
  pts: EgoPt[];
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * 径向布局（②③）：n 个邻居等角分布，首点 12 点方向，同输入同坐标（无随机源）。
 * n=0 → pts 空、size 仍给出可画中心的最小画幅。
 * `causal[i]` 为真时该点线段末端额外让出箭头位（方向由 marker 表达，端点在此算准）。
 */
export function egoLayout(n: number, names: readonly string[] = [], causal?: readonly boolean[]): EgoLayout {
  const widest = names.reduce((m, s) => Math.max(m, labelWidth(clipName(s))), EGO_LABEL_FS * 3);
  const staggered = n >= 8;
  // 同带内需要容纳的条数：错带后减半（向上取整）
  const perBand = staggered ? Math.ceil(n / 2) : n;
  // 弧长 ≥ 最宽标签 + 12 单位间隙 ⇒ 反推环半径
  const need = ((widest + 12) * Math.max(0, perBand)) / (Math.PI * 2);
  const ring = Math.min(EGO_RING_MAX, Math.max(EGO_RING_MIN, Math.ceil(need)));
  const half = ring + (staggered ? EGO_STAGGER_BAND : 0) + EGO_CENTER_R + widest + 20;
  const size = Math.round(half * 2);
  const cx = half;
  const cy = half;
  const pts: EgoPt[] = [];
  if (n > 0) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const radius = staggered && i % 2 === 1 ? ring + EGO_STAGGER_BAND : ring;
      const x = cx + cos * radius;
      const y = cy + sin * radius;
      // 线段端点：沿单位向量从两端各让开对应圆半径；因果边末端再让出箭头长
      const ux = cos;
      const uy = sin;
      const startGap = EGO_CENTER_R + 2;
      const endGap = EGO_NEIGHBOR_R + 2 + (causal?.[i] ? EGO_ARROW_GAP : 0);
      const x1 = cx + ux * startGap;
      const y1 = cy + uy * startGap;
      const x2 = x - ux * endGap;
      const y2 = y - uy * endGap;
      // 关系词放在线段 62% 处（偏外，避开中心圆与环上标签）
      const midX = cx + (x - cx) * 0.62;
      const midY = cy + (y - cy) * 0.62;
      // 标签锚点：左右外侧水平排，正上/正下垂直外排
      let anchor: EgoPt['anchor'];
      let labelX: number;
      let labelY: number;
      if (cos > 0.3) {
        anchor = 'start';
        labelX = x + EGO_NEIGHBOR_R + 6;
        labelY = y + EGO_LABEL_FS * 0.35;
      } else if (cos < -0.3) {
        anchor = 'end';
        labelX = x - EGO_NEIGHBOR_R - 6;
        labelY = y + EGO_LABEL_FS * 0.35;
      } else if (sin < 0) {
        anchor = 'middle';
        labelX = x;
        labelY = y - EGO_NEIGHBOR_R - 8;
      } else {
        anchor = 'middle';
        labelX = x;
        labelY = y + EGO_NEIGHBOR_R + EGO_LABEL_FS + 3;
      }
      pts.push({
        x: round1(x),
        y: round1(y),
        radius: round1(radius),
        x1: round1(x1),
        y1: round1(y1),
        x2: round1(x2),
        y2: round1(y2),
        midX: round1(midX),
        midY: round1(midY),
        anchor,
        labelX: round1(labelX),
        labelY: round1(labelY),
      });
    }
  }
  return { size, cx: round1(cx), cy: round1(cy), ring, staggered, pts };
}

/** 因果箭头的让位量（导出供测试与渲染层口径一致）。 */
export const EGO_ARROW_INSET = EGO_ARROW_GAP;
