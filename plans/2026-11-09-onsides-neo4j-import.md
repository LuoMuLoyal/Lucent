# OnSides → Neo4j 导入计划

**状态**：草案，待评审
**日期**：2026-11-09
**数据源**：`DrugDataBase/raw/onsides/v3.1.1/`（OnSides 3.1.1，FAERS 共识推理版）

---

## 1. 为什么是图数据库

OnSides 发布的就是**已结构化的关系数据**，不是文本。它的 schema
（`raw/onsides/v3.1.1/schema/postgres.sql`）本身就是一个四跳的图：

```
成分 (rxnorm_ingredient)
  └─< ingredient_to_product >─ 产品 (rxnorm_product)
                                    └─< product_to_rxnorm >─ 标签 (label)
                                                                └─< adverse_effect >─ 副作用 (meddra_term)
```

典型查询——「布洛芬会造成哪些副作用」或「这个副作用可能由哪些成分引起」——
在关系库里要跨 4 张表 join，在图上是一次 2–3 跳遍历。数据量到 693 万条关系后，
join 的成本是不可接受的，而图遍历的复杂度只随跳数增长、与总量无关。

**不需要任何 LLM 抽取**：关系已经给定，这跟 GraphRAG（从文本抽三元组）是
完全不同的问题。所以这里不适合 SAG2 / VectorGraphRAG，它们解决的是非结构化
文本的检索。

### 与既有 Neo4j 的关系

`Lucent/compose.graph.yaml` 已经在腾讯云跑着一个 Neo4j 5.26.31-community，
semantica-service 在用它做本体服务。**OnSides 复用同一个实例**：用独立的
标签前缀（`on:*`）隔离，避免与 semantica 的本体命名空间冲突。

---

## 2. 数据盘点

源文件位于 `DrugDataBase/raw/onsides/v3.1.1/csv/`。

| 文件                                     |          行数 |   大小 | 用途              |
| ---------------------------------------- | ------------: | -----: | ----------------- |
| `product_adverse_effect.csv`             | **6,928,667** | 400 MB | 核心关系表        |
| `product_to_rxnorm.csv`                  |        64,311 | 840 KB | 标签→产品         |
| `product_label.csv`                      |        42,798 | 7.8 MB | 药品标签          |
| `vocab_rxnorm_product.csv`               |        10,470 | 615 KB | RxNorm 产品词表   |
| `vocab_rxnorm_ingredient_to_product.csv` |         8,599 | 119 KB | 成分→产品         |
| `vocab_meddra_adverse_effect.csv`        |         6,424 | 210 KB | MedDRA 副作用词表 |
| `vocab_rxnorm_ingredient.csv`            |         1,867 |  64 KB | RxNorm 成分词表   |
| `high_confidence.csv`                    |          少量 |   5 KB | 高置信子集样本    |

**核心关系表的字段**：

```
product_label_id, effect_id, label_section, effect_meddra_id, match_method, pred0, pred1
8605,              2889299,   AR,           10001718,        PMB,          0.704, 5.084
```

- `label_section` — 副作用在说明书中的位置（`AR` = adverse reaction 等）
- `match_method` — 症状文本匹配到 MedDRA 术语所用的方法（如 `PMB`）
- `pred0` / `pred1` — 二者是 OnSides 提供的置信度分数；**语义需在实现前确认**
  （见 §7 风险 R1）

### 规模估算（Neo4j 侧）

| 项目                |       数量 |
| ------------------- | ---------: |
| 节点：MedDRA 副作用 |     ~6.4 K |
| 节点：RxNorm 成分   |     ~1.9 K |
| 节点：RxNorm 产品   |    ~10.5 K |
| 节点：药品标签      |    ~42.8 K |
| **节点小计**        |  **~61 K** |
| 关系：产品↔副作用   | **6.93 M** |
| 关系：标签→产品     |       64 K |
| 关系：成分→产品     |      8.6 K |
| **关系小计**        | **~7.0 M** |

