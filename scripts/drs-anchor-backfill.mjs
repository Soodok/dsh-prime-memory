#!/usr/bin/env node
/**
 * DRS 历史锚点回填 CLI(T8.2,一次性任务;wing-migrate 同款形状:dry-run 先行)。
 *
 * 用法:npm run build && node scripts/drs-anchor-backfill.mjs \
 *   [--memory <memory.db>] [--drs <projection.db>] [--session <id>] \
 *   [--limit N] [--window-ms N] [--sample N] [--apply]
 *   缺省 memory = $DSH_HOME/memory/memory.db(dshHomePath('memory') 同口径)
 *   缺省 drs   = $DSH_REFERENCE_SESSION_DIR/projection.db(再退 ~/.dsh-reference-session/)
 *   缺省 dry-run:两库只读,只出报告;--apply 才写 l0 的 turn/step 两列
 *   (恒带 `AND turn IS NULL`,已锚定行永不覆盖)。
 * 退出码:0 = 报告正常;1 = 库缺失/不可读等硬错误。
 */
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const numOf = (name) => {
  const raw = argOf(name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};
const hasFlag = (name) => process.argv.includes(name);

const apply = hasFlag('--apply');
const sessionId = argOf('--session');
const limit = numOf('--limit');
const windowMs = numOf('--window-ms');
const sample = numOf('--sample') ?? 0;

let memoryPath = argOf('--memory');
if (!memoryPath) {
  const { dshHomePath } = await import('@deepseek-ai/dsh-home-paths');
  memoryPath = `${dshHomePath('memory')}/memory.db`;
}
let drsPath = argOf('--drs');
if (!drsPath) {
  const dir = process.env.DSH_REFERENCE_SESSION_DIR || join(homedir(), '.dsh-reference-session');
  drsPath = join(dir, 'projection.db');
}
for (const [label, path] of [['memory', memoryPath], ['drs', drsPath]]) {
  if (!statSync(path, { throwIfNoEntry: false })) {
    console.error(`${label} 库不存在: ${path}`);
    process.exit(1);
  }
}

const { planAnchorBackfill, applyAnchorBackfill } = await import('../dist/drs-anchor-backfill.js');

const memory = new DatabaseSync(memoryPath, { readOnly: !apply });
const drs = new DatabaseSync(drsPath, { readOnly: true });

const plan = planAnchorBackfill({
  memory, drs,
  ...(sessionId === undefined ? {} : { sessionId }),
  ...(limit === undefined ? {} : { limit }),
  ...(windowMs === undefined ? {} : { windowMs }),
});

console.log(`drs-anchor-backfill ${apply ? '(APPLY)' : '(dry-run)'} window=${plan.windowMs}ms`);
console.log(`memory=${memoryPath}`);
console.log(`drs=${drsPath}`);
if (sessionId !== undefined) console.log(`session=${sessionId}`);
console.log(
  `candidates=${plan.candidates} drsSessions=${plan.drsSessions} alreadyAnchored=${plan.alreadyAnchored} ` +
  `fills=${plan.fills.length} skips=${plan.skips.length}`,
);

const bySession = new Map();
for (const fill of plan.fills) {
  const row = bySession.get(fill.sessionId) ?? { fills: 0 };
  row.fills += 1;
  bySession.set(fill.sessionId, row);
}
for (const skip of plan.skips) {
  const row = bySession.get(skip.sessionId) ?? { fills: 0 };
  row[skip.reason] = (row[skip.reason] ?? 0) + 1;
  bySession.set(skip.sessionId, row);
}
for (const [id, row] of [...bySession.entries()].sort()) {
  console.log(`  ${id}: ${JSON.stringify(row)}`);
}

let report = null;
if (apply) {
  report = applyAnchorBackfill(memory, plan);
  console.log(
    `applied=${report.applied} rows ${report.totalRowsBefore}→${report.totalRowsAfter} ` +
    `invariant=${report.invariantHolds ? 'OK' : 'VIOLATED'}`,
  );
  if (!report.invariantHolds) process.exit(1);
} else {
  console.log('dry-run:未写任何行;--apply 执行回填');
}

if (sample > 0) {
  const source = report ? report.plan.fills : plan.fills;
  console.log(`sample(${Math.min(sample, source.length)}/${source.length}):`);
  for (const fill of source.slice(0, sample)) {
    console.log(
      `  ${fill.recordId} [${fill.role}] l0@${fill.l0Timestamp} drs@${fill.drsTime} Δ=${fill.deltaMs}ms → turn=${fill.turn} step=${fill.step}`,
    );
  }
}
memory.close();
drs.close();
