# ADR-0022: 记忆时效三档分级与四轴正交（门1/门2/门3 + 退场双平面传播）

- 状态: accepted（门2 灰度闸默认关，验后翻默认是独立发版决策，见 task_8.6）
- 日期: 2026-10-22
- 相关: 计划 `dsh-prime-memory-expiry-tiering`（本 ADR 是其母计划）、
  ADR-0021（写面=源导+重投，消费本 ADR 的判据单源）、ADR-0008（scope 与 family 正交先例）

## 背景

现状把**四件事塞进一根 `valid_to` 列**：退场（软删遮蔽）、过时（有效期失效）、
历史区间（persistence p/s）、记录时间（created_at）。后果是两个方向的事故：

- 合法带 `valid_to` 的记忆（"2020 年结束的旅行"）被检索面**静默遮蔽**——它没退场，
  只是成了历史；实测本机存量里这类误遮蔽占退场行相当比例；
- "纠正只能靠出 SQL"：改一条记忆没有一等动作，退场传播（图谱侧）半条腿缺失。

## 决策

1. **四轴正交铁律**：退场方式（`dsh_superseded.marker.reason`）/ 时间有效性定性
   （`dsh_validity.state`，查询期派生）/ 客观持续性（`persistence`）/ 现实有效期
   （`valid_to`）各司一职，不得互相冒充。`valid_to` 回归纯现实有效期；
   退场判据全仓单源 = **marker**（`isRetired` / `retiredL1Sql` / `isRetiredRecord` 同口径一对）。
2. **六态分级（spec §0）**：current / historical / expired / expired_suspect /
   superseded / retired。前三+两"疑"档留在检索索引，退场两档撤出。
   `expired` 判"过时"必须 valid_to 来源可信（`validToSource='evidence'`）；
   来源不可信（llm_inferred/fallback_now/unknown）一律 `expired_suspect`——**疑而不隐**。
3. **三扇门分置**：
   - 门1（索引层，bugfix 不受灰度门控）：升版一次性 FTS 全量回灌（stamp 幂等）收敛误遮蔽；
   - 门2（被动注入，灰度闸 `validity.tieringEnabled` 默认关）：注入候选剔除 `expired`，
     `expired_suspect` 保留并带"疑似失效"标注；
   - 门3（工具反查，参数级开关默认全关）：`memory_search` 出口剔除可信 expired
     （与门1 前行为逐字等价），`include_expired` / `as_of` / `follow_supersede` 显式放宽。
4. **`expired` 是查询期谓词，不是落库翻态**：判据单源 `classifyValidity`，所有消费面
   （注入/工具/图谱 sweep/面板）现算；`dsh_validity` metadata 标注只是"写入时怎么判的"
   快照（面板/审计用），永不作为判据回放。validToSource 由派生链现场打标
   （activity_*→evidence、工具直填→llm_inferred、anchor 兜底→fallback_now、缺→unknown）。
5. **退场双平面对偶刀**：软删/取代经 `retireL1Batch` 后调 `markSourcesRetired`
   重算清扫（来源全退场→archived 墓碑；全复活→回 active）；物理删保留
   `markSourcesDeleted`（row 存活判据）。强制重投 `forceReprojectRecord` 只删投影凭证、
   **保留在途 job 映射**（claim 现读 L1 ⇒ 在途 job 投的即改后内容；清映射反破坏 PK 去重）。
6. **反向取代链**（门3 follow_supersede）：`findSupersededTargets` 反查"被本条取代的
   **退场行**"（LIKE `"by":"<id>"` 含闭合引号防前缀误配；百~千全扫 + 超阈值 warn）。
7. **存量保鲜**：`validity-backfill`（零 LLM 本地派生）单飞/分页/逐行可中断，
   每攒 50 条被改记录调重投缝保鲜图谱；灰度闸关时不跑（零漂移）。

## 后果

- 正面："改完图谱不跟随""纠正靠人肉 SQL""历史记录被静默吞掉"三类债同时收口；
  默认行为逐字兼容（门1 是恢复误遮蔽的 bugfix；门2/门3 默认关 = 与改前一致）。
- 代价：三处判据（supersede.isRetired / sqlite.retiredL1Sql / memory-md.isRetiredRecord）
  必须同口径成对维护（已互相注释指认）；`complete()` 返回值形状扩为 touched 节点数组。
- 已知边界：门1 与门2 同批合入但灰度闸独立——闸关期间 expired 会进注入（计划明文接受，
  工具出口仍过滤；翻默认由 task_8.6 验证后决策）；bench 端到端对比（task_8.2）待真跑；
  旧版 retire 写进 `valid_to` 的退场时刻在 restore 后保留为历史值（会被 classify 判
  historical/expired_suspect，可检可注入带标注，由 backfill 逐步纠偏）。
- **md 投射层判据同批翻转**：`.disable` 后缀/归档 `retired: true` 全改按 marker——
  与库侧"列表说它退了、文件就有后缀"的不变式保持同构。
