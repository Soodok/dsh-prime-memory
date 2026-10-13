/**
 * 记忆模式运行时开关(0.1.7 声明式设置面)。
 * 语义:静态 config(cordis.patch.yml,部署上限)AND 运行时开关,两者同时开才工作。
 *
 * **0.1.7 迁移**(host dsh-v0.1.7-rc.1,compat/0.1.7 线):宿主删除了
 * `settings.register` / `installSection` 两代命令式注册面,开关改由 Config 的
 * **volatile 节**承载(`memorySchema.live`,src/config.ts)——宿主把 volatile
 * 字段自动投影成设置表单,运行时变更提交进引用并广播 `loader/volatile-update`,
 * 不 remount 插件。本模块只剩一个薄句柄:
 * - 读 = `config.live.get()` 冻结快照 + `resolveSettings` 防御性解析(无缓存可失真);
 * - 写 = `ctx.settings.update(ENTRY_ID, { live })` → configEditor 落 profile
 *   patch → loader 做 volatile-only 提交(生命周期保留)。settings-set RPC
 *   (stats.ts)与本插件客户端面板经此读写,patch 合并语义与旧 scope 一致。
 * - 命名空间 = 本插件 loader entry id `dsh-memory`(cordis.patch.yml 固定),
 *   与 0.1.6 以前的 settings namespace 恰好同串——旧 settings.yaml 的
 *   `dsh-memory` section 因此能被宿主导入器按 entry id 对上(§6 迁移)。
 *
 * v0.9.0 契约:含远程嵌入运行时覆盖四键(embedRemote*)与记忆写删门 memoryMutate
 * (自 dist 逆向补全——settings 缺键 = 用户已存值被静默丢弃,红线)。
 */
import type { Context } from '@deepseek-ai/cordis';
// 纯类型导入:拉入 `loader/volatile-update` 事件声明(module augmentation)。
import type {} from '@deepseek-ai/cordis-plugin-loader';
import type { MemoryConfig } from './config.js';
import { EFFORT_CHOICES, liveSettingsSchema } from './config.js';
import type { MemoryLogger } from './types.js';

// EffortChoice/DistillBudgets/DistillChainEntry/MemoryLiveSettings 来自契约单一事实源
import type { DistillBudgets, DistillChainEntry, EffortChoice, LayerRouteKey, MemoryLiveSettings } from './contract.js';
export type { DistillBudgets, DistillChainEntry, EffortChoice, MemoryLiveSettings } from './contract.js';

/** 运行时路由链上限(写入门与 UI 同限,防误粘贴巨数组撑爆 settings 存储)。 */
export const DISTILL_CHAIN_MAX = 8;

/**
 * 运行时统一路由链的展示投影(llm-providers 的 chain.current 数据源):
 * distillChain 非空即原样返回;为空时投影旧运行时键(distillProvider/distillModel
 * 成对 → 单行主路由,旧档位 reasoningEffort 作为该主路由的档位)。注意:生效逻辑
 * (effectiveCfg)只认显式 distillChain、不走本投影——旧键路径在未配链时按旧语义
 * 原样生效。
 */
export function projectDistillChain(
  s: Partial<MemoryLiveSettings> | undefined,
): DistillChainEntry[] {
  if (s?.distillChain?.length) return s.distillChain;
  if (s?.distillProvider && s?.distillModel) {
    return [{ provider: s.distillProvider, model: s.distillModel, reasoningEffort: s.reasoningEffort || '' }];
  }
  return [];
}

/**
 * settings-set 写入门校验:返回错误文案(null = 通过)。
 * opts.requireExplicitHead(层链用):头行必须 provider+model 双显式——层键出现
 * 即意图覆盖;"双空 = 跟随默认模型"是全局链独有语义,层链禁掉双空头,消除
 * "层链头跟随哪套全局解析"的歧义。
 */
