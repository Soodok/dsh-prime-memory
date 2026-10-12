window.__ModuleLoader__.load({
	id: "dsh-prime-memory",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __export = (target, all) => {
		  for (var name in all)
		    __defProp(target, name, { get: all[name], enumerable: true });
		};
		var __copyProps = (to, from, except, desc) => {
		  if (from && typeof from === "object" || typeof from === "function") {
		    for (let key of __getOwnPropNames(from))
		      if (!__hasOwnProp.call(to, key) && key !== except)
		        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
		  }
		  return to;
		};
		var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
		
		// client/src/entry.tsx
		var entry_exports = {};
		__export(entry_exports, {
		  SETTINGS_SEAT: () => SETTINGS_SEAT,
		  apply: () => apply,
		  inject: () => inject
		});
		module.exports = __toCommonJS(entry_exports);
		
		// client/src/panel.tsx
		var import_react21 = require("react");
		
		// client/src/sidebar-icon.ts
		var BOOK_ICON_SVG = '<svg data-mem-icon="1" viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0"><path d="M8 3.4C6.6 2.5 4.6 2.4 2.9 3.1v9.3c1.7-.7 3.7-.6 5.1.3 1.4-.9 3.4-1 5.1-.3V3.1C11.4 2.4 9.4 2.5 8 3.4Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 3.4v9.3" stroke="currentColor" stroke-width="1.2"/></svg>';
		function patchSidebarIcon() {
		  try {
		    const buttons = document.querySelectorAll("button");
		    for (let i = 0; i < buttons.length; i++) {
		      const b = buttons[i];
		      const span = b.querySelector("span");
		      const svg = b.querySelector("svg");
		      if (span && svg && span.textContent && span.textContent.trim() === "记忆" && svg.getAttribute("data-mem-icon") !== "1") {
		        svg.outerHTML = BOOK_ICON_SVG;
		      }
		    }
		  } catch {
		  }
		}
		var sidebarIconTimer = null;
		function scheduleSidebarPatch() {
		  if (sidebarIconTimer !== null) return;
		  sidebarIconTimer = setTimeout(() => {
		    sidebarIconTimer = null;
		    patchSidebarIcon();
		  }, 250);
		}
		function watchSidebarIcon() {
		  patchSidebarIcon();
		  try {
		    if (document.body.getAttribute("data-mem-icon-bodywatch") === "1") return;
		    document.body.setAttribute("data-mem-icon-bodywatch", "1");
		    new MutationObserver(scheduleSidebarPatch).observe(document.body, { childList: true, subtree: true });
		  } catch {
		  }
		}
		
		// client/src/skin.ts
		var SKIN_KEY = "dsh-mem-skin";
		function rootEl() {
		  return document.documentElement;
		}
		function lsGet() {
		  try {
		    return localStorage.getItem(SKIN_KEY);
		  } catch {
		    return null;
		  }
		}
		function lsSet(v) {
		  try {
		    localStorage.setItem(SKIN_KEY, v);
		  } catch {
		  }
		}
		function hostDark() {
		  return typeof document !== "undefined" && document.body.hasAttribute("data-ds-dark-theme");
		}
		function sysDark() {
		  try {
		    return window.matchMedia("(prefers-color-scheme: dark)").matches;
		  } catch {
		    return false;
		  }
		}
		function effectiveSkin(skin) {
		  if (skin === "light") return "light";
		  if (skin === "dark") return "dark";
		  return hostDark() || sysDark() ? "dark" : "light";
		}
		function getSkin() {
		  const v = lsGet();
		  return v === "light" || v === "dark" ? v : "auto";
		}
		function setSkin(skin) {
		  lsSet(skin);
		}
		function commit(skin) {
		  rootEl().setAttribute("data-dsh-mem-skin", effectiveSkin(skin));
		}
		var hostWatched = false;
		function ensureHostWatch() {
		  if (hostWatched) return;
		  hostWatched = true;
		  const obs = new MutationObserver(() => {
		    if (getSkin() === "auto") commit("auto");
		  });
		  obs.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
		}
		function applySkin(skin) {
		  commit(skin);
		  ensureHostWatch();
		  return effectiveSkin(skin);
		}
		
		// client/src/styles.ts
		var S = {
		  section: { padding: "0 4px" },
		  heading: { fontSize: 16, fontWeight: 600, margin: "0 0 4px", color: "var(--dsh-mem-text-1)" },
		  intro: { fontSize: 13, color: "var(--dsh-mem-text-3)", margin: "0 0 12px" },
		  tabbar: { display: "flex", gap: 1, flexWrap: "nowrap", overflowX: "auto", borderBottom: "1px solid var(--dsh-mem-border)", marginBottom: 14 },
		  error: {
		    marginTop: 10,
		    fontSize: 13,
		    color: "var(--dsh-mem-danger)",
		    whiteSpace: "pre-wrap"
		  },
		  hint: { marginTop: 12, fontSize: 12, color: "var(--dsh-mem-text-3)" },
		  toolbar: { display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" },
		  card: {
		    padding: "10px 12px",
		    marginBottom: 8,
		    fontSize: 13
		  },
		  cardHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 },
		  muted: { color: "var(--dsh-mem-text-3)", fontSize: 12 },
		  content: { lineHeight: 1.5, wordBreak: "break-word", color: "var(--dsh-mem-text-1)" },
		  detail: {
		    marginTop: 8,
		    paddingTop: 8,
		    borderTop: "1px dashed var(--dsh-mem-border)",
		    fontSize: 12,
		    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
		    color: "var(--dsh-mem-text-2)",
		    whiteSpace: "pre-wrap"
		  },
		  pre: {
		    margin: 0,
		    padding: "10px 12px",
		    background: "var(--dsh-mem-bg-inset)",
		    border: "1px solid var(--dsh-mem-border)",
		    borderRadius: 10,
		    fontSize: 12,
		    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
		    whiteSpace: "pre-wrap",
		    wordBreak: "break-word",
		    lineHeight: 1.6,
		    maxHeight: 480,
		    overflow: "auto"
		  },
		  switchRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0" },
		  switchLabel: { fontSize: 13, fontWeight: 600, minWidth: 72, color: "var(--dsh-mem-text-1)" },
		  switchDesc: { fontSize: 12, color: "var(--dsh-mem-text-3)" },
		  switch: {
		    width: 36,
		    height: 20,
		    borderRadius: 999,
		    position: "relative",
		    cursor: "pointer",
		    transition: "background .15s",
		    flexShrink: 0
		  },
		  switchOn: { background: "var(--dsh-mem-accent-fill)" },
		  switchOff: { background: "var(--dsh-mem-border-strong)" },
		  switchDisabled: { opacity: 0.4, cursor: "not-allowed" },
		  knob: {
		    position: "absolute",
		    top: 2,
		    width: 16,
		    height: 16,
		    borderRadius: "50%",
		    background: "var(--dsh-mem-thumb)",
		    transition: "left .15s",
		    boxShadow: "0 1px 2px rgba(0,0,0,.25)"
		  },
		  switchPanel: {
		    border: "1px solid var(--dsh-mem-border)",
		    borderRadius: 10,
		    background: "var(--dsh-mem-bg-card)",
		    boxShadow: "var(--dsh-mem-shadow-card)",
		    padding: "4px 14px",
		    marginBottom: 14
		  },
		  panelLabel: {
		    fontSize: 12,
		    fontWeight: 600,
		    color: "var(--dsh-mem-text-3)",
		    margin: "12px 0 2px"
		  },
		  statGrid: {
		    display: "grid",
		    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
		    gap: 8,
		    marginBottom: 14
		  },
		  statTile: { padding: "10px 12px" },
		  statNum: { fontSize: 20, fontWeight: 650, lineHeight: "28px", color: "var(--dsh-mem-text-1)" },
		  statLabel: { fontSize: 12, color: "var(--dsh-mem-text-3)", marginTop: 2 },
		  infoRow: {
		    display: "flex",
		    alignItems: "baseline",
		    gap: 12,
		    padding: "5px 0",
		    borderBottom: "1px solid var(--dsh-mem-border)"
		  },
		  infoKey: { fontSize: 12.5, color: "var(--dsh-mem-text-3)", whiteSpace: "nowrap", minWidth: 96 },
		  infoVal: {
		    fontSize: 12.5,
		    color: "var(--dsh-mem-text-1)",
		    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
		    wordBreak: "break-all",
		    textAlign: "right",
		    flex: 1
		  },
		  seg: {
		    display: "inline-flex",
		    border: "1px solid var(--dsh-mem-border)",
		    borderRadius: 8,
		    overflow: "hidden",
		    flexShrink: 0,
		    background: "var(--dsh-mem-bg-inset)"
		  },
		  segBtn: {
		    padding: "4px 12px",
		    fontSize: 12,
		    lineHeight: "16px",
		    cursor: "pointer",
		    background: "transparent",
		    color: "var(--dsh-mem-text-2)",
		    border: "none",
		    borderRight: "1px solid var(--dsh-mem-border)"
		  },
		  segBtnOn: {
		    background: "var(--dsh-mem-accent-fill)",
		    color: "#fff",
		    fontWeight: 600
		  },
		  flexRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
		  grow: { flex: 1 },
		  sceneHead: { display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6, flexWrap: "wrap" },
		  sceneTitle: { fontSize: 13, fontWeight: 600, fontFamily: "ui-monospace, Consolas, monospace", color: "var(--dsh-mem-text-1)" }
		};
		
		// client/src/theme.ts
		var THEME_STYLE_ID = "dsh-mem-theme-style";
		var LIGHT_TOK = [
		  "  --dsh-mem-accent: #4d6bfe;",
		  "  --dsh-mem-accent-text: #3d5be0;",
		  "  --dsh-mem-accent-fill: #3d5be0;",
		  "  --dsh-mem-accent-weak: rgba(77,107,254,0.10);",
		  "  --dsh-mem-bg-card: var(--dsw-alias-bg-layer-2, #ffffff);",
		  "  --dsh-mem-bg-inset: var(--dsw-alias-bg-overlay, #e9ecf2);",
		  "  --dsh-mem-bg-hover: var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,0.06));",
		  "  --dsh-mem-bg-pop: var(--dsw-alias-bg-layer-3, #ffffff);",
		  "  --dsh-mem-bg-pop-base: var(--dsw-alias-bg-primary, #ffffff);",
		  "  --dsh-mem-border: var(--dsw-alias-border-l2, rgba(0,0,0,0.10));",
		  "  --dsh-mem-border-strong: var(--dsw-alias-border-l3, rgba(0,0,0,0.12));",
		  "  --dsh-mem-border-pop: var(--dsw-alias-border-inverted, rgba(0,0,0,0));",
		  "  --dsh-mem-text-1: var(--dsw-alias-label-primary, #0f1115);",
		  "  --dsh-mem-text-2: var(--dsw-alias-label-secondary, #61666b);",
		  "  --dsh-mem-text-3: var(--dsw-alias-label-tertiary, #6e7781);",
		  "  --dsh-mem-danger: var(--dsw-alias-state-error-primary, #d0403f);",
		  // 成本折线图系列色：8 档固定色；PALETTE 只引用 var()，1 档锚品牌蓝、8 档中性"其他"
		  "  --dsh-mem-chart-1: #4d6bfe;",
		  "  --dsh-mem-chart-2: #0e9c8f;",
		  "  --dsh-mem-chart-3: #1f9d55;",
		  "  --dsh-mem-chart-4: #a8821c;",
		  "  --dsh-mem-chart-5: #d97a0d;",
		  "  --dsh-mem-chart-6: #d64570;",
		  "  --dsh-mem-chart-7: #7c5cff;",
		  "  --dsh-mem-chart-8: #61666b;",
		  // 档位色 = 灰 → 品牌蓝的渐变阶（chat/work 过渡蓝、auto 品牌蓝）；
		  // 文字对比度按 pill 实际底色（流光内底 = bg-card 97% + 档位色 3%）复算 AA 达标
		  "  --dsh-mem-mode-chat: #5a69b0;",
		  "  --dsh-mem-mode-work: #5263ca;",
		  "  --dsh-mem-mode-auto: #3d5be0;",
		  // 开关旋钮 / 进度条底（滑轨已随 ModeSlider 删除，填充渐变与停点令牌一并移除）
		  "  --dsh-mem-thumb: #ffffff;",
		  "  --dsh-mem-track: rgba(128,140,150,0.32);",
		  // wing 八边形令牌（WingWheel）：连线 / 角默认 / 角选中 / 空角与未打标态；
		  // 全部引用既有中性色与品牌蓝体系，双主题各自声明，无裸色溢出
		  "  --dsh-mem-wing-line: rgba(128,140,150,0.35);",
		  "  --dsh-mem-wing-corner: var(--dsh-mem-text-2);",
		  "  --dsh-mem-wing-corner-on: var(--dsh-mem-accent);",
		  "  --dsh-mem-wing-empty: var(--dsh-mem-text-3);",
		  "  --dsh-mem-shadow-card: var(--dsw-shadow-lv1, 0 2px 4px 0 rgba(0,0,0,0.05));",
		  "  --dsh-mem-shadow-pop: var(--dsw-shadow-lv3, 0 0 1px 0 rgba(0,0,0,.2), 0 0 4px 0 rgba(0,0,0,.02), 0 12px 32px 0 rgba(0,0,0,0.08));"
		];
		var DARK_TOK = [
		  "  --dsh-mem-accent: #6e85ff;",
		  "  --dsh-mem-accent-text: #7b90ff;",
		  "  --dsh-mem-accent-fill: #465ce8;",
		  "  --dsh-mem-accent-weak: rgba(110,133,255,0.14);",
		  "  --dsh-mem-bg-card: var(--dsw-alias-bg-layer-2, #2c2c2e);",
		  "  --dsh-mem-bg-inset: var(--dsw-alias-bg-layer-1, #232324);",
		  "  --dsh-mem-bg-hover: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08));",
		  "  --dsh-mem-bg-pop: var(--dsw-alias-bg-layer-3, #353638);",
		  "  --dsh-mem-bg-pop-base: var(--dsw-alias-bg-primary, #1b1c1e);",
		  "  --dsh-mem-border: var(--dsw-alias-border-l2, rgba(255,255,255,0.12));",
		  "  --dsh-mem-border-strong: var(--dsw-alias-border-l3, rgba(255,255,255,0.16));",
		  "  --dsh-mem-border-pop: var(--dsw-alias-border-inverted, rgba(255,255,255,0.06));",
		  "  --dsh-mem-text-1: var(--dsw-alias-label-primary, #f9fafb);",
		  "  --dsh-mem-text-2: var(--dsw-alias-label-secondary, #cfd3d6);",
		  "  --dsh-mem-text-3: var(--dsw-alias-label-tertiary, #8892a6);",
		  "  --dsh-mem-danger: var(--dsw-alias-state-error-primary, #f4707b);",
		  "  --dsh-mem-chart-1: #6e85ff;",
		  "  --dsh-mem-chart-2: #35c4b5;",
		  "  --dsh-mem-chart-3: #52c98d;",
		  "  --dsh-mem-chart-4: #d9b23e;",
		  "  --dsh-mem-chart-5: #f59e5b;",
		  "  --dsh-mem-chart-6: #f47ba2;",
		  "  --dsh-mem-chart-7: #a78bfa;",
		  "  --dsh-mem-chart-8: #8892a6;",
		  "  --dsh-mem-mode-chat: #97a4ff;",
		  "  --dsh-mem-mode-work: #8295ff;",
		  "  --dsh-mem-mode-auto: #7b90ff;",
		  "  --dsh-mem-thumb: #e8ebf5;",
		  "  --dsh-mem-track: rgba(148,160,180,0.30);",
		  "  --dsh-mem-wing-line: rgba(148,160,180,0.32);",
		  "  --dsh-mem-wing-corner: var(--dsh-mem-text-2);",
		  "  --dsh-mem-wing-corner-on: var(--dsh-mem-accent);",
		  "  --dsh-mem-wing-empty: var(--dsh-mem-text-3);",
		  "  --dsh-mem-shadow-card: var(--dsw-shadow-lv1, 0 2px 4px 0 rgba(0,0,0,0.3));",
		  "  --dsh-mem-shadow-pop: var(--dsw-shadow-lv3, 0 0 1px 0 rgba(0,0,0,.2), 0 0 4px 0 rgba(0,0,0,.02), 0 12px 32px 0 rgba(0,0,0,0.08));"
		];
		var COMPONENT_CSS = [
		  // conic 角度要 @property 注册才能插值动画；不支持 @property 的浏览器里
		  // var(--dsh-mem-angle) 无定义 → conic 层失效 → background 整条退化为无背景
		  //（光带边框与内底一起消失，只剩文字色）。2026 常青浏览器均已支持，仅作记录。
		  "@property --dsh-mem-angle { syntax: '<angle>'; initial-value: 0deg; inherits: false; }",
		  "@keyframes dshMemFlow { to { --dsh-mem-angle: 360deg; } }",
		  // ── 主题切换过渡：只过渡颜色/阴影（不碰 transform），明暗翻转不生硬 ──
		  ".dsh-mem-root, .dsh-mem-root * { transition: background-color .18s ease, border-color .18s ease, color .18s ease, box-shadow .18s ease; }",
		  // ── 控件：按钮（次级）── 圆角体系：控件 8 / 卡片 10 / 浮层 12 / 胶囊 999
		  ".dsh-mem-btn {",
		  "  padding: 5px 14px; font-size: 13px; line-height: 20px; border-radius: 8px; cursor: pointer;",
		  "  border: 1px solid var(--dsh-mem-border); background: var(--dsh-mem-bg-card); color: var(--dsh-mem-text-1);",
		  "  transition: background-color .15s ease, border-color .15s ease, transform .08s ease;",
		  "}",
		  ".dsh-mem-btn:hover:not(:disabled) { border-color: var(--dsh-mem-border-strong); background: var(--dsh-mem-bg-hover); }",
		  ".dsh-mem-btn:active:not(:disabled) { transform: scale(0.98); }",
		  ".dsh-mem-btn:focus-visible { outline: 2px solid var(--dsh-mem-accent); outline-offset: 1px; }",
		  ".dsh-mem-btn:disabled { opacity: 0.45; cursor: not-allowed; }",
		  // ── 控件：输入框 / 下拉 ──
		  ".dsh-mem-input {",
		  "  padding: 5px 10px; font-size: 13px; border-radius: 8px; color: var(--dsh-mem-text-1);",
		  "  border: 1px solid var(--dsh-mem-border); background: var(--dsh-mem-bg-card);",
		  "  transition: border-color .15s ease, box-shadow .15s ease;",
		  "}",
		  ".dsh-mem-input:focus {",
		  "  outline: none; border-color: var(--dsh-mem-accent);",
		  "  box-shadow: 0 0 0 3px var(--dsh-mem-accent-weak);",
		  "}",
		  // ── 下拉触发钮（NSel）：观感与输入框一致（8px 圆角/同令牌边框底色），
		  //    文字 ellipsis + CSS 描边 chevron（展开旋转 180°）；弹出面板见 .dsh-mem-pop ──
		  ".dsh-mem-select {",
		  "  display: inline-flex; align-items: center; justify-content: space-between; gap: 8px;",
		  "  width: 100%; min-width: 0; padding: 5px 10px; font: inherit; font-size: 13px; line-height: 20px;",
		  "  text-align: left; border-radius: 8px; cursor: pointer; color: var(--dsh-mem-text-1);",
		  "  border: 1px solid var(--dsh-mem-border); background: var(--dsh-mem-bg-card);",
		  "  transition: border-color .15s ease, box-shadow .15s ease;",
		  "}",
		  ".dsh-mem-select:focus-visible {",
		  "  outline: none; border-color: var(--dsh-mem-accent);",
		  "  box-shadow: 0 0 0 3px var(--dsh-mem-accent-weak);",
		  "}",
		  ".dsh-mem-select:disabled { opacity: 0.45; cursor: not-allowed; }",
		  ".dsh-mem-select-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
		  // 下拉弹出面板：dsh MenuDropdown 同款——浮层 12 圆角 + menu 底 + lv3 投影；
		  // 选项行 10 圆角 + hover 底色 + 选中打勾（active 由 data-active 标记）
		  ".dsh-mem-sel { position: relative; display: inline-flex; min-width: 0; vertical-align: top; }",
		  ".dsh-mem-sel-chev {",
		  "  width: 8px; height: 8px; flex: none; margin-right: 2px;",
		  "  border-right: 1.5px solid var(--dsh-mem-text-3); border-bottom: 1.5px solid var(--dsh-mem-text-3);",
		  "  transform: rotate(45deg); transition: transform .12s ease;",
		  "}",
		  ".dsh-mem-sel-chev-open { transform: rotate(225deg); }",
		  ".dsh-mem-pop {",
		  "  position: absolute; top: calc(100% + 6px); left: 0; z-index: 30;",
		  "  min-width: 100%; width: max-content; max-width: 340px; max-height: 264px;",
		  "  overflow-y: auto; overscroll-behavior: contain; padding: 4px;",
		  // 不透明实底:基色垫底+别名色整层叠印(别名即使带 alpha 也被垫死),2026-10-09 用户修复
		  "  background: linear-gradient(var(--dsh-mem-bg-pop), var(--dsh-mem-bg-pop)) , var(--dsh-mem-bg-pop-base); border: 1px solid var(--dsh-mem-border-pop);",
		  "  border-radius: 12px; box-shadow: var(--dsh-mem-shadow-pop);",
		  "}",
		  ".dsh-mem-pop-opt {",
		  "  display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box;",
		  "  min-height: 32px; padding: 5px 10px; font: inherit; font-size: 13px; line-height: 20px;",
		  "  text-align: left; color: var(--dsh-mem-text-1); cursor: pointer;",
		  "  background: none; border: none; outline: none; border-radius: 10px;",
		  "}",
		  '.dsh-mem-pop-opt:hover, .dsh-mem-pop-opt[data-active="1"] { background: var(--dsh-mem-bg-hover); }',
		  ".dsh-mem-pop-opt-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
		  ".dsh-mem-pop-check { flex: none; font-size: 12px; color: var(--dsh-mem-text-1); }",
		  ".dsh-mem-pop-empty { padding: 10px; font-size: 13px; color: var(--dsh-mem-text-3); }",
		  // ── Tab（下划线式）：active 品牌蓝下划线 + 主文字色 ──
		  ".dsh-mem-tab {",
		  "  padding: 6px 6px; font-size: 13px; cursor: pointer; background: none; border: none; white-space: nowrap;",
		  "  color: var(--dsh-mem-text-2); border-bottom: 2px solid transparent; margin-bottom: -1px;",
		  "}",
		  ".dsh-mem-tab:hover { color: var(--dsh-mem-text-1); }",
		  ".dsh-mem-tab-on { font-weight: 600; color: var(--dsh-mem-text-1); border-bottom-color: var(--dsh-mem-accent); }",
		  ".dsh-mem-tab:focus-visible { outline: 2px solid var(--dsh-mem-accent); outline-offset: -2px; }",
		  // ── 卡片：hover 微抬（边框加深），只给可交互卡片用 ──
		  ".dsh-mem-card {",
		  "  border: 1px solid var(--dsh-mem-border); border-radius: 10px; background: var(--dsh-mem-bg-card);",
		  "  box-shadow: var(--dsh-mem-shadow-card);",
		  "}",
		  ".dsh-mem-card-hover:hover { border-color: var(--dsh-mem-border-strong); }",
		  // ── 场景卡折叠箭头：展开态旋转 90°（进 reduced-motion 压制名单） ──
		  ".dsh-mem-scene-chev { display: inline-block; transition: transform .15s ease; color: var(--dsh-mem-text-3); }",
		  // ── 记忆类型标签：tint 风格（彩底淡色 + 彩字），--dsh-mem-tag-c 由类型类给定 ──
		  ".dsh-mem-tag {",
		  "  display: inline-block; padding: 1px 8px; border-radius: 999px;",
		  "  font-size: 11px; font-weight: 600; line-height: 18px; white-space: nowrap;",
		  "  color: var(--dsh-mem-tag-c, var(--dsh-mem-text-2));",
		  "  background: color-mix(in srgb, var(--dsh-mem-tag-c, #8a93a1) 12%, transparent);",
		  "  border: 1px solid color-mix(in srgb, var(--dsh-mem-tag-c, #8a93a1) 28%, transparent);",
		  "}",
		  ".dsh-mem-tag-persona   { --dsh-mem-tag-c: #6f42c1; }",
		  ".dsh-mem-tag-episodic  { --dsh-mem-tag-c: #0757b4; }",
		  ".dsh-mem-tag-instruction, .dsh-mem-tag-work-artifact { --dsh-mem-tag-c: #8a5a00; }",
		  ".dsh-mem-tag-work-fact { --dsh-mem-tag-c: #0757b4; }",
		  ".dsh-mem-tag-work-task { --dsh-mem-tag-c: #116629; }",
		  ".dsh-mem-tag-work-method { --dsh-mem-tag-c: #6f42c1; }",
		  "body[data-ds-dark-theme] .dsh-mem-tag-persona   { --dsh-mem-tag-c: #c297ff; }",
		  "body[data-ds-dark-theme] .dsh-mem-tag-episodic  { --dsh-mem-tag-c: #6cb2ff; }",
		  "body[data-ds-dark-theme] .dsh-mem-tag-instruction, body[data-ds-dark-theme] .dsh-mem-tag-work-artifact { --dsh-mem-tag-c: #e3b341; }",
		  "body[data-ds-dark-theme] .dsh-mem-tag-work-fact { --dsh-mem-tag-c: #6cb2ff; }",
		  "body[data-ds-dark-theme] .dsh-mem-tag-work-task { --dsh-mem-tag-c: #6fca74; }",
		  "body[data-ds-dark-theme] .dsh-mem-tag-work-method { --dsh-mem-tag-c: #c297ff; }",
		  // ── pill 边缘流光（品牌蓝族，chat/work/auto 三档共用；off 无）：border 区画旋转
		  // conic 光带；内部必须用【不透明】底色盖住光带——半透明内层会让 conic 透进按钮
		  // 内部干扰文字（实测事故）。不透明底 = 主题底混 3% 档位色（--dsh-mem-pill-tint
		  // 由 pill inline 给定；3% 保证档位色文字 AA，暗色智能档余量 4.63:1）
		  ".dsh-mem-flow {",
		  "  border: 1px solid transparent;",
		  "  background:",
		  "    linear-gradient(",
		  "      color-mix(in srgb, var(--dsh-mem-bg-card, #ffffff) 97%, var(--dsh-mem-pill-tint, #4d6bfe)),",
		  "      color-mix(in srgb, var(--dsh-mem-bg-card, #ffffff) 97%, var(--dsh-mem-pill-tint, #4d6bfe))",
		  "    ) padding-box,",
		  "    conic-gradient(from var(--dsh-mem-angle),",
		  "      rgba(61,91,224,0.9), rgba(77,107,254,0.95), rgba(147,168,255,1),",
		  "      rgba(110,133,255,0.9), rgba(61,91,224,0.9)) border-box;",
		  "  animation: dshMemFlow 3s linear infinite;",
		  "}",
		  // ── off 档 pill：dsh 透明按钮——无底无边框只留文字，hover 才出 interactive 淡底
		  //（裸 button 会露 UA 默认灰底+描边，必须显式压掉） ──
		  ".dsh-mem-pill-off { border: none; background: transparent; }",
		  ".dsh-mem-pill-off:hover { background: var(--dsh-mem-bg-hover); }",
		  ".dsh-mem-pill-off:focus-visible { outline: 2px solid var(--dsh-mem-accent); outline-offset: 1px; }",
		  // 流光态焦点环（同一物理按钮的两态焦点反馈对称，配方同 .dsh-mem-btn）
		  ".dsh-mem-flow:focus-visible { outline: 2px solid var(--dsh-mem-accent); outline-offset: 1px; }",
		  // ── 触屏隐形热区（手机端适配）：触点目标补足 44px 标准（iOS HIG）。
		  // 伪元素不参与布局（浮层/输入栏几何零变化），指针事件落在宿主元素上。
		  // 全端统一不做 pointer:coarse 分端（桌面点中目标变大是纯收益）。
		  // pill：视觉高 24px，::after 上下各外扩 10px；只上下不左右——左右是宿主输入栏
		  // 邻位控件（模式选择器），外扩会制造误触重叠带 ──
		  ".dsh-mem-pill-hit::after {",
		  "  content: ''; position: absolute; left: 0; right: 0; top: -10px; bottom: -10px;",
		  "}",
		  // ── 浮层（dsh 原生菜单同配方：不透明实底 + inverted 描边（浅色不可见）+ lv3 阴影） ──
		  ".dsh-mem-popover {",
		  "  border-radius: 12px;",
		  "  border: 1px solid var(--dsh-mem-border-pop);",
		  "  background: linear-gradient(var(--dsh-mem-bg-pop), var(--dsh-mem-bg-pop)) , var(--dsh-mem-bg-pop-base);",
		  "  box-shadow: var(--dsh-mem-shadow-pop);",
		  "  color: var(--dsh-mem-text-1);",
		  "}",
		  // ── 重建面板 ──（模态本体走 NModal：原生 Modal 优先，回退 rb-overlay/rb-modal）
		  ".dsh-mem-rb-card {",
		  "  border: 1px solid var(--dsh-mem-border); border-radius: 10px; background: var(--dsh-mem-bg-card);",
		  "  box-shadow: var(--dsh-mem-shadow-card); padding: 12px 14px; margin-bottom: 14px; font-size: 13px;",
		  // 剪掉行内溢出的固定宽控件（如维度输入框），防其顶破卡片圆角边界
		  "  overflow: hidden;",
		  "}",
		  ".dsh-mem-rb-bar { height: 8px; border-radius: 4px; overflow: hidden; flex: 1; background: var(--dsh-mem-track); }",
		  ".dsh-mem-rb-fill { height: 100%; border-radius: 4px; background: var(--dsh-mem-accent-fill); transition: width .4s ease; }",
		  // 无位移阶段(单次 LLM 调用可达分钟级)的呼吸进度条:宽度满格,透明度呼吸表达"在跑"
		  "@keyframes dshMemRbBreath { 0%,100% { opacity: 1; } 50% { opacity: .35; } }",
		  ".dsh-mem-rb-fill-indet { animation: dshMemRbBreath 1.6s ease-in-out infinite; transition: none; }",
		  ".dsh-mem-rb-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.35);",
		  "  display: flex; align-items: center; justify-content: center; z-index: 2000; }",
		  ".dsh-mem-rb-modal { width: 440px; max-width: calc(100vw - 48px); border-radius: 12px;",
		  "  padding: 18px 20px; font-size: 13px; line-height: 1.6;",
		  "  border: 1px solid var(--dsh-mem-border); background: var(--dsh-mem-bg-card); color: var(--dsh-mem-text-1);",
		  "  box-shadow: 0 16px 48px rgba(0,0,0,0.24); }",
		  "body[data-ds-dark-theme] .dsh-mem-rb-modal { box-shadow: 0 16px 48px rgba(0,0,0,0.6); }",
		  ".dsh-mem-rb-muted { font-size: 12px; color: var(--dsh-mem-text-3); }",
		  // ── 会话信息区（悬浮卡下半部）：分隔线 + 2×2 指标 + 状态行；纯静态 DOM，
		  // 不挂 rAF 循环，轮询数据到达才触发本组件小树 re-render ──
		  ".dsh-mem-sinfo { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--dsh-mem-border); }",
		  ".dsh-mem-sinfo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 10px; }",
		  ".dsh-mem-sinfo-val { font-size: 13px; font-weight: 600; color: var(--dsh-mem-text-1); line-height: 18px; font-variant-numeric: tabular-nums; }",
		  ".dsh-mem-sinfo-label { font-size: 11px; color: var(--dsh-mem-text-3); line-height: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
		  ".dsh-mem-sinfo-warn { font-size: 11px; color: var(--dsh-mem-danger); line-height: 16px; margin-bottom: 6px; }",
		  ".dsh-mem-sinfo-note { font-size: 11px; color: var(--dsh-mem-text-3); line-height: 16px; margin-top: 8px; }",
		  ".dsh-mem-sinfo-sum { font-size: 11px; color: var(--dsh-mem-text-3); line-height: 16px; margin-top: 8px; }",
		  // reduced-motion 兜底放样式表末尾：同特异性下后置声明才能压过上面的组件类
		  "@media (prefers-reduced-motion: reduce) {",
		  "  .dsh-mem-root, .dsh-mem-root *, .dsh-mem-btn, .dsh-mem-input, .dsh-mem-select, .dsh-mem-rb-fill, .dsh-mem-scene-chev, .dsh-mem-sel-chev { transition: none; }",
		  "  .dsh-mem-flow { animation: none; }",
		  "}"
		];
		function buildStyleSheet() {
		  return [
		    // auto/跟随宿主的兜底：浅色在 :root，暗色在 body[data-ds-dark-theme]
		    ":root {",
		    ...LIGHT_TOK,
		    "}",
		    "body[data-ds-dark-theme] {",
		    ...DARK_TOK,
		    "}",
		    // 皮肤显式覆写：html[data-dsh-mem-skin] 由 skin.ts 始终写成具体 light|dark。
		    // 与宿主暗色块同特异度（元素+属性），但后置声明胜出，从而能压过宿主强切明暗。
		    'html[data-dsh-mem-skin="light"] {',
		    ...LIGHT_TOK,
		    "}",
		    'html[data-dsh-mem-skin="dark"] {',
		    ...DARK_TOK,
		    "}",
		    ...COMPONENT_CSS
		  ].join("\n");
		}
		function ensureThemeStyle(skin) {
		  const eff = effectiveSkin(skin ?? getSkin());
		  if (!document.getElementById(THEME_STYLE_ID)) {
		    const el = document.createElement("style");
		    el.id = THEME_STYLE_ID;
		    el.textContent = buildStyleSheet();
		    document.head.appendChild(el);
		  }
		  document.documentElement.setAttribute("data-dsh-mem-skin", eff);
		}
		
		// client/src/tabs/ConflictsTab.tsx
		var import_react2 = require("react");
		
		// client/src/format.ts
		var TYPE_LABELS = {
		  persona: "画像偏好",
		  episodic: "客观事件",
		  instruction: "全局指令",
		  work_fact: "工作事实",
		  work_task: "工作任务",
		  work_method: "工作方法",
		  work_artifact: "工作资产"
		};
		function fmtTime(iso) {
		  if (!iso) return "-";
		  try {
		    return new Date(iso).toLocaleString();
		  } catch {
		    return String(iso);
		  }
		}
		function fmtAgo(iso) {
		  if (!iso) return null;
		  try {
		    const t = new Date(iso).getTime();
		    if (!t) return null;
		    let s = Math.floor((Date.now() - t) / 1e3);
		    if (s < 0) s = 0;
		    if (s < 45) return "刚刚";
		    if (s < 3600) return Math.floor(s / 60) + " 分钟前";
		    if (s < 86400) return Math.floor(s / 3600) + " 小时前";
		    return Math.floor(s / 86400) + " 天前";
		  } catch {
		    return null;
		  }
		}
		function fmtMB(bytes) {
		  if (!bytes || bytes <= 0) return "0MB";
		  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + "KB";
		  return (bytes / (1024 * 1024)).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0) + "MB";
		}
		
		// client/src/ui/primitives.tsx
		var import_react = require("react");
		
		// client/src/env.ts
		function hostRequire(id) {
		  return require(id);
		}
		
		// client/src/ui/primitives.tsx
		var P = null;
		try {
		  P = hostRequire("@deepseek-ai/dsh-client-ui-primitives");
		} catch {
		  P = null;
		}
		function NButton(props) {
		  if (P && P.Button) return (0, import_react.createElement)(P.Button, { size: "sm", ...props });
		  const rest = { ...props };
		  delete rest.variant;
		  delete rest.icon;
		  rest.className = "dsh-mem-btn" + (rest.className ? " " + rest.className : "");
		  return (0, import_react.createElement)("button", rest);
		}
		function NInput(props) {
		  if (P && P.Input) {
		    const inner = { ...props };
		    const layoutStyle = inner.style;
		    delete inner.style;
		    return (0, import_react.createElement)("span", { style: layoutStyle }, (0, import_react.createElement)(P.Input, inner));
		  }
		  const rest = { ...props };
		  rest.className = "dsh-mem-input" + (rest.className ? " " + rest.className : "");
		  return (0, import_react.createElement)("input", rest);
		}
		function NModal(props) {
		  if (props.open === false) return null;
		  if (P && P.Modal) return (0, import_react.createElement)(P.Modal, { closeLabel: "关闭", ...props });
		  return (0, import_react.createElement)(
		    "div",
		    {
		      className: "dsh-mem-rb-overlay",
		      onClick: (e) => {
		        if (e.target === e.currentTarget && props.onClose) props.onClose();
		      }
		    },
		    (0, import_react.createElement)(
		      "div",
		      { className: "dsh-mem-rb-modal" },
		      props.title ? (0, import_react.createElement)("div", { style: { fontSize: 15, fontWeight: 600, marginBottom: 10 } }, props.title) : null,
		      props.children,
		      props.footer ? (0, import_react.createElement)(
		        "div",
		        { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 } },
		        props.footer
		      ) : null
		    )
		  );
		}
		
		// client/src/tabs/conflicts-view.ts
		var CONFLICT_TYPE_SECTIONS = [
		  {
		    type: "hard",
		    label: "硬冲突（占额度）",
		    hint: "事实层面直接互斥——两边不可能同时为真，必须由人给出结论。"
		  },
		  {
		    type: "conditional",
		    label: "条件冲突（不占额度）",
		    hint: "各自前提不同才显得矛盾（环境/配置/工作区）；先确认前提是否还成立。"
		  },
		  {
		    type: "supersession",
		    label: "新旧取代（不占额度）",
		    hint: "线索指向新的更可信、旧的应让位——但机器不自动裁决，仍由人确认。"
		  }
		];
		function conflictTypeOf(p) {
		  const t = p.conflict_type;
		  return t === "conditional" || t === "supersession" ? t : "hard";
		}
		function groupConflictsByType(items) {
		  const buckets = /* @__PURE__ */ new Map();
		  for (const sec of CONFLICT_TYPE_SECTIONS) {
		    buckets.set(sec.type, []);
		  }
		  for (const p of items) {
		    const type = conflictTypeOf(p);
		    const arr = buckets.get(type);
		    if (arr) arr.push(p);
		  }
		  const result = [];
		  for (const sec of CONFLICT_TYPE_SECTIONS) {
		    const arr = buckets.get(sec.type);
		    if (arr && arr.length > 0) {
		      result.push({ type: sec.type, label: sec.label, hint: sec.hint, items: arr });
		    }
		  }
		  return result;
		}
		function reviewLabel(p) {
		  if ((p.review_state ?? "unseen") === "unseen") return "";
		  return `已复看 ${String(p.defer_count ?? 0)} 次`;
		}
		function isDeferred(p) {
		  return (p.review_state ?? "unseen") === "deferred";
		}
		var D = (ms) => ms == null ? "" : new Date(ms).toISOString().slice(0, 10);
		function axisText(p, side) {
		  const vf = side === "winner" ? p.winner_valid_from_ms : p.loser_valid_from_ms;
		  const vt = side === "winner" ? p.winner_valid_to_ms : p.loser_valid_to_ms;
		  const ps = side === "winner" ? p.winner_persistence : p.loser_persistence;
		  const parts = [];
		  const vfS = D(vf);
		  const vtS = D(vt);
		  if (vfS) parts.push(`有效期起 ${vfS}`);
		  if (vtS) parts.push(`有效期止 ${vtS}`);
		  if (ps) parts.push(`持续性 ${ps}`);
		  return parts.join(" / ");
		}
		function claimLabel(p) {
		  const k = p.claim_key;
		  return k ? `claim ${k}` : "";
		}
		
		// client/src/tabs/ConflictsTab.tsx
		var import_jsx_runtime = require("react/jsx-runtime");
		var POLL_MS = 1e4;
		var GONE = "（该记录正文不可得：已不在主表，或被更早的清理清掉了）";
		function ConflictsTab(props) {
		  const rpc = props.rpc;
		  const [view, setView] = (0, import_react2.useState)(null);
		  const [error, setError] = (0, import_react2.useState)(null);
		  const [note, setNote] = (0, import_react2.useState)(null);
		  const [busy, setBusy] = (0, import_react2.useState)(null);
		  const load = (0, import_react2.useCallback)(() => {
		    rpc("dsh-memory/conflicts", {}).then((r) => {
		      if (r && r.ok) {
		        setView(r.value);
		        setError(null);
		      } else setError(r && r.error ? r.error.message : "RPC error");
		    }).catch((e) => {
		      setError(String(e && e.message || e));
		    });
		  }, [rpc]);
		  (0, import_react2.useEffect)(() => {
		    load();
		    const timer = setInterval(load, POLL_MS);
		    return () => {
		      clearInterval(timer);
		    };
		  }, [load]);
		  const resolve = (pair, outcome) => {
		    if (outcome !== "defer") {
		      const doomed = outcome === "winner" ? pair.loser_content || GONE : outcome === "loser" ? pair.winner_content || GONE : null;
		      if (doomed !== null) {
		        const ok = window.confirm(
		          `裁决这一对？
		
		将要退场的记忆：
		「${doomed}」
		
		它会移出检索面（不再被召回），但记录仍保留 —— 可在「记忆」页的「已退场」区恢复。裁决结论本身不可覆盖。`
		        );
		        if (!ok) return;
		      }
		    }
		    setBusy(pair.pair_id);
		    setNote(null);
		    rpc("dsh-memory/conflict-resolve", { pairId: pair.pair_id, outcome }).then((r) => {
		      if (r && r.ok) {
		        const v = r.value;
		        setNote(v.notice ?? `已裁决 ${v.pair_id}：${v.outcome}${v.removed_record_id ? "，退场 " + v.removed_record_id : "，未移除记录"}`);
		        load();
		      } else {
		        setError(r && r.error ? r.error.message : "裁决失败");
		      }
		    }).catch((e) => {
		      setError(String(e && e.message || e));
		    }).finally(() => {
		      setBusy(null);
		    });
		  };
		  const items = view?.items ?? [];
		  const sections = groupConflictsByType(items);
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...S.flexRow, marginBottom: 10 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: S.muted, children: view === null ? "加载中…" : view.enabled ? `待裁决 ${view.total} 对` : "矛盾冻结未开启" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: S.grow }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NButton, { onClick: load, children: "刷新" })
		    ] }),
		    error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: S.error, children: error }) : null,
		    note ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: S.hint, children: note }) : null,
		    view !== null && !view.enabled ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: S.intro, children: [
		      view.notice ?? "矛盾冻结未开启。",
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
		      "矛盾冻结是**opt-in**：它把裁决权交还给人，代价是冲突会一直停着等你处理。 确认要接手这些裁决，再去「概览」打开它 —— 打开后已停放的队列会立刻显示在这里。"
		    ] }) : null,
		    view !== null && view.enabled && items.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: S.intro, children: "没有待裁决的冲突对。新记忆入库时若与旧记忆矛盾且冻结已开启，那一对会停到这里。" }) : null,
		    sections.map((sec) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginBottom: 12 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: S.cardHead, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...S.muted, fontWeight: 600 }, children: sec.label }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: S.muted, children: [
		          sec.items.length,
		          " 条"
		        ] })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...S.muted, fontSize: 11, marginBottom: 6 }, children: sec.hint }),
		      sec.items.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ConflictCard, { pair: p, busy: busy === p.pair_id, onResolve: resolve }, p.pair_id))
		    ] }, sec.type))
		  ] });
		}
		function ConflictCard(props) {
		  const p = props.pair;
		  const rl = reviewLabel(p);
		  const cl = claimLabel(p);
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-mem-card", style: S.card, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: S.cardHead, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: S.muted, children: "pair " + p.pair_id.slice(0, 12) }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: S.muted, children: fmtTime(p.created_at) }),
		      rl ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...S.muted, color: isDeferred(p) ? "var(--dsh-mem-accent-fill)" : void 0 }, children: rl }) : null,
		      cl ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: S.muted, children: cl }) : null,
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: S.grow }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: S.muted, title: "产生该冻结的蒸馏批次 id（可用 memory_receipts 追这一轮判了什么）", children: "run " + p.run_id.slice(0, 12) })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		      Side,
		      {
		        label: "LLM 建议：胜方",
		        accent: true,
		        id: p.winner_id,
		        content: p.winner_content,
		        pair: p,
		        side: "winner"
		      }
		    ),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Side, { label: "LLM 建议：败方", id: p.loser_id, content: p.loser_content, pair: p, side: "loser" }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...S.flexRow, marginTop: 8 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		        NButton,
		        {
		          disabled: props.busy,
		          title: "判 LLM 建议的胜方为真；败方从检索库退场",
		          onClick: () => {
		            props.onResolve(p, "winner");
		          },
		          children: props.busy ? "裁决中…" : "判胜方为真"
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		        NButton,
		        {
		          disabled: props.busy,
		          title: "判败方为真；胜方从检索库退场",
		          onClick: () => {
		            props.onResolve(p, "loser");
		          },
		          children: "判败方为真"
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		        NButton,
		        {
		          disabled: props.busy,
		          title: "判两者其实是各自独立的事实（LLM 判错了）；两条都保留，不删除",
		          onClick: () => {
		            props.onResolve(p, "both");
		          },
		          children: "两者都保留"
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		        NButton,
		        {
		          disabled: props.busy,
		          title: "看过但暂不裁决——该对仍在队列里，重置超时并累计复看次数",
		          onClick: () => {
		            props.onResolve(p, "defer");
		          },
		          children: "看过，暂不裁决"
		        }
		      )
		    ] })
		  ] });
		}
		function Side(props) {
		  const axis = props.pair && props.side ? axisText(props.pair, props.side) : "";
		  const mt = props.pair && props.side ? props.side === "winner" ? props.pair.winner_maturity : props.pair.loser_maturity : void 0;
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginTop: 6 }, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...S.muted, fontWeight: props.accent ? 600 : void 0 }, children: props.label }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: S.content, children: props.content || GONE }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...S.muted, fontFamily: "ui-monospace, Consolas, monospace" }, children: props.id }),
		    axis ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...S.muted, marginTop: 2, fontSize: 11 }, children: axis }) : null,
		    mt ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...S.muted, marginTop: 2, fontSize: 11 }, children: "成熟度 · " + (mt === "high" ? "高" : mt === "mid" ? "中" : "低") }) : null
		  ] });
		}
		
		// client/src/tabs/ConnectTab.tsx
		var import_react3 = require("react");
		var import_jsx_runtime2 = require("react/jsx-runtime");
		function errMsg(r) {
		  return r && r.error && r.error.message ? r.error.message : "RPC 错误";
		}
		function SourceCard(props) {
		  const { src, rpc, onChanged, onErr } = props;
		  const retire = (active) => {
		    rpc("dsh-memory/memory-sources-retire", { id: src.id, active }).then((r) => {
		      if (r && r.ok) onChanged();
		      else onErr(errMsg(r));
		    }).catch((e) => onErr(String(e?.message || e)));
		  };
		  const retired = src.status === "retired";
		  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-mem-card", style: S.card, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.cardHead, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: src.label || src.id }),
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.muted, children: "· " + src.kind + (retired ? " · 已退役" : src.disabled ? " · 已停用" : "") }),
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.grow }),
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(NButton, { onClick: () => retire(!retired), children: retired ? "恢复" : "退役" })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { ...S.detail }, children: src.path }),
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { ...S.muted, marginTop: 4 }, children: "上次扫描 " + (src.lastScanAt || "—") + " · 上次导入 " + (src.lastImportAt || "—") })
		  ] });
		}
		function ConnectTab(props) {
		  const rpc = props.rpc;
		  const [data, setData] = (0, import_react3.useState)(null);
		  const [scan, setScan] = (0, import_react3.useState)(null);
		  const [error, setError] = (0, import_react3.useState)(null);
		  const [busy, setBusy] = (0, import_react3.useState)(false);
		  const [form, setForm] = (0, import_react3.useState)({ id: "", kind: "file", path: "", label: "" });
		  const load = (0, import_react3.useCallback)(() => {
		    rpc("dsh-memory/memory-sources-list", {}).then((r) => {
		      if (r && r.ok) {
		        setData(r.value);
		        setError(null);
		      } else setError(errMsg(r));
		    }).catch((e) => setError(String(e?.message || e)));
		  }, [rpc]);
		  (0, import_react3.useEffect)(() => {
		    load();
		  }, [load]);
		  const add = () => {
		    if (!form.id.trim() || !form.path.trim()) {
		      setError("登记来源需要 id 与绝对路径 path");
		      return;
		    }
		    rpc("dsh-memory/memory-sources-add", { id: form.id.trim(), kind: form.kind, path: form.path.trim(), label: form.label.trim() || void 0 }).then((r) => {
		      if (r && r.ok) {
		        setError(null);
		        setForm({ ...form, id: "", path: "", label: "" });
		        load();
		      } else setError(errMsg(r));
		    }).catch((e) => setError(String(e?.message || e)));
		  };
		  const runScan = () => {
		    setBusy(true);
		    rpc("dsh-memory/memport-scan", {}).then((r) => {
		      if (r && r.ok) {
		        setScan(r.value);
		        setError(null);
		        load();
		      } else setError(errMsg(r));
		    }).catch((e) => setError(String(e?.message || e))).finally(() => setBusy(false));
		  };
		  const input = (key, placeholder) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		    "input",
		    {
		      className: "dsh-mem-input",
		      style: { flex: key === "path" ? 2 : 1, minWidth: 120 },
		      value: form[key],
		      placeholder,
		      onChange: (e) => setForm({ ...form, [key]: e.target.value })
		    }
		  );
		  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { style: S.intro, children: [
		      "登记外部 AI 工具的记忆来源（仅存路径指针，正文不复制入库）。扫描为只读预览；实际导入由「memport 导入」经 memory_import 完成。整面需在设置开启",
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: " memport.enabled" }),
		      "。"
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.toolbar, children: [
		      input("id", "来源 id(小写-连字符)"),
		      input("kind", "kind: claude/codex/workbuddy/file…"),
		      input("path", "绝对路径(目录或 .mem)"),
		      input("label", "显示名(可选)"),
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(NButton, { onClick: add, children: "登记来源" })
		    ] }),
		    !data?.memoryMutate ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.hint, children: "提示：登记/退役需先在面板开启「高权限模式」。" }) : null,
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { ...S.flexRow, margin: "8px 0 12px" }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.muted, children: data ? data.sources.length ? data.sources.length + " 个来源" : "暂无来源" : "加载中…" }),
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.grow }),
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(NButton, { onClick: runScan, disabled: busy, children: busy ? "扫描中…" : "扫描全部来源" }),
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(NButton, { onClick: load, children: "刷新" })
		    ] }),
		    error ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.error, children: error }) : null,
		    (data?.sources || []).map((src) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(SourceCard, { rpc, src, onChanged: load, onErr: setError }, src.id)),
		    scan ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { marginTop: 12 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.heading, children: [
		        "扫描预览",
		        scan.notice ? `（${scan.notice}）` : ""
		      ] }),
		      scan.sources.map((s) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-mem-card", style: S.card, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.cardHead, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: s.label || s.sourceId }),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.muted, children: "：新 " + s.counts.new + " · 近重复 " + s.counts["near-dup"] + " · 疑似冲突 " + s.counts["conflict-candidate"] + " · 重复 " + s.counts.dup }),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.grow }),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.muted, children: s.files + " 包 · " + s.total + " 条" })
		        ] }),
		        s.errors.length ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { ...S.error, whiteSpace: "pre-wrap" }, children: s.errors.join("\n") }) : null,
		        s.sampleNew.length ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { ...S.detail }, children: s.sampleNew.map((n) => `[${n.type}] ${n.content}`).join("\n") }) : s.counts.new > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.muted, children: "有新记录（样本省略）。" }) : null
		      ] }, s.sourceId)),
		      scan.enabled && scan.sources.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.muted, children: "无启用来源，或来源下未发现 .mem。" }) : null
		    ] }) : null
		  ] });
		}
		
		// client/src/tabs/SkillsTab.tsx
		var import_react4 = require("react");
		var import_jsx_runtime3 = require("react/jsx-runtime");
		function errMsg2(r) {
		  return r && r.error && r.error.message ? r.error.message : "RPC 错误";
		}
		var TITLES = { candidate: "候选", active: "活跃", archived: "已归档" };
		function SkillsTab(props) {
		  const rpc = props.rpc;
		  const [data, setData] = (0, import_react4.useState)(null);
		  const [error, setError] = (0, import_react4.useState)(null);
		  const [busy, setBusy] = (0, import_react4.useState)(false);
		  const load = (0, import_react4.useCallback)(() => {
		    rpc("dsh-memory/skills-list", {}).then((r) => {
		      if (r && r.ok) {
		        setData(r.value);
		        setError(null);
		      } else setError(errMsg2(r));
		    }).catch((e) => setError(String(e?.message || e)));
		  }, [rpc]);
		  (0, import_react4.useEffect)(() => {
		    load();
		  }, [load]);
		  const act = (id, action, tier) => {
		    if (busy) return;
		    setBusy(true);
		    rpc("dsh-memory/skills-action", { id, action, tier }).then((r) => {
		      if (r && r.ok) {
		        setError(r.value.changed ? null : r.value.notice || null);
		        load();
		      } else setError(errMsg2(r));
		    }).catch((e) => setError(String(e?.message || e))).finally(() => setBusy(false));
		  };
		  if (data && !data.enabled) {
		    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: S.intro, children: "技能结晶（程序性记忆）未启用。到「概览」页开启「技能」开关（或部署配置 skills.enabled），重复工作流会固化为技能候选，在此审阅晋升。" });
		  }
		  const mutateHint = data && !data.memoryMutate ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: S.hint, children: "提示：晋升/归档/固定需在面板开启「高权限模式」。" }) : null;
		  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
		    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { ...S.flexRow, marginBottom: 10 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: S.muted, children: data ? `${data.skills.length} 个技能 · 自动晋升${data.allowPromote ? "开" : "关(人工审阅)"} · 需证据会话达阈` : "加载中…" }),
		      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: S.grow }),
		      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(NButton, { onClick: load, children: "刷新" })
		    ] }),
		    mutateHint,
		    error ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: S.error, children: error }) : null,
		    data && data.skills.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: S.intro, children: '暂无技能。技能从重复出现的"工作方法"记忆结晶而来。' }) : null,
		    (data?.skills || []).map((s) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-mem-card", style: S.card, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: S.cardHead, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: s.title }),
		        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-mem-tag", style: { marginLeft: 6 }, children: TITLES[s.status] }),
		        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: S.muted, children: ` · 档:${s.tier}${s.pinned ? " · 已固定" : ""} · 覆盖 ${s.sessionCount} 会话` }),
		        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: S.grow })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }, children: [
		        s.status === "candidate" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(NButton, { onClick: () => act(s.id, "promote"), disabled: busy, children: "晋升" }) : null,
		        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
		          "select",
		          {
		            className: "dsh-mem-select",
		            style: { width: "auto", padding: "5px 10px" },
		            value: s.tier,
		            onChange: (e) => act(s.id, "set-tier", e.target.value),
		            children: [
		              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "full", children: "全文档" }),
		              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "excerpt", children: "摘录档" }),
		              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "hint", children: "提示档" })
		            ]
		          }
		        ),
		        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(NButton, { onClick: () => act(s.id, s.pinned ? "unpin" : "pin"), disabled: busy, children: s.pinned ? "取消固定" : "固定" }),
		        s.status !== "archived" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(NButton, { onClick: () => act(s.id, "archive"), disabled: busy, children: "归档" }) : null
		      ] })
		    ] }, s.id))
		  ] });
		}
		
		// client/src/tabs/CostTab.tsx
		var import_react5 = require("react");
		
		// client/src/ui/controls.tsx
		var import_jsx_runtime4 = require("react/jsx-runtime");
		function Switch(props) {
		  const on = !!props.checked;
		  const disabled = !!props.disabled;
		  const base = { ...S.switch, ...on ? S.switchOn : S.switchOff, ...disabled ? S.switchDisabled : null };
		  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
		    "div",
		    {
		      style: base,
		      onClick: () => {
		        if (!disabled && props.onChange) props.onChange(!on);
		      },
		      children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { ...S.knob, left: on ? 18 : 2 } })
		    }
		  );
		}
		function SwitchRow(props) {
		  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: S.switchRow, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Switch, { checked: props.checked, disabled: props.disabled, onChange: props.onChange }),
		    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: S.switchLabel, children: props.label }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: S.switchDesc, children: props.desc || "" })
		    ] })
		  ] });
		}
		function ActionButton(props) {
		  const disabled = !!props.disabled;
		  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
		    "button",
		    {
		      type: "button",
		      title: props.disabled ? "" : props.title || "",
		      "aria-disabled": disabled,
		      onClick: () => {
		        if (!disabled && props.onClick) props.onClick();
		      },
		      style: {
		        ...S.seg,
		        ...S.segBtn,
		        fontFamily: "inherit",
		        border: "1px solid var(--dsh-mem-border)",
		        cursor: disabled ? "not-allowed" : "pointer",
		        ...disabled ? S.switchDisabled : null
		      },
		      children: props.label
		    }
		  );
		}
		function Segmented(props) {
		  const value = props.value;
		  const disabled = !!props.disabled;
		  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { ...S.seg, ...disabled ? S.switchDisabled : null }, children: props.options.map((opt, i) => {
		    const on = opt.key === value;
		    const optDisabled = disabled || !!opt.disabled;
		    return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
		      "span",
		      {
		        title: opt.disabledTitle || opt.title || "",
		        style: {
		          ...S.segBtn,
		          ...on ? S.segBtnOn : null,
		          ...i === props.options.length - 1 ? { borderRight: "none" } : null,
		          ...optDisabled ? { cursor: "not-allowed", opacity: 0.45 } : null
		        },
		        onClick: () => {
		          if (!optDisabled && !on && props.onChange) props.onChange(opt.key);
		        },
		        children: opt.label
		      },
		      opt.key
		    );
		  }) });
		}
		
		// client/src/tabs/CostTab.tsx
		var import_jsx_runtime5 = require("react/jsx-runtime");
		function renderCostChart(buckets, models, maxY, fmtDate, fmtInt, palette) {
		  const W = 600;
		  const H = 200;
		  const L = 46;
		  const R2 = 10;
		  const T = 10;
		  const B = 26;
		  const iw = W - L - R2;
		  const ih = H - T - B;
		  const n = buckets.length;
		  const x = (i) => L + (n <= 1 ? iw / 2 : i / (n - 1) * iw);
		  const y = (v) => T + ih - v / maxY * ih;
		  const yTicks = [0, maxY / 2, maxY];
		  const xIdx = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : n === 2 ? [0, 1] : [0];
		  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("svg", { viewBox: "0 0 " + W + " " + H, style: { width: "100%", height: "auto", display: "block" }, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("line", { x1: L, y1: y(0), x2: W - R2, y2: y(0), stroke: "var(--dsh-mem-border)", strokeWidth: 1 }),
		    yTicks.map((v) => {
		      return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("text", { x: L - 6, y: y(v) + 4, textAnchor: "end", fontSize: 10, fill: "var(--dsh-mem-text-3)", children: fmtInt(v) }, "yt" + v);
		    }),
		    xIdx.map((i) => {
		      return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("text", { x: x(i), y: H - 8, textAnchor: "middle", fontSize: 10, fill: "var(--dsh-mem-text-3)", children: fmtDate(buckets[i] ? buckets[i].ts : 0) }, "xt" + i);
		    }),
		    models.map((m, mi) => {
		      const pts = buckets.map((b, i) => x(i) + "," + y(b.byModel[m] || 0)).join(" ");
		      return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
		        "polyline",
		        {
		          points: pts,
		          fill: "none",
		          stroke: palette[mi % palette.length],
		          strokeWidth: 2,
		          strokeLinejoin: "round",
		          strokeLinecap: "round"
		        },
		        "pl" + m
		      );
		    })
		  ] });
		}
		var RANGE_LABELS = { day: "今日", week: "本周", month: "本月", all: "累计" };
		var LAYER_OPTS = [
		  { key: "", label: "全部" },
		  { key: "l1", label: "L1" },
		  { key: "l2", label: "L2" },
		  { key: "l3", label: "L3" }
		];
		var GRAN_OPTS = [
		  { key: "day", label: "日" },
		  { key: "week", label: "周" },
		  { key: "month", label: "月" }
		];
		var PALETTE = [
		  "var(--dsh-mem-chart-1)",
		  "var(--dsh-mem-chart-2)",
		  "var(--dsh-mem-chart-3)",
		  "var(--dsh-mem-chart-4)",
		  "var(--dsh-mem-chart-5)",
		  "var(--dsh-mem-chart-6)",
		  "var(--dsh-mem-chart-7)",
		  "var(--dsh-mem-chart-8)"
		];
		var RANGES = ["day", "week", "month", "all"];
		var thFirst = { fontSize: 12, fontWeight: 600, color: "var(--dsh-mem-text-3)", textAlign: "left", padding: "4px 10px", borderBottom: "1px solid var(--dsh-mem-border)" };
		var thStyle = { fontSize: 12, fontWeight: 600, color: "var(--dsh-mem-text-3)", textAlign: "right", padding: "4px 10px", borderBottom: "1px solid var(--dsh-mem-border)" };
		var tdFirst = { fontSize: 12.5, fontWeight: 600, color: "var(--dsh-mem-text-1)", textAlign: "left", padding: "4px 10px" };
		var tdStyle = { fontSize: 12.5, color: "var(--dsh-mem-text-1)", textAlign: "right", padding: "4px 10px", fontFamily: "ui-monospace, Consolas, monospace" };
		function CostTab(props) {
		  const rpc = props.rpc;
		  const [data, setData] = (0, import_react5.useState)(null);
		  const [error, setError] = (0, import_react5.useState)(null);
		  const [granularity, setGranularity] = (0, import_react5.useState)("day");
		  const [layer, setLayer] = (0, import_react5.useState)("");
		  const [rangeDays, setRangeDays] = (0, import_react5.useState)(0);
		  const [rangeOpen, setRangeOpen] = (0, import_react5.useState)(false);
		  const load = (0, import_react5.useCallback)(() => {
		    setError(null);
		    rpc("dsh-memory/token-cost", {
		      granularity,
		      rangeDays
		    }).then((r) => {
		      if (r && r.ok) setData(r.value);
		      else setError(r && r.error ? r.error.message : "RPC error");
		    }).catch((e) => {
		      setError(String(e && e.message || e));
		    });
		  }, [rpc, granularity, rangeDays]);
		  (0, import_react5.useEffect)(() => {
		    load();
		    const timer = setInterval(load, 5e3);
		    return () => {
		      clearInterval(timer);
		    };
		  }, [load]);
		  const fmtInt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
		  const fmtModel = (p, m) => p ? p + "/" + m : m;
		  const fmtDate = (ts) => {
		    try {
		      const d = new Date(ts);
		      const g = data && data.trend ? data.trend.granularity : granularity;
		      if (g === "month") return d.getMonth() + 1 + "月";
		      return d.getMonth() + 1 + "/" + d.getDate();
		    } catch {
		      return "";
		    }
		  };
		  const windows = data && data.windows || [];
		  const byModel = data && data.byModel || [];
		  const byLayer = data && data.byLayer || [];
		  const trend = data && data.trend ? data.trend : null;
		  let buckets = [];
		  if (trend && trend.byLayer) {
		    if (layer === "l1" || layer === "l2" || layer === "l3") {
		      buckets = trend.byLayer[layer] || [];
		    } else {
		      const seqs = [trend.byLayer.l1 || [], trend.byLayer.l2 || [], trend.byLayer.l3 || []];
		      const n = seqs[0].length;
		      for (let i = 0; i < n; i++) {
		        const merged = { ts: 0, total: 0, byModel: {} };
		        for (let s = 0; s < seqs.length; s++) {
		          const seq = seqs[s];
		          if (seq && seq[i]) {
		            if (merged.ts === 0) merged.ts = seq[i].ts;
		            merged.total += seq[i].total;
		            Object.keys(seq[i].byModel).forEach((m) => {
		              merged.byModel[m] = (merged.byModel[m] || 0) + seq[i].byModel[m];
		            });
		          }
		        }
		        buckets.push(merged);
		      }
		    }
		  }
		  const models = [];
		  const seen = {};
		  buckets.forEach((b) => {
		    Object.keys(b.byModel).forEach((m) => {
		      if (!seen[m]) {
		        seen[m] = true;
		        models.push(m);
		      }
		    });
		  });
		  models.sort();
		  let maxY = 1;
		  buckets.forEach((b) => {
		    if (b.total > maxY) maxY = b.total;
		    models.forEach((m) => {
		      if ((b.byModel[m] || 0) > maxY) maxY = b.byModel[m];
		    });
		  });
		  const layerTable = byLayer.map((lc) => {
		    const win = {};
		    lc.windows.forEach((w) => {
		      win[w.range] = w;
		    });
		    return { layer: lc.layer, win };
		  });
		  const cell = (lc, r, pick) => {
		    const w = lc.win[r];
		    return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("td", { style: tdStyle, children: w ? fmtInt(pick(w)) : "0" }, r);
		  };
		  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { children: [
		    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { ...S.flexRow, marginBottom: 10 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Segmented, { value: layer, options: LAYER_OPTS, onChange: setLayer }),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Segmented, { value: granularity, options: GRAN_OPTS, onChange: setGranularity }),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
		        NButton,
		        {
		          onClick: () => {
		            setRangeOpen(!rangeOpen);
		          },
		          children: rangeDays > 0 ? "近 " + rangeDays + " 天" : "近N天"
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: S.grow }),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(NButton, { onClick: load, children: "刷新" })
		    ] }),
		    rangeOpen ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { ...S.flexRow, marginBottom: 10 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: S.muted, children: "展示近 N 天（正整数，清空=默认窗口；超出保留期后端自动回退）" }),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
		        NInput,
		        {
		          value: rangeDays === 0 ? "" : String(rangeDays),
		          placeholder: "如 30",
		          style: { width: 90 },
		          onChange: (e) => {
		            const v = String(e.target.value || "").trim();
		            if (v === "") {
		              setRangeDays(0);
		              return;
		            }
		            const n = Number(v);
		            if (Number.isInteger(n) && n > 0 && n <= 3650) setRangeDays(n);
		          }
		        }
		      )
		    ] }) : null,
		    error ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: S.error, children: "成本读取失败：" + error }) : null,
		    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: S.panelLabel, children: "成本趋势（按模型）" }),
		    buckets.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { children: [
		      renderCostChart(buckets, models, maxY, fmtDate, fmtInt, PALETTE),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px 12px", margin: "6px 0 14px" }, children: models.map((m, mi) => {
		        return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
		          "span",
		          {
		            style: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--dsh-mem-text-2)" },
		            children: [
		              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: { width: 10, height: 10, borderRadius: 4, background: PALETTE[mi % PALETTE.length], display: "inline-block" } }),
		              m
		            ]
		          },
		          "lg" + m
		        );
		      }) })
		    ] }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { style: S.muted, children: data ? "暂无成本数据（触发一次蒸馏后这里会出现趋势）。" : "加载中…" }),
		    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: S.panelLabel, children: "层级成本（输出 token）" }),
		    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("table", { style: { width: "100%", borderCollapse: "collapse", marginBottom: 14 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("tr", { children: [
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("th", { style: thFirst, children: "层级" }),
		        RANGES.map((r) => {
		          return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("th", { style: thStyle, children: RANGE_LABELS[r] }, r);
		        })
		      ] }) }),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("tbody", { children: layerTable.map((lc) => {
		        return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("tr", { children: [
		          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("td", { style: tdFirst, children: lc.layer.toUpperCase() }),
		          RANGES.map((r) => cell(lc, r, (w) => w.outputTokens))
		        ] }, lc.layer);
		      }) })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: S.panelLabel, children: "层级成本（单次 avg）" }),
		    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("table", { style: { width: "100%", borderCollapse: "collapse", marginBottom: 14 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("tr", { children: [
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("th", { style: thFirst, children: "层级" }),
		        RANGES.map((r) => {
		          return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("th", { style: thStyle, children: RANGE_LABELS[r] + "-avg" }, r);
		        })
		      ] }) }),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("tbody", { children: layerTable.map((lc) => {
		        return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("tr", { children: [
		          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("td", { style: tdFirst, children: lc.layer.toUpperCase() }),
		          RANGES.map((r) => cell(lc, r, (w) => w.avgOutputTokens))
		        ] }, lc.layer);
		      }) })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: S.panelLabel, children: "层级成本（单次 median）" }),
		    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("table", { style: { width: "100%", borderCollapse: "collapse", marginBottom: 14 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("tr", { children: [
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("th", { style: thFirst, children: "层级" }),
		        RANGES.map((r) => {
		          return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("th", { style: thStyle, children: RANGE_LABELS[r] + "-median" }, r);
		        })
		      ] }) }),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("tbody", { children: layerTable.map((lc) => {
		        return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("tr", { children: [
		          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("td", { style: tdFirst, children: lc.layer.toUpperCase() }),
		          RANGES.map((r) => cell(lc, r, (w) => w.medianOutputTokens))
		        ] }, lc.layer);
		      }) })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: S.panelLabel, children: "时间窗口总览" }),
		    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: S.statGrid, children: windows.map((w) => {
		      return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dsh-mem-card", style: S.statTile, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: S.statNum, children: fmtInt(w.outputTokens + w.reasoningTokens) }),
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: S.statLabel, children: RANGE_LABELS[w.range] + " · 总输出 token" }),
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: S.muted, children: "文字 " + fmtInt(w.outputTokens) + " · 思考 " + fmtInt(w.reasoningTokens) + " · " + w.calls + " 次调用" })
		      ] }, w.range);
		    }) }),
		    byModel.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { children: [
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: S.panelLabel, children: "按模型（累计）" }),
		      byModel.map((m) => {
		        const label = fmtModel(m.provider, m.model);
		        return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: S.infoRow, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: S.infoKey, children: label }),
		          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: S.infoVal, children: m.calls + " 次 · 输出 " + fmtInt(m.outputTokens) + " · 思考 " + fmtInt(m.reasoningTokens) })
		        ] }, "m-" + label);
		      })
		    ] }) : null,
		    data ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { style: S.hint, children: "输入按字符、输出/思考按 token 计；趋势图 Y 轴为输出 token，上方可切换层级与颗粒度。" }) : null
		  ] });
		}
		
		// client/src/tabs/LogTab.tsx
		var import_react6 = require("react");
		var import_jsx_runtime6 = require("react/jsx-runtime");
		var SOURCES = [
		  { id: "", label: "系统日志" },
		  { id: "recall_turn", label: "召回追踪" },
		  { id: "distill_run", label: "蒸馏追踪" }
		];
		function fmtEvent(ev) {
		  if (ev.kind === "recall_turn") {
		    const outcome = String(ev.outcome ?? "?");
		    const hits = ev.hitIds?.length ?? 0;
		    const injected = ev.injectedIds?.length ?? 0;
		    const q = ev.queryText ? ` query="${String(ev.queryText).slice(0, 40)}"` : ` sha=${String(ev.querySha ?? "")}`;
		    return `[${new Date(Number(ev.ts)).toLocaleTimeString()}] recall ${outcome}${q} hits=${hits} injected=${injected} suppressed=${String(ev.suppressedCount ?? 0)} ${String(ev.durationMs ?? 0)}ms`;
		  }
		  if (ev.kind === "distill_run") {
		    const by = ev.byKind ? " byKind=" + JSON.stringify(ev.byKind) : "";
		    const err = ev.errorKind ? " error=" + String(ev.errorKind) : "";
		    return `[${new Date(Number(ev.ts)).toLocaleTimeString()}] distill ${String(ev.layer)}${ev.runId ? " run=" + String(ev.runId) : ""} ok=${String(ev.ok)} in=${String(ev.inputChars ?? 0)}ch new=${String(ev.newRecords ?? 0)} ${String(ev.durationMs ?? 0)}ms${by}${err}`;
		  }
		  return JSON.stringify(ev);
		}
		function LogTab(props) {
		  const rpc = props.rpc;
		  const [source, setSource] = (0, import_react6.useState)("");
		  const [lines, setLines] = (0, import_react6.useState)(null);
		  const [error, setError] = (0, import_react6.useState)(null);
		  const preRef = (0, import_react6.useRef)(null);
		  const load = (0, import_react6.useCallback)(() => {
		    setError(null);
		    if (source === "") {
		      rpc("dsh-memory/log-tail", { lines: 200 }).then((r) => {
		        if (r && r.ok) setLines(r.value.lines);
		        else setError(r && r.error ? r.error.message : "RPC error");
		      }).catch((e) => setError(String(e && e.message || e)));
		      return;
		    }
		    rpc("dsh-memory/trace-tail", { lines: 200, kind: source }).then((r) => {
		      if (r && r.ok) setLines(r.value.events.map(fmtEvent));
		      else setError(r && r.error ? r.error.message : "RPC error");
		    }).catch((e) => setError(String(e && e.message || e)));
		  }, [rpc, source]);
		  (0, import_react6.useEffect)(() => {
		    load();
		  }, [load]);
		  (0, import_react6.useEffect)(() => {
		    if (lines && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
		  }, [lines]);
		  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { children: [
		    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { ...S.flexRow, marginBottom: 10, gap: 8 }, children: [
		      SOURCES.map((s) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(NButton, { onClick: () => setSource(s.id), children: source === s.id ? "● " + s.label : s.label }, s.id)),
		      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: S.grow }),
		      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(NButton, { onClick: load, children: "刷新" })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { ...S.muted, marginBottom: 10 }, children: error ? "加载失败" : lines === null ? "加载中…" : `最近 ${lines.length} 条（${SOURCES.find((s) => s.id === source)?.label}）` }),
		    error ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { ...S.error, marginBottom: 10 }, children: "读取失败：" + error + "（点右上“刷新”重试）" }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("pre", { style: S.pre, ref: preRef, children: (lines || []).join("\n") || "(暂无记录)" })
		  ] });
		}
		
		// client/src/tabs/OverviewTab.tsx
		var import_react15 = require("react");
		
		// client/src/pill/modes.ts
		var MODES = [
		  { key: "chat", label: "日常", color: "var(--dsh-mem-mode-chat)" },
		  { key: "auto", label: "智能", color: "var(--dsh-mem-mode-auto)" },
		  { key: "work", label: "工作", color: "var(--dsh-mem-mode-work)" }
		];
		function modeInfo(key) {
		  for (let i = 0; i < MODES.length; i++) if (MODES[i].key === key) return MODES[i];
		  return MODES[1];
		}
		function modeLabel(key) {
		  if (key === "auto") return "智能（双族）";
		  if (key === "chat") return "日常（个人）";
		  if (key === "work") return "工作（团队）";
		  return "关闭";
		}
		
		// client/src/tabs/DistillSettings.tsx
		var import_react11 = require("react");
		
		// client/src/tabs/BudgetInputs.tsx
		var import_react7 = require("react");
		var import_jsx_runtime7 = require("react/jsx-runtime");
		var LAYERS = [
		  ["extract", "抽取"],
		  ["dedup", "去重"],
		  ["l2", "L2 场景"],
		  ["l3", "L3 画像"],
		  ["graph", "图谱投影"]
		];
		var SCOPE_KEYS = {
		  l1: ["extract", "dedup"],
		  l2: ["l2"],
		  l3: ["l3"]
		};
		function BudgetInputs(props) {
		  const rpc = props.rpc;
		  const disabled = !!props.disabled;
		  const data = props.data;
		  const setData = props.setData;
		  const onError = props.onError;
		  const scope = props.scope ?? "all";
		  const layers = scope === "all" || scope === "input" ? LAYERS : LAYERS.filter((l) => SCOPE_KEYS[scope].includes(l[0]));
		  const [draft, setDraft] = (0, import_react7.useState)(null);
		  if (!data || !data.budgets) return null;
		  const cur = data.budgets.current || {};
		  const def = data.budgets.defaults || {};
		  const eff = data.budgets.effective || {};
		  const ib = data.inputBudget || { current: 0, fallback: 0, effective: 0 };
		  const curIn = ib.current || 0;
		  const effIn = ib.effective || ib.fallback || 0;
		  const shown = (key) => {
		    if (draft && draft[key] !== void 0) return draft[key];
		    const c = key === "input" ? curIn : cur[key] || 0;
		    return c > 0 ? String(c) : "";
		  };
		  const commitPart = (keys, buildPayload, applyView) => {
		    if (!draft) return;
		    const values = {};
		    for (let i = 0; i < keys.length; i++) {
		      const key = keys[i];
		      const raw = (draft[key] !== void 0 ? draft[key] : shown(key)).trim();
		      const n = raw === "" ? 0 : Number(raw);
		      const max = key === "input" ? 1e6 : 1e6;
		      const min = key === "input" ? raw === "" ? 0 : 1e3 : 0;
		      if (!Number.isInteger(n) || n < min || n > max) {
		        onError(
		          key === "input" ? "输入预算须为 0 或 1000~1000000 的整数（留空或 0 = 跟随配置）" : "输出预算须为 0~1000000 的整数（留空或 0 = 跟随默认）"
		        );
		        setDraft(null);
		        return;
		      }
		      values[key] = n;
		    }
		    setDraft(null);
		    const prev = data;
		    setData(applyView(prev, values));
		    rpc("dsh-memory/settings-set", buildPayload(values)).then((r) => {
		      if (!r || !r.ok) {
		        setData(prev);
		        onError(r && r.error ? "预算写入失败：" + r.error.message : "预算写入失败");
		      } else {
		        onError(null);
		      }
		    }).catch((e) => {
		      setData(prev);
		      onError("预算写入失败：" + String(e && e.message || e));
		    });
		  };
		  const commitOutputs = () => {
		    commitPart(
		      ["extract", "dedup", "l2", "l3"],
		      (v) => ({ distillBudgets: v }),
		      (prev, v) => {
		        const effNext = {};
		        for (let j = 0; j < layers.length; j++) {
		          const k = layers[j][0];
		          effNext[k] = v[k] > 0 ? v[k] : def[k] || 0;
		        }
		        return {
		          ...prev,
		          settings: { ...prev.settings, distillBudgets: v },
		          budgets: {
		            ...prev.budgets,
		            current: v,
		            effective: effNext
		          }
		        };
		      }
		    );
		  };
		  const commitInput = () => {
		    commitPart(
		      ["input"],
		      (v) => ({ distillMaxInputChars: v.input }),
		      (prev, v) => {
		        return {
		          ...prev,
		          settings: { ...prev.settings, distillMaxInputChars: v.input },
		          inputBudget: {
		            ...prev.inputBudget || { current: 0, fallback: 0, effective: 0 },
		            current: v.input,
		            effective: v.input > 0 ? v.input : ib.fallback || 0
		          }
		        };
		      }
		    );
		  };
		  const dirty = (keys) => {
		    if (!draft) return false;
		    for (let i = 0; i < keys.length; i++) {
		      const key = keys[i];
		      const want = (draft[key] !== void 0 ? draft[key] : "").trim();
		      const was = key === "input" ? curIn > 0 ? String(curIn) : "" : (cur[key] || 0) > 0 ? String(cur[key]) : "";
		      if (want !== was) return true;
		    }
		    return false;
		  };
		  const inputBox = (key, _label, title, width, placeholder, onCommit) => {
		    return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
		      NInput,
		      {
		        type: "number",
		        min: 0,
		        max: 1e6,
		        style: { width },
		        title,
		        placeholder: String(placeholder || ""),
		        value: shown(key),
		        disabled,
		        onChange: (e) => {
		          const v = e.target.value;
		          const d = { ...draft || {} };
		          d[key] = v;
		          setDraft(d);
		        },
		        onBlur: () => {
		          if (dirty([key])) onCommit();
		        },
		        onKeyDown: (e) => {
		          if (e.key === "Enter" && dirty([key])) onCommit();
		        }
		      },
		      key
		    );
		  };
		  const showOutputs = scope !== "input";
		  const showInput = scope === "all" || scope === "input";
		  const effNote = layers.map((l) => eff[l[0]] || "?").join(" / ");
		  const rowLabel = (key) => key === "extract" ? "抽取输出" : key === "dedup" ? "去重输出" : key === "l2" ? "L2 输出" : "L3 输出";
		  const rowStyle2 = { display: "flex", alignItems: "center", gap: 8 };
		  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
		    showOutputs ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { marginTop: 12 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
		        "div",
		        {
		          style: S.switchLabel,
		          title: (scope === "l1" ? "L1 的抽取与去重是两次独立调用，输出限额各自设置（路由共用同一条链）。" : "") + "留空或 0 = 跟随默认（当前生效 " + effNote + "）；思考档 high/xhigh/max 时实际限额自动 ×4",
		          children: "输出预算"
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }, children: layers.map((l) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: rowStyle2, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { width: 68, flexShrink: 0, fontSize: 12, color: "var(--dsh-mem-text-2)" }, children: rowLabel(l[0]) }),
		        inputBox(
		          l[0],
		          l[1],
		          l[1] + " 输出预算（token，留空 = 默认 " + (def[l[0]] || "?") + "）",
		          110,
		          def[l[0]],
		          commitOutputs
		        ),
		        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { fontSize: 11, color: "var(--dsh-mem-text-3)" }, children: "token" })
		      ] }, l[0])) })
		    ] }) : null,
		    showInput ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { marginTop: 12 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
		        "div",
		        {
		          style: S.switchLabel,
		          title: "单次蒸馏调用的输入字符上限（≈token）：L1 抽取按此分块、L2/L3 超限截断；留空或 0 = 跟随配置（当前生效 " + (effIn || "?") + "，来自 llm.maxInputChars）",
		          children: "输入预算"
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: rowStyle2, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { width: 68, flexShrink: 0, fontSize: 12, color: "var(--dsh-mem-text-2)" }, children: "单次输入" }),
		        inputBox(
		          "input",
		          "输入",
		          "单次蒸馏输入字符上限（≈token，中文 1 字≈1 token；留空 = 跟随配置 " + (ib.fallback || "?") + "）",
		          110,
		          ib.fallback,
		          commitInput
		        ),
		        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { fontSize: 11, color: "var(--dsh-mem-text-3)" }, children: "字符" })
		      ] }) })
		    ] }) : null
		  ] });
		}
		
		// client/src/tabs/ChannelEditor.tsx
		var import_react8 = require("react");
		var import_jsx_runtime8 = require("react/jsx-runtime");
		var STY = {
		  block: { marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--dsh-mem-border)" },
		  head: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 },
		  title: { fontSize: 13, fontWeight: 650, color: "var(--dsh-mem-text-1)" },
		  chip: {
		    display: "inline-flex",
		    alignItems: "center",
		    borderRadius: 999,
		    padding: "1px 8px",
		    fontSize: 11,
		    fontWeight: 600,
		    lineHeight: "18px",
		    whiteSpace: "nowrap"
		  },
		  chipAccent: { background: "var(--dsh-mem-accent-weak)", color: "var(--dsh-mem-accent-text)" },
		  chipMuted: { background: "var(--dsh-mem-bg-inset)", color: "var(--dsh-mem-text-2)" },
		  desc: { fontSize: 11, color: "var(--dsh-mem-text-3)", margin: "0 0 8px", lineHeight: 1.5 },
		  fieldRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 },
		  fieldLabel: { fontSize: 11, color: "var(--dsh-mem-text-3)", flexShrink: 0, width: 64 },
		  input: { flex: "1 1 220px", minWidth: 160 },
		  warn: { fontSize: 11, color: "var(--dsh-mem-danger)", marginTop: 6 },
		  preview: { fontSize: 12, color: "var(--dsh-mem-text-2)", marginTop: 8, wordBreak: "break-all", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" }
		};
		var MODE_OPTIONS = [
		  { key: "", label: "跟随部署配置", title: "没有运行时覆盖，用 cordis.patch.yml 的 llm.mode/baseURL（默认 host）" },
		  { key: "host", label: "复用宿主", title: "复用宿主 ctx.llm（与付费供应商同路）" },
		  { key: "direct", label: "直连端点", title: "插件原生 HTTP 直连 OpenAI 兼容端点，与付费 API 解耦" }
		];
		function ChannelEditor(props) {
		  const { channel, rpc, disabled } = props;
		  const [baseText, setBaseText] = (0, import_react8.useState)(channel.runtimeBaseURL);
		  const [keyText, setKeyText] = (0, import_react8.useState)("");
		  const baseTimer = (0, import_react8.useRef)(void 0);
		  const dirty = (0, import_react8.useRef)(false);
		  (0, import_react8.useEffect)(() => {
		    if (!dirty.current) setBaseText(channel.runtimeBaseURL);
		  }, [channel.runtimeBaseURL]);
		  (0, import_react8.useEffect)(() => () => clearTimeout(baseTimer.current), []);
		  const commit2 = (patch) => {
		    rpc("dsh-memory/settings-set", patch).catch(() => {
		    });
		  };
		  const onBaseChange = (v) => {
		    dirty.current = true;
		    setBaseText(v);
		    clearTimeout(baseTimer.current);
		    baseTimer.current = setTimeout(() => {
		      dirty.current = false;
		      commit2({ directBaseURL: v.trim() });
		    }, 600);
		  };
		  const commitKey = () => {
		    const v = keyText.trim();
		    if (v) {
		      dirty.current = true;
		      commit2({ directApiKey: v });
		      dirty.current = false;
		    }
		    setKeyText("");
		  };
		  const runtime = channel.runtime;
		  const editing = runtime === "direct";
		  const isDirect = channel.effective === "direct";
		  const deployedDirect = channel.deployed === "direct";
		  const apiKeySet = channel.runtimeApiKeySet || channel.deployedApiKeySet;
		  const showWarn = isDirect && !channel.directReady;
		  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: STY.block, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: STY.head, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { style: STY.title, children: "蒸馏通道" }),
		      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { style: isDirect ? STY.chipAccent : STY.chipMuted, children: isDirect ? "直连端点" : "复用宿主" }),
		      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { title: "direct = 插件原生直连 OpenAI 兼容端点，与付费 API 解耦；失败自动回退宿主路由链。", style: { marginLeft: "auto", fontSize: 11, color: "var(--dsh-mem-text-3)" }, children: [
		        "生效：",
		        runtime ? runtime === "direct" ? "运行时直连" : "运行时宿主" : "跟随部署配置"
		      ] })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: STY.desc, children: "direct 通道走插件原生 HTTP，不依赖宿主 provider 注册表；direct 失败自动回退宿主路由链作兜底安全网。" }),
		    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
		      Segmented,
		      {
		        value: runtime,
		        disabled,
		        options: MODE_OPTIONS.map((m) => ({ key: m.key, label: m.label, title: m.title })),
		        onChange: (k) => commit2({ distillMode: k })
		      }
		    ),
		    editing ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { children: [
		      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: STY.fieldRow, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { style: STY.fieldLabel, children: "端点 URL" }),
		        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
		          NInput,
		          {
		            style: STY.input,
		            placeholder: "如 http://127.0.0.1:11434/v1 或 https://api.xxx/v1",
		            value: baseText,
		            disabled,
		            onChange: (e) => onBaseChange(e.target.value),
		            onKeyDown: (e) => {
		              if (e.key === "Enter") {
		                clearTimeout(baseTimer.current);
		                dirty.current = false;
		                commit2({ directBaseURL: baseText.trim() });
		              }
		            }
		          }
		        ),
		        deployedDirect && !channel.runtimeBaseURL ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { style: { fontSize: 11, color: "var(--dsh-mem-text-3)" }, children: [
		          "部署基线：",
		          channel.deployedBaseURL || "（空）"
		        ] }) : null
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: STY.fieldRow, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { style: STY.fieldLabel, children: "API Key" }),
		        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
		          NInput,
		          {
		            style: STY.input,
		            type: "password",
		            placeholder: apiKeySet ? "••••••••（已配置；留空提交可覆盖）" : "本地免 key 可留空",
		            value: keyText,
		            disabled,
		            autoComplete: "new-password",
		            onChange: (e) => setKeyText(e.target.value),
		            onKeyDown: (e) => {
		              if (e.key === "Enter") commitKey();
		            },
		            onBlur: commitKey
		          }
		        ),
		        apiKeySet ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { style: STY.chipAccent, children: "已配置" }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { style: STY.chipMuted, children: "未配置" }),
		        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
		          NButton,
		          {
		            disabled,
		            title: "写入空串清除运行时密钥（部署 .yml 的密钥不受影响）",
		            onClick: () => commit2({ directApiKey: "" }),
		            children: "清除"
		          }
		        )
		      ] }),
		      showWarn ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: STY.warn, children: "⚠ direct 未配置完整：需同时有端点 URL 与模型（llm.model / 全局链主路由），否则会回退宿主路由。" }) : null
		    ] }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: STY.preview, children: isDirect ? "当前将直连端点：" + (channel.runtimeBaseURL || channel.deployedBaseURL || "（未配置端点）") + (apiKeySet ? " · 密钥已配置" : " · 未配置密钥") : "当前复用宿主 ctx.llm（" + (runtime === "host" ? "运行时锁定" : "跟随部署配置") + "）" })
		  ] });
		}
		
		// client/src/tabs/RouteChainEditor.tsx
		var import_react10 = require("react");
		
		// client/src/ui/NSel.tsx
		var import_react9 = require("react");
		var import_jsx_runtime9 = require("react/jsx-runtime");
		function NSel(props) {
		  const options = props.options || [];
		  const value = props.value || "";
		  const disabled = !!props.disabled;
		  const [open, setOpen] = (0, import_react9.useState)(false);
		  const [idx, setIdx] = (0, import_react9.useState)(-1);
		  const wrapRef = (0, import_react9.useRef)(null);
		  const listRef = (0, import_react9.useRef)(null);
		  let selectedLabel = "";
		  for (let si = 0; si < options.length; si++) {
		    if (options[si].id === value) selectedLabel = options[si].label;
		  }
		  (0, import_react9.useEffect)(() => {
		    if (!open) return void 0;
		    const onDown = (e) => {
		      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
		    };
		    document.addEventListener("mousedown", onDown);
		    return () => {
		      document.removeEventListener("mousedown", onDown);
		    };
		  }, [open]);
		  (0, import_react9.useEffect)(() => {
		    if (!open || !listRef.current) return;
		    const el = listRef.current.querySelector('[data-active="1"]');
		    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
		  }, [open, idx]);
		  const indexOfValue = () => {
		    for (let i = 0; i < options.length; i++) if (options[i].id === value) return i;
		    return -1;
		  };
		  const closeMenu = (refocus) => {
		    setOpen(false);
		    setIdx(-1);
		    if (refocus && wrapRef.current) {
		      const btn3 = wrapRef.current.querySelector("button");
		      if (btn3 && btn3.focus) btn3.focus();
		    }
		  };
		  const pick = (id) => {
		    closeMenu(true);
		    if (id !== value && props.onChange) props.onChange(id);
		  };
		  const moveActive = (delta) => {
		    const n = options.length;
		    if (n === 0) return;
		    let cur = idx >= 0 ? idx : indexOfValue();
		    if (cur < 0) cur = delta > 0 ? -1 : 0;
		    setIdx(delta > 0 ? ((cur + 1) % n + n) % n : ((cur - 1) % n + n) % n);
		  };
		  const onKey = (e) => {
		    if (disabled) return;
		    if (e.key === "Escape") {
		      if (open) {
		        e.preventDefault();
		        closeMenu(true);
		      }
		      return;
		    }
		    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
		      e.preventDefault();
		      if (!open) {
		        setOpen(true);
		        setIdx(indexOfValue());
		      } else moveActive(e.key === "ArrowDown" ? 1 : -1);
		      return;
		    }
		    if (!open && (e.key === "Enter" || e.key === " ")) {
		      e.preventDefault();
		      setOpen(true);
		      setIdx(indexOfValue());
		      return;
		    }
		    if (open && e.key === "Enter") {
		      e.preventDefault();
		      let t = idx >= 0 ? idx : indexOfValue();
		      if (t < 0) t = 0;
		      if (options[t]) pick(options[t].id);
		    }
		  };
		  const onBlur = (e) => {
		    if (!open) return;
		    const to = e.relatedTarget;
		    if (!to || wrapRef.current && !wrapRef.current.contains(to)) setOpen(false);
		  };
		  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "dsh-mem-sel", style: props.style, ref: wrapRef, onKeyDown: onKey, onBlur, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(
		      "button",
		      {
		        type: "button",
		        className: "dsh-mem-select" + (open ? " dsh-mem-select-open" : ""),
		        disabled,
		        "aria-haspopup": "listbox",
		        "aria-expanded": open,
		        onClick: () => {
		          if (open) closeMenu(false);
		          else {
		            setOpen(true);
		            setIdx(-1);
		          }
		        },
		        children: [
		          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "dsh-mem-select-label", children: selectedLabel || props.placeholder || "（请选择）" }),
		          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "dsh-mem-sel-chev" + (open ? " dsh-mem-sel-chev-open" : ""), "aria-hidden": true })
		        ]
		      }
		    ),
		    open && !disabled ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "dsh-mem-pop", ref: listRef, role: "listbox", children: options.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "dsh-mem-pop-empty", children: "无选项" }) : options.map((o, i) => {
		      return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(
		        "button",
		        {
		          type: "button",
		          className: "dsh-mem-pop-opt" + (o.id === value ? " dsh-mem-pop-opt-on" : ""),
		          role: "option",
		          "aria-selected": o.id === value,
		          "data-active": i === idx ? "1" : "0",
		          onMouseDown: (e) => {
		            if (e.preventDefault) e.preventDefault();
		          },
		          onClick: () => {
		            pick(o.id);
		          },
		          onMouseEnter: () => {
		            if (idx !== i) setIdx(i);
		          },
		          children: [
		            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "dsh-mem-pop-opt-label", children: o.label }),
		            o.id === value ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "dsh-mem-pop-check", children: "✓" }) : null
		          ]
		        },
		        o.id
		      );
		    }) }) : null
		  ] });
		}
		
		// client/src/tabs/RouteChainEditor.tsx
		var import_jsx_runtime10 = require("react/jsx-runtime");
		var modelsCache = {};
		var EFFORT_VOCAB = ["", "off", "none", "minimal", "low", "medium", "high", "xhigh", "max"];
		var STY2 = {
		  wrap: { padding: "8px 0" },
		  row: { background: "var(--dsh-mem-bg-inset)", borderRadius: 8, padding: 8, marginBottom: 8, border: "1px solid transparent" },
		  rowErr: { border: "1px solid var(--dsh-mem-danger)" },
		  badge: { flexShrink: 0, width: 20, height: 18, borderRadius: 999, background: "var(--dsh-mem-accent-weak)", color: "var(--dsh-mem-accent-text)", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" },
		  // 控件行：供应商/模型/档位同行，flexWrap 兜底窄面板（放不下时档位折行）
		  line: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
		  // 序调整/删除按钮独立成行，右下角对齐
		  actions: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 6 },
		  ico: { padding: 0, width: 26, height: 26, minWidth: 26, fontSize: 13, lineHeight: "20px" },
		  add: { width: "100%", padding: "7px 0", fontSize: 12.5, color: "var(--dsh-mem-text-3)", background: "transparent", border: "1px dashed var(--dsh-mem-border-strong)", borderRadius: 8 },
		  ghost: { border: "none", background: "transparent", color: "var(--dsh-mem-text-3)" },
		  note: { fontSize: 11, color: "var(--dsh-mem-text-3)", marginTop: 6 },
		  warn: { fontSize: 11, color: "var(--dsh-mem-danger)", marginTop: 6 },
		  mono: { fontSize: 12.5, color: "var(--dsh-mem-text-1)", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
		  roRow: { display: "flex", alignItems: "center", gap: 8, background: "var(--dsh-mem-bg-inset)", borderRadius: 8, padding: "7px 10px", marginBottom: 6 }
		};
		var EMPTY_ROW = { provider: "", model: "", reasoningEffort: "" };
		function copyRow(e) {
		  return { provider: e.provider || "", model: e.model || "", reasoningEffort: e.reasoningEffort || "" };
		}
		function RouteChainEditor(props) {
		  const rpc = props.rpc;
		  const disabled = !!props.disabled;
		  const scope = props.scope ?? "global";
		  const isLayer = scope !== "global";
		  const [info, setInfo] = (0, import_react10.useState)(null);
		  const [rows, setRows] = (0, import_react10.useState)(null);
		  const [rowErrs, setRowErrs] = (0, import_react10.useState)({});
		  const [err, setErr] = (0, import_react10.useState)(null);
		  const [manual, setManual] = (0, import_react10.useState)({ idx: -1, text: "" });
		  const pendingWrites = (0, import_react10.useRef)(0);
		  function refreshInfo() {
		    rpc("dsh-memory/llm-providers", {}).then((r) => {
		      if (r && r.ok && pendingWrites.current === 0) setInfo(r.value);
		    }).catch(() => {
		    });
		  }
		  (0, import_react10.useEffect)(() => {
		    refreshInfo();
		    const timer = setInterval(refreshInfo, 5e3);
		    return () => {
		      clearInterval(timer);
		    };
		  }, [rpc]);
		  (0, import_react10.useEffect)(() => {
		    if (!info || !info.providers) return;
		    info.providers.forEach((p) => {
		      if (!p.id || modelsCache[p.id]) return;
		      rpc("dsh-memory/llm-models", { provider: p.id }).then((r) => {
		        if (r && r.ok && r.value) modelsCache[p.id] = r.value.models || [];
		      }).catch(() => {
		      });
		    });
		  }, [rpc, info]);
		  const layerView = isLayer && info && info.layerChains ? info.layerChains[scope] : null;
		  const savedRows = isLayer ? layerView?.runtime ?? [] : info && info.chain ? info.chain.current : [];
		  (0, import_react10.useEffect)(() => {
		    if (rows === null && info && savedRows.length) {
		      setRows(savedRows.map(copyRow));
		    }
		  }, [info, rows, savedRows]);
		  function updateRow(i, patch) {
		    setRows(rows.map((r, j) => j === i ? { ...r, ...patch } : r));
		    setRowErrs({});
		  }
		  function moveRow(i, dir) {
		    let next = rows.map(copyRow);
		    if (dir < 0 && i === 1) {
		      if (!next[0].provider) next = next.slice(1);
		      else {
		        const t = next[0];
		        next[0] = next[1];
		        next[1] = t;
		      }
		    } else if (dir < 0 && i > 1) {
		      const t2 = next[i - 1];
		      next[i - 1] = next[i];
		      next[i] = t2;
		    } else if (dir > 0 && i < next.length - 1 && !(i === 0 && !next[0].provider)) {
		      const t3 = next[i + 1];
		      next[i + 1] = next[i];
		      next[i] = t3;
		    }
		    setRows(next);
		    setRowErrs({});
		  }
		  function removeRow(i) {
		    if (i === 0) {
		      if (isLayer) setRows(rows.length > 1 ? rows.slice(1) : rows);
		      else setRows([EMPTY_ROW].concat(rows.slice(1)));
		    } else {
		      setRows(rows.slice(0, i).concat(rows.slice(i + 1)));
		    }
		    setRowErrs({});
		  }
		  function addRow() {
		    let defProv = rows[0] && rows[0].provider || "";
		    if (!defProv && info.providers && info.providers[0]) defProv = info.providers[0].id;
		    setRows(rows.concat([{ provider: defProv, model: "", reasoningEffort: "" }]));
		    setRowErrs({});
		  }
		  function forkStatic() {
		    if (isLayer) {
		      const st2 = layerView && layerView.static || [];
		      if (st2.length) setRows(st2.slice(0, 8).map(copyRow));
		      else {
		        const first = info.providers && info.providers[0] || { id: "" };
		        setRows([{ provider: first.id, model: "", reasoningEffort: "" }]);
		      }
		      setRowErrs({});
		      return;
		    }
		    const st = info.chain && info.chain.static || [];
		    setRows([EMPTY_ROW].concat(st.slice(0, 7).map(copyRow)));
		    setRowErrs({});
		  }
		  function save() {
		    const errs = {};
		    const seen = {};
		    if (isLayer && (!rows[0].provider || !rows[0].model)) {
		      errs[0] = "主路由行必须显式选择供应商与模型（层链不支持跟随默认模型）";
		    } else if (rows[0].provider && !rows[0].model || !rows[0].provider && rows[0].model) {
		      errs[0] = "主路由行供应商与模型须成对（双空 = 跟随默认模型）";
		    }
		    if (rows[0].provider && rows[0].model) seen[rows[0].provider + "::" + rows[0].model] = 0;
		    for (let i = 1; i < rows.length; i++) {
		      if (!rows[i].provider || !rows[i].model) {
		        errs[i] = "回退路由必须显式选择供应商与模型";
		        continue;
		      }
		      const key = rows[i].provider + "::" + rows[i].model;
		      if (seen[key] !== void 0) {
		        errs[i] = seen[key] === 0 ? "与主路由完全相同（运行时会跳过，请去重）" : "与第 " + (seen[key] + 1) + " 行重复";
		      } else {
		        seen[key] = i;
		      }
		    }
		    setRowErrs(errs);
		    if (rows.length > 8) {
		      setErr("路由链最多 8 行（含主路由行），请删除多余行");
		      return;
		    }
		    if (Object.keys(errs).length) return;
		    pendingWrites.current += 1;
		    if (isLayer && info && info.layerChains) {
		      setInfo({
		        ...info,
		        layerChains: {
		          ...info.layerChains,
		          [scope]: { ...info.layerChains[scope], runtime: rows.map(copyRow), source: "runtime" }
		        }
		      });
		    } else {
		      setInfo({
		        ...info,
		        chain: { ...info.chain, current: rows.map(copyRow), source: "runtime" }
		      });
		    }
		    const payload = isLayer ? { distillLayerChains: { [scope]: rows } } : { distillChain: rows };
		    rpc("dsh-memory/settings-set", payload).then((r) => {
		      pendingWrites.current -= 1;
		      setErr(!r || r.ok ? null : "路由链保存失败：" + (r && r.error && r.error.message || "未知错误"));
		      refreshInfo();
		    }).catch((e) => {
		      pendingWrites.current -= 1;
		      setErr("路由链保存失败：" + String(e && e.message || e));
		      refreshInfo();
		    });
		  }
		  function clearToFollow() {
		    pendingWrites.current += 1;
		    if (isLayer) {
		      rpc("dsh-memory/settings-set", { distillLayerChains: { [scope]: [] } }).then((r) => {
		        pendingWrites.current -= 1;
		        setRows(null);
		        setRowErrs({});
		        setErr(!r || r.ok ? null : "清空失败，请重试");
		        refreshInfo();
		      }).catch((e) => {
		        pendingWrites.current -= 1;
		        setErr("清空失败：" + String(e && e.message || e));
		        refreshInfo();
		      });
		      return;
		    }
		    rpc("dsh-memory/settings-set", { distillChain: [], distillProvider: "", distillModel: "", reasoningEffort: "" }).then((r) => {
		      pendingWrites.current -= 1;
		      setRows(null);
		      setRowErrs({});
		      setErr(!r || r.ok ? null : "清空失败，请重试");
		      refreshInfo();
		    }).catch((e) => {
		      pendingWrites.current -= 1;
		      setErr("清空失败：" + String(e && e.message || e));
		      refreshInfo();
		    });
		  }
		  if (!info) return null;
		  const providers = info.providers || [];
		  const providersById = {};
		  providers.forEach((p) => {
		    providersById[p.id] = p;
		  });
		  function roRow(e, i) {
		    return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: STY2.roRow, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { style: STY2.badge, children: i === 0 ? "主" : String(i + 1) }),
		      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { style: { ...STY2.mono, color: "var(--dsh-mem-text-2)" }, children: e.provider + " / " + e.model }),
		      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { style: { marginLeft: "auto", flexShrink: 0, fontSize: 11, color: "var(--dsh-mem-text-3)" }, children: e.effort ? "档位 " + e.effort : "跟随部署配置" })
		    ] }, "ro" + i);
		  }
		  if (info.pinned) {
		    const effPin = isLayer ? layerView?.effectiveChain ?? [] : info.chain && info.chain.effectiveChain || [];
		    return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: STY2.wrap, children: [
		      effPin.map(roRow),
		      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: STY2.note, children: "部署已锁定路由（pin），调整请修改 cordis.patch.yml 中 llm 的配置。" })
		    ] });
		  }
		  if (rows === null) {
		    if (isLayer) {
		      const lv = layerView;
		      const src = lv?.source ?? "global";
		      if (src === "static" && lv) {
		        return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: STY2.wrap, children: [
		          lv.static.map((e, i) => roRow({ provider: e.provider, model: e.model, effort: e.reasoningEffort || "" }, i)),
		          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { marginTop: 6 }, children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(NButton, { onClick: forkStatic, disabled, children: "自定义本层链" }) })
		        ] });
		      }
		      const previewRows = lv?.effectiveChain ?? [];
		      return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: STY2.wrap, children: [
		        previewRows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: S.switchDesc, children: "本层跟随全局链，暂无可用路由。" }) : previewRows.map(roRow),
		        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { marginTop: 6 }, children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(NButton, { onClick: forkStatic, disabled, children: "自定义本层链" }) })
		      ] });
		    }
		    const effFollow = info.chain && info.chain.effectiveChain || [];
		    return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: STY2.wrap, children: [
		      effFollow.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: S.switchDesc, children: "蒸馏跟随默认模型，未配置回退链。" }) : effFollow.map(roRow),
		      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { marginTop: 6 }, children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(NButton, { onClick: forkStatic, disabled, children: "编辑为运行时链" }) })
		    ] });
		  }
		  const capped = rows.length >= 8;
		  const dirty = JSON.stringify(rows) !== JSON.stringify(savedRows);
		  const rowEls = rows.map((row2, i) => {
		    const isPrimary = i === 0;
		    const known = !row2.provider || !!providersById[row2.provider];
		    const modelsLoaded = row2.provider ? Object.prototype.hasOwnProperty.call(modelsCache, row2.provider) : false;
		    const modelList = modelsLoaded ? modelsCache[row2.provider] : [];
		    const manualInput = modelsLoaded && modelList.length === 0;
		    let curEfforts = [];
		    for (let mi = 0; mi < modelList.length; mi++) {
		      if (modelList[mi].id === row2.model) {
		        curEfforts = modelList[mi].efforts || [];
		        break;
		      }
		    }
		    let providerOptions = providers.map((p) => {
		      return { id: p.id, label: p.name !== p.id ? p.name + "（" + p.id + "）" : p.id };
		    });
		    if (isPrimary && !isLayer) {
		      providerOptions = [
		        {
		          id: "",
		          label: info.default ? "跟随默认模型（" + info.default.provider + " / " + info.default.model + "）" : "跟随默认模型"
		        }
		      ].concat(providerOptions);
		    }
		    if (row2.provider && !providersById[row2.provider]) {
		      providerOptions.push({ id: row2.provider, label: row2.provider + "（已不在列表）" });
		    }
		    const modelOptions = modelList.map((m) => {
		      return { id: m.id, label: m.name !== m.id ? m.name + "（" + m.id + "）" : m.id };
		    });
		    if (row2.model && !modelList.some((m) => m.id === row2.model)) {
		      modelOptions.push({ id: row2.model, label: row2.model + "（已不在列表）" });
		    }
		    const effortOptions = [{ id: "", label: "跟随部署配置" }].concat(
		      curEfforts.filter((k) => EFFORT_VOCAB.indexOf(k) >= 0).map((k) => ({ id: k, label: k }))
		    );
		    return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: { ...STY2.row, ...rowErrs[i] ? STY2.rowErr : null }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: STY2.line, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { style: STY2.badge, children: isPrimary ? "主" : String(i + 1) }),
		        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
		          NSel,
		          {
		            style: { flex: 1, minWidth: 150 },
		            options: providerOptions,
		            value: row2.provider,
		            disabled,
		            placeholder: isPrimary ? "跟随默认模型" : "供应商",
		            onChange: (v) => {
		              updateRow(i, { provider: v, model: "", reasoningEffort: "" });
		            }
		          }
		        ),
		        !row2.provider ? null : manualInput ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
		          NInput,
		          {
		            style: { flex: 1, minWidth: 150 },
		            placeholder: "模型 id（该供应商未提供列表，输入后回车）…",
		            value: manual.idx === i ? manual.text : row2.model,
		            onChange: (e) => {
		              setManual({ idx: i, text: e.target.value });
		            },
		            onKeyDown: (e) => {
		              if (e.key === "Enter") {
		                const v = (manual.idx === i ? manual.text : "").trim();
		                if (v) {
		                  updateRow(i, { model: v });
		                  setManual({ idx: -1, text: "" });
		                }
		              }
		            }
		          }
		        ) : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
		          NSel,
		          {
		            style: { flex: 1, minWidth: 150 },
		            options: modelOptions,
		            value: row2.model,
		            disabled: disabled || !modelsLoaded,
		            placeholder: modelsLoaded ? isPrimary ? "（选择模型，可留空跟随默认）" : "（选择模型）" : "加载模型列表…",
		            onChange: (v) => {
		              updateRow(i, { model: v });
		            }
		          }
		        ),
		        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
		          NSel,
		          {
		            style: { flexShrink: 0, width: 118 },
		            options: effortOptions,
		            value: row2.reasoningEffort,
		            disabled: disabled || !(row2.provider && row2.model),
		            placeholder: "跟随部署配置",
		            onChange: (v) => {
		              updateRow(i, { reasoningEffort: v });
		            }
		          }
		        )
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: STY2.actions, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
		          NButton,
		          {
		            style: STY2.ico,
		            disabled: disabled || i === 0,
		            title: i === 1 ? "上移（与主路由互换/顶替为主路由）" : "上移",
		            onClick: () => {
		              moveRow(i, -1);
		            },
		            children: "↑"
		          }
		        ),
		        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
		          NButton,
		          {
		            style: STY2.ico,
		            disabled: disabled || i === rows.length - 1 || i === 0 && !row2.provider,
		            title: "下移",
		            onClick: () => {
		              moveRow(i, 1);
		            },
		            children: "↓"
		          }
		        ),
		        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
		          NButton,
		          {
		            style: STY2.ico,
		            disabled,
		            title: isPrimary ? "重置为跟随默认" : "删除",
		            onClick: () => {
		              removeRow(i);
		            },
		            children: "✕"
		          }
		        )
		      ] }),
		      isPrimary && !row2.provider ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: STY2.note, children: "跟随默认模型" + (info.default ? "：" + info.default.provider + " / " + info.default.model : "") + "（档位跟随部署配置，选定模型后可单独设置）" }) : null,
		      !known ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: STY2.warn, children: "⚠ 供应商 " + row2.provider + " 已不在已注册路由中：该路由调用会失败并被链跳过（不阻止保存）。" }) : null,
		      rowErrs[i] ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: STY2.warn, children: "✕ " + rowErrs[i] }) : null
		    ] }, "row" + i);
		  });
		  const effChain = isLayer ? layerView?.effectiveChain ?? [] : info.chain && info.chain.effectiveChain || [];
		  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: STY2.wrap, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
		      "div",
		      {
		        style: { ...S.switchDesc, marginBottom: 8 },
		        title: isLayer ? "本层链失败只在层内降级，绝不落到全局链；每行档位独立" : "第 1 行主路由；失败（报错/掐断/网络异常/空输出）按序降级；每行档位独立",
		        children: isLayer ? "主路由失败，只降级到本层回退" : "主路由失败，按序降级"
		      }
		    ),
		    rowEls,
		    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(NButton, { style: STY2.add, disabled: disabled || capped, onClick: addRow, children: capped ? "已达上限（8 条）" : "+ 添加回退路由" }),
		    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 10 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
		        NButton,
		        {
		          style: isLayer ? { ...STY2.ghost, color: "var(--dsh-mem-danger)", border: "1px solid var(--dsh-mem-danger)" } : STY2.ghost,
		          disabled,
		          onClick: clearToFollow,
		          children: isLayer ? "清除自定义 · 跟随全局" : "清空并跟随部署配置"
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: S.grow }),
		      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(NButton, { variant: "primary", disabled, onClick: save, children: "保存" })
		    ] }),
		    err ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { ...STY2.warn, marginTop: 8 }, children: "✕ " + err }) : null,
		    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: { marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--dsh-mem-border)" }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { fontSize: 11, color: "var(--dsh-mem-text-3)", marginBottom: 4 }, children: "实际链" + (dirty ? "（保存后更新；当前显示已保存值）" : "") }),
		      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
		        "div",
		        {
		          style: { fontSize: 12, color: "var(--dsh-mem-text-2)", wordBreak: "break-all", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" },
		          children: effChain.map((e) => e.provider + "/" + e.model + (e.effort ? "（" + e.effort + "）" : "")).join(" → ") || "（暂无可用路由）"
		        }
		      )
		    ] })
		  ] });
		}
		
		// client/src/tabs/DistillSettings.tsx
		var import_jsx_runtime11 = require("react/jsx-runtime");
		var STY3 = {
		  hint: { fontSize: 11, color: "var(--dsh-mem-text-3)", margin: "0 0 8px" },
		  panelHead: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 },
		  panelTitle: { fontSize: 13.5, fontWeight: 650, color: "var(--dsh-mem-text-1)" },
		  chip: {
		    display: "inline-flex",
		    alignItems: "center",
		    borderRadius: 999,
		    padding: "1px 8px",
		    fontSize: 11,
		    fontWeight: 600,
		    lineHeight: "18px",
		    whiteSpace: "nowrap"
		  },
		  chipAccent: { background: "var(--dsh-mem-accent-weak)", color: "var(--dsh-mem-accent-text)" },
		  chipMuted: { background: "var(--dsh-mem-bg-inset)", color: "var(--dsh-mem-text-2)" },
		  inUse: { fontSize: 11, color: "var(--dsh-mem-text-3)", margin: "6px 0 0" }
		};
		function Dot(props) {
		  const base = {
		    display: "inline-block",
		    width: 7,
		    height: 7,
		    borderRadius: "50%",
		    marginRight: 4,
		    verticalAlign: "middle",
		    flexShrink: 0
		  };
		  if (props.kind === "runtime") return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: { ...base, background: "var(--dsh-mem-accent)" } });
		  if (props.kind === "static") return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: { ...base, background: "transparent", border: "1.5px solid var(--dsh-mem-text-3)" } });
		  return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: { ...base, background: "var(--dsh-mem-track)" } });
		}
		var LAYER_META = {
		  l1: { seg: "L1", title: "L1 · 抽取 / 去重" },
		  l2: { seg: "L2", title: "L2 · 场景摘要" },
		  l3: { seg: "L3", title: "L3 · 画像蒸馏" }
		};
		function DistillSettings(props) {
		  const rpc = props.rpc;
		  const disabled = !!props.disabled;
		  const [info, setInfo] = (0, import_react11.useState)(null);
		  const [tab, setTab] = (0, import_react11.useState)("g");
		  (0, import_react11.useEffect)(() => {
		    let alive = true;
		    const refresh = () => {
		      rpc("dsh-memory/llm-providers", {}).then((r) => {
		        if (alive && r && r.ok) setInfo(r.value);
		      }).catch(() => {
		      });
		    };
		    refresh();
		    const timer = setInterval(refresh, 5e3);
		    return () => {
		      alive = false;
		      clearInterval(timer);
		    };
		  }, [rpc]);
		  const layers = info?.layerChains;
		  const dotOf = (k) => layers?.[k]?.source ?? "global";
		  const users = ["l1", "l2", "l3"].filter((k) => dotOf(k) === "global");
		  const segOptions = [
		    { key: "g", label: "全局默认", title: "未单独配置的层走这条链（当前在用：" + (users.length ? users.map((k) => LAYER_META[k].seg).join("、") : "无") + "）" },
		    ...["l1", "l2", "l3"].map((k) => ({
		      key: k,
		      title: LAYER_META[k].title + " · " + (dotOf(k) === "runtime" ? "运行时自定义" : dotOf(k) === "static" ? "部署 YAML 层链（只读）" : "跟随全局"),
		      label: /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { children: [
		        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Dot, { kind: dotOf(k) }),
		        LAYER_META[k].seg
		      ] })
		    }))
		  ];
		  const chipTitle = (k) => dotOf(k) === "runtime" ? "本层走设置页自定义链" : dotOf(k) === "static" ? "本层走部署 YAML 层链（UI 只读，自定义可覆盖）" : "本层未单独配置，走全局默认链";
		  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { children: [
		    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Segmented, { value: tab, options: segOptions, onChange: (k) => setTab(k) }),
		    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { style: STY3.hint, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Dot, { kind: "runtime" }),
		      " 自定义 · ",
		      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Dot, { kind: "static" }),
		      " 部署 YAML · ",
		      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Dot, { kind: "global" }),
		      " 跟随全局",
		      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { title: "每层实际链：运行时自定义 → 部署 YAML 层链 → 全局默认链，逐级兜底；部署 pin 时运行时编辑只读", children: "（层链优先于全局）" })
		    ] }),
		    tab === "g" ? /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { children: [
		      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { style: STY3.panelHead, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: STY3.panelTitle, children: "全局默认链" }),
		        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: { ...STY3.chip, ...STY3.chipAccent }, children: "运行时 · 可编辑" }),
		        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: { ...STY3.inUse, marginLeft: "auto" }, children: users.length ? "在用：" + users.map((k) => LAYER_META[k].seg).join("、") : "当前无层使用" })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(RouteChainEditor, { rpc, disabled }, "g"),
		      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(BudgetInputs, { rpc, disabled, data: props.data, setData: props.setData, onError: props.onError, scope: "input" }, "g-budget"),
		      info?.channel ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(ChannelEditor, { channel: info.channel, rpc, disabled }) : null
		    ] }) : /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { children: [
		      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { style: STY3.panelHead, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: STY3.panelTitle, children: LAYER_META[tab].title }),
		        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: { ...STY3.chip, ...dotOf(tab) === "runtime" ? STY3.chipAccent : STY3.chipMuted }, title: chipTitle(tab), children: dotOf(tab) === "runtime" ? "运行时自定义" : dotOf(tab) === "static" ? "静态 · YAML" : "跟随全局" })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(RouteChainEditor, { rpc, disabled, scope: tab }, tab),
		      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(BudgetInputs, { rpc, disabled, data: props.data, setData: props.setData, onError: props.onError, scope: tab }, tab + "-budget")
		    ] })
		  ] });
		}
		
		// client/src/tabs/EmbeddingSection.tsx
		var import_react12 = require("react");
		
		// client/src/dimensions.ts
		var DIMS_MIN = 1;
		var DIMS_MAX = 1e5;
		function dimsRangeMessage() {
		  return `嵌入维度须为 ${DIMS_MIN}~${DIMS_MAX} 的整数（留空 = 跟随部署配置）`;
		}
		function commitDimensions(raw, deps) {
		  deps.clearDirty();
		  const trimmed = raw.trim();
		  if (trimmed === "") {
		    deps.submit(0);
		    return;
		  }
		  const n = Number(trimmed);
		  if (!Number.isInteger(n) || n < DIMS_MIN || n > DIMS_MAX) {
		    deps.reject(dimsRangeMessage());
		    return;
		  }
		  deps.submit(n);
		}
		
		// client/src/rpc.ts
		function shortMethod(endpoint) {
		  return endpoint.startsWith("dsh-memory/") ? endpoint.slice("dsh-memory/".length) : endpoint;
		}
		function makeRpc(_ctx) {
		  return (async (endpoint, payload) => {
		    let response;
		    try {
		      response = await fetch(`/dsh-memory/rpc/${shortMethod(endpoint)}`, {
		        method: "POST",
		        headers: { "content-type": "application/json" },
		        body: JSON.stringify(payload ?? {})
		      });
		    } catch (err) {
		      throw new Error(`transport failure for ${endpoint}: ${err instanceof Error ? err.message : String(err)}`);
		    }
		    if (!response.ok) throw new Error(`transport failure for ${endpoint}: HTTP ${response.status}`);
		    return await response.json();
		  });
		}
		function asLoose(rpc) {
		  return rpc;
		}
		
		// client/src/tabs/EmbeddingSection.tsx
		var import_jsx_runtime12 = require("react/jsx-runtime");
		var RSTY = {
		  block: { marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--dsh-mem-border)" },
		  title: { fontSize: 12, fontWeight: 600, color: "var(--dsh-mem-text-3)", margin: "0 0 2px" },
		  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 },
		  label: { fontSize: 11, color: "var(--dsh-mem-text-3)", flexShrink: 0, width: 64 },
		  input: { flex: "1 1 200px", minWidth: 140 },
		  chip: {
		    display: "inline-flex",
		    alignItems: "center",
		    borderRadius: 999,
		    padding: "1px 8px",
		    fontSize: 11,
		    fontWeight: 600,
		    lineHeight: "18px",
		    whiteSpace: "nowrap"
		  },
		  chipAccent: { background: "var(--dsh-mem-accent-weak)", color: "var(--dsh-mem-accent-text)" },
		  chipMuted: { background: "var(--dsh-mem-bg-inset)", color: "var(--dsh-mem-text-2)" },
		  note: { fontSize: 11, color: "var(--dsh-mem-text-3)", margin: "6px 0 0" }
		};
		function EmbeddingSection(props) {
		  const rpc = props.rpc;
		  const loose = asLoose(rpc);
		  const [st, setSt] = (0, import_react12.useState)(null);
		  const [err, setErr] = (0, import_react12.useState)(null);
		  const busyPollRef = (0, import_react12.useRef)(null);
		  const [rBase, setRBase] = (0, import_react12.useState)("");
		  const [rModel, setRModel] = (0, import_react12.useState)("");
		  const [rDims, setRDims] = (0, import_react12.useState)("");
		  const [rKey, setRKey] = (0, import_react12.useState)("");
		  const remoteDirty = (0, import_react12.useRef)({ base: false, model: false, dims: false });
		  const baseTimer = (0, import_react12.useRef)(void 0);
		  const modelTimer = (0, import_react12.useRef)(void 0);
		  const load = (0, import_react12.useCallback)(() => {
		    rpc("dsh-memory/embedding-state-get", {}).then((r) => {
		      if (r && r.ok && r.value && r.value.supported !== false) {
		        const v = r.value;
		        if (busyPollRef.current) {
		          busyPollRef.current.v = !!(v.download && (v.download.phase === "downloading" || v.download.phase === "verifying") || v.apply.busy || v.reindex && v.reindex.running || v.runtime && v.runtime.phase === "installing");
		        }
		        setSt(v);
		        setErr(null);
		      } else if (r && r.ok && r.value && r.value.supported === false) {
		        setSt(null);
		        setErr("__unsupported__");
		      } else {
		        setErr(r && !r.ok ? r.error.message : "RPC error");
		      }
		    }).catch((e) => {
		      setErr(String(e && e.message || e));
		    });
		  }, [rpc]);
		  (0, import_react12.useEffect)(() => {
		    load();
		  }, [load]);
		  (0, import_react12.useEffect)(() => {
		    let stopped = false;
		    const busyFlag = { v: false };
		    busyPollRef.current = busyFlag;
		    const tick = () => {
		      if (stopped) return;
		      load();
		      timer = setTimeout(tick, busyFlag.v ? 1200 : 5e3);
		    };
		    let timer = setTimeout(tick, 1200);
		    return () => {
		      stopped = true;
		      clearTimeout(timer);
		      busyPollRef.current = null;
		    };
		  }, [load]);
		  (0, import_react12.useEffect)(() => () => {
		    clearTimeout(baseTimer.current);
		    clearTimeout(modelTimer.current);
		  }, []);
		  (0, import_react12.useEffect)(() => {
		    if (!st || !st.remote) return;
		    if (!remoteDirty.current.base) setRBase(st.remote.baseURL || "");
		    if (!remoteDirty.current.model) setRModel(st.remote.model || "");
		    if (!remoteDirty.current.dims) setRDims(st.remote.dimensions > 0 ? String(st.remote.dimensions) : "");
		  }, [st]);
		  const commitRemote = (patch) => {
		    rpc("dsh-memory/settings-set", patch).then((r) => {
		      if (!r || !r.ok) setErr(r && r.error ? "远程连接保存失败：" + r.error.message : "远程连接保存失败");
		      else {
		        setErr(null);
		        load();
		      }
		    }).catch((e) => setErr("远程连接保存失败：" + String(e && e.message || e)));
		  };
		  const onRemoteBase = (v) => {
		    remoteDirty.current.base = true;
		    setRBase(v);
		    clearTimeout(baseTimer.current);
		    baseTimer.current = setTimeout(() => {
		      remoteDirty.current.base = false;
		      commitRemote({ embedRemoteBaseURL: v.trim() });
		    }, 600);
		  };
		  const onRemoteModel = (v) => {
		    remoteDirty.current.model = true;
		    setRModel(v);
		    clearTimeout(modelTimer.current);
		    modelTimer.current = setTimeout(() => {
		      remoteDirty.current.model = false;
		      commitRemote({ embedRemoteModel: v.trim() });
		    }, 600);
		  };
		  const commitRemoteDims = () => commitDimensions(rDims, {
		    // 复位脏标记由 commitDimensions 无条件执行（含失败路径）——**不要**在这里
		    // 再加判断，那正是修复前的缺陷：失败时标记留在 true，轮询回填被永久门控，
		    // 输入框卡死在非法值上。
		    clearDirty: () => {
		      remoteDirty.current.dims = false;
		    },
		    submit: (n) => commitRemote({ embedRemoteDimensions: n }),
		    reject: (message) => setErr(message)
		  });
		  const commitRemoteKey = () => {
		    const v = rKey.trim();
		    if (v) commitRemote({ embedRemoteApiKey: v });
		    setRKey("");
		  };
		  const call = (endpoint, payload, confirmText) => {
		    if (confirmText && !window.confirm(confirmText)) return;
		    loose(endpoint, payload).then((r) => {
		      if (!r || !r.ok) setErr(r && r.error ? r.error.message : "操作失败");
		      else {
		        setErr(null);
		        load();
		      }
		    }).catch((e) => {
		      setErr(String(e && e.message || e));
		    });
		  };
		  if (err === "__unsupported__") {
		    return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "dsh-mem-rb-card", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: { fontWeight: 600, marginBottom: 4 }, children: "语义检索（嵌入）" }),
		      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "dsh-mem-rb-muted", children: "存储处于降级状态，嵌入管理不可用。" })
		    ] });
		  }
		  if (!st) {
		    return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "dsh-mem-rb-card", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "dsh-mem-rb-muted", children: err ? "嵌入状态读取失败：" + err : "嵌入状态读取中…" }),
		      err ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(NButton, { style: { marginTop: 8 }, onClick: load, children: "重试" }) : null
		    ] });
		  }
		  const switchConfirm = "切换嵌入源后将按新模型重建向量索引（期间语义检索暂退化为关键词匹配，不影响对话）。确定切换？";
		  const onSource = (key) => {
		    if (key === "local") {
		      const ready = [];
		      for (let i = 0; i < st.models.length; i++) if (st.models[i].state === "downloaded") ready.push(st.models[i].id);
		      if (ready.length === 0) {
		        setErr("请先在下方下载一个本地嵌入模型，再切换到本地档。");
		        return;
		      }
		      const current = st.activeModel && ready.indexOf(st.activeModel) >= 0 ? st.activeModel : ready[0];
		      call("dsh-memory/embedding-source-set", { source: "local", activeModel: current }, switchConfirm);
		      return;
		    }
		    call("dsh-memory/embedding-source-set", { source: key }, key === "remote" ? switchConfirm : null);
		  };
		  const dl = st.download;
		  const dlActive = dl && (dl.phase === "downloading" || dl.phase === "verifying");
		  const ap = st.apply;
		  const localInfo = st.local;
		  const rt = st.runtime;
		  const remote = st.remote;
		  let runtimeRow = null;
		  if (rt.phase === "installing") {
		    runtimeRow = /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: { marginTop: 8, fontSize: 12 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: S.flexRow, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: "安装推理运行时中… 已耗时 " + Math.round(rt.elapsedMs / 1e3) + "s（约 100~200MB，视网络）" }),
		        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: S.grow }),
		        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(NButton, { onClick: () => call("dsh-memory/embedding-runtime-cancel", {}), children: "取消" })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("pre", { style: { ...S.pre, maxHeight: 68, marginTop: 6, fontSize: 11, opacity: 0.85 }, children: (rt.lastLines || []).join("\n") || "等待 npm 输出…" })
		    ] });
		  } else if (rt.phase === "error") {
		    runtimeRow = /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: { marginTop: 8, fontSize: 12, color: "var(--dsh-mem-danger)" }, children: "运行时安装失败：" + (rt.error || "未知") + "（重新切换嵌入源可重试）" });
		  } else if (rt.phase === "ready") {
		    runtimeRow = /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "dsh-mem-rb-muted", style: { marginTop: 8 }, children: "推理运行时就绪（transformers.js v" + rt.installedVersion + "）" });
		  } else if (st.source === "local") {
		    runtimeRow = /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "dsh-mem-rb-muted", style: { marginTop: 8 }, children: "首次启用本地嵌入时会自动安装推理运行时（约 100~200MB）。" });
		  }
		  let applyRow = null;
		  if (ap.phase === "warming") {
		    applyRow = /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "dsh-mem-rb-muted", style: { marginTop: 8 }, children: "加载嵌入模型中…（首次需数秒）" });
		  } else if (ap.phase === "switching") {
		    applyRow = /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "dsh-mem-rb-muted", style: { marginTop: 8 }, children: "切换嵌入源中…" });
		  } else if (ap.phase === "error") {
		    applyRow = /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: { marginTop: 8, fontSize: 12, color: "var(--dsh-mem-danger)" }, children: "切换失败：" + ap.message + "（已保存的嵌入源不变，重启后仍按原源运行）" });
		  } else if (st.reindex && st.reindex.running) {
		    const rj = st.reindex;
		    const rDone = rj.l1Done + rj.l0Done;
		    const rTotal = rj.l1Total + rj.l0Total;
		    const rPct = rTotal > 0 ? Math.round(rDone / rTotal * 100) : 0;
		    applyRow = /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: { marginTop: 8 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: S.flexRow, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "dsh-mem-rb-muted", children: "重嵌入中 L1 " + rj.l1Done + "/" + rj.l1Total + " · L0 " + rj.l0Done + "/" + rj.l0Total + "（" + rPct + "%）" }),
		        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: S.grow }),
		        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(NButton, { onClick: () => call("dsh-memory/embedding-reindex-cancel", {}), children: "取消" })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: { ...S.flexRow, marginTop: 6 }, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "dsh-mem-rb-bar", children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "dsh-mem-rb-fill", style: { width: rPct + "%" } }) }) })
		    ] });
		  }
		  const modelCards = st.models.map((m) => {
		    const isActive = st.source === "local" && st.activeModel === m.id;
		    const mDl = dlActive && dl.modelId === m.id;
		    const pct = mDl && dl.overallTotal > 0 ? Math.round(dl.overallReceived / dl.overallTotal * 100) : 0;
		    let action;
		    if (mDl) {
		      action = /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: { flex: 1, minWidth: 200 }, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: S.flexRow, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "dsh-mem-rb-muted", style: { whiteSpace: "nowrap" }, children: (dl.phase === "verifying" ? "校验中 " : "") + fmtMB(dl.overallReceived) + " / " + fmtMB(dl.overallTotal) + "（文件 " + dl.fileIndex + "/" + dl.fileCount + "，" + pct + "%" + (dl.speedBps > 0 && dl.phase === "downloading" ? "，" + fmtMB(dl.speedBps) + "/s" : "") + "）" }),
		          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: S.grow }),
		          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(NButton, { onClick: () => call("dsh-memory/embedding-download-cancel", {}), children: "取消" })
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: { ...S.flexRow, marginTop: 6 }, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "dsh-mem-rb-bar", children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "dsh-mem-rb-fill", style: { width: pct + "%" } }) }) })
		      ] });
		    } else if (isActive) {
		      action = /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: S.flexRow, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "dsh-mem-tag dsh-mem-tag-work-task", children: "使用中" }),
		        localInfo && localInfo.state === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "dsh-mem-rb-muted", children: "模型加载中…" }) : null,
		        localInfo && localInfo.state === "failed" ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { style: { fontSize: 12, color: "var(--dsh-mem-danger)" }, children: "加载失败：" + (localInfo.error || "") }) : null,
		        localInfo && localInfo.state === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "dsh-mem-rb-muted", children: "已就绪" }) : null
		      ] });
		    } else if (m.state === "downloaded") {
		      action = /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: S.flexRow, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
		          NButton,
		          {
		            disabled: ap.busy,
		            onClick: () => call("dsh-memory/embedding-source-set", { source: "local", activeModel: m.id }, switchConfirm),
		            children: "启用"
		          }
		        ),
		        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
		          NButton,
		          {
		            disabled: dlActive,
		            onClick: () => call("dsh-memory/embedding-model-delete", { modelId: m.id }, "删除已下载的 " + m.name + "（" + fmtMB(m.totalBytes) + "）？"),
		            children: "删除"
		          }
		        )
		      ] });
		    } else {
		      action = /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
		        NButton,
		        {
		          disabled: dlActive || !st.ceilings.local,
		          title: !st.ceilings.local ? "部署已禁用本地嵌入模型" : "",
		          onClick: () => call("dsh-memory/embedding-download-start", { modelId: m.id }),
		          children: (m.state === "partial" ? "继续下载 " : "下载 ") + fmtMB(m.totalBytes)
		        }
		      );
		    }
		    return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
		      "div",
		      {
		        style: { ...S.flexRow, padding: "8px 0", borderBottom: "1px solid var(--dsh-mem-border)", flexWrap: "wrap" },
		        children: [
		          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: { minWidth: 150 }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: { fontWeight: 600 }, children: m.name }),
		            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "dsh-mem-rb-muted", children: m.tags.join(" · ") + " · " + m.dims + " 维 · 上下文 " + m.contextTokens })
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: { flex: 1, minWidth: 180, fontSize: 12, color: "var(--dsh-mem-text-2)" }, children: m.description }),
		          action
		        ]
		      },
		      m.id
		    );
		  });
		  const vec = st.vectors;
		  const vecOk = !!vec && vec.l1.embedded >= 0 && vec.l0.embedded >= 0;
		  const vecNote = !vec ? "向量索引：宿主版本较旧，未上报计数" : !vecOk ? "向量索引不可用（sqlite-vec 扩展缺失或检索库降级），重建无从谈起" : "已嵌入 L1 " + vec.l1.embedded + "/" + vec.l1.total + " · L0 " + vec.l0.embedded + "/" + vec.l0.total + (vec.l1.missing + vec.l0.missing > 0 ? "（待补 " + (vec.l1.missing + vec.l0.missing) + " 条）" : "") + (vec.l1.skipped + vec.l0.skipped > 0 ? "（" + (vec.l1.skipped + vec.l0.skipped) + " 条内容不可嵌入，已跳过）" : "");
		  const reindexRunning = !!(st.reindex && st.reindex.running);
		  const canRebuild = vecOk && st.source !== "off" && !reindexRunning && !st.apply.busy;
		  const rebuildHint = !vecOk ? "向量能力不可用" : st.source === "off" ? "嵌入源已关闭，请先启用" : reindexRunning ? "重建已在进行中" : st.apply.busy ? "嵌入源切换进行中" : "只补缺失向量；已有向量不动。零向量内容会被跳过（重试无意义）";
		  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "dsh-mem-rb-card", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: S.flexRow, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: { fontWeight: 600, whiteSpace: "nowrap" }, children: "语义检索（嵌入源）" }),
		      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: S.grow }),
		      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
		        Segmented,
		        {
		          value: st.source,
		          options: [
		            { key: "off", label: "关闭" },
		            { key: "local", label: "本地", disabled: !st.ceilings.local, disabledTitle: "部署已禁用本地嵌入模型" },
		            { key: "remote", label: "远程", disabled: !st.ceilings.remote, disabledTitle: "部署未配置远程嵌入（baseUrl/apiKey/model/dimensions）" }
		          ],
		          onChange: onSource
		        }
		      )
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "dsh-mem-rb-muted", style: { marginTop: 4 }, children: st.source === "off" ? "当前：关键词（BM25）检索，不做向量嵌入" : st.source === "remote" ? "当前：远程嵌入（" + (remote.model || "未配置模型") + (remote.baseURL ? " · " + remote.baseURL : "") + "）" : "当前：本地嵌入" + (st.activeModel ? "（" + st.activeModel + "）" : "") }),
		    st.activeNote ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: { marginTop: 4, fontSize: 12, color: "var(--dsh-mem-danger)" }, children: st.activeNote }) : null,
		    err && err !== "__unsupported__" ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: { marginTop: 6, fontSize: 12, color: "var(--dsh-mem-danger)" }, children: err }) : null,
		    dl && dl.phase === "error" ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: { marginTop: 6, fontSize: 12, color: "var(--dsh-mem-danger)" }, children: "下载失败：" + (dl.error || "") }) : null,
		    runtimeRow,
		    applyRow,
		    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: RSTY.block, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: RSTY.title, children: "远程连接（生效值；运行时覆盖优先于部署 YAML）" }),
		      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: RSTY.note, children: "生效端点 " + (remote.baseURL || "（未配置）") + " · 模型 " + (remote.model || "（未配置）") + " · " + (remote.dimensions > 0 ? remote.dimensions + " 维" : "维度跟随部署") + (remote.apiKeySet ? " · 密钥已设置" : " · 密钥未设置") }),
		      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: RSTY.row, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { style: RSTY.label, children: "端点 URL" }),
		        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
		          NInput,
		          {
		            style: RSTY.input,
		            placeholder: "如 https://api.xxx/v1/embeddings 的服务基址",
		            value: rBase,
		            onChange: (e) => onRemoteBase(e.target.value),
		            onKeyDown: (e) => {
		              if (e.key === "Enter") {
		                clearTimeout(baseTimer.current);
		                remoteDirty.current.base = false;
		                commitRemote({ embedRemoteBaseURL: rBase.trim() });
		              }
		            }
		          }
		        )
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: RSTY.row, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { style: RSTY.label, children: "模型名" }),
		        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
		          NInput,
		          {
		            style: RSTY.input,
		            placeholder: "如 text-embedding-3-small",
		            value: rModel,
		            onChange: (e) => onRemoteModel(e.target.value),
		            onKeyDown: (e) => {
		              if (e.key === "Enter") {
		                clearTimeout(modelTimer.current);
		                remoteDirty.current.model = false;
		                commitRemote({ embedRemoteModel: rModel.trim() });
		              }
		            }
		          }
		        ),
		        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { style: RSTY.label, children: "维度" }),
		        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
		          NInput,
		          {
		            style: { width: 90, minWidth: 0, flex: "0 1 90px" },
		            type: "number",
		            min: 0,
		            placeholder: "跟随部署",
		            title: "向量维度（留空/0 = 跟随部署配置）",
		            value: rDims,
		            onChange: (e) => {
		              remoteDirty.current.dims = true;
		              setRDims(e.target.value);
		            },
		            onKeyDown: (e) => {
		              if (e.key === "Enter") commitRemoteDims();
		            },
		            onBlur: commitRemoteDims
		          }
		        )
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: RSTY.row, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { style: RSTY.label, children: "API Key" }),
		        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
		          NInput,
		          {
		            style: RSTY.input,
		            type: "password",
		            autoComplete: "new-password",
		            placeholder: remote.apiKeySet ? "••••••••（已设置；输入新值提交可覆盖）" : "远程服务需要密钥时填写",
		            value: rKey,
		            onChange: (e) => setRKey(e.target.value),
		            onKeyDown: (e) => {
		              if (e.key === "Enter") commitRemoteKey();
		            },
		            onBlur: commitRemoteKey
		          }
		        ),
		        remote.apiKeySet ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { style: RSTY.chipAccent, children: "已设置" }) : /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { style: RSTY.chipMuted, children: "未设置" }),
		        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
		          NButton,
		          {
		            title: "写入空串清除运行时密钥（部署 YAML 的密钥不受影响）",
		            onClick: () => commitRemote({ embedRemoteApiKey: "" }),
		            children: "清除"
		          }
		        )
		      ] })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: S.panelLabel, children: "本地模型目录（下载后离线可用，不随插件分发）" }),
		    modelCards,
		    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: RSTY.block, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: RSTY.title, children: "向量索引" }),
		      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: RSTY.note, children: vecNote }),
		      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: RSTY.row, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
		        NButton,
		        {
		          disabled: !canRebuild,
		          title: rebuildHint,
		          onClick: () => call("dsh-memory/embedding-reindex", {}),
		          children: "重建索引"
		        }
		      ) })
		    ] })
		  ] });
		}
		
		// client/src/tabs/RebuildPanel.tsx
		var import_react13 = require("react");
		var import_jsx_runtime13 = require("react/jsx-runtime");
		var RB_PHASE_LABEL = {
		  preparing: "准备中（归档旧数据 · 清空检索库）",
		  distilling: "分块蒸馏中",
		  finalizing: "收尾（强制 L2 场景 + L3 画像）"
		};
		function RebuildPanel(props) {
		  const rpc = props.rpc;
		  const [rbRaw, setRb] = (0, import_react13.useState)(null);
		  const [confirmOpen, setConfirmOpen] = (0, import_react13.useState)(false);
		  const [busy, setBusy] = (0, import_react13.useState)(false);
		  const [rbError, setRbError] = (0, import_react13.useState)(null);
		  const refresh = (0, import_react13.useCallback)(() => {
		    rpc("dsh-memory/rebuild-status", {}).then((r) => {
		      if (r && r.ok) setRb(r.value);
		    }).catch(() => {
		    });
		  }, [rpc]);
		  (0, import_react13.useEffect)(() => {
		    refresh();
		  }, [refresh]);
		  const running = !!(rbRaw && rbRaw.running);
		  (0, import_react13.useEffect)(() => {
		    if (!running) return;
		    const timer = setInterval(refresh, 1500);
		    return () => {
		      clearInterval(timer);
		    };
		  }, [running, refresh]);
		  if (!rbRaw || rbRaw.supported === false) return null;
		  const rb = rbRaw;
		  ensureThemeStyle();
		  const start = () => {
		    setBusy(true);
		    setRbError(null);
		    rpc("dsh-memory/rebuild-start", {}).then((r) => {
		      setBusy(false);
		      if (r && r.ok) {
		        setConfirmOpen(false);
		        setRb(r.value);
		      } else {
		        setRbError(r && r.error ? r.error.message : "启动失败");
		      }
		    }).catch((e) => {
		      setBusy(false);
		      setRbError(String(e && e.message || e));
		    });
		  };
		  const cancel = () => {
		    setBusy(true);
		    rpc("dsh-memory/rebuild-cancel", {}).then((r) => {
		      setBusy(false);
		      if (r && r.ok) setRb(r.value);
		    }).catch(() => {
		      setBusy(false);
		    });
		  };
		  const empty = !running && (rb.messageCount === 0 || rb.estCalls === 0);
		  const pct = rb.total > 0 ? Math.round(rb.done / rb.total * 100) : 0;
		  let lastNote = null;
		  if (!running && rb.phase === "done") {
		    lastNote = "上次重建：完成（" + rb.done + "/" + rb.total + " 会话，产出 " + rb.recordsBuilt + " 条记录）" + (rb.finishedAt ? " · " + fmtTime(new Date(rb.finishedAt).toISOString()) : "");
		  } else if (!running && rb.phase === "cancelled") {
		    lastNote = "上次重建：已取消（完成 " + rb.done + "/" + rb.total + " 会话，已重建部分保留）";
		  } else if (!running && rb.phase === "failed") {
		    lastNote = "上次重建：失败：" + (rb.error || "未知错误");
		  }
		  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "dsh-mem-rb-card", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { style: { fontWeight: 600, whiteSpace: "nowrap" }, children: "重建记忆" }),
		      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: "dsh-mem-rb-muted", style: { flex: 1, minWidth: 180 }, children: running ? (RB_PHASE_LABEL[rb.phase] || rb.phase) + " · " + rb.done + "/" + rb.total + " 会话（" + pct + "%）" : "从 L0 原始对话重新蒸馏 L1/L2/L3；旧数据先归档（不删除）" }),
		      running ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(NButton, { disabled: busy || rb.cancelRequested, onClick: cancel, children: rb.cancelRequested ? "取消中…" : "取消重建" }) : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
		        NButton,
		        {
		          disabled: busy || empty,
		          title: empty ? "L0 无消息，无可重建内容" : "重新蒸馏全部记忆",
		          style: { color: "var(--dsh-mem-danger)" },
		          onClick: () => {
		            setConfirmOpen(true);
		          },
		          children: busy ? "…" : "开始重建"
		        }
		      )
		    ] }),
		    running ? /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10, marginTop: 10 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: "dsh-mem-rb-bar", children: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: "dsh-mem-rb-fill", style: { width: pct + "%" } }) }),
		      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "dsh-mem-rb-muted", style: { whiteSpace: "nowrap" }, children: "产出 " + rb.recordsBuilt + " 条" })
		    ] }) : null,
		    lastNote ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: "dsh-mem-rb-muted", style: { marginTop: 8 }, children: lastNote }) : null,
		    rbError ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { style: { marginTop: 8, fontSize: 12, color: "var(--dsh-mem-danger)" }, children: rbError }) : null,
		    confirmOpen ? /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(
		      NModal,
		      {
		        open: true,
		        onClose: () => {
		          setConfirmOpen(false);
		        },
		        title: "确认重建全部记忆？",
		        footer: [
		          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
		            NButton,
		            {
		              onClick: () => {
		                setConfirmOpen(false);
		              },
		              children: "取消"
		            },
		            "cancel"
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(NButton, { variant: "primary", disabled: busy, onClick: start, children: busy ? "启动中…" : "开始重建" }, "confirm")
		        ],
		        children: [
		          /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { children: [
		            "将以 L0 原始对话为事实源重新蒸馏：",
		            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("b", { children: rb.sessionCount + " 个会话 · " + rb.messageCount + " 条消息" }),
		            "，预计 ≥" + rb.estCalls + " 次蒸馏调用。"
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { style: { marginTop: 8 }, children: "现有 L1 记忆 / L2 场景 / L3 画像会整体归档（*.bak.时间戳，可手工找回），随后清空重建；重建期间可正常对话，新对话的蒸馏优先进行；中途可取消，已重建部分保留。" })
		        ]
		      }
		    ) : null
		  ] });
		}
		
		// client/src/tabs/RuminatePanel.tsx
		var import_react14 = require("react");
		var import_jsx_runtime14 = require("react/jsx-runtime");
		var RM_PHASE_LABEL = {
		  refreshing: "轻量刷新中",
		  distilling: "L1 蒸馏中",
		  consolidating: "L2 场景整合中",
		  updating: "L3 画像更新中",
		  relabeling: "标注校验/重标定中"
		};
		var RM_RUNNING_PHASES = ["refreshing", "distilling", "consolidating", "updating", "relabeling"];
		var RM_PHASE_INTERVAL = {
		  refreshing: 4e3,
		  distilling: 1500,
		  consolidating: 6e3,
		  updating: 6e3,
		  relabeling: 3e3
		  // 重标定按批次推进,detail 每批都变,可稍密
		};
		var RM_BACKOFF_CAP = 5;
		var RM_IDLE_INTERVAL = 3e4;
		function RuminatePanel(props) {
		  const rpc = props.rpc;
		  const [rmRaw, setRm] = (0, import_react14.useState)(null);
		  const [confirmOpen, setConfirmOpen] = (0, import_react14.useState)(false);
		  const [busy, setBusy] = (0, import_react14.useState)(false);
		  const [rmError, setRmError] = (0, import_react14.useState)(null);
		  const refresh = (0, import_react14.useCallback)(() => {
		    return rpc("dsh-memory/ruminate-status", {}).then((r) => {
		      if (r && r.ok) {
		        const st = r.value;
		        const base = RM_PHASE_INTERVAL[st.phase] ?? 3e3;
		        if (st.detail && st.detail === lastDetailRef.current) backoffRef.current = Math.min(backoffRef.current * 2, RM_BACKOFF_CAP);
		        else backoffRef.current = 1;
		        lastDetailRef.current = st.detail ?? null;
		        pollRef.current = Math.min(base * backoffRef.current, 15e3);
		        setRm(st);
		      }
		      return r;
		    }).catch(() => {
		    });
		  }, [rpc]);
		  const pollRef = (0, import_react14.useRef)(1500);
		  const backoffRef = (0, import_react14.useRef)(1);
		  const lastDetailRef = (0, import_react14.useRef)(null);
		  (0, import_react14.useEffect)(() => {
		    refresh();
		  }, [refresh]);
		  const running = !!(rmRaw && (rmRaw.running || RM_RUNNING_PHASES.indexOf(rmRaw.phase) >= 0));
		  (0, import_react14.useEffect)(() => {
		    if (!running) return;
		    let alive = true;
		    let timer;
		    const loop = () => {
		      void Promise.resolve(refresh()).finally(() => {
		        if (!alive) return;
		        timer = setTimeout(loop, pollRef.current);
		      });
		    };
		    loop();
		    return () => {
		      alive = false;
		      clearTimeout(timer);
		      pollRef.current = 1500;
		      backoffRef.current = 1;
		      lastDetailRef.current = null;
		    };
		  }, [running, refresh]);
		  (0, import_react14.useEffect)(() => {
		    if (running) return;
		    const timer = setInterval(refresh, RM_IDLE_INTERVAL);
		    return () => clearInterval(timer);
		  }, [running, refresh]);
		  const [, setTick] = (0, import_react14.useState)(0);
		  (0, import_react14.useEffect)(() => {
		    if (!running) return;
		    const timer = setInterval(() => setTick((n) => n + 1), 1e3);
		    return () => clearInterval(timer);
		  }, [running]);
		  if (!rmRaw || rmRaw.supported === false) return null;
		  const rm = rmRaw;
		  ensureThemeStyle();
		  const start = () => {
		    setBusy(true);
		    setRmError(null);
		    rpc("dsh-memory/ruminate-start", {}).then((r) => {
		      setBusy(false);
		      if (r && r.ok) {
		        setConfirmOpen(false);
		        setRm(r.value);
		      } else {
		        setRmError(r && r.error ? r.error.message : "启动失败");
		      }
		    }).catch((e) => {
		      setBusy(false);
		      setRmError(String(e && e.message || e));
		    });
		  };
		  const cancel = () => {
		    setBusy(true);
		    rpc("dsh-memory/ruminate-cancel", {}).then((r) => {
		      setBusy(false);
		      if (r && r.ok) setRm(r.value);
		    }).catch(() => {
		      setBusy(false);
		    });
		  };
		  const pct = rm.total > 0 ? Math.round(rm.done / rm.total * 100) : 0;
		  const sub = rm.sub && rm.sub.total > 0 ? rm.sub : null;
		  const barPct = sub ? Math.round(sub.done / sub.total * 100) : pct;
		  const indet = running && !sub && (rm.phase === "consolidating" || rm.phase === "updating" || rm.phase === "relabeling");
		  const idleLike = !running;
		  const elapsed = running && rm.startedAt ? Math.max(0, Date.now() - rm.startedAt) : 0;
		  const elapsedText = elapsed > 0 ? elapsed >= 6e4 ? Math.floor(elapsed / 6e4) + "分" + Math.floor(elapsed % 6e4 / 1e3) + "秒" : Math.floor(elapsed / 1e3) + "秒" : "";
		  let lastNote = null;
		  if (idleLike && rm.phase === "done") {
		    const rl = rm.relabel;
		    lastNote = "上次反刍整理：完成（" + rm.done + "/" + rm.total + " 步" + (rm.recordsBuilt > 0 ? "，产出 " + rm.recordsBuilt + " 条记录" : "，无待消化缓冲") + "）" + (rl ? " · 重标定：补 cogHall " + rl.cogHallFixed + "，补 wing " + rl.wingLabeled + "，打 tags " + rl.tagged + (rl.deferred > 0 ? "，让出 " + rl.deferred : "") : "") + (rm.finishedAt ? " · " + fmtTime(new Date(rm.finishedAt).toISOString()) : "");
		  } else if (idleLike && rm.phase === "cancelled") {
		    lastNote = "上次反刍整理：已取消（完成 " + rm.done + "/" + rm.total + " 会话，已蒸馏部分保留）";
		  } else if (idleLike && rm.phase === "failed") {
		    lastNote = "上次反刍整理：失败：" + (rm.error || "未知错误");
		  }
		  const unit = rm.phase === "refreshing" || rm.phase === "relabeling" ? "步" : "会话";
		  const progressText = sub ? sub.label + " " + sub.done + "/" + sub.total + "（" + Math.round(sub.done / sub.total * 100) + "%）" : rm.total > 0 ? rm.done + "/" + rm.total + " " + unit + "（" + pct + "%）" : "进行中…";
		  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "dsh-mem-rb-card", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { style: { fontWeight: 600, whiteSpace: "nowrap" }, children: "反刍整理" }),
		      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { className: "dsh-mem-rb-muted", style: { flex: 1, minWidth: 180 }, children: running ? (RM_PHASE_LABEL[rm.phase] || rm.phase) + " · " + progressText + (elapsedText ? " · 已用 " + elapsedText : "") : "冲刷未蒸馏缓冲，跑一轮 L1→L2→L3 消化；不清库不改 L0" }),
		      running ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(NButton, { disabled: busy || rm.cancelRequested, onClick: cancel, children: rm.cancelRequested ? "取消中…" : "取消整理" }) : /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
		        NButton,
		        {
		          disabled: busy,
		          title: "消化未蒸馏的记忆缓冲",
		          style: { color: "var(--dsh-mem-accent)" },
		          onClick: () => {
		            setConfirmOpen(true);
		          },
		          children: busy ? "…" : "反刍整理"
		        }
		      )
		    ] }),
		    running ? /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10, marginTop: 10 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { className: "dsh-mem-rb-bar", children: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
		        "div",
		        {
		          className: "dsh-mem-rb-fill" + (indet ? " dsh-mem-rb-fill-indet" : ""),
		          style: { width: indet ? "100%" : barPct + "%" }
		        }
		      ) }),
		      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { className: "dsh-mem-rb-muted", style: { whiteSpace: "nowrap" }, children: sub ? sub.label + " " + sub.done + "/" + sub.total : "产出 " + rm.recordsBuilt + " 条" })
		    ] }) : null,
		    running && rm.detail ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { className: "dsh-mem-rb-muted", style: { marginTop: 6, whiteSpace: "normal" }, children: "当前：" + rm.detail }) : null,
		    lastNote ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { className: "dsh-mem-rb-muted", style: { marginTop: 8 }, children: lastNote }) : null,
		    rmError ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { style: { marginTop: 8, fontSize: 12, color: "var(--dsh-mem-danger)" }, children: rmError }) : null,
		    confirmOpen ? /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(
		      NModal,
		      {
		        open: true,
		        onClose: () => setConfirmOpen(false),
		        title: "确认反刍整理？",
		        footer: [
		          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
		            NButton,
		            {
		              onClick: () => setConfirmOpen(false),
		              children: "取消"
		            },
		            "cancel"
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(NButton, { variant: "primary", disabled: busy, onClick: start, children: busy ? "启动中…" : "反刍整理" }, "confirm")
		        ],
		        children: [
		          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { children: "将扫描未蒸馏缓冲，按会话逐个跑蒸馏管线，完成后强制 L2 场景整合与 L3 画像更新。" }),
		          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { style: { marginTop: 8 }, children: "与重建不同：不清空 L1 检索库、不归档旧产物、不改 L0；仅消化攒而未蒸馏的切片，无缓冲时做轻量 L2/L3 刷新。" })
		        ]
		      }
		    ) : null
		  ] });
		}
		
		// client/src/tabs/OverviewTab.tsx
		var import_jsx_runtime15 = require("react/jsx-runtime");
		function OverviewTab(props) {
		  const rpc = props.rpc;
		  const [stats, setStats] = (0, import_react15.useState)(null);
		  const [settingsData, setSettingsData] = (0, import_react15.useState)(null);
		  const [error, setError] = (0, import_react15.useState)(null);
		  const load = (0, import_react15.useCallback)(() => {
		    rpc("dsh-memory/stats", {}).then((r) => {
		      if (r && r.ok) setStats(r.value);
		      else setError(r && r.error ? r.error.message : "RPC error");
		    }).catch((e) => {
		      setError(String(e && e.message || e));
		    });
		    rpc("dsh-memory/settings-get", {}).then((r) => {
		      if (r && r.ok) setSettingsData(r.value);
		    }).catch(() => {
		    });
		  }, [rpc]);
		  (0, import_react15.useEffect)(() => {
		    load();
		    const timer = setInterval(load, 5e3);
		    return () => {
		      clearInterval(timer);
		    };
		  }, [load]);
		  const toggle = (key, value) => {
		    if (!settingsData) return;
		    const prev = settingsData;
		    const patch = { [key]: value };
		    const next = { ...prev, settings: { ...prev.settings, [key]: value } };
		    setSettingsData(next);
		    rpc("dsh-memory/settings-set", patch).then((r) => {
		      if (!r || !r.ok) {
		        setSettingsData(prev);
		        setError(r && r.error ? "开关写入失败：" + r.error.message : "开关写入失败");
		      } else {
		        setError(null);
		      }
		    }).catch((e) => {
		      setSettingsData(prev);
		      setError("开关写入失败：" + String(e && e.message || e));
		    });
		  };
		  const tiles = [];
		  const infos = [];
		  if (stats) {
		    const th = stats.thresholds || { l2MinNewMemories: 5, l3Interval: 20 };
		    tiles.push({ num: String(stats.l0Today), label: "L0 今日消息" });
		    tiles.push({ num: String(stats.l1Count), label: "L1 原子记忆" });
		    tiles.push({ num: String(stats.sceneCount), label: "L2 场景块" });
		    tiles.push({ num: String(stats.pendingExtract), label: "待重试消息" });
		    infos.push(["数据目录", stats.dataDir]);
		    infos.push(["插件版本", "v" + stats.version]);
		    infos.push(["默认档", modeLabel(stats.family)]);
		    infos.push(["L1 累计抽取", String(stats.l1TotalExtracted)]);
		    infos.push(["L3 画像", stats.personaChars > 0 ? stats.personaChars + " 字符" : "未生成"]);
		    infos.push(["上次 L1 抽取", fmtTime(stats.lastExtractAt)]);
		    infos.push(["上次 L2 整合", fmtTime(stats.lastL2At)]);
		    infos.push(["上次 L3 蒸馏", fmtTime(stats.lastL3At)]);
		    infos.push(["待 L2 新记忆", stats.memoriesSinceL2 + " / " + (th.l2MinNewMemories != null ? th.l2MinNewMemories : 5)]);
		    infos.push(["待 L3 新记忆", stats.memoriesSinceL3 + " / " + (th.l3Interval != null ? th.l3Interval : 20)]);
		  }
		  const degraded = stats && stats.message && stats.message !== "running";
		  const master = settingsData && settingsData.settings ? settingsData.settings.enabled : true;
		  let ceilingNote = "";
		  if (settingsData && settingsData.ceilings) {
		    const off = [];
		    if (!settingsData.ceilings.capture) off.push("捕获");
		    if (!settingsData.ceilings.distill) off.push("蒸馏");
		    if (!settingsData.ceilings.recall) off.push("召回");
		    if (off.length > 0) ceilingNote = "注意：部署配置已停用 " + off.join("、") + "（运行时开关无法开启）";
		  }
		  const mutate = settingsData && settingsData.settings ? !!settingsData.settings.memoryMutate : false;
		  const cfEnabled = settingsData && settingsData.settings ? !!settingsData.settings.conflictFreeze : false;
		  const toolRoom = settingsData && settingsData.settings ? settingsData.settings.toolRoom !== false : true;
		  const toolGraph = settingsData && settingsData.settings ? settingsData.settings.toolGraph !== false : true;
		  const toolRuminate = settingsData && settingsData.settings ? settingsData.settings.toolRuminate !== false : true;
		  const toolConflict = settingsData && settingsData.settings ? settingsData.settings.toolConflict !== false : true;
		  const toolMutate = settingsData && settingsData.settings ? settingsData.settings.toolMutate !== false : true;
		  const skillsEnabled = settingsData && settingsData.settings ? settingsData.settings.skillsEnabled === true : false;
		  return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { children: [
		    settingsData && settingsData.supported === false ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { style: S.hint, children: "settings 服务不可用，记忆模式开关未启用（记忆保持全开）。" }) : settingsData ? /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { style: S.switchPanel, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { style: S.panelLabel, children: "记忆模式" }),
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
		        SwitchRow,
		        {
		          label: "记忆模式",
		          desc: master ? "已开启：捕获对话并蒸馏记忆" : "已关闭：不捕获、不蒸馏、不注入（数据保留）",
		          checked: master,
		          onChange: (v) => {
		            toggle("enabled", v);
		          }
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
		        SwitchRow,
		        {
		          label: "捕获",
		          desc: "L0：记录原始对话（关闭后蒸馏也无输入）",
		          checked: settingsData.settings.capture,
		          disabled: !master,
		          onChange: (v) => {
		            toggle("capture", v);
		          }
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
		        SwitchRow,
		        {
		          label: "蒸馏",
		          desc: "L1 抽取 + L2 场景 + L3 画像",
		          checked: settingsData.settings.distill,
		          disabled: !master,
		          onChange: (v) => {
		            toggle("distill", v);
		          }
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
		        SwitchRow,
		        {
		          label: "召回",
		          desc: "对话时注入相关记忆与画像",
		          checked: settingsData.settings.recall,
		          disabled: !master,
		          onChange: (v) => {
		            toggle("recall", v);
		          }
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { style: S.panelLabel, children: "高权限模式" }),
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
		        SwitchRow,
		        {
		          label: "高权限模式",
		          desc: mutate ? "已开启：模型获得记忆写入/删除工具，记忆 Tab 可删除指定记忆" : "默认关闭；开启后模型获得写删记忆工具，面板解锁记忆删除",
		          checked: mutate,
		          onChange: (v) => {
		            toggle("memoryMutate", v);
		          }
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { style: S.panelLabel, children: "技能结晶" }),
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
		        SwitchRow,
		        {
		          label: "技能（程序性记忆）",
		          desc: skillsEnabled ? "已开启：重复工作方法会结晶为技能候选，注入活跃技能，可在「技能」页审阅晋升" : "默认关闭；开启后注册 memory_skill_* 工具与注入（新装工具需重启后完全生效）",
		          checked: skillsEnabled,
		          onChange: (v) => {
		            toggle("skillsEnabled", v);
		          }
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { style: S.panelLabel, children: "工具封印" }),
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
		        SwitchRow,
		        {
		          label: "Room 管理工具",
		          desc: toolRoom ? "已注册：memory_room_admin / memory_room_review（目录治理）" : "已封印：两个工具从模型工具列表移除",
		          checked: toolRoom,
		          onChange: (v) => {
		            toggle("toolRoom", v);
		          }
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
		        SwitchRow,
		        {
		          label: "图谱工具",
		          desc: toolGraph ? "已注册：memory_search_graph / memory_expand_graph_node" : "已封印：图谱读工具从模型工具列表移除",
		          checked: toolGraph,
		          onChange: (v) => {
		            toggle("toolGraph", v);
		          }
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
		        SwitchRow,
		        {
		          label: "反刍工具",
		          desc: toolRuminate ? "已注册：memory_ruminate / _cancel / _status" : "已封印：反刍三件从模型工具列表移除",
		          checked: toolRuminate,
		          onChange: (v) => {
		            toggle("toolRuminate", v);
		          }
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
		        SwitchRow,
		        {
		          label: "冲突工具",
		          desc: toolConflict ? "已注册：memory_conflicts / _rejected / resolve_conflict" : "已封印：冲突三件从模型工具列表移除",
		          checked: toolConflict,
		          onChange: (v) => {
		            toggle("toolConflict", v);
		          }
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
		        SwitchRow,
		        {
		          label: "写删工具",
		          desc: toolMutate ? "已注册：memory_add / memory_import / memory_delete（仍需高权限模式）" : "已封印：L1 写删工具从模型工具列表移除（槽位三件不受此开关影响）",
		          checked: toolMutate,
		          onChange: (v) => {
		            toggle("toolMutate", v);
		          }
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { style: S.panelLabel, children: "人工冲突裁决" }),
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
		        SwitchRow,
		        {
		          label: "人工冲突裁决",
		          desc: cfEnabled ? '已开启：去重判定"两边都像对的"时冻结冲突对，停放到待人工裁决区' : "默认关闭；开启后冲突按 LLM 的 winner/loser 自动了结变为冻结，需人工裁决",
		          checked: cfEnabled,
		          onChange: (v) => {
		            toggle("conflictFreeze", v);
		          }
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { style: S.panelLabel, children: "蒸馏参数" }),
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(DistillSettings, { rpc, disabled: !master, data: settingsData, setData: setSettingsData, onError: setError }),
		      ceilingNote ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { style: S.hint, children: ceilingNote }) : null
		    ] }) : null,
		    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(EmbeddingSection, { rpc }),
		    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(RebuildPanel, { rpc }),
		    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(RuminatePanel, { rpc }),
		    degraded ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { style: { ...S.error, marginBottom: 10 }, children: "⚠ " + stats.message + "。上方数据为最后一次成功读取的值，记忆功能当前未工作。" }) : null,
		    error ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { style: S.error, children: "获取状态失败：" + error }) : !stats ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { style: S.intro, children: "正在读取记忆状态…" }) : /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { children: [
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { style: S.panelLabel, children: "记忆概况" }),
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { style: S.statGrid, children: tiles.map((t) => {
		        return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "dsh-mem-card", style: S.statTile, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { style: S.statNum, children: t.num }),
		          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { style: S.statLabel, children: t.label })
		        ] }, t.label);
		      }) }),
		      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { style: S.panelLabel, children: "运行状态" }),
		      infos.map((row2) => {
		        return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { style: S.infoRow, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { style: S.infoKey, children: row2[0] }),
		          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { style: S.infoVal, children: row2[1] })
		        ] }, row2[0]);
		      })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { style: S.hint, children: "浏览各层记忆内容请切换上方 Tab；原始对话（L0）不入浏览器，可由模型侧 conversation_search 工具查询。" })
		  ] });
		}
		
		// client/src/tabs/PersonaTab.tsx
		var import_react16 = require("react");
		var import_jsx_runtime16 = require("react/jsx-runtime");
		function PersonaTab(props) {
		  const rpc = props.rpc;
		  const [content, setContent] = (0, import_react16.useState)(null);
		  const [error, setError] = (0, import_react16.useState)(null);
		  const load = (0, import_react16.useCallback)(() => {
		    setError(null);
		    rpc("dsh-memory/persona", {}).then((r) => {
		      if (r && r.ok) setContent(r.value.content);
		      else setError(r && r.error ? r.error.message : "RPC error");
		    }).catch((e) => {
		      setError(String(e && e.message || e));
		    });
		  }, [rpc]);
		  (0, import_react16.useEffect)(() => {
		    load();
		  }, [load]);
		  return /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { children: [
		    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { style: { ...S.flexRow, marginBottom: 10 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { style: S.muted, children: error ? "加载失败" : content === null ? "加载中…" : content ? content.length + " 字符" : "未生成画像" }),
		      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { style: S.grow }),
		      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(NButton, { onClick: load, children: "刷新" })
		    ] }),
		    error ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { style: { ...S.error, marginBottom: 10 }, children: "画像读取失败：" + error + "（点右上“刷新”重试）" }) : null,
		    content ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("pre", { style: S.pre, children: content }) : content === null ? null : /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { style: S.intro, children: "画像尚未生成；蒸馏若干记忆后 L3 会自动产出。" })
		  ] });
		}
		
		// client/src/tabs/RecordsTab.tsx
		var import_react17 = require("react");
		var import_jsx_runtime17 = require("react/jsx-runtime");
		function retiredSelOf(r) {
		  if (r === "active") return false;
		  if (r === "retired") return true;
		  return void 0;
		}
		var TYPE_CHOICES = [
		  "persona",
		  "episodic",
		  "instruction",
		  "work_fact",
		  "work_task",
		  "work_method",
		  "work_artifact"
		];
		var DELETE_LIMIT = 200;
		function RecordsTab(props) {
		  const rpc = props.rpc;
		  const limit = 50;
		  const [items, setItems] = (0, import_react17.useState)([]);
		  const [hasMore, setHasMore] = (0, import_react17.useState)(false);
		  const [total, setTotal] = (0, import_react17.useState)(null);
		  const [sceneOptions, setSceneOptions] = (0, import_react17.useState)([]);
		  const [loading, setLoading] = (0, import_react17.useState)(false);
		  const [truncated, setTruncated] = (0, import_react17.useState)(false);
		  const [error, setError] = (0, import_react17.useState)(null);
		  const [expandedId, setExpandedId] = (0, import_react17.useState)(null);
		  const [sel, setSel] = (0, import_react17.useState)(/* @__PURE__ */ new Set());
		  const [hiPriv, setHiPriv] = (0, import_react17.useState)(false);
		  const [hiPrivBusy, setHiPrivBusy] = (0, import_react17.useState)(false);
		  const [query, setQuery] = (0, import_react17.useState)("");
		  const [typeFilter, setTypeFilter] = (0, import_react17.useState)("");
		  const [sceneFilter, setSceneFilter] = (0, import_react17.useState)("");
		  const [hallFilter, setHallFilter] = (0, import_react17.useState)([]);
		  const [tagFilter, setTagFilter] = (0, import_react17.useState)("");
		  const [untaggedOnly, setUntaggedOnly] = (0, import_react17.useState)(false);
		  const [orphanCount, setOrphanCount] = (0, import_react17.useState)(0);
		  const [retiredFilter, setRetiredFilter] = (0, import_react17.useState)("");
		  const [wingCatalog, setHallCatalog] = (0, import_react17.useState)(null);
		  const [last, setLast] = (0, import_react17.useState)({ query: "", type: "", scene: "", halls: [], tag: "", untagged: false, retired: "" });
		  const seqRef = (0, import_react17.useRef)(0);
		  const fetchPage = (0, import_react17.useCallback)(
		    (conds, offset, append) => {
		      setLoading(true);
		      setError(null);
		      const token = ++seqRef.current;
		      const payload = { limit, offset };
		      if (conds.query) payload.query = conds.query;
		      if (conds.type) payload.type = conds.type;
		      if (conds.scene) payload.scene = conds.scene;
		      if (conds.halls.length > 0) payload.halls = conds.halls;
		      if (conds.tag) payload.tag = conds.tag;
		      if (conds.untagged) payload.untagged = true;
		      const retiredSel = retiredSelOf(conds.retired);
		      if (retiredSel !== void 0) payload.retired = retiredSel;
		      rpc("dsh-memory/list-records", payload).then((r) => {
		        if (token !== seqRef.current) return;
		        setLoading(false);
		        if (!r || !r.ok) {
		          setError(r && r.error ? r.error.message : "RPC error");
		          return;
		        }
		        const v = r.value;
		        setItems((prev) => append ? prev.concat(v.items) : v.items);
		        if (v.usageSummary) setUsageSummary(v.usageSummary);
		        if (!append) setSel(/* @__PURE__ */ new Set());
		        setHasMore(!!v.hasMore);
		        setTotal(v.total === void 0 || v.total === null ? null : v.total);
		        setTruncated(!!v.truncated);
		        if (v.scenes) setSceneOptions(v.scenes);
		        if (v.wingCatalog) setHallCatalog(v.wingCatalog);
		      }).catch((e) => {
		        if (token !== seqRef.current) return;
		        setLoading(false);
		        setError(String(e && e.message || e));
		      });
		    },
		    [rpc]
		  );
		  const search = () => {
		    const conds = { query: query.trim(), type: typeFilter, scene: sceneFilter, halls: hallFilter, tag: tagFilter, untagged: untaggedOnly, retired: retiredFilter };
		    setLast(conds);
		    fetchPage(conds, 0, false);
		  };
		  const applyRetiredFilter = (next) => {
		    setRetiredFilter(next);
		    const conds = { query: query.trim(), type: typeFilter, scene: sceneFilter, halls: hallFilter, tag: tagFilter, untagged: untaggedOnly, retired: next };
		    setLast(conds);
		    fetchPage(conds, 0, false);
		  };
		  const loadRooms = (0, import_react17.useCallback)(() => {
		    rpc("dsh-memory/rooms-get", {}).then((r) => {
		      if (r && r.ok) setOrphanCount(r.value.orphanCount ?? 0);
		    }).catch(() => {
		    });
		  }, [rpc]);
		  (0, import_react17.useEffect)(() => {
		    fetchPage({ query: "", type: "", scene: "", halls: [], tag: "", untagged: false, retired: "" }, 0, false);
		    loadRooms();
		  }, [fetchPage, loadRooms]);
		  const loadHiPriv = (0, import_react17.useCallback)(() => {
		    rpc("dsh-memory/settings-get", {}).then((r) => {
		      if (r && r.ok && r.value) setHiPriv(!!r.value.settings.memoryMutate);
		    }).catch(() => {
		    });
		  }, [rpc]);
		  (0, import_react17.useEffect)(() => {
		    loadHiPriv();
		  }, [loadHiPriv]);
		  const toggleHiPriv = () => {
		    const next = !hiPriv;
		    if (next && !window.confirm("开启高权限模式：模型获得写入/删除记忆工具，记忆库可删除指定记忆。确定开启？")) return;
		    setHiPrivBusy(true);
		    rpc("dsh-memory/settings-set", { memoryMutate: next }).then((r) => {
		      if (r && r.ok) setHiPriv(next);
		      else if (r) setError(r.error ? r.error.message : "切换高权限模式失败");
		      setHiPrivBusy(false);
		      loadHiPriv();
		    }).catch((e) => {
		      setHiPrivBusy(false);
		      setError(String(e && e.message || e));
		    });
		  };
		  const toggleSel = (id) => {
		    setSel((prev) => {
		      const next = new Set(prev);
		      if (next.has(id)) next.delete(id);
		      else next.add(id);
		      return next;
		    });
		  };
		  const deleteSelected = () => {
		    const ids = Array.from(sel);
		    if (ids.length === 0) return;
		    if (!hiPriv) {
		      setError("高权限模式未开启：请在右上「高权限：关」或概览页开关中开启后，再退场记忆。");
		      return;
		    }
		    if (ids.length > DELETE_LIMIT) {
		      setError("一次最多退场 " + DELETE_LIMIT + " 条（当前勾选 " + ids.length + " 条），请分批操作。");
		      return;
		    }
		    if (!window.confirm("退场勾选的 " + ids.length + " 条记忆？\n\n它们会移出检索面（不再被召回），但记录仍保留 —— 可在下方「已退场」区恢复。")) return;
		    rpc("dsh-memory/records-delete", { ids }).then((r) => {
		      if (r && r.ok) {
		        setSel(/* @__PURE__ */ new Set());
		        if (expandedId && ids.indexOf(expandedId) >= 0) setExpandedId(null);
		        fetchPage(last, 0, false);
		        if (showRetired) loadRetired();
		      } else if (r) setError(r.error ? r.error.message : "退场失败");
		    }).catch((e) => setError(String(e && e.message || e)));
		  };
		  const deleteRecord = (id) => {
		    if (!window.confirm("退场该条记忆？\n\n它会移出检索面（不再被召回），但记录仍保留 —— 可在下方「已退场」区恢复。")) return;
		    rpc("dsh-memory/records-delete", { ids: [id] }).then((r) => {
		      if (r && r.ok) {
		        setSel((prev) => {
		          const next = new Set(prev);
		          next.delete(id);
		          return next;
		        });
		        if (expandedId === id) setExpandedId(null);
		        fetchPage(last, 0, false);
		        if (showRetired) loadRetired();
		      } else if (r) setError(r.error ? r.error.message : "退场失败");
		    }).catch((e) => setError(String(e && e.message || e)));
		  };
		  const [retired, setRetired] = (0, import_react17.useState)([]);
		  const [retiredTotal, setRetiredTotal] = (0, import_react17.useState)(0);
		  const [showRetired, setShowRetired] = (0, import_react17.useState)(false);
		  const [retiredBusy, setRetiredBusy] = (0, import_react17.useState)(false);
		  const loadRetired = (0, import_react17.useCallback)(() => {
		    setRetiredBusy(true);
		    rpc("dsh-memory/records-retired", { limit: 100, offset: 0 }).then((r) => {
		      if (r && r.ok) {
		        setRetired(r.value.items);
		        setRetiredTotal(r.value.total);
		      } else if (r) setError(r.error ? r.error.message : "已退场列表加载失败");
		    }).catch((e) => setError(String(e && e.message || e))).finally(() => setRetiredBusy(false));
		  }, [rpc]);
		  (0, import_react17.useEffect)(() => {
		    if (showRetired) loadRetired();
		  }, [showRetired, loadRetired]);
		  const restoreRecords = (ids) => {
		    if (ids.length === 0) return;
		    setRetiredBusy(true);
		    rpc("dsh-memory/records-restore", { ids }).then((r) => {
		      if (r && r.ok) {
		        loadRetired();
		        fetchPage(last, 0, false);
		      } else if (r) setError(r.error ? r.error.message : "恢复失败");
		    }).catch((e) => setError(String(e && e.message || e))).finally(() => setRetiredBusy(false));
		  };
		  const RETIRE_REASON_LABEL = {
		    conflict: "裁决退场",
		    superseded: "被取代",
		    manual: "人工退场",
		    obsolete: "声明过时",
		    unknown: "已退场"
		  };
		  const countText = total !== null ? "共 " + total + " 条" : items.length + " 条" + (hasMore ? "+" : "");
		  const [usageSummary, setUsageSummary] = (0, import_react17.useState)(null);
		  const selCount = sel.size;
		  return /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { children: [
		    /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { style: S.toolbar, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
		        NInput,
		        {
		          style: { flex: 1, minWidth: 160 },
		          placeholder: "搜索记忆内容（BM25 关键词）…",
		          value: query,
		          onChange: (e) => {
		            setQuery(e.target.value);
		          },
		          onKeyDown: (e) => {
		            if (e.key === "Enter") search();
		          }
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
		        NSel,
		        {
		          style: { maxWidth: 200 },
		          options: [{ id: "", label: "全部类型" }].concat(
		            TYPE_CHOICES.map((t) => {
		              return { id: t, label: TYPE_LABELS[t] || t };
		            })
		          ),
		          value: typeFilter,
		          onChange: setTypeFilter
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
		        NSel,
		        {
		          style: { maxWidth: 220 },
		          options: [{ id: "", label: "全部情境" }].concat(
		            sceneOptions.map((s) => {
		              return { id: s, label: s.length > 24 ? s.slice(0, 24) + "…" : s };
		            })
		          ),
		          value: sceneFilter,
		          onChange: setSceneFilter
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
		        WingMultiSelect,
		        {
		          options: wingCatalog ?? Array.from(new Set(items.map((m) => m.hall).filter((h) => !!h))).map((id) => ({ id, label: id })),
		          selected: hallFilter,
		          onChange: setHallFilter
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(NButton, { onClick: search, children: "搜索" }),
		      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
		        NButton,
		        {
		          style: {
		            color: hiPriv ? "var(--dsh-mem-danger)" : void 0,
		            border: hiPriv ? "1px solid var(--dsh-mem-danger)" : void 0
		          },
		          disabled: hiPrivBusy,
		          title: hiPriv ? "关闭高权限模式（收回模型写删工具与删除权限）" : "开启高权限模式以写删记忆",
		          onClick: toggleHiPriv,
		          children: hiPriv ? "高权限：开" : "高权限：关"
		        }
		      )
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { style: { marginBottom: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
		        "button",
		        {
		          type: "button",
		          title: untaggedOnly ? "取消孤儿筛选" : "只看没有任何 Room 绑定的记忆",
		          onClick: () => {
		            const next = !untaggedOnly;
		            setUntaggedOnly(next);
		            if (next) setTagFilter("");
		            const conds = { query: query.trim(), type: typeFilter, scene: sceneFilter, halls: hallFilter, tag: next ? "" : tagFilter, untagged: next, retired: retiredFilter };
		            setLast(conds);
		            fetchPage(conds, 0, false);
		          },
		          style: {
		            cursor: "pointer",
		            fontSize: 12,
		            padding: "2px 8px",
		            borderRadius: 999,
		            border: untaggedOnly ? "1px solid var(--dsh-mem-accent)" : "1px solid var(--dsh-mem-border)",
		            background: untaggedOnly ? "var(--dsh-mem-bg-inset)" : "transparent",
		            color: untaggedOnly ? "var(--dsh-mem-accent)" : "var(--dsh-mem-text-2)"
		          },
		          children: "无绑定 · " + orphanCount
		        }
		      ),
		      (tagFilter || untaggedOnly) && /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("span", { style: S.muted, children: [
		        "筛选中:",
		        untaggedOnly ? "无绑定" : tagFilter,
		        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
		          "button",
		          {
		            type: "button",
		            title: "清除 Room/孤儿筛选",
		            onClick: () => {
		              setTagFilter("");
		              setUntaggedOnly(false);
		              const conds = { query: query.trim(), type: typeFilter, scene: sceneFilter, halls: hallFilter, tag: "", untagged: false, retired: retiredFilter };
		              setLast(conds);
		              fetchPage(conds, 0, false);
		            },
		            style: { cursor: "pointer", marginLeft: 6, background: "transparent", border: "none", color: "var(--dsh-mem-accent)", fontSize: 12 },
		            children: "×清除"
		          }
		        )
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
		        "button",
		        {
		          type: "button",
		          title: "导出无 Room 绑定的孤儿清单 CSV(含候选)",
		          onClick: () => {
		            rpc("dsh-memory/rooms-export", { kind: "orphans" }).then((r) => {
		              if (!r || !r.ok || !r.value?.csv) return;
		              const blob = new Blob([r.value.csv], { type: "text/csv;charset=utf-8" });
		              const url = URL.createObjectURL(blob);
		              const a = document.createElement("a");
		              a.href = url;
		              a.download = "dsh-memory-room-orphans.csv";
		              a.click();
		              URL.revokeObjectURL(url);
		            }).catch(() => void 0);
		          },
		          style: {
		            cursor: "pointer",
		            fontSize: 12,
		            padding: "2px 8px",
		            borderRadius: 6,
		            border: "1px solid var(--dsh-mem-border)",
		            background: "transparent",
		            color: "var(--dsh-mem-text-2)"
		          },
		          children: "导出孤儿"
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { style: S.muted, children: "Room 标签/分类管理:见「Hall」「Room」标签页。" })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { style: { ...S.flexRow, marginBottom: 10 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { style: S.muted, children: loading ? "加载中…" : countText }),
		      usageSummary ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { style: S.muted, title: "老化权重效果口径:参与召回尝试的记忆中,进 topN(被注入上下文)的比例", children: "召回使用 " + usageSummary.used + "/" + usageSummary.attempted + "(" + usageSummary.rate + "%)" }) : null,
		      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { style: S.muted, children: "退场筛查" }),
		      [["", "全部"], ["active", "仅活跃"], ["retired", "仅退场"]].map(([val, label]) => {
		        const on = retiredFilter === val;
		        return /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
		          "button",
		          {
		            type: "button",
		            title: val === "" ? "活跃与已退场混排（已退场的带徽标）" : val === "active" ? "只看未退场的记忆" : "只看已退场（软删）的记忆，可在此恢复",
		            onClick: () => applyRetiredFilter(val),
		            style: {
		              cursor: "pointer",
		              fontSize: 12,
		              padding: "2px 10px",
		              borderRadius: 999,
		              border: on ? "1px solid var(--dsh-mem-accent)" : "1px solid var(--dsh-mem-border)",
		              background: on ? "var(--dsh-mem-bg-inset)" : "transparent",
		              color: on ? "var(--dsh-mem-accent)" : "var(--dsh-mem-text-2)"
		            },
		            children: label
		          },
		          val
		        );
		      }),
		      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
		        NButton,
		        {
		          style: selCount > 0 ? { color: "var(--dsh-mem-danger)" } : void 0,
		          disabled: selCount === 0,
		          title: hiPriv ? "删除勾选的记忆（一次最多 " + DELETE_LIMIT + " 条）" : "高权限模式未开启，删除不可用",
		          onClick: deleteSelected,
		          children: "删除选中" + (selCount > 0 ? "（" + selCount + "）" : "")
		        }
		      ),
		      selCount > 0 ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
		        NButton,
		        {
		          onClick: () => {
		            setSel(/* @__PURE__ */ new Set());
		          },
		          children: "清空选择"
		        }
		      ) : null,
		      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { style: S.grow }),
		      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
		        NButton,
		        {
		          onClick: () => {
		            fetchPage(last, 0, false);
		            loadRooms();
		          },
		          children: "刷新"
		        }
		      )
		    ] }),
		    !hiPriv ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { style: S.hint, children: "提示：删除记忆需先开启高权限模式（右上开关或概览页「高权限模式」），关闭时删除按钮不可用。" }) : null,
		    error ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { style: S.error, children: error }) : null,
		    truncated ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { style: S.hint, children: "搜索分页已达检索上限（200 条），更早的结果未显示。请用更精确的关键词或类型/情境过滤。" }) : null,
		    items.length === 0 && !loading && !error ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { style: S.intro, children: "暂无记忆。对话几轮后，蒸馏管线会自动抽取记忆。" }) : items.map((m) => {
		      const open = expandedId === m.id;
		      const checked = sel.has(m.id);
		      return /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)(
		        "div",
		        {
		          className: "dsh-mem-card dsh-mem-card-hover",
		          style: { ...S.card, cursor: "pointer", ...checked ? { borderLeft: "3px solid var(--dsh-mem-danger)" } : null, ...m.retired ? { opacity: 0.62 } : null },
		          onClick: () => {
		            setExpandedId(open ? null : m.id);
		          },
		          children: [
		            /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { style: S.cardHead, children: [
		              /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
		                "input",
		                {
		                  type: "checkbox",
		                  checked,
		                  style: { margin: 0, cursor: "pointer", flexShrink: 0 },
		                  title: "勾选以批量删除",
		                  onClick: (e) => {
		                    e.stopPropagation();
		                  },
		                  onChange: () => {
		                    toggleSel(m.id);
		                  }
		                }
		              ),
		              /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: "dsh-mem-tag dsh-mem-tag-" + m.type, children: TYPE_LABELS[m.type] || m.type }),
		              m.hall ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: "dsh-mem-tag dsh-mem-tag-work-fact", children: "Wing · " + (wingCatalog?.find((h) => h.id === m.hall)?.label || m.hall) }) : null,
		              m.retired ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
		                "span",
		                {
		                  title: "该记忆已退场（软删）：移出检索面但仍可恢复，并未真正删除",
		                  style: {
		                    fontSize: 11,
		                    padding: "1px 6px",
		                    borderRadius: 999,
		                    border: "1px solid var(--dsh-mem-danger)",
		                    color: "var(--dsh-mem-danger)",
		                    whiteSpace: "nowrap"
		                  },
		                  children: "已退场" + (m.retiredReason ? " · " + (RETIRE_REASON_LABEL[m.retiredReason] || m.retiredReason) : "")
		                }
		              ) : null,
		              /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { style: S.muted, children: "优先级 " + m.priority }),
		              m.maturity ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
		                "span",
		                {
		                  title: "成熟度（优先级 + 被用次数 + 新鲜度合成）：" + m.maturity,
		                  style: {
		                    fontSize: 11,
		                    padding: "1px 6px",
		                    borderRadius: 999,
		                    whiteSpace: "nowrap",
		                    border: "1px solid var(--dsh-mem-border)",
		                    color: "var(--dsh-mem-text-2)"
		                  },
		                  children: m.maturity === "high" ? "成熟·高" : m.maturity === "mid" ? "成熟·中" : "成熟·低"
		                }
		              ) : null,
		              m.agingWeight != null ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
		                "span",
		                {
		                  style: {
		                    fontSize: 11,
		                    padding: "1px 6px",
		                    borderRadius: 999,
		                    whiteSpace: "nowrap",
		                    border: "1px solid " + (m.agingWeight <= 0.6 ? "var(--dsh-mem-danger)" : "var(--dsh-mem-border)"),
		                    color: m.agingWeight <= 0.6 ? "var(--dsh-mem-danger)" : "var(--dsh-mem-text-2)"
		                  },
		                  title: "老化权重 " + Math.round(m.agingWeight * 100) + "%(读路径衰减系数 max(0.5, 0.5^(Δ天/半衰期)));越低越老",
		                  children: "老化 " + Math.round(m.agingWeight * 100) + "%"
		                }
		              ) : null,
		              m.usage ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
		                "span",
		                {
		                  style: S.muted,
		                  title: "召回使用 " + m.usage.used + "/" + m.usage.attempts + "(进 topN 才算 used)" + (m.usage.lastUsedAt ? ";最近使用 " + fmtTime(new Date(m.usage.lastUsedAt).toISOString()) : "") + (m.usage.lastAttemptAt ? ";最近尝试 " + fmtTime(new Date(m.usage.lastAttemptAt).toISOString()) : ""),
		                  children: "用 " + m.usage.used + "/" + m.usage.attempts
		                }
		              ) : null,
		              m.score !== null && m.score !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { style: S.muted, children: "相关度 " + Number(m.score).toFixed(2) }) : null,
		              /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { style: S.grow }),
		              /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { style: S.muted, children: fmtTime(m.updatedAt) }),
		              m.retired ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
		                NButton,
		                {
		                  style: { padding: "0 7px", minWidth: 26, height: 26, fontSize: 12, color: "var(--dsh-mem-accent)" },
		                  title: "恢复该记忆到检索面（可撤销退场）",
		                  onClick: (e) => {
		                    e.stopPropagation();
		                    restoreRecords([m.id]);
		                  },
		                  children: "恢复"
		                }
		              ) : hiPriv ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
		                NButton,
		                {
		                  style: { padding: "0 7px", minWidth: 26, height: 26, fontSize: 12, color: "var(--dsh-mem-danger)" },
		                  title: "删除该记忆（高权限）",
		                  onClick: (e) => {
		                    e.stopPropagation();
		                    deleteRecord(m.id);
		                  },
		                  children: "✕"
		                }
		              ) : null
		            ] }),
		            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { style: S.content, children: m.content }),
		            open ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { style: S.detail, children: "id: " + m.id + "\n情境: " + (m.scene || "-") + "\n版本: v" + m.version + "（去重合并次数 " + m.version + "）\n创建: " + fmtTime(m.createdAt) + "\n活跃时间: " + (m.timestamps && m.timestamps.length > 0 ? m.timestamps.map(fmtTime).join(" → ") : "-") + "\n" + (m.sourceAnchors && m.sourceAnchors.length > 0 ? "来源锚点: " + m.sourceAnchors.join(", ") : "来源锚点: -") }) : null
		          ]
		        },
		        m.id
		      );
		    }),
		    /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { style: { ...S.flexRow, marginTop: 12 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(NButton, { onClick: () => setShowRetired((v) => !v), children: (showRetired ? "收起" : "展开") + "「已退场」（可恢复）" }),
		      showRetired && retiredBusy ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { style: S.muted, children: "加载中…" }) : null,
		      showRetired && !retiredBusy && retiredTotal > 0 ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { style: S.muted, children: "共 " + retiredTotal + " 条可恢复" }) : null
		    ] }),
		    showRetired ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { style: { marginTop: 8 }, children: retired.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { style: S.hint, children: retiredBusy ? " " : "没有已退场的记忆。" }) : /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { children: [
		      retired.map((m) => /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "dsh-mem-card", style: S.card, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { style: S.cardHead, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { style: S.muted, children: RETIRE_REASON_LABEL[m.retiredReason] || m.retiredReason }),
		          m.verdict ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { style: S.muted, children: "结论 " + m.verdict }) : null,
		          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { style: S.grow }),
		          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { style: S.muted, children: fmtTime(m.retiredAt) }),
		          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(NButton, { disabled: retiredBusy, title: "恢复到检索面", onClick: () => restoreRecords([m.id]), children: "恢复" })
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { style: S.content, children: m.content })
		      ] }, m.id)),
		      retiredTotal > retired.length ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { style: S.hint, children: "共 " + retiredTotal + " 条，此处显示 " + retired.length + " 条" }) : null
		    ] }) }) : null,
		    hasMore ? /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { style: S.flexRow, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { style: S.grow }),
		      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
		        NButton,
		        {
		          disabled: loading,
		          onClick: () => {
		            if (!loading) fetchPage(last, items.length, true);
		          },
		          children: loading ? "加载中…" : "加载更多"
		        }
		      )
		    ] }) : null
		  ] });
		}
		function WingMultiSelect(props) {
		  const [open, setOpen] = (0, import_react17.useState)(false);
		  const wrapRef = (0, import_react17.useRef)(null);
		  (0, import_react17.useEffect)(() => {
		    if (!open) return;
		    const onDown = (e) => {
		      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
		    };
		    const onKey = (e) => {
		      if (e.key === "Escape") setOpen(false);
		    };
		    document.addEventListener("pointerdown", onDown);
		    document.addEventListener("keydown", onKey);
		    return () => {
		      document.removeEventListener("pointerdown", onDown);
		      document.removeEventListener("keydown", onKey);
		    };
		  }, [open]);
		  const labelOf = (id) => props.options.find((o) => o.id === id)?.label ?? id;
		  const summary = props.selected.length === 0 ? "全部 Wing" : props.selected.length <= 2 ? props.selected.map(labelOf).join(" + ") : `${labelOf(props.selected[0])} 等 ${props.selected.length} 域`;
		  const toggle = (id) => {
		    props.onChange(props.selected.includes(id) ? props.selected.filter((x) => x !== id) : [...props.selected, id]);
		  };
		  return /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { ref: wrapRef, style: { position: "relative", maxWidth: 150 }, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)(
		      "button",
		      {
		        type: "button",
		        className: "dsh-mem-select",
		        "aria-haspopup": "listbox",
		        "aria-expanded": open,
		        onClick: () => setOpen(!open),
		        children: [
		          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: "dsh-mem-select-label", title: summary, children: summary }),
		          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: "dsh-mem-sel-chev" + (open ? " dsh-mem-sel-chev-open" : "") })
		        ]
		      }
		    ),
		    open ? /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "dsh-mem-pop", role: "listbox", style: { left: 0, right: "auto", minWidth: 150 }, children: [
		      props.options.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { className: "dsh-mem-pop-empty", children: "暂无可筛 Hall" }) : null,
		      props.options.map((o) => {
		        const active = props.selected.includes(o.id);
		        return /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("button", { type: "button", className: "dsh-mem-pop-opt", onClick: () => toggle(o.id), "aria-selected": active, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: "dsh-mem-pop-check", children: active ? "✓" : "" }),
		          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: "dsh-mem-pop-label", children: o.label })
		        ] }, o.id);
		      }),
		      props.selected.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("button", { type: "button", className: "dsh-mem-pop-opt", onClick: () => props.onChange([]), children: [
		        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: "dsh-mem-pop-check" }),
		        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: "dsh-mem-pop-label", children: "清除筛选" })
		      ] }) : null
		    ] }) : null
		  ] });
		}
		
		// client/src/tabs/RoomsTab.tsx
		var import_react18 = require("react");
		var import_jsx_runtime18 = require("react/jsx-runtime");
		function majorOf(slug) {
		  const i = slug.indexOf("/");
		  return i === -1 ? slug : slug.slice(0, i);
		}
		function suffixOf(slug) {
		  const i = slug.indexOf("/");
		  return i === -1 ? slug : slug.slice(i + 1);
		}
		function downloadCsv(csv, name) {
		  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
		  const url = URL.createObjectURL(blob);
		  const a = document.createElement("a");
		  a.href = url;
		  a.download = name;
		  a.click();
		  URL.revokeObjectURL(url);
		}
		var btn = {
		  cursor: "pointer",
		  fontSize: 12,
		  padding: "2px 8px",
		  borderRadius: 6,
		  border: "1px solid var(--dsh-mem-border)",
		  background: "transparent",
		  color: "var(--dsh-mem-text-2)"
		};
		function RoomsTab(props) {
		  const rpc = props.rpc;
		  const [registry, setRegistry] = (0, import_react18.useState)([]);
		  const [rooms, setRooms] = (0, import_react18.useState)([]);
		  const [orphanCount, setOrphanCount] = (0, import_react18.useState)(0);
		  const [busy, setBusy] = (0, import_react18.useState)(false);
		  const [msg, setMsg] = (0, import_react18.useState)(null);
		  const [error, setError] = (0, import_react18.useState)(null);
		  const [hiPriv, setHiPriv] = (0, import_react18.useState)(false);
		  const [hiPrivBusy, setHiPrivBusy] = (0, import_react18.useState)(false);
		  const [regSlug, setRegSlug] = (0, import_react18.useState)("");
		  const [regLabel, setRegLabel] = (0, import_react18.useState)("");
		  const [regDesc, setRegDesc] = (0, import_react18.useState)("");
		  const [form, setForm] = (0, import_react18.useState)(null);
		  const [preview, setPreview] = (0, import_react18.useState)(null);
		  const [grownOpen, setGrownOpen] = (0, import_react18.useState)(false);
		  const [dragOverHall, setDragOverHall] = (0, import_react18.useState)(null);
		  const [picking, setPicking] = (0, import_react18.useState)(null);
		  const [editing, setEditing] = (0, import_react18.useState)(null);
		  const [expandedRooms, setExpandedRooms] = (0, import_react18.useState)(/* @__PURE__ */ new Set());
		  const [roomRecords, setRoomRecords] = (0, import_react18.useState)({});
		  const [expandedHalls, setExpandedHalls] = (0, import_react18.useState)(() => {
		    try {
		      const v = window.localStorage.getItem("dsh.memory.halls.open");
		      return v ? new Set(JSON.parse(v)) : /* @__PURE__ */ new Set();
		    } catch {
		      return /* @__PURE__ */ new Set();
		    }
		  });
		  const [filter, setFilter] = (0, import_react18.useState)("");
		  const dragRef = (0, import_react18.useRef)(null);
		  const [ghost, setGhost] = (0, import_react18.useState)(null);
		  const onDragLabelDown = (ev, slug) => {
		    if (!hiPriv || busy || ev.button !== 0) return;
		    ev.currentTarget.setPointerCapture(ev.pointerId);
		    dragRef.current = { from: slug, x: ev.clientX, y: ev.clientY, active: false };
		  };
		  const onDragLabelMove = (ev) => {
		    const d = dragRef.current;
		    if (!d) return;
		    if (!d.active && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 6) d.active = true;
		    if (!d.active) return;
		    setGhost({ x: ev.clientX, y: ev.clientY, text: d.from });
		    const hall = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.("[data-hall]")?.getAttribute("data-hall") ?? null;
		    setDragOverHall(hall);
		  };
		  const onDragLabelUp = (ev) => {
		    const d = dragRef.current;
		    dragRef.current = null;
		    setGhost(null);
		    if (!d) return;
		    if (!d.active) return;
		    const hall = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.("[data-hall]")?.getAttribute("data-hall");
		    setDragOverHall(null);
		    if (hall) beginReclass(d.from, hall);
		  };
		  const loadAll = (0, import_react18.useCallback)(() => {
		    rpc("dsh-memory/rooms-get", {}).then((r) => {
		      if (r && r.ok) {
		        setRooms(r.value.rooms ?? []);
		        setRegistry(r.value.registry ?? []);
		        setOrphanCount(r.value.orphanCount ?? 0);
		      }
		    }).catch(() => void 0);
		  }, [rpc]);
		  const loadHiPriv = (0, import_react18.useCallback)(() => {
		    rpc("dsh-memory/settings-get", {}).then((r) => {
		      if (r && r.ok && r.value) setHiPriv(!!r.value.settings.memoryMutate);
		    }).catch(() => {
		    });
		  }, [rpc]);
		  (0, import_react18.useEffect)(() => {
		    loadAll();
		    loadHiPriv();
		  }, [loadAll, loadHiPriv]);
		  const toggleHiPriv = () => {
		    const next = !hiPriv;
		    if (next && !window.confirm("开启高权限模式:模型获得写入/删除记忆工具,并解锁 Hall 页的分类管理操作。确定开启?")) return;
		    setHiPrivBusy(true);
		    rpc("dsh-memory/settings-set", { memoryMutate: next }).then((r) => {
		      if (r && r.ok) setHiPriv(next);
		      else if (r) setError(r.error ? r.error.message : "切换高权限模式失败");
		      setHiPrivBusy(false);
		      loadHiPriv();
		    }).catch((e) => {
		      setHiPrivBusy(false);
		      setError(String(e && e.message || e));
		    });
		  };
		  const run = (fn) => {
		    if (busy) return;
		    setBusy(true);
		    setError(null);
		    setMsg(null);
		    fn().finally(() => setBusy(false));
		  };
		  const register = () => run(async () => {
		    const r = await rpc("dsh-memory/room-register", {
		      slug: regSlug.trim(),
		      label: regLabel.trim() || void 0,
		      description: regDesc.trim() || void 0
		    });
		    if (r && r.ok) {
		      setMsg(r.value?.notice ?? `已注册:${regSlug.trim()}`);
		      setRegSlug("");
		      setRegLabel("");
		      setRegDesc("");
		      loadAll();
		    } else setError(r && r.error ? r.error.message : "注册失败");
		  });
		  const adopt = (slug) => run(async () => {
		    const r = await rpc("dsh-memory/room-register", { slug, source: "grown" });
		    if (r && r.ok) {
		      setMsg(`已收编:${slug}(source=grown)`);
		      loadAll();
		    } else setError(r && r.error ? r.error.message : "收编失败");
		  });
		  const previewMerge = (override) => run(async () => {
		    const fm = override ?? form;
		    if (!fm) return;
		    const to = fm.to.trim();
		    if (!to) {
		      setError("目标 slug 不能为空");
		      return;
		    }
		    if (to === fm.from) {
		      setError("目标与源相同");
		      return;
		    }
		    const r = await rpc("dsh-memory/room-admin", { action: fm.action, from: fm.from, to });
		    if (r && r.ok) {
		      setPreview({ action: fm.action, from: fm.from, to, notice: String(r.value?.notice ?? "") });
		    } else setError(r && r.error ? r.error.message : "预览失败");
		  });
		  const beginReclass = (from, hall) => {
		    if (!busy) {
		      setMsg(null);
		      setError(null);
		    }
		    if (!hall) {
		      setError("尚无 hall:先注册一个(如 dsh-plugin),再归类。");
		      return;
		    }
		    if (majorOf(from) === hall) {
		      if (registry.some((e) => e.slug === from)) {
		        setMsg(`${from} 已在 ${hall} 下。`);
		        return;
		      }
		      setPicking(null);
		      void adopt(from);
		      return;
		    }
		    const f = { action: "rename", from, to: `${hall}/${suffixOf(from)}` };
		    setForm(f);
		    setPreview(null);
		    void previewMerge(f);
		  };
		  const execMerge = () => run(async () => {
		    if (!preview) return;
		    if (preview.action === "rename" && !registry.some((e) => e.slug === preview.from)) {
		      const rr = await rpc("dsh-memory/room-register", { slug: preview.from, source: "grown" });
		      if (!rr || !rr.ok) {
		        setError(rr && rr.error ? rr.error.message : "收编源失败");
		        return;
		      }
		    }
		    const r = await rpc("dsh-memory/room-admin", { action: preview.action, from: preview.from, to: preview.to, dryRun: false });
		    if (r && r.ok) {
		      setMsg(String(r.value?.notice ?? "完成"));
		      setPreview(null);
		      setForm(null);
		      loadAll();
		    } else setError(r && r.error ? r.error.message : "执行失败");
		  });
		  const retire = (slug, active, withRecords = false) => run(async () => {
		    if (!active) {
		      const tip = withRecords ? `退役 Room:${slug} 并退场其下全部记忆?(记录为软删,可在记忆页「已退场」区逐条恢复)` : `退役 Room:${slug}?(存量记录的 tags 不动,仅词表不再推荐;可随时恢复)`;
		      if (!window.confirm(tip)) return;
		    }
		    const r = await rpc("dsh-memory/room-admin", { action: "retire", slug, active, withRecords: withRecords || void 0 });
		    if (r && r.ok) {
		      setMsg(String(r.value?.notice ?? "完成"));
		      loadAll();
		      if (expandedRooms.has(slug)) {
		        const rr = await rpc("dsh-memory/list-records", { tag: slug, limit: 10, retired: false });
		        if (rr && rr.ok) setRoomRecords((m) => ({ ...m, [slug]: { items: rr.value.items, total: rr.value.total ?? null } }));
		      }
		    } else setError(r && r.error ? r.error.message : "操作失败");
		  });
		  const saveEditing = () => run(async () => {
		    if (!editing) return;
		    const r = await rpc("dsh-memory/room-admin", { action: "update", slug: editing.slug, label: editing.label, description: editing.description });
		    if (r && r.ok) {
		      setMsg(String(r.value?.notice ?? "已更新"));
		      setEditing(null);
		      loadAll();
		    } else setError(r && r.error ? r.error.message : "更新失败");
		  });
		  const toggleRoomExpand = (slug) => run(async () => {
		    if (expandedRooms.has(slug)) {
		      const next = new Set(expandedRooms);
		      next.delete(slug);
		      setExpandedRooms(next);
		      return;
		    }
		    const r = await rpc("dsh-memory/list-records", { tag: slug, limit: 10, retired: false });
		    if (r && r.ok) {
		      const next = new Set(expandedRooms);
		      next.add(slug);
		      setExpandedRooms(next);
		      setRoomRecords((m) => ({ ...m, [slug]: { items: r.value.items, total: r.value.total ?? null } }));
		    } else setError(r && r.error ? r.error.message : "加载失败");
		  });
		  const exportRecords = (slug) => run(async () => {
		    const r = await rpc("dsh-memory/rooms-export", { kind: "records", tag: slug });
		    if (!r.ok) {
		      setError(r.error.message);
		      return;
		    }
		    if (r.value.csv) downloadCsv(r.value.csv, `dsh-memory-room-${slug.replace(/\//g, "-")}-records.csv`);
		    else setError("导出为空");
		  });
		  const groups = (0, import_react18.useMemo)(() => {
		    const countOf = new Map(rooms.map((r) => [r.room, r.count]));
		    const byHall = /* @__PURE__ */ new Map();
		    for (const e of registry) {
		      if (e.status !== "active") continue;
		      const hall = majorOf(e.slug);
		      const list = byHall.get(hall);
		      if (list) list.push(e);
		      else byHall.set(hall, [e]);
		    }
		    return [...byHall.entries()].map(([hall, entries]) => ({
		      hall,
		      label: registry.find((e) => e.slug === hall)?.label,
		      entries: [...entries].sort((a, b) => a.slug.localeCompare(b.slug)),
		      total: entries.reduce((s2, e) => s2 + (countOf.get(e.slug) ?? 0), 0)
		    })).sort((a, b) => a.hall.localeCompare(b.hall));
		  }, [registry, rooms]);
		  const grownOnly = (0, import_react18.useMemo)(() => rooms.filter((r) => !registry.some((e) => e.slug === r.room)), [rooms, registry]);
		  const persistHalls = (next) => {
		    try {
		      window.localStorage.setItem("dsh.memory.halls.open", JSON.stringify([...next]));
		    } catch {
		    }
		  };
		  const toggleHall = (hall) => setExpandedHalls((cur) => {
		    const next = new Set(cur);
		    if (next.has(hall)) next.delete(hall);
		    else next.add(hall);
		    persistHalls(next);
		    return next;
		  });
		  const setAllHalls = (open) => {
		    const next = open ? new Set(groups.map((g) => g.hall)) : /* @__PURE__ */ new Set();
		    setExpandedHalls(next);
		    persistHalls(next);
		  };
		  const normFilter = filter.trim().toLowerCase();
		  const visibleGroups = (0, import_react18.useMemo)(() => {
		    if (!normFilter) return groups;
		    return groups.map((g) => {
		      const hallHit = g.hall.toLowerCase().includes(normFilter) || (g.label ?? "").toLowerCase().includes(normFilter);
		      const entries = hallHit ? g.entries : g.entries.filter(
		        (e) => e.slug.toLowerCase().includes(normFilter) || (e.label ?? "").toLowerCase().includes(normFilter) || (e.aliases ?? []).some((a) => a.toLowerCase().includes(normFilter))
		      );
		      return { ...g, entries };
		    }).filter((g) => g.entries.length > 0);
		  }, [groups, normFilter]);
		  const visibleGrown = (0, import_react18.useMemo)(
		    () => normFilter ? grownOnly.filter((r) => r.room.toLowerCase().includes(normFilter)) : grownOnly,
		    [grownOnly, normFilter]
		  );
		  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { children: [
		    /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { ...S.flexRow, marginBottom: 8 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: S.muted, children: "Hall = Room 大类 · 大类上限 200,小类「大类/小类」细分不占额度 · 与 Wing(域)筛选无关" }),
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: S.grow }),
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
		        "button",
		        {
		          type: "button",
		          title: "导出分类数据 CSV(Room 词表+计数)",
		          onClick: () => run(async () => {
		            const r = await rpc("dsh-memory/rooms-export", { kind: "rooms" });
		            if (!r.ok) {
		              setError(r.error.message);
		              return;
		            }
		            if (r.value.csv) downloadCsv(r.value.csv, "dsh-memory-rooms.csv");
		          }),
		          style: btn,
		          children: "导出词表"
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(
		        "button",
		        {
		          type: "button",
		          title: "导出无 Room 绑定的孤儿清单(含候选)",
		          onClick: () => run(async () => {
		            const r = await rpc("dsh-memory/rooms-export", { kind: "orphans" });
		            if (!r.ok) {
		              setError(r.error.message);
		              return;
		            }
		            if (r.value.csv) downloadCsv(r.value.csv, "dsh-memory-room-orphans.csv");
		          }),
		          style: btn,
		          children: [
		            "导出孤儿 · ",
		            orphanCount
		          ]
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
		        "button",
		        {
		          type: "button",
		          style: {
		            ...btn,
		            color: hiPriv ? "var(--dsh-mem-danger)" : void 0,
		            border: hiPriv ? "1px solid var(--dsh-mem-danger)" : btn.border
		          },
		          disabled: hiPrivBusy,
		          title: hiPriv ? "关闭高权限模式(收回模型写删工具与管理操作)" : "开启高权限模式以解锁分类管理操作",
		          onClick: toggleHiPriv,
		          children: hiPriv ? "高权限:开" : "高权限:关"
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", style: btn, onClick: loadAll, title: "重拉注册表与计数", children: "刷新" })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
		        "input",
		        {
		          value: filter,
		          onChange: (e) => setFilter(e.target.value),
		          placeholder: "搜索 hall/room(slug、显示名、别名)",
		          style: { ...S.input, width: 250, fontSize: 12 }
		        }
		      ),
		      filter ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", style: btn, onClick: () => setFilter(""), children: "清除" }) : null,
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: S.muted, children: `匹配 ${visibleGroups.reduce((s2, g) => s2 + g.entries.length, 0)} room / ${visibleGroups.length} hall` }),
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: S.grow }),
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", style: btn, title: "展开全部 hall 的子 room", onClick: () => setAllHalls(true), children: "展开全部" }),
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", style: btn, title: "收起全部 hall(只留 hall 头)", onClick: () => setAllHalls(false), children: "收起全部" })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 10 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
		        "input",
		        {
		          value: regSlug,
		          onChange: (e) => setRegSlug(e.target.value),
		          placeholder: "slug(如 dsh-plugin 或 dsh-plugin/merge)",
		          disabled: !hiPriv || busy,
		          style: { ...S.input, width: 210, fontSize: 12 }
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
		        "input",
		        {
		          value: regLabel,
		          onChange: (e) => setRegLabel(e.target.value),
		          placeholder: "名称(可中文)",
		          disabled: !hiPriv || busy,
		          style: { ...S.input, width: 110, fontSize: 12 }
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
		        "input",
		        {
		          value: regDesc,
		          onChange: (e) => setRegDesc(e.target.value),
		          placeholder: "归类说明(喂标注器)",
		          disabled: !hiPriv || busy,
		          style: { ...S.input, width: 170, fontSize: 12 }
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
		        "button",
		        {
		          type: "button",
		          disabled: !hiPriv || busy || !regSlug.trim(),
		          onClick: register,
		          style: { ...btn, color: "var(--dsh-mem-accent)", borderColor: "var(--dsh-mem-accent)", opacity: !hiPriv || busy || !regSlug.trim() ? 0.5 : 1 },
		          children: "注册"
		        }
		      ),
		      !hiPriv && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: S.muted, children: "管理操作需先开启高权限模式" })
		    ] }),
		    editing ? /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { position: "sticky", top: 0, zIndex: 5, background: "var(--dsh-mem-bg-inset)", display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap", padding: "6px 8px", border: "1px solid var(--dsh-mem-accent)", borderRadius: 8 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("span", { style: S.muted, children: [
		        "编辑 ",
		        editing.slug
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("input", { value: editing.label, onChange: (ev) => setEditing({ ...editing, label: ev.target.value }), placeholder: "显示名(可中文)", disabled: busy, style: { ...S.input, width: 140, fontSize: 12 } }),
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("input", { value: editing.description, onChange: (ev) => setEditing({ ...editing, description: ev.target.value }), placeholder: "归类说明(喂标注器)", disabled: busy, style: { ...S.input, width: 200, fontSize: 12 } }),
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", disabled: busy, onClick: saveEditing, style: { ...btn, color: "var(--dsh-mem-accent)", borderColor: "var(--dsh-mem-accent)" }, children: "保存" }),
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", disabled: busy, onClick: () => setEditing(null), style: btn, children: "取消" })
		    ] }) : null,
		    form ? /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { position: "sticky", top: 0, zIndex: 5, background: "var(--dsh-mem-bg-inset)", display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap", padding: "6px 8px", border: "1px solid var(--dsh-mem-accent)", borderRadius: 8 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("span", { style: S.muted, children: [
		        form.action === "merge" ? "合并" : "归类/改名",
		        " ",
		        form.from,
		        " →"
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
		        "input",
		        {
		          value: form.to,
		          onChange: (ev) => setForm({ ...form, to: ev.target.value }),
		          placeholder: "目标 slug",
		          disabled: busy,
		          style: { ...S.input, width: 190, fontSize: 12 }
		        }
		      ),
		      form.action === "rename" ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: { display: "inline-flex", gap: 4, flexWrap: "wrap" }, children: groups.filter((gg) => gg.hall !== majorOf(form.from)).map((gg) => /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
		        "button",
		        {
		          type: "button",
		          title: `归入 ${gg.hall} 下(${gg.hall}/${suffixOf(form.from)})`,
		          onClick: () => setForm({ ...form, to: `${gg.hall}/${suffixOf(form.from)}` }),
		          style: { ...btn, borderRadius: 999, padding: "1px 8px" },
		          children: gg.hall
		        },
		        gg.hall
		      )) }) : null,
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", disabled: busy, onClick: () => previewMerge(), style: { ...btn, color: "var(--dsh-mem-accent)", borderColor: "var(--dsh-mem-accent)" }, children: "预览" }),
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", disabled: busy, onClick: () => {
		        setForm(null);
		        setPreview(null);
		        setPicking(null);
		      }, style: btn, children: "取消" }),
		      picking ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: S.muted, children: "挑选中:点击目标 hall 头完成归类" }) : null,
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: S.muted, children: "与反刍并发会互相覆盖,请在反刍空闲时执行。" })
		    ] }) : null,
		    preview ? /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { position: "sticky", top: 0, zIndex: 5, background: "var(--dsh-mem-bg-inset)", marginBottom: 8, padding: "6px 8px", border: "1px solid var(--dsh-mem-danger)", borderRadius: 8, fontSize: 12 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { children: preview.notice }),
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { display: "flex", gap: 6, marginTop: 4 }, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("button", { type: "button", disabled: busy, onClick: execMerge, style: { ...btn, color: "var(--dsh-mem-danger)", borderColor: "var(--dsh-mem-danger)" }, children: [
		          "确认执行",
		          preview.action === "merge" ? "合并" : "归类/改名"
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", disabled: busy, onClick: () => setPreview(null), style: btn, children: "再改改" })
		      ] })
		    ] }) : null,
		    msg ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: S.hint, children: msg }) : null,
		    error ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: S.error, children: error }) : null,
		    ghost ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: { position: "fixed", left: ghost.x + 12, top: ghost.y + 12, zIndex: 9999, pointerEvents: "none", fontSize: 12, padding: "2px 10px", borderRadius: 999, border: "1px solid var(--dsh-mem-accent)", background: "var(--dsh-mem-bg-inset)", color: "var(--dsh-mem-accent)" }, children: ghost.text }) : null,
		    visibleGroups.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { style: S.intro, children: normFilter ? "无匹配的 hall/room。" : "注册表为空。在上方注册 Hall/Room(如 dsh-plugin),或把自生长 slug「收编」进词表 —— 之后候选标注器会优先把相关记忆挂到这些 slug 上。" }) : visibleGroups.map((g) => {
		      const hallOpen = !!normFilter || expandedHalls.has(g.hall);
		      return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { marginBottom: 10, border: "1px solid var(--dsh-mem-border)", borderRadius: 8, overflow: "hidden" }, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(
		          "div",
		          {
		            "data-hall": g.hall,
		            onDragOver: (ev) => {
		              if (!hiPriv || busy) return;
		              ev.preventDefault();
		              ev.dataTransfer.dropEffect = "move";
		              setDragOverHall(g.hall);
		            },
		            onDragLeave: () => setDragOverHall((cur) => cur === g.hall ? null : cur),
		            onDrop: (ev) => {
		              ev.preventDefault();
		              setDragOverHall(null);
		              if (!hiPriv || busy) return;
		              const from = ev.dataTransfer.getData("text/dsh-room");
		              if (from) beginReclass(from, g.hall);
		            },
		            onClick: () => {
		              if (picking) {
		                if (!busy) {
		                  const from = picking;
		                  setPicking(null);
		                  beginReclass(from, g.hall);
		                }
		                return;
		              }
		              toggleHall(g.hall);
		            },
		            style: {
		              display: "flex",
		              alignItems: "center",
		              gap: 8,
		              padding: "5px 10px",
		              background: "var(--dsh-mem-bg-inset)",
		              outline: dragOverHall === g.hall || picking !== null ? "2px dashed var(--dsh-mem-accent)" : void 0,
		              outlineOffset: dragOverHall === g.hall || picking !== null ? "-2px" : void 0,
		              cursor: "pointer"
		            },
		            title: picking ? "点击此 hall:把「" + picking + "」归入 " + g.hall + " 下(major/minor,预览后确认)" : hiPriv ? "拖入 room 归类到该 hall 下(major/minor;记录随迁,旧名进别名,预览后确认)" : void 0,
		            children: [
		              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
		                "button",
		                {
		                  type: "button",
		                  title: hallOpen ? "收起子 room" : "展开子 room(默认折叠)",
		                  onClick: (ev) => {
		                    ev.stopPropagation();
		                    toggleHall(g.hall);
		                  },
		                  style: { ...btn, borderRadius: 999, padding: "1px 7px", flexShrink: 0 },
		                  children: hallOpen ? "▾" : "▸"
		                }
		              ),
		              /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("span", { style: { fontSize: 12, fontWeight: 600 }, children: [
		                g.hall,
		                g.label ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: S.muted, children: " (" + g.label + ")" }) : null
		              ] }),
		              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: S.muted, children: `合计 ${g.total} 条 · ${g.entries.length} 个 room` }),
		              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: S.grow }),
		              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
		                "button",
		                {
		                  type: "button",
		                  disabled: !hiPriv || busy,
		                  title: `预填注册表单为 ${g.hall}/…(注册该 hall 下的小类)`,
		                  onClick: (ev) => {
		                    ev.stopPropagation();
		                    setRegSlug(g.hall + "/");
		                  },
		                  style: btn,
		                  children: "+小类"
		                }
		              )
		            ]
		          }
		        ),
		        hallOpen ? g.entries.map((e) => {
		          const standalone = e.slug === g.hall;
		          const count = rooms.find((r) => r.room === e.slug)?.count ?? 0;
		          const retired = e.status === "retired";
		          return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { padding: "4px 10px", borderTop: "1px solid var(--dsh-mem-border)", opacity: retired ? 0.55 : 1 }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
		              /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", gap: "2px 8px", alignItems: "baseline" }, children: [
		                /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
		                  "button",
		                  {
		                    type: "button",
		                    title: expandedRooms.has(e.slug) ? "收起内容" : "展开查看该 Room 的记录内容(默认收起)",
		                    onClick: () => void toggleRoomExpand(e.slug),
		                    style: { ...btn, borderRadius: 999, padding: "1px 7px", flexShrink: 0 },
		                    children: expandedRooms.has(e.slug) ? "▾" : "▸"
		                  }
		                ),
		                /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(
		                  "span",
		                  {
		                    style: { fontSize: 12, cursor: hiPriv && !busy ? "grab" : "default", touchAction: "none" },
		                    onPointerDown: (ev) => onDragLabelDown(ev, e.slug),
		                    onPointerMove: onDragLabelMove,
		                    onPointerUp: onDragLabelUp,
		                    title: hiPriv && !busy ? "按住拖到某个 hall 头上归类(major/minor;记录随迁,旧名进别名)" : e.description ? `${e.slug} — ${e.description}` : e.slug,
		                    children: [
		                      standalone ? e.slug : "· " + e.slug.slice(g.hall.length + 1),
		                      e.source === "pre-registered" ? " ⭐" : ""
		                    ]
		                  }
		                ),
		                e.label ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: S.muted, children: e.label }) : null,
		                /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: S.muted, children: count + " 条" }),
		                retired ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: { ...S.muted, color: "var(--dsh-mem-danger)" }, children: "已退役" }) : null,
		                (e.aliases ?? []).length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: { ...S.muted, wordBreak: "break-all" }, children: "别名: " + (e.aliases ?? []).join(", ") }) : null
		              ] }),
		              /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }, children: [
		                !hiPriv ? null : /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(import_jsx_runtime18.Fragment, { children: [
		                  /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", disabled: busy, title: "编辑显示名/归类说明", onClick: () => {
		                    setEditing({ slug: e.slug, label: e.label ?? "", description: e.description ?? "" });
		                    setForm(null);
		                    setPreview(null);
		                    setPicking(null);
		                  }, style: btn, children: "编辑" }),
		                  /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
		                    "button",
		                    {
		                      type: "button",
		                      disabled: busy,
		                      title: picking === e.slug ? "再点一次取消挑选;然后点击目标 hall 头完成归类" : "归类到已有 hall 下:点击后选目标 hall(记录随迁,旧名进别名)",
		                      onClick: () => {
		                        if (picking === e.slug) {
		                          setPicking(null);
		                          return;
		                        }
		                        setForm({ action: "rename", from: e.slug, to: "" });
		                        setPreview(null);
		                        setPicking(e.slug);
		                        setMsg(null);
		                        setError(null);
		                      },
		                      style: { ...btn, ...picking === e.slug ? { color: "var(--dsh-mem-accent)", borderColor: "var(--dsh-mem-accent)" } : {} },
		                      children: picking === e.slug ? "选 hall…" : "归类"
		                    }
		                  ),
		                  /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", disabled: busy, title: `改名(= merge 1:1 + 注册表改名)`, onClick: () => {
		                    setForm({ action: "rename", from: e.slug, to: "" });
		                    setPreview(null);
		                  }, style: btn, children: "改名" }),
		                  /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", disabled: busy, title: "合并到另一个 Room(dryRun 预览→确认实跑)", onClick: () => {
		                    setForm({ action: "merge", from: e.slug, to: "" });
		                    setPreview(null);
		                  }, style: btn, children: "合并" }),
		                  /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", disabled: busy, title: retired ? "恢复该 Room 到词表" : "退役该 Room(存量 tags 不动)", onClick: () => retire(e.slug, retired), style: { ...btn, ...retired ? { color: "var(--dsh-mem-accent)", borderColor: "var(--dsh-mem-accent)" } : { color: "var(--dsh-mem-danger)", borderColor: "var(--dsh-mem-danger)" } }, children: retired ? "恢复" : "退役" }),
		                  !retired ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", disabled: busy, title: "退役并退场该 Room 下全部记忆(软删,可在「已退场」区恢复)", onClick: () => retire(e.slug, false, true), style: { ...btn, color: "var(--dsh-mem-danger)", borderColor: "var(--dsh-mem-danger)" }, children: "退场" }) : null
		                ] }),
		                /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", disabled: busy, title: "导出该 Room 的记录清单 CSV", onClick: () => exportRecords(e.slug), style: btn, children: "导出" })
		              ] })
		            ] }),
		            expandedRooms.has(e.slug) ? /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { margin: "4px 0 2px", padding: "4px 8px", border: "1px dashed var(--dsh-mem-border)", borderRadius: 6 }, children: [
		              (roomRecords[e.slug]?.items ?? []).map((it) => /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { fontSize: 11, padding: "3px 0", borderBottom: "1px solid var(--dsh-mem-border)" }, children: [
		                /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: "dsh-mem-tag dsh-mem-tag-" + it.type, children: TYPE_LABELS[it.type] || it.type }),
		                " ",
		                /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: S.muted, children: it.updatedAt ? fmtTime(it.updatedAt) : "" }),
		                /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: { marginTop: 2, wordBreak: "break-all", color: "var(--dsh-mem-text-2)" }, children: it.content.length > 120 ? it.content.slice(0, 120) + "…" : it.content })
		              ] }, it.id)),
		              (roomRecords[e.slug]?.items.length ?? 0) === 0 ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: S.muted, children: "该 Room 暂无记录。" }) : null,
		              (roomRecords[e.slug]?.total ?? 0) > (roomRecords[e.slug]?.items.length ?? 0) ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: { ...S.muted, fontSize: 11 }, children: "共 " + roomRecords[e.slug].total + " 条,仅显示前 " + roomRecords[e.slug].items.length + " 条" }) : null
		            ] }) : null
		          ] }, e.slug);
		        }) : null
		      ] }, g.hall);
		    }),
		    visibleGrown.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { marginTop: 4 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("button", { type: "button", onClick: () => setGrownOpen(!grownOpen), style: btn, title: grownOpen ? "收起未注册自生长 Room" : "展开未注册自生长 Room", children: [
		        grownOpen ? "▾" : "▸",
		        " 自生长未注册 · 共 ",
		        visibleGrown.length
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: S.muted, children: "(只在 tags 里涌现,不在词表 —— 收编后标注器才会优先挂靠)" }),
		      grownOpen ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 6 }, children: visibleGrown.map((r) => /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 4 }, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
		          "span",
		          {
		            style: { ...btn, cursor: hiPriv && !busy ? "grab" : "default", borderRadius: 999, padding: "2px 8px", touchAction: "none" },
		            onPointerDown: (ev) => onDragLabelDown(ev, r.room),
		            onPointerMove: onDragLabelMove,
		            onPointerUp: onDragLabelUp,
		            title: hiPriv && !busy ? "自生长 slug(未注册)——按住拖到某个 hall 头上 = 收编并归为其子类" : "自生长 slug(未注册)",
		            children: r.room + " · " + r.count
		          }
		        ),
		        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", disabled: !hiPriv || busy, title: "收编进注册表(source=grown,原地)", onClick: () => adopt(r.room), style: { ...btn, color: "var(--dsh-mem-accent)", borderColor: "var(--dsh-mem-accent)", opacity: !hiPriv || busy ? 0.5 : 1 }, children: "收编" }),
		        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
		          "button",
		          {
		            type: "button",
		            disabled: !hiPriv || busy,
		            title: "归类到已有 hall 下:点击后选目标 hall(收编+子类一步,记录随迁)",
		            onClick: () => {
		              if (picking === r.room) {
		                setPicking(null);
		                return;
		              }
		              setForm({ action: "rename", from: r.room, to: "" });
		              setPreview(null);
		              setPicking(r.room);
		              setMsg(null);
		              setError(null);
		            },
		            style: { ...btn, opacity: !hiPriv || busy ? 0.5 : 1, ...picking === r.room ? { color: "var(--dsh-mem-accent)", borderColor: "var(--dsh-mem-accent)" } : {} },
		            children: picking === r.room ? "选 hall…" : "归"
		          }
		        )
		      ] }, r.room)) }) : null
		    ] }) : null
		  ] });
		}
		
		// client/src/tabs/RoomTab.tsx
		var import_react19 = require("react");
		var import_jsx_runtime19 = require("react/jsx-runtime");
		var btn2 = {
		  cursor: "pointer",
		  fontSize: 12,
		  padding: "2px 8px",
		  borderRadius: 6,
		  border: "1px solid var(--dsh-mem-border)",
		  background: "transparent",
		  color: "var(--dsh-mem-text-2)"
		};
		function downloadCsv2(csv, name) {
		  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
		  const url = URL.createObjectURL(blob);
		  const a = document.createElement("a");
		  a.href = url;
		  a.download = name;
		  a.click();
		  URL.revokeObjectURL(url);
		}
		function RoomTab(props) {
		  const rpc = props.rpc;
		  const [registry, setRegistry] = (0, import_react19.useState)([]);
		  const [counts, setCounts] = (0, import_react19.useState)([]);
		  const [orphanCount, setOrphanCount] = (0, import_react19.useState)(0);
		  const [busy, setBusy] = (0, import_react19.useState)(false);
		  const [msg, setMsg] = (0, import_react19.useState)(null);
		  const [error, setError] = (0, import_react19.useState)(null);
		  const [hiPriv, setHiPriv] = (0, import_react19.useState)(false);
		  const [hiPrivBusy, setHiPrivBusy] = (0, import_react19.useState)(false);
		  const [reg, setReg] = (0, import_react19.useState)({ slug: "", label: "", description: "" });
		  const [editing, setEditing] = (0, import_react19.useState)(null);
		  const [renaming, setRenaming] = (0, import_react19.useState)(null);
		  const [expanded, setExpanded] = (0, import_react19.useState)(/* @__PURE__ */ new Set());
		  const [retiredFilter, setRetiredFilter] = (0, import_react19.useState)("");
		  const [filter, setFilter] = (0, import_react19.useState)("");
		  const [records, setRecords] = (0, import_react19.useState)({});
		  const loadAll = (0, import_react19.useCallback)(() => {
		    rpc("dsh-memory/rooms-get", {}).then((r) => {
		      if (r && r.ok) {
		        setCounts(r.value.rooms ?? []);
		        setRegistry(r.value.registry ?? []);
		        setOrphanCount(r.value.orphanCount ?? 0);
		      }
		    }).catch(() => void 0);
		  }, [rpc]);
		  const loadHiPriv = (0, import_react19.useCallback)(() => {
		    rpc("dsh-memory/settings-get", {}).then((r) => {
		      if (r && r.ok && r.value) setHiPriv(!!r.value.settings.memoryMutate);
		    }).catch(() => {
		    });
		  }, [rpc]);
		  (0, import_react19.useEffect)(() => {
		    loadAll();
		    loadHiPriv();
		  }, [loadAll, loadHiPriv]);
		  const toggleHiPriv = () => {
		    const next = !hiPriv;
		    if (next && !window.confirm("开启高权限模式:模型获得写入/删除记忆工具,并解锁 Room 管理操作。确定开启?")) return;
		    rpc("dsh-memory/settings-set", { memoryMutate: next }).then((r) => {
		      if (r && r.ok) setHiPriv(next);
		      setHiPrivBusy(false);
		      loadHiPriv();
		    }).catch(() => setHiPrivBusy(false));
		  };
		  const run = (fn) => {
		    if (busy) return;
		    setBusy(true);
		    setError(null);
		    setMsg(null);
		    fn().finally(() => setBusy(false));
		  };
		  const register = () => run(async () => {
		    const r = await rpc("dsh-memory/room-register", { slug: reg.slug.trim(), label: reg.label.trim() || void 0, description: reg.description.trim() || void 0 });
		    if (r && r.ok) {
		      setMsg(r.value?.notice ?? `已注册:${reg.slug.trim()}`);
		      setReg({ slug: "", label: "", description: "" });
		      loadAll();
		    } else setError(r && r.error ? r.error.message : "注册失败");
		  });
		  const adopt = (slug) => run(async () => {
		    const r = await rpc("dsh-memory/room-register", { slug, source: "grown" });
		    if (r && r.ok) {
		      setMsg(`已收编:${slug}(source=grown)`);
		      loadAll();
		    } else setError(r && r.error ? r.error.message : "收编失败");
		  });
		  const previewRename = () => run(async () => {
		    if (!renaming) return;
		    const to = renaming.to.trim();
		    if (!to) {
		      setError("目标 slug 不能为空");
		      return;
		    }
		    if (to === renaming.slug) {
		      setError("目标与源相同");
		      return;
		    }
		    if (!registry.some((e) => e.slug === renaming.slug)) {
		      const rr = await rpc("dsh-memory/room-register", { slug: renaming.slug, source: "grown" });
		      if (!rr || !rr.ok) {
		        setError(rr && rr.error ? rr.error.message : "收编源失败");
		        return;
		      }
		      loadAll();
		    }
		    const r = await rpc("dsh-memory/room-admin", { action: "rename", from: renaming.slug, to });
		    if (r && r.ok) setMsg(String(r.value?.notice ?? ""));
		    else setError(r && r.error ? r.error.message : "预览失败");
		  });
		  const execRename = () => run(async () => {
		    if (!renaming) return;
		    if (!registry.some((e) => e.slug === renaming.slug)) {
		      await rpc("dsh-memory/room-register", { slug: renaming.slug, source: "grown" });
		    }
		    const r = await rpc("dsh-memory/room-admin", { action: "rename", from: renaming.slug, to: renaming.to.trim(), dryRun: false });
		    if (r && r.ok) {
		      setMsg(String(r.value?.notice ?? "完成"));
		      setRenaming(null);
		      loadAll();
		    } else setError(r && r.error ? r.error.message : "执行失败");
		  });
		  const saveEditing = () => run(async () => {
		    if (!editing) return;
		    const r = await rpc("dsh-memory/room-admin", { action: "update", slug: editing.slug, label: editing.label, description: editing.description });
		    if (r && r.ok) {
		      setMsg(String(r.value?.notice ?? "已更新"));
		      setEditing(null);
		      loadAll();
		    } else setError(r && r.error ? r.error.message : "更新失败");
		  });
		  const retire = (slug, active, withRecords = false) => run(async () => {
		    if (!active) {
		      const tip = withRecords ? `退役 Room:${slug} 并退场其下全部记忆?(记录为软删,可在记忆页「已退场」区逐条恢复)` : `退役 Room:${slug}?(存量记录的 tags 不动,仅词表不再推荐;可随时恢复)`;
		      if (!window.confirm(tip)) return;
		    }
		    const r = await rpc("dsh-memory/room-admin", { action: "retire", slug, active, withRecords: withRecords || void 0 });
		    if (r && r.ok) {
		      setMsg(String(r.value?.notice ?? "完成"));
		      loadAll();
		      if (expanded.has(slug)) {
		        const rr = await rpc("dsh-memory/list-records", { tag: slug, limit: 10, retired: false });
		        if (rr && rr.ok) setRecords((m) => ({ ...m, [slug]: { items: rr.value.items, total: rr.value.total ?? null } }));
		      }
		    } else setError(r && r.error ? r.error.message : "操作失败");
		  });
		  const exportRecords = (slug) => run(async () => {
		    const r = await rpc("dsh-memory/rooms-export", { kind: "records", tag: slug });
		    if (!r.ok) {
		      setError(r.error.message);
		      return;
		    }
		    if (r.value.csv) {
		      const blob = new Blob([r.value.csv], { type: "text/csv;charset=utf-8" });
		      const url = URL.createObjectURL(blob);
		      const a = document.createElement("a");
		      a.href = url;
		      a.download = `dsh-memory-room-${slug.replace(/\//g, "-")}-records.csv`;
		      a.click();
		      URL.revokeObjectURL(url);
		    }
		  });
		  const toggleExpand = (slug) => run(async () => {
		    if (expanded.has(slug)) {
		      const next = new Set(expanded);
		      next.delete(slug);
		      setExpanded(next);
		      return;
		    }
		    const r = await rpc("dsh-memory/list-records", { tag: slug, limit: 10, retired: false });
		    if (r && r.ok) {
		      const next = new Set(expanded);
		      next.add(slug);
		      setExpanded(next);
		      setRecords((m) => ({ ...m, [slug]: { items: r.value.items, total: r.value.total ?? null } }));
		    } else setError(r && r.error ? r.error.message : "加载失败");
		  });
		  const countOf = (slug) => counts.find((c) => c.room === slug)?.count ?? 0;
		  const rows = [
		    ...registry.map((e) => ({ slug: e.slug, count: countOf(e.slug), entry: e })),
		    ...counts.filter((c) => !registry.some((e) => e.slug === c.room)).map((c) => ({ slug: c.room, count: c.count }))
		  ].filter((row2) => {
		    if (retiredFilter === "active") return row2.entry?.status !== "retired";
		    if (retiredFilter === "retired") return row2.entry?.status === "retired";
		    return true;
		  });
		  const normFilter = filter.trim().toLowerCase();
		  const visibleRows = normFilter ? rows.filter(
		    (row2) => row2.slug.toLowerCase().includes(normFilter) || (row2.entry?.label ?? "").toLowerCase().includes(normFilter) || (row2.entry?.aliases ?? []).some((a) => a.toLowerCase().includes(normFilter))
		  ) : rows;
		  return /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { children: [
		    /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { style: { ...S.flexRow, marginBottom: 8, flexWrap: "wrap" }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { style: S.muted, children: "Room 级管理:存在(注册/收编/退役)· 名称(显示名/说明/改名)· 条目(展开浏览) · 归类到 hall 请到「Hall」页" }),
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("div", { style: S.grow }),
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("button", { type: "button", style: btn2, title: "导出无 Room 绑定的孤儿清单(含候选)", onClick: () => run(async () => {
		        const r = await rpc("dsh-memory/rooms-export", { kind: "orphans" });
		        if (!r.ok) {
		          setError(r.error.message);
		          return;
		        }
		        if (r.value.csv) downloadCsv2(r.value.csv, "dsh-memory-room-orphans.csv");
		      }), children: [
		        "导出孤儿 · ",
		        orphanCount
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
		        "button",
		        {
		          type: "button",
		          style: { ...btn2, color: hiPriv ? "var(--dsh-mem-danger)" : void 0, border: hiPriv ? "1px solid var(--dsh-mem-danger)" : btn2.border },
		          disabled: hiPrivBusy,
		          title: hiPriv ? "关闭高权限模式" : "开启高权限模式以解锁 Room 管理操作",
		          onClick: toggleHiPriv,
		          children: hiPriv ? "高权限:开" : "高权限:关"
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", style: btn2, onClick: loadAll, children: "刷新" })
		    ] }),
		    editing ? /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { style: { position: "sticky", top: 0, zIndex: 5, background: "var(--dsh-mem-bg-inset)", display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap", padding: "6px 8px", border: "1px solid var(--dsh-mem-accent)", borderRadius: 8 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("span", { style: S.muted, children: [
		        "编辑 ",
		        editing.slug
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("input", { value: editing.label, onChange: (e) => setEditing({ ...editing, label: e.target.value }), placeholder: "显示名(可中文)", disabled: busy, style: { ...S.input, width: 140, fontSize: 12 } }),
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("input", { value: editing.description, onChange: (e) => setEditing({ ...editing, description: e.target.value }), placeholder: "归类说明(喂标注器)", disabled: busy, style: { ...S.input, width: 200, fontSize: 12 } }),
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", disabled: busy, onClick: saveEditing, style: { ...btn2, color: "var(--dsh-mem-accent)", borderColor: "var(--dsh-mem-accent)" }, children: "保存" }),
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", disabled: busy, onClick: () => setEditing(null), style: btn2, children: "取消" })
		    ] }) : null,
		    renaming ? /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { style: { position: "sticky", top: 0, zIndex: 5, background: "var(--dsh-mem-bg-inset)", display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap", padding: "6px 8px", border: "1px solid var(--dsh-mem-accent)", borderRadius: 8 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("span", { style: S.muted, children: [
		        "改名 ",
		        renaming.slug,
		        " →"
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("input", { value: renaming.to, onChange: (e) => setRenaming({ ...renaming, to: e.target.value }), placeholder: "新 slug(可两级:hall/子类)", disabled: busy, style: { ...S.input, width: 200, fontSize: 12 } }),
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", disabled: busy, onClick: previewRename, style: { ...btn2, color: "var(--dsh-mem-accent)", borderColor: "var(--dsh-mem-accent)" }, children: "预览" }),
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", disabled: busy, onClick: execRename, style: { ...btn2, color: "var(--dsh-mem-danger)", borderColor: "var(--dsh-mem-danger)" }, children: "确认执行" }),
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", disabled: busy, onClick: () => setRenaming(null), style: btn2, children: "取消" }),
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { style: S.muted, children: "记录随迁;与反刍并发会互相覆盖,请在反刍空闲时执行。" })
		    ] }) : null,
		    /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { style: S.muted, children: "退场筛选" }),
		      [["", "全部"], ["active", "活跃"], ["retired", "已退役"]].map(([val, label]) => {
		        const on = retiredFilter === val;
		        return /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
		          "button",
		          {
		            type: "button",
		            title: val === "" ? "全部 room" : val === "active" ? "只看词表未退役的 room" : "只看已退役的 room",
		            onClick: () => setRetiredFilter(val),
		            style: {
		              cursor: "pointer",
		              fontSize: 12,
		              padding: "2px 10px",
		              borderRadius: 999,
		              border: on ? "1px solid var(--dsh-mem-accent)" : "1px solid var(--dsh-mem-border)",
		              background: on ? "var(--dsh-mem-bg-inset)" : "transparent",
		              color: on ? "var(--dsh-mem-accent)" : "var(--dsh-mem-text-2)"
		            },
		            children: label
		          },
		          val
		        );
		      }),
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("div", { style: S.grow }),
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
		        "input",
		        {
		          value: filter,
		          onChange: (e) => setFilter(e.target.value),
		          placeholder: "搜索 room(slug、显示名、别名)",
		          style: { ...S.input, width: 230, fontSize: 12 }
		        }
		      ),
		      filter ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", style: btn2, onClick: () => setFilter(""), children: "清除" }) : null
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 10 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("input", { value: reg.slug, onChange: (e) => setReg({ ...reg, slug: e.target.value }), placeholder: "slug(如 dsh-plugin 或 dsh-plugin/merge)", disabled: !hiPriv || busy, style: { ...S.input, width: 210, fontSize: 12 } }),
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("input", { value: reg.label, onChange: (e) => setReg({ ...reg, label: e.target.value }), placeholder: "名称(可中文)", disabled: !hiPriv || busy, style: { ...S.input, width: 110, fontSize: 12 } }),
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("input", { value: reg.description, onChange: (e) => setReg({ ...reg, description: e.target.value }), placeholder: "归类说明(喂标注器)", disabled: !hiPriv || busy, style: { ...S.input, width: 170, fontSize: 12 } }),
		      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", disabled: !hiPriv || busy || !reg.slug.trim(), onClick: register, style: { ...btn2, color: "var(--dsh-mem-accent)", borderColor: "var(--dsh-mem-accent)", opacity: !hiPriv || busy || !reg.slug.trim() ? 0.5 : 1 }, children: "注册" }),
		      !hiPriv && /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { style: S.muted, children: "管理操作需先开启高权限模式" })
		    ] }),
		    msg ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("div", { style: S.hint, children: msg }) : null,
		    error ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("div", { style: S.error, children: error }) : null,
		    visibleRows.length === 0 ? normFilter ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { style: S.intro, children: "无匹配的 Room。" }) : /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { style: S.intro, children: "暂无 Room:对话/反刍会从标签涌现,或在上方注册。" }) : visibleRows.map((row2) => {
		      const e = row2.entry;
		      const retired = e?.status === "retired";
		      const grownOnly = !e;
		      return /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { style: { marginBottom: 6, border: "1px solid var(--dsh-mem-border)", borderRadius: 8 }, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "4px 10px" }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
		            "button",
		            {
		              type: "button",
		              title: expanded.has(row2.slug) ? "收起记忆条目" : "展开查看该 Room 的记忆条目(默认收起)",
		              onClick: () => void toggleExpand(row2.slug),
		              style: { ...btn2, borderRadius: 999, padding: "1px 7px", flexShrink: 0 },
		              children: expanded.has(row2.slug) ? "▾" : "▸"
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { style: { flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", gap: "2px 8px", alignItems: "baseline" }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("span", { style: { fontSize: 12, opacity: retired ? 0.6 : 1 }, children: [
		              row2.slug,
		              e?.source === "pre-registered" ? " ⭐" : ""
		            ] }),
		            e?.label ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { style: S.muted, children: e.label }) : null,
		            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { style: S.muted, children: row2.count + " 条" }),
		            grownOnly ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { style: S.muted, children: "(自生长未注册)" }) : null,
		            retired ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { style: { ...S.muted, color: "var(--dsh-mem-danger)" }, children: "已退役" }) : null,
		            (e?.aliases ?? []).length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { style: { ...S.muted, wordBreak: "break-all" }, children: "别名: " + (e?.aliases ?? []).join(", ") }) : null
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { style: { display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }, children: [
		            !hiPriv || grownOnly ? null : /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)(import_jsx_runtime19.Fragment, { children: [
		              /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", disabled: busy, title: "编辑显示名/归类说明", onClick: () => {
		                setEditing({ slug: row2.slug, label: e?.label ?? "", description: e?.description ?? "" });
		                setRenaming(null);
		              }, style: btn2, children: "编辑" }),
		              /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", disabled: busy, title: "改名(可两级 slug;记录随迁,旧名进别名)", onClick: () => {
		                setRenaming({ slug: row2.slug, to: "" });
		                setEditing(null);
		              }, style: btn2, children: "改名" }),
		              /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
		                "button",
		                {
		                  type: "button",
		                  disabled: busy,
		                  title: retired ? "恢复该 Room 到词表" : "退役该 Room(存量 tags 不动)",
		                  onClick: () => retire(row2.slug, retired),
		                  style: { ...btn2, ...retired ? { color: "var(--dsh-mem-accent)", borderColor: "var(--dsh-mem-accent)" } : { color: "var(--dsh-mem-danger)", borderColor: "var(--dsh-mem-danger)" } },
		                  children: retired ? "恢复" : "退役"
		                }
		              ),
		              !retired ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", disabled: busy, title: "退役并退场该 Room 下全部记忆(软删,可在「已退场」区恢复)", onClick: () => retire(row2.slug, false, true), style: { ...btn2, color: "var(--dsh-mem-danger)", borderColor: "var(--dsh-mem-danger)" }, children: "退场" }) : null
		            ] }),
		            grownOnly ? /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)(import_jsx_runtime19.Fragment, { children: [
		              /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", disabled: !hiPriv || busy, title: "收编进注册表(source=grown)", onClick: () => adopt(row2.slug), style: { ...btn2, color: "var(--dsh-mem-accent)", borderColor: "var(--dsh-mem-accent)", opacity: !hiPriv || busy ? 0.5 : 1 }, children: "收编" }),
		              /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", disabled: !hiPriv || busy, title: "退场该 Room 下全部记忆(软删,可在「已退场」区恢复)", onClick: () => {
		                setRenaming(null);
		                retire(row2.slug, false, true);
		              }, style: { ...btn2, color: "var(--dsh-mem-danger)", borderColor: "var(--dsh-mem-danger)", opacity: !hiPriv || busy ? 0.5 : 1 }, children: "退场" })
		            ] }) : null,
		            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", disabled: busy, title: "导出该 Room 的记录清单 CSV", onClick: () => exportRecords(row2.slug), style: btn2, children: "导出" })
		          ] })
		        ] }),
		        expanded.has(row2.slug) ? /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { style: { margin: "0 10px 6px", padding: "4px 8px", border: "1px dashed var(--dsh-mem-border)", borderRadius: 6 }, children: [
		          (records[row2.slug]?.items ?? []).map((it) => /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { style: { fontSize: 11, padding: "3px 0", borderBottom: "1px solid var(--dsh-mem-border)" }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { className: "dsh-mem-tag dsh-mem-tag-" + it.type, children: TYPE_LABELS[it.type] || it.type }),
		            " ",
		            it.retired ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { style: { ...S.muted, color: "var(--dsh-mem-danger)" }, children: "[已退场]" }) : null,
		            " ",
		            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { style: S.muted, children: it.updatedAt ? fmtTime(it.updatedAt) : "" }),
		            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("div", { style: { marginTop: 2, wordBreak: "break-all", color: "var(--dsh-mem-text-2)", opacity: it.retired ? 0.55 : 1 }, children: it.content.length > 140 ? it.content.slice(0, 140) + "…" : it.content })
		          ] }, it.id)),
		          (records[row2.slug]?.items.length ?? 0) === 0 ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("div", { style: S.muted, children: "该 Room 暂无记忆条目。" }) : null,
		          (records[row2.slug]?.total ?? 0) > (records[row2.slug]?.items.length ?? 0) ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("div", { style: { ...S.muted, fontSize: 11 }, children: "共 " + records[row2.slug].total + " 条,仅显示前 " + records[row2.slug].items.length + " 条" }) : null
		        ] }) : null
		      ] }, row2.slug);
		    })
		  ] });
		}
		
		// client/src/tabs/ScenesTab.tsx
		var import_react20 = require("react");
		var import_jsx_runtime20 = require("react/jsx-runtime");
		function SceneCard(props) {
		  const s = props.s;
		  const [open, setOpen] = (0, import_react20.useState)(false);
		  return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "dsh-mem-card dsh-mem-card-hover", style: S.card, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)(
		      "div",
		      {
		        style: { ...S.sceneHead, cursor: "pointer", userSelect: "none" },
		        onClick: () => {
		          setOpen(!open);
		        },
		        children: [
		          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: "dsh-mem-scene-chev", style: { transform: open ? "rotate(90deg)" : "none" }, children: "▸" }),
		          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { style: S.sceneTitle, children: s.path }),
		          s.heat ? /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { style: S.muted, children: "热度 " + s.heat }) : null,
		          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { style: S.grow }),
		          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { style: S.muted, children: "更新 " + fmtTime(s.updated) })
		        ]
		      }
		    ),
		    s.summary ? /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { style: { ...S.muted, marginBottom: 6 }, children: s.summary }) : null,
		    open ? /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("pre", { style: S.pre, children: s.content || "(空)" }) : null
		  ] });
		}
		function ScenesTab(props) {
		  const rpc = props.rpc;
		  const [items, setItems] = (0, import_react20.useState)(null);
		  const [error, setError] = (0, import_react20.useState)(null);
		  const load = (0, import_react20.useCallback)(() => {
		    rpc("dsh-memory/scenes", {}).then((r) => {
		      if (r && r.ok) {
		        setItems(r.value.items);
		        setError(null);
		      } else setError(r && r.error ? r.error.message : "RPC error");
		    }).catch((e) => {
		      setError(String(e && e.message || e));
		    });
		  }, [rpc]);
		  (0, import_react20.useEffect)(() => {
		    load();
		  }, [load]);
		  return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { children: [
		    /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { style: { ...S.flexRow, marginBottom: 10 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { style: S.muted, children: items ? items.length + " 个场景块" : "加载中…" }),
		      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { style: S.grow }),
		      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(NButton, { onClick: load, children: "刷新" })
		    ] }),
		    error ? /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { style: S.error, children: error }) : null,
		    items && items.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { style: S.intro, children: "暂无场景块。累计 5 条新记忆后 L2 会自动整合出第一个场景。" }) : null,
		    (items || []).map((s) => {
		      return /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(SceneCard, { s }, s.path);
		    })
		  ] });
		}
		
		// client/src/panel.tsx
		var import_jsx_runtime21 = require("react/jsx-runtime");
		var TABS = [
		  ["overview", "概览"],
		  ["records", "记忆"],
		  ["conflicts", "冲突"],
		  ["scenes", "场景"],
		  ["rooms", "Hall"],
		  ["room", "Room"],
		  ["persona", "画像"],
		  ["cost", "成本"],
		  ["log", "日志"],
		  ["connect", "来源"],
		  ["skills", "技能"]
		];
		var SKIN_OPTS = [
		  ["light", "浅色"],
		  ["dark", "深色"],
		  ["auto", "跟随"]
		];
		function MemoryPanel(props) {
		  const rpc = props.rpc;
		  const [tab, setTab] = (0, import_react21.useState)("overview");
		  const [skin, setSkinState] = (0, import_react21.useState)(() => getSkin());
		  ensureThemeStyle(skin);
		  (0, import_react21.useEffect)(() => {
		    applySkin(skin);
		    watchSidebarIcon();
		  }, [skin]);
		  const switchSkin = (next) => {
		    setSkin(next);
		    setSkinState(next);
		  };
		  let body;
		  if (tab === "overview") body = /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(OverviewTab, { rpc });
		  else if (tab === "records") body = /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(RecordsTab, { rpc });
		  else if (tab === "conflicts") body = /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(ConflictsTab, { rpc });
		  else if (tab === "scenes") body = /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(ScenesTab, { rpc });
		  else if (tab === "rooms") body = /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(RoomsTab, { rpc });
		  else if (tab === "room") body = /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(RoomTab, { rpc });
		  else if (tab === "persona") body = /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(PersonaTab, { rpc });
		  else if (tab === "cost") body = /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(CostTab, { rpc });
		  else if (tab === "connect") body = /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(ConnectTab, { rpc });
		  else if (tab === "skills") body = /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(SkillsTab, { rpc });
		  else body = /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(LogTab, { rpc });
		  return /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "dsh-mem-root", style: S.section, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("h2", { style: S.heading, children: "记忆 (Memory)" }),
		    /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("p", { style: S.intro, children: "L0~L3 分层蒸馏记忆：浏览被记住的内容，控制记忆模式开关。" }),
		    /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(
		      "div",
		      {
		        style: {
		          display: "flex",
		          justifyContent: "flex-end",
		          alignItems: "center",
		          gap: 2,
		          marginTop: -6,
		          marginBottom: 10
		        },
		        children: [
		          /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { style: { fontSize: 12, color: "var(--dsh-mem-text-3)", marginRight: 4 }, children: "皮肤" }),
		          SKIN_OPTS.map((s) => /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
		            "button",
		            {
		              className: skin === s[0] ? "dsh-mem-tab dsh-mem-tab-on" : "dsh-mem-tab",
		              onClick: () => switchSkin(s[0]),
		              title: `皮肤：${s[1]}`,
		              children: s[1]
		            },
		            s[0]
		          ))
		        ]
		      }
		    ),
		    /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("div", { style: S.tabbar, children: TABS.map((t) => {
		      return /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
		        "button",
		        {
		          className: tab === t[0] ? "dsh-mem-tab dsh-mem-tab-on" : "dsh-mem-tab",
		          onClick: () => {
		            setTab(t[0]);
		          },
		          children: t[1]
		        },
		        t[0]
		      );
		    }) }),
		    body
		  ] });
		}
		
		// client/src/pill/MemoryModePill.tsx
		var import_react25 = require("react");
		
		// src/util/context-occupancy.ts
		var CONTEXT_METER_CIRCUMFERENCE = 34.55751918948772;
		function haloDashArray(occupancyRatio, circumference = CONTEXT_METER_CIRCUMFERENCE, minLen = 0) {
		  const clamped = Number.isFinite(occupancyRatio) ? Math.min(1, Math.max(0, occupancyRatio)) : 0;
		  const len = Math.max(clamped * circumference, clamped > 0 ? minLen : 0);
		  return `${len} ${circumference}`;
		}
		var RADIUS_EPSILON = 1e-6;
		function isContextMeterAnchor(sig) {
		  if (sig.ariaHasPopup !== "dialog") return false;
		  if (sig.viewBox !== "0 0 14 14") return false;
		  const radii = sig.circleRadii;
		  if (!Array.isArray(radii) || radii.length !== 2) return false;
		  return radii.every((r) => Math.abs(r - 5.5) < RADIUS_EPSILON);
		}
		
		// client/src/meter/occupancy-indicator.ts
		var statsCall = null;
		var snapshotBySession = /* @__PURE__ */ new Map();
		var activeSessionId = null;
		var panelListeners = /* @__PURE__ */ new Set();
		var panelWasOpen = false;
		var snapshotListeners = /* @__PURE__ */ new Set();
		function initOccupancyIndicator(call) {
		  statsCall = call;
		}
		function noteOccupancySession(sessionId) {
		  if (sessionId === activeSessionId) return;
		  activeSessionId = sessionId;
		  panelWasOpen = false;
		  if (sessionId !== null && !snapshotBySession.has(sessionId)) void fetchSnapshot(true);
		}
		function onMeterPanelOpen(listener) {
		  panelListeners.add(listener);
		  return () => panelListeners.delete(listener);
		}
		function onMeterSnapshotUpdate(listener) {
		  snapshotListeners.add(listener);
		  return () => snapshotListeners.delete(listener);
		}
		function effectiveView(snap) {
		  const recall = Math.max(snap?.backfillRecallTokens ?? 0, snap?.recallTokens ?? 0);
		  const ledgerProfile = snap?.profileTokens ?? 0;
		  const profile = ledgerProfile > 0 ? ledgerProfile : snap?.backfillProfileTokens ?? 0;
		  return { stock: recall + profile, recall, profile, window: snap?.contextWindowTokens ?? null };
		}
		function currentMeterSnapshot() {
		  const sid = activeSessionId;
		  if (sid === null) return null;
		  const snap = snapshotBySession.get(sid);
		  if (!snap) return null;
		  const v = effectiveView(snap);
		  return {
		    stockTokens: v.stock,
		    recallTokens: v.recall,
		    profileTokens: v.profile,
		    contextWindowTokens: v.window,
		    mode: snap.mode
		  };
		}
		function currentAnchor() {
		  return anchorCache?.button ?? null;
		}
		var FETCH_MIN_INTERVAL_MS = 2e3;
		var FETCH_FAILURE_REMOVE_AFTER = 3;
		var lastFetchStartedAt = 0;
		var fetchInFlight = false;
		var fetchFailureStreak = 0;
		async function fetchSnapshot(force = false) {
		  const sid = activeSessionId;
		  if (!statsCall || !sid || fetchInFlight) return;
		  if (!force && Date.now() - lastFetchStartedAt < FETCH_MIN_INTERVAL_MS) return;
		  fetchInFlight = true;
		  lastFetchStartedAt = Date.now();
		  try {
		    const res = await statsCall("dsh-memory/session-stats", { sessionId: sid });
		    const v = res && res.ok ? res.value : void 0;
		    if (!res || !res.ok) {
		      fetchFailureStreak++;
		      scheduleReconcile();
		      return;
		    }
		    if (sid !== activeSessionId) return;
		    snapshotBySession.set(sid, {
		      stockTokens: v?.supported && v.memoryOccupancy ? v.memoryOccupancy.stockTokens : null,
		      recallTokens: v?.supported && v.memoryOccupancy ? v.memoryOccupancy.recallTokens : null,
		      profileTokens: v?.supported && v.memoryOccupancy ? v.memoryOccupancy.profileTokens : null,
		      backfillRecallTokens: v?.supported ? v.occupancyBackfill?.recallTokens ?? null : null,
		      backfillProfileTokens: v?.supported ? v.occupancyBackfill?.profileTokens ?? null : null,
		      contextWindowTokens: v?.supported ? v.contextWindowTokens ?? null : null,
		      mode: v?.supported ? v.mode ?? null : null,
		      updatedAt: Date.now()
		    });
		    fetchFailureStreak = 0;
		    for (const l of snapshotListeners) l();
		    scheduleReconcile();
		  } catch {
		    fetchFailureStreak++;
		    scheduleReconcile();
		  } finally {
		    fetchInFlight = false;
		  }
		}
		var PARASITE_CLASS = "dsh-mem-parasite";
		var MIN_VISIBLE_ARC = 2;
		var observer = null;
		var reconcileScheduled = false;
		var anchorCache = null;
		function watchContextMeter() {
		  if (observer !== null || typeof document === "undefined" || !document.body) return;
		  observer = new MutationObserver(onMutations);
		  observer.observe(document.body, {
		    childList: true,
		    subtree: true,
		    attributes: true,
		    attributeFilter: ["stroke-dasharray", "aria-expanded", "aria-label"]
		  });
		  scheduleReconcile();
		}
		function onMutations(mutations) {
		  for (const m of mutations) {
		    const target = m.target;
		    if (target && typeof target.classList?.contains === "function" && target.classList.contains(PARASITE_CLASS)) {
		      continue;
		    }
		    scheduleReconcile();
		    return;
		  }
		}
		function scheduleReconcile() {
		  if (reconcileScheduled) return;
		  reconcileScheduled = true;
		  queueMicrotask(() => {
		    reconcileScheduled = false;
		    reconcile();
		  });
		}
		function findAnchor() {
		  const candidates = document.querySelectorAll('button[aria-haspopup="dialog"]');
		  for (let i = 0; i < candidates.length; i++) {
		    const button = candidates[i];
		    if (!button) continue;
		    const svg = button.querySelector("svg");
		    if (!svg) continue;
		    const circles = svg.querySelectorAll("circle");
		    const radii = [];
		    for (let c = 0; c < circles.length; c++) {
		      const r = parseFloat(circles[c]?.getAttribute("r") ?? "");
		      if (Number.isFinite(r)) radii.push(r);
		    }
		    if (isContextMeterAnchor({
		      ariaHasPopup: button.getAttribute("aria-haspopup"),
		      viewBox: svg.getAttribute("viewBox"),
		      circleRadii: radii
		    })) {
		      return { button, svg };
		    }
		  }
		  return null;
		}
		function reconcile() {
		  if (!anchorCache || !anchorCache.button.isConnected || !anchorCache.svg.isConnected) {
		    const found = document.body ? findAnchor() : null;
		    anchorCache = found ? found : null;
		  }
		  if (!anchorCache) return;
		  const open = anchorCache.button.getAttribute("aria-expanded") === "true";
		  if (open !== panelWasOpen) {
		    panelWasOpen = open;
		    for (const l of panelListeners) l(open);
		    if (open) void fetchSnapshot(true);
		  }
		  applyHalo();
		}
		function applyHalo() {
		  const svg = anchorCache?.svg;
		  if (!svg) return;
		  const snap = activeSessionId !== null ? snapshotBySession.get(activeSessionId) : void 0;
		  const failing = fetchFailureStreak >= FETCH_FAILURE_REMOVE_AFTER;
		  const view = failing ? { stock: 0, recall: 0, profile: 0, window: null } : effectiveView(snap);
		  const win = view.window;
		  const ratio = win !== null && win > 0 ? Math.min(1, Math.max(0, view.stock / win)) : null;
		  const existing = svg.querySelector(`circle.${PARASITE_CLASS}`);
		  if (ratio === null || ratio <= 0) {
		    existing?.remove();
		    return;
		  }
		  let halo = existing;
		  if (!halo) {
		    halo = document.createElementNS("http://www.w3.org/2000/svg", "circle");
		    halo.setAttribute("class", PARASITE_CLASS);
		    halo.setAttribute("cx", "7");
		    halo.setAttribute("cy", "7");
		    halo.setAttribute("r", "6.4");
		    halo.setAttribute("fill", "none");
		    halo.setAttribute("stroke", "var(--dsh-mem-accent)");
		    halo.setAttribute("stroke-width", "0.85");
		    halo.setAttribute("transform", "rotate(-90 7 7)");
		    halo.style.filter = "drop-shadow(0 0 3px var(--dsh-mem-accent))";
		    halo.setAttribute("aria-hidden", "true");
		    halo.style.pointerEvents = "none";
		    svg.appendChild(halo);
		  }
		  halo.setAttribute(
		    "stroke-dasharray",
		    haloDashArray(ratio, CONTEXT_METER_CIRCUMFERENCE, MIN_VISIBLE_ARC)
		  );
		  const fill = svg.querySelector("circle:nth-of-type(2)");
		  const offKey = fill?.getAttribute("stroke-dasharray") ?? "";
		  if (svg.dataset.offKey !== void 0 && svg.dataset.offKey !== offKey) {
		    void fetchSnapshot();
		  }
		  svg.dataset.offKey = offKey;
		}
		
		// client/src/meter/panel-section.ts
		var SECTION_TAG = "dsh-mem-panel";
		var inited = false;
		var mounted = null;
		var panelOpen = false;
		function fmtTokens(n) {
		  if (n >= 1e6) {
		    const v = n / 1e6;
		    return `${v < 100 ? v.toFixed(1) : Math.round(v)}M`;
		  }
		  if (n >= 1e3) {
		    const v = n / 1e3;
		    return `${v < 100 ? v.toFixed(1) : Math.round(v)}K`;
		  }
		  return String(Math.round(n));
		}
		function initPanelSection(read) {
		  if (inited) return;
		  inited = true;
		  onMeterPanelOpen((open) => {
		    panelOpen = open;
		    if (!open) {
		      mounted?.remove();
		      mounted = null;
		      return;
		    }
		    tryMount(read);
		  });
		  onMeterSnapshotUpdate(() => {
		    if (panelOpen && !mounted) tryMount(read);
		  });
		}
		function tryMount(read) {
		  const view = read();
		  if (!view || view.stockTokens === null || view.stockTokens <= 0) return;
		  const anchor = currentAnchor();
		  if (!anchor || document.activeElement !== anchor) return;
		  const target = findDialogRoot();
		  if (!target) return;
		  mounted?.remove();
		  mounted = renderSection(view);
		  target.appendChild(mounted);
		}
		function findDialogRoot() {
		  const dialogs = document.querySelectorAll('[role="dialog"]');
		  for (let i = dialogs.length - 1; i >= 0; i--) {
		    const el = dialogs[i];
		    if (!el || !el.isConnected) continue;
		    if (el.querySelector(`[data-${SECTION_TAG}]`) || el.hasAttribute(`data-${SECTION_TAG}`)) continue;
		    const style = window.getComputedStyle(el);
		    if (style.display === "none" || style.visibility === "hidden") continue;
		    return el;
		  }
		  return null;
		}
		function row(dotColor, label, tokens) {
		  const div = document.createElement("div");
		  div.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:12px;";
		  const left = document.createElement("span");
		  left.style.cssText = `display:inline-flex;align-items:center;gap:6px;color:var(--dsh-mem-text-2);`;
		  const dot = document.createElement("i");
		  dot.style.cssText = `width:7px;height:7px;border-radius:50%;background:${dotColor};display:inline-block;`;
		  left.append(dot, document.createTextNode(label));
		  const right = document.createElement("span");
		  right.textContent = `~${fmtTokens(tokens)}`;
		  right.style.cssText = "font-variant-numeric:tabular-nums;color:var(--dsh-mem-text-1);";
		  div.append(left, right);
		  return div;
		}
		function renderSection(view) {
		  const section = document.createElement("section");
		  section.setAttribute(`data-${SECTION_TAG}`, "");
		  section.style.cssText = [
		    "border-top:1px solid var(--dsh-mem-border)",
		    "margin-top:6px",
		    "padding-top:8px",
		    "font-size:12px",
		    "line-height:1.5"
		  ].join(";");
		  const title = document.createElement("div");
		  title.textContent = "记忆占用";
		  title.style.cssText = "color:var(--dsh-mem-text-2);font-weight:600;margin-bottom:4px;";
		  section.append(title);
		  if (view.recallTokens !== null && view.recallTokens > 0) {
		    section.append(row("var(--dsh-mem-accent)", "召回片段", view.recallTokens));
		  }
		  if (view.profileTokens !== null && view.profileTokens > 0) {
		    section.append(row("var(--dsh-mem-accent)", "记忆稳定区", view.profileTokens));
		  }
		  if (view.mode === "off") {
		    const offNote = document.createElement("div");
		    offNote.textContent = "已停用 · 显示现存残留";
		    offNote.style.cssText = "color:var(--dsh-mem-text-3);padding-top:2px;";
		    section.append(offNote);
		  }
		  return section;
		}
		
		// client/src/pill/WingWheel.tsx
		var import_react24 = require("react");
		
		// client/src/pill/SessionInfoArea.tsx
		var import_react22 = require("react");
		var import_jsx_runtime22 = require("react/jsx-runtime");
		function sinfoCell(val, label, title) {
		  return /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { title: title || void 0, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "dsh-mem-sinfo-val", children: val }),
		    /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "dsh-mem-sinfo-label", children: label })
		  ] });
		}
		function SessionInfoArea(props) {
		  const rpc = props.rpc;
		  const sessionId = props.sessionId;
		  const [stats, setStats] = (0, import_react22.useState)(void 0);
		  const busyRef = (0, import_react22.useRef)(false);
		  (0, import_react22.useEffect)(() => {
		    if (!rpc || !sessionId) return void 0;
		    let alive = true;
		    let timer = null;
		    let seq = 0;
		    const tick = () => {
		      const token = ++seq;
		      rpc("dsh-memory/session-stats", { sessionId }).then((r) => {
		        if (!alive || token !== seq) return;
		        if (r && r.ok && r.value) {
		          if (r.value.supported === false) {
		            setStats(null);
		          } else {
		            const v = r.value;
		            setStats(v);
		            const d = v.distill || {};
		            const g = v.global || {};
		            busyRef.current = (d.pendingSlice || 0) > 0 || (d.parkedSlices || 0) > 0 || (g.pendingTotal || 0) > 0;
		          }
		        }
		      }).catch(() => {
		      }).then(() => {
		        if (alive) timer = setTimeout(tick, busyRef.current ? 2e3 : 5e3);
		      });
		    };
		    tick();
		    return () => {
		      alive = false;
		      if (timer) clearTimeout(timer);
		    };
		  }, [rpc, sessionId]);
		  if (stats === null) return null;
		  if (stats === void 0) {
		    return /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "dsh-mem-sinfo", children: /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: "dsh-mem-sinfo-grid", children: [
		      sinfoCell("…", "召回命中"),
		      sinfoCell("…", "攒批进度"),
		      sinfoCell("…", "本会话记忆"),
		      sinfoCell("…", "会话消息")
		    ] }) });
		  }
		  const rc = stats.recall || {};
		  const di = stats.distill || {};
		  const gl = stats.global || {};
		  const isOff = stats.mode === "off";
		  let rcVal;
		  let rcLabel;
		  let rcTitle;
		  if (rc.enabled === false) {
		    rcVal = "停用";
		    rcLabel = "召回命中";
		    const reasonText = {
		      deploy: "部署未启用",
		      global: "全局开关关闭",
		      session: "会话只写",
		      mode: "档位关闭"
		    };
		    rcTitle = rc.reason ? "召回已停用（" + (reasonText[rc.reason] ?? rc.reason) + "）" : "召回已停用（开关关闭 / 档位关闭 / 部署未启用）";
		  } else {
		    rcVal = (rc.hitTurns || 0) + "/" + (rc.injectedTurns || 0);
		    rcLabel = "召回命中 · " + (rc.totalHits || 0) + " 条";
		    rcTitle = "最近一轮命中 " + (rc.lastHits || 0) + " 条，耗时 " + (rc.lastDurationMs || 0) + "ms" + ((rc.timeouts || 0) > 0 ? "，超时跳过 " + rc.timeouts + " 次" : "");
		  }
		  let dVal;
		  let dLabel;
		  let dTitle;
		  if (isOff) {
		    dVal = String(di.parkedSlices || 0);
		    dLabel = "挂起切片";
		    dTitle = "档位关闭：未蒸馏切片挂起，切回档位后继续";
		  } else {
		    dVal = (di.pendingSlice || 0) + "/" + (di.threshold != null ? di.threshold : "-");
		    dLabel = (di.parkedSlices || 0) > 0 ? "攒批 · 挂起 " + di.parkedSlices : "攒批进度";
		    dTitle = "达到阈值后自动蒸馏（阈值随使用渐进爬坡到稳态）";
		  }
		  const pTitle = di.lastDistillAt ? "最近蒸馏 " + fmtTime(di.lastDistillAt) : "本会话尚未蒸馏";
		  const warn = gl.degraded ? "⚠ 存储不可用，记忆功能已停用" : null;
		  let note = null;
		  if (!gl.degraded) {
		    if (stats.retrieval === "keyword" && !isOff) note = "检索降级：纯关键词（向量不可用）";
		    else if (stats.retrieval === "none") note = "检索不可用（FTS 与向量均失效）";
		  }
		  const ago = fmtAgo(gl.lastExtractAt);
		  return /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: "dsh-mem-sinfo", children: [
		    warn ? /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "dsh-mem-sinfo-warn", children: warn }) : null,
		    /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: "dsh-mem-sinfo-grid", children: [
		      sinfoCell(rcVal, rcLabel, rcTitle),
		      sinfoCell(dVal, dLabel, dTitle),
		      sinfoCell(String(di.producedRecords || 0), "本会话记忆", pTitle),
		      sinfoCell(stats.l0Count != null ? String(stats.l0Count) : "…", "会话消息")
		    ] }),
		    note ? /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "dsh-mem-sinfo-note", children: note }) : null,
		    /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "dsh-mem-sinfo-sum", children: "待蒸馏 " + (gl.pendingTotal || 0) + " · 上次蒸馏 " + (ago || "尚未蒸馏") })
		  ] });
		}
		
		// client/src/pill/SessionRecalledArea.tsx
		var import_react23 = require("react");
		var import_jsx_runtime23 = require("react/jsx-runtime");
		var SHOW_CAP = 6;
		var POLL_MS2 = 4e3;
		var MATURITY_LABEL = { high: "成熟·高", mid: "成熟·中", low: "成熟·低" };
		function SessionRecalledArea(props) {
		  const rpc = props.rpc;
		  const sessionId = props.sessionId;
		  const [records, setRecords] = (0, import_react23.useState)(void 0);
		  (0, import_react23.useEffect)(() => {
		    if (!rpc || !sessionId) return void 0;
		    let alive = true;
		    let timer = null;
		    let seq = 0;
		    const tick = () => {
		      const token = ++seq;
		      rpc("dsh-memory/session-recalled", { sessionId }).then((r) => {
		        if (!alive || token !== seq) return;
		        if (r && r.ok && r.value) setRecords(r.value.records);
		      }).catch(() => {
		      }).then(() => {
		        if (alive) timer = setTimeout(tick, POLL_MS2);
		      });
		    };
		    tick();
		    return () => {
		      alive = false;
		      if (timer) clearTimeout(timer);
		    };
		  }, [rpc, sessionId]);
		  if (records === void 0) return null;
		  const recentFirst = [...records].reverse();
		  const shown = recentFirst.slice(0, SHOW_CAP);
		  const hidden = recentFirst.length - shown.length;
		  return /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "dsh-mem-sinfo", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
		      "div",
		      {
		        style: { fontSize: 11, color: "var(--dsh-mem-text-3)", marginBottom: 6 },
		        title: "本会话召回注入、且目前仍在上下文里的记忆（压缩/清空后自动消失，不是常驻）",
		        children: "本会话召回 " + records.length + " 条"
		      }
		    ),
		    records.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { style: { fontSize: 11, color: "var(--dsh-mem-text-3)", lineHeight: "16px" }, children: "还没召回到记忆（聊几轮后按相关性自动浮现）" }) : /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
		      shown.map((r) => /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { style: rowStyle, title: rowTitle(r), children: [
		        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
		          "span",
		          {
		            className: "dsh-mem-tag dsh-mem-tag-" + r.type,
		            style: { flexShrink: 0, whiteSpace: "nowrap" },
		            children: TYPE_LABELS[r.type] || r.type
		          }
		        ),
		        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "dsh-mem-sinfo-val", style: textStyle, children: r.content }),
		        r.maturity ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { style: { fontSize: 10, color: "var(--dsh-mem-text-3)", whiteSpace: "nowrap", flexShrink: 0 }, children: MATURITY_LABEL[r.maturity] }) : null
		      ] }, r.id)),
		      hidden > 0 ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { style: { fontSize: 11, color: "var(--dsh-mem-text-3)" }, children: "+ " + hidden + " 条更早召回（详见面板「记忆」页）" }) : null
		    ] })
		  ] });
		}
		var rowStyle = {
		  display: "flex",
		  alignItems: "flex-start",
		  gap: 6,
		  lineHeight: "16px"
		};
		var textStyle = {
		  fontSize: 12,
		  lineHeight: "16px",
		  fontWeight: 400,
		  minWidth: 0,
		  display: "-webkit-box",
		  WebkitLineClamp: 2,
		  WebkitBoxOrient: "vertical",
		  overflow: "hidden"
		};
		function rowTitle(r) {
		  const head = "[" + (TYPE_LABELS[r.type] || r.type) + "] " + r.content;
		  const sc = r.usageScenario && r.usageScenario.length > 0 ? "\n使用场景：" + r.usageScenario.join("；") : "";
		  return head + sc;
		}
		
		// client/src/pill/WingWheel.tsx
		var import_jsx_runtime24 = require("react/jsx-runtime");
		var SIZE = 196;
		var CENTER = SIZE / 2;
		var R = 64;
		var DRAG_SLOP = 4;
		var DEAD = 3 * (Math.PI / 180);
		var DEG = Math.PI / 180;
		var TAU = Math.PI * 2;
		function cornerAngle(i) {
		  return (-90 + i * 45) * DEG;
		}
		function cornerPos(i) {
		  const a = cornerAngle(i);
		  return { left: CENTER + R * Math.cos(a), top: CENTER + R * Math.sin(a) };
		}
		function cornerXY(i) {
		  const p = cornerPos(i);
		  return { x: p.left, y: p.top };
		}
		function normAngle(a) {
		  while (a < -Math.PI) a += TAU;
		  while (a >= Math.PI) a -= TAU;
		  return a;
		}
		function angleIndex(a) {
		  let t = a + 90 * DEG;
		  while (t < 0) t += TAU;
		  while (t >= TAU) t -= TAU;
		  return Math.round(t / (45 * DEG)) % 8;
		}
		function snapIndex(p, cur) {
		  const cand = angleIndex(p);
		  if (cand === cur) return cur;
		  const curA = cornerAngle(cur);
		  const candA = cornerAngle(cand);
		  const dir = Math.sign(normAngle(candA - curA)) || 1;
		  const edge = curA + dir * (22.5 * DEG);
		  if (Math.abs(normAngle(p - edge)) < DEAD) return cur;
		  return cand;
		}
		function WingWheel(props) {
		  ensureThemeStyle();
		  const isOff = props.mode === "off";
		  const [overview, setOverview] = (0, import_react24.useState)(null);
		  const [backfillBusy, setBackfillBusy] = (0, import_react24.useState)(false);
		  const [localError, setLocalError] = (0, import_react24.useState)(null);
		  const timersRef = (0, import_react24.useRef)([]);
		  (0, import_react24.useEffect)(
		    () => () => {
		      for (const t of timersRef.current) window.clearTimeout(t);
		    },
		    []
		  );
		  (0, import_react24.useEffect)(() => {
		    let alive = true;
		    props.rpc("dsh-memory/wing-overview", {}).then((r) => {
		      if (!alive) return;
		      if (r && r.ok) setOverview(r.value);
		    }).catch(() => {
		    });
		    return () => {
		      alive = false;
		    };
		  }, [props.rpc]);
		  const cornerCount = (id) => {
		    if (!overview) return null;
		    if (id === "general") return overview.general;
		    return overview.corners.find((c) => c.id === id)?.count ?? 0;
		  };
		  const backfill = () => {
		    if (backfillBusy || !overview || overview.unlabeled === 0) return;
		    setBackfillBusy(true);
		    setLocalError(null);
		    let polls = 0;
		    const finish = () => setBackfillBusy(false);
		    const tick = () => {
		      polls++;
		      props.rpc("dsh-memory/wing-overview", {}).then((r) => {
		        const v = r && r.ok ? r.value : null;
		        if (v) setOverview(v);
		        if (v && v.unlabeled === 0 || polls >= 20) finish();
		        else {
		          const t = window.setTimeout(tick, 3e3);
		          timersRef.current.push(t);
		        }
		      }).catch(() => finish());
		    };
		    props.rpc("dsh-memory/wing-backfill", {}).then((r) => {
		      if (!r || !r.ok) {
		        setLocalError(r && r.error ? "回填失败：" + r.error.message : "回填失败");
		        finish();
		        return;
		      }
		      timersRef.current.push(window.setTimeout(tick, 3e3));
		    }).catch((e) => {
		      setLocalError("回填失败：" + String(e && e.message || e));
		      finish();
		    });
		  };
		  const boxRef = (0, import_react24.useRef)(null);
		  const startRef = (0, import_react24.useRef)(null);
		  const movedRef = (0, import_react24.useRef)(false);
		  const downIndexRef = (0, import_react24.useRef)(null);
		  const dragTargetRef = (0, import_react24.useRef)(null);
		  const [drag, setDrag] = (0, import_react24.useState)(null);
		  const lockedIndex = (() => {
		    if (props.halls.length !== 1 || !overview) return null;
		    const i = overview.corners.findIndex((c) => c.id === props.halls[0]);
		    return i >= 0 ? i : null;
		  })();
		  const activeCorner = drag ? drag.index : lockedIndex;
		  const blockPosRef = (0, import_react24.useRef)(
		    activeCorner != null ? cornerXY(activeCorner) : { x: CENTER, y: CENTER }
		  );
		  const blockTargetRef = (0, import_react24.useRef)(blockPosRef.current);
		  const [blockPos, setBlockPos] = (0, import_react24.useState)(blockPosRef.current);
		  (0, import_react24.useEffect)(() => {
		    blockTargetRef.current = activeCorner != null ? cornerXY(activeCorner) : { x: CENTER, y: CENTER };
		  }, [activeCorner]);
		  const reducedMotionRef = (0, import_react24.useRef)(false);
		  (0, import_react24.useEffect)(() => {
		    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
		    const apply2 = () => {
		      reducedMotionRef.current = mq.matches;
		    };
		    apply2();
		    mq.addEventListener("change", apply2);
		    return () => mq.removeEventListener("change", apply2);
		  }, []);
		  (0, import_react24.useEffect)(() => {
		    let raf = 0;
		    const loop = () => {
		      const cur = blockPosRef.current;
		      const tgt = blockTargetRef.current;
		      if (reducedMotionRef.current) {
		        if (cur.x !== tgt.x || cur.y !== tgt.y) {
		          blockPosRef.current = tgt;
		          setBlockPos(tgt);
		        }
		      } else {
		        const dx = tgt.x - cur.x;
		        const dy = tgt.y - cur.y;
		        if (Math.hypot(dx, dy) > 0.05) {
		          const next = { x: cur.x + dx * 0.2, y: cur.y + dy * 0.2 };
		          blockPosRef.current = next;
		          setBlockPos(next);
		        } else if (cur.x !== tgt.x || cur.y !== tgt.y) {
		          blockPosRef.current = tgt;
		          setBlockPos(tgt);
		        }
		      }
		      raf = window.requestAnimationFrame(loop);
		    };
		    raf = window.requestAnimationFrame(loop);
		    return () => window.cancelAnimationFrame(raf);
		  }, []);
		  const pointAngle = (clientX, clientY) => {
		    const box = boxRef.current;
		    if (!box) return { angle: 0, dist: 0 };
		    const r = box.getBoundingClientRect();
		    const scale = r.width / SIZE || 1;
		    const dx = (clientX - (r.left + CENTER * scale)) / scale;
		    const dy = (clientY - (r.top + CENTER * scale)) / scale;
		    return { angle: Math.atan2(dy, dx), dist: Math.hypot(dx, dy) };
		  };
		  const INNER = 34;
		  const onBoxDown = (e) => {
		    if (isOff) return;
		    const { angle, dist } = pointAngle(e.clientX, e.clientY);
		    if (dist < 24) return;
		    e.currentTarget.setPointerCapture?.(e.pointerId);
		    movedRef.current = false;
		    startRef.current = { x: e.clientX, y: e.clientY };
		    const idx = angleIndex(angle);
		    downIndexRef.current = idx;
		    dragTargetRef.current = idx;
		    setDrag({ index: idx });
		  };
		  const onBoxMove = (e) => {
		    if (!startRef.current) return;
		    const s = startRef.current;
		    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > DRAG_SLOP) movedRef.current = true;
		    if (!movedRef.current) return;
		    const { angle, dist } = pointAngle(e.clientX, e.clientY);
		    const cur = dragTargetRef.current;
		    const cand = dist < INNER ? null : cur == null ? angleIndex(angle) : snapIndex(angle, cur);
		    if (cand !== cur) {
		      dragTargetRef.current = cand;
		      setDrag({ index: cand });
		    }
		  };
		  const onBoxUp = (e) => {
		    if (!startRef.current) return;
		    e.currentTarget.releasePointerCapture?.(e.pointerId);
		    const moved = movedRef.current;
		    const di = downIndexRef.current;
		    const dt = dragTargetRef.current;
		    startRef.current = null;
		    downIndexRef.current = null;
		    dragTargetRef.current = null;
		    setDrag(null);
		    if (!moved) {
		      const id = di != null ? overview?.corners[di]?.id : void 0;
		      if (!id) return;
		      if (!props.halls.includes(id)) props.onCommitWing([id]);
		    } else if (dt == null) {
		      if (props.halls.length !== 0) props.onCommitWing(null);
		    } else {
		      const id = overview?.corners[dt]?.id;
		      if (id && !props.halls.includes(id)) props.onCommitWing([id]);
		    }
		  };
		  const polyPoints = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
		    const p = cornerPos(i);
		    return `${p.left},${p.top}`;
		  }).join(" ");
		  const grayStyle = isOff ? { opacity: 0.45, pointerEvents: "none" } : {};
		  const boundariesDisabled = props.halls.length === 0 || isOff;
		  return /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", { style: { width: SIZE }, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)(
		      "div",
		      {
		        ref: boxRef,
		        style: { position: "relative", width: SIZE, height: SIZE, ...grayStyle },
		        onPointerDown: onBoxDown,
		        onPointerMove: onBoxMove,
		        onPointerUp: onBoxUp,
		        onPointerCancel: onBoxUp,
		        children: [
		          /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)(
		            "svg",
		            {
		              width: SIZE,
		              height: SIZE,
		              style: { position: "absolute", inset: 0, pointerEvents: "none" },
		              "aria-hidden": "true",
		              children: [
		                /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(
		                  "polygon",
		                  {
		                    points: polyPoints,
		                    fill: "none",
		                    stroke: "var(--dsh-mem-wing-line)",
		                    strokeWidth: "1",
		                    strokeDasharray: "3 3",
		                    opacity: 0.45
		                  }
		                ),
		                /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(
		                  "polygon",
		                  {
		                    points: polyPoints,
		                    fill: "none",
		                    stroke: "var(--dsh-mem-wing-line)",
		                    strokeWidth: "1"
		                  }
		                ),
		                [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
		                  const p = cornerPos(i);
		                  return /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(
		                    "line",
		                    {
		                      x1: CENTER,
		                      y1: CENTER,
		                      x2: p.left,
		                      y2: p.top,
		                      stroke: "var(--dsh-mem-wing-line)",
		                      strokeWidth: "1"
		                    },
		                    "spoke" + i
		                  );
		                })
		              ]
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(
		            "div",
		            {
		              "aria-hidden": "true",
		              style: {
		                position: "absolute",
		                left: blockPos.x,
		                top: blockPos.y,
		                transform: "translate(-50%, -50%)",
		                width: 52,
		                height: 30,
		                borderRadius: 10,
		                border: "1.5px solid var(--dsh-mem-accent)",
		                background: "var(--dsh-mem-accent-weak)",
		                pointerEvents: "none",
		                zIndex: 1
		              }
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(
		            "button",
		            {
		              type: "button",
		              title: "智能档：自动判断召回各域（点中心 / 从角向内拖 = 全域）",
		              onClick: () => props.onCommitWing(null),
		              style: {
		                position: "absolute",
		                left: CENTER,
		                top: CENTER,
		                transform: "translate(-50%, -50%)",
		                width: 52,
		                height: 30,
		                borderRadius: 10,
		                border: "none",
		                background: "transparent",
		                color: activeCorner == null ? "var(--dsh-mem-wing-corner-on)" : "var(--dsh-mem-wing-corner)",
		                fontSize: 11,
		                fontWeight: 600,
		                cursor: "pointer",
		                zIndex: 2
		              },
		              children: "智能"
		            }
		          ),
		          [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
		            const corner = overview?.corners[i];
		            const id = corner?.id;
		            const label = corner?.label ?? LABEL_FALLBACK[i] ?? `域${i + 1}`;
		            const count = id ? cornerCount(id) : null;
		            const active = activeCorner === i;
		            const dim = activeCorner != null && !active;
		            const empty = count === 0;
		            const p = cornerPos(i);
		            return /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)(
		              "div",
		              {
		                title: id ? `「${label}」${count ?? 0} 条
		点按/拖动 = 以该角为主题（抑制其他角）` : "词表加载中",
		                style: {
		                  position: "absolute",
		                  left: p.left,
		                  top: p.top,
		                  transform: "translate(-50%, -50%)",
		                  display: "flex",
		                  flexDirection: "column",
		                  alignItems: "center",
		                  gap: 0,
		                  padding: "1px 4px",
		                  borderRadius: 8,
		                  border: "1px solid transparent",
		                  background: "transparent",
		                  color: active ? "var(--dsh-mem-wing-corner-on)" : empty ? "var(--dsh-mem-wing-empty)" : "var(--dsh-mem-wing-corner)",
		                  fontSize: 9.5,
		                  lineHeight: "12px",
		                  fontWeight: active ? 600 : 400,
		                  whiteSpace: "nowrap",
		                  maxWidth: 58,
		                  opacity: dim ? 0.45 : 1,
		                  pointerEvents: "none",
		                  zIndex: 2
		                },
		                children: [
		                  /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { children: label }),
		                  /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { style: { fontSize: 8, opacity: 0.75, fontVariantNumeric: "tabular-nums" }, children: count === null ? " " : empty ? "空角" : `${count} 条` })
		                ]
		              },
		              id ?? i
		            );
		          })
		        ]
		      }
		    ),
		    /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)(
		      "div",
		      {
		        title: props.halls.length === 0 ? "选定某个角（单 Wing）后，这两项才生效" : "锁定 Wing 时两类无角记忆是否参与召回",
		        style: {
		          display: "flex",
		          flexDirection: "column",
		          gap: 6,
		          marginTop: 10,
		          opacity: boundariesDisabled ? 0.45 : void 0,
		          filter: boundariesDisabled ? "grayscale(1)" : void 0,
		          pointerEvents: boundariesDisabled ? "none" : void 0
		        },
		        children: [
		          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { style: { fontSize: 11, color: "var(--dsh-mem-text-3)" }, children: overview ? `另有 ${overview.unlabeled} 条未打标` : "未打标" }),
		          /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(
		              Segmented,
		              {
		                value: props.hallIncludeUnlabeled ? "in" : "ex",
		                options: [
		                  { key: "in", label: "含未打标", title: "未打标记忆默认包含" },
		                  { key: "ex", label: "不含", title: "锁定 Wing 时排除未打标记忆" }
		                ],
		                onChange: (key) => props.onCommitWingBoundaries({ includeUnlabeled: key === "in" })
		              }
		            ),
		            /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(
		              Segmented,
		              {
		                value: props.hallIncludeGeneral ? "in" : "ex",
		                options: [
		                  { key: "in", label: "含跨域", title: "跨域（general）兜底记忆也参与召回" },
		                  { key: "ex", label: "不含", title: "跨域与单主题相悖，默认不含" }
		                ],
		                onChange: (key) => props.onCommitWingBoundaries({ includeGeneral: key === "in" })
		              }
		            )
		          ] })
		        ]
		      }
		    ),
		    /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(Row, { label: "会话", children: /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(
		      Segmented,
		      {
		        value: isOff ? "off" : "on",
		        options: [
		          { key: "on", label: "启用", title: "本会话正常捕获/蒸馏/注入记忆" },
		          {
		            key: "off",
		            label: "关闭",
		            title: "本会话对记忆系统隐身：不捕获、不蒸馏、不注入（数据保留）"
		          }
		        ],
		        onChange: (key) => props.onCommit(key === "off" ? "off" : "auto")
		      }
		    ) }),
		    props.recall !== void 0 && props.onCommitRecall ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(Row, { label: "注入", children: /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(
		      Segmented,
		      {
		        value: props.recall === null ? "follow" : props.recall ? "on" : "off",
		        disabled: isOff,
		        options: [
		          { key: "follow", label: "跟随全局", title: "清除本会话覆盖，跟随全局召回开关" },
		          { key: "on", label: "开", title: "本会话强制注入记忆" },
		          { key: "off", label: "关", title: "只写：记忆照常沉淀，但不注入本会话" }
		        ],
		        onChange: (key) => props.onCommitRecall(key === "on" ? true : key === "off" ? false : null)
		      }
		    ) }) : null,
		    /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)(
		      "div",
		      {
		        style: {
		          display: "flex",
		          justifyContent: "space-between",
		          alignItems: "center",
		          gap: 8,
		          marginTop: 10
		        },
		        children: [
		          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { style: { fontSize: 11, color: "var(--dsh-mem-text-3)" }, children: overview ? `未打标 ${overview.unlabeled} 条` : "未打标计数加载中" }),
		          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(
		            ActionButton,
		            {
		              label: backfillBusy ? "回填中…" : "回填",
		              title: "对存量未打标记忆批量补打 wing 标签",
		              disabled: !overview || overview.unlabeled === 0 || backfillBusy,
		              onClick: () => backfill()
		            }
		          )
		        ]
		      }
		    ),
		    props.error || localError ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("div", { style: { fontSize: 11, color: "var(--dsh-mem-danger)", marginTop: 8 }, children: props.error || localError }) : null,
		    /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(SessionRecalledArea, { rpc: props.rpc, sessionId: props.sessionId }),
		    /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(SessionInfoArea, { rpc: props.rpc, sessionId: props.sessionId })
		  ] });
		}
		function Row(props) {
		  return /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)(
		    "div",
		    {
		      style: {
		        display: "flex",
		        flexDirection: "column",
		        gap: 6,
		        marginTop: 10
		      },
		      children: [
		        /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { style: { fontSize: 12, color: "var(--dsh-mem-text-3)" }, children: props.label }),
		        props.children
		      ]
		    }
		  );
		}
		var LABEL_FALLBACK = ["工作", "人际", "学习", "创作娱乐", "居家", "健康", "财务", "出行"];
		function useViewportClamp(popRef) {
		  const shiftRef = (0, import_react24.useRef)(0);
		  const [shiftX, setShiftX] = (0, import_react24.useState)(0);
		  (0, import_react24.useEffect)(() => {
		    const clamp = () => {
		      const el = popRef.current;
		      if (!el) return;
		      const r = el.getBoundingClientRect();
		      if (r.width === 0) return;
		      const left = r.left - shiftRef.current;
		      const edge = 8;
		      let next = 0;
		      if (left < edge) next = edge - left;
		      else if (left + r.width > window.innerWidth - edge) {
		        next = window.innerWidth - edge - (left + r.width);
		      }
		      if (next !== shiftRef.current) {
		        shiftRef.current = next;
		        setShiftX(next);
		      }
		    };
		    clamp();
		    window.addEventListener("resize", clamp);
		    const iv = window.setInterval(clamp, 100);
		    return () => {
		      window.removeEventListener("resize", clamp);
		      window.clearInterval(iv);
		    };
		  }, [popRef]);
		  return shiftX;
		}
		
		// client/src/pill/MemoryModePill.tsx
		var import_jsx_runtime25 = require("react/jsx-runtime");
		function MemoryModePill(props) {
		  const rpc = props.rpc;
		  const sessionId = props.sessionId || props.session && props.session.sessionId;
		  const [mode, setMode] = (0, import_react25.useState)(null);
		  const [recall, setRecall] = (0, import_react25.useState)(null);
		  const [recallResolved, setRecallResolved] = (0, import_react25.useState)(true);
		  const [halls, setWings] = (0, import_react25.useState)([]);
		  const [hallIncludeUnlabeled, setWingIncludeUnlabeled] = (0, import_react25.useState)(true);
		  const [hallIncludeGeneral, setWingIncludeGeneral] = (0, import_react25.useState)(false);
		  const [wingLabels, setHallLabels] = (0, import_react25.useState)({});
		  const [error, setError] = (0, import_react25.useState)(null);
		  const [open, setOpen] = (0, import_react25.useState)(false);
		  const wrapRef = (0, import_react25.useRef)(null);
		  const popRef = (0, import_react25.useRef)(null);
		  const shiftX = useViewportClamp(popRef);
		  const seqRef = (0, import_react25.useRef)(0);
		  const load = (0, import_react25.useCallback)(() => {
		    if (!sessionId || !rpc) return;
		    const token = ++seqRef.current;
		    setError(null);
		    rpc("dsh-memory/session-mode-get", { sessionId }).then((r) => {
		      if (token !== seqRef.current) return;
		      if (r && r.ok && r.value) {
		        setMode(r.value.mode);
		        setRecall(r.value.recall);
		        setRecallResolved(r.value.recallResolved);
		        setWings(r.value.halls ?? (r.value.hall ? [r.value.hall] : []));
		        setWingIncludeUnlabeled(r.value.hallIncludeUnlabeled);
		        setWingIncludeGeneral(r.value.hallIncludeGeneral);
		      } else setError(r && !r.ok ? r.error.message : "RPC error");
		    }).catch((e) => {
		      if (token !== seqRef.current) return;
		      setError(String(e && e.message || e));
		    });
		    rpc("dsh-memory/wing-overview", {}).then((r) => {
		      if (r && r.ok && r.value) {
		        setHallLabels(Object.fromEntries(r.value.corners.map((c) => [c.id, c.label])));
		      }
		    }).catch(() => {
		    });
		  }, [sessionId, rpc]);
		  (0, import_react25.useEffect)(() => {
		    load();
		  }, [load]);
		  (0, import_react25.useEffect)(() => {
		    watchSidebarIcon();
		  }, []);
		  (0, import_react25.useEffect)(() => {
		    initOccupancyIndicator(
		      (endpoint, payload) => rpc(endpoint, payload)
		    );
		    initPanelSection(currentMeterSnapshot);
		    watchContextMeter();
		    noteOccupancySession(sessionId ?? null);
		  }, [sessionId, rpc]);
		  (0, import_react25.useEffect)(() => {
		    if (!open) return;
		    const onDown = (e) => {
		      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
		    };
		    const onKey = (e) => {
		      if (e.key === "Escape") setOpen(false);
		    };
		    document.addEventListener("pointerdown", onDown);
		    document.addEventListener("keydown", onKey);
		    return () => {
		      document.removeEventListener("pointerdown", onDown);
		      document.removeEventListener("keydown", onKey);
		    };
		  }, [open]);
		  const commit2 = (next) => {
		    if (!rpc || !sessionId || mode === null || next === mode) return;
		    const prev = mode;
		    const token = seqRef.current;
		    setMode(next);
		    setError(null);
		    rpc("dsh-memory/session-mode-set", { sessionId, mode: next }).then((r) => {
		      if (token !== seqRef.current) return;
		      if (!r || !r.ok) {
		        setMode(prev);
		        setError(r && r.error ? "档位写入失败：" + r.error.message : "档位写入失败");
		      }
		    }).catch((e) => {
		      if (token !== seqRef.current) return;
		      setMode(prev);
		      setError("档位写入失败：" + String(e && e.message || e));
		    });
		  };
		  const commitRecall = (next) => {
		    if (!rpc || !sessionId || mode === null || next === recall) return;
		    const prevRecall = recall;
		    const prevResolved = recallResolved;
		    const token = seqRef.current;
		    setRecall(next);
		    if (next !== null) setRecallResolved(next);
		    setError(null);
		    rpc("dsh-memory/session-mode-set", { sessionId, mode, recall: next }).then((r) => {
		      if (token !== seqRef.current) return;
		      if (!r || !r.ok) {
		        setRecall(prevRecall);
		        setRecallResolved(prevResolved);
		        setError(r && r.error ? "注入设置失败：" + r.error.message : "注入设置失败");
		      } else {
		        setRecall(r.value.recall);
		        setRecallResolved(r.value.recallResolved);
		      }
		    }).catch((e) => {
		      if (token !== seqRef.current) return;
		      setRecall(prevRecall);
		      setRecallResolved(prevResolved);
		      setError("注入设置失败：" + String(e && e.message || e));
		    });
		  };
		  const commitWing = (next) => {
		    if (!rpc || !sessionId || mode === null) return;
		    const norm = next ?? [];
		    if (JSON.stringify(norm) === JSON.stringify(halls)) return;
		    const prevHalls = halls;
		    const token = seqRef.current;
		    setWings(norm);
		    setError(null);
		    rpc("dsh-memory/session-mode-set", { sessionId, mode, halls: next }).then((r) => {
		      if (token !== seqRef.current) return;
		      if (!r || !r.ok) {
		        setWings(prevHalls);
		        setError(r && r.error ? "域设置失败：" + r.error.message : "域设置失败");
		      } else {
		        setWings(r.value.halls ?? (r.value.hall ? [r.value.hall] : []));
		      }
		    }).catch((e) => {
		      if (token !== seqRef.current) return;
		      setWings(prevHalls);
		      setError("域设置失败：" + String(e && e.message || e));
		    });
		  };
		  const commitWingBoundaries = (patch) => {
		    if (!rpc || !sessionId || mode === null) return;
		    const prev = { unlabeled: hallIncludeUnlabeled, general: hallIncludeGeneral };
		    const token = seqRef.current;
		    if (patch.includeUnlabeled !== void 0) setWingIncludeUnlabeled(patch.includeUnlabeled);
		    if (patch.includeGeneral !== void 0) setWingIncludeGeneral(patch.includeGeneral);
		    setError(null);
		    rpc("dsh-memory/session-mode-set", {
		      sessionId,
		      mode,
		      halls: halls.length > 0 ? halls : null,
		      hallIncludeUnlabeled: patch.includeUnlabeled,
		      hallIncludeGeneral: patch.includeGeneral
		    }).then((r) => {
		      if (token !== seqRef.current) return;
		      if (!r || !r.ok) {
		        setWingIncludeUnlabeled(prev.unlabeled);
		        setWingIncludeGeneral(prev.general);
		        setError(r && r.error ? "域设置失败：" + r.error.message : "域设置失败");
		      } else {
		        setWings(r.value.halls ?? (r.value.hall ? [r.value.hall] : []));
		        setWingIncludeUnlabeled(r.value.hallIncludeUnlabeled);
		        setWingIncludeGeneral(r.value.hallIncludeGeneral);
		      }
		    }).catch((e) => {
		      if (token !== seqRef.current) return;
		      setWingIncludeUnlabeled(prev.unlabeled);
		      setWingIncludeGeneral(prev.general);
		      setError("域设置失败：" + String(e && e.message || e));
		    });
		  };
		  if (!sessionId || !rpc) return null;
		  const info = modeInfo(mode);
		  const loaded = mode !== null;
		  const isOff = loaded && mode === "off";
		  const isFlow = loaded && !isOff;
		  const wingText = halls.length === 1 ? wingLabels[halls[0]] ?? halls[0] : halls.length > 1 ? `${halls.length} Wing` : null;
		  const faceLabel = !loaded ? error ? "⚠" : "…" : isOff ? info.label : !recallResolved ? "只写" : wingText ? wingText : info.label;
		  ensureThemeStyle();
		  const pillStyle = {
		    position: "relative",
		    // dsh-mem-pill-hit 的 ::after 隐形热区以此为定位基准
		    display: "inline-flex",
		    alignItems: "center",
		    gap: 4,
		    height: 24,
		    padding: "0 10px",
		    borderRadius: 999,
		    fontSize: 12,
		    fontWeight: 500,
		    lineHeight: "20px",
		    cursor: "pointer",
		    // 流光档的边框/背景由 .dsh-mem-flow 的双层背景提供（流光边 + 不透明内底），
		    // inline 只给文字色 / 光晕 / 流光内底混色通道（--dsh-mem-pill-tint）
		    color: isFlow ? info.color : "var(--dsh-mem-text-2)"
		  };
		  if (isFlow) {
		    pillStyle.boxShadow = "0 0 12px color-mix(in srgb, " + info.color + " 30%, transparent)";
		    pillStyle["--dsh-mem-pill-tint"] = info.color;
		  }
		  return /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { ref: wrapRef, style: { position: "relative", display: "inline-flex" }, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)(
		      "button",
		      {
		        type: "button",
		        title: error ? "档位读取失败：" + error + "（点击重试）" : "本会话记忆域与档位（点击切换）",
		        onClick: () => {
		          if (error) load();
		          setOpen(!open);
		        },
		        className: (isFlow ? "dsh-mem-flow" : "dsh-mem-pill-off") + " dsh-mem-pill-hit",
		        style: pillStyle,
		        children: [
		          "记忆 · ",
		          /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { children: faceLabel })
		        ]
		      }
		    ),
		    open ? /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
		      "div",
		      {
		        ref: popRef,
		        style: {
		          position: "absolute",
		          bottom: "calc(100% + 8px)",
		          left: "50%",
		          transform: "translateX(calc(-50% + " + shiftX + "px))",
		          zIndex: 1e3
		        },
		        children: /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
		          "div",
		          {
		            className: "dsh-mem-popover",
		            style: { position: "relative", padding: "10px 12px" },
		            children: /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
		              WingWheel,
		              {
		                mode: mode || "auto",
		                halls,
		                hallIncludeUnlabeled,
		                hallIncludeGeneral,
		                onCommit: commit2,
		                onCommitWing: commitWing,
		                onCommitWingBoundaries: commitWingBoundaries,
		                recall: loaded ? recall : void 0,
		                onCommitRecall: commitRecall,
		                error,
		                rpc,
		                sessionId
		              }
		            )
		          }
		        )
		      }
		    ) : null
		  ] });
		}
		
		// client/src/entry.tsx
		var inject = ["slots"];
		var SETTINGS_SEAT = "settings.section";
		var SEAT_PROBE_MS = 3e3;
		function apply(ctx) {
		  const rpc = makeRpc(ctx);
		  console.info("[dsh-prime-memory] client apply: slots 注入就绪,注册 UI 槽位");
		  const SETTINGS_SEAT2 = "settings.section";
		  let cardSeatLive = false;
		  try {
		    ctx.slots.inject(SETTINGS_SEAT2, () => {
		      cardSeatLive = true;
		      try {
		        return ctx.slots.register(
		          { name: SETTINGS_SEAT2, id: "dsh-memory", order: 200, label: "记忆", inject: () => ({ rpc }) },
		          MemoryPanel
		        );
		      } catch (err) {
		        console.warn(`[dsh-prime-memory] ${SETTINGS_SEAT2} 注册失败:`, err);
		        return () => {
		        };
		      }
		    });
		  } catch (err) {
		    console.warn(`[dsh-prime-memory] ${SETTINGS_SEAT2} 槽位未声明:`, err);
		  }
		  setTimeout(() => {
		    if (cardSeatLive) return;
		    console.warn(
		      `[dsh-prime-memory] 宿主未声明 ${SETTINGS_SEAT2}：设置里的「记忆」面板不会出现。（0.1.5 的座位集合本机未验证，请在真机上确认。）`
		    );
		  }, SEAT_PROBE_MS);
		  try {
		    ctx.slots.inject("conversation.input.left", () => {
		      return ctx.slots.register(
		        {
		          name: "conversation.input.left",
		          id: "dsh-memory-mode",
		          order: 100,
		          inject: (sessionId) => {
		            return { sessionId, rpc };
		          }
		        },
		        MemoryModePill
		      );
		    });
		  } catch (err) {
		    console.warn("[dsh-prime-memory] conversation.input.left 注册失败:", err);
		  }
		}
		
		// esbuild 对具名导出会整体替换 module.exports(__toCommonJS:getter + __esModule);
		// 摊平回官方 bundle 同款的普通数据属性对象(含 toStringTag),loader 只按属性读取。
		var __flat = {};
		for (var __k in module.exports) __flat[__k] = module.exports[__k];
		Object.defineProperty(__flat, Symbol.toStringTag, { value: "Module" });
		return __flat;
	}
});