按 Neo4j 常规经验，7M 边 + 61K 节点的存储量在 **1–2 GB** 量级（含索引）。
相对磁盘不是问题；**内存与导入方式才是**（见 §4）。

---

## 3. 图模型设计

**全部节点与关系统一加 `on:` 命名空间前缀**，与 semantica 的本体隔离。

### 节点

```cypher
(:on:Ingredient {rxnorm_id, name, term_type})
(:on:Product    {rxnorm_id, name, term_type})
(:on:Label      {label_id, source, source_product_name, source_product_id, source_label_url})
(:on:Effect     {meddra_id, name, term_type})
```

**ID 即主键**：`rxnorm_id` / `meddra_id` 直接用源数据值（字符串/整数），
不另造内部 ID——这些是标准词表 ID，天然唯一，且便于与外部系统对齐。

### 关系

```cypher
(:on:Ingredient)-[:ON_INGREDIENT_OF]->(:on:Product)
(:on:Product)-[:ON_HAS_LABEL]->(:on:Label)          // 由 product_to_rxnorm 反向
(:on:Label)-[:ON_ADVERSE_EFFECT {
    label_section, match_method, pred0, pred1
}]->(:on:Effect)
```

**置信度放在关系属性上**，不放在节点：`pred0`/`pred1` 描述的是「这个标签
报这个副作用」这一具体断言的可信度，换一个标签就是另一个值。

### 索引

```cypher
CREATE INDEX on_ingredient_name IF NOT EXISTS FOR (n:on:Ingredient) ON (n.name);
CREATE INDEX on_product_name    IF NOT EXISTS FOR (n:on:Product)    ON (n.name);
CREATE INDEX on_effect_name     IF NOT EXISTS FOR (n:on:Effect)     ON (n.name);
CREATE INDEX on_effect_meddra   IF NOT EXISTS FOR (n:on:Effect)     ON (n.meddra_id);
CREATE INDEX on_label_id        IF NOT EXISTS FOR (n:on:Label)      ON (n.label_id);
```

中文药名查询会走 `name` 索引；MedDRA 与 RxNorm 的精确查询走 ID 索引。

---

## 4. 导入方式：必须用 `neo4j-admin import`

**这是本计划最关键的一条约束。**

现有 `compose.graph.yaml` 给 Neo4j 的配置是：

```yaml
NEO4J_server_memory_heap_initial__size: 512m
NEO4J_server_memory_heap_max__size: 512m
NEO4J_server_memory_pagecache_size: 256m
```

**693 万条关系用 Cypher 逐批写入，在这个内存配置下会失败或极慢**
（每次事务都要维持状态，page cache 只有 256m，会持续换入换出）。
`LOAD CSV` 也是在线写入，同样受此限制。

正确做法是 **`neo4j-admin database import full` 离线导入**：直接生成存储文件，
绕过事务与缓存层，7M 关系通常在几分钟量级。

### 步骤

1. **停 neo4j 容器**（离线导入要求数据库未运行）
2. **生成 import 用的 CSV**（表头格式：`id:ID`、`:LABEL`、`:TYPE`、`:START_ID`、`:END_ID`）
3. 在**独立数据库**中导入：`neo4j-admin database import full onsides ...`
4. 启动容器，建索引
5. 验证（§5）

### 关于「独立数据库」

Neo4j **Community 版只支持单一数据库 `neo4j`**，不支持 `CREATE DATABASE`。
所以要么：

- **A（推荐）**：导入到默认库 `neo4j`，用 `on:` 标签前缀隔离——这正是 §3 的设计。
- B：为 OnSides 单独起一个 Neo4j 实例。内存又要多一份，不推荐。

选 A 时注意：**离线导入会覆盖整个数据库**。若 semantica 的数据已在
`neo4j` 库里，必须先导出或改用 B。**实施前必须确认当前库里有内容**
（见 §7 风险 R2）。

