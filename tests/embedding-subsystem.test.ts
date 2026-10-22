/**
 * 嵌入子系统单元测试:状态文件、初始解析、下载器状态机(断点续传/sha 校验/取消)、
 * 运行时安装器(npm ci→install 回退/取消)、本地服务状态机(假通道)、代理解析。
 */
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { EmbeddingSourceStore, remoteCeiling, resolveInitialEmbedding, EmbeddingManager, makeLocalServiceFactory } from '../src/store/embedding-source.js';
import { ModelDownloadQueue, resolveProxyUrl, maskProxyUrl } from '../src/store/download-queue.js';
import { RuntimeInstaller, PINNED_TRANSFORMERS_VERSION } from '../src/store/runtime-installer.js';
import { LocalEmbeddingService, type EmbedWorkerChannel, type EmbedWorkerReply } from '../src/store/local-embedding.js';
import { MODEL_CATALOG, catalogById, catalogTotalBytes } from '../src/store/model-catalog.js';
import { NoopEmbeddingService } from '../src/store/embedding.js';
import type { MemoryConfig } from '../src/config.js';
import type { CatalogEntry } from '../src/store/model-catalog.js';
import type { MemoryLogger } from '../src/types.js';

let dir: string;
async function tmp(): Promise<string> {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'dsh-emb-'));
  return dir;
}
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const noopLogger: MemoryLogger = { info: () => {}, warn: () => {}, error: () => {} };

function cfg(over: Partial<MemoryConfig['embedding']> = {}): MemoryConfig {
  return {
    dataDir: '', family: 'auto',
    capture: { enabled: true, stripCodeBlocks: true, maxMessageChars: 4000 },
    extract: { enabled: true, minMessages: 6, idleSeconds: 300, backgroundMessages: 10, candidatePool: 5 },
    l2: { enabled: true, minNewMemories: 5, maxScenes: 12, sceneContextLimit: 3 },
    l3: { enabled: true, interval: 20 },
    recall: { enabled: true, maxResults: 5, maxCharsPerMemory: 500, maxTotalRecallChars: 2000, timeoutMs: 5000, includePersona: true, includeSceneNav: true, strategy: 'hybrid', scoreThreshold: 0.3, decayHalfLifeDays: 30 },
    embedding: { enabled: true, baseUrl: 'http://x/v1', apiKey: 'k', model: 'm', dimensions: 8, maxInputChars: 5000, timeoutMs: 10000, allowLocalModels: true, mirror: 'https://hf-mirror.com', proxy: '', ...over },
    llm: { provider: '', model: '', mode: 'host', baseURL: '', apiKey: '', maxTokens: 65536, reasoningEffort: '', temperature: 0.3, maxInputChars: 700000, timeoutMs: 120000 },
    hall: { enabled: ['work'] },
    tokenCost: { retentionDays: 365 },
    tools: true,
    benchControl: false,
  } as MemoryConfig;
}

describe('model catalog', () => {
  it('carries three pinned models with intact integrity data', () => {
    expect(MODEL_CATALOG.map((m) => m.id)).toEqual(['bge-small-zh-v1.5', 'embeddinggemma-300m', 'bge-m3']);
    expect(MODEL_CATALOG.map((m) => m.dims)).toEqual([512, 768, 1024]);
    for (const m of MODEL_CATALOG) {
      for (const f of m.files) {
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(f.size).toBeGreaterThan(0);
      }
    }
    expect(catalogById('bge-m3')?.pooling).toBe('cls');
    expect(catalogTotalBytes(MODEL_CATALOG[0])).toBeGreaterThan(20_000_000);
  });
});

