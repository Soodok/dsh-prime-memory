/**
 * 回填**轮询必须带 `probe`**（构建产物级守卫，纯 node 断言，不拉 DOM）。
 *
 * 钉的是一个真机踩过的死循环：三个回填端点是「触发器 + 状态查询」二合一——
 * **空闲时裸调用会再开一轮**。轮询 tick 若用裸调用，就变成
 * 「跑完 → 3s 后 tick 又开一轮」的无底洞：日志每 3s 一条 `回填启动…回填结束`，
 * 面板永远停在「正在扫描存量…」，用户看到的就是「不开始」。
 *
 * 断言取 tick 的专有写法 `… , { probe: true }).then`：`resume` 路径是三元表达式
 * （`mode === "resume" ? { probe: true } : {}`）、触发路径是 `{}`，二者都不会命中这个串，
 * 所以它只在「轮询走 probe」时成立。
 *
 * 不证明：轮询间隔/上限等行为——那仍是真机 GUI 检查。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const client = readFileSync(join(HERE, '..', 'dist', 'client.js'), 'utf8');

describe('回填轮询只读（构建产物）', () => {
  it('keyword 轮询用 probe:true（裸调用会反复重开一轮）', () => {
    expect(client).toContain('dsh-memory/keyword-backfill", { probe: true }).then');
  });

  it('redistill 轮询用 probe:true（同款触发器陷阱）', () => {
    expect(client).toContain('dsh-memory/redistill-backfill", { probe: true }).then');
  });

  it('触发路径仍是不带 probe 的裸调用（否则按钮点不动）', () => {
    // 三条只读调用（tick/resume/cancel）都不该顶掉“点按钮就开跑”的能力：
    // 触发路径写成三元表达式的 else 分支 `: {}`，或启动调用带 `{}`。
    expect(client).toContain('mode === "resume" ? { probe: true } : {}');
  });

  it('wing 的轮询走 wing-overview（本就是只读端点，无需 probe）', () => {
    expect(client).toContain('dsh-memory/wing-overview');
    // wing 的 tick 不该调 wing-backfill（那会重开一轮）
    expect(client).not.toContain('dsh-memory/wing-backfill", { probe: true }).then');
  });
});