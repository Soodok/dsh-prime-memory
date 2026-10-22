/**
 * 蒸馏预算编辑：分层输出 token 上限（extract/dedup/l2/l3/graph 五键）+ 单次输入字符上限。
 * 数据源：settings-get 的 budgets（current 运行时覆盖（0=跟随默认）/ defaults
 * 内置默认 / effective 实际生效）与 inputBudget（current 0=跟随配置 / fallback
 * 静态配置 / effective）。输出五键经 settings-set 的 distillBudgets 整组提交；
 * 输入走 distillMaxInputChars 单键提交。思考档 high/xhigh/max 的 ×4 放大只作用
 * 于输出预算（行提示注明）。
 *
 * scope（#34 B 分段）：'all'（缺省：五输出 + 输入）| 'input'（仅输入，全局面板）
 * | 'l1' | 'l2' | 'l3'（仅该层输出行；l1 = 抽取 + 去重两行）。提交始终整组五键，
 * 未编辑键带现值回写，避免互相清零。
 */
import { useState } from 'react';
import type { SettingsGetResponse, SettingsSetRequest } from '../../../src/contract.js';
import type { RpcFn } from '../rpc.js';
import { S } from '../styles.js';
import { NInput } from '../ui/primitives.js';

const LAYERS: Array<[string, string]> = [
  ['extract', '抽取'],
  ['dedup', '去重'],
  ['l2', 'L2 场景'],
  ['l3', 'L3 画像'],
  ['graph', '图谱投影'],
];

/** 层范围 → 该面板显示的输出键（l1 同管抽取 + 去重两个调用点）。 */
const SCOPE_KEYS: Record<'l1' | 'l2' | 'l3', string[]> = {
  l1: ['extract', 'dedup'],
  l2: ['l2'],
  l3: ['l3'],
};

