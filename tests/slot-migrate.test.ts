/**
 * 旧 slot 语义迁移判据回归（cfg.slots.migrateLegacy）。
 *
 * 核心是"宁缺勿滥"：默认零动作；只有 open + pinned + rule 且 refs 解析到**未退场**
 * L1 记录（内容另有载体）才软退场。todo/anchor/pointer 一律不碰。
 */
import { describe, expect, it, vi } from 'vitest';
import { migrateLegacySlots, pickMigratableSlots } from '../src/pipeline/slot-migrate.js';
import type { SlotMigrateStoreFace, SlotMigrateL1Face } from '../src/pipeline/slot-migrate.js';
import type { Slot } from '../src/store/slots.js';

function slot(over: Partial<Slot>): Slot {
  return {
    id: 'slot_1',
    title: '规则',
    kind: 'rule',
    status: 'open',
    priority: 75,
    body: '正文',
    refs: [],
    pinned: true,
    origin: 'user',
    createdAt: '2026-10-03T18:34:00.000Z',
    updatedAt: '2026-10-03T18:34:00.000Z',
    ...over,
  } as Slot;
}

function storeOf(slots: Slot[]): SlotMigrateStoreFace & { closed: Array<{ id: string; status: string }> } {
  const closed: Array<{ id: string; status: string }> = [];
  return {
    closed,
    list: () => slots,
    close: async (id, status) => {
      closed.push({ id, status });
      return true;
    },
  };
}

const l1With = (alive: string[], retired: string[] = []): SlotMigrateL1Face => ({
  getByIds: (ids) => [
    ...alive.filter((id) => ids.includes(id)).map((id) => ({ id })),
    ...retired.filter((id) => ids.includes(id)).map((id) => ({ id, validTo: 1_760_000_000_000 })),
  ],
});

describe('migrateLegacySlots：开关与判据', () => {
  it('默认关 → 零动作（连 list 都不必碰）', async () => {
    const store = storeOf([slot({ refs: ['mem_a'] })]);
    expect(await migrateLegacySlots(store, l1With(['mem_a']), false)).toBe(0);
    expect(store.closed).toEqual([]);
  });

  it('open + pinned + rule + refs 命中活记录 → 软退场 dropped', async () => {
    const store = storeOf([slot({ id: 's1', refs: ['mem_a'] })]);
    expect(await migrateLegacySlots(store, l1With(['mem_a']), true)).toBe(1);
    expect(store.closed).toEqual([{ id: 's1', status: 'dropped' }]);
  });

  it('kind 非 rule / 未 pinned / 非 open → 一律不碰', async () => {
    const store = storeOf([
      slot({ id: 'todo', kind: 'todo', refs: ['mem_a'] }),
      slot({ id: 'anchor', kind: 'anchor', refs: ['mem_a'] }),
      slot({ id: 'pointer', kind: 'pointer', refs: ['mem_a'] }),
      slot({ id: 'unpinned', pinned: false, refs: ['mem_a'] }),
      slot({ id: 'done', status: 'done', refs: ['mem_a'] }),
      slot({ id: 'expired', status: 'expired', refs: ['mem_a'] }),
    ]);
    expect(await migrateLegacySlots(store, l1With(['mem_a']), true)).toBe(0);
    expect(store.closed).toEqual([]);
  });

  it('refs 为空 / 指向已退场记录 / 记录不存在 → 不退场（退场会真丢信息）', async () => {
    const store = storeOf([
      slot({ id: 'noref', refs: [] }),
      slot({ id: 'retired', refs: ['mem_gone'] }),
      slot({ id: 'unknown', refs: ['mem_never'] }),
    ]);
    expect(await migrateLegacySlots(store, l1With([], ['mem_gone']), true)).toBe(0);
    expect(store.closed).toEqual([]);
  });

  it('L1 面未装配 → 保守零动作', async () => {
    const store = storeOf([slot({ refs: ['mem_a'] })]);
    expect(await migrateLegacySlots(store, undefined, true)).toBe(0);
    expect(store.closed).toEqual([]);
  });

  it('多条里只退场命中的那些；close 失败不计入', async () => {
    const store: SlotMigrateStoreFace = {
      list: () => [
        slot({ id: 'hit-1', refs: ['mem_a'] }),
        slot({ id: 'miss', kind: 'todo', refs: ['mem_a'] }),
        slot({ id: 'hit-2', refs: ['mem_b', 'mem_x'] }),
      ],
      close: async (id) => id !== 'hit-2',
    };
    expect(await migrateLegacySlots(store, l1With(['mem_a', 'mem_b']), true)).toBe(1);
  });

  it('close 抛错不冒泡（反刍收尾不能被单条槽位打断）', async () => {
    const store: SlotMigrateStoreFace = {
      list: () => [slot({ refs: ['mem_a'] })],
      close: async () => {
        throw new Error('磁盘只读');
      },
    };
    const warn = vi.fn();
    const logger = { info: () => {}, warn, error: () => {}, debug: () => {} } as never;
    await expect(migrateLegacySlots(store, l1With(['mem_a']), true, logger)).resolves.toBe(0);
    expect(warn).toHaveBeenCalled();
  });
});

describe('pickMigratableSlots：预览（纯读，供面板先给人看）', () => {
  it('列出候选与其内容载体，不产生任何写', () => {
    const store = storeOf([slot({ id: 's1', title: '命令分类器优先级', refs: ['mem_a'] })]);
    const picked = pickMigratableSlots(store.list(), l1With(['mem_a']));
    expect(picked).toEqual([{ id: 's1', title: '命令分类器优先级', carrier: 'mem_a' }]);
    expect(store.closed).toEqual([]);
  });

  it('refs 多条时取第一个活记录作载体', () => {
    const picked = pickMigratableSlots([slot({ refs: ['mem_dead', 'mem_live'] })], l1With(['mem_live'], ['mem_dead']));
    expect(picked[0]?.carrier).toBe('mem_live');
  });
});
