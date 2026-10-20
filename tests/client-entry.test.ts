/**
 * 客户端 bundle 的座位契约。
 *
 * ## 这个文件防的是什么（一次真实回归）
 *
 * 曾经把设置面板同时注册到三个座位，理由是「`slots.inject` 只在座位被声明时才触发
 * ⇒ 多个座位天然互斥」。**实测推翻**：0.1.2 宿主**同时声明全部三个**，
 * 于是设置里出现了**三份**同名面板。
 *
 * 三条宿主线的座位事实（读宿主源码得来，不是推测）：
 *
 * | 座位 | 谁声明 | 渲染成什么 |
 * |---|---|---|
 * | `settings.section` | `dsh-client-ui-settings-general:650` | 顶层导航页（与「插件」分区**同级**） |
 * | `settings.plugins.tab` | `dsh-client-ui-settings-plugins:1781` | 「插件」分区里**与「插件配置」平级的标签页** |
 * | `settings.plugin.item` | 同包 `:1793`（`configurable` 贡献运行期声明） | **「插件配置」下的子级卡片** |
 *
 * 三条**同时存在**。本插件的裁定：**只挂顶层分节 `settings.section`**（记忆面板是
 * 多标签页的完整面板，适合放顶层）——「插件配置」下那个子级座位留给轻量单卡片
 * （search-index 留在那里）。
 *
 * 所以本文件的第一条硬断言是：**这条宿主线上，设置座位恰好注册一个，且是
 * `settings.section`**。
 *
 * ## 它证明什么 / 不证明什么
 *
 * 证明：bundle 在顶层分节座位上注册了面板；另外两个设置座位一条都不注册；
 * 座位没被声明时**不擅自挂别的**，但会在 Console 里说出来。
 * 不证明：React 真的渲染出面板 —— 那仍然是真机 GUI 检查。
 *
 * ⚠️ 读的是**构建产物** `dist/client.js`：改了 `client/src` 必须先 `npm run build`。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(HERE, '..', 'dist', 'client.js');
const PLUGIN_ID = 'dsh-prime-memory';

const INPUT_SEAT = 'conversation.input.left';
const CARD_SEAT = 'settings.plugin.item';
const SIBLING_TAB = 'settings.plugins.tab';
const TOP_SECTION = 'settings.section';

/** 判定期（与 entry.tsx 的 SEAT_PROBE_MS 一致）。 */
const PROBE_MS = 3000;

/** 0.1.2 实际声明：三个设置座位**全在**（这就是当年出现三份的原因）。 */
const HOST_012 = [TOP_SECTION, SIBLING_TAB, CARD_SEAT, INPUT_SEAT];

/** 任意属性都返回可调用的桩：bundle 不渲染，只需这些模块能被 require 到。 */
function stubModule(): unknown {
  const target = function () {};
  return new Proxy(target, {
    get: (_t, prop) => {
      if (prop === Symbol.toStringTag) return 'Module';
      if (prop === 'Fragment') return {};
      return stubModule();
    },
    apply: () => ({}),
  });
}

const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')) as {
  dsh?: { client?: { inject?: string[] } };
};
const REACT_BASELINE = ['react', 'react/jsx-runtime'];
const DECLARED = new Set([...REACT_BASELINE, ...(pkg.dsh?.client?.inject ?? [])]);
const RETIRED = /@deepseek-ai\/dsh-client-(runtime|store)(\/|$)/;

