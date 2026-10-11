/**
 * Tab：§C 矛盾冻结的人工裁决面板。
 *
 * ## 为什么有这个 Tab
 *
 * 冻结的语义是「**不自动裁决**」：新记忆照常入 L1，与它冲突的旧记忆作为**一对**
 * 停放在 `conflict_pending`，双方内容都不被改写，直到人给出结论。
 *
 * 但在这之前只有「写」没有「读」——`dsh-memory/conflict-resolve` 端点一直在，
 * 却没有任何地方能列出待裁决对，于是 `pair_id` 无处可得：
 * 模型被 `memory_resolve_conflict` 的描述指到一个**不存在的** `memory_conflicts`
 * 工具，人也没有面板。队列成了只进不出的黑洞，安全阀超时自动了结会成为唯一出路
 * ——那正是 §C 想避免的事。
 *
 * 本 Tab 补上「读」那一半；`dsh-memory/conflicts` 端点与 `memory_conflicts` 工具
 * 共用 `conflict-service.ts` 的同一份形状，所以**人在面板上看到的**与
 * **模型能裁决的**是同一个队列、同一批 id。
 *
 * ## 四种结论
 *
 * - `winner`：判 LLM 建议的胜方为真，**败方从检索库退场**；
 * - `loser`：判败方为真，胜方退场；
 * - `both`：判两者其实是**各自独立的事实**（LLM 判错的情形），两条都保留；
 * - `defer`：看过但**暂不裁决**——不关闭冲突，该对仍在队列里，重置超时并累计复看次数。
 *
 * 前两者会删掉一条记忆，故走确认弹窗并把**将要退场的那条正文**摆出来 ——
 * 不让人对着 id 做不可逆决定。
 */
import { useCallback, useEffect, useState } from 'react';
import type { ConflictPairView, ConflictsResponse } from '../../../src/contract.js';
import { fmtTime } from '../format.js';
import type { RpcFn } from '../rpc.js';
import { S } from '../styles.js';
import { NButton } from '../ui/primitives.js';
import {
  groupConflictsByType,
  reviewLabel,
  isDeferred,
  axisText,
  claimLabel,
} from './conflicts-view.js';

/** 队列轮询间隔：冲突只在蒸馏时新增，10s 足够快，也不至于把面板拖住。 */
const POLL_MS = 10_000;

/** 取不到正文时的占位。**与"内容为空"是两回事**，必须分开说。 */
const GONE = '（该记录正文不可得：已不在主表，或被更早的清理清掉了）';

type Outcome = 'winner' | 'loser' | 'both' | 'defer';

