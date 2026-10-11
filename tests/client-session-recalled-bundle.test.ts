/**
 * G-live「本会话召回」显示层的边界守卫（读构建产物，纯 node 断言，不拉 DOM）。
 *
 * 钉住两件易被回退的事：
 *   1. 显示在 **client 浮层**（pill）里：端点字面量与区块标题必须进 `dist/client.js`；
 *   2. **形式不挂持久槽位**：服务端入口（dist/index.js）不得接线 `projection/slots`
 *      （那张侧栏卡把召回/约定渲染成槽位注册表，用户已明确否决）；且投影模块自身
 *      不得出现任何 recalled 痕迹——防止以后有人“把召回接回投影”而不是另开显示面。
 *
 * 不证明：真的按会话渲染出正确条目——那仍是真机 GUI 检查（与 client-entry.test.ts 同一边界）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const client = readFileSync(join(HERE, '..', 'dist', 'client.js'), 'utf8');
const serverEntry = readFileSync(join(HERE, '..', 'dist', 'index.js'), 'utf8');
const slotsProjection = readFileSync(join(HERE, '..', 'dist', 'projection', 'slots.js'), 'utf8');

describe('本会话召回显示层（构建产物）', () => {
  it('client 侧消费 session-recalled 端点并渲染区块标题', () => {
    expect(client).toContain('dsh-memory/session-recalled');
    expect(client).toContain('本会话召回');
  });

  it('投影侧（memorySlots）不得挂任何召回痕迹——形式不是持久槽位', () => {
    expect(slotsProjection).not.toMatch(/recalled/i);
    expect(slotsProjection).not.toContain('session-recalled');
  });

  it('服务端入口不接线 slots 投影（侧栏不再出常驻槽位卡）', () => {
    // 投影模块本体有意保留（契约测试可证），但 index 不得 import 它；
    // 拿 import 路径而非 key 名作断言：index.ts 里的“为何不接”注释合法含 memorySlots 字样。
    expect(serverEntry).not.toContain('projection/slots');
  });
});
