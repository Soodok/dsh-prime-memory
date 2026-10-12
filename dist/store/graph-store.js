/**
 * 图谱存储层(graph_nodes / graph_edges / graph_projection_jobs 三张域表 +
 * graph_job_records / graph_projected_records 两张 job 索引表)。
 *
 * 仿 CostLedger 的边界:与检索引擎零关系,唯一耦合是共享同一个 node:sqlite
 * 连接;但降级姿态强于 CostLedger 先例——GraphStore.init 独立 try/catch,初始化
 * 失败只让图谱域 no-op(检索返空/入队返 0/claim 返 null),绝不传染整库降级
 * (图谱是纯投影,不值得为此停捕获/蒸馏)。
 *
 * job 队列语义:
 * - 去重下推 SQL:in-flight 去重查 graph_job_records(PK record_id),已完成去重
 *   查 graph_projected_records——都是索引点查,不做全 job 扫描;
 * - 优先级不倒挂:新蒸馏=10000 > 存量补投影=100;claim 按 priority DESC 取;
 * - claim 只认当前 projectorVersion;attempts 在 claim 时 +1,≥3 的 job 不再被
 *   claim(fail 时转 dead 收尾);
 * - LLM 永不进事务:claim(置 running)与 complete(读 scope → 纯函数 apply →
 *   写回)是两个独立事务缝,complete 用 BEGIN IMMEDIATE 全程持写锁;
 * - 来源全缺失的 job 判 dead-不可重试,不向调用方抛错。
 */
