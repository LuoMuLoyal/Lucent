# Semantica（英文侧 OAG）聚合落地文档

Created: 2026-09-17
状态：聚合定稿（本文是 Semantica 的唯一执行入口；上游决策不再分散在四份文档里）
基线：**fork 自持并跟随上游 `main` 最新，不钉 SHA**（2026-09-19 按 `main` 复核全文结论；此前基于 v0.6.8 的判断已逐条重核，差异见 §0 末）
定位：把工作区内关于 **Semantica** 的全部结论聚合成一份可执行文档 —— 它是什么、为什么只在英文侧用、怎么落地、要改它哪些代码、有什么坑。**AGE 的具体引入步骤不在本文**（见 §9 指针）。

---

## 〇、本文与前序文档的关系

Semantica 的判断此前散落在四份文档里，互相有引用的"跳来跳去"成本。本文把它们收敛为一份，并标注每条的来源：

| 来源                                                        | 内容                                                                                            | 本文归属                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `Lumos-docs/2026-09-15-lightrag-vs-oag-selection-review.md` | 决策主体：按语言分工、Semantica 采纳但限定英文侧、源码级核实、fork 清单、存储矩阵、风险         | §1–§8 全部                                               |
| `plans/2026-08-28-medicine-risk-graph-plan.md` §6.9         | 最早的 Semantica 替代路线（六步链路逐条对照、与 LightRAG 的关系）                               | §1.3、§3.2、§6                                           |
| `plans/2026-09-27-apache-age-introduction-plan.md`          | AGE 作为 Semantica 图后端的引入步骤                                                             | §9（指针，不复述）                                       |
| `plans/2026-09-16-lightrag-introduction-plan.md`            | 中文侧边界（"中文侧不引入 Semantica"）                                                          | §2、§8                                                   |
| **试点仓 `semantica-oag-pilot/`（2026-09-17）**             | 一手实测：AGE Cypher 子集、三项能力（本体治理 / 推理 / 溯源）、并发与写入基准、四类生成源码核实 | §3.5、§6.3、§6.4、§6.5、§7 第 9–12 项、§8.1 试点验证结果 |

**口径变化提示**：`plans/2026-08-28-medicine-risk-graph-plan.md` 写于 2026-09-06，其 §6.9 的判断（Semantica **替代**自建 OAG、且与 LightRAG 二选一）已被 2026-09-16 复核**取代** —— 现行口径是**按语言分工、两线并行**（§2）。引用时以本文为准。

**基线变更（2026-09-19）**：上游基线由 **v0.6.8 tag** 改为 **`main` 最新**。本文所有源码级结论已在 `main` 上逐条重验，差异仅有三处：

| 变化                         | 原（v0.6.8）                                         | 现（`main`）                                                                           | 影响                                         |
| ---------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------- |
| **核心依赖瘦身**             | 52 个强制依赖，含 torch / opencv / librosa，不可裁剪 | 22 个重包移入 extras，核心只剩 numpy / pandas / scipy / sklearn / rdflib / networkx 等 | **§6.1、§8.3 的体积论据作废**（§6.1 已重写） |
| **`embeddings-local` extra** | 原判"在 PyPI 不存在"                                 | 确实存在                                                                               | 该条文档漂移实例删除                         |
| **版本与分支**               | 最新 release v0.6.8；`main` 已进 0.7.0               | 同上，且确认 **`main` 是唯一干线**（无 dev/release 分支）                              | §1.1 增补分支模型；pin 策略改为跟随 main     |

**其余全部结论不变**：§5 的七项中文侧缺陷、§7 的 12 项 fork 改动、§6.3 的 AGE Cypher 子集、§6.4 的三个坑（`xsd:xsd:` 前缀重复、Datalog 不等式静默忽略、`load_from_graph` 静默返回 0）在 `main` 上**均仍成立**。

来源标注沿用原文档约定：`[核实]` = 源码 / 官方仓库 / 官方文档 / API 实测；`[二手]` = 第三方分析；`[研判]` = 本文判断。

---

## 一、Semantica 是什么

### 1.1 仓库事实

`[核实]` GitHub API + PyPI（2026-09-17 复测）

| 项                    | 值                                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仓库                  | `semantica-agi/semantica`（canonical；`pellera9/semantica` 是 fork，1★ 无 release）                                                                                   |
| 描述                  | Graph-Native Infrastructure for Context and Accountable AI Systems                                                                                                    |
| 许可                  | **MIT**                                                                                                                                                               |
| 语言 / 体积           | Python（13.1 MB）+ TypeScript（1.2 MB，explorer UI）                                                                                                                  |
| Star / fork / watcher | **13,214 / 1,483 / 68**（2026-09-19 实测；2026-09-17 为 13,083 / 1,463 / 68）                                                                                         |
| 创建 / 最后 push      | 2025-06-25 / 2026-09-18                                                                                                                                               |
| 最新 release          | **v0.6.8（2026-09-05）**，24 个 release，全部 v0.x；**`main` 已是 0.7.0，领先 v0.6.8 共 127 个提交，且尚未发布到 PyPI**                                               |
| 版本节奏              | 10 个月从 0.0.1 → 0.6.8；2026-06 起放缓                                                                                                                               |
| open issues           | 106                                                                                                                                                                   |
| **分支模型**          | **只有 `main` 一条干线**：76 个分支里没有 `dev` / `develop` / `release` / `next`，46 个 open PR 全部直打 `main`；其余分支是 dependabot 与短命 feature/fix，不能当基线 |
| 贡献者分布            | 主维护者 1 人（2,031 commits）/ 核心 2 人（276、142）/ bot 1 个（104）/ 活跃外围约 22 人（4–26）/ **一次性贡献者约百人（各 1 commit）**                               |

**贡献者口径要写准**：仓库确有约 107 位贡献者，但分布极度倾斜 —— 一个账号占前 30 名提交量的约 72%，尾部上百个账号各只有 1 次提交。准确表述是**"单一主维护者 + 长尾一次性贡献者"**：不是业余单人项目，但一次性贡献者也接不了手。这正是选择 **fork 自持**而非跟随上游的直接理由（§7）。

**canonical README 中 "Palantir" 一词不出现**（字符串检索为空）；当前自我定位为 _"alternative to expensive enterprise platforms"_。`[核实]`

### 1.2 功能面：最接近 Palantir Ontology 的开源实现

`[核实]` PyPI README（78,900 字符）+ 文档站

| 能力                      | 内容                                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ontology Management**   | OWL 生成、**SHACL 校验**、SKOS 受控词表 + 可视化编辑器                                                                                                                                                                                            |
| **Decision Intelligence** | `record_decision()` / `add_causal_relationship()`（关系类型限 `CAUSED` / `INFLUENCED` / `PRECEDENT_FOR`）/ `trace_decision_chain()` / `find_similar_decisions()` / `analyze_decision_impact()` / `check_decision_rules()` —— **决策为一等图节点** |
| **确定性推理**            | 前向链、Rete 网络、Datalog、SPARQL，可解释路径；README 明确**图构建 / 推理 / 溯源不需要 LLM**                                                                                                                                                     |
| **Provenance**            | W3C PROV-O，导出 JSON / CSV / RDF（`RDFExporter().export(kg, "audit_trail.ttl", format="turtle")`）                                                                                                                                               |
| **Conflict Detection**    | 冲突事实被标记并解决，而非静默覆盖                                                                                                                                                                                                                |
| **Temporal**              | Bi-temporal 事实、Allen 区间代数、`state_at()` 时间点快照                                                                                                                                                                                         |
| **存储**                  | RDF（Oxigraph / Blazegraph / Jena / RDF4J）+ LPG（Neo4j / FalkorDB / **AGE** / Neptune）+ **pgvector**                                                                                                                                            |
| **集成**                  | REST API、**MCP server**（`semantica-mcp`）、CLI、可视化工作台                                                                                                                                                                                    |

官方 README 的首个正式 recipe 就是医疗场景：

```python
d1 = graph.record_decision(
    category="drug_interaction_check",
    scenario="Patient P-4821: warfarin + amiodarone co-prescribed",
    reasoning="Amiodarone potentiates warfarin's anticoagulant effect",
    outcome="flag_for_review", confidence=0.91,
)
```

**相对 LightRAG 的独有属性**：图构建全程**确定性、不依赖 LLM**。对医疗场景，"结论如何得出"可复现、可审计。`[研判]`

### 1.3 它在 OAG 六步链路里能覆盖哪几步

`[核实]` + `[研判]`，源自 `plans/2026-08-28-medicine-risk-graph-plan.md` §6.9