### 前置校验（导入前必做）

```cypher
// 在现有实例上确认是否已有数据
MATCH (n) RETURN count(n) AS nodeCount;
MATCH ()-[r]->() RETURN count(r) AS relCount;
```

若结果非零，导入方案需改为：导出 → 全量导入 → 合并，或采用方案 B。

---

## 5. 验证标准

导入后必须能回答以下问题，且响应在可接受范围：

| 验证项                              | 期望                     |
| ----------------------------------- | ------------------------ |
| 节点/关系计数与 §2 估算一致         | 误差 < 0.1%              |
| 「已知药品 → 其副作用列表」         | 单跳查询 < 100 ms        |
| 「成分 → 产品 → 标签 → 副作用」多跳 | < 500 ms                 |
| 按 `pred` 过滤高置信关联            | 可过滤，结果显著少于全量 |
| 中文药名精确匹配                    | 命中（依赖 `name` 索引） |

示例查询：

```cypher
// 某成分可能引发的副作用（含置信度）
MATCH (i:on:Ingredient {name: '布洛芬'})
      -[:ON_INGREDIENT_OF]->(p:on:Product)
      -[:ON_HAS_LABEL]->(l:on:Label)
      -[ae:ON_ADVERSE_EFFECT]->(e:on:Effect)
WHERE ae.pred1 >= $threshold
RETURN e.name, count(*) AS reports, max(ae.pred1) AS score
ORDER BY reports DESC LIMIT 20;
```

---

## 6. 与 Lucent 的接入边界

**本计划只覆盖「导入 Neo4j」**，不含 Lucent 代码改动。后续接入需要单独评审：

- 新模块（建议 `src/modules/drug-safety-graph/`），独立于现有 `assistant` 的知识检索
- 与现有 `medicines` 模块的关系：OnSides 用 RxNorm/MedDRA 标准 ID，
  而 Lucent 有自己的药品表——**需要一张 ID 映射表**，这是接入时的主要工作量
- 是否作为一个新的 assistant 工具（如 `check_ingredient_adverse_effects`）

---

## 7. 风险与待确认

| ID     | 风险/问题                                                                  | 影响                                 | 处理                                                                  |
| ------ | -------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| **R1** | `pred0` / `pred1` 的确切语义未确认（是概率？分数？哪个方向为「更可信」？） | 阈值过滤器写错会返回错误结论         | **实施前必须查 OnSides 文档确认**                                     |
| **R2** | 现有 `neo4j` 库中是否已有 semantica 数据未知                               | 离线导入会覆盖                       | 导入前执行 §4 计数校验；有数据则改方案                                |
| R3     | 内存 512m heap / 256m pagecache 对导入后的日常查询可能偏小                 | 多跳查询慢                           | 导入后实测；必要时调到 1G/512m（腾讯云 3.6 GiB，需与 semantica 协调） |
| R4     | 中文药名匹配：OnSides 是英文（RxNorm/MedDRA 标准词）                       | 用户问「布洛芬」而库里是 `Ibuprofen` | 需要中文↔标准名的映射，可能复用现有中文药品库                         |
| R5     | `match_method` 有多种取值，质量不一                                        | 低质量匹配引入噪声                   | 统计各方法占比，考虑按方法过滤                                        |
| R6     | 腾讯云机器 3.6 GiB，同时跑 semantica + 导入                                | 导入期 OOM 风险                      | 导入安排在低峰；导入时暂停 semantica                                  |

---

## 8. 执行顺序

1. **确认 R1、R2**（两个必须先答的问题，否则实施可能推倒重来）
2. 执行 §4 前置校验
3. 写导入脚本（生成 Neo4j admin import 格式 CSV）
4. 离线导入 + 建索引
5. 跑 §5 验证
6. （后续，单独评审）Lucent 接入

**本计划不含**：135 万医疗问答的 SAG2 验证。那是独立议题，见向量库选型讨论。
