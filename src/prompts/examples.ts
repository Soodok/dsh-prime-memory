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

/** 一条止例：会话片段 → 模型该产出的 title/content 对。 */
interface GoodExample {
  /** 类型（与 G2 骨架同名，方便对照）。 */
  type: string;
  title: string;
  content: string;
}

/**
 * 止例集。每条的 content 都按 G2 骨架写成"前因后果"，title 是它的名词短语摘要。
 *
 * 刻意覆盖到 title 的四种难头：含英文标识符（吃字符额度）、含数字（容易被当 id 残片）、
 * 纯中文短语、以及"主语是团队/用户"的正当名词短语（这几个词作**短语**开头是合法的，
 * 只有叙述引子才算话头）。
 */
export const TITLE_GOOD_EXAMPLES: readonly GoodExample[] = [
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
export const TITLE_BAD_EXAMPLES: ReadonlyArray<{ title: string; why: string }> = [
  { title: '用户要求以后所有 npm publish 必须显式带参数', why: '是个句子，且以叙述引子开头——title 回答"讲的是什么"，不是"谁说了什么"' },
  { title: '保存到 docs/report.md 的调研结论', why: '含路径分隔符，且"保存到…"是动作不是主题' },
  { title: '会话-session-44332549-f05e', why: '残留 id 片段，换一批记录就换个名字，不能当身份' },
];

/** 止例里最不该出现的一件事：title 直接抄 content 开头。挑一条做自检。 */
function copiesContentStart(g: GoodExample): boolean {
  const c = g.content.trim();
  return c.startsWith(g.title) || g.title.length >= NAME_MAX;
}

/** 供用例与提示词共用：把止例渲染成"输入 → 输出对象"的示范块。 */
export function renderGoodExample(g: GoodExample): string {
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

/** 自检：示例本身是否合格（用例直接吃这两个函数，不另抄一份判据）。 */
export function auditFewShot(): { 超预算: boolean; 长度: number; 不合格title: string[]; 抄content开头: string[] } {
  const badTitles = TITLE_GOOD_EXAMPLES.filter((g) => !validateTitle(g.title).ok).map((g) => g.title);
  return {
    超预算: EXTRACTION_FEW_SHOT.length > FEW_SHOT_BUDGET,
    长度: EXTRACTION_FEW_SHOT.length,
    不合格title: badTitles,
    抄content开头: TITLE_GOOD_EXAMPLES.filter(copiesContentStart).map((g) => g.title),
  };
}
