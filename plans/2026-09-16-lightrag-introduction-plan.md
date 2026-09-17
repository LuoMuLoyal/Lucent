# LightRAG 中文散文检索层引入计划

Created: 2026-09-16
Revised: 2026-09-17（按库内实测修正前提 + 按数据本质收敛范围：LightRAG 只为**中文散文**提供语义检索；中文产品表走 SQL、英文 DrugBank 关系数据走 AGE + OAG，均不在本计划范围；V3 全量导入落地后更新实测数据）
状态：待评审（未开工）
定位：把**中文药品知识检索中的"散文部分"**（说明书字段级语义检索 + 医学问答）整体交给 LightRAG —— **导入与查询都归它**。**中文产品表检索不迁移**（保持 SQL 键查）；**英文侧不在本计划范围**（其关系数据走 AGE + OAG，见 `2026-09-27-apache-age-introduction-plan.md`）。

---

## 〇、前提修正（2026-09-17 库内实测）

上一版计划 §2.2 写"保留 `drugbank_passage_embeddings` / `search_drugbank_passages` / `VectorStoreFactory` / `AI_EMBEDDING_*`"，隐含"英文侧已有向量检索"的前提。

**实测结论（dev 库 `lucent-postgres-dev` / 2026-09-17 当日分两次核实）：**

| 对象                                                                                  | 实测结果                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `leaflet_embeddings` / `medical_qa_embeddings` / `drugbank_passage_embeddings`        | **全部不存在**（information_schema 无这三张表，`vector` 扩展未安装）                                                                                                                                                            |
| `medicine_leaflet_chunks` / `medical_qa_chunks` / `drugbank_passage_chunks`           | **全部 0 行**                                                                                                                                                                                                                   |
| `cn_medicine_products` / `cn_medicine_leaflets` / `cn_medicine_product_leaflet_links` | **已全量导入**（2026-09-17 同日落地 V3 迁移 `20260917120000` + `cn-v3-*` 导入：leaflets 21,142 / products 63,889 / links 63,889，0 rejected）                                                                                   |
| `drugbank_drugs`                                                                      | 19,842 行（已全量）                                                                                                                                                                                                             |
| DrugBank 关系数据                                                                     | `drug_interactions` JSONB 展开 **2,474,851 条交互边**；`drug_drug_targets` **61,079 条**（target 25,138 / enzyme 5,505 / transporter 2,759 / carrier 884 / all 26,793）；`drugbank_targets` 5,096；`drugbank_structures` 14,622 |
| DrugBank 叙事字段                                                                     | description 11,964 / indication 4,058 / mechanism_of_action 3,836 / pharmacodynamics 2,849 / toxicity 2,264                                                                                                                     |

**修正后的前提**：

1. **三个来源都没有任何向量嵌入**——不存在"已经付过一次嵌入费"这回事，QA 进 LightRAG 是首次嵌入，英文 DrugBank 叙事字段将来建向量也是首次。
2. **"英文侧不动"的旧表述是错的**：英文侧不是"已有向量、只需保留"，而是"也从未建设"。英文侧怎么建，由数据本质决定（关系数据 → 图/本体，叙事字段 → 向量），与本计划正交，见 §三.4。

---

## 一、决定与边界

