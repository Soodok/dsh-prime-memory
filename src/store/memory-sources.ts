/**
 * 外部记忆来源注册表（轨3 Connect 路径的一等实体）。
 *
 * 动机：此前"其他 agent → 记忆库"的取内容路径只装配到 `memory_import` 这最后一寸，
 * 前面十一寸（发现来源、记录来源、按来源管理）全外包给 skill 文本 + 用户手填路径。
 * 本注册表把"来源"升为可持久、可枚举、可按来源撤销的一等实体。
 *
 * **路径指针不复制**（Connect 语义，援引 `slots.refs` 先例）：每条只存 `path` + 摘要，
 * 正文**永不落进插件目录**——既是"移动房子家具先消毒"的卫生边界，也让带 ext_key 的
 * 外部记忆"来源仍在、可重放"（可重建性显式化）。
 *
 * 存储：rooms-registry 同款 sidecar（`memory-sources.json`），全量载入内存 + 写穿原子持久化，
 * `rev` 乐观计数。文件缺失 = 合法空表；损坏/不可读 → 告警 + 只读降级（内存态照常、停止回写），
 * **绝不阻塞扫描/导入/面板**（降级即回退"无注册来源"，非破坏性）。上限防刷。
 */
import * as path from 'node:path';
import { readJsonStrict, atomicWriteText, ensureDir } from '../util/io.js';
import type { MemoryLogger } from '../types.js';

/** sidecar 版本常量（file-versions 同款集中纪律）。 */
export const MEMORY_SOURCES_FILE_VERSION = 1 as const;

