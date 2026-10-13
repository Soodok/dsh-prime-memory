#!/usr/bin/env node
/**
 * 蒸馏路径的 few-shot A/B：**结构保持**到底是不是示例换来的。
 *
 * 为什么不能用 `ab-naming.mjs` 的数回答这个问题：那条量的是"给定正文只要 title"的
 * 命名任务。生产里 `title` 是**追加到抽取提示**上的第 7 个字段，而抽取提示本身已经在要求
 * `content/type/priority/applicability/metadata/source_message_ids` 一整套情境数组形状。
 * 两个任务的遵从难度不是一个量级，拿命名任务上的 99.4% 去推断抽取路径就是越界引用。
 *
 * 判据按用户定的可用性来：**content 没前因后果、写不全就不算可用**，所以主指标是
 * `骨架齐备率`（要素表来自 `prompts/examples.ts::SKELETON_ELEMENTS`，与止例同源），
 * 副指标才是 title 出现率/合格率。
 *
 * 输入是 `l0_conversations` 里的**真会话窗口**（只读）。两臂吃完全相同的窗口与温度，
 * 唯一差异是系统提示里那段示例。
 *
 * 用法：node tools/ab-distill.mjs [--sessions 8] [--window 12] [--model omnicoder-9b]
 */
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { formatExtractionPrompt, getExtractMemoriesSystemPrompt } from '../dist/prompts/l1-extraction.js';
import { scoreSkeleton } from '../dist/prompts/examples.js';
import { acceptTitle, validateTitle } from '../dist/util/md-name.js';
import { DEFAULT_ENDPOINT, callLlm } from './repair-names.mjs';

const args = process.argv.slice(2);
function flag(name, dflt) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`--${name} 需要值`);
  return v;
}
const SESSIONS = Math.max(2, Number(flag('sessions', 8)));
const WINDOW = Math.max(4, Number(flag('window', 12)));
const MODEL = flag('model', 'omnicoder-9b');
const ENDPOINT = flag('endpoint', DEFAULT_ENDPOINT);
const MAX_TOKENS = Number(flag('max-tokens', 3000));
const DB = resolve(flag('db', join(homedir(), '.dsh', 'memory', 'memory.db')));
const apiKey = (process.env.DSH_LLM_API_KEY ?? '').trim();
// 生产里 halls 非空（会追加 Wing 标签段）。这里传空表是**刻意的控制变量**：
// 两臂都不带它，差值才只归因于示例段；代价是绝对值会比生产略高（少一项输出要求）。
const HALLS = [];

// ── 取真会话窗口：按 session_id 排序取前 N 个足够长、且正文够实的会话 ──
const db = new DatabaseSync(DB, { readOnly: true, allowExtension: false });
const sessions = db
  .prepare(
    `SELECT session_id AS s FROM l0_conversations
      GROUP BY s HAVING COUNT(*) >= ? AND SUM(CASE WHEN length(message_text) > 40 THEN 1 ELSE 0 END) >= ?
      ORDER BY s LIMIT ?`,
  )
  .all(WINDOW + 2, Math.max(3, Math.floor(WINDOW / 3)), SESSIONS)
  .map((r) => r.s);
const getMsgs = db.prepare(
  'SELECT record_id AS id, role, message_text AS text, timestamp FROM l0_conversations WHERE session_id = ? ORDER BY timestamp, record_id',
);
if (sessions.length === 0) { db.close(); throw new Error('没找到够长的真会话，检查 --db 或放宽 --window'); }

// 窗口必须在**关库之前**取完：`getMsgs` 是绑在这个连接上的语句，先 close 再用就是
// "statement has been finalized"（本轮第一跑就撞在这里）。
const windows = sessions.map((s) => {
  /** @type {Array<{id:string;role:string;content:string;timestamp:number}>} */
  const all = getMsgs
    .all(s)
    .map((m) => ({ id: m.id, role: m.role, content: String(m.text ?? ''), timestamp: Number(m.timestamp) }))
    .filter((m) => m.content.trim().length > 0);
  // 取第一个"够实"的窗口：跳过"你是谁/你好"这类无信息量的开头。
  const start = Math.max(0, all.findIndex((m) => m.content.length > 40) - 1);
  return { session: s, msgs: all.slice(start, start + WINDOW) };
});
db.close();
if (windows.some((w) => w.msgs.length === 0)) {
  throw new Error(`有会话取不到消息（窗口 ${WINDOW} 太窄）：${windows.filter((w) => w.msgs.length === 0).map((w) => w.session).join(', ')}`);
}