| OAG 步骤   | 自建方案                                 | Semantica 能否替代                                                                  |
| ---------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| ① 本体建模 | LLM 辅助 + 人工审核、`ontology_types` 表 | **可省**：`LLMOntologyGenerator` + SHACL + 质量门禁                                 |
| ② 数据集成 | ETL 映射本体实例、复用 Phase 1 边表      | **半省**：`DBIngestor` 能拉数据，但"映射到现成 PG 边表"这层粘合仍需少量自写         |
| ③ 知识存储 | 关系表 + JSONB + pgvector                | **可省**：RDF 三元组 / AGE / 向量全有，PG18 兼容                                    |
| ④ 推理引擎 | 递归 CTE（可选 AGE）                     | **可省**：Rete / Datalog / SPARQL 直接用                                            |
| ⑤ LLM 集成 | Skill 声明式定义 + 意图转查询            | **需保留**：Agent 是自建 LangGraph runtime，Semantica 的 LangChain/MCP 只作工具出口 |
| ⑥ 行动执行 | Action 校验 + 高危审批 + 审计            | **必须保留**：Decision Intelligence 只记录决策/审计，不执行动作                     |

### 1.4 自陈局限

README 内明文：`[核实]`

> _"`ReteEngine`'s alpha-node condition matcher is intentionally simple in this release — validate `match_patterns()` output against your actual rule set before wiring it into a production compliance gate."_

---

## 二、决策：采纳，但限定英文侧

**结论（2026-09-16 定稿）：Semantica 是唯一执行层之外的"英文知识图谱 + 本体治理 + 推理 + 溯源"承接者；中文侧不引入。**

| 侧       | 语料                  | 检索                                                             | 结构化推理 / 本体                                               | 动作                         |
| -------- | --------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------- |
| **中文** | 中文说明书 + 医学问答 | **LightRAG**（一 workspace 一信任层）                            | 边表 + SQL / 递归 CTE，**不上 OAG**                             | proposal + confirm（Lucent） |
| **英文** | DrugBank 全库         | pgvector passage 检索（`mode=naive` 语义），**不建 LightRAG 图** | **Semantica（OAG）**：OWL/SHACL 本体 + 确定性推理 + PROV-O 溯源 | 同上                         |

职责区分（两条线在语言上分开，**不构成二选一**）：

```
中文  LightRAG（说明书 + 问答，分 workspace）  +  边表 + SQL/CTE        ← 检索层 + 中文本体
英文  Semantica（DrugBank 本体 + 推理 + 溯源）  +  现有 pgvector passage  ← OAG 层 + 英文检索
两者   proposal + confirm（Lucent）                                     ← 唯一的执行层
```

### 2.1 用法建议（决定后口径）

| 用法                                                                | 决定                                                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 英文侧（DrugBank）本体治理 + 确定性推理 + PROV-O 溯源               | **采纳** —— 这是它在开源里不可替代的部分                                                                      |
| 中文侧检索 / 中文侧结构化推理                                       | **不采纳** —— 中文侧走 LightRAG + 边表 + SQL/CTE（§5 给出硬理由）                                             |
| 作为执行层（写库 / 审批动作）                                       | **不采纳** —— 文档明文 _"PolicyEngine … does NOT automatically prevent actions"_；执行留在 proposal + confirm |
| 用它的内置嵌入器 / 中文嵌入                                         | **不用** —— 英文侧用现有 pgvector 检索栈；本体入图是确定性灌入，不需要它的嵌入                                |
| 上游依赖（跟版本升级）                                              | **跟 `main` 最新** —— fork 自持，基线始终是 main HEAD（不钉 SHA）；每次升级重读 §5 / §7 的源码级结论          |
| 仅借 **SHACL 校验**（`pip install pyshacl`，纯 Python、Apache-2.0） | **可选，低风险** —— CI / 导入阶段即可用，不需要整包                                                           |

### 2.2 为什么是"采纳"而不是"自建"

`[研判]` 三条约束：

1. **形态错配 —— 它是 context 层，不是检索层，也不是执行层。** Lucent 已用 Prisma/Postgres 持有业务数据、LangGraph 做编排、proposal/confirm 做 action。因此边界必须划死：**它只承接"英文知识图谱 + 本体治理 + 推理 + 溯源"**，业务数据与用户数据不迁入，写操作不交给它。
2. **难的是内容而非机器。** OAG 真正的难点是领域语义决策：`Ingredient → ATC class` 如何映射？相互作用严重度谁定？**没有任何框架能替使用者回答这些** —— Semantica 提供 OWL/SHACL 的机器，不提供药品本体的内容。英文侧之所以相对可控，是因为 **DrugBank 已经是结构化的**（靶点表、ATC 编码、相互作用 JSONB），入图主要是 schema 映射而非抽取。
3. **成熟度决定"必须 fork 自持"，而不是"不能用"。** v0.x、单一主维护者 + 长尾一次性贡献者、自陈推理引擎 _"intentionally simple"_、无具名生产用户、**文档与代码系统性漂移**（§5）。这些都是真的，但结论不是放弃 —— MIT + 体积可控意味着**接手成本可估**。

**替代品核查结论**：问题不是"它够不够好"，而是"有没有替代品" —— 替代品只有"自己实现 Datalog / SPARQL / PROV-O / SHACL"，成本高于接手一个 MIT 项目。`[核实]`

---

## 三、英文侧落地：确定性灌入，不是 LLM 抽取

### 3.1 关键点

**英文侧入图是"schema 映射"，不是"LLM 抽取"。** DrugBank 的靶点、ATC、相互作用已经是结构化的 —— 确定性灌入，**零抽取误差、零 token**。LLM 只用于英文叙述字段（`indication` / `mechanism_of_action`）里可选的关系补充，且受本体类型约束。

### 3.2 能力映射

`[核实]` Semantica `main` 能力面

- **本体生成与治理**：`OntologyEngine` / `OntologyGenerator` + SHACL 校验 + OWL/RDF 导出；
- **知识存储**：LPG 图后端（**AGE**，见 §6.2）；
- **确定性推理**：前向链 / Rete / Datalog / SPARQL，可解释路径，不依赖 LLM；
- **溯源**：W3C PROV-O 导出（`RDFExporter().export(kg, "audit_trail.ttl", format="turtle")`）；
- **数据集成**：`DBIngestor` 从 PG 直连拉取。

### 3.3 目标架构

```
┌──────────────────────────────────────────────────────────────────────┐
│ Lucent (NestJS, PM2/Traefik, 原生 Node)                               │
│                                                                      │
│  agent/runtime/subgraphs/knowledge.ts                                │
│    ├─ search_medicine_leaflets ──┐  中文 → 新增 search_knowledge_graph │
│    ├─ search_medical_qa_corpus ──┼─→      (HTTP → lightrag)           │
│    ├─ search_drugbank_passages ──┼─→ 英文 → 沿用现有 pgvector 检索      │
│    └─ ...                        │                                    │
│                                  │  英文 → 新增 reason_over_ontology    │
│                                  │        (HTTP → semantica)           │
│  VectorStoreFactory (PGVectorStore)                                   │
│    ├─ medical_qa_embeddings ←────┘                                    │
│    ├─ leaflet_embeddings                                              │
│    └─ drugbank_passage_embeddings                                     │
│                                                                      │
│  唯一执行层：proposal + confirm（写库 / 审批 / 审计）                   │
└──────────┬────────────────────────────────────┬──────────────────────┘
           │ HTTP :9621（内网）                  │ HTTP（内网）
┌──────────▼────────────────────────┐  ┌────────▼─────────────────────┐
│ lightrag-server（中文侧）          │  │ semantica sidecar（英文侧）   │
│  PG 四件套 → 复用现有 PostgreSQL   │  │  AGE 1.7（现有 PG18 内，      │
│  workspace=lumos_leaflet (mix)    │  │      独立 database）          │
│  workspace=lumos_qa     (naive)   │  │  本体 = 词表 → OWL/SHACL      │
│  RERANK_BINDING=aliyun            │  │  DrugBank 确定性灌入           │
│  （不建英文图）                    │  │  推理 = Rete / Datalog / SPARQL│
└───────────────────────────────────┘  │  溯源 = PROV-O → 自接 PG 存储  │
                                       └───────────────────────────────┘
      （离线，不进结论层）中英映射 = 数据资产（§4.4）
```

### 3.4 五条设计约束

1. **用户可见的答案必须在 Lucent 生成。** 两个理由，缺一不可：
   - **出口唯一**：答案必须经过 `system.prompt.ts` 的信任分层、`policy.service.ts` 的安全策略、
     以及工具 envelope（`coverage` / `confidence` / `ambiguities`）与 `verifiability` 标注。
   - **多来源合成**：答案是本体断言 + pgvector 段落 + 结构化工具共同产出的，
     只有 Lucent 同时看得见全部来源。
     **不使用 `/query/stream` 或 Ollama 兼容 `/api/chat` 做用户可见回答** —— 会产生双重生成、
     双倍成本、绕开安全层。
     > **措辞更正（2026-09-17）**：旧表述"LightRAG 与 Semantica 都只做 index / reason / retrieve，
     > **不做 generate**"不准确 —— Semantica **确实有生成能力**（4 处，见 §3.5）。
     > 正确的表述是"**不生成用户可见的回答**"，不是"没有生成能力"。