/** 已知外部 agent 来源类别（与 memport foreign-agent.md 对齐）；'file' = 任意路径。 */
export const SOURCE_KINDS = ['trae', 'qoder', 'codex', 'claude', 'workbuddy', 'golutra', 'cursor', 'file'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** 来源上限（防刷；一个工作区通常 <20 个外部工具记忆落点）。 */
const SOURCES_CAP = 100;
const PATH_MAX = 500;
const LABEL_MAX = 80;

export interface MemorySourceEntry {
  /** 稳定 id（小写字母数字连字符）；扫描/导入按此归类、支持按来源撤销。 */
  id: string;
  kind: SourceKind;
  /** 路径指针（绝对路径/目录），正文永不复制进来。 */
  path: string;
  label?: string;
  /** 最近一次扫描时间（ISO）；未扫为空。 */
  lastScanAt: string;
  /** 最近一次导入时间（ISO）；未导入为空。 */
  lastImportAt: string;
  /** 用户临时停用（保留条目但不参与自动扫描；≠ 删除）。 */
  disabled: boolean;
  status: 'active' | 'retired';
  createdAt: string;
  updatedAt: string;
}

interface SourcesFile {
  version: typeof MEMORY_SOURCES_FILE_VERSION;
  rev: number;
  sources: MemorySourceEntry[];
}

export type MemorySourceInput = Pick<MemorySourceEntry, 'id' | 'kind' | 'path'> &
  Partial<Pick<MemorySourceEntry, 'label'>>;

function isSourceId(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(s);
}

function normKind(k: unknown): SourceKind {
  return (SOURCE_KINDS as readonly string[]).includes(String(k)) ? (k as SourceKind) : 'file';
}

export class MemorySourceStore {
  private readonly file: string;
  private entries: MemorySourceEntry[] = [];
  private rev = 0;
  private loaded = false;
  private degraded: string | undefined;
  private degradedLogged = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    dataDir: string,
    private readonly logger?: MemoryLogger,
  ) {
    this.file = path.join(dataDir, 'memory-sources.json');
  }

  /** 载入（启动 await 一次）。缺失 = 合法空表；损坏 = 只读降级（回退"无来源"）。 */
  async init(): Promise<void> {
    await ensureDir(path.dirname(this.file));
    const read = await readJsonStrict<SourcesFile>(this.file);
    if (!read.ok) {
      if (read.reason !== 'missing') {
        this.degraded = `${read.reason}${'detail' in read && read.detail ? `: ${read.detail}` : ''}`;
        this.logger?.warn(`[memory] 外部来源注册表只读降级: ${this.degraded}`);
      }
      this.loaded = true;
      return;
    }
    if (read.value.version !== MEMORY_SOURCES_FILE_VERSION) {
      this.logger?.warn(`[memory] 外部来源注册表版本 ${String(read.value.version)} 未知，按当前形状读取`);
    }
    const sources = Array.isArray(read.value.sources) ? read.value.sources : [];
    for (const s of sources) {
      if (!s || typeof s.id !== 'string' || !isSourceId(s.id)) continue; // 非法 id 丢弃
      if (typeof s.path !== 'string' || !s.path) continue; // 无路径指针的来源无意义，丢弃
      this.entries.push({
        id: s.id,
        kind: normKind(s.kind),
        path: s.path.slice(0, PATH_MAX),
        label: typeof s.label === 'string' ? s.label : undefined,
        lastScanAt: typeof s.lastScanAt === 'string' ? s.lastScanAt : '',
        lastImportAt: typeof s.lastImportAt === 'string' ? s.lastImportAt : '',
        disabled: s.disabled === true,
        status: s.status === 'retired' ? 'retired' : 'active',
        createdAt: typeof s.createdAt === 'string' ? s.createdAt : '',
        updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : '',
      });
    }
    this.rev = typeof read.value.rev === 'number' ? read.value.rev : 0;
    this.loaded = true;
  }

  private ensureLoaded(): void {
    if (!this.loaded) throw new Error('外部来源注册表未初始化（先 await init()）');
  }

  /** 全量条目（含 retired；副本返回，活引用纪律）。 */
  list(): MemorySourceEntry[] {
    this.ensureLoaded();
    return this.entries.map((e) => ({ ...e }));
  }

  /** active 且未停用的来源（扫描/导入遍历用）。 */
  listEnabled(): MemorySourceEntry[] {
    return this.list().filter((e) => e.status === 'active' && !e.disabled);
  }

  byId(id: string): MemorySourceEntry | undefined {
    this.ensureLoaded();
    const found = this.entries.find((e) => e.id === id);
    return found ? { ...found } : undefined;
  }

  /** 登记来源（幂等：同 id 已存在则原地补全 kind/path/label，不新建）。上限防刷。 */
  async register(input: MemorySourceInput): Promise<{ entry: MemorySourceEntry; created: boolean }> {
    this.ensureLoaded();
    const id = String(input.id ?? '').trim().toLowerCase();
    if (!isSourceId(id)) throw new Error(`非法来源 id: ${String(input.id)}（小写字母数字连字符，≤64）`);
    const p = String(input.path ?? '').trim();
    if (!p) throw new Error('来源 path 不能为空（路径指针不复制，但必须指向真实落点）');
    if (p.length > PATH_MAX) throw new Error(`来源 path 过长（>${PATH_MAX}）`);
    const found = this.entries.find((e) => e.id === id);
    if (found) {
      let changed = false;
      const kind = normKind(input.kind);
      if (found.kind !== kind) {
        found.kind = kind;
        changed = true;
      }
      if (found.path !== p) {
        found.path = p;
        changed = true;
      }
      if (typeof input.label === 'string' && input.label.trim() && found.label !== input.label.trim().slice(0, LABEL_MAX)) {
        found.label = input.label.trim().slice(0, LABEL_MAX);
        changed = true;
      }
      if (found.status === 'retired') {
        found.status = 'active';
        changed = true;
      }
      if (changed) {
        found.updatedAt = new Date().toISOString();
        this.rev++;
        await this.persist();
      }
      return { entry: { ...found }, created: false };
    }
    if (this.entries.length >= SOURCES_CAP) throw new Error(`外部来源已达上限（${SOURCES_CAP}），请先退役部分来源`);
    const now = new Date().toISOString();
    const entry: MemorySourceEntry = {
      id,
      kind: normKind(input.kind),
      path: p.slice(0, PATH_MAX),
      label: typeof input.label === 'string' && input.label.trim() ? input.label.trim().slice(0, LABEL_MAX) : undefined,
      lastScanAt: '',
      lastImportAt: '',
      disabled: false,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    this.entries.push(entry);
    this.rev++;
    await this.persist();
    return { entry: { ...entry }, created: true };
  }

  /** 记一次扫描时间。 */
  async markScanned(id: string, at: string): Promise<boolean> {
    return this.patch(id, (e) => {
      e.lastScanAt = at;
    });
  }

  /** 记一次导入时间。 */
  async markImported(id: string, at: string): Promise<boolean> {
    return this.patch(id, (e) => {
      e.lastImportAt = at;
    });
  }

  /** 启用/停用（停用保留条目、只是不参与自动扫描）。 */
  async setDisabled(id: string, disabled: boolean): Promise<boolean> {
    return this.patch(id, (e) => {
      e.disabled = disabled;
    });
  }

  /** 退役/恢复（status 迁移）。 */
  async setStatus(id: string, status: 'active' | 'retired'): Promise<boolean> {
    return this.patch(id, (e) => {
      e.status = status;
    });
  }

  private async patch(id: string, mut: (e: MemorySourceEntry) => void): Promise<boolean> {
    this.ensureLoaded();
    const found = this.entries.find((e) => e.id === id);
    if (!found) return false;
    mut(found);
    found.updatedAt = new Date().toISOString();
    this.rev++;
    await this.persist();
    return true;
  }

  /** 写穿持久化（串行链；失败降级内存态并告警一次，绝不抛出阻塞调用方）。 */
  private async persist(): Promise<void> {
    if (this.degraded) return;
    this.writeChain = this.writeChain.then(async () => {
      const data: SourcesFile = { version: MEMORY_SOURCES_FILE_VERSION, rev: this.rev + 1, sources: this.entries };
      try {
        await ensureDir(path.dirname(this.file));
        await atomicWriteText(this.file, JSON.stringify(data, null, 2));
        this.rev = data.rev;
      } catch (err) {
        this.degraded = err instanceof Error ? err.message : String(err);
        if (!this.degradedLogged) {
          this.degradedLogged = true;
          this.logger?.warn(`[memory] 外部来源注册表写入失败，只读降级: ${this.degraded}`);
        }
      }
    });
    await this.writeChain;
  }
}
