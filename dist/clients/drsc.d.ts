/**
 * DrscClient(T8.4 读切,drsc-redact-memory-wiring task_18):memory 读历史
 * 面的 dsh-reference-session-collector HTTP 客户端。
 *
 * 两个读点(R7):
 * - 蒸馏背景窗(recentBySession 等价供给)→ `op=session&tail=N&redact=1`
 *   (collector task_11 尾窗升序 + task_12 redact 臂);
 * - 工具面 conversation_search → `op=search&redact=1`(命中基于原文 fts,
 *   返回 snippet 取脱敏锚定文本)。
 *
 * 硬依赖纪律(对齐 T7.3 裁定):collector 缺席/超时/非 2xx/ok=false 一律抛
 * {@link DrscClientError}——**绝不回退本地 l0**(表已退役,无退路);调用方
 * 分口径处理:蒸馏背景窗空窗降级(runner),工具面显式报错(tools)。
 *
 * 同源 Host 解析(steward drs-source 的 resolveDrsBaseUrl 同款):
 * 显式 baseUrl > 首个 trustedHosts 条目(补 http://)> `http://127.0.0.1:8080`
 * (宿主缺省口)。Host 头回显首个 trustedHosts 条目:collector 信任门是精确
 * 匹配,条目省略端口而 URL 带端口会失配。trustedHosts 惰性读取(webStartup
 * 可能晚于本插件就绪),每次请求现算,无缓存陈旧面。
 */
import type { ConversationMessage } from '../types.js';
/** collector API 路径(与其 DRS_API_PATH 字面一致;不跨包 import)。 */
export declare const DRSC_API_PATH = "/api/dsh-reference-session-collector";
/** 客户端缺省超时:loopback 正常 <10ms,5s 是给冷启动 GC/断点的天花板。 */
export declare const DRSC_DEFAULT_TIMEOUT_MS = 5000;
/** collector 缺席/超时/契约破损。显式报错,不回退本地。 */
export declare class DrscClientError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
/**
 * 基址解析:显式配置 > 首个 trustedHosts 条目(补 http:// 前缀)>
 * `http://127.0.0.1:8080`(宿主默认口;trustedHosts 缺席的老线 collector 门本就放行)。
 */
export declare function resolveDrscBaseUrl(explicit: string | undefined, trustedHosts?: readonly string[]): string;
/** `op=session` 的一个 segment 行(redact=1 时 text 为脱敏正文;wire 蛇形直取)。 */
export interface DrscSessionRow {
    seq: number;
    turn: number;
    step: number;
    kind: string;
    role: string;
    time: number;
    text: string;
}
/** `op=search` 的一个命中(redact=1 时 snippet 为脱敏锚定文本)。 */
export interface DrscSearchHit {
    session_id: string;
    seq: number;
    kind: string;
    rank: number;
    snippet: string;
    time: number;
    on_surface: number;
    turn: number;
}
/** kind → L0 角色词表(memory 只收 user/assistant 两类,其余(tool/* 等)不映射)。 */
export declare function drscRoleOf(kind: string): 'user' | 'assistant' | undefined;
/**
 * session 行 → ConversationMessage 形状映射(蒸馏背景窗用)。
 * - id:确定性合成 `drsc:<session>:<seq>`(跨次调用稳定,anchor 追溯可解释);
 * - anchor:turn>0 才成立(与 ConversationAnchor 红线一致:没坐标不伪造);
 * - 非 user/assistant 段(tool/call 等)返回 undefined,调用方跳过。
 */
export declare function drscRowToConversationMessage(row: DrscSessionRow, sessionId: string): ConversationMessage | undefined;
export interface DrscClientOptions {
    /** 显式基址(缺省走 trustedHosts → 127.0.0.1:8080,见 resolveDrscBaseUrl)。 */
    baseUrl?: string;
    /** trustedHosts 惰性读取(webStartup 服务可能晚于装配;每次请求现取)。 */
    trustedHosts?: () => readonly string[] | undefined;
    /** 注入面(单测);缺省全局 fetch。 */
    fetchImpl?: typeof fetch;
    /** 单请求超时 ms;缺省 {@link DRSC_DEFAULT_TIMEOUT_MS}。 */
    timeoutMs?: number;
}
export declare class DrscClient {
    private readonly options;
    private readonly fetchImpl;
    private readonly timeoutMs;
    constructor(options?: DrscClientOptions);
    /** 每次请求现算基址与 Host 回显(trustedHosts 惰性;无缓存陈旧面)。 */
    private base;
    /** 一个 GET 的 JSON 包络(非 2xx / ok!==true / 超时 / 断网一律抛 DrscClientError)。 */
    private getJson;
    /**
     * 会话尾窗:`op=session&session=<id>&tail=N&redact=1` → 脱敏消息行(升序)。
     * collector 无此会话(session:null)返回空数组(新会话首轮的常态,非错误)。
     */
    sessionTail(sessionId: string, tail: number): Promise<DrscSessionRow[]>;
    /** 原史检索:`op=search&q=<query>&limit=N&redact=1` → 脱敏 snippet 命中。 */
    search(query: string, limit: number): Promise<DrscSearchHit[]>;
}
