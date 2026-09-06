# 三源 RAG 混合检索升级计划(Hybrid Search 优先)

Created: 2026-09-06

## 一、背景与动机

### 1.1 现状(代码事实)

Lucent 的"普通 RAG"由三个 assistant 工具组成,全部走 `VectorStoreFactory` 提供的 **PGVectorStore 纯向量余弦检索**:

| 工具                                          | chunk 表                  | embedding 表                  | 检索形态                                                    |
| --------------------------------------------- | ------------------------- | ----------------------------- | ----------------------------------------------------------- |
| `search_medicine_leaflets`(中文说明书)        | `medicine_leaflet_chunks` | `leaflet_embeddings`          | 先向量聚合做产品分辨率,再按 resolvedProductId 过滤取 chunks |
| `search_drugbank_passages`(DrugBank 科学段落) | `drugbank_passage_chunks` | `drugbank_passage_embeddings` | entity-scoped(先解析 drugbankId),再向量检索                 |
| `search_medical_qa_corpus`(医疗 QA)           | `medical_qa_chunks`       | `medical_qa_embeddings`       | 纯向量,`MEDICAL_QA_MAX_LIMIT=5` + F-15 低可信标注           |

三源互不合并(`docs/archive/01-reference/contracts/data-sources.md` 合同明文),`verifiability` 标注在服务端 chunk 映射处生成,不落库。项目内**目前无任何 LightRAG 代码**(medicine-risk-graph Phase 3 尚未开工),也没有 FTS/BM25 检索。

### 1.2 痛点

- **纯向量检索的召回盲区**:精确关键词(批准文号、CAS 号、成分名、ATC 码、剂量表述)在语义空间里不一定命中;专有名词拼写近似(如 "acetaminophen" vs "paracetamol" 是语义同义,但 "ibuprofen 200mg" vs "布洛芬 缓释胶囊" 的剂量细节靠向量不稳)。
- **说明书产品分辨率依赖向量聚合**:`resolveProductByVector` 用 chunk 分数聚合出产品,纯向量下歧义阈值(0.05)容易误聚。
- **中文检索无关键词通道**:说明书与 QA 是中文,PG 原生 `to_tsvector` 默认配置对中文按空格/标点切分,几乎退化,无法复用 PG FTS 的倒排索引能力。
- **没有混合排序**:即使命中关键词,也无法与语义分数融合,召回即上限。

### 1.3 目标

在不引入新运行时、不破坏三源分离与 F-15 合规分层的前提下,把三源检索从"纯向量"升级为"**向量 + 关键词(Hybrid Search)**",用 **RRF(Reciprocal Rank Fusion)** 融合排序,显著改善精确术语与专名查询的召回质量。

**边界声明(本计划不做)**:

- **不顶替 LightRAG / GraphRAG**:本计划是"普通 RAG 升级"的第一阶段(关键词 + 向量混合),不是引入图谱增强检索。LightRAG 仍按 `2026-08-28-medicine-risk-graph-plan.md` Phase 3 单独评估,两者定位互补(本计划管召回质量,Phase 3 管开放问答的图增强召回),不互相依赖、不阻塞。
- **不改产品监管定位**:`plans/product-regulatory-positioning.md` A 路径的三源分离、`verifiability` 分层、`MEDICAL_QA_MAX_LIMIT=5`、低可信标注**全部保留**。Hybrid Search 只换召回后端,标注/决策/上限逻辑不动。
- **不删现有 embedding 表与向量检索**:向量作为混合检索的一半保留;纯向量路径作为降级/回退。

## 二、技术选型:PG18 全文检索 + RRF 融合(零新运行时)

### 2.1 为什么选 PG 原生 FTS 而不是引入 Elasticsearch / OpenSearch / Meilisearch

