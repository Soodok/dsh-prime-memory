/** Tab：L1 记忆浏览器（搜索/筛选/分页 + 展开详情 + 高权限**退场(软删)** + 已退场区恢复）。 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ListRecordsRequest, RetiredRecordView, UiRecord } from '../../../src/contract.js';
import { TYPE_LABELS, fmtTime } from '../format.js';
import type { RpcFn } from '../rpc.js';
import { S } from '../styles.js';
import { NSel, type NSelOption } from '../ui/NSel.js';
import { NButton, NInput } from '../ui/primitives.js';

interface QueryConds {
  query: string;
  type: string;
  scene: string;
  halls: string[];
  /** Room 过滤(自生长 slug tag;空 = 不过滤)。 */
  tag: string;
  /** 孤儿记忆:只看没有任何 Room 绑定的记录(与 tag 互斥)。 */
  untagged: boolean;
  /** 退场筛查:''=全部(混排+徽标) / 'active'=仅活跃 / 'retired'=仅已退场。 */
  retired: '' | 'active' | 'retired';
}

/** 退场筛查 → 契约三态布尔('' 不传 = 全部)。 */
function retiredSelOf(r: '' | 'active' | 'retired'): boolean | undefined {
  if (r === 'active') return false;
  if (r === 'retired') return true;
  return undefined;
}

// 两族混合视图：筛选器提供全部 7 种类型
const TYPE_CHOICES = [
  'persona',
  'episodic',
  'instruction',
  'work_fact',
  'work_task',
  'work_method',
  'work_artifact',
];

// Hall 属性通道筛选项(R8 单一事实源):随 list-records 首屏由服务端下发(8 角 + general 跨域),
// client 不再手抄词表。下发缺失(旧服务端)时降级为从已加载记录的 wing 值派生选项(只显示已有标签)。

/** records-delete 单次上限（契约：ids ≤200）。 */
const DELETE_LIMIT = 200;

