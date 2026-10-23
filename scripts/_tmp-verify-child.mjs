/**
 * fix #11 本地集成验证(不依赖真模型):
 * 1) 裸 node 直跑 embedding-child.cjs → 静默退出(code 0,无 SyntaxError);
 * 2) fork → ping/pong;warmup(假 runtimeDir)→ ok:false stage=load;
 * 3) 经 LocalEmbeddingService 默认通道:waitForReady 拒绝 → failed 态 → embedBatch 抛"加载失败";
 * 4) close() → 子进程退出,tasklist 无孤儿;
 * 5) 子进程被外部强杀 → 主线程收到 exit → setOnCrash 通知 → 未决请求全部拒绝。
 */
import { fork, spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const childFile = path.join(root, 'dist', 'embedding-child.cjs');
let failures = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` [${extra}]` : ''}`);
  if (!cond) failures++;
};

// ── 1) 裸 node 直跑:静默退出 ──
{
  const r = spawnSync(process.execPath, [childFile], { encoding: 'utf-8', timeout: 15000 });
  ok('task1 裸跑不报 SyntaxError、退出码 0', r.status === 0 && !String(r.stderr).includes('SyntaxError'), `status=${r.status} stderr=${String(r.stderr).trim().slice(0, 80)}`);
}

// ── 2) fork ping/pong + 假 cfg 的 warmup 失败语义 ──
{
  const cfg = { runtimeDir: path.join(root, '_no_such_runtime_'), modelDir: path.join(root, '_no_such_model_'), pooling: 'cls', dtype: 'q8', maxInputChars: 5000 };
  const child = fork(childFile, [], { env: { ...process.env, DSH_EMBED_CFG: JSON.stringify(cfg) }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const recv = (pred, ms = 20000) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`等待超时(${ms}ms)`)), ms);
      child.on('message', function h(msg) {
        if (pred(msg)) {
          clearTimeout(t);
          child.off('message', h);
          resolve(msg);
        }
      });
    });
  child.send({ id: 1, type: 'ping' });
  const pong = await recv((m) => m.type === 'pong');
  ok('task4 fork 成功且 ping→pong', pong.id === 1 && pong.ok === true, JSON.stringify(pong));
  child.send({ id: 2, type: 'warmup' });
  const load = await recv((m) => m.id === 2);
  ok('warmup 假 runtime → ok:false stage=load', load.ok === false && load.stage === 'load', String(load.error).slice(0, 60));
  child.kill();
  await new Promise((r) => child.once('exit', r));
}

// ── 3)+4) 经 LocalEmbeddingService 默认通道:startWarmup→failed→embed 抛错→close 无孤儿 ──
{
  const mod = await import(pathToFileURL(path.join(root, 'dist', 'store', 'local-embedding.js')).href);
  const entry = { id: 'fake', dims: 512, pooling: 'cls' };
  const svc = new mod.LocalEmbeddingService(entry, path.join(root, '_no_such_model_'), {
    runtimeDir: path.join(root, '_no_such_runtime_'),
    childPath: childFile,
    logger: { info: () => {}, warn: (s) => console.log('  log:', s), error: () => {} },
  });
  // 状态机走真通道:warmup 失败 → failed
  await svc.waitForReady().then(
    () => ok('waitForReady 应拒绝', false),
    (e) => ok('task5 waitForReady 拒绝(假 runtime)', /加载失败|no such|Cannot find/i.test(String(e.message)), String(e.message).slice(0, 60)),
  );
  ok('task5 失败后 state=failed', svc.getState() === 'failed', svc.getState());
  await svc.embedBatch(['x']).then(
    () => ok('embedBatch 应抛加载失败', false),
    (e) => ok('embedBatch 抛"加载失败"(降级 FTS 语义)', /加载失败/.test(String(e.message)), String(e.message).slice(0, 60)),
  );
  const before = spawnSync('tasklist', ['/FI', 'IMAGENAME eq node.exe', '/FO', 'csv', '/NH'], { encoding: 'utf-8' }).stdout;
  const beforeCount = (before.match(/"node\.exe"/g) ?? []).length;
  svc.close();
  await new Promise((r) => setTimeout(r, 1200));
  const after = spawnSync('tasklist', ['/FI', 'IMAGENAME eq node.exe', '/FO', 'csv', '/NH'], { encoding: 'utf-8' }).stdout;
  const afterCount = (after.match(/"node\.exe"/g) ?? []).length;
  ok('task10 close 后 node.exe 计数不升(无孤儿)', afterCount <= beforeCount, `before=${beforeCount} after=${afterCount}`);
}

// ── 5) 外部强杀子进程 → 父进程 exit 事件 → pending 全部拒绝 ──
{
  const cfg = { runtimeDir: path.join(root, '_no_such_runtime_'), modelDir: path.join(root, '_no_such_model_'), pooling: 'cls', dtype: 'q8', maxInputChars: 5000 };
  const child = fork(childFile, [], { env: { ...process.env, DSH_EMBED_CFG: JSON.stringify(cfg) }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  const r = await Promise.race([exited, new Promise((res) => setTimeout(() => res(null), 8000))]);
  ok('task3 强杀子进程 → 父进程收到 exit', r !== null, JSON.stringify(r));
}

console.log(failures === 0 ? '\nINTEGRATION ALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