| 维度       | PG18 FTS(选定)                                      | 独立搜索引擎                    |
| ---------- | --------------------------------------------------- | ------------------------------- |
| 运行时     | 零新增,复用现有 PG18(`pgvector/pgvector:pg18` 镜像) | 新服务 + 数据同步 + 运维面      |
| 数据一致性 | 与 chunk 表同库,事务内一致                          | 双写/异步同步,漂移风险          |
| 部署       | 无                                                  | compose 新增 + 资源占用         |
| 规模适配   | 千级说明书 / 千级 DrugBank / 135 万 QA,PG 倒排可扛  | 大规模更强,但当前量级杀鸡用牛刀 |
| 与现有架构 | 与 `VectorStoreFactory` 同源同库,改造成本低         | 跨系统调用                      |

结论:当前三源量级(说明书/DrugBank 千级,QA 135 万)PG18 原生 FTS 完全可承载,且与现有 PG 统一。**搜索引擎留作远期(若 QA 全量 FTS + 向量双索引导致 PG 压力上升再评估)**。

### 2.2 中文分词策略(关键技术决策)

PG 原生 FTS 对中文不友好(默认按空格/标点切分)。三源里说明书与 QA 是中文,必须解决中文分词。候选方案:

| 方案                      | 说明                                                                    | 成本                                                                               | 推荐度                                            |
| ------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------- |
| **A. pg_jieba 扩展**      | PG 侧中文分词扩展,`to_tsvector('jiebacfg', text)`,倒排直接可用          | 需编译安装到 `pgvector/pgvector:pg18` 镜像(自定义 Dockerfile);有 `pg_jieba` 社区包 | ✅ 首选(自托管可控,符合少依赖原则的"单一 PG"变体) |
| B. 应用层分词 + `tsquery` | Lucent 侧用分词器切词,拼 `to_tsquery('simple', ...)`,把切词结果塞进查询 | 无 DB 扩展,但要自管词典/切词一致性                                                 | ⚠️ 备选(避免扩展时)                               |
| C. 字符 n-gram            | 按 2-gram 建索引,`simple` 配置                                          | 索引膨胀、噪音大                                                                   | ❌ 不推荐                                         |

**决策**:默认 **方案 A(pg_jieba)**,交付一个带 pg_jieba 的 PG 镜像作为增量;若评估 pg_jieba 在 `pgvector/pgvector:pg18` 编译成本过高或与 pase/vector 冲突,降级 **方案 B**(应用层分词,复用现有 JS 分词库或 `Intl.Segmenter` 粗切 + 词典)。英文(DrugBank)直接用 PG 原生 `english` 配置,零额外成本。

> 注:pg_jieba 需要验证是否兼容 PG18。若不可用,方案 B 是主路径,且 DrugBank 英文侧始终不受影响(本计划先做英文侧可立即受益)。

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

三张 chunk 表各加一个 `tsvector` 生成列 + GIN 索引(用 Prisma `Unsupported("tsvector")` + 原生 SQL migration,Prisma 不直接管理 tsvector 类型):

```sql
-- medicine_leaflet_chunks
ALTER TABLE "medicine_leaflet_chunks"
  ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('jiebacfg', "chunk_text")) STORED;
CREATE INDEX medicine_leaflet_chunks_search_tsv_idx
  ON "medicine_leaflet_chunks" USING GIN (search_tsv);

-- drugbank_passage_chunks:同上,用 'english' 配置
-- medical_qa_chunks:同上,用 'jiebacfg'(QA 问题+答案拼一起,或仅 question;见 3.3)
```

- 生成列随 chunk 行自动维护,**重建脚本无需改动**(`rebuild-leaflet-index.ts` / `rebuild-drugbank-rag-index.ts` 写 chunk 行时生成列自动更新)。
- FTS 配置为字典依赖,若换分词方案(方案 A→B)需 `REINDEX`;本计划保留 `search_tsv` 物化列,避免查询期每行现算。

### 3.2 服务层:HybridRetrievalService(新增,不动现有三工具结构)

新增 `src/modules/assistant/tools/vector/hybrid.service.ts`,封装"向量通道 + FTS 通道 + RRF 融合",暴露给三个现有检索工具:

