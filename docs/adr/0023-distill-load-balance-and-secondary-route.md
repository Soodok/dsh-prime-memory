# ADR-0023: 蒸馏分块分载、二线大容量兜底与 fail-closed 路由

- **状态**：Accepted（0.26.7–0.26.8 落地）
- **日期**：2026-10-23
- **相关计划**：`.agents/plans/dsh-prime-memory-distill-load-balance/`

## 背景（真机取证）

面板"待重试 114"反复反刍不清零。读 `pending.json` 证实数据真在（处理问题，非刷新），根因链：

1. **抽取/去重"全有或全无"**：`runExtraction` 抽取块循环与去重批循环均**无块级/批级 try/catch**，任一块超时或 JSON 崩即整抛 → `pending=rest`（只在无抛错时执行）不触发 → 整批 114 全退回待重试，前若干块 LLM 成本全废。
2. **模型输入上限盲值**：`llm.maxInputChars=700k` 远超本地 Qwen 真实 ~200k；`model-catalog.ts` 只声明**嵌入**模型上限，蒸馏 LLM 无任何声明源 → 大调用撞模型硬限。
3. **供应商网关侧掐断**：`qoder-cn/DeepSeek-Flash` 对大输入固定 60s abort（插件 `llm.timeoutMs` 默认 120s，且 local-35 能跑 88s+ 不掐 → 60s 非插件窗）。**抬插件超时对它无效**。
4. **L2 无分块**：`runSceneConsolidation` 一次把整族 backlog 塞单调用，库越大越必超时。

## 决策

- **R1′ 抽取块级容错 + 部分消费**：块级 try/catch，失败块消息进 `failedMessages` 留桶、成功块照常进 dedup+write；`extractSessionSlice` 消费改 `pending = rest ∪ failedMessages`。**全块失败仍等价旧"整抛"**（不误当零产出成功、保留整片 + 退避）。
- **R1 L2 分块分载**：`runSceneConsolidation` 按 `MAX_SCENE_CHUNK_CHARS`(24k) 切块逐块整合，块级 try/catch；单块时与改前逐字一致（零漂移）。跨块合并判断为近似（诚实降级）。
- **R5 整轮墙钟预算 + 模型上限**：`llm.extractTimeBudgetMs`(默认 0=不限) 超预算把剩余块留 pending 下轮续，防慢模型独占串行泵；`llm.modelMaxInputChars` 声明真实上限，perChunk 取 `min(24k, 模型上限−42k, …)`。
- **R9 路由健康学习**：`RouteHealthStore`（`distill-route-health.json` sidecar，读 fail-open、只降不升、陈旧过期）记"退避后跑通的最小块长"，runExtraction 读它收紧 perChunk、成功后回记，跨进程免重付退避风暴。
- **R3 二线大容量兜底**：`llm.secondary{provider,model,reasoningEffort,triggerChars}`，**按输入体量触发**（单次调用 ≥ triggerChars 才前置二线）；未配 → 不启用、不改选任意模型。
- **R4 fail-closed 回退**：`llm.requireExplicitRoute`(默认 false 灰度) 开启后，显式一线+二线+链皆空 → 抛 `NoDistillRouteError`，**不蹭宿主 `agentDefaultModel`**；runner 侧据此 skip+顺延、**不记退避**（区分"没配"与"模型慢"）。
- **R10 面板可调超时**：`distillTimeoutMs` 走 live volatile + `effectiveCfg` 注入 `llm.timeoutMs`（镜像 `distillMaxInputChars`），设置页"蒸馏参数→蒸馏超时(ms)"即时生效。
- **R6 反刍豁免退避 / R7 队列去重**：反刍与 rebuild 同为用户显式动作 → `bypassBackoff` 越过 `inExtractBackoff`；`pushTask` 对同 `(session,mode)` 未消费的 force-flush 去重（治"一长阻塞→积压排空刷屏"）。

## 后果

- **默认零行为变更**：二线未配、`requireExplicitRoute=false`、`extractTimeBudgetMs=0`、`adaptiveChunk` 未声明上限时，perChunk/路由与改前逐字一致；唯一非默认关的是 R1′ 块级容错（严格更安全：以前任一块崩整批丢，现在只重投失败块）。
- **供应商侧掐断不可用超时解**：面板超时（R10）只救"慢但未被网关掐"的路由；qoder-cn 60s 固定掐断须**换路由/二线**，文档与输入框 title 均如实标注。
- **内存/文件分叉另案**：面板 `runner.pendingCount`(内存) 与 `loadPending`(文件) 曾观测不一致（反刍报"无缓冲"而盘上有 114），属独立 bug，未纳入本 ADR。
- **未纳入（后续谨慎评估）**：R1″ 去重批 checkpoint/续跑（现"去重崩→整片保留+重抽"已无数据丢失，仅浪费；resume 语义复杂）、R2 L3 分块（persona 单文档连贯性风险 > 收益）、R8 sinceL2 连续失败停攒（L2 分块后已缓解）。