export function RecordsTab(props: { rpc: RpcFn }) {
  const rpc = props.rpc;
  const limit = 50;

  const [items, setItems] = useState<UiRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [sceneOptions, setSceneOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 勾选待删集合（批量删除用）；换页/搜索重置
  const [sel, setSel] = useState<Set<string>>(new Set());
  // 写删权限门（memoryMutate）：开启后模型获得写删工具、面板可删除记忆
  const [hiPriv, setHiPriv] = useState(false);
  const [hiPrivBusy, setHiPrivBusy] = useState(false);

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sceneFilter, setSceneFilter] = useState('');
  const [hallFilter, setHallFilter] = useState<string[]>([]);
  // Room 过滤(标签自生长分类):点分类 chip 即按该 tag 筛选记录
  const [tagFilter, setTagFilter] = useState('');
  // 孤儿记忆(无 Room 绑定)筛选:与 tagFilter 互斥
  const [untaggedOnly, setUntaggedOnly] = useState(false);
  const [orphanCount, setOrphanCount] = useState(0);
  // 退场筛查:''=全部(混排+徽标) / 'active'=仅活跃 / 'retired'=仅已退场
  const [retiredFilter, setRetiredFilter] = useState<'' | 'active' | 'retired'>('');
  // Wing 词表(服务端下发,R8);null = 未下发(降级:从已加载记录派生)
  const [wingCatalog, setHallCatalog] = useState<Array<{ id: string; label: string }> | null>(null);

  // 上一次实际生效的查询条件（「加载更多」按它续页）
  const [last, setLast] = useState<QueryConds>({ query: '', type: '', scene: '', halls: [], tag: '', untagged: false, retired: '' });

  // 请求序号：快速搜索/翻页时旧响应过期即弃，避免慢响应覆盖新结果
  const seqRef = useRef(0);

  const fetchPage = useCallback(
    (conds: QueryConds, offset: number, append: boolean) => {
      setLoading(true);
      setError(null);
      const token = ++seqRef.current;
      const payload: ListRecordsRequest = { limit, offset };
      if (conds.query) payload.query = conds.query;
      if (conds.type) payload.type = conds.type;
      if (conds.scene) payload.scene = conds.scene;
      if (conds.halls.length > 0) payload.halls = conds.halls;
      if (conds.tag) payload.tag = conds.tag;
      if (conds.untagged) payload.untagged = true;
      const retiredSel = retiredSelOf(conds.retired);
      if (retiredSel !== undefined) payload.retired = retiredSel;
      rpc('dsh-memory/list-records', payload)
        .then((r) => {
          if (token !== seqRef.current) return;
          setLoading(false);
          if (!r || !r.ok) {
            setError(r && r.error ? r.error.message : 'RPC error');
            return;
          }
          const v = r.value;
          setItems((prev) => (append ? prev.concat(v.items) : v.items));
          if (v.usageSummary) setUsageSummary(v.usageSummary);
          // 换页（非追加）时勾选集作废：列表内容已不是原来那批
          if (!append) setSel(new Set());
          setHasMore(!!v.hasMore);
          setTotal(v.total === undefined || v.total === null ? null : v.total);
          setTruncated(!!v.truncated);
          if (v.scenes) setSceneOptions(v.scenes);
          if (v.wingCatalog) setHallCatalog(v.wingCatalog);
        })
        .catch((e: unknown) => {
          if (token !== seqRef.current) return;
          setLoading(false);
          setError(String((e && (e as Error).message) || e));
        });
    },
    [rpc],
  );

  const search = () => {
    const conds = { query: query.trim(), type: typeFilter, scene: sceneFilter, halls: hallFilter, tag: tagFilter, untagged: untaggedOnly, retired: retiredFilter };
    setLast(conds);
    fetchPage(conds, 0, false);
  };

  /** 切换退场筛查(全部/仅活跃/仅退场)并立即重查第一页。 */
  const applyRetiredFilter = (next: '' | 'active' | 'retired') => {
    setRetiredFilter(next);
    const conds = { query: query.trim(), type: typeFilter, scene: sceneFilter, halls: hallFilter, tag: tagFilter, untagged: untaggedOnly, retired: next };
    setLast(conds);
    fetchPage(conds, 0, false);
  };

  // 孤儿计数(Room 标签/分类浏览已分离至 Hall 页;此处只留"无绑定"视图)
  const loadRooms = useCallback(() => {
    rpc('dsh-memory/rooms-get', {})
      .then((r) => {
        if (r && r.ok) setOrphanCount(r.value.orphanCount ?? 0);
      })
      .catch(() => {
        /* 端点不可用时静默,不影响列表主功能 */
      });
  }, [rpc]);

  useEffect(() => {
    fetchPage({ query: '', type: '', scene: '', halls: [], tag: '', untagged: false, retired: '' }, 0, false);
    loadRooms();
  }, [fetchPage, loadRooms]);

  // 读当前写删门状态（settings-get 的 key 均脱敏，memoryMutate 布尔原样）
  const loadHiPriv = useCallback(() => {
    rpc('dsh-memory/settings-get', {})
      .then((r) => {
        if (r && r.ok && r.value) setHiPriv(!!r.value.settings.memoryMutate);
      })
      .catch(() => {});
  }, [rpc]);
  useEffect(() => {
    loadHiPriv();
  }, [loadHiPriv]);

  const toggleHiPriv = () => {
    const next = !hiPriv;
    if (next && !window.confirm('开启高权限模式：模型获得写入/删除记忆工具，记忆库可删除指定记忆。确定开启？')) return;
    setHiPrivBusy(true);
    rpc('dsh-memory/settings-set', { memoryMutate: next })
      .then((r) => {
        if (r && r.ok) setHiPriv(next);
        else if (r) setError(r.error ? r.error.message : '切换高权限模式失败');
        setHiPrivBusy(false);
        loadHiPriv();
      })
      .catch((e: unknown) => {
        setHiPrivBusy(false);
        setError(String((e && (e as Error).message) || e));
      });
  };

  const toggleSel = (id: string) => {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 批量退场勾选记忆（records-delete = **软删**，ids 数组一次 ≤200）。
   *  写删门关闭时不动手：给提示引导先开高权限模式。 */
  const deleteSelected = () => {
    const ids = Array.from(sel);
    if (ids.length === 0) return;
    if (!hiPriv) {
      setError('高权限模式未开启：请在右上「高权限：关」或概览页开关中开启后，再退场记忆。');
      return;
    }
    if (ids.length > DELETE_LIMIT) {
      setError('一次最多退场 ' + DELETE_LIMIT + ' 条（当前勾选 ' + ids.length + ' 条），请分批操作。');
      return;
    }
    if (!window.confirm('退场勾选的 ' + ids.length + ' 条记忆？\n\n它们会移出检索面（不再被召回），但记录仍保留 —— 可在下方「已退场」区恢复。')) return;
    rpc('dsh-memory/records-delete', { ids })
      .then((r) => {
        if (r && r.ok) {
          setSel(new Set());
          if (expandedId && ids.indexOf(expandedId) >= 0) setExpandedId(null);
          fetchPage(last, 0, false);
          if (showRetired) loadRetired();
        } else if (r) setError(r.error ? r.error.message : '退场失败');
      })
      .catch((e: unknown) => setError(String((e && (e as Error).message) || e)));
  };

  /** 单条退场（软删，可恢复；host 侧同样有 memoryMutate 门兜底）。 */
  const deleteRecord = (id: string) => {
    if (!window.confirm('退场该条记忆？\n\n它会移出检索面（不再被召回），但记录仍保留 —— 可在下方「已退场」区恢复。')) return;
    rpc('dsh-memory/records-delete', { ids: [id] })
      .then((r) => {
        if (r && r.ok) {
          setSel((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          if (expandedId === id) setExpandedId(null);
          fetchPage(last, 0, false);
          if (showRetired) loadRetired();
        } else if (r) setError(r.error ? r.error.message : '退场失败');
      })
      .catch((e: unknown) => setError(String((e && (e as Error).message) || e)));
  };

  /** 已退场（软删）记录：可恢复。默认折叠，展开时才拉取——不让它拖慢正常浏览。 */
  const [retired, setRetired] = useState<RetiredRecordView[]>([]);
  const [retiredTotal, setRetiredTotal] = useState(0);
  const [showRetired, setShowRetired] = useState(false);
  const [retiredBusy, setRetiredBusy] = useState(false);

  const loadRetired = useCallback(() => {
    setRetiredBusy(true);
    rpc('dsh-memory/records-retired', { limit: 100, offset: 0 })
      .then((r) => {
        if (r && r.ok) {
          setRetired(r.value.items);
          setRetiredTotal(r.value.total);
        } else if (r) setError(r.error ? r.error.message : '已退场列表加载失败');
      })
      .catch((e: unknown) => setError(String((e && (e as Error).message) || e)))
      .finally(() => setRetiredBusy(false));
  }, [rpc]);

  useEffect(() => {
    if (showRetired) loadRetired();
  }, [showRetired, loadRetired]);

  /** 恢复：送回检索面（向量不可用时仅回关键词检索，不视为失败）。 */
  const restoreRecords = (ids: string[]) => {
    if (ids.length === 0) return;
    setRetiredBusy(true);
    rpc('dsh-memory/records-restore', { ids })
      .then((r) => {
        if (r && r.ok) {
          loadRetired();
          fetchPage(last, 0, false);
        } else if (r) setError(r.error ? r.error.message : '恢复失败');
      })
      .catch((e: unknown) => setError(String((e && (e as Error).message) || e)))
      .finally(() => setRetiredBusy(false));
  };

  const RETIRE_REASON_LABEL: Record<string, string> = {
    conflict: '裁决退场',
    superseded: '被取代',
    manual: '人工退场',
    obsolete: '声明过时',
    unknown: '已退场',
  };

  const countText = total !== null ? '共 ' + total + ' 条' : items.length + ' 条' + (hasMore ? '+' : '');
  // 召回使用汇总(首屏响应附带;进 topN 才算 used)
  const [usageSummary, setUsageSummary] = useState<{ tracked: number; attempted: number; used: number; rate: number } | null>(null);
  const selCount = sel.size;

  return (
    <div>
      <div style={S.toolbar}>
        <NInput
          style={{ flex: 1, minWidth: 160 }}
          placeholder="搜索记忆内容（BM25 关键词）…"
          value={query}
          onChange={(e: { target: { value: string } }) => {
            setQuery(e.target.value);
          }}
          onKeyDown={(e: ReactKeyboardEvent) => {
            if (e.key === 'Enter') search();
          }}
        />
        <NSel
          style={{ maxWidth: 200 }}
          options={([{ id: '', label: '全部类型' }] as NSelOption[]).concat(
            TYPE_CHOICES.map((t) => {
              return { id: t, label: TYPE_LABELS[t] || t };
            }),
          )}
          value={typeFilter}
          onChange={setTypeFilter}
        />
        <NSel
          style={{ maxWidth: 220 }}
          options={([{ id: '', label: '全部情境' }] as NSelOption[]).concat(
            sceneOptions.map((s) => {
              return { id: s, label: s.length > 24 ? s.slice(0, 24) + '…' : s };
            }),
          )}
          value={sceneFilter}
          onChange={setSceneFilter}
        />
        <WingMultiSelect
          options={
            wingCatalog ??
            Array.from(new Set(items.map((m) => m.hall).filter((h): h is string => !!h))).map((id) => ({ id, label: id }))
          }
          selected={hallFilter}
          onChange={setHallFilter}
        />
        <NButton onClick={search}>搜索</NButton>
        <NButton
          style={{
            color: hiPriv ? 'var(--dsh-mem-danger)' : undefined,
            border: hiPriv ? '1px solid var(--dsh-mem-danger)' : undefined,
          }}
          disabled={hiPrivBusy}
          title={hiPriv ? '关闭高权限模式（收回模型写删工具与删除权限）' : '开启高权限模式以写删记忆'}
          onClick={toggleHiPriv}
        >
          {hiPriv ? '高权限：开' : '高权限：关'}
        </NButton>
      </div>
      {/* ── 孤儿筛选(Room 标签/分类管理已分离至 Hall 页) ── */}
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          title={untaggedOnly ? '取消孤儿筛选' : '只看没有任何 Room 绑定的记忆'}
          onClick={() => {
            const next = !untaggedOnly;
            setUntaggedOnly(next);
            if (next) setTagFilter('');
            const conds = { query: query.trim(), type: typeFilter, scene: sceneFilter, halls: hallFilter, tag: next ? '' : tagFilter, untagged: next, retired: retiredFilter };
            setLast(conds);
            fetchPage(conds, 0, false);
          }}
          style={{
            cursor: 'pointer', fontSize: 12, padding: '2px 8px', borderRadius: 999,
            border: untaggedOnly ? '1px solid var(--dsh-mem-accent)' : '1px solid var(--dsh-mem-border)',
            background: untaggedOnly ? 'var(--dsh-mem-bg-inset)' : 'transparent',
            color: untaggedOnly ? 'var(--dsh-mem-accent)' : 'var(--dsh-mem-text-2)',
          }}
        >
          {'无绑定 · ' + orphanCount}
        </button>
        {(tagFilter || untaggedOnly) && (
          <span style={S.muted}>
            筛选中:{untaggedOnly ? '无绑定' : tagFilter}
            <button
              type="button"
              title="清除 Room/孤儿筛选"
              onClick={() => {
                setTagFilter('');
                setUntaggedOnly(false);
                const conds = { query: query.trim(), type: typeFilter, scene: sceneFilter, halls: hallFilter, tag: '', untagged: false, retired: retiredFilter };
                setLast(conds);
                fetchPage(conds, 0, false);
              }}
              style={{ cursor: 'pointer', marginLeft: 6, background: 'transparent', border: 'none', color: 'var(--dsh-mem-accent)', fontSize: 12 }}
            >
              ×清除
            </button>
          </span>
        )}
        <button
          type="button"
          title="导出无 Room 绑定的孤儿清单 CSV(含候选)"
          onClick={() => {
            rpc('dsh-memory/rooms-export', { kind: 'orphans' })
              .then((r) => {
                if (!r || !r.ok || !r.value?.csv) return;
                const blob = new Blob([r.value.csv as string], { type: 'text/csv;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'dsh-memory-room-orphans.csv';
                a.click();
                URL.revokeObjectURL(url);
              })
              .catch(() => undefined);
          }}
          style={{
            cursor: 'pointer', fontSize: 12, padding: '2px 8px', borderRadius: 6,
            border: '1px solid var(--dsh-mem-border)', background: 'transparent',
            color: 'var(--dsh-mem-text-2)',
          }}
        >
          导出孤儿
        </button>
        <span style={S.muted}>Room 标签/分类管理:见「Hall」「Room」标签页。</span>
      </div>
      <div style={{ ...S.flexRow, marginBottom: 10 }}>
        <span style={S.muted}>{loading ? '加载中…' : countText}</span>
        {usageSummary ? (
          <span style={S.muted} title="老化权重效果口径:参与召回尝试的记忆中,进 topN(被注入上下文)的比例">{'召回使用 ' + usageSummary.used + '/' + usageSummary.attempted + '(' + usageSummary.rate + '%)'}</span>
        ) : null}
        {/* 退场筛查:三态分开看——软删记录不隐藏(可恢复),但混排时可一键分流 */}
        <span style={S.muted}>退场筛查</span>
        {([['', '全部'], ['active', '仅活跃'], ['retired', '仅退场']] as const).map(([val, label]) => {
          const on = retiredFilter === val;
          return (
            <button
              key={val}
              type="button"
              title={
                val === ''
                  ? '活跃与已退场混排（已退场的带徽标）'
                  : val === 'active'
                    ? '只看未退场的记忆'
                    : '只看已退场（软删）的记忆，可在此恢复'
              }
              onClick={() => applyRetiredFilter(val)}
              style={{
                cursor: 'pointer',
                fontSize: 12,
                padding: '2px 10px',
                borderRadius: 999,
                border: on ? '1px solid var(--dsh-mem-accent)' : '1px solid var(--dsh-mem-border)',
                background: on ? 'var(--dsh-mem-bg-inset)' : 'transparent',
                color: on ? 'var(--dsh-mem-accent)' : 'var(--dsh-mem-text-2)',
              }}
            >
              {label}
            </button>
          );
        })}
        {/* 批量删除：勾选后成组调 records-delete；写删门关闭时点击给提示 */}
        <NButton
          style={selCount > 0 ? { color: 'var(--dsh-mem-danger)' } : undefined}
          disabled={selCount === 0}
          title={hiPriv ? '删除勾选的记忆（一次最多 ' + DELETE_LIMIT + ' 条）' : '高权限模式未开启，删除不可用'}
          onClick={deleteSelected}
        >
          {'删除选中' + (selCount > 0 ? '（' + selCount + '）' : '')}
        </NButton>
        {selCount > 0 ? (
          <NButton
            onClick={() => {
              setSel(new Set());
            }}
          >
            清空选择
          </NButton>
        ) : null}
        <div style={S.grow} />
        <NButton
          onClick={() => {
            fetchPage(last, 0, false);
            loadRooms();
          }}
        >
          刷新
        </NButton>
      </div>
      {!hiPriv ? <div style={S.hint}>提示：删除记忆需先开启高权限模式（右上开关或概览页「高权限模式」），关闭时删除按钮不可用。</div> : null}
      {error ? <div style={S.error}>{error}</div> : null}
      {truncated ? (
        <div style={S.hint}>搜索分页已达检索上限（200 条），更早的结果未显示。请用更精确的关键词或类型/情境过滤。</div>
      ) : null}
      {items.length === 0 && !loading && !error ? (
        <p style={S.intro}>暂无记忆。对话几轮后，蒸馏管线会自动抽取记忆。</p>
      ) : (
        items.map((m) => {
          const open = expandedId === m.id;
          const checked = sel.has(m.id);
          return (
            <div
              key={m.id}
              className="dsh-mem-card dsh-mem-card-hover"
              style={{ ...S.card, cursor: 'pointer', ...(checked ? { borderLeft: '3px solid var(--dsh-mem-danger)' } : null), ...(m.retired ? { opacity: 0.62 } : null) }}
              onClick={() => {
                setExpandedId(open ? null : m.id);
              }}
            >
              <div style={S.cardHead}>
                {/* 勾选框（阻止冒泡：点勾选不触发展开/收起） */}
                <input
                  type="checkbox"
                  checked={checked}
                  style={{ margin: 0, cursor: 'pointer', flexShrink: 0 }}
                  title="勾选以批量删除"
                  onClick={(e: { stopPropagation(): void }) => {
                    e.stopPropagation();
                  }}
                  onChange={() => {
                    toggleSel(m.id);
                  }}
                />
                <span className={'dsh-mem-tag dsh-mem-tag-' + m.type}>{TYPE_LABELS[m.type] || m.type}</span>
                {m.hall ? (
                  <span className="dsh-mem-tag dsh-mem-tag-work-fact">
                    {"Wing · " + (wingCatalog?.find((h) => h.id === m.hall)?.label || m.hall)}
                  </span>
                ) : null}
                {m.retired ? (
                  <span
                    title="该记忆已退场（软删）：移出检索面但仍可恢复，并未真正删除"
                    style={{
                      fontSize: 11,
                      padding: '1px 6px',
                      borderRadius: 999,
                      border: '1px solid var(--dsh-mem-danger)',
                      color: 'var(--dsh-mem-danger)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {'已退场' + (m.retiredReason ? ' · ' + (RETIRE_REASON_LABEL[m.retiredReason] || m.retiredReason) : '')}
                  </span>
                ) : null}
                <span style={S.muted}>{'优先级 ' + m.priority}</span>
                {m.maturity ? (
                  <span
                    title={'成熟度（优先级 + 被用次数 + 新鲜度合成）：' + m.maturity}
                    style={{
                      fontSize: 11,
                      padding: '1px 6px',
                      borderRadius: 999,
                      whiteSpace: 'nowrap',
                      border: '1px solid var(--dsh-mem-border)',
                      color: 'var(--dsh-mem-text-2)',
                    }}
                  >
                    {m.maturity === 'high' ? '成熟·高' : m.maturity === 'mid' ? '成熟·中' : '成熟·低'}
                  </span>
                ) : null}
                {m.agingWeight != null ? (
                  <span
                    style={{
                      fontSize: 11, padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap',
                      border: '1px solid ' + (m.agingWeight <= 0.6 ? 'var(--dsh-mem-danger)' : 'var(--dsh-mem-border)'),
                      color: m.agingWeight <= 0.6 ? 'var(--dsh-mem-danger)' : 'var(--dsh-mem-text-2)',
                    }}
                    title={'老化权重 ' + Math.round(m.agingWeight * 100) + '%(读路径衰减系数 max(0.5, 0.5^(Δ天/半衰期)));越低越老'}
                  >
                    {'老化 ' + Math.round(m.agingWeight * 100) + '%'}
                  </span>
                ) : null}
                {m.usage ? (
                  <span
                    style={S.muted}
                    title={'召回使用 ' + m.usage.used + '/' + m.usage.attempts + '(进 topN 才算 used)'
                      + (m.usage.lastUsedAt ? ';最近使用 ' + fmtTime(new Date(m.usage.lastUsedAt).toISOString()) : '')
                      + (m.usage.lastAttemptAt ? ';最近尝试 ' + fmtTime(new Date(m.usage.lastAttemptAt).toISOString()) : '')}
                  >
                    {'用 ' + m.usage.used + '/' + m.usage.attempts}
                  </span>
                ) : null}
                {m.score !== null && m.score !== undefined ? (
                  <span style={S.muted}>{'相关度 ' + Number(m.score).toFixed(2)}</span>
                ) : null}
                <div style={S.grow} />
                <span style={S.muted}>{fmtTime(m.updatedAt)}</span>
                {m.retired ? (
                  <NButton
                    style={{ padding: '0 7px', minWidth: 26, height: 26, fontSize: 12, color: 'var(--dsh-mem-accent)' }}
                    title="恢复该记忆到检索面（可撤销退场）"
                    onClick={(e: { stopPropagation(): void }) => {
                      e.stopPropagation();
                      restoreRecords([m.id]);
                    }}
                  >
                    恢复
                  </NButton>
                ) : hiPriv ? (
                  <NButton
                    style={{ padding: '0 7px', minWidth: 26, height: 26, fontSize: 12, color: 'var(--dsh-mem-danger)' }}
                    title="删除该记忆（高权限）"
                    onClick={(e: { stopPropagation(): void }) => {
                      e.stopPropagation();
                      deleteRecord(m.id);
                    }}
                  >
                    ✕
                  </NButton>
                ) : null}
              </div>
              <div style={S.content}>{m.content}</div>
              {open ? (
                <div style={S.detail}>
                  {'id: ' +
                    m.id +
                    '\n' +
                    '情境: ' +
                    (m.scene || '-') +
                    '\n' +
                    '版本: v' +
                    m.version +
                    '（去重合并次数 ' +
                    m.version +
                    '）\n' +
                    '创建: ' +
                    fmtTime(m.createdAt) +
                    '\n' +
                    '活跃时间: ' +
                    (m.timestamps && m.timestamps.length > 0 ? m.timestamps.map(fmtTime).join(' → ') : '-') +
                    '\n' +
                    (m.sourceAnchors && m.sourceAnchors.length > 0
                      ? '来源锚点: ' + m.sourceAnchors.join(', ')
                      : '来源锚点: -')}
                </div>
              ) : null}
            </div>
          );
        })
      )}
      {/* 已退场（软删）区：与活动记忆**分开呈现**——"退场了"与"根本没这条"必须能分辨 */}
      <div style={{ ...S.flexRow, marginTop: 12 }}>
        <NButton onClick={() => setShowRetired((v) => !v)}>
          {(showRetired ? '收起' : '展开') + '「已退场」（可恢复）'}
        </NButton>
        {showRetired && retiredBusy ? <span style={S.muted}>加载中…</span> : null}
        {showRetired && !retiredBusy && retiredTotal > 0 ? (
          <span style={S.muted}>{'共 ' + retiredTotal + ' 条可恢复'}</span>
        ) : null}
      </div>
      {showRetired ? (
        <div style={{ marginTop: 8 }}>
          {retired.length === 0 ? (
            <p style={S.hint}>{retiredBusy ? ' ' : '没有已退场的记忆。'}</p>
          ) : (
            <div>
              {retired.map((m) => (
                <div key={m.id} className="dsh-mem-card" style={S.card}>
                  <div style={S.cardHead}>
                    <span style={S.muted}>{RETIRE_REASON_LABEL[m.retiredReason] || m.retiredReason}</span>
                    {m.verdict ? <span style={S.muted}>{'结论 ' + m.verdict}</span> : null}
                    <div style={S.grow} />
                    <span style={S.muted}>{fmtTime(m.retiredAt)}</span>
                    <NButton disabled={retiredBusy} title="恢复到检索面" onClick={() => restoreRecords([m.id])}>
                      恢复
                    </NButton>
                  </div>
                  <div style={S.content}>{m.content}</div>
                </div>
              ))}
              {retiredTotal > retired.length ? (
                <p style={S.hint}>{'共 ' + retiredTotal + ' 条，此处显示 ' + retired.length + ' 条'}</p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
      {hasMore ? (
        <div style={S.flexRow}>
          <div style={S.grow} />
          <NButton
            disabled={loading}
            onClick={() => {
              if (!loading) fetchPage(last, items.length, true);
            }}
          >
            {loading ? '加载中…' : '加载更多'}
          </NButton>
        </div>
      ) : null}
      {/* 外部存档节（N8）：导出/对账两个真动作 + 一枚标着“待 P2”的同步位。 */}
      {/* 外部存档节已拉到概览页（ArchiveSection）：与重建/反刍同属运维动作。 */}
    </div>
  );
}


/** Hall 筛选多选下拉（R13 查询侧多选；选项 = 服务端下发的词表，缺失时降级为已有标签）。
 *  触发钮沿用 .dsh-mem-select 观感；面板复用 .dsh-mem-pop 材质，行内勾选即时切换。 */
function WingMultiSelect(props: {
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onChange(next: string[]): void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const labelOf = (id: string) => props.options.find((o) => o.id === id)?.label ?? id;
  const summary =
    props.selected.length === 0
      ? '全部 Wing'
      : props.selected.length <= 2
        ? props.selected.map(labelOf).join(' + ')
        : `${labelOf(props.selected[0]!)} 等 ${props.selected.length} 域`;
  const toggle = (id: string) => {
    props.onChange(props.selected.includes(id) ? props.selected.filter((x) => x !== id) : [...props.selected, id]);
  };
  return (
    <div ref={wrapRef} style={{ position: 'relative', maxWidth: 150 }}>
      <button
        type="button"
        className="dsh-mem-select"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="dsh-mem-select-label" title={summary}>
          {summary}
        </span>
        <span className={'dsh-mem-sel-chev' + (open ? ' dsh-mem-sel-chev-open' : '')} />
      </button>
      {open ? (
        <div className="dsh-mem-pop" role="listbox" style={{ left: 0, right: 'auto', minWidth: 150 }}>
          {props.options.length === 0 ? <div className="dsh-mem-pop-empty">暂无可筛 Hall</div> : null}
          {props.options.map((o) => {
            const active = props.selected.includes(o.id);
            return (
              <button key={o.id} type="button" className="dsh-mem-pop-opt" onClick={() => toggle(o.id)} aria-selected={active}>
                <span className="dsh-mem-pop-check">{active ? '✓' : ''}</span>
                <span className="dsh-mem-pop-label">{o.label}</span>
              </button>
            );
          })}
          {props.selected.length > 0 ? (
            <button type="button" className="dsh-mem-pop-opt" onClick={() => props.onChange([])}>
              <span className="dsh-mem-pop-check" />
              <span className="dsh-mem-pop-label">清除筛选</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
