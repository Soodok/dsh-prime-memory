/**
 * 召回 Hook(消息侧注入版,ADR-0001):
 * 1. agent/pre-step(waterfall,prepend 注册):有新的用户来源消息到达的步骤
 *    (轮首 claim 或 steering 插话)→ 检索 L1 → 以合成消息形式注入到用户消息之前。
 *    注入消息携带插件来源(form: 'recall'),对用户可见、随会话历史持久累积——
 *    这就是"记忆生效"的显式提示(dsh-time-context 同款官方范式)。
 *    纯工具步透传;召回超时(recall.timeoutMs 总预算)跳过本轮,绝不阻塞对话。
 * 2. agent/created:在 agent 作用域注册动态上下文 provider(L3 画像 + L2 场景导航 +
 *    工具指南——系统提示只保留稳定内容;指南三条件门控:工具开启 && 有内容)。
 *
 * 注入内容使用 <relevant-memories> 标签包裹(模型侧语义边界 + 助手回显剥离锚点),
 * 召回预算(单条/整轮)超限截断并引导模型用记忆工具查全文。
 * L0 防污染零成本:capture 侧只收 source.kind === 'user' 的消息,注入消息天然被排除。
 *
 * 注意:PromptContext.text 是同步函数,画像/场景导航这类异步文件读取必须走内存缓存,
 * 由定时刷新 + 管线更新后的主动失效来更新。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { MemoryConfig } from '../config.js';
import type { LiveSettingsHandle } from '../settings.js';
import type { L1Store } from '../store/l1.js';
import type { PersonaStore } from '../store/persona.js';
import type { SessionRecalledStore } from '../store/session-recalled.js';
import type { RecallFeedbackFace } from '../projection/recall.js';
import type { SceneStore } from '../store/scenes.js';
import type { SessionModeStore } from '../store/session-modes.js';
import type { RecallUsageStore } from '../store/recall-usage.js';
import type { MemoryLogger } from '../types.js';
import { type OccupancyLedger } from '../util/context-occupancy.js';
/**
 * 从会话消息构建召回查询(纯函数):末尾 N 条 + 总长截断,空输入返回空串。
 * 全史拼接会让 MATCH 表达式随会话长度线性膨胀(整会话累计二次方成本)。
 */
/**
 * 本插件 recall 注入的署名判据(v4 `plugin:memory` 与 v3 旧行双形状;宿主迁移负责
 * 升格旧行)。导出供双形状单测钉住——估算函数(estimateRecallFromStorage /
 * estimateRecallTokens)对旧形状漏判会让"记忆召回份额"静默归零。
 */
export declare function isOwnRecallSource(src: {
    kind?: unknown;
    plugin?: unknown;
    form?: unknown;
} | undefined | null): boolean;
/** 会话事件里本插件可能关心的那几个字段（只读形状，不依赖宿主类型导出）。 */
export interface InjectionEventLike {
    /** 存储兜底路的事件形状宽松，`type` 也可能缺；缺即不是注入（下面的不等判定已覆盖 undefined）。 */
    type?: string;
    /** 存储兜底路（`sessionPersistence.loadStored`）的事件**不带 seq**，所以它是可选的。 */
    seq?: number;
    data?: {
        id?: unknown;
        source?: Record<string, unknown>;
        content?: ReadonlyArray<{
            type?: string;
            text?: string;
        }>;
    };
}
/** 一条本插件召回注入的事实。 */
export interface OwnInjectionFacts {
    /** 注入消息 id——稳定锚点。**不能用 seq 做键**：压缩的 `surfaceOp:{op:'replace'}` 会重排它。 */
    id: string;
    /**
     * 该消息此刻在日志里的 seq（拿去比 `surface.nodes`）。
     *
     * `undefined` = 这条来源根本没有 seq。**没有 seq 就不能声称“它可见”**——
     * 宁可算“不在可见集里”，也不拿一个臆测的默认值去判（哨兵值会把误标藏起来）。
     */
    seq: number | undefined;
    /** 注入正文字符数（token 估算用）。 */
    chars: number;
}
/**
 * 认出一条 `user/message` 事件是不是本插件的召回注入，并取出它的消息 id / seq / 正文字数。
 *
 * 这是**唯一的识别口径**：召份额估算（live 与存储两条路）与「正文已被摘要取代」对账都读它。
 * 两处各写一套判定迟早漂移，而漂移的后果是静默的（份额归零或误标取代）。
 * 署名判定走 `isOwnRecallSource`，同时吃 v4 `plugin:memory` 与 v3 旧行形状。
 */
