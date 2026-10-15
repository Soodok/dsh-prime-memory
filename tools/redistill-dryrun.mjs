#!/usr/bin/env node
/**
 * redistill-dryrun.mjs —— 存量记忆重蒸馏整形提示词的 dry-run 校验（例子阶段产物，离线、只读）。
 *
 * 纪律（对标 tools/keyword-distill-dryrun.mjs）：
 * - 绝不写任何记忆库；读样本一律 readOnly；不碰正在用的写路径。
 * - 绝不打印 API key / base 中的凭据片段。
 * - `--mock` → 内置 fixture + 本地 http 桩，验证 渲染→调用→解析→质量闸(scoreSkeleton)→机械闸 全链路，退出码 0=过。
 * - `--live --from l1 --n 15 --base <url> --model <name>` → 真读活跃「平」L1 + 调端点，产 redistill-dryrun.sample.md。
 * - `--dump --from l1 --n 15` → 只读导出样本到 .redistill-samples.json。
 * - 反向对照 `--mock --bad`：注入一条机械越界(空正文/6 关键词)样本 → 机械闸判违规 → 退出码非零。
 *
 * 系统提示词从 tools/redistill.prompt.md 的 ```text 块读取（单一事实源）。
 * 质量闸从 dist/prompts/examples.js import scoreSkeleton（不复制骨架表，避免第二事实源）。
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreSkeleton } from '../dist/prompts/examples.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const MODE = has('--live') ? 'live' : 'mock';
const N = Number(val('--n') || 8);

function loadSystemPrompt() {
  const md = readFileSync(path.join(__dirname, 'redistill.prompt.md'), 'utf8');
  const m = md.match(/```text\r?\n([\s\S]*?)```/);
  if (!m) throw new Error('prompt.md 里找不到 ```text 系统提示词块');
  return m[1].trim();
}

// ── 词数估算（CJK 按字/2 估、Latin 按空格词，与 keyword-dryrun 同口径）──
function wordCount(s) {
  const cjkChars = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (s.match(/[A-Za-z0-9][\w.\-+]*/g) || []).length;
  return latin + Math.ceil(cjkChars / 2);
}

// ── 机械闸：正文非空 + keywords/usage_scenario 配额（越界=违规）──────────
function mechGate(item, inputById) {
  const errs = [];
  const warns = [];
  const rec = inputById.get(item.id);
  if (!rec) { errs.push(`id 无法配对: ${String(item.id).slice(0, 40)}`); return { errs, warns }; }
  const content = typeof item.content === 'string' ? item.content.trim() : '';
  if (content.length === 0) errs.push('整形后正文为空');
  const kw = Array.isArray(item.keywords) ? item.keywords.map((x) => String(x).trim()).filter(Boolean) : [];
  const sc = Array.isArray(item.usage_scenario) ? item.usage_scenario.map((x) => String(x).trim()).filter(Boolean) : [];
  if (kw.length < 1 || kw.length > 5) errs.push(`keywords 数越界(${kw.length})`);
  for (const k of kw) { const w = wordCount(k); if (w < 1 || w > 6) errs.push(`keyword 词数越界: "${k}"(${w})`); }
  if (new Set(kw.map((k) => k.toLowerCase())).size !== kw.length) errs.push('keywords 含重复');
  if (sc.length < 1 || sc.length > 3) errs.push(`usage_scenario 数越界(${sc.length})`);
  for (const s of sc) { const w = wordCount(s); if (w < 4 || w > 12) errs.push(`scenario 词数越界: "${s}"(${w})`); }
  return { errs, warns };
}

// ── 质量闸：整形后骨架分严格优于整形前才判「可写」──────────────────────
function quality(rec, newContent) {
  const o = scoreSkeleton(rec.type, rec.content || '');
  const n = scoreSkeleton(rec.type, typeof newContent === 'string' ? newContent : '');
  const better = (n.齐备 && !o.齐备) || n.命中数 > o.命中数;
  const write = better && (newContent || '').trim().length > 0;
  return { o, n, write };
}

// ── 只读样本源 ──────────────────────────────────────────────────────────
const MOCK_FIXTURE = [
  { id: 'rf1', type: 'work_fact', title: 'WinPS Set-Content 写 BOM 炸 manifest', content: 'Set-Content -Encoding utf8 会写 BOM，装机后五格冒烟集体挂了。' },
  { id: 'rf2', type: 'work_method', title: 'pnpm 单包换版重装', content: '先改 package.json 的 file: 指针，再跑 install。' },
  { id: 'rf3', type: 'instruction', title: 'publish 必须钉 npmjs', content: '发布要显式带 registry 参数，不然会打到镜像。' },
];

