/**
 * 契约键集守卫(净室重写验收第 1 关)。
 *
 * 目的:防止重写过程中 settings/端点/词汇表键集缩水——dsh-settings 按命名空间
 * 持久化用户已有值,schema 缺一个键 = 用户配置被静默丢弃。
 * - EFFORT_CHOICES / Hall 目录:运行时词汇表,逐值比对;
 * - 端点全集:38 个(含面板高权限删除 records-delete、§C 冲突队列读写两端点、
 *   记忆退场三端点与快照两端点);
 * - MemoryLiveSettings 键注册表:完整 20 键清单在此固化,slice 12 落地
 *   liveSettingsSchema 后由键集 diff 测试对 schema 运行时复核;
 * - 占用账本算术:stock = recall + profile 恒等式与迁移函数语义(context-occupancy
 *   是占用数字的唯一算术来源)。
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { EFFORT_CHOICES, memorySchema, resolveDataDir } from '../src/config.js';
import { MEMORY_ENDPOINTS } from '../src/stats.js';
import { WING_CATALOG, HALL_CORNERS, WING_DEFAULT_ENABLED, WING_FALLBACK, wingLabel, familyForType, resolveRecordFamily } from '../src/types.js';
import {
  CHARS_PER_TOKEN,
  CONTEXT_METER_CIRCUMFERENCE,
  clearProfileShare,
  emptyOccupancyLedger,
  estimateInjectedMessageTokens,
  estimateStableSectionTokens,
  haloDashArray,
  isContextMeterAnchor,
  recordProfileShare,
  recordRecallInjection,
  resetForCompaction,
} from '../src/util/context-occupancy.js';

/** MemoryLiveSettings 完整键注册表(legacy 15 键 + v0.9.0 dist 逆向 5 键)。 */
const MEMORY_LIVE_SETTINGS_KEYS = [
  // legacy(0.8.x)
  'enabled',
  'capture',
  'distill',
  'recall',
  'reasoningEffort',
  'distillProvider',
  'distillModel',
  'distillChain',
  'distillBudgets',
  'distillMaxInputChars',
  'distillLayerChains',
  'distillMode',
  'directBaseURL',
  'directApiKey',
  // v0.9.0(远程嵌入运行时覆盖 + 写删门,自 dist/contract.d.ts 逆向)
  'embedRemoteBaseURL',
  'embedRemoteApiKey',
  'embedRemoteModel',
  'embedRemoteDimensions',
  'memoryMutate',
] as const;

/** 端点全集(40 个;含 records-delete / 图谱两端点 / receipts / §C 冲突队列读写+丢弃留痕三端点 / ruminate 三端点 / 退场与快照五端点)。 */
const ENDPOINTS = [
  'dsh-memory/stats',
  'dsh-memory/token-cost',
  'dsh-memory/session-mode-get',
  'dsh-memory/session-mode-set',
  'dsh-memory/wing-overview',
  'dsh-memory/rooms-get',
  'dsh-memory/rooms-export',
  'dsh-memory/room-register',
  'dsh-memory/room-admin',
  'dsh-memory/wing-backfill',
  'dsh-memory/session-stats',
  'dsh-memory/settings-get',
  'dsh-memory/settings-set',
  'dsh-memory/list-records',
  'dsh-memory/records-delete',
  'dsh-memory/receipts',
  'dsh-memory/conflicts',
  'dsh-memory/conflict-resolve',
  'dsh-memory/conflicts-rejected',
  'dsh-memory/graph-search',
  'dsh-memory/graph-node-get',
  'dsh-memory/scenes',
  'dsh-memory/persona',
  'dsh-memory/log-tail',
  'dsh-memory/trace-tail',
  'dsh-memory/rebuild-status',
  'dsh-memory/rebuild-start',
  'dsh-memory/rebuild-cancel',
  'dsh-memory/ruminate-status',
  'dsh-memory/ruminate-start',
  'dsh-memory/ruminate-cancel',
  'dsh-memory/llm-providers',
  'dsh-memory/llm-models',
  'dsh-memory/embedding-state-get',
  'dsh-memory/embedding-source-set',
  'dsh-memory/embedding-download-start',
  'dsh-memory/embedding-download-cancel',
  'dsh-memory/embedding-model-delete',
  'dsh-memory/embedding-runtime-cancel',
  'dsh-memory/embedding-reindex',
  'dsh-memory/embedding-reindex-cancel',
  'dsh-memory/records-retired',
  'dsh-memory/records-restore',
  'dsh-memory/cleanup-retired',
  'dsh-memory/snapshots-list',
  'dsh-memory/snapshot-restore',
  'dsh-memory/memory-sources-list',
  'dsh-memory/memory-sources-add',
  'dsh-memory/memory-sources-retire',
  'dsh-memory/memport-scan',
  'dsh-memory/skills-list',
  'dsh-memory/session-recalled',
  'dsh-memory/recall-feedback',
  'dsh-memory/workspace-relink',
  'dsh-memory/mem-export',
  'dsh-memory/mem-reconcile',
  'dsh-memory/skills-action',
] as const;

