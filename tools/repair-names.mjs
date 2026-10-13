#!/usr/bin/env node
/**
 * pm-name-distill Phase 5（D）：存量改名临时客户端。
 *
 * 定位（用户定）：一次性修补**不进插件**——不加 RPC 端点、不加面板按钮、契约计数不动。
 * 本脚本 import 编译产物 `dist/**.js` 直连库与投射账本，LLM 走局域网 OpenAI 兼容端点
 * （与插件 llm.mode='direct' 同形状：POST bearer key，messages 一问一答，
 * choices[0].message.content 里拿 JSON）。
 *
 * 四条生死纪律（背景见计划 spec D 节）：
 * 1. 改名动的是**文件身份键**：账本键=绝对路径，改名 = 旧路径变孤儿 + 新路径变 firstTime。
 *    所以执行序不可颠倒：**UPDATE name → 写新文件+写新账本（建新基线）→ 才让孤儿扫描
 *    拆旧基线**。写库前必须过 `reconcileLedger` 对账闸，落在 fileOnly/both 的记录跳过。
 * 2. `name` 不在快照哈希的字段表里（`l1-snapshot.ts::canonicalRecords` 逐字段抄录，没有
 *    `name`）——改名既不改检索库哈希也不改快照哈希，**没有任何哈希护栏会替你发现改错**，
 *    全靠 `rename-plan-<ts>.json` 计划文件可回滚（--revert 的凭据）。
 * 3. **默认干跑**：没有 `--apply` 就没有任何写路径；`--apply` 必须指向一份已产出的计划文件，
 *    脚本绝不“现场问 LLM 现场写”。
 * 4. 整批 LLM 失败（HTTP 异常 / 响应解析不出 JSON 数组）→ 记 error **并停**，不拿规则名凑数；
 *    只有**单条**不合格才回落 `deriveName`，并计入 fallback 统计。
 *
 * 密钥纪律：`DSH_LLM_API_KEY` 只从环境变量读，给了就只进 `Authorization` header；
 * 局域网 llama.cpp 不吃鉴权，所以**缺省也能跑**（那时不发该头）。密钥不落日志、不进计划文件。
 * 输出纪律：stdout 最后一行是 JSON 汇总（机器可读），过程日志全走 stderr。
 *
 * 用法见 --help。默认干跑；--apply 才写。对真实库执行由用户操作，本仓 mock 自检只用
 * mkdtemp 临时库（见 tools/repair-names.mocktest.mjs）。
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// ── 运行时 import 编译产物（当前 dist 为 Phase 1 后版本，导出面已逐个核对）──
import { MemoryDb } from '../dist/store/sqlite.js';
import { L1Store } from '../dist/store/l1.js';
import { MdLedgerStore } from '../dist/store/memory-md-ledger.js';
import { reconcileLedger } from '../dist/store/memory-md-export.js';
import { sweepOrphanFiles } from '../dist/store/memory-md-orphan.js';
import { digest, recordDigest, renderRecord, resolveMemoriesRoot, targetFor } from '../dist/store/memory-md.js';
import { NAME_CLIP_MAX, acceptTitle, allocUniqueName, deriveName, reshapeTitle, validateTitle } from '../dist/util/md-name.js';

// 整形函数不再本地养一份：`reshapeTitle` / `acceptTitle` 的真源是 `src/util/md-name.ts`，
// 管线（toStoreRecord）与本脚本写进库的名字必须过同一套形状清洗。两套迟早漂，
// 而这里漂了不报错——只会让“脚本认为合法、管线不认”的名字轮流出现。仍然导出给旧调用方。
export { reshapeTitle };

/** 计划里的默认端点（用户指定，与插件 direct 配置同形状）。 */
export const DEFAULT_ENDPOINT = 'http://192.168.100.25:8203/v1/chat/completions';
/** 批量条数：llama.cpp 的 batch 限制是已知坑，默认保守取 10（spec D）。 */
export const LLM_BATCH = 10;
/** 每条喂给 LLM 的正文上限（字符）。 */
export const EXCERPT_CHARS = 240;
/** 对账闸的读盘预算（只读，宁慢勿漏：漏一条 fileOnly 就是把人改的内容判丢）。 */
const GATE_BUDGET_MS = 300_000;

export const HELP = `用法: node tools/repair-names.mjs [选项]
  pm-name-distill Phase5 存量改名临时客户端。**默认就是干跑**（等价 --plan）：
  只读库、只问 LLM、只产计划文件——不写库、不碰投射文件。

  --plan | --dry-run     干跑。产出 rename-plan-<ts>.md（人审表）+ rename-plan-<ts>.json
                         （执行凭据 = 回滚凭据：id/旧名/新名/旧路径/新路径/时间戳）
  --apply --plan-file <f>  按**已审**计划执行改名（不再问 LLM）。也接受 --apply <f> 写法；
                         没有计划文件一律拒绝，脚本不会现场编一份计划再执行
  --revert <f>           按同一份计划文件反向回滚：旧文件回位 → name 还原 → 拆新侧
  --db <path>            记忆库路径，默认 ~/.dsh/memory/memory.db
  --data-dir <path>      数据目录（账本/计划/归档都在其下），默认 ~/.dsh/memory
  --memories-root <path> 投射单根（即 cfg.memExport.root），默认空 = <data-dir>/memories
                         （--cfg-root 是同义别名，留给旧命令记录）
  --concurrency <n>      LLM 批量并发（1..8），默认 1 = 串行。并发只影响用时：
                         名字分配恒按 id 排序，同一条记录两次跑拿到同一个名
  --max N                本轮最多产出的**动作**条数（数动作不数遍历，与投射侧同口径），默认 100
  --budget-ms N          LLM 批量之间的墙钟预算（ms），默认 60000；超了 capped+remaining 如实回报
  --timeout-ms N         **单批**请求的超时（ms），默认 60000，可给 1..600000。
                         真因：llama.cpp 单 slot 会把并发请求排队，8 路并发下每路都要等
                         完前面所有批（实测第 5/9 批直接撞 30s 旧硬时）。
  --only-bad             只处理坏味形状的名字（判据委托 validateTitle，单一真源不漂移）
  --sweep-orphans        只跑孤儿投射文件归档（面板那枚按钮的命令行版）。**默认也是干跑**，
                         要真搬必须再叠 --apply；它不依赖计划文件，收的是“账本记着但
                         已无记录认领”的所有残片（改名后的旧路径就靠这一步收尾）
  --endpoint <url>       OpenAI 兼容端点，默认 ${DEFAULT_ENDPOINT}
  --model <name>         请求体 model 字段，默认 default
  --help                 本帮助

环境变量:
  DSH_LLM_API_KEY       端点密钥。局域网 llama.cpp 不吃鉴权，**不给也能跑**（那就不发
                        Authorization 头）；给了只进 header，不落日志、不进计划文件。

护栏:
  · 整批 LLM 失败（HTTP 非 2xx / 响应不是可解析 JSON 数组）→ 记 error 并停，退出码 1，
    不降级成规则名乱写；单条不合格才回落规则名并计入 fallback。
  · --apply 前先查账本基线与库内条数是否匹配（认领覆盖率 < 0.5 拒绝执行）。
  · 计划文件里的库路径与 --db 不一致 → 拒绝执行。
  · 脚本永不 rm 旧投射文件：旧路径交给 P4.4 孤儿扫描整体归档（memories-orphans/<批次>）。

输出: stdout 最后一行为 JSON 汇总（机器可读）；过程日志走 stderr。
退出码: 0 成功 / 1 运行错误（含整批 LLM 失败）/ 2 参数错误`;