function documentStub(): unknown {
  // canvas 2D 上下文桩:bundle 现在含 @antv/g6,它在装载期探测 canvas 能力
  // (getContext('2d') 取不到就会在 require 阶段抛错——那不是本护栏要管的事)
  const ctx2d = () => ({
    canvas: {}, fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '', textAlign: '', textBaseline: '',
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, fill() {}, stroke() {},
    fillRect() {}, clearRect() {}, strokeRect() {}, fillText() {}, strokeText() {}, translate() {}, rotate() {}, scale() {},
    setTransform() {}, resetTransform() {}, drawImage() {}, putImageData() {}, clip() {}, setLineDash() {},
    measureText: () => ({ width: 0 }),
    getImageData: () => ({ data: [], width: 0, height: 0 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
  });
  const el = () => ({
    dataset: {}, style: {}, textContent: '', attributes: {}, className: '',
    clientWidth: 800, clientHeight: 600, offsetWidth: 800, offsetHeight: 600,
    setAttribute() {}, removeAttribute() {}, remove() {}, appendChild() {}, insertBefore() {},
    addEventListener() {}, removeEventListener() {},
    getContext: () => ctx2d(), toDataURL: () => 'data: ',
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  });
  return {
    head: { appendChild: () => {} },
    documentElement: { style: {}, setAttribute() {}, removeAttribute() {} },
    body: el(),
    createElement: () => el(),
    createElementNS: () => el(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
  };
}

interface Loaded {
  exports: { apply: (ctx: unknown) => void; inject?: readonly string[] };
  seen: string[];
}

function loadBundle(): Loaded {
  const captured: Array<{ id: string; factory: (req: (s: string) => unknown) => unknown }> = [];
  const document = documentStub();
  // location/navigator 同理:g6 装载期读 window.location.href / navigator.userAgent
  const location = { href: 'http://localhost/', search: '', hash: '', hostname: 'localhost', protocol: 'http:' };
  const navigator = { userAgent: 'node-test', maxTouchPoints: 0, language: 'zh-CN' };
  const sandbox: Record<string, unknown> = {
    // window.document 必须同时给:@antv/g6 装载期读的是 window.document,
    // 只有顶层 document 会在 require 阶段就 TypeError(与本文件护栏无关)
    window: { document, location, navigator, __ModuleLoader__: { load: (reg: unknown) => captured.push(reg as never) } },
    document,
    location,
    navigator,
    MutationObserver: class { observe() {} disconnect() {} },
    queueMicrotask: (fn: () => void) => fn(),
    setTimeout, clearTimeout, console,
    fetch: () => Promise.reject(new Error('network is not available in this test')),
  };
  sandbox.globalThis = sandbox;
  runInNewContext(readFileSync(BUNDLE, 'utf8'), sandbox, { filename: 'dist/client.js' });

  expect(captured).toHaveLength(1);
  const reg = captured[0];
  expect(reg.id).toBe(PLUGIN_ID);

  const seen: string[] = [];
  const exports = reg.factory((spec: string) => {
    seen.push(spec);
    if (!DECLARED.has(spec)) throw new Error(`undeclared require "${spec}"`);
    return stubModule();
  }) as Loaded['exports'];
  return { exports, seen };
}

/** 记录注册动作的假宿主；`inject` 只在座位**被声明**时触发（真实语义）。 */
function clientCtx(declaredSlots: readonly string[]) {
  const ledger: Array<Record<string, unknown>> = [];
  const disposer = () => {};
  const declared = new Set(declaredSlots);
  const slots = {
    inject: (name: string, factory: () => unknown) => {
      if (declared.has(name)) factory();
      return disposer;
    },
    register: (options: Record<string, unknown>) => {
      ledger.push(options);
      return disposer;
    },
  };
  return { ctx: { slots, get: () => undefined }, ledger };
}

function applyOn(declaredSlots: readonly string[]) {
  const { exports } = loadBundle();
  const { ctx, ledger } = clientCtx(declaredSlots);
  exports.apply(ctx);
  return ledger;
}

const settingsSeats = (ledger: Array<Record<string, unknown>>) =>
  ledger.filter((o) => String(o.name).startsWith('settings.')).map((o) => String(o.name));

describe('客户端 bundle 的装载契约', () => {
  it('按 handoff 协议注册，且 id 与包名一致', () => {
    expect(typeof loadBundle().exports.apply).toBe('function');
  });

  it('只 require 已声明的模块(不越界引用未报备的宿主包)', () => {
    const { seen } = loadBundle();
    const undeclared = [...new Set(seen)].filter((s) => !DECLARED.has(s));
    expect(undeclared, `bundle required modules missing from dsh.client.inject: ${undeclared.join(', ')}`).toEqual([]);
  });

  it('不引用已退役的发布版专属包(dsh-client-runtime / dsh-client-store)', () => {
    const { seen } = loadBundle();
    const retired = [...new Set(seen)].filter((s) => RETIRED.test(s));
    expect(retired).toEqual([]);
  });

  it('inject 只声明 slots —— 声明可选服务会让 apply 永久挂起(UI 全静默消失)', () => {
    expect(loadBundle().exports.inject).toEqual(['slots']);
  });
});

describe('设置座位：只挂顶层「记忆」分节', () => {
  it('**0.1.2 线最多只注册一个设置座位** —— 这条就是当年"三份面板"的回归护栏', () => {
    const seats = settingsSeats(applyOn(HOST_012));
    expect(
      seats,
      `0.1.2 宿主同时声明 ${TOP_SECTION} / ${SIBLING_TAB} / ${CARD_SEAT}，` +
        '注册多个就会在设置里出现多份同名面板',
    ).toHaveLength(1);
    expect(seats).toEqual([TOP_SECTION]);
  });

  it('注册的分节带 id 与 label（顶层导航据此渲染入口）', () => {
    const ledger = applyOn(HOST_012);
    const seat = ledger.find((o) => o.name === TOP_SECTION);
    expect(seat).toBeDefined();
    expect(seat!.id).toBe('dsh-memory');
    expect(seat!.label).toBe('记忆');
    expect(typeof seat!.inject).toBe('function');
    expect((seat!.inject as () => { rpc: unknown })().rpc).toBeTypeOf('function');
  });

  it('**不注册**「插件配置」下的两个座位（那个位置留给轻量单卡片）', () => {
    // 只声明那两个座位的宿主 ⇒ 一个设置座位都不该注册。
    expect(settingsSeats(applyOn([CARD_SEAT, SIBLING_TAB, INPUT_SEAT]))).toEqual([]);
  });

  it('输入栏 pill 照常注册（它不是设置座位，不受座位改名影响）', () => {
    expect(applyOn(HOST_012).map((o) => o.name)).toContain(INPUT_SEAT);
  });
});

describe('设置座位：没挂上时必须响亮', () => {
  it('座位被声明时即刻挂上，不等判定期', () => {
    expect(settingsSeats(applyOn(HOST_012))).toEqual([TOP_SECTION]);
  });

  it('座位始终没被声明 → 不注册任何座位，但**必须在 Console 说出来**（静默消失是这类 bug 的温床）', async () => {
    const { exports } = loadBundle();
    const ledger: Array<Record<string, unknown>> = [];
    const declared = new Set([CARD_SEAT, SIBLING_TAB, INPUT_SEAT]);
    const disposer = () => {};
    const warn = console.warn;
    const warns: string[] = [];
    console.warn = (...args: unknown[]) => warns.push(args.map(String).join(' '));
    try {
      exports.apply({
        slots: {
          inject: (name: string, factory: () => unknown) => {
            if (declared.has(name)) factory();
            return disposer;
          },
          register: (options: Record<string, unknown>) => {
            ledger.push(options);
            return disposer;
          },
        },
        get: () => undefined,
      });
      expect(settingsSeats(ledger), '不回退、不猜 —— 只留一个座位').toEqual([]);
      await new Promise((r) => setTimeout(r, PROBE_MS + 250));
      expect(settingsSeats(ledger), '判定期后也不该擅自挂别的座位').toEqual([]);
      expect(warns.some((w) => w.includes('不会出现')), '没挂上必须响亮，不能静默').toBe(true);
    } finally {
      console.warn = warn;
    }
  }, 10_000);
});
