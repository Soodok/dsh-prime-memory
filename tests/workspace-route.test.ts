/**
 * 内容路由（workspace 归属）判据回归。
 *
 * 钉住四件与用户口径直接相关的事：
 *   1. 谈到 dsh 生态 → 归 `.agents`；只谈 Hanako/inferglow 且无 dsh → 归 `agent-no-dsh`；
 *   2. **双项目并存时 dsh 侧胜出**（路由表序即优先级，且非 dsh 那条带 noneOf 二次保险）；
 *   3. 都不命中返回 `undefined`——**宁缺勿猜**，归错 workspace 比不归更难查；
 *   4. 只有 `scope` 决定可见性，本模块**从不产出 scope**（它只给一个路径字符串）。
 */
import { describe, expect, it } from 'vitest';
import { routeConflictsWithProvenance, routeWorkspace, type WorkspaceRoute } from '../src/workspace-route.js';
import { WORKSPACE_SUBDIR, targetFor } from '../src/store/memory-md.js';
import { memorySchema } from '../src/config.js';
import { resolve } from 'node:path';

/**
 * 路由表**取自真配置默认值**，不在此手抄一份。
 *
 * 上一版这里写死了与 `config.ts` 同形的三条字面量，结果默认路由表改了这里不会红——
 * “断言与抄本一致、抄本不与事实一致”，等于把刚发生的双 `.agents` 缺陷留在看不见的位置。
 */
const DEFAULTS = (memorySchema as unknown as (v: unknown) => Record<string, unknown>)({});
const SRC = DEFAULTS.workspaceSource as { enabled: boolean; routes: WorkspaceRoute[] };
const ROUTES: WorkspaceRoute[] = SRC.routes;

