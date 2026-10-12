/**
 * 外部存档节（N8）：把 md 投射的三个动作从"只能手调 RPC"变成面板上有手。
 *
 * 为什么在 RecordsTab 底部而不是新开一个 tab：新 tab 要碰家族节契约与 tab 标题，
 * 而这一节的体量只有三枚按钮 + 一行状态，塞进「记忆」页正好和已经住在这里的
 * 「导出孤儿」连续。
 *
 * 三条纪律：
 * - **不弹框、不抢焦点、不自动轮询**：只响应点击，结果就地写在按钮下方；
 * - **一次只跑一批**：后端是有界的（`maxRecords`/`timeBudgetMs`），`remaining > 0`
 *   时明说"再点一次继续"，绝不让一次点击挂死 UI；
 * - **不拿空数据骗人**：功能没开时后端返回的是"未开启（cfg.memExport.enabled）"
 *   这句话，我们把它原样显示出来——比悄悄藏起整节更好回答"我点了怎么没反应"。
 */
import { useState } from 'react';
import { NButton } from '../ui/primitives.js';
import { S } from '../styles.js';
import type { RpcFn } from '../rpc.js';
import type { DshMemoryResponseMap } from '../../../src/contract.js';

/** 本节会发的两个端点（第三个属于 P2，现在只占位）。 */
type ArchiveEndpoint = 'dsh-memory/mem-export' | 'dsh-memory/mem-reconcile';
type ExportReport = DshMemoryResponseMap['dsh-memory/mem-export'];
type ReconcileReport = DshMemoryResponseMap['dsh-memory/mem-reconcile'];

const HINT_STYLE = { fontSize: 12, color: 'var(--dsh-mem-text-3)', lineHeight: '18px' } as const;
const ROOT_STYLE = { fontSize: 11, color: 'var(--dsh-mem-text-3)', wordBreak: 'break-all' } as const;

/** 把一次 RPC 的返回拆成 `{report, error}`，envelope 的两种形状都在此收口。 */
async function call<K extends ArchiveEndpoint>(rpc: RpcFn, method: K): Promise<{ report?: DshMemoryResponseMap[K]; error?: string }> {
  try {
    const r = await rpc(method, {});
    if (r && r.ok && r.value !== undefined) return { report: r.value };
    const msg = r && !r.ok ? r.error?.message : undefined;
    return { error: typeof msg === 'string' && msg.length > 0 ? msg : '端点无响应' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function lineOf(rep: ExportReport): string {
  const head = `已写 ${rep.written} · 未变 ${rep.unchanged} · 跳过 ${rep.skipped}`;
  return rep.remaining > 0 ? `${head} · 剩余 ${rep.remaining} 条，再点一次继续` : head;
}

function lineOfReconcile(rep: ReconcileReport): string {
  const parts = [
    `首次 ${rep.firstTime}`,
    `一致 ${rep.same}`,
    `仅库变 ${rep.dbOnly}`,
    `仅文件变 ${rep.fileOnly}`,
    `两边都变 ${rep.both}`,
    `文件缺失 ${rep.missingFile}`,
  ];
  return parts.join(' · ') + (rep.capped ? `（本次只扫了 ${rep.scanned} 条，未扫全）` : '');
}

/** 「外部存档」一节。 */
export function ArchiveSection(props: { rpc: RpcFn }) {
  const rpc = props.rpc;
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState<ExportReport | undefined>(undefined);
  const [recon, setRecon] = useState<ReconcileReport | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const run = <K extends ArchiveEndpoint>(method: K, sink: (rep: DshMemoryResponseMap[K]) => void): void => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    void call<K>(rpc, method).then((out) => {
      if (out.report !== undefined) sink(out.report);
      if (out.error !== undefined) setError(out.error);
      setBusy(false);
    });
  };

  const root = exported?.root ?? recon?.root;
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--dsh-mem-border)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--dsh-mem-text-2)', marginBottom: 6 }}>
        外部存档（markdown 投射）
      </div>
      <div style={S.flexRow}>
        <NButton
          disabled={busy}
          title="把当前全部记忆渲染为 <根>/<类型>/<名称>.memory.md，并记下内容指纹（只写文件，不改库）"
          onClick={() => { run('dsh-memory/mem-export', setExported); }}
        >
          导出为可携存档
        </NButton>
        <NButton
          disabled={busy}
          title="按账本基线比对库与磁盘，只出报告：什么都不写，因此不需要高权限"
          onClick={() => { run('dsh-memory/mem-reconcile', setRecon); }}
        >
          与存档对账
        </NButton>
        <NButton
          disabled
          title="文件 → 库的反向同步属于 P2，尚未实装；届时需要高权限模式（memoryMutate）"
        >
          从存档同步回库
        </NButton>
      </div>
      <div style={{ ...HINT_STYLE, marginTop: 6 }}>
        {error !== undefined ? `失败：${error}` : null}
        {error === undefined && exported !== undefined ? lineOf(exported) : null}
        {error === undefined && exported === undefined && recon !== undefined ? lineOfReconcile(recon) : null}
        {error === undefined && exported === undefined && recon === undefined
          ? '导出=库→文件；对账=只读比较；同步（文件→库）待 P2。'
          : null}
      </div>
      {recon !== undefined && error === undefined ? (
        <div style={HINT_STYLE}>最近差异样本：{recon.samples.map((s) => `${s.state}:${s.relPath}`).join('，') || '（无）'}</div>
      ) : null}
      {root !== undefined ? <div style={ROOT_STYLE}>投射根：{root}</div> : null}
    </div>
  );
}
