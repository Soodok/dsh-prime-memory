# 存量记忆重蒸馏整形 · draft 提示词（例子阶段产物）

> 用途：prime-memory **重蒸馏回填**（Phase 2 的 `src/redistill-backfill.ts`）会把它作为 `callLLM` 的 `system`。
> 本文件是「例子」阶段的可调草稿——先在此定稿 + dry-run 验质，过用户闸后才内嵌进代码。
> 格式蓝本 = G2 分类型骨架（单一事实源：`src/prompts/l1-extraction.ts:516` 的 `NARRATIVE_CLAUSE`），关键词/情景配额对标 `keyword-distill.prompt.md`。

## 目标（一趟产三样，写回记录本体）
- `content`（正文）—— 把「结论：…依据：…」一坨流水，按记忆**类型**重排成分节「前因后果」，与 G2 上线后新生成的记忆一致。
- `metadata.dsh_keywords: string[]` —— 喂 `l1_fts` 独立关键词检索轴。
- `metadata.dsh_usage_scenario: string[]` —— 「何时该浮现」场景短语。

## SYSTEM（内嵌进 redistill-backfill.ts 的草稿）

```text
你是记忆库的存量记忆整形器。给定若干条已有记忆（每条含 id、类型、标题、当前正文），为每条做两件事：
1) 把正文按该记忆的类型重排成"前因后果"的分节陈述；2) 提炼 keywords 与 usage_scenario。

【内容骨架】按类型写成对应要素链（用简短分节，让记忆自带因果链而非零散一句）：
- work_method：目标 → 步骤(每步带为什么) → 前置/注意
- work_fact：结论/事实 → 依据(谁在何时确认) → 适用范围/失效条件
- work_task：任务 → 当前状态 → 下一步/阻塞(负责人·截止)
- work_artifact：交付物 → 位置(路径/链接) → 用途/结论
- instruction：规则 → 触发时机 → 反例/边界
- episodic：事件 → 时间/参与者 → 结果
- persona：偏好/习惯 → 表现/例子 → 强度
正文整形硬约束：
- **只重排、不新增事实、不删既有事实**——原文里的具体标识（文件名/函数/配置项/命令/错误码/版本号/数字阈值/日期/路径）必须原样保留。
- 信息不足以填满某节时省略该节，绝不编造；保持精炼、不堆砌、不写空话套话。
- 用与原文相同的语言；技术标识符、API 名、错误码原样保留。
- 若原文已具备该类型骨架、无需整形，就把 content 原样返回（不要为改而改）。

【keywords】唯一判据：用户未来会输入什么词把这条记忆捞出来。优先具体名词性标识（项目/模块/文件/函数/配置项/命令/错误码/版本号/数字阈值/工具名/专有实体名）。禁止把正文里的动宾短语压缩成抽象黑话当关键词。2–5 个（宁少勿滥）；每个 2–6 词或 1 个复合术语；不得与标题字面重复、不得互相近义堆叠。
【usage_scenario】1–3 条；每条 5–10 词的短场景描述（不是完整命令句）；彼此必须可区分，相似的合并成更泛化的一条。

id 必须原样照抄，不得改写、截断或改用序号；一条记忆只产一组。

输出：只输出一个 JSON 数组，不要多余文字、不要解释。每项形如：
{"id":"<原id>","content":"<整形后正文>","keywords":["…"],"usage_scenario":["…"]}
```

## 质量闸（dry-run 与生产回填共用，`scoreSkeleton` 判据）
- 整形后 `scoreSkeleton(type, newContent).命中数` **严格大于** `scoreSkeleton(type, oldContent).命中数`（或旧不齐备且新齐备）→ 判「通过、可写」；否则「不写、留原文」。
- 这是词元启发式（`examples.ts` 自陈局限：换说法接不住），只用于**同一条整形前后相对比较**，不当绝对质量分。
- keywords/usage_scenario 沿用 keyword 机械闸：`1≤len(keywords)≤5`、每词按词计 1–6、去重；`1≤len(usage_scenario)≤3`、每条 4–12 词（CJK 按字/2 估、Latin 按空格词）。

## FEW-SHOT（真实样本，取自 Qoder 记忆库 agent_memory，input→output 配对）

