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
export const DRSC_API_PATH = '/api/dsh-reference-session-collector';

/** 客户端缺省超时:loopback 正常 <10ms,5s 是给冷启动 GC/断点的天花板。 */
export const DRSC_DEFAULT_TIMEOUT_MS = 5_000;

/** collector 缺席/超时/契约破损。显式报错,不回退本地。 */
export class DrscClientError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DrscClientError';
  }
}

/**
 * 基址解析:显式配置 > 首个 trustedHosts 条目(补 http:// 前缀)>
 * `http://127.0.0.1:8080`(宿主默认口;trustedHosts 缺席的老线 collector 门本就放行)。
 */
export function resolveDrscBaseUrl(explicit: string | undefined, trustedHosts?: readonly string[]): string {
  const trimmed = explicit?.trim() ?? '';
  const pick = trimmed !== '' ? trimmed : trustedHosts?.find((entry) => entry.trim() !== '')?.trim();
  if (pick === undefined || pick === '') return 'http://127.0.0.1:8080';
  return /^https?:\/\//u.test(pick) ? pick : `http://${pick}`;
}

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
export function drscRoleOf(kind: string): 'user' | 'assistant' | undefined {
  if (kind === 'user/message') return 'user';
  if (kind === 'assistant/message') return 'assistant';
  return undefined;
}

/**
 * session 行 → ConversationMessage 形状映射(蒸馏背景窗用)。
 * - id:确定性合成 `drsc:<session>:<seq>`(跨次调用稳定,anchor 追溯可解释);
 * - anchor:turn>0 才成立(与 ConversationAnchor 红线一致:没坐标不伪造);
 * - 非 user/assistant 段(tool/call 等)返回 undefined,调用方跳过。
 */
export function drscRowToConversationMessage(
  row: DrscSessionRow,
  sessionId: string,
): ConversationMessage | undefined {
  const role = drscRoleOf(row.kind);
  if (role === undefined) return undefined;
  const msg: ConversationMessage = {
    id: `drsc:${sessionId}:${row.seq}`,
    role,
    content: row.text,
    timestamp: row.time,
  };
  if (Number.isFinite(row.turn) && row.turn > 0) {
    msg.anchor = { sessionId, turn: row.turn };
    if (Number.isFinite(row.step) && row.step > 0) msg.anchor.step = row.step;
  }
  return msg;
}

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

/** 包络收窄:响应必须是 {ok:true, ...} 形状。 */
interface DrscEnvelope {
  ok: boolean;
  error?: unknown;
}

export class DrscClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: DrscClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DRSC_DEFAULT_TIMEOUT_MS;
  }

  /** 每次请求现算基址与 Host 回显(trustedHosts 惰性;无缓存陈旧面)。 */
  private base(): { url: string; hostHeader?: string } {
    const trusted = this.options.trustedHosts?.() ?? [];
    const base = resolveDrscBaseUrl(this.options.baseUrl, trusted).replace(/\/+$/u, '');
    const first = trusted.find((entry) => entry.trim() !== '')?.trim();
    return { url: `${base}${DRSC_API_PATH}`, ...(first !== undefined ? { hostHeader: first } : {}) };
  }

  /** 一个 GET 的 JSON 包络(非 2xx / ok!==true / 超时 / 断网一律抛 DrscClientError)。 */
  private async getJson(query: string): Promise<Record<string, unknown>> {
    const { url, hostHeader } = this.base();
    let response: Response;
    try {
      response = await this.fetchImpl(`${url}${query}`, {
        headers: {
          accept: 'application/json',
          ...(hostHeader === undefined ? {} : { host: hostHeader }),
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new DrscClientError(`collector 不可达(${query}): ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }
    if (!response.ok) throw new DrscClientError(`collector HTTP ${response.status}(${query})`);
    let body: unknown;
    try {
      body = await response.json();
    } catch (err) {
      throw new DrscClientError(`collector 响应非 JSON(${query})`, { cause: err });
    }
    if (typeof body !== 'object' || body === null || (body as DrscEnvelope).ok !== true) {
      const reason =
        typeof body === 'object' && body !== null
          ? String((body as DrscEnvelope).error ?? 'ok=false')
          : '响应非对象';
      throw new DrscClientError(`collector 包络异常(${query}): ${reason}`);
    }
    return body as Record<string, unknown>;
  }

  /**
   * 会话尾窗:`op=session&session=<id>&tail=N&redact=1` → 脱敏消息行(升序)。
   * collector 无此会话(session:null)返回空数组(新会话首轮的常态,非错误)。
   */
  async sessionTail(sessionId: string, tail: number): Promise<DrscSessionRow[]> {
    const body = await this.getJson(
      `?op=session&session=${encodeURIComponent(sessionId)}&tail=${Math.max(0, Math.floor(tail))}&redact=1`,
    );
    if (body['session'] === null || body['session'] === undefined) return [];
    const rows = Array.isArray(body['rows']) ? (body['rows'] as Record<string, unknown>[]) : [];
    return rows.map((r) => ({
      seq: Number(r['seq'] ?? 0),
      turn: Number(r['turn'] ?? 0),
      step: Number(r['step'] ?? 0),
      kind: String(r['kind'] ?? ''),
      role: String(r['role'] ?? ''),
      time: Number(r['time'] ?? 0),
      text: String(r['text'] ?? ''),
    }));
  }

  /** 原史检索:`op=search&q=<query>&limit=N&redact=1` → 脱敏 snippet 命中。 */
  async search(query: string, limit: number): Promise<DrscSearchHit[]> {
    const body = await this.getJson(
      `?op=search&q=${encodeURIComponent(query)}&limit=${Math.max(1, Math.floor(limit))}&redact=1`,
    );
    const hits = Array.isArray(body['hits']) ? (body['hits'] as Record<string, unknown>[]) : [];
    return hits.map((h) => ({
      session_id: String(h['session_id'] ?? ''),
      seq: Number(h['seq'] ?? 0),
      kind: String(h['kind'] ?? ''),
      rank: Number(h['rank'] ?? 0),
      snippet: String(h['snippet'] ?? ''),
      time: Number(h['time'] ?? 0),
      on_surface: Number(h['on_surface'] ?? 1),
      turn: Number(h['turn'] ?? 0),
    }));
  }
}