describe('embedding source store', () => {
  it('roundtrip and corrupt-file fallback to remote', async () => {
    const dataDir = join(await tmp(), `src-${Date.now()}`);
    await mkdir(dataDir, { recursive: true });
    const s = new EmbeddingSourceStore(dataDir);
    await s.init();
    expect(s.get()).toEqual({ source: 'remote', activeModel: null }); // 无文件 = 历史行为
    await s.set({ source: 'local', activeModel: 'bge-m3' });
    const s2 = new EmbeddingSourceStore(dataDir);
    await s2.init();
    expect(s2.get()).toEqual({ source: 'local', activeModel: 'bge-m3' });

    const badDir = join(await tmp(), `srcbad-${Date.now()}`);
    await mkdir(badDir, { recursive: true });
    await writeFile(join(badDir, 'embedding-source.json'), '{{{');
    const s3 = new EmbeddingSourceStore(badDir);
    await s3.init();
    expect(s3.get().source).toBe('remote');
  });
});

describe('remoteCeiling / resolveInitialEmbedding', () => {
  it('remote ceiling requires baseUrl+model+dims+enabled (key optional)', () => {
    expect(remoteCeiling(cfg())).toBe(true);
    expect(remoteCeiling(cfg({ apiKey: '' }))).toBe(true); // 本地免 key 自托管放行
    expect(remoteCeiling(cfg({ enabled: false }))).toBe(false);
    expect(remoteCeiling(cfg({ dimensions: 0 }))).toBe(false);
    expect(remoteCeiling(cfg({ baseUrl: '' }))).toBe(false);
  });

  it('resolves off/local-when-disabled/local-missing/remote/no-ceiling paths', async () => {
    const dataDir = join(await tmp(), `init-${Date.now()}`);
    await mkdir(dataDir, { recursive: true });
    const downloader = new ModelDownloadQueue(dataDir, { mirror: 'https://hf-mirror.com' });
    const makeLocal = vi.fn(() => null);
    const store = new EmbeddingSourceStore(dataDir);

    await store.init();
    expect((await resolveInitialEmbedding(cfg({ enabled: false }), store, downloader, makeLocal)).dims).toBe(0);
    const localDisabled = cfg({ allowLocalModels: false });
    await store.set({ source: 'local', activeModel: 'bge-m3' });
    const r1 = await resolveInitialEmbedding(localDisabled, store, downloader, makeLocal);
    expect(r1.svc).toBeInstanceOf(NoopEmbeddingService);
    expect(r1.note).toContain('禁用本地嵌入');
    // 模型未下载 → 纯 FTS
    const r2 = await resolveInitialEmbedding(cfg(), store, downloader, makeLocal);
    expect(r2.note).toContain('文件缺失');
    // remote 正常路径
    await store.set({ source: 'remote', activeModel: null });
    const r3 = await resolveInitialEmbedding(cfg(), store, downloader, makeLocal);
    expect(r3.providerInfo).toEqual({ provider: 'remote', model: 'm', dimensions: 8 });
  });
});

