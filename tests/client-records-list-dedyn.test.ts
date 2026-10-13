/**
 * L1 记录面板「去动态 + 可用性」边界守卫（读构建产物，纯 node 断言，不拉 DOM）。
 *
 * 起因（2026-10-13 用户实测）：批量删除后面板自动重发上一条查询，而删除后检索面
 * 存在短暂迟滞，列表停在「加载中」、体感即「搜索框失效」。用户裁决：
 *   1. **去动态**——列表只在表单提交（搜索/回车/清空快捷键/筛选/刷新）时变化；
 *      删除/恢复只做本地行更新，不再自动 `fetchPage(last)` 重发查询；
 *   2. **输入框恒可用** + 清空快捷键（Esc / Ctrl+Backspace 清空并回全量列表）；
 *   3. **服务端软超时**——list-records 的关键词检索竞速 8s 上限，到期返回可重试的
 *      业务错误，不得把面板永久钉在加载态。
 *
 * 不证明：真机点击流（那仍是 farm 浏览器实测的边界）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const client = readFileSync(join(HERE, '..', 'dist', 'client.js'), 'utf8');
const statsRoute = readFileSync(join(HERE, '..', 'dist', 'stats.js'), 'utf8');

describe('记录面板去动态与可用性（构建产物）', () => {
  it('删除/恢复不再自动重发上一条查询（本地行更新，去动态）', () => {
    // 「加载更多/刷新」按钮仍合法地用 fetchPage(last)；只钉删除与恢复的**成功分支**
    // 不得再自动重查（那正是删除后检索迟滞被放大成「搜索框失效」的路径）。
    for (const endpoint of ['dsh-memory/records-delete', 'dsh-memory/records-restore']) {
      const at = client.indexOf(endpoint);
      expect(at).toBeGreaterThan(0);
      const branch = client.slice(at, at + 900);
      expect(branch).not.toContain('fetchPage(');
      expect(branch).toContain('setItems(');
    }
  });

  it('清空快捷键在：Esc / Ctrl+Backspace 清空关键词并回全量列表', () => {
    expect(client).toContain('Backspace');
    expect(client).toContain('Escape');
  });

  it('list-records 关键词检索带软超时护栏，超时返回可重试的业务错误', () => {
    expect(statsRoute).toContain('检索超时');
    expect(statsRoute).toContain('raceTimeout');
  });

  it('brief 声明过时的投射文件联动已异步化（不再 await 在 RPC 关键路径上）', () => {
    // recall-feedback 的 case 体内不允许 `await disableProjectionFile`；
    // 联动改为后台执行 + 完成后落日志。
    const fb = statsRoute.indexOf('用户声明记忆过时并退场');
    expect(fb).toBeGreaterThan(0);
    const body = statsRoute.slice(fb, fb + 4000);
    expect(body).not.toMatch(/await disableProjectionFile/);
    expect(body).toContain('disableProjectionFile');
    expect(body).toContain('失效联动(后台)');
  });
});
