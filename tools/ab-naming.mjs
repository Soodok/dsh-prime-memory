#!/usr/bin/env node
/**
 * pm-name-distill task_3.9：few-shot 值不值得默认开的 A/B。
 *
 * 为什么需要它而不是"看着示例更专业就开"：示例是**每轮蒸馏都要付的固定成本**
 * （约 1.2–1.4k 字提示），而 `cfg.naming.fewShot` 关掉时没人会想念它。默认值该由
 * fallback 率的差决定，不该由审美决定。
 *
 * 口径（诚实声明，别把这张表读成它没测的东西）：
 * - 测的是**"同一批真机记录，有/无示例时模型给的 title 合格率"**，用批量命名那条
 *   prompt（与存量改名脚本同源同形状）。它**不等于**"整条蒸馏管线开示例后的产物质量"
 *   ——那要跑真会话抽取，成本与噪声都高一个量级，且混入 content 质量这个无关变量。
 * - 输入只读：只 SELECT，绝不写库、不碰投射文件与账本。
 * - 两臂喂**同一批**记录、同一 temperature，只有系统提示差一个示例段。
 *
 * 用法：node tools/ab-naming.mjs [--n 40] [--batch 10] [--concurrency 3] [--model omnicoder-9b]
 * 密钥只从 `DSH_LLM_API_KEY` 读（局域网 llama.cpp 不吃鉴权，缺省也能跑）。
 */
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { EXTRACTION_FEW_SHOT } from '../dist/prompts/examples.js';
import { acceptTitle, validateTitle } from '../dist/util/md-name.js';
import { DEFAULT_ENDPOINT, buildBatchMessages, callLlm, parseTitleArray } from './repair-names.mjs';

const args = process.argv.slice(2);
/** 取旗标值（缺失给默认）；未知旗标直接拒绝，不静默忽略。 */
function flag(name, dflt) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`--${name} 需要值`);
  return v;
}
for (const a of args) {
  if (a.startsWith('--') && !['--n', '--batch', '--concurrency', '--model', '--db', '--endpoint'].includes(a)) {
    throw new Error(`未知旗标 ${a}（支持 --n/--batch/--concurrency/--model/--db/--endpoint）`);
  }
}

const N = Math.max(4, Number(flag('n', 40)));
const BATCH = Math.max(2, Number(flag('batch', 10)));
const CONC = Math.min(4, Math.max(1, Number(flag('concurrency', 3))));
const MODEL = flag('model', 'omnicoder-9b');
const ENDPOINT = flag('endpoint', DEFAULT_ENDPOINT);
const DB = resolve(flag('db', join(homedir(), '.dsh', 'memory', 'memory.db')));
const EXCERPT = 240;
const apiKey = (process.env.DSH_LLM_API_KEY ?? '').trim();

// ── 只读取样：按 record_id 排序取前 N 条，两次跑取到同一批（否则 A/B 不可比）──
const db = new DatabaseSync(DB, { readOnly: true, allowExtension: false });
const rows = db
  .prepare('SELECT record_id AS id, type, name, content FROM l1_records ORDER BY record_id LIMIT ?')
  .all(N);
db.close();
if (rows.length < 4) throw new Error(`样本太少（${rows.length} 条），--n 给大一点或检查 --db`);
const items = rows.map((r) => ({ id: r.id, excerpt: (r.content ?? '').slice(0, EXCERPT) }));
const chunks = [];
for (let i = 0; i < items.length; i += BATCH) chunks.push(items.slice(i, i + BATCH));

/**
 * 一臂的基准提示。
 *
 * 为什么不用抽取提示做基座（第一版试了）：那份提示自带“输出情境数组”的硬要求，
 * 模型就照 `scene_name`/`message_ids` 回，补一句“本轮只给 title”压不过它——两臂会一起
 * 零合格，拿到的不是“示例有没有用”而是“工具自己坏了”。所以基座用已跑通的**命名提示**
 * （与存量改名脚本同源同形状），示例段才是唯一变量。
 */
const BASE_SYSTEM = buildBatchMessages(chunks[0]).system;

