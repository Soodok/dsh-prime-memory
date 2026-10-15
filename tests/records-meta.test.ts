/**
 * `dsh-memory/records-meta` 契约：按 record_id 批量取全量元数据 + 正文。
 *
 * 这是记忆查看器唯一的数据来源（不再读 `.memory.md` 文件），所以钉三件事：
 * 1. 字段齐备且 `filePath` 与投射写盘同一算法（`relPathFor`），不是另算一份；
 * 2. 入参非法（空/非数组/过滤后为空）一律抛错，由 RPC 壳转成 ok:false——
 *    查看器据此显示可读原因，而不是拿到半份数据渲染成 [object Object]；
 * 3. 无 `name` 的存量记录回落 `mem-<id 后 8 位>` 文件名，不产出空路径。
 */
import { describe, expect, it } from 'vitest';
import { handleEndpoint, type EndpointDeps } from '../src/stats.js';

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function deps(getByIds: (ids: string[]) => unknown[]): EndpointDeps {
  return { cfg: {}, stores: { l1: { getByIds } }, logger } as unknown as EndpointDeps;
}

const named = {
  id: 'mem_1789884509038_f4fa34',
  type: 'work_fact',
  name: '核心重构-proposal.ts重命名为bene',
  content: '## 结论/事实\n核心重构已完成。',
  priority: 85,
  createdAt: 1758377429000,
  updatedAt: 1760486280000,
  scene_name: '围绕 dsh-context-compression 的团队重构',
  scope: 'workspace',
  workspaceId: 'e:/test/rewrite-agently',
  metadata: { dsh_keywords: ['benefit.ts'], dsh_usage_scenario: ['当讨论重命名时'] },
};

describe('dsh-memory/records-meta', () => {
  it('返回全量元数据 + 正文，filePath 与投射同源', async () => {
    const res = (await handleEndpoint('dsh-memory/records-meta', { ids: [named.id] }, deps(() => [named]))) as {
      items: Array<Record<string, unknown>>;
    };
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      id: named.id,
      name: named.name,
      type: 'work_fact',
      content: named.content,
      scope: 'workspace',
      workspaceId: 'e:/test/rewrite-agently',
      keywords: ['benefit.ts'],
      usageScenario: ['当讨论重命名时'],
      filePath: 'work_fact/核心重构-proposal.ts重命名为bene.memory.md',
      retired: false,
    });
    expect(typeof res.items[0]!.createdAt).toBe('string');
    expect(typeof res.items[0]!.maturity).toBe('string');
  });

  it('无 name 的存量记录仍给出可用文件名（回落 mem-<id 尾>）', async () => {
    const legacy = { ...named, name: undefined };
    const res = (await handleEndpoint('dsh-memory/records-meta', { ids: [named.id] }, deps(() => [legacy]))) as {
      items: Array<Record<string, unknown>>;
    };
    expect(res.items[0]!.name).toBeNull();
    expect(String(res.items[0]!.filePath)).toMatch(/^work_fact\/.+\.memory\.md$/);
  });

  it('global 记录不带 workspaceId，退场标记如实透出', async () => {
    const g = { ...named, scope: 'global', workspaceId: undefined, validTo: 1760500000000 };
    const res = (await handleEndpoint('dsh-memory/records-meta', { ids: [named.id] }, deps(() => [g]))) as {
      items: Array<Record<string, unknown>>;
    };
    expect(res.items[0]).toMatchObject({ scope: 'global', workspaceId: null, retired: true });
  });

  it('入参非法一律抛错：空数组 / 非数组 / 过滤后为空', async () => {
    const d = deps(() => [named]);
    await expect(handleEndpoint('dsh-memory/records-meta', { ids: [] }, d)).rejects.toThrow();
    await expect(handleEndpoint('dsh-memory/records-meta', { ids: 'mem_x' }, d)).rejects.toThrow();
    await expect(handleEndpoint('dsh-memory/records-meta', { ids: [7, null] }, d)).rejects.toThrow();
    await expect(handleEndpoint('dsh-memory/records-meta', {}, d)).rejects.toThrow();
  });

  it('ids 超上限被截到 50，不把整库拉出来', async () => {
    let seen = 0;
    const res = (await handleEndpoint(
      'dsh-memory/records-meta',
      { ids: Array.from({ length: 80 }, (_, i) => `mem_${i}`) },
      deps((ids) => {
        seen = ids.length;
        return [];
      }),
    )) as { items: unknown[] };
    expect(seen).toBe(50);
    expect(res.items).toEqual([]);
  });
});
