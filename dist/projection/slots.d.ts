/**
 * 激活槽位服务端投影(memorySlots)。
 *
 * 展示契约：本 key 由 **dsh-brief-sidebar** 消费（「记忆槽位分区」）。宿主契约说明
 * 不注册时 key 会从快照消失、客户端读作 capability absence（降级优雅，不致加载失败），
 * 所以摘注册不会弄坏会话，但会让旧版消费方默默丢分区——要隐藏那张卡请走它的开关。
 * 另：会话召回的展示走 `memoryRecall` 投影与 client 浮层（SessionRecalledArea），不得灌进本投影。
 *
 * 只注册服务端单元,绝不做 client——前端展示由未来 brief-sidebar 消费(下一轮)。
 * 注册经 ctx.inject(['sessionProjections'], …):服务缺席时静默不注册、不抛错
 * (注册表里没有 key 时客户端读 faceOf(key) 恒为 undefined,侧边栏栏位自然隐藏)。
 *
 * apply 同步、闭包 SlotStore:tool/result(settled)时同步读 revision() 判脏,rev 未变
 * 返回同引用(避免每帧 republish),rev 变才重建快照。view 用 WeakMap 保引用稳定。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SlotStore } from '../store/slots.js';
export declare const MEMORY_SLOTS_KEY = "memorySlots";
export interface SlotsViewSlot {
    id: string;
    title: string;
    kind: string;
    status: string;
    priority: number;
    /** 原始引用(L1 record_id / 文件路径 / URL);存在才校验,旧 checkpoint 无此字段照常通过。 */
    refs?: string[];
    /**
     * L1 record_id 类引用的解析视图(v0.20.2):ref → 名称简述(content 首行截断)。
     * 前端展示用;解析发生在投影帧构建时(帧随 slots rev 刷新,L1 记录后续编辑
     * 不回灌旧帧——引用集在写入时即冻结,可接受)。缺失/已退场记录不产生条目,
     * 前端回落显示原始 ref。
     */
    refViews?: SlotRefView[];
}
/** 一条 record_id 引用的展示解析。 */
export interface SlotRefView {
    ref: string;
    title: string;
    /**
     * 记忆文件相对路径（`<type>/<name>.memory.md`）。
     * 拼接绝对地址：
     * - 有 workspaceId → `<workspaceId>/.agents/memory/<filePath>`
     * - 无 workspaceId → `<memoriesRoot>/<filePath>`（由消费方自行解析根目录）
     */
    filePath?: string;
    /** 记忆归属的工作区绝对路径；空串/undefined = global（无 workspace）。 */
    workspaceId?: string;
}
export interface SlotsProjectionState {
    rev: number;
    count: number;
    openCount: number;
    slots: SlotsViewSlot[];
}
export interface SlotsView {
    rev: number;
    count: number;
    openCount: number;
    slots: SlotsViewSlot[];
}
/**
 * 零依赖 schema:`sessionProjections` 契约在类型层写的是 zod 的 `ZodType`,但运行时
 * **只调用 `parse(value)`** 一个方法(实测 registry `viewCheckpoint`/`restore`/`drive`/
 * `viewCell` 四处)。本插件不新增依赖(不引 zod —— package.json/锁文件不在本轮改动白名单,
 * 且声明式依赖缺失会在严格 node_modules 布局下解析失败),改为自实现等价校验器。
 *
 * 语义边界(有意为之,非"占位"):
 * - 合法 → **原样返回同一引用**(不 clone、不 strip):registry 按 `Object.is` 比较 view,
 *   clone 会破坏引用稳定契约;
 * - 非法 → **抛错**:`parse` 是 registry 的校验闸(状态回放前 / wire 出网前),
 *   静默透传会让损坏的持久态与越界 view 一路带进客户端;
 * - **未知键容忍**(不拒绝):`drive` 期 `viewSchema.parse` 无 try/catch,若新增字段即抛错
 *   会打断整条会话事件驱动;view 的字段集由构造函数固定 + 单测断言(F9)保证。
 */
interface SchemaLike<T> {
    parse(value: unknown): T;
}
/** 持久态校验:registry 用它挡掉损坏/过期的 checkpoint 行(row 不合法即整条丢弃)。 */
export declare const stateSchema: SchemaLike<SlotsProjectionState>;
/** wire view 校验:registry 在 view 出网前调用(也覆盖 live drive 的发布路径)。 */
export declare const viewSchema: SchemaLike<SlotsView>;
/** 投影需要的 L1 只读面(结构化声明,避免跨模块类型耦合)。 */
export interface L1LookupFace {
    getByIds(ids: string[]): Array<{
        id: string;
        content: string;
        type: string;
        name?: string;
        workspaceId?: string;
    }>;
}
export declare function registerSlotsProjection(ctx: Context, store: SlotStore, l1?: L1LookupFace): void;
export {};