// ────────────────────────────────────────────────────────────────────────────
// task_5.1 argparse
// ────────────────────────────────────────────────────────────────────────────

/** 需要带值的旗标。`--cfg-root` 是 `--memories-root` 的历史别名，两者同义。 */
const VALUE_FLAGS = new Set(['--plan-file', '--revert', '--db', '--data-dir', '--memories-root', '--cfg-root', '--max', '--budget-ms', '--timeout-ms', '--concurrency', '--endpoint', '--model']);
/** 布尔旗标。 */
const BOOLEAN_FLAGS = new Set(['--plan', '--dry-run', '--apply', '--only-bad', '--sweep-orphans']);

/** `--memories-root` → `memoriesRoot`。 */
function camelize(flagName) {
  return flagName.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * 解析命令行。纯函数（不读 process.argv），便于 mock 自检直接断言。
 * @param {string[]} argv - 不含 node 与脚本路径的参数序列。
 * @returns {{ opts: Record<string, string|boolean>, help: boolean, error: string|undefined }}
 */
export function parseArgs(argv) {
  const opts = {};
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { help = true; continue; }
    if (a === '--plan' || a === '--dry-run') { opts.dryRun = true; continue; }
    if (a === '--only-bad') { opts.onlyBad = true; continue; }
    if (a === '--apply') {
      opts.apply = true;
      // 紧凑写法 `--apply <计划文件>`：下一个 token 不是旗标就当计划文件。
      const nxt = argv[i + 1];
      if (nxt !== undefined && !nxt.startsWith('--')) { opts.planFile = nxt; i++; }
      continue;
    }
    if (VALUE_FLAGS.has(a)) {
      const v = argv[++i];
      if (v === undefined || (v.length > 2 && v.startsWith('--'))) return { opts, help, error: `选项 ${a} 需要一个值` };
      opts[camelize(a.slice(2))] = v;
      continue;
    }
    if (BOOLEAN_FLAGS.has(a)) { opts[camelize(a.slice(2))] = true; continue; }
    return { opts, help, error: `未知参数: ${a}（--help 看用法）` };
  }
  if (opts.revert !== undefined && opts.apply === true) return { opts, help, error: '--apply 与 --revert 互斥' };
  if (opts.apply === true && opts.dryRun === true) return { opts, help, error: '--apply 与 --plan/--dry-run 互斥' };
  for (const [flag, cap] of [['max', 100_000], ['budgetMs', 3_600_000], ['timeoutMs', 600_000], ['concurrency', 8]]) {
    const v = opts[flag];
    if (v === undefined) continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > cap) return { opts, help, error: `选项 --${flag} 需要 1..${cap} 的整数，收到 ${v}` };
  }
  return { opts, help, error: undefined };
}

/** 默认库/数据目录：~/.dsh/memory（真机装机实况路径；脚本不自检宿主是否在跑，由使用者保证）。 */
export function defaultPaths() {
  const dataDir = join(homedir(), '.dsh', 'memory');
  return { dataDir, dbPath: join(dataDir, 'memory.db') };
}

// ────────────────────────────────────────────────────────────────────────────
// 判据函数（--only-bad 用；单独抽出可测——mock 自检直接喂真机坏样本表）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 「坏味形状」判据：这条名字要不要进本轮修补。纯函数、逐条独立可测。
 *
 * **判据单一真源**：闸门就是 `md-name.ts::validateTitle`，闸门拒收的形状自然不该留在
 * `name` 列里，所以先问闸门、再补两条闸门问不出来的指纹。曾在本地另养一套正则判据，
 * 立刻与 src 漂移：src 把 `session-` 收窄成真 id 形状放行了 `dsh-session-steward`，
 * 而本地宽判把它误杀——两套判据必漂移，只留一份。
 *
 * - 空名（最需要修的一档，投射侧回落 `mem-<id8>`）；
 * - `validateTitle` 拒收（句末标点/叙述引子开头/路径/URL/session id/长 hex/版本号尾巴/
 *   裸驼峰标识符/过短过长……清单以 src 为准）；
 * - 归一后与原文不同（含被 `sanitizeFilename` 洗掉的非法字符）；
 * - 长度顶格（≥ {@link NAME_CLIP_MAX}，`deriveName` 截断的指纹，真机 1127 条的主要坏味形态）。
 *   对的是**兜底截断上限**而不是闸门上限：放宽闸门（40）后若仍拿 40 当顶格判据，
 *   那 28–39 字这一批“被规则名腰斩”的存量就再也筛不出来了。
 * ⚠ 顶格判据有已知误报（真·顶格好名会被带上）——修补幂等，误报代价只是白跑一轮。
 * @param {string|undefined} name - 记录现名。
 * @returns {boolean} true = 算坏味，进本轮候选。
 */
