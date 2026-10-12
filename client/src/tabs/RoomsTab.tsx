/** Tab:Hall —— Room 大类/小类分类管理(beta.7,room-classification-management T15)。
 *
 *  术语:UI 层 大类=Hall、小类/条目=Room;代码仍叫 major/minor(与注册表一致)。
 *  Hall 与 Wing(metadata.hall,域)及认知 hall 无关 —— 只是 Room 词表的分组视图。
 *  - Hall 分组:slug 无 '/' 自成 hall(它既是 hall 又是其下唯一 room);'major/minor' 归其前缀。
 *  - 操作:两级注册 / 收编自生长(source=grown)/ 改名 / 合并(dryRun 预览→确认实跑)/
 *    退役·恢复 / 每 room 记录 CSV 导出。破坏性操作统一走 dsh-memory/room-admin,
 *    高权限(memoryMutate)门控,与 memory_room_admin 工具同一编排(备份+入队场景重算)。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { RpcFn } from '../rpc.js';
import type { UiRecord } from '../../../src/contract.js';
import { fmtTime, registerTypeCatalog, tagClass, typeLabel } from '../format.js';
import { S } from '../styles.js';

/** 大类归属(slug 首段;与 src/store/rooms-registry.ts majorOf 同义,客户端本地复刻
 *  ——该模块依赖 node:fs,不可进客户端 bundle)。 */
function majorOf(slug: string): string {
  const i = slug.indexOf('/');
  return i === -1 ? slug : slug.slice(0, i);
}

/** slug 小类段(standalone 即自身;'a/b' → 'b')。归类时拼 `hall/小类段` 用。 */
function suffixOf(slug: string): string {
  const i = slug.indexOf('/');
  return i === -1 ? slug : slug.slice(i + 1);
}