describe('model download queue', () => {
  function tinyEntry(): CatalogEntry {
    return {
      id: 'tiny', name: 'Tiny', repo: 'x/tiny', revision: 'rev0', dims: 4, contextTokens: 8,
      pooling: 'cls', tags: [], description: '合成模型',
      files: [
        { path: 'config.json', size: 11, sha256: shaOf('hello-part0') },
        { path: 'onnx/model.onnx', size: 12, sha256: shaOf('hello-part1!') },
      ],
    };
  }
  function shaOf(s: string): string {
    return createHash('sha256').update(s).digest('hex');
  }

  it('downloads, verifies sha256 and reports done; corrupt bytes retried with cache-bust then error', async () => {
    const dataDir = join(await tmp(), `dl-${Date.now()}`);
    await mkdir(dataDir, { recursive: true });
    const entry = tinyEntry();
    // 第一文件好;第二文件前两次吐坏字节(触发 sha 失配→删断点重下),第三次好
    let badCalls = 0;
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      const pathPart = url.split('/resolve/rev0/')[1] ?? '';
      const file = pathPart.split('?')[0];
      const retryParam = url.includes('dshmem-retry=');
      const body = file === 'config.json' ? 'hello-part0' : retryParam || badCalls >= 2 ? 'hello-part1!' : 'CORRUPT-BYTES';
      if (file !== 'config.json' && !retryParam) badCalls++;
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(body));
          c.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-length': String(body.length) } });
    });
    const q = new ModelDownloadQueue(dataDir, { mirror: 'https://mirror.test', fetchImpl, retryDelaysMs: [1, 1], logger: noopLogger });
    const prog = await q.startEntry(entry);
    expect(prog.phase).toBe('done');
    expect(prog.overallReceived).toBe(23);
    expect(fetchImpl.mock.calls.filter((u) => String(u[0]).includes('dshmem-retry=1')).length).toBeGreaterThan(0);
    // 合成模型不在目录 → isDownloaded/deleteModel 走目录判据:状态按 none、删除拒绝
    expect(await q.isDownloaded('tiny')).toBe(false);
    expect(await q.deleteModel('tiny')).toEqual({ ok: false, error: '未知模型' });
    // 文件确实落盘且尺寸吻合
    const { stat } = await import('node:fs/promises');
    expect((await stat(join(dataDir, 'models', 'tiny', 'config.json'))).size).toBe(11);
    expect((await stat(join(dataDir, 'models', 'tiny', 'onnx', 'model.onnx'))).size).toBe(12);
    // 真实目录模型:预置文件后删除成功
    await mkdir(join(dataDir, 'models', 'bge-m3', 'onnx'), { recursive: true });
    await writeFile(join(dataDir, 'models', 'bge-m3', 'config.json'), 'x');
    expect(await q.deleteModel('bge-m3')).toEqual({ ok: true });
  });

  it('cancel keeps .part breakpoint and surfaces cancelled phase', async () => {
    const dataDir = join(await tmp(), `dlc-${Date.now()}`);
    await mkdir(dataDir, { recursive: true });
    const entry = tinyEntry();
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('config.json')) {
        return new Response('hello-part0', { status: 200, headers: { 'content-length': '11' } });
      }
      // 第二文件:流挂住直到 abort 信号,吐一个块后关闭——取消语义确定化
      const signal = init?.signal as AbortSignal | undefined;
      const stream = new ReadableStream({
        async start(controller) {
          await new Promise<void>((resolve) => {
            if (signal?.aborted) resolve();
            else signal?.addEventListener('abort', () => resolve(), { once: true });
          });
          controller.enqueue(new TextEncoder().encode('xx'));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-length': '12' } });
    });
    const q = new ModelDownloadQueue(dataDir, { mirror: 'https://mirror.test', fetchImpl, logger: noopLogger });
    const p = q.startEntry(entry);
    // 等 file 1 完成、file 2 流挂住后取消
    await new Promise((r) => setTimeout(r, 30));
    expect(q.cancel()).toBe(true);
    const prog = await p;
    expect(prog.phase).toBe('cancelled');
    expect(await q.isBusy()).toBe(false);
    // .part 断点保留(取消不删断点;取消检查先于写盘,故为 0 字节空断点)
    const { stat } = await import('node:fs/promises');
    expect((await stat(join(dataDir, 'models', 'tiny', 'onnx', 'model.onnx.part'))).isFile()).toBe(true);
  });
});

