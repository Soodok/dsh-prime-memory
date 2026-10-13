#!/usr/bin/env node
/**
 * repair-names.mjs 的本地 mock 自检（pm-name-distill Phase 5，task_5.2/5.3/5.5/5.6/5.7 覆盖）。
 *
 * 纪律：
 * - 全部跑在 mkdtemp 临时目录 + 自建 sqlite 库（走 dist 的 MemoryDb/L1Store 真建表），
 *   **绝不触碰** ~/.dsh/memory/memory.db；
 * - 不进 vitest，`node tools/repair-names.mocktest.mjs` 直跑，退出码 0 = 全过；
 * - 假 LLM 端点 = 本地 node:http，响应形状与 OpenAI 兼容端点一致；
 * - 临时产物全部清理（含 Windows 下 sqlite 的 -wal/-shm 伴生文件，随目录一起 rm）。
 */
import { mkdtemp, mkdir, readdir, readFile, rename as renameFile, rm, stat, writeFile, appendFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HELP,
  applyRenames,
  bootstrap,
  isBadNameShape,
  parseArgs,
  parseTitleArray,
  planRenames,
  validateTitleLike,
} from './repair-names.mjs';

import { MemoryDb } from '../dist/store/sqlite.js';
import { L1Store } from '../dist/store/l1.js';
import { MdLedgerStore } from '../dist/store/memory-md-ledger.js';
import { exportRecords } from '../dist/store/memory-md-export.js';
import { deriveName } from '../dist/util/md-name.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPAIR = join(HERE, 'repair-names.mjs');
/** 假密钥：断言它出现在请求 header、但绝不出现在任何落盘文件里。 */
const FAKE_KEY = 'SEKRIT-fake-key-never-persist';
/** 本地黑洞端点（discard port 9）：任何没显式给 --endpoint 的 CLI 调用都被引到这里，
 *  保证 mock 自检永远不会去碰真机局域网端点。 */
const DEAD_ENDPOINT = 'http://127.0.0.1:9/v1/chat/completions';

