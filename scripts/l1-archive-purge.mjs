#!/usr/bin/env node
/**
 * l1 归档清退一次性迁移（wing-migrate 同款纪律：dry-run 缺省，--apply 才动库）。
 *
 * 步骤（--apply 时按序）：
 *   ①备份：memory.db(+wal/shm) → ~/.dsh/memory/backups/pre-l1-purge-<ts>/
 *   ②markdown 导出：全部退场 l1 行（valid_to 非空或 dsh_superseded 标记，判据
 *     与 store/sqlite.ts retiredL1Sql 逐字同口径）→ archive-md/type/name.memory.md
 *     （含 front-matter：record_id/type/priority/scene/valid_to/supersede 标记）
 *   ③disable 文件归档：memories 树内全部 `.memory.md.disable` 文件移动 → disabled-files/
 *     （同步摘除 mem-md-ledger.json 对应条目，账本坏文件=跳过不动账）
 *   ④检索面前置清理：l1_fts / l1_vec（sqlite-vec 扩展可得时）DELETE 退场 record_id
 *   ⑤硬删：l1_records 退场行 + l1_receipts 孤儿行 → VACUUM
 *   ⑥对账：活跃行数前后不变式；报告 JSON 落 archive 根。
 *
 * 安全闸：桌面/宿主进程必须在场外（脚本自检 wal 帧数异常=并发写嫌疑仅告警）。
 * 绝不触碰 l0_conversations（l0 属插件自有写路径，spec R8 三期裁定）。
 */
import { DatabaseSync } from 'node:sqlite'
import {
  copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync,
  renameSync, readdirSync, statSync, rmSync,
} from 'node:fs'
import { join, basename } from 'node:path'

const APPLY = process.argv.includes('--apply')
const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
const MEM_DIR = join(home, '.dsh', 'memory')
const DB = join(MEM_DIR, 'memory.db')
if (!existsSync(DB)) { console.error('memory.db 不存在：', DB); process.exit(1) }

const ts = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-')
const ARK = join(MEM_DIR, `purge-archive-${ts}`)
const BAK = join(MEM_DIR, 'backups', `pre-l1-purge-${ts}`)

// 与 store/sqlite.ts retiredL1Sql 同口径（唯一事实源，两处漂移=事故）。
const RETIRED = `COALESCE(valid_to,'') <> '' OR metadata_json LIKE '%"dsh_superseded"%'`

const report = { apply: APPLY, ts, steps: {}, invariants: {} }

const db = new DatabaseSync(DB)
const num = (v) => Number(typeof v === 'bigint' ? v : v)

const totalBefore = num(db.prepare('SELECT COUNT(*) n FROM l1_records').get().n)
const activeBefore = num(db.prepare(`SELECT COUNT(*) n FROM l1_records WHERE NOT (${RETIRED})`).get().n)
const retiredRows = db.prepare(`SELECT * FROM l1_records WHERE ${RETIRED} ORDER BY type, record_id`).all()
report.invariants = { totalBefore, activeBefore, retired: retiredRows.length }

// ---- ② markdown 导出（dry-run 也算数量预览；apply 才写文件） ----
function slug(text, fallback) {
  const s = String(text ?? '').replace(/[\\/:*?"<>|\s]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 60)
  return s === '' ? fallback : s
}
const mdPreview = retiredRows.map((r) => {
  const meta = (() => { try { return JSON.parse(String(r.metadata_json ?? '{}')) } catch { return {} } })()
  const name = slug(meta.name ?? r.name ?? String(r.content).slice(0, 24), r.record_id)
  const rel = join('archive-md', slug(r.type, 'untitled'), `${name}-${String(r.record_id).slice(-6)}.memory.md`)
  const fm = [
    '---',
    `record_id: ${r.record_id}`,
    `type: ${r.type ?? ''}`,
    `priority: ${r.priority ?? ''}`,
    `scene_name: ${r.scene_name ?? ''}`,
    `family: ${r.family ?? ''}`,
    `persistence: ${r.persistence ?? ''}`,
    `scope: ${r.scope ?? ''}`,
    `valid_from: ${r.valid_from ?? ''}`,
    `valid_to: ${r.valid_to ?? ''}`,
    `supersede: ${JSON.stringify(meta.dsh_superseded ?? null)}`,
    `created: ${r.created_time ?? ''} | updated: ${r.updated_time ?? ''}`,
    '---',
    '',
    `# ${meta.name ?? r.name ?? name}`,
    '',
    String(r.content ?? ''),
    '',
  ].join('\n')
  return { rel, fm }
})
report.steps.exportMd = { rows: mdPreview.length, sample: mdPreview.slice(0, 3).map(m => m.rel) }

// ---- ③ .disable 文件盘点 ----
function* walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) yield* walk(p)
    else yield p
  }
}
const disableFiles = existsSync(join(MEM_DIR, 'memories'))
  ? [...walk(join(MEM_DIR, 'memories'))].filter(f => f.endsWith('.disable'))
  : []
