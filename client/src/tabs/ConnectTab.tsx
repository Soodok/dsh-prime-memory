/**
 * Tab：外部记忆来源（轨3 Connect）。
 *
 * 「路径指针不复制」——这里只登记来源路径、只读扫描预览，**不写库**：
 * 实际导入由 agent 调 `memory_import`（携 source_id 走 ext_key 幂等 + 脱敏）完成。
 * 整面受 config `memport.enabled` 门控（默认关）；关时列表为空、扫描返回未启用提示。
 * 写类操作（登记/退役）另需面板开启「高权限模式」（memoryMutate 门）。
 */
import { useCallback, useEffect, useState } from 'react';
import type { MemorySourceView, MemorySourcesListResponse, MemportScanResponse } from '../../../src/contract.js';
import type { RpcFn } from '../rpc.js';
import { S } from '../styles.js';
import { NButton } from '../ui/primitives.js';

function errMsg(r: { ok?: boolean; error?: { message?: string } } | undefined): string {
  return r && r.error && r.error.message ? r.error.message : 'RPC 错误';
}

function SourceCard(props: { rpc: RpcFn; src: MemorySourceView; onChanged: () => void; onErr: (m: string) => void }) {
  const { src, rpc, onChanged, onErr } = props;
  const retire = (active: boolean) => {
    rpc('dsh-memory/memory-sources-retire', { id: src.id, active })
      .then((r) => {
        if (r && r.ok) onChanged();
        else onErr(errMsg(r));
      })
      .catch((e: unknown) => onErr(String((e as Error)?.message || e)));
  };
  const retired = src.status === 'retired';
  return (
    <div className="dsh-mem-card" style={S.card}>
      <div style={S.cardHead}>
        <strong>{src.label || src.id}</strong>
        <span style={S.muted}>{'· ' + src.kind + (retired ? ' · 已退役' : src.disabled ? ' · 已停用' : '')}</span>
        <div style={S.grow} />
        <NButton onClick={() => retire(!retired)}>{retired ? '恢复' : '退役'}</NButton>
      </div>
      <div style={{ ...S.detail }}>{src.path}</div>
      <div style={{ ...S.muted, marginTop: 4 }}>
        {'上次扫描 ' + (src.lastScanAt || '—') + ' · 上次导入 ' + (src.lastImportAt || '—')}
      </div>
    </div>
  );
}

export function ConnectTab(props: { rpc: RpcFn }) {
  const rpc = props.rpc;
  const [data, setData] = useState<MemorySourcesListResponse | null>(null);
  const [scan, setScan] = useState<MemportScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ id: '', kind: 'file', path: '', label: '' });

  const load = useCallback(() => {
    rpc('dsh-memory/memory-sources-list', {})
      .then((r) => {
        if (r && r.ok) {
          setData(r.value);
          setError(null);
        } else setError(errMsg(r));
      })
      .catch((e: unknown) => setError(String((e as Error)?.message || e)));
  }, [rpc]);

  useEffect(() => {
    load();
  }, [load]);

  const add = () => {
    if (!form.id.trim() || !form.path.trim()) {
      setError('登记来源需要 id 与绝对路径 path');
      return;
    }
    rpc('dsh-memory/memory-sources-add', { id: form.id.trim(), kind: form.kind, path: form.path.trim(), label: form.label.trim() || undefined })
      .then((r) => {
        if (r && r.ok) {
          setError(null);
          setForm({ ...form, id: '', path: '', label: '' });
          load();
        } else setError(errMsg(r));
      })
      .catch((e: unknown) => setError(String((e as Error)?.message || e)));
  };

  const runScan = () => {
    setBusy(true);
    rpc('dsh-memory/memport-scan', {})
      .then((r) => {
        if (r && r.ok) {
          setScan(r.value);
          setError(null);
          load();
        } else setError(errMsg(r));
      })
      .catch((e: unknown) => setError(String((e as Error)?.message || e)))
      .finally(() => setBusy(false));
  };

  const input = (key: 'id' | 'kind' | 'path' | 'label', placeholder: string) => (
    <input
      className="dsh-mem-input"
      style={{ flex: key === 'path' ? 2 : 1, minWidth: 120 }}
      value={form[key]}
      placeholder={placeholder}
      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
    />
  );

  return (
    <div>
      <p style={S.intro}>
        登记外部 AI 工具的记忆来源（仅存路径指针，正文不复制入库）。扫描为只读预览；实际导入由「memport 导入」经 memory_import 完成。整面需在设置开启
        <code> memport.enabled</code>。
      </p>

      <div style={S.toolbar}>
        {input('id', '来源 id(小写-连字符)')}
        {input('kind', 'kind: claude/codex/workbuddy/file…')}
        {input('path', '绝对路径(目录或 .mem)')}
        {input('label', '显示名(可选)')}
        <NButton onClick={add}>登记来源</NButton>
      </div>
      {!data?.memoryMutate ? <div style={S.hint}>提示：登记/退役需先在面板开启「高权限模式」。</div> : null}

      <div style={{ ...S.flexRow, margin: '8px 0 12px' }}>
        <span style={S.muted}>{data ? (data.sources.length ? data.sources.length + ' 个来源' : '暂无来源') : '加载中…'}</span>
        <div style={S.grow} />
        <NButton onClick={runScan} disabled={busy}>
          {busy ? '扫描中…' : '扫描全部来源'}
        </NButton>
        <NButton onClick={load}>刷新</NButton>
      </div>
      {error ? <div style={S.error}>{error}</div> : null}

      {(data?.sources || []).map((src) => (
        <SourceCard key={src.id} rpc={rpc} src={src} onChanged={load} onErr={setError} />
      ))}

      {scan ? (
        <div style={{ marginTop: 12 }}>
          <div style={S.heading}>扫描预览{scan.notice ? `（${scan.notice}）` : ''}</div>
          {scan.sources.map((s) => (
            <div key={s.sourceId} className="dsh-mem-card" style={S.card}>
              <div style={S.cardHead}>
                <strong>{s.label || s.sourceId}</strong>
                <span style={S.muted}>
                  {'：新 ' + s.counts.new + ' · 近重复 ' + s.counts['near-dup'] + ' · 疑似冲突 ' + s.counts['conflict-candidate'] + ' · 重复 ' + s.counts.dup}
                </span>
                <div style={S.grow} />
                <span style={S.muted}>{s.files + ' 包 · ' + s.total + ' 条'}</span>
              </div>
              {s.errors.length ? <div style={{ ...S.error, whiteSpace: 'pre-wrap' }}>{s.errors.join('\n')}</div> : null}
              {s.sampleNew.length ? (
                <div style={{ ...S.detail }}>{s.sampleNew.map((n) => `[${n.type}] ${n.content}`).join('\n')}</div>
              ) : s.counts.new > 0 ? (
                <div style={S.muted}>有新记录（样本省略）。</div>
              ) : null}
            </div>
          ))}
          {scan.enabled && scan.sources.length === 0 ? <div style={S.muted}>无启用来源，或来源下未发现 .mem。</div> : null}
        </div>
      ) : null}
    </div>
  );
}