export function validateDistillChain(
  chain: unknown,
  opts?: { requireExplicitHead?: boolean },
): string | null {
  if (!Array.isArray(chain)) return 'distillChain 须为数组';
  if (chain.length > DISTILL_CHAIN_MAX) return `路由链最多 ${DISTILL_CHAIN_MAX} 条`;
  const seen = new Set<string>();
  for (let i = 0; i < chain.length; i++) {
    if (!chain[i] || typeof chain[i] !== 'object') return `第 ${i + 1} 行须为对象`;
    const e = chain[i] as Partial<DistillChainEntry>;
    const p = typeof e.provider === 'string' ? e.provider : '';
    const m = typeof e.model === 'string' ? e.model : '';
    const eff = typeof e.reasoningEffort === 'string' ? e.reasoningEffort : '';
    if (p.length > 200 || m.length > 200) return `第 ${i + 1} 行 provider/model 过长(≤200 字符)`;
    if (!(EFFORT_CHOICES as readonly string[]).includes(eff)) return `第 ${i + 1} 行思考档位非法: ${eff || '(空)'}`;
    if (i === 0) {
      if (opts?.requireExplicitHead && (!p || !m)) return '主路由行必须显式选择供应商与模型(层链不支持跟随默认模型)';
      if ((p && !m) || (!p && m)) return '主路由行 provider 与 model 须成对(双空 = 跟随默认模型)';
    } else if (!p || !m) {
      return `第 ${i + 1} 行回退路由必须显式选择供应商与模型`;
    }
    if (p && m) {
      const key = `${p}::${m}`;
      if (seen.has(key)) return `第 ${i + 1} 行与前面的路由重复(${p}/${m})`;
      seen.add(key);
    }
  }
  return null;
}

export interface LiveSettingsHandle {
  /** 读取面是否可用(0.1.7 起 volatile 引用恒在,恒为 true;写面缺失时 update 抛错) */
  supported: boolean;
  get(): MemoryLiveSettings;
  /** UI 写入入口;写面缺失或宿主拒绝时抛错,由 RPC 层转成业务错误 */
  update(patch: Partial<MemoryLiveSettings>): Promise<void>;
}

/** 本插件 loader entry id(cordis.patch.yml 固定)= 0.1.7 设置表单的命名空间。 */
export const MEMORY_ENTRY_ID = 'dsh-memory';

/** settings 服务的结构化最小面(不依赖包级类型导出,跨 DSH 版本稳定)。 */
interface SettingsFormsLike {
  /** 合并可编辑字段进 entry 的 profile patch(0.1.7 SettingsForms.update)。 */
  update(ns: string, patch: object, expectedRevision?: number): Promise<void>;
  /** 登记本实例的页面策略;自带自定义页的插件用它关掉自动生成的表单页。 */
  configure?(presentation: { auto?: boolean }, owner?: unknown): () => void;
}

const ALWAYS_ON: MemoryLiveSettings = {
  enabled: true,
  capture: true,
  distill: true,
  recall: true,
  reasoningEffort: '',
  distillProvider: '',
  distillModel: '',
  distillChain: [],
  distillBudgets: { extract: 0, dedup: 0, l2: 0, l3: 0, graph: 0 },
  distillMaxInputChars: 0,
  distillLayerChains: { l1: [], l2: [], l3: [] },
  distillMode: '',
  directBaseURL: '',
  directApiKey: '',
  embedRemoteBaseURL: '',
  embedRemoteApiKey: '',
  embedRemoteModel: '',
  embedRemoteDimensions: 0,
  memoryMutate: false,
  conflictFreeze: false,
  skillsEnabled: false,
  toolRoom: true,
  toolGraph: true,
  toolRuminate: true,
  toolConflict: true,
  toolMutate: true,
};

/** 自带自定义设置页(settings.section 顶层「记忆」分节,client 半挂载):
 *  关掉宿主按 volatile 字段自动生成的表单页,避免同一个插件出现两份设置入口。
 *  settings 服务缺失/未挂 configure 时静默跳过(自动表单页照常生成,无害)。 */
export function suppressAutoSettingsForm(ctx: Context): void {
  ctx.inject(['settings'], (sctx) => {
    sctx.effect(() => {
      const svc = sctx.get('settings') as SettingsFormsLike | undefined;
      return svc?.configure?.({ auto: false }, ctx.fiber) ?? (() => {});
    });
  });
}