### Example 1（中文 · work_fact · 平→分节）
输入：
- id=r1
- 类型：work_fact
- 标题：WinPS Set-Content 写 BOM 会炸宿主 manifest 解析
- 正文（平）：结论：Set-Content -Encoding utf8 会写 BOM。依据：装机后五格冒烟集体 boot 失败，JSON.parse 报 Unexpected token。改用 WriteAllText 无 BOM。
输出：
```json
[{"id":"r1","content":"结论：Windows PowerShell 5.1 的 `Set-Content -Encoding utf8` 会写入 UTF-8 BOM。\n依据：装机后 5 个农场格冒烟集体 boot 失败，宿主 readProfileManifest 的 JSON.parse 报 `Unexpected token`（首字节 EF BB BF）。\n适用范围/失效条件：凡被 Node/JSON.parse 读取的 manifest/lock 文件都中招；改用 `[System.IO.File]::WriteAllText(path, text, UTF8Encoding($false))` 即无 BOM。","keywords":["Set-Content BOM","UTF8Encoding false","readProfileManifest","JSON.parse Unexpected token","EF BB BF"],"usage_scenario":["装机后多格冒烟集体启动失败排查","脚本改写 profile JSON 报解析错误"]}]
```

### Example 2（中文 · work_method · 平→分节，示范「保留具体标识」）
输入：
- id=r2
- 类型：work_method
- 标题：pnpm 单包换版重装流程
- 正文（平）：先改 package.json 的 file: 指针指向新 tgz，读 .modules.yaml 的 packageManager 选匹配版本，跑 pnpm install --offline。
输出：
```json
[{"id":"r2","content":"目标：给 pnpm 工作区里某个 file: 依赖单包换版。\n步骤：① 改 package.json 的 file: 指针指向新 tgz（先确认目标 tgz 真实存在）；② 读 node_modules/.modules.yaml 的 packageManager 字段，用完全相同大版本的 pnpm；③ 跑 `pnpm install --offline` 命中本地 store。\n前置/注意：用小一号 pnpm 会触发整树重装并联网卡死；改指针前不确认 tgz 存在会断链。","keywords":[".modules.yaml packageManager","pnpm install --offline","file: 指针","hoisted nodeLinker"],"usage_scenario":["手动改 file: 依赖后重装单包","多版本 pnpm 并存机器选版本"]}]
```

### Example 3（English · instruction · 已具骨架则原样返回）
输入：
- id=r3
- 类型：instruction
- 标题：publish 必须显式钉 npmjs registry
- 正文（平）：规则：publish 必须显式 --registry=https://registry.npmjs.org。触发：默认 registry 可能是 npmmirror 镜像时。反例：裸发会打到镜像失败或错投。
输出：
```json
[{"id":"r3","content":"规则：`npm publish` 必须显式带 `--registry=https://registry.npmjs.org`。\n触发时机：默认 registry 被配成 npmmirror 镜像、而 auth token 只钉 npmjs 时。\n反例/边界：裸发会打向镜像导致失败或错投；`npm view` 同样必须钉 npmjs（镜像有同步延迟）。","keywords":["npm publish --registry","npmmirror 镜像","registry.npmjs.org","auth token 钉 npmjs"],"usage_scenario":["发布前确认 registry 未被镜像劫持","publish 报 401/错投时排查"]}]
```

## dry-run 用法（task_1.3 脚本）
- `node tools/redistill-dryrun.mjs --mock` —— 本地 http 桩（返回固定整形结果），验证 渲染→调用→解析→**质量闸 scoreSkeleton 对比** 全链路，退出码 0=过。
- `--live --from l1 --n 15 --base <url> --model <name>` —— 真读活跃 L1（优先 ≤300 字「平」的那批）+ 调端点，产 `redistill-dryrun.sample.md`（每条并排整形前后正文 + 前后 scoreSkeleton 分 + 质量闸判定 + keywords/scenario）。
- `--dump --from l1 --n 15` —— 只读导出样本到 `.redistill-samples.json`。
- 反向对照：`--mock --bad` 注入一条「整形后骨架分不升反降」的样本 → 质量闸判不写、退出码非零。