describe('runtime installer', () => {
  function fakeSpawn(dataDir: string, codes: number[]) {
    let call = 0;
    const commands: Array<{ cmd: string; args: string[] }> = [];
    const spawnImpl = vi.fn((cmd: string, args: string[], cwd: string): { onStdout: (cb: (l: string) => void) => void; onStderr: (cb: (l: string) => void) => void; kill: () => void; exited: Promise<number | null> } => {
      commands.push({ cmd, args });
      const callIndex = call;
      const code = codes[Math.min(callIndex, codes.length - 1)];
      call++;
      const exited = (async () => {
        if (code === 0) {
          // 模拟 npm 成功效果:把钉死版本的 package.json 落盘(installedVersion 读盘判据)
          const { mkdir, writeFile } = await import('node:fs/promises');
          const pkgDir = join(cwd, 'node_modules', '@huggingface', 'transformers');
          await mkdir(pkgDir, { recursive: true });
          await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ name: '@huggingface/transformers', version: PINNED_TRANSFORMERS_VERSION }));
        }
        return code;
      })();
      return {
        onStdout: () => {},
        onStderr: () => {},
        kill: () => {},
        exited,
      };
    });
    return { spawnImpl, commands, getCalls: () => call };
  }

  it('ensures runtime via npm ci with lockfile, falls back to install on ci failure', async () => {
    const dataDir = join(await tmp(), `ri-${Date.now()}`);
    await mkdir(dataDir, { recursive: true });
    const lock = JSON.stringify({ lockfileVersion: 3, name: 'dsh-memory-runtime' });
    const lockPath = join(await tmp(), `lock-${Date.now()}.json`);
    await writeFile(lockPath, lock);
    const { spawnImpl, commands } = fakeSpawn(dataDir, [1, 0]);
    const installer = new RuntimeInstaller(dataDir, PINNED_TRANSFORMERS_VERSION, { spawnImpl, lockfileSource: lockPath, logger: noopLogger });
    expect(await installer.isReady()).toBe(false);
    expect(await installer.ensure()).toBe(true);
    // 第一次 ci(失败)→ 第二次 install 成功
    expect(commands[0].args[0]).toBe('ci');
    expect(commands[1].args[0]).toBe('install');
    expect(commands[1].args.at(-1)).toBe(`@huggingface/transformers@${PINNED_TRANSFORMERS_VERSION}`);
    const anchored = JSON.parse(await readFile(join(dataDir, 'runtime', 'package.json'), 'utf-8'));
    expect(anchored.dependencies['@huggingface/transformers']).toBe(PINNED_TRANSFORMERS_VERSION);
    expect(installer.getProgress().phase).toBe('ready');
    // 二次 ensure 幂等就绪
    expect(await installer.ensure()).toBe(true);
  });

  it('version-matched install short-circuits to ready without spawning npm', async () => {
    const dataDir = join(await tmp(), `ri2-${Date.now()}`);
    const { spawnImpl, getCalls } = fakeSpawn(dataDir, [0]);
    const installer = new RuntimeInstaller(dataDir, PINNED_TRANSFORMERS_VERSION, { spawnImpl, lockfileSource: join(dataDir, 'none.json') });
    // 预置已就位的 package.json + sharp 平台原生件(isReady 兼验 native,fix #11 半装检测)
    await mkdir(join(dataDir, 'runtime', 'node_modules', '@huggingface', 'transformers'), { recursive: true });
    await writeFile(join(dataDir, 'runtime', 'node_modules', '@huggingface', 'transformers', 'package.json'), JSON.stringify({ name: 'x', version: PINNED_TRANSFORMERS_VERSION }));
    const cand = installer.sharpNativeCandidates()[0];
    await mkdir(dirname(cand.binding), { recursive: true });
    await writeFile(cand.binding, 'fake-binding');
    await mkdir(cand.libvipsDir, { recursive: true });
    await writeFile(join(cand.libvipsDir, 'libvips-fake.dll'), 'x');
    expect(await installer.isReady()).toBe(true);
    expect(await installer.ensure()).toBe(true);
    expect(getCalls()).toBe(0);
  });

  it('isReady=false 当 sharp 原生件缺失(半装状态);删 libvips 库文件即触发重装(fix #11 task_7)', async () => {
    const dataDir = join(await tmp(), `ri3-${Date.now()}`);
    const { spawnImpl } = fakeSpawn(dataDir, [0]);
    const installer = new RuntimeInstaller(dataDir, PINNED_TRANSFORMERS_VERSION, { spawnImpl, lockfileSource: join(dataDir, 'none.json'), logger: noopLogger });
    // 只有 transformers package.json、无 @img 原生包 → 半装,未就绪
    await mkdir(join(dataDir, 'runtime', 'node_modules', '@huggingface', 'transformers'), { recursive: true });
    await writeFile(join(dataDir, 'runtime', 'node_modules', '@huggingface', 'transformers', 'package.json'), JSON.stringify({ name: 'x', version: PINNED_TRANSFORMERS_VERSION }));
    expect(await installer.isReady()).toBe(false);
    // 补齐原生件 → 就绪
    const cand = installer.sharpNativeCandidates()[0];
    await mkdir(dirname(cand.binding), { recursive: true });
    await writeFile(cand.binding, 'fake-binding');
    await mkdir(cand.libvipsDir, { recursive: true });
    const dll = join(cand.libvipsDir, 'libvips-42.dll');
    await writeFile(dll, 'x');
    expect(await installer.isReady()).toBe(true);
    // 手动删 dll → isReady() === false(触发重装)
    await rm(dll);
    expect(await installer.isReady()).toBe(false);
  });
});