async function arm(withShot) {
  // 基准串本身就**不含**示例段（fewShot 不传），所以两臂的差异恰好只有一个示例段——
  // 不会把"删掉示例段"这种反操作当成控制变量。
  const finalSystem = withShot ? `${BASE_SYSTEM}
${EXTRACTION_FEW_SHOT}` : BASE_SYSTEM;
  const out = { ok: 0, reject: {}, lengths: [], errors: 0, batches: 0, errSample: [] };
  let cursor = 0;
  const worker = async () => {
    while (cursor < chunks.length) {
      const idx = cursor++;
      const { user } = buildBatchMessages(chunks[idx]);
      out.batches++;
      let text;
      try {
        text = await callLlm(ENDPOINT, apiKey, MODEL, { system: finalSystem, user }, undefined, 90_000);
      } catch (err) {
        out.errors++;
        // 不能只计数：两臂都“合格率 0”时，没原因就会被误读成“示例没用”。
        // 实际完全可能是端点报错/上下文超限，那是工具环了而不是假设被证伪。
        const msg = err instanceof Error ? err.message : String(err);
        if (out.errSample.length < 2) out.errSample.push(`批次${idx + 1}: ${msg.slice(0, 200)}`);
        continue;
      }
      const map = parseTitleArray(text);
      if (map === null) {
        out.errors++;
        if (out.errSample.length < 2) out.errSample.push(`批次${idx + 1}: 响应不是可解析 JSON 数组，前 160 字：${text.slice(0, 160)}`);
        continue;
      }
      for (const c of chunks[idx]) {
        const raw = map.get(c.id);
        if (raw === undefined) { out.reject['missing-item'] = (out.reject['missing-item'] ?? 0) + 1; continue; }
        const acc = acceptTitle(raw);
        if (acc === undefined) {
          const reason = validateTitle(String(raw)).reason ?? 'unknown';
          out.reject[reason] = (out.reject[reason] ?? 0) + 1;
          continue;
        }
        out.ok++;
        out.lengths.push(acc.length);
      }
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  const asked = items.length;
  const rejected = Object.values(out.reject).reduce((a, b) => a + b, 0);
  const avg = out.lengths.length === 0 ? 0 : out.lengths.reduce((a, b) => a + b, 0) / out.lengths.length;
  return {
    样本: asked,
    批次: out.batches,
    合格: out.ok,
    合格率: +(out.ok / asked).toFixed(3),
    拒因: out.reject,
    被拒条数: rejected,
    平均落名长度: +avg.toFixed(1),
    整批失败: out.errors,
    失败原因样本: out.errSample,
    本臂完全跑不通: out.ok === 0,
  };
}

const off = await arm(false);
const on = await arm(true);
// 两臂任何一臂一条都没跑通时，**不得报合格率差与判定**：那会把“工具环了”当成
// “示例没提升”这个结论写进计划。本脚本宁可拒答也不给假结论。
if (off.本臂完全跑不通 || on.本臂完全跑不通) {
  console.log(JSON.stringify({
    臂A_无示例: off,
    臂B_有示例: on,
    判定: '本次不可结论：至少一臂零合格（看失败原因样本）。合格率差与默认值结论**不给**。',
  }, null, 1));
  process.exitCode = 1;
} else {
  const delta = +(on.合格率 - off.合格率).toFixed(3);
  // 判定门槛写死在输出里：低于这个提升就不值得每轮多付 1.2k 字提示。
  const KEEP_THRESHOLD = 0.05;
  console.log(JSON.stringify({
    臂A_无示例: off,
    臂B_有示例: on,
    合格率差: delta,
    判定: delta >= KEEP_THRESHOLD
      ? `示例使合格率 +${delta}，达到 ≥${KEEP_THRESHOLD} 门槛 → fewShot 可默认开`
      : `示例使合格率 +${delta}（门槛 ${KEEP_THRESHOLD}）→ fewShot 保持默认关；示例每轮白付 1.2-1.4k 字`,
    口径说明: '测的是"同一批真机记录有/无示例时 title 合格率"，不等于整条蒸馏管线开示例后的产物质量',
  }, null, 1));
}
