/**
 * fix #11 task_8/9/10 + Should-Pass 真模型验证(本机,不依赖宿主 GUI):
 * - 下载 bge-small-zh-v1.5(sha256 由 catalog 逐文件锁定);
 * - 新 child 通道:warmup→ready、embed 维度 512、单条/batch32 时延;
 * - 旧 worker 通道(useWorker 逃生门)同文本对照:cosine > 0.9999;
 * - close() 后子进程退出(tasklist 无新增 node.exe)。
 */
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '_tmp-fix11-data');
const { catalogById } = await import(pathToFileURL(path.join(root, 'dist', 'store', 'model-catalog.js')).href);
const { ModelDownloadQueue } = await import(pathToFileURL(path.join(root, 'dist', 'store', 'download-queue.js')).href);
const { LocalEmbeddingService } = await import(pathToFileURL(path.join(root, 'dist', 'store', 'local-embedding.js')).href);

let failures = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` [${extra}]` : ''}`);
  if (!cond) failures++;
};
const logger = { info: (s) => console.log('  i:', s), warn: (s) => console.log('  w:', s), error: (s) => console.log('  e:', s) };

const entry = catalogById('bge-small-zh-v1.5');
const q = new ModelDownloadQueue(dataDir, { mirror: 'https://hf-mirror.com', proxy: process.env.DSH_TEST_PROXY || '', logger });
console.log('downloading bge-small-zh-v1.5 …');
const prog = await q.startEntry(entry);
ok('task8 前置:模型下载完成(sha256 逐文件校验)', prog.phase === 'done', `phase=${prog.phase} err=${prog.error ?? ''}`);
if (prog.phase !== 'done') process.exit(1);

const modelDir = q.modelsDir(entry.id);
const runtimeDir = path.join(dataDir, 'runtime');
const texts = ['今天天气不错,适合写代码。', 'The quick brown fox jumps over the lazy dog.', '记忆插件把推理挪进了独立子进程。', 'DSH 宿主的 sharp 与运行时 sharp 同名不同路径。'];

// ── 新 child 通道 ──
const svcChild = new LocalEmbeddingService(entry, modelDir, { runtimeDir, logger, childPath: path.join(root, 'dist', 'embedding-child.cjs') });
const t0 = Date.now();
await svcChild.waitForReady();
ok('task8 warmup→ready(真模型加载,child 通道)', svcChild.getState() === 'ready', `${Date.now() - t0}ms`);
const one = await svcChild.embed(texts[0]);
ok('embed 返回 512 维', one.length === 512 && one instanceof Float32Array, `len=${one.length}`);
// 时延(就绪后):单条 ×3 取中位;batch 32 条 ×1
for (let i = 0; i < 3; i++) await svcChild.embed(texts[1]);
const ts = [];
for (let i = 0; i < 3; i++) {
  const s = Date.now();
  await svcChild.embed(texts[2]);
  ts.push(Date.now() - s);
}
const singleMed = ts.sort((a, b) => a - b)[1];
console.log(`  单条 embed 时延(3 次): ${ts.join('/')}ms`);
const batchTexts = Array.from({ length: 32 }, (_, i) => `${texts[i % texts.length]}#${i}`);
const bs = Date.now();
const vecsChild = await svcChild.embedBatch(batchTexts);
const batchMs = Date.now() - bs;
ok('batch32 返回 32 条向量', vecsChild.length === 32, `${batchMs}ms`);
console.log(`  batch32 耗时 ${batchMs}ms(不含首载)`);

// ── 旧 worker 通道对照(task_9 cosine) ──
const svcWorker = new LocalEmbeddingService(entry, modelDir, {
  runtimeDir,
  logger,
  useWorker: true,
  workerPath: path.join(root, 'dist', 'embedding-worker.cjs'),
});
await svcWorker.waitForReady();
const vecsWorker = await svcWorker.embedBatch(batchTexts);
const cos = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};
const sims = vecsChild.map((v, i) => cos(v, vecsWorker[i]));
const minSim = Math.min(...sims);
ok('task9 worker vs child cosine > 0.9999(32 对)', minSim > 0.9999, `min=${minSim.toFixed(10)} maxΔ=${(1 - Math.max(...sims)).toExponential(2)}`);

// ── 终止与孤儿 ──
const before = spawnSync('tasklist', ['/FI', 'IMAGENAME eq node.exe', '/FO', 'csv', '/NH'], { encoding: 'utf-8' }).stdout;
const beforeCount = (before.match(/"node\.exe"/g) ?? []).length;
svcWorker.close();
svcChild.close();
await new Promise((r) => setTimeout(r, 1500));
const after = spawnSync('tasklist', ['/FI', 'IMAGENAME eq node.exe', '/FO', 'csv', '/NH'], { encoding: 'utf-8' }).stdout;
const afterCount = (after.match(/"node\.exe"/g) ?? []).length;
ok('task10 双通道 close 后无孤儿 node.exe', afterCount <= beforeCount, `before=${beforeCount} after=${afterCount}`);
ok('时延参考:单条中位 <20ms', singleMed < 20, `${singleMed}ms`);
ok('时延参考:batch32 <600ms', batchMs < 600, `${batchMs}ms`);

console.log(failures === 0 ? '\nREAL-MODEL ALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
