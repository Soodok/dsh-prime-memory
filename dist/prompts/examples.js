/**
 * 名称蒸馏（Phase 3）的标准格式示例集。
 *
 * 为什么必须有示例而不是只给定义：只写"6–14 字名词短语"这句散文，模型就是照着它自由
 * 发挥——真机 `deriveName` 那批名字正是"看起来像定义、实际是句子残片"。示例是唯一能让
 * 模型看清 **title 与 content 边界**的形状：两者必须在同一个例子里并列可见。
 *
 * 三条硬约束（都有对应用例钉着，不靠自觉）：
 * 1. **每个止例的 title 都必须过 `validateTitle`**——否则等于示范一个会被自己闸门拒掉的名字；
 * 2. **每个止例的 content 都必须就是 `narrativeTemplates`（G2）那套骨架的产物**——否则同时开
 *    两个开关时，模型在一份提示里看到两套互相矛盾的示范；
 * 3. **总长有预算上限**：这份示例每轮蒸馏都要付，是固定成本，不是免费午餐。
 *
 * 反例同样必要：模型最容易犯的三类错（抄句首、塞路径、留话头）各给一条"不要这样"。
 */
import { NAME_MAX, validateTitle } from '../util/md-name.js';
/** 示例集总长预算（字符）。超了就该减条数，而不是悄悄放宽。 */
export const FEW_SHOT_BUDGET = 1400;
/**
 * 止例集。每条的 content 都按 G2 骨架写成"前因后果"，title 是它的名词短语摘要。
 *
 * 刻意覆盖到 title 的四种难头：含英文标识符（吃字符额度）、含数字（容易被当 id 残片）、
 * 纯中文短语、以及"主语是团队/用户"的正当名词短语（这几个词作**短语**开头是合法的，
 * 只有叙述引子才算话头）。
 */
export const TITLE_GOOD_EXAMPLES = [
    {
        type: 'work_fact',
        title: 'npm发布必须显式指定registry',
        content: '结论：npm publish 必须显式带 --registry=https://registry.npmjs.org。依据：默认 registry 指向镜像时发布打到镜像会失败或错投，本机 ~/.npmrc 实测如此。适用范围：所有对外发包；镜像有同步延迟，view 也必须钉源。',
    },
    {
        type: 'work_method',
        title: '记忆改名后的孤儿文件归档流程',
        content: '目标：把改名后无人认领的投射文件收掉，避免活档案堆积。步骤：先按账本双指纹判定谁变了，回灌或重写使两侧一致，再扫描账本键与记录落点的差集，把孤儿搬进归档目录（不删，保留相对形状）。注意：来路不明的文件一律不动，那可能是人放进来等着同步的输入。',
    },
    {
        type: 'work_task',
        title: '六线宿主兼容冒烟任务状态',
        content: '任务：为 dsh 插件做六线宿主冒烟。当前状态：0.2.0 与 0.1.7 两线已跑通，其余四线未跑。下一步/阻塞：需要保留场格子里的凭据刷新，负责人为仓库维护者，截止未定。',
    },
    {
        type: 'work_artifact',
        title: '宿主子系统解读文档集',
        content: '交付物：宿主内部架构的 digest 分片文档集。位置：仓库 docs 目录下的模块化分片。用途/结论：给插件作者定位"要改哪一层"，源码锚点侧车标注 file:line 与对应宿主版本。',
    },
    {
        type: 'instruction',
        title: '修改用户环境前须确认可逆性与影响范围',
        content: '规则：任何改动用户环境（配置、依赖、profile、运行中实例）之前必须先说明可逆性与爆炸范围并获确认。触发时机：需要重启服务、改写配置、安装依赖、发布到 registry 时。反例/边界：只读取证与临时目录内的自检不受此限，不必为读操作索要许可。',
    },
    {
        type: 'persona',
        title: '偏好短命令先行后解释的沟通风格',
        content: '偏好：回复要先给可执行的下一步，再给理由。表现：长铺垫会被打断，明确要求"别写前言和收尾"。强度：跨多个会话稳定成立，属硬性偏好。',
    },
];
/** 反例：模型最常犯的三种错，各给一条"不要这样"。 */
export const TITLE_BAD_EXAMPLES = [
    { title: '用户要求以后所有 npm publish 必须显式带参数', why: '是个句子，且以叙述引子开头——title 回答"讲的是什么"，不是"谁说了什么"' },
    { title: '保存到 docs/report.md 的调研结论', why: '含路径分隔符，且"保存到…"是动作不是主题' },
    { title: '会话-session-44332549-f05e', why: '残留 id 片段，换一批记录就换个名字，不能当身份' },
];
/** 止例里最不该出现的一件事：title 直接抄 content 开头。挑一条做自检。 */
function copiesContentStart(g) {
    const c = g.content.trim();
    return c.startsWith(g.title) || g.title.length >= NAME_MAX;
}
/** 供用例与提示词共用：把止例渲染成"输入 → 输出对象"的示范块。 */
export function renderGoodExample(g) {
    return `type=${g.type}\ntitle：${g.title}\ncontent：${g.content}`;
}
/**
 * 追加到抽取系统提示尾部的示例段。
 *
 * 只在 `cfg.naming.fewShot` 为真时拼上（默认关）：它每轮都收固定成本，值不值要靠
 * A/B 的 fallback 率说话，不能靠"看起来更专业"。
 */
