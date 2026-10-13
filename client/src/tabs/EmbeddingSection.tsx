/**
 * 嵌入源区块（D4 三态单选 + D7 下载进度 + D5 重嵌进度；1.2s 轮询，不能让用户傻等）。
 * 远程连接为可编辑面（EmbeddingStateView.remote）：显示生效远程连接（baseURL /
 * model / dimensions / apiKeySet——运行时覆盖优先于部署），经 settings-set 的
 * embedRemote* 键写运行时覆盖；API Key 写后不回显，只显示「已设置」。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EmbeddingStateView, SettingsSetRequest } from '../../../src/contract.js';
import { commitDimensions } from '../dimensions.js';
import { fmtMB } from '../format.js';
import { asLoose, type RpcFn, type RpcLoose } from '../rpc.js';
import { S } from '../styles.js';
import { NButton, NInput } from '../ui/primitives.js';
import { Segmented } from '../ui/controls.js';

const RSTY = {
  block: { marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--dsh-mem-border)' } as const,
  title: { fontSize: 12, fontWeight: 600, color: 'var(--dsh-mem-text-3)', margin: '0 0 2px' } as const,
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 } as const,
  label: { fontSize: 11, color: 'var(--dsh-mem-text-3)', flexShrink: 0, width: 64 } as const,
  input: { flex: '1 1 200px', minWidth: 140 } as const,
  chip: {
    display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '1px 8px',
    fontSize: 11, fontWeight: 600, lineHeight: '18px', whiteSpace: 'nowrap',
  } as const,
  chipAccent: { background: 'var(--dsh-mem-accent-weak)', color: 'var(--dsh-mem-accent-text)' } as const,
  chipMuted: { background: 'var(--dsh-mem-bg-inset)', color: 'var(--dsh-mem-text-2)' } as const,
  note: { fontSize: 11, color: 'var(--dsh-mem-text-3)', margin: '6px 0 0' } as const,
};

export function EmbeddingSection(props: { rpc: RpcFn }) {
  const rpc = props.rpc;
  const loose = asLoose(rpc);
  const [st, setSt] = useState<EmbeddingStateView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // 轮询退避标记（load 维护）：snapshot 一次几十次 fs.stat，空闲也 1.2s 轮询太烧
  const busyPollRef = useRef<{ v: boolean } | null>(null);

  // ── 远程连接草稿（可回显端点/模型/维度；密钥不回读）──
  const [rBase, setRBase] = useState('');
  const [rModel, setRModel] = useState('');
  const [rDims, setRDims] = useState('');
  const [rKey, setRKey] = useState('');
  // 每字段「用户正在编辑」标记：轮询回传不覆盖未提交草稿
  const remoteDirty = useRef<{ base: boolean; model: boolean; dims: boolean }>({ base: false, model: false, dims: false });
  const baseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const modelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(() => {
    rpc('dsh-memory/embedding-state-get', {})
      .then((r) => {
        if (r && r.ok && r.value && r.value.supported !== false) {
          const v = r.value;
          if (busyPollRef.current) {
            busyPollRef.current.v = !!(
              (v.download && (v.download.phase === 'downloading' || v.download.phase === 'verifying')) ||
              v.apply.busy ||
              (v.reindex && v.reindex.running) ||
              (v.runtime && v.runtime.phase === 'installing')
            );
          }
          setSt(v);
          setErr(null);
        } else if (r && r.ok && r.value && r.value.supported === false) {
          setSt(null);
          setErr('__unsupported__');
        } else {
          setErr(r && !r.ok ? r.error.message : 'RPC error');
        }
      })
      .catch((e: unknown) => {
        setErr(String((e && (e as Error).message) || e));
      });
  }, [rpc]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    let stopped = false;
    const busyFlag = { v: false };
    busyPollRef.current = busyFlag;
    const tick = () => {
      if (stopped) return;
      load();
      timer = setTimeout(tick, busyFlag.v ? 1200 : 5000);
    };
    let timer = setTimeout(tick, 1200);
    return () => {
      stopped = true;
      clearTimeout(timer);
      busyPollRef.current = null;
    };
  }, [load]);

  useEffect(() => () => {
    clearTimeout(baseTimer.current);
    clearTimeout(modelTimer.current);
  }, []);

  // 生效远程连接 → 输入框（未在编辑中的字段才采纳轮询值；0 维度显示为空）
  useEffect(() => {
    if (!st || !st.remote) return;
    if (!remoteDirty.current.base) setRBase(st.remote.baseURL || '');
    if (!remoteDirty.current.model) setRModel(st.remote.model || '');
    if (!remoteDirty.current.dims) setRDims(st.remote.dimensions > 0 ? String(st.remote.dimensions) : '');
  }, [st]);

  /** 远程连接运行时覆盖写入（settings-set；apiKey 属机密只写不读）。 */
  const commitRemote = (patch: SettingsSetRequest) => {
    rpc('dsh-memory/settings-set', patch)
      .then((r) => {
        if (!r || !r.ok) setErr(r && r.error ? '远程连接保存失败：' + r.error.message : '远程连接保存失败');
        else {
          setErr(null);
          load();
        }
      })
      .catch((e: unknown) => setErr('远程连接保存失败：' + String((e && (e as Error).message) || e)));
  };

  const onRemoteBase = (v: string) => {
    remoteDirty.current.base = true;
    setRBase(v);
    clearTimeout(baseTimer.current);
    baseTimer.current = setTimeout(() => {
      remoteDirty.current.base = false;
      commitRemote({ embedRemoteBaseURL: v.trim() });
    }, 600);
  };
  const onRemoteModel = (v: string) => {
    remoteDirty.current.model = true;
    setRModel(v);
    clearTimeout(modelTimer.current);
    modelTimer.current = setTimeout(() => {
      remoteDirty.current.model = false;
      commitRemote({ embedRemoteModel: v.trim() });
    }, 600);
  };
  /** 维度：Enter/失焦一次性提交（正整数或清空=0 跟随部署）。 */
  const commitRemoteDims = () =>
    commitDimensions(rDims, {
      // 复位脏标记由 commitDimensions 无条件执行（含失败路径）——**不要**在这里
      // 再加判断，那正是修复前的缺陷：失败时标记留在 true，轮询回填被永久门控，
      // 输入框卡死在非法值上。
      clearDirty: () => {
        remoteDirty.current.dims = false;
      },
      submit: (n) => commitRemote({ embedRemoteDimensions: n }),
      reject: (message) => setErr(message),
    });
  /** 密钥：Enter/失焦一次性提交后清空输入框（明文不回显；空值不提交）。 */
  const commitRemoteKey = () => {
    const v = rKey.trim();
    if (v) commitRemote({ embedRemoteApiKey: v });
    setRKey('');
  };

  const call = (endpoint: Parameters<RpcLoose>[0], payload: unknown, confirmText?: string | null) => {
    if (confirmText && !window.confirm(confirmText)) return;
    loose(endpoint, payload)
      .then((r) => {
        if (!r || !r.ok) setErr(r && r.error ? r.error.message : '操作失败');
        else {
          setErr(null);
          load();
        }
      })
      .catch((e: unknown) => {
        setErr(String((e && (e as Error).message) || e));
      });
  };

  if (err === '__unsupported__') {
    return (
      <div className="dsh-mem-rb-card">
        <div style={{ fontWeight: 600, marginBottom: 4 }}>语义检索（嵌入）</div>
        <div className="dsh-mem-rb-muted">存储处于降级状态，嵌入管理不可用。</div>
      </div>
    );
  }
  if (!st) {
    return (
      <div className="dsh-mem-rb-card">
        <div className="dsh-mem-rb-muted">{err ? '嵌入状态读取失败：' + err : '嵌入状态读取中…'}</div>
        {err ? (
          <NButton style={{ marginTop: 8 }} onClick={load}>重试</NButton>
        ) : null}
      </div>
    );
  }

  const switchConfirm =
    '切换嵌入源后将按新模型重建向量索引（期间语义检索暂退化为关键词匹配，不影响对话）。确定切换？';
  const onSource = (key: string) => {
    if (key === 'local') {
      // 本地档需要具体模型：有已下载模型直接取最新的启用；否则提示先下载
      const ready: string[] = [];
      for (let i = 0; i < st.models.length; i++) if (st.models[i]!.state === 'downloaded') ready.push(st.models[i]!.id);
      if (ready.length === 0) {
        setErr('请先在下方下载一个本地嵌入模型，再切换到本地档。');
        return;
      }
      // 默认取目录序首个已下载模型（目录按轻→重排序，避免默认选中最大最慢的）
      const current = st.activeModel && ready.indexOf(st.activeModel) >= 0 ? st.activeModel : ready[0]!;
      call('dsh-memory/embedding-source-set', { source: 'local', activeModel: current }, switchConfirm);
      return;
    }
    call('dsh-memory/embedding-source-set', { source: key }, key === 'remote' ? switchConfirm : null);
  };

  const dl = st.download;
  const dlActive = dl && (dl.phase === 'downloading' || dl.phase === 'verifying');
  const ap = st.apply;
  const localInfo = st.local;
  const rt = st.runtime;
  const remote = st.remote;

  let runtimeRow: React.ReactNode = null;
  if (rt.phase === 'installing') {
    runtimeRow = (
      <div style={{ marginTop: 8, fontSize: 12 }}>
        <div style={S.flexRow}>
          <span>{'安装推理运行时中… 已耗时 ' + Math.round(rt.elapsedMs / 1000) + 's（约 100~200MB，视网络）'}</span>
          <div style={S.grow} />
          <NButton onClick={() => call('dsh-memory/embedding-runtime-cancel', {})}>取消</NButton>
        </div>
        <pre style={{ ...S.pre, maxHeight: 68, marginTop: 6, fontSize: 11, opacity: 0.85 }}>
          {(rt.lastLines || []).join('\n') || '等待 npm 输出…'}
        </pre>
      </div>
    );
  } else if (rt.phase === 'error') {
    runtimeRow = (
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--dsh-mem-danger)' }}>
        {'运行时安装失败：' + (rt.error || '未知') + '（重新切换嵌入源可重试）'}
      </div>
    );
  } else if (rt.phase === 'ready') {
    runtimeRow = (
      <div className="dsh-mem-rb-muted" style={{ marginTop: 8 }}>
        {'推理运行时就绪（transformers.js v' + rt.installedVersion + '）'}
      </div>
    );
  } else if (st.source === 'local') {
    runtimeRow = (
      <div className="dsh-mem-rb-muted" style={{ marginTop: 8 }}>
        首次启用本地嵌入时会自动安装推理运行时（约 100~200MB）。
      </div>
    );
  }

  let applyRow: React.ReactNode = null;
  if (ap.phase === 'warming') {
    applyRow = <div className="dsh-mem-rb-muted" style={{ marginTop: 8 }}>加载嵌入模型中…（首次需数秒）</div>;
  } else if (ap.phase === 'switching') {
    applyRow = <div className="dsh-mem-rb-muted" style={{ marginTop: 8 }}>切换嵌入源中…</div>;
  } else if (ap.phase === 'error') {
    applyRow = (
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--dsh-mem-danger)' }}>
        {'切换失败：' + ap.message + '（已保存的嵌入源不变，重启后仍按原源运行）'}
      </div>
    );
  } else if (st.reindex && st.reindex.running) {
    const rj = st.reindex;
    const rDone = rj.l1Done + rj.l0Done;
    const rTotal = rj.l1Total + rj.l0Total;
    const rPct = rTotal > 0 ? Math.round((rDone / rTotal) * 100) : 0;
    applyRow = (
      <div style={{ marginTop: 8 }}>
        <div style={S.flexRow}>
          <span className="dsh-mem-rb-muted">
            {'重嵌入中 L1 ' + rj.l1Done + '/' + rj.l1Total + ' · L0 ' + rj.l0Done + '/' + rj.l0Total + '（' + rPct + '%）'}
          </span>
          <div style={S.grow} />
          <NButton onClick={() => call('dsh-memory/embedding-reindex-cancel', {})}>取消</NButton>
        </div>
        <div style={{ ...S.flexRow, marginTop: 6 }}>
          <div className="dsh-mem-rb-bar">
            <div className="dsh-mem-rb-fill" style={{ width: rPct + '%' }} />
          </div>
        </div>
      </div>
    );
  }

  const modelCards = st.models.map((m) => {
    const isActive = st.source === 'local' && st.activeModel === m.id;
    const mDl = dlActive && dl!.modelId === m.id;
    const pct = mDl && dl!.overallTotal > 0 ? Math.round((dl!.overallReceived / dl!.overallTotal) * 100) : 0;
    let action: React.ReactNode;
    if (mDl) {
      action = (
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={S.flexRow}>
            <span className="dsh-mem-rb-muted" style={{ whiteSpace: 'nowrap' }}>
              {(dl!.phase === 'verifying' ? '校验中 ' : '') +
                fmtMB(dl!.overallReceived) +
                ' / ' +
                fmtMB(dl!.overallTotal) +
                '（文件 ' +
                dl!.fileIndex +
                '/' +
                dl!.fileCount +
                '，' +
                pct +
                '%' +
                (dl!.speedBps > 0 && dl!.phase === 'downloading' ? '，' + fmtMB(dl!.speedBps) + '/s' : '') +
                '）'}
            </span>
            <div style={S.grow} />
            <NButton onClick={() => call('dsh-memory/embedding-download-cancel', {})}>取消</NButton>
          </div>
          <div style={{ ...S.flexRow, marginTop: 6 }}>
            <div className="dsh-mem-rb-bar">
              <div className="dsh-mem-rb-fill" style={{ width: pct + '%' }} />
            </div>
          </div>
        </div>
      );
    } else if (isActive) {
      action = (
        <div style={S.flexRow}>
          <span className="dsh-mem-tag dsh-mem-tag-work-task">使用中</span>
          {localInfo && localInfo.state === 'loading' ? <span className="dsh-mem-rb-muted">模型加载中…</span> : null}
          {localInfo && localInfo.state === 'failed' ? (
            <span style={{ fontSize: 12, color: 'var(--dsh-mem-danger)' }}>{'加载失败：' + (localInfo.error || '')}</span>
          ) : null}
          {localInfo && localInfo.state === 'ready' ? <span className="dsh-mem-rb-muted">已就绪</span> : null}
        </div>
      );
    } else if (m.state === 'downloaded') {
      action = (
        <div style={S.flexRow}>
          <NButton
            disabled={ap.busy}
            onClick={() => call('dsh-memory/embedding-source-set', { source: 'local', activeModel: m.id }, switchConfirm)}
          >
            启用
          </NButton>
          <NButton
            disabled={dlActive}
            onClick={() =>
              call('dsh-memory/embedding-model-delete', { modelId: m.id }, '删除已下载的 ' + m.name + '（' + fmtMB(m.totalBytes) + '）？')
            }
          >
            删除
          </NButton>
        </div>
      );
    } else {
      action = (
        <NButton
          disabled={dlActive || !st.ceilings.local}
          title={!st.ceilings.local ? '部署已禁用本地嵌入模型' : ''}
          onClick={() => call('dsh-memory/embedding-download-start', { modelId: m.id })}
        >
          {(m.state === 'partial' ? '继续下载 ' : '下载 ') + fmtMB(m.totalBytes)}
        </NButton>
      );
    }
    return (
      <div
        key={m.id}
        style={{ ...S.flexRow, padding: '8px 0', borderBottom: '1px solid var(--dsh-mem-border)', flexWrap: 'wrap' }}
      >
        <div style={{ minWidth: 150 }}>
          <div style={{ fontWeight: 600 }}>{m.name}</div>
          <div className="dsh-mem-rb-muted">{m.tags.join(' · ') + ' · ' + m.dims + ' 维 · 上下文 ' + m.contextTokens}</div>
        </div>
        <div style={{ flex: 1, minWidth: 180, fontSize: 12, color: 'var(--dsh-mem-text-2)' }}>{m.description}</div>
        {action}
      </div>
    );
  });

  // ── 向量索引概况（手动重建的入口）──
  // embedded < 0 是宿主 db 层的"能力不可用"哨兵（sqlite-vec 缺失/库降级），
  // 不是"零条"。这两个说法在界面上必须分开，否则用户会去点一个永远没反应的按钮。
  const vec = st.vectors;
  const vecOk = !!vec && vec.l1.embedded >= 0 && vec.l0.embedded >= 0;
  // 上一次重建的留痕。进度条只在 running 期间存在，而“待补 0 条”的重建会瞬间跑完，
  // 没留痕就与“点了没反应”完全同形（真机反馈的根因）。前后待补数是这里的重点：
  // “效果无法确认”指的是没有可比数字，不是没动画。
  const lastRun = st.reindex ? st.reindex.last : undefined;
  const lastNote = !lastRun
    ? ''
    : ' · 上次重建：处理 ' + lastRun.processed + '/' + lastRun.planned + ' 条' +
      (lastRun.failed > 0 ? '、失败 ' + lastRun.failed : '') +
      (lastRun.cancelled ? '（被取消）' : '') +
      '，待补 ' + (lastRun.missingBefore.l1 + lastRun.missingBefore.l0) +
      ' → ' + (lastRun.missingAfter.l1 + lastRun.missingAfter.l0) +
      '，用时 ' + (lastRun.durationMs / 1000).toFixed(1) + 's';
  const vecNote = !vec
    ? '向量索引：宿主版本较旧，未上报计数'
    : !vecOk
      ? '向量索引不可用（sqlite-vec 扩展缺失或检索库降级），重建无从谈起'
      : '已嵌入 L1 ' + vec.l1.embedded + '/' + vec.l1.total +
        ' · L0 ' + vec.l0.embedded + '/' + vec.l0.total +
        (vec.l1.missing + vec.l0.missing > 0 ? '（待补 ' + (vec.l1.missing + vec.l0.missing) + ' 条）' : '') +
        (vec.l1.skipped + vec.l0.skipped > 0 ? '（' + (vec.l1.skipped + vec.l0.skipped) + ' 条内容不可嵌入，已跳过）' : '') +
        lastNote;
  const reindexRunning = !!(st.reindex && st.reindex.running);
  const canRebuild = vecOk && st.source !== 'off' && !reindexRunning && !st.apply.busy;
  const rebuildHint = !vecOk
    ? '向量能力不可用'
    : st.source === 'off'
      ? '嵌入源已关闭，请先启用'
      : reindexRunning
        ? '重建已在进行中'
        : st.apply.busy
          ? '嵌入源切换进行中'
          : '只补缺失向量；已有向量不动。零向量内容会被跳过（重试无意义）';

  return (
    <div className="dsh-mem-rb-card">
      <div style={S.flexRow}>
        <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>语义检索（嵌入源）</div>
        <div style={S.grow} />
        <Segmented
          value={st.source}
          options={[
            { key: 'off', label: '关闭' },
            { key: 'local', label: '本地', disabled: !st.ceilings.local, disabledTitle: '部署已禁用本地嵌入模型' },
            { key: 'remote', label: '远程', disabled: !st.ceilings.remote, disabledTitle: '部署未配置远程嵌入（baseUrl/apiKey/model/dimensions）' },
          ]}
          onChange={onSource}
        />
      </div>
      <div className="dsh-mem-rb-muted" style={{ marginTop: 4 }}>
        {st.source === 'off'
          ? '当前：关键词（BM25）检索，不做向量嵌入'
          : st.source === 'remote'
            ? '当前：远程嵌入（' + (remote.model || '未配置模型') + (remote.baseURL ? ' · ' + remote.baseURL : '') + '）'
            : '当前：本地嵌入' + (st.activeModel ? '（' + st.activeModel + '）' : '')}
      </div>
      {st.activeNote ? (
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--dsh-mem-danger)' }}>{st.activeNote}</div>
      ) : null}
      {err && err !== '__unsupported__' ? (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--dsh-mem-danger)' }}>{err}</div>
      ) : null}
      {dl && dl.phase === 'error' ? (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--dsh-mem-danger)' }}>{'下载失败：' + (dl.error || '')}</div>
      ) : null}
      {runtimeRow}
      {applyRow}
      {/* 远程连接（生效值 + 运行时覆盖编辑）：切换到远程档即按此连接请求 */}
      <div style={RSTY.block}>
        <div style={RSTY.title}>远程连接（生效值；运行时覆盖优先于部署 YAML）</div>
        <div style={RSTY.note}>
          {'生效端点 ' + (remote.baseURL || '（未配置）') + ' · 模型 ' + (remote.model || '（未配置）') + ' · ' + (remote.dimensions > 0 ? remote.dimensions + ' 维' : '维度跟随部署') + (remote.apiKeySet ? ' · 密钥已设置' : ' · 密钥未设置')}
        </div>
        <div style={RSTY.row}>
          <span style={RSTY.label}>端点 URL</span>
          <NInput
            style={RSTY.input}
            placeholder="如 https://api.xxx/v1/embeddings 的服务基址"
            value={rBase}
            onChange={(e: { target: { value: string } }) => onRemoteBase(e.target.value)}
            onKeyDown={(e: { key: string }) => {
              if (e.key === 'Enter') {
                clearTimeout(baseTimer.current);
                remoteDirty.current.base = false;
                commitRemote({ embedRemoteBaseURL: rBase.trim() });
              }
            }}
          />
        </div>
        <div style={RSTY.row}>
          <span style={RSTY.label}>模型名</span>
          <NInput
            style={RSTY.input}
            placeholder="如 text-embedding-3-small"
            value={rModel}
            onChange={(e: { target: { value: string } }) => onRemoteModel(e.target.value)}
            onKeyDown={(e: { key: string }) => {
              if (e.key === 'Enter') {
                clearTimeout(modelTimer.current);
                remoteDirty.current.model = false;
                commitRemote({ embedRemoteModel: rModel.trim() });
              }
            }}
          />
          <span style={RSTY.label}>维度</span>
          <NInput
            // 定宽 90 但在 flex 行里可收缩：minWidth:0 解除 flex item 的 min-content 下限，
            // 否则窄容器下 90px 固定的输入框会把整行顶出卡片
            style={{ width: 90, minWidth: 0, flex: '0 1 90px' }}
            type="number"
            min={0}
            placeholder="跟随部署"
            title="向量维度（留空/0 = 跟随部署配置）"
            value={rDims}
            onChange={(e: { target: { value: string } }) => {
              remoteDirty.current.dims = true;
              setRDims(e.target.value);
            }}
            onKeyDown={(e: { key: string }) => {
              if (e.key === 'Enter') commitRemoteDims();
            }}
            onBlur={commitRemoteDims}
          />
        </div>
        <div style={RSTY.row}>
          <span style={RSTY.label}>API Key</span>
          <NInput
            style={RSTY.input}
            type="password"
            autoComplete="new-password"
            placeholder={remote.apiKeySet ? '••••••••（已设置；输入新值提交可覆盖）' : '远程服务需要密钥时填写'}
            value={rKey}
            onChange={(e: { target: { value: string } }) => setRKey(e.target.value)}
            onKeyDown={(e: { key: string }) => {
              if (e.key === 'Enter') commitRemoteKey();
            }}
            onBlur={commitRemoteKey}
          />
          {remote.apiKeySet ? <span style={RSTY.chipAccent}>已设置</span> : <span style={RSTY.chipMuted}>未设置</span>}
          <NButton
            title="写入空串清除运行时密钥（部署 YAML 的密钥不受影响）"
            onClick={() => commitRemote({ embedRemoteApiKey: '' })}
          >
            清除
          </NButton>
        </div>
      </div>
      <div style={S.panelLabel}>本地模型目录（下载后离线可用，不随插件分发）</div>
      {modelCards}
      <div style={RSTY.block}>
        <div style={RSTY.title}>向量索引</div>
        <div style={RSTY.note}>{vecNote}</div>
        <div style={RSTY.row}>
          <NButton
            disabled={!canRebuild}
            title={rebuildHint}
            onClick={() => call('dsh-memory/embedding-reindex', {})}
          >
            重建索引
          </NButton>
        </div>
      </div>
    </div>
  );
}