describe('effort vocabulary', () => {
  it('is the exact 9-value table in contract order', () => {
    expect([...EFFORT_CHOICES]).toEqual(['', 'off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  });
});

describe('wing catalog', () => {
  it('keeps the 8-corner catalog and mainline defaults', () => {
    expect(WING_CATALOG.map((h) => h.id)).toEqual([
      'work',
      'relationships',
      'learning',
      'creative',
      // 居家在健康之前(2026-09-23 用户要求对调,三处断言同步)
      'home',
      'health',
      'finance',
      'journey',
    ]);
    // experimental 字段已退休(8 角全主线);角集 = 全目录,general 移出角集作跨域兜底
    expect(HALL_CORNERS.map((h) => h.id)).toEqual(WING_CATALOG.map((h) => h.id));
    expect(WING_CATALOG.some((h) => h.id === 'general')).toBe(false);
    expect(WING_FALLBACK).toBe('general');
    expect(wingLabel('general')).toBe('跨域');
    expect([...WING_DEFAULT_ENABLED]).toEqual([
      'work',
      'relationships',
      'learning',
      'creative',
      // 居家在健康之前(2026-09-23 用户要求对调,三处断言同步)
      'home',
      'health',
      'finance',
      'journey',
    ]);
  });
});

describe('endpoint surface', () => {
  it('exposes exactly the 57 contracted endpoints, records-delete and graph included', () => {
    expect(ENDPOINTS.length).toBe(57);
    expect(ENDPOINTS.filter((e) => e.startsWith('dsh-memory/')).length).toBe(57);
  });

  it('本地清单与 src/stats.ts 的 MEMORY_ENDPOINTS **逐项一致**', () => {
    // 注意:本副本与 MEMORY_ENDPOINTS 都是**手工维护**的清单,两者会一起漂移
    // ——2026-09-16 实测:ruminate 三端点早已由 contract.ts 与分发器实现,却同时
    // 缺席本副本与 MEMORY_ENDPOINTS,本断言照样全绿,而线上 /dsh-memory/rpc/
    // ruminate-status 恒返 404、设置面板「反刍整理」整块静默消失。
    // 因此本断言不是唯一门禁,必须配合下方对 contract.ts 源码的守卫。
    expect([...ENDPOINTS].sort()).toEqual([...MEMORY_ENDPOINTS].sort());
  });

  it('唯一事实源守卫:与 src/stats.ts 分发器的 case 集逐项一致', async () => {
    // MEMORY_ENDPOINTS 同时是 HTTP 前缀路由 /dsh-memory/rpc/<短名> 的**放行白名单**
    // (见 stats.ts 的 SHORT_ENDPOINTS)。有 case 无白名单 = 该端点恒返 404,
    // 而客户端 rpc 的 catch 会静默吞掉异常、面板整块消失(2026-09-16 ruminate 事故)。
    const src = await readFile(new URL('../src/stats.ts', import.meta.url), 'utf8');
    const cases = [...src.matchAll(/case '(dsh-memory\/[^']+)':/g)].map((m) => m[1]);
    expect(cases.length).toBeGreaterThan(0);
    expect([...MEMORY_ENDPOINTS].sort()).toEqual([...cases].sort());
  });

  it('契约守卫:contract.ts 声明的端点必须全部在白名单内', async () => {
    // 单向包含即可捕获本类漂移:contract.ts 有、白名单没有 → 端点不可达。
    // (反向差额是 contract.ts 自身的滞后,单独跟踪,不在此断言。)
    const src = await readFile(new URL('../src/contract.ts', import.meta.url), 'utf8');
    const body = /\bexport interface DshMemoryRequestMap\s*\{([\s\S]*?)\n\}/.exec(src);
    expect(body, 'contract.ts 里找不到 DshMemoryRequestMap').not.toBeNull();
    const contractKeys = [...body![1].matchAll(/'(dsh-memory\/[^']+)'\s*:/g)].map((m) => m[1]);
    expect(contractKeys.length).toBeGreaterThan(0);
    const missing = contractKeys.filter((k) => !MEMORY_ENDPOINTS.includes(k));
    expect(missing, `contract.ts 声明但白名单缺失: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('memory live settings key registry', () => {
  it('registers 19 keys incl. the v0.9.0 reverse-engineered ones', () => {
    expect(MEMORY_LIVE_SETTINGS_KEYS.length).toBe(19);
    for (const k of ['embedRemoteBaseURL', 'embedRemoteApiKey', 'embedRemoteModel', 'embedRemoteDimensions', 'memoryMutate']) {
      expect(MEMORY_LIVE_SETTINGS_KEYS).toContain(k);
    }
  });

  it('static config schema keeps every deploy key with defaults', () => {
    // schemastery 对象可调用:空输入产出完整默认对象——键集/默认值缩水在此暴露
    const defaults = (memorySchema as unknown as (v: unknown) => Record<string, unknown>)({});
    for (const k of ['dataDir', 'family', 'capture', 'extract', 'l2', 'l3', 'recall', 'embedding', 'llm', 'hall', 'tokenCost', 'tools', 'benchControl', 'graph', 'conflictFreeze', 'trace']) {
      expect(defaults[k], `config key ${k} missing`).toBeDefined();
    }
    // 部署默认值抽查(与 0.9.0 契约逐项一致;§C/§F memorax-absorb 键随波追加)
    expect(defaults.family).toBe('auto');
    expect((defaults.capture as Record<string, unknown>).maxMessageChars).toBe(4000);
    expect((defaults.capture as Record<string, unknown>).redactSecrets).toBe(true);
    expect((defaults.trace as Record<string, unknown>).enabled).toBe(true);
    expect((defaults.trace as Record<string, unknown>).retentionDays).toBe(14);
    expect((defaults.trace as Record<string, unknown>).captureContent).toBe(false);
    expect((defaults.extract as Record<string, unknown>).minMessages).toBe(6);
    expect((defaults.extract as Record<string, unknown>).idleSeconds).toBe(300);
    expect((defaults.l2 as Record<string, unknown>).minNewMemories).toBe(5);
    expect((defaults.l3 as Record<string, unknown>).interval).toBe(20);
    expect((defaults.recall as Record<string, unknown>).strategy).toBe('hybrid');
    expect((defaults.recall as Record<string, unknown>).scoreThreshold).toBe(0.3);
    expect((defaults.recall as Record<string, unknown>).decayHalfLifeDays).toBe(30);
    expect((defaults.embedding as Record<string, unknown>).enabled).toBe(false);
    expect((defaults.embedding as Record<string, unknown>).dimensions).toBe(0);
    expect((defaults.embedding as Record<string, unknown>).mirror).toBe('https://hf-mirror.com');
    expect((defaults.llm as Record<string, unknown>).mode).toBe('host');
    expect((defaults.llm as Record<string, unknown>).maxTokens).toBe(65_536);
    expect((defaults.llm as Record<string, unknown>).maxInputChars).toBe(700_000);
    expect((defaults.hall as Record<string, unknown>).enabled).toEqual([
      'work',
      'relationships',
      'learning',
      'creative',
      // 居家在健康之前(2026-09-23 用户要求对调,三处断言同步)
      'home',
      'health',
      'finance',
      'journey',
    ]);
    expect((defaults.tokenCost as Record<string, unknown>).retentionDays).toBe(365);
    expect(defaults.tools).toBe(true);
    expect(defaults.benchControl).toBe(false);
    // §C 矛盾冻结:新功能默认关(冻结消耗人的注意力,不可默认全开)
    expect((defaults.conflictFreeze as Record<string, unknown>).enabled).toBe(false);
    // 0.1.7 迁移:运行时开关整节迁入 Config 的 live volatile 节(原 settings
    // 服务 dsh-memory 命名空间)——节缺键 = 用户已存开关值被静默丢弃,红线。
    // 注意:volatile 节解析出来是**引用**(有 .get()),先解引用再比对键集
    const rawLive = defaults.live as { get?: () => Record<string, unknown> } | undefined;
    const live = typeof rawLive?.get === 'function' ? rawLive.get() : (rawLive as Record<string, unknown>);
    expect(live).toBeDefined();
    for (const k of MEMORY_LIVE_SETTINGS_KEYS) {
      expect(live).toHaveProperty(k);
    }
    // 开关默认值抽查:总/捕获/蒸馏/召回默认开,高权限门与冻结裁决默认关
    expect(live.enabled).toBe(true);
    expect(live.capture).toBe(true);
    expect(live.distill).toBe(true);
    expect(live.recall).toBe(true);
    expect(live.memoryMutate).toBe(false);
    expect(live.conflictFreeze).toBe(false);
    expect(live.embedRemoteDimensions).toBe(0);
  });

  it('resolveDataDir falls back to dshHomePath("memory") shape', () => {
    const dir = resolveDataDir({ ...({ dataDir: 'X:/mem' } as Parameters<typeof resolveDataDir>[0]) });
    expect(dir).toBe('X:/mem');
  });
});

describe('family resolution chain', () => {
  it('uses forced > extracted > type-prefix in that order', () => {
    expect(resolveRecordFamily('chat', 'work', 'work_fact')).toBe('chat');
    expect(resolveRecordFamily(undefined, 'work', 'episodic')).toBe('work');
    expect(resolveRecordFamily(undefined, undefined, 'work_task')).toBe('work');
    expect(resolveRecordFamily(undefined, undefined, 'episodic')).toBe('chat');
    expect(resolveRecordFamily(undefined, 'nonsense', 'preference')).toBe('chat');
  });
  it('familyForType prefixes work* only', () => {
    expect(familyForType('work_method')).toBe('work');
    expect(familyForType('networking')).toBe('chat');
  });
});

describe('occupancy ledger arithmetic (single source of truth)', () => {
  it('density constants match the official meter', () => {
    expect(CHARS_PER_TOKEN).toBe(4);
    expect(estimateInjectedMessageTokens(16)).toBe(4 + 4 + 4); // ceil(16/4)+block+role
    expect(estimateInjectedMessageTokens(17)).toBe(5 + 4 + 4);
    expect(estimateStableSectionTokens(16)).toBe(4); // 子片无结构开销
  });

  it('keeps stock = recall + profile across injection/share/clear sequences', () => {
    const l = emptyOccupancyLedger(1000);
    recordRecallInjection(l, 400, 1001);
    expect(l.stockTokens).toBe(l.recallTokens);
    expect(l.lastInjectTokens).toBe(estimateInjectedMessageTokens(400));
    recordProfileShare(l, 800, 1002);
    expect(l.profileTokens).toBe(estimateStableSectionTokens(800));
    expect(l.stockTokens).toBe(l.recallTokens + l.profileTokens);
    recordRecallInjection(l, 100, 1003);
    expect(l.stockTokens).toBe(l.recallTokens + l.profileTokens);
    clearProfileShare(l, 1004);
    expect(l.profileTokens).toBe(0);
    expect(l.stockTokens).toBe(l.recallTokens);
    expect(l.updatedAt).toBe(1004);
  });

  it('resetForCompaction zeroes the whole ledger (低估近似语义)', () => {
    const l = emptyOccupancyLedger(1);
    recordRecallInjection(l, 400);
    recordProfileShare(l, 800);
    resetForCompaction(l, 2);
    expect(l).toEqual({ stockTokens: 0, recallTokens: 0, profileTokens: 0, lastInjectTokens: 0, updatedAt: 2 });
  });
});

describe('context meter render helpers', () => {
  it('halo dasharray clamps ratio and honors minLen only when visible', () => {
    expect(haloDashArray(0.5)).toBe(`${CONTEXT_METER_CIRCUMFERENCE / 2} ${CONTEXT_METER_CIRCUMFERENCE}`);
    expect(haloDashArray(2)).toBe(`${CONTEXT_METER_CIRCUMFERENCE} ${CONTEXT_METER_CIRCUMFERENCE}`);
    expect(haloDashArray(-1)).toBe(`0 ${CONTEXT_METER_CIRCUMFERENCE}`);
    expect(haloDashArray(0.001, undefined, 0.5)).toBe(`0.5 ${CONTEXT_METER_CIRCUMFERENCE}`);
    expect(haloDashArray(0, undefined, 0.5)).toBe(`0 ${CONTEXT_METER_CIRCUMFERENCE}`);
    expect(haloDashArray(Number.NaN)).toBe(`0 ${CONTEXT_METER_CIRCUMFERENCE}`);
  });

  it('recognizes the official meter anchor signature only', () => {
    expect(isContextMeterAnchor({ ariaHasPopup: 'dialog', viewBox: '0 0 14 14', circleRadii: [5.5, 5.5] })).toBe(true);
    expect(isContextMeterAnchor({ ariaHasPopup: 'menu', viewBox: '0 0 14 14', circleRadii: [5.5, 5.5] })).toBe(false);
    expect(isContextMeterAnchor({ ariaHasPopup: 'dialog', viewBox: '0 0 16 16', circleRadii: [5.5, 5.5] })).toBe(false);
    expect(isContextMeterAnchor({ ariaHasPopup: 'dialog', viewBox: '0 0 14 14', circleRadii: [5.5] })).toBe(false);
    expect(isContextMeterAnchor({ ariaHasPopup: 'dialog', viewBox: '0 0 14 14', circleRadii: [5.5, 5.5000001] })).toBe(true);
  });
});
