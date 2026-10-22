/** 节点类型词汇表(提示词枚举与 apply 校验共用;超集即丢弃提案)。 */
export const GRAPH_NODE_TYPES = ['person', 'project', 'organization', 'tool', 'place'];
export const GRAPH_NODE_TYPE_SET = new Set(GRAPH_NODE_TYPES);
/** 记录生命周期四态(节点/fact/边通用)。 */
export const GRAPH_STATUSES = ['active', 'superseded', 'disputed', 'archived'];
export const GRAPH_STATUS_SET = new Set(GRAPH_STATUSES);
/** 因果边四词单源(投影提示词枚举、校验与面板预览加权共用——防两处词表漂移)。 */
export const GRAPH_CAUSAL_RELATIONS = ['导致', '因为', '修复了', '取代'];
/** 规范中文关系词(提示词给枚举;校验不做白名单——关系是开放词表,只做长度钳制)。
 *  尾部即因果集 GRAPH_CAUSAL_RELATIONS——让"前因后果"跨记录成链;仅当 graph.enabled 时
 *  才参与投影(整块图谱默认关,不碰非图谱用户的蒸馏产物)。 */
export const GRAPH_RELATION_WORDS = ['使用', '属于', '创建', '参与', '贡献', '依赖', '位于', '相关', ...GRAPH_CAUSAL_RELATIONS];
/** 提案字段上限(校验侧截断/丢弃与提示词内插共用同一组数字)。 */
export const GRAPH_CAP = {
    /** 提案内临时引用(ref)长度。 */
    ref: 120,
    /** 节点显示名。 */
    name: 160,
    /** 单个别名/标签/关系词。 */
    alias: 80,
    tag: 60,
    relation: 60,
    /** 节点状态行与单条 fact 值(与召回注入的单条 maxCharsPerMemory 默认 500 同量级,给足余量)。 */
    state: 1_200,
    factKey: 120,
    factValue: 1_200,
    /** fact 值为数组时的元素数与每元素长度。 */
    factValueItems: 40,
    /** 单节点提案的别名/标签条数上限。 */
    aliases: 20,
    tags: 12,
    /** 单提案允许引用的来源记录数(正常远小于批大小;钳到批上限的整数倍防畸形输出)。 */
    proposalSources: 64,
    /** 单个日期字符串(validFrom/validTo)长度。 */
    date: 80,
};
/**
 * 节点累计 sourceRecordIds 的并集封顶(保最新):图谱可重建,来源集只增会让
 * 长寿命节点(如"用户本人")的来源数组无界增长;封顶后丢的是最老的来源引用,
 * 状态仍由 active facts 决定,不影响可追溯性主体。
 */
export const GRAPH_SOURCE_RECORDS_CAP = 128;
