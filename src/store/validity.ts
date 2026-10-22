/**
 * 记忆**有效性定性**的标注纯函数层(计划 expiry-tiering §2.1 冻结契约 · 先行刀)。
 *
 * 与 `supersede.ts` 同构:读写成对、可被单测直接验,不起库不起宿主。
 * 本层承载三档分级 + 两类取代态的**判据单源**——`classifyValidity` 是全仓
 * 唯一有权回答"这条记录现在算什么态"的函数;检索/注入/图谱退役传播都只
 * 消费它的结论,不得再各写一份 valid_to/marker 比较。
 *
 * ## 两条铁律(与 supersede.ts 相同)
 *
 * 1. **不可变**:`with*` / `strip*` 一律返回**新对象**,绝不改入参。
 * 2. **零漂移**:无标注时 `strip` 返回**原引用**;`with` 只在确有 state 时才写键
 *    ——既有记录的 `metadata_json` 不该因为本功能上线而多出任何字节。
 *
 * 保留键带 `dsh_` 前缀的理由与 `SUPERSEDE_METADATA_KEY` 完全相同:写库时保留键
 * 会与 LLM 产出的 metadata 合并进同一个 JSON 对象,必须靠命名空间隔开,
 * 否则一次 LLM 幻觉输出 `expired` 就能伪装成系统定性。
 */
import type { MemoryRecord, Persistence } from '../types.js';
import { readSupersedeMarker, type SupersedeInfo } from './supersede.js';

/** `l1_records.metadata_json` 里承载有效性标注的**保留键**。 */
export const VALIDITY_METADATA_KEY = 'dsh_validity';

/**
 * 有效性六态(spec §0 分级模型):
 * - `current`          有效-当前(仍在持续且未到有效期)
 * - `historical`       有效-历史(时点/已结束区间/无时间性,未退场)
 * - `expired`          过时(仍在持续但 valid_to≤now,且 valid_to 来源可信)
 * - `expired_suspect`  假过时嫌疑(同上但 valid_to 来源不可信,不硬隐藏)
 * - `superseded`       被取代(marker reason='superseded'/'conflict',撤出检索面)
 * - `retired`          人工/废弃退场(marker reason='manual'/'obsolete')
 */
export type ValidityState =
  | 'current'
  | 'historical'
  | 'expired'
  | 'expired_suspect'
  | 'superseded'
  | 'retired';

/** valid_to 的证据来源:`evidence` 之外一律视为不可信(判不出"真过时")。 */
export type ValidToSource = 'evidence' | 'llm_inferred' | 'fallback_now' | 'unknown';

/** 写进 metadata 的标注负载。`state` 必填,其余缺省即不写键。 */
export interface ValidityInfo {
  state: ValidityState;
  validToSource: ValidToSource;
  /** 判定依据的一句话说明(面板/审计可读,不做判据)。 */
  basis: string;
  /** 标注时刻(ISO 8601)。 */
  at: string;
  /** 取代它的记录 id(透传 supersede 标记,仅 state='superseded' 场景有值)。 */
  by?: string;
  /** 冲突对 id(透传,仅退场两类有值)。 */
  pairId?: string;
  /** 判定置信度 0..1(证据强度注记,不参与判据)。 */
  confidence?: number;
}

const VALIDITY_STATES: readonly ValidityState[] = [
  'current', 'historical', 'expired', 'expired_suspect', 'superseded', 'retired',
];

const VALID_TO_SOURCES: readonly ValidToSource[] = ['evidence', 'llm_inferred', 'fallback_now', 'unknown'];

/**
 * 写入有效性标注(返回**新对象**)。
 *
 * `info` 缺失或没有合法 `state` 时**不写键并原样返回**——"未判定"不是一种标注,
 * 不该产生一个空壳键占位(零漂移纪律,对齐 task_1.7 的字节断言)。
 */
