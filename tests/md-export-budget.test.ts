/**
 * md 投射单次动作护栏的运行时覆盖（`live.mdExportMaxRecords`）。
 *
 * 为什么单独钉：这个键存在的唯一理由就是"不重启就能调大"。它走 `effectiveCfg` 覆盖链，
 * 一旦有人把导出/收敛那两处改回读 `cfg.memExport`（启动快照），旋钮会变成"面板上能改、
 * 改了没反应"——那种缺陷在报告上完全看不出来，所以在这里把覆盖关系本身钉住。
 */
import { describe, expect, it } from 'vitest';
import { effectiveCfg } from '../src/pipeline/runner.js';
import type { MemoryLiveSettings } from '../src/contract.js';
import type { MemoryConfig } from '../src/config.js';
import type { LiveSettingsHandle } from '../src/settings.js';

function live(over: Partial<MemoryLiveSettings> = {}): LiveSettingsHandle {
  const s = {
    enabled: true, capture: true, distill: true, recall: true,
    reasoningEffort: '', distillProvider: '', distillModel: '', distillChain: [],
    distillBudgets: { extract: 0, dedup: 0, l2: 0, l3: 0, graph: 0 }, distillMaxInputChars: 0,
    distillLayerChains: { l1: [], l2: [], l3: [] }, distillMode: '', directBaseURL: '', directApiKey: '',
    embedRemoteBaseURL: '', embedRemoteApiKey: '', embedRemoteModel: '', embedRemoteDimensions: 0,
    memoryMutate: false, conflictFreeze: false, skillsEnabled: false, mdExportMaxRecords: 0,
    ...over,
  } as MemoryLiveSettings;
  return { supported: true, get: () => s, update: async (patch) => { Object.assign(s, patch); } };
}

const cfg = {
  llm: { provider: '', model: '' },
  memExport: { enabled: true, root: '/tmp/md-root', maxRecords: 2000, timeBudgetMs: 120_000 },
} as unknown as MemoryConfig;

describe('effectiveCfg / mdExportMaxRecords 覆盖链', () => {
  it('0 = 跟随部署值（不覆盖成 0，那会让一次点击一条都不写）', () => {
    const eff = effectiveCfg(cfg, live({ mdExportMaxRecords: 0 }));
    expect(eff.memExport.maxRecords).toBe(2000);
  });

  it('>0 覆盖条数，但 enabled / root 原样保留（只给条数这一个旋钮）', () => {
    const eff = effectiveCfg(cfg, live({ mdExportMaxRecords: 5000 }));
    expect(eff.memExport.maxRecords).toBe(5000);
    expect(eff.memExport.enabled).toBe(true);
    expect(eff.memExport.root).toBe('/tmp/md-root');
    expect(eff.memExport.timeBudgetMs).toBe(120_000);
  });

  it('没有 live 句柄时原样返回；mdExportMaxRecords=0 时不凭空造 memExport 子树', () => {
    expect(effectiveCfg(cfg, undefined).memExport.maxRecords).toBe(2000);
    // 一干覆盖全不命中的 cfg（没有 conflictFreeze 子树，也没有 memExport）：
    // 护栏为 0 时不得无中生有地造一个 memExport 子树，否则下游 `?.` 判“配过了”。
    const thin = { llm: {} } as unknown as MemoryConfig;
    const out = effectiveCfg(thin, live({ conflictFreeze: undefined as unknown as boolean }));
    expect(out).toBe(thin);
    expect((out as { memExport?: unknown }).memExport).toBeUndefined();
  });
});
