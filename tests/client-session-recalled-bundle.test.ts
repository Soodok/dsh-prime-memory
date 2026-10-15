/**
 * G-live「本会话召回」显示层的边界守卫（读构建产物，纯 node 断言，不拉 DOM）。
 *
 * 钉住几件易被回退的事（0.25.0 起「本会话召回」的 pill 渲染已移交 dsh-brief-sidebar）：
 *   1. **pill 不再重复渲染召回**：prime-memory 的 client 浮层不再挂 `session-recalled` 端点/
 *      「本会话召回」区块（输入区弹窗再渲染一份就是重复）——`dist/client.js` 不得再出现这些串；
 *   2. **形式不挂持久槽位**：`memorySlots` 投影（dist/projection/slots.js）不得出现任何
 *      recalled 痕迹——召回集一旦流经投影，就会被渲染成"槽位注册表"，而召回不是常驻约定；
 *   3. **展示契约不抽掉**：服务端入口继续接线 slots 投影。宿主对缺席是优雅降级
 *      （key 从快照消失、读作 capability absence），所以摘注册不致会话加载失败，
 *      但会让旧版 dsh-brief-sidebar 默默丢分区——隐藏该走它的开关，不是抽契约。
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
  it('pill 不再渲染本会话召回（0.25.0 移交 brief-sidebar，防重复渲染回退）', () => {
    // 召回展示已由 dsh-brief-sidebar 接管；prime-memory 输入区弹窗再渲染一份就是重复。
    // SessionRecalledArea 组件文件保留以备回滚，但不再被 import → 这些串不该进包。
    expect(client).not.toContain('dsh-memory/session-recalled');
    expect(client).not.toContain('本会话召回');
    expect(client).not.toContain('recalled-superseded');
  });

  it('投影侧（memorySlots）不得挂任何召回痕迹——形式不是持久槽位', () => {
    expect(slotsProjection).not.toMatch(/recalled/i);
    expect(slotsProjection).not.toContain('session-recalled');
  });

  it('服务端入口继续接线 slots 投影（不抽掉跨插件展示契约）', () => {
    // 抽注册本身不会弄坏会话（宿主读作 capability absence），但旧版 brief-sidebar
    // 会默默丢分区；要隐藏请用它的「记忆槽位分区」开关。
    expect(serverEntry).toContain('projection/slots');
  });

  it('memoryRecall 投影已接线（brief 侧栏「本会话召回」分区的数据源）', () => {
    expect(serverEntry).toContain('projection/recall');
    const recall = readFileSync(join(HERE, '..', 'dist', 'projection', 'recall.js'), 'utf8');
    expect(recall).toContain('memoryRecall');
    // 召回集不得反过来挂到槽位投影上（两边各走各的 key）。
    expect(slotsProjection).not.toContain('memoryRecall');
  });
});