| #   | 决定                            | 内容                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **LightRAG 是中文散文检索核心** | 中文说明书字段级语义检索 + 医学问答的**导入 + 查询**都走 LightRAG；Lucent 不再自己维护中文向量索引                                                                                                                                                                                              |
| 2   | **中文产品表不迁移**            | `search_cn_medicine_products` / `get_cn_medicine_detail` 保持 SQL 键查（产品表是键值型结构化数据，点查即可，不需要语义检索）                                                                                                                                                                    |
| 3   | **模式由模型选，默认 `naive`**  | `naive` / `local` / `global` / `hybrid` / `mix`，**默认 `naive`**；`bypass` 进黑名单。说明书**建图仅作为 P2 评测项**，评测证明有收益才启用 `local/global/mix` 并改默认（§六 P2）                                                                                                                |
| 4   | **来源由模型选**                | `source` 是工具的一个参数，模型可自由决定查说明书还是查问答                                                                                                                                                                                                                                     |
| 5   | **删旧散文检索工具**            | `search_medicine_leaflets`、`search_medical_qa_corpus` 及其 service / spec 删除；**`search_cn_medicine_products` / `get_cn_medicine_detail` 保留**                                                                                                                                              |
| 6   | **删旧向量表与脚本阶段**        | dev 实测三张 embedding 表**均不存在**，无需 DROP；删除 `rebuild-leaflet-index.ts`、`import-medical-qa.ts` 的 `--embed` 阶段等**会创建**这些不存在的表的脚本阶段                                                                                                                                 |
| 7   | **不做降级**                    | LightRAG 不可用 = 中文散文检索不可用。用 `capabilities.disabledReason` 显式暴露，不静默降级为"没有证据"                                                                                                                                                                                         |
| 8   | **不保留 `resolvedProduct`**    | 返回 chunks + `leafletId` + `sourceField` 即可；产品身份交给结构化工具（SQL，保留）                                                                                                                                                                                                             |
| 9   | **不新增 ADR**                  | 决策记在本计划 + 模块 README + 迁移日志                                                                                                                                                                                                                                                         |
| 10  | **英文侧单独规划**              | 英文 DrugBank 关系数据（交互/靶点/ATC/序列）→ **AGE + OAG**（`2026-09-27-apache-age-introduction-plan.md`）；叙事字段（mechanism/toxicity/pharmacodynamics…）→ 单独评估建向量检索，**不引入 LightRAG**。`drugbank_passage_embeddings` / `search_drugbank_passages` 现状为"从未建设"，不承诺保留 |

**不在范围内**：英文侧 OAG（Semantica + AGE）；英文叙事字段的向量检索；中文产品表的结构化键查（保持原状）。

---

## 二、现状（2026-09-17 核实）

### 2.1 引用面

| 对象                          | 现引用位置                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `leaflet_embeddings`          | `src/modules/assistant/tools/leaflet/read.service.ts`、`scripts/import/medicine/rebuild-leaflet-index.ts`（**表不存在，代码引用的是空目标**）                 |
| `medical_qa_embeddings`       | `src/modules/assistant/tools/knowledge/medical.service.ts`、`scripts/import/medicine/import-medical-qa.ts`（`--embed` 阶段）（**同上**）                      |
| `drugbank_passage_embeddings` | `src/modules/assistant/tools/drugbank/search.service.ts`、`scripts/import/medicine/rebuild-drugbank-rag-index.ts`（**同上；英文侧不动，本计划不删这段引用**） |
| 测试中的表名断言              | `tools/tool.service.spec.ts`、`services/core.service.spec.ts`（含 `tables: ['medical_qa_embeddings']`）—— 删除工具时同步改                                    |

### 2.2 本地 dev 库实测（`lucent-postgres-dev`）

- **三张向量表 `leaflet_embeddings` / `medical_qa_embeddings` / `drugbank_passage_embeddings` 全部不存在**，`vector` 扩展未安装；
- `medicine_leaflet_chunks` / `medical_qa_chunks` / `drugbank_passage_chunks` **均为 0 行**；
- `cn_medicine_products` / `cn_medicine_leaflets` / `cn_medicine_product_leaflet_links` **已全量导入**（同日 V3 落地：products 63,889 / leaflets 21,142 / 1:1 链接 63,889 条，源为 `DrugDataBase/DrugEntityDedup/` 去重 Parquet）。

→ **结论**：**不存在"已经付过一次嵌入费"这回事**，QA 与说明书进 LightRAG 是**首次**嵌入。生产库需在开工前单独核对一次（同样的表存在性 + 行数查询）。

### 2.3 数据本质核实（决定"每类数据用哪个"的事实依据）

| 数据子集                                         | 形态                                                            | 检索需求                  | 方案                                 |
| ------------------------------------------------ | --------------------------------------------------------------- | ------------------------- | ------------------------------------ |
| `cn_medicine_products`（V3 63,889）              | **键值型**：药名/批准文号/企业/品类/条码                        | 点查一个产品              | **SQL**（现有键查，保留）            |
| `cn_medicine_leaflets`（V3 21,142）              | **字段规整的散文**：适应症/用法/不良反应/禁忌/相互作用/药理毒理 | 语义提问命中字段          | **LightRAG（默认 naive）**，建图可选 |
| `medical_qa`（136 万）                           | 开放散文、低可信、带 safetyLabel                                | 语义召回                  | **LightRAG（只 naive）**，不建图     |
| DrugBank 关系数据（drugs/targets/interactions…） | **多跳关系网络**：247 万交互边 + 6.1 万靶点边 + ATC + 序列      | 路径/多跳查询、可审计结论 | **AGE + OAG**（另计划）              |
| DrugBank 叙事字段（mechanism/toxicity…）         | 散文                                                            | 语义召回（英文）          | 单独建向量（另行评估）               |