import { randomBytes } from 'node:crypto';
import { applyGraphProjection } from '../graph/apply.js';
import { searchGraphNodes } from '../graph/search.js';
import { GRAPH_JOB_BACKOFF_BASE_MS, GRAPH_JOB_BATCH, GRAPH_JOB_MAX_ATTEMPTS, GRAPH_PRIORITY_BACKFILL, GRAPH_PROJECTOR_VERSION, } from '../graph/types.js';
import { normPersistence } from '../types.js';
import { isZeroVector, vecToBuffer } from './vec-utils.js';
const TAG = '[memory][graph]';
/** 坏 JSON 容忍解析:图谱表列损坏只损失该行派生信息,不抛。 */
function parseJsonSafe(raw, fallback) {
    if (!raw)
        return fallback;
    try {
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
/** L1 行(MemoryDb 同款列)→ MemoryRecord;timestamp_str 逗号连接 ISO 契约与主库一致。 */
function rowToRecord(r) {
    const family = r.family;
    return {
        id: String(r.record_id),
        content: String(r.content),
        type: String(r.type ?? ''),
        priority: Number(r.priority ?? 50),
        scene_name: String(r.scene_name ?? ''),
        timestamps: String(r.timestamp_str ?? '')
            .split(',')
            .map((t) => Date.parse(t))
            .filter((t) => !Number.isNaN(t)),
        createdAt: Date.parse(String(r.created_time ?? '')) || 0,
        updatedAt: Date.parse(String(r.updated_time ?? '')) || 0,
        version: Number(r.version ?? 0),
        metadata: parseJsonSafe(r.metadata_json, {}),
        family: family === 'work' || family === 'chat' ? family : undefined,
        // 时间增强列(与主库同源):图谱时间锚优先取它们
        validFrom: r.valid_from ? Date.parse(String(r.valid_from)) || undefined : undefined,
        validTo: r.valid_to ? Date.parse(String(r.valid_to)) || undefined : undefined,
        persistence: normPersistence(r.persistence),
    };
}
/**
 * L1 列清单(基础列 + 按库的实际形状裁剪的时间增强列)。
 *
 * 时间增强列由 MemoryDb 的增量迁移补齐,但 GraphStore 也可能被挂到一个尚未迁移的
 * 库上(手建库/旧库/独立测试夹具)——此时写死列名会直接 `no such column` 让 claim 失败。
 * 故按 `PRAGMA table_info` 现查现拼,缺列就退回基础列(时间轴回落到 metadata.activity_*)。
 */
function l1SelectCols(db) {
    const base = 'record_id, content, type, priority, scene_name, version, timestamp_str, created_time, updated_time, metadata_json, family';
    try {
        const cols = new Set(db.prepare('PRAGMA table_info(l1_records)').all().map((r) => r.name));
        const extra = ['valid_from', 'valid_to', 'persistence'].filter((c) => cols.has(c));
        return extra.length > 0 ? `${base}, ${extra.join(', ')}` : base;
    }
    catch {
        return base;
    }
}
function rowToNode(r) {
    return {
        id: String(r.node_id),
        name: String(r.name),
        type: r.type,
        aliases: parseJsonSafe(r.aliases_json, []),
        tags: parseJsonSafe(r.tags_json, []),
        currentState: String(r.current_state ?? ''),
        facts: parseJsonSafe(r.facts_json, []),
        status: r.status,
        confidence: Number(r.confidence ?? 0.8),
        sourceRecordIds: parseJsonSafe(r.source_record_ids_json, []),
        families: parseJsonSafe(r.families_json, []),
        createdAt: String(r.created_time ?? ''),
        updatedAt: String(r.updated_time ?? ''),
    };
}
function rowToEdge(r) {
    return {
        id: String(r.edge_id),
        fromNodeId: String(r.from_node_id),
        toNodeId: String(r.to_node_id),
        relation: String(r.relation ?? ''),
        status: r.status,
        validFrom: r.valid_from || undefined,
        validTo: r.valid_to || undefined,
        confidence: Number(r.confidence ?? 0.8),
        sourceRecordIds: parseJsonSafe(r.source_record_ids_json, []),
        createdAt: String(r.created_time ?? ''),
        updatedAt: String(r.updated_time ?? ''),
    };
}
function rowToJob(r) {
    return {
        id: r.job_id,
        sourceRecordIds: parseJsonSafe(r.source_record_ids_json, []),
        priority: r.priority,
        projectorVersion: r.projector_version,
        status: r.status,
        attempts: r.attempts,
        nextAttemptAt: r.next_attempt_at,
        ...(r.error ? { error: r.error } : {}),
        createdAt: r.created_time,
        updatedAt: r.updated_time,
    };
}
/** 分块 IN 点查(沿用主库 chunkIds 的保守上限)。 */
function chunkOf(ids, size = 900) {
    const out = [];
    for (let i = 0; i < ids.length; i += size)
        out.push(ids.slice(i, i + size));
    return out;
}
export class GraphStore {
    db = null;
    logger;
    stmtInsertNode;
    stmtInsertEdge;
    /**
     * §F 图谱节点向量列（vec0）。**结构性可选**：维度未定或 vec0 不可用时这三个
     * 语句就是 `undefined`，该路整体 no-op——既不影响图谱的词法检索，也不向上抛。
     */
    stmtInsertNodeVec;
    stmtDeleteNodeVec;
    stmtSearchNodeVec;
    /** init 是否就绪(未就绪 = 图谱域整体 no-op,不抛错不传染)。 */
    get ready() {
        return this.db !== null;
    }
    /**
     * 建表 + 语句缓存(MemoryDb.initSchema 内调用)。任何一步失败都只告警并保持
     * 未就绪——图谱域整体降级 no-op,检索主链路(L0/L1/FTS/向量)不受影响。
     *
     * @param vec §F 节点向量列的维度(来自 MemoryDb 的**既有**能力探测结果;
     *   缺省/0 = 部署未启用向量 → 该路结构性不存在,不建表也不报错)。
     */
    init(db, logger, vec) {
        this.logger = logger;
        try {
            db.exec(`
        CREATE TABLE IF NOT EXISTS graph_nodes (
          node_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          aliases_json TEXT NOT NULL DEFAULT '[]',
          tags_json TEXT NOT NULL DEFAULT '[]',
          current_state TEXT NOT NULL DEFAULT '',
          facts_json TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'active',
          confidence REAL NOT NULL DEFAULT 0.8,
          source_record_ids_json TEXT NOT NULL DEFAULT '[]',
          families_json TEXT NOT NULL DEFAULT '[]',
          created_time TEXT NOT NULL DEFAULT '',
          updated_time TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_graph_nodes_status ON graph_nodes(status);
        CREATE INDEX IF NOT EXISTS idx_graph_nodes_updated ON graph_nodes(updated_time);
        CREATE TABLE IF NOT EXISTS graph_edges (
          edge_id TEXT PRIMARY KEY,
          from_node_id TEXT NOT NULL,
          to_node_id TEXT NOT NULL,
          relation TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active',
          valid_from TEXT DEFAULT '',
          valid_to TEXT DEFAULT '',
          confidence REAL NOT NULL DEFAULT 0.8,
          source_record_ids_json TEXT NOT NULL DEFAULT '[]',
          created_time TEXT NOT NULL DEFAULT '',
          updated_time TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON graph_edges(from_node_id);
        CREATE INDEX IF NOT EXISTS idx_graph_edges_status ON graph_edges(status);
        CREATE TABLE IF NOT EXISTS graph_projection_jobs (
          job_id TEXT PRIMARY KEY,
          source_record_ids_json TEXT NOT NULL DEFAULT '[]',
          priority INTEGER NOT NULL DEFAULT 0,
          projector_version INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER,
          error TEXT,
          created_time TEXT NOT NULL DEFAULT '',
          updated_time TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_graph_jobs_pick ON graph_projection_jobs(status, priority);
        CREATE TABLE IF NOT EXISTS graph_job_records (
          record_id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS graph_projected_records (
          record_id TEXT PRIMARY KEY,
          projector_version INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_graph_projected_version ON graph_projected_records(projector_version);
      `);
            this.stmtInsertNode = db.prepare(`
        INSERT INTO graph_nodes (
          node_id, name, type, aliases_json, tags_json, current_state, facts_json,
          status, confidence, source_record_ids_json, families_json, created_time, updated_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
          name=excluded.name, type=excluded.type, aliases_json=excluded.aliases_json,
          tags_json=excluded.tags_json, current_state=excluded.current_state,
          facts_json=excluded.facts_json, status=excluded.status, confidence=excluded.confidence,
          source_record_ids_json=excluded.source_record_ids_json, families_json=excluded.families_json,
          updated_time=excluded.updated_time
      `);
            this.stmtInsertEdge = db.prepare(`
        INSERT INTO graph_edges (
          edge_id, from_node_id, to_node_id, relation, status, valid_from, valid_to,
          confidence, source_record_ids_json, created_time, updated_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(edge_id) DO UPDATE SET
          from_node_id=excluded.from_node_id, to_node_id=excluded.to_node_id,
          relation=excluded.relation, status=excluded.status, valid_from=excluded.valid_from,
          valid_to=excluded.valid_to, confidence=excluded.confidence,
          source_record_ids_json=excluded.source_record_ids_json, updated_time=excluded.updated_time
      `);
            this.db = db;
            this.prepareNodeVec(db, logger, vec);
            logger?.info(`${TAG} 图谱表就绪(5 表,projectorVersion=${GRAPH_PROJECTOR_VERSION})`);
        }
        catch (err) {
            // 独立降级:图谱域 no-op,不向上抛(强于 costLedger 的冒泡语义——图谱无检索主链路关键)
            this.db = null;
            logger?.warn(`${TAG} 图谱表初始化失败,图谱功能停用(主存储不受影响): ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /**
     * §F 图谱节点向量列：与 `l1_vec` **同模式**的 vec0 虚拟表——同一个 `vec-utils`
     * 编码、同一种 `float[N] distance_metric=cosine` 声明。
     *
     * **内层 try/catch 是刻意的**（task_34）：vec0 扩展缺失时 `CREATE VIRTUAL TABLE`
     * 会抛。若让它冒到外层，图谱会从"向量路不可用"退化成"**整个图谱域不可用**"——
     * 词法检索、投影、裁决全部陪葬。外层那层 catch 是给"图谱表建不起来"用的，
     * 不该被一个**可选**的向量列触发。
     */
    prepareNodeVec(db, logger, vec) {
        const dimensions = vec?.dimensions ?? 0;
        this.stmtInsertNodeVec = undefined;
        this.stmtDeleteNodeVec = undefined;
        this.stmtSearchNodeVec = undefined;
        // 部署未启用向量（或探测未通过）→ 该路**结构性不存在**：不建表、不告警、不抛。
        // 这与"建了空表却永远查不到东西"是两回事——前者可断言，后者不可。
        if (dimensions <= 0)
            return;
        try {
            db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS graph_node_vec USING vec0(
          node_id TEXT PRIMARY KEY,
          embedding float[${dimensions}] distance_metric=cosine,
          updated_time TEXT DEFAULT ''
        )
      `);
            this.stmtInsertNodeVec = db.prepare('INSERT INTO graph_node_vec (node_id, embedding, updated_time) VALUES (?, ?, ?)');
            this.stmtDeleteNodeVec = db.prepare('DELETE FROM graph_node_vec WHERE node_id = ?');
            this.stmtSearchNodeVec = db.prepare(`
        SELECT node_id, distance
        FROM graph_node_vec
        WHERE embedding MATCH ? AND k = ?
        ORDER BY distance
      `);
            logger?.info(`${TAG} 图谱节点向量表就绪(dim=${dimensions})`);
        }
        catch (err) {
            logger?.warn(`${TAG} 图谱节点向量表不可用,向量路停用(图谱词法检索不受影响): ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /** 节点向量路是否可用。未就绪时下方两个方法的调用方**无需分支**——它们自身 no-op。 */
    get nodeVecReady() {
        return this.stmtSearchNodeVec !== undefined;
    }
    /**
     * 写入/覆盖节点向量(先删后插:vec0 不支持 ON CONFLICT)。
     * 未就绪 / 零向量 / 单条失败 → **静默跳过**,绝不抛。
     * @returns 实际写入条数(供调用方记账,不用于控制流)。
     */
    upsertNodeVectors(rows) {
        const stmtInsert = this.stmtInsertNodeVec;
        const stmtDelete = this.stmtDeleteNodeVec;
        if (!this.db || !stmtInsert || !stmtDelete)
            return 0;
        let written = 0;
        for (const row of rows) {
            if (isZeroVector(row.embedding))
                continue; // cosine 未定义,不入表
            try {
                stmtDelete.run(row.nodeId);
                stmtInsert.run(row.nodeId, vecToBuffer(row.embedding), row.updatedAt ?? '');
                written++;
            }
            catch (err) {
                this.logger?.warn(`${TAG} 节点向量写入失败(跳过该条): ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        return written;
    }
    /** 删除节点向量(节点删/合并时用)。未就绪 no-op。 */
    deleteNodeVectors(nodeIds) {
        const stmtDelete = this.stmtDeleteNodeVec;
        if (!this.db || !stmtDelete)
            return;
        try {
            for (const id of nodeIds)
                stmtDelete.run(id);
        }
        catch (err) {
            this.logger?.warn(`${TAG} 节点向量删除失败: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /**
     * 向量检索节点(按 cosine 距离升序,score = 1 - distance,与 L1 向量路同口径)。
     * 未就绪返回**空数组**——调用方无需判断 `nodeVecReady`,降级是内建的。
     */
    searchNodesByVector(embedding, topK) {
        const stmtSearch = this.stmtSearchNodeVec;
        if (!this.db || !stmtSearch || topK <= 0)
            return [];
        try {
            const rows = stmtSearch.all(vecToBuffer(embedding), topK);
            const out = [];
            for (const { node_id, distance } of rows) {
                if (distance == null || Number.isNaN(distance))
                    continue;
                const node = this.getNode(node_id);
                if (!node)
                    continue;
                out.push({ node, score: 1 - distance });
            }
            return out;
        }
        catch (err) {
            this.logger?.warn(`${TAG} 节点向量检索失败(返回空): ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }
    /** 插件停机时清空连接引用(dispose 序调用,防悬空引用)。 */
    close() {
        this.db = null;
    }
    /** 统一事务边界(immediate 供 complete 全程持写锁)。 */
    tx(fn, immediate = false) {
        const db = this.db;
        db.exec(immediate ? 'BEGIN IMMEDIATE' : 'BEGIN');
        try {
            const result = fn();
            db.exec('COMMIT');
            return result;
        }
        catch (err) {
            try {
                db.exec('ROLLBACK');
            }
            catch {
                /* ignore */
            }
            throw err;
        }
    }
    /** 事务内的 upsert 体(upsertTouched 与 complete 共用;调用方负责事务)。 */
    upsertTouchedInTx(nodes, edges) {
        const now = new Date().toISOString();
        for (const n of nodes) {
            this.stmtInsertNode.run(n.id, n.name, n.type, JSON.stringify(n.aliases), JSON.stringify(n.tags ?? []), n.currentState, JSON.stringify(n.facts), n.status, n.confidence, JSON.stringify(n.sourceRecordIds), JSON.stringify(n.families), n.createdAt || now, n.updatedAt || now);
        }
        for (const e of edges) {
            this.stmtInsertEdge.run(e.id, e.fromNodeId, e.toNodeId, e.relation, e.status, e.validFrom ?? '', e.validTo ?? '', e.confidence, JSON.stringify(e.sourceRecordIds), e.createdAt || now, e.updatedAt || now);
        }
    }
    /** 全量读图谱(apply scope 与检索的统一入口;图谱量级为可重建投影,百~千级)。 */
    loadGraph() {
        if (!this.db)
            return { nodes: [], edges: [] };
        try {
            return this.loadGraphInTx();
        }
        catch (err) {
            this.logger?.warn(`${TAG} 图谱读取失败(返回空): ${err instanceof Error ? err.message : String(err)}`);
            return { nodes: [], edges: [] };
        }
    }
    /** 事务内的全图读取(complete 用;调用方负责事务)。 */
    loadGraphInTx() {
        const db = this.db;
        const nodes = db.prepare('SELECT * FROM graph_nodes').all().map(rowToNode);
        const edges = db.prepare('SELECT * FROM graph_edges').all().map(rowToEdge);
        return { nodes, edges };
    }
    /** 事务内按 id 装载 L1 记录(claim 与 complete 共用;调用方负责事务)。 */
    loadRecordsInTx(ids) {
        const db = this.db;
        const records = [];
        const cols = l1SelectCols(db);
        for (const chunk of chunkOf(ids)) {
            const ph = chunk.map(() => '?').join(',');
            for (const r of db
                .prepare(`SELECT ${cols} FROM l1_records WHERE record_id IN (${ph})`)
                .all(...chunk)) {
                records.push(rowToRecord(r));
            }
        }
        return records;
    }
    /** 单节点详情(expand 用;不存在/未就绪返回 null)。 */
    getNode(id) {
        if (!this.db)
            return null;
        try {
            const row = this.db.prepare('SELECT * FROM graph_nodes WHERE node_id = ?').get(id);
            return row ? rowToNode(row) : null;
        }
        catch {
            return null;
        }
    }
    /** 与某节点相连的 active 边(expand 用;悬挂 id 返回空数组,不解析不抛)。 */
    edgesOf(nodeId) {
        if (!this.db)
            return [];
        try {
            const rows = this.db
                .prepare("SELECT * FROM graph_edges WHERE (from_node_id = ? OR to_node_id = ?) AND status = 'active'")
                .all(nodeId, nodeId);
            return rows.map(rowToEdge);
        }
        catch {
            return [];
        }
    }
    /**
     * 图谱检索(纯函数 searchGraphNodes 的存储缝;可选族过滤)。
     * families 非空时只返回本族衍生的节点(档位隔离;无族信息节点一律不可见——
     * 宁可漏不可串)。降级/异常返回空数组。
     */
    searchNodes(query, limit, families) {
        if (!this.db)
            return [];
        const { nodes, edges } = this.loadGraph();
        const filtered = families && families.length > 0
            ? nodes.filter((n) => n.families.some((f) => families.includes(f)))
            : nodes;
        return searchGraphNodes(filtered, edges, query, limit);
    }
    // ============================
    // 投影 job 队列
    // ============================
    newJobId() {
        return `gjob_${Date.now()}_${randomBytes(3).toString('hex')}`;
    }
    /**
     * 投影入队(按 GRAPH_JOB_BATCH 分片成多个 job;去重下推 SQL):
     * 已有在途 mapping(pending/running/failed 退避中)或已按当前版本完成投影的
     * 记录跳过。返回实际新建的 job 数。
     */
    queueGraphProjection(recordIds, priority) {
        if (!this.db || recordIds.length === 0)
            return 0;
        try {
            const db = this.db;
            const ids = [...new Set(recordIds)];
            // 下推去重:在途 mapping ∪ 已完成投影,都是索引点查
            const blocked = new Set();
            for (const chunk of chunkOf(ids)) {
                const ph = chunk.map(() => '?').join(',');
                for (const row of db.prepare(`SELECT record_id FROM graph_job_records WHERE record_id IN (${ph})`).all(...chunk)) {
                    blocked.add(row.record_id);
                }
                for (const row of db
                    .prepare(`SELECT record_id FROM graph_projected_records WHERE record_id IN (${ph}) AND projector_version = ?`)
                    .all(...chunk, GRAPH_PROJECTOR_VERSION)) {
                    blocked.add(row.record_id);
                }
            }
            const fresh = ids.filter((id) => !blocked.has(id));
            if (fresh.length === 0)
                return 0;
            const now = new Date().toISOString();
            return this.tx(() => {
                let created = 0;
                for (let i = 0; i < fresh.length; i += GRAPH_JOB_BATCH) {
                    const batch = fresh.slice(i, i + GRAPH_JOB_BATCH);
                    const jobId = this.newJobId();
                    db.prepare(`INSERT INTO graph_projection_jobs (job_id, source_record_ids_json, priority, projector_version, status, attempts, created_time, updated_time)
             VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`).run(jobId, JSON.stringify(batch), priority, GRAPH_PROJECTOR_VERSION, now, now);
                    for (const id of batch) {
                        db.prepare('INSERT OR REPLACE INTO graph_job_records (record_id, job_id) VALUES (?, ?)').run(id, jobId);
                    }
                    created++;
                }
                return created;
            });
        }
        catch (err) {
            this.logger?.warn(`${TAG} 投影入队失败(忽略): ${err instanceof Error ? err.message : String(err)}`);
            return 0;
        }
    }
    /**
     * 记录被物理删除后，把两张**索引表**里指向它的行一并抹掉。
     *
     * 为什么必需（F19）：`graph_projected_records` 之前全仓**只增不减**。记录行删了而投影行还在，
     * 就留下两类静默问题：① 投影进度表里挂着一批查不到主人的 record_id；② 从快照**恢复**回来的
     * 记录因为投影行已存在而被当成“已投影”，**永远不会重投影**（检索图里就这么缺一条，不报错）。
     *
     * 只删索引行，**不动图节点/边**：节点是跨记录聚合出来的事实，归图自己的生命周期管。
     * 失败只 warn 并返回已删数——清理的既成事实不应被旁路索引拖挂。
     *
     * @param ids - 已被物理删除的记录 id。
     * @returns 从投影表删掉的行数。
     */
    forgetRecords(ids) {
        if (!this.db || ids.length === 0)
            return 0;
        const db = this.db;
        let removed = 0;
        try {
            // 分批：IN 列表不能无限长（与入队/去重查询同一个口径）
            for (let i = 0; i < ids.length; i += 500) {
                const chunk = ids.slice(i, i + 500);
                const ph = chunk.map(() => '?').join(',');
                db.prepare(`DELETE FROM graph_projected_records WHERE record_id IN (${ph})`).run(...chunk);
                const jobInfo = db.prepare(`DELETE FROM graph_job_records WHERE record_id IN (${ph})`).run(...chunk);
                removed += chunk.length;
                void jobInfo;
            }
            return removed;
        }
        catch (err) {
            this.logger?.warn(`${TAG} 图索引遗录清理失败(忽略): ${err instanceof Error ? err.message : String(err)}`);
            return removed;
        }
    }
    /**
     * 取下一个可执行 job 并置 running(attempts +1):只认当前 projectorVersion,
     * attempts 封顶与退避窗口在 WHERE 里过滤;来源全缺失 → job 判 dead 返 null
     * (不可重试不抛)。部分缺失时 job 收缩到真实存在的记录子集。
     */
    claimNext() {
        if (!this.db)
            return null;
        try {
            const db = this.db;
            const nowMs = Date.now();
            const nowIso = new Date(nowMs).toISOString();
            return this.tx(() => {
                const row = db
                    .prepare(`SELECT * FROM graph_projection_jobs
             WHERE projector_version = ? AND attempts < ?
               AND status IN ('pending', 'failed')
               AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
             ORDER BY priority DESC, created_time ASC LIMIT 1`)
                    .get(GRAPH_PROJECTOR_VERSION, GRAPH_JOB_MAX_ATTEMPTS, nowMs);
                if (!row)
                    return null;
                db.prepare(`UPDATE graph_projection_jobs SET status = 'running', attempts = attempts + 1, error = NULL, updated_time = ? WHERE job_id = ?`).run(nowIso, row.job_id);
                const job = rowToJob({ ...row, status: 'running', attempts: row.attempts + 1, error: null });
                const records = this.loadRecordsInTx(job.sourceRecordIds);
                if (records.length === 0) {
                    // 来源全缺失:判 dead-不可重试,放掉 mapping 占位(不抛错)
                    db.prepare(`UPDATE graph_projection_jobs SET status = 'dead', error = ?, updated_time = ? WHERE job_id = ?`).run('来源记录已全部删除', nowIso, row.job_id);
                    db.prepare('DELETE FROM graph_job_records WHERE job_id = ?').run(row.job_id);
                    return null;
                }
                if (records.length < job.sourceRecordIds.length) {
                    // 部分缺失:job 收缩到真实存在的来源(缺失部分无法回溯,不参与校验)
                    const keep = new Set(records.map((r) => r.id));
                    job.sourceRecordIds = job.sourceRecordIds.filter((id) => keep.has(id));
                    db.prepare('UPDATE graph_projection_jobs SET source_record_ids_json = ?, updated_time = ? WHERE job_id = ?').run(JSON.stringify(job.sourceRecordIds), nowIso, row.job_id);
                }
                return { job, records };
            });
        }
        catch (err) {
            this.logger?.warn(`${TAG} claim 投影任务失败(本轮跳过): ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
    }
    /**
     * 提交投影结果(单事务,BEGIN IMMEDIATE):读全图 scope → 纯函数 apply(硬
     * 校验)→ 写回 touched 行 → job 置 completed + 登记已投影记录 + 放掉 mapping。
     * job 非 running 态(已完成/已 dead/已回收)一律幂等 no-op;任何一步抛错整体
     * 回滚,不留半写。
     */
    complete(jobId, result, opts) {
        if (!this.db)
            return;
        try {
            const db = this.db;
            const now = opts?.now ?? new Date().toISOString();
            const idFactory = opts?.idFactory ?? ((prefix) => `${prefix}_${Date.now()}_${randomBytes(3).toString('hex')}`);
            this.tx(() => {
                const row = db.prepare('SELECT * FROM graph_projection_jobs WHERE job_id = ?').get(jobId);
                if (!row)
                    return;
                if (row.status !== 'running')
                    return; // 幂等:completed/dead/回收中的重复提交无害跳过
                const wanted = parseJsonSafe(row.source_record_ids_json, []);
                const records = this.loadRecordsInTx(wanted);
                const { nodes, edges } = this.loadGraphInTx();
                const outcome = applyGraphProjection({
                    nodes,
                    edges,
                    records,
                    result,
                    allowedRecordIds: new Set(records.map((r) => r.id)),
                    now,
                    idFactory,
                });
                const touchedNodes = nodes.filter((n) => outcome.nodeIds.includes(n.id));
                const touchedEdges = edges.filter((e) => outcome.edgeIds.includes(e.id));
                this.upsertTouchedInTx(touchedNodes, touchedEdges);
                db.prepare(`UPDATE graph_projection_jobs SET status = 'completed', error = NULL, updated_time = ? WHERE job_id = ?`).run(now, jobId);
                for (const id of wanted) {
                    db.prepare('INSERT OR REPLACE INTO graph_projected_records (record_id, projector_version) VALUES (?, ?)').run(id, GRAPH_PROJECTOR_VERSION);
                }
                db.prepare('DELETE FROM graph_job_records WHERE job_id = ?').run(jobId);
                if (outcome.dropped > 0) {
                    this.logger?.warn(`${TAG} 投影校验丢弃 ${outcome.dropped} 条无来源/非法提案(job=${jobId})`);
                }
                this.logger?.info(`${TAG} 投影完成(job=${jobId},来源 ${wanted.length} 条 → 节点 ${touchedNodes.length} / 边 ${touchedEdges.length})`);
            }, true);
        }
        catch (err) {
            // 提交失败:job 仍在 running 态,下次启动 recoverRunning 回收重投
            this.logger?.warn(`${TAG} 投影提交失败(待启动回收重投): ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /**
     * 投影失败收尾:attempts 已在 claim 时 +1——封顶转 dead(放掉 mapping,允许
     * 重新入队);未封顶转 failed + 指数退避 nextAttemptAt(mapping 保留防重复入队)。
     */
    fail(jobId, error) {
        if (!this.db)
            return;
        try {
            const db = this.db;
            const nowMs = Date.now();
            const nowIso = new Date(nowMs).toISOString();
            this.tx(() => {
                const row = db.prepare('SELECT attempts FROM graph_projection_jobs WHERE job_id = ?').get(jobId);
                if (!row)
                    return;
                if (row.attempts >= GRAPH_JOB_MAX_ATTEMPTS) {
                    db.prepare(`UPDATE graph_projection_jobs SET status = 'dead', error = ?, updated_time = ? WHERE job_id = ?`).run(error.slice(0, 500), nowIso, jobId);
                    db.prepare('DELETE FROM graph_job_records WHERE job_id = ?').run(jobId);
                    this.logger?.warn(`${TAG} 投影任务达重试上限,标记 dead(job=${jobId}): ${error.slice(0, 200)}`);
                }
                else {
                    const backoffMs = GRAPH_JOB_BACKOFF_BASE_MS * 2 ** (row.attempts - 1);
                    db.prepare(`UPDATE graph_projection_jobs SET status = 'failed', error = ?, next_attempt_at = ?, updated_time = ? WHERE job_id = ?`).run(error.slice(0, 500), nowMs + backoffMs, nowIso, jobId);
                }
            });
        }
        catch (err) {
            this.logger?.warn(`${TAG} 投影失败收尾异常(忽略): ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /** 启动回收:上次进程退出时卡在 running 的 job 放回 pending(dispose 缝不永久卡批)。 */
    recoverRunning() {
        if (!this.db)
            return 0;
        try {
            const r = this.db
                .prepare(`UPDATE graph_projection_jobs SET status = 'pending', updated_time = ? WHERE status = 'running'`)
                .run(new Date().toISOString());
            const n = Number(r.changes ?? 0);
            if (n > 0)
                this.logger?.info(`${TAG} 启动回收 ${n} 个 running 投影任务 → pending`);
            return n;
        }
        catch {
            return 0;
        }
    }
    /** 最近 job 列表(诊断/面板用;未就绪返回空)。 */
    listJobs(limit = 50) {
        if (!this.db)
            return [];
        try {
            return this.db
                .prepare('SELECT * FROM graph_projection_jobs ORDER BY created_time DESC LIMIT ?')
                .all(limit).map(rowToJob);
        }
        catch {
            return [];
        }
    }
    /**
     * 存量补投影:从未投影(当前版本)且无在途 mapping 的 L1 记录里按创建时间
     * 升序取最多 limit 条分片入队(优先级 GRAPH_PRIORITY_BACKFILL,恒低于新蒸馏)。
     * 返回新建 job 数。
     */
    queueMissing(limit) {
        if (!this.db || limit <= 0)
            return 0;
        try {
            const rows = this.db
                .prepare(`SELECT r.record_id FROM l1_records r
           WHERE NOT EXISTS (SELECT 1 FROM graph_projected_records p WHERE p.record_id = r.record_id AND p.projector_version = ?)
             AND NOT EXISTS (SELECT 1 FROM graph_job_records m WHERE m.record_id = r.record_id)
           ORDER BY r.created_time ASC LIMIT ?`)
                .all(GRAPH_PROJECTOR_VERSION, Math.min(limit, 9000));
            return this.queueGraphProjection(rows.map((r) => r.record_id), GRAPH_PRIORITY_BACKFILL);
        }
        catch (err) {
            this.logger?.warn(`${TAG} 存量补投影扫描失败(本轮跳过): ${err instanceof Error ? err.message : String(err)}`);
            return 0;
        }
    }
    // ============================
    // 删除传播(B10)
    // ============================
    /**
     * 删除传播(L1 批量删除后的惰性墓碑):来源在 L1 已全部不存在的 active/disputed
     * 节点与边标 archived(保留行,expand 可见墓碑)。挂在 MemoryDb.deleteL1Batch
     * 之后;按 L1 存活集判定(而非本次删除集合),跨多次删除与历史孤儿一并收敛。
     */
    markSourcesDeleted(deletedIds) {
        if (!this.db || deletedIds.length === 0)
            return;
        try {
            const { nodes, edges } = this.loadGraph();
            // 候选来源全集 → L1 存活点查(chunked IN):有任一来源存活即不标
            const sourceIds = new Set();
            for (const n of nodes)
                for (const id of n.sourceRecordIds)
                    sourceIds.add(id);
            for (const e of edges)
                for (const id of e.sourceRecordIds)
                    sourceIds.add(id);
            if (sourceIds.size === 0)
                return;
            const alive = new Set();
            for (const chunk of chunkOf([...sourceIds])) {
                const ph = chunk.map(() => '?').join(',');
                for (const row of this.db
                    .prepare(`SELECT record_id FROM l1_records WHERE record_id IN (${ph})`)
                    .all(...chunk)) {
                    alive.add(row.record_id);
                }
            }
            const dead = (ids) => ids.length > 0 && ids.every((id) => !alive.has(id));
            const now = new Date().toISOString();
            const deadNodes = nodes.filter((n) => (n.status === 'active' || n.status === 'disputed') && dead(n.sourceRecordIds));
            const deadEdges = edges.filter((e) => (e.status === 'active' || e.status === 'disputed') && dead(e.sourceRecordIds));
            if (deadNodes.length === 0 && deadEdges.length === 0)
                return;
            this.tx(() => {
                for (const n of deadNodes) {
                    this.db.prepare(`UPDATE graph_nodes SET status = 'archived', updated_time = ? WHERE node_id = ?`).run(now, n.id);
                }
                for (const e of deadEdges) {
                    this.db.prepare(`UPDATE graph_edges SET status = 'archived', updated_time = ? WHERE edge_id = ?`).run(now, e.id);
                }
            });
            this.logger?.info(`${TAG} 删除传播:${deadNodes.length} 节点 / ${deadEdges.length} 边来源已全部删除,标 archived`);
        }
        catch (err) {
            this.logger?.warn(`${TAG} 删除传播失败(忽略): ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /**
     * §C 矛盾冻结:把图谱的 `disputed` 状态**同步**到给定冲突集。
     *
     * 为什么是"同步"而不是"标记":裁决会**撤销**争议。只做单向标记的话,
     * 一对已被人工裁决的对,其节点会永远停在 `disputed`——那是**派生投影在说谎**。
     * 图谱是本仓库反复确认的 L1 **派生投影**,派生字段就必须**由当前事实重算**,
     * 而不是靠一串增量事件累积(后者一旦漏一次就永久跑偏)。
     *
     * 判据(与 {@link markSourcesDeleted} 方向相反:那边问"来源是否**全部**消失",
     * 这边问"来源是否**命中**冲突集",命中一条即存疑):
     * - `active` 且来源命中冲突集 → `disputed`
     * - `disputed` 且来源**不**命中冲突集 → 复原为 `active`
     * - `archived` 墓碑两边都不动(墓碑是删除传播的产物,与争议无关)
     *
     * @returns 本次标记 / 复原的节点数。
     */
    syncDisputed(disputedRecordIds) {
        if (!this.db)
            return { marked: 0, cleared: 0 };
        try {
            const hit = new Set(disputedRecordIds);
            const now = new Date().toISOString();
            const nodes = this.loadGraph().nodes;
            const toMark = nodes.filter((n) => n.status === 'active' && n.sourceRecordIds.some((id) => hit.has(id)));
            // 冲突集为空 = 队列里没有未裁决对 → 所有 disputed 都该复原
            const toClear = nodes.filter((n) => n.status === 'disputed' && !n.sourceRecordIds.some((id) => hit.has(id)));
            if (toMark.length === 0 && toClear.length === 0)
                return { marked: 0, cleared: 0 };
            this.tx(() => {
                for (const n of toMark) {
                    this.db.prepare(`UPDATE graph_nodes SET status = 'disputed', updated_time = ? WHERE node_id = ?`).run(now, n.id);
                }
                for (const n of toClear) {
                    this.db.prepare(`UPDATE graph_nodes SET status = 'active', updated_time = ? WHERE node_id = ?`).run(now, n.id);
                }
            });
            this.logger?.info(`${TAG} 矛盾冻结同步:${toMark.length} 节点标 disputed,${toClear.length} 节点复原 active`);
            return { marked: toMark.length, cleared: toClear.length };
        }
        catch (err) {
            this.logger?.warn(`${TAG} 冻结状态同步失败(忽略): ${err instanceof Error ? err.message : String(err)}`);
            return { marked: 0, cleared: 0 };
        }
    }
    /** 清空全部图谱数据(L1 重建时调用——图谱是 L1 的投影,记录清空即图谱作废)。 */
    resetAll() {
        if (!this.db)
            return;
        try {
            this.tx(() => {
                for (const table of ['graph_nodes', 'graph_edges', 'graph_projection_jobs', 'graph_job_records', 'graph_projected_records']) {
                    this.db.exec(`DELETE FROM ${table}`);
                }
            });
        }
        catch (err) {
            this.logger?.warn(`${TAG} 图谱清空失败(忽略): ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
