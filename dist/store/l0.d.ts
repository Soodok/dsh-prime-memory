/**
 * L0 存量计数门面(T8.4 l0 写路径退役后)。
 *
 * capture 已停写 l0 正文三表与 JSONL 事实源(见 hooks/capture.ts 与
 * store/l0-watermark.ts),历史读面(recentBySession / search)改经
 * `clients/drsc.ts` 的 DrscClient(硬依赖,无本地回退)——本类只剩状态
 * 面板的两个只读计数(今日捕获 / 按会话累计)。task_22 存量清退后表为
 * 空壳,计数自然归零,读路径无需判空。
 */
import type { MemoryDb } from './sqlite.js';
export declare class L0Store {
    private readonly db;
    constructor(db: MemoryDb);
    /** 今日已捕获消息数(SQL 计数,不再读整文件;写停后归零,面板口径保留)。 */
    countToday(): Promise<number>;
    /** 该会话累计已捕获消息数(session-stats 数据源;索引 COUNT)。 */
    countBySession(sessionId: string): Promise<number>;
}
