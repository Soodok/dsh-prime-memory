/** 跨 Tab 共用的格式化函数与类型词表目录。 */

/**
 * 类型标签表（pm-name-distill task_1.5）：手抄 7 项 `TYPE_LABELS` 已下线，
 * 目录由服务端随 `list-records` / `session-recalled` 下发（单一真源在
 * `src/memory-types.ts`）。未注册前（旧服务端/首帧未到）降级显示 type 原值——
 * 标签晚点出来，好过 client 侧再养一份会漂移的手抄表。
 */
let typeLabels: Record<string, string> = {};

/** 注册下发的词表目录（幂等，多次调用累积覆盖）。 */
export function registerTypeCatalog(entries: Array<{ id: string; label: string }> | undefined | null): void {
  if (!entries || entries.length === 0) return;
  const next: Record<string, string> = { ...typeLabels };
  for (const e of entries) next[e.id] = e.label;
  typeLabels = next;
}

/** type → 展示标签；未注册时回落原值（不编标签）。 */
export function typeLabel(type: string): string {
  return typeLabels[type] || type;
}

/** 已注册词表的 id 序（筛选器下拉选项源；未注册时为空，调用方自行降级）。 */
export function typeCatalogIds(): string[] {
  return Object.keys(typeLabels);
}

/**
 * 标签 CSS 类（F11）：统一 slug（`_`→`-`）。
 * 旧拼接直接用 `type` 原值，`dsh-mem-tag-work_fact` 匹配不上主题 CSS 的
 * `.dsh-mem-tag-work-fact`，标签无色；拼接点只认这一个形状。
 */
export function tagClass(type: string): string {
  return 'dsh-mem-tag dsh-mem-tag-' + type.replace(/_/g, '-');
}

/** ISO 时间 → 本地可读串；空值/非法输入回退原样或 '-'。 */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

/** 相对时间（悬浮卡摘要行用）：刚刚 / N 分钟前 / N 小时前 / N 天前；无效返回 null。 */
export function fmtAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const t = new Date(iso).getTime();
    if (!t) return null;
    let s = Math.floor((Date.now() - t) / 1000);
    if (s < 0) s = 0;
    if (s < 45) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    return Math.floor(s / 86400) + ' 天前';
  } catch {
    return null;
  }
}

/** 字节数 → 人类可读体积（嵌入模型卡等）：KB/MB 两级，百 MB 以上取整。 */
export function fmtMB(bytes: number): string {
  if (!bytes || bytes <= 0) return '0MB';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0) + 'MB';
}
