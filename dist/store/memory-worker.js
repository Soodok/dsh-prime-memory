/**
 * 后台记忆 worker 线程体(由 `memory-backend-worker.ts` 拉起)。
 *
 * 职责边界:**读 + 纯 metadata 写**,不碰嵌入、不碰热路径。
 * 线程内自开一条 SQLite 连接(WAL + busy_timeout=5000 已由 sqlite.ts 设置,
 * 多连接并发安全),主线程因此不再被后台批处理的同步 SQL 占住。
 *
 * 协议:`{id, method, args}` → `{id, ok, value}` / `{id, ok:false, error}`。
 * 起库失败属于致命错误:直接 `{type:'fatal'}` 后退出,不静默空转。
 */
import { parentPort, workerData } from 'node:worker_threads';
import { MemoryDb } from './sqlite.js';
const data = (workerData ?? {});
const port = parentPort;
function reply(id, ok, value, error) {
    port?.postMessage({ id, ok, value, error });
}
if (!port) {
    // 被当作普通模块 require 了:不该发生,但也不许静默
    throw new Error('memory-worker 只能在 worker_threads 中运行');
}
if (typeof data.dbPath !== 'string' || data.dbPath === '') {
    port.postMessage({ type: 'fatal', error: 'worker 未收到 dbPath' });
    port.close();
}
else {
    let db;
    try {
        db = new MemoryDb(data.dbPath, data.dimensions ?? 0);
        db.init();
        port.postMessage({ type: 'ready' });
    }
    catch (err) {
        port.postMessage({
            type: 'fatal',
            error: `记忆 worker 开库失败: ${err instanceof Error ? err.message : String(err)}`,
        });
        port.close();
        db = null;
    }
    if (db) {
        const handle = db;
        port.on('message', (msg) => {
            const id = msg?.id;
            const method = msg?.method;
            const args = msg?.args ?? [];
            if (typeof id !== 'number' || typeof method !== 'string')
                return;
            try {
                switch (method) {
                    case 'allLite':
                        reply(id, true, handle.getAllL1Lite(Number(args[0]), Number(args[1])));
                        return;
                    case 'getByIds':
                        reply(id, true, handle.getL1ByIds(Array.isArray(args[0]) ? args[0] : []));
                        return;
                    case 'list':
                        reply(id, true, handle.listL1(args[0]));
                        return;
                    case 'patchMetadata':
                        reply(id, true, handle.patchL1Metadata(String(args[0]), args[1]));
                        return;
                    case 'patchMetadataAndReindex':
                        reply(id, true, handle.patchL1MetadataAndReindex(String(args[0]), args[1]));
                        return;
                    case 'size':
                        reply(id, true, handle.countL1());
                        return;
                    default:
                        reply(id, false, undefined, `未知方法: ${method}`);
                }
            }
            catch (err) {
                reply(id, false, undefined, err instanceof Error ? err.message : String(err));
            }
        });
    }
}
