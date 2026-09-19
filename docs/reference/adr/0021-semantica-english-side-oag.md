# ADR-0021: Semantica 只承接英文侧 OAG（图查询 / 本体治理 / 确定性推理 / PROV-O 溯源）

- **Status**: accepted
- **Date**: 2026-09-19
- **Deciders**: LuoMuLoyal

## Context

英文侧 DrugBank 需要一个"能回答角色关系、且结论可复核"的知识层：`INHIBITS` 与
`SUBSTRATE_OF` 是临床上不同的断言，向量/散文检索把两者混成"相关"；而任何面向用药的
结论都必须能沿"结论 → 断言 → 来源表与来源行"走回去。自建这条链路意味着自己实现
Cypher 化的多跳图、OWL/SHACL 校验、Datalog 与 PROV-O —— 成本高于接手一个 MIT 项目。

候选里 Semantica 是唯一同时具备"确定性推理 + 本体治理 + W3C PROV-O"的开源实现，
但它是 context 层而非检索层/执行层，且成熟度有限（v0.x、单一主维护者、自陈推理引擎
"intentionally simple"、文档与代码系统性漂移）。它自带生成能力（4 处），其中
`GraphReasoner.reason` 是 prompt-stuffing（把整张图 dump 进上下文），在规模、类型化
检索、确定性与溯源四条上都与我们冲突。

与此同时，中文侧的关系藏在说明书散文里，必须先用 LLM 抽取才能召回，而 Semantica 的
中文能力经过源码级核实是不可用的（实体消解、分句、NER、嵌入默认全为英文，且失败
静默降级为哈希向量）。

## Decision

1. **采纳 Semantica，但边界划死在英文侧**：它只承接"英文 DrugBank 知识图谱 + 本体治理
   - 确定性推理 + PROV-O 溯源"。业务数据与用户数据不迁入，写操作不交给它。
     **中文侧不引入**：中文检索与结构化推理继续走 LightRAG + 边表 + SQL/CTE。
2. **fork 自持，跟随上游 `main`（不钉 SHA）**：升级到新 `main` 时按三步纪律重核源码级
   结论（fork 改动是否已被上游修掉、中文侧边界是否变化、AGE Cypher 子集是否变化），
   生产镜像 vendor 整棵 wheel 树作为上游删库/下架的安全网。
3. **入图是确定性 schema 映射，不是 LLM 抽取**：DrugBank 的靶点 / ATC / 相互作用已经是
   结构化字段，零抽取误差、零 token；LLM 只用于 NL→Cypher 的生成，且生成在 Lucent 侧
   （sidecar 因此不需要任何 LLM 凭据）。
4. **图后端是 Apache AGE 1.7.0**（自建 PG18 镜像、独立 database `lucent_graph`、
   不升 1.8.0），LightRAG 永远不用 AGE。
5. **sidecar 是我们自建的服务**（`semantica-service`，FastAPI + 同步 `def` + 连接池 +
   `statement_timeout`）：Semantica 自身没有可拉取的生产镜像，也没有我们的工具契约。
6. **溯源是一等能力**：图上每条边带 `prov` id 指向来源表与来源行，审计记录进 Postgres
   并串成哈希链（`semantica_provenance`，与 Lucent 同库不同表）。
7. **答案出口唯一**：用户可见的回答只在 Lucent 生成（要过信任分层、安全策略与 envelope
   的 `coverage`/`confidence`/`verifiability`）；不使用 sidecar 的生成端点。
   执行层留在 Lucent 的 proposal + confirm。
8. **本体以 Lucent 仓内的词表为源，SHACL 形状手写**：自动派生既误报又漏报，且会静默丢弃
   低频关系类型（转运体介导的 DDI 正是在其中）。
9. **中英映射不进运行时结论层**：作为离线数据资产；将来接图必须带 `confidence` /
   `review_status`，未复核的 `SAME_AS` 不得被结论级推理消费。

## Options Considered

| Option                                    | Pros                                                                                                           | Cons                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **采纳 Semantica（本 ADR）**              | 确定性推理 + OWL/SHACL + PROV-O 三件套开箱；MIT；核心依赖已瘦身（重包进 extras）；图数据与 Lucent 数据物化隔离 | v0.x 成熟度、文档漂移、需要 fork 自持与自建 HTTP 服务                           |
| 自建（Datalog / SPARQL / PROV-O / SHACL） | 完全可控、无外部漂移                                                                                           | 四套机器的实现与维护成本高于接手一个 MIT 项目；时间线不可接受                   |
| 中文侧也上 Semantica                      | 引擎统一                                                                                                       | 中文能力源码级不可用（消解/分句/NER/嵌入），且失败静默降级                      |
| 用它的 `GraphReasoner` 生成答案           | 少写一层                                                                                                       | prompt-stuffing：规模不可行、丢掉类型化检索、非确定性、无溯源；与"出口唯一"冲突 |
| 专用图数据库（Neo4j / FalkorDB / Kuzu）   | 图算法更全                                                                                                     | 新增运维品类；候选多为非 OSI 许可；三项核心能力根本不走图后端，换库买不到它们   |

## Consequences

- **变简单**：Lucent 不必自建 Datalog/SHACL/PROV-O；图与业务数据分库（`lucent_graph`
  vs `lucent`），互不污染；中文侧不受英文侧引擎选择影响。
- **变灵活**：fork 自持让上游缺陷可以自己修（已修 8 项）；sidecar 无 LLM 凭据，
  依赖集小、可离线构建。
- **风险**：上游按自己的节奏演进，fork 需要定期重核；sidecar 是无官方镜像的自建服务，
  容器化与三环境编排要自己维护（归 AGE 计划）；推理引擎的能力面比宣传窄，
  实际可用的目前只有 Datalog 与 SHACL 两条。
- **不可逆**：图数据形态（AGE + `prov` 属性 + 哈希链审计表）一旦被产品消费，换引擎意味着
  重建全部断言与审计。因此每次升级前先在 `semantica-service` 里跑 `add_edge_provenance.py --verify`
  确认链与 id 仍然一致。