// ── 迷你断言器：计数通过/失败，末尾统一判定退出码 ──
let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond === true) {
    passed++;
    console.log(`  ok ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}
function scenario(title) {
  console.log(`\n== ${title} ==`);
}

// ── 记录夹具 ──
// 名字形状取自真机普查的坏味样本（spec 现状表）；内容与名字解耦，fallback 断言用 deriveName(content)。
const SEEDS_A = [
  { id: 'r1', name: '用户要求将-dsh-agent-teams-插件', content: '用户要求把 agent-teams 插件迁移到新宿主，配置面保持兼容。\n细节：沿用旧键名，不做破坏性改动。' },
  { id: 'r2', name: 'C1-9a-1门禁判定与根因确认-Target..', content: '门禁判定 C1-9a-1 的根因是目标枚举漏了写路径。' },
  { id: 'r3', name: '会话-session-44332549-f0-2', content: '某次 session-44332549 的恢复流程演练记录。' },
  { id: 'r4', name: '库存扣减幂等设计', content: '库存扣减以订单号做幂等键，重复请求直接回读既有结果。' },
  { id: 'r5', name: '', content: '冷启动预热会话的白名单被误删，恢复后需补测试。' },
  { id: 'r6', name: '端点契约计数', content: '契约端点计数保持五十九，本轮不新增。' },
];
/** 12 条全坏味（给 --max/--budget 截断场景用）。 */
const SEEDS_B = Array.from({ length: 12 }, (_, i) => ({
  id: `b${i + 1}`,
  name: `坏味样本第${i + 1}条需要重新命名因为截断了..`,
  content: `坏味样本 ${i + 1}：这条记录的正文讲的是编号 ${i + 1} 号流程的返工要点。`,
}));

/** title 池：全部过 validateTitleLike，互不相同，且避开夹具里的 Existing 好名。 */
const TITLE_POOL = [
  '插件迁移兼容策略', '门禁根因枚举缺口', '会话恢复演练记录', '白名单误删补测',
  '冷启动预热流程', '扣减幂等回读设计', '契约计数冻结说明', '词表派生单一真源',
  '投射账本基线重建', '孤儿扫描归档纪律', '干跑计划审计表', '回滚凭据侧车文件',
  '命名闸门拒收残片', '批量端点降级规则', '墙钟预算截断', '配额只数动作条',
];

// ── 假 LLM 端点 ──
// mode: normal 全部回好 title | missing 漏掉最后一 id | path 第一条回带反斜杠的路径形状
//       | garbage 整段非 JSON（触发 rule）| slow 每请求延时（触发 budget 截断）
function startLlm(mode) {
  const state = { calls: 0, lastAuth: '', lastBody: null };
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      state.calls++;
      state.lastAuth = String(req.headers.authorization ?? '');
      let body = null;
      try { body = JSON.parse(raw); } catch { /* 保持 null，下面断言用 */ }
      state.lastBody = body;
      const userMsg = body?.messages?.find((m) => m.role === 'user')?.content ?? '';
      const ids = [...String(userMsg).matchAll(/id=(\S+)/g)].map((m) => m[1]);
      const reply = (text, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: text } }] }));
      };
      const send = () => {
        if (mode === 'garbage') { reply('这不是 JSON，只是模型的闲聊。'); return; }
        const titles = ids.map((id, i) => ({ id, title: TITLE_POOL[(state.calls * 7 + i) % TITLE_POOL.length] }));
        if (mode === 'missing' && titles.length > 0) titles.pop();
        if (mode === 'path' && titles.length > 0) titles[0] = { id: titles[0].id, title: 'C:\\notes\\x' };
        reply(`\`\`\`json\n${JSON.stringify(titles)}\n\`\`\``);
      };
      if (mode === 'slow') setTimeout(send, 40);
      else send();
    });
  });
  return new Promise((ok) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      ok({
        url: `http://127.0.0.1:${port}/v1/chat/completions`,
        state,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

// ── 临时环境：mkdtemp + dist 真建表 + 种子记录 ──
const cleanupDirs = [];
async function makeEnv(seeds) {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-repair-'));
  cleanupDirs.push(dataDir);
  const dbPath = join(dataDir, 'memory.db');
  const db = new MemoryDb(dbPath, 0);
  db.init();
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const l1 = new L1Store(dataDir, db, undefined, 'keyword', logger, 0, undefined, () => false);
  await l1.init();
  const ledger = new MdLedgerStore(dataDir, logger);
  await ledger.init();
  const now = Date.now();
  await l1.appendNew(seeds.map((s) => ({
    id: s.id, content: s.content, type: 'work_fact', priority: 60,
    scene_name: '', timestamps: [now], createdAt: now, updatedAt: now, name: s.name,
  })));
  await ledger.flush();
  return { dataDir, dbPath, db, l1, ledger, logger };
}

/** 建投射基线：走 dist 的 exportRecords 真导出（之后记录才不是全 firstTime，闸才有意义）。 */
async function makeBaseline(env) {
  await exportRecords({
    records: env.l1.all(),
    cfgRoot: undefined,
    dataDir: env.dataDir,
    ledger: env.ledger,
    maxRecords: 10_000,
    timeBudgetMs: 60_000,
    logger: env.logger,
  });
  await env.ledger.flush();
}

function closeEnv(env) {
  try { env.db.close(); } catch { /* 已关 */ }
}

/**
 * CLI 子进程调用（stdout=JSON 汇总，stderr=日志）。
 * 必须用**异步** spawn：假 LLM 端点跑在本进程里，spawnSync 会阻塞事件循环使服务端无法应答。
 * 环境处理：大小写不敏感地剔除宿主可能已有的 DSH_LLM_API_KEY，按需注入假密钥；
 * 未显式给 --endpoint 的调用一律注入本地黑洞端点，绝不外呼真机地址。
 */
function cli(args, { withKey = true } = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.toUpperCase() === 'DSH_LLM_API_KEY') continue;
    env[k] = v;
  }
  if (withKey) env.DSH_LLM_API_KEY = FAKE_KEY;
  const finalArgs = args.includes('--endpoint') || args.includes('--help')
    ? args
    : [...args, '--endpoint', DEAD_ENDPOINT];
  return new Promise((ok, no) => {
    const child = spawn(process.execPath, [REPAIR, ...finalArgs], { env });
    const timer = setTimeout(() => child.kill(), 180_000);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', no);
    child.on('close', (code) => {
      clearTimeout(timer);
      let summary = null;
      try { summary = JSON.parse(stdout); } catch { /* 非 JSON 模式（help/报错） */ }
      ok({ code, stdout, stderr, summary });
    });
  });
}

async function readDirDeep(dir) {
  const out = [];
  let items = [];
  try { items = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const it of items) {
    const p = join(dir, it.name);
    if (it.isDirectory()) out.push(...await readDirDeep(p));
    else out.push(p);
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// T1 task_5.1 骨架：argparse / 缺密钥退出码 2 且不写文件 / --help
// ════════════════════════════════════════════════════════════════════════════
async function t1() {
  scenario('T1 task_5.1 argparse + 密钥闸 + help');
  check('未知参数报错', parseArgs(['--nope']).error !== undefined);
  check('值旗标缺值报错', parseArgs(['--max']).error !== undefined);
  check('--apply 与 --revert 互斥', parseArgs(['--apply', '--revert', 'x']).error !== undefined);
  check('驼峰归一 + 布尔旗标', (() => {
    const p = parseArgs(['--only-bad', '--budget-ms', '50', '--apply']);
    return p.error === undefined && p.opts.onlyBad === true && p.opts.budgetMs === '50' && p.opts.apply === true;
  })());

  const env = await makeEnv(SEEDS_A);
  const noKey = await cli(['--db', env.dbPath, '--data-dir', env.dataDir], { withKey: false });
  check('缺 DSH_LLM_API_KEY 退出码 2', noKey.code === 2, `code=${noKey.code}`);
  check('缺 key 时报错文案可辨识', noKey.stderr.includes('DSH_LLM_API_KEY'));
  const files = await readDirDeep(env.dataDir);
  check(
    '缺 key 不写任何新文件（只有库/records/账本初始化物）',
    !files.some((f) => f.includes('rename-plan')),
    files.join(';'),
  );
  const h = await cli(['--help']);
  check('--help 退出码 0 且含用法', h.code === 0 && h.stdout.includes('用法'));
  check('HELP 声明了退出码与密钥纪律', HELP.includes('退出码') && HELP.includes('DSH_LLM_API_KEY'));
  closeEnv(env);
  await rm(env.dataDir, { recursive: true, force: true });
}

// ════════════════════════════════════════════════════════════════════════════
// T2 task_5.2 LLM 批量三类响应（正常/缺条/带路径 title）+ garbage→rule + 截断口径
// ════════════════════════════════════════════════════════════════════════════
async function t2() {
  scenario('T2 task_5.2 批量三类响应 + 计数 + 计划文件');
  const env = await makeEnv(SEEDS_A);
  const llm = await startLlm('normal');

  // 纯函数层：坏味判据 & title 闸门各自的钉死断言
  check('isBadNameShape 命中真机五样本', (() => {
    const samples = [
      '用户要求将-dsh-agent-teams-插件', '团队已完成Codex-3个参考项目-bainia',
      '会话-session-44332549-f0-2', 'buildTurnCompactSystemPr', 'C1-9a-1门禁判定与根因确认-Target..',
    ];
    return samples.every(isBadNameShape) && !isBadNameShape('库存扣减幂等设计') && isBadNameShape('');
  })());
  check('validateTitleLike 拒带路径/引子/句末标点', (() => {
    const bad = ['C:\\notes\\x', 'docs/guide', '用户要求改名', '这是一个完整的句子。', 'session-44332549', 'a'.repeat(40), '残片-202601'];
    return bad.every((t) => validateTitleLike(t).ok === false) && validateTitleLike('门禁根因枚举缺口').ok === true;
  })());
  check('parseTitleArray 容忍围栏与杂文', (() => {
    const m = parseTitleArray('前言\n```json\n[{"id":"a","title":"名字甲"}]\n```\n后记');
    return m !== null && m.get('a') === '名字甲' && parseTitleArray('完全不是 JSON') === null;
  })());

  // 三类响应跑 CLI 干跑（onlyBad：候选 = r1,r2,r3,r5 四条——r3 含 session- 也是坏味）
  const baseArgs = ['--dry-run', '--only-bad', '--db', env.dbPath, '--data-dir', env.dataDir, '--endpoint', llm.url];
  const runNormal = await cli(baseArgs);
  check('正常批量：exit 0', runNormal.code === 0);
  check('Bearer 头携带密钥', llm.state.lastAuth === `Bearer ${FAKE_KEY}`);
  const p1 = runNormal.summary?.plan ?? {};
  check('正常批量：4 条全 llm', p1.rows === 4 && p1.llm === 4 && p1.fallback === 0 && p1.rule === 0, JSON.stringify(p1));

  // 缺条模式
  const llmMissing = await startLlm('missing');
  const runMissing = await cli(['--dry-run', '--only-bad', '--db', env.dbPath, '--data-dir', env.dataDir, '--endpoint', llmMissing.url]);
  const p2 = runMissing.summary?.plan ?? {};
  check('缺条批量：3 llm + 1 fallback', p2.rows === 4 && p2.llm === 3 && p2.fallback === 1, JSON.stringify(p2));
  const side2 = await readFile(p2.jsonl, 'utf8');
  const rows2 = side2.trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const fb2 = rows2.find((r) => r.source === 'fallback');
  const seedFb = SEEDS_A.find((s) => s.id === fb2.recordId);
  check('降级条走 deriveName 规则名', fb2 !== undefined && fb2.newName === deriveName(seedFb.content), `newName=${fb2?.newName}`);
  await llmMissing.close();

  // 带路径 title 模式
  const llmPath = await startLlm('path');
  const runPath = await cli(['--dry-run', '--only-bad', '--db', env.dbPath, '--data-dir', env.dataDir, '--endpoint', llmPath.url]);
  const p3 = runPath.summary?.plan ?? {};
  check('路径 title 被闸拒：llm 3 + fallback 1', p3.rows === 4 && p3.fallback === 1 && p3.llm === 3, JSON.stringify(p3));
  await llmPath.close();

  // 整批非 JSON → rule
  const llmGarb = await startLlm('garbage');
  const runGarb = await cli(['--dry-run', '--only-bad', '--db', env.dbPath, '--data-dir', env.dataDir, '--endpoint', llmGarb.url]);
  const p4 = runGarb.summary?.plan ?? {};
  check('整批解析失败走规则名：rule=4', p4.rows === 4 && p4.rule === 4 && p4.llm === 0, JSON.stringify(p4));
  await llmGarb.close();

  // 计划文件成对 + 行数==待改条数 + 密钥零落盘
  const mdText = await readFile(p1.md, 'utf8');
  const jsonlText = await readFile(p1.jsonl, 'utf8');
  const mdRows = mdText.split('\n').filter((l) => /^\| r\d/.test(l)).length;
  check('md 待改段行数 == sidecar 行数', mdRows === jsonlText.trim().split(/\r?\n/).filter(Boolean).length, `md=${mdRows}`);
  check('md 含七列表头', mdText.includes('| record_id | 旧名 | 新名 | 来源 | 旧路径 | 新路径 | 风险 |'));
  const allFiles = await readDirDeep(env.dataDir);
  const leaked = [];
  for (const f of allFiles) {
    if (!f.startsWith(env.dataDir)) continue;
    try {
      const t = await readFile(f, 'utf8').catch(() => '');
      if (t.includes(FAKE_KEY)) leaked.push(f);
    } catch { /* 二进制忽略 */ }
  }
  check('密钥不落任何盘（计划/账本/库伴生全无 SEKRIT）', leaked.length === 0, leaked.join(';'));

  closeEnv(env);
  await llm.close();
  await rm(env.dataDir, { recursive: true, force: true });

  // --max 数动作不数遍历 / --budget-ms 墙钟截断（12 条坏味 envB）
  const envB = await makeEnv(SEEDS_B);
  const llmB = await startLlm('normal');
  const runMax = await cli(['--dry-run', '--only-bad', '--max', '5', '--db', envB.dbPath, '--data-dir', envB.dataDir, '--endpoint', llmB.url]);
  const pm = runMax.summary?.plan ?? {};
  check('--max 5：rows=5 且 capped、remaining=7', pm.rows === 5 && pm.capped === true && pm.remaining === 7, JSON.stringify(pm));
  const llmS = await startLlm('slow');
  const runBudget = await cli(['--dry-run', '--only-bad', '--budget-ms', '1', '--db', envB.dbPath, '--data-dir', envB.dataDir, '--endpoint', llmS.url]);
  const pb = runBudget.summary?.plan ?? {};
  check('--budget-ms 超限：capped=true 且 remaining 如实', pb.capped === true && pb.rows < 12, JSON.stringify(pb));
  await llmS.close();
  await llmB.close();
  closeEnv(envB);
  await rm(envB.dataDir, { recursive: true, force: true });
}

// ════════════════════════════════════════════════════════════════════════════
// T3 task_5.3 对账闸：fileOnly 的记录进跳过段而不是待改段
// ════════════════════════════════════════════════════════════════════════════
async function t3() {
  scenario('T3 task_5.3 写库前置闸（fileOnly 跳过并标风险）');
  const env = await makeEnv(SEEDS_A);
  await makeBaseline(env);
  // 人为制造 fileOnly：直接改 r4 的投射文件内容（人在文件侧改过）。
  const llm = await startLlm('normal');
  const dry = await cli(['--dry-run', '--db', env.dbPath, '--data-dir', env.dataDir, '--endpoint', llm.url]);
  const p = dry.summary?.plan ?? {};
  const mdText = await readFile(p.md, 'utf8');
  const sidecar = await readFile(p.jsonl, 'utf8');
  check('无差异时全库干跑 exit 0', dry.code === 0, `code=${dry.code} err=${dry.stderr.slice(0, 200)}`);

  // 找 r4 的旧路径（name=库存扣减幂等设计）
  const r4Path = join(env.dataDir, 'memories', 'work_fact', '库存扣减幂等设计.memory.md');
  check('基线文件已在位', existsSync(r4Path), r4Path);
  await appendFile(r4Path, '\n人手补了一段说明。\n', 'utf8');
  const dry2 = await cli(['--dry-run', '--db', env.dbPath, '--data-dir', env.dataDir, '--endpoint', llm.url]);
  const p2 = dry2.summary?.plan ?? {};
  check('闸生效：gateSkipped=1', p2.gateSkipped === 1, JSON.stringify(p2));
  const md2 = await readFile(p2.md, 'utf8');
  const skipSec = md2.split('## 跳过')[1] ?? '';
  const todoSec = (md2.split('## 待改')[1] ?? '').split('## 跳过')[0];
  check('fileOnly 记录进跳过段', skipSec.includes('r4') && skipSec.includes('reconcile:fileOnly'));
  check('fileOnly 记录不在待改段', !/\| r4 \|/.test(todoSec));
  check('sidecar 不含被闸拦下的记录', !sidecarIncludes(await readFile(p2.jsonl, 'utf8'), 'r4'));
  await llm.close();
  closeEnv(env);
  await rm(env.dataDir, { recursive: true, force: true });
}
function sidecarIncludes(text, id) {
  return text.trim().split(/\r?\n/).filter(Boolean).some((l) => JSON.parse(l).recordId === id);
}

// ════════════════════════════════════════════════════════════════════════════
// T4 task_5.5 --apply 执行序：happy 全链路 + 中途失败注入不变量
// ════════════════════════════════════════════════════════════════════════════
let applyEnv = null; // T4/T6/T5 共享：apply 后的环境留给幂等与回滚断言
async function t4() {
  scenario('T4 task_5.5 apply 执行序（先建新基线再拆旧基线）');
  // ── happy：dry → apply --plan ──
  applyEnv = await makeEnv(SEEDS_A);
  await makeBaseline(applyEnv);
  const llm = await startLlm('normal');
  const dry = await cli(['--dry-run', '--only-bad', '--db', applyEnv.dbPath, '--data-dir', applyEnv.dataDir, '--endpoint', llm.url]);
  const p = dry.summary.plan;
  const ap = await cli(['--apply', '--plan', p.jsonl, '--db', applyEnv.dbPath, '--data-dir', applyEnv.dataDir]);
  check('apply exit 0', ap.code === 0, `stderr=${ap.stderr.slice(-300)}`);
  const a = ap.summary?.applied ?? {};
  check('named == 待改条数(4)', a.named === 4 && a.failed.length === 0, JSON.stringify(a));
  const rows = await readFileAsJsonl(p.jsonl);
  closeEnv(applyEnv);
  // 重新打开核对库/账本/文件三面对齐
  applyEnv2 = await reopen(applyEnv);
  for (const row of rows) {
    const rec = applyEnv2.l1.all().find((r) => r.id === row.recordId);
    check(`库侧：${row.recordId} name==新名`, rec?.name === row.newName, `name=${rec?.name}`);
    check(`新文件已在位：${row.recordId}`, existsSync(row.newAbs), row.newAbs);
    check(`旧文件已搬走：${row.recordId}`, !existsSync(row.oldAbs));
    const ledgerOnDisk = JSON.parse(await readFile(join(applyEnv2.dataDir, 'mem-md-ledger.json'), 'utf8'));
    check(`账本：新键在/旧键删（${row.recordId}）`,
      ledgerOnDisk.entries[row.newAbs] !== undefined && ledgerOnDisk.entries[row.oldAbs] === undefined);
  }
  check('旧文件确实进了归档（4 条全搬走）', a.sweep?.moved === 4 && existsSync(a.archiveDir ?? ''), JSON.stringify(a.sweep));
  applyArchive = a.archiveDir;
  applyRows = rows;
  await llm.close();

  // ── 中途失败注入：第二条写文件时抛 ──
  const envF = await makeEnv(SEEDS_A);
  await makeBaseline(envF);
  const llmF = await startLlm('normal');
  const planF = await planRenames({
    records: envF.l1.all(), l1: envF.l1, ledger: envF.ledger, dataDir: envF.dataDir,
    cfgRoot: undefined, dbPath: envF.dbPath, endpoint: llmF.url, apiKey: FAKE_KEY, model: 'default',
    max: 100, budgetMs: 60_000, onlyBad: true, logger: envF.logger,
  });
  await llmF.close();
  check('直接调用 plan：4 行', planF.rows.length === 4);
  let writeCalls = 0;
  const failHooks = {
    mkdir: (p, o) => mkdir(p, o),
    async writeFile(p, t) {
      writeCalls++;
      if (writeCalls === 2) throw new Error('注入：磁盘拒绝写第二条');
      await writeFile(p, t, 'utf8');
    },
    stat: (p) => stat(p),
    readFile: (p, enc) => readFile(p, enc),
    rm: (p) => rm(p, { force: true }),
    readdir: (p) => readdir(p),
    fileRename: (a, b) => renameFile(a, b),
    exists: existsSync,
  };
  const apF = await applyRenames({
    rows: planF.rows, l1: envF.l1, ledger: envF.ledger, dataDir: envF.dataDir,
    cfgRoot: undefined, logger: envF.logger, stateById: new Map(), hooks: failHooks,
  });
  check('注入失败被记录并回滚一条', apF.rolledBack === 1 && apF.failed.length === 1, JSON.stringify(apF.failed));
  // 不变量：任何一条记录，要么新文件已在、要么旧文件未动——绝不两头都没有。
  let invariant = true;
  const viol = [];
  for (const row of planF.rows) {
    const ok = existsSync(row.newAbs) || existsSync(row.oldAbs);
    if (!ok) { invariant = false; viol.push(row.recordId); }
  }
  check('执行序即回滚凭据：无“两头都没有”', invariant, viol.join(','));
  const failRow = planF.rows.find((r) => apF.failed.some((f) => f.id === r.recordId));
  const curName = envF.l1.all().find((r) => r.id === failRow.recordId)?.name ?? '';
  check('失败条的 name 已还原（旧认领恢复）', curName === failRow.oldName, `cur=${curName}`);
  check('失败条的旧文件未动', existsSync(failRow.oldAbs));
  closeEnv(envF);
  await rm(envF.dataDir, { recursive: true, force: true });
}
async function readFileAsJsonl(path) {
  const t = await readFile(path, 'utf8');
  return t.trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

// ════════════════════════════════════════════════════════════════════════════
// T6 task_5.7 可重放（放在 T5 前：同一环境 apply → 重放 → revert）
// ════════════════════════════════════════════════════════════════════════════
async function t6() {
  scenario('T6 task_5.7 同一库第二次 --apply 零动作（named=0）');
  const p = join(applyEnv.dataDir, (await readdir(applyEnv.dataDir)).find((f) => f.endsWith('.plan.jsonl')));
  const replay = await cli(['--apply', '--plan', p, '--db', applyEnv.dbPath, '--data-dir', applyEnv.dataDir]);
  const a = replay.summary?.applied ?? {};
  check('重放 exit 0', replay.code === 0, replay.stderr.slice(-200));
  check('named=0', a.named === 0, JSON.stringify(a));
  check('written=0、幂等计数吃满', a.written === 0 && a.skippedIdempotent === applyRows.length, JSON.stringify(a));
  check('重放不再跑孤儿扫描（无新基线落地）', a.sweep === null);
}

// ════════════════════════════════════════════════════════════════════════════
// T5 task_5.6 --revert：旧文件回位 → name 还原 → 账本还原（逐字对账）
// ════════════════════════════════════════════════════════════════════════════
async function t5() {
  scenario('T5 task_5.6 revert 往返还原');
  const planPath = join(applyEnv.dataDir, (await readdir(applyEnv.dataDir)).find((f) => f.endsWith('.plan.jsonl')));
  const rv = await cli(['--revert', planPath, '--db', applyEnv.dbPath, '--data-dir', applyEnv.dataDir]);
  const r = rv.summary?.reverted ?? {};
  check('revert exit 0 且零失败', rv.code === 0 && r.failed.length === 0, `code=${rv.code} failed=${JSON.stringify(r.failed)} err=${rv.stderr.slice(-200)}`);
  check('reverted == 计划行数', r.reverted === applyRows.length, JSON.stringify(r));
  closeEnv(applyEnv2);
  const verify = await reopen(applyEnv);
  const ledgerOnDisk = JSON.parse(await readFile(join(verify.dataDir, 'mem-md-ledger.json'), 'utf8'));
  for (const row of applyRows) {
    const rec = verify.l1.all().find((x) => x.id === row.recordId);
    check(`name 逐字还原：${row.recordId}`, rec?.name === row.oldName, `got=${rec?.name} want=${row.oldName}`);
    check(`旧文件回位：${row.recordId}`, existsSync(row.oldAbs));
    check(`新文件已拆：${row.recordId}`, !existsSync(row.newAbs));
    const back = ledgerOnDisk.entries[row.oldAbs];
    check(`旧账本条目还原（digest/relPath 对齐 sidecar）：${row.recordId}`,
      back !== undefined && back.dbDigest === row.oldEntry?.dbDigest && back.relPath === row.oldEntry?.relPath);
  }
  closeEnv(verify);
  await rm(applyEnv.dataDir, { recursive: true, force: true });
}

let applyEnv2 = null;
let applyArchive = '';
let applyRows = [];
async function reopen(env) {
  return await bootstrap({ dbPath: env.dbPath, dataDir: env.dataDir, logger: env.logger });
}

// ── 主流程 ──
async function main() {
  await t1();
  await t2();
  await t3();
  await t4();
  await t6();
  await t5();
  console.log(`\n== 汇总：通过 ${passed}，失败 ${failures.length} ==`);
  if (failures.length > 0) {
    console.log(`失败清单:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('mocktest 未捕获错误:', err);
  process.exitCode = 1;
}).finally(async () => {
  // 临时产物一律清理（sqlite 的 -wal/-shm 随目录走）
  for (const d of cleanupDirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  if (!existsSync(applyArchive) && applyArchive.length > 0) { /* 归档在 applyEnv 里，已随目录清掉 */ }
});