function readFromSource() {
  const dbp = val('--db') || path.join(homedir(), '.dsh', 'memory', 'memory.db');
  const db = new DatabaseSync(dbp, { readOnly: true });
  // 活跃 + 无 superseded + 正文 20~300 字（「平」的主战场）；再在 JS 侧筛 scoreSkeleton 不齐备的。
  const rows = db.prepare(
    "SELECT record_id AS id, name AS title, type, content FROM l1_records " +
    "WHERE COALESCE(valid_to,'')='' AND metadata_json NOT LIKE '%\"dsh_superseded\"%' " +
    "AND LENGTH(content) BETWEEN 20 AND 300 ORDER BY updated_time DESC LIMIT 400",
  ).all();
  db.close();
  const flat = rows
    .map((r) => ({ id: r.id, type: r.type || 'work_fact', title: r.name || r.title || '', content: (r.content || '').slice(0, 400) }))
    .filter((r) => !scoreSkeleton(r.type, r.content).齐备);
  return flat.slice(0, N);
}

function readSamples() {
  if (has('--dump')) {
    const p = val('--samples') || path.join(__dirname, '.redistill-samples.json');
    const rows = readFromSource();
    writeFileSync(p, JSON.stringify(rows, null, 2), 'utf8');
    console.log('dumped', rows.length, 'samples ->', p);
    process.exit(0);
  }
  if (MODE === 'mock') return MOCK_FIXTURE;
  return readFromSource();
}

function renderUser(samples) {
  const list = samples.map((r, i) => `${i + 1}. id=${r.id}\n类型：${r.type}\n标题：${r.title}\n当前正文：${r.content}`).join('\n\n');
  return '记忆列表:\n' + list;
}