2. **一个 workspace = 一个 trust tier**，切分轴是**信任层级**，不是语言。
3. **中文侧建图，但只用于召回。** 中文的关系藏在散文里，需要抽取才能召回；但**它的图不用于结论** —— 无类型契约、无约束、无溯源，结论由边表 + SQL 承担。
4. **英文侧不建 LightRAG 图。** DrugBank 的靶点 / ATC / 相互作用**已经是结构化的边**，用 LLM 重抽等于用猜测覆盖权威事实，还会与 OAG 图形成"两个图、两套语义"（同一问题两个互相矛盾的答案）。
5. **AGE 只服务英文侧，LightRAG 保持 `PGTableGraphStorage`。** LightRAG 的存储实现**加文档后不可更换**，绑上 AGE 等于把 AGE 的版本生命周期绑进检索层数据。

### 3.5 四类"生成"的归属

Semantica **有生成能力**，共四处（`[核实]` 读源码）。这四类的归属理由各不相同，
不能合并成一句话：

| #   | 生成能力               | 实现                                                                                | 用户可见      | 归属                                 | 理由                                                             |
| --- | ---------------------- | ----------------------------------------------------------------------------------- | ------------- | ------------------------------------ | ---------------------------------------------------------------- |
| ①   | **答案生成**           | `GraphReasoner.reason(graph, query)` → `provider.generate(prompt)`                  | ✅            | **Lucent**                           | 见下                                                             |
| ②   | **查询生成** NL→Cypher | 试点自建（非 Semantica 内置）                                                       | ❌ 中间产物   | **Lucent 生成，sidecar 校验 + 执行** | 见下                                                             |
| ③   | **本体候选生成**       | `LLMOntologyGenerator.generate_ontology_from_text()` / `OntologyEngine.from_text()` | ❌ 供人工复核 | **不用**                             | 英文侧走 §4.1 的 YAML 词表；且实测自动生成会丢低频边类型（§6.4） |
| ④   | **实体关系抽取**       | `semantica.semantic_extract`（LLM / HuggingFace / spaCy 三路）                      | ❌ 建图用     | **不用**                             | 英文侧是结构化数据的确定性映射，零抽取（§3.1）                   |

另有 9 个 LLM provider wrapper（OpenAI / Anthropic / Gemini / DeepSeek / Ollama / Groq / LiteLLM / Novita / HuggingFace）。

#### ① 答案生成为什么不用 —— 是技术路线不合适，不只是策略原因

`[核实]` `GraphReasoner.reason` 的实现是 **prompt-stuffing**：

```python
# _prepare_graph_context：把**全部** entities / relationships 线性 dump 成文本
context_lines.append(f"- {name} [{etype}]{props_str}")
context_lines.append(f"- {src} --[{rtype}]--> {tgt}{props_str}")

# _build_reasoning_prompt：整坨塞进 prompt
f"...{context}\nQuestion: {query}\nAnswer strictly based on the provided graph context."
```

四点不可行：

1. **规模上不可能** —— 试点图 396 节点 / 6,784 边勉强能塞；全量 DrugBank（19,842 药 +
   247 万交互边）远超任何上下文窗口，且**无子图选择、无检索**。
2. **丢掉类型化检索能力** —— 已验证的核心价值是 `INHIBITS` vs `SUBSTRATE_OF` 的**角色区分**
   （帕罗西汀抑制 CYP2D6 × 曲马多是 CYP2D6 底物）；塞成文本后退化为"让 LLM 自己读"。
3. **非确定性** —— 而选 Semantica 的首要理由正是确定性（结论可复现、可审计）。
4. **无溯源** —— 答案没有可追溯的推导路径。

**即使把它的生成器改好，答案出口仍然必须唯一**（约束 1）：答案要多来源合成、
要带 Lucent 的 `verifiability` 与 envelope、要过 `policy.service.ts`。
这是**结构约束，不是实现质量问题**。

#### ② 查询生成的归属 —— 这是真正开放的一项

| 放 Lucent                                                   | 放 sidecar                                     |
| ----------------------------------------------------------- | ---------------------------------------------- |
| 复用 `LlmRuntimeService` 角色化配置，一套凭据 / 成本 / 限流 | 紧挨本体 schema 与 AGE 限制，**prompt 不漂移** |
| 重试与可观测性已有                                          | 只读守卫与执行同进程                           |

**选定切分：Lucent 生成，sidecar 校验 + 执行。**

- sidecar 暴露 `GET /schema`：本体词汇 + AGE 不支持项（§6.3）+ few-shot。
  schema 变了 prompt 自动跟着变，**解决漂移**；
- sidecar 暴露 `POST /validate`：dry-run / EXPLAIN，把 AGE 报错结构化返回，
  **重试回路跨两侧**；
- 生成留在 Lucent，**sidecar 因此不需要 LLM 凭据** —— 这是 §6.5 依赖集精简的依据。

### 3.6 工具接入点

新增 `reason_over_ontology`（英文），需同步注册于：

- `tools/shared/tool-types.ts`：`ASSISTANT_TOOL_NAMES`、`ASSISTANT_READ_TOOL_NAMES`、`ASSISTANT_TOOL_SOURCE_MAP`
- `tools/shared/tool-definitions.ts`：`TOOL_DESCRIPTIONS`
- `agent/runtime/subgraphs/knowledge.ts`：`KNOWLEDGE_TOOL_ORDER`
- `tools/tool.service.ts`：dispatch

返回包成现有 envelope 形状（`query` / `coverage` / `confidence` / `ambiguities`），且**必须带上来源等级**（DrugBank / 本体断言 + PROV-O 引用）。

---

## 四、本体层设计

**形态：一份共享词汇表 + 两侧各自落地。** 词汇表是两侧唯一的对齐契约；英文侧由 Semantica 做机器治理，中文侧只做命名对齐 + 边表 + SQL。

### 4.1 本体骨架（两侧共享的词汇表）

在 Lucent 仓库落一个 YAML，纳入代码评审与迁移管理 —— 这样"本体漂移"退化为普通数据迁移，而非永久策展负担。

- **实体类型**：`Drug` / `Product` / `Ingredient` / `Target` / `Enzyme` / `Indication` / `AdverseReaction` / `Manufacturer` / `DrugClass`
- **关系类型**：`has_ingredient` / `targets` / `treats` / `interacts_with` / `contraindicated_in` / `manufactured_by` / `in_class`
- **每条断言带 provenance 字段**：来源表 / 来源版本 / 置信度（可复用 `match_quality_*`）

**这份 YAML 有两个消费者，这是它存在的理由**：`[研判]`

- 英文侧 → 作为 Semantica 本体定义与 SHACL 形状的**输入源**（随 OWL 导出）；
- 中文侧 → 作为 `arch:check` 的**校验清单**：代码与 SQL 里出现的每个关系类型都必须在词表里（规则进 lint，而不是文字约定）。

### 4.2 英文侧

见 §3。要点复述：**确定性灌入**（`DBIngestor` 直连 PG 拉 DrugBank 结构化表），本体来自 §4.1 词表 → OWL/SHACL，推理走 Rete / Datalog / SPARQL，溯源走 PROV-O。

### 4.3 中文侧：只做命名对齐

中文侧**不引入本体引擎**。它只承担两件事：

1. **命名对齐**：边表与 SQL 中出现的实体/关系类型，与 §4.1 词表**同名**。将来若要合流，不需要再做一次词汇映射；不提前定，以后就是两套词汇表互相翻译。
2. **CI 强制**：`arch:check` 增加一条检查 —— 关系类型必须在词表内；provenance 列（来源表 / 版本 / 置信度）走 NOT NULL 或投影视图。

**这就是"中文侧不需要本体引擎，但需要有人守语义"的落点**：守语义的机制从引擎换成 CI 与代码评审，成本几乎为零。

### 4.4 中英映射（桥）的定位

桥**不进运行时结论层**，作为离线数据资产与演示能力存在。

- **英文 OAG 不依赖它**：英文用户查英文药（如 `Ibuprofen`），DrugBank 自身足够；桥只在"英文侧遇到中文药名"时才用得上。**因此两件事解耦**：英文 OAG 可以现在开工，桥按自己的节奏推进。
- **若将来要接进图，产物形态必须是本体里的一等 Link**：每条边带 `method`（LLM 翻译 / 盐容忍 / 拼写变体）、`confidence`、`review_status`、来源版本，并随本体版本化。`[研判]`
- **精度优先于覆盖**：错误的 `SAME_AS` 边是**被断言为真的事实**，会被确定性推理放大成"看起来可审计的错结论" —— 比检索漏掉更危险。因此未复核的桥边**不得被结论级推理消费**（用 SHACL 形状表达，或由推理层过滤）。`[研判]`
- **两条已知事实**（供接图时使用）：盐剥离必须走白名单（`硝酸甘油 → Glycerin` 这类错误会销毁药效基团），且 ATC 类别校验只能算**补充**防线 —— 对已发现的典型错误对，多数情况下错误一侧**根本没有 ATC 码可比**。

> 一条已作废的中间判断：曾用"中英映射覆盖率仅 9.7%"支撑"跨语言多跳断链"。该 9.7% 是"映射条数 / 原始产品行（204,844）"，与按药名重建的映射不是同一口径 —— **此论据作废**。

---

## 五、中文侧为什么不上 OAG：`main` 源码级核实