export const EXTRACTION_FEW_SHOT = `

【标准格式示例】下面每例的 title 与 content 是**并列的两个产物**：title 是名词短语（回答"这条讲的是什么"），content 是完整叙述正文。**不要**把 content 的开头抄成 title。

${TITLE_GOOD_EXAMPLES.map(renderGoodExample).join('\n\n')}

【不要这样】
${TITLE_BAD_EXAMPLES.map((b) => `- ✗ ${b.title}　→ ${b.why}`).join('\n')}
`;
/**
 * 各类型的"前因后果"要素表（照 G2 `NARRATIVE_CLAUSE` 写，不另造一套定义）。
 *
 * 为什么需要它：可用性判据是用户定的——"content 没前因后果、写不全就不算可用"。
 * 那句活若只留在提示词里就永远没法判定、也没法拿它定默认值，所以每个类型拆 3 个要素，
 * 每个要素给一组词元（命中任一即算在）。
 *
 * **这是关键词启发式，不是语义判定**：要素换个说法就接不住；G2 自己也允许"信息不足则省略该节"。
 * 因此它只能用于**同一输入下两臂相对比较**，不能当绝对质量分。
 */
export const SKELETON_ELEMENTS = {
    work_method: [
        { name: '目标', anyOf: ['目标', '目的', '为了', '旨在'] },
        { name: '步骤', anyOf: ['步骤', '做法', '先', '再', '然后', '流程', '执行'] },
        { name: '前置/注意', anyOf: ['前置', '注意', '前提', '坑', '风险', '必须', '不能'] },
    ],
    work_fact: [
        { name: '结论/事实', anyOf: ['结论', '事实', '必须', '只能', '会', '导致', '默认'] },
        { name: '依据', anyOf: ['因为', '由于', '实测', '验证', '确认', '依据', '来源', '试过'] },
        { name: '适用范围/失效', anyOf: ['适用', '范围', '失效', '仅', '除非', '例外'] },
    ],
    work_task: [
        { name: '任务', anyOf: ['任务', '需求', '要做', '目标', '工作'] },
        { name: '当前状态', anyOf: ['当前', '状态', '进度', '已', '未', '完成', '跑通'] },
        { name: '下一步/阻塞', anyOf: ['下一步', '阻塞', '待', '计划', '负责人', '截止', '尚需'] },
    ],
    work_artifact: [
        { name: '交付物', anyOf: ['交付', '文档', '报告', '产物', '脚本', '清单', '模块'] },
        { name: '位置', anyOf: ['位置', '路径', '目录', '链接', '存放', '落到', '位于'] },
        { name: '用途/结论', anyOf: ['用途', '供', '用于', '结论', '便于', '可用'] },
    ],
    instruction: [
        { name: '规则', anyOf: ['规则', '必须', '不得', '禁止', '要求', '一律'] },
        { name: '触发时机', anyOf: ['触发', '时机', '当', '若', '之前', '之后'] },
        { name: '反例/边界', anyOf: ['反例', '边界', '例外', '不适用', '除非', '不必', '豁免'] },
    ],
    episodic: [
        { name: '事件', anyOf: ['发生', '做了', '完成', '处理', '排查', '提交'] },
        { name: '时间/参与者', anyOf: ['时间', '于', '日', '当天', '用户', '团队', '会话'] },
        { name: '结果', anyOf: ['结果', '产出', '导致', '得以'] },
    ],
    persona: [
        { name: '偏好/习惯', anyOf: ['偏好', '习惯', '喜欢', '倾向', '风格'] },
        { name: '表现/例子', anyOf: ['表现', '例子', '例如', '总是', '会'] },
        { name: '强度', anyOf: ['一直', '从不', '总是', '硬性', '强烈', '优先', '稳定'] },
    ],
};
/** 不在表里的类型（宿主那 29 类新词）共用一个兼容要素集，不拿未知类型假判完备。 */
const GENERIC_ELEMENTS = [
    { name: '事实', anyOf: ['是', '为', '必须', '会', '有'] },
    { name: '原因', anyOf: ['因为', '由于', '原因', '实测', '验证'] },
    { name: '边界', anyOf: ['适用', '范围', '仅', '除非', '注意'] },
];
/**
 * 按类型给 content 打骨架分（关键词启发式，局限见 {@link SKELETON_ELEMENTS}）。
 *
 * @param type - 记忆类型。
 * @param content - 模型产出的正文。
 * @returns 命中情况；空正文算 0 命中而不是"齐备"。
 */
export function scoreSkeleton(type, content) {
    const spec = SKELETON_ELEMENTS[type] ?? GENERIC_ELEMENTS;
    const text = typeof content === 'string' ? content : '';
    const 缺 = [];
    for (const el of spec) {
        if (!el.anyOf.some((k) => text.includes(k)))
            缺.push(el.name);
    }
    return {
        类型: type,
        要素数: spec.length,
        命中数: spec.length - 缺.length,
        缺,
        齐备: text.trim().length > 0 && 缺.length === 0,
        无表可依: SKELETON_ELEMENTS[type] === undefined,
    };
}
/** 自检：示例本身是否合格（用例直接吃这个函数，不在用例里手抄判据）。 */
export function auditFewShot() {
    const badTitles = TITLE_GOOD_EXAMPLES.filter((g) => !validateTitle(g.title).ok).map((g) => g.title);
    // 止例自己必须骨架齐备：否则示例就是在示范"只写一句"，而定义与判据全部白写。
    const thin = TITLE_GOOD_EXAMPLES.filter((g) => !scoreSkeleton(g.type, g.content).齐备)
        .map((g) => `${g.type}:${scoreSkeleton(g.type, g.content).缺.join('/')}`);
    return {
        超预算: EXTRACTION_FEW_SHOT.length > FEW_SHOT_BUDGET,
        长度: EXTRACTION_FEW_SHOT.length,
        不合格title: badTitles,
        抄content开头: TITLE_GOOD_EXAMPLES.filter(copiesContentStart).map((g) => g.title),
        止例骨架不全: thin,
    };
}
