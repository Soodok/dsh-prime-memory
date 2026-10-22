/**
 * RouteHealthStore 单测（R9）：读 fail-open / 只降不升 / 陈旧过期 / save-load 往返 / reset。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTE_HEALTH_STALE_MS, RouteHealthStore, routeHealthPathFor } from '../src/store/route-health.js';

const DAY = 24 * 60 * 60_000;
let dir = '';
let file = '';

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rh-'));
  file = routeHealthPathFor(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('RouteHealthStore', () => {
  it('缺文件 load → 空表、不抛、lastGood=0', async () => {
    const s = new RouteHealthStore(file);
    await s.load();
    expect(s.lastGoodChunkChars('p', 'm')).toBe(0);
  });

  it('损坏文件 load → fail-open 空表不抛', async () => {
    await writeFile(file, '{ this is not json', 'utf-8');
    const s = new RouteHealthStore(file);
    await s.load();
    expect(s.lastGoodChunkChars('p', 'm')).toBe(0);
  });

  it('recordGood 只降不升', async () => {
    const s = new RouteHealthStore(file);
    await s.load();
    s.recordGood('p', 'm', 30_000);
    expect(s.lastGoodChunkChars('p', 'm')).toBe(30_000);
    s.recordGood('p', 'm', 50_000); // 更大不覆盖
    expect(s.lastGoodChunkChars('p', 'm')).toBe(30_000);
    s.recordGood('p', 'm', 20_000); // 更小才覆盖
    expect(s.lastGoodChunkChars('p', 'm')).toBe(20_000);
  });

  it('陈旧学习值（超 staleMs）读回 0', async () => {
    const s = new RouteHealthStore(file);
    await s.load();
    s.recordGood('p', 'm', 20_000);
    expect(s.lastGoodChunkChars('p', 'm', Date.now())).toBe(20_000);
    // 把"现在"推到 8 天后 → 判陈旧
    expect(s.lastGoodChunkChars('p', 'm', Date.now() + ROUTE_HEALTH_STALE_MS + DAY)).toBe(0);
  });

  it('save → 新实例 load 往返一致', async () => {
    const s = new RouteHealthStore(file);
    await s.load();
    s.recordGood('a', 'x', 18_000, 9000);
    s.recordGood('b', 'y', 40_000);
    expect(await s.save()).toBe(true);
    expect(await s.save()).toBe(false); // 无变更不再写

    const s2 = new RouteHealthStore(file);
    await s2.load();
    expect(s2.lastGoodChunkChars('a', 'x')).toBe(18_000);
    expect(s2.latencyEma('a', 'x')).toBe(9000);
    expect(s2.lastGoodChunkChars('b', 'y')).toBe(40_000);
  });

  it('reset 清单条与全部', async () => {
    const s = new RouteHealthStore(file);
    await s.load();
    s.recordGood('a', 'x', 10_000);
    s.recordGood('b', 'y', 20_000);
    s.reset('a', 'x');
    expect(s.lastGoodChunkChars('a', 'x')).toBe(0);
    expect(s.lastGoodChunkChars('b', 'y')).toBe(20_000);
    s.reset();
    expect(s.snapshot()).toHaveLength(0);
  });
});
