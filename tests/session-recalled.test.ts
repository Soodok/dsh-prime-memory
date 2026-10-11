/** G-live 会话活召回集累积器：owner 隔离、插入序去重、reset、空输入不建条。 */
import { describe, expect, it } from 'vitest';
import { SessionRecalledStore } from '../src/store/session-recalled.js';

describe('SessionRecalledStore', () => {
  it('add 累积、list 按插入序去重、reset 清空', () => {
    const s = new SessionRecalledStore();
    s.add('owner1', ['a', 'b']);
    s.add('owner1', ['b', 'c']);
    expect(s.list('owner1')).toEqual(['a', 'b', 'c']);
    s.reset('owner1');
    expect(s.list('owner1')).toEqual([]);
  });
  it('owner 之间互不串（子代理归一到同一 owner 才共享）', () => {
    const s = new SessionRecalledStore();
    s.add('o1', ['x']);
    s.add('o2', ['y']);
    expect(s.list('o1')).toEqual(['x']);
    expect(s.list('o2')).toEqual(['y']);
  });
  it('空 ownerId / 空 ids 不建条', () => {
    const s = new SessionRecalledStore();
    s.add('', ['a']);
    s.add('o', []);
    expect(s.size()).toBe(0);
  });
  it('未知 owner → 空数组', () => {
    expect(new SessionRecalledStore().list('nope')).toEqual([]);
  });
});
