/**
 * 声明面守卫:运行时 import 的裸包必须在 dependencies ∪ peerDependencies 里。
 *
 * 为什么钉这条:`@deepseek-ai/schemastery` 曾只写在 devDependencies,而
 * `src/config.ts` 是**运行时** `import Schema from '@deepseek-ai/schemastery'`
 * (类型专用语句会被编译擦除,值导入不会)。devDeps 不进包,装机后这一句解析到
 * 哪份库,取决于 profile 里**恰好还装了谁**——实测 0.1.5-rc.3 格只有 2 个插件
 * 声明 schemastery、0.1.7-rc.2 格有 14 个;拆掉那几个同侪,pm 就 MODULE_NOT_FOUND
 * 或绑到另一代 API 上(格内实测 schemastery 有 3.18.4 与 4.0.x 两代,`.volatile()`
 * 只在其中一代上有)。这类缺陷 typecheck 与 build 都看不见,只能在声明面钉。
 *
 * `import type …` / `export type …`(含刻意的 `import type {} from '…'` 声明合并)
 * 编译期擦除,不构成运行时绑定,故单列不计违规。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const HERE = import.meta.dirname;
const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/** 递归取仓根下某目录的所有 .ts 文件(跳过 node_modules)。 */
function tsFiles(rel: string, out: string[] = []): string[] {
  const dir = join(HERE, '..', rel);
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== 'node_modules') tsFiles(rel + '/' + e, out);
    } else if (e.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** 裸包名:scoped 取前两段,其余取首段。 */
function bareName(spec: string): string {
  return spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
}

interface ImportFact {
  name: string;
  typeOnly: boolean;
  file: string;
}

function importsOf(rel: string): ImportFact[] {
  const facts: ImportFact[] = [];
  for (const f of tsFiles(rel)) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/(?:^|\s)(?:import|export)\s+(.*?)\s*from\s*['"]([^'"]+)['"]/);
      if (m === null) continue;
      const spec = m[2];
      if (spec.startsWith('.') || spec.startsWith('node:')) continue;
      facts.push({
        name: bareName(spec),
        // 类型专用语句编译期擦除:没有运行时绑定
        typeOnly: /^\s*(?:import|export)\s+type[\s{]/.test(line),
        file: f.split(sep).join('/'),
      });
    }
  }
  return facts;
}

describe('运行时 import 必须被 dependencies/peerDependencies 声明', () => {
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
  const devOnly = new Set(Object.keys(pkg.devDependencies ?? {}));

  it('src(server 半,随包发布)无未声明的运行时 import', () => {
    const offenders = importsOf('src')
      .filter((i) => !i.typeOnly && !declared.has(i.name))
      .map((i) => `${i.name}${devOnly.has(i.name) ? '(仅 devDependencies!)' : '(完全没声明)'} ← ${i.file}`);
    expect(offenders).toEqual([]);
  });

  it('schemastery 这类宿主同侪库落在 dependencies,不是 devDependencies', () => {
    // 装机解析证据(格内实测):profile 平铺层把这份库共享给全部插件,
    // 谁声明谁带入——本包不自带就等于把运行时 API 交给运气。
    expect(pkg.dependencies?.['@deepseek-ai/schemastery']).toBeDefined();
    expect(devOnly.has('@deepseek-ai/schemastery')).toBe(false);
  });

  it('识别面自检:类型专用 import 与值 import 能区分开', () => {
    const facts = importsOf('src').filter((i) => i.name === '@deepseek-ai/schemastery');
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.some((i) => i.typeOnly === false)).toBe(true);
    // 反面对照:确有一条被正确判成 type-only(刻意声明合并用法),证明判定非恒真
    const typeOnlyNames = importsOf('src').filter((i) => i.typeOnly).map((i) => i.name);
    expect(typeOnlyNames).toContain('@deepseek-ai/cordis-plugin-loader');
  });
});
