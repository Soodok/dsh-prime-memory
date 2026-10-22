/**
 * 图谱域约束常量的单一事实源。
 *
 * 提示词(src/prompts/graph-projection.ts)与校验(src/graph/apply.ts)两侧都从
 * 这里内插/引用——防"提示词说一套、校验执行另一套"的漂移。上限值从本项目自身
 * 的序列化约束推导(L1 content 上限、fact 行渲染宽度、上下文装配预算),不对照
 * 外部实现抄数。
 */
import type { GraphNodeType, GraphRecordStatus } from './types.js';
/** 节点类型词汇表(提示词枚举与 apply 校验共用;超集即丢弃提案)。 */
export declare const GRAPH_NODE_TYPES: readonly GraphNodeType[];
export declare const GRAPH_NODE_TYPE_SET: ReadonlySet<string>;
/** 记录生命周期四态(节点/fact/边通用)。 */
export declare const GRAPH_STATUSES: readonly GraphRecordStatus[];
export declare const GRAPH_STATUS_SET: ReadonlySet<string>;
/** 因果边四词单源(投影提示词枚举、校验与面板预览加权共用——防两处词表漂移)。 */
export declare const GRAPH_CAUSAL_RELATIONS: readonly ["导致", "因为", "修复了", "取代"];
/** 规范中文关系词(提示词给枚举;校验不做白名单——关系是开放词表,只做长度钳制)。
 *  尾部即因果集 GRAPH_CAUSAL_RELATIONS——让"前因后果"跨记录成链;仅当 graph.enabled 时
 *  才参与投影(整块图谱默认关,不碰非图谱用户的蒸馏产物)。 */
export declare const GRAPH_RELATION_WORDS: readonly ["使用", "属于", "创建", "参与", "贡献", "依赖", "位于", "相关", "导致", "因为", "修复了", "取代"];
/** 提案字段上限(校验侧截断/丢弃与提示词内插共用同一组数字)。 */
export declare const GRAPH_CAP: {
    /** 提案内临时引用(ref)长度。 */
    readonly ref: 120;
    /** 节点显示名。 */
    readonly name: 160;
    /** 单个别名/标签/关系词。 */
    readonly alias: 80;
    readonly tag: 60;
    readonly relation: 60;
    /** 节点状态行与单条 fact 值(与召回注入的单条 maxCharsPerMemory 默认 500 同量级,给足余量)。 */
    readonly state: 1200;
    readonly factKey: 120;
    readonly factValue: 1200;
    /** fact 值为数组时的元素数与每元素长度。 */
    readonly factValueItems: 40;
    /** 单节点提案的别名/标签条数上限。 */
    readonly aliases: 20;
    readonly tags: 12;
    /** 单提案允许引用的来源记录数(正常远小于批大小;钳到批上限的整数倍防畸形输出)。 */
    readonly proposalSources: 64;
    /** 单个日期字符串(validFrom/validTo)长度。 */
    readonly date: 80;
};
/**
 * 节点累计 sourceRecordIds 的并集封顶(保最新):图谱可重建,来源集只增会让
 * 长寿命节点(如"用户本人")的来源数组无界增长;封顶后丢的是最老的来源引用,
 * 状态仍由 active facts 决定,不影响可追溯性主体。
 */
export declare const GRAPH_SOURCE_RECORDS_CAP = 128;
