import { describe, expect, it } from 'vitest';

import { liveSettingsSchema } from '../src/config.js';
import { readLiveRef } from '../src/settings.js';

// 老线断裂实录：0.1.5-rc.3 的纯净格解析到 schemastery/cordis 4.0.2，它没有
// `Schema.object(...).volatile()`。原代码无条件调用 → 整插件 load-failure（不是降级，
// 是起不来）。旧格子里 cordis 漂到了 4.0.4，把这个坑掩盖了一整个季度。
describe('live 节在不支持 volatile 的老 schemastery 上仍可构建与读取', () => {
  it('liveSettingsSchema() 不抛（本机 devDeps 支持 volatile，两种分支都得活着）', () => {
    expect(() => liveSettingsSchema()).not.toThrow();
  });

  it('readLiveRef 接 Volatile 引用（有 .get()）', () => {
    const payload = { enabled: true } as never;
    let pulls = 0;
    const ref = {
      get: () => {
        pulls++;
        return payload;
      },
    };
    expect(readLiveRef(ref)).toBe(payload);
    expect(pulls).toBe(1); // 现取现读，不多拽一次
  });

  it('readLiveRef 接老线冻结值（没有 .get()）—— 这是崩溃与可用的分水岭', () => {
    const plain = { enabled: false } as never;
    expect(readLiveRef(plain)).toBe(plain);
    // 空引用也不能抛：调用点每次操作都读，抛了就是整条链路挂掉
    expect(() => readLiveRef(undefined)).not.toThrow();
    expect(readLiveRef(undefined)).toBeUndefined();
  });
});
