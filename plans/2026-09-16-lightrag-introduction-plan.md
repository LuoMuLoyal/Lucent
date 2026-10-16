# LightRAG 中文散文检索层引入计划

Created: 2026-09-16
Revised: 2026-09-17（按库内实测修正前提 + 按数据本质收敛范围：LightRAG 只为**中文散文**提供语义检索；中文产品表走 SQL、英文 DrugBank 关系数据走 AGE + OAG，均不在本计划范围；V3 全量导入落地后更新实测数据）
Revised: 2026-09-18（P1 + **P3 已落地**：旧散文检索工具/服务/脚本阶段已删除，capabilities 已增 `retrieval_unavailable`，双仓契约已同步；P2 仅有一次 20 条小样本模式验证，全量评测与 P4/P5 仍未做）
Revised: 2026-10-16（**实施完毕，文件已删**。剩余事项全部登记在 `docs/TODO.md`「2026-09-18 LightRAG 中文散文检索」，本文件不再作为执行源）
状态：**实施完毕文件已删**（2026-10-16）。本目录中保留此文件名仅作为指向 `docs/TODO.md` 的指针；按 `plans/README.md` 生命周期第 4 条，计划执行完毕即删除，此处由维护者确认后移除。
定位（历史记录）：把**中文药品知识检索中的"散文部分"**（说明书字段级语义检索 + 医学问答）整体交给 LightRAG —— **导入与查询都归它**。**中文产品表检索不迁移**（保持 SQL 键查）；**英文侧不在本计划范围**（其关系数据走 OAG + Neo4j，见 ADR-0022）。

## 剩余事项的唯一台账

以下条目**只在 `docs/TODO.md` 维护**，本文件不再重复：

- **P2 全量评测（未做）**：当前只有一次 20 条小样本模式验证，需中大规模重跑 + 答案质量评分，才能判断图模式是否显著优于 `naive`。
- **建图成本决策（未决）**：实测约 10.5 s/chunk、约 $0.057/doc；chunk 级重复率 70.2% 可利用抽取缓存，但跳过写入会丢约 69,264 条跨药品断言。
- **`validity_period` 的「暂定」信号已在库内丢失**：需回 `DrugDataBase/derived/v3-dedup/leaflets_dedup.parquet` 取。
- **P4 灌 `qa` workspace（脚本就位，未实跑）**：`medical_qa_chunks` 当前 0 行。
- **P5 生产核对（未做）**：sidecar 可达、`/query` 鉴权生效、workspace 命中。
- **workspace 隔离（已知限制，不做）**：上游 #2527 确认单实例仅支持单 workspace。

## 落地后的代码事实（2026-10-16 核实）

| 项           | 现状                                                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 检索工具     | `search_cn_medicine_knowledge`（`src/modules/assistant/tools/retrieval/knowledge.service.ts`），`source` 缺失默认 `leaflet`（`LIGHTRAG_DEFAULT_SOURCE`），非法值 warn + 可读信封 |
| 图模式开关   | `LIGHTRAG_GRAPH_SOURCES`，默认 `leaflet` 放行 `local`/`global`/`hybrid`/`mix`；`qa` 只接受 `naive`                                                                               |
| 旧工具       | `search_medicine_leaflets` / `search_medical_qa_corpus` 及其服务与脚本阶段已删除                                                                                                 |
| capabilities | 已增 `retrieval_unavailable` disabledReason                                                                                                                                      |
| 英文侧       | `search_drugbank_passages` 保留（Lucent 自有 pgvector 表），与本计划无关                                                                                                         |

---

## 历史正文已删除

原「〇 前提修正」至「十 待确认」共 11 节执行细节（含决定与边界、目标形态、sidecar 配置、
工具契约、删除清单、灌数据、落地顺序与验收、风险表）随计划执行完毕一并删除——
其中的持久结论已分别沉淀到：

- `src/modules/assistant/README.md`（检索工具契约、`LIGHTRAG_*` 变量语义、图模式开关口径）
- `docs/reference/environment-variables.md`（sidecar 侧变量说明）
- `docs/TODO.md`（未完成项：P2 全量评测、建图成本决策、P4 灌 qa、P5 生产核对、workspace 隔离限制）
- `docs/logs/migration-log/2026-09-18.md`（P1/P3 落地记录）
