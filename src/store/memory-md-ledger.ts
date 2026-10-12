/**
 * md 投射的指纹账本（N9）。
 *
 * 它存在的唯一理由：**库里没有任何 hash 列**（spec F26），三处现成 hash 又全不落库
 * （F27：快照是整集粗粒度、memport 每次现算、reconcile 只活在状态文件里）。没有这张
 * 账本就无从回答"这个文件是被人改的，还是被我们上次写出去的"——而那是双向同步的
 * 全部难点：两方比较必吃一边。
 *
 * 三条口径：
 * - **键是 `relPath` 不是 `name`**：账本记的是文件，relPath 才是文件的身份；name 只是
 *   它的一部分（同名不同 type 会落到两个不同文件里）。
 * - **派生态**：删了这张表最坏是"下次全量重写一遍文件"，不会丢任何记忆。所以它
 *   **不进**快照哈希投影（`canonicalRecords` 不动），也不需要迁移。
 * - **写穿失败只降级为只读并 warn 一次**，绝不抛给调用方：投射是旁路，旁路不能弄挂主路。
 */
import { dirname, join } from 'node:path';
import { atomicWriteText, ensureDir, readJsonStrict } from '../util/io.js';
import { MEM_MD_LEDGER_FILE_VERSION } from './file-versions.js';
import type { MemoryLogger } from '../types.js';

/** 一条投射记录的指纹账。`db*` 是库侧、`file*` 是磁盘侧，两边成对才能判象限。 */
export interface MdLedgerEntry {
  /** 记录 id（写入时刻的那一个；merge 后可能变，故只当线索不当键）。 */
  id: string;
  /** 外部导入幂等键（有则可用于跨 id 认人）。 */
  extKey: string;
  /** 相对投射根的路径（正斜杠），账本的键。 */
  relPath: string;
  /** 上次投射时**库侧**的内容指纹。 */
  dbDigest: string;
  /** 上次投射时**文件侧**的内容指纹。 */
  fileDigest: string;
  fileMtimeMs: number;
  fileSize: number;
  /** 写入时刻（ISO）。只作展示，不参与任何判据——参与就会让渲染不纯。 */
  syncedAt: string;
}

interface LedgerFile {
  version: typeof MEM_MD_LEDGER_FILE_VERSION;
  entries: Record<string, MdLedgerEntry>;
}

export class MdLedgerStore {
  private readonly file: string;
  private entries = new Map<string, MdLedgerEntry>();
  private loaded = false;
  private degraded: string | undefined;
  private degradedLogged = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    dataDir: string,
    private readonly logger?: MemoryLogger,
  ) {
    this.file = join(dataDir, 'mem-md-ledger.json');
  }

  async init(): Promise<void> {
    await ensureDir(dirname(this.file));
    const read = await readJsonStrict<LedgerFile>(this.file);
    if (!read.ok) {
      if (read.reason !== 'missing') {
        this.degraded = `${read.reason}${'detail' in read && read.detail ? `: ${read.detail}` : ''}`;
        this.logger?.warn(`[memory] md 投射账本只读降级: ${this.degraded}`);
      }
      this.loaded = true;
      return;
    }
    for (const [rel, e] of Object.entries(read.value.entries ?? {})) {
      const parsed = this.normalize(e);
      // 键与条目内的 relPath 不一致 ⇒ 以键为准重写（不丢条目，但留一行 warn：
      // 手工编辑过账本的人需要知道它被规整了）。
      if (parsed !== undefined) this.entries.set(rel, { ...parsed, relPath: rel });
    }
    this.loaded = true;
  }

  /** 逐条收窄：形状不符的条目丢弃，不让一条坏数据拖垮整表。 */
  private normalize(e: unknown): MdLedgerEntry | undefined {
    if (!e || typeof e !== 'object') return undefined;
    const raw = e as Record<string, unknown>;
    if (typeof raw.relPath !== 'string' || raw.relPath.length === 0) return undefined;
    if (typeof raw.dbDigest !== 'string' || typeof raw.fileDigest !== 'string') return undefined;
    return {
      id: typeof raw.id === 'string' ? raw.id : '',
      extKey: typeof raw.extKey === 'string' ? raw.extKey : '',
      relPath: raw.relPath,
      dbDigest: raw.dbDigest,
      fileDigest: raw.fileDigest,
      fileMtimeMs: typeof raw.fileMtimeMs === 'number' ? raw.fileMtimeMs : 0,
      fileSize: typeof raw.fileSize === 'number' ? raw.fileSize : 0,
      syncedAt: typeof raw.syncedAt === 'string' ? raw.syncedAt : '',
    };
  }

  private ensureLoaded(): void {
    if (!this.loaded) throw new Error('md 投射账本未初始化(先 await init())');
  }

  get(relPath: string): MdLedgerEntry | undefined {
    this.ensureLoaded();
    return this.entries.get(relPath);
  }

  all(): MdLedgerEntry[] {
    this.ensureLoaded();
    return [...this.entries.values()];
  }

  set(entry: MdLedgerEntry): void {
    this.ensureLoaded();
    this.entries.set(entry.relPath, entry);
    this.schedulePersist();
  }

  delete(relPath: string): boolean {
    this.ensureLoaded();
    if (!this.entries.delete(relPath)) return false;
    this.schedulePersist();
    return true;
  }

  /** 条目上限护栏：投射是"文件 ↔ 库"的一一对应，超量只可能是脏数据堆积。 */
  private prune(): void {
    const MAX = 50_000;
    if (this.entries.size <= MAX) return;
    const sorted = [...this.entries.entries()].sort((a, b) => (a[1].syncedAt < b[1].syncedAt ? -1 : 1));
    for (const [rel] of sorted.slice(0, this.entries.size - MAX)) this.entries.delete(rel);
  }

  private schedulePersist(): void {
    if (this.degraded) return;
    this.writeChain = this.writeChain.then(() => this.persist(), () => this.persist());
  }

  private async persist(): Promise<void> {
    if (this.degraded) return;
    this.prune();
    const data: LedgerFile = {
      version: MEM_MD_LEDGER_FILE_VERSION,
      entries: Object.fromEntries(this.entries),
    };
    try {
      await ensureDir(dirname(this.file));
      await atomicWriteText(this.file, JSON.stringify(data, null, 2));
    } catch (err) {
      this.degraded = err instanceof Error ? err.message : String(err);
      if (!this.degradedLogged) {
        this.degradedLogged = true;
        this.logger?.warn(`[memory] md 投射账本写入失败，只读降级: ${this.degraded}`);
      }
    }
  }

  /** 等待在途写完成（测试/停机/导出收尾）。 */
  flush(): Promise<void> {
    return this.writeChain;
  }
}
