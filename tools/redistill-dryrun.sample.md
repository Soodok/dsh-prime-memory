# redistill dry-run (live)

样本 15 条｜机械闸违规 0｜质量闸判可写 8 / 留原文 7

### id=mem_1791956349436_eb5d56  ✅可写
- 类型: work_fact | 标题: DSH榜单前15名分布与中段动态
- 【整形前】(骨架 1/3 缺:结论/事实,依据)
  截至 2026-10-14T05:32:16.955Z，在 DSH 榜单追踪范围内，drscrewdriver 位列 #12（103,667 下载），距 #11 仅 4,484；MeteorNOX 升至 #6，PerryLink 跌至 #8；T1 段（#5–#8）下载量密集，#6 与 #7 仅差 2,934。
- 【整形后】(骨架 2/3 缺:依据)
  结论：截至 2026-10-14T05:32:16.955Z，DSH 榜单前 15 名中 drscrewdriver 位列 #12（103,667 下载），距 #11 仅 4,484；MeteorNOX 升至 #6，PerryLink 跌至 #8；T1 段（#5–#8）下载量密集，#6 与 #7 仅差 2,934。
- keywords: ["DSH 榜单","drscrewdriver","MeteorNOX","PerryLink"]
- usage_scenario: ["查询 DSH 榜单特定插件排名","分析 T1 段下载量竞争态势"]

### id=mem_1791954653350_fe1283  ✅可写
- 类型: work_method | 标题: DSH榜单下载预测模型调优与回验SOP
- 【整形前】(骨架 0/3 缺:目标,步骤,前置/注意)
  DSH榜单下载预测模型调优与回验SOP：1. 参数更新：修正 `_window_pred.py` 的 DROP_DAY 与 INTAKE_DAYS 参数。2. 阶跃期处理：当 intake 出现阶跃（单日进量远超前 4 日均值）时，改用前 1-2 日值或中位数计算代理，偏差 >30% 时标注“阶跃期”，不可直接套用历史均值。3. 回验与归档：生成下期预测并回验上期，记录失效模式（如 §13），形成可追溯的追踪基线。4. 适用范围：DSH 榜单追踪任务；负责人：AI 助手。
- 【整形后】(骨架 3/3 齐备)
  目标：DSH 榜单下载预测模型调优与回验。步骤：1. 参数更新：修正 `_window_pred.py` 的 DROP_DAY 与 INTAKE_DAYS 参数。2. 阶跃期处理：当 intake 出现阶跃（单日进量远超前 4 日均值）时，改用前 1-2 日值或中位数计算代理，偏差 >30% 时标注“阶跃期”，不可直接套用历史均值。3. 回验与归档：生成下期预测并回验上期，记录失效模式（如 §13），形成可追溯的追踪基线。前置/注意：适用范围为 DSH 榜单追踪任务；负责人：AI 助手。
- keywords: ["_window_pred.py","DROP_DAY","INTAKE_DAYS","阶跃期处理"]
- usage_scenario: ["修正预测模型参数","处理 intake 阶跃异常","生成预测基线归档"]

### id=mem_1791917114720_d3838e  ⏸留原文
- 类型: work_method | 标题: 中文技术查询搜索引擎选型标准
- 【整形前】(骨架 2/3 缺:前置/注意)
  目标：为 Agent 搜索工具选型提供判断标准。依据：实测 Bing 引擎在中文技术查询时噪声大（易返回日历/天气等无关结果），Exa 引擎在中文技术查询时精准命中目标且信息密度高。结论：推荐在中文技术查询场景优先使用 Exa 引擎，Bing 引擎结果不稳定需配合精准查询或换引擎。
- 【整形后】(骨架 2/3 缺:前置/注意)
  目标：为 Agent 搜索工具选型提供判断标准。依据：实测 Bing 引擎在中文技术查询时噪声大（易返回日历/天气等无关结果），Exa 引擎在中文技术查询时精准命中目标且信息密度高。结论：推荐在中文技术查询场景优先使用 Exa 引擎，Bing 引擎结果不稳定需配合精准查询或换引擎。
- keywords: ["Exa 引擎","Bing 引擎","中文技术查询","Agent 搜索"]
- usage_scenario: ["选型中文技术查询引擎","解决 Bing 查询噪声问题"]

### id=mem_1791904176508_a03e4b  ⏸留原文
- 类型: work_fact | 标题: 近期核心推进项目与审查焦点
- 【整形前】(骨架 2/3 缺:依据)
  事实：近期团队核心推进项目为 `dsh-prime-memory` 插件的存储层加固（file-layer-hardening）计划。适用范围：当前开发周期；当前代码审查焦点已转移至 `dsh-perm-gate` 权限门禁插件。