/**
 * 读 live 节的当前值。两种形状都得接：
 * - 新 schemastery：`liveSettingsSchema()` 成功标了 `.volatile()`，宿主给 `Volatile<T>`（有 `.get()`）。
 * - 老 schemastery（0.1.5-rc.3 解析到的 4.0.2，无 `.volatile()`）：config.ts 的探测不标，
 *   宿主直接给配置对象本体——没有 `.get()`，当成冻结快照读即可。
 * 不兼容这一形就是在老线报 `ref.get is not a function`（把加载期崩换成运行期崩）。
 */
export function readLiveRef(ref: unknown): MemoryLiveSettings {
  const maybe = ref as { get?: () => MemoryLiveSettings } | null | undefined;
  return typeof maybe?.get === 'function' ? maybe.get() : (maybe as MemoryLiveSettings);
}

export function registerLiveSettings(ctx: Context, config: MemoryConfig, logger: MemoryLogger): LiveSettingsHandle {
  // 读面:volatile 引用恒在(由 Config schema 默认值兜底),读数现取现解析,
  // 无进程内缓存——旧「服务就绪探测 / scope 复用 / 实例判活」整套机制随
  // 命令式注册面一起删除(0.1.7 无注册,自然无 already-registered 竞态)。
  const ref = config.live;
  const read = (): MemoryLiveSettings => resolveSettings(readLiveRef(ref));

  // 变更诊断(替代旧 scope.watch):宿主把 volatile-only 变更提交进引用后,
  // 向持有 fiber 广播一次 loader/volatile-update(路径为键数组,只关心 live 节)。
  ctx.on('loader/volatile-update', (paths) => {
    if (!paths.some((p) => p[0] === 'live')) return;
    const current = read();
    const b = current.distillBudgets;
    const budgetNote = (b.extract || b.dedup || b.l2 || b.l3 || b.graph)
      ? `,输出预算=抽取 ${b.extract || '默认'}/去重 ${b.dedup || '默认'}/L2 ${b.l2 || '默认'}/L3 ${b.l3 || '默认'}/图谱 ${b.graph || '默认'}`
      : '';
    const inputNote = current.distillMaxInputChars > 0 ? `,输入预算=${current.distillMaxInputChars}` : '';
    logger.info(
      `[memory] 记忆模式开关更新:总=${current.enabled} 捕获=${current.capture} 蒸馏=${current.distill} 召回=${current.recall}` +
        `,蒸馏思考=${current.reasoningEffort || '跟随配置'}` +
        (current.distillProvider && current.distillModel
          ? `,蒸馏模型=${current.distillProvider}/${current.distillModel}`
          : '') + budgetNote + inputNote,
    );
  });

  // ── 读写面三代腰(纯特性检测,playbook §5:勿按版本号分支)──────────────
  // 代 1(0.1.7+):settings 服务有 SettingsForms.update(ns,patch) —— 读走 Config
  //   live volatile 引用(read()),写走 forms.update(整节提交)。
  // 代 2(0.1.2/0.1.5):settings.register 返回 SettingsScope(get/watch/update)
  //   —— 读写全走 scope(写活读死:0.1.2/0.1.5 的 scope.get() 快照可能恒默认,
  //   磁盘才是真值,调用方以持久化成功为准)。
  // 代 2'(register 缺失):installSection 只回 hooks —— 读走 setSource 注入的
  //   thunk,写显式拒绝。
  // 代 3(0.1.0/0.1.1):settings 服务整体缺席 → 恒开降级,internal/service 上线
  //   重试。参考件:compat/0.1.5 registerLiveSettings 的 tryAttach 全套。
  let forms: SettingsFormsLike | undefined;
  ctx.inject(['settings'], (sctx) => {
    forms = sctx.get('settings') as SettingsFormsLike | undefined;
  });

  interface SettingsScopeLike {
    get(): unknown;
    watch(callback: (next: MemoryLiveSettings) => void): () => void;
    update(patch: Partial<MemoryLiveSettings>): Promise<void>;
  }
  let inner: LiveSettingsHandle = {
    supported: false,
    get: () => ({ ...ALWAYS_ON, distillChain: [] }),
    update: () => Promise.reject(new Error('settings 服务不可用,记忆开关无法写入')),
  };

  const wireScope = (scope: SettingsScopeLike): LiveSettingsHandle => {
    return {
      supported: true,
      get: () => resolveSettings(scope.get()),
      update: async (patch) => {
        await scope.update(patch);
      },
    };
  };

  const tryAttachOld = (): boolean => {
    const settings = ctx.get('settings') as
      | (SettingsFormsLike & {
          register?: (ns: string, schema: unknown, options?: object) => SettingsScopeLike;
          installSection?: (
            owner: Context,
            ns: string,
            schema: unknown,
            entry: MemoryLiveSettings,
            hooks: { setSource(current: () => MemoryLiveSettings): void; onChange(): void },
          ) => void;
        })
      | undefined;
    if (!settings || typeof (forms as SettingsFormsLike | undefined)?.update === 'function') return true; // 代 1 生效,老臂不必挂
    if (typeof settings.register === 'function') {
      try {
        const scope = settings.register(MEMORY_ENTRY_ID, liveSettingsSchema(), { applies: 'live' });
        inner = wireScope(scope);
        logger.info('[memory] 记忆模式开关就绪(settings.register,命名空间 dsh-memory)');
        return true;
      } catch (err) {
        logger.warn(`[memory] 记忆模式开关注册失败(保持全开): ${err instanceof Error ? err.message : String(err)}`);
        return true;
      }
    }
    if (typeof settings.installSection === 'function') {
      try {
        let source: () => MemoryLiveSettings = () => ({ ...ALWAYS_ON, distillChain: [] });
        let notify: (() => void) | undefined;
        const bridge: SettingsScopeLike = {
          get: () => resolveSettings(source()),
          watch: (callback) => {
            notify = () => void callback(bridge.get() as MemoryLiveSettings);
            return () => {
              notify = undefined;
            };
          },
          update: () => Promise.reject(new Error('installSection 桥接模式不支持运行时写入')),
        };
        settings.installSection(ctx, MEMORY_ENTRY_ID, liveSettingsSchema(), { ...ALWAYS_ON, distillChain: [] }, {
          setSource: (current) => {
            source = current;
          },
          onChange: () => notify?.(),
        });
        inner = wireScope(bridge);
        logger.info('[memory] 记忆模式开关就绪(settings.installSection 桥接,运行时写入不可用)');
        return true;
      } catch (err) {
        logger.warn(`[memory] 记忆模式开关 installSection 桥接失败(保持全开): ${err instanceof Error ? err.message : String(err)}`);
        return true;
      }
    }
    logger.warn('[memory] settings 服务无可用的 register/installSection API,记忆模式开关降级为恒开');
    return true;
  };

  if (!tryAttachOld()) {
    logger.warn('[memory] settings 服务未就绪,记忆模式开关暂不可用(保持全开,等待服务上线)');
  }
  // 服务迁移自愈(代 2/2' 臂):下线 → 降级;换实例/上线 → 立即重试挂接(幂等)。
  ctx.on('internal/service', (name: string) => {
    if (name !== 'settings') return;
    inner = {
      supported: false,
      get: () => ({ ...ALWAYS_ON, distillChain: [] }),
      update: () => Promise.reject(new Error('settings 服务不可用,记忆开关无法写入')),
    };
    tryAttachOld();
  });

  const modernWrite = (): boolean => {
    const f = forms as SettingsFormsLike | undefined;
    return !!(f && typeof f.update === 'function');
  };

  return {
    supported: true,
    get: () => (modernWrite() ? read() : inner.get()),
    update: async (patch) => {
      if (modernWrite()) {
        if (!forms) throw new Error('settings 服务不可用,记忆开关无法写入');
        // patch 合并语义与旧 scope.update 一致:只改传入键。合并在插件侧完成后
        // **整节提交**——宿主的表单 update 按 volatile 节整体写入 profile patch,
        // 部分对象会覆盖掉未提交字段。写失败(update 抛错)对调用方可观测。
        const next: MemoryLiveSettings = { ...read(), ...patch };
        await forms.update(MEMORY_ENTRY_ID, { live: next });
        return;
      }
      await inner.update(patch);
    },
  };
}

