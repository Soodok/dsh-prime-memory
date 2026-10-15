/**
 * 轻量 markdown 渲染（零外部依赖）。
 * 支持：heading h1-h6、**bold**、`code`、无序/有序列表、段落。
 * 用于 RecordsTab 的 L1 正文展示与将来查看器复用。
 */
import { createElement, Fragment, type ReactNode } from 'react';

/* ── 样式令牌（全部走 --dsh-mem-* 变量，与主题皮肤对齐） ── */
const H_STYLES: React.CSSProperties[] = [
  { fontSize: 15, fontWeight: 700, margin: '8px 0 4px', color: 'var(--dsh-mem-text-1)' },
  { fontSize: 14, fontWeight: 600, margin: '6px 0 3px', color: 'var(--dsh-mem-text-1)' },
  { fontSize: 13, fontWeight: 600, margin: '5px 0 2px', color: 'var(--dsh-mem-text-1)' },
  { fontSize: 12, fontWeight: 600, margin: '4px 0 2px', color: 'var(--dsh-mem-text-2)' },
  { fontSize: 12, fontWeight: 600, margin: '3px 0 1px', color: 'var(--dsh-mem-text-2)' },
  { fontSize: 11, fontWeight: 600, margin: '3px 0 1px', color: 'var(--dsh-mem-text-2)' },
];
const P: React.CSSProperties = { margin: '2px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
const LI: React.CSSProperties = { margin: '1px 0 1px 12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
const CODE: React.CSSProperties = {
  fontFamily: 'ui-monospace, monospace',
  fontSize: '0.92em',
  background: 'var(--dsh-mem-bg-3)',
  padding: '0 3px',
  borderRadius: 3,
};

/** 行内解析：**bold** 和 `code`。 */
function inline(text: string, key: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`/;
  let rest = text;
  let i = 0;
  while (rest.length > 0) {
    const m = re.exec(rest);
    if (m === null) { nodes.push(rest); break; }
    if (m.index > 0) nodes.push(rest.slice(0, m.index));
    if (m[1] !== undefined) {
      nodes.push(createElement('strong', { key: `${key}-b${i++}` }, m[1]));
    } else {
      nodes.push(createElement('code', { key: `${key}-c${i++}`, style: CODE }, m[2]));
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return nodes;
}

/** 把 markdown 字符串渲染为 React 节点树。 */
export function MarkdownBody({ text }: { text: string }): ReactNode {
  const lines = text.split('\n');
  const out: ReactNode[] = [];
  let idx = 0;
  for (const line of lines) {
    const t = line.trim();
    if (t.length === 0) continue;
    // heading
    const h = /^(#{1,6})\s+(.+)/.exec(t);
    if (h) {
      const lv = h[1].length;
      out.push(createElement(`h${lv}`, { key: `h${idx}`, style: H_STYLES[lv - 1] }, ...inline(h[2], `h${idx}`)));
      idx++;
      continue;
    }
    // unordered list
    const ul = /^[-*]\s+(.+)/.exec(t);
    if (ul) {
      out.push(createElement('div', { key: `li${idx}`, style: LI }, '• ', ...inline(ul[1], `li${idx}`)));
      idx++;
      continue;
    }
    // ordered list
    const ol = /^\d+\.\s+(.+)/.exec(t);
    if (ol) {
      out.push(createElement('div', { key: `li${idx}`, style: LI }, t.slice(0, t.indexOf('.') + 2), ...inline(ol[1], `li${idx}`)));
      idx++;
      continue;
    }
    // paragraph
    out.push(createElement('div', { key: `p${idx}`, style: P }, ...inline(t, `p${idx}`)));
    idx++;
  }
  return createElement(Fragment, null, ...out);
}
