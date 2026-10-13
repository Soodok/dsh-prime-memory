/**
 * 本会话召回区（G-live）：pill 浮层里的一段**普通只读列表**——当前会话注入过、且正文仍在
 * 上下文里的那几条（= 模型此刻真正看到的）。
 *
 * 两种“离场”分处理（用户 2026-10-13 定）：
 * - 已被摘要取代（`superseded`）：**直接隐藏不显示**，与 brief 折叠同口径；
 * - 判过时（`retired`）：仍列出并划删除线——那是人的裁决凭证，“正文没了”不是丢掉裁决的理由。
 * 两标记同存时保留该行（裁决优先）。压缩不再清空底层列表（12a5154），所以“隐藏”必须发生在
 * 这一层的过滤上，而不是靠数据被删。
 *
 * 刻意**不是**槽位：
 * - 不注册、不常驻、不提供 pin/激活任何写操作。记忆按相关性隐式浮现；
 * - 数据源 `dsh-memory/session-recalled`（按 sessionKey 的持久 sidecar），
 *   所以旧会话重开也读得到，不是重启即空的内存态；
 * - 与 `memorySlots` 投影无关（那条路只承载用户手动写的常驻约定）。
 *
 * 轮询同 SessionInfoArea：浮层挂载（展开）期间才转；RPC 失败保留上一帧，
 * 首帧未送达前整块隐藏（不拿空态骗人）。
 */
import { useEffect, useState, type CSSProperties } from 'react';
import type { UiRecord } from '../../../src/contract.js';
import { registerTypeCatalog, tagClass, typeLabel } from '../format.js';
import type { RpcFn } from '../rpc.js';

/** 最多展示条数：浮层只有 196px 宽，再多读不动（折叠为「+N 条更早」）。 */
const SHOW_CAP = 6;
/** 轮询间隔(ms)：只在浮层展开期间转，成本可忽略。 */
const POLL_MS = 4000;

const MATURITY_LABEL: Record<'low' | 'mid' | 'high', string> = { high: '成熟·高', mid: '成熟·中', low: '成熟·低' };

export function SessionRecalledArea(props: { rpc: RpcFn; sessionId: string }) {
  const rpc = props.rpc;
  const sessionId = props.sessionId;
  // undefined = 首帧未送达（整块隐藏）；数组 = 最新活召回集（含空数组=本会话确实还没召回）
  const [records, setRecords] = useState<UiRecord[] | undefined>(undefined);

  useEffect(() => {
    if (!rpc || !sessionId) return undefined;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let seq = 0;
    const tick = () => {
      const token = ++seq;
      rpc('dsh-memory/session-recalled', { sessionId })
        .then((r) => {
          if (!alive || token !== seq) return;
          if (r && r.ok && r.value) {
            // 词表目录随响应下发（task_1.5）：pill 与面板同源取标签，不手抄。
            registerTypeCatalog(r.value.typeCatalog);
            setRecords(r.value.records);
          }
        })
        .catch(() => {
          /* 瞬时失败：保留上一帧，不闪没 */
        })
        .then(() => {
          if (alive) timer = setTimeout(tick, POLL_MS);
        });
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [rpc, sessionId]);

  if (records === undefined) return null;

  // 正文已被摘要取代的条目直接隐藏（用户定，与 brief 折叠同口径）；判过时行例外保留——
  // 那是裁决凭证，两标记同存时也不能一起藏掉。
  const rows = records.filter((r) => r.superseded !== true || r.retired === true);
  // 注入序是旧→新，展示成最近在上
  const recentFirst = [...rows].reverse();
  const shown = recentFirst.slice(0, SHOW_CAP);
  const hidden = recentFirst.length - shown.length;
  // 底层确实召回过、只是全部被折叠：不能当成“从没召回”。
  const allSuperseded = rows.length === 0 && records.length > 0;

  return (
    <div className="dsh-mem-sinfo">
      <div
        style={{ fontSize: 11, color: 'var(--dsh-mem-text-3)', marginBottom: 6 }}
        title="本会话召回、且正文仍在上下文里的记忆（正文被摘要顶掉的已折叠不显示；清空会话才清除；不是常驻注入）"
      >
        {'本会话召回 ' + rows.length + ' 条'}
      </div>
      {allSuperseded ? (
        // 不是“还没召回到”——那批确实注入过，只是正文已被摘要顶掉。说谎的空态比不显示更糟。
        <div style={{ fontSize: 11, color: 'var(--dsh-mem-text-3)', lineHeight: '16px' }}>
          {'本会话注入过的 ' + records.length + ' 条记忆正文已被摘要取代'}
        </div>
      ) : records.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--dsh-mem-text-3)', lineHeight: '16px' }}>
          还没召回到记忆（聊几轮后按相关性自动浮现）
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {shown.map((r) => (
            <div key={r.id} style={rowStyle} title={rowTitle(r)}>
              <span
                className={tagClass(r.type)}
                style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
              >
                {typeLabel(r.type)}
              </span>
              <span className="dsh-mem-sinfo-val" style={r.retired === true ? STALE_TEXT_STYLE : textStyle}>
                {r.content}
              </span>
              {/* 判过时的条目不摘除，只划掉：那是人的裁决，与“正文还在不在”无关。 */}
              {r.retired === true ? (
                <span style={{ fontSize: 10, color: 'var(--dsh-mem-text-3)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  已判过时
                </span>
              ) : null}
              {r.maturity ? (
                <span style={{ fontSize: 10, color: 'var(--dsh-mem-text-3)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {MATURITY_LABEL[r.maturity]}
                </span>
              ) : null}
            </div>
          ))}
          {hidden > 0 ? (
            <div style={{ fontSize: 11, color: 'var(--dsh-mem-text-3)' }}>{'+ ' + hidden + ' 条更早召回（详见面板「记忆」页）'}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** 一行：标签 + 正文 + 成熟度（标签/成熟度不换行，正文吃剩余宽度）。 */
const rowStyle = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 6,
  lineHeight: '16px',
} as CSSProperties;

/** 正文：最多两行，超出省略（全文在 title 里）。minWidth 0 才能让 flex 子项被钳制。 */
const textStyle = {
  fontSize: 12,
  lineHeight: '16px',
  fontWeight: 400,
  minWidth: 0,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
} as CSSProperties & Record<string, string | number>;

/** 已判过时：同一样式加删除线（不新增颜色字面量，置灰交给行旁的旁注）。 */
const STALE_TEXT_STYLE = { ...textStyle, textDecoration: 'line-through' } as CSSProperties & Record<string, string | number>;

/** 悬停给全文与使用场景（正文行内被钳制，别让人只看到半句）。 */
function rowTitle(r: UiRecord): string {
  const head = '[' + typeLabel(r.type) + '] ' + r.content;
  const sc = r.usageScenario && r.usageScenario.length > 0 ? '\n使用场景：' + r.usageScenario.join('；') : '';
  return head + sc;
}