```
HybridRetrievalService.query({ query, table, ftsConfig, vectorFilters, topK })
  ├─ 向量通道: store.similaritySearchWithScore(query, N)
  ├─ FTS 通道:  $queryRaw`... WHERE search_tsv @@ plainto_tsquery($cfg, $q) ... ts_rank`
  └─ RRF 融合:  按 rank 合并 → 返回统一 result 列表
```

三个工具(`leaflet/read.service.ts`、`drugbank/search.service.ts`、`knowledge/medical.service.ts`)把 `store.similaritySearchWithScore` 替换为 `HybridRetrievalService.query`:

- **leaflet**:保留产品分辨率逻辑(它本身是召回质量的加分项),把"分辨率用的向量聚合"与"chunks 检索"都接到 Hybrid 通道;
- **drugbank**:保留 entity-scoped(先 `resolveSingleDrugbankId`),FTS 通道加 `drugbank_id` 过滤(与向量 metadata filter 对齐);
- **medical**:保留 `MEDICAL_QA_MAX_LIMIT=5` 截断与 `OPEN_CORPUS_VERIFIABILITY` 标注——**只换检索后端,不换输出信封**。

### 3.3 三源实施优先级

| 源                | FTS 配置                          | 收益                                        | 优先级                      |
| ----------------- | --------------------------------- | ------------------------------------------- | --------------------------- |
| DrugBank 科学段落 | `english`(零中文成本)             | 专名/CAS/ATC/剂量术语精确命中,立竿见影      | **P0(先做,英文侧立即受益)** |
| 中文说明书        | `jiebacfg`(方案 A/B)              | 批准文号、成分名、字段术语关键词召回        | **P1(依赖中文分词决策)**    |
| 医疗 QA           | `jiebacfg`,仅 question 字段建 FTS | QA 口语化、量大,FTS 增益有限;主升力仍在向量 | **P2(可选,评估后再做)**     |

QA 特判:135 万条全量建 GIN 索引成本高,且开放低可信语料检索质量的主升力在语义而非关键词。**P2 默认不做全量 FTS**,先做 P0/P1 验证 RRF 收益,若 QA 关键词召回缺口明显再评估(可只对 `question` 建索引或抽样验证)。

### 3.4 与既有架构的对齐点

- **与 `agentic-proactive-evolution.md` P0-1 对齐**:该计划已写"混合检索(关键词 + embedding,embedding 模型池已就绪)"——本计划把 P0-1 的混合检索落地为可复用服务,供后续独立搜索 API 直接调用。
- **与 medicine-risk-graph Phase 3 的关系**:本计划不引入 LightRAG;Phase 3 仍是独立评估项。Hybrid Search 是"普通 RAG 升级"的第一阶段,Phase 3 是"图谱增强"的第二阶段,两者先后独立。
- **F-15 分层**:`verifiability` / `sourceNote` / `MEDICAL_QA_MAX_LIMIT` 输出逻辑全部不变;FTS 召回的结果同样走既有 chunk 映射标注。

### 3.5 验证

- 单元测试:RRF 融合正确性、FTS 查询构造、降级路径(向量/FTS 单通道)。
- 集成测试:三源工具各接 Hybrid 通道后,现有 spec 回归不破;新增"专名查询"用例(如 CAS 号、批准文号、ATC 码)验证 Hybrid 召回优于纯向量。
- 性能基准:P95 延迟(纯向量 vs Hybrid)、索引构建耗时、135 万 QA 若建索引的资源占用评估。

## 四、涉及文件

### 新增

| 文件                                                        | 说明                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `prisma/migrations/<ts>_add_search_tsv/`                    | 三张 chunk 表加 `search_tsv` 生成列 + GIN 索引的原生 SQL migration |
| `src/modules/assistant/tools/vector/hybrid.service.ts`      | RRF 融合检索服务(向量 + FTS 双通道)                                |
| `src/modules/assistant/tools/vector/hybrid.service.spec.ts` | 单元测试                                                           |
| `deploy/postgres/`(或 docker-compose 片段)                  | 若选方案 A:带 pg_jieba 的 PG18 Dockerfile                          |

