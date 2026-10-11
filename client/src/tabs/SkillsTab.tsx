/**
 * Tab：技能库（轨2 SkillsTab，人工审阅面）。
 *
 * 技能是 L1 之上的派生投影（不是 memory type）；这里列出候选/活跃技能，供人工
 * 晋升、固定、改注入档、归档。整块受 cfg.skills.enabled 门控（默认关时后端返回
 * enabled=false、列表空，本 Tab 显示"未启用"提示）。写动作需面板开启「高权限模式」。
 * 手动晋升仍需证据会话数达阈（后端把关，不受自动闸 allowPromote 约束）。
 */
import { useCallback, useEffect, useState } from 'react';
import type { SkillView, SkillsListResponse } from '../../../src/contract.js';
import type { RpcFn } from '../rpc.js';
import { S } from '../styles.js';
import { NButton } from '../ui/primitives.js';

function errMsg(r: { ok?: boolean; error?: { message?: string } } | undefined): string {
  return r && r.error && r.error.message ? r.error.message : 'RPC 错误';
}

const TITLES: Record<SkillView['status'], string> = { candidate: '候选', active: '活跃', archived: '已归档' };

export function SkillsTab(props: { rpc: RpcFn }) {
  const rpc = props.rpc;
  const [data, setData] = useState<SkillsListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    rpc('dsh-memory/skills-list', {})
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

  const act = (id: string, action: 'promote' | 'archive' | 'pin' | 'unpin' | 'set-tier', tier?: SkillView['tier']) => {
    if (busy) return;
    setBusy(true);
    rpc('dsh-memory/skills-action', { id, action, tier })
      .then((r) => {
        if (r && r.ok) {
          setError(r.value.changed ? null : r.value.notice || null);
          load();
        } else setError(errMsg(r));
      })
      .catch((e: unknown) => setError(String((e as Error)?.message || e)))
      .finally(() => setBusy(false));
  };

  if (data && !data.enabled) {
    return <p style={S.intro}>技能结晶（程序性记忆）未启用。到「概览」页开启「技能」开关（或部署配置 skills.enabled），重复工作流会固化为技能候选，在此审阅晋升。</p>;
  }

  const mutateHint = data && !data.memoryMutate ? <div style={S.hint}>提示：晋升/归档/固定需在面板开启「高权限模式」。</div> : null;

  return (
    <div>
      <div style={{ ...S.flexRow, marginBottom: 10 }}>
        <span style={S.muted}>{data ? `${data.skills.length} 个技能 · 自动晋升${data.allowPromote ? '开' : '关(人工审阅)'} · 需证据会话达阈` : '加载中…'}</span>
        <div style={S.grow} />
        <NButton onClick={load}>刷新</NButton>
      </div>
      {mutateHint}
      {error ? <div style={S.error}>{error}</div> : null}
      {data && data.skills.length === 0 ? <p style={S.intro}>暂无技能。技能从重复出现的"工作方法"记忆结晶而来。</p> : null}
      {(data?.skills || []).map((s) => (
        <div key={s.id} className="dsh-mem-card" style={S.card}>
          <div style={S.cardHead}>
            <strong>{s.title}</strong>
            <span className="dsh-mem-tag" style={{ marginLeft: 6 }}>{TITLES[s.status]}</span>
            <span style={S.muted}>{` · 档:${s.tier}${s.pinned ? ' · 已固定' : ''} · 覆盖 ${s.sessionCount} 会话`}</span>
            <div style={S.grow} />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {s.status === 'candidate' ? (
              <NButton onClick={() => act(s.id, 'promote')} disabled={busy}>晋升</NButton>
            ) : null}
            <select
              className="dsh-mem-select"
              style={{ width: 'auto', padding: '5px 10px' }}
              value={s.tier}
              onChange={(e) => act(s.id, 'set-tier', e.target.value as SkillView['tier'])}
            >
              <option value="full">全文档</option>
              <option value="excerpt">摘录档</option>
              <option value="hint">提示档</option>
            </select>
            <NButton onClick={() => act(s.id, s.pinned ? 'unpin' : 'pin')} disabled={busy}>
              {s.pinned ? '取消固定' : '固定'}
            </NButton>
            {s.status !== 'archived' ? (
              <NButton onClick={() => act(s.id, 'archive')} disabled={busy}>归档</NButton>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