以下均为对 **上游 `main`**（2026-09-19 复核；原为 v0.6.8 tag 核实，逐条在 `main` 上重验后结论不变）的结果。它们**不影响英文侧**，但决定了中文侧不能交给它。

| 项                           | 证据                                                                                                                                                            | 后果                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **中文实体消解静默失效**     | `deduplication/similarity_calculator.py`：token 预筛用 `.split()` 后判定 `"no_shared_tokens"`，v2 blocking key 为 `tok:{token[:4]}`                             | 中文整串只有一个 token → **一对候选都生成不出来**，不报错，只是什么都不合并                 |
| **NER 默认英文**             | `extract_entities_spacy(model="en_core_web_sm")`；文档称 ml 档为 _"general English NER"_                                                                        | 中文抽取只能走 `method="llm"`（计量）                                                       |
| **分句切不了中文**           | `split/methods.py` 硬编码 `en_core_web_sm`；正则回落 `re.split(r"(?<=[.!?])\s+", text)` 要求 ASCII 标点 + 空白                                                  | `。` 结尾的中文句切不开                                                                     |
| **嵌入硬编码英文**           | `semantic_extract/methods.py` L244 在**无参数的缓存全局**里写死 `TextEmbedder("BAAI/bge-small-en-v1.5")`                                                        | 即使改了存储层嵌入，这条内部相似度路径仍是英文                                              |
| **加载失败静默降级**         | 模型加载失败时 `get_method()` 返回 `"fallback"` → **128 维 SHA-256 哈希向量**，不抛异常                                                                         | 危险失败模式：以为在用语义嵌入，实际是哈希                                                  |
| **语言标签不往返**           | `explorer/utils/rdf_parser.py` L55 `if lang and lang.startswith("en")` 使 `@en` 胜出、`@zh` 被丢弃；`owl_generator.py` 导出无标签字面量；SHACL 用 `sh:datatype` | `@zh` 字面量是 `rdf:langString`，会被 `xsd:string` 形状拒绝；中文标签只能存**无标签字符串** |
| **changelog 与发布版不一致** | CHANGELOG v0.6.7 #967 声称修好 CJK bigram 回落；**`main` 的 `decision_query.py` 仍是纯 whitespace Jaccard**（`jaccard` / `bigram` 在该文件零命中）              | 中文决策/先例检索不可用；**不能把 changelog 当能力清单**                                    |
| **多语言无支持声明**         | 81 份 in-repo 文档 + README + ARCHITECTURE 中 `multilingual` / `cross-lingual` / `Chinese` / `bge-zh` / `bge-m3` **零命中**                                     | 中文能力属未声明、未验证区                                                                  |

**文档漂移的其他实例**（作为成熟度证据，不是否决理由）：`RELEASE_NOTES.md` 停在 0.5.0；`ARCHITECTURE.md` 称 MCP "10+ tools" 而文档已是 15 个；README 的性能数字自陈"非 `tests/` 断言"；`_cosine_similarity` 名称与实现（字符 bigram Jaccard）不符。**注：原列表中的 `semantica[embeddings-local]` extra "在 PyPI 不存在"一条已作废** —— `main` 上该 extra 确实存在（`sentence-transformers` / `fastembed` / `onnxruntime` / `tokenizers`）。

> **结论：引用它时每个 `[核实]` 都必须自己读源码，不信文档。**

**成本论据（与能力论据并列）**：换引擎省掉的是**最便宜的那一环（写 SQL）**，而抽取一步在 Semantica 上同样省不掉、且中文抽取质量更差（上表）。`[研判]`

| 环节                                                       | 谁做                        | 成本                               |
| ---------------------------------------------------------- | --------------------------- | ---------------------------------- |
| **把散文里的关系抽成边**（成分 / 禁忌病症 / 严重相互作用） | Lucent（LLM + 词典 + 复核） | **贵** —— 工作量的大头在这里       |
| 建边表 + ETL                                               | Lucent                      | 便宜，一次性脚本                   |
| 查询（视图 / 参数化函数 / 递归 CTE）                       | Lucent                      | **便宜** —— 十几条查询，每条几十行 |
| 守语义（命名、关系类型、溯源列）                           | Lucent + CI                 | 持续，可自动化                     |

**桥梁说明**：以上缺陷**都不影响中文侧→英文侧的映射工作** —— 映射是离线产出（LLM 翻译 + 本地 DrugBank 索引）、以预解析 ID 的边形式消费，不经过它的中文消解 / NER / 分句 / 嵌入。

---

## 六、存储、集成与部署

### 6.1 集成代价

`[核实]` PyPI JSON API + README

| 维度           | LightRAG                                                                                  | Semantica                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 形态           | **官方 HTTP server**（`lightrag-server` / `lightrag-gunicorn` / 官方 Docker 镜像 / GHCR） | **Python 库**，in-process                                                                                                                                        |
| 从 NestJS 调用 | `fetch` → `:9621`                                                                         | **我们自建 HTTP 服务**：Semantica 自身的 REST 在 `explorer` extra 内（官方定位开发控制台，且不含我们的工具契约）；MCP 为 **stdio-only**，做不了远程服务。见 §6.5 |
| 生产部署路径   | 官方 Docker + compose + k8s                                                               | **无官方生产镜像** → 自建镜像 + 自写包装服务。见 §6.5                                                                                                            |
| 基础安装依赖   | 轻（Python ≥3.10）                                                                        | **已大幅瘦身**：`main` 移走了 22 个重包，SHACL 校验不再连带 PyTorch                                                                                              |

**依赖体积已不是问题（`main` 相对 v0.6.8 的关键改善）**：`main` 的
`feat(deps): slim core dependencies`（2026-09-07）把 22 个重包从强制依赖移入 extras，
`pip install semantica`（**无任何 extra**）现在只剩：

- **基础科学栈**：`numpy`、`pandas`、`scipy`、`scikit-learn`
- **图与 RDF 栈**：`rdflib`、`networkx`、`pyarrow`
- **工具栈**：`requests`、`chardet`、`protobuf`、`grpcio`、`pillow`、`pydantic`、`click`、
  `rich`、`tqdm`、`pyyaml`、`toml`、`python-dotenv`、`loguru`、`structlog`、`httpx`

原 v0.6.8 里强制的 `torch` / `transformers` / `sentence-transformers` / `fastembed` /
`onnxruntime` / `spacy` / `gensim` / `opencv-python` / `librosa` / `matplotlib` / `seaborn` /
`plotly` / `faiss-cpu` / `lxml` / `python-docx` / `openpyxl` / `GitPython` **全部已转移到
extras**。因此"只借 SHACL 却连带 PyTorch + OpenCV + librosa"这条论据**对新基线不成立**。

→ 这直接改变了 §6.5 的镜像体积结论：**基于 `main` 的 sidecar 镜像不再需要背 PyTorch 栈**，
只有显式声明用到 extras 才会引入。`[核实 2026-09-19]`

**LLM SDK 不在基础安装内**：`llm-openai` / `llm-deepseek`（两者都只装 `openai`）/ `llm-litellm`（覆盖 OpenAI / Anthropic / Gemini / DeepSeek / Ollama）**均为 extra**；SHACL 也是 `shacl` extra（`pyshacl>=0.25.0`）。

**外部厂商 API 路线下的一个硬缺口**：`OpenAIStore`（唯一的云端嵌入路径）只接受 `api_key` 与 `model`，**没有 `base_url` 透传**（LLM 那条路是支持 `base_url` 的）。"嵌入也走外部厂商"在文档里不支持、代码里也没有这条路径 —— 要么在 Semantica 侧改（§7 第 1 项），要么用 SDK 的 `OPENAI_BASE_URL` 环境变量绕过（未文档化）。

生产 extra 用 curated 集合而非 `[all]`（`[all]` 连 `dev`、`infra`、`cloud`、`graph-all` 一起装）：

```
semantica[explorer,shacl,tripletstore-oxigraph,monitoring,viz]  +  llm-openai
```

**框架支持矩阵**：一等支持 Agno、CrewAI、LangChain（`pip install semantica[langchain]`）；**仅经 REST API / MCP**：**LangGraph**、LlamaIndex、AutoGen、OpenAI Agents、Google ADK。Lumos 的编排栈是 **LangGraph + TypeScript** → 对应路径只有 REST API / MCP。

### 6.2 存储与持久化

| 层                   | 能力                                                                                                        | 结论                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| ContextGraph         | **纯内存实现**，`__init__` 无 store/backend 参数；持久化只有 `save_to_file`（JSON / Markdown **整图快照**） | 需要 LPG 后端才能落库                                                                               |
| LPG 图后端           | `GraphStore` 只认 `neo4j` / `falkordb` / `neptune` / `age`，其余抛 `ValidationError`                        | **没有"纯 PG 表"图后端**（与 LightRAG 的 `PGTableGraphStorage` 不同）                               |
| RDF                  | `OxigraphStore`（嵌入式）/ Blazegraph / Jena / RDF4J                                                        | Oxigraph **不能**承载 ContextGraph（决策记录器会对 SPARQL 端点发 Cypher）                           |
| 决策 / 审批链 / 策略 | 走 `execute_query` 发 Cypher                                                                                | **必须有 AGE 或外部 LPG 服务**；否则退化为进程内 + 文件快照（无并发写、整图重写）                   |
| provenance           | 内置 `InMemoryStorage` / `SQLiteStorage`                                                                    | **PG 无内置后端**；`ProvenanceStorage` 是文档化的自扩展点，自写 PG 实现可让审计与 `audit_logs` 同库 |
| 向量                 | `PgVectorStore`（需预先 `CREATE EXTENSION vector`，Semantica **不自动创建**；自建表、无 schema 参数）       | 可复用现有 PG 实例                                                                                  |
| SKOS / 本体版本      | SKOS 需要 TripletStore；版本历史为 SQLite 文件                                                              | Oxigraph（嵌入式目录）+ SQLite                                                                      |

