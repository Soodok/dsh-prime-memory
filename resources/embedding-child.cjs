/**
 * 本地嵌入子进程(fix #11):transformers.js 的模型加载与推理在 fork 出的独立
 * 子进程执行,主线程只投递文本、收回向量。取代 worker_threads 的原因:
 * 插件 runtime 的 sharp/libvips 与宿主 Electron 的 sharp/libvips 在同一进程内
 * 加载会撞 libvips-42.dll 名字(OS LoadLibrary 层冲突,同名不同路径行为未定义)
 * ——worker_thread 与主线程同进程,撞名前提仍在;子进程自带独立 DLL 表,物理隔离。
 *
 * 推理队列语义与 embedding-worker.cjs 完全一致(单线程串行、priority 插队、
 * 条间 setImmediate 让路),只有 IPC 传输层不同:
 *
 * 协议(与 src/store/local-embedding.ts 的 RealChildChannel 配对;自增 id):
 * - 启动配置:env DSH_EMBED_CFG(JSON 字符串:{runtimeDir,modelDir,pooling,dtype,
 *   maxInputChars}——fork 的 env 只收标量,嵌套对象经序列化传递);
 * - 入向:{id,type:'ping'} | {id,type:'warmup'} | {id,type:'embed',texts,priority}
 * - 出向:{id,ok:true,type:'pong'|'ready'|'embedded',vectors?}(vectors 为
 *   number[][],fork IPC 默认 JSON 序列化不支持 TypedArray,主线程侧重建
 *   Float32Array;512d×32 条 ≈64KB,序列化 <5ms,瓶颈在推理不在传输)
 *   | {id,ok:false,stage:'load'|'infer',error} | {type:'fatal',error}
 *
 * 信任边界(沿 AGENTS.md 审查记录):runtime/ 目录在数据目录信任边界内,
 * 本进程按其 package.json createRequire 加载 transformers——对数据目录有写
 * 权限的进程理论上可植入恶意模块;模型文件逐文件 sha256 锁定,运行时代码
 * 无同级防护,完整修复需安装指纹设计,暂以文档化假设为准。
 */
'use strict';

const path = require('node:path');
const { createRequire } = require('node:module');

// 必须由 fork 启动(需要 IPC channel);裸 node 执行时静默退出,不报 SyntaxError、不永挂。
if (typeof process.send !== 'function') {
  console.error('[embedding-child] 未经 fork 启动,无 IPC 通道,退出');
  process.exit(0);
}

/** 错误消息归一化(Error 取 message,其余 String 化)。 */
function errMsg(err) {
  return err && err.message ? err.message : String(err);
}

const cfg = JSON.parse(process.env.DSH_EMBED_CFG || '{}');
const RUNTIME_DIR = typeof cfg.runtimeDir === 'string' ? cfg.runtimeDir : '';
const MODEL_DIR = typeof cfg.modelDir === 'string' ? cfg.modelDir : '';
const POOLING = cfg.pooling === 'cls' ? 'cls' : 'mean';
const DTYPE = typeof cfg.dtype === 'string' ? cfg.dtype : 'q8';
const MAX_INPUT_CHARS = cfg.maxInputChars > 0 ? cfg.maxInputChars : 5000;

let extractor = null; // pipeline('feature-extraction', …)
let loadState = 'idle'; // idle | loading | ready | failed
let loadPromise = null;
let loadError = null;

// ── 模型懒加载(首请求触发;失败后经 warmup 可重试,embed 请求失败快返回) ──
function ensureLoaded() {
  if (loadState === 'ready') return Promise.resolve();
  if (loadState === 'loading' && loadPromise) return loadPromise;
  loadState = 'loading';
  loadError = null;
  loadPromise = (async () => {
    try {
      if (!RUNTIME_DIR || !MODEL_DIR) throw new Error('DSH_EMBED_CFG 缺少 runtimeDir/modelDir');
      const req = createRequire(path.join(RUNTIME_DIR, 'package.json'));
      const mod = req('@huggingface/transformers');
      if (mod.env) {
        mod.env.allowRemoteModels = false;
        if (mod.env.allowLocalModels !== undefined) mod.env.allowLocalModels = true;
      }
      extractor = await mod.pipeline('feature-extraction', MODEL_DIR, { dtype: DTYPE });
      loadState = 'ready';
    } catch (err) {
      loadState = 'failed';
      loadError = errMsg(err);
      loadPromise = null; // 失败后下一次 warmup 重新走加载
      throw err;
    }
  })();
  return loadPromise;
}

