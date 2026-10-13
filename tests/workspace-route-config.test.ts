/**
 * 内容路由的**配置面**回归。
 *
 * 为什么单独钉默认值：路由会往库里的 `workspace_id` 写值。默认一旦从 `false` 漂成
 * `true`，下一次蒸馏就会在没人授权的情况下开始给记忆归项目——这类"默认值漂移"是
 * 静默的，只能靠断言拦住。
 *
 * 注：`memorySchema` 是**可调用**的（`memorySchema({...})`，同 `capture-config.test.ts`），
 * 不是 `.parse`；照仓内既有写法来，别为了测试去改导出面。
 */
import { describe, expect, it } from 'vitest';
import { memorySchema } from '../src/config.js';

interface Hints {
  enabled: boolean;
  maxRecords: number;
  timeBudgetMs: number;
  routes: Array<{ path: string; anyOf: string[]; noneOf: string[] }>;
}
const hintsOf = (raw: Record<string, unknown> = {}): Hints =>
  (memorySchema as unknown as (v: unknown) => { workspaceHints: Hints })(raw).workspaceHints;

describe('cfg.workspaceHints', () => {
  it('默认开（用户口径：谈到本仓/dsh 生态的记忆要归本仓 workspace，不要全托底到单根）', () => {
    // 旧默认值是 false（当时叫“hints”，归属靠不可靠的来源链推）。主判据已换成内容路由后，
    // 关着就等于"新记录永远没归属"——实测 0/1166，而用户明确要求本仓相关记忆落本仓。
    expect(hintsOf().enabled).toBe(true);
  });

  it('默认路由的 path 是 workspace 根，不得自带 .agents（否则落点会双叠）', () => {
    // `targetFor` 会在 path 后拼 `.agents/memory`；旧默认值写成 `...\.agents` 就会得到
    // `.agents\.agents\memory\`，而护栏只查根存在与否，拦不住这种形状。
    for (const r of hintsOf().routes) {
      expect(r.path.toLowerCase().endsWith('\\.agents'), r.path).toBe(false);
      expect(r.path.toLowerCase().endsWith('/.agents'), r.path).toBe(false);
    }
  });

  it('默认路由表 = 用户给的两条归类规则，且 dsh 侧在前', () => {
    const routes = hintsOf().routes;
    expect(routes.length).toBeGreaterThanOrEqual(2);
    const dshIdx = routes.findIndex((r) => r.path.includes('rewrite-agently'));
    const noDshIdx = routes.findIndex((r) => r.path.includes('agent-no-dsh'));
    expect(dshIdx, '缺 .agents 侧路由').toBeGreaterThanOrEqual(0);
    expect(noDshIdx, '缺 agent-no-dsh 侧路由').toBeGreaterThanOrEqual(0);
    // 排序即优先级：双项目并存时 dsh 侧必须先被匹配到（用户口径）。
    expect(dshIdx).toBeLessThan(noDshIdx);
    expect(routes[dshIdx].anyOf).toContain('dsh');
    expect(routes[noDshIdx].anyOf.some((w) => w.includes('hanako'))).toBe(true);
    // 非 dsh 那条必须带 noneOf:['dsh'] 作二次保险——只靠排序太脆。
    expect(routes[noDshIdx].noneOf).toContain('dsh');
  });

  it('re-link 护栏有默认值（漏传不会退化成"无界扫全库"）', () => {
    const hints = hintsOf();
    expect(hints.maxRecords).toBeGreaterThan(0);
    expect(Number.isFinite(hints.timeBudgetMs)).toBe(true);
    expect(hints.timeBudgetMs).toBeGreaterThan(0);
  });

  it('显式开启与自定义路由都能被解析（用户改配置不该被 schema 拒）', () => {
    const hints = hintsOf({
      workspaceHints: { enabled: true, routes: [{ path: 'E:\\x\\proj', anyOf: ['foo'], noneOf: ['bar'] }] },
    });
    expect(hints.enabled).toBe(true);
    expect(hints.routes).toHaveLength(1);
    expect(hints.routes[0].noneOf).toEqual(['bar']);
  });

  it('路由项缺字段时由 schema 兜默认，不会产出 undefined 词表把路由打死', () => {
    const hints = hintsOf({ workspaceHints: { enabled: true, routes: [{ path: 'E:\\x\\only' }] } });
    expect(hints.routes[0].anyOf).toEqual([]);
    expect(hints.routes[0].noneOf).toEqual([]);
  });
});
