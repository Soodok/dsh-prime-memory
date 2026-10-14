# 关键词 / 情景蒸馏 · draft 提示词（例子阶段产物）

> 用途：prime-memory **回填批扫**（Phase 2 的 `src/keyword-backfill.ts`）会把它作为 `callLLM` 的 `system`。
> 本文件是「例子」阶段的可调草稿——先在此定稿 + dry-run 验质，过用户闸后才内嵌进代码。
> 配额口径对标 Qoder 记忆抽取契约（`.agents/corpus/qoder-memory-extract-prompt-reference.md`，2026-10-14 carve 自 `QoderCN.exe`）。

## 目标字段（写回 `metadata`）
- `dsh_keywords: string[]` —— 喂 `l1_fts` 的独立关键词检索轴（BM25 精确命中轴，不与正文词频混）。
- `usage_scenario: string[]` —— 可选同批产出；本批默认只产 keywords（情景留后续，规避 md 投射联动）。

## SYSTEM（内嵌进 keyword-backfill.ts 的草稿）

```text
你是记忆库的关键词与情景标注器。给定若干条记忆（每条含 id、标题、正文摘要），为每条提炼：
1) keywords：最能代表该记忆的检索词，用于精确命中；2) usage_scenario：未来「何时应当浮现这条记忆」的场景短语。

严格规则：
- keywords 的唯一判据：**用户未来会输入什么词把这条记忆捞出来**。优先具体名词性标识——项目/模块/文件/函数/配置项/命令/错误码/版本号/数字阈值/工具名/专有实体名。
- **禁止**把正文里的动宾短语压缩成抽象黑话当关键词（反例：把“判定批量流量”压成“批量流量判定”、把“做窗口滑动归因”压成“窗口滑动归因”、把“保持只读约束”压成“只读约束”）——这类词没人会拿去搜，一律换成它指向的具体实体/标识，或直接删掉。
- keywords：2–5 个（宁少勿滥，够区分即可）；每个 2–6 词或 1 个复合术语；不得与标题字面重复、不得互相近义堆叠、不收停用词/整句。
- usage_scenario：1–3 条；每条 5–10 词的短场景描述（不是完整命令句）；彼此必须可区分，相似的合并成更泛化的一条。
- 语言跟随该记忆正文：中文记忆产出中文（技术标识符、API 名、错误码原样保留），英文记忆产出英文。
- id 必须原样照抄，不得改写、截断或改用序号；一条记忆只产一组，不要拆分。

输出：只输出一个 JSON 数组，不要多余文字、不要解释。每项形如：
{"id":"<原id>","keywords":["…","…"],"usage_scenario":["…","…"]}
```

## 机械闸（dry-run 收尾自检，越界即非零退出，不靠肉眼）
- `1 ≤ len(keywords) ≤ 5`；每个 keyword：去空白非空、按词计 2–6（含连字符/驼峰复合按 1 计）、全表内该条无重复。
- `1 ≤ len(usage_scenario) ≤ 3`；每条 5–10 词（CJK 按字/词近似、Latin 按空格词）。
- keywords 与该条 title 分词后**交集为空**（去冗余硬约束）。
- 每条必须带 `id` 且能在输入集合里配对上；配不上的丢弃并计数。

## FEW-SHOT（真实样本，取自 Qoder 记忆库 agent_memory，input→output 配对）

### Example 1（中文 · 踩坑）
输入：
- id=m1
- 标题：Windows PowerShell中Node fallback下需用分号替代&&
- 正文：在Windows PowerShell环境下通过Node fallback执行Bash命令时，`&&`操作符不被识别，报错`InvalidEndOfLine`。应改用分号`;`连接多条命令…
输出：
```json
[{"id":"m1","keywords":["PowerShell","Node fallback","InvalidEndOfLine","分号分隔"],"usage_scenario":["PowerShell里用&&串联命令报解析错误","Node fallback执行Bash复合命令失败时"]}]
```

### Example 2（中文 · 项目技术栈）
输入：
- id=m2
- 标题：项目核心技术栈
- 正文：后端 Node.js 20+ 运行时，用 Docker Engine 做动态 Worker 容器编排；前端 Vue 3 + Vite；数据库 better-sqlite3（需 C++ 编译工具链）；AI 后端 Claude/Kimi/Codex Agent SDK。
输出：
```json
[{"id":"m2","keywords":["Node.js 20+","Docker Engine","Vue 3","better-sqlite3","Agent SDK"],"usage_scenario":["新成员了解项目技术选型","评估技术迁移或替换可行性","搭本地开发环境确认工具链"]}]
```

### Example 3（English · environment）
输入：
- id=m3
- title: pnpm install purges and hangs on version mismatch
- content: Running pnpm install with a pnpm whose major differs from `node_modules/.modules.yaml` `packageManager` triggers a full "reinstall from scratch" prompt and a network hang. Use the matching pnpm version and `--offline`.
输出：
```json
[{"id":"m3","keywords":["modules.yaml packageManager","pnpm version mismatch","hoisted nodeLinker","offline install"],"usage_scenario":["pnpm install hangs after full-reinstall prompt","relinking a file: dep in a hoisted workspace"]}]
```

### Example 4（中文 · 决策，示范「keywords 不重复标题」）
输入：
- id=m4
- 标题：镜像管理与Git仓库关联要求
- 正文：项目镜像管理需建立 Git 仓库与 Harbor 镜像仓库的关联映射，确保镜像预备、构建、推送、拉取与对应 Git 仓库版本一致。
输出：
```json
[{"id":"m4","keywords":["Harbor","镜像映射","版本一致","Git关联"],"usage_scenario":["设计镜像构建流水线的Git绑定","排查镜像拉取失败的映射配置"]}]
```

## dry-run 用法（task_1.3 脚本）
- `node tools/keyword-distill-dryrun.mjs --mock` —— 本地 node:http 假端点（返回固定 JSON），验证渲染/解析/机械闸管线，退出码 0。
- `node tools/keyword-distill-dryrun.mjs --live --n 20` —— 从真实库只读取样本 + 调配置端点，产出 `keyword-distill-dryrun.sample.md`。
- 反向对照：喂一条越界样本（keywords 6 个 / 与标题重复），`--mock` 应非零退出。
