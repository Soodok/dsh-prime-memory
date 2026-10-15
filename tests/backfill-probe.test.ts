/**
 * 回填端点的 `probe: true` 只读快照契约。
 *
 * 钉的是 UI 那条「离开区域再回来恢复在途进度」所依赖的硬约束：**probe 绝不启动新一轮**。
 * 三个端点平时都是「触发器」——空闲时调用会真的开跑；如果挂载探测走了普通路径，
 * 用户每次切回概览都会白烧一轮 token（而且是在他没点按钮的情况下）。
 *
 * 同时钉「探测无副作用」：probe 之后模块级 running 仍为 false。
 */
import { describe, expect, it } from 'vitest';
import { handleEndpoint, type EndpointDeps } from '../src/stats.js';
import { keywordBackfillState } from '../src/keyword-backfill.js';
import { redistillBackfillState } from '../src/redistill-backfill.js';
import { wingBackfillState } from '../src/wing-backfill.js';

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** 最小 deps：probe 路径只读 cfg/live + 模块级 state，不碰 stores/ctx。 */
function deps(cfg: unknown): EndpointDeps {
  return { cfg, stores: {}, logger } as unknown as EndpointDeps;
}

describe('回填端点 probe 只读快照', () => {
  it('keyword: probe 回状态，且**不启动**任务（无副作用）', async () => {
    expect(keywordBackfillState().running).toBe(false);
    const r = (await handleEndpoint('dsh-memory/keyword-backfill', { probe: true }, deps({ keyword: { enabled: true } }))) as Record<string, unknown>;
    expect(r.started).toBe(false);
    expect(r.running).toBe(false);
    expect(r.enabled).toBe(true);
    // 只读：探测过后仍未在跑
    expect(keywordBackfillState().running).toBe(false);
  });

  it('keyword: 门控关时 probe 如实报 enabled=false，且仍不启动', async () => {
    const r = (await handleEndpoint('dsh-memory/keyword-backfill', { probe: true }, deps({ keyword: { enabled: false } }))) as Record<string, unknown>;
    expect(r).toMatchObject({ started: false, running: false, enabled: false });
    expect(keywordBackfillState().running).toBe(false);
  });

  it('redistill: probe 回状态，且不启动', async () => {
    const r = (await handleEndpoint('dsh-memory/redistill-backfill', { probe: true }, deps({ redistill: { enabled: true } }))) as Record<string, unknown>;
    expect(r).toMatchObject({ started: false, running: false, enabled: true });
    expect(redistillBackfillState().running).toBe(false);
  });

  it('redistill: 门控关时 probe 报 enabled=false，且不启动', async () => {
    const r = (await handleEndpoint('dsh-memory/redistill-backfill', { probe: true }, deps({ redistill: { enabled: false } }))) as Record<string, unknown>;
    expect(r).toMatchObject({ started: false, running: false, enabled: false });
    expect(redistillBackfillState().running).toBe(false);
  });

  it('wing: probe 只回 running，且不启动', async () => {
    const r = (await handleEndpoint('dsh-memory/wing-backfill', { probe: true }, deps({}))) as Record<string, unknown>;
    expect(r).toMatchObject({ started: false, running: false });
    expect(wingBackfillState().running).toBe(false);
  });
});

describe('回填端点 cancel 控制面（中止开关的后端那一半）', () => {
  it('keyword: 空闲时 cancel 不动任务、也不启动', async () => {
    const r = (await handleEndpoint('dsh-memory/keyword-backfill', { cancel: true }, deps({ keyword: { enabled: true } }))) as Record<string, unknown>;
    expect(r.started).toBe(false);
    expect(r.running).toBe(false);
    expect((r.progress as { cancelled: boolean }).cancelled).toBe(false);
    expect(keywordBackfillState().running).toBe(false);
  });

  it('redistill: 空闲时 cancel 不动任务', async () => {
    const r = (await handleEndpoint('dsh-memory/redistill-backfill', { cancel: true }, deps({ redistill: { enabled: true } }))) as Record<string, unknown>;
    expect(r).toMatchObject({ started: false, running: false });
    expect(redistillBackfillState().running).toBe(false);
  });

  it('wing: 空闲时 cancel 不动任务', async () => {
    const r = (await handleEndpoint('dsh-memory/wing-backfill', { cancel: true }, deps({}))) as Record<string, unknown>;
    expect(r).toMatchObject({ started: false, running: false });
    expect(wingBackfillState().running).toBe(false);
  });

  it('progress 体带 cancelled 字段（面板据此区分“已中止”与“预算用尽”）', async () => {
    const r = (await handleEndpoint('dsh-memory/keyword-backfill', { probe: true }, deps({ keyword: { enabled: true } }))) as { progress: Record<string, unknown> };
    expect(r.progress).toHaveProperty('cancelled');
  });
});
