/**
 * 存量维护区：三个「对存量记忆跑一轮 LLM 批处理」的运维动作，聚合成概览页一张卡。
 *
 * 为什么从输入区弹窗（WingWheel）搬来：这三项与「重建记忆」「反刍整理」是同一类运维动作，
 * 堆在输入框浮层里会把弹窗撑得很高、也难找；概览页才是它们的归属（见 OverviewTab 同区）。
 *
 * 三个动作各自的门控与语义：
 * - wing 回填：无门控，扫未打标存量补 wing 标签；进度以 wing-overview 的 unlabeled 归零判断。
 * - 关键词回填：`keyword.enabled` 门控，喂 FTS 关键词轴；端点单飞，轮询到 running=false。
 * - 重蒸馏整形：`redistill.enabled` 门控，按 G2 骨架重排「平」正文，只有严格更优才写回。
 * 关态端点返回 enabled=false，这里如实提示去设置里开。
 * 后两者是后台逐条批扫（一个请求只装一条、跑完一条再发下一条），运行期把端点 progress
 * （真目标/已完成/条序/失败）渲染成进度行，否则只有一个「回填中…」——用户无法判断是在跑还是卡死。
 *
 * 离开区域再回来：轮询计时器随组件卸载被清，但后台任务还在跑。挂载时用端点 `probe: true`
 * 只读快照问一次，在跑就把轮询接回去——否则进度行卡在最后一帧，用户得再点一次才更新。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BackfillProgress, WingOverviewResponse } from '../../../src/contract.js';
import { ensureThemeStyle } from '../theme.js';
import { NButton } from '../ui/primitives.js';
import type { RpcFn } from '../rpc.js';

export function BackfillSection(props: { rpc: RpcFn }) {
  const rpc = props.rpc;
  const [overview, setOverview] = useState<WingOverviewResponse | null>(null);
  const [wingBusy, setWingBusy] = useState(false);
  const [kwBusy, setKwBusy] = useState(false);
  const [kwSummary, setKwSummary] = useState<string | null>(null);
  const [kwProgress, setKwProgress] = useState<BackfillProgress | null>(null);
  const [kwCounts, setKwCounts] = useState<{ updated?: number; failed?: number } | null>(null);
  const [rdBusy, setRdBusy] = useState(false);
  const [rdSummary, setRdSummary] = useState<string | null>(null);
  const [rdProgress, setRdProgress] = useState<BackfillProgress | null>(null);
  const [rdCounts, setRdCounts] = useState<{ updated?: number; skipped?: number; failed?: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const timersRef = useRef<number[]>([]);
  useEffect(
    () => () => {
      for (const t of timersRef.current) window.clearTimeout(t);
    },
    [],
  );

  // 未打标计数：挂载拉一次，wing 回填跑完再刷新。
  const refreshOverview = useCallback(() => {
    rpc('dsh-memory/wing-overview', {})
      .then((r) => {
        if (r && r.ok) setOverview(r.value);
      })
      .catch(() => {});
  }, [rpc]);
  useEffect(() => {
    refreshOverview();
  }, [refreshOverview]);

  ensureThemeStyle();

  /** 轮询上限（×3s）：批扫现在一轮可达十几分钟，上限比这短就会在半路停轮询并把
   *  “没跑完”当成“跑完了”报出去（旧值 20 次 = 60s，正好是新预算的 1/15）。 */
  const POLL_CAP = 400;

  /** 批扫运行期的进度行文案：扫描阶段与分批阶段分开报（两者对用户是完全不同的等待）。
   *  counts 必须同时上：真机踩到“全部超时失败”时进度行照涨“已处理 251 条”，
   *  跟成功跑完长得一模一样——只看条数的进度会把失败误读成推进。 */
  const fmtProgress = (
    p: BackfillProgress | null,
    verb: string,
    counts?: { updated?: number; skipped?: number; failed?: number },
  ): string => {
    if (!p) return `${verb}中…`;
    if (p.scanning || p.candidates === 0) return `${verb}中：正在扫描存量、筛出需${verb}的记录…`;
    const parts = [
      `${verb}中：真目标 ${p.candidates} 条`,
      `已完成 ${p.processed} 条`,
      p.batchTotal > 0 ? `第 ${Math.min(p.batchesDone + 1, p.batchTotal)}/${p.batchTotal} 条` : '',
      p.concurrency > 1 ? `并行 ${p.concurrency}` : '串行',
      (counts?.failed ?? 0) > 0 ? `失败 ${counts!.failed} 条` : '',
    ].filter(Boolean);
    const outcome = counts
      ? `（写回 ${counts.updated ?? 0}${counts.skipped !== undefined ? ` / 留原文 ${counts.skipped}` : ''}）`
      : '';
    return parts.join(' · ') + outcome;
  };

  /** 跑完后的摘要：有 deferred 就必须说“没跑完”，否则用户会把“预算用尽”当成“处完了”。 */
  const tail = (p: BackfillProgress | null): string =>
    (p && p.deferred > 0 ? `，本次未跑完、剩 ${p.deferred} 条待再点一次` : '');

  /** wing 回填：跑完以 unlabeled 归零为结束判据（轮询 wing-overview）。
   *  `mode='resume'` = 挂载时只读快照(probe)，在跑就把轮询接回去，空闲则什么都不做。 */
  const wingBackfill = (mode: 'start' | 'resume' = 'start') => {
    if (wingBusy) return;
    if (mode === 'start' && (!overview || overview.unlabeled === 0)) return;
    if (mode === 'start') setWingBusy(true);
    setErr(null);
    let polls = 0;
    const finish = () => setWingBusy(false);
    const tick = () => {
      polls++;
      rpc('dsh-memory/wing-overview', {})
        .then((r) => {
          const v = r && r.ok ? (r.value as WingOverviewResponse) : null;
          if (v) setOverview(v);
          if ((v && v.unlabeled === 0) || polls >= POLL_CAP) finish();
          else timersRef.current.push(window.setTimeout(tick, 3000));
        })
        .catch(() => finish());
    };
    rpc('dsh-memory/wing-backfill', mode === 'resume' ? { probe: true } : {})
      .then((r) => {
        if (!r || !r.ok) {
          if (mode === 'resume') return finish();
          setErr(r && r.error ? '回填失败：' + r.error.message : '回填失败');
          finish();
          return;
        }
        if (mode === 'resume') {
          if (!(r.value && r.value.running)) return; // 无在途任务：什么都不做（不动忙态、不弹错）
          setWingBusy(true);
        }
        timersRef.current.push(window.setTimeout(tick, 3000));
      })
      .catch((e: unknown) => {
        if (mode === 'resume') return finish();
        setErr('回填失败：' + String((e && (e as Error).message) || e));
        finish();
      });
  };

  /**
   * 关键词回填：对缺 `dsh_keywords` 的存量记忆批量补关键词。端点单飞，轮询到 running=false。
   * 字面量端点直传（rpc 按端点键推返回类型，收成 string 会破坏推断）。
   * `mode='resume'` = 挂载时只读快照(probe)，在跑就把轮询接回去，空闲则什么都不做。
   */
  const keywordBackfill = (mode: 'start' | 'resume' = 'start') => {
    if (kwBusy) return;
    if (mode === 'start') {
      setKwBusy(true);
      setKwSummary(null);
      setKwProgress(null);
      setKwCounts(null);
    }
    setErr(null);
    let polls = 0;
    // 本轮回显进度：不能读 state（showResult 是点击时建的闭包，读到的是旧值），所以局部追一份。
    let last: BackfillProgress | null = null;
    const finish = () => setKwBusy(false);
    const showResult = (v: { updated?: number; failed?: number }) => {
      const fail = v.failed ?? 0;
      setKwSummary(`关键词回填完成：成功 ${v.updated ?? 0} 条${fail > 0 ? `，失败 ${fail} 条` : ''}${tail(last)}`);
    };
    const failMsg = (m: string) => {
      setErr(m);
      finish();
    };
    const tick = () => {
      polls++;
      rpc('dsh-memory/keyword-backfill', {})
        .then((r) => {
          const v = r && r.ok ? r.value : null;
          if (!v) return failMsg('关键词回填失败');
          if (v.progress) { last = v.progress; setKwProgress(v.progress); setKwCounts({ updated: v.updated, failed: v.failed }); }
          if (v.running) {
            if (polls >= POLL_CAP) { showResult(v); return finish(); }
            timersRef.current.push(window.setTimeout(tick, 3000));
            return;
          }
          // 终态：门控中途被关（enabled=false）时数字无意义，不报“完成”只静默收尾。
          if (v.enabled) showResult(v);
          finish();
        })
        .catch(() => failMsg('关键词回填失败'));
    };
    rpc('dsh-memory/keyword-backfill', mode === 'resume' ? { probe: true } : {})
      .then((r) => {
        if (!r || !r.ok) {
          if (mode === 'resume') return;
          return failMsg(r && r.error ? '关键词回填失败：' + r.error.message : '关键词回填失败');
        }
        const v = r.value;
        if (!v) { if (mode === 'resume') return; return failMsg('关键词回填失败'); }
        if (mode === 'resume') {
          if (!v.running) return; // 无在途任务：什么都不做
          if (v.progress) { last = v.progress; setKwProgress(v.progress); setKwCounts({ updated: v.updated, failed: v.failed }); }
          setKwBusy(true);
          timersRef.current.push(window.setTimeout(tick, 3000));
          return;
        }
        if (!v.enabled) return failMsg('关键词回填未开启：请先在概览开关组打开关键词回填');
        if (v.progress) { last = v.progress; setKwProgress(v.progress); setKwCounts({ updated: v.updated, failed: v.failed }); }
        timersRef.current.push(window.setTimeout(tick, 3000));
      })
      .catch((e: unknown) => {
        if (mode === 'resume') return;
        failMsg('关键词回填失败：' + String((e && (e as Error).message) || e));
      });
  };

  /** 重蒸馏整形：同关键词回填的单飞轮询形状，多一个 skipped（留原文计数）。
   *  `mode='resume'` = 挂载时只读快照(probe)，在跑就把轮询接回去，空闲则什么都不做。 */
  const redistillBackfill = (mode: 'start' | 'resume' = 'start') => {
    if (rdBusy) return;
    if (mode === 'start') {
      setRdBusy(true);
      setRdSummary(null);
      setRdProgress(null);
      setRdCounts(null);
    }
    setErr(null);
    let polls = 0;
    // 同上：进度局部跟踪，否则摘要里的 deferred 永远是点击时的 null。
    let last: BackfillProgress | null = null;
    const finish = () => setRdBusy(false);
    const showResult = (v: { updated?: number; skipped?: number; failed?: number }) => {
      setRdSummary(`整形完成：写回 ${v.updated ?? 0} 条，留原文 ${v.skipped ?? 0} 条${(v.failed ?? 0) > 0 ? `，失败 ${v.failed} 条` : ''}${tail(last)}`);
    };
    const failMsg = (m: string) => {
      setErr(m);
      finish();
    };
    const tick = () => {
      polls++;
      rpc('dsh-memory/redistill-backfill', {})
        .then((r) => {
          const v = r && r.ok ? r.value : null;
          if (!v) return failMsg('重蒸馏整形失败');
          if (v.progress) { last = v.progress; setRdProgress(v.progress); setRdCounts({ updated: v.updated, skipped: v.skipped, failed: v.failed }); }
          if (v.running) {
            if (polls >= POLL_CAP) { showResult(v); return finish(); }
            timersRef.current.push(window.setTimeout(tick, 3000));
            return;
          }
          // 终态：门控中途被关（enabled=false）时数字无意义，不报“完成”只静默收尾。
          if (v.enabled) showResult(v);
          finish();
        })
        .catch(() => failMsg('重蒸馏整形失败'));
    };
    rpc('dsh-memory/redistill-backfill', mode === 'resume' ? { probe: true } : {})
      .then((r) => {
        if (!r || !r.ok) {
          if (mode === 'resume') return;
          return failMsg(r && r.error ? '重蒸馏整形失败：' + r.error.message : '重蒸馏整形失败');
        }
        const v = r.value;
        if (!v) { if (mode === 'resume') return; return failMsg('重蒸馏整形失败'); }
        if (mode === 'resume') {
          if (!v.running) return; // 无在途任务：什么都不做
          if (v.progress) { last = v.progress; setRdProgress(v.progress); setRdCounts({ updated: v.updated, skipped: v.skipped, failed: v.failed }); }
          setRdBusy(true);
          timersRef.current.push(window.setTimeout(tick, 3000));
          return;
        }
        if (!v.enabled) return failMsg('重蒸馏整形未开启：请先在概览开关组打开重蒸馏整形');
        if (v.progress) { last = v.progress; setRdProgress(v.progress); setRdCounts({ updated: v.updated, skipped: v.skipped, failed: v.failed }); }
        timersRef.current.push(window.setTimeout(tick, 3000));
      })
      .catch((e: unknown) => {
        if (mode === 'resume') return;
        failMsg('重蒸馏整形失败：' + String((e && (e as Error).message) || e));
      });
  };

  /**
   * 离开区域再回来时**恢复在途任务**。
   *
   * 为什么需要：轮询计时器随组件卸载被清（上面的 cleanup），但后台任务仍在跑；
   * 回到页面若不重新接上轮询，进度行就卡在最后一帧，用户得再点一次才更新。
   * 三个端点都支持 `probe: true` 只读快照——**绝不启动新一轮**（空闲时用它启动会白烧 token）。
   */
  useEffect(() => {
    keywordBackfill('resume');
    redistillBackfill('resume');
    wingBackfill('resume');
    // 仅挂载时探测一次；三个 resume 都是幂等的只读查询，StrictMode 双调用无副作用。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    padding: '8px 0',
  };
  const hintStyle: React.CSSProperties = { flex: 1, minWidth: 180, fontSize: 12, color: 'var(--dsh-mem-text-3)' };

  return (
    <div className="dsh-mem-rb-card" style={{ padding: '4px 14px', marginTop: 12 }}>
      <div style={{ fontWeight: 600, padding: '8px 0 2px' }}>存量回填与整形</div>

      <div style={rowStyle}>
        <div style={hintStyle}>
          {overview ? `对存量未打标记忆批量补打 wing 标签 · 未打标 ${overview.unlabeled} 条` : '未打标计数加载中…'}
        </div>
        <NButton
          disabled={!overview || overview.unlabeled === 0 || wingBusy}
          style={{ color: 'var(--dsh-mem-accent)' }}
          onClick={() => wingBackfill()}
        >
          {wingBusy ? '回填中…' : 'wing 回填'}
        </NButton>
      </div>

      <div style={rowStyle}>
        <div style={hintStyle}>{kwBusy ? fmtProgress(kwProgress, '回填', kwCounts ?? undefined) : kwSummary || '为缺 dsh_keywords 的存量记忆补检索关键词，喂 FTS 关键词轴（需先开关键词回填开关）'}</div>
        <NButton disabled={kwBusy} style={{ color: 'var(--dsh-mem-accent)' }} onClick={() => keywordBackfill()}>
          {kwBusy ? '回填中…' : '关键词回填'}
        </NButton>
      </div>

      <div style={rowStyle}>
        <div style={hintStyle}>{rdBusy ? fmtProgress(rdProgress, '整形', rdCounts ?? undefined) : rdSummary || '把“平”的存量记忆按类型重排成分节骨架，顺带产关键词/情景；只有严格更优才写回（需先开重蒸馏整形开关）'}</div>
        <NButton disabled={rdBusy} style={{ color: 'var(--dsh-mem-accent)' }} onClick={() => redistillBackfill()}>
          {rdBusy ? '整形中…' : '重蒸馏整形'}
        </NButton>
      </div>

      {err ? <div style={{ padding: '6px 0', fontSize: 12, color: 'var(--dsh-mem-danger)' }}>{err}</div> : null}
    </div>
  );
}