export function isBadNameShape(name) {
  const n = (name ?? '').trim();
  if (n.length === 0) return true;
  const gate = validateTitle(n);
  if (!gate.ok) return true;
  if (gate.name !== n) return true;
  if (n.length >= NAME_CLIP_MAX) return true;
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// title 闸门（与 task_2.1 validateTitle 同口径）
// ────────────────────────────────────────────────────────────────────────────

// 叙述引子清单不再本地持有——`validateTitle`（src 真源）已含 `starts-with-lead-in` 判据，
// 两套清单必漂移。

/**
 * LLM 返回 title 的入库闸门：直接委托 `md-name.ts::validateTitle`（唯一真源）。
 * 曾在本地养过一份同口径判据（脚本先于 Phase 2 写）——真机立刻漂移：本地宽判
 * `session-` 子串把 `dsh-session-steward` 正当名误杀，而 src 版已收窄成 id 形状。
 * 两套闸门必漂移，只留一份。
 * @param {unknown} raw - 模型给的 title 原文。
 * @returns {{ ok: true, title: string } | { ok: false, reason: string }}
 */
export function validateTitleLike(raw) {
  const g = validateTitle(typeof raw === 'string' ? raw : '');
  return g.ok ? { ok: true, title: g.name } : { ok: false, reason: g.reason };
}

/**
 * LLM 标题整形：已上收到 `md-name.ts::reshapeTitle`（上方重导出）。
 * 旧行为直接拿原文过形状闸，空格/尾点一律 `illegal-chars` 打进 fallback
 * （真机 16/20）；这些字符本来就不是语义问题，洗一下就能用。
 */

// ────────────────────────────────────────────────────────────────────────────
// task_5.2 LLM 批量
// ────────────────────────────────────────────────────────────────────────────

/** 批量提示词（system+user）。定义与 spec C 的分离口径同文：title 是名词短语，不是句子。 */
export function buildBatchMessages(items) {
  const system = '你是记忆库命名器。为每条记忆给出 title。' +
    'title 定义：6–14 个字的名词短语，回答“这条讲的是什么”；' +
    '不得是完整句子、不得以句末标点结尾（。！？.!?）、不得含文件路径或 / \\ 分隔符、' +
    '不得含 URL、session- 开头的会话 id、uuid 残片（连续长 hex）、-1234 这类版本号尾巴；' +
    '不得以「用户要求/用户规定/团队已/本次/目前/结论/要点」等叙述引子开头。' +
    '只输出一个 JSON 数组，形如 [{"id":"...","title":"..."}]，每个给定 id 恰出现一次，不要输出其它文字。';
  const user = items.map((it) => `id=${it.id}\n正文（前 ${EXCERPT_CHARS} 字）：${it.excerpt}`).join('\n\n');
  return { system, user };
}

/**
 * 从模型回复里抽出 id→title。容忍 ```json 围栏与前后杂文（取第一个 [ 到最后一个 ]）。
 * 解析整体失败时返回 null（调用方按「整批失败 → rule」处理）；解析成功但缺条属正常返回，
 * 缺的 id 由调用方逐条降级。
 * @param {string} text - choices[0].message.content 原文。
 * @returns {Map<string, string>|null}
 */
export function parseTitleArray(text) {
  const s = (text ?? '').replace(/```(?:json)?/gi, '');
  const from = s.indexOf('[');
  const to = s.lastIndexOf(']');
  if (from < 0 || to <= from) return null;
  let arr;
  try {
    arr = JSON.parse(s.slice(from, to + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  const map = new Map();
  for (const it of arr) {
    if (it === null || typeof it !== 'object') continue;
    if (typeof it.id === 'string' && typeof it.title === 'string') map.set(it.id, it.title);
  }
  return map;
}

/**
 * 一次 chat/completions 调用（direct 同形状）。密钥只在这里进 header，绝不外溢到日志。
 *
 * 真端点实测（192.168.100.25:8203 / omnicoder-9b）：这是**推理模型**——不开
 * `chat_template_kwargs.enable_thinking:false` 时 content 为空、答案全在
 * reasoning_content 里且 max_tokens 会被thinking吃光（实测 14.5s vs 关后 0.7s）。
 * 故：① 请求体固定禁思考；② content 为空时兜底取 reasoning_content（远端退回
 * thinking 模式也不至于整批静默降级成规则名）。
 * @returns {Promise<string>} 模型回复文本。
 */
export async function callLlm(endpoint, apiKey, model, messages, fetchImpl, timeoutMs = 60_000, maxTokens = LLM_BATCH * 64) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await (fetchImpl ?? globalThis.fetch)(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: messages.system },
        { role: 'user', content: messages.user },
      ],
      // maxTokens 必须可传：默认值是按“10 条命名”算的，而**抽取一臂的输出长得多**
      // （情境数组 + 每条完整正文），沿用 640 会**静默截断**——那正好能把
      // “示例有收益”测成假阴性（截断后 JSON 解不开 → 产出 0 条）。
      temperature: 0.2,
      max_tokens: maxTokens,
      chat_template_kwargs: { enable_thinking: false },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`端点返回 ${res.status}`);
  const body = await res.json();
  const msg = body?.choices?.[0]?.message;
  const content = typeof msg?.content === 'string' && msg.content.length > 0 ? msg.content : msg?.reasoning_content;
  if (typeof content !== 'string' || content.length === 0) throw new Error('响应缺少 content/reasoning_content');
  return content;
}

/**
 * 给一批记录要 title。两档失败分开处理（spec 护栏）：
 * - **整批失败**（HTTP 异常 / 响应解析不出 JSON 数组，**重试一次后仍失败**）→ `{ ok:false, error }`，
 *   由调用方记 error 并停。端点坏的时候，规则名不是“人审过的名字”，写进库等于把坏名字换个姿势再写一遍。
 *   为什么必须先重试一次：真机实测 8 路并发下单批会被排队到超时（一次拖掉整份计划 rows=0）——
 *   超时是瞬时故障，不是端点坏了，拿它废掉一整轮是错把抖动当致命。
 * - **单条不合格**（缺条 / 过不了 validateTitle 闸门）→ 回落 `deriveName` 规则名，
 *   标 `fallback` 并带上 reason，由调用方计入 fallback 统计。
 * @returns {Promise<{ ok: true, rows: Array<{ rec: object, cand: string, source: 'llm'|'fallback', reason?: string }> }
 *   | { ok: false, error: string, items: number }>}
 */
export async function titleBatch(candidates, endpoint, apiKey, model, fetchImpl, logger, timeoutMs = 60_000) {
  const items = candidates.map((r) => ({ id: r.id, excerpt: (r.content ?? '').slice(0, EXCERPT_CHARS) }));
  const { system, user } = buildBatchMessages(items);
  let map = null;
  let batchError = '';
  for (let attempt = 1; attempt <= 2 && map === null; attempt++) {
    try {
      const text = await callLlm(endpoint, apiKey, model, { system, user }, fetchImpl, timeoutMs);
      map = parseTitleArray(text);
      if (map === null) batchError = '响应不是可解析的 JSON 数组';
    } catch (err) {
      batchError = err instanceof Error ? err.message : String(err);
    }
    if (map === null && attempt === 1) {
      logger?.warn(`[repair] 第 1 次尝试失败，重试一次（${candidates.length} 条）: ${batchError}`);
    }
  }
  if (map === null) {
    logger?.warn(`[repair] 批量失败（${candidates.length} 条，本轮不产出计划）: ${batchError}`);
    return { ok: false, error: batchError, items: candidates.length };
  }
  const out = [];
  for (const r of candidates) {
    const raw = map.get(r.id);
    if (raw === undefined) { out.push({ rec: r, cand: deriveName(r.content), source: 'fallback', reason: 'missing-item', raw: '' }); continue; }
    // 整形与“只超长时按词元边界收一刀”都在 `acceptTitle`（真源）里，本地不再拼一套；
    // 本函数只负责把**拒因**留痕（人审时要能看出模型给了什么、为什么没收）。
    const gate = validateTitleLike(raw);
    const accepted = acceptTitle(raw);
    if (accepted === undefined) {
      out.push({
        rec: r,
        cand: deriveName(r.content),
        source: 'fallback',
        reason: gate.ok ? 'name-shape' : `title-gate:${gate.reason}`,
        raw,
      });
      continue;
    }
    out.push({ rec: r, cand: accepted, source: 'llm', raw });
  }
  return { ok: true, rows: out };
}

// ────────────────────────────────────────────────────────────────────────────
// task_5.3 写库前置对账闸（只读）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 跑 `reconcileLedger` 拿每条记录的象限态。sampleCap 顶到全量：要的是**逐条**状态，
 * 不是计数报告——默认 10 条样本给不出“哪些 id 落在 fileOnly”。
 * @returns {Promise<Map<string, string>>} id → state（firstTime/same/dbOnly/fileOnly/both/missingFile）
 */
export async function reconcileGate({ records, cfgRoot, dataDir, ledger, logger }) {
  const report = await reconcileLedger({
    records,
    cfgRoot,
    dataDir,
    ledger,
    maxRecords: records.length,
    timeBudgetMs: GATE_BUDGET_MS,
    sampleCap: records.length + 16,
    logger,
  });
  if (report.capped === true) throw new Error('对账闸未扫完（capped）——本轮拒绝写库，请先排查账本/磁盘状态');
  const byId = new Map();
  for (const s of report.samples) byId.set(s.id, s.state);
  return byId;
}

/** 闸口跳过判据：人在文件侧改过内容的（fileOnly/both），本轮不能顺手改名。 */
const GATE_SKIP_STATES = new Set(['fileOnly', 'both']);

/**
 * `--apply` 前置闸（task_5.5 护栏）：**账本基线必须与库内条数匹配**，否则拒绝执行。
 *
 * 为什么需要这道闸：改名的全部可回滚性建在“旧路径在账本里有基线”上（`oldEntry`）。
 * 一个从没跑过投射、或者账本被清过的库（coverage ≈ 0），改名后旧文件既认不出来也找不回去，
 * `--revert` 就成了无凭据的口号。这时正确的做法是先跑一轮投射建立基线，而不是先改名。
 *
 * 只读，绝不写；判据是“账本条目里的 id 能在库里找回来”的占库内条数的比例。
 * @param {object} deps - { records, ledger, minCoverage? }
 * @returns {{ dbCount: number, claimed: number, coverage: number }}
 * @throws 覆盖不足 / 空库时抛错（调用方给可读退出）。
 */
export function assertLedgerBaseline({ records, ledger, minCoverage = 0.5 }) {
  const dbCount = records.length;
  if (dbCount === 0) throw new Error('库里没有任何记录，无需改名（确认 --db 指对了库）');
  const idsInDb = new Set(records.map((r) => r.id));
  const claimed = new Set();
  for (const e of ledger.all()) {
    if (typeof e.id === 'string' && e.id.length > 0 && idsInDb.has(e.id)) claimed.add(e.id);
  }
  const coverage = claimed.size / dbCount;
  if (coverage < minCoverage) {
    throw new Error(
      `账本基线与库内条数不匹配：账本只认领了 ${claimed.size}/${dbCount} 条（coverage=${coverage.toFixed(2)} < ${minCoverage}）。` +
      '先把 memExport 投射跑一轮建立基线再 --apply；本轮拒绝执行，未写任何东西。',
    );
  }
  return { dbCount, claimed: claimed.size, coverage };
}

// ────────────────────────────────────────────────────────────────────────────
// task_5.4 计划生成 + 产出文件
// ────────────────────────────────────────────────────────────────────────────

export function makeStamp(now = Date.now()) {
  return new Date(now).toISOString().replace(/[:.]/g, '-');
}

/**
 * 生成改名计划（干跑的全部动作：只读库、只问 LLM、只产计划对象——不写库、不碰投射文件）。
 *
 * **两段式，分配恒按 id 排序**（确定性要求）：
 *  A. 取 title：候选按 id 排序后切成 ≤LLM_BATCH 的批，按 `concurrency` 受限并发问端点；
 *     配额（`max`，数动作不数遍历）与墙钟（`budgetMs`）都只在**排下一批之前**查。
 *  B. 落名：拿到 title 的候选**严格按 id 序**过 `allocUniqueName` 消歧。
 * 分开的原因是确定性：并发把完成顺序打乱了也不要紧，B 段的分配序恒等于 id 序，
 * 同一条记录在同一个库状态上两次跑拿到同一个名。
 *
 * 整批 LLM 失败 → `aborted=true` + `error`，`rows` 空：不拿规则名凑数（spec 护栏）。
 *
 * @param {object} deps - { records, l1, ledger, dataDir, cfgRoot, dbPath?, endpoint, apiKey, model,
 *   max?, budgetMs?, concurrency?, onlyBad?, logger, stateById?, fetchImpl?, now? }
 * @returns {Promise<{ stamp: string, plannedAt: string, rows: object[], skips: object[], counts: object, error?: string }>}
 *   rows：待改（计划表主段，行数==待改条数）；skips：跳过段（含 fileOnly/both、同名、越界）。
 */
export async function planRenames(deps) {
  const { records, l1, ledger, dataDir, cfgRoot, endpoint, apiKey, model, logger } = deps;
  const now = deps.now ?? Date.now;
  const max = deps.max ?? 100;
  const budgetMs = deps.budgetMs ?? 60_000;
  // 单批超时。不能只靠 `budgetMs`：那是批量之间的预算，而一批卡死在 fetch 上时
  // 墙钟查不到（它只在排下一批前查），只能靠请求自己的 AbortSignal。默认 60s 而不再硬写 30s。
  const timeoutMs = deps.timeoutMs ?? 60_000;
  const concurrency = Math.min(8, Math.max(1, deps.concurrency ?? 1));
  const startedAt = now();
  const stamp = makeStamp(startedAt);
  const plannedAt = new Date(startedAt).toISOString();

  const stateById = deps.stateById ?? await reconcileGate({ records, cfgRoot, dataDir, ledger, logger });
  const homeRoot = resolveMemoriesRoot(cfgRoot, dataDir, logger);

  const skips = [];
  const counts = { scanned: records.length, candidates: 0, llm: 0, fallback: 0, gateSkipped: 0, alreadyNamed: 0, unsafePath: 0, capped: false, remaining: 0 };

  // 候选池：onlyBad 只留坏味形状；被对账闸拦下的先进跳过段。排序是分配确定性的前提。
  let candidates = [];
  for (const r of records) {
    if (deps.onlyBad && !isBadNameShape(r.name)) { continue; }
    const st = stateById.get(r.id) ?? '';
    if (GATE_SKIP_STATES.has(st)) {
      skips.push({ id: r.id, oldName: r.name ?? '', reason: `reconcile:${st}`, risk: '文件侧被人改过' });
      counts.gateSkipped++;
      continue;
    }
    candidates.push(r);
  }
  candidates.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  counts.candidates = candidates.length;

  // ── A 段：按批取 title（受限并发）──
  // 只取前 `max` 条候选去问：配额数的是动作，而每条候选最多产出一个动作，所以上顶也就是上界。
  const take = Math.min(candidates.length, max);
  const chunks = [];
  for (let i = 0; i < take; i += LLM_BATCH) chunks.push(candidates.slice(i, i + LLM_BATCH));
  const titled = new Map();
  let abortError = '';
  let cursor = 0;
  const worker = async () => {
    while (abortError.length === 0 && cursor < chunks.length) {
      if (now() - startedAt >= budgetMs) { counts.capped = true; return; }
      const idx = cursor++;
      const res = await titleBatch(chunks[idx], endpoint, apiKey, model, deps.fetchImpl, logger, timeoutMs);
      if (!res.ok) { abortError = `第 ${idx + 1}/${chunks.length} 批 LLM 失败：${res.error}`; return; }
      for (const t of res.rows) titled.set(t.rec.id, t);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker()));
  if (abortError.length > 0) {
    logger?.error(`[repair] ${abortError}（整批失败不降级：本轮不产出任何计划文件）`);
    counts.remaining = candidates.length;
    return { stamp, plannedAt, rows: [], skips, counts, error: abortError, aborted: true };
  }
  // 未问到的条数 = 配额截断 + 墙钟截断，如实回报（remaining 是“本轮没动”的候选数）
  if (take < candidates.length) counts.capped = true;
  counts.remaining = Math.max(0, take - titled.size) + Math.max(0, candidates.length - take);

  // 占用集初值：本轮不动的记录的名字都是占（改名的候选们的现名**不**进占用——
  // 它们会被腾出，但 isFree 对“持者是别的候选”一律当占，从分配源头避开批次内互换）。
  const candidateIds = new Set(candidates.map((r) => r.id));
  const reserved = new Set();
  for (const r of records) {
    const n = (r.name ?? '').trim();
    if (n.length > 0 && !candidateIds.has(r.id)) reserved.add(n);
  }

  // ── B 段：按 id 序落名（candidates 已排序，titled 只是查表）──
  const rows = [];
  for (const r of candidates) {
    const t = titled.get(r.id);
    if (t === undefined) { continue; } // 截断没问到 title 的，本轮不动
    counts[t.source]++;
    const isFree = (name) => {
      const owner = l1.findIdByName(name);
      return owner === undefined || owner === r.id;
    };
    const newName = allocUniqueName(t.cand, r.id, isFree, reserved);
    const oldTarget = targetFor(r, cfgRoot, dataDir, logger);
    const newTarget = targetFor({ ...r, name: newName }, cfgRoot, dataDir, logger);
    if (newTarget.absPath === undefined || oldTarget.absPath === undefined) {
      skips.push({ id: r.id, oldName: r.name ?? '', reason: 'unsafe-path', risk: '投射落点越界' });
      counts.unsafePath++;
      continue;
    }
    if (newName === (r.name ?? '')) {
      // 幂等判据：目标值已等于现值 → 零动作，不吃配额。
      skips.push({ id: r.id, oldName: r.name ?? '', reason: 'already-named', risk: '' });
      counts.alreadyNamed++;
      continue;
    }
    const oldEntry = ledger.get(oldTarget.absPath) ?? null;
    const newText = renderRecord({ ...r, name: newName }).text;
    rows.push({
      v: 1,
      stamp,
      plannedAt,
      dbPath: deps.dbPath ?? '',
      dataDir,
      cfgRoot: cfgRoot ?? '',
      recordId: r.id,
      oldName: r.name ?? '',
      newName,
      source: t.source,
      sourceReason: t.reason ?? '',
      // 模型原文进凭据：fallback 行要能看出「模型给了什么、为什么没收」，
      // 否则人审时只能看到规则名，分不出是闸门误杀还是模型真的没答上来。
      llmRaw: t.raw ?? '',
      type: r.type,
      retired: r.validTo !== undefined,
      side: oldEntry !== null && oldEntry.root !== undefined && resolve(oldEntry.root) !== resolve(homeRoot) ? 'ws' : 'home',
      oldRelPath: oldTarget.relPath,
      newRelPath: newTarget.relPath,
      oldAbs: oldTarget.absPath,
      newAbs: newTarget.absPath,
      oldRoot: oldTarget.root,
      newRoot: newTarget.root,
      oldEntry,
      newFileDigest: digest(newText),
    });
  }

  return { stamp, plannedAt, rows, skips, counts };
}

/** Markdown 表格单元里名字带 `|` 会破表——替换成全角竖线，路径原样保留。 */
function mdCell(s) {
  return String(s ?? '').replaceAll('|', '｜');
}

/**
 * 产出计划双文件：人审的 `.md`（待改段行数 == rows.length）+ 执行/回滚用的 `.json`。
 *
 * `.json` 是**唯一执行凭据**（`--apply` / `--revert` 都只认它）：每条含 id、旧名、新名、
 * 旧投射路径、新投射路径、旧账本条目（回滚时还原它）、新文件指纹（回滚时只删内容一致的
 * 那个文件）、批次时间戳。先写 `.json` 再写 `.md`：凭据比读数表重要，
 * 宁可看到一份没计划的 md 也不要看到一份没凭据的计划。
 * @param {object} p - { dataDir, stamp, plan, dbPath, cfgRoot, endpoint?, model? }
 * @returns {Promise<{ planMd: string, planJson: string }>}
 */
export async function writePlanFiles({ dataDir, stamp, plan, dbPath, cfgRoot, endpoint, model }) {
  const planMd = join(dataDir, `rename-plan-${stamp}.md`);
  const planJson = join(dataDir, `rename-plan-${stamp}.json`);
  const doc = {
    v: 1,
    kind: 'dsh-rename-plan',
    stamp,
    plannedAt: plan.plannedAt ?? new Date().toISOString(),
    db: dbPath,
    dataDir,
    memoriesRoot: cfgRoot ?? '',
    endpoint: endpoint ?? '',
    model: model ?? '',
    counts: plan.counts,
    rows: plan.rows,
  };
  await writeFile(planJson, JSON.stringify(doc, null, 2) + '\n', 'utf8');

  const lines = [];
  lines.push(`# rename-plan ${stamp}`);
  lines.push('');
  lines.push(`- 时间: \`${doc.plannedAt}\``);
  lines.push(`- 库: \`${dbPath}\``);
  lines.push(`- 数据目录: \`${dataDir}\`，memories-root: \`${cfgRoot ?? ''}\``);
  lines.push(`- 端点: \`${endpoint ?? ''}\` model: \`${model ?? ''}\``);
  lines.push(`- 待改 ${plan.rows.length} 条 · 跳过 ${plan.skips.length} 条 · llm ${plan.counts.llm} / fallback ${plan.counts.fallback}`);
  lines.push(`- scanned=${plan.counts.scanned} candidates=${plan.counts.candidates} gateSkipped=${plan.counts.gateSkipped} alreadyNamed=${plan.counts.alreadyNamed} unsafePath=${plan.counts.unsafePath} capped=${plan.counts.capped} remaining=${plan.counts.remaining}`);
  lines.push(`- 执行: \`node tools/repair-names.mjs --apply --plan-file "${planJson}" --db "${dbPath}" --data-dir "${dataDir}"\``);
  lines.push(`- 回滚: \`node tools/repair-names.mjs --revert "${planJson}" --db "${dbPath}" --data-dir "${dataDir}"\``);
  lines.push('');
  lines.push('## 待改（此段行数 == 待改条数）');
  lines.push('');
  lines.push('| record_id | 旧名 | 新名 | 来源 | 旧路径 | 新路径 | 风险 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of plan.rows) {
    const rawNote = r.source === 'fallback' && typeof r.llmRaw === 'string' && r.llmRaw.length > 0 ? `模型给了:${r.llmRaw}` : '';
    const risk = [r.retired ? '已退场' : '', r.source === 'fallback' ? `降级:${r.sourceReason}` : '', rawNote, r.oldEntry === null ? '无旧账本基线(firstTime)' : ''].filter(Boolean).join(';');
    lines.push(`| ${mdCell(r.recordId)} | ${mdCell(r.oldName)} | ${mdCell(r.newName)} | ${r.source} | ${mdCell(r.oldAbs)} | ${mdCell(r.newAbs)} | ${mdCell(risk)} |`);
  }
  lines.push('');
  lines.push('## 跳过');
  lines.push('');
  lines.push('| record_id | 现名 | 原因 | 说明 |');
  lines.push('|---|---|---|---|');
  for (const s of plan.skips) {
    lines.push(`| ${mdCell(s.id)} | ${mdCell(s.oldName)} | ${mdCell(s.reason)} | ${mdCell(s.risk)} |`);
  }
  lines.push('');
  lines.push('图例：风险列 `reconcile:fileOnly/both` = 人在文件侧改过内容，让位于人；`already-named` = 幂等（目标==现值）；');
  lines.push('`降级:*` = 该条 LLM title 没过闸门（或模型漏答了这条），回落 deriveName 规则名（计划里看得出哪几条不是模型给的名）；');
  lines.push('`firstTime`（无旧账本条目）的记录改名后旧文件不进门禁归档、留在原地（oldEntry 为空可凭计划手工处置）。');
  await writeFile(planMd, lines.join('\n'), 'utf8');
  return { planMd, planJson };
}

/**
 * 读计划文件（`--apply` / `--revert` 的入口）。
 *
 * 主形状是 `rename-plan-<ts>.json`（`{ v, kind, db, rows: [...] }`）；同时兼容**逐行 JSON**
 * 的旧 sidecar（真机上已经产出的 `<stamp>.plan.jsonl` 不能变成废纸——那就是回滚凭据）。
 * 任何一行形状不符都整体报错而不是带病执行。
 * @returns {Promise<object[]>} 计划行（按文件里的顺序，即 id 序）。
 */
export async function readPlanFile(path) {
  const text = (await readFile(path, 'utf8')).trim();
  if (text.length === 0) throw new Error(`计划文件是空的: ${path}`);
  let rows;
  if (text.startsWith('{') || text.startsWith('[')) {
    let obj;
    try { obj = JSON.parse(text); } catch (err) {
      throw new Error(`计划文件不是合法 JSON: ${path} — ${err instanceof Error ? err.message : String(err)}`);
    }
    rows = Array.isArray(obj) ? obj : obj.rows;
    if (!Array.isArray(rows)) throw new Error(`计划文件缺 rows 数组: ${path}`);
  } else {
    rows = [];
    for (const [i, line] of text.split(/\r?\n/).entries()) {
      if (line.trim().length === 0) continue;
      try { rows.push(JSON.parse(line)); } catch (err) {
        throw new Error(`计划文件第 ${i + 1} 行不是合法 JSON: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  for (const [i, obj] of rows.entries()) {
    if (obj?.v !== 1 || typeof obj.recordId !== 'string') throw new Error(`计划文件第 ${i + 1} 行形状不符（缺 v/recordId）`);
  }
  return rows;
}

/**
 * 执行序/回滚的护栏：计划行必须来自同一本库（防止拿 A 库的计划去改 B 库）。
 * Windows 路径大小写不敏感：两侧 resolve 后再比。
 */
function assertSameDb(rows, dbPath) {
  const want = resolve(dbPath).toLowerCase();
  for (const r of rows) {
    if (typeof r.dbPath === 'string' && r.dbPath.length > 0 && resolve(r.dbPath).toLowerCase() !== want) {
      throw new Error(`计划的库路径(${r.dbPath})与当前 --db(${dbPath})不一致，拒绝执行`);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// task_5.5 --apply 执行序（不可颠倒）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 写一条新投影 + 写新账本条目（建新基线）。fs 操作走 hooks，mock 自检可注入中途失败。
 * @returns {Promise<string>} 新绝对路径
 */
async function writeProjection(row, record, deps) {
  const { ledger, cfgRoot, logger, hooks } = deps;
  const rec = { ...record, name: row.newName };
  const target = targetFor(rec, cfgRoot, deps.dataDir, logger);
  if (target.absPath === undefined) throw new Error(`投射落点越界: ${target.relPath}`);
  const { text } = renderRecord(rec);
  await hooks.mkdir(dirname(target.absPath), { recursive: true });
  await hooks.writeFile(target.absPath, text, 'utf8');
  const st = await hooks.stat(target.absPath);
  ledger.set(target.absPath, {
    id: rec.id,
    extKey: rec.extKey ?? '',
    root: target.root,
    relPath: target.relPath,
    dbDigest: recordDigest(rec),
    fileDigest: digest(text),
    fileMtimeMs: st.mtimeMs,
    fileSize: st.size,
    syncedAt: new Date().toISOString(),
  });
  return target.absPath;
}

const defaultHooks = { mkdir, writeFile, stat, readFile, rm, readdir, fileRename: rename, exists: existsSync };

/**
 * 按 sidecar 行执行改名。**顺序三段，段内可失败回退，段间不可颠倒**：
 * 1. UPDATE name（dist L1Store.rename 窄写路径：只动 name 列，不碰 updated_time/检索面）；
 *    撞 dup 的排下一轮再试（最多 3 轮，处理成环的罕见互撞）。
 * 2. 对新路径写文件 + 写新账本条目；某条写失败 → **立刻把该条 name 还原**（旧路径重新被
 *    认领，孤儿扫描就不会拆它）——不变量：任何时刻每条要么新文件已在、要么旧文件未动。
 * 3. flush 账本后，孤儿扫描把失去认领的旧路径整体搬进归档并删旧条目。
 *
 * 幂等（task_5.7）：现值已等于目标值的行零动作（第二次跑 named=0）；其中账本缺条目
 * 的（上次死在第 2 段之后）会只补投影/补账，不重复动库。
 *
 * @param {object} deps - { rows, l1, ledger, dataDir, cfgRoot, logger, stateById, hooks?, now? }
 */
export async function applyRenames(deps) {
  const { l1, ledger, cfgRoot, dataDir, logger } = deps;
  const hooks = deps.hooks ?? defaultHooks;
  const now = deps.now ?? Date.now;
  const stateById = deps.stateById ?? new Map();
  const report = {
    named: 0, written: 0, restamped: 0, rolledBack: 0, failed: [],
    skippedIdempotent: 0, skippedGate: 0, skippedMismatch: 0,
    sweep: null, archiveDir: '', ms: 0,
  };
  const t0 = now();
  const records = l1.all();
  const byId = new Map(records.map((r) => [r.id, r]));

  // ── 段 0：闸与幂等过滤（写库前必须过对账闸——纪律在段入口，不在段尾补票）──
  const todo = [];
  for (const row of deps.rows) {
    const r = byId.get(row.recordId);
    if (r === undefined) { report.failed.push({ id: row.recordId, error: 'record-missing' }); continue; }
    if (GATE_SKIP_STATES.has(stateById.get(r.id) ?? '')) { report.skippedGate++; continue; }
    const cur = (r.name ?? '').trim();
    if (cur === row.newName) {
      // 幂等行：库里已是目标名。文件/账本缺哪个补哪个（上次中途失败的残局），库不再动。
      const hasLedger = ledger.get(row.newAbs) !== undefined;
      const hasFile = hooks.exists(row.newAbs);
      if (hasFile && hasLedger) { report.skippedIdempotent++; continue; }
      try {
        await writeProjection(row, r, { ledger, cfgRoot, dataDir, logger, hooks });
        report.restamped++;
      } catch (err) {
        report.failed.push({ id: row.recordId, error: `restamp:${err instanceof Error ? err.message : String(err)}` });
      }
      continue;
    }
    if (cur.length > 0 && cur !== row.oldName) {
      // 计划生成后名字又被人/流程改过：带旧凭据回滚会指错地方，拒绝盲动。
      report.skippedMismatch++;
      continue;
    }
    todo.push({ row, r });
  }

  // ── 段 1：UPDATE name（dup 多重轮）──
  const renamed = [];
  let pending = todo;
  for (let pass = 0; pass < 3 && pending.length > 0; pass++) {
    const still = [];
    for (const it of pending) {
      const res = l1.rename(it.row.recordId, it.row.newName);
      if (res.ok) { renamed.push(it); report.named++; }
      else if (res.reason === 'dup' && pass < 2) still.push(it);
      else report.failed.push({ id: it.row.recordId, error: `rename:${res.reason ?? 'unknown'}` });
    }
    pending = still;
  }

  // ── 段 2：写新文件 + 新账本（建新基线）；失败即还原该条 name ──
  const landed = [];
  for (const it of renamed) {
    try {
      await writeProjection(it.row, it.r, { ledger, cfgRoot, dataDir, logger, hooks });
      report.written++;
      landed.push(it);
    } catch (err) {
      const back = l1.rename(it.row.recordId, it.row.oldName);
      report.rolledBack++;
      report.failed.push({ id: it.row.recordId, error: `write:${err instanceof Error ? err.message : String(err)}; rollback:${back.ok ? 'ok' : back.reason}` });
    }
  }
  await ledger.flush();

  // ── 段 3：孤儿扫描拆旧基线（只在至少一条新基线落地后才跑）──
  if (landed.length > 0) {
    const sweep = await sweepOrphanFiles({
      records: l1.all(),
      cfgRoot,
      dataDir,
      ledger,
      dryRun: false,
      maxFiles: deps.rows.length * 2 + 64,
      timeBudgetMs: GATE_BUDGET_MS,
      logger,
    });
    report.sweep = { scanned: sweep.scanned, orphans: sweep.orphans, moved: sweep.moved, failed: sweep.failed, missing: sweep.missing, capped: sweep.capped, remaining: sweep.remaining };
    report.archiveDir = sweep.dir;
    await ledger.flush();
  }
  report.ms = now() - t0;
  return report;
}

// ────────────────────────────────────────────────────────────────────────────
// task_5.6 --revert 反向执行
// ────────────────────────────────────────────────────────────────────────────

/** 在 `<dataDir>/memories-orphans/<批次>/[home|ws]/<relPath>` 里找被归档的旧文件（含数字尾巴）。 */
async function findArchivedOld(deps, row) {
  // hooks 必须在这里也兜底：`runCli` 调 revert 时不传 hooks，而本函数直接摸
  // `deps.hooks.exists` —— 真机第一次跑 `--revert` 就是死在这句上
  // （74 条全报 `restore-file:Cannot read properties of undefined (reading 'exists')`）。
  // apply 侧有 `deps.hooks ?? defaultHooks`，revert 侧漏了——同一对函数必须同一条默认值纪律。
  const hooks = deps.hooks ?? defaultHooks;
  const base = join(deps.dataDir, 'memories-orphans');
  if (!hooks.exists(base)) return undefined;
  let stamps;
  try { stamps = await hooks.readdir(base); } catch { return undefined; }
  for (const st of stamps) {
    const cand0 = join(base, st, row.side, ...row.oldRelPath.split('/'));
    if (hooks.exists(cand0)) return cand0;
    // 归档落位撞名时的数字尾巴（孤儿扫描 freeSlot 的形状：x.memory.md.2 …）
    for (let n = 2; n <= 999; n++) {
      const candN = `${cand0}.${n}`;
      if (hooks.exists(candN)) return candN;
    }
  }
  return undefined;
}

/**
 * 按 sidecar 反向还原。**每条先建回旧身份、后拆新身份**（与 apply 同一条不对称性纪律）：
 * 1. 旧文件回位（原地还在就跳过；被归档了就搬回来）；
 * 2. 旧账本条目还原（sidecar 的 oldEntry；firstTime 行本来就没条目，跳过）；
 * 3. name 还原（l1.rename 回到 oldName——还原也是改名，dup 就失败保旧侧、绝不动新侧文件）；
 * 4. 拆新侧：删新文件（**只删内容与计划 newFileDigest 一致的那个**——被人动过就留着并报 drift）
 *    + 删新账本条目。
 * 幂等：已是旧形状的条目零动作。
 *
 * @param {object} deps - { rows, l1, ledger, dataDir, cfgRoot, logger, hooks? }
 */
export async function revertPlan(deps) {
  const { l1, ledger, dataDir } = deps;
  const hooks = deps.hooks ?? defaultHooks;
  const report = { reverted: 0, skippedAlready: 0, failed: [], newFileDrift: [], newFileKept: 0, moved: 0 };
  const records = l1.all();
  const byId = new Map(records.map((r) => [r.id, r]));
  // 本轮真还原成功的 id：收尾自检只查这些（task_5.6 验收：往返后 name 逐字还原）。
  const revertedIds = new Set();

  for (const row of deps.rows) {
    const r = byId.get(row.recordId);
    if (r === undefined) { report.failed.push({ id: row.recordId, error: 'record-missing' }); continue; }
    const cur = (r.name ?? '').trim();
    const oldInPlace = hooks.exists(row.oldAbs);
    const oldLedgerBack = ledger.get(row.oldAbs) !== undefined;
    if (cur === row.oldName && oldInPlace && oldLedgerBack && !hooks.exists(row.newAbs)) {
      report.skippedAlready++;
      continue; // 已还原（或从未被改）：幂等零动作。
    }
    // 1) 旧文件回位
    try {
      if (!oldInPlace) {
        const found = await findArchivedOld(deps, row);
        if (found !== undefined) {
          await hooks.mkdir(dirname(row.oldAbs), { recursive: true });
          await hooks.fileRename(found, row.oldAbs);
          report.moved++;
        } else if (row.oldEntry !== null && row.oldEntry !== undefined) {
          // 有账本基线说明我们曾写出过这个文件，现在原地没有、归档也找不到：不动，交人工。
          report.failed.push({ id: row.recordId, error: 'old-file-not-found' });
          continue;
        }
        // firstTime 行（oldEntry 为空）：apply 时本来就没有旧文件，无位可回。
      }
    } catch (err) {
      report.failed.push({ id: row.recordId, error: `restore-file:${err instanceof Error ? err.message : String(err)}` });
      continue;
    }
    // 2) 旧账本条目还原
    if (row.oldEntry !== null && row.oldEntry !== undefined) {
      ledger.set(row.oldAbs, row.oldEntry);
    } else {
      ledger.delete(row.oldAbs);
    }
    // 3) name 还原
    if (cur !== row.oldName) {
      const res = l1.rename(row.recordId, row.oldName);
      if (!res.ok) {
        report.failed.push({ id: row.recordId, error: `rename-back:${res.reason ?? 'unknown'}` });
        continue; // 旧侧已复位，新侧原样保留——宁可两边都在，不可两头都没有。
      }
    }
    report.reverted++;
    revertedIds.add(row.recordId);
    // 4) 拆新侧
    try {
      if (hooks.exists(row.newAbs)) {
        const textNow = await hooks.readFile(row.newAbs, 'utf8');
        if (digest(textNow) === row.newFileDigest) {
          await hooks.rm(row.newAbs, { force: true });
        } else {
          report.newFileDrift.push({ id: row.recordId, path: row.newAbs });
          report.newFileKept++;
        }
      }
      ledger.delete(row.newAbs);
    } catch (err) {
      report.failed.push({ id: row.recordId, error: `teardown-new:${err instanceof Error ? err.message : String(err)}` });
    }
  }
  await ledger.flush();
  const after = new Map(l1.all().map((x) => [x.id, (x.name ?? '').trim()]));
  for (const id of revertedIds) {
    const row = deps.rows.find((r) => r.recordId === id);
    if (after.get(id) !== row.oldName) {
      report.failed.push({ id, error: 'verify-name-drift' });
    }
  }
  return report;
}

// ────────────────────────────────────────────────────────────────────────────
// 装配 + CLI 主流程
// ────────────────────────────────────────────────────────────────────────────

/** stderr 日志器（stdout 留给机器可读汇总）。quiet 时只留 warn/error。 */
export function makeLogger({ info = true } = {}) {
  return {
    info: (m) => { if (info) process.stderr.write(`${m}\n`); },
    warn: (m) => process.stderr.write(`${m}\n`),
    error: (m) => process.stderr.write(`${m}\n`),
  };
}

/**
 * 打开库/存储/账本（真建表路径走 dist；dimensions=0 纯 FTS 模式，改名流程不需要向量）。
 * ⚠ 偏差记录（task_5.1「只读打开」）：dist MemoryDb 不提供 readOnly 连接形态，
 * 干跑的「只读」由代码路径保证——干跑只调 all/findIdByName/reconcileLedger，无任何写 API。
 */
export async function bootstrap({ dbPath, dataDir, logger }) {
  const db = new MemoryDb(dbPath, 0, logger);
  const init = db.init();
  if (typeof init?.reason === 'string' && init.reason.length > 0) {
    logger?.warn(`[repair] 建表返回: ${init.reason}`);
  }
  const l1 = new L1Store(dataDir, db, undefined, 'keyword', logger, 0, undefined, () => false);
  await l1.init();
  const ledger = new MdLedgerStore(dataDir, logger);
  await ledger.init();
  return { db, l1, ledger };
}

/** 主流程。返回进程退出码（不自己 process.exit，方便 mock 自检直接调用）。 */
export async function runCli(argv) {
  const { opts, help, error } = parseArgs(argv);
  if (help) { process.stdout.write(`${HELP}\n`); return 0; }
  if (error !== undefined) {
    process.stderr.write(`参数错误: ${error}\n`);
    return 2;
  }
  const logger = makeLogger();
  const { dataDir: defDir, dbPath: defDb } = defaultPaths();
  const dataDir = resolve(opts.dataDir ?? defDir);
  const dbPath = resolve(opts.db ?? defDb);
  // memories-root 主名（就是 cfg.memExport.root），cfg-root 是同义别名。
  const cfgRoot = opts.memoriesRoot ?? opts.cfgRoot;
  const sweepOnly = opts.sweepOrphans === true;
  const mode = opts.revert !== undefined
    ? 'revert'
    : (opts.apply === true ? (sweepOnly ? 'sweep' : 'apply') : (sweepOnly ? 'sweep' : 'plan'));
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const model = opts.model ?? 'default';
  // 密钥可缺：局域网 llama.cpp 不吃鉴权，缺了就不发 Authorization 头（给了也只进 header）。
  const apiKey = (process.env.DSH_LLM_API_KEY ?? '').trim();
  if (mode === 'plan' && apiKey.length === 0) {
    logger.warn('[repair] 未设置 DSH_LLM_API_KEY：将以无 Authorization 头请求端点。');
  }
  if (mode === 'apply' && opts.planFile === undefined) {
    process.stderr.write('--apply 必须带一份已审计划文件（--apply --plan-file <rename-plan-*.json>，或 --apply <file>）。' +
      '拒绝「现场编一份计划现场执行」，未动库。\n');
    return 2;
  }

  const { db, l1, ledger } = await bootstrap({ dbPath, dataDir, logger });
  const summary = { mode, db: dbPath, dataDir };
  try {
    if (mode === 'sweep') {
      // 只跑孤儿归档：改名成功后旧路径全靠这一步收尾，否则残片一直躺在活档案里、
      // 账本也一直虚高（真机本轮：1167 → 1241 条，75 个没人认领）。
      // 面板端点有 dryRun 默认 true 同一纪律，这里也不给“默认就搬”。
      const rep = await sweepOrphanFiles({
        records: l1.all(), cfgRoot, dataDir, ledger,
        dryRun: opts.apply !== true,
        maxFiles: opts.max === undefined ? 100 : Number(opts.max),
        timeBudgetMs: opts.budgetMs === undefined ? 60_000 : Number(opts.budgetMs),
        logger,
      });
      summary.sweep = { dryRun: rep.dryRun, scanned: rep.scanned, claimed: rep.claimed, orphans: rep.orphans, moved: rep.moved, failed: rep.failed, missing: rep.missing, capped: rep.capped, remaining: rep.remaining, dir: rep.dir, samples: rep.samples.slice(0, 8) };
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      return rep.failed > 0 ? 1 : 0;
    }

    if (mode === 'plan') {
      const records = l1.all();
      const plan = await planRenames({
        records, l1, ledger, dataDir, cfgRoot, dbPath,
        endpoint, apiKey, model,
        max: opts.max === undefined ? 100 : Number(opts.max),
        budgetMs: opts.budgetMs === undefined ? 60_000 : Number(opts.budgetMs),
        timeoutMs: opts.timeoutMs === undefined ? 60_000 : Number(opts.timeoutMs),
        concurrency: opts.concurrency === undefined ? 1 : Number(opts.concurrency),
        onlyBad: opts.onlyBad === true,
        logger,
      });
      summary.plan = { stamp: plan.stamp, plannedAt: plan.plannedAt, rows: plan.rows.length, skips: plan.skips.length, ...plan.counts };
      if (plan.error !== undefined) {
        // 护栏：整批 LLM 失败 → 不写任何计划文件，只如实报错退出。
        summary.error = plan.error;
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        return 1;
      }
      const files = await writePlanFiles({ dataDir, stamp: plan.stamp, plan, dbPath, cfgRoot, endpoint, model });
      summary.plan.md = files.planMd;
      summary.plan.json = files.planJson;
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      return 0;
    }

    const planPath = resolve(mode === 'apply' ? opts.planFile : opts.revert);
    const rows = await readPlanFile(planPath);
    assertSameDb(rows, dbPath);
    summary.planFile = planPath;
    summary.planRows = rows.length;

    if (mode === 'revert') {
      const reverted = await revertPlan({ rows, l1, ledger, dataDir, cfgRoot, logger });
      summary.reverted = reverted;
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      return reverted.failed.length > 0 ? 1 : 0;
    }

    // apply：先过账本基线闸（必须与库内条数匹配）与对账闸，再动库。
    const records = l1.all();
    summary.baseline = assertLedgerBaseline({ records, ledger });
    const stateById = await reconcileGate({ records, cfgRoot, dataDir, ledger, logger });
    const applied = await applyRenames({ rows, l1, ledger, dataDir, cfgRoot, logger, stateById });
    summary.applied = applied;
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return applied.failed.length > 0 ? 1 : 0;
  } catch (err) {
    // 护栏：闸拒绝 / 意外异常都给机器可读的一行错误。单条写失败的回滚在 applyRenames 内部。
    const msg = err instanceof Error ? err.message : String(err);
    summary.error = msg;
    logger.error(`[repair] 本轮拒绝执行或未跑完: ${msg}`);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 1;
  } finally {
    try { db.close(); } catch { /* 关不掉不掩盖主结果 */ }
  }
}

// 直接运行才走 CLI（被 mocktest import 时只出函数不跑库）。
const invokedPath = process.argv[1] === undefined ? '' : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  runCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`[repair] 未捕获错误: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