### 修改

| 文件                                                       | 说明                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/modules/assistant/tools/leaflet/read.service.ts`      | 检索切到 HybridRetrievalService(保留产品分辨率)                                |
| `src/modules/assistant/tools/drugbank/search.service.ts`   | 检索切到 HybridRetrievalService(entity-scoped 不变)                            |
| `src/modules/assistant/tools/knowledge/medical.service.ts` | 检索切到 HybridRetrievalService(上限/标注不变)                                 |
| `scripts/import/medicine/rebuild-*.ts`                     | 若生成列方案不生效(如生成列与现有 upsert 冲突),改为重建脚本同步写 `search_tsv` |
| `package.json`                                             | 新增 `rag:hybrid:*` 脚本(建索引/重建 tsvector)                                 |
| `docs/reference/environment-variables.md`                  | 记录 FTS 配置 / 中文分词方案相关 env(若有)                                     |

### 删除

- 无(纯增量,不删现有向量路径;删除项留到后续 LightRAG 评估出结论再定)

## 五、执行顺序

1. **P0-A**:确认 pg_jieba 在 `pgvector/pgvector:pg18` 是否可用(编译/安装验证);若不可用,确认方案 B(应用层分词)细节。英文侧(DrugBank)不依赖此决策,可先行。
2. **P0-B**:DrugBank 通道 FTS(`english`)+ `HybridRetrievalService` 骨架 + RRF → `search_drugbank_passages` 接入,spec + 性能基准。
3. **P1-A**:中文分词方案落地(方案 A 镜像 或 方案 B 应用层分词)→ 说明书通道 FTS(`jiebacfg`)→ `search_medicine_leaflets` 接入。
4. **P1-B**:医疗 QA 通道评估:是否建 FTS(默认不建,仅 question 建索引的 POC 评估)。
5. **P1-C**:更新测试 + 文档 + 迁移日志;与 `agentic-proactive-evolution.md` P0-1 的独立搜索 API 对齐(把 `HybridRetrievalService` 作为其底层)。

## 六、风险与缓解

| 风险                     | 影响                         | 缓解                                                                                   |
| ------------------------ | ---------------------------- | -------------------------------------------------------------------------------------- |
| pg_jieba 与 PG18 不兼容  | 中文 FTS 无法建              | 降级方案 B(应用层分词);英文侧不受影响,仍可先落地 P0-B                                  |
| 生成列与现有重建脚本冲突 | chunk 重建后 tsvector 未更新 | 生成列由 DB 自动维护(STORED),一般无冲突;若 upsert 路径异常,重建脚本显式写 `search_tsv` |
| RRF 参数不敏感           | 融合排序质量不佳             | k=60 为业界常用值,做参数敏感度小验证                                                   |
| QA 全量 FTS 成本         | 135 万条索引膨胀/构建耗时    | 默认不做全量;仅 question 抽样 POC                                                      |
| Hybrid 拉高延迟          | 双通道 + 融合                | FTS 走 GIN 索引毫秒级;P95 基准约束;任一侧超时降级另一侧                                |
| 与 LightRAG Phase 3 混淆 | 两个"升级"重叠               | 文档明确边界:本计划是关键词+向量混合,Phase 3 是图增强,独立评估、独立推进               |

## 七、关联文档

- `plans/product-regulatory-positioning.md` —— A 路径合规边界(三源分离 / verifiability / QA 上限,不可回退)
- `plans/2026-08-28-medicine-risk-graph-plan.md` —— Phase 3 LightRAG 开放检索(独立评估,本计划不引入)
- `plans/2026-09-02-agentic-proactive-evolution.md` —— P0-1 混合检索 API(本计划为其落地底层)
- `docs/archive/01-reference/contracts/data-sources.md` / `data-sources-medical-qa.md` —— 三源检索合同
- `src/modules/assistant/tools/vector/vector-store.factory.ts` —— 现有向量工厂(共享 embedding 模型)
