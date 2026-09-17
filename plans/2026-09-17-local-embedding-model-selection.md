# 本地嵌入模型选型调研（LightRAG 中文侧 + OAG 英文侧）

Created: 2026-09-17
状态：调研记录（**未决策**；缺硬件与规模输入，收敛条件见 §6）
定位：回答"LightRAG / OAG 的向量嵌入，本地用哪个模型"。先厘清**要嵌入的不是一件事而是三条线**（§0），再给候选矩阵（§2）、服务形态（§3）、分档推荐（§4）与红线清单（§5）。**不推翻** `2026-09-16-lightrag-introduction-plan.md` 与 `2026-09-17-semantica-oag-english-side-plan.md` 的任何既有决定，只补它们留下的"嵌入模型"空位。

证据标注沿用同目录既有约定：`[核实]` = 源码 / 官方仓库 / 官方文档 / 实测；`[二手]` = 第三方；`[研判]` = 本文判断；`[待核实]` = 本条**尚未**复核，落地前必须补。

---

## 〇、要嵌入的到底是哪几条线

| #   | 索引                          | 谁配置                                                                                                                                                                                               | 语料                                                                             | 现状                                                                                                      |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | LightRAG `PGVectorStorage`    | sidecar 独立 env：`EMBEDDING_*`（`deploy/lightrag/.env.example`）                                                                                                                                    | 中文说明书字段（`cn_medicine_leaflets` 21,142）+ 医学问答（`medical_qa` 136 万） | 模板是 `EMBEDDING_BINDING=openai` + `EMBEDDING_DIM=1536` 占位，**未选模型**                               |
| 2   | Lucent 自有 pgvector 表       | `AI_EMBEDDING_*` → `LlmRuntimeService.createEmbeddingModel()`（`src/llm-runtime/llm-runtime.service.ts`）经 `VectorStoreFactory`（`src/modules/assistant/tools/vector/vector-store.factory.ts`）使用 | 英文 DrugBank passage（`drugbank_passage_embeddings`）等                         | 三张向量表 dev 库**均不存在**（见 LightRAG 计划 §0 实测），等于**首次建设**                               |
| 3   | Semantica 内部 `TextEmbedder` | 上游硬编码，无 env                                                                                                                                                                                   | 英文抽取阶段内部相似度                                                           | `[核实：semantica plan §5]` 写死 `BAAI/bge-small-en-v1.5`；加载失败**静默**退化为 128 维 SHA-256 哈希向量 |

**两条必须先说清的前提**：

1. **OAG 主链不吃嵌入。** `[核实：2026-09-17-semantica-oag-english-side-plan.md §2.1/§3.1]` 英文侧入图是"DrugBank 结构化边**确定性灌入**"，不需要 LLM 抽取，也不需要 Semantica 的嵌入器；Phase 4 推理（Rete / Datalog / SPARQL）同样与向量无关。**真正需要嵌入的只有 §0 表的第 1、2 行**，第 3 行是"顺手修掉的一条历史路径"。
2. **LightRAG 的嵌入是一次性锁定的。** `[核实：LightRAG env.docker-compose-full @main，2026-09-17 抓取]` 上游原文 _"Embedding Configuration (Should not be changed after the first file processed)"_。换模型或换维度 = 中文侧全量重建（21k 说明书 + 上限 136 万 QA）。因此**先小样本跑通、再定模型、最后全量**，顺序不可反。

---

## 一、LightRAG 侧的上游约束（决定候选范围）

`[核实：LightRAG env.docker-compose-full @main，2026-09-17 抓取]`

