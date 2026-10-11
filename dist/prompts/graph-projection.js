/**
 * 图谱投影 prompt(系统提示 + 用户上下文装配)。
 *
 * 净室边界:全文自写(C1)——只对齐"记录是唯一事实来源、关系用有向边表达、
 * 来源只能引用本批"的语义,措辞/示例/上限从本项目自身约束推导。
 * 字段上限与节点类型全部从 src/graph/constraints.ts 内插(防提示词/校验漂移:
 * 常量改动时提示词自动跟随,测试另以"提示词含全部类型与上限数字"双钉固定)。
 * 文末的 golden 示例(GRAPH_PROJECTION_EXAMPLE)同时是 G1 apply 的校验样本——
 * 提示词示例与校验器共用同一条真值,示例漂移会直接挂测试。
 */
import { GRAPH_CAP, GRAPH_NODE_TYPES, GRAPH_RELATION_WORDS } from '../graph/constraints.js';
import { CONTENT_IS_DATA_CLAUSE, DATA_DELIMITER_NOTE } from './boundary.js';
/** 单条记忆在 prompt 中的字符上限(8 条/批 × 2000 字 ≈ 1.6 万字,远低于输入预算)。 */
export const GRAPH_RECORD_TEXT_LIMIT = 2000;
/** 上下文节点序列化时每节点携带的 active 事实条数上限。 */
export const GRAPH_PROMPT_FACTS_PER_NODE = 8;
/** 单条事实值在 prompt 中的字符上限。 */
export const GRAPH_PROMPT_FACT_CHARS = 200;
/** 投影任务无产出时的约定返回(写入 prompt 与测试)。 */
export const GRAPH_EMPTY_RESULT_HINT = '{"reason":"本批没有值得沉淀的实体或关系","nodes":[],"edges":[]}';
/** golden 示例:提示词展示的输出样例,同时是 apply 校验器的零丢弃回归样本。 */
export const GRAPH_PROJECTION_EXAMPLE = {
    reason: '本批记录提到张三参与 GraphX 项目并使用 VSCode,沉淀实体与协作关系',
    nodes: [
        {
            ref: 'n1',
            name: '张三',
            type: 'person',
            aliases: ['老张'],
            tags: ['前端负责人'],
            state: '负责 GraphX 的前端模块',
            facts: [{ key: '职位', value: '前端负责人' }],
            confidence: 0.9,
            sourceRecordIds: ['rec-1'],
        },
        {
            ref: 'n2',
            name: 'GraphX',
            type: 'project',
            tags: ['可视化'],
            state: '正在开发图谱可视化模块',
            facts: [{ key: '里程碑', value: ['完成 Schema 设计', '联调中'] }],
            confidence: 0.85,
            sourceRecordIds: ['rec-1', 'rec-2'],
        },
        {
            ref: 'n3',
            name: 'VSCode',
            type: 'tool',
            confidence: 0.8,
            sourceRecordIds: ['rec-2'],
        },
    ],
    edges: [
        { fromRef: 'n1', toRef: 'n2', relation: '参与', confidence: 0.9, sourceRecordIds: ['rec-1'] },
        { fromRef: 'n1', toRef: 'n3', relation: '使用', confidence: 0.8, sourceRecordIds: ['rec-2'] },
    ],
};
/** 系统提示(约束常量内插;类型/关系词/上限与校验器同源)。 */
export function getGraphProjectionSystemPrompt() {
    return `你是记忆系统的知识图谱投影器。输入是一批 L1 记忆记录(唯一事实来源)与图谱中已有的实体节点,你的任务是从记录中识别值得长期沉淀的实体与它们之间的有向关系,输出节点与边的提案。

${CONTENT_IS_DATA_CLAUSE}

## 铁律

- **记录是唯一事实来源**:提案中的每个结论都必须来自本批提供的记忆记录,禁止使用任何常识推断或输入之外的知识;无法对应到记录 id 的提案会被系统直接丢弃。
- **来源引用**:每个节点、每条 fact、每条边的 sourceRecordIds 只能填本批输入中出现的记录 id。
- **关系必须用有向边表达**(fromRef/toRef),禁止把"A 属于 B"这类关系写成 fact 字符串——fact 只描述实体自身属性。
- **别名合并**:同一实体的拼写变体(全角/半角、大小写、空格连字符差异)必须合并到同一节点,新变体放进 aliases,不要创建重复节点。
- 子串相似不是同一实体:只有归一后名称一致且类型相同才视为同一实体。

## 节点类型(只允许这五类)

${GRAPH_NODE_TYPES.join(' | ')}

- tags 是语义角色标签(如"前端负责人"、"可视化"),每节点 1~6 个,不能替代稳定的 type。
- 单行状态(state)描述实体"现在是什么状态";facts 是结构化属性(key/value)。
- 日期字段(validFrom/validTo)只在记录中有明确时间证据时填写,格式 ISO,不猜测。

## 关系词(用规范中文)

${GRAPH_RELATION_WORDS.join('、')}(也可用其他贴切的中文动词短语,≤${GRAPH_CAP.relation} 字)

当记录**显式陈述了因果**时,优先用因果边表达(如「X 导致 Y」「X 修复了 Y」「X 因为 Y」「A 取代 B」),
这能让前因后果跨记录成链。因果边只写在**记录里有明确依据**的关系上,不做常识推断(见铁律)。

## 字段上限

- name ≤${GRAPH_CAP.name} 字;aliases ≤${GRAPH_CAP.aliases} 条;tags ≤${GRAPH_CAP.tags} 个
- state ≤${GRAPH_CAP.state} 字;fact 的 key ≤${GRAPH_CAP.factKey} 字、value ≤${GRAPH_CAP.factValue} 字(数组值 ≤${GRAPH_CAP.factValueItems} 个元素)
- 单提案 sourceRecordIds ≤${GRAPH_CAP.proposalSources} 个

## 输出格式

严格输出一个 JSON 对象,不输出任何其他内容(包括解释或代码围栏):

{
  "reason": "一句话说明本批沉淀了什么(或为什么为空)",
  "nodes": [
    {
      "ref": "提案内临时引用(如 n1),边的 fromRef/toRef 用它连线",
      "name": "实体名",
      "type": "person|project|organization|tool|place",
      "aliases": ["拼写变体"],
      "tags": ["语义角色标签"],
      "state": "单行当前状态(可选)",
      "facts": [{ "key": "属性名", "value": "属性值或字符串数组" }],
      "validFrom": "ISO 日期(可选,有证据才填)",
      "confidence": 0.9,
      "sourceRecordIds": ["本批记录 id"]
    }
  ],
  "edges": [
    { "fromRef": "n1", "toRef": "n2", "relation": "参与", "confidence": 0.9, "sourceRecordIds": ["本批记录 id"] }
  ]
}

没有值得沉淀的实体或关系时输出:${GRAPH_EMPTY_RESULT_HINT}`;
}
/** 上下文节点序列化(仅 active facts,有界;superseded/disputed 历史不进 prompt)。 */
export function serializeNodeForPrompt(node) {
    const parts = [
        `- id=${node.id} | ${node.name} | 类型 ${node.type}`,
    ];
    if (node.aliases.length > 0)
        parts.push(`  别名: ${node.aliases.join('、')}`);
    if (node.tags?.length)
        parts.push(`  标签: ${node.tags.join('、')}`);
    if (node.currentState)
        parts.push(`  状态: ${node.currentState.replaceAll('\n', ' / ')}`);
    const activeFacts = node.facts.filter((f) => f.status === 'active').slice(0, GRAPH_PROMPT_FACTS_PER_NODE);
    for (const f of activeFacts) {
        const value = Array.isArray(f.value) ? f.value.join('、') : f.value;
        parts.push(`  事实 ${f.key}: ${value.slice(0, GRAPH_PROMPT_FACT_CHARS)}`);
    }
    return parts.join('\n');
}
function recordLine(r) {
    const meta = r.metadata;
    const times = [];
    if (meta?.activity_start_time)
        times.push(`开始 ${String(meta.activity_start_time)}`);
    if (meta?.activity_end_time)
        times.push(`结束 ${String(meta.activity_end_time)}`);
    return [
        `- id=${r.id} | 类型 ${r.type}${r.family ? ` | 族 ${r.family}` : ''} | 记录时间 ${new Date(r.createdAt).toISOString()}`,
        `  内容: ${r.content.slice(0, GRAPH_RECORD_TEXT_LIMIT)}`,
        ...(times.length > 0 ? [`  活动时间: ${times.join(', ')}`] : []),
    ].join('\n');
}
function edgeLine(edges, nameOf) {
    return edges.map((e) => `- ${nameOf(e.fromNodeId)} --[${e.relation}]--> ${nameOf(e.toNodeId)}`);
}
/** 用户上下文装配(记录 + 已有节点 + 已有边;数量上限由调用方选择后传入)。 */
export function buildGraphProjectionPrompt(inputs) {
    const nameOf = new Map(inputs.nodes.map((n) => [n.id, n.name]));
    const nameFor = (id) => nameOf.get(id) ?? '(未知节点)';
    const sections = [];
    sections.push(`## 本批记忆记录(唯一事实来源;sourceRecordIds 只能引用这些 id)\n\n${DATA_DELIMITER_NOTE}\n\n${inputs.records.map(recordLine).join('\n') || '(空)'}`);
    sections.push(`## 图谱已有节点(合并实体时对照;别名变体并入这些节点而不是新建)\n\n${inputs.nodes.map(serializeNodeForPrompt).join('\n') || '(图谱当前为空)'}`);
    const lines = edgeLine(inputs.edges, nameFor);
    sections.push(`## 图谱已有边(active)\n\n${lines.join('\n') || '(无)'}`);
    sections.push('## 任务\n\n从本批记录中识别实体(五类节点)与有向关系,输出提案 JSON。注意:\n- 已有节点在本批出现新信息时,提案同一实体(名称归一一致 + 类型相同),系统会合并来源与别名;\n- 状态/事实随时间变化的,直接给新值,系统会自动关闭旧值的有效区间;\n- 同一关系指向新目标时系统自动 supersede 旧边,照常输出新边即可。');
    return sections.join('\n\n');
}
/** 生命周期词汇(节点状态中文标注,prompt/工具复用)。 */
export const GRAPH_STATUS_LABELS = {
    active: '生效中',
    superseded: '已被更新',
    disputed: '有争议',
    archived: '已归档',
};
