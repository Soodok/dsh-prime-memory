import type { Context } from '@deepseek-ai/cordis';
import type { MemoryConfig } from '../config.js';
import type { LiveSettingsHandle } from '../settings.js';
import type { RuminateController } from '../pipeline/ruminate.js';
import type { GraphStore } from '../store/graph-store.js';
import type { L0Store } from '../store/l0.js';
import type { L1Store } from '../store/l1.js';
import type { PersonaStore } from '../store/persona.js';
import type { SceneStore } from '../store/scenes.js';
import type { SessionModeStore } from '../store/session-modes.js';
import type { MemoryFamily, MemoryLogger } from '../types.js';
import type { RoomRegistryStore } from '../store/rooms-registry.js';
export declare function registerMemoryTools(ctx: Context, cfg: MemoryConfig, stores: {
    l0: L0Store;
    l1: L1Store;
    scenes: Record<MemoryFamily, SceneStore>;
    persona: Record<MemoryFamily, PersonaStore>;
    /** 图谱存储(可选:未装配时图谱工具返回未启用提示)。 */
    graph?: GraphStore;
}, logger: MemoryLogger, modes: SessionModeStore, live: LiveSettingsHandle, 
/** 反刍控制器(可选:未装配时 ruminate 工具返回未启用提示)。 */
ruminate?: RuminateController, 
/** Room 注册表(分类管理 beta.4;缺省 = memory_room_admin 返回未装配提示)。 */
roomRegistry?: RoomRegistryStore): void;
