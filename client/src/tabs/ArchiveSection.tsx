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
import type { DshMemoryRequestMap, DshMemoryResponseMap } from '../../../src/contract.js';

/** 本节会发的六个端点（导出 / 对账 / 同步 / 孤儿归档 / 清理预览 / 真清理）。 */
type ArchiveEndpoint =
  | 'dsh-memory/mem-export'
  | 'dsh-memory/mem-reconcile'
  | 'dsh-memory/mem-sync'
  | 'dsh-memory/mem-orphans'
  | 'dsh-memory/cleanup-retired';
type ExportReport = DshMemoryResponseMap['dsh-memory/mem-export'];
type ReconcileReport = DshMemoryResponseMap['dsh-memory/mem-reconcile'];
type SyncReport = DshMemoryResponseMap['dsh-memory/mem-sync'];
type OrphanReport = DshMemoryResponseMap['dsh-memory/mem-orphans'];
type CleanupReport = DshMemoryResponseMap['dsh-memory/cleanup-retired'];

const HINT_STYLE = { fontSize: 12, color: 'var(--dsh-mem-text-3)', lineHeight: '18px' } as const;
const ROOT_STYLE = { fontSize: 11, color: 'var(--dsh-mem-text-3)', wordBreak: 'break-all' } as const;

/** 把一次 RPC 的返回拆成 `{report, error}`，envelope 的两种形状都在此收口。 */
async function call<K extends ArchiveEndpoint>(
  rpc: RpcFn,
  method: K,
  payload: DshMemoryRequestMap[K],
): Promise<{ report?: DshMemoryResponseMap[K]; error?: string }> {
  try {
    const r = await rpc(method, payload);
    if (r && r.ok && r.value !== undefined) return { report: r.value };
    const msg = r && !r.ok ? r.error?.message : undefined;
    return { error: typeof msg === 'string' && msg.length > 0 ? msg : '端点无响应' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function lineOf(rep: ExportReport): string {
  const head = `已写 ${rep.written} · 未变 ${rep.unchanged} · 跳过 ${rep.skipped}`;
  // 起名回填是这一步顺带做的写库动作（只写 name 列），得让人看得见它动了几条。
  const named = rep.named > 0 ? ` · 新起名 ${rep.named} 条` : '';
  const nameBad = rep.nameFailed > 0 ? ` · 起名失败 ${rep.nameFailed} 条(下轮重试)` : '';
  const tail = rep.remaining > 0 ? ` · 剩余 ${rep.remaining} 条，再点一次继续` : '';
  return head + named + nameBad + tail;
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

function lineOfSync(rep: SyncReport): string {
  const head = `回灌 ${rep.imported} · 重写文件 ${rep.rendered} · 退场 ${rep.retired} · 一致 ${rep.same}`;
  const tail = rep.pending > 0 ? ` · 两边都变 ${rep.pending} 条已挂账（两侧都没动）` : '';
  const extra = rep.newFiles > 0 ? ` · 新文件 ${rep.newFiles} 个未入库（导入须走写入内核）` : '';
  // 遍历防护拦下的条目必须说出来：它们落在投射根以外（链接/越界目录），不说就等于静默丢弃，
  // 而“报告说一致”与“实际根本没看那批目录”在人眼里长得一样。
  const links = rep.skippedLinks > 0 ? ` · 防护拦下 ${rep.skippedLinks} 个链接/越界条目（未读）` : '';
  // 陈旧根那份既没回灌也没被写，不说出去就会被当成“已经同步过了”：它实际在等孤儿归档。
  const stale = rep.staleRootFiles > 0 ? ` · 陈旧根 ${rep.staleRootFiles} 个文件未参与同步（交给孤儿归档）` : '';
  // 同记录多路径且两份都被改：机器不替人挑，但必须说出来——不说就会被当成“同步过了”。
  const multi = rep.multiPath > 0 ? ` · 同记录多路径 ${rep.multiPath} 份未动（先跑孤儿归档再同步）` : '';
  return head + tail + extra + links + stale + multi + (rep.remaining > 0 ? ` · 剩余 ${rep.remaining} 个文件，再点一次继续` : '');
}

function lineOfOrphans(rep: OrphanReport): string {
  const head = rep.dryRun
    ? `账本共 ${rep.scanned} 条 · 仍被认领 ${rep.claimed} · 无人认领 ${rep.orphans}（未搬任何东西）`
    : `已搬 ${rep.moved} · 失败 ${rep.failed} · 仍被认领 ${rep.claimed}`;
  const tail = rep.remaining > 0 ? ` · 剩余 ${rep.remaining} 条，再点一次继续` : '';
  return head + tail + (rep.dir.length > 0 ? ` · 归档到 ${rep.dir}` : '');
}

function lineOfCleanup(rep: CleanupReport): string {
  if (rep.aborted) return `清理已中止（未删任何记录）：${rep.diffs.join('；') || '门禁未通过'}`;
  if (rep.dryRun) return `待删 ${rep.targets} 条（预览了前 ${rep.items?.length ?? 0} 条）——未删除任何东西`;
  const f = rep.files ?? { moved: 0, failed: 0, absent: 0 };
  const head = `已删 ${rep.purged} 条 · 归档正文 ${rep.archiveMd === undefined || rep.archiveMd === '' ? '未写' : '已写'} · 文件搬家 ${f.moved}(失败 ${f.failed}) · 图索引 ${rep.graphForgotten ?? 0}`;
  return rep.otherChanged && rep.otherChanged > 0 ? `${head} · 本批之外 ${rep.otherChanged} 条处于漂移（不影响本批）` : head;
}

/** 「外部存档」一节。 */
export function ArchiveSection(props: { rpc: RpcFn }) {
  const rpc = props.rpc;
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState<ExportReport | undefined>(undefined);
  const [recon, setRecon] = useState<ReconcileReport | undefined>(undefined);
  const [synced, setSynced] = useState<SyncReport | undefined>(undefined);
  const [orphans, setOrphans] = useState<OrphanReport | undefined>(undefined);
  const [cleanup, setCleanup] = useState<CleanupReport | undefined>(undefined);
  // 物理删除不可逆，而本节已有“不弹框”纪律 ⇒ 用两步 arming 当确认门槛：
  // 必须先跑一次预览（否则连要删什么都不知道），再点两次才真删。
  // 归档文件也是不可逆感动作：同样用两步 arming，且必须先看过预览。
  const [orphanArmed, setOrphanArmed] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const run = <K extends ArchiveEndpoint>(
    method: K,
    sink: (rep: DshMemoryResponseMap[K]) => void,
    payload: DshMemoryRequestMap[K],
  ): void => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    void call<K>(rpc, method, payload).then((out) => {
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
          onClick={() => { run('dsh-memory/mem-export', setExported, {}); }}
        >
          导出为可携存档
        </NButton>
        <NButton
          disabled={busy}
          title="按账本基线比对库与磁盘，只出报告：什么都不写，因此不需要高权限"
          onClick={() => { run('dsh-memory/mem-reconcile', setRecon, {}); }}
        >
          与存档对账
        </NButton>
        <NButton
          disabled={busy}
          title="文件 → 库：只有文件变过的回灌入库，`.disable` 后缀的退场；两边都变的那些两侧都不动，只挂账。会写库，因此需要高权限模式"
          onClick={() => { run('dsh-memory/mem-sync', setSynced, {}); }}
        >
          从存档同步回库
        </NButton>
        <NButton
          disabled={busy}
          title="只读预览：扫账本，找出“我们写过但现在没记录认领它”的投射文件（改名/消歧留下的残片）。来路不明的文件一律不动，也不搬任何东西"
          onClick={() => {
            setOrphanArmed(false);
            run('dsh-memory/mem-orphans', setOrphans, { dryRun: true });
          }}
        >
          孤儿文件预览
        </NButton>
        <NButton
          disabled={busy || orphans === undefined || !orphans.dryRun || orphans.orphans === 0}
          title={orphanArmed
            ? '再点一次就真的搬——文件会被移出投射目录（不删，进归档目录，可手动搬回）'
            : '不删只搬：进 <数据目录>/memories-orphans/<批次时间戳>/；需要先跑预览，再点两次确认；服务端还要高权限模式'}
          onClick={() => {
            if (!orphanArmed) { setOrphanArmed(true); return; }
            setOrphanArmed(false);
            run('dsh-memory/mem-orphans', setOrphans, { dryRun: false });
          }}
        >
          {orphanArmed ? '确认搬走孤儿文件' : '孤儿文件归档'}
        </NButton>
        <NButton
          disabled={busy}
          title="只读预览：列出将被物理删除的退场记忆（前 50 条）与总数，不删任何东西"
          onClick={() => {
            setArmed(false);
            run('dsh-memory/cleanup-retired', setCleanup, { dryRun: true });
          }}
        >
          清理预览（干跑）
        </NButton>
        <NButton
          disabled={busy || cleanup === undefined || !cleanup.dryRun || cleanup.targets === 0}
          title={armed
            ? '再点一次就真的删——物理删除不可逆（但会先落快照与归档正文）'
            : '不可逆动作：需要先跑预览，再点两次确认；服务端那边还要高权限模式'}
          onClick={() => {
            if (!armed) { setArmed(true); return; }
            setArmed(false);
            run('dsh-memory/cleanup-retired', setCleanup, { dryRun: false });
          }}
        >
          {armed ? '确认物理删除' : '清理并归档'}
        </NButton>
      </div>
      <div style={{ ...HINT_STYLE, marginTop: 6 }}>
        {error !== undefined
          ? `失败：${error}`
          : cleanup !== undefined
            ? lineOfCleanup(cleanup)
            : orphans !== undefined
              ? lineOfOrphans(orphans)
              : synced !== undefined
                ? lineOfSync(synced)
                : exported !== undefined
                  ? lineOf(exported)
                  : recon !== undefined
                    ? lineOfReconcile(recon)
                    : '导出=库→文件；对账=只读比较；同步=文件→库；孤儿=搬走没人认领的残片；清理=物理删除（不可逆，需高权限模式）。'}
      </div>
      {recon !== undefined && error === undefined ? (
        <div style={HINT_STYLE}>最近差异样本：{recon.samples.map((s) => `${s.state}:${s.relPath}`).join('，') || '（无）'}</div>
      ) : null}
      {root !== undefined ? <div style={ROOT_STYLE}>投射根：{root}</div> : null}
    </div>
  );
}