describe('local embedding service (fake channel)', () => {
  function fakeChannel(): { channel: EmbedWorkerChannel; replies: Array<(call: { type: string }) => EmbedWorkerReply>; failAll: (e: string) => void } {
    const pending: Array<(c: { type: string }) => EmbedWorkerReply> = [];
    let crashCb: ((e: string) => void) | undefined;
    return {
      replies: pending,
      failAll: (e: string) => crashCb?.(e),
      channel: {
        request: async (call) => {
          const make = pending[pending.length - 1];
          return make ? make(call) : { id: 0, ok: true, type: 'pong' };
        },
        terminate: () => {},
        setOnCrash: (cb) => {
          crashCb = cb;
        },
      },
    };
  }

  function entry(): CatalogEntry {
    return { ...MODEL_CATALOG[0], id: 'fake', files: [] };
  }

  it('state machine: warmup ready → embed → terminate rejects further use', async () => {
    const dataDir = await tmp();
    const f = fakeChannel();
    f.replies.push(() => ({ id: 1, ok: true, type: 'ready' }));
    const svc = new LocalEmbeddingService(entry(), join(dataDir, 'models', 'fake'), {
      runtimeDir: join(dataDir, 'runtime'),
      channel: f.channel,
      logger: noopLogger,
    });
    expect(svc.isReady()).toBe(false);
    f.replies.push((call) =>
      call.type === 'embed'
        ? { id: 2, ok: true, type: 'embedded', vectors: [new Float32Array(512).fill(0.5)] }
        : { id: 2, ok: true, type: 'ready' },
    );
    await svc.waitForReady();
    expect(svc.isReady()).toBe(true);
    expect(svc.getState()).toBe('ready');
    const vecs = await svc.embedBatch(['hello']);
    expect(vecs[0].length).toBe(512);
    svc.close();
    expect(svc.getState()).toBe('terminated');
    await expect(svc.embedBatch(['x'])).rejects.toThrow('不可复用');
  });

  it('load failure transitions to failed; embed throws until retried via warmup', async () => {
    const dataDir = await tmp();
    const f = fakeChannel();
    f.replies.push(() => ({ id: 1, ok: false, stage: 'load', error: '模型文件坏' }));
    const svc = new LocalEmbeddingService(entry(), join(dataDir, 'models', 'fake'), {
      runtimeDir: join(dataDir, 'runtime'),
      channel: f.channel,
      logger: noopLogger,
    });
    await expect(svc.waitForReady()).rejects.toThrow('模型文件坏');
    expect(svc.getState()).toBe('failed');
    await expect(svc.embedBatch(['x'])).rejects.toThrow('加载失败');
    // 恢复:warmup 成功
    f.replies.push(() => ({ id: 3, ok: true, type: 'ready' }));
    await svc.waitForReady();
    expect(svc.isReady()).toBe(true);
  });
});

