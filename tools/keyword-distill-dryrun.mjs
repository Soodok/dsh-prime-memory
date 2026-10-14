#!/usr/bin/env node
/**
 * keyword-distill-dryrun.mjs —— 关键词/情景蒸馏提示词的 dry-run 校验（例子阶段产物，离线、只读）。
 *
 * 纪律（对标 tools/repair-names.mocktest.mjs）：
 * - 绝不写任何记忆库；读样本一律 mode=readonly；不碰正在用的写路径。
 * - 绝不打印 API key / base 中的凭据片段。
 * - `node tools/keyword-distill-dryrun.mjs --mock` → 内置 fixture + 本地 http 桩，验证 渲染→调用→解析→机械闸 全链路，退出码 0=过。
 * - `--live --from qoder|l1 --n 20` → 真读样本 + 真端点（--base/--model 或 env OPENAI_BASE_URL/KW_MODEL，key 取 env KW_API_KEY，缺则尝试内部读 ~/.dsh 但不回显）。
 *
 * 系统提示词从 tools/keyword-distill.prompt.md 的 ```text 块读取（单一事实源）。
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const MODE = has('--live') ? 'live' : 'mock';
const N = Number(val('--n') || 8);

// ── 读系统提示词（prompt.md 里第一个 ```text 块）────────────────────────
function loadSystemPrompt() {
  const md = readFileSync(path.join(__dirname, 'keyword-distill.prompt.md'), 'utf8');
  const m = md.match(/```text\r?\n([\s\S]*?)```/);
  if (!m) throw new Error('prompt.md 里找不到 ```text 系统提示词块');
  return m[1].trim();
}

// ── 机械闸：逐条判配额，返回违规列表（空=过）──────────────────────────
function wordCount(s) {
  const cjkChars = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (s.match(/[A-Za-z0-9][\w.\-+]*/g) || []).length;
  // 中文按“词”估：平均词长≈两个汉字，故 cjk 字 ÷2 上取整；拉丁按空格词。
  return latin + Math.ceil(cjkChars / 2);
}
function tokenizeTitle(s) {
  return new Set((s.toLowerCase().match(/[a-z0-9_.\-+]+|[\u4e00-\u9fff]{2,4}/g)) || []);
}
function gateItem(item, inputById) {
  const errs = [];
  const warns = [];
  const rec = inputById.get(item.id);
  if (!rec) { errs.push(`id 无法配对: ${String(item.id).slice(0, 40)}`); return { errs, warns }; }
  const kw = Array.isArray(item.keywords) ? item.keywords.map((x) => String(x).trim()).filter(Boolean) : [];
  const sc = Array.isArray(item.usage_scenario) ? item.usage_scenario.map((x) => String(x).trim()).filter(Boolean) : [];
  if (kw.length < 1 || kw.length > 5) errs.push(`keywords 数越界(${kw.length})`);
  for (const k of kw) { const w = wordCount(k); if (w < 1 || w > 6) errs.push(`keyword 词数越界: "${k}"(${w})`); }
  if (new Set(kw.map((k) => k.toLowerCase())).size !== kw.length) errs.push('keywords 含重复');
  if (sc.length < 1 || sc.length > 3) errs.push(`usage_scenario 数越界(${sc.length})`);
  for (const s of sc) { const w = wordCount(s); if (w < 4 || w > 12) errs.push(`scenario 词数越界: "${s}"(${w})`); }
  // keywords 与标题字面重叠 = 软告警（真实语料普遍重叠，BM25 无害），不计违规
  const titleTok = tokenizeTitle(rec.title || '');
  for (const k of kw) if (titleTok.has(k.toLowerCase()) && wordCount(k) === 1) warns.push(`keyword 与标题重叠: "${k}"`);
  return { errs, warns };
}