// ── 推理队列(逐条 job;priority 插队;条间让路) ──
const queue = []; // [{ request, index, text }]
let pumping = false;

function postReply(msg) {
  // 通道已断(父进程退出/正在终止)时 send 抛错——静默即可,父进程侧有 exit 兜底
  try {
    process.send(msg);
  } catch {
    /* IPC 已关闭,回复无处可去 */
  }
}

/** 请求全部条目完成 → 回执(Float32Array → number[] 序列化,IPC JSON 通道不支持 TypedArray)。 */
function settle(request) {
  if (request.failed || request.remaining !== 0) return;
  postReply({
    id: request.id,
    ok: true,
    type: 'embedded',
    vectors: request.vectors.map((v) => Array.from(v)),
  });
}

/** 首个失败即回执错误,并移除该请求尚未开跑的条目(正在跑的至多 1 条,算完即弃)。 */
function failRequest(request, error, stage) {
  if (request.failed) return;
  request.failed = true;
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].request === request) queue.splice(i, 1);
  }
  postReply({ id: request.id, ok: false, stage: stage, error: errMsg(error) });
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift();
      if (job.request.failed) continue;
      try {
        const result = await extractor([job.text.slice(0, MAX_INPUT_CHARS)], { pooling: POOLING, normalize: true });
        const data = result[0] && result[0].data;
        job.request.vectors[job.index] = data instanceof Float32Array ? data : new Float32Array(data);
        job.request.remaining -= 1;
        settle(job.request);
      } catch (err) {
        failRequest(job.request, err, 'infer');
      }
      // 条间让路:交还本进程事件循环,新消息(含 priority 插队)可在批间被处理
      await new Promise((resolve) => setImmediate(resolve));
    }
  } finally {
    pumping = false;
  }
}

function handleEmbed(msg) {
  const texts = Array.isArray(msg.texts) ? msg.texts : [];
  if (texts.length === 0) {
    postReply({ id: msg.id, ok: true, type: 'embedded', vectors: [] });
    return;
  }
  const request = { id: msg.id, vectors: new Array(texts.length), remaining: texts.length, failed: false };
  // 单条请求(召回 query)插队到队首;批次追加到队尾(批内条目间仍会被后来的插队)
  const priority = msg.priority === true && texts.length === 1;
  for (let i = 0; i < texts.length; i++) {
    const job = { request: request, index: i, text: String(texts[i] == null ? '' : texts[i]) };
    if (priority) queue.unshift(job);
    else queue.push(job);
  }
  void pump();
}

process.on('message', (msg) => {
  if (!msg || typeof msg.id !== 'number' || typeof msg.type !== 'string') return;
  if (msg.type === 'ping') {
    postReply({ id: msg.id, ok: true, type: 'pong' });
    return;
  }
  if (msg.type === 'warmup') {
    ensureLoaded().then(
      () => postReply({ id: msg.id, ok: true, type: 'ready' }),
      () => postReply({ id: msg.id, ok: false, stage: 'load', error: loadError ?? '模型加载失败' }),
    );
    return;
  }
  if (msg.type === 'embed') {
    void (async () => {
      try {
        await ensureLoaded();
      } catch {
        postReply({ id: msg.id, ok: false, stage: 'load', error: loadError ?? '模型加载失败' });
        return;
      }
      handleEmbed(msg);
    })();
    return;
  }
});

// 父进程disconnect(通道被主动关闭,如宿主优雅退出/RealChildChannel 前置断开):
// 模型与 onnxruntime 都只服务于这条通道,留着就是孤儿常驻——直接退出。
// taskkill /T /F 兜底覆盖"父进程被硬杀、无 disconnect"的路径。
process.on('disconnect', () => process.exit(0));

// 未捕获异常:尽力通知父进程后强制退出(父进程的 exit 处理会拒绝全部 pending
// 并转入 failed 态)。不保持半死状态——半死的子进程只会让调用方挂到超时。
process.on('uncaughtException', (err) => {
  postReply({ type: 'fatal', error: errMsg(err) });
  setTimeout(() => process.exit(1), 50);
});
