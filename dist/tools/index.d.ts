import type { Context } from '@deepseek-ai/cordis';
import type { MemoryConfig } from '../config.js';
import type { LiveSettingsHandle } from '../settings.js';
import type { RuminateController } from '../pipeline/ruminate.js';
import type { GraphStore } from '../store/graph-store.js';
import type { DrscClient } from '../clients/drsc.js';
import type { L1Store } from '../store/l1.js';
import type { PersonaStore } from '../store/persona.js';
import type { SceneStore } from '../store/scenes.js';
import type { SessionModeStore } from '../store/session-modes.js';
import type { MemoryFamily, MemoryLogger } from '../types.js';
import type { RoomRegistryStore } from '../store/rooms-registry.js';
/**
 * 封印登记面:把某个工具组的延迟注册交给 {@link registerMemoryTools} 的封印机制。
 * 组名见 `toolSealed` 的 switch;登记后是否真正注册由当前封印状态决定,
 * 并在 `loader/volatile-update` 时随 `applyToolSeals` 重放(热更)。
 */
export interface ToolSealRegistry {
    /** 登记一个工具组的一次性注册器;`make()` 须返回 `ctx.tools.register` 的 disposer。 */
    reg(group: string, make: () => () => void): void;
}
export declare function registerMemoryTools(ctx: Context, cfg: MemoryConfig, stores: {
    /** DRSC 客户端(T8.4 读切):conversation_search 的历史供给面;缺席=显式报错。 */
    drsc?: DrscClient;
    l1: L1Store;
    scenes: Record<MemoryFamily, SceneStore>;
    persona: Record<MemoryFamily, PersonaStore>;
    /** 图谱存储(可选:未装配时图谱工具返回未启用提示)。 */
    graph?: GraphStore;
    /** 人工打分面(可选)：冲突视图的成熟度旁注与面板同一口径。 */
    feedback?: {
        lastOf(id: string): number | undefined;
    };
}, logger: MemoryLogger, modes: SessionModeStore, live: LiveSettingsHandle, 
/** 反刍控制器(可选:未装配时 ruminate 工具返回未启用提示)。 */
ruminate?: RuminateController, 
/** Room 注册表(分类管理 beta.4;缺省 = memory_room_admin 返回未装配提示)。 */
roomRegistry?: RoomRegistryStore): ToolSealRegistry;