**部署形态与 AGE 版本纪律**：`[核实]`

- 镜像 = `pgvector/pgvector:pg18` + 编译 **`release/PG18/1.7.0`** 的 AGE（Semantica 的 AGE adapter 会自己执行 `CREATE EXTENSION IF NOT EXISTS age` → 需要扩展创建权限；并 `SET search_path = ag_catalog` → **建议用独立 database**，避免污染 Prisma 域）。
- **不要上 1.8.0**：`apache/age#2500`（open，2026-08-07）—— 1.8.0 引入原生 vertex/edge 类型后 `id()` 返回 `graphid`（pass-by-value int64），`agtype_in_operator` 仍按 varlena 指针解引用，**`WITH [1] AS ids MATCH (n) WHERE id(n) IN ids` 直接 SIGSEGV 并触发 PG 崩溃恢复**；`release/PG18/1.7.0` 不受影响，且 Docker Hub 目前也没有 PG18 1.8.0 镜像。
- 该 issue 明确提到这个查询模式**正是 LightRAG 的 Postgres 图后端会发的** —— 这也是**英文侧只用 AGE 服务 Semantica、LightRAG 保持 `PGTableGraphStorage`** 的原因。
- 注意 Semantica 自己的功能矩阵里，AGE 后端的 **Reasoning/analytics 与 Provenance 只标 `Partial`**，并注明 _"Cypher compatibility and property handling can differ from standalone LPG engines"_。

### 6.3 AGE 1.7.0 的 Cypher 子集（2026-09-17 试点实测）

试点仓 `scripts/probe_age_cypher.py` 逐条实测，把上面的 `Partial` 具体化：

**支持**：聚合 `count` / `ORDER BY` 别名、`collect(DISTINCT)`、`WITH + WHERE`、`OPTIONAL MATCH`、
`UNWIND`、`$param` 绑定（Semantica 转义为字面量后下发）、`CASE`、正则 `=~`、锚定的变长路径、边属性聚合。

**不支持**：

| 项                   | 报错                                         |
| -------------------- | -------------------------------------------- |
| `shortestPath()`     | `syntax error at or near "shortestPath"`     |
| `allShortestPaths()` | `syntax error at or near "allShortestPaths"` |
| 多类型边 `[r:A\|B]`  | `syntax error at or near "\|"`               |
| `datetime()`         | `function datetime does not exist`           |

→ **路径查询必须写成显式类型化多跳模式**，不能依赖最短路函数。
另注：`INTERACTS_WITH` 边在常见药物集上是**近团**（试点 86 药之间就有 5,504 条），
无约束的变长路径会组合爆炸（实测一条 `-[*1..3]->` 跑满 2 分钟未返回），必须加锚点、类型约束与 `LIMIT`。

### 6.4 三项能力实测：本体治理 / 确定性推理 / PROV-O 溯源（2026-09-17 试点）

**核心结论：这三项能力都不依赖图后端，因此 AGE 被标 `Partial` 不构成换图数据库的理由。**

| 能力        | 实际承载层                              | 实测结果                                                                                                                                              |
| ----------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 本体治理    | 纯 RDF/OWL 层（rdflib / pyshacl）       | ✅ OWL 导出合法；**手写** SHACL 形状校验有效（准确报出 3 条违规，与裸 pyshacl 一致）；质量门禁可用；**不需要 JDK**。⚠️ 但**自动派生不可用**（见坑 1） |
| 确定性推理  | 内存 facts（`ContextGraph` → Datalog）  | ✅ 递归传递闭包正确；与 Cypher 交叉验证一致（560 对完全相同）                                                                                         |
| PROV-O 溯源 | 独立存储（InMemory / SQLite / 自写 PG） | ✅ 导出为真 RDF（42 三元组，rdflib 可解析）；哈希链校验 `valid: True`                                                                                 |

#### 三个必须写进落地清单的坑

1. **本体与 SHACL 都必须手写，不能从数据反推**（fork 第 12 项）——
   - `to_shacl()` 自动派生的形状有缺陷：数据类型写成 `xsd:xsd:string`（**前缀重复**），
     约束**不可满足** → 连正确数据都被判 `conforms=False`；且不含 `sh:minCount`/`sh:maxCount`，
     缺必填属性反而不报。**误报 + 漏报同时存在，比空形状更危险**（会在 CI 里挡掉合法数据）。
   - **`main` 复核**：两条均仍在。`SHACLGenerator._resolve_xsd()` 的回落分支仍是
     `f"xsd:{range_str}"`，别名表里**没有任何 `xsd:` 前缀键**，故 range 若已带前缀即产出
     `xsd:xsd:string`；`sh:minCount` 只在词条显式声明 `cardinality.min` 或 `required` 时才发，
     自动派生不产生这两个字段。**类与文件实际位于 `ontology/ontology_generator.py`
     （`SHACLGenerator` 类），不是 `ontology/shacl_generator.py`** —— 该文件在上游任何版本都不存在。
   - 本体生成**丢弃低频关系类型**：试点喂入 15 种关系类型，**保留 9 种、丢 6 种**，
     丢弃的恰好是边数 ≤3 的（`REGULATES` 1 / `TRANSPORTED_BY` 1 / `ACTIVATES` 2 /
     `BLOCKS` 3 / `CARRIED_BY` 3 / `DOWNREGULATES` 3），保留的都是 ≥10 的 ——
     存在一个**最低支持度阈值**。
     `TRANSPORTED_BY`（转运体介导的 DDI）正是临床重要但稀有的边，被静默丢弃。
     → **本体以 §4.1 的 YAML 词表为准，SHACL 形状从该 YAML 手写。**

2. **Datalog 的不等式约束被静默忽略**（fork 第 10 项）—— `D != S` 与 `D <> S` 均不生效，
   最小可复现案例中三种写法（含不带不等号的对照）结果**完全相同**。临床后果是自反假阳性
   （试点全量数据上 **12 个**"药物与自身相互作用"）。**不等式必须在查询/后处理层过滤。**

3. **`load_from_graph(AGE store)` 静默返回 0**（fork 第 11 项）—— 对填充了 37 个节点的
   `ContextGraph` 能载入 85 条事实，对 AGE store 则**返回 0 且不抛异常**。
   → 推理层与 AGE 之间**必须自建桥**（导出为 `ContextGraph` / dict）。
   这是应用侧胶水代码；**换图数据库同样需要**，因为 `load_from_graph` 的签名始终接受 `ContextGraph`。

> 另：通用 `Reasoner.add_rule` + `forward_chain()` 派生 0 条（即使 `IF/THEN` 规则被正确解析）。
> **实际可用的是 `DatalogReasoner`**，落地时直接用后者。

#### PG 版 ProvenanceStorage 的成本已探明（fork 第 4 项）

抽象方法只有 **5 个**（`clear` / `retrieve` / `retrieve_all` / `store` / `trace_lineage`），
试点已实现并跑通（约 160 行）。

⚠️ **陷阱**：`get_chain_head()` **不在** `__abstractmethods__` 里，基类默认 `return None`
（注释写"该后端不支持链式"）。只实现那 5 个抽象方法会**静默关闭哈希链** ——
写入看似正常，但 `verify_chain()` 报 `chain_break`。正确成本是 **6 个方法**。

### 6.5 服务形态与框架选型（2026-09-17 试点实测）

#### 前提：Semantica 没有可拉取的生产镜像

|              | LightRAG（既有先例）        | Semantica                                 |
| ------------ | --------------------------- | ----------------------------------------- |
| 官方生产镜像 | ✅ `ghcr.io/hkuds/lightrag` | ❌ **无**                                 |
| 形态         | 官方 HTTP server            | **in-process Python 库**                  |
| REST         | 官方自带                    | 仅 `explorer` extra（官方定位开发控制台） |
| MCP          | —                           | **stdio-only**，做不了远程服务            |

→ **"semantica sidecar" 这个说法有误导性：那个 sidecar 是*我们的*，Semantica 只是它内部的库依赖。**
试点已证明推理层与 AGE 之间**必须自建桥**（§6.4），那座桥就是代码。

#### 落点切分