- 【整形后】(骨架 2/3 缺:依据)
  结论/事实：近期团队核心推进项目为 `dsh-prime-memory` 插件的存储层加固（file-layer-hardening）计划。适用范围：当前开发周期；当前代码审查焦点已转移至 `dsh-perm-gate` 权限门禁插件。
- keywords: ["dsh-prime-memory","file-layer-hardening","dsh-perm-gate"]
- usage_scenario: ["确认近期核心开发项目","定位代码审查焦点"]

### id=mem_1791904176508_442b30  ⏸留原文
- 类型: work_fact | 标题: 工作区根目录
- 【整形前】(骨架 2/3 缺:适用范围/失效)
  工作区根目录 `E:\test\rewrite-agently` 为多项目工作区（workspace），非单一 Git 仓库。内部包含 `mine-dsh-plugins`（自身非 Git 仓，含约 37 个独立 Git 子仓及 570+ 分支）、`reffer-*` 等多个独立插件仓。此前在此目录推进 perm-gate 实测时曾因非 Git 仓导致 push 失败。
- 【整形后】(骨架 2/3 缺:适用范围/失效)
  结论/事实：工作区根目录 `E:\test\rewrite-agently` 为多项目工作区（workspace），非单一 Git 仓库。内部包含 `mine-dsh-plugins`（自身非 Git 仓，含约 37 个独立 Git 子仓及 570+ 分支）、`reffer-*` 等多个独立插件仓。此前在此目录推进 perm-gate 实测时曾因非 Git 仓导致 push 失败。
- keywords: ["E:\\test\\rewrite-agently","mine-dsh-plugins","reffer-*","多项目工作区"]
- usage_scenario: ["识别工作区 Git 结构","排查 push 失败原因"]

### id=mem_1791864486738_7fae4b  ✅可写
- 类型: work_method | 标题: API-批量采集限流防护规范
- 【整形前】(骨架 2/3 缺:目标)
  API 批量采集限流防护规范：1. 执行 npm 数据拉取或第三方包管理 API 批量采集时，必须采用顺序请求模式。2. 单请求间隔严格控制在 0.25 秒，以保障系统稳定性并防止触发限流或封禁。3. 遇 429/400 限流或特定批次错误后，必须严格执行该间隔并配合重试机制补齐漏包。4. 适用于所有涉及第三方包管理 API 的批量采集任务。
- 【整形后】(骨架 3/3 齐备)
  目标：API 批量采集限流防护。步骤：1. 执行 npm 数据拉取或第三方包管理 API 批量采集时，必须采用顺序请求模式。2. 单请求间隔严格控制在 0.25 秒，以保障系统稳定性并防止触发限流或封禁。3. 遇 429/400 限流或特定批次错误后，必须严格执行该间隔并配合重试机制补齐漏包。前置/注意：适用于所有涉及第三方包管理 API 的批量采集任务。
- keywords: ["API 批量采集","0.25 秒间隔","429/400 限流","顺序请求模式"]
- usage_scenario: ["配置 API 采集限流","处理 429/400 错误重试"]

### id=mem_1791781169148_c25ad2  ⏸留原文
- 类型: work_method | 标题: 团队决定保持每日自动抓取-registry-数据
- 【整形前】(骨架 1/3 缺:目标,前置/注意)
  团队决定保持每日自动抓取 registry 数据即可，无需人工干预操作。数据新鲜度判定与抓取流程按此自动化策略执行，取消此前关于是否修改 mtime 判定或人工干预的待办。
- 【整形后】(骨架 1/3 缺:目标,前置/注意)
  结论/事实：团队决定保持每日自动抓取 registry 数据即可，无需人工干预操作。数据新鲜度判定与抓取流程按此自动化策略执行，取消此前关于是否修改 mtime 判定或人工干预的待办。
- keywords: ["registry 数据抓取","每日自动抓取","mtime 判定"]
- usage_scenario: ["确认 registry 数据更新策略","取消人工干预待办"]

### id=mem_1791781169147_701754  ⏸留原文
- 类型: work_fact | 标题: 3080-直连-API-未监听属于桌面版使用模式
- 【整形前】(骨架 1/3 缺:依据,适用范围/失效)
  3080 直连 API 未监听属于桌面版使用模式的常态，无需重启。自 2026-10-01 11:39 左右起，127.0.0.1:3080 停止响应/拒绝连接，经排查并非服务故障，而是用户主要使用桌面版导致该端口无进程监听。排名数据经 Web GUI 代理 :19387/dsh-market/registry 回退供给，注册表后端数据正常刷新。
- 【整形后】(骨架 1/3 缺:依据,适用范围/失效)
  结论/事实：3080 直连 API 未监听属于桌面版使用模式的常态，无需重启。自 2026-10-01 11:39 左右起，127.0.0.1:3080 停止响应/拒绝连接，经排查并非服务故障，而是用户主要使用桌面版导致该端口无进程监听。排名数据经 Web GUI 代理 :19387/dsh-market/registry 回退供给，注册表后端数据正常刷新。
