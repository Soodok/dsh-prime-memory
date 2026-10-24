/**
 * 内容路由的**配置面**回归。
 *
 * 为什么单独钉默认值：路由会往库里的 `workspace_id` 写值，并决定投射文件的**落点根**。
 * 默认值一旦漂动，下一次蒸馏就会在没人授权的情况下开始给记忆归项目／换目录——这类
 * “默认值漂移”是静默的，只能靠断言拦住。（现行决定：**默认开**，理由见下方用例与 config 注释。）
 *
 * 名字：本面叫 `workspaceSource`（旧名 `workspaceHints` 已硬改名，无发版史所以不留别名）。
 * 键名漂移会直接反映在本文件的 schema 取值上——那是本用例的附带防线。
 *
 * 注：`memorySchema` 是**可调用**的（`memorySchema({...})`，同 `capture-config.test.ts`），
 * 不是 `.parse`；照仓内既有写法来，别为了测试去改导出面。
 */
import { describe, expect, it } from 'vitest';
import { memorySchema } from '../src/config.js';

interface SourceCfg {
  enabled: boolean;
  maxRecords: number;
  timeBudgetMs: number;
  routes: Array<{ path: string; anyOf: string[]; noneOf: string[] }>;
}
const sourceOf = (raw: Record<string, unknown> = {}): SourceCfg =>
  (memorySchema as unknown as (v: unknown) => { workspaceSource: SourceCfg })(raw).workspaceSource;

describe('cfg.workspaceSource', () => {
  it('默认开（用户口径：谈到本仓/dsh 生态的记忆要归本仓 workspace，不要全托底到单根）', () => {
    // 旧默认值是 false（当时叫“hints”，归属靠不可靠的来源链推）。主判据已换成内容路由后，
    // 关着就等于"新记录永远没归属"——实测 0/1166，而用户明确要求本仓相关记忆落本仓。
    expect(sourceOf().enabled).toBe(true);
  });

  it('默认路由的 path 是 workspace 根，不得自带 .agents（否则落点会双叠）', () => {
    // `targetFor` 会在 path 后拼 `.agents/memory`；旧默认值写成 `...\.agents` 就会得到
    // `.agents\.agents\memory\`，而护栏只查根存在与否，拦不住这种形状。
    for (const r of sourceOf().routes) {
      expect(r.path.toLowerCase().endsWith('\\.agents'), r.path).toBe(false);
      expect(r.path.toLowerCase().endsWith('/.agents'), r.path).toBe(false);
    }
  });

  it('默认路由表必须可移植：不得含任何具体主机的绝对路径（issue #13）', () => {
    // 曾经的默认值是作者本机的 `E:\test\rewrite-agently` / `E:\test\agent-no-dsh`。
    // 别人装好插件即刻生效：凡正文含 dsh/cordis/prime-memory 的记忆都被写到别人的路径上，
    // 别人的机器没这个盘 → 投射静默退回单根；而 `scope: workspace` 时这些记录在真实工作区
    // 里按 workspace 过滤不可见，表现为"记忆莫名其妙丢了"。默认值属于可移植性契约，
    // 断言从"默认表等于某两条规则"改成"默认表不许出现宿主私有路径"。
    const routes = sourceOf().routes;
    for (const r of routes) {
      expect(r.path, '默认路由不得含他人机器路径').not.toMatch(/[A-Za-z]:[\\/]/);
      expect(r.path).not.toContain('rewrite-agently');
      expect(r.path).not.toContain('agent-no-dsh');
    }
  });

  it('默认不启用任何具体归属（routes 为空 → 全部落单根，不猜）', () => {
    // 空表不是"功能坏了"：`routeWorkspace` 全不命中返回 undefined，归属列留空，
    // 行为与 enabled:false 等价但语义更诚实（"没配"而不是"配了个别人的"）。
    expect(sourceOf().routes).toEqual([]);
  });

  it('re-link 护栏有默认值（漏传不会退化成"无界扫全库"）', () => {
    const cfg = sourceOf();
    expect(cfg.maxRecords).toBeGreaterThan(0);
    expect(Number.isFinite(cfg.timeBudgetMs)).toBe(true);
    expect(cfg.timeBudgetMs).toBeGreaterThan(0);
  });

  it('显式开启与自定义路由都能被解析（用户改配置不该被 schema 拒）', () => {
    const cfg = sourceOf({
      workspaceSource: { enabled: true, routes: [{ path: 'E:\\x\\proj', anyOf: ['foo'], noneOf: ['bar'] }] },
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.routes).toHaveLength(1);
    expect(cfg.routes[0]!.noneOf).toEqual(['bar']);
  });

  it('路由项缺字段时由 schema 兜默认，不会产出 undefined 词表把路由打死', () => {
    const cfg = sourceOf({ workspaceSource: { enabled: true, routes: [{ path: 'E:\\x\\only' }] } });
    expect(cfg.routes[0]!.anyOf).toEqual([]);
    expect(cfg.routes[0]!.noneOf).toEqual([]);
  });
});