### 2.4 LightRAG 存储形态（与本计划直接相关）

LightRAG 自带四种存储，**向量是其中一等公民**：`PGKVStorage` / **`PGVectorStorage`** / `PGTableGraphStorage` / `PGDocStatusStorage`。因此它替代的是**整条中文散文向量检索链**（嵌入 + 检索），不是"在现有向量上再叠一层图"。

- `storage implementation cannot be changed after documents are added` → 四件套**一次选定**，用 `PGTableGraphStorage`（纯 SQL 表，不需要 AGE，不需要新数据库服务）。
- `naive` 模式就是纯 chunk 向量检索（不碰图）—— 即现有行为的等价物；图能力是增量，**且只在本计划 P2 评测证明有收益后才默认启用**。

---

## 三、目标形态

### 3.1 部署（sidecar，三环境同一形态）

| 环境    | 落点                                                                             | 端口             |
| ------- | -------------------------------------------------------------------------------- | ---------------- |
| prod    | `compose.yaml` 新增 `lightrag` 服务（同 app 网络，`expose: 9621`，不发布宿主机） | 内网             |
| staging | 同机 `docker compose` 起 sidecar（与 PM2 无关，PM2 只管 Node 进程）              | `127.0.0.1:9621` |
| dev     | `compose.dev.yaml` 加一份，放在 **profile** 里（默认不启动，不拖慢本地）         | `127.0.0.1:9621` |

- `POSTGRES_*` 指向**现有 Postgres 的独立 database**（如 `lightrag`），不污染 Prisma 迁移域。
- 不做公网暴露、不挂 Traefik；只由 Lucent 内网调用。

### 3.2 workspace 设计（按来源划分）

| workspace | 语料                              | 建图                                | 可用模式                                                                 |
| --------- | --------------------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| `leaflet` | 中文说明书（V3 去重后 21,142 份） | **默认不建图**；P2 评测有收益才启用 | 默认 `naive`；评测通过后 `naive` / `local` / `global` / `hybrid` / `mix` |
| `qa`      | 医学问答（136 万条）              | **跳过图构建**                      | **只有 `naive`**                                                         |

说明书画图与否由 P2 评测数据决定（§六 P2），与问答不建图的理由不同：

- **问答不建图**：全量抽取的墙钟时间在数千小时量级（既有结论），且它不是产品的主力问答来源。
- **说明书默认不建图**：说明书是字段规整的散文，语义提问直接命中对应字段即可，图抽取（LLM 实体关系抽取）的成本与收益需要通过评测验证，不为"建图"而建图。

### 3.3 数据流

```
导入：chunk 表（事实源）
  medicine_leaflet_chunks ──┐
  medical_qa_chunks ────────┴─→ /documents/texts（稳定 doc id）→ LightRAG(leaflet/qa)
                                                                    │
查询：Agent ── search_cn_medicine_knowledge(query, source, mode, limit) ──┘
                 ↓  /query（only_need_context=true + include_chunk_content=true）
              envelope（chunks + leafletId + sourceField + coverage/confidence）

产品身份：search_cn_medicine_products / get_cn_medicine_detail（SQL，保留，不迁移）
```

### 3.4 与英文侧的关系（边界）

- 英文 DrugBank 关系数据 → **AGE + OAG**：见 `2026-09-27-apache-age-introduction-plan.md`，本计划不引入、不冲突。
- 英文 DrugBank 叙事字段 → 建向量检索（pgvector 或独立方案）**另行评估**，不引入 LightRAG。
- **中文侧不引入 Semantica / AGE**（无多跳关系网络可走，硬上成本大于收益）。

---

## 四、配置

### 4.1 Lucent 侧（新增 EnvKey + zod 校验）