async function callEndpoint(system, user) {
  const body = JSON.stringify({ model: MODEL_NAME, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0 });
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', ...(API_KEY ? { authorization: 'Bearer ' + API_KEY } : {}) }, body });
  if (!res.ok) throw new Error(`端点 ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = await res.json();
  return j.choices?.[0]?.message?.content || '';
}

function extractJson(text) {
  text = (text || '').trim();
  const fence = text.match(/```(?:json)?\r?\n([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  let v = null;
  try { v = JSON.parse(text); } catch {
    const cand = [text.indexOf('{'), text.indexOf('[')].filter((i) => i >= 0);
    const s = cand.length ? Math.min(...cand) : -1;
    const e = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (s >= 0 && e > s) { try { v = JSON.parse(text.slice(s, e + 1)); } catch { v = null; } }
  }
  if (v === null) return [];
  return Array.isArray(v) ? v : [v];
}

async function run() {
  const system = loadSystemPrompt();
  const samples = readSamples();
  if (has('--bad')) samples.push({ id: 'mbad', type: 'work_fact', title: '越界反例', content: '用于反向对照：整形后应留空正文触发机械闸。' });
  const inputById = new Map(samples.map((r) => [r.id, r]));
  const CHUNK = 20;
  let mockServer = null;
  if (MODE === 'mock') {
    mockServer = createServer((req, res) => {
      let buf = ''; req.on('data', (c) => (buf += c)); req.on('end', () => {
        const body = JSON.parse(buf || '{}');
        const userTxt = String(((body.messages || []).find((m) => m.role === 'user') || {}).content || '');
        const ids = [...userTxt.matchAll(/id=(\S+)/g)].map((m) => m[1]);
        const canned = JSON.stringify(ids.map((id) => mockOutputFor(inputById.get(id) || { id, type: 'work_fact', title: '', content: '' })));
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
    parsed.push(...extractJson(txt));
  }
  if (mockServer) mockServer.close();

  let viol = 0; let wouldWrite = 0; let keepOriginal = 0;
  const lines = [];
  for (const item of parsed) {
    const rec = inputById.get(item.id);
    const { errs } = mechGate(item, inputById);
    if (errs.length) viol++;
    const q = rec ? quality(rec, item.content) : null;
    if (q) { if (q.write) wouldWrite++; else keepOriginal++; }
    lines.push('### id=' + item.id + (errs.length ? '  ❌ ' + errs.join('; ') : (q && q.write ? '  ✅可写' : '  ⏸留原文')));
    if (rec) {
      lines.push('- 类型: ' + rec.type + ' | 标题: ' + rec.title);
      lines.push('- 【整形前】(骨架 ' + (q ? q.o.命中数 + '/' + q.o.要素数 : '?') + (q && q.o.齐备 ? ' 齐备' : ' 缺:' + (q ? q.o.缺.join(',') : '?')) + ')');
      lines.push('  ' + (rec.content || '').replace(/\n/g, ' '));
      lines.push('- 【整形后】(骨架 ' + (q ? q.n.命中数 + '/' + q.n.要素数 : '?') + (q && q.n.齐备 ? ' 齐备' : ' 缺:' + (q ? q.n.缺.join(',') : '?')) + ')');
      lines.push('  ' + String(item.content || '').replace(/\n/g, ' '));
      lines.push('- keywords: ' + JSON.stringify(item.keywords || []));
      lines.push('- usage_scenario: ' + JSON.stringify(item.usage_scenario || []));
    }
    lines.push('');
  }
  const report = `# redistill dry-run (${MODE})\n\n样本 ${samples.length} 条｜机械闸违规 ${viol}｜质量闸判可写 ${wouldWrite} / 留原文 ${keepOriginal}\n\n` + lines.join('\n');
  if (MODE === 'live') {
    const outp = val('--out') || path.join(__dirname, 'redistill-dryrun.sample.md');
    writeFileSync(outp, report, 'utf8');
    console.log('wrote', outp, 'violations=', viol, 'write=', wouldWrite, 'keep=', keepOriginal);
  }
  console.log(report.split('\n').slice(0, 3).join('\n'));
  process.exit(viol === 0 ? 0 : 1);
}

// mock 输出：从 fixture 派生"合格且骨架更优"的整形结果（等价于人工标注）
const MOCK_ANSWERS = {
  rf1: { content: '结论：Windows PowerShell 5.1 的 Set-Content -Encoding utf8 会写入 UTF-8 BOM。\n依据：装机后 5 个农场格冒烟集体 boot 失败，宿主 JSON.parse 报 Unexpected token（首字节 EF BB BF）。\n适用范围：凡被 Node/JSON.parse 读取的 manifest 文件都中招，改用 WriteAllText 无 BOM 即失效。', keywords: ['Set-Content BOM', 'readProfileManifest', 'JSON.parse Unexpected token', 'EF BB BF'], usage_scenario: ['装机后多格冒烟集体启动失败排查', '脚本改写 profile JSON 报解析错误'] },
  rf2: { content: '目标：给 pnpm 工作区里某个 file: 依赖单包换版。\n步骤：先改 package.json 的 file: 指针指向新 tgz；再读 .modules.yaml 的 packageManager 选匹配版本；然后跑 pnpm install --offline。\n前置/注意：用小一号 pnpm 会触发整树重装并联网卡死，注意先确认目标 tgz 真实存在。', keywords: ['.modules.yaml packageManager', 'pnpm install --offline', 'file: 指针', 'hoisted nodeLinker'], usage_scenario: ['手动改 file: 依赖后重装单包', '多版本 pnpm 并存机器选版本'] },
  rf3: { content: '规则：npm publish 必须显式带 --registry=https://registry.npmjs.org。\n触发时机：当默认 registry 被配成 npmmirror 镜像、而 auth token 只钉 npmjs 时。\n反例/边界：裸发会打向镜像导致失败或错投，除非显式钉源。', keywords: ['npm publish --registry', 'npmmirror 镜像', 'registry.npmjs.org', 'auth token 钉 npmjs'], usage_scenario: ['发布前确认 registry 未被镜像劫持', 'publish 报 401 或错投时排查'] },
  mbad: { content: '', keywords: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], usage_scenario: ['ok scene here'] },
};
function mockOutputFor(r) { return { id: r.id, ...(MOCK_ANSWERS[r.id] || { content: r.content, keywords: [(r.title || 'x').slice(0, 6)], usage_scenario: ['generic scene here'] }) }; }

let ENDPOINT = '', MODEL_NAME = '', API_KEY = '';
run().catch((e) => { console.error('DRYRUN FAIL:', e.message); process.exit(2); });