export function ConflictsTab(props: { rpc: RpcFn }) {
  const rpc = props.rpc;
  const [view, setView] = useState<ConflictsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** 正在裁决的 pair_id（按钮禁用 + 文案切换用）。 */
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    rpc('dsh-memory/conflicts', {})
      .then((r) => {
        if (r && r.ok) {
          setView(r.value);
          setError(null);
        } else setError(r && r.error ? r.error.message : 'RPC error');
      })
      .catch((e: unknown) => {
        setError(String((e && (e as Error).message) || e));
      });
  }, [rpc]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [load]);

  const resolve = (pair: ConflictPairView, outcome: Outcome) => {
    // defer = "看过、暂不裁决"——不关闭冲突，该对仍在队列里，无需确认弹窗。
    if (outcome !== 'defer') {
      // 退场哪一条：winner → 败方；loser → 胜方；both → 都不退场。
      const doomed =
        outcome === 'winner'
          ? pair.loser_content || GONE
          : outcome === 'loser'
            ? pair.winner_content || GONE
            : null;
      if (doomed !== null) {
        const ok = window.confirm(
          `裁决这一对？\n\n将要退场的记忆：\n「${doomed}」\n\n` +
            '它会移出检索面（不再被召回），但记录仍保留 —— 可在「记忆」页的「已退场」区恢复。' +
            '裁决结论本身不可覆盖。',
        );
        if (!ok) return;
      }
    }
    setBusy(pair.pair_id);
    setNote(null);
    rpc('dsh-memory/conflict-resolve', { pairId: pair.pair_id, outcome })
      .then((r) => {
        if (r && r.ok) {
          const v = r.value;
          setNote(v.notice ?? `已裁决 ${v.pair_id}：${v.outcome}${v.removed_record_id ? '，退场 ' + v.removed_record_id : '，未移除记录'}`);
          load();
        } else {
          setError(r && r.error ? r.error.message : '裁决失败');
        }
      })
      .catch((e: unknown) => {
        setError(String((e && (e as Error).message) || e));
      })
      .finally(() => {
        setBusy(null);
      });
  };

  const items = view?.items ?? [];
  const sections = groupConflictsByType(items);

  return (
    <div>
      <div style={{ ...S.flexRow, marginBottom: 10 }}>
        <span style={S.muted}>
          {view === null ? '加载中…' : view.enabled ? `待裁决 ${view.total} 对` : '矛盾冻结未开启'}
        </span>
        <div style={S.grow} />
        <NButton onClick={load}>刷新</NButton>
      </div>

      {error ? <div style={S.error}>{error}</div> : null}
      {note ? <p style={S.hint}>{note}</p> : null}

      {/* 未开启与"开启了但队列为空"必须分开说：前者要去开开关，后者无事可做 */}
      {view !== null && !view.enabled ? (
        <p style={S.intro}>
          {view.notice ?? '矛盾冻结未开启。'}
          <br />
          矛盾冻结是**opt-in**：它把裁决权交还给人，代价是冲突会一直停着等你处理。
          确认要接手这些裁决，再去「概览」打开它 —— 打开后已停放的队列会立刻显示在这里。
        </p>
      ) : null}

      {view !== null && view.enabled && items.length === 0 ? (
        <p style={S.intro}>没有待裁决的冲突对。新记忆入库时若与旧记忆矛盾且冻结已开启，那一对会停到这里。</p>
      ) : null}

      {sections.map((sec) => (
        <div key={sec.type} style={{ marginBottom: 12 }}>
          <div style={S.cardHead}>
            <span style={{ ...S.muted, fontWeight: 600 }}>{sec.label}</span>
            <span style={S.muted}>{sec.items.length} 条</span>
          </div>
          <div style={{ ...S.muted, fontSize: 11, marginBottom: 6 }}>{sec.hint}</div>
          {sec.items.map((p) => (
            <ConflictCard key={p.pair_id} pair={p} busy={busy === p.pair_id} onResolve={resolve} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** 一对冲突：两侧正文并排 + 三轴 + 四种结论（含 defer）。 */
function ConflictCard(props: { pair: ConflictPairView; busy: boolean; onResolve: (p: ConflictPairView, o: Outcome) => void }) {
  const p = props.pair;
  const rl = reviewLabel(p);
  const cl = claimLabel(p);
  return (
    <div className="dsh-mem-card" style={S.card}>
      <div style={S.cardHead}>
        <span style={S.muted}>{'pair ' + p.pair_id.slice(0, 12)}</span>
        <span style={S.muted}>{fmtTime(p.created_at)}</span>
        {rl ? <span style={{ ...S.muted, color: isDeferred(p) ? 'var(--dsh-mem-accent-fill)' : undefined }}>{rl}</span> : null}
        {cl ? <span style={S.muted}>{cl}</span> : null}
        <div style={S.grow} />
        <span style={S.muted} title={'产生该冻结的蒸馏批次 id（可用 memory_receipts 追这一轮判了什么）'}>
          {'run ' + p.run_id.slice(0, 12)}
        </span>
      </div>

      <Side
        label="LLM 建议：胜方"
        accent
        id={p.winner_id}
        content={p.winner_content}
        pair={p}
        side="winner"
      />
      <Side label="LLM 建议：败方" id={p.loser_id} content={p.loser_content} pair={p} side="loser" />

      <div style={{ ...S.flexRow, marginTop: 8 }}>
        <NButton
          disabled={props.busy}
          title="判 LLM 建议的胜方为真；败方从检索库退场"
          onClick={() => {
            props.onResolve(p, 'winner');
          }}
        >
          {props.busy ? '裁决中…' : '判胜方为真'}
        </NButton>
        <NButton
          disabled={props.busy}
          title="判败方为真；胜方从检索库退场"
          onClick={() => {
            props.onResolve(p, 'loser');
          }}
        >
          判败方为真
        </NButton>
        <NButton
          disabled={props.busy}
          title="判两者其实是各自独立的事实（LLM 判错了）；两条都保留，不删除"
          onClick={() => {
            props.onResolve(p, 'both');
          }}
        >
          两者都保留
        </NButton>
        <NButton
          disabled={props.busy}
          title="看过但暂不裁决——该对仍在队列里，重置超时并累计复看次数"
          onClick={() => {
            props.onResolve(p, 'defer');
          }}
        >
          看过，暂不裁决
        </NButton>
      </div>
    </div>
  );
}

/** 冲突的一侧：id + 正文 + 三轴（正文缺失时明确说是"记录不在库"，不冒充空内容）。 */
function Side(props: { label: string; id: string; content: string; accent?: boolean; pair?: ConflictPairView; side?: 'winner' | 'loser' }) {
  const axis = props.pair && props.side ? axisText(props.pair, props.side) : '';
  const mt = props.pair && props.side ? (props.side === 'winner' ? props.pair.winner_maturity : props.pair.loser_maturity) : undefined;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ ...S.muted, fontWeight: props.accent ? 600 : undefined }}>{props.label}</div>
      <div style={S.content}>{props.content || GONE}</div>
      <div style={{ ...S.muted, fontFamily: 'ui-monospace, Consolas, monospace' }}>{props.id}</div>
      {axis ? <div style={{ ...S.muted, marginTop: 2, fontSize: 11 }}>{axis}</div> : null}
      {mt ? <div style={{ ...S.muted, marginTop: 2, fontSize: 11 }}>{'成熟度 · ' + (mt === 'high' ? '高' : mt === 'mid' ? '中' : '低')}</div> : null}
    </div>
  );
}