- keywords: ["127.0.0.1:3080","桌面版使用模式",":19387/dsh-market/registry"]
- usage_scenario: ["排查 3080 端口未监听","确认桌面版数据回退机制"]

### id=mem_1790712656689_961991  ✅可写
- 类型: work_method | 标题: DSH-记忆体系运行机制遵循捕获-蒸馏-反刍-检
- 【整形前】(骨架 1/3 缺:目标,前置/注意)
  DSH 记忆体系运行机制遵循捕获、蒸馏、反刍、检索、编辑与场景注入六环节；关键设计原则包括：L0 原始消息不可篡改且需严格保真；L1 记忆软删可恢复，采用坐标锚点存储规范；采用 Hall 八角分类体系（默认工作/人际/通用，上限8个）；标注持续性状态；矛盾记忆冻结待人工裁决（优先补全全库扫描逻辑）。
- 【整形后】(骨架 2/3 缺:前置/注意)
  目标：DSH 记忆体系运行机制遵循捕获、蒸馏、反刍、检索、编辑与场景注入六环节。关键设计原则：L0 原始消息不可篡改且需严格保真；L1 记忆软删可恢复，采用坐标锚点存储规范；采用 Hall 八角分类体系（默认工作/人际/通用，上限8个）；标注持续性状态；矛盾记忆冻结待人工裁决（优先补全全库扫描逻辑）。
- keywords: ["DSH 记忆体系","L0 原始消息","L1 记忆软删","Hall 八角分类"]
- usage_scenario: ["理解记忆体系六环节","处理矛盾记忆冻结"]

### id=mem_1790712656689_e4ced9  ✅可写
- 类型: work_fact | 标题: DSH-记忆体系采用双插件加四层蒸馏架构-核心成
- 【整形前】(骨架 0/3 缺:结论/事实,依据,适用范围/失效)
  DSH 记忆体系采用双插件加四层蒸馏架构，核心成员包括负责 L0-L3 蒸馏与知识图谱的 dsh-prime-memory、负责人类 Markdown 真源编辑的 dsh-memory-palace，以及负责 L0-L2 蒸馏与场景注入的 dsh-sgme。
- 【整形后】(骨架 1/3 缺:依据,适用范围/失效)
  结论/事实：DSH 记忆体系采用双插件加四层蒸馏架构，核心成员包括负责 L0-L3 蒸馏与知识图谱的 dsh-prime-memory、负责人类 Markdown 真源编辑的 dsh-memory-palace，以及负责 L0-L2 蒸馏与场景注入的 dsh-sgme。
- keywords: ["dsh-prime-memory","dsh-memory-palace","dsh-sgme","四层蒸馏架构"]
- usage_scenario: ["识别记忆体系核心插件","理解双插件加四层架构"]

### id=mem_1790282741846_fbc2f0  ⏸留原文
- 类型: work_fact | 标题: npm-新版发布流程采用暂存机制-staged
- 【整形前】(骨架 1/3 缺:依据,适用范围/失效)
  npm 新版发布流程采用暂存机制（staged publishing）：使用无 2FA 豁免的 token 发布时，registry 会暂存版本并等待处理/人工批准；若版本已被暂存或处理中，再次发布同版本号会报 409 冲突，导致该版本号被“烧掉”。针对 dsh-perm-gate 2.6.1 版本，实际发布成功落地（2026-09-24T20:05:26Z），代码与 2.6.2 一致，未发生版本号被烧的情况。
- 【整形后】(骨架 1/3 缺:依据,适用范围/失效)
  结论/事实：npm 新版发布流程采用暂存机制（staged publishing）：使用无 2FA 豁免的 token 发布时，registry 会暂存版本并等待处理/人工批准；若版本已被暂存或处理中，再次发布同版本号会报 409 冲突，导致该版本号被“烧掉”。针对 dsh-perm-gate 2.6.1 版本，实际发布成功落地（2026-09-24T20:05:26Z），代码与 2.6.2 一致，未发生版本号被烧的情况。
- keywords: ["staged publishing","409 冲突","dsh-perm-gate 2.6.1","版本号烧掉"]
- usage_scenario: ["排查 npm 发布 409 冲突","确认 dsh-perm-gate 发布状态"]

### id=mem_1790282048155_f993e8  ✅可写
- 类型: work_method | 标题: 复用共享-venv-的标准方案-采用-pip
- 【整形前】(骨架 1/3 缺:目标,步骤)
  复用共享 venv 的标准方案：采用 `pip install --target` 侧载缺失包至独立 overlay 目录，配合 `PYTHONPATH` 前置实现零改动复用，避免污染 venv 本体。该方案适用于 laya-api 及后续 microduck_rl 等依赖冲突场景。