export function withValidity(
  metadata: Record<string, unknown> | undefined,
  info: (Partial<ValidityInfo> & { state?: ValidityState }) | undefined,
): Record<string, unknown> {
  const base = metadata ?? {};
  if (!info || typeof info.state !== 'string' || !VALIDITY_STATES.includes(info.state)) return base;
  const marker: Record<string, unknown> = {
    state: info.state,
    validToSource: VALID_TO_SOURCES.includes(info.validToSource ?? 'unknown') ? (info.validToSource ?? 'unknown') : 'unknown',
    basis: typeof info.basis === 'string' ? info.basis : '',
    at: typeof info.at === 'string' ? info.at : '',
  };
  // 可选字段"有值才写键"(与 supersede.ts 同一语义:空串无法与"没有该字段"区分)
  if (info.by) marker.by = info.by;
  if (info.pairId) marker.pairId = info.pairId;
  if (typeof info.confidence === 'number' && Number.isFinite(info.confidence)) {
    marker.confidence = Math.max(0, Math.min(1, info.confidence));
  }
  return { ...base, [VALIDITY_METADATA_KEY]: marker };
}

/**
 * 读回有效性标注(读侧**唯一入口**,白名单投影)。
 *
 * 形状校验从严:`state` 缺失或不在六态枚举内 → 返回 `undefined`(当作**未标注**)。
 * 未标注的记录由调用方按 fail-open 处理,绝不让一个坏键把记忆判成"过时"而藏起来。
 */
export function readValidity(metadata: unknown): ValidityInfo | undefined {
  if (metadata === null || typeof metadata !== 'object') return undefined;
  const raw = (metadata as Record<string, unknown>)[VALIDITY_METADATA_KEY];
  if (raw === null || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.state !== 'string' || !VALIDITY_STATES.includes(o.state as ValidityState)) return undefined;
  const info: ValidityInfo = {
    state: o.state as ValidityState,
    validToSource:
      typeof o.validToSource === 'string' && VALID_TO_SOURCES.includes(o.validToSource as ValidToSource)
        ? (o.validToSource as ValidToSource)
        : 'unknown',
    basis: typeof o.basis === 'string' ? o.basis : '',
    at: typeof o.at === 'string' ? o.at : '',
  };
  // 写读成对:写侧每个可选字段都必须在这里成对读回(漏读=静默丢字段,
  // supersede 的 conflictType 曾踩过这个坑)。
  if (typeof o.by === 'string' && o.by) info.by = o.by;
  if (typeof o.pairId === 'string' && o.pairId) info.pairId = o.pairId;
  if (typeof o.confidence === 'number' && Number.isFinite(o.confidence)) {
    info.confidence = Math.max(0, Math.min(1, o.confidence));
  }
  return info;
}

/**
 * 去标注(重判前清旧键用)。返回**新对象**;无键时返回**原引用**——
 * 对未标注记录做 strip 是彻底的 no-op,不产生任何新对象。
 */
export function stripValidity(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const base = metadata ?? {};
  if (!(VALIDITY_METADATA_KEY in base)) return base;
  const next = { ...base };
  delete next[VALIDITY_METADATA_KEY];
  return next;
}

/** classifyValidity 的入参(全部来自记录现值,now 由调用方注入以便测试)。 */
export interface ClassifyValidityInput {
  /** 退场标记(readSupersedeMarker 的结果);存在即优先于时间轴判定。 */
  marker?: SupersedeInfo;
  /** 客观持续性;缺省 = 未判定(fail-open)。 */
  persistence?: Persistence;
  /** 现实有效期(epoch ms);缺省 = 未闭合。 */
  validTo?: number;
  /** valid_to 的证据来源;缺省按 'unknown'(不可信,判不出真过时)。 */
  validToSource?: ValidToSource;
  /** 判定时刻(epoch ms)。 */
  now: number;
}

