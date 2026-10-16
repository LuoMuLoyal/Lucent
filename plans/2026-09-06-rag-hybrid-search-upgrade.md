# 三源 RAG 混合检索升级计划(Hybrid Search 优先)

Created: 2026-09-06
Revised: 2026-10-16（按 2026-09-18 LightRAG 落地后的现状收窄范围：中文说明书与医疗 QA 两路已随旧散文检索工具删除而迁往 LightRAG sidecar，本计划只剩 DrugBank 英文通道一条；见下方 §0）

## 〇、范围收窄说明（2026-10-16）

原计划要改造的三个工具里，两个已不存在：

| 原工具                                                                                                                                           | 现状                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_medicine_leaflets`（中文说明书）                                                                                                         | **已删除**。中文散文检索整体交给 LightRAG sidecar，工具名改为 `search_cn_medicine_knowledge`（见 `src/modules/assistant/tools/retrieval/knowledge.service.ts`）。 |
| `search_medical_qa_corpus`（医疗 QA）                                                                                                            | **已删除**。`qa` workspace 由 LightRAG 承载，P4 灌库尚未执行（见 `docs/TODO.md`「2026-09-18 LightRAG 中文散文检索」）。                                           |
| `search_drugbank_passages`（DrugBank 英文段落） **仍在**，走 Lucent 自有 pgvector 表（`drugbank_passage_embeddings`，768 维，48,475 行已灌入）。 |

因此本计划的实际剩余范围只有 §2.2 的英文侧 FTS（DrugBank 通道）与 §3.2 的 `HybridRetrievalService` 骨架。中文侧是否需要 FTS 已不是本计划的问题——它由 LightRAG 侧自行决定，与本计划的 pg_jieba 路线无关。

**未决（开工前先裁决）**：是否还值得为单条英文通道引入 pg_jieba/应用层分词 + RRF。§3.3 原文已论证「英文侧主升力在向量」，且英文语料是叙事字段（mechanism/indication/toxicity…）而非专名密集字段，专名查询（CAS 号、批准文号、ATC 码）的缺口可用 §3.1 的 `search_cn_medicine_products` 键查与 DrugBank 实体解析补。若裁决为不做，本计划整体删除。

## 一、背景与动机

### 1.1 现状(代码事实)

Lucent 的「普通 RAG」当前只剩一个工具：

| 工具                                            | chunk 表                  | embedding 表                  | 检索形态                                       |
| ----------------------------------------------- | ------------------------- | ----------------------------- | ---------------------------------------------- |
| `search_drugbank_passages`（DrugBank 科学段落） | `drugbank_passage_chunks` | `drugbank_passage_embeddings` | entity-scoped（先解析 drugbankId），再向量检索 |

中文散文检索（原说明书 + QA 两源）已迁至 LightRAG sidecar，见 §0。DrugBank 通道与 LightRAG 互不合并（`docs/archive/01-reference/contracts/data-sources.md` 合同明文），`verifiability` 标注在服务端 chunk 映射处生成，不落库。该通道当前是纯向量余弦检索，没有 FTS/BM25。

### 1.2 痛点

- **纯向量检索的召回盲区**：精确关键词（CAS 号、ATC 码、成分名）在语义空间里不一定命中。
- **DrugBank 作用域解析是前置门槛**：`drugbankId` 解析失败时整条通道直接空结果——2026-10-07 事故的两个独立根因之一（整句当 LIKE 模式、`contains + take:5` 把原药与酯/盐一起带回来），已由 F1 修复；混合检索是另一条可能的补强路径。
- **没有混合排序**：即使命中关键词，也无法与语义分数融合，召回即上限。

### 1.3 目标

在不引入新运行时、不破坏三源分离与 F-15 合规分层的前提下,把 DrugBank 通道从「纯向量」升级为「**向量 + 关键词(Hybrid Search)**」,用 **RRF(Reciprocal Rank Fusion)** 融合排序,改善精确术语与专名查询的召回质量。

**边界声明(本计划不做)**:

- **不顶替 LightRAG / GraphRAG**:LightRAG 已按 `2026-09-16-lightrag-introduction-plan.md` 落地(中文散文检索),本计划不碰它;本计划只管英文 DrugBank 通道的召回质量。
- **不改产品监管定位**:`plans/product-regulatory-positioning.md` A 路径的三源分离、`verifiability` 分层、`MEDICAL_QA_MAX_LIMIT=5`、低可信标注**全部保留**。Hybrid Search 只换召回后端,标注/决策/上限逻辑不动。
- **不删现有 embedding 表与向量检索**:向量作为混合检索的一半保留;纯向量路径作为降级/回退。

## 二、技术选型:PG18 全文检索 + RRF 融合(零新运行时)

### 2.1 为什么选 PG 原生 FTS 而不是引入 Elasticsearch / OpenSearch / Meilisearch

| 维度       | PG18 FTS(选定)                                         | 独立搜索引擎                    |
| ---------- | ------------------------------------------------------ | ------------------------------- |
| 运行时     | 零新增,复用现有 PG18(`pgvector/pgvector:pg18` 镜像)    | 新服务 + 数据同步 + 运维面      |
| 数据一致性 | 与 chunk 表同库,事务内一致                             | 双写/异步同步,漂移风险          |
| 部署       | 无                                                     | compose 新增 + 资源占用         |
| 规模适配   | DrugBank 48,475 chunk(2026-10-02 灌入实测),PG 倒排可扛 | 大规模更强,但当前量级杀鸡用牛刀 |
| 与现有架构 | 与 `VectorStoreFactory` 同源同库,改造成本低            | 跨系统调用                      |

结论:DrugBank 通道当前量级 PG18 原生 FTS 完全可承载,且与现有 PG 统一。**搜索引擎留作远期**。

### 2.2 检索配置:英文侧直接用 PG 原生 `english`

原 §2.2 的中文分词决策（pg_jieba / 应用层分词 / n-gram 三选一）**随范围收窄一并删除**——中文散文检索已迁往 LightRAG sidecar，由它自行处理分词，本计划不再需要为中文建 FTS。

DrugBank 语料是英文，PG 原生 `english` 配置零额外成本，无扩展依赖。

### 2.3 融合排序:RRF

向量 top-k 与 FTS top-k 用 **Reciprocal Rank Fusion** 合并:

```
score(d) = Σ_r 1 / (k + rank_r(d))   # k 通常取 60
```

- 对每个来源 top-N(建议 N=20)按 rank 贡献分数,再统一排序截断。
- 与 `@langchain/community` 无冲突:向量侧继续走 `PGVectorStore.similaritySearchWithScore`,FTS 侧走 `$queryRaw` 原生 `ts_rank` 或纯 rank,RRF 在 Lucent 服务层做。
- 可回退:任一侧不可用(embedding 未配置 / FTS 索引未建)时,降级为另一侧单通道。

## 三、落地设计

### 3.1 数据层:新增 FTS 物化列与索引(不删 chunk 表)

给 `drugbank_passage_chunks` 加一个 `tsvector` 生成列 + GIN 索引(用 Prisma `Unsupported("tsvector")` + 原生 SQL migration,Prisma 不直接管理 tsvector 类型):

```sql
-- drugbank_passage_chunks(48,475 行,2026-10-02 已灌入)
ALTER TABLE "drugbank_passage_chunks"
  ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "chunk_text")) STORED;
