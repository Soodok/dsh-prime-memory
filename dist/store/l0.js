export class L0Store {
    db;
    constructor(db) {
        this.db = db;
    }
    /** 今日已捕获消息数(SQL 计数,不再读整文件;写停后归零,面板口径保留)。 */
    async countToday() {
        const d = new Date();
        return this.db.countL0Since(new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString());
    }
    /** 该会话累计已捕获消息数(session-stats 数据源;索引 COUNT)。 */
    async countBySession(sessionId) {
        return this.db.countL0BySession(sessionId);
    }
}
