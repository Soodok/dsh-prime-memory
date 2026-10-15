/** Tab：概览。记忆模式开关组 + 蒸馏参数 + 嵌入源 + 重建 + 计数瓦片/明细行。 */
import { useCallback, useEffect, useState } from 'react';
import type { MemoryStats, SettingsGetResponse, SettingsSetRequest } from '../../../src/contract.js';
import { fmtTime } from '../format.js';
import { modeLabel } from '../pill/modes.js';
import type { RpcFn } from '../rpc.js';
import { S } from '../styles.js';
import { SwitchRow } from '../ui/controls.js';
import { ArchiveSection } from './ArchiveSection.js';
import { DistillSettings } from './DistillSettings.js';
import { EmbeddingSection } from './EmbeddingSection.js';
import { RebuildPanel } from './RebuildPanel.js';
import { RuminatePanel } from './RuminatePanel.js';
import { BackfillSection } from './BackfillSection.js';

/** 可通过开关切换的 settings 键。 */
type ToggleKey = 'enabled' | 'capture' | 'distill' | 'recall' | 'memoryMutate' | 'conflictFreeze' | 'skillsEnabled' | 'keywordEnabled' | 'redistillEnabled' | 'mdSyncEnabled' | 'memportEnabled' | 'toolRoom' | 'toolGraph' | 'toolRuminate' | 'toolConflict' | 'toolMutate';