CREATE INDEX drugbank_passage_chunks_search_tsv_idx
  ON "drugbank_passage_chunks" USING GIN (search_tsv);
```

- 生成列随 chunk 行自动维护,**重建脚本无需改动**(`scripts/import/medicine/rebuild-drugbank-rag-index.ts` 写 chunk 行时生成列自动更新)。
- 保留 `search_tsv` 物化列,避免查询期每行现算。

### 3.2 服务层:HybridRetrievalService(新增,不动现有工具结构)

新增 `src/modules/assistant/tools/vector/hybrid.service.ts`,封装「向量通道 + FTS 通道 + RRF 融合」:

```
HybridRetrievalService.query({ query, table, ftsConfig, vectorFilters, topK })
  ├─ 向量通道: store.similaritySearchWithScore(query, N)
  ├─ FTS 通道:  $queryRaw`... WHERE search_tsv @@ plainto_tsquery($cfg, $q) ... ts_rank`
  └─ RRF 融合:  按 rank 合并 → 返回统一 result 列表
```

唯一调用方 `src/modules/assistant/tools/drugbank/search.service.ts` 把 `store.similaritySearchWithScore` 替换为 `HybridRetrievalService.query`:

- 保留 entity-scoped(先 `resolveSingleDrugbankId`),FTS 通道加 `drugbank_id` 过滤(与向量 metadata filter 对齐);
- `verifiability` / `sourceNote` 输出逻辑全部不变——**只换检索后端,不换输出信封**。

### 3.3 实施优先级

| 源                | FTS 配置              | 收益                                   | 优先级                 |
| ----------------- | --------------------- | -------------------------------------- | ---------------------- |
| DrugBank 科学段落 | `english`(零中文成本) | 专名/CAS/ATC/剂量术语精确命中,立竿见影 | **P0(本计划唯一目标)** |

原计划的中文说明书(P1)与医疗 QA(P2)两行随工具删除一并作废——它们的 FTS 需求已由 LightRAG sidecar 自行回答。

### 3.4 与既有架构的对齐点

- **与 `agentic-proactive-evolution.md` P0-1 对齐**:该计划已写「混合检索(关键词 + embedding,embedding 模型池已就绪)」——本计划把 P0-1 的混合检索落地为可复用服务,供后续独立搜索 API 直接调用。
- **与 LightRAG 的关系**:中文散文检索已在 LightRAG sidecar(`2026-09-16-lightrag-introduction-plan.md`,P1/P3 已落地),本计划不碰它;两者语料不重叠(DrugBank 英文 vs 中文说明书/QA)。
- **与 2026-10-07 事故修复的关系**:F1 修的是「作用域读错字段」(整句当 LIKE 模式),本计划补的是「作用域解析成功后的召回质量」,两件事正交,不互相替代。

### 3.5 验证

- 单元测试:RRF 融合正确性、FTS 查询构造、降级路径(向量/FTS 单通道)。
- 集成测试:DrugBank 工具接 Hybrid 通道后,现有 spec 回归不破;新增「专名查询」用例(如 CAS 号、ATC 码)验证 Hybrid 召回优于纯向量。
- 性能基准:P95 延迟(纯向量 vs Hybrid)、GIN 索引构建耗时(48k 行量级)。

## 四、涉及文件

### 新增

| 文件                                                        | 说明                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `prisma/migrations/<ts>_add_drugbank_search_tsv/`           | `drugbank_passage_chunks` 加 `search_tsv` 生成列 + GIN 索引的原生 SQL migration |
| `src/modules/assistant/tools/vector/hybrid.service.ts`      | RRF 融合检索服务(向量 + FTS 双通道)                                             |
| `src/modules/assistant/tools/vector/hybrid.service.spec.ts` | 单元测试                                                                        |

### 修改

| 文件                                                     | 说明                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/modules/assistant/tools/drugbank/search.service.ts` | 检索切到 HybridRetrievalService(entity-scoped 不变)                      |
| `scripts/import/medicine/rebuild-drugbank-rag-index.ts`  | 若生成列方案不生效(如与现有 upsert 冲突),改为重建脚本同步写 `search_tsv` |
| `package.json`                                           | 新增 `rag:hybrid:*` 脚本(建索引/重建 tsvector)                           |
| `docs/reference/environment-variables.md`                | 记录 FTS 配置相关 env(若有)                                              |

