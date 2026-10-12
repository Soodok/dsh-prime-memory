/**
 * 「记忆已声明过时」一次性播报 Hook。
 *
 * 用户在召回卡上打 `-1` 之后，记忆库那侧当场退场了，但模型此刻的上下文里那条记忆
 * 还在——它必须被告知"这条已由用户判定过时，别再依据它作答"，否则退场只发生在
 * 用户看得见的地方，模型仍在按旧信息干活。
 *
 * 与槽位常驻注入（`slot-recall.ts`）的分工：那是**跨会话常驻**的约定，每轮都在；
 * 本 Hook 是**一次性**的更正通知，`drain` 取走即离队，下一轮就没有了。
 *
 * 门控：`cfg.recallFeedback.enabled && cfg.recallFeedback.announce`。关时不进
 * `agent/pre-step` 的注入分支（零出队、零新帧），既有会话逐字现状。
 *
 * 注入帧形状刻意与 recall/slot 同源（`source.kind:'plugin:memory'` + `form:'recall'`）：
 * 改这个形状会让宿主的"记忆召回份额"统计漏判（isOwnRecallSource），是踩过的红线。
 * 正文按宿主 house style 转义闭合标签，防伪造帧边界。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { MemoryConfig } from '../config.js';
import type { ObsoleteNoticeStore } from '../store/obsolete-notices.js';
import type { MemoryLogger } from '../types.js';
export interface ObsoleteNoticeController {
    /** 生成本轮播报文本(null = 无待播报)；导出供单元测试。会**出队**。 */
    buildInjection(sessionKey: string): string | null;
}
export declare function registerObsoleteNotice(ctx: Context, cfg: MemoryConfig, notices: ObsoleteNoticeStore, logger: MemoryLogger): ObsoleteNoticeController;
