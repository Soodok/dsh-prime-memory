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
import type { MemoryConfig } from './config.js';
import type { MemoryLogger } from './types.js';
import type { DistillChainEntry, MemoryLiveSettings } from './contract.js';
export type { DistillBudgets, DistillChainEntry, EffortChoice, MemoryLiveSettings } from './contract.js';
/** 运行时路由链上限(写入门与 UI 同限,防误粘贴巨数组撑爆 settings 存储)。 */
export declare const DISTILL_CHAIN_MAX = 8;
/**
 * 运行时统一路由链的展示投影(llm-providers 的 chain.current 数据源):
 * distillChain 非空即原样返回;为空时投影旧运行时键(distillProvider/distillModel
 * 成对 → 单行主路由,旧档位 reasoningEffort 作为该主路由的档位)。注意:生效逻辑
 * (effectiveCfg)只认显式 distillChain、不走本投影——旧键路径在未配链时按旧语义
 * 原样生效。
 */
export declare function projectDistillChain(s: Partial<MemoryLiveSettings> | undefined): DistillChainEntry[];
/**
 * settings-set 写入门校验:返回错误文案(null = 通过)。
 * opts.requireExplicitHead(层链用):头行必须 provider+model 双显式——层键出现
 * 即意图覆盖;"双空 = 跟随默认模型"是全局链独有语义,层链禁掉双空头,消除
 * "层链头跟随哪套全局解析"的歧义。
 */
export declare function validateDistillChain(chain: unknown, opts?: {
    requireExplicitHead?: boolean;
}): string | null;
export interface LiveSettingsHandle {
    /** 读取面是否可用(0.1.7 起 volatile 引用恒在,恒为 true;写面缺失时 update 抛错) */
    supported: boolean;
    get(): MemoryLiveSettings;
    /** UI 写入入口;写面缺失或宿主拒绝时抛错,由 RPC 层转成业务错误 */
    update(patch: Partial<MemoryLiveSettings>): Promise<void>;
}
/** 本插件 loader entry id(cordis.patch.yml 固定)= 0.1.7 设置表单的命名空间。 */
export declare const MEMORY_ENTRY_ID = "dsh-memory";
/** 自带自定义设置页(settings.section 顶层「记忆」分节,client 半挂载):
 *  关掉宿主按 volatile 字段自动生成的表单页,避免同一个插件出现两份设置入口。
 *  settings 服务缺失/未挂 configure 时静默跳过(自动表单页照常生成,无害)。 */
export declare function suppressAutoSettingsForm(ctx: Context): void;
/**
 * 读 live 节的当前值。两种形状都得接：
 * - 新 schemastery：`liveSettingsSchema()` 成功标了 `.volatile()`，宿主给 `Volatile<T>`（有 `.get()`）。
 * - 老 schemastery（0.1.5-rc.3 解析到的 4.0.2，无 `.volatile()`）：config.ts 的探测不标，
 *   宿主直接给配置对象本体——没有 `.get()`，当成冻结快照读即可。
 * 不兼容这一形就是在老线报 `ref.get is not a function`（把加载期崩换成运行期崩）。
 */
export declare function readLiveRef(ref: unknown): MemoryLiveSettings;
export declare function registerLiveSettings(ctx: Context, config: MemoryConfig, logger: MemoryLogger): LiveSettingsHandle;
