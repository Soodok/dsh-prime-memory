# ADR-0021: 图谱确定性写面 = 源导 + 重投（update/reproject/migrate 三语义）

- 状态: accepted
- 日期: 2026-10-22
- 相关: ADR-0007（图谱可重建性与阶梯）、ADR-0011（节点向量列与降级）、计划
  `dsh-prime-memory-graph-write-plane`（本决策的计划母体）与其上游
  `dsh-prime-memory-expiry-tiering`（R9/R10 对偶刀，以"先行刀"形式同批落地）

## 背景

图谱写面此前只有 add/delete/import 三动作，留下四个缺口：

- **G-update**：改一条记忆只能"add 新的 + 手工删旧的"，且改完图谱不跟随；
- **G-reproject**：已投影记录被 `projector_version` 永久跳过，无重投入口；
  非蒸馏写入（`memory_add`/`memory_import`）根本不入投影队（真根因：唯一入队点在
  distill 分支）——用户手加记录长期 projected=None；
- **G-writeplane**：图谱工具全只读，无"迁移关系"语义动作；
- **G-vec**：`graph_node_vec` 全库 0 行而节点 812 个。Phase 0 取证定性：嵌入开着
  （source=local，bge-m3，表已建）而 `upsertNodeVectors` **生产零调用点** → 漏调 = 缺陷。

结构性约束（ADR-0007 已定）：图谱三表是 L1 的**派生投影**，可整体重建；派生字段必须
由当前事实重算，增量事件一旦漏一次就永久跑偏。因此写面的正确形态不可能是"直接
UPDATE graph_edges"。

## 决策

1. **写面唯一真源是 L1，纠正 = 改源 + 重投**。不提供、不新增任何绕过投影直写
   `graph_*` 表的公共 API。所有写路径维持"零无源事实"不变量：`sourceRecordIds`
   非空且 ⊆ 现存 L1，由 `applyGraphProjection` 纯函数硬校验，**不因"是工具传入"豁免**。

2. **update = 新版本 + 旧版本 supersede 退场**。读旧 → 造新（`version+1`，新 id）→
   走既有退场汇流口 `retire([旧],{reason:'superseded',by:新id})` → 写新 →
   对 [旧,新] `forceReprojectRecord`。不新造退场通道；旧行保留可 restore。
   extKey **不**随血缘走（旧行退场后仍占部分唯一索引，新行同键必撞 UNIQUE 静默丢写；
   幂等预检命中退场旧行已挡住重复导入）。

3. **非蒸馏写入入投影队走单一钩子**。`MemoryRunner.enqueueGraphFor(recordIds)`
   为唯一入队实现：distill 分支与 `memory_add`/`memory_import`/`memory_update`
   三工具路径同源同优先级（`GRAPH_PRIORITY_NEW`），不存在第二套去重/优先级逻辑。

4. **重投幂等的定义是"在途不堆重"**。`forceReprojectRecord` 删
   `graph_projected_records` 凭证后入队，但**不动在途 `graph_job_records` 映射**
   （与上游 task_7.5 字面的一处刻意偏差）：claim 在认领时才现读 L1，在途 job
   天然投的是改后内容；删映射反而会让连调两次绕过 PK 去重、堆出内容重叠的双 job。

5. **迁移关系 = 引导式改源 + 确定性边提案兜底**。`memory_migrate_relation`：
   校验来源全部"现存未退场"（判据单源 `classifyValidity`）→ 显式边提案经
   `applyGraphProjection` 纯函数落库（同 (from,relation) 换目标闭旧边出新边，覆盖
   LLM 不吐边的不可复现情形）→ 新增承载新关系的 L1 载体记录留可回溯根据。
   兜底支路允许"非 LLM 产出"的边落库，但必须：过同一纯函数 + validSources 硬校验、
   metadata 打 `proposal_source='tool'`、落一条 `l1_receipts` 决策凭证——与手写 SQL
   严格可区分。**重投批只拉载体、不拉旧源**：旧源文本仍描述旧关系，拉进来会把刚迁移
   的边翻回去（"内容即真相"的必然推论；要连旧文本一起改配合 `memory_update`）。

6. **退场→图谱退役传播用重算 sweep，判据复用 classifyValidity**。
   `markSourcesRetired`（先行刀，上游 R9）：软删/取代后按当前 L1 全量判定，
   来源全部退场态（`classifyValidity ∈ {superseded, retired}`，row 消失同口径）的
   active/disputed 节点·边标 archived 墓碑；来源全部复活的 archived 项拉回 active
   （restore 回药）。物理删传播 `markSourcesDeleted`（row 存活判据）保持不动。
   合法历史 valid_to（无 marker）**不**触发退役——"过时"与"退场"正交。

7. **G-vec 定性为缺陷并按缺陷修**。投影 `complete()` 返回落库的 active/disputed
   touched 节点，`runGraphProjection` 在事务缝外经 `stores.l1.embedText` 同一嵌入源
   补写 `graph_node_vec`（`writeNodeVectorsAfterComplete`）；嵌入失败只 warn 不回滚
   投影。存量 812 节点不专门回填——由重投/重建通道逐步保鲜（写面本就有纠正入口）。

## 后果

- 正面：模型/用户可在工具面完成"改、重投、迁"全部纠正，不再依赖人肉 SQL；
  图谱与 L1 的一致性由"退场汇流口 + 重算 sweep + 投影校验"三处既有单源保证，
  写面没有新增第二套语义。
- 代价：频繁 update 累积版本行（交给 cleanup-retired 干跑+快照门禁控规模）；
  `complete()` 返回值形状变化（void → touched 数组，调用方仅 pipeline 一处，
  测试不受影响）；`memory_migrate_relation` 的确定性落边与 LLM 投影并存，靠
  `proposal_source` 审计标记区分而非物理隔离。
- 边界：本决策不改 `GRAPH_PROJECTOR_VERSION`（写面是新增能力不是投影语义断裂）；
  图谱未启用（`graph.enabled=false`）时所有写面钩子结构性 no-op，工具显式拒答，
  不开"入队了永不泵"的陈旧队列口子。