| 约束                       | 事实                                                                                                                                    | 对选型的影响                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `EMBEDDING_BINDING` 白名单 | `ollama, openai, azure_openai, jina, lollms, bedrock`（另有 gemini）                                                                    | **没有 `hf` / sentence-transformers 直载**。"本地"必须落成"本地 HTTP 服务"：要么 `ollama`，要么 `openai` 指向自建 OpenAI 兼容端点 |
| 上游向导默认               | vLLM 部署 `BAAI/bge-m3`，`EMBEDDING_DIM=1024`，`EMBEDDING_TOKEN_LIMIT=8192`                                                             | 上游自己把 **bge-m3 + vLLM** 当默认路线，跟默认路线踩坑最少                                                                       |
| Ollama 示例                | `EMBEDDING_MODEL=qwen3-embedding:4b`、`EMBEDDING_DIM=2560`、`OLLAMA_EMBEDDING_NUM_CTX=8192`                                             | Ollama 路线需**同时**设 `OLLAMA_EMBEDDING_NUM_CTX`，否则上下文被默认截断                                                          |
| 非对称检索                 | `EMBEDDING_ASYMMETRIC` + `EMBEDDING_DOCUMENT_PREFIX` / `EMBEDDING_QUERY_PREFIX`（注释点名 BGE/E5/GTE 需成对设置）                       | 前缀/instruction 型模型要显式配；**漏配是静默掉点**，不报错                                                                       |
| 维度 ↔ 索引                | `POSTGRES_VECTOR_INDEX_TYPE`：`HNSW` / `HNSW_HALFVEC`（注释：_"Use HNSW_HALFVEC for large embeddings (2000+ dim)"_，需 pgvector ≥ 0.7） | >2000 维必须 halfvec，或把模型输出截断到 ≤2000                                                                                    |
| 批量与并发                 | `EMBEDDING_FUNC_MAX_ASYNC=8`（默认）、`EMBEDDING_BATCH_NUM=10`；`EMBEDDING_TIMEOUT=30`                                                  | 灌库前按服务端吞吐重设；CPU 推理下默认值会大面积超时                                                                              |
| 可选发送维度               | `EMBEDDING_SEND_DIM`（OpenAI 系默认 **false**）、`EMBEDDING_USE_BASE64`                                                                 | 自建 OpenAI 兼容端若不支持 `dimensions` 参数，保持 `false`；MRL 截断走本地侧配置而非该参数                                        |
| 镜像未钉版本               | `compose.yaml` / `compose.dev.yaml` / `compose.staging.yaml` 均用 `ghcr.io/hkuds/lightrag:latest`                                       | `[研判]` 与"嵌入一次锁定"直接冲突：**建议改为钉 tag/digest**，否则上游一次破坏性变更会让已建索引与运行时不匹配                    |

---

## 二、候选模型矩阵

维度 / 上下文 / 许可取自各模型卡；**仅 `bge-m3`（1024）与 `qwen3-embedding:4b`（2560）两条经上游 LightRAG env 示例交叉验证**，其余标 `[待核实]`，落地前逐个复核。

| 模型                                | 维度                         | 上下文             | 许可                      | 定位                                                                                             |
| ----------------------------------- | ---------------------------- | ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------ |
| `BAAI/bge-m3`                       | 1024 `[核实]`                | 8192 `[核实]`      | MIT `[二手]`              | **默认首选**：中文强、多语言、对称（无前缀/instruction），一个模型可同时服务中文侧与英文 passage |
| `Qwen/Qwen3-Embedding-0.6B`         | 1024 `[待核实]`              | 32k `[待核实]`     | Apache-2.0 `[二手]`       | 轻量现代替代，支持 MRL 截维；query 侧有 instruction 约定                                         |
| `Qwen/Qwen3-Embedding-4B`           | 2560 `[核实]`                | 32k `[待核实]`     | Apache-2.0 `[二手]`       | 质量档；**>2000 维触发 halfvec 或截维问题**                                                      |
| `Qwen/Qwen3-Embedding-8B`           | 4096 `[待核实]`              | 32k `[待核实]`     | Apache-2.0 `[二手]`       | 顶配质量；维度超出 `vector` HNSW 上限，必须 halfvec / MRL                                        |
| `BAAI/bge-large-zh-v1.5`            | 1024 `[待核实]`              | **512** `[待核实]` | MIT `[二手]`              | 中文单语短文本；说明书"适应症/用法/禁忌"段落会被截断                                             |
| `BAAI/bge-small-zh-v1.5`            | 512 `[待核实]`               | **512** `[待核实]` | MIT `[二手]`              | 纯 CPU 链路验证用，不作生产                                                                      |
| `Alibaba-NLP/gte-multilingual-base` | 768 `[待核实]`               | 8192 `[待核实]`    | Apache-2.0 `[二手]`       | 轻量长上下文备选                                                                                 |
| `nomic-ai/nomic-embed-text-v1.5`    | 768 `[待核实]`               | 8192 `[待核实]`    | Apache-2.0 `[二手]`       | 英文 passage 备选，Matryoshka 可截维                                                             |
| `BAAI/bge-small-en-v1.5`            | 384 `[核实：semantica plan]` | 512 `[待核实]`     | MIT `[二手]`              | Semantica 硬编码的那一个；**只要参数化就够，不必换成大模型**                                     |
| `jina-embeddings-v3` / `v4`         | 1024 / 2048 `[待核实]`       | 8k `[待核实]`      | **CC-BY-NC-4.0** `[二手]` | **不建议**：商用医疗产品的授权风险                                                               |
| `BAAI/bge-reranker-v2-m3`           | —                            | —                  | MIT `[二手]`              | 不是嵌入，是**本地重排**（见 §3.4）                                                              |