| Key                          | 默认                   | 说明                                          |
| ---------------------------- | ---------------------- | --------------------------------------------- |
| `LIGHTRAG_ENABLED`           | `false`                | 关闭时工具返回"未配置"信封，不抛错            |
| `LIGHTRAG_BASE_URL`          | `http://lightrag:9621` |                                               |
| `LIGHTRAG_API_KEY`           | —                      | 启用时必填                                    |
| `LIGHTRAG_TIMEOUT_MS`        | `8000`                 | 工具级 20s（`TOOL_EXECUTION_TIMEOUT_MS`）兜底 |
| `LIGHTRAG_WORKSPACE_LEAFLET` | `leaflet`              |                                               |
| `LIGHTRAG_WORKSPACE_QA`      | `qa`                   |                                               |

落点：`src/config/env/env-keys.enum.ts`、`src/config/env/environment.validation.ts`、`docs/reference/environment-variables.md`、`.env.production.example`、`compose*.yaml`。LightRAG 侧自己的变量见 §4.2（独立文件 `deploy/lightrag/.env(.example)`，**不进入 Lucent 的 `.env.production.example`**）。

### 4.2 sidecar 侧：**独立 env 文件**（变量名与凭据独立，文件也不共用）

LightRAG 用**它自己的变量名与自己的凭据**，与 Lucent 的 `AI_*` 完全独立 —— 即使指向同一家厂商，也是**两套配置、两个 key、各自轮换、各自限流**。

**存储**

| 变量                          | 值                             |
| ----------------------------- | ------------------------------ |
| `LIGHTRAG_KV_STORAGE`         | `PGKVStorage`                  |
| `LIGHTRAG_VECTOR_STORAGE`     | `PGVectorStorage`              |
| `LIGHTRAG_GRAPH_STORAGE`      | `PGTableGraphStorage`          |
| `LIGHTRAG_DOC_STATUS_STORAGE` | `PGDocStatusStorage`           |
| `POSTGRES_*`                  | 独立 database（如 `lightrag`） |

**模型（按角色分离，LightRAG 原生变量，全部只存在于 sidecar 独立 env 文件）**

| 变量                                                                                                               | 用途                                                                |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `LLM_BINDING` / `LLM_BINDING_HOST` / `LLM_BINDING_API_KEY` / `LLM_MODEL`                                           | 兜底：未单独设置的角色继承它                                        |
| `EXTRACT_LLM_*`                                                                                                    | 实体关系抽取 + 合并摘要（**便宜、非 thinking 模型**；仅建图时使用） |
| `KEYWORD_LLM_*`                                                                                                    | 查询关键词抽取（便宜模型）                                          |
| `QUERY_LLM_*`                                                                                                      | 检索问答（强模型）                                                  |
| `EMBEDDING_BINDING` / `EMBEDDING_BINDING_HOST` / `EMBEDDING_BINDING_API_KEY` / `EMBEDDING_MODEL` / `EMBEDDING_DIM` | 自带嵌入配置                                                        |
| `RERANK_BINDING` / `RERANK_BINDING_HOST` / `RERANK_BINDING_API_KEY`                                                | `aliyun` + `gte-rerank-v2`                                          |

**唯一共享的值**：`LIGHTRAG_API_KEY` —— sidecar 的调用密钥，与 Lucent 侧 §4.1 的同名项必须一致（这是鉴权握手，不是模型配置复用）。

**为什么变量名独立更好（不只是洁癖）**：LightRAG 的嵌入索引与 Lucent 未来可能建的英文 pgvector（DrugBank 叙事字段）是**两套相互独立的索引** —— 改其中一套不必重建另一套。若共用同一份模型配置，任何一次嵌入模型或维度调整都会同时触发两边全量重建。

**为什么还要单独一份文件（选定方案）**：LightRAG 的 env 必须是**独立文件，不共用 Lucent 的 `.env`**。这是模型配置独立性（上面那条）与凭据暴露面（下面这条）**两个问题叠在一起**，其中**暴露面只能靠独立文件解决**：