describe('routeWorkspace', () => {
  it('谈到 dsh 生态 → 归 rewrite-agently（workspace 根，不含 .agents）', () => {
    expect(routeWorkspace('dsh-prime-memory 的反刍计数没有持久化', ROUTES)).toContain('rewrite-agently');
    expect(routeWorkspace('Cordis 的 inject 门面', ROUTES)).toContain('rewrite-agently');
    expect(routeWorkspace('给 brief-sidebar 加一个分区', ROUTES)).toContain('rewrite-agently');
  });

  it('只谈 Hanako/inferglow 且全程无 dsh → 归 agent-no-dsh', () => {
    expect(routeWorkspace('Hanako 1.0.0-beta 的 asar 是明文未加密的', ROUTES)).toContain('agent-no-dsh');
    expect(routeWorkspace('inferglow 的 seed 包里有 pi-agent 0.84.4', ROUTES)).toContain('agent-no-dsh');
  });

  it('mine-dsh-plugins 下的插件内容归本仓 workspace（用户口径）', () => {
    // 只提目录名不提 dsh- 前缀的那类记忆也要能接住：路由表里显式列了 mine-dsh-plugins。
    expect(routeWorkspace('mine-dsh-plugins 里某个插件的目录结构', ROUTES)).toContain('rewrite-agently');
    expect(routeWorkspace('dsh-session-steward 的设置卡不派发', ROUTES)).toContain('rewrite-agently');
  });

  it('内容路由默认开（用户口径：不要全托底到 <dataDir>/memories）', () => {
    expect(SRC.enabled).toBe(true);
  });

  it('默认路由的 path 是 workspace 根：拼上 WORKSPACE_SUBDIR 后不得出现 .agents 套 .agents', () => {
    // 旧默认值写成 `E:\test\rewrite-agently\.agents`，而 `targetFor` 会再拼一层
    // `.agents/memory` → 落点变成 `.agents\.agents\memory\`。护栏只查根存在与否，
    // 救不了这种形状（`.agents` 确实存在），等于在仓里挂一棵孤儿树。
    for (const route of ROUTES) {
      const root = resolve(route.path, ...WORKSPACE_SUBDIR);
      expect(/[/\\]\.agents[/\\]\.agents([/\\]|$)/i.test(root), root).toBe(false);
      expect(route.path.toLowerCase().endsWith('\\.agents'), route.path).toBe(false);
    }
  });

  it('有 workspace_id 的记录落点在 workspace 根下，不在单根（N10 口径）', () => {
    const t = targetFor(
      { id: 'r1', content: 'x', type: 'work_fact', name: '测试条目', workspaceId: 'E:\\test\\rewrite-agently' },
      undefined, 'C:\\tmp\\data',
    );
    expect(t.inWorkspace).toBe(resolve(t.root).toLowerCase().includes('rewrite-agently'));
    expect(t.root.replace(/\\/g, '/')).toContain('.agents/memory');
  });

  it('同一段内容既谈 Hanako 又谈 DSH → 归 DSH 侧（用户口径，排序即优先级）', () => {
    const text = '用 Hanako 的 asar 结构反推 dsh 的 cordis 插件装载方式';
    expect(routeWorkspace(text, ROUTES)).toContain('rewrite-agently');
  });

  it('都不命中 → undefined（宁缺勿猜，绝不给个默认 workspace）', () => {
    expect(routeWorkspace('咖啡豆每周采购一次', ROUTES)).toBeUndefined();
    expect(routeWorkspace('', ROUTES)).toBeUndefined();
    expect(routeWorkspace('   \n\t ', ROUTES)).toBeUndefined();
    expect(routeWorkspace('！？。、', ROUTES)).toBeUndefined();
  });

  it('大小写/全半角/多余空白不影响命中（NFKC 归一，与 memport 同口径）', () => {
    expect(routeWorkspace('DSH 宿主', ROUTES)).toContain('rewrite-agently');
    expect(routeWorkspace('ＤＳＨ 宿主', ROUTES)).toContain('rewrite-agently');
    expect(routeWorkspace('HANAKO   逆向', ROUTES)).toContain('agent-no-dsh');
  });

  it('路由表写错(path 空/非法)不污染归属列，继续找下一命中项', () => {
    expect(routeWorkspace('纯 hanako 内容', [{ path: '   ', anyOf: ['hanako'], noneOf: [] }])).toBeUndefined();
    const routes: WorkspaceRoute[] = [
      { path: '   ', anyOf: ['hanako'], noneOf: [] },
      { path: 'E:\\test\\rewrite-agently\\.agents', anyOf: ['hanako'], noneOf: [] },
    ];
    expect(routeWorkspace('纯 hanako 内容', routes)).toContain('rewrite-agently');
  });

  it('noneOf 命中时此路整条失效（不是"部分匹配"）', () => {
    const routes: WorkspaceRoute[] = [
      { path: 'E:\\x\\dsh', anyOf: ['dsh'], noneOf: [] },
      { path: 'E:\\x\\no-dsh', anyOf: ['dsh'], noneOf: ['dsh'] },
    ];
    expect(routeWorkspace('dsh 相关', routes)).toBe('e:\\x\\dsh');
  });

  it('空路由表 = 全不命中（关状态下调用方不该写任何归属）', () => {
    expect(routeWorkspace('dsh 与 hanako 都谈', [])).toBeUndefined();
  });
});

describe('routeConflictsWithProvenance — 来源链只作交叉验证', () => {
  it('两侧一致(含大小写/盘符差异)不算冲突', () => {
    expect(routeConflictsWithProvenance('E:\\test\\rewrite-agently\\.agents', 'e:\\test\\rewrite-agently\\.agents')).toBe(false);
  });
  it('两侧不同 → 冲突为真(应当可观测，而不是默默选一边)', () => {
    expect(routeConflictsWithProvenance('E:\\test\\rewrite-agently\\.agents', 'E:\\test\\other-proj')).toBe(true);
  });
  it('任一侧缺失 → 不判定(来源链覆盖率低正是常态)', () => {
    expect(routeConflictsWithProvenance(undefined, 'E:\\x')).toBe(false);
    expect(routeConflictsWithProvenance('E:\\x', undefined)).toBe(false);
  });
});
