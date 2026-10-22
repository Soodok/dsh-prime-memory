/**
 * 冒烟自检(构建产物协议断言):对 dist/ 产物与包契约做最小组的"能装、能引、形状对"验证。
 *
 * 重写版定位调整:原 4000 行手写断言大棚中的行为级断言已随净室重写逐模块迁入
 * vitest(tests/*.test.ts,147 用例——那是行为等价的主验收面);本文件只保留
 * dist 产物协议断言(老版本 smoke 的"防陈旧产物"职责):
 * - 包入口与 client handoff 协议(window.__ModuleLoader__.load 包裹);
 * - worker/lockfile 资产就位;
 * - 类型契约与包元数据一致(端点数/包名/版本)。
 * 运行:npm run smoke(先 build:smoke 编译本文件,再 node 执行)。
 */
import { readFile, access } from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`✓ ${name}`);
  } else {
    failures++;
    console.error(`✗ ${name}${detail ? `: ${detail}` : ''}`);
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  // ── dist 产物就位 ──
  const dist = path.join(root, 'dist');
  for (const f of ['index.js', 'index.d.ts', 'client.js', 'embedding-worker.cjs', 'embedding-child.cjs', 'runtime-package-lock.json', 'contract.d.ts', 'store/sqlite.js']) {
    check(`dist/${f} 存在`, await exists(path.join(dist, f)));
  }

  // ── client handoff 协议(react external + ModuleLoader 包装 + bundle id) ──
  const client = await readFile(path.join(dist, 'client.js'), 'utf-8');
  check('client.js: __ModuleLoader__.load 包装', client.startsWith('window.__ModuleLoader__.load({'));
  check('client.js: bundle id 与包名一致', client.includes('"dsh-prime-memory"'));
  check('client.js: react external(require 调用存在)', client.includes('require("react")'));
  check('client.js: 无裸 import(纯 CJS 体)', !/^import[\s{"' ]/m.test(client));

  // ── worker/child 协议头(workerData/env 消费 + transformers 本地加载) ──
  const worker = await readFile(path.join(dist, 'embedding-worker.cjs'), 'utf-8');
  check('worker: 读取 workerData', worker.includes('workerData'));
  check('worker: transformers 本地加载(禁远程模型)', worker.includes('allowRemoteModels = false'));
  const child = await readFile(path.join(dist, 'embedding-child.cjs'), 'utf-8');
  check('child: 读取 env DSH_EMBED_CFG', child.includes('DSH_EMBED_CFG'));
  check('child: transformers 本地加载(禁远程模型)', child.includes('allowRemoteModels = false'));
  check('child: 向量序列化为普通数组(settle 经 Array.from)', child.includes('Array.from'));
  // 主线程侧默认通道必须是子进程(fix #11):local-embedding.js 不得只剩 worker 路径
  const localEmbed = await readFile(path.join(dist, 'store', 'local-embedding.js'), 'utf-8');
  check('child: 主线程默认走 RealChildChannel', localEmbed.includes('RealChildChannel') && localEmbed.includes('embedding-child.cjs'));

  // ── 包入口可加载 + 导出面(名字/inject/Config schema 形状) ──
  const entry = (await import(pathToFileURL(path.join(dist, 'index.js')).href)) as {
    name: string;
    inject: string[];
    Config: { __type?: string } & ((v?: unknown) => unknown);
  };
  check('entry.name = dsh-memory-plugin', entry.name === 'dsh-memory-plugin');
  // 0.1.5 起 rpc.handle 按调用方 fiber 校验 webServer 授权,故 inject 补声明 connection+webServer
  // (见 src/index.ts:52-58)。此处断言须与声明同步,否则 smoke 会红。
  check(
    'entry.inject = [llm, tools, systemPrompt, connection, webServer]',
    JSON.stringify(entry.inject) === JSON.stringify(['llm', 'tools', 'systemPrompt', 'connection', 'webServer']),
  );
  // Config 是 schemastery schema 对象(可调用产出默认值):调用一次验证形状
  const defaults = (entry.Config as unknown as (v: unknown) => Record<string, unknown>)({});
  check('Config 产出部署默认键', ['dataDir', 'family', 'capture', 'extract', 'l2', 'l3', 'recall', 'embedding', 'llm', 'hall', 'tokenCost', 'tools', 'benchControl', 'conflictFreeze'].every((k) => k in defaults));
  check('Config 默认 family=auto', (defaults.family as string) === 'auto');

  // ── 类型契约与端点面 ──
  const contractDts = await readFile(path.join(dist, 'contract.d.ts'), 'utf-8');
  const endpointCount = (contractDts.match(/'dsh-memory\//g) ?? []).length;
  check('contract.d.ts 含 26 端点字面量(52 = 请求+响应映射)', endpointCount >= 52, `实际 ${endpointCount}`);
  check('contract.d.ts 含 records-delete', contractDts.includes("'dsh-memory/records-delete'"));
  check('contract.d.ts 含图谱端点', contractDts.includes("'dsh-memory/graph-search'") && contractDts.includes("'dsh-memory/graph-node-get'"));
  check('contract.d.ts 含 memoryMutate/embedRemote*', contractDts.includes('memoryMutate') && contractDts.includes('embedRemoteBaseURL'));

  // ── 包元数据 ──
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf-8')) as {
    version: string;
    main: string;
    files: string[];
    repository?: { url?: string };
  };
  check('package.json version 与 PLUGIN_VERSION 同步', PLUGIN_VERSION_SYNC === pkg.version);
  check('package.json main 指向 dist/index.js', pkg.main === 'dist/index.js');
  // 逐个核验 files 白名单的每一项(此前只查 README*/INSTALL*/CHANGELOG* 前缀,
  // 其余条目如 ENGINEERING-NOTES.md 会被静默跳过 → 文档漏发包也无人发现)。
  // access() 对目录同样有效,故 dist/assets 无需特判。
  for (const f of pkg.files) {
    check(`files 字段 ${f} 就位`, await exists(path.join(root, f)));
  }
  check('repository 指向 drscrewdriver 仓库', pkg.repository?.url?.includes('drscrewdriver') === true);

  console.log(failures === 0 ? '\n冒烟全部通过' : `\n${failures} 项失败`);
  if (failures > 0) process.exit(1);
}

// PLUGIN_VERSION 从 dist/index.js 取(与宿主运行时同源),避免第二处抄版本号
import { createRequire as _cr } from 'node:module';
const _require2 = _cr(import.meta.url);
const PLUGIN_VERSION_SYNC = (_require2(path.join(root, 'package.json')) as { version: string }).version;

main().catch((err) => {
  console.error(`smoke 崩溃: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
