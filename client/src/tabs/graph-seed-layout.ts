/**
 * 全图星图的初始布局:type 扇区 seed 坐标(轨③纯函数,无 G6/无 DOM/无契约依赖)。
 *
 * 目的(spec 模块 B/T3-4):
 * - 分组观感——五类实体各占一个扇区,进 Tab 未等物理收敛就先"按组"成团;
 * - 同图同形——坐标只由 id hash 决定(与输入顺序、组内序号无关),
 *   同一张图每次加载开局逐位一致,消除"布局彩票";收敛后的微调交给 G6 物理。
 *
 * 未知 type(理论上生产不出现:apply 校验超集即丢弃)不混入五类扇区,
 * 单独占末位扇区,视觉分组不被污染。
 */

/** 扇区顺序 = 存储侧 GraphNodeType 枚举序(types.ts GRAPH_NODE_TYPES,改动需同步)。 */
const SECTOR_ORDER = ['person', 'project', 'organization', 'tool', 'place'] as const;

export interface SeedInput {
  id: string;
  type: string;
}

export interface SeedPoint {
  id: string;
  x: number;
  y: number;
}

/** FNV-1a 32bit:非加密、纯散列,同串恒同值(跨引擎确定性)。 */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** [0,1) 均匀分布分量(salt 让同一 id 的角/径解耦)。 */
function unit(id: string, salt: string): number {
  return hash32(`${id}\u0000${salt}`) / 0x100000000;
}

/** 世界半径:画布短边一半 ×0.85 留边(与 G6 容器尺寸解耦,渲染层自行给 width/height)。 */
export function worldRadius(width: number, height: number): number {
  return (Math.min(width, height) / 2) * 0.85;
}

/**
 * 生成初始坐标:以 (0,0) 为世界中心,每个节点落在其 type 扇区内的 hash 定点。
 * 扇区起始角 −π/2(正上方起,顺时针),与邻域径向卡既有角式同族。
 */
export function seedPositions(nodes: readonly SeedInput[], width: number, height: number): SeedPoint[] {
  if (nodes.length === 0) return [];
  const R = worldRadius(width, height);
  const hasUnknown = nodes.some((n) => !SECTOR_ORDER.includes(n.type as (typeof SECTOR_ORDER)[number]));
  const sectors = SECTOR_ORDER.length + (hasUnknown ? 1 : 0);
  const sectorWidth = (Math.PI * 2) / sectors;
  return nodes.map((n) => {
    let idx = SECTOR_ORDER.indexOf(n.type as (typeof SECTOR_ORDER)[number]);
    if (idx < 0) idx = SECTOR_ORDER.length; // 未知 type 的专属末位扇区
    const start = idx * sectorWidth - Math.PI / 2;
    // 角度取扇区中段 76%(两端各留 12% 扇隙,组间留白才"看得出分团");半径 0.35R~0.95R
    const angle = start + (0.12 + 0.76 * unit(n.id, 'angle')) * sectorWidth;
    const r = R * (0.35 + 0.6 * unit(n.id, 'radius'));
    return { id: n.id, x: Math.cos(angle) * r, y: Math.sin(angle) * r };
  });
}
