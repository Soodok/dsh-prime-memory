/**
 * Vitest 配置：纯 node 环境单元测试（TDD 基座，与 smoke 互补）。
 * 只测纯函数/模块级逻辑，不拉宿主；client 的 JSX 组件不在本 suite（另由 typecheck 管）。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 全量套件 159 个文件并行时，重磁盘 IO 的投影/收敛类测试会顶穿默认 5s：
    // 一旦超时，后台未结算的 runProjection 会把模块级 running 标志留给下一个用例，
    // 造成「已有任务在跑」级联假阳性（单跑同文件必绿）。放宽到 20s。
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/smoke.ts', 'src/bench-control.ts', 'src/token-cost.ts'],
    },
  },
});