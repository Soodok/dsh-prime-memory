#!/usr/bin/env node
/**
 * L0 水位基线物化 CLI(T8.4 写停前置,task_16;drs-anchor-backfill 同款形状)。
 *
 * 把现存 l0_conversations 里每会话的最大 turn 一次性灌进 l0_watermark 小表——
 * 写停生效(capture 不再写正文三表)后,§A 恢复幂等判据只认水位表;没有基线,
 * 升级后的首次 resume 会把水位当空、重放旧 turn 重复蒸馏。
 * 插件启动链也会幂等补跑同一物化(MemoryDb.initSchema → ensureBaseline),
 * 本脚本是**显式前置/对账**入口:想在换装前离线灌好、或事后核对时用。
 *
 * 用法:node scripts/l0-watermark-baseline.mjs [--memory <memory.db>] [--apply]
 *   缺省 memory = $DSH_HOME/memory/memory.db(dshHomePath('memory') 同口径)
 *   缺省 dry-run:只读报告每会话将灌入的水位;--apply 才建表+灌入
 *   (CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE:存量水位行不覆盖,可重复跑)。
 * 退出码:0 = 正常;1 = 库缺失/不可读等硬错误。
 */
import { statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const hasFlag = (name) => process.argv.includes(name);
const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const apply = hasFlag('--apply');
let memoryPath = argOf('--memory');
if (!memoryPath) {
  const { dshHomePath } = await import('@deepseek-ai/dsh-home-paths');
  memoryPath = `${dshHomePath('memory')}/memory.db`;
}
if (!statSync(memoryPath, { throwIfNoEntry: false })) {
  console.error(`memory 库不存在: ${memoryPath}`);
  process.exit(1);
}

const db = new DatabaseSync(memoryPath, { readOnly: !apply });

const l0Exists = db
  .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='l0_conversations'")
  .get() !== undefined;
const wmExists = db
  .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='l0_watermark'")
  .get() !== undefined;

if (!l0Exists) {
  console.log(`l0_conversations 表不存在(已清退或全新库):无基线可灌,无事可做。memory=${memoryPath}`);
  db.close();
  process.exit(0);
}

// dry-run 也建表?不——只读模式下用内存侧对账:待灌集 = l0 会话水位 − 已有水位行。
const baselines = db
  .prepare(`SELECT session_id, MAX(turn) AS max_turn, COUNT(*) AS rows
            FROM l0_conversations WHERE turn IS NOT NULL GROUP BY session_id ORDER BY session_id`)
  .all();
const existing = new Map(
  wmExists
    ? db.prepare('SELECT session_id, max_turn FROM l0_watermark').all().map((r) => [r.session_id, r.max_turn])
    : [],
);
const pending = baselines.filter((r) => !existing.has(r.session_id));
const coverage = baselines.filter((r) => existing.has(r.session_id) && existing.get(r.session_id) >= r.max_turn);

console.log(`l0-watermark-baseline ${apply ? '(APPLY)' : '(dry-run)'}`);
console.log(`memory=${memoryPath}`);
console.log(`l0 会话=${baselines.length} 水位表=${wmExists ? '存在' : '不存在'} 已覆盖=${coverage.length} 待灌=${pending.length}`);

const sampleOf = (list, label) => {
  if (list.length === 0) return;
  console.log(`${label} sample(≤10/${list.length}):`);
  for (const r of list.slice(0, 10)) {
    console.log(`  ${r.session_id}: max_turn=${r.max_turn} rows=${r.rows}${existing.has(r.session_id) ? ` (已有 ${existing.get(r.session_id)})` : ''}`);
  }
};
sampleOf(pending, '待灌');
const stale = baselines.filter((r) => existing.has(r.session_id) && existing.get(r.session_id) < r.max_turn);
sampleOf(stale, '水位落后于 l0 行(OR IGNORE 保留,由启动链幂等对齐)');

if (!apply) {
  console.log('dry-run:未写任何行;--apply 建表并物化');
  db.close();
  process.exit(0);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS l0_watermark (
    session_id TEXT PRIMARY KEY,
    max_turn INTEGER NOT NULL DEFAULT 0,
    last_step INTEGER,
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);
const result = db
  .prepare(`INSERT OR IGNORE INTO l0_watermark (session_id, max_turn, last_step)
            SELECT session_id, MAX(turn), NULL
            FROM l0_conversations
            WHERE turn IS NOT NULL
            GROUP BY session_id`)
  .run();
const after = db.prepare('SELECT COUNT(*) AS n FROM l0_watermark').get();
console.log(`applied: l0_watermark 现有 ${after.n} 行(changes=${Number(result.changes)})`);
db.close();