describe('proxy resolution', () => {
  it('three-state semantics with NO_PROXY respect and masking', () => {
    expect(resolveProxyUrl('http://p:1', 'hf-mirror.com')).toBe('http://p:1');
    expect(resolveProxyUrl('none', 'x')).toBe('');
    const saved = { ...process.env };
    delete process.env.HTTPS_PROXY; delete process.env.https_proxy; delete process.env.ALL_PROXY; delete process.env.all_proxy; delete process.env.HTTP_PROXY; delete process.env.http_proxy; delete process.env.NO_PROXY; delete process.env.no_proxy;
    try {
      expect(resolveProxyUrl(undefined, 'x')).toBe('');
      process.env.HTTPS_PROXY = 'http://env-proxy:7890';
      expect(resolveProxyUrl('', 'hf-mirror.com')).toBe('http://env-proxy:7890');
      process.env.NO_PROXY = 'hf-mirror.com,.example.com';
      expect(resolveProxyUrl('', 'hf-mirror.com')).toBe('');
      expect(resolveProxyUrl('', 'sub.example.com')).toBe('');
      expect(resolveProxyUrl('', 'other.com')).toBe('http://env-proxy:7890');
    } finally {
      process.env = saved;
    }
    expect(maskProxyUrl('http://user:pass@p:1')).toBe('http://p:1');
    expect(maskProxyUrl('not a url')).toBe('<invalid-url>');
  });
});

describe('embedding manager', () => {
  it('apply chain switches to off and persists; busy guard works', async () => {
    const dataDir = join(await tmp(), `mgr-${Date.now()}`);
    await mkdir(dataDir, { recursive: true });
    const c = cfg();
    const store = new EmbeddingSourceStore(dataDir);
    await store.init();
    const downloader = new ModelDownloadQueue(dataDir, { mirror: 'https://hf-mirror.com' });
    const installer = new RuntimeInstaller(dataDir, PINNED_TRANSFORMERS_VERSION, { logger: noopLogger });
    const db = {
      swapProvider: vi.fn(() => ({ ok: true, needsReindex: false })),
      markEmbeddingSynced: vi.fn(),
      // snapshot() 附带向量计数后,桩件必须覆盖这几个查询——
      // `as never` 会绕过类型,漏掉哪个只会在跑的时候炸(2026-09-17 实测)
      getVecSkipSet: () => new Set<string>(),
      countL1Vec: () => 0,
      countL1Retired: () => 0,
      countL1: () => 0,
      countL1VecMissing: () => 0,
      countL0Vec: () => 0,
      countL0: () => 0,
      countL0VecMissing: () => 0,
    } as never;
    const l1 = { setEmbeddingService: vi.fn() } as never;
    const manager = new EmbeddingManager({
      dataDir, cfg: c, db, l1, sourceStore: store, installer, downloader,
      initial: { svc: new NoopEmbeddingService(), dims: 0 },
      logger: noopLogger,
    });
    const accepted = manager.requestSource({ source: 'off' });
    expect(accepted.accepted).toBe(true);
    // 轮询等 apply 完成
    for (let i = 0; i < 50 && manager.isBusy(); i++) await new Promise((r) => setTimeout(r, 10));
    const snap = await manager.snapshot();
    expect(snap.apply.phase).toBe('done');
    expect(snap.source).toBe('off');
    expect(store.get().source).toBe('off');
    // off 档后 remote 请求:ceiling 按 eff() 判定(此处部署配置齐备)→ 接受
    const acc2 = manager.requestSource({ source: 'remote' });
    expect(acc2.accepted).toBe(true);
    for (let i = 0; i < 50 && manager.isBusy(); i++) await new Promise((r) => setTimeout(r, 10));
    expect((await manager.snapshot()).apply.phase).toBe('done');
    manager.dispose();
  });
});