// ── 样本读取（只读）────────────────────────────────────────────────────
const MOCK_FIXTURE = [
  { id: 'm1', title: 'Windows PowerShell中Node fallback下需用分号替代&&', content: '在Windows PowerShell环境下通过Node fallback执行Bash命令时，&&操作符不被识别，报错InvalidEndOfLine。应改用分号连接多条命令。' },
  { id: 'm2', title: '项目核心技术栈', content: '后端 Node.js 20+，Docker Engine 做动态 Worker 编排；前端 Vue 3 + Vite；数据库 better-sqlite3 需 C++ 编译工具链；AI 后端 Agent SDK。' },
  { id: 'm3', title: 'pnpm install purges on version mismatch', content: 'Running pnpm install with a pnpm major different from .modules.yaml packageManager triggers full reinstall and a network hang. Use matching pnpm and --offline.' },
];

function readFromSource() {
  const from = val('--from') || 'qoder';
  if (from === 'qoder') {
    const dbp = val('--db') || path.join(process.env.APPDATA || '', 'QoderCN', 'SharedClientCache', 'cache', 'db', 'local.db');
    const db = new DatabaseSync(dbp, { readOnly: true });
    const rows = db.prepare('SELECT title, content, keywords FROM agent_memory WHERE keywords IS NOT NULL AND TRIM(keywords)<>"" ORDER BY freq DESC LIMIT ?').all(N);
    db.close();
    return rows.map((r, i) => ({ id: 'q' + i, title: r.title, content: (r.content || '').slice(0, 280) }));
  }
  // from === 'l1' → prime-memory 自己的库
  const dbp = val('--db') || path.join(homedir(), '.dsh', 'memory', 'memory.db');
  const db = new DatabaseSync(dbp, { readOnly: true });
  const rows = db.prepare('SELECT record_id AS id, name, content FROM l1_records ORDER BY updated_time DESC LIMIT ?').all(N);
  db.close();
  return rows.map((r) => ({ id: r.id, title: r.name || '', content: (r.content || '').slice(0, 280) }));
}

function readSamples() {
  if (has('--dump')) {
    const p = val('--samples') || path.join(__dirname, '.kw-samples.json');
    const rows = readFromSource();
    writeFileSync(p, JSON.stringify(rows, null, 2), 'utf8');
    console.log('dumped', rows.length, 'samples ->', p);
    process.exit(0);
  }
  if (MODE === 'mock') return MOCK_FIXTURE;
  return readFromSource();
}

// ── 渲染 user 提示（与生产 chunk 渲染同形）─────────────────────────────
function renderUser(samples) {
  const list = samples.map((r, i) => `${i + 1}. id=${r.id}\n标题：${r.title}\n正文：${r.content}`).join('\n\n');
  return '记忆列表:\n' + list;
}