export declare function ownInjectionFromEvent(ev: InjectionEventLike): OwnInjectionFacts | undefined;
export declare function buildRecallQuery(messages: Array<{
    content: unknown;
}>, tailMessages?: number, maxChars?: number): string;
/**
 * §E 压缩感知标记器(memorax-absorb / task_24-26):记录刚完成压缩的会话,
 * pre-step 消费后做一次性增强召回。纯内存状态,CaptureBuffers 同款可单测导出。
 *
 * - `onCompactionEnd`:只认无 error 的 compaction/end(失败的压缩没有把内容逐出上下文);
 * - `consume`:消费即清(一次性增强);容量上限淘汰最旧(积压即异常,回退路径兜底)。
 */
export declare class PostCompactionTracker {
    private readonly cap;
    private readonly map;
    constructor(cap?: number);
    /** @returns 是否真的置了标记(false = 非 compaction/end 或带 error)。 */
    onCompactionEnd(sessionId: string, data?: {
        error?: unknown;
    }): boolean;
    /** 消费该会话的增强标记(存在即清,返回是否存在)。 */
    consume(sessionId: string): boolean;
    get size(): number;
}
/** 单会话召回统计(悬浮卡信息区数据源;每轮 O(1) 记账,agent/disposed 清理)。
 *  口径声明:这是"注入统计"而非 bench 的离线 recall@k——运行时没有 ground truth,
 *  命中率 = hitTurns / injectedTurns。去重语义:全量压制轮计入 hitTurns
 *  (相关记忆已在模型上下文里,本质是命中而非未命中),injectedTurns 仍计全部
 *  发生过检索的轮次(保住分母语义与悬浮卡口径连续性)。 */
import type { RecallSessionStats } from '../contract.js';
export type { RecallSessionStats } from '../contract.js';
/** 新建零值统计(首次出现的会话)。 */
export declare function emptyRecallStats(now?: number): RecallSessionStats;
export interface RecallHooks {
    /** 管线更新后调用:画像/场景缓存立即失效并异步刷新。 */
    invalidateProfile(): void;
    /** 会话召回统计只读视图(未发生过检索的会话返回 undefined)。 */
    stats(sessionId: string): RecallSessionStats | undefined;
    /** 记忆占用账本只读出口:内存优先,miss 时从流水复生(重启后历史会话);从未注入返回 null。 */
    occupancy(sessionId: string): OccupancyLedger | null;
    /**
     * 稳定区份额估算(旧会话回填):按当前画像/导航/指南组词折算 token,
     * 纯读不记账——旧会话系统提示里"现在大约坐着多少稳定区"的最佳可得估计。
     */
    estimateProfileTokens(agentId: string): number;
    /** 召回份额回填:live 会话 surface 现扫本插件注入,miss 时读盘上日志兜底;
     *  均不可得返回 null。 */
    estimateRecallTokens(sessionId: string): Promise<number | null>;
}
export declare function registerRecall(ctx: Context, cfg: MemoryConfig, stores: {
    l1: L1Store;
    scenes: Record<'chat' | 'work', SceneStore>;
    persona: Record<'chat' | 'work', PersonaStore>;
    recalled?: SessionRecalledStore;
    feedback?: RecallFeedbackFace;
}, logger: MemoryLogger, live: LiveSettingsHandle, modes: SessionModeStore, dataDir: string, 
/** 召回使用统计(可选;未装配 = 零成本旁路):进 topN(注入)才算 used。 */
usage?: RecallUsageStore): RecallHooks;