describe('makeLocalServiceFactory', () => {
  it('returns null for unknown model and wires dirs for known ones', async () => {
    const dataDir = await tmp();
    const installer = new RuntimeInstaller(dataDir, PINNED_TRANSFORMERS_VERSION, { logger: noopLogger });
    const downloader = new ModelDownloadQueue(dataDir, { mirror: 'https://hf-mirror.com' });
    // childPath 指向 resources 真源文件:源码态下 dist 产物不存在,同时顺带验证 fork 通道能起
    const childPath = fileURLToPath(new URL('../resources/embedding-child.cjs', import.meta.url));
    const factory = makeLocalServiceFactory(installer, downloader, noopLogger, 4000, childPath);
    expect(factory('no-such-model')).toBeNull();
    const svc = factory('bge-m3');
    expect(svc).not.toBeNull();
    expect(svc).toBeInstanceOf(LocalEmbeddingService);
    svc?.close();
  });
});

/**
 * 手动重建(embedding-reindex)。
 *
 * 这组用例的重点**不是**"能不能跑起来",而是**该拒绝的时候有没有拒绝**:
 * `L1Store.reindex` 在向量能力未就绪时静默返回 0/0/0(l0 腿随 T8.4 写停退役),
 * 若入口不设门槛,受理一个"根本不会跑"的请求就等于向用户谎报"重建成功、零条待补"。
 * 因此每条拒绝路径都要同时断言 **抛错** 且 **下游一次都没被调用**。
 */