未评估（有意留白）：`stella` 系列、`Conan-embedding`、`text2vec`、各家 1B 以下蒸馏中文模型的横向评测。若 §6 的中文评测集落地，可一并纳入。

---

## 三、服务形态（"本地"具体长什么样）

### 3.1 路线 A：Ollama（dev 最快）

```text
# 宿主机
ollama pull bge-m3            # 或 qwen3-embedding:0.6b / qwen3-embedding:4b

# deploy/lightrag/.env
EMBEDDING_BINDING=ollama
EMBEDDING_BINDING_HOST=http://host.docker.internal:11434
EMBEDDING_MODEL=bge-m3
EMBEDDING_DIM=1024
OLLAMA_EMBEDDING_NUM_CTX=8192
```

- `[二手]` Ollama 有 OpenAI 兼容层（含 `/v1/embeddings`），但它是**兼容子集**，与 native `/api/embed` 不等价。
- `[研判]` **只把 Ollama 用于 LightRAG 自己的 `ollama` binding**；不要把 Lucent 的 `AI_EMBEDDING_BASE_URL` 指到 Ollama 兼容层（理由见 §3.2）。

### 3.2 路线 B：vLLM / Infinity / Xinference / TEI（推荐给生产）

暴露原生 OpenAI 兼容 `/v1/embeddings`，LightRAG 用 `EMBEDDING_BINDING=openai`，Lucent 侧同端点复用。

**Lucent 侧有一条硬约束** `[核实]`：`src/llm-runtime/llm-runtime.service.ts` 只构造 `OpenAIEmbeddings`，`AI_PROVIDER` 也只支持 `openai-compatible`（`docs/reference/environment-variables.md`）。所以**若要本地模型同时服务 §0 的第 2 条线**，端点必须具备原生 OpenAI `/v1/embeddings` 语义，优先 vLLM / Infinity / Xinference / TEI，而不是靠 Ollama 兼容层。

其它必须注意的：容器里访问宿主服务用 `host.docker.internal`（上游 env 注释明确），不是 `localhost`；`AI_EMBEDDING_DIMENSION` 有校验上限 `MAX_EMBEDDING_DIMENSION = 4096`（`src/config/app-defaults.constants.ts`），2560 / 4096 能过校验，但**过校验 ≠ 能建索引**（见 §5.2）。

### 3.3 重排（顺带本地化）

现在模板是 `RERANK_BINDING=aliyun` + `gte-rerank-v2`（云端）。本地化路径：部署 `BAAI/bge-reranker-v2-m3`，LightRAG 侧按上游示例用 `RERANK_BINDING=cohere` 指向自建 rerank 端点。`[核实：env 注释 "For rerank model deployed by vLLM use cohere binding"]`

### 3.4 离线 / 内网

`[研判]` 模型权重走 ModelScope 或 `HF_ENDPOINT=https://hf-mirror.com`；Ollama 模型预先 `import` 进镜像或挂载卷。sidecar 与 embedding 服务都应有"模型缺失 → 启动失败"的显式行为，不允许静默降级（§5.4）。

---

## 四、分档推荐（`[研判]`，未在本机实测）

| 场景                        | 嵌入                            | 维度       | 说明                                                                                                              |
| --------------------------- | ------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| 纯 CPU 开发机，只为跑通链路 | `bge-small-zh-v1.5` 或 `bge-m3` | 512 / 1024 | 只做小样本验证；全量灌库挪到 GPU 机器，默认并发（8/10）在 CPU 上必然超时                                          |
| 单卡 8–16G                  | **`bge-m3`（首选）**            | 1024       | 上游默认路线；1024 维对 pgvector 友好；中英通吃少一套运维                                                         |
| 单卡 8–16G，想更省          | `Qwen3-Embedding-0.6B`          | 1024       | 需接受 query instruction 约定与 MRL 截维策略                                                                      |
| 单卡 24G+，追质量           | `Qwen3-Embedding-4B`            | 2560       | 必须同时决定 halfvec 或 MRL 截断（§5.2）                                                                          |
| 英文侧（§0 第 2、3 条线）   | 复用同一个 `bge-m3` 服务        | 1024       | 避免两套模型/两套维度；Semantica 那条只需"参数化 + fail-fast"，**不必**升级成 bge-m3（384→1024 会牵动它内部路径） |

**一句话**：先 `bge-m3` + vLLM/Infinity（生产）或 Ollama（dev）落地，把 §0 第 1、2 条线的空位补上；等 qa workspace 评测出结论再评估 `Qwen3-Embedding-4B`，并接受"换模型 = 中文侧全量重建"的一次性代价。