/**
 * 六态判据(spec §0 表,唯一真源)。
 *
 * 判定次序:退场标记 > 时间轴。marker 存在即 `superseded`/`retired`,
 * 不看 valid_to——"软删遮蔽"与"过时"是正交两轴,marker 是既成事实。
 * persistence 未判定时 **fail-open**:valid_to 未闭合 → `current`;
 * 已闭合(无论来源)→ `expired_suspect`(宁可标注疑,也不静默隐藏)。
 */
export function classifyValidity(input: ClassifyValidityInput): ValidityState {
  const { marker, persistence, validTo, validToSource = 'unknown', now } = input;
  if (marker) {
    return marker.reason === 'manual' || marker.reason === 'obsolete' ? 'retired' : 'superseded';
  }
  const hasValidTo = typeof validTo === 'number' && Number.isFinite(validTo) && validTo > 0;
  const past = hasValidTo && (validTo as number) <= now;
  if (persistence === undefined) {
    // 未判定不参与取代/闭合判定,只当普通事实:能判疑,不能判死。
    return past ? 'expired_suspect' : 'current';
  }
  if (persistence === 'o') {
    if (!hasValidTo || !past) return 'current';
    return validToSource === 'evidence' ? 'expired' : 'expired_suspect';
  }
  // p(时点)/ s(已结束区间)/ t(无时间性):未退场即"有效-历史",照常可检可注入。
  return 'historical';
}

/** 六态里是否属于**退场态**(撤出检索面的那两档)。 */
export function isExitedState(state: ValidityState): boolean {
  return state === 'superseded' || state === 'retired';
}

/** 从记录 metadata 推 validToSource(未标注一律 'unknown',判不出可信过时)。 */
export function validToSourceOf(metadata: unknown): ValidToSource {
  return readValidity(metadata)?.validToSource ?? 'unknown';
}

/** 门3 反查参数(工具与 RPC 共用;全缺省 = 默认行为)。 */
export interface ValidityGateOptions {
  /** 放行当前 `expired`(可信过时)行;缺省 false。 */
  includeExpired?: boolean;
  /** valid 轴回放时刻(epoch ms):按 `validFrom ≤ T < (validTo ?? ∞)` 判可见，
   *  只放宽 valid 轴、**不复活退场**(marker 行一律排除)。与 includeExpired 同给时 asOf 优先。 */
  asOf?: number;
}

/**
 * 检索出口的时效可见性谓词(门3，工具与面板 RPC 共用一份——防两处漂移)。
 *
 * 存在理由:门1 解除索引遮蔽后，带合法历史/过期 valid_to 的行会进检索命中；
 * "默认只给有效"由出口层这刀维持(与改前"索引天然遮蔽 expired"的输出逐字等价)。
 * 退场两档(superseded/retired)已被门1 索引层挡在命中之外，这里再查一道
 * 只为 `asOf` 回放路径("不复活退场"的显式兑现)，不是重复过滤。
 */
export function passesValidityGate(
  record: Pick<MemoryRecord, 'metadata' | 'validTo' | 'validFrom' | 'persistence' | 'createdAt'>,
  now: number,
  opts: ValidityGateOptions = {},
): boolean {
  // 退场行永不可见(asOf 不复活;命中面本已不含它们,防御性兑现语义)。
  if (readSupersedeMarker(record.metadata) !== undefined) return false;
  const asOf = typeof opts.asOf === 'number' && Number.isFinite(opts.asOf) && opts.asOf > 0 ? opts.asOf : undefined;
  if (asOf !== undefined) {
    const from = record.validFrom ?? record.createdAt;
    if (Number.isFinite(from) && from > asOf) return false;
    if (record.validTo !== undefined && asOf >= record.validTo) return false;
    return true;
  }
  if (opts.includeExpired === true) return true;
  // 默认与 includeExpired 两档都只剔"可信 expired";expired_suspect 保留(疑而不隐)。
  return stateOfRecord(record, now) !== 'expired';
}

