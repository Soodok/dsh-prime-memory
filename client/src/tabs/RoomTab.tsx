/** Tab:Room —— room 级管理(与 Hall 页分离):存在(注册/收编/退役)、名称(改名/显示名/说明)、
 *  room 下的记忆条目(▸ 展开浏览,默认收起)。归类到 hall 的拖拽/点选在「Hall」页。 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { UiRecord } from '../../../src/contract.js';
import { fmtTime, registerTypeCatalog, tagClass, typeLabel } from '../format.js';
import type { RpcFn } from '../rpc.js';
import { S } from '../styles.js';

interface RegEntry {
  slug: string;
  label?: string;
  description?: string;
  source: 'pre-registered' | 'grown';
  aliases?: string[];
  status: 'active' | 'retired';
}

const btn: CSSProperties = {
  cursor: 'pointer', fontSize: 12, padding: '2px 8px', borderRadius: 6,
  border: '1px solid var(--dsh-mem-border)', background: 'transparent',
  color: 'var(--dsh-mem-text-2)',
};

function downloadCsv(csv: string, name: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function RoomTab(props: { rpc: RpcFn }) {
  const rpc = props.rpc;
  const [registry, setRegistry] = useState<RegEntry[]>([]);
  const [counts, setCounts] = useState<Array<{ room: string; count: number }>>([]);
  const [orphanCount, setOrphanCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hiPriv, setHiPriv] = useState(false);
  const [hiPrivBusy, setHiPrivBusy] = useState(false);
  const [reg, setReg] = useState({ slug: '', label: '', description: '' });
  const [editing, setEditing] = useState<{ slug: string; label: string; description: string } | null>(null);
  const [renaming, setRenaming] = useState<{ slug: string; to: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // 退场筛选:''=全部 / 'active'=活跃(词表未退役) / 'retired'=已退役
  const [retiredFilter, setRetiredFilter] = useState<'' | 'active' | 'retired'>('');
  // 名称搜索过滤:slug、显示名、别名,大小写不敏感(与退场筛选叠加)
  const [filter, setFilter] = useState('');
  const [records, setRecords] = useState<Record<string, { items: UiRecord[]; total: number | null }>>({});

  const loadAll = useCallback(() => {
    rpc('dsh-memory/rooms-get', {})
      .then((r) => {
        if (r && r.ok) {
          setCounts(r.value.rooms ?? []);
          setRegistry(r.value.registry ?? []);
          setOrphanCount(r.value.orphanCount ?? 0);
        }
      })
      .catch(() => undefined);
  }, [rpc]);

  const loadHiPriv = useCallback(() => {
    rpc('dsh-memory/settings-get', {})
      .then((r) => {
        if (r && r.ok && r.value) setHiPriv(!!r.value.settings.memoryMutate);
      })
      .catch(() => {});
  }, [rpc]);

  useEffect(() => {
    loadAll();
    loadHiPriv();
  }, [loadAll, loadHiPriv]);

  const toggleHiPriv = () => {
    const next = !hiPriv;
    if (next && !window.confirm('开启高权限模式:模型获得写入/删除记忆工具,并解锁 Room 管理操作。确定开启?')) return;
    rpc('dsh-memory/settings-set', { memoryMutate: next })
      .then((r) => {
        if (r && r.ok) setHiPriv(next);
        setHiPrivBusy(false);
        loadHiPriv();
      })
      .catch(() => setHiPrivBusy(false));
  };
  const run = (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    fn().finally(() => setBusy(false));
  };

  const register = () =>
    run(async () => {
      const r = await rpc('dsh-memory/room-register', { slug: reg.slug.trim(), label: reg.label.trim() || undefined, description: reg.description.trim() || undefined });
      if (r && r.ok) {
        setMsg(r.value?.notice ?? `已注册:${reg.slug.trim()}`);
        setReg({ slug: '', label: '', description: '' });
        loadAll();
      } else setError(r && r.error ? r.error.message : '注册失败');
    });

  const adopt = (slug: string) =>
    run(async () => {
      const r = await rpc('dsh-memory/room-register', { slug, source: 'grown' });
      if (r && r.ok) {
        setMsg(`已收编:${slug}(source=grown)`);
        loadAll();
      } else setError(r && r.error ? r.error.message : '收编失败');
    });

  const previewRename = () =>
    run(async () => {
      if (!renaming) return;
      const to = renaming.to.trim();
      if (!to) { setError('目标 slug 不能为空'); return; }
      if (to === renaming.slug) { setError('目标与源相同'); return; }
      if (!registry.some((e) => e.slug === renaming.slug)) {
        const rr = await rpc('dsh-memory/room-register', { slug: renaming.slug, source: 'grown' });
        if (!rr || !rr.ok) { setError(rr && rr.error ? rr.error.message : '收编源失败'); return; }
        loadAll();
      }
      const r = await rpc('dsh-memory/room-admin', { action: 'rename', from: renaming.slug, to });
      if (r && r.ok) setMsg(String(r.value?.notice ?? ''));
      else setError(r && r.error ? r.error.message : '预览失败');
    });

  const execRename = () =>
    run(async () => {
      if (!renaming) return;
      if (!registry.some((e) => e.slug === renaming.slug)) {
        await rpc('dsh-memory/room-register', { slug: renaming.slug, source: 'grown' });
      }
      const r = await rpc('dsh-memory/room-admin', { action: 'rename', from: renaming.slug, to: renaming.to.trim(), dryRun: false });
      if (r && r.ok) {
        setMsg(String(r.value?.notice ?? '完成'));
        setRenaming(null);
        loadAll();
      } else setError(r && r.error ? r.error.message : '执行失败');
    });

  const saveEditing = () =>
    run(async () => {
      if (!editing) return;
      const r = await rpc('dsh-memory/room-admin', { action: 'update', slug: editing.slug, label: editing.label, description: editing.description });
      if (r && r.ok) {
        setMsg(String(r.value?.notice ?? '已更新'));
        setEditing(null);
        loadAll();
      } else setError(r && r.error ? r.error.message : '更新失败');
    });

  const retire = (slug: string, active: boolean, withRecords = false) =>
    run(async () => {
      if (!active) {
        const tip = withRecords
          ? `退役 Room:${slug} 并退场其下全部记忆?(记录为软删,可在记忆页「已退场」区逐条恢复)`
          : `退役 Room:${slug}?(存量记录的 tags 不动,仅词表不再推荐;可随时恢复)`;
        if (!window.confirm(tip)) return;
      }
      const r = await rpc('dsh-memory/room-admin', { action: 'retire', slug, active, withRecords: withRecords || undefined });
      if (r && r.ok) {
        setMsg(String(r.value?.notice ?? '完成'));
        loadAll();
        // 退场效果立现:该 room 正展开时刷新其活跃条目(退场后即"暂无记忆条目")
        if (expanded.has(slug)) {
          const rr = await rpc('dsh-memory/list-records', { tag: slug, limit: 10, retired: false });
          if (rr && rr.ok) {
            registerTypeCatalog(rr.value.typeCatalog);
            setRecords((m) => ({ ...m, [slug]: { items: rr.value.items, total: rr.value.total ?? null } }));
          }
        }
      } else setError(r && r.error ? r.error.message : '操作失败');
    });

  const exportRecords = (slug: string) =>
    run(async () => {
      const r = await rpc('dsh-memory/rooms-export', { kind: 'records', tag: slug });
      if (!r.ok) { setError(r.error.message); return; }
      if (r.value.csv) {
        const blob = new Blob([r.value.csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dsh-memory-room-${slug.replace(/\//g, '-')}-records.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    });

  const toggleExpand = (slug: string) =>
    run(async () => {
      if (expanded.has(slug)) {
        const next = new Set(expanded);
        next.delete(slug);
        setExpanded(next);
        return;
      }
      const r = await rpc('dsh-memory/list-records', { tag: slug, limit: 10, retired: false });
      if (r && r.ok) {
        registerTypeCatalog(r.value.typeCatalog);
        const next = new Set(expanded);
        next.add(slug);
        setExpanded(next);
        setRecords((m) => ({ ...m, [slug]: { items: r.value.items, total: r.value.total ?? null } }));
      } else setError(r && r.error ? r.error.message : '加载失败');
    });

  const countOf = (slug: string) => counts.find((c) => c.room === slug)?.count ?? 0;
  /** 全量 room 视图:注册条目(含 retired)∪ 自生长未注册(伪行,grown 标记);按退场筛选。 */
  const rows: Array<{ slug: string; count: number; entry?: RegEntry }> = ([
    ...registry.map((e) => ({ slug: e.slug, count: countOf(e.slug), entry: e })),
    ...counts.filter((c) => !registry.some((e) => e.slug === c.room)).map((c) => ({ slug: c.room, count: c.count })),
  ] as Array<{ slug: string; count: number; entry?: RegEntry }>).filter((row) => {
    if (retiredFilter === 'active') return row.entry?.status !== 'retired';
    if (retiredFilter === 'retired') return row.entry?.status === 'retired';
    return true;
  });
  const normFilter = filter.trim().toLowerCase();
  const visibleRows = normFilter
    ? rows.filter((row) =>
        row.slug.toLowerCase().includes(normFilter) ||
        (row.entry?.label ?? '').toLowerCase().includes(normFilter) ||
        (row.entry?.aliases ?? []).some((a) => a.toLowerCase().includes(normFilter)),
      )
    : rows;

  return (
    <div>
      <div style={{ ...S.flexRow, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={S.muted}>Room 级管理:存在(注册/收编/退役)· 名称(显示名/说明/改名)· 条目(展开浏览) · 归类到 hall 请到「Hall」页</span>
        <div style={S.grow} />
        <button type="button" style={btn} title="导出无 Room 绑定的孤儿清单(含候选)" onClick={() => run(async () => {
          const r = await rpc('dsh-memory/rooms-export', { kind: 'orphans' });
          if (!r.ok) { setError(r.error.message); return; }
          if (r.value.csv) downloadCsv(r.value.csv, 'dsh-memory-room-orphans.csv');
        })}>导出孤儿 · {orphanCount}</button>
        <button
          type="button"
          style={{ ...btn, color: hiPriv ? 'var(--dsh-mem-danger)' : undefined, border: hiPriv ? '1px solid var(--dsh-mem-danger)' : btn.border }}
          disabled={hiPrivBusy}
          title={hiPriv ? '关闭高权限模式' : '开启高权限模式以解锁 Room 管理操作'}
          onClick={toggleHiPriv}
        >{hiPriv ? '高权限:开' : '高权限:关'}</button>
        <button type="button" style={btn} onClick={loadAll}>刷新</button>
      </div>

      {/* 编辑栏(sticky) */}
      {editing ? (
        <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--dsh-mem-bg-inset)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap', padding: '6px 8px', border: '1px solid var(--dsh-mem-accent)', borderRadius: 8 }}>
          <span style={S.muted}>编辑 {editing.slug}</span>
          <input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} placeholder="显示名(可中文)" disabled={busy} style={{ ...S.input, width: 140, fontSize: 12 }} />
          <input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="归类说明(喂标注器)" disabled={busy} style={{ ...S.input, width: 200, fontSize: 12 }} />
          <button type="button" disabled={busy} onClick={saveEditing} style={{ ...btn, color: 'var(--dsh-mem-accent)', borderColor: 'var(--dsh-mem-accent)' }}>保存</button>
          <button type="button" disabled={busy} onClick={() => setEditing(null)} style={btn}>取消</button>
        </div>
      ) : null}

      {/* 改名栏(sticky,含预览确认) */}
      {renaming ? (
        <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--dsh-mem-bg-inset)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap', padding: '6px 8px', border: '1px solid var(--dsh-mem-accent)', borderRadius: 8 }}>
          <span style={S.muted}>改名 {renaming.slug} →</span>
          <input value={renaming.to} onChange={(e) => setRenaming({ ...renaming, to: e.target.value })} placeholder="新 slug(可两级:hall/子类)" disabled={busy} style={{ ...S.input, width: 200, fontSize: 12 }} />
          <button type="button" disabled={busy} onClick={previewRename} style={{ ...btn, color: 'var(--dsh-mem-accent)', borderColor: 'var(--dsh-mem-accent)' }}>预览</button>
          <button type="button" disabled={busy} onClick={execRename} style={{ ...btn, color: 'var(--dsh-mem-danger)', borderColor: 'var(--dsh-mem-danger)' }}>确认执行</button>
          <button type="button" disabled={busy} onClick={() => setRenaming(null)} style={btn}>取消</button>
          <span style={S.muted}>记录随迁;与反刍并发会互相覆盖,请在反刍空闲时执行。</span>
        </div>
      ) : null}

      {/* 退场筛选:全部 / 活跃(词表未退役) / 已退役 + 名称搜索 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={S.muted}>退场筛选</span>
        {([['', '全部'], ['active', '活跃'], ['retired', '已退役']] as const).map(([val, label]) => {
          const on = retiredFilter === val;
          return (
            <button
              key={val}
              type="button"
              title={val === '' ? '全部 room' : val === 'active' ? '只看词表未退役的 room' : '只看已退役的 room'}
              onClick={() => setRetiredFilter(val)}
              style={{
                cursor: 'pointer', fontSize: 12, padding: '2px 10px', borderRadius: 999,
                border: on ? '1px solid var(--dsh-mem-accent)' : '1px solid var(--dsh-mem-border)',
                background: on ? 'var(--dsh-mem-bg-inset)' : 'transparent',
                color: on ? 'var(--dsh-mem-accent)' : 'var(--dsh-mem-text-2)',
              }}
            >
              {label}
            </button>
          );
        })}
        <div style={S.grow} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="搜索 room(slug、显示名、别名)"
          style={{ ...S.input, width: 230, fontSize: 12 }}
        />
        {filter ? <button type="button" style={btn} onClick={() => setFilter('')}>清除</button> : null}
      </div>

      {/* 注册表单 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 10 }}>
        <input value={reg.slug} onChange={(e) => setReg({ ...reg, slug: e.target.value })} placeholder="slug(如 dsh-plugin 或 dsh-plugin/merge)" disabled={!hiPriv || busy} style={{ ...S.input, width: 210, fontSize: 12 }} />
        <input value={reg.label} onChange={(e) => setReg({ ...reg, label: e.target.value })} placeholder="名称(可中文)" disabled={!hiPriv || busy} style={{ ...S.input, width: 110, fontSize: 12 }} />
        <input value={reg.description} onChange={(e) => setReg({ ...reg, description: e.target.value })} placeholder="归类说明(喂标注器)" disabled={!hiPriv || busy} style={{ ...S.input, width: 170, fontSize: 12 }} />
        <button type="button" disabled={!hiPriv || busy || !reg.slug.trim()} onClick={register} style={{ ...btn, color: 'var(--dsh-mem-accent)', borderColor: 'var(--dsh-mem-accent)', opacity: !hiPriv || busy || !reg.slug.trim() ? 0.5 : 1 }}>注册</button>
        {!hiPriv && <span style={S.muted}>管理操作需先开启高权限模式</span>}
      </div>

      {msg ? <div style={S.hint}>{msg}</div> : null}
      {error ? <div style={S.error}>{error}</div> : null}

      {visibleRows.length === 0 ? (
        normFilter ? <p style={S.intro}>无匹配的 Room。</p> : <p style={S.intro}>暂无 Room:对话/反刍会从标签涌现,或在上方注册。</p>
      ) : (
        visibleRows.map((row) => {
          const e = row.entry;
          const retired = e?.status === 'retired';
          const grownOnly = !e;
          return (
            <div key={row.slug} style={{ marginBottom: 6, border: '1px solid var(--dsh-mem-border)', borderRadius: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px' }}>
                <button
                  type="button"
                  title={expanded.has(row.slug) ? '收起记忆条目' : '展开查看该 Room 的记忆条目(默认收起)'}
                  onClick={() => void toggleExpand(row.slug)}
                  style={{ ...btn, borderRadius: 999, padding: '1px 7px', flexShrink: 0 }}
                >{expanded.has(row.slug) ? '▾' : '▸'}</button>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: '2px 8px', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 12, opacity: retired ? 0.6 : 1 }}>
                    {row.slug}
                    {e?.source === 'pre-registered' ? ' ⭐' : ''}
                  </span>
                  {e?.label ? <span style={S.muted}>{e.label}</span> : null}
                  <span style={S.muted}>{row.count + ' 条'}</span>
                  {grownOnly ? <span style={S.muted}>(自生长未注册)</span> : null}
                  {retired ? <span style={{ ...S.muted, color: 'var(--dsh-mem-danger)' }}>已退役</span> : null}
                  {(e?.aliases ?? []).length > 0 ? <span style={{ ...S.muted, wordBreak: 'break-all' }}>{'别名: ' + (e?.aliases ?? []).join(', ')}</span> : null}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                  {!hiPriv || grownOnly ? null : (
                    <>
                      <button type="button" disabled={busy} title="编辑显示名/归类说明" onClick={() => { setEditing({ slug: row.slug, label: e?.label ?? '', description: e?.description ?? '' }); setRenaming(null); }} style={btn}>编辑</button>
                      <button type="button" disabled={busy} title="改名(可两级 slug;记录随迁,旧名进别名)" onClick={() => { setRenaming({ slug: row.slug, to: '' }); setEditing(null); }} style={btn}>改名</button>
                      <button
                        type="button"
                        disabled={busy}
                        title={retired ? '恢复该 Room 到词表' : '退役该 Room(存量 tags 不动)'}
                        onClick={() => retire(row.slug, retired)}
                        style={{ ...btn, ...(retired ? { color: 'var(--dsh-mem-accent)', borderColor: 'var(--dsh-mem-accent)' } : { color: 'var(--dsh-mem-danger)', borderColor: 'var(--dsh-mem-danger)' }) }}
                      >{retired ? '恢复' : '退役'}</button>
                      {!retired ? (
                        <button type="button" disabled={busy} title="退役并退场该 Room 下全部记忆(软删,可在「已退场」区恢复)" onClick={() => retire(row.slug, false, true)} style={{ ...btn, color: 'var(--dsh-mem-danger)', borderColor: 'var(--dsh-mem-danger)' }}>退场</button>
                      ) : null}
                    </>
                  )}
                  {grownOnly ? (
                    <>
                    <button type="button" disabled={!hiPriv || busy} title="收编进注册表(source=grown)" onClick={() => adopt(row.slug)} style={{ ...btn, color: 'var(--dsh-mem-accent)', borderColor: 'var(--dsh-mem-accent)', opacity: !hiPriv || busy ? 0.5 : 1 }}>收编</button>
                      <button type="button" disabled={!hiPriv || busy} title="退场该 Room 下全部记忆(软删,可在「已退场」区恢复)" onClick={() => { setRenaming(null); retire(row.slug, false, true); }} style={{ ...btn, color: 'var(--dsh-mem-danger)', borderColor: 'var(--dsh-mem-danger)', opacity: !hiPriv || busy ? 0.5 : 1 }}>退场</button>
                    </>
                  ) : null}
                  <button type="button" disabled={busy} title="导出该 Room 的记录清单 CSV" onClick={() => exportRecords(row.slug)} style={btn}>导出</button>
                </div>
              </div>
              {expanded.has(row.slug) ? (
                <div style={{ margin: '0 10px 6px', padding: '4px 8px', border: '1px dashed var(--dsh-mem-border)', borderRadius: 6 }}>
                  {(records[row.slug]?.items ?? []).map((it) => (
                    <div key={it.id} style={{ fontSize: 11, padding: '3px 0', borderBottom: '1px solid var(--dsh-mem-border)' }}>
                      <span className={tagClass(it.type)}>{typeLabel(it.type)}</span>{' '}
                      {it.retired ? <span style={{ ...S.muted, color: 'var(--dsh-mem-danger)' }}>[已退场]</span> : null}{' '}
                      <span style={S.muted}>{it.updatedAt ? fmtTime(it.updatedAt) : ''}</span>
                      <div style={{ marginTop: 2, wordBreak: 'break-all', color: 'var(--dsh-mem-text-2)', opacity: it.retired ? 0.55 : 1 }}>
                        {it.content.length > 140 ? it.content.slice(0, 140) + '…' : it.content}
                      </div>
                    </div>
                  ))}
                  {(records[row.slug]?.items.length ?? 0) === 0 ? <div style={S.muted}>该 Room 暂无记忆条目。</div> : null}
                  {(records[row.slug]?.total ?? 0) > (records[row.slug]?.items.length ?? 0) ? (
                    <div style={{ ...S.muted, fontSize: 11 }}>{'共 ' + records[row.slug]!.total + ' 条,仅显示前 ' + records[row.slug]!.items.length + ' 条'}</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}