| 内容                                                                          | 归属                                                                          |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 包装服务代码（`/reason`、`/schema`、`/validate`、`ontology:rebuild`、AGE 桥） | **独立仓** `semantica-service/`                                               |
| Dockerfile + fork 自持（跟 main）+ vendor wheel 树                            | 同上                                                                          |
| `.env` / `.env.example`                                                       | `Lucent/deploy/semantica/`（与 `deploy/lightrag/` 同构，**只放配置**）        |
| compose 服务定义                                                              | `Lucent/compose{,.dev,.staging}.yaml`（与 lightrag 并列，同机容器、不走 PM2） |
| TS HTTP 客户端 + 工具注册                                                     | `Lucent/src/modules/assistant/`                                               |

**代码不放进 `Lucent/deploy/`**，三条理由：

1. **`deploy/` 的语义会被破坏** —— 它现在表示"**外部镜像**的部署配置"
   （`deploy/lightrag/` 只有 `.env` + `.env.example`，镜像来自 GHCR）。
   塞进一个我们拥有并维护的代码库，这个含义就没了。
2. **语言 / 工具链 / 发布节奏全不同** —— Lucent CI 是 pnpm + Node；多一个 Python 服务
   要多一套 lint / test / 依赖管理 / 镜像发布流程，而它的升级周期与 Lucent 版本无关
   （fork 自持意味着按内部节奏 rebase）。
3. **工作区约定本就是"一个项目一个仓"** —— Lucent / Luminous / Luminous-website 各自独立仓，
   根目录不是 git 仓。一个独立发布的 Python 服务正好符合这个形状。

#### 框架：FastAPI + uvicorn，同步 `def` 端点

决定因素不是"哪个流行"，而是**这个服务的负载没法异步化**：

| 组件                            | 性质                                                        |
| ------------------------------- | ----------------------------------------------------------- |
| `ApacheAgeStore`                | **psycopg2 = 同步阻塞**（由 `graph-apache-age` extra 引入） |
| `DatalogReasoner`               | **CPU-bound 同步**（fixpoint 求值）                         |
| `OntologyEngine.validate_graph` | **CPU-bound 同步**（pyshacl）                               |

用 async 原生栈（asyncpg + async 框架）意味着要**绕开 Semantica 自己的 AGE store 另写一套**，
而 Datalog 与 SHACL **照样绕不开** —— 异步买不到什么，只增加复杂度。

**并发实测**（`scripts/bench_concurrency.py`，试点 API 全部为同步 `def` 端点）：

| 指标     | 值                                       |
| -------- | ---------------------------------------- |
| 单请求   | 265 ms                                   |
| 并发 16  | **16/16 成功**，墙钟 0.51 s，中位 479 ms |
| 延迟退化 | **1.8×**                                 |
| 吞吐     | **31.4 req/s**                           |

FastAPI 把同步 `def` 端点**自动丢进线程池**，阻塞调用不会卡事件循环 —— 正是该负载需要的语义。

**对照实测**（`scripts/bench_shared_store.py`）：全局共享一个 `ApacheAgeStore`
（内部只有一条 psycopg2 连接）并发 16 时 **16/16 成功、结果一致**，
但墙钟 **1.35 s vs 每请求新建连接 0.46 s，慢 2.9×** —— 单连接把并发串行化了。
（注：该测试只覆盖只读查询，写路径上的事务交错风险它证明不了。）

#### 依赖集

```toml
semantica[shacl,graph-apache-age,tripletstore-oxigraph]  # 跟随上游 main；不写 ==pin
fastapi
uvicorn[standard]
```

- **去掉 `explorer`** —— 用不到它的路由（试点 `api.py` 直接连 AGE，注释里已写明）。
  该 extra 本身**很轻**（fastapi / starlette / uvicorn[standard] / websockets /
  python-multipart / defusedxml），不是"重控制台"；只是既然自己钉 FastAPI，
  就不必带上 websockets / python-multipart / defusedxml。
- **去掉 `llm-openai`** —— 理由见 §3.5：四类生成里唯一可能用到 LLM 的 ② 放在 Lucent，
  **sidecar 因此不需要 LLM 凭据**。
  **注意：这不是因为 Semantica 没有生成能力**（它有四处），而是因为英文侧是确定性灌入。

#### 五条实现约束（比框架品牌更重要）

1. **绝不把调 psycopg2 / pyshacl / Datalog 的处理器写成 `async def`** ——
   那会跑在事件循环上，一慢全停。用同步 `def`（FastAPI 自动线程池）或显式 `run_in_threadpool`。
2. **用连接池，不要全局单例 store** —— 实测慢 2.9×（`psycopg2.pool.ThreadedConnectionPool`）。
3. **每条连接都设 `statement_timeout`** —— 试点那条失控的变长路径跑满 2 分钟，
   靠手动 `pg_terminate_backend` 才掐掉。
4. **Datalog / SHACL 是 CPU-bound** —— 用多 worker（`--workers N`），并对输入规模设上限或超时。
5. **AGE 查询并发另设上限** —— 稠密图上多跳代价高（§6.3）。

> 被排除的框架：Flask + gunicorn（模型最简，但 FastAPI 已在依赖树、且拿不到自动 OpenAPI 与
> pydantic 校验）、Litestar（引入新依赖换不来实质收益）、裸 Starlette（FastAPI 就是它 + pydantic）、
> Django（对规模过重）、async 原生栈（见上）。

---

## 七、fork 清单

fork 自持后，§5 的缺陷从"能力否决"变成"待办"。按必要性排序。

**2026-09-19 在 `main` 上逐条复核：12 项全部仍然有效**（无一项被上游修掉），多数行号未漂；下表行号已按 `main` 校准（其中第 5、7、8 项的原行号在 `main` 上完全未变）。

| #   | 位置                                                           | 改什么                                                              | 必要性                                                         |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | `embeddings/provider_stores.py` `OpenAIStore.__init__`         | 加 `base_url` 透传（config 或 `OPENAI_BASE_URL` 环境变量）          | **必须** —— 否则外部厂商嵌入接不上                             |
| 2   | `semantic_extract/methods.py` L463                             | 把硬编码的缓存全局 `TextEmbedder("bge-small-en-v1.5")` 参数化       | **必须**（若中文文本入图；英文侧可选）                         |
| 3   | 启动自检                                                       | 断言 `TextEmbedder.get_method() != "fallback"`，否则 fail fast      | **必须** —— 防 128 维哈希向量静默上线                          |
| 4   | `provenance/storage.py`                                        | 实现 PG 版 `ProvenanceStorage` 子类，审计与 `audit_logs` 同库同事务 | **值得** —— 默认只有 SQLite；**成本已实测为 6 个方法**（§6.4） |
| 5   | `deduplication/similarity_calculator.py` L200–215 / L671–677   | token 预筛与 blocking key 改字符 n-gram / 前缀                      | 按需 —— 中文实体消解若留在 Lucent 则不需要                     |
| 6   | `context/decision_query.py` 决策相似度回落                     | 补上 changelog 承诺的字符 bigram 回落（约 5 行）                    | 按需 —— 用它的决策检索才需要                                   |
| 7   | `split/methods.py` L340 / L424                                 | 中文句切分与 spaCy 模型参数化                                       | 按需 —— 复用现有 chunk 表则不需要                              |
| 8   | `explorer/utils/rdf_parser.py` L55 + `owl_generator.py`        | 保留语言标签（或明确只存无标签字符串）                              | 按需 —— 双语标签重要才改                                       |
| 9   | `graph_store/age_store.py` `_infer_return_cols`                | 按逗号切分 `RETURN` 时**同时跟踪引号**（现只跟踪括号深度）          | **必须** —— 见 §6.3，LLM 生成的查询极易触发                    |
| 10  | `reasoning/datalog_reasoner.py` 规则解析                       | 支持并**真正应用**不等式（`!=` / `<>`）约束                         | **必须** —— 见 §6.4，现为静默忽略，产出假阳性                  |
| 11  | `reasoning/datalog_reasoner.py` `load_from_graph`              | 对不支持的图对象**抛错**而非静默返回 0                              | **值得** —— 见 §6.4，危险的静默空操作                          |
| 12  | `ontology/ontology_generator.py` `SHACLGenerator._resolve_xsd` | 修 `xsd:xsd:string`（前缀重复）导致的不可满足约束；补 `sh:minCount` | **必须** —— 见 §6.4，误报+漏报同时存在                         |

**第 9 项的实测依据（2026-09-17 试点）**：`_infer_return_cols` 按逗号切分 `RETURN` 子句且**不识别字符串字面量**，
因此 `RETURN a AS x, 'reduces metabolism, increasing risk' AS note` 被切成 5 列而非 4 列，
AGE 报 `return row and column definition list do not match`。对照实验（无字面量 3/3 通过、
含逗号字面量 5≠4 失败、逗号在括号内 4/4 通过）见试点仓 `scripts/verify_return_cols_bug.py`，
已在试点内以 `age_exec.py` 修正并跑通真实 LLM 查询。

**配套两条**：内网镜像 **vendor 整棵 wheel 树**（防上游下架/删库）；一条 `ontology:rebuild`（从 PG + 本体文件全量重建图）作为"未被锁定"的可执行证明。

