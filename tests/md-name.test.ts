/**
 * `deriveName` / `validateTitle` / `normalizeName` / `allocUniqueName`
 * （P0-b + pm-name-distill Phase 2：文件身份名的形状规则与残句治理）。
 *
 * 名字直接当 `<root>/<type>/<name>.memory.md` 的文件名用，所以它的纪律**必须是**
 * `sanitizeFilename` 那一套（非法字符、Windows 保留设备名、stem 超长）——自己另写
 * 一份正则迟早和它漂移，漂移的后果是"库里存的名字写不出文件"。
 *
 * Phase 2 重写后新增：分段流水线（标题行 → 剥 markdown 前缀 → 剥叙述引子 → 结构边界截断
 * → 词元边界收尾 → 截断纪律）与 `validateTitle` 形状门禁。金标准表逐条钉住真机坏味样本
 * 在新流水线下的产物，防止退回"首行前 24 字"的残句行为。
 */
import { describe, expect, it } from 'vitest';
import { NAME_MAX, NARRATIVE_LEAD_INS, allocUniqueName, deriveName, fallbackStem, normalizeName, validateTitle } from '../src/util/md-name.js';

describe('deriveName（既有语义：取首行 / 截断 / 剥前缀 / 平台雷）', () => {
  it('取首个非空行，跳过 markdown 的前缀符号', () => {
    expect(deriveName('上行必须走官方地址\n因为镜像有同步延迟')).toBe('上行必须走官方地址');
    expect(deriveName('\n\n  # 标题式开头\n正文')).toBe('标题式开头');
    expect(deriveName('- 列表式记忆')).toBe('列表式记忆');
    expect(deriveName('> 引用式开头')).toBe('引用式开头');
  });

  it('截断到 NAME_MAX，且不会留尾部悬空分隔符', () => {
    const long = `${'记忆'.repeat(40)}\n第二行`;
    const n = deriveName(long);
    expect(n.length).toBeLessThanOrEqual(NAME_MAX);
    expect(n).not.toMatch(/[-_.]$/);
  });

  it('洗掉文件名非法字符（走 sanitizeFilename 的白名单）', () => {
    expect(deriveName('a/b\\c:d*e?f"g<h>i|j')).not.toMatch(/[/\\:*?"<>|]/);
    // 改处理由：Phase 2 词元边界收尾不再切半 ASCII 单词，NAME_MAX 也放宽到 28——
    // 旧值 'pnpm-install-frozen-lo' 把 'lockfile' 腰斩，新值整词丢弃超长尾词。
    expect(deriveName('pnpm install --frozen-lockfile')).toBe('pnpm-install-frozen');
  });

  it('Windows 保留设备名加前缀避让（CON.md 仍会命中设备语义）', () => {
    // 保留名判定不转小写（`CON` 与 `con` 都是设备名），故前缀后保留原大小写。
    expect(deriveName('CON')).toBe('_CON');
    expect(deriveName('nul')).toBe('_nul');
  });

  it('无可用文字时返回空串，**不**编一个看起来像名字的东西', () => {
    expect(deriveName('')).toBe('');
    expect(deriveName('   \n  \n')).toBe('');
    expect(deriveName('！！！')).toBe('');
    expect(deriveName('---')).toBe('');
  });

  it('CJK 与中英混排原样保留（白名单含汉字区，不该被洗成一串横线）', () => {
    expect(deriveName('DSH 宿主 0.2.0-rc.2 的 shell 能力缝')).toContain('宿主');
  });
});

describe('deriveName 分段流水线（Phase 2 金标准表：真机坏味样本 → 期望名字）', () => {
  // 每条取自 `_tmp-name-quality.txt` 的首行正文或坏味样本成因，钉死新流水线的真实产物。
  const GOLDEN: Array<[string, string, string]> = [
    ['g1', '上行必须走官方地址', '上行必须走官方地址'],
    ['g2', '# 记忆投射的落点规则', '记忆投射的落点规则'],
    ['g3', '- 列表式记忆条目', '列表式记忆条目'],
    ['g4', '> 引用式开头条目', '引用式开头条目'],
    ['g5', '用户规定 AI 在进行超出契约的修复时，修改前后必须分别创建独立的 commit 进行固定，作为开发流程约束。', 'AI-在进行超出契约的修复时-修改前后必须分别创建独立的'],
    ['g6', '用户要求将 dsh-agent-teams 插件适配 DSH 0.1.2 的根因分析报告保存为 Markdown 文件，落到仓库根目录。', 'dsh-agent-teams-插件适配-DSH-0.1'],
    ['g7', '团队已完成Codex 3个参考项目（bainianlaoyao/shuind/JohnXu22786）的代码拉取、分析、评估。', '完成Codex-3个参考项目'],
    ['g8', '会话 session-44332549-f05e-416f-8395-32fb7a585746 将三个参考仓库克隆至 release 目录。', '会话'],
    ['g9', 'buildTurnCompactSystemPrompt 负责组装每一轮的系统提示词。', 'buildTurnCompactSystemPrompt'],
    ['g10', 'C1-9a-1门禁判定与根因确认-Target..', 'C1-9a-1门禁判定与根因确认-Target'],
    ['g11', '针对 DSH 0.1.5 实时流经速度分析需求，推荐采用组合技术方案：使用 llm/stream 事件拦截原始流并进行实时统计。', 'DSH-0.1.5-实时流经速度分析需求-推荐采用组合技'],
    ['g12', 'dsh-bash-terminal 插件完整源码（12个文件）已下载并归档至本地路径 E:\\test\\rewrite-agently。', 'dsh-bash-terminal-插件完整源码'],
    ['g13', '团队将关于dsh-live-token-stats插件实时流分析接口调研的分析结果保存为Markdown报告，文件路径为 docs/report.md。', '关于dsh-live-token-stats插件实时流分'],
    ['g14', '脚本日志输出规范：`bili_collect.py` 移除所有 `print()` 控制台输出，改为网络请求与文件写入直报。', '脚本日志输出规范'],
    ['g15', '生成了压缩机制与输入器变更说明文档，详细解析了本地压缩与远程压缩的切换逻辑、UI 差异。', '压缩机制与输入器变更说明文档-详细解析了本地压缩与远程压'],
    ['g16', '已生成包含42条带星标标记的B站视频清单的Markdown文档，按投稿日期倒序排列，并附带时长异常分类。', '包含42条带星标标记的B站视频清单的Markdown文档'],
    ['g17', '错误可观测性规范：readPendingBuckets 的 catch 块静默返回空桶，混淆了文件缺失与文件损坏。', '错误可观测性规范'],
    ['g18', '团队已创建独立子场景文件《场景文件-DSH-NPM发布操作场景库.md》，涵盖NPM操作分类、权限矩阵。', '创建独立子场景文件-场景文件-DSH-NPM发布操作场景'],
    ['g19', 'L2 scene files are stored in `C:\\Users\\joshua\\.dsh\\memory\\scenes` directory.', 'L2-scene-files-are-stored-in'],
    ['g20', 'pnpm install --frozen-lockfile', 'pnpm-install-frozen'],
    ['g21', '记忆导入写入通道优先级为 C→B→A：通道 B 利用遗留 l1/records.jsonl 路径配合重启实现全字段保真导入。', '记忆导入写入通道优先级为-C-B-A'],
    ['g22', '用户（陈一鹏）的职业身份已更新：原为运维工程师，现具备 Web 编程能力，目前从事全栈开发工作。', '陈一鹏-的职业身份已更新'],
  ];

  it.each(GOLDEN)('%s：正文 %j 蒸馏为期望名字', (_k, content, expected) => {
    expect(deriveName(content)).toBe(expected);
  });

  it('金标准产物一律不切半 ASCII 单词、不以分隔符或句末标点收尾、不超 NAME_MAX', () => {
    for (const [, content] of GOLDEN) {
      const n = deriveName(content);
      if (n.length === 0) continue;
      expect(n.length).toBeLessThanOrEqual(NAME_MAX);
      expect(n).not.toMatch(/[-_.]$/);
      expect(n).not.toMatch(/[。！？]$/);
    }
  });

  it('剥叙述引子表后主句保留（引子常量导出、与 validateTitle 共用）', () => {
    // 「团队已完成Codex…」引子剥掉后剩「完成…」，括号里的仓库名整块丢弃。
    expect(deriveName('团队已完成Codex 3个参考项目（bainianlaoyao/shuind）拉取。')).toBe('完成Codex-3个参考项目');
    expect(NARRATIVE_LEAD_INS).toContain('用户要求');
    expect(NARRATIVE_LEAD_INS).toContain('团队已');
    // 允许单测扩展引子表：新加一项即被 deriveName 认作话头（连同其后标点一起丢）。
    expect(deriveName('结论：本批全绿通过校验')).toBe('本批全绿通过校验');
  });

  it('幂等：同一输入两次逐字同（无随机、无时间依赖）', () => {
    for (const [, content] of GOLDEN) {
      expect(deriveName(content)).toBe(deriveName(content));
    }
  });
});

describe('validateTitle（Phase 3 few-shot 门禁：形状判据）', () => {
  it('真机 5 个坏味样本全部 ok:false，且各自 reason 稳定', () => {
    expect(validateTitle('用户要求将-dsh-agent-teams-插件')).toEqual({ ok: false, reason: 'starts-with-lead-in' });
    expect(validateTitle('团队已完成Codex-3个参考项目-bainia')).toEqual({ ok: false, reason: 'starts-with-lead-in' });
    expect(validateTitle('会话-session-44332549-f0-2')).toEqual({ ok: false, reason: 'has-session-id' });
    expect(validateTitle('buildTurnCompactSystemPr')).toEqual({ ok: false, reason: 'code-identifier' });
    expect(validateTitle('C1-9a-1门禁判定与根因确认-Target..')).toEqual({ ok: false, reason: 'ends-with-punctuation' });
  });

  it('长度区间 4–28 之外的直接拒', () => {
    expect(validateTitle('abc')).toEqual({ ok: false, reason: 'too-short' });
    expect(validateTitle('x'.repeat(29))).toEqual({ ok: false, reason: 'too-long' });
  });

  it('换行 / 盘符路径 / 裸斜杠 / url / id 残片 各自命中', () => {
    expect(validateTitle('第一行\n第二行')).toEqual({ ok: false, reason: 'has-newline' });
    expect(validateTitle('E:\\x 路径名')).toEqual({ ok: false, reason: 'has-drive-path' });
    expect(validateTitle('读取 a/b 配置')).toEqual({ ok: false, reason: 'has-slash' });
    expect(validateTitle('http 下载链接')).toEqual({ ok: false, reason: 'has-url' });
    expect(validateTitle('记录-12345-号')).toEqual({ ok: false, reason: 'has-id-fragment' });
  });

  it('干净人给名字放行，并返回过白名单后的归一值', () => {
    expect(validateTitle('上行必须走官方地址')).toEqual({ ok: true, name: '上行必须走官方地址' });
    expect(validateTitle('记忆投射的落点规则')).toEqual({ ok: true, name: '记忆投射的落点规则' });
  });
});

describe('截断纪律（task_2.3：12 条尾点形状输入全部收敛）', () => {
  // 旧流水线切在 '.' 上会留尾点 / 尾横线；新流水线一律剥净。
  const DOT_END_SHAPES: string[] = [
    `${'a'.repeat(27)}..rest tail here`,
    `${'配置'.repeat(20)}...`,
    `version 1.2.3.4.5.6.7.8.9.0 trailing`,
    `${'x'.repeat(26)}...tail`,
    `规则说明文字${'。'.repeat(3)}尾部悬空`,
    `Target value set to 9999... pending extra`,
    `${'记忆条目'.repeat(8)}...`,
    `npm publish --tag dsh-0.2.0 --access public ...`,
    `${'p'.repeat(25)}....more`,
    `路径 E:\\a\\b\\c\\d\\e\\f 后续内容`,
    `结论：值等于 3.14159 的近似`,
    `${'汉字汉字汉字'.repeat(4)}...end`,
  ];

  it('每一条产物都不以分隔符收尾、不超 NAME_MAX', () => {
    for (const content of DOT_END_SHAPES) {
      const n = deriveName(content);
      expect(n).not.toMatch(/[._-]$/);
      expect(n.length).toBeLessThanOrEqual(NAME_MAX);
    }
  });

  it('NAME_MAX 由 24 放宽到 28', () => {
    expect(NAME_MAX).toBe(28);
  });
});

describe('normalizeName（人给的改名入参）', () => {
  it('空串与超长都直接拒', () => {
    expect(normalizeName('')).toEqual({ ok: false, reason: 'empty' });
    expect(normalizeName('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(normalizeName('x'.repeat(NAME_MAX * 2 + 1))).toEqual({ ok: false, reason: 'too-long' });
  });

  it('含非法字符时**不静默洗掉**，而是报 illegal-chars（人以为改成了 A，实际存成 B 更糟）', () => {
    expect(normalizeName('bad/name')).toEqual({ ok: false, reason: 'illegal-chars' });
    expect(normalizeName('有 空格')).toEqual({ ok: false, reason: 'illegal-chars' });
  });

  it('全标点这类"洗完就空"的输入报 no-usable-char', () => {
    expect(normalizeName('!!!')).toEqual({ ok: false, reason: 'no-usable-char' });
  });

  it('合法名字原样通过，并返回归一后的值', () => {
    expect(normalizeName('pnpm-hoisted')).toEqual({ ok: true, name: 'pnpm-hoisted' });
    expect(normalizeName('上行必须走官方地址')).toEqual({ ok: true, name: '上行必须走官方地址' });
  });
});

describe('allocUniqueName（同一个基底洗出多个名字时的消歧）', () => {
  /** 空库：什么都不算占。 */
  const freeAll = () => true;

  it('基底没人占就直接用，并把它推进占用集', () => {
    const taken = new Set<string>();
    expect(allocUniqueName('官方地址上行', 'rec-0001', freeAll, taken)).toBe('官方地址上行');
    expect(taken.has('官方地址上行')).toBe(true);
    // 第二次同样基底 → 拿 -2（同一轮里的重复分配靠占用集挡住，不看库）。
    expect(allocUniqueName('官方地址上行', 'rec-0002', freeAll, taken)).toBe('官方地址上行-2');
  });

  it('基底已被库里另一条占着 → 走后缀，不拿别人的名字', () => {
    const taken = new Set<string>();
    const isFree = (n: string) => n !== '官方地址上行';
    expect(allocUniqueName('官方地址上行', 'rec-0003', isFree, taken)).toBe('官方地址上行-2');
  });

  it('后缀要留位置：总长不得超过 NAME_MAX', () => {
    const base = deriveName('记'.repeat(60));
    expect(base.length).toBe(NAME_MAX);
    const taken = new Set<string>([base]);
    const got = allocUniqueName(base, 'rec-0004', freeAll, taken);
    expect(got.length).toBeLessThanOrEqual(NAME_MAX);
    expect(got).toBe(`${base.slice(0, NAME_MAX - 2)}-2`);
  });

  it('基底洗不出名字（纯标点正文）时回落 mem-<id8>，两条也不互撞', () => {
    const taken = new Set<string>();
    const a = allocUniqueName('', 'abcdef1234500001', freeAll, taken);
    const b = allocUniqueName('', 'abcdef1234500002', freeAll, taken);
    expect(a).toBe(fallbackStem('abcdef1234500001'));
    expect(b).toBe(fallbackStem('abcdef1234500002'));
    expect(a).not.toBe(b);
  });

  it('回落名也被占时继续加后缀，绝不交出一个重复名', () => {
    const id = 'zzzz0000abcd1234';
    const stem = fallbackStem(id);
    const taken = new Set<string>([stem, `${stem}-2`]);
    const got = allocUniqueName('', id, freeAll, taken);
    expect(got).toBe(`${stem}-3`);
  });

  it('与 deriveName 一致：蒸馏出来的名字一定过得了 normalizeName（两条路不能互斥）', () => {
    const derived = deriveName('反刍计数没有持久化\n第二轮又回到 12/20');
    expect(derived.length).toBeGreaterThan(0);
    expect(normalizeName(derived)).toEqual({ ok: true, name: derived });
  });

  it('回归护栏（task_2.5）：同基底 12 条经 allocUniqueName 不重名、后缀不超总长', () => {
    const base = deriveName('上行必须走官方地址'.repeat(4));
    expect(base.length).toBeLessThanOrEqual(NAME_MAX);
    const taken = new Set<string>();
    const got: string[] = [];
    for (let i = 0; i < 12; i++) {
      got.push(allocUniqueName(base, `rec-b2-${i}`, freeAll, taken));
    }
    expect(new Set(got).size).toBe(12);
    for (const n of got) expect(n.length).toBeLessThanOrEqual(NAME_MAX);
  });
});