1. **凭据暴露面**：共用一份 `.env` 意味着那个 Python 容器能读到 Lucent 的 `JWT_*` / `DATABASE_URL` / 微信密钥。sidecar 是独立进程、独立 image、独立升级周期，多一个进程多一份被读的风险；`POSTGRES_*` 撞名靠显式覆盖能解决，但**暴露面靠覆盖解决不了**——只能不把秘密放进它读得到的地方。
2. **变量名独立性**：LightRAG 用**它自己的变量名与自己的凭据**（`LLM_BINDING*` / `EXTRACT_LLM_*` / `KEYWORD_LLM_*` / `QUERY_LLM_*` / `EMBEDDING_*` / `RERANK_*` / `POSTGRES_*`），与 Lucent 的 `AI_*` 完全独立 —— 即使指向同一家厂商，也是两套配置、两个 key、各自轮换、各自限流。
3. **运维心智**：compose 的 `env_file` 按服务注入，文件独立后"LightRAG 的配置在哪、改了什么"一目了然，排查问题不碰 Lucent 主 `.env`；prod 就是在部署平台给 `lightrag` 服务单独挂一份只含自身项的 env。

**文件布局（推荐）**：

```
Lucent/
  .env                    # Lucent 主配置（不含任何 LIGHTRAG_* / LLM_BINDING* / POSTGRES_* for lightrag）
  deploy/lightrag/
    .env.example          # sidecar 独立 env 模板（只含 LightRAG 自身项），提交仓库
    .env                  # sidecar 实际 env（gitignore，prod 由部署平台注入同内容）
```

- `deploy/lightrag/.env.example` 提交仓库，作为 LightRAG 全部变量的唯一清单；
- compose 中 `lightrag` 服务用 `env_file: deploy/lightrag/.env`；
- **`LIGHTRAG_API_KEY` 同时存在于两处**：Lucent 侧 `LIGHTRAG_API_KEY`（调用密钥，§4.1）与 sidecar 文件里的同名项，值必须一致——这是鉴权握手，不是模型配置复用。

**结论**：环境变量**单独一份文件**（选定，不是"在意才选"）。代价是每次给 LightRAG 加变量要动两个文件（模板 + 实际 env），换来的是凭据不扩散 + 配置可独立轮换/限流 + 排查心智清晰。文档在 `docs/reference/environment-variables.md` 里**单开一节**记录 LightRAG 的变量名，不混进 Lucent 的 `AI_*` 表。

---

## 五、工具契约

### 5.1 命名（推荐值，可一行改）

**`search_cn_medicine_knowledge`** —— 与现有 `search_cn_medicine_products` / `get_cn_medicine_detail` 同族；标注中文；不写死 `leaflet` / `qa`（它跨两者）。

英文侧的工具另起一名（如 `query_drug_ontology`），从动词上区分"检索文本"与"查询本体"。英文叙事字段若建向量检索，工具名另定（如 `search_drugbank_science`）。

### 5.2 参数

| 参数     | 必填 | 约束                                                                                                                             |
| -------- | ---- | -------------------------------------------------------------------------------------------------------------------------------- |
| `query`  | 是   | 检索语句                                                                                                                         |
| `source` | 是   | `leaflet` / `qa` —— **模型自由选择**，服务端映射到 workspace                                                                     |
| `mode`   | 否   | 默认 `naive`；可选 `naive` / `local` / `global` / `hybrid` / `mix`（**仅当 P2 评测通过后对 `leaflet` 开放**）；**`bypass` 拒绝** |
| `limit`  | 否   | 默认 4、上限 8                                                                                                                   |

参数走 `AssistantToolCall.toolArgs`（**不从 `userMessage` 文本猜**——旧工具那条路径随之淘汰）。

### 5.3 服务端校验与强制

1. `source` → workspace 映射在服务端；模型不能直接指定 workspace 名；
2. **`qa` workspace 只接受 `naive`**：它没建图，`local/global/mix` 拿不到实体，选了下场是空结果，不如直接拒（附 reason）；
3. **`leaflet` 在 P2 评测通过前也只接受 `naive`**：没建图时 `local/global/mix` 同样空结果；
4. `bypass` 一律拒绝；
5. `/query` 固定带 `only_need_context=true` + `include_chunk_content=true` —— **绝不 generate**（否则双重生成、绕开安全层）；
6. `verifiability` 由服务端按 `source` 写入（说明书 / `open_corpus`），不接受模型传；
7. 超时 / 不可达 → `coverage: { status: 'empty', reason: '检索服务不可用' }`，与"确实没有证据"区分。

### 5.4 envelope 映射

