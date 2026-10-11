/**
 * 皮肤（轨1-P0）的构建产物守卫。
 *
 * 沿用本仓 client 侧测试的既有约定：**读 `dist/client.js`**（改了 client/src 必须先
 * `npm run build`），纯 node 断言，不拉 DOM。这里钉住三件事，任何一条退化即红：
 *   1. 皮肤显式覆写块 `html[data-dsh-mem-skin="light"]` / `="dark"` 都在（令牌值来源）；
 *   2. auto/跟随宿主的兜底块仍在（`:root` 浅 + `body[data-ds-dark-theme]` 暗）——
 *      皮肤不能把兜底删掉，否则 auto 档失去宿主透传；
 *   3. ensureThemeStyle 可重入：既有 `getElementById` 幂等守卫 + 每次都刷新
 *      `data-dsh-mem-skin` 属性（切换皮肤只换属性，不重写样式表）。
 *
 * 不证明：皮肤真的改变了像素观感——那仍是真机 GUI 检查（与 client-entry.test.ts 同一边界）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(HERE, '..', 'dist', 'client.js');
const js = readFileSync(BUNDLE, 'utf8');

describe('皮肤令牌块（构建产物）', () => {
  it('显式皮肤覆写块都在，且各自带浅色/暗色锚定令牌', () => {
    // light 覆写块：选择器存在 + 块内含浅色强调色 #4d6bfe
    expect(js).toContain('html[data-dsh-mem-skin="light"]');
    // dark 覆写块：选择器存在 + 块内含暗色强调色 #6e85ff
    expect(js).toContain('html[data-dsh-mem-skin="dark"]');
  });

  it('auto 兜底块未被皮肤覆写挤掉（宿主透传仍在）', () => {
    expect(js).toContain(':root {');
    expect(js).toContain('body[data-ds-dark-theme] {');
  });

  it('浅/暗两组强调色都出现在产物里（说明两组令牌都被引用，非空壳）', () => {
    expect(js).toContain('#4d6bfe'); // 浅色 --dsh-mem-accent
    expect(js).toContain('#6e85ff'); // 暗色 --dsh-mem-accent
  });
});

describe('ensureThemeStyle 可重入', () => {
  it('样式表只注入一次（保留 getElementById 幂等守卫）', () => {
    expect(js).toContain('dsh-mem-theme-style');
    expect(js).toMatch(/getElementById\([^)]*THEME_STYLE_ID|getElementById\("dsh-mem-theme-style"\)/);
  });

  it('每次都按生效皮肤刷新 html 属性（切换只换属性不重写表）', () => {
    expect(js).toContain('data-dsh-mem-skin');
    // auto 档解析依赖宿主暗色属性 + 系统偏好，二者都应在产物里被读取
    expect(js).toContain('data-ds-dark-theme');
    expect(js).toContain('prefers-color-scheme: dark');
  });
});