export function OverviewTab(props: { rpc: RpcFn }) {
  const rpc = props.rpc;
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [settingsData, setSettingsData] = useState<SettingsGetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 计数 5s 轮询；settings 跟随同一次 load 刷新（开关写入后有真实值收敛）
  const load = useCallback(() => {
    rpc('dsh-memory/stats', {})
      .then((r) => {
        if (r && r.ok) setStats(r.value);
        else setError(r && r.error ? r.error.message : 'RPC error');
      })
      .catch((e: unknown) => {
        setError(String((e && (e as Error).message) || e));
      });
    rpc('dsh-memory/settings-get', {})
      .then((r) => {
        if (r && r.ok) setSettingsData(r.value);
      })
      .catch(() => {});
  }, [rpc]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => {
      clearInterval(timer);
    };
  }, [load]);

  // 开关写入：乐观翻 UI，失败回滚到写前快照
  const toggle = (key: ToggleKey, value: boolean) => {
    if (!settingsData) return;
    const prev = settingsData;
    const patch = { [key]: value } as SettingsSetRequest;
    // 乐观视图按具体键注入：settings-set 是 patch 语义（层链键为 Partial），
    // 而本页 settings 视图要求全量 Record——不能整包 spread，否则形状不合且会
    // 把未拉到的键盖成空值
    const next = { ...prev, settings: { ...prev.settings, [key]: value } };
    setSettingsData(next);
    rpc('dsh-memory/settings-set', patch)
      .then((r) => {
        if (!r || !r.ok) {
          setSettingsData(prev);
          setError(r && r.error ? '开关写入失败：' + r.error.message : '开关写入失败');
        } else {
          setError(null);
        }
      })
      .catch((e: unknown) => {
        setSettingsData(prev);
        setError('开关写入失败：' + String((e && (e as Error).message) || e));
      });
  };

  // 数值型 live 键写入（回填并行度滑块）：与 toggle 同样的乐观 + 失败回滚语义
  const setNum = (key: 'backfillConcurrency', value: number) => {
    if (!settingsData) return;
    const prev = settingsData;
    const next = { ...prev, settings: { ...prev.settings, [key]: value } };
    setSettingsData(next);
    rpc('dsh-memory/settings-set', { [key]: value } as SettingsSetRequest)
      .then((r) => {
        if (!r || !r.ok) {
          setSettingsData(prev);
          setError(r && r.error ? '并行度写入失败：' + r.error.message : '并行度写入失败');
        } else {
          setError(null);
        }
      })
      .catch((e: unknown) => {
        setSettingsData(prev);
        setError('并行度写入失败：' + String((e && (e as Error).message) || e));
      });
  };

  // 概览统计拆两段呈现：瓦片（核心计数，一眼可读）+ 明细行（目录/版本/时间线/进度）
  const tiles: Array<{ num: string; label: string }> = [];
  const infos: Array<[string, string]> = [];
  if (stats) {
    const th = stats.thresholds || { l2MinNewMemories: 5, l3Interval: 20 };
    tiles.push({ num: String(stats.l0Today), label: 'L0 今日消息' });
    tiles.push({ num: String(stats.l1Count), label: 'L1 原子记忆' });
    tiles.push({ num: String(stats.sceneCount), label: 'L2 场景块' });
    tiles.push({ num: String(stats.pendingExtract), label: '待重试消息' });
    infos.push(['数据目录', stats.dataDir]);
    infos.push(['插件版本', 'v' + stats.version]);
    infos.push(['默认档', modeLabel(stats.family)]);
    infos.push(['L1 累计抽取', String(stats.l1TotalExtracted)]);
    infos.push(['L3 画像', stats.personaChars > 0 ? stats.personaChars + ' 字符' : '未生成']);
    infos.push(['上次 L1 抽取', fmtTime(stats.lastExtractAt)]);
    infos.push(['上次 L2 整合', fmtTime(stats.lastL2At)]);
    infos.push(['上次 L3 蒸馏', fmtTime(stats.lastL3At)]);
    infos.push(['待 L2 新记忆', stats.memoriesSinceL2 + ' / ' + (th.l2MinNewMemories != null ? th.l2MinNewMemories : 5)]);
    infos.push(['待 L3 新记忆', stats.memoriesSinceL3 + ' / ' + (th.l3Interval != null ? th.l3Interval : 20)]);
  }
  // message 非 running = 管线降级（数据为最后一次成功读取）
  const degraded = stats && stats.message && stats.message !== 'running';

  const master = settingsData && settingsData.settings ? settingsData.settings.enabled : true;
  // 部署上限提示：cordis.patch.yml 停用的分项，运行时开关打不开
  let ceilingNote = '';
  if (settingsData && settingsData.ceilings) {
    const off: string[] = [];
    if (!settingsData.ceilings.capture) off.push('捕获');
    if (!settingsData.ceilings.distill) off.push('蒸馏');
    if (!settingsData.ceilings.recall) off.push('召回');
    if (off.length > 0) ceilingNote = '注意：部署配置已停用 ' + off.join('、') + '（运行时开关无法开启）';
  }
  const mutate = settingsData && settingsData.settings ? !!settingsData.settings.memoryMutate : false;
  const cfEnabled = settingsData && settingsData.settings ? !!settingsData.settings.conflictFreeze : false;
  const toolRoom = settingsData && settingsData.settings ? settingsData.settings.toolRoom !== false : true;
  const toolGraph = settingsData && settingsData.settings ? settingsData.settings.toolGraph !== false : true;
  const toolRuminate = settingsData && settingsData.settings ? settingsData.settings.toolRuminate !== false : true;
  const toolConflict = settingsData && settingsData.settings ? settingsData.settings.toolConflict !== false : true;
  const toolMutate = settingsData && settingsData.settings ? settingsData.settings.toolMutate !== false : true;
  const skillsEnabled = settingsData && settingsData.settings ? settingsData.settings.skillsEnabled === true : false;
  // 存量回填/进阶功能启用开关（与下方 BackfillSection 的按钮同区）。
  const keywordEnabled = settingsData && settingsData.settings ? settingsData.settings.keywordEnabled === true : false;
  const redistillEnabled = settingsData && settingsData.settings ? settingsData.settings.redistillEnabled === true : false;
  const mdSyncEnabled = settingsData && settingsData.settings ? settingsData.settings.mdSyncEnabled === true : false;
  const memportEnabled = settingsData && settingsData.settings ? settingsData.settings.memportEnabled === true : false;
  // 回填并行度：0 = 跟随部署 cfg.backfill.concurrency（当前默认 2）
  const bfConcurrency = settingsData && settingsData.settings ? (settingsData.settings.backfillConcurrency ?? 0) : 0;

  return (
    <div>
      {settingsData && settingsData.supported === false ? (
        <p style={S.hint}>settings 服务不可用，记忆模式开关未启用（记忆保持全开）。</p>
      ) : settingsData ? (
        <div style={S.switchPanel}>
          {/* 分组一：记忆模式（总闸 + 三个分项；总闸关闭时分项置灰） */}
          <div style={S.panelLabel}>记忆模式</div>
          <SwitchRow
            label="记忆模式"
            desc={master ? '已开启：捕获对话并蒸馏记忆' : '已关闭：不捕获、不蒸馏、不注入（数据保留）'}
            checked={master}
            onChange={(v) => {
              toggle('enabled', v);
            }}
          />
          <SwitchRow
            label="捕获"
            desc="L0：记录原始对话（关闭后蒸馏也无输入）"
            checked={settingsData.settings.capture}
            disabled={!master}
            onChange={(v) => {
              toggle('capture', v);
            }}
          />
          <SwitchRow
            label="蒸馏"
            desc="L1 抽取 + L2 场景 + L3 画像"
            checked={settingsData.settings.distill}
            disabled={!master}
            onChange={(v) => {
              toggle('distill', v);
            }}
          />
          <SwitchRow
            label="召回"
            desc="对话时注入相关记忆与画像"
            checked={settingsData.settings.recall}
            disabled={!master}
            onChange={(v) => {
              toggle('recall', v);
            }}
          />
          {/* 分组二：高权限模式（写删门）——模型侧写删工具与面板删除记录共用的总闸 */}
          <div style={S.panelLabel}>高权限模式</div>
          <SwitchRow
            label="高权限模式"
            desc={
              mutate
                ? '已开启：模型获得记忆写入/删除工具，记忆 Tab 可删除指定记忆'
                : '默认关闭；开启后模型获得写删记忆工具，面板解锁记忆删除'
            }
            checked={mutate}
            onChange={(v) => {
              toggle('memoryMutate', v);
            }}
          />
          {/* 分组：技能结晶（轨2）——看板可拨总开关，控工具注册/注入/端点；工具注册变更需重启生效 */}
          <div style={S.panelLabel}>技能结晶</div>
          <SwitchRow
            label="技能（程序性记忆）"
            desc={skillsEnabled ? '已开启：重复工作方法会结晶为技能候选，注入活跃技能，可在「技能」页审阅晋升' : '默认关闭；开启后注册 memory_skill_* 工具与注入（新装工具需重启后完全生效）'}
            checked={skillsEnabled}
            onChange={(v) => {
              toggle('skillsEnabled', v);
            }}
          />
          {/* 分组：工具封印（v0.21.0）——false = 该组工具不注册,从模型工具列表消失;
              核心读(memory_search / read_scene / receipts / conversation_search)与槽位三件不受控 */}
          <div style={S.panelLabel}>工具封印</div>
          <SwitchRow
            label="Room 管理工具"
            desc={toolRoom ? '已注册：memory_room_admin / memory_room_review（目录治理）' : '已封印：两个工具从模型工具列表移除'}
            checked={toolRoom}
            onChange={(v) => { toggle('toolRoom', v); }}
          />
          <SwitchRow
            label="图谱工具"
            desc={toolGraph ? '已注册：memory_search_graph / memory_expand_graph_node' : '已封印：图谱读工具从模型工具列表移除'}
            checked={toolGraph}
            onChange={(v) => { toggle('toolGraph', v); }}
          />
          <SwitchRow
            label="反刍工具"
            desc={toolRuminate ? '已注册：memory_ruminate / _cancel / _status' : '已封印：反刍三件从模型工具列表移除'}
            checked={toolRuminate}
            onChange={(v) => { toggle('toolRuminate', v); }}
          />
          <SwitchRow
            label="冲突工具"
            desc={toolConflict ? '已注册：memory_conflicts / _rejected / resolve_conflict' : '已封印：冲突三件从模型工具列表移除'}
            checked={toolConflict}
            onChange={(v) => { toggle('toolConflict', v); }}
          />
          <SwitchRow
            label="写删工具"
            desc={toolMutate ? '已注册：memory_add / memory_import / memory_delete（仍需高权限模式）' : '已封印：L1 写删工具从模型工具列表移除（槽位三件不受此开关影响）'}
            checked={toolMutate}
            onChange={(v) => { toggle('toolMutate', v); }}
          />
          {/* 分组三：人工冲突裁决（§C 冻结开关）——开启后冲突对停放到待人工裁决区 */}
          <div style={S.panelLabel}>人工冲突裁决</div>
          <SwitchRow
            label="人工冲突裁决"
            desc={
              cfEnabled
                ? '已开启：去重判定"两边都像对的"时冻结冲突对，停放到待人工裁决区'
                : '默认关闭；开启后冲突按 LLM 的 winner/loser 自动了结变为冻结，需人工裁决'
            }
            checked={cfEnabled}
            onChange={(v) => {
              toggle('conflictFreeze', v);
            }}
          />
          {/* 分组：存量回填与整形的启用开关——与下方 BackfillSection / ArchiveSection 的按钮同区；
              这些面默认关，不开则按钮点了只报“未开启”。 */}
          <div style={S.panelLabel}>存量回填与整形</div>
          <SwitchRow
            label="关键词回填"
            desc={keywordEnabled ? '已开启：可对存量记忆批量补检索关键词（下方「存量回填与整形」区点按钮）' : '默认关闭；开启后才能跑关键词回填（喂 FTS 关键词轴）'}
            checked={keywordEnabled}
            onChange={(v) => { toggle('keywordEnabled', v); }}
          />
          <SwitchRow
            label="重蒸馏整形"
            desc={redistillEnabled ? '已开启：可把“平”的存量记忆按类型重排成分节骨架（仅动严格更优的）' : '默认关闭；开启后才能跑重蒸馏整形（改正文会重算向量+覆盖 .memory.md）'}
            checked={redistillEnabled}
            onChange={(v) => { toggle('redistillEnabled', v); }}
          />
          {/* 回填并行度滑块（排查用旋钮）：默认 1 = 串行逐条；拖高只是临时提速。
              诊断时需要的常常是“立刻降到 1 串行再看一遍”——为此改 YAML + 重启不现实。
              诚实提示：并发度在启动那一轮就读定了，拖滑块不影响**正在跑**的那次。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13 }}>回填并行度</span>
            <input
              type="range"
              min={0}
              max={8}
              step={1}
              value={Math.min(8, bfConcurrency)}
              onChange={(e) => { setNum('backfillConcurrency', Number(e.target.value)); }}
              style={{ width: 120 }}
            />
            <span style={{ fontSize: 12, color: 'var(--dsh-mem-text-3)' }}>
              {bfConcurrency === 0 ? '0·跟随配置（默认 1=串行）' : bfConcurrency === 1 ? '1·串行逐条' : `${bfConcurrency} 路并发`}
              · 对**下一次点击**生效（正在跑的那轮不会改道）
            </span>
          </div>
          <SwitchRow
            label="md 反向同步"
            desc={mdSyncEnabled ? '已开启：可将 .memory.md 文件侧修改回灌入库（需先开 md 投射 + 高权限）' : '默认关闭；风险高于导出（会写库），需先开 md 投射再开本项'}
            checked={mdSyncEnabled}
            onChange={(v) => { toggle('mdSyncEnabled', v); }}
          />
          <SwitchRow
            label="外部记忆来源 Connect"
            desc={memportEnabled ? '已开启：可登记/扫描外部记忆源并导入' : '默认关闭；开启后 memport 相关端点可用'}
            checked={memportEnabled}
            onChange={(v) => { toggle('memportEnabled', v); }}
          />
          {/* 分组三：蒸馏参数（B 形态分段：全局默认链 + 按层路由 l1/l2/l3 + 预算随层归组；
              旧「蒸馏思考」全局切换器与「蒸馏模型」单路由选择器已并入 RouteChainEditor） */}
          <div style={S.panelLabel}>蒸馏参数</div>
          <DistillSettings rpc={rpc} disabled={!master} data={settingsData} setData={setSettingsData} onError={setError} />
          {ceilingNote ? <p style={S.hint}>{ceilingNote}</p> : null}
        </div>
      ) : null}
      <EmbeddingSection rpc={rpc} />
      <RebuildPanel rpc={rpc} />
      <RuminatePanel rpc={rpc} />
      <BackfillSection rpc={rpc} />
      {degraded ? (
        <div style={{ ...S.error, marginBottom: 10 }}>
          {'⚠ ' + stats!.message + '。上方数据为最后一次成功读取的值，记忆功能当前未工作。'}
        </div>
      ) : null}
      {error ? (
        <div style={S.error}>{'获取状态失败：' + error}</div>
      ) : !stats ? (
        <p style={S.intro}>正在读取记忆状态…</p>
      ) : (
        <div>
          <div style={S.panelLabel}>记忆概况</div>
          <div style={S.statGrid}>
            {tiles.map((t) => {
              return (
                <div key={t.label} className="dsh-mem-card" style={S.statTile}>
                  <div style={S.statNum}>{t.num}</div>
                  <div style={S.statLabel}>{t.label}</div>
                </div>
              );
            })}
          </div>
          <div style={S.panelLabel}>运行状态</div>
          {infos.map((row) => {
            return (
              <div key={row[0]} style={S.infoRow}>
                <span style={S.infoKey}>{row[0]}</span>
                <span style={S.infoVal}>{row[1]}</span>
              </div>
            );
          })}
        </div>
      )}
      {/* 外部存档节（用户要求拉到概览页）：导出/对账/同步/清理这四个动作与上面的
          「重建记忆」「反刍整理」是同一类运维动作，放两个页里人找不到。 */}
      <ArchiveSection rpc={rpc} />
      <p style={S.hint}>浏览各层记忆内容请切换上方 Tab；原始对话（L0）不入浏览器，可由模型侧 conversation_search 工具查询。</p>
    </div>
  );
}