- 形状沿用 `buildReadEnvelope` / `buildReadConfidence`；
- `chunks[]`：`text` / `rank` / `score` + **`leafletId`** / **`sourceField`**（来自灌入时写入的 metadata，用于溯源）；
- `tables`：登记 LightRAG 的存储表名（`lightrag_*`）；
- **不再有** `resolvedProduct` 字段（决定 8）；
- 无法映射回 `leafletId` 的结果标 `coverage: partial`。

### 5.5 lightRAG 不可用时的可见性

- 复用现有 `ASSISTANT_TOOL_DISABLED_REASONS`，新增 **`retrieval_unavailable`**：`GET capabilities` 能告诉客户端"检索暂不可用"；
- 该变更会改 capabilities 的响应 schema → 见第八节跨仓动作。

---

## 六、删除清单

| 类别     | 对象                                                                                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工具实现 | `src/modules/assistant/tools/leaflet/read.service.ts` + `read.service.spec.ts`（目录清空后删除）                                                                                                                        |
| 工具实现 | `src/modules/assistant/tools/knowledge/medical.service.ts` + `medical.service.spec.ts`（目录清空后删除）                                                                                                                |
| 索引脚本 | `scripts/import/medicine/rebuild-leaflet-index.ts` 的 **`--embed` 阶段**（**rebuild 阶段保留**，它负责写入 `medicine_leaflet_chunks`——§7 灌数据的输入；只删会创建 `leaflet_embeddings` 的 `createEmbeddingStore` 调用） |
| 索引脚本 | `scripts/import/medicine/import-medical-qa.ts` 的 **`--embed` 阶段**（`--filter` 阶段保留，它负责写入 `medical_qa_chunks`）                                                                                             |
| 向量表   | 三张 embedding 表 dev 实测**均不存在**，无需 DROP；仅删除上述脚本中 `createEmbeddingStore`（会建表）的调用                                                                                                              |
| 常量     | `MEDICAL_QA_MAX_LIMIT`；`ASSISTANT_VECTOR_*` 是否保留取决于 DrugBank passage 工具是否仍引用（实施时确认）                                                                                                               |
| 注册点   | `tools/shared/tool-types.ts` 三处列表 + `ASSISTANT_TOOL_SOURCE_MAP`；`tools/shared/tool-definitions.ts`；`agent/runtime/subgraphs/knowledge.ts` 的 `KNOWLEDGE_TOOL_ORDER`；`tools/tool.service.ts` dispatch             |
| 测试     | `tools/tool.service.spec.ts`、`services/core.service.spec.ts` 中涉及两个工具/两张表的用例                                                                                                                               |

**保留不删**：`search_cn_medicine_products` / `get_cn_medicine_detail`（中文产品表键查）；`search_drugbank_passages` 及其英文向量路径（英文侧另行规划，不删）。

**顺序（不可反）**：灌 LightRAG → 评测通过 → 才删除旧散文检索工具。旧向量表不存在，无 DROP 步骤。

---

## 七、灌数据

- **输入 = 现有 chunk 表**（`medicine_leaflet_chunks` / `medical_qa_chunks`），经 `/documents/texts` 批量灌入 —— 复用既有切分结果，避免 chunk 边界漂移导致实体抽取不一致；
- **稳定 doc id**：`body_hash` + `chunkIndex`（沿用 `scripts/shared/stable-id.ts` 的模式）；metadata 带 `leafletId` / `sourceField`，供查询侧溯源；
- **幂等**：重灌前按 doc id 删除；
- **脚本**：新增 `scripts/import/medicine/rebuild-lightrag-index.ts`（结构照既有 `rebuild-*-index.ts`），挂 `pnpm` 命令；支持 `--workspace=leaflet|qa`、`--limit`；
- **失败处理**：`docStatus` 表 + `/documents/reprocess_failed` 进运维手册；
- **成本**：默认只嵌入不抽取（`leaflet` 默认 naive、`qa` 只 naive）；抽取额外成本仅在 P2 评测需要建图时才产生。

---

## 八、落地顺序与验收