export function BudgetInputs(props: {
  rpc: RpcFn;
  disabled?: boolean;
  data: SettingsGetResponse | null;
  setData(d: SettingsGetResponse): void;
  onError(msg: string | null): void;
  scope?: 'all' | 'input' | 'l1' | 'l2' | 'l3';
}) {
  const rpc = props.rpc;
  const disabled = !!props.disabled;
  const data = props.data;
  const setData = props.setData;
  const onError = props.onError;
  const scope = props.scope ?? 'all';
  const layers = scope === 'all' || scope === 'input' ? LAYERS : LAYERS.filter((l) => SCOPE_KEYS[scope].includes(l[0]));
  // 草稿（string|null）：击键只进本地态，blur / Enter 才提交（'input' 键 = 输入预算）
  const [draft, setDraft] = useState<Record<string, string> | null>(null);

  if (!data || !data.budgets) return null;
  const cur: Record<string, number> = data.budgets.current || ({} as Record<string, number>);
  const def: Record<string, number> = data.budgets.defaults || ({} as Record<string, number>);
  const eff: Record<string, number> = data.budgets.effective || ({} as Record<string, number>);
  const ib = data.inputBudget || { current: 0, fallback: 0, effective: 0 };
  const curIn = ib.current || 0;
  const effIn = ib.effective || ib.fallback || 0;
  // R10 蒸馏超时(ms)：tb.current 运行时覆盖 / tb.fallback 静态 llm.timeoutMs
  const tb = data.timeoutBudget || { current: 0, fallback: 0, effective: 0 };
  const curTo = tb.current || 0;
  const effTo = tb.effective || tb.fallback || 0;

  /** 输入框显示值：草稿优先，否则现值（0 显示为空 = 跟随默认/配置）。 */
  const shown = (key: string): string => {
    if (draft && draft[key] !== undefined) return draft[key]!;
    const c = key === 'input' ? curIn : key === 'timeout' ? curTo : cur[key] || 0;
    return c > 0 ? String(c) : '';
  };

  /** 通用提交：从草稿收集并校验 keys，然后构造 settings-set 载荷 + 乐观视图。 */
  const commitPart = (
    keys: string[],
    buildPayload: (v: Record<string, number>) => SettingsSetRequest,
    applyView: (prev: SettingsGetResponse, v: Record<string, number>) => SettingsGetResponse,
  ) => {
    if (!draft) return;
    const values: Record<string, number> = {};
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      const raw = (draft[key] !== undefined ? draft[key] : shown(key)).trim();
      const n = raw === '' ? 0 : Number(raw);
      const max = key === 'timeout' ? 600000 : key === 'input' ? 256000 : 1000000;
      const min = key === 'input' || key === 'timeout' ? (raw === '' ? 0 : 1000) : 0;
      if (!Number.isInteger(n) || n < min || n > max) {
        onError(
          key === 'input'
            ? '输入预算须为 0 或 1000~256000 的整数（留空或 0 = 跟随配置）'
            : key === 'timeout'
              ? '蒸馏超时须为 0 或 1000~600000 的整数（留空或 0 = 跟随配置）'
              : '输出预算须为 0~1000000 的整数（留空或 0 = 跟随默认）',
        );
        setDraft(null);
        return;
      }
      values[key] = n;
    }
    setDraft(null);
    const prev = data;
    setData(applyView(prev, values));
    rpc('dsh-memory/settings-set', buildPayload(values))
      .then((r) => {
        if (!r || !r.ok) {
          setData(prev);
          onError(r && r.error ? '预算写入失败：' + r.error.message : '预算写入失败');
        } else {
          onError(null);
        }
      })
      .catch((e: unknown) => {
        setData(prev);
        onError('预算写入失败：' + String((e && (e as Error).message) || e));
      });
  };

  /** 输出五键整组提交（distillBudgets）。 */
  const commitOutputs = () => {
    commitPart(
      ['extract', 'dedup', 'l2', 'l3'],
      (v) => ({ distillBudgets: v as unknown as SettingsSetRequest['distillBudgets'] }),
      (prev, v) => {
        // effective 视图按本面板显示的层重算（0 → 回落默认值）
        const effNext: Record<string, number> = {};
        for (let j = 0; j < layers.length; j++) {
          const k = layers[j]![0]!;
          effNext[k] = v[k]! > 0 ? v[k]! : (def[k] || 0);
        }
        return {
          ...prev,
          settings: { ...prev.settings, distillBudgets: v as unknown as SettingsGetResponse['settings']['distillBudgets'] },
          budgets: {
            ...prev.budgets,
            current: v as unknown as SettingsGetResponse['budgets']['current'],
            effective: effNext as unknown as SettingsGetResponse['budgets']['effective'],
          },
        };
      },
    );
  };

  /** 输入预算单键提交（distillMaxInputChars）。 */
  const commitInput = () => {
    commitPart(
      ['input'],
      (v) => ({ distillMaxInputChars: v.input }),
      (prev, v) => {
        return {
          ...prev,
          settings: { ...prev.settings, distillMaxInputChars: v.input! },
          inputBudget: {
            ...(prev.inputBudget || { current: 0, fallback: 0, effective: 0 }),
            current: v.input!,
            effective: v.input! > 0 ? v.input! : ib.fallback || 0,
          },
        };
      },
    );
  };

  /** R10 蒸馏超时单键提交（distillTimeoutMs）。 */
  const commitTimeout = () => {
    commitPart(
      ['timeout'],
      (v) => ({ distillTimeoutMs: v.timeout }),
      (prev, v) => ({
        ...prev,
        settings: { ...prev.settings, distillTimeoutMs: v.timeout! },
        timeoutBudget: {
          ...(prev.timeoutBudget || { current: 0, fallback: 0, effective: 0 }),
          current: v.timeout!,
          effective: v.timeout! > 0 ? v.timeout! : tb.fallback || 0,
        },
      }),
    );
  };

  /** keys 中是否有未提交差异（true 才触发 blur/Enter 提交）。 */
  const dirty = (keys: string[]) => {
    if (!draft) return false;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      const want = (draft[key] !== undefined ? draft[key] : '').trim();
      const was =
        key === 'input' ? (curIn > 0 ? String(curIn) : '')
        : key === 'timeout' ? (curTo > 0 ? String(curTo) : '')
        : (cur[key] || 0) > 0 ? String(cur[key]) : '';
      if (want !== was) return true;
    }
    return false;
  };

  const inputBox = (
    key: string,
    _label: string,
    title: string,
    width: number,
    placeholder: number | undefined,
    onCommit: () => void,
  ) => {
    return (
      <NInput
        key={key}
        type="number"
        min={0}
        max={1000000}
        style={{ width }}
        title={title}
        placeholder={String(placeholder || '')}
        value={shown(key)}
        disabled={disabled}
        onChange={(e: { target: { value: string } }) => {
          const v = e.target.value;
          const d = { ...(draft || {}) };
          d[key] = v;
          setDraft(d);
        }}
        onBlur={() => {
          if (dirty([key])) onCommit();
        }}
        onKeyDown={(e: { key: string }) => {
          if (e.key === 'Enter' && dirty([key])) onCommit();
        }}
      />
    );
  };

  const showOutputs = scope !== 'input';
  const showInput = scope === 'all' || scope === 'input';
  const effNote = layers.map((l) => eff[l[0]!] || '?').join(' / ');
  /** 行标签点明输出预算归属的调用点（L1 面板两行分指抽取/去重）。 */
  const rowLabel = (key: string): string =>
    key === 'extract' ? '抽取输出' : key === 'dedup' ? '去重输出' : key === 'l2' ? 'L2 输出' : 'L3 输出';
  const rowStyle = { display: 'flex', alignItems: 'center', gap: 8 } as const;
  return (
    <div>
      {showOutputs ? (
        <div style={{ marginTop: 12 }}>
          <div
            style={S.switchLabel}
            title={
              (scope === 'l1' ? 'L1 的抽取与去重是两次独立调用，输出限额各自设置（路由共用同一条链）。' : '') +
              '留空或 0 = 跟随默认（当前生效 ' + effNote + '）；思考档 high/xhigh/max 时实际限额自动 ×4'
            }
          >
            输出预算
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            {layers.map((l) => (
              <div key={l[0]} style={rowStyle}>
                <span style={{ width: 68, flexShrink: 0, fontSize: 12, color: 'var(--dsh-mem-text-2)' }}>{rowLabel(l[0]!)}</span>
                {inputBox(
                  l[0]!,
                  l[1]!,
                  l[1]! + ' 输出预算（token，留空 = 默认 ' + (def[l[0]!] || '?') + '）',
                  110,
                  def[l[0]!],
                  commitOutputs,
                )}
                <span style={{ fontSize: 11, color: 'var(--dsh-mem-text-3)' }}>token</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {showInput ? (
        <div style={{ marginTop: 12 }}>
          <div
            style={S.switchLabel}
            title={'单次蒸馏调用的输入字符上限（≈token）：L1 抽取按此分块、L2/L3 超限截断；留空或 0 = 跟随配置（当前生效 ' + (effIn || '?') + '，来自 llm.maxInputChars）'}
          >
            输入预算
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            <div style={rowStyle}>
              <span style={{ width: 68, flexShrink: 0, fontSize: 12, color: 'var(--dsh-mem-text-2)' }}>单次输入</span>
              {inputBox(
                'input',
                '输入',
                '单次蒸馏输入字符上限（≈token，中文 1 字≈1 token；留空 = 跟随配置 ' + (ib.fallback || '?') + '）',
                110,
                ib.fallback,
                commitInput,
              )}
              <span style={{ fontSize: 11, color: 'var(--dsh-mem-text-3)' }}>字符</span>
            </div>
          </div>
        </div>
      ) : null}
      {showInput ? (
        <div style={{ marginTop: 12 }}>
          <div
            style={S.switchLabel}
            title={'单次蒸馏调用超时(ms)：治"慢但未被网关掐"的路由需更大超时窗；留空或 0 = 跟随配置（当前生效 ' + (effTo || '?') + 'ms，来自 llm.timeoutMs）。注：供应商网关侧固定掐断（如某些路由 60s）抬此值无效，须换路由'}
          >
            蒸馏超时
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            <div style={rowStyle}>
              <span style={{ width: 68, flexShrink: 0, fontSize: 12, color: 'var(--dsh-mem-text-2)' }}>超时</span>
              {inputBox(
                'timeout',
                '超时',
                '单次蒸馏调用超时(ms)（留空 = 跟随配置 ' + (tb.fallback || '?') + '）',
                110,
                tb.fallback,
                commitTimeout,
              )}
              <span style={{ fontSize: 11, color: 'var(--dsh-mem-text-3)' }}>ms</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
