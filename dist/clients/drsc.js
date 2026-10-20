/** collector API 路径(与其 DRS_API_PATH 字面一致;不跨包 import)。 */
export const DRSC_API_PATH = '/api/dsh-reference-session-collector';
/** 客户端缺省超时:loopback 正常 <10ms,5s 是给冷启动 GC/断点的天花板。 */
export const DRSC_DEFAULT_TIMEOUT_MS = 5_000;
/** collector 缺席/超时/契约破损。显式报错,不回退本地。 */
export class DrscClientError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'DrscClientError';
    }
}
/**
 * 基址解析:显式配置 > 首个 trustedHosts 条目(补 http:// 前缀)>
 * `http://127.0.0.1:8080`(宿主默认口;trustedHosts 缺席的老线 collector 门本就放行)。
 */
export function resolveDrscBaseUrl(explicit, trustedHosts) {
    const trimmed = explicit?.trim() ?? '';
    const pick = trimmed !== '' ? trimmed : trustedHosts?.find((entry) => entry.trim() !== '')?.trim();
    if (pick === undefined || pick === '')
        return 'http://127.0.0.1:8080';
    return /^https?:\/\//u.test(pick) ? pick : `http://${pick}`;
}
/** kind → L0 角色词表(memory 只收 user/assistant 两类,其余(tool/* 等)不映射)。 */
export function drscRoleOf(kind) {
    if (kind === 'user/message')
        return 'user';
    if (kind === 'assistant/message')
        return 'assistant';
    return undefined;
}
/**
 * session 行 → ConversationMessage 形状映射(蒸馏背景窗用)。
 * - id:确定性合成 `drsc:<session>:<seq>`(跨次调用稳定,anchor 追溯可解释);
 * - anchor:turn>0 才成立(与 ConversationAnchor 红线一致:没坐标不伪造);
 * - 非 user/assistant 段(tool/call 等)返回 undefined,调用方跳过。
 */
export function drscRowToConversationMessage(row, sessionId) {
    const role = drscRoleOf(row.kind);
    if (role === undefined)
        return undefined;
    const msg = {
        id: `drsc:${sessionId}:${row.seq}`,
        role,
        content: row.text,
        timestamp: row.time,
    };
    if (Number.isFinite(row.turn) && row.turn > 0) {
        msg.anchor = { sessionId, turn: row.turn };
        if (Number.isFinite(row.step) && row.step > 0)
            msg.anchor.step = row.step;
    }
    return msg;
}
export class DrscClient {
    options;
    fetchImpl;
    timeoutMs;
    constructor(options = {}) {
        this.options = options;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.timeoutMs = options.timeoutMs ?? DRSC_DEFAULT_TIMEOUT_MS;
    }
    /** 每次请求现算基址与 Host 回显(trustedHosts 惰性;无缓存陈旧面)。 */
    base() {
        const trusted = this.options.trustedHosts?.() ?? [];
        const base = resolveDrscBaseUrl(this.options.baseUrl, trusted).replace(/\/+$/u, '');
        const first = trusted.find((entry) => entry.trim() !== '')?.trim();
        return { url: `${base}${DRSC_API_PATH}`, ...(first !== undefined ? { hostHeader: first } : {}) };
    }
    /** 一个 GET 的 JSON 包络(非 2xx / ok!==true / 超时 / 断网一律抛 DrscClientError)。 */
    async getJson(query) {
        const { url, hostHeader } = this.base();
        let response;
        try {
            response = await this.fetchImpl(`${url}${query}`, {
                headers: {
                    accept: 'application/json',
                    ...(hostHeader === undefined ? {} : { host: hostHeader }),
                },
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        }
        catch (err) {
            throw new DrscClientError(`collector 不可达(${query}): ${err instanceof Error ? err.message : String(err)}`, {
                cause: err,
            });
        }
        if (!response.ok)
            throw new DrscClientError(`collector HTTP ${response.status}(${query})`);
        let body;
        try {
            body = await response.json();
        }
        catch (err) {
            throw new DrscClientError(`collector 响应非 JSON(${query})`, { cause: err });
        }
        if (typeof body !== 'object' || body === null || body.ok !== true) {
            const reason = typeof body === 'object' && body !== null
                ? String(body.error ?? 'ok=false')
                : '响应非对象';
            throw new DrscClientError(`collector 包络异常(${query}): ${reason}`);
        }
        return body;
    }
    /**
     * 会话尾窗:`op=session&session=<id>&tail=N&redact=1` → 脱敏消息行(升序)。
     * collector 无此会话(session:null)返回空数组(新会话首轮的常态,非错误)。
     */
    async sessionTail(sessionId, tail) {
        const body = await this.getJson(`?op=session&session=${encodeURIComponent(sessionId)}&tail=${Math.max(0, Math.floor(tail))}&redact=1`);
        if (body['session'] === null || body['session'] === undefined)
            return [];
        const rows = Array.isArray(body['rows']) ? body['rows'] : [];
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
    async search(query, limit) {
        const body = await this.getJson(`?op=search&q=${encodeURIComponent(query)}&limit=${Math.max(1, Math.floor(limit))}&redact=1`);
        const hits = Array.isArray(body['hits']) ? body['hits'] : [];
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
