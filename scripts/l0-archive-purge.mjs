#!/usr/bin/env node
/**
 * l0 存量清退一次性迁移（drsc-redact-memory-wiring task_22；l1 版同款纪律：
 * dry-run 缺省，--apply 才动库）。
 *
 * 步骤（--apply 时按序）：
 *   ①备份：memory.db(+wal/shm) → ~/.dsh/memory/backups/pre-l0-purge-<ts>/
 *   ②markdown 导出：全部 l0_conversations 行 → archive-md-l0/<session>/<role>-<ts>-<id6>.memory.md
 *     （front-matter：record_id/session/role/timestamp/turn/step + redacted: true）。
 *     正文=redactSecrets(message_text)——**与 capture 单点/collector redacted 臂同一引擎**
 *     （dist/util/redact.js，collector 侧逐字节 vendor 同源=口径等价；spec R8
 *     「经 redacted 臂拉取，等价 capture 面」的离线等价实现，脚本零 HTTP 依赖）。
 *   ③硬删：l0_fts 全清 → l0_vec 全清（sqlite-vec 扩展不可得=跳过+warn，与 l1 版④同款）
 *     → l0_conversations 全清 → VACUUM
 *   ④对账不变式：l1_records/l0_watermark 前后计数不动；l0 三表归零；报告 JSON 落归档根。
 *
 * 安全闸：
 *   - --apply 前置：l0_watermark 表必须已存在（写停 build 未激活/未 init 时清退=
 *     旧插件边写边删+重启重放，直接 abort）；
 *   - 桌面/宿主进程应在场外的窗口跑（wal 有内容=并发写嫌疑，apply 下 abort）；
 *   - 绝不触碰 l1_records/l1_fts/l1_vec（那是 l1-archive-purge 的疆域）。
 */
import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { redactSecrets } from '../dist/util/redact.js'

const APPLY = process.argv.includes('--apply')
const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
const MEM_DIR = join(home, '.dsh', 'memory')
const DB = join(MEM_DIR, 'memory.db')
if (!existsSync(DB)) { console.error('memory.db 不存在：', DB); process.exit(1) }

const ts = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-')
const ARK = join(MEM_DIR, `purge-archive-${ts}`)
const BAK = join(MEM_DIR, 'backups', `pre-l0-purge-${ts}`)

const report = { apply: APPLY, ts, steps: {}, invariants: {} }
const num = (v) => Number(typeof v === 'bigint' ? v : v)
const db = new DatabaseSync(DB)

// ── 读面：全部 l0 存量行（turn/step 列随 sqlite.ts 迁移存在与否兼容读） ──
const l0Cols = db.prepare('PRAGMA table_info(l0_conversations)').all().map(c => String(c.name))
if (l0Cols.length === 0) { console.log('l0_conversations 不存在——无需清退（可能已跑过）。'); db.close(); process.exit(0) }
const rows = db.prepare('SELECT * FROM l0_conversations ORDER BY session_id, timestamp, record_id').all()
const sessions = new Set(rows.map(r => String(r.session_id ?? '')))
const rawBytes = rows.reduce((t, r) => t + String(r.message_text ?? '').length, 0)
const hasTurn = l0Cols.includes('turn'); const hasStep = l0Cols.includes('step')
report.steps.scan = {
  rows: rows.length, sessions: sessions.size, rawChars: rawBytes,
  anchored: hasTurn ? rows.filter(r => num(r.turn) > 0).length : 0,
}