/** scope.get() 的防御性解析:异常值回退默认(宁可多记不可静默停摆)。 */
function resolveSettings(value: unknown): MemoryLiveSettings {
  if (!value || typeof value !== 'object') return { ...ALWAYS_ON, distillChain: [] };
  const v = value as Partial<MemoryLiveSettings>;
  const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
  const rawBudgets = (v.distillBudgets ?? {}) as Partial<DistillBudgets>;
  // 路由链逐条防御:非对象条目剔除、超长截断、非法档位归空、超限截断到上限
  const defuseChain = (raw: unknown): DistillChainEntry[] => {
    const out: DistillChainEntry[] = [];
    if (!Array.isArray(raw)) return out;
    for (const item of raw) {
      if (out.length >= DISTILL_CHAIN_MAX) break;
      if (!item || typeof item !== 'object') continue;
      const e = item as Partial<DistillChainEntry>;
      const eff = typeof e.reasoningEffort === 'string' && (EFFORT_CHOICES as readonly string[]).includes(e.reasoningEffort)
        ? e.reasoningEffort
        : '';
      out.push({
        provider: typeof e.provider === 'string' ? e.provider.slice(0, 200) : '',
        model: typeof e.model === 'string' ? e.model.slice(0, 200) : '',
        reasoningEffort: eff,
      });
    }
    return out;
  };
  const rawLayer = (v.distillLayerChains ?? {}) as Partial<Record<LayerRouteKey, unknown>>;
  return {
    enabled: v.enabled !== false,
    capture: v.capture !== false,
    distill: v.distill !== false,
    recall: v.recall !== false,
    reasoningEffort:
      typeof v.reasoningEffort === 'string' && (EFFORT_CHOICES as readonly string[]).includes(v.reasoningEffort)
        ? (v.reasoningEffort as EffortChoice)
        : '',
    distillProvider: typeof v.distillProvider === 'string' ? v.distillProvider : '',
    distillModel: typeof v.distillModel === 'string' ? v.distillModel : '',
    distillChain: defuseChain(v.distillChain),
    distillLayerChains: {
      l1: defuseChain(rawLayer.l1),
      l2: defuseChain(rawLayer.l2),
      l3: defuseChain(rawLayer.l3),
    },
    distillBudgets: {
      extract: num(rawBudgets.extract),
      dedup: num(rawBudgets.dedup),
      l2: num(rawBudgets.l2),
      l3: num(rawBudgets.l3),
      graph: num(rawBudgets.graph),
    },
    distillMaxInputChars: num(v.distillMaxInputChars),
    // 蒸馏通道:mode 白名单(非法归 '' = 跟随部署);端点与密钥截断防御但保留原始内容
    distillMode: v.distillMode === 'host' || v.distillMode === 'direct' ? v.distillMode : '',
    directBaseURL: typeof v.directBaseURL === 'string' ? v.directBaseURL.slice(0, 2000) : '',
    directApiKey: typeof v.directApiKey === 'string' ? v.directApiKey.slice(0, 2000) : '',
    // 远程嵌入覆盖:端点/密钥截 2000,模型名截 200,维度钳 0~8192(与部署 schema 上限一致)
    embedRemoteBaseURL: typeof v.embedRemoteBaseURL === 'string' ? v.embedRemoteBaseURL.slice(0, 2000) : '',
    embedRemoteApiKey: typeof v.embedRemoteApiKey === 'string' ? v.embedRemoteApiKey.slice(0, 2000) : '',
    embedRemoteModel: typeof v.embedRemoteModel === 'string' ? v.embedRemoteModel.slice(0, 200) : '',
    embedRemoteDimensions:
      typeof v.embedRemoteDimensions === 'number' && Number.isFinite(v.embedRemoteDimensions)
        ? Math.min(Math.max(Math.floor(v.embedRemoteDimensions), 0), 8192)
        : 0,
    // 写删门:严格 === true(任何异常值都视为关,模型写删风险宁紧勿松)
    memoryMutate: v.memoryMutate === true,
    // §C 人工冲突裁决:严格 === true(默认关,冻结消耗注意力)
    conflictFreeze: v.conflictFreeze === true,
    // 轨2 技能结晶:严格 === true(默认关,新功能默认关)
    skillsEnabled: v.skillsEnabled === true,
    // 工具分组封印:严格 !== false(缺省/异常值 = 未封印,工具照常注册)
    toolRoom: v.toolRoom !== false,
    toolGraph: v.toolGraph !== false,
    toolRuminate: v.toolRuminate !== false,
    toolConflict: v.toolConflict !== false,
    toolMutate: v.toolMutate !== false,
  };
}