// ── 调用（OpenAI 兼容 /chat/completions）；mock 用本地 http 桩跑通全链路 ──
async function callEndpoint(system, user) {
  const body = JSON.stringify({ model: MODEL_NAME, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0 });
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', ...(API_KEY ? { authorization: 'Bearer ' + API_KEY } : {}) }, body });
  if (!res.ok) throw new Error(`端点 ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = await res.json();
  return j.choices?.[0]?.message?.content || '';
}

function extractJsonArray(text) {
  const fence = text.match(/```json\r?\n([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  const s = raw.indexOf('['), e = raw.lastIndexOf(']');
  if (s < 0 || e <= s) throw new Error('输出里找不到 JSON 数组');
  return JSON.parse(raw.slice(s, e + 1));
}

async function run() {
  const system = loadSystemPrompt();
  const samples = readSamples();
  if (has('--bad')) samples.push({ id: 'mbad', title: '越界反例', content: '用于反向对照：应产 6 个关键词触发机械闸' });
  const inputById = new Map(samples.map((r) => [r.id, r]));
  // 分块调端点（每批 CHUNK 条，与生产 wing-backfill 同口径，避免一次喂太多把输出截断）
  const CHUNK = 20;
  let mockServer = null;
  if (MODE === 'mock') {
    mockServer = createServer((req, res) => {
      let buf = ''; req.on('data', (c) => (buf += c)); req.on('end', () => {
        const body = JSON.parse(buf || '{}');
        const msgs = body.messages || [];
        const userTxt = String((msgs.find((m) => m.role === 'user') || {}).content || '');
        const ids = [...userTxt.matchAll(/id=(\S+)/g)].map((m) => m[1]);
        const canned = JSON.stringify(ids.map((id) => mockOutputFor(inputById.get(id) || { id, title: '', content: '' })));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: '```json\n' + canned + '\n```' } }] }));
      });
    });
    await new Promise((ok) => mockServer.listen(0, '127.0.0.1', ok));
    ENDPOINT = 'http://127.0.0.1:' + mockServer.address().port + '/v1/chat/completions';
    MODEL_NAME = 'mock'; API_KEY = '';
  } else {
    ENDPOINT = (val('--base') || process.env.OPENAI_BASE_URL || '').replace(/\/$/, '') + '/chat/completions';
    MODEL_NAME = val('--model') || process.env.KW_MODEL || '';
    API_KEY = process.env.KW_API_KEY || '';
    if (!ENDPOINT.startsWith('http') || !MODEL_NAME) throw new Error('live 需 --base/OPENAI_BASE_URL 与 --model/KW_MODEL');
  }
  const parsed = [];
  for (let i = 0; i < samples.length; i += CHUNK) {
    const txt = await callEndpoint(system, renderUser(samples.slice(i, i + CHUNK)));
    parsed.push(...extractJsonArray(txt));
  }
  if (mockServer) mockServer.close();

  // 机械闸
  let viol = 0;
  let warned = 0;
  const lines = [];
  for (const item of parsed) {
    const { errs, warns } = gateItem(item, inputById);
    if (errs.length) viol++;
    if (warns.length) warned++;
    const rec = inputById.get(item.id);
    lines.push('### id=' + item.id + (errs.length ? '  ❌ ' + errs.join('; ') : warns.length ? '  ⚠️ ' + warns.join('; ') : '  ✅'));
    lines.push('- 标题: ' + (rec ? rec.title : '(?)'));
    lines.push('- keywords: ' + JSON.stringify(item.keywords || []));
    lines.push('- usage_scenario: ' + JSON.stringify(item.usage_scenario || []));
    lines.push('');
  }
  const report = `# keyword-distill dry-run (${MODE})\n\n样本 ${samples.length} 条，机械闸违规 ${viol} 条，软告警 ${warned} 条。\n\n` + lines.join('\n');
  if (MODE === 'live') {
    const outp = val('--out') || path.join(__dirname, 'keyword-distill-dryrun.sample.md');
    writeFileSync(outp, report, 'utf8');
    console.log('wrote', outp, 'violations=', viol);
  }
  console.log(report.split('\n').slice(0, 3).join('\n'));
  process.exit(viol === 0 ? 0 : 1);
}

// mock 输出：从 fixture 派生"合格"答案（等价于 few-shot 里的人工标注）
const MOCK_ANSWERS = {
  m1: { keywords: ['PowerShell', 'Node fallback', 'InvalidEndOfLine', '分号分隔'], usage_scenario: ['PowerShell里用&&串联命令报解析错误', 'Node fallback执行Bash复合命令失败时'] },
  m2: { keywords: ['Node.js 20+', 'Docker Engine', 'Vue 3', 'better-sqlite3', 'Agent SDK'], usage_scenario: ['新成员了解项目技术选型', '评估技术迁移或替换可行性', '搭本地开发环境确认工具链'] },
  m3: { keywords: ['modules.yaml packageManager', 'pnpm version mismatch', 'hoisted nodeLinker', 'offline install'], usage_scenario: ['pnpm install hangs after full-reinstall prompt', 'relinking a file: dep in a hoisted workspace'] },
  mbad: { keywords: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], usage_scenario: ['ok scene here'] },
};
function mockOutputFor(r) { return { id: r.id, ...(MOCK_ANSWERS[r.id] || { keywords: [r.title.slice(0, 6)], usage_scenario: ['generic scene'] }) }; }

let ENDPOINT = '', MODEL_NAME = '', API_KEY = '';
run().catch((e) => { console.error('DRYRUN FAIL:', e.message); process.exit(2); });