### 删除

- 无(纯增量,不删现有向量路径)

## 五、执行顺序

1. **P0-A**:确认 `to_tsvector('english', …)` 生成列 + GIN 在 `pgvector/pgvector:pg18` 上的构建耗时与 `rebuild-drugbank-rag-index.ts` 的 upsert 路径无冲突。
2. **P0-B**:DrugBank 通道 FTS(`english`)+ `HybridRetrievalService` 骨架 + RRF → `search_drugbank_passages` 接入,spec + 性能基准。
3. **P0-C**:更新测试 + 文档 + 迁移日志;与 `agentic-proactive-evolution.md` P0-1 的独立搜索 API 对齐(把 `HybridRetrievalService` 作为其底层)。

## 六、风险与缓解

| 风险                     | 影响                         | 缓解                                                                                   |
| ------------------------ | ---------------------------- | -------------------------------------------------------------------------------------- |
| 生成列与现有重建脚本冲突 | chunk 重建后 tsvector 未更新 | 生成列由 DB 自动维护(STORED),一般无冲突;若 upsert 路径异常,重建脚本显式写 `search_tsv` |
| RRF 参数不敏感           | 融合排序质量不佳             | k=60 为业界常用值,做参数敏感度小验证                                                   |
| Hybrid 拉高延迟          | 双通道 + 融合                | FTS 走 GIN 索引毫秒级;P95 基准约束;任一侧超时降级另一侧                                |
| 收益不及预期             | 加了复杂度却无召回增益       | 先用评测集(专名查询 vs 纯向量)量化;不达标则整体回退,纯增量改动可干净 revert            |

## 七、关联文档

- `plans/product-regulatory-positioning.md` —— A 路径合规边界(三源分离 / verifiability / QA 上限,不可回退)
- `plans/2026-09-16-lightrag-introduction-plan.md` —— 中文散文检索已迁 LightRAG(本计划只做英文 DrugBank 通道)
- `plans/2026-10-07-assistant-intent-routing-and-retrieval-fixes.md` —— F1 修作用域读错字段(与本计划的召回质量正交)
- `plans/2026-09-02-agentic-proactive-evolution.md` —— P0-1 混合检索 API(本计划为其落地底层)
- `docs/archive/01-reference/contracts/data-sources.md` / `data-sources-medical-qa.md` —— 三源检索合同
- `src/modules/assistant/tools/vector/vector-store.factory.ts` —— 现有向量工厂(共享 embedding 模型)
