/** 记忆设置分节的主面板：Tab 框架（概览 / 记忆 / 冲突 / 场景 / Hall / Room / 画像 / 成本 / 日志）。 */
import { useEffect, useState } from 'react';
import type { RpcFn } from './rpc.js';
import { watchSidebarIcon } from './sidebar-icon.js';
import { applySkin, getSkin, setSkin, type Skin } from './skin.js';
import { S } from './styles.js';
import { ensureThemeStyle } from './theme.js';
import { ConflictsTab } from './tabs/ConflictsTab.js';
import { CostTab } from './tabs/CostTab.js';
import { LogTab } from './tabs/LogTab.js';
import { OverviewTab } from './tabs/OverviewTab.js';
import { PersonaTab } from './tabs/PersonaTab.js';
import { RecordsTab } from './tabs/RecordsTab.js';
import { RoomsTab } from './tabs/RoomsTab.js';
import { RoomTab } from './tabs/RoomTab.js';
import { ScenesTab } from './tabs/ScenesTab.js';

/**
 * Tab 注册表：[key, 名称]；首项为默认页。
 *
 * 「冲突」排在「记忆」之后：它是**待办**性质的面板 —— 冻结开启后队列里停着的是
 * 等你裁决的东西，藏太深等于没有（这正是它此前长期缺失的表现：
 * 裁决端点一直在，但没有任何地方列得出 `pair_id`）。
 */
const TABS: Array<[string, string]> = [
  ['overview', '概览'],
  ['records', '记忆'],
  ['conflicts', '冲突'],
  ['scenes', '场景'],
  ['rooms', 'Hall'],
  ['room', 'Room'],
  ['persona', '画像'],
  ['cost', '成本'],
  ['log', '日志'],
];

/** 皮肤三态（轨1-P0）：纯表现层，偏好存 localStorage，不进插件 config。 */
const SKIN_OPTS: Array<[Skin, string]> = [
  ['light', '浅色'],
  ['dark', '深色'],
  ['auto', '跟随'],
];

export function MemoryPanel(props: { rpc: RpcFn }) {
  const rpc = props.rpc;
  const [tab, setTab] = useState('overview');
  const [skin, setSkinState] = useState<Skin>(() => getSkin());

  // 主题令牌与组件样式在面板挂载时注入（输入栏 pill 也可能已注入，幂等）；
  // 每次渲染按当前皮肤刷新 html 属性（ensureThemeStyle 可重入，不重写样式表）。
  ensureThemeStyle(skin);
  useEffect(() => {
    // applySkin 挂上（至多一次的）宿主跟随监听；皮肤变更经 state 重渲染回流至此。
    applySkin(skin);
    watchSidebarIcon();
  }, [skin]);

  const switchSkin = (next: Skin) => {
    setSkin(next); // 持久化到 localStorage
    setSkinState(next); // 触发重渲染 → ensureThemeStyle(next) + effect applySkin(next)
  };

  let body;
  if (tab === 'overview') body = <OverviewTab rpc={rpc} />;
  else if (tab === 'records') body = <RecordsTab rpc={rpc} />;
  else if (tab === 'conflicts') body = <ConflictsTab rpc={rpc} />;
  else if (tab === 'scenes') body = <ScenesTab rpc={rpc} />;
  else if (tab === 'rooms') body = <RoomsTab rpc={rpc} />;
  else if (tab === 'room') body = <RoomTab rpc={rpc} />;
  else if (tab === 'persona') body = <PersonaTab rpc={rpc} />;
  else if (tab === 'cost') body = <CostTab rpc={rpc} />;
  else body = <LogTab rpc={rpc} />;

  return (
    <div className="dsh-mem-root" style={S.section}>
      <h2 style={S.heading}>记忆 (Memory)</h2>
      <p style={S.intro}>L0~L3 分层蒸馏记忆：浏览被记住的内容，控制记忆模式开关。</p>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 2,
          marginTop: -6,
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--dsh-mem-text-3)', marginRight: 4 }}>皮肤</span>
        {SKIN_OPTS.map((s) => (
          <button
            key={s[0]}
            className={skin === s[0] ? 'dsh-mem-tab dsh-mem-tab-on' : 'dsh-mem-tab'}
            onClick={() => switchSkin(s[0])}
            title={`皮肤：${s[1]}`}
          >
            {s[1]}
          </button>
        ))}
      </div>
      <div style={S.tabbar}>
        {TABS.map((t) => {
          return (
            <button
              key={t[0]}
              className={tab === t[0] ? 'dsh-mem-tab dsh-mem-tab-on' : 'dsh-mem-tab'}
              onClick={() => {
                setTab(t[0]!);
              }}
            >
              {t[1]}
            </button>
          );
        })}
      </div>
      {body}
    </div>
  );
}