/**
 * 记录现态的**读侧**定性(expiry-tiering 门2/门3 与图谱传播共用):
 * 六态由记录现值 + 当下墙钟**查询期谓词**算出,不吃落库快照——
 * `expired` 随时间自然成立,拿写入时缓存的 state 会把"当时还没过时"当成永真。
 * 标注(`dsh_validity`)只为面板/审计留一份"写当时怎么判的",不是判据本身。
 */
export function stateOfRecord(record: Pick<MemoryRecord, 'metadata' | 'validTo' | 'persistence'>, now: number): ValidityState {
  return classifyValidity({
    marker: readSupersedeMarker(record.metadata),
    persistence: record.persistence,
    validTo: record.validTo,
    validToSource: validToSourceOf(record.metadata),
    now,
  });
}

/** 门2 注入过滤的产出(task_3.3/3.4 可单测形状)。 */
export interface InjectFilterResult<T> {
  /** 剔除可信 `expired` 后的候选(保序)。 */
  kept: T[];
  /** `expired_suspect` 的 id 集(注入行带"疑似失效"标注,不硬隐藏)。 */
  suspectIds: Set<string>;
  /** 因退场态被挡的条数(superseded/retired 本由门1 索引层排除,这里只记现算命中的防御数)。 */
  exited: number;
}

/**
 * 被动注入候选的时效过滤(门2 主体,纯函数供单测;调用点在 `hooks/recall.ts`,
 * 仅 `tieringEnabled` 为真时进入——关时逐字现状由调用点门保证)。
 *
 * 判据单源 `classifyValidity`(经 stateOfRecord 现算),不另写 valid_to/marker 比较(计划 §4 约束)。
 * 行缺失 fail-open 保留:宁多注一条也不静默丢记忆。
 */
export function filterInjectCandidates<T extends { id: string }>(
  candidates: readonly T[],
  recordOf: (id: string) => MemoryRecord | undefined,
  now: number,
): InjectFilterResult<T> {
  const kept: T[] = [];
  const suspectIds = new Set<string>();
  let exited = 0;
  for (const c of candidates) {
    const r = recordOf(c.id);
    if (r === undefined) { kept.push(c); continue; }
    const state = stateOfRecord(r, now);
    if (state === 'expired') continue;
    if (isExitedState(state)) { exited++; continue; }
    if (state === 'expired_suspect') suspectIds.add(c.id);
    kept.push(c);
  }
  return { kept, suspectIds, exited };
}

/**
 * 写侧标注钩子(expiry-tiering 门2/门3 的写入时机,spec §2.1"派生时机"):
 * 对**新建/重写**的记录就地盖一份 `dsh_validity` 快照(供面板/审计/反查展示,
 * 判定仍以 `stateOfRecord` 现算为准——本快照不是判据)。
 *
 * 直接变异传入 record(与 `familyForType` 兜底同位:写侧拥有刚建的记录对象;
 * 检索命中等共享对象绝不得经本函数改写)。`sourceHint` 只在尚无标注时生效:
 * 管线/工具在源头就知道 valid_to 的证据链,盖得越早越准;汇流口补盖拿不到
 * 源头信息时留 'unknown'(fail-open,只能判疑不能判死)。
 */
export function stampValidity(record: MemoryRecord, now: number, sourceHint?: ValidToSource): void {
  const existing = readValidity(record.metadata);
  const marker = readSupersedeMarker(record.metadata);
  const source = existing?.validToSource ?? sourceHint ?? 'unknown';
  const state = classifyValidity({ marker, persistence: record.persistence, validTo: record.validTo, validToSource: source, now });
  record.metadata = withValidity(record.metadata, {
    state,
    validToSource: source,
    basis: marker ? `marker:${marker.reason}` : `persistence:${record.persistence ?? '?'} validToSource:${source}`,
    at: new Date(now).toISOString(),
    ...(marker?.by ? { by: marker.by } : {}),
    ...(marker?.pairId ? { pairId: marker.pairId } : {}),
  });
}
