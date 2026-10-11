/**
 * G-live「本会话召回」显示层的边界守卫（读构建产物，纯 node 断言，不拉 DOM）。
 *
 * 钉住两件易被回退的事：
 *   1. 显示在 **client 浮层**（pill）里：端点字面量与区块标题必须进 `dist/client.js`；
 *   2. **形式不挂持久槽位**：`memorySlots` 投影（dist/projection/slots.js）不得出现任何
 *      recalled 痕迹——召回集一旦流经投影，就会被宿主渲染成"槽位注册表"，
 *      而这不是常驻约定，属于语义错位（用户明确否掉过）。
 *
 * 不证明：真的按会话渲染出正确条目——那仍是真机 GUI 检查（与 client-entry.test.ts 同一边界）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const client = readFileSync(join(HERE, '..', 'dist', 'client.js'), 'utf8');
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
});