// ── ② redacted md 导出（dry-run 只算命中数与抽样，apply 写文件） ──
function slug(text, fallback) {
  const s = String(text ?? '').replace(/[\\/:*?"<>|\s]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 60)
  return s === '' ? fallback : s
}
const kindTally = {}
let redactedRows = 0
const exportsPlanned = []
for (const r of rows) {
  const text = String(r.message_text ?? '')
  const red = redactSecrets(text)
  if (red.redacted) {
    redactedRows += 1
    for (const [kind, n] of Object.entries(red.counts)) kindTally[kind] = (kindTally[kind] ?? 0) + n
  }
  const sid = slug(r.session_id, 'no-session')
  const id6 = String(r.record_id).slice(-6).replace(/[^\w-]/gu, '_')
  const name = `${slug(r.role, 'msg')}-${num(r.timestamp) || 'na'}-${id6}.memory.md`
  exportsPlanned.push({
    rel: join('archive-md-l0', sid, name),
    fm: [
      '---',
      `record_id: ${r.record_id}`,
      `session_id: ${r.session_id ?? ''}`,
      `role: ${r.role ?? ''}`,
      `timestamp: ${r.timestamp ?? 0}`,
      `recorded_at: ${r.recorded_at ?? ''}`,
      ...(hasTurn ? [`turn: ${r.turn ?? ''}`] : []),
      ...(hasStep ? [`step: ${r.step ?? ''}`] : []),
      'redacted: true',
      'source: l0-archive-purge (T8.4 R8; engine=util/redact.ts same as capture & collector redacted arm)',
      '---',
      '',
    ].join('\n'),
    body: red.text,
  })
}
report.steps.export = { files: exportsPlanned.length, rowsWithRedaction: redactedRows, kindTally }

// ── 不变式基线（apply 前后对拍） ──
const l1Before = num(db.prepare('SELECT COUNT(*) n FROM l1_records').get().n)
const wmTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='l0_watermark'").get() !== undefined
const wmBefore = wmTable ? num(db.prepare('SELECT COUNT(*) n FROM l0_watermark').get().n) : -1
report.invariants = { l1Records: l1Before, watermarkRows: wmBefore, watermarkTable: wmTable }

if (!APPLY) {
  console.log(JSON.stringify({ mode: 'dry-run', ...report }, null, 1))
  console.log('DRY-RUN OK —— 未动库。实跑：node scripts/l0-archive-purge.mjs --apply')
  db.close(); process.exit(0)
}

// ── 安全闸（apply-only） ──
if (!wmTable) {
  db.close()
  console.error('ABORT：l0_watermark 表缺失——写停 build 未激活/未 init，清退=边写边删+重启重放。先装 M3 版并跑一次（ensureBaseline）再来。')
  process.exit(2)
}
const wal = DB + '-wal'
if (existsSync(wal) && statSync(wal).size > 4 * 1024 * 1024) {
  db.close()
  console.error(`ABORT：wal ${statSync(wal).size}B 异常大——宿主疑似在场写入，先关 DSH 再跑。`)
  process.exit(2)
}

// ── ① 备份 ──
mkdirSync(BAK, { recursive: true })
let backedUp = 0
for (const suffix of ['', '-wal', '-shm']) {
  if (existsSync(DB + suffix)) { copyFileSync(DB + suffix, join(BAK, 'memory.db' + suffix)); backedUp += 1 }
}
report.steps.backup = { dir: BAK, files: backedUp }

// ── ② 写导出 ──
for (const e of exportsPlanned) {
  const abs = join(ARK, e.rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, e.fm + e.body + '\n', 'utf8')
}

// ── ③ 硬删（检索面先行，主表跟后；vec 扩展缺席=跳过） ──
db.exec('BEGIN')
let ftsDeleted = 0; let vecSkipped = ''
try {
  if (db.prepare("SELECT name FROM sqlite_master WHERE name='l0_fts'").get() !== undefined) {
    ftsDeleted = num(db.prepare('DELETE FROM l0_fts').get().changes ?? 0)
    // fts DELETE 的 changes 不可靠——归零校验兜底
    ftsDeleted = num(db.prepare('SELECT COUNT(*) n FROM l0_fts').get().n) === 0 ? ftsDeleted : -1
  }
  if (db.prepare("SELECT name FROM sqlite_master WHERE name='l0_vec'").get() !== undefined) {
    try {
      db.exec('DELETE FROM l0_vec')
    } catch (err) {
      vecSkipped = `l0_vec 清理跳过（sqlite-vec 扩展不可得）：${err instanceof Error ? err.message : String(err)}`
    }
  }
  const main = num(db.prepare('DELETE FROM l0_conversations').get().changes ?? 0)
  db.exec('COMMIT')
  report.steps.delete = { mainDeleted: main, ftsRemain: ftsDeleted, vecSkipped }
  db.exec('VACUUM')
} catch (err) {
  db.exec('ROLLBACK')
  db.close()
  console.error('ABORT（已回滚，备份在手）：', err)
  process.exit(3)
}

// ── ④ 对账 ──
const l1After = num(db.prepare('SELECT COUNT(*) n FROM l1_records').get().n)
const wmAfter = num(db.prepare('SELECT COUNT(*) n FROM l0_watermark').get().n)
const l0After = num(db.prepare('SELECT COUNT(*) n FROM l0_conversations').get().n)
report.invariants = { ...report.invariants, l1RecordsAfter: l1After, watermarkAfter: wmAfter, l0After }
const ok = l1After === l1Before && wmAfter === wmBefore && l0After === 0
db.close()

// 归档计数自证
let mdFiles = 0
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(join(d, e.name)); else mdFiles += 1 } }
if (existsSync(join(ARK, 'archive-md-l0'))) walk(join(ARK, 'archive-md-l0'))
report.steps.export.mdWritten = mdFiles
report.verify = { pass: ok, mdMatch: mdFiles === exportsPlanned.length, vecSkipped }

mkdirSync(ARK, { recursive: true })
writeFileSync(join(ARK, 'purge-report.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify(report, null, 1))
if (!ok) { console.error('INVARIANT FAIL —— 报告已落档，备份在 ' + BAK); process.exit(4) }
console.log('L0_PURGE_OK')

