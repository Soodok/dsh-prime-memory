/**
 * 皮肤（插件自选外观）：Light / Dark / Auto 三态。轨1-P0。
 *
 * 设计边界（对齐计划轨1，且刻意保守）：
 * - 皮肤是纯表现层，偏好存 **localStorage**，**不进插件 config / volatile 键集**
 *   （避免 config 缺键丢用户值的红线 S5）。
 * - `auto` = 插件不表态，跟随宿主：宿主 `body[data-ds-dark-theme]` + 系统
 *   `prefers-color-scheme` 自然透传（theme.ts 的 `:root` / `body[data-ds-dark-theme]` 兜底）。
 * - `light` / `dark` = 在 `html[data-dsh-mem-skin]` 上强制一组令牌覆写（theme.ts 声明），
 *   与宿主暗色块同特异度但后置声明胜出。
 * - 只挂**一个** MutationObserver 监听宿主暗色属性，且仅在 auto 档生效。
 * - `ensureThemeStyle` 是各挂载点（面板/pill/浮层/重建面板）都会调的幂等入口，
 *   故 theme.ts 会始终用 `getSkin()` 兜底刷新属性，无需在每个挂载点单独接线。
 */
export type Skin = 'light' | 'dark' | 'auto';

const SKIN_KEY = 'dsh-mem-skin';

function rootEl(): HTMLElement {
  return document.documentElement;
}

function lsGet(): string | null {
  try {
    return localStorage.getItem(SKIN_KEY);
  } catch {
    return null;
  }
}
function lsSet(v: string): void {
  try {
    localStorage.setItem(SKIN_KEY, v);
  } catch {
    // localStorage 不可用（隐私模式等）：本次会话内仍生效，不持久化即可。
  }
}

function hostDark(): boolean {
  return typeof document !== 'undefined' && document.body.hasAttribute('data-ds-dark-theme');
}
function sysDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** 生效外观：light|dark 显式；auto 取宿主暗色属性，否则取系统偏好。 */
export function effectiveSkin(skin: Skin): 'light' | 'dark' {
  if (skin === 'light') return 'light';
  if (skin === 'dark') return 'dark';
  return hostDark() || sysDark() ? 'dark' : 'light';
}

/** 读取持久化的皮肤偏好（缺省 auto）。 */
export function getSkin(): Skin {
  const v = lsGet();
  return v === 'light' || v === 'dark' ? v : 'auto';
}

export function setSkin(skin: Skin): void {
  lsSet(skin);
}

/** 把生效外观写到 html 属性上（auto 也解析成具体 light|dark，保证令牌块命中）。 */
function commit(skin: Skin): void {
  rootEl().setAttribute('data-dsh-mem-skin', effectiveSkin(skin));
}

let hostWatched = false;
function ensureHostWatch(): void {
  if (hostWatched) return;
  hostWatched = true;
  const obs = new MutationObserver(() => {
    // 宿主翻转暗色时：只有 auto 档才跟随，显式 light/dark 不被宿主改写。
    if (getSkin() === 'auto') commit('auto');
  });
  obs.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
}

/** 应用皮肤偏好到 DOM，并挂上（至多一次的）宿主跟随监听。返回生效外观。 */
export function applySkin(skin: Skin): 'light' | 'dark' {
  commit(skin);
  ensureHostWatch();
  return effectiveSkin(skin);
}