---

## 五、红线清单

1. **许可**：`jina-embeddings-v3/v4` 是 CC-BY-NC —— 商业医疗产品不用。选型时许可与维度、质量同权。
2. **维度 ↔ pgvector 索引**：`vector` 类型 HNSW/IVFFlat 上限 2000 维。`[核实：上游 env 注释]` LightRAG 用 `HNSW_HALFVEC` 覆盖 2000+ 场景；`[待核实]` **Lucent 侧**的 `PGVectorStore.ensureTableInDatabase()`（LangChain）建索引行为与其维度上限**必须单独确认**，不能默认它支持 2560 维。
3. **512 token 模型吃长字段**：说明书"适应症 / 用法用量 / 不良反应 / 禁忌 / 相互作用"是长散文，512 token 模型必须切块，否则尾部静默丢失。
4. **静默降级是这里最危险的失败模式**：Semantica 加载失败 → 128 维 hash 向量（`[核实：semantica plan §5]`）；LightRAG 前缀漏配 → 检索质量下降但无报错。落地时对"模型真的在跑"加启动断言，而不是看日志。
5. **换模型 = 全量重建**：LightRAG 官方无 re-embed 工具（`[核实：lightrag plan §风险表]`），维度写进 `src/modules/assistant/README.md` 与 sidecar env 注释。
6. **上游未钉版本**：`ghcr.io/hkuds/lightrag:latest` + 不可逆的存储/嵌入选择 = 建议钉 digest（§1 末行）。
7. **两条线不共用凭据/配置**：这是 `lightrag plan §4.2` 已经定下的口径；本地化后依然成立（Lucent `AI_EMBEDDING_*` ≠ sidecar `EMBEDDING_*`），改一边不触发另一边重建。

---

## 六、未决项（收敛这份调研需要补的输入）

| #   | 待补                                                   | 谁给 / 怎么补     | 阻塞什么                                                                                          |
| --- | ------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------- |
| 1   | **部署机有没有 GPU、显存多大**                         | 人工确认          | §4 分档、§3.2 服务选型                                                                            |
| 2   | 1k 条样本的嵌入吞吐 / 延迟基准（中文说明书 + QA 各抽） | 实测              | 136 万 QA 是否全量、`EMBEDDING_FUNC_MAX_ASYNC` / `EMBEDDING_BATCH_NUM` / `EMBEDDING_TIMEOUT` 定值 |
| 3   | Qwen3-Embedding 全系维度与上下文逐条复核               | 模型卡 / 实测     | §2 表中 `[待核实]` 项                                                                             |
| 4   | LangChain `PGVectorStore` 建索引的维度上限与索引类型   | 读源码 / 建表实测 | §5.2                                                                                              |
| 5   | Ollama OpenAI 兼容层 `/v1/embeddings` 的实际行为       | 实测              | 是否只把它当 LightRAG binding 用                                                                  |
| 6   | 中文侧小型检索评测集（说明书字段级 + QA）              | 需构造            | "bge-m3 vs Qwen3-Embedding vs bge-large-zh" 的取舍从"看榜"变成"看本库数据"                        |

---

## 七、与现有文档的关系

| 文档                                                  | 关系                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `plans/2026-09-16-lightrag-introduction-plan.md`      | 本调研补它的 `EMBEDDING_*` 空位（该计划 §4.2 只定义变量名，未选模型）；§0 数据规模引自其 §0 实测 |
| `plans/2026-09-17-semantica-oag-english-side-plan.md` | 本调研 §0 第 3 行、§5.4 引自其 §5 / §7；**不改变**"OAG 主链不吃嵌入"的结论                       |
| `plans/2026-09-06-rag-hybrid-search-upgrade.md`       | 向量侧的选型若变更，需回看该计划的混合检索（向量 + FTS）是否需要同维度                           |
| `deploy/lightrag/.env.example`                        | 本调研结论落地时改动的唯一 sidecar 配置入口（`EMBEDDING_*` + 本地 rerank 段）                    |
| `docs/reference/environment-variables.md`             | LightRAG 小节与新选型无变量名冲突；`AI_EMBEDDING_MODEL` 语义描述可能需补"可指向自建端点"         |

**外网出处**（`[二手]` 来源，落地前应复核）：[LightRAG env.docker-compose-full](https://github.com/HKUDS/LightRAG/blob/main/env.docker-compose-full)、[Ollama OpenAI compatibility](https://docs.ollama.com/openai)、[ollama bge-m3](https://ollama.com/library/bge-m3)、[Qwen3-Embedding-0.6B 模型卡](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)。