> **跟随 `main` 的代价与纪律（2026-09-19）**：基线不钉 SHA 意味着 §7 的行号会随上游漂移，
> 且 46 个 open PR 随时可能改动被 fork 的文件。因此每次 rebase 到新 `main` 时：
> ① 重跑 §7 清单确认 12 项是否已被上游修掉（修掉则从 fork 改动里删除）；
> ② 重读 §5 确认中文侧边界未变；③ 重跑 S1 的 AGE 探针（§6.3 的 Cypher 子集结论与后端版本绑定）。
> vendor wheel 树是这条策略的安全网 —— 上游删库/下架不影响已构建镜像。

---

## 八、落地顺序与运维

### 8.1 落地阶段（纯英文侧，自包含）

**本节路径不需要任何中文侧工作。** Semantica 只吃英文 DrugBank；中文说明书 / 中文问答属 LightRAG 那条线（§9 指针），与本计划无依赖、不可混排验收。

| 阶段                | 工作量 | 内容                                                                                                                                                                                                  | 验收                                                                                  |
| ------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **S0**              | 0.5 天 | 建立**英文侧**标注评测集：20–50 条 DrugBank 真实问题 + 期望证据（多跳、相互作用、靶点、ATC 分类）                                                                                                     | "药 → 靶点 → 相互作用药"这类题有可判定的标准答案                                      |
| **S1** ✅试点已验证 | 0.5 天 | 实测 `dyingbleed/postgres-rag:18-trixie`：确认 AGE 为 **1.7.0**（1.8.0 有 #2500 SIGSEGV）；不达标则按同一配方自建镜像                                                                                 | `CREATE EXTENSION age;` 成功；**注意镜像仅 arm64，amd64 需自建**（§8.1 试点验证结果） |
| **S2** ✅试点已跑通 | 1 天   | **把试点提升为独立仓 `semantica-service/`**（§6.5）：FastAPI + 同步 `def` + 连接池 + `statement_timeout`；暴露 `/reason`、`/schema`、`/validate`、`/health`；AGE 后端指向独立 database `lucent_graph` | 镜像可构建；`/health` 返回图规模；并发 16 无失败                                      |
| **S3**              | 1 天   | §4.1 词表 → **手写** SHACL 形状 + OWL 导出（自动派生不可用，见 §6.4）                                                                                                                                 | 手写形状能挡住故意的违规数据；OWL 可被 rdflib 解析                                    |
| **S4** ✅试点已验证 | 1 天   | **确定性灌入 DrugBank**（零 LLM 抽取、零 token），批量 `UNWIND` 写入                                                                                                                                  | 多跳查询（药 → 靶点 → 相互作用药）返回正确结果                                        |
| **S5**              | 1 天   | Lucent 新增 `reason_over_ontology` 工具，接 §3.6 的四个注册点；NL→Cypher 按 §3.5 切分（Lucent 生成、sidecar 校验执行）                                                                                | 工具返回带 PROV-O 溯源的 envelope                                                     |
| **S6**              | 0.5 天 | 文档 + 当日迁移日志                                                                                                                                                                                   | `pnpm docs:verify` / `pnpm docs:links` 通过                                           |
| **S7**（按需）      | —      | 中英映射接图准入（§4.4）                                                                                                                                                                              | 硬约束：**未复核的 `SAME_AS` 边不得被结论级推理消费**                                 |

**执行顺序不可反**：S1 是唯一的"零成本否决点"（已由试点通过）；S0 的评测集是 S4 之后所有"是否继续"的唯一判据。
**S2 现在是第一步真正的工程动作** —— 试点是工作区根目录下一个没有 git、没有 CI 的目录，
必须先提升为独立仓才能接进 Lucent。

#### 起点状态（2026-09-17 实测）

| 项                                      | 实测                                                                                            | 对应阶段            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------- |
| dev/test PG 镜像                        | `pgvector/pgvector:pg18`（容器 `lucent-postgres-dev` / `lucent-postgres-test`），**未编译 AGE** | 未开始 S1           |
| `dyingbleed/postgres-rag:18-trixie`     | 本地无此镜像                                                                                    | 未开始 S1           |
| `lucent_graph` 数据库                   | 不存在                                                                                          | 未开始 S2           |
| semantica sidecar / `deploy/semantica/` | 不存在                                                                                          | 未开始 S2           |
| 全仓代码引用                            | `semantica` 仅出现在文档，**零代码引用**                                                        | 未开始 S5           |
| Lucent 工具表                           | `tool-types.ts` 仍为 23 个工具，无 `reason_over_ontology`                                       | 未开始 S5           |
| 英文 DrugBank 数据                      | 已在库：`drugbank_drugs` 19,842；交互边 2,474,851；靶点边 61,079；`drugbank_targets` 5,096      | **S4 的输入已就绪** |

#### 试点验证结果（2026-09-17，独立于 Lucent 主干）

**结论：可行性验证通过。** 试点位于工作区根目录 `semantica-oag-pilot/`（未进 Lucent 仓），
详细记录见该目录 `README.md`。要点：

| 验证项                                                                     | 结果                                                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 镜像 AGE 版本                                                              | **1.7.0** ✓（pgvector 0.8.1）                                                       |
| `age#2500` SIGSEGV 探针                                                    | **未复现**（`id(n) IN <变量列表>` 在 1.7.0 正常）                                   |
| Semantica 的 AGE 后端连通                                                  | ✓（确认无"纯 PG 表"图后端，决策/推理必须走 AGE）                                    |
| 建图（86 药 / 149 靶点 / 161 ATC → **396 节点 / 6,784 边 / 17 种边类型**） | ✓ 0 失败                                                                            |
| 类型化多跳查询                                                             | ✓ 6/6 通过（酶介导 DDI、共享靶点、4 跳级联链、ATC 范围、机制+记录联立、血清素叠加） |
| 自然语言 → 本体约束 Cypher → 有据可依回答                                  | ✓ 通过：3/4 一次成功，1/4 触发生成错误后由**重试回路**修正                          |
| **本体治理**（OWL 导出 / SHACL 校验 / 质量门禁）                           | ✓ 可用；但**形状必须手写**（自动派生的为空）—— §6.4                                 |
| **确定性推理**（Datalog，与 Cypher 交叉验证）                              | ✓ 逻辑一致（560 对完全相同）；但**不等式被静默忽略**—— §6.4                         |
| **PROV-O 溯源**（导出 / 血缘 / 哈希链）                                    | ✓ 完全可用；**PG 后端已自实现并跑通**（6 个方法）—— §6.4                            |
| LLM / 嵌入连通（复用 Lucent 的阿里云 MaaS）                                | ✓ 均可用；**图路径不需要嵌入**，未引入本地嵌入模型                                  |
| 全量导入 / 全量嵌入                                                        | 未做（试点有意限定在小范围）                                                        |

**两条需要提前准备的风险（试点新增）**：

1. **镜像仅 arm64** —— `dyingbleed/postgres-rag:18-trixie` 在 amd64 宿主上会报
   _"requested image's platform (linux/arm64) does not match the detected host platform"_，
   靠 QEMU 模拟可运行。生产服务器若为 amd64，**必须按同一配方自建 amd64 镜像** ——
   即 AGE 计划 §八待确认第 1 条的"自建镜像回退"路径需要**提前落实**，不能等到部署时。
   **注意：写入吞吐不能拿试点的 45 边/s 做判断** —— 那是逐条 `create_relationship()` 的往返开销，
   批量 `UNWIND` 实测 **1571 边/s（49.6×）**；全量 DrugBank 的 247 万交互边按此约 26 分钟（仍在模拟下）。
2. **NL→Cypher 需要重试回路** —— 试点中实测到模型产出 `OPTIONAL MATCH ... AS x` 这类非法语法。
   重试（把报错回喂模型）是**生产必需**，不是可选优化。

**图数据库选型结论（试点新增）：维持 AGE，不引入专用图数据库。**

- 试点已证明四项核心能力（类型化多跳检索、本体治理、确定性推理、PROV-O 溯源）在
  **AGE + Semantica** 上均可跑通，且三项能力**根本不走图后端**（§6.4）。
- 官方把 AGE 的 Reasoning/analytics 与 Provenance 标 `Partial`，指的是 Semantica
  **未把这两项接进 AGE 后端**，而不是 AGE 做不了 —— 且推理路径基于内存 `ContextGraph`，
  与图后端无关（由 `load_from_graph` 的签名直接证明）。**换图数据库买不到这三项能力。**
- 不支持的 Cypher 特性（`shortestPath` / 多类型边 / `datetime()`）都有已实测的等价写法；
  且 Datalog 侧反而能表达 AGE 变长路径表达不了、且会组合爆炸的**递归规则**。
- 真正的缺口是**应用侧桥接层**（AGE → `ContextGraph`/dict → 推理器），换库同样存在。
- 成本面：AGE 编译进现有 PG18 镜像（同备份、同监控、同连接池）；专用图库是新运维品类，
  且候选多为非 OSI 许可（FalkorDB SSPL / Memgraph BSL 1.1）、Kuzu 已归档。

**重新评估的触发条件**：① 需要图算法（中心性 / 社区发现 / 多源最短路）作为**面向用户的产品能力**；
② 数据达到千万级边且原生 amd64 上 AGE 查询延迟不达标。