- 【整形后】(骨架 3/3 齐备)
  目标：复用共享 venv 的标准方案。步骤：采用 `pip install --target` 侧载缺失包至独立 overlay 目录，配合 `PYTHONPATH` 前置实现零改动复用，避免污染 venv 本体。前置/注意：该方案适用于 laya-api 及后续 microduck_rl 等依赖冲突场景。
- keywords: ["pip install --target","PYTHONPATH","overlay 目录","laya-api"]
- usage_scenario: ["解决 venv 依赖冲突","复用共享 venv 环境"]

### id=mem_1790280971377_400192  ⏸留原文
- 类型: work_fact | 标题: DSH-v0.1.7-兼容性检测发现-dsh-s
- 【整形前】(骨架 2/3 缺:依据)
  DSH v0.1.7 兼容性检测发现：dsh-session-steward 插件直读 session.jsonl（14 处），在会话格式 V3→V4 升级后存在真实兼容风险。该插件此前已推进至 0.5.4 版本（0.1.5 线最高优先级），但存在版本标识冲突（package.json 0.4.0 vs 插件配置 3.x），且 npm 注册表版本滞后。其 discoverSessions() 仅匹配 v0 文件，受 DISCOVERY_LIMIT=200 截断。
- 【整形后】(骨架 2/3 缺:依据)
  结论/事实：DSH v0.1.7 兼容性检测发现：dsh-session-steward 插件直读 session.jsonl（14 处），在会话格式 V3→V4 升级后存在真实兼容风险。该插件此前已推进至 0.5.4 版本（0.1.5 线最高优先级），但存在版本标识冲突（package.json 0.4.0 vs 插件配置 3.x），且 npm 注册表版本滞后。其 discoverSessions() 仅匹配 v0 文件，受 DISCOVERY_LIMIT=200 截断。
- keywords: ["dsh-session-steward","session.jsonl","V3→V4 升级","DISCOVERY_LIMIT=200"]
- usage_scenario: ["排查 dsh-session-steward 兼容风险","分析会话格式升级影响"]

### id=mem_1790276104313_6cdb6d  ✅可写
- 类型: work_method | 标题: 项目已识别-readJsonIfExists-将
- 【整形前】(骨架 0/3 缺:目标,步骤,前置/注意)
  项目已识别 readJsonIfExists 将损坏压成 undefined 的隐患，state.json 实际包含 version: 2 及 v1 到 v2 迁移逻辑，未知版本被静默降级解释是比无版本更危险的数据丢失路径。为此确立版本失效处理契约：采用分层 fail-closed 策略，存在破坏性迁移路径的 store 未知版本时拒绝加载，无迁移路径的 store 未知版本时拒绝写入并降级为只读。
- 【整形后】(骨架 3/3 齐备)
  目标：解决 readJsonIfExists 将损坏压成 undefined 的隐患。步骤：确立版本失效处理契约：采用分层 fail-closed 策略，存在破坏性迁移路径的 store 未知版本时拒绝加载，无迁移路径的 store 未知版本时拒绝写入并降级为只读。前置/注意：state.json 实际包含 version: 2 及 v1 到 v2 迁移逻辑，未知版本被静默降级解释是比无版本更危险的数据丢失路径。
- keywords: ["readJsonIfExists","fail-closed 策略","state.json","version: 2"]
- usage_scenario: ["处理 store 未知版本加载","防止数据静默降级丢失"]

### id=mem_1790237776188_f815f4  ✅可写
- 类型: work_fact | 标题: dsh-session-guard-仓库实际分支
- 【整形前】(骨架 1/3 缺:结论/事实,依据)
  dsh-session-guard 仓库实际分支结构为 main、legacy/0.1.2 和 compat/0.1.5，不存在 master 分支。其中 legacy/0.1.2 分支源码与 main 分支完全一致，0.3.0/0.3.1 仅为打包重发（修改了 version、publishConfig.tag 和 engines.dsh），无功能代码变更。
- 【整形后】(骨架 2/3 缺:依据)
  结论/事实：dsh-session-guard 仓库实际分支结构为 main、legacy/0.1.2 和 compat/0.1.5，不存在 master 分支。其中 legacy/0.1.2 分支源码与 main 分支完全一致，0.3.0/0.3.1 仅为打包重发（修改了 version、publishConfig.tag 和 engines.dsh），无功能代码变更。
- keywords: ["dsh-session-guard","legacy/0.1.2","compat/0.1.5","0.3.0/0.3.1"]
- usage_scenario: ["确认 dsh-session-guard 分支结构","分析 0.3.0/0.3.1 发布内容"]