describe('manual reindex (embedding-reindex)', () => {
  async function mk(over: { vectorsReady?: boolean; sideEffectsOnly?: boolean; none?: boolean } = {}) {
    const dataDir = join(await tmp(), `reindex-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    await mkdir(dataDir, { recursive: true });
    const store = new EmbeddingSourceStore(dataDir);
    await store.init();
    const downloader = new ModelDownloadQueue(dataDir, { mirror: 'https://hf-mirror.com' });
    const installer = new RuntimeInstaller(dataDir, PINNED_TRANSFORMERS_VERSION, { logger: noopLogger });
    const l1Reindex = vi.fn(async () => ({ written: 1, failed: 0, skipped: 0 }));
    const ready = over.vectorsReady ?? true;
    const l1 = { setEmbeddingService: vi.fn(), vectorsReady: () => ready, reindex: l1Reindex } as never;
    const db = {
      swapProvider: vi.fn(() => ({ ok: true, needsReindex: false })),
      markEmbeddingSynced: vi.fn(),
      getVecSkipSet: () => new Set<string>(),
      countL1Vec: () => 3,
      countL1Retired: () => 0,
      countL1: () => 5,
      countL1VecMissing: () => 2,
      countL0Vec: () => 7,
      countL0: () => 9,
      countL0VecMissing: () => 2,
    } as never;
    const svc = {
      isReady: () => true,
      getProviderInfo: () => ({ provider: 'remote', model: 'm', dimensions: 8 }),
      getDimensions: () => 8,
    } as never;
    const initial = over.none
      ? { svc: new NoopEmbeddingService(), dims: 0 }
      : { svc, dims: 8, providerInfo: { provider: 'remote', model: 'm', dimensions: 8 } };
    const manager = new EmbeddingManager({
      dataDir, cfg: cfg(), db, l1, sourceStore: store, installer, downloader, initial, logger: noopLogger,
    });
    return { manager, l1Reindex };
  }

  it('嵌入源关闭（无 providerInfo）→ 拒绝，且下游一次都没跑', async () => {
    const { manager, l1Reindex } = await mk({ none: true });
    expect(() => manager.startReindex()).toThrow(/嵌入源已关闭/);
    await new Promise((r) => setTimeout(r, 20));
    expect(l1Reindex).not.toHaveBeenCalled();
    manager.dispose();
  });

  it('向量能力未就绪 → 拒绝，不谎报「已受理」', async () => {
    const { manager, l1Reindex } = await mk({ vectorsReady: false });
    expect(() => manager.startReindex()).toThrow(/未就绪/);
    await new Promise((r) => setTimeout(r, 20));
    expect(l1Reindex).not.toHaveBeenCalled();
    manager.dispose();
  });

  it('受理后跑 L1；running 是同步置位的，并发第二次触发立即被拒', async () => {
    const { manager, l1Reindex } = await mk();
    let release: () => void = () => {};
    l1Reindex.mockImplementation(
      () => new Promise((r) => { release = () => r({ written: 0, failed: 0, skipped: 0 }); }),
    );
    expect(manager.startReindex()).toEqual({ accepted: true });
    // 不 await：reindexNow 在首个 await 之前就把 running 置了 true
    expect(() => manager.startReindex()).toThrow(/已在进行中/);
    await Promise.resolve();
    expect(l1Reindex).toHaveBeenCalledTimes(1);
    release();
    for (let i = 0; i < 50; i++) {
      if (!(await manager.snapshot()).reindex.running) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect((await manager.snapshot()).reindex.running).toBe(false);
    manager.dispose();
  });
  
  it('跑完留下 `reindex.last`：处理/计划/失败/前后待补数都可确认', async () => {
    // 这条钉的是真机反馈的后半句：“索引重设的效果无法确认”。进度条只在 running 期间存在，
    // 而“待补 0 条”的重建会瞬间跑完，没留痕就与“点了没反应”完全同形。
    const { manager } = await mk();
    expect((await manager.snapshot()).reindex.last).toBeUndefined();
  
    manager.startReindex();
    for (let i = 0; i < 50; i++) {
      if (!(await manager.snapshot()).reindex.running) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const last = (await manager.snapshot()).reindex.last;
    expect(last).toBeDefined();
    // 默认桩：两层各 written 1 条、无失败；db 桩给 L1 5/3、L0 9/7 → 相减待补各 2
    expect([last!.processed, last!.planned, last!.failed, last!.cancelled]).toEqual([0, 0, 0, false]);
    expect(last!.missingBefore).toEqual({ l1: 2, l0: 2 });
    expect(last!.missingAfter).toEqual({ l1: 2, l0: 2 });
    expect(last!.durationMs).toBeGreaterThanOrEqual(0);
    expect(last!.finishedAt).toBeGreaterThan(0);
    manager.dispose();
  });
  
  it('失败条数与取消标志会落进 last（不能只报“跑完了”）', async () => {
    const { manager, l1Reindex } = await mk();
    l1Reindex.mockImplementation(async (opts?: { onProgress?: (d: number, t: number) => void }) => {
      opts?.onProgress?.(4, 4);
      return { written: 3, failed: 1, skipped: 0 };
    });
    manager.startReindex();
    for (let i = 0; i < 50; i++) {
      if (!(await manager.snapshot()).reindex.running) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const last = (await manager.snapshot()).reindex.last;
    expect([last!.processed, last!.planned, last!.failed]).toEqual([4, 4, 1]);
    manager.dispose();
  });
  
  it('卸载后拒绝', async () => {
    const { manager } = await mk();
    manager.dispose();
    expect(() => manager.startReindex()).toThrow(/已卸载/);
  });

  it('snapshot 附带向量计数（口径：embedded/total/missing/skipped）', async () => {
    const { manager } = await mk();
    const snap = await manager.snapshot();
    expect(snap.vectors.l1).toEqual({ embedded: 3, total: 5, missing: 2, skipped: 0 });
    expect(snap.vectors.l0).toEqual({ embedded: 7, total: 9, missing: 2, skipped: 0 });
    manager.dispose();
  });
});
