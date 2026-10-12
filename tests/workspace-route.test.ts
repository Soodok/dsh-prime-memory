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

/** 与 config.ts 默认表同形（win32 归一会把盘符与小写化，断言里用同样形式）。 */
const ROUTES: WorkspaceRoute[] = [
  { path: 'E:\\test\\rewrite-agently\\.agents', anyOf: ['dsh', 'cordis', 'prime-memory', 'brief-sidebar', 'host farm'], noneOf: [] },
  { path: 'E:\\test\\agent-no-dsh', anyOf: ['hanako', 'hanaagent', 'openhanako', 'inferglow', 'pi-agent'], noneOf: ['dsh'] },
];

describe('routeWorkspace', () => {
  it('谈到 dsh 生态 → 归 rewrite-agently\\.agents', () => {
    expect(routeWorkspace('dsh-prime-memory 的反刍计数没有持久化', ROUTES)).toContain('rewrite-agently');
    expect(routeWorkspace('Cordis 的 inject 门面', ROUTES)).toContain('rewrite-agently');
    expect(routeWorkspace('给 brief-sidebar 加一个分区', ROUTES)).toContain('rewrite-agently');
  });

  it('只谈 Hanako/inferglow 且全程无 dsh → 归 agent-no-dsh', () => {
    expect(routeWorkspace('Hanako 1.0.0-beta 的 asar 是明文未加密的', ROUTES)).toContain('agent-no-dsh');
    expect(routeWorkspace('inferglow 的 seed 包里有 pi-agent 0.84.4', ROUTES)).toContain('agent-no-dsh');
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