function downloadCsv(csv: string, name: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

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

export function RoomsTab(props: { rpc: RpcFn }) {
  const rpc = props.rpc;

  const [registry, setRegistry] = useState<RegEntry[]>([]);
  const [rooms, setRooms] = useState<Array<{ room: string; count: number; label?: string }>>([]);
  const [orphanCount, setOrphanCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 高权限门(与记忆页同一 memoryMutate 键;两页各自同步显示)
  const [hiPriv, setHiPriv] = useState(false);
  const [hiPrivBusy, setHiPrivBusy] = useState(false);
  // 注册表单(受控;「+小类」预填 hall 前缀)
  const [regSlug, setRegSlug] = useState('');
  const [regLabel, setRegLabel] = useState('');
  const [regDesc, setRegDesc] = useState('');
  // 行内合并/改名表单 + dryRun 预览态(预览 → 确认执行)
  const [form, setForm] = useState<{ action: 'merge' | 'rename'; from: string; to: string } | null>(null);
  const [preview, setPreview] = useState<{ action: 'merge' | 'rename'; from: string; to: string; notice: string } | null>(null);
  // 未注册自生长区收拢态
  const [grownOpen, setGrownOpen] = useState(false);
  // 拖拽归类:拖 room → 放到 hall 头(高亮);松手 = 预填 rename 表单并出 dryRun 预览
  const [dragOverHall, setDragOverHall] = useState<string | null>(null);
  // 点选归类(拖拽不可用的 webview 兜底):点「归类」进入挑选态,再点目标 hall 头完成
  const [picking, setPicking] = useState<string | null>(null);
  // 编辑显示名/归类说明(注册后可重编辑)
  const [editing, setEditing] = useState<{ slug: string; label: string; description: string } | null>(null);
  // room 内容展开(默认收起,免一次性渲染过多;首次展开拉前 10 条)
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(new Set());
  const [roomRecords, setRoomRecords] = useState<Record<string, { items: UiRecord[]; total: number | null }>>({});
  // Hall 分组折叠:默认全折叠(只显示 hall 头),展开状态本地记忆
  const [expandedHalls, setExpandedHalls] = useState<Set<string>>(() => {
    try {
      const v = window.localStorage.getItem('dsh.memory.halls.open');
      return v ? new Set(JSON.parse(v) as string[]) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  // 名称搜索过滤:hall/room 的 slug、显示名、别名,大小写不敏感
  const [filter, setFilter] = useState('');
  // 指针自制拖拽(HTML5 DnD 在部分 webview 不触发,ego-browser 同款纯 pointer 方案)
  const dragRef = useRef<{ from: string; x: number; y: number; active: boolean } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; text: string } | null>(null);

  const onDragLabelDown = (ev: ReactPointerEvent, slug: string) => {
    if (!hiPriv || busy || ev.button !== 0) return;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    dragRef.current = { from: slug, x: ev.clientX, y: ev.clientY, active: false };
  };
  const onDragLabelMove = (ev: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.active && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 6) d.active = true;
    if (!d.active) return;
    setGhost({ x: ev.clientX, y: ev.clientY, text: d.from });
    const hall = (document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-hall]') as HTMLElement | null)?.getAttribute('data-hall') ?? null;
    setDragOverHall(hall);
  };
  const onDragLabelUp = (ev: ReactPointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    setGhost(null);
    if (!d) return;
    if (!d.active) return;
    const hall = (document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-hall]') as HTMLElement | null)?.getAttribute('data-hall');
    setDragOverHall(null);
    if (hall) beginReclass(d.from, hall);
  };

  const loadAll = useCallback(() => {
    rpc('dsh-memory/rooms-get', {})
      .then((r) => {
        if (r && r.ok) {
          setRooms(r.value.rooms ?? []);
          setRegistry(r.value.registry ?? []);
          setOrphanCount(r.value.orphanCount ?? 0);
        }
      })
      .catch(() => undefined); /* 端点不可用:留空态,不阻塞面板 */
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
    if (next && !window.confirm('开启高权限模式:模型获得写入/删除记忆工具,并解锁 Hall 页的分类管理操作。确定开启?')) return;
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

  /** 统一操作壳:串行 + 提示复位。 */
  const run = (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    fn().finally(() => setBusy(false));
  };

  const register = () =>
    run(async () => {
      const r = await rpc('dsh-memory/room-register', {
        slug: regSlug.trim(),
        label: regLabel.trim() || undefined,
        description: regDesc.trim() || undefined,
      });
      if (r && r.ok) {
        setMsg(r.value?.notice ?? `已注册:${regSlug.trim()}`);
        setRegSlug('');
        setRegLabel('');
        setRegDesc('');
        loadAll();
      } else setError(r && r.error ? r.error.message : '注册失败');
    });

  /** 收编自生长 slug(source=grown;词表挂靠优先级与预注册同)。 */
  const adopt = (slug: string) =>
    run(async () => {
      const r = await rpc('dsh-memory/room-register', { slug, source: 'grown' });
      if (r && r.ok) {
        setMsg(`已收编:${slug}(source=grown)`);
        loadAll();
      } else setError(r && r.error ? r.error.message : '收编失败');
    });

  const previewMerge = (override?: { action: 'merge' | 'rename'; from: string; to: string }) =>
    run(async () => {
      const fm = override ?? form;
      if (!fm) return;
      const to = fm.to.trim();
      if (!to) { setError('目标 slug 不能为空'); return; }
      if (to === fm.from) { setError('目标与源相同'); return; }
      const r = await rpc('dsh-memory/room-admin', { action: fm.action, from: fm.from, to });
      if (r && r.ok) {
        setPreview({ action: fm.action, from: fm.from, to, notice: String(r.value?.notice ?? '') });
      } else setError(r && r.error ? r.error.message : '预览失败');
    });

  /** 归类到 hall 下(拖拽松手 / 「归类」按钮共用):预填 rename 表单(major/minor)
   *  并直接出 dryRun 预览——记录随迁、旧名进别名,确认后才实跑。 */
  const beginReclass = (from: string, hall: string) => {
    if (!busy) { setMsg(null); setError(null); }
    if (!hall) { setError('尚无 hall:先注册一个(如 dsh-plugin),再归类。'); return; }
    if (majorOf(from) === hall) {
      if (registry.some((e) => e.slug === from)) { setMsg(`${from} 已在 ${hall} 下。`); return; }
      setPicking(null);
      void adopt(from); // 未注册 slug 落回自己的 hall = 原地收编
      return;
    }
    const f = { action: 'rename' as const, from, to: `${hall}/${suffixOf(from)}` };
    setForm(f);
    setPreview(null);
    void previewMerge(f);
  };

  const execMerge = () =>
    run(async () => {
      if (!preview) return;
      // 自生长源归类:先原地收编 from(source=grown,markMerged/renameSlug 才有条目可挂),
      // 再走 rename——顺序钉死在 hall-room.integration.test 的组合用例
      if (preview.action === 'rename' && !registry.some((e) => e.slug === preview.from)) {
        const rr = await rpc('dsh-memory/room-register', { slug: preview.from, source: 'grown' });
        if (!rr || !rr.ok) { setError(rr && rr.error ? rr.error.message : '收编源失败'); return; }
      }
      const r = await rpc('dsh-memory/room-admin', { action: preview.action, from: preview.from, to: preview.to, dryRun: false });
      if (r && r.ok) {
        setMsg(String(r.value?.notice ?? '完成'));
        setPreview(null);
        setForm(null);
        loadAll();
      } else setError(r && r.error ? r.error.message : '执行失败');
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
        // 退场效果立现:该 room 正展开时刷新其活跃条目
        if (expandedRooms.has(slug)) {
          const rr = await rpc('dsh-memory/list-records', { tag: slug, limit: 10, retired: false });
          if (rr && rr.ok) {
            registerTypeCatalog(rr.value.typeCatalog);
            setRoomRecords((m) => ({ ...m, [slug]: { items: rr.value.items, total: rr.value.total ?? null } }));
          }
        }
      } else setError(r && r.error ? r.error.message : '操作失败');
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

  /** room 内容展开/收起(读操作,不吃高权限门;首次展开拉前 10 条)。 */
  const toggleRoomExpand = (slug: string) =>
    run(async () => {
      if (expandedRooms.has(slug)) {
        const next = new Set(expandedRooms);
        next.delete(slug);
        setExpandedRooms(next);
        return;
      }
      const r = await rpc('dsh-memory/list-records', { tag: slug, limit: 10, retired: false });
      if (r && r.ok) {
        registerTypeCatalog(r.value.typeCatalog);
        const next = new Set(expandedRooms);
        next.add(slug);
        setExpandedRooms(next);
        setRoomRecords((m) => ({ ...m, [slug]: { items: r.value.items, total: r.value.total ?? null } }));
      } else setError(r && r.error ? r.error.message : '加载失败');
    });

  const exportRecords = (slug: string) =>
    run(async () => {
      const r = await rpc('dsh-memory/rooms-export', { kind: 'records', tag: slug });
      if (!r.ok) { setError(r.error.message); return; }
      if (r.value.csv) downloadCsv(r.value.csv, `dsh-memory-room-${slug.replace(/\//g, '-')}-records.csv`);
      else setError('导出为空');
    });

  // ── 视图模型:hall 分组 + 未注册自生长区 ──
  const groups = useMemo(() => {
    const countOf = new Map(rooms.map((r) => [r.room, r.count]));
    const byHall = new Map<string, RegEntry[]>();
    for (const e of registry) {
      // hall 下的子 room 只显示 active(retired 的去 Room 页看——用户裁定)
      if (e.status !== 'active') continue;
      const hall = majorOf(e.slug);
      const list = byHall.get(hall);
      if (list) list.push(e);
      else byHall.set(hall, [e]);
    }
    return [...byHall.entries()]
      .map(([hall, entries]) => ({
        hall,
        label: registry.find((e) => e.slug === hall)?.label,
        entries: [...entries].sort((a, b) => a.slug.localeCompare(b.slug)),
        total: entries.reduce((s2, e) => s2 + (countOf.get(e.slug) ?? 0), 0),
      }))
      .sort((a, b) => a.hall.localeCompare(b.hall));
  }, [registry, rooms]);

  const grownOnly = useMemo(() => rooms.filter((r) => !registry.some((e) => e.slug === r.room)), [rooms, registry]);

  const persistHalls = (next: Set<string>) => {
    try { window.localStorage.setItem('dsh.memory.halls.open', JSON.stringify([...next])); } catch { /* 存储不可用 = 会话内仍生效 */ }
  };
  const toggleHall = (hall: string) =>
    setExpandedHalls((cur) => {
      const next = new Set(cur);
      if (next.has(hall)) next.delete(hall);
      else next.add(hall);
      persistHalls(next);
      return next;
    });
  const setAllHalls = (open: boolean) => {
    const next = open ? new Set(groups.map((g) => g.hall)) : new Set<string>();
    setExpandedHalls(next);
    persistHalls(next);
  };

  // 搜索过滤:hall 自身命中(slug/显示名)→ 显示全部子 room;否则只留命中的子 room
  // (slug/显示名/别名);整组无命中 → 隐藏。搜索时 hall 自动展开(折叠态会藏住匹配项)。
  const normFilter = filter.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    if (!normFilter) return groups;
    return groups
      .map((g) => {
        const hallHit = g.hall.toLowerCase().includes(normFilter) || (g.label ?? '').toLowerCase().includes(normFilter);
        const entries = hallHit
          ? g.entries
          : g.entries.filter((e) =>
              e.slug.toLowerCase().includes(normFilter) ||
              (e.label ?? '').toLowerCase().includes(normFilter) ||
              (e.aliases ?? []).some((a) => a.toLowerCase().includes(normFilter)),
            );
        return { ...g, entries };
      })
      .filter((g) => g.entries.length > 0);
  }, [groups, normFilter]);
  const visibleGrown = useMemo(
    () => (normFilter ? grownOnly.filter((r) => r.room.toLowerCase().includes(normFilter)) : grownOnly),
    [grownOnly, normFilter],
  );

  return (
    <div>
      <div style={{ ...S.flexRow, marginBottom: 8 }}>
        <span style={S.muted}>Hall = Room 大类 · 大类上限 200,小类「大类/小类」细分不占额度 · 与 Wing(域)筛选无关</span>
        <div style={S.grow} />
        <button
          type="button"
          title="导出分类数据 CSV(Room 词表+计数)"
          onClick={() =>
            run(async () => {
              const r = await rpc('dsh-memory/rooms-export', { kind: 'rooms' });
              if (!r.ok) { setError(r.error.message); return; }
              if (r.value.csv) downloadCsv(r.value.csv, 'dsh-memory-rooms.csv');
            })
          }
          style={btn}
        >导出词表</button>
        <button
          type="button"
          title="导出无 Room 绑定的孤儿清单(含候选)"
          onClick={() =>
            run(async () => {
              const r = await rpc('dsh-memory/rooms-export', { kind: 'orphans' });
              if (!r.ok) { setError(r.error.message); return; }
              if (r.value.csv) downloadCsv(r.value.csv, 'dsh-memory-room-orphans.csv');
            })
          }
          style={btn}
        >导出孤儿 · {orphanCount}</button>
        <button
          type="button"
          style={{
            ...btn,
            color: hiPriv ? 'var(--dsh-mem-danger)' : undefined,
            border: hiPriv ? '1px solid var(--dsh-mem-danger)' : btn.border,
          }}
          disabled={hiPrivBusy}
          title={hiPriv ? '关闭高权限模式(收回模型写删工具与管理操作)' : '开启高权限模式以解锁分类管理操作'}
          onClick={toggleHiPriv}
        >{hiPriv ? '高权限:开' : '高权限:关'}</button>
        <button type="button" style={btn} onClick={loadAll} title="重拉注册表与计数">刷新</button>
      </div>

      {/* 搜索过滤 + 折叠批量操作 */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="搜索 hall/room(slug、显示名、别名)"
          style={{ ...S.input, width: 250, fontSize: 12 }}
        />
        {filter ? <button type="button" style={btn} onClick={() => setFilter('')}>清除</button> : null}
        <span style={S.muted}>{`匹配 ${visibleGroups.reduce((s2, g) => s2 + g.entries.length, 0)} room / ${visibleGroups.length} hall`}</span>
        <div style={S.grow} />
        <button type="button" style={btn} title="展开全部 hall 的子 room" onClick={() => setAllHalls(true)}>展开全部</button>
        <button type="button" style={btn} title="收起全部 hall(只留 hall 头)" onClick={() => setAllHalls(false)}>收起全部</button>
      </div>

      {/* 注册表单(高权限):两级 slug 一次注册 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 10 }}>
        <input
          value={regSlug}
          onChange={(e) => setRegSlug(e.target.value)}
          placeholder="slug(如 dsh-plugin 或 dsh-plugin/merge)"
          disabled={!hiPriv || busy}
          style={{ ...S.input, width: 210, fontSize: 12 }}
        />
        <input
          value={regLabel}
          onChange={(e) => setRegLabel(e.target.value)}
          placeholder="名称(可中文)"
          disabled={!hiPriv || busy}
          style={{ ...S.input, width: 110, fontSize: 12 }}
        />
        <input
          value={regDesc}
          onChange={(e) => setRegDesc(e.target.value)}
          placeholder="归类说明(喂标注器)"
          disabled={!hiPriv || busy}
          style={{ ...S.input, width: 170, fontSize: 12 }}
        />
        <button
          type="button"
          disabled={!hiPriv || busy || !regSlug.trim()}
          onClick={register}
          style={{ ...btn, color: 'var(--dsh-mem-accent)', borderColor: 'var(--dsh-mem-accent)', opacity: !hiPriv || busy || !regSlug.trim() ? 0.5 : 1 }}
        >注册</button>
        {!hiPriv && <span style={S.muted}>管理操作需先开启高权限模式</span>}
      </div>

      {/* 全局操作栏:合并/归类/改名的表单与预览常驻页首(sticky 跟随滚动,不被埋) */}
      {editing ? (
        <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--dsh-mem-bg-inset)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap', padding: '6px 8px', border: '1px solid var(--dsh-mem-accent)', borderRadius: 8 }}>
          <span style={S.muted}>编辑 {editing.slug}</span>
          <input value={editing.label} onChange={(ev) => setEditing({ ...editing, label: ev.target.value })} placeholder="显示名(可中文)" disabled={busy} style={{ ...S.input, width: 140, fontSize: 12 }} />
          <input value={editing.description} onChange={(ev) => setEditing({ ...editing, description: ev.target.value })} placeholder="归类说明(喂标注器)" disabled={busy} style={{ ...S.input, width: 200, fontSize: 12 }} />
          <button type="button" disabled={busy} onClick={saveEditing} style={{ ...btn, color: 'var(--dsh-mem-accent)', borderColor: 'var(--dsh-mem-accent)' }}>保存</button>
          <button type="button" disabled={busy} onClick={() => setEditing(null)} style={btn}>取消</button>
        </div>
      ) : null}
      {form ? (
        <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--dsh-mem-bg-inset)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap', padding: '6px 8px', border: '1px solid var(--dsh-mem-accent)', borderRadius: 8 }}>
          <span style={S.muted}>{form.action === 'merge' ? '合并' : '归类/改名'} {form.from} →</span>
          <input
            value={form.to}
            onChange={(ev) => setForm({ ...form, to: ev.target.value })}
            placeholder="目标 slug"
            disabled={busy}
            style={{ ...S.input, width: 190, fontSize: 12 }}
          />
          {form.action === 'rename' ? (
            <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
              {groups.filter((gg) => gg.hall !== majorOf(form.from)).map((gg) => (
                <button
                  key={gg.hall}
                  type="button"
                  title={`归入 ${gg.hall} 下(${gg.hall}/${suffixOf(form.from)})`}
                  onClick={() => setForm({ ...form, to: `${gg.hall}/${suffixOf(form.from)}` })}
                  style={{ ...btn, borderRadius: 999, padding: '1px 8px' }}
                >{gg.hall}</button>
              ))}
            </span>
          ) : null}
          <button type="button" disabled={busy} onClick={() => previewMerge()} style={{ ...btn, color: 'var(--dsh-mem-accent)', borderColor: 'var(--dsh-mem-accent)' }}>预览</button>
          <button type="button" disabled={busy} onClick={() => { setForm(null); setPreview(null); setPicking(null); }} style={btn}>取消</button>
          {picking ? <span style={S.muted}>挑选中:点击目标 hall 头完成归类</span> : null}
          <span style={S.muted}>与反刍并发会互相覆盖,请在反刍空闲时执行。</span>
        </div>
      ) : null}
      {preview ? (
        <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--dsh-mem-bg-inset)', marginBottom: 8, padding: '6px 8px', border: '1px solid var(--dsh-mem-danger)', borderRadius: 8, fontSize: 12 }}>
          <div>{preview.notice}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button type="button" disabled={busy} onClick={execMerge} style={{ ...btn, color: 'var(--dsh-mem-danger)', borderColor: 'var(--dsh-mem-danger)' }}>确认执行{preview.action === 'merge' ? '合并' : '归类/改名'}</button>
            <button type="button" disabled={busy} onClick={() => setPreview(null)} style={btn}>再改改</button>
          </div>
        </div>
      ) : null}
      {msg ? <div style={S.hint}>{msg}</div> : null}
      {error ? <div style={S.error}>{error}</div> : null}
      {ghost ? (
        <div style={{ position: 'fixed', left: ghost.x + 12, top: ghost.y + 12, zIndex: 9999, pointerEvents: 'none', fontSize: 12, padding: '2px 10px', borderRadius: 999, border: '1px solid var(--dsh-mem-accent)', background: 'var(--dsh-mem-bg-inset)', color: 'var(--dsh-mem-accent)' }}>
          {ghost.text}
        </div>
      ) : null}

      {/* Hall 分组树(默认折叠,只显示 hall 头;搜索时自动展开匹配组) */}
      {visibleGroups.length === 0 ? (
        <p style={S.intro}>{normFilter ? '无匹配的 hall/room。' : '注册表为空。在上方注册 Hall/Room(如 dsh-plugin),或把自生长 slug「收编」进词表 —— 之后候选标注器会优先把相关记忆挂到这些 slug 上。'}</p>
      ) : (
        visibleGroups.map((g) => {
        const hallOpen = !!normFilter || expandedHalls.has(g.hall);
        return (
          <div key={g.hall} style={{ marginBottom: 10, border: '1px solid var(--dsh-mem-border)', borderRadius: 8, overflow: 'hidden' }}>
            <div
              data-hall={g.hall}
              onDragOver={(ev) => {
                if (!hiPriv || busy) return;
                ev.preventDefault();
                ev.dataTransfer.dropEffect = 'move';
                setDragOverHall(g.hall);
              }}
              onDragLeave={() => setDragOverHall((cur) => (cur === g.hall ? null : cur))}
              onDrop={(ev) => {
                ev.preventDefault();
                setDragOverHall(null);
                if (!hiPriv || busy) return;
                const from = ev.dataTransfer.getData('text/dsh-room');
                if (from) beginReclass(from, g.hall);
              }}
              onClick={() => {
                if (picking) {
                  if (!busy) {
                    const from = picking;
                    setPicking(null);
                    beginReclass(from, g.hall);
                  }
                  return;
                }
                toggleHall(g.hall);
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                background: 'var(--dsh-mem-bg-inset)',
                outline: dragOverHall === g.hall || picking !== null
                  ? '2px dashed var(--dsh-mem-accent)'
                  : undefined,
                outlineOffset: dragOverHall === g.hall || picking !== null ? '-2px' : undefined,
                cursor: 'pointer',
              }}
              title={picking
                ? '点击此 hall:把「' + picking + '」归入 ' + g.hall + ' 下(major/minor,预览后确认)'
                : hiPriv ? '拖入 room 归类到该 hall 下(major/minor;记录随迁,旧名进别名,预览后确认)' : undefined}
            >
              <button
                type="button"
                title={hallOpen ? '收起子 room' : '展开子 room(默认折叠)'}
                onClick={(ev) => { ev.stopPropagation(); toggleHall(g.hall); }}
                style={{ ...btn, borderRadius: 999, padding: '1px 7px', flexShrink: 0 }}
              >{hallOpen ? '▾' : '▸'}</button>
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                {g.hall}
                {g.label ? <span style={S.muted}>{' (' + g.label + ')'}</span> : null}
              </span>
              <span style={S.muted}>{`合计 ${g.total} 条 · ${g.entries.length} 个 room`}</span>
              <div style={S.grow} />
              <button
                type="button"
                disabled={!hiPriv || busy}
                title={`预填注册表单为 ${g.hall}/…(注册该 hall 下的小类)`}
                onClick={(ev) => { ev.stopPropagation(); setRegSlug(g.hall + '/'); }}
                style={btn}
              >+小类</button>
            </div>
            {hallOpen ? g.entries.map((e) => {
              const standalone = e.slug === g.hall;
              const count = rooms.find((r) => r.room === e.slug)?.count ?? 0;
              const retired = e.status === 'retired';
              return (
                <div key={e.slug} style={{ padding: '4px 10px', borderTop: '1px solid var(--dsh-mem-border)', opacity: retired ? 0.55 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: '2px 8px', alignItems: 'baseline' }}>
                    <button
                      type="button"
                      title={expandedRooms.has(e.slug) ? '收起内容' : '展开查看该 Room 的记录内容(默认收起)'}
                      onClick={() => void toggleRoomExpand(e.slug)}
                      style={{ ...btn, borderRadius: 999, padding: '1px 7px', flexShrink: 0 }}
                    >{expandedRooms.has(e.slug) ? '▾' : '▸'}</button>
                    <span
                      style={{ fontSize: 12, cursor: hiPriv && !busy ? 'grab' : 'default', touchAction: 'none' }}
                      onPointerDown={(ev) => onDragLabelDown(ev, e.slug)}
                      onPointerMove={onDragLabelMove}
                      onPointerUp={onDragLabelUp}
                      title={hiPriv && !busy
                        ? '按住拖到某个 hall 头上归类(major/minor;记录随迁,旧名进别名)'
                        : e.description ? `${e.slug} — ${e.description}` : e.slug}
                    >
                      {standalone ? e.slug : '· ' + e.slug.slice(g.hall.length + 1)}
                      {e.source === 'pre-registered' ? ' ⭐' : ''}
                    </span>
                    {e.label ? <span style={S.muted}>{e.label}</span> : null}
                    <span style={S.muted}>{count + ' 条'}</span>
                    {retired ? <span style={{ ...S.muted, color: 'var(--dsh-mem-danger)' }}>已退役</span> : null}
                    {(e.aliases ?? []).length > 0 ? <span style={{ ...S.muted, wordBreak: 'break-all' }}>{'别名: ' + (e.aliases ?? []).join(', ')}</span> : null}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                    {!hiPriv ? null : (
                      <>
                        <button type="button" disabled={busy} title="编辑显示名/归类说明" onClick={() => { setEditing({ slug: e.slug, label: e.label ?? '', description: e.description ?? '' }); setForm(null); setPreview(null); setPicking(null); }} style={btn}>编辑</button>
                        <button
                          type="button"
                          disabled={busy}
                          title={picking === e.slug ? '再点一次取消挑选;然后点击目标 hall 头完成归类' : '归类到已有 hall 下:点击后选目标 hall(记录随迁,旧名进别名)'}
                          onClick={() => {
                            if (picking === e.slug) { setPicking(null); return; }
                            setForm({ action: 'rename', from: e.slug, to: '' });
                            setPreview(null);
                            setPicking(e.slug);
                            setMsg(null); setError(null);
                          }}
                          style={{ ...btn, ...(picking === e.slug ? { color: 'var(--dsh-mem-accent)', borderColor: 'var(--dsh-mem-accent)' } : {}) }}
                        >{picking === e.slug ? '选 hall…' : '归类'}</button>
                        <button type="button" disabled={busy} title={`改名(= merge 1:1 + 注册表改名)`} onClick={() => { setForm({ action: 'rename', from: e.slug, to: '' }); setPreview(null); }} style={btn}>改名</button>
                        <button type="button" disabled={busy} title="合并到另一个 Room(dryRun 预览→确认实跑)" onClick={() => { setForm({ action: 'merge', from: e.slug, to: '' }); setPreview(null); }} style={btn}>合并</button>
                        <button type="button" disabled={busy} title={retired ? '恢复该 Room 到词表' : '退役该 Room(存量 tags 不动)'} onClick={() => retire(e.slug, retired)} style={{ ...btn, ...(retired ? { color: 'var(--dsh-mem-accent)', borderColor: 'var(--dsh-mem-accent)' } : { color: 'var(--dsh-mem-danger)', borderColor: 'var(--dsh-mem-danger)' }) }}>{retired ? '恢复' : '退役'}</button>
                      {!retired ? (
                        <button type="button" disabled={busy} title="退役并退场该 Room 下全部记忆(软删,可在「已退场」区恢复)" onClick={() => retire(e.slug, false, true)} style={{ ...btn, color: 'var(--dsh-mem-danger)', borderColor: 'var(--dsh-mem-danger)' }}>退场</button>
                      ) : null}
                      </>
                    )}
                    <button type="button" disabled={busy} title="导出该 Room 的记录清单 CSV" onClick={() => exportRecords(e.slug)} style={btn}>导出</button>
                  </div>
                  </div>
                  {expandedRooms.has(e.slug) ? (
                    <div style={{ margin: '4px 0 2px', padding: '4px 8px', border: '1px dashed var(--dsh-mem-border)', borderRadius: 6 }}>
                      {(roomRecords[e.slug]?.items ?? []).map((it) => (
                        <div key={it.id} style={{ fontSize: 11, padding: '3px 0', borderBottom: '1px solid var(--dsh-mem-border)' }}>
                          <span className={tagClass(it.type)}>{typeLabel(it.type)}</span>{' '}
                          <span style={S.muted}>{it.updatedAt ? fmtTime(it.updatedAt) : ''}</span>
                          <div style={{ marginTop: 2, wordBreak: 'break-all', color: 'var(--dsh-mem-text-2)' }}>
                            {it.content.length > 120 ? it.content.slice(0, 120) + '…' : it.content}
                          </div>
                        </div>
                      ))}
                      {(roomRecords[e.slug]?.items.length ?? 0) === 0 ? <div style={S.muted}>该 Room 暂无记录。</div> : null}
                      {(roomRecords[e.slug]?.total ?? 0) > (roomRecords[e.slug]?.items.length ?? 0) ? (
                        <div style={{ ...S.muted, fontSize: 11 }}>{'共 ' + roomRecords[e.slug]!.total + ' 条,仅显示前 ' + roomRecords[e.slug]!.items.length + ' 条'}</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            }) : null}
          </div>
        );
        })
      )}

      {/* 未注册自生长区 */}
      {visibleGrown.length > 0 ? (
        <div style={{ marginTop: 4 }}>
          <button type="button" onClick={() => setGrownOpen(!grownOpen)} style={btn} title={grownOpen ? '收起未注册自生长 Room' : '展开未注册自生长 Room'}>
            {grownOpen ? '▾' : '▸'} 自生长未注册 · 共 {visibleGrown.length}
          </button>
          <span style={S.muted}>{'(只在 tags 里涌现,不在词表 —— 收编后标注器才会优先挂靠)'}</span>
          {grownOpen ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 6 }}>
              {visibleGrown.map((r) => (
                <span key={r.room} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span
                    style={{ ...btn, cursor: hiPriv && !busy ? 'grab' : 'default', borderRadius: 999, padding: '2px 8px', touchAction: 'none' }}
                    onPointerDown={(ev) => onDragLabelDown(ev, r.room)}
                    onPointerMove={onDragLabelMove}
                    onPointerUp={onDragLabelUp}
                    title={hiPriv && !busy ? '自生长 slug(未注册)——按住拖到某个 hall 头上 = 收编并归为其子类' : '自生长 slug(未注册)'}
                  >
                    {r.room + ' · ' + r.count}
                  </span>
                  <button type="button" disabled={!hiPriv || busy} title="收编进注册表(source=grown,原地)" onClick={() => adopt(r.room)} style={{ ...btn, color: 'var(--dsh-mem-accent)', borderColor: 'var(--dsh-mem-accent)', opacity: !hiPriv || busy ? 0.5 : 1 }}>收编</button>
                  <button
                    type="button"
                    disabled={!hiPriv || busy}
                    title="归类到已有 hall 下:点击后选目标 hall(收编+子类一步,记录随迁)"
                    onClick={() => {
                      if (picking === r.room) { setPicking(null); return; }
                      setForm({ action: 'rename', from: r.room, to: '' });
                      setPreview(null);
                      setPicking(r.room);
                      setMsg(null); setError(null);
                    }}
                    style={{ ...btn, opacity: !hiPriv || busy ? 0.5 : 1, ...(picking === r.room ? { color: 'var(--dsh-mem-accent)', borderColor: 'var(--dsh-mem-accent)' } : {}) }}
                  >{picking === r.room ? '选 hall…' : '归'}</button>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
