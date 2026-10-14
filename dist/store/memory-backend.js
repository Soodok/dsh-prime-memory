/**
 * 进程内实现:直接包 `L1Store` 的既有同步方法。
 *
 * 行为与改造前**完全等价**(零 IPC),用于:① 默认路径 ② worker 不可用时的降级
 * ③ 单测。把"接口化"和"线程化"分成两步,是为了让回归可归因。
 */
export class InProcMemoryBackend {
    l1;
    constructor(l1) {
        this.l1 = l1;
    }
    async allLite(limit, offset) {
        return this.l1.allLite(limit, offset);
    }
    async getByIds(ids) {
        return this.l1.getByIds(ids);
    }
    async list(opts) {
        return this.l1.list(opts);
    }
    async patchMetadata(id, metadata) {
        return this.l1.patchMetadata(id, metadata);
    }
    async patchMetadataAndReindex(id, metadata) {
        return this.l1.patchMetadataAndReindex(id, metadata);
    }
    async size() {
        return this.l1.size;
    }
    async dispose() {
        /* 进程内实现不持有资源:db 生命周期归插件所有 */
    }
}
