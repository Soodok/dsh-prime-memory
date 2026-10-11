/**
 * 反刍控制器:按用户指令把未蒸馏缓冲冲刷出来,跑一轮 L1 抽取 → L2 场景整合 → L3 画像更新,
 * 可选图谱投影。与 rebuild 不同:不清库、不改 L0、不归档旧产物;仅消化"攒而未蒸馏"的切片。
 *
 * 语义:
 * - 扫描 pending 三桶(auto/chat/work),按会话分组,逐个入队强制蒸馏(force=true);
 * - 蒸馏完成后按族强制 L2(把未整合的残余记录全部落进场景);
 * - L3 画像冷启动更新(hasPersona=false 时自动触发,已有人格则轻量刷新);
 * - 若有图谱投影,新记录自动入队(由 runner 的图谱泵接管)。
 * - 支持中途取消:已蒸馏部分保留,pending 切片中未被消费的维持原状。
 *
 * 调度:任务入队走 runner 的优先级队列(live 任务优先于 ruminate 任务),
 * 不阻塞宿主正常对话。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { MemoryConfig } from '../config.js';
import type { L1Store } from '../store/l1.js';
import { type MemoryBackend } from '../store/memory-backend.js';
import type { PersonaStore } from '../store/persona.js';
import type { SceneStore } from '../store/scenes.js';
import type { StateStore } from '../store/state.js';
import type { LiveSettingsHandle } from '../settings.js';
import type { MemoryFamily, MemoryLogger } from '../types.js';
import { type SlotMigrateStoreFace } from './slot-migrate.js';
import { type RelabelStats } from './relabel.js';
import type { MemoryRunner } from './runner.js';
export interface RuminateStatus {
    running: boolean;
    /** 当前阶段:idle / refreshing / distilling / consolidating / updating / done / cancelled / failed */
    phase: string;
    /** 已完成会话数(轻量刷新为已完成步骤数) */
    done: number;
    /** 待处理会话数(轻量刷新为待执行步骤数) */
    total: number;
    /** 蒸馏产出记录总数 */
    recordsBuilt: number;
    /** 当前动作的人类可读描述(L2/L3 单次可达分钟级) */
    detail: string | null;
    /** 标注校验/重标定结果(最后一次反刍/轻量刷新;未执行或旧版为 null)。 */
    relabel: RelabelStats | null;
    /** 子进度:非会话阶段(relabeling)的批次进度,由重标定批回调驱动;离开阶段即清空。 */
    sub: {
        done: number;
        total: number;
        label: string;
    } | null;
    /** 取消请求标志 */
    cancelRequested: boolean;
    /** 开始时间 */
    startedAt: number | null;
    /** 结束时间 */
    finishedAt: number | null;
    /** 错误信息(失败时) */
    error: string | null;
}
export declare class RuminateController {
    private readonly ctx;
    private readonly cfg;
    private readonly runner;
    private readonly stores;
    private readonly logger;
    private readonly live;
    private status;
    private cancelRequested;
    /** 启动守卫:置位早于 status.running,封住"await 读取"期间的双击窗口。 */
    private starting;
    private sessions;
    private totalL1;
    private pendingFile;
    /** Room 注册表(可选;孤儿候选预标记的合并词表来源)。 */
    private readonly roomRegistry;
    /** 记忆后端:未注入时包 l1(进程内,行为与改造前等价)。 */
    private backend;
    constructor(ctx: Context, cfg: MemoryConfig, runner: Pick<MemoryRunner, 'enqueue' | 'states'>, stores: {
        l1: L1Store;
        /** 记忆后端(后台边界);缺省 = 包 l1 的进程内实现(行为等价)。 */
        backend?: MemoryBackend;
        scenes: Record<MemoryFamily, SceneStore>;
        persona: Record<MemoryFamily, PersonaStore>;
        state: StateStore;
        /** 常驻槽位面（仅 cfg.slots.migrateLegacy 开启时读/写，缺省不碰）。 */
        slots?: SlotMigrateStoreFace;
    }, logger: MemoryLogger, live: LiveSettingsHandle, pendingFile: string, 
    /** Room 注册表(可选;孤儿候选预标记的合并词表来源)。 */
    roomRegistry?: {
        listActive(): Array<{
            slug: string;
            label?: string;
            description?: string;
        }>;
    });
    /** 状态快照 */
    getStatus(): RuminateStatus;
    /**
     * 启动反刍:扫描 pending 三桶,按会话分组,逐个入队蒸馏;完成后强制 L2+L3。
     * 桶形状的唯一权威是 store/pending.ts 的 loadPending——不得在本层再解析该文件。
     */
    start(): Promise<RuminateStatus>;
    /** 请求取消:当前块完成后停止,已蒸馏部分保留。 */
    requestCancel(): RuminateStatus;
    /** 入队一个会话。 */
    private doEnqueue;
    /** 收尾:强制 L2 + L3。 */
    private finalize;
    /**
     * 轻量刷新:没有 pending 时仅跑一轮 L2/L3。
     *
     * 为什么必须先置 running/phase:此处每次 runSceneConsolidation/runPersona 都是**真实 LLM 调用**
     * (实测单次可达 70s+),而本方法是 `await` 的、期间 `start()` 一直挂着并占住守卫。
     * 原先不置 running,导致刷新期间界面既无进度也无取消按钮,再点一次只得到"反刍已在进行中"
     * 却看不到任何进展——即用户反馈的"管线进度和状态提示仍然欠缺"。
     * 现在:先把步骤数登记为 total、每完成一步自增 done,并给出当前动作描述(detail)。
     */
    private doLightRefresh;
    private finish;
}