### 8.2 运维手册

- **Semantica**：`ontology:rebuild`（从 PG + 词表全量重建图）作为"未被锁定"的可执行证明；wheel 树 vendor 进内网镜像。
- 上游升级**跟随 `main` 最新**（不钉 SHA）：每次 rebase 后按 §7 末尾的三步纪律重核 §5 / §7 / §6.3 的源码级结论。
- **安装来源**：PyPI 落后 `main`，因此生产镜像**从 fork 的 `main` 源码构建**（`pip install .[shacl,graph-apache-age,tripletstore-oxigraph]`），不装 PyPI 的 0.6.8。这样"跟随 main"与"可复现构建"同时成立 —— 可复现性由 vendor wheel 树与镜像层保证，而不是靠版本号 pin。

### 8.3 风险清单（Semantica 相关条目）

| 风险                             | 事实                                                                                                                                                                   | 应对                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **依赖体积**                     | 核心依赖已瘦身：22 个重包（torch / opencv / librosa 等）移入 extras，`pip install semantica` 不再强制它们；但**用到本地嵌入 / spaCy / 文档解析时仍要显式装对应 extra** | 用 curated extras 而非 `[all]`；**中文侧不引 Semantica**，体积与 CVE 面只落在英文侧                                                               |
| **上游文档与代码漂移**           | changelog 声称的 CJK 修复不在 `main`；`RELEASE_NOTES.md` 停在 0.5.0                                                                                                    | fork 自持 + vendor wheel 树；**引用它时逐条读源码，不信文档**                                                                                     |
| **Semantica 存储在 PG 上受限**   | 无纯 PG 表图后端；决策/审批/策略写 Cypher（必须 AGE）；provenance 仅 SQLite                                                                                            | 英文侧用 AGE；provenance 走自写 PG `ProvenanceStorage`（§7 第 4 项）                                                                              |
| **嵌入静默降级**                 | 模型加载失败 → 128 维 SHA-256 哈希向量，**不抛异常**                                                                                                                   | fork 第 3 项：启动自检 `get_method() != "fallback"`，否则 fail fast                                                                               |
| **AGE 版本纪律**                 | `apache/age#2500`（open）：1.8.0 上 `id(n) IN <变量列表>` SIGSEGV 并触发 PG 崩溃恢复                                                                                   | 钉 `release/PG18/1.7.0`；升级前先看 #2500 状态                                                                                                    |
| **AGE 功能矩阵限制**             | AGE 后端的 Reasoning/analytics 与 Provenance 只标 `Partial`                                                                                                            | 接受局限；关键查询先实测再决定                                                                                                                    |
| **第三方镜像供应链**             | `dyingbleed/postgres-rag` 是社区镜像，维护持续性未知                                                                                                                   | 钉 `18-trixie` 不可变标签；上线前审计 Dockerfile 与镜像层；必要时以同一配方自建镜像回退                                                           |
| **Semantica 项目成熟度**         | 较新开源，社区与维护可持续性存疑                                                                                                                                       | 跟随 `main` 最新（不钉 SHA）但 fork 自持；Skill / Action 留在 Lucent 侧（可剥离）；自建路线仍为可回退的 plan B                                    |
| **Semantica 推理存储后端二选一** | 纯关系表 / JSONB 不满足 Rete / Datalog / SPARQL 推理要求                                                                                                               | 选 AGE（英文侧确定形态）；源层仍为 Phase 1 关系表，**物化隔离**                                                                                   |
| **审计缺口（现状）**             | `AuditLogService` 已有、account / auth / data-export 都接了，但 **`proposal-confirm` 写入路径未写审计**                                                                | 在 confirm 路径补 `assistant.proposal.confirm` 审计（`resourceType` / `resourceId` + `proposalIds` + `decision`），与 §4.1 的断言 provenance 对齐 |

### 8.4 非目标（不属本文）

本文只覆盖英文侧，以下**不在本计划的路径里、也不构成其依赖**：

- **中文侧不引入 Semantica / AGE** —— 中文侧无多跳关系网络可走，硬上成本大于收益。理由是边界声明（§5 给出源码级依据），**不是**本文的待办项。
- 中文说明书 / 中文问答的检索与抽取 —— 走 LightRAG 那条线（§9 指针）。
- 中英映射的构建 —— 离线数据资产，英文 OAG 不依赖它（§4.4）。

> 将来中文侧若出现"任意起点、跳数不定的**路径查询**"，可复用英文侧已装的 AGE 的 Cypher（边际成本近零）。现在不决定。

---

## 九、相关计划指针

| 主题                                                                       | 文档                                                        |
| -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **AGE 引入步骤**（镜像、独立 database、权限、compose、EnvKey、P0–P5 验收） | `plans/2026-09-27-apache-age-introduction-plan.md`          |
| 中文侧 LightRAG（散文检索层）                                              | `plans/2026-09-16-lightrag-introduction-plan.md`            |
| 药品风险图（Phase 1 边表 = 英文侧 OAG 的源层）                             | `plans/2026-08-28-medicine-risk-graph-plan.md`              |
| 决策原始调研（论文 / 替代方案对照 / 全部来源链接）                         | `Lumos-docs/2026-09-15-lightrag-vs-oag-selection-review.md` |

**决策要点（七条，从原始调研收敛）**：

1. **按语言分工，不做二选一。** 中文走 LightRAG，英文走 Semantica。信任分层的切分轴仍是**来源**，不是语言。
2. **不引入 `lightrag-langchain`。** 第三方、AGE 依赖、与官方推荐后端不兼容。
3. **Semantica 采纳但限定英文侧，并 fork 自持。** **跟随上游 `main` 最新（不钉 SHA）** + vendor wheel 树 + **AGE 1.7.0** + §7 的 12 项改动；**中文侧不引**。
4. **英文侧不建 LightRAG 图。** DrugBank 的关系已经是结构化的边。
5. **动作层留在 Lucent。** 执行与审批继续走 proposal + confirm，并补上 confirm 路径缺失的审计。
6. **中英映射不进结论层。** 作为离线数据资产；将来接图必须带 `confidence` / `review_status`。
7. **先建英文侧评测集。** S4 之后的所有"是否继续"由它裁决（§8.1 S0）。

---

## 十、关键来源

**Semantica**

- 仓库：https://github.com/semantica-agi/semantica
- 文档：https://docs.getsemantica.ai/ （JS 壳；**markdown 真源在仓库 `docs/`**，引用走 `github.com/semantica-agi/semantica/blob/main/...`）
- PyPI（extras / 依赖全清单）：https://pypi.org/project/semantica/ —— 注意 **PyPI 最新仍是 0.6.8，落后 `main`（0.7.0）127 个提交**；跟 `main` 时不要装 PyPI 版
- 存储后端清单：https://github.com/semantica-agi/semantica/blob/main/docs/storage-backends.md
- 嵌入 provider（无 `base_url`）：https://github.com/semantica-agi/semantica/blob/main/semantica/embeddings/provider_stores.py
- 中文实体消解 blocking key：https://github.com/semantica-agi/semantica/blob/main/semantica/deduplication/similarity_calculator.py
- 决策检索（CJK 回落缺失）：https://github.com/semantica-agi/semantica/blob/main/semantica/context/decision_query.py
- 语言标签被丢弃：https://github.com/semantica-agi/semantica/blob/main/semantica/explorer/utils/rdf_parser.py
- SHACL 生成（`xsd:xsd:` 前缀 bug）：https://github.com/semantica-agi/semantica/blob/main/semantica/ontology/ontology_generator.py
- 贡献者分布：https://api.github.com/repos/semantica-agi/semantica/contributors?per_page=100

**Apache AGE**

- 仓库：https://github.com/apache/age
- PG18 1.7.0 release：https://github.com/apache/age/releases/tag/PG18/v1.7.0-rc0
- 1.8.0 崩溃 issue：https://github.com/apache/age/issues/2500

**OAG / 本体参照**

- Palantir OAG 文档页：https://www.palantir.com/docs/foundry/ontology/ontology-augmented-generation/
- OG-RAG 论文：https://aclanthology.org/2025.emnlp-main.1674/ ｜代码：https://github.com/microsoft/ograg2
- `pyshacl`（Apache-2.0，纯 Python）：https://github.com/RDFLib/pySHACL
- `pyoxigraph`（MIT OR Apache-2.0，嵌入式 SPARQL 存储）：https://pypi.org/project/pyoxigraph/

**替代方案对照**（完整表见原始调研 §11）

- Microsoft GraphRAG（**已进入维护模式**）：https://github.com/microsoft/graphrag
- trustgraph-ai/trustgraph（本轮核实出的最强真对手，动作 + 审计更成熟，弱在 SHACL/OWL profile 深度与时态）：https://github.com/trustgraph-ai/trustgraph
- openshuyi/ontograph-core（唯一三条腿都建模的 TS 项目，但无后端、无法承担生产）：https://github.com/openshuyi/ontograph-core
- Palantir 官方**没有**开源 Ontology 产品（`palantir` org 下全是 SDK / tooling）。