| 阶段   | 工作量 | 内容                                                                                                                                                 | 验收                                                                                   |
| ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **P0** | 0.5 天 | 评测集：20–50 条分层中文问题（说明书 / 问答）+ 期望证据 id                                                                                           | 数据集就位                                                                             |
| **P1** | 2–3 天 | dev 起 sidecar（profile）+ 配置 + `retrieval` client + 工具注册 + 单测（成功/超时/4xx/5xx/未配置/qa 选 mix 被拒/leaflet 未评测前选 mix 被拒/空结果） | dev 能返回带 `leafletId` 的 chunks                                                     |
| **P2** | 1–2 天 | 灌 `leaflet` workspace 并评测 **`naive` 基线**；随后对子集做图抽取，评测 `naive` vs `mix` vs `local/global`                                          | **有对比数据**；**若图模式不显著优于 `naive`，默认保持 `naive`、建图设为 off**（§3.2） |
| **P3** | 1–2 天 | 删除旧散文检索工具与脚本阶段 + capabilities 新 disabledReason + prod/staging 编排 + 文档                                                             | e2e：LightRAG 停止时工具返回"检索服务不可用"、主链不受影响                             |
| **P4** | 1–2 天 | 灌 `qa` workspace（只 naive）+ 评测                                                                                                                  | 问答检索切到 LightRAG                                                                  |
| **P5** | 0.5 天 | 核对生产库（§2.2 同款查询）确认无遗留向量表 + 迁移日志                                                                                               | 无代码引用旧散文检索                                                                   |

**跨仓动作（P3 必做）**：工具数 23 → 21 且 capabilities 新增 disabledReason → `pnpm export:openapi` + Luminous `dart run scripts/contract/bootstrap.dart`。

**文档动作**：`src/modules/assistant/README.md`（Tools / Dependencies 段）、`docs/reference/environment-variables.md`、`docs/reference/deployment.md`（新 sidecar 品类）、当日 migration log。**不建 ADR。**

**门禁**：`pnpm lint:check` / `pnpm typecheck` / `pnpm test` / `pnpm arch:check` / `pnpm docs:verify` / `pnpm docs:links`。

---

## 九、风险与运维

| 风险                         | 事实                                                                                                      | 应对                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **检索层单点**               | 不做降级：LightRAG 挂 = 中文散文检索不可用                                                                | `capabilities.disabledReason = retrieval_unavailable` + 失败率告警（VictoriaMetrics/Grafana）；文案与"没有证据"区分 |
| **存储不可更换**             | 加入文档后不能改 storage implementation                                                                   | 一次选定 PG 四件套（`PGTableGraphStorage`，无 AGE、无新服务）                                                       |
| **Embedding 变更需全量重建** | 官方无 re-embed 工具                                                                                      | 锁定嵌入模型与维度，写进模块 README。**独立配置的收益**：只重建 LightRAG 侧，英文侧（若将来建）不受影响（§4.2）     |
| **升级需全停**               | v1.5.7 改并发协议且无版本标记，漏一个旧 writer 即损坏数据                                                 | 升级流程：排空 pipeline → 停所有 writer → 启新版本                                                                  |
| **删除留孤儿节点**           | 官方 `kg_integrity_repair.py`；开放 issue #3835（`entity_chunks` / `relation_chunks` 残留）               | 定期审计；pin 一个 #3835 已修复版本；删除走 `/documents/delete_document`                                            |
| **PG 容量与连接数**          | KV/Vector/Graph/DocStatus 四套表落在同一 PG；`MAX_PARALLEL_INSERT=2`                                      | 开工前评估磁盘与连接池上限；`postgres` 服务保留慢查询日志                                                           |
| **建图成本不可控**           | 说明书建图需 LLM 抽取，成本与时间随语料线性涨                                                             | **默认不建图**（§3.2/§8 P2）；建图只在评测证明收益后、且按子集分批进行                                              |
| **混合检索旧计划冲突**       | 既有 `plans/2026-09-06-rag-hybrid-search-upgrade.md` 的目标（pg_jieba 中文全文/混合检索）与 LightRAG 重叠 | 本计划落地后，评估该计划作废或缩到英文侧                                                                            |

---

## 十、待确认（两项，均不影响 P0/P1 开工）

1. **工具名**：默认采用 `search_cn_medicine_knowledge`（§5.1），如需改名在 P1 前定即可。
2. **说明书是否建图**：本计划默认**不建图**（`leaflet` 默认 `naive`），由 P2 评测数据决定。若评测证明 `mix/local/global` 显著优于 `naive` 再改默认并开放模式。