/** 解析抽取输出（可能是 ```json 围栏 + 情境数组）。失败返回 null，由调用方记"零产出"。 */
function parseScenes(text) {
  const s = String(text ?? '').replace(/```(?:json)?/gi, '');
  const from = s.indexOf('[');
  const to = s.lastIndexOf(']');
  if (from < 0 || to <= from) return null;
  try {
    const arr = JSON.parse(s.slice(from, to + 1));
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

async function arm(withShot) {
  const system = getExtractMemoriesSystemPrompt('auto', { narrative: true, title: true, fewShot: withShot });
  const st = {
    会话: 0, 解析失败: 0, 记忆条数: 0, 骨架齐备: 0, title出现: 0, title合格: 0,
    正文总长: 0, 缺要素: {}, 样本: [],
  };
  for (const w of windows) {
    st.会话++;
    const user = formatExtractionPrompt({ newMessages: w.msgs, backgroundMessages: [], previousSceneName: '无', halls: HALLS });
    let text;
    try {
      text = await callLlm(ENDPOINT, apiKey, MODEL, { system, user }, undefined, 180_000, MAX_TOKENS);
    } catch (err) {
      st.解析失败++;
      if (st.样本.length < 3) st.样本.push(`调用失败 ${w.session.slice(0, 18)}: ${(err instanceof Error ? err.message : String(err)).slice(0, 120)}`);
      continue;
    }
    const scenes = parseScenes(text);
    if (scenes === null) {
      st.解析失败++;
      if (st.样本.length < 3) st.样本.push(`输出解析失败 ${w.session.slice(0, 18)}: 前 120 字 ${text.slice(0, 120)}`);
      continue;
    }
    for (const sc of scenes) {
      for (const m of Array.isArray(sc?.memories) ? sc.memories : []) {
        const content = typeof m?.content === 'string' ? m.content : '';
        if (content.trim().length === 0) continue;
        st.记忆条数++;
        const type = typeof m?.type === 'string' ? m.type : '';
        const sk = scoreSkeleton(type, content);
        if (sk.齐备) st.骨架齐备++;
        for (const miss of sk.缺) st.缺要素[miss] = (st.缺要素[miss] ?? 0) + 1;
        if (typeof m?.title === 'string' && m.title.trim().length > 0) {
          st.title出现++;
          if (acceptTitle(m.title) !== undefined) st.title合格++;
          else if (st.样本.length < 3) st.样本.push(`title 不合格: ${m.title.slice(0, 60)}（${validateTitle(m.title).reason}）`);
        }
        st.正文总长 += content.length;
      }
    }
  }
  const n = st.记忆条数;
  return {
    会话: st.会话,
    产出会话数: st.会话 - st.解析失败,
    记忆条数: n,
    骨架齐备率: n === 0 ? 0 : +(st.骨架齐备 / n).toFixed(3),
    title出现率: n === 0 ? 0 : +(st.title出现 / n).toFixed(3),
    title合格率: st.title出现 === 0 ? 0 : +(st.title合格 / st.title出现).toFixed(3),
    平均正文长度: n === 0 ? 0 : Math.round(st.正文总长 / n),
    缺要素分布: st.缺要素,
    解析失败: st.解析失败,
    样本: st.样本,
    本臂零产出: n === 0,
  };
}

const off = await arm(false);
const on = await arm(true);
const 骨架差 = +(on.骨架齐备率 - off.骨架齐备率).toFixed(3);
const KEEP = 0.05;
if (off.本臂零产出 || on.本臂零产出) {
  console.log(JSON.stringify({ 臂A_无示例: off, 臂B_有示例: on, 判定: '至少一臂零产出 → 本次不给结论（不是"示例没用"，是这一臂没跑通）' }, null, 1));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    臂A_无示例: off,
    臂B_有示例: on,
    骨架齐备率差: 骨架差,
    判定: 骨架差 >= KEEP
      ? `示例使骨架齐备率 +${骨架差}（≥${KEEP}）→ fewShot 有结构性收益，可默认开`
      : `示例使骨架齐备率 +${骨架差}（<${KEEP}）→ 结构保持不靠示例；fewShot 保持默认关`,
    口径: '输入=l0_conversations 真会话窗口；halls 传空（控制变量，两臂一致）；骨架打分是关键词启发式，只用于两臂相对比较',
  }, null, 1));
}