report.steps.disableFiles = { count: disableFiles.length }

// ---- ④/⑤ 前置检索面 + 硬删统计 ----
const orphanReceipts = num(db.prepare(
  `SELECT COUNT(*) n FROM l1_receipts rec WHERE NOT EXISTS (
     SELECT 1 FROM l1_records r WHERE r.record_id = rec.record_id AND NOT (${RETIRED}))`,
).get().n)
const dbBytes = statSync(DB).size
report.steps.purge = {
  retiredRows: retiredRows.length, orphanReceipts, dbBytesBefore: dbBytes,
}

if (!APPLY) {
  db.close()
  console.log('DRY-RUN（未动库）报告：')
  console.log(JSON.stringify(report, null, 1))
  process.exit(0)
}

// ===================== 以下才动真格 =====================
// ① 备份
mkdirSync(BAK, { recursive: true })
for (const suf of ['', '-wal', '-shm']) {
  if (existsSync(DB + suf)) copyFileSync(DB + suf, join(BAK, 'memory.db' + suf))
}
report.steps.backup = BAK

// ② 写 md
for (const { rel, fm } of mdPreview) {
  const abs = join(ARK, rel)
  mkdirSync(abs.slice(0, abs.lastIndexOf('\\') > 0 ? abs.lastIndexOf('\\') : abs.lastIndexOf('/')), { recursive: true })
  writeFileSync(abs, fm, 'utf8')
}
// ③ 移动 .disable + 摘账
mkdirSync(join(ARK, 'disabled-files'), { recursive: true })
const ledgerPath = join(MEM_DIR, 'mem-md-ledger.json')
let ledger = null
try { ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) } catch { /* 坏文件=不动账 */ }
let ledgerPruned = 0
for (const f of disableFiles) {
  const dest = join(ARK, 'disabled-files', basename(f))
  renameSync(f, dest)
  if (ledger?.entries && Object.prototype.hasOwnProperty.call(ledger.entries, f)) {
    delete ledger.entries[f]
    ledgerPruned++
  }
}
if (ledger !== null && ledgerPruned > 0) {
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n', 'utf8')
}
report.steps.disableFiles.moved = disableFiles.length
report.steps.ledgerPruned = ledgerPruned

// ④ 检索面前置：fts 普通删除；vec 试加载扩展，缺=跳过并记录
let vecPurged = 'skipped(no-extension)'
const retiredIds = retiredRows.map(r => String(r.record_id))
try {
  db.exec('DELETE FROM l1_fts WHERE record_id IN (SELECT record_id FROM l1_records WHERE ' + RETIRED + ')')
} catch (err) { report.steps.ftsNote = `fts delete failed: ${err.message}` }
try {
  const { getLoadablePath } = await import('sqlite-vec')
  db.loadExtension(getLoadablePath('vec'))
  const stmt = db.prepare('DELETE FROM l1_vec WHERE record_id = ?')
  for (const id of retiredIds) stmt.run(id)
  vecPurged = retiredIds.length
} catch {
  vecPurged = 'skipped(sqlite-vec 不可用；下次插件启动 purge 兜底)'
}
report.steps.retrievalPreClean = { vec: vecPurged }

// ⑤ 硬删主表 + 孤儿 receipts + VACUUM
const delRecords = num(db.prepare(`DELETE FROM l1_records WHERE ${RETIRED}`).run().changes)
const delReceipts = num(db.prepare(
  `DELETE FROM l1_receipts WHERE NOT EXISTS (
     SELECT 1 FROM l1_records r WHERE r.record_id = l1_receipts.record_id)`,
).run().changes)
db.exec('VACUUM')
report.steps.deleted = { l1_records: delRecords, l1_receipts_orphans: delReceipts }

// ⑥ 对账
const totalAfter = num(db.prepare('SELECT COUNT(*) n FROM l1_records').get().n)
const activeAfter = num(db.prepare(`SELECT COUNT(*) n FROM l1_records WHERE NOT (${RETIRED})`).get().n)
const ftsAfter = num(db.prepare('SELECT COUNT(*) n FROM l1_fts').get().n)
report.invariants.totalAfter = totalAfter
report.invariants.activeAfter = activeAfter
report.invariants.ftsAfter = ftsAfter
if (activeAfter !== activeBefore) {
  report.invariants.VIOLATION = `活跃行变化 ${activeBefore}->${activeAfter}——立即从备份恢复 ${BAK}`
}
report.invariants.dbBytesAfter = statSync(DB).size
db.close()

writeFileSync(join(ARK, 'purge-report.json'), JSON.stringify(report, null, 2), 'utf8')
console.log('APPLY 完成。报告：')
console.log(JSON.stringify(report, null, 1))
if (report.invariants.VIOLATION) process.exit(2)
