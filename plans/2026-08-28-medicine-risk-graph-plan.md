# 药品风险检查图数据结构引入计划

Created: 2026-08-28
Revised: 2026-09-05（技术选型变更：PG19 SQL/PGQ → PolarDB PG17 + AGE/openCypher；评审修订：AGE 定位为 LightRAG 图存储后端而非风险图查询、删除相互作用传递推理、用户数据隔离、AGE 版本钉 1.7、边表血缘、PolarDB 迁移独立任务线）
Revised: 2026-09-06（PolarDB Ontology 引擎实测评测：自托管镜像不包含 Ontology/AGE/pgvector，仅含 pase 向量扩展；确认 OAG 全链路在自托管环境需自建；新增 Phase 4：OAG 本体增强生成）

## 一、背景与动机

### 1.1 当前风险检查架构

风险检查分两条路径：

- **静态检查**（`RiskDetectionService`）：纯规则引擎，在内存中做两两药品配对
- **LLM 检查**（`MedicineRiskLlmGeneratorService`）：把静态检查结果 + 上下文塞给 LLM 做深度分析

数据流：

```
用户药箱 (UserCurrentMedicine)
  ├── 过敏史 (UserAllergy)
  ├── 健康状况 (UserCondition)
  └── 药品详情 (CnMedicineProduct / DrugbankDrug)
       ├── ingredients        (TEXT 字符串)
       ├── drugInteractions    (JSONB 数组)
       ├── foodInteractions    (JSONB 数组)
       ├── contraindications   (TEXT)
       └── synonyms            (JSONB 数组)
```

### 1.2 核心痛点

| 痛点                          | 位置                                                                                                 | 影响                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **N² 笛卡尔积**               | `risk-detection.service.ts` 第 93-104 行：`for i, for j=i+1` 两两配对，每次重新提取 token 集合做交集 | 用户药品越多，延迟平方级增长                        |
| **成分归一化硬编码**          | `ingredient-canonicalization.ts` 第 5-31 行：仅 15 个成分别名映射，手工维护                          | 新药品成分不在此表则回退为原始 token，准确性下降    |
| **DrugBank 交互数据是 JSONB** | `DrugbankDrug.drugInteractions` 是 JSONB，非关系表                                                   | 查询必须先拉出整行再内存中解析，无法做高效 join     |
| **CN↔DrugBank 两张孤岛表**    | `CnMedicineProduct` 和 `DrugbankDrug` 无关系关联                                                     | 跨源的交互检测完全靠文本匹配                        |
| **过敏匹配是字符串包含**      | `risk-detection.service.ts` 第 124-178 行：`includes` 匹配                                           | "青霉素" 匹配 "青霉素V钾片" 但匹配不到 "penicillin" |
| **过敏/禁忌链路缺确定性模型** | 过敏仅字符串匹配；condition→substance→drug 无确定性路径                                              | 过敏与禁忌的召回依赖 LLM，无确定性的可回溯链路      |

### 1.3 目标

将 JSONB 数据和硬编码映射关系化，利用标准 PostgreSQL 18 的关系 + pgvector 能力，把 N² 内存配对降为 SQL JOIN。风险图的确定性推理（成分共享、过敏/禁忌链路）由关系表 + SQL/递归 CTE 承载，不依赖 AGE。AGE 的角色是 LightRAG 的可选图存储后端（详见 §5）与 Phase 4 OAG 的可选推理图存储（详见 §6）。

## 二、技术选型：标准 PostgreSQL 18 + pgvector（AGE 可选）

### 2.1 选型结论（评审修订 2026-09-05）

原方案先等 PG19 GA（SQL/PGQ），后改为 PolarDB PG17 + AGE。经调研（自托管前提）进一步收敛为：**维持现状的标准 PostgreSQL 18 + pgvector，不换库**；LightRAG 图存储走 **PGTableGraphStorage（纯 SQL 表）**，AGE 降级为**可选项**（仅当产品确实需要直接写 Cypher 做自定义图分析时再引入）。

理由（每条都有依据）：

- **PolarDB 的"集成 AGE + pgvector"优势，在自托管下不成立**：LightRAG 官方 `Dockerfile.postgres` 就是 `pgvector/pgvector:pg18` + 编译 `release/PG18/1.7.0` 的 AGE——标准 PG18 用官方配方即可 100% 复刻，无需 PolarDB。
- **PolarDB 托管版 AGE 只支持 PG16/15/14**（阿里云文档明确适用范围），PG17 发布公告的插件清单里**没有 age**；本地版 17 镜像是否预置 AGE 未经验证。切 PolarDB 17 反而引入"PG18→17 内核降级 + fork 兼容性"风险，收益为零。
- **LightRAG 官方推荐 PGTableGraphStorage**：`env.example` 明示"PGTableGraphStorage runs the graph on plain PostgreSQL 14+ tables with no Apache AGE and no extensions … Use PGGraphStorage only if you need AGE"。源码类注释同样声明 PGTableGraphStorage 是一等公民实现、AGE 版只是 reference。
- **风险图本体本就只需关系表 + SQL/递归 CTE**（Phase 1），不依赖任何图引擎（详见 §3）。

### 2.2 LightRAG 图存储后端对比（实测源码）

| 维度   | **PGTableGraphStorage（默认，选定）**                                            | **PGGraphStorage（AGE，可选）**                           |
| ------ | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 存储   | 两张普通表 `lightrag_graph_nodes` / `lightrag_graph_edges`（JSONB + B-tree）     | AGE `_ag_label_vertex` / `_ag_label_edge` 图存储          |
| 依赖   | **无扩展、无 AGE**；`pgvector/pgvector:pg18` 即可                                | 需 AGE 1.7 扩展；AGE ≥1.8 拒绝启动（apache/age#2500）     |
| 功能面 | 49 个方法，完整 `BaseGraphStorage` 契约（CRUD/批量/BFS/search_labels/drop/迁移） | 54 个方法，多出的是 AGE 特有配置/版本防呆，**非功能优势** |
| 边语义 | 幂等 upsert，`src_id=min(a,b)` / `tgt_id=max(a,b)` 规范化                        | 依赖 Cypher MATCH，边写入可能丢                           |
| 运维   | 标准 PG 表，backup/reindex/监控全原生                                            | 多一个扩展要装/钉版本/search_path 污染                    |
| 兼容性 | **任何 PG 14+**（RDS/Cloud SQL/Supabase/Neon/自托管）                            | 仅 AGE 支持的 PG 版本 + 必须钉 1.7                        |

**结论**：两个后端都实现同一套 LightRAG 图契约（实体/关系三元组的检索增强），功能等价；AGE 的"更强"体现在 Cypher 查询能力，而产品不会直接写 Cypher 遍历 LightRAG 的图。**真实产品与竞赛 demo 均选 PGTableGraphStorage**：零扩展、可移植、运维简单、贴合医学产品"少依赖、可追溯、易迁移"诉求。

### 2.3 AGE 的保留条件（不阻塞当前）

- 仅在确认产品需要**直接对图执行 openCypher**（如"成分网络浏览器"：遍历共享成分的多跳链路、图可视化分析）时，才值得引入 AGE。
- 若引入：走 LightRAG 官方配方（`pgvector/pgvector:pg18` + `release/PG18/1.7.0` 编译的 AGE 1.7.0），而非 PolarDB；必须钉 1.7.x（1.8+ 会崩 PGGraphStorage）。
- 两个后端可迁移（LightRAG 自带 `migrate_graph_storage.py`），非不可逆决策——先 PGTableGraphStorage 上线，把"是否需要 AGE"留作产品迭代中再验证。

### 2.4 PolarDB Ontology 引擎实测（2026-09-06）

**结论：自托管 PolarDB-PG 不包含 Ontology 引擎，OAG 全链路在自托管环境必须自建。**

背景：OAG（Ontology-Augmented Generation，Palantir 提出）是比 RAG 更进一步的本体增强生成范式——用"本体建模 → 数据集成 → 知识存储 → 推理引擎 → LLM 集成 → 行动执行"六步链路，为 Agent 提供结构化、可推理、可执行的上下文。阿里云宣称 PolarDB-PG "嵌入轻量级 Ontology 引擎，支持 OAG"。

**实测评测（`polardb/polardb_pg_local_instance:17`，PostgreSQL 17.11）：**

| 能力              | 阿里云托管版宣称         | 自托管镜像实测                                                                               |
| ----------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| Apache AGE 图引擎 | Polar_AGE（图引擎）      | ❌ `CREATE EXTENSION age` 报错，无 `age.control` / `age.so`                                  |
| pgvector          | PGVector（向量检索）     | ❌ `CREATE EXTENSION vector` 报错，无 `vector.control`                                       |
| Ontology 引擎     | 嵌入轻量级 Ontology 引擎 | ❌ 全盘搜索 `/u01` 无 onto/knowledge/graph/rag 组件；bin 仅标准 PG 工具                      |
| pase 向量扩展     | （PolarDB 自研向量检索） | ✅ `CREATE EXTENSION pase` 成功，"ant ai similarity search"，含 `pase_hnsw` / `pase_ivfflat` |

**解读：**

- "本体知识平台"是阿里云**托管版专属**能力：官方文档明确"功能目前处于灰度阶段，请提交工单"，开通方式是控制台创建独立的"AI 应用"（架构选 AI 应用 → 本体知识图谱），不是内核扩展。
- 开发者社区文章"PolarDB-PG 嵌入 Ontology 引擎"指的也是**托管版 PolarDB-PG**（控制台产品），不是自托管镜像。
- 自托管镜像唯一与 AI 相关的是 `pase`（自研向量检索，API 与 pgvector 不兼容），没有 AGE、没有 pgvector、没有 Ontology。

**对本计划的影响：**

- 维持"标准 PostgreSQL 18 + pgvector"基线不动（自托管 PolarDB 反而缺 pgvector）。
- **OAG 全链路（Phase 4）在自托管环境自建**，不依赖阿里云托管平台，本体元数据/实例/推理全部落在 PG18 关系表 + 可选图存储上（详见 §6）。

### 2.5 与 PG19 SQL/PGQ 的关系

PG19 原生 `CREATE PROPERTY GRAPH` + `GRAPH_TABLE`（只读图视图、零副本、强一致）是未来更优的图能力，但：

- 与 LightRAG 无关（LightRAG 走 PGTableGraphStorage 或 AGE 存储，不消费 PG19 图视图）；
- 自托管升级到 PG19 时，风险图本体（关系表 + CTE）与 PGTableGraphStorage（普通表）均平滑兼容，无需迁移；
- 因此 PG19 SQL/PGQ 不进入本计划当前范围，仅作远期观察。

## 三、Phase 1：JSONB → 关系表（标准 PG18 可直接执行）

### 3.1 新增关系表

#### 3.1.1 `drug_interaction_edges` — 药物相互作用边

```prisma
model DrugInteractionEdge {
  id           String   @id @default(uuid())
  drugAId      String   @map("drug_a_id")   // DrugbankDrug.drugbankId；字典序小值在前
  drugBId      String   @map("drug_b_id")   // 字典序大值在后；unique 真正去重双向
  description  String?
  source       String   @default("drugbank") // "drugbank" | "cn" | "inferred"
  sourceImportId String? @map("source_import_id") // 血缘 → drug_source_imports.id
  dataVersion  String?  @map("data_version")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  @@unique([drugAId, drugBId, source])
  @@index([drugAId])
  @@index([drugBId])
  @@index([sourceImportId])
  @@map("drug_interaction_edges")
}
```

数据来源：ETL 脚本解析 `DrugbankDrug.drugInteractions` JSONB，每条 `{ drugbankId, description }` 展开为一行。

#### 3.1.2 `drug_ingredient_edges` — 药品→成分边

```prisma
model DrugIngredientEdge {
  id           String   @id @default(uuid())
  drugSource   String   @map("drug_source")   // "drugbank" | "cn"
  drugRefId    String   @map("drug_ref_id")   // drugbankId 或 cn_medicine_products.id
  ingredientKey String  @map("ingredient_key") // 标准化成分 key（如 "acetaminophen"）
  ingredientText String @map("ingredient_text") // 原始文本
  sourceImportId String? @map("source_import_id") // 血缘 → drug_source_imports.id
  dataVersion  String?  @map("data_version")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  @@unique([drugSource, drugRefId, ingredientKey])
  @@index([drugSource, drugRefId])
  @@index([ingredientKey])
  @@index([sourceImportId])
  @@map("drug_ingredient_edges")
}
```

数据来源：

- DrugBank 药品：解析 `synonyms` + 药品名，经 `canonicalIngredientKeysFor()` 归一化后写入
- CN 药品：解析 `ingredients` 文本，经 `extractIngredientTokens()` + `canonicalIngredientKeysFor()` 后写入

#### 3.1.3 `ingredient_synonym_edges` — 成分别名映射

```prisma
model IngredientSynonymEdge {
  id           String   @id @default(uuid())
  canonicalKey String   @map("canonical_key")  // 如 "acetaminophen"
  synonymToken String   @map("synonym_token")  // 如 "paracetamol", "对乙酰氨基酚", "扑热息痛"
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  @@unique([canonicalKey, synonymToken])
  @@index([synonymToken])
  @@map("ingredient_synonym_edges")
}
```

数据来源：当前 `ingredient-canonicalization.ts` 中的 `canonicalIngredientVariants` 硬编码表（15 条），迁移为关系数据。后续可从 DrugBank synonyms 自动批量导入。

#### 3.1.4 `allergen_ingredient_edges` — 过敏原→成分映射

```prisma
model AllergenIngredientEdge {
  id              String   @id @default(uuid())
  allergenLabel   String   @map("allergen_label")   // 用户过敏标签原文
  allergenToken   String   @map("allergen_token")   // normalizeToken 后的 token
  ingredientKey   String?  @map("ingredient_key")   // 匹配到的标准化成分 key
  matchType       String   @map("match_type")       // "exact" | "synonym" | "text"
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  @@unique([allergenToken, ingredientKey])
  // 注意：ingredientKey 可 NULL 时 PG 唯一约束对多个 NULL 不去重。
  // 生产实现需改为部分唯一索引 WHERE ingredient_key IS NOT NULL，或非 NULL 哨兵值。
  @@index([allergenToken])
  @@map("allergen_ingredient_edges")
}
```

### 3.2 ETL 导入脚本

新建 `scripts/medicine/build-graph-edges.ts`：

1. **`ingredient_synonym_edges`**：从 `canonicalIngredientVariants` 常量导入 15 条种子数据
2. **`drug_interaction_edges`**：遍历 `DrugbankDrug` 表，解析 `drugInteractions` JSONB，展开为行
3. **`drug_ingredient_edges`**：遍历 `DrugbankDrug` + `CnMedicineProduct`，提取成分 token → 归一化 → 写入
4. **`allergen_ingredient_edges`**：遍历历史 `UserAllergy` 数据，对每个过敏标签做成分匹配，写入结果

脚本注册为 `package.json` 的 `import:graph-edges` 命令。

### 3.3 改造 `RiskDetectionService`

将 `risk-detection.service.ts` 中的内存配对逻辑逐步改为 SQL JOIN 查询。**边表成为风险检查的唯一事实源**：风险检查只读边表；原始 JSONB 降级为导入存档。边表构建挂在 `DrugSourceImport` 导入完成后（JSONB 入库即重建），不允许独立脚本"忘了跑"导致两条路漂移。

**前（内存 N²）：**

```typescript
for (let i = 0; i < details.length; i++) {
  for (let j = i + 1; j < details.length; j++) {
    const interaction = this.pairInteractionFinding(current, other);
    // ...
  }
}
```

**后（SQL JOIN）：**

```typescript
// 一次性查出用户药箱中所有有交互的药对
const interactions = await this.prisma.$queryRaw`
  SELECT a.display_name AS drug_a, b.display_name AS drug_b, e.description
  FROM user_current_medicines ucm_a
  JOIN user_current_medicines ucm_b ON ucm_a.user_id = ucm_b.user_id AND ucm_a.id < ucm_b.id
  JOIN drug_interaction_edges e ON e.drug_a_id = ucm_a.source_ref_id AND e.drug_b_id = ucm_b.source_ref_id
  WHERE ucm_a.user_id = ${userId} AND ucm_a.is_current = true AND ucm_b.is_current = true
`;
```

同理，重复成分检测改为 `drug_ingredient_edges` 自 join，过敏匹配改为 `allergen_ingredient_edges` JOIN `drug_ingredient_edges`。

### 3.4 改造 `ingredient-canonicalization.ts`

- `canonicalIngredientVariants` 硬编码表移到 DB 后，此文件仅保留 `normalizeToken`、`extractIngredientTokens` 等纯函数
- `canonicalIngredientKeysFor` 改为异步查 `ingredient_synonym_edges` 表
- 缓存层：内存 LRU + Redis 双层缓存，避免每次检查都查 DB

### 3.5 验证

- 现有 `risk-check.service.spec.ts` 和 `risk-detection.service.spec.ts` 测试全部通过
- 新增 ETL 脚本的单元测试：验证 JSONB 解析正确性
- 性能基准：10 种药品的风险检查延迟从 N² 降到 O(N) 级别

## 四、Phase 2：风险图查询（关系表 + SQL/递归 CTE）

风险图本体用 Phase 1 的关系边表承载，查询全部走标准 SQL（JOIN + 递归 CTE），**不依赖任何图引擎**。本阶段不引入 PolarDB、不引入 AGE。

### 4.1 确定性查询（SQL 实现）

**药物相互作用（一跳）：**

```sql
SELECT a.display_name AS drug_a, b.display_name AS drug_b, e.description AS evidence
FROM user_current_medicines ua
JOIN user_current_medicines ub ON ua.user_id = ub.user_id AND ua.id < ub.id
JOIN drug_interaction_edges e
  ON e.drug_a_id = ua.source_ref_id AND e.drug_b_id = ub.source_ref_id
WHERE ua.user_id = $1 AND ua.is_current = true AND ub.is_current = true
```

**重复成分（成分蕴含，两跳）：**

```sql
SELECT a.display_name AS drug_a, b.display_name AS drug_b, e1.ingredient_key
FROM user_current_medicines ua
JOIN user_current_medicines ub ON ua.user_id = ub.user_id AND ua.id < ub.id
JOIN drug_ingredient_edges e1 ON e1.drug_source = $2 AND e1.drug_ref_id = ua.source_ref_id
JOIN drug_ingredient_edges e2 ON e2.drug_source = $2 AND e2.drug_ref_id = ub.source_ref_id
  AND e2.ingredient_key = e1.ingredient_key
WHERE ua.user_id = $1 AND ua.is_current = true AND ub.is_current = true
```

**过敏/禁忌链路（allergen → ingredient → drug）：**

```sql
SELECT a.label AS allergen_label, d.name AS drug_name, i.ingredient_key
FROM user_allergies a
JOIN allergen_ingredient_edges ae ON ae.allergen_token = normalize_token(a.label)
JOIN drug_ingredient_edges i ON i.ingredient_key = ae.ingredient_key
JOIN cn_medicine_products d ON d.id = i.drug_ref_id
WHERE a.user_id = $1 AND a.is_active = true
```

**多跳链路（如需，递归 CTE）：**

```sql
-- 例：从成分出发，找共享该成分的药品（<=3 跳，单用户子图毫秒级）
WITH RECURSIVE reach AS (
  SELECT drug_ref_id, 1 AS depth FROM drug_ingredient_edges WHERE ingredient_key = $1
  UNION
  SELECT e.drug_ref_id, r.depth + 1 FROM reach r
  JOIN drug_ingredient_edges e ON e.ingredient_key = r.ingredient_key
  WHERE r.depth < 3
) SELECT DISTINCT drug_ref_id FROM reach
```

> **临床正确性约束**：相互作用（`interacts_with`）不是传递关系——B↔C 相互作用不代表 A↔C 有任何关系。**不允许**"A 与 B 共成分、B 与 C 相互作用 → A 与 C 间接风险"这种多跳推理（会产生大量假阳性，灌入 LLM 后造成误导性结论）。风险图只做两类合法多跳：成分蕴含（上例重复成分自 join）与过敏/禁忌链路（`allergen→ingredient→drug`、`condition→substance→drug`）。`interacts_with` 边只允许一跳使用。

> **用户数据隔离**：所有查询的 `$userId` 只来自关系表（`user_current_medicines` / `user_allergies`），边表只存全局知识（drug / ingredient / allergen / condition 映射），**不含任何用户数据**。

### 4.2 Prisma 集成

全部走 `$queryRaw` 标准 SQL，返回普通列，无 agtype 转换层：

```typescript
const interactions = await this.prisma.$queryRaw<InteractionRow[]>`
  SELECT a.display_name AS drug_a, b.display_name AS drug_b, e.description
  FROM user_current_medicines ua
  JOIN user_current_medicines ub ON ua.user_id = ub.user_id AND ua.id < ub.id
  JOIN drug_interaction_edges e
    ON e.drug_a_id = ua.source_ref_id AND e.drug_b_id = ub.source_ref_id
  WHERE ua.user_id = ${userId} AND ua.is_current = true AND ub.is_current = true
`;
```

### 4.3 删除的代码

Phase 2 完成后可删除：

- `ingredient-canonicalization.ts` 中的 `canonicalIngredientKeysFor`、`expandCanonicalIngredientTokens`（改查 `ingredient_synonym_edges` 表 + 缓存）
- `risk-detection.service.ts` 中的内存 `pairInteractionFinding`、`duplicateIngredientFinding`、`allergyFindings` 方法
- `risk-context-builder.service.ts` 中手工拼接 findings 的逻辑

### 4.4 LLM 上下文增强

`RiskContextBuilderService` 注入图查询结果时，只注入**合法多跳**：成分蕴含与过敏/禁忌链路。**不注入"相互作用传递"链**（临床不成立，会产生假阳性，见 4.1 约束）。

```typescript
// 成分蕴含链路（合法传递推理）—— 关系表 drug_ingredient_edges 自 join，无需 AGE
const sharedIngredientChains = await this.prisma.$queryRaw`
  SELECT a.display_name AS drug_a, b.display_name AS drug_b, e1.ingredient_key
  FROM user_current_medicines ua
  JOIN user_current_medicines ub ON ua.user_id = ub.user_id AND ua.id < ub.id
  JOIN drug_ingredient_edges e1 ON e1.drug_source = ${source} AND e1.drug_ref_id = ua.source_ref_id
  JOIN drug_ingredient_edges e2 ON e2.drug_source = ${source} AND e2.drug_ref_id = ub.source_ref_id
    AND e2.ingredient_key = e1.ingredient_key
  WHERE ua.user_id = ${userId} AND ua.is_current = true AND ub.is_current = true
`;

// 过敏/禁忌链路（合法）—— allergen 标签 → ingredient → drug
const allergyChains = await this.prisma.$queryRaw`
  SELECT a.label AS allergen_label, d.name AS drug_name, i.ingredient_key
  FROM user_allergies a
  JOIN allergen_ingredient_edges ae ON ae.allergen_token = normalize_token(a.label)
  JOIN drug_ingredient_edges i ON i.ingredient_key = ae.ingredient_key
  JOIN cn_medicine_products d ON d.id = i.drug_ref_id
  WHERE a.user_id = ${userId} AND a.is_active = true
`;

// 注入 LLM prompt（只注入合法链路，interacts_with 仅允许一跳）
context.sharedIngredientChains = sharedIngredientChains;
context.allergyChains = allergyChains;
```

### 4.5 AGE（可选，不阻塞当前）

仅当产品确认需要**直接写 openCypher 做自定义图分析**（如"成分网络浏览器"多跳可视化）时，才启用 AGE：

- 走 LightRAG 官方配方：`pgvector/pgvector:pg18` + 编译 `release/PG18/1.7.0` 的 AGE 1.7.0（`shared_preload_libraries=age`），**不换 PolarDB**；
- 必须钉 AGE 1.7.x（1.8+ 会崩 PGGraphStorage，见 apache/age#2500）；
- AGE 图为只读投影，由导入管线在 `DrugSourceImport` 完成后自动重建（幂等 MERGE），不允许写路径直改图；
- 若不需要 AGE，风险图查询走 4.1 的 SQL/CTE 即为终点。

## 五、Phase 3：LightRAG 图增强检索（开放检索层）

### 5.1 目标与定位

LightRAG（HKUDS，EMNLP2025，39k+ stars）是 GraphRAG 的轻量替代：省去 GraphRAG 昂贵的 community detection 与多跳推理，支持增量更新，索引/查询的 LLM 调用量大幅下降。

- **定位**：开放检索的图增强生成层，服务于 Assistant 的开放问答；**只检索不决策**，不参与风险判断。
- **与存储后端的关系**：LightRAG 的图存储走 **PGTableGraphStorage**（纯 SQL 表 `lightrag_graph_nodes` / `lightrag_graph_edges`，无扩展、无 AGE，官方推荐默认）。风险图的确定性推理（成分共享、过敏/禁忌链路）由关系表 + SQL/递归 CTE 承载（Phase 1/4.1），与 LightRAG 完全独立。AGE（`PGGraphStorage`）仅作为可选升级路径（§4.5），当前不引入。两者共享 Phase 1 的关系表数据底座与同一个 PG18 实例。
- **范围红线**：沿用 `data-sources-medical-qa.md` 的既有边界——`safetyLabel` 预过滤、`MEDICAL_QA_MAX_LIMIT = 5` 检索上限、`verifiability: 'open_corpus'` 低可信标注。LightRAG 只做索引与召回，**决策与免责仍由 Lucent 服务端控制**。

### 5.2 存储与部署形态

- **统一后端落在现有 PG18**：LightRAG 官方推荐 PostgreSQL 作为统一存储，KV / Vector / Graph / DocStatus 四种存储一个 PG 承载。向量检索走现有 pgvector（`pgvector/pgvector:pg18`）；**图存储走 `PGTableGraphStorage`**（官方默认，纯 SQL 表，无扩展、无 AGE）——`env.example` 明确 "Use PGGraphStorage only if you need AGE"，本计划不需要直接写 Cypher，故不引入 AGE。
- **Python sidecar 部署**：LightRAG 是 Python 3.10+，Lucent 是 NestJS/TypeScript。接入方式为独立 `lightrag-server`（提供 REST API + WebUI），Lucent 通过 HTTP 调用，互不阻塞。
- **Docker 部署**：官方发布 GHCR 镜像（`ghcr.io/hkuds/lightrag`），支持 Docker Compose，与 Lucent、PG18 实例编排在同一 compose 栈；`POSTGRES_DATABASE` 建议独立（如 `lucent_rag`），与业务库同实例隔离 schema。
- **嵌入模型一致性**：索引与查询必须用同一 embedding 模型；变更需重建向量相关表（PG 后端在首次建表时固定向量维度）。**直接复用现有 `LlmRuntimeService.createEmbeddingModel()` 的模型配置**（与当前 pgvector RAG 三表一致），避免两套向量、两套成本、两套精度；通过环境变量统一注入。

### 5.3 数据接入范围

| 语料                                           | 是否进入 LightRAG | 说明                                            |
| ---------------------------------------------- | ----------------- | ----------------------------------------------- |
| `medicine_leaflet_chunks`（说明书）            | ✅ 主索引         | 官方文本，语料质量最高                          |
| `drugbank_passage_chunks`（DrugBank 科学段落） | ✅ 主索引         | 结构化科学信息                                  |
| `medical_qa_chunks`（开放语料）                | ⚠️ 受限           | 仅 `safetyLabel` 通过的部分；必须保留低可信标注 |
| 用户个人记录                                   | ❌ 不入 LightRAG  | 隐私边界，保持 Lucent 个人上下文独立            |

**全量风险警告**：LightRAG 索引时用 LLM 抽取实体/关系，135 万 QA 全量建图成本极高。**首期用 DrugBank + 说明书子集（千级条）跑通链路**，随后按**增量索引管线**扩量（新 QA 入库 → 增量建图），医疗 QA 全量建图不作为首期必需项；LLM token 消耗按量预算并基准化。

### 5.4 REST API 契约（Lucent ↔ lightrag-server）

```text
POST /documents/text        # 增量入库单条文本（Lucent 导入管线调用）
POST /documents/file        # 批量入库文件
DELETE /documents/{id}      # 删除文档，自动重建受影响图谱
POST /query                 # 检索+生成
GET  /health                # 健康检查
```

Lucent 侧封装 `LightRagClient`（`src/modules/assistant/`），只暴露两个方法给服务层：

```typescript
// 入库：Lucent 把待索引切片推给 LightRAG
await this.lightRag.indexChunks(source, chunks);
// 查询：返回检索证据，仍由 Lucent 做决策与 verifiability 标注
const evidences = await this.lightRag.query(question, { topK });
```

### 5.5 与可验证性分层的融合

LightRAG 检索结果**不改变**现有 F-15 可验证性分层：

- 说明书 / DrugBank 切片经 LightRAG 召回后，仍标 `verifiability: 'curated'`（来源可追溯）。
- 医疗 QA 经 LightRAG 召回后，仍标 `verifiability: 'open_corpus'` + `sourceNote: '开放语料,低可信教育参考,无独立可验证来源'`。
- 标注逻辑在 Lucent 服务端 chunk 映射处生成，**不改数据库、不改导入脚本**（沿用既有约束）。

### 5.6 验证

- 单元测试：`LightRagClient` 的请求/响应解析、错误处理、超时降级。
- 集成测试：本地起 `lightrag-server`（Docker），用 DrugBank 子集验证索引 → 查询 → 证据返回链路。
- 回归：Assistant 现有 RAG 测试不回归；`verifiability` 标注在 LightRAG 接入后保持输出一致。
- 性能基准：查询 P95 延迟、索引耗时、LLM token 消耗（对比 LightRAG vs 现有纯向量召回）。

## 六、Phase 4：OAG 本体增强生成（自建，可选但推荐）

OAG（Ontology-Augmented Generation，Palantir 提出）：以"本体"为 Agent 提供结构化、可推理、可执行的上下文，区别于 RAG 的零散文本片段。本计划在自托管环境自建全链路（PolarDB 托管版 Ontology 平台不可用，见 §2.4 实测）。

### 6.1 目标与定位

- **定位**：在 Phase 3（LightRAG 开放检索）之上，增加"确定性本体推理"层——LLM 的开放问答仍走 LightRAG；涉及药物-成分-过敏/禁忌的**结构化事实问答与多跳推理**走 OAG，给出可追溯、可执行的结果。
- **与 RAG 的关系**：RAG 返回文本片段（上下文噪声大）；OAG 返回结构化实体及其关系网络（精准、完整、可追溯）。两者互补：RAG 管开放语料召回，OAG 管领域本体推理。
- **与 Phase 1/2 的关系**：Phase 1/2 已建的关系边表（`drug_interaction_edges` / `drug_ingredient_edges` / `ingredient_synonym_edges` / `allergen_ingredient_edges`）**就是 OAG 本体的数据底座**——本体实例直接映射到这些表，不重复建图。

### 6.2 六步链路（对应 Palantir OAG 工程范式）

| 步骤           | 自托管实现                                                                                                                                                             | 依赖                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **① 本体建模** | 从现有 Prisma schema + DrugBank/说明书结构，LLM 辅助生成候选本体（Object / Link / Action 的 JSON Schema 定义），人工审核确认；存入本体元数据表                         | 现有 Prisma schema、`LlmRuntimeService`      |
| **② 数据集成** | ETL 将业务数据映射为本体实例：复用 Phase 1 边表 + 新增本体实例表（JSONB 属性）；`DrugSourceImport` 完成后钩子触发同步                                                  | Phase 1 边表、ETL 管线                       |
| **③ 知识存储** | 本体实例 = 关系表 + JSONB（确定性）+ pgvector（语义属性 embedding）；可选图存储（AGE 1.7 或纯 SQL 邻接）承载多跳遍历                                                   | PG18 + pgvector；可选 AGE                    |
| **④ 推理引擎** | 自研：图遍历（递归 CTE 或可选 AGE Cypher）+ 规则执行（SQL 视图/服务层）。例：过敏链路 `allergen → ingredient → drug`、相互作用一跳约束                                 | Phase 2 的 SQL/CTE 成果                      |
| **⑤ LLM 集成** | LLM 理解意图 → 转成本体查询（SQL/工具调用）；声明式 Skill 定义（类 Palantir Skill：一个 Skill 文件声明 query / traverse / path / action 能力），Agent 据此自主探索推理 | `RiskContextBuilderService`、Assistant Agent |
| **⑥ 行动执行** | Action 框架：参数校验 + 前置条件检查 + 人工审批（高危动作 pending）+ Webhook 触发下游；全量操作审计                                                                    | 现有 Action/通知能力                         |

### 6.3 本体建模（步骤①）

- **输入**：现有 Prisma schema（`medicine-graph.prisma` 边表、`CnMedicineProduct` / `DrugbankDrug` / `UserAllergy` / `UserCondition` / `UserCurrentMedicine`）+ DrugBank/说明书字段说明。
- **LLM 辅助生成**：调用 `LlmRuntimeService.createEmbeddingModel()` 同一模型体系外的 LLM（复用现有 LLM 配置），输入 schema 摘要，输出候选 Object/Link/Action 定义（JSON Schema）。
- **人工审核**：候选定义进入 `ontology_types` 表（ObjectType / LinkType / ActionType），审核通过才生效；支持版本管理（`ontology_version`）。
- **示例本体（药品领域）**：
  - Object：`Drug`（属性：name、atc_code、rx_required）、`Ingredient`（属性：key、is_active）、`Allergen`、`Condition`、`InteractionEvidence`
  - Link：`Drug → CONTAINS → Ingredient`、`Ingredient → CONTRAINDICATED_IN → Condition`、`Drug → INTERACTS_WITH → Drug`、`Allergen → MAPS_TO → Ingredient`
  - Action：`RecommendAlternative(drugId)`、`FlagContraindication(userId, drugId)`、`NotifyPhysician(userId, riskId)`

### 6.4 知识存储与推理（步骤③④）

**本体实例存储（确定性层）**：

- 本体实例直接落 Phase 1 边表 + 新增 `ontology_instances` 表（`object_type` / `object_id` / `properties JSONB`），JSONB 存非关系属性；
- 语义属性（如 Drug 描述、Ingredient 名称）挂 pgvector embedding，支持自然语言语义匹配检索（复用 `LlmRuntimeService.createEmbeddingModel()` 同一 embedding 配置）。

**推理引擎（两种形态，先 A 后 B）**：

- **A. 纯 SQL/递归 CTE（默认）**：与 Phase 2 相同的模式。过敏链路、成分蕴含、禁忌链路全部可用 SQL JOIN + 递归 CTE 表达，毫秒级，无额外依赖。
- **B. AGE 图遍历（可选）**：仅当产品确认需要任意起点多跳遍历 / 路径查找（如"从某成分出发，找出所有共享它的药品再找出相互作用"）且 SQL 递归 CTE 难以表达时，引入 AGE 1.7（钉死版本，§2.3 条件）。推理查询走 openCypher，其余仍走 SQL。

### 6.5 LLM 集成与行动执行（步骤⑤⑥）

**Skill 声明式定义**（类 Palantir Skill，简化自建）：

```json
{
  "skill": "drug-risk-reasoning",
  "ontology": "medicine",
  "capabilities": [
    {
      "op": "query",
      "sql": "SELECT ... FROM drug_interaction_edges WHERE drug_a_id = $id"
    },
    { "op": "traverse", "sql": "WITH RECURSIVE reach AS (...) SELECT ..." },
    { "op": "path", "sql": "SELECT ... -- 过敏/禁忌链路" },
    {
      "op": "action",
      "endpoint": "/api/v1/medicines/flag-contraindication",
      "requiresApproval": true
    }
  ]
}
```

Agent 收到用户问题时：理解意图 → 选择 Skill 能力 → 执行查询/遍历 → 结果作为结构化上下文注入 LLM → 需要动作时调用 action（高危动作 pending 待人工审批）。

**行动执行红线**：

- 高危动作（如推荐替代药、通知医生）**必须人工审批**后才能执行，不允许 LLM 直接触发；
- 所有 action 全量审计（操作者、入参、结果、时间）；
- 用户数据（过敏史、药箱）只作为查询参数，不写入共享本体实例；本体实例只含全局知识（Drug / Ingredient / Allergen / Condition / Interaction）。

### 6.6 与 Deep Agents 的关系（决策：当前不引入）

背景：Deep Agents（LangChain 官方 agent harness，`langchain-ai/deepagents`，有 Python 与 JS/TS 两版）是"开箱即用"的 Agent 运行时，自带 sub-agents、context management、Skills（按需加载的可复用行为）、HITL、持久化。其 **Skills 机制与 OAG 步骤⑤ 的"Skill 声明式定义"是同一概念**，且官方实现开箱即用。

**结论：本计划（Phase 4 OAG）不引入 Deep Agents，维持自建 LangGraph runtime 消费 Skill 声明式定义。**

理由：

- **同层替代而非底层组件**：Lucent 已有自建 LangGraph runtime（`src/modules/assistant/agent/runtime/`：classify → router → agent↔tools → subgraphs → respond + HITL 审批 + Postgres checkpointer）。Deep Agents 与它是同一层的两套实现，引入 = 替换而非叠加，需迁移 22 个领域工具、3 个子图、HITL 提案与三仓持久化，成本极高且推倒现有已测代码。
- **医疗场景要确定性**：Deep Agents 哲学是 "trust the LLM, enforce boundaries at tool level"；本计划（及 evolution plan）坚持 HITL 提案门控 + 规则路由 + 验证节点，即"不信任 LLM 的写路径"。引入 Deep Agents 反而与医疗合规方向相悖。
- **Skill gap 不需换 runtime**：本计划缺的只是"Skill 声明式加载器"，用 `skill-registry.ts`（§10 新增文件）按数据格式实现即可，由现有 runtime 消费。

**远期触发条件（满足才重新评估）**：产品出现开放域多步长任务需求（跨会话、多工具编排、子代理分派，如"连续追踪睡眠与用药关系并每周生成分析"）时，再评估 Deep Agents 的 sub-agents / context management / Skills 是否值得替换自建 runtime。该评估放 evolution plan Phase 3 之后，不进当前主线。

### 6.7 与可验证性分层的融合

- OAG 推理结果有确定性 SQL 支撑，`verifiability` 标注为 `curated`（可追溯）；
- 图遍历 / 路径查找结果附 SQL 可复现；
- 行动执行写入审计日志，符合合规要求。

### 6.8 验证

- 单元测试：本体定义校验（JSON Schema）、Skill 解析、推理查询构造；
- 集成测试：`ontology_types` 注册 → 数据同步 → 推理查询（过敏链路、成分蕴含、相互作用一跳）→ Skill 调用链路；

## 七、依赖关系

```
Phase 1 (关系化，PG18)                       Phase 2 (风险图查询，PG18)
┌─────────────────────────────┐      ┌─────────────────────────────┐
│ 1. 新建 4 张关系表 + 迁移     │      │ 1. 确定性查询：SQL JOIN      │
│ 2. ETL 脚本：JSONB → 关系行  │      │ 2. 多跳：递归 CTE            │
│ 3. RiskDetectionService 改用 │  ──► │ 3. 不依赖 AGE / PolarDB     │
│    SQL JOIN (唯一真相源)     │      │ 4. 删除内存配对 + 硬编码映射  │
│ 4. 删除 ingredient-          │      │ 5. LLM 上下文注入合法链路     │
│    canonicalization 硬编码   │      └─────────────────────────────┘
└─────────────────────────────┘

             Phase 3 (LightRAG 开放检索，PG18 + PGTableGraphStorage)
     ┌─────────────────────────────────────────────┐
     │ 1. lightrag-server (Python sidecar) 部署     │
     │ 2. PG18 作统一后端 (pgvector + 纯 SQL 图表)  │
     │ 3. 说明书/DrugBank 子集建索引 (PGTableGraph) │
     │ 4. Lucent LightRagClient 封装 + REST 接入    │
     │ 5. verifiability 分层融合 (curated/open_corpus)│
     └─────────────────────────────────────────────┘

             Phase 4 (OAG 本体增强生成，自建，复用 Phase 1 边表)
     ┌─────────────────────────────────────────────┐
     │ 1. 本体建模：LLM 辅助候选 → 人工审核         │
     │ 2. 数据集成：业务数据 → 本体实例（边表复用） │
     │ 3. 知识存储：关系表 + JSONB + pgvector        │
     │ 4. 推理引擎：递归 CTE（可选 AGE 图遍历）      │
     │ 5. LLM 集成：Skill 声明式定义 + 意图转查询    │
     │ 6. 行动执行：Action 审批 + Webhook + 审计     │
     └─────────────────────────────────────────────┘
```

- Phase 1 各子任务有依赖：3.1 建表 → 3.2 ETL → 3.3 改 Service → 3.4 清理硬编码
- Phase 2 各子任务有依赖：4.1 确定性查询 → 4.2 Prisma 集成 → 4.3 删除旧代码 → 4.4 LLM 上下文；**无数据库迁移、无图引擎依赖**
- Phase 3 前置条件：PG18 就绪（现状）；LightRAG 图存储走 PGTableGraphStorage（无扩展、无 AGE）
- Phase 3 各子任务有依赖：5.2 部署 → 5.3 数据接入 → 5.4 REST 封装 → 5.5 分层融合
- **Phase 4 依赖 Phase 1 边表**（本体实例数据底座）+ Phase 2 的 SQL/CTE 推理成果；可选 AGE（6.4 B）按 §2.3 条件引入
- **可选 AGE（4.5 / 6.4 B）**：仅当产品需要直接写 Cypher 自定义图分析时引入，独立于主线，不阻塞任何阶段

## 八、执行顺序

1. **Phase 1.1**：新建 `drug_interaction_edges`、`drug_ingredient_edges`、`ingredient_synonym_edges`、`allergen_ingredient_edges` 四张表（Prisma schema + migration）
2. **Phase 1.2**：编写 ETL 脚本 `scripts/medicine/build-graph-edges.ts`，从 JSONB 和硬编码表导入关系数据（含血缘 `source_import_id` / `data_version`；挂在 `DrugSourceImport` 导入完成后）
3. **Phase 1.3**：改造 `RiskDetectionService`，将内存 N² 配对改为 SQL JOIN 查询（边表为唯一事实源）
4. **Phase 1.4**：清理 `ingredient-canonicalization.ts`，删除硬编码 `canonicalIngredientVariants`，改为 DB 查询 + 缓存
5. **Phase 1.5**：更新测试 + 性能基准验证
6. **Phase 2.1**：风险图确定性查询（JOIN）走 `RiskDetectionService` + `RiskContextBuilderService`
7. **Phase 2.2**：Prisma `$queryRaw` 集成（标准 SQL，无 agtype 转换层）
8. **Phase 2.3**：删除 `ingredient-canonicalization.ts` 残余归一化函数
9. **Phase 2.4**：LLM 上下文注入合法链路（成分蕴含 + 过敏/禁忌链路；**禁止注入相互作用传递链**）
10. **Phase 2.5**：更新测试 + 文档
11. **Phase 3.1**：Docker 编排 `lightrag-server`（GHCR 镜像），PG18 作统一后端（`PGTableGraphStorage`，无 AGE），验证 `/health`
12. **Phase 3.2**：说明书 / DrugBank 子集（千级条）索引入库，验证增量更新
13. **Phase 3.3**：Lucent 封装 `LightRagClient` + REST 接入（`src/modules/assistant/`）
14. **Phase 3.4**：`verifiability` 分层融合，医疗 QA 受限接入（`safetyLabel` + 5 条上限）
15. **Phase 3.5**：更新测试 + 性能基准（对比纯向量召回）
16. **Phase 4.1**：本体建模——LLM 辅助生成候选 Object/Link/Action 定义，人工审核入库 `ontology_types`（含版本管理）
17. **Phase 4.2**：数据集成——ETL 将业务数据映射为本体实例（复用 Phase 1 边表 + `ontology_instances` JSONB），`DrugSourceImport` 完成后钩子触发
18. **Phase 4.3**：推理引擎 A——递归 CTE 实现过敏链路、成分蕴含、相互作用一跳（复用 Phase 2 成果）
19. **Phase 4.4**：LLM 集成——Skill 声明式定义（query / traverse / path / action），Agent 意图 → 本体查询
20. **Phase 4.5**：行动执行——Action 框架（参数校验 + 高危审批 + Webhook + 审计）
21. **Phase 4.6**：更新测试 + 文档；性能基准（对比纯 SQL vs 可选 AGE）
22. **（可选）AGE 引入**：若产品确认需要任意起点多跳遍历 / 路径查找 → 按 §2.3 条件引入 AGE 1.7（PG18 官方配方），Phase 4 推理引擎切 B 形态；LightRAG 图存储迁移 `PGTableGraphStorage → PGGraphStorage`（若同时需要）

## 九、风险与缓解

| 风险                                  | 影响                                    | 缓解                                                                                               |
| ------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **ETL 数据不一致**                    | JSONB 和关系表数据不同步                | ETL 脚本做幂等 + 全量重建；DrugBank 导入时触发增量同步；边表挂在 DrugSourceImport 完成钩子         |
| **成分归一化准确率下降**              | 从硬编码迁移到 DB 后，匹配规则变化      | Phase 1.4 保留硬编码作为 fallback；DB 查询 miss 时回退                                             |
| **Prisma `$queryRaw` 类型安全**       | 原生 SQL 返回类型不安全                 | 定义 TypeScript interface + Zod schema 验证返回                                                    |
| **用户数据进入共享知识**              | 隐私泄漏（多租户红线）                  | 边表/本体实例只含全局知识映射；用户过敏/药箱只留关系表，查询参数化 JOIN；LightRAG 语料不含个人记录 |
| **"相互作用传递"假阳性**              | 误导性风险结论（医疗事故级）            | 4.1/4.4 明确禁止该推理；LLM 上下文只注入成分蕴含 + 过敏/禁忌链路                                   |
| **图查询性能未达预期**                | 大图上可能不如预期                      | 风险图查询走关系表 + CTE（单用户子图，毫秒级）；必要时加索引/物化视图                              |
| **PGTableGraphStorage 性能/功能不足** | LightRAG 图检索质量或吞吐受限           | 官方默认后端，功能等价 AGE；若确需 Cypher 自定义分析再按 §4.5 引入 AGE（可迁移）                   |
| **LightRAG 索引成本爆炸**             | 全量 135 万 QA 建图超预算               | 首期子集跑通链路；按增量索引管线扩量；医疗 QA 受限接入；LLM token 消耗基准化                       |
| **LightRAG 引入额外 Python 运行时**   | 部署复杂度上升                          | 官方 Docker/GHCR 镜像 + Compose 编排；embedding 复用现有模型配置                                   |
| **LightRAG 与现有 RAG 行为漂移**      | 检索结果改变影响 verifiability          | 服务端分层标注逻辑不动；回归测试保输出一致                                                         |
| **OAG 本体建模质量不足**              | LLM 生成的候选本体不准，推理结果误导    | 人工审核门禁；版本管理 + 回滚；LLM 候选仅作草稿，Object/Link/Action 以审核为准                     |
| **OAG 推理性能（多跳）**              | 递归 CTE 在深跳/大图上退化              | 单用户子图毫秒级；必要时加物化视图/索引；仍不足再按 §2.3 引入 AGE 图遍历（6.4 B）                  |
| **OAG 行动执行风险（医疗决策）**      | LLM 触发错误动作（推荐错药/通知错医生） | 高危动作强制人工审批；前置条件校验；全量审计；Action 白名单 + 参数 Schema 校验                     |
| **OAG 与 RAG 结果冲突**               | 两条检索路径给不同答案                  | 明确分工（RAG 管开放语料、OAG 管本体推理）；冲突时以 OAG 确定性结果优先 + 双标可追溯               |

## 十、涉及的文件

### 新增

| 文件                                                                    | 说明                                                                                               |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `prisma/models/medicine-graph.prisma`                                   | 四张关系表的 Prisma schema                                                                         |
| `scripts/medicine/build-graph-edges.ts`                                 | ETL 导入脚本                                                                                       |
| `src/modules/medicines/services/risk/risk-graph.service.ts`             | 图查询服务（关系表 + 递归 CTE，Phase 2.3；不依赖 AGE）                                             |
| `src/modules/medicines/services/risk/risk-graph.service.spec.ts`        | 图查询测试                                                                                         |
| `src/modules/assistant/lightrag/lightrag-client.ts`                     | LightRAG REST 客户端（Phase 3）                                                                    |
| `src/modules/assistant/lightrag/lightrag-client.spec.ts`                | LightRAG 客户端测试                                                                                |
| `deploy/lightrag/`                                                      | LightRAG sidecar 部署（Dockerfile / compose 片段）                                                 |
| `prisma/models/medicine-ontology.prisma`                                | 本体元数据：`ontology_types`（Object/Link/Action 定义 + 版本）、`ontology_instances`（JSONB 属性） |
| `src/modules/medicines/services/ontology/ontology-modeling.service.ts`  | OAG 步骤①：LLM 辅助本体建模 + 人工审核（Phase 4.1）                                                |
| `src/modules/medicines/services/ontology/ontology-reasoning.service.ts` | OAG 步骤④：推理引擎（递归 CTE，可选 AGE 图遍历）（Phase 4.3）                                      |
| `src/modules/medicines/services/ontology/skill-registry.ts`             | OAG 步骤⑤：Skill 声明式定义（query / traverse / path / action）                                    |
| `src/modules/medicines/services/ontology/action-executor.ts`            | OAG 步骤⑥：Action 执行（参数校验 + 高危审批 + Webhook + 审计）                                     |
| `src/modules/medicines/services/ontology/*.spec.ts`                     | OAG 各服务测试                                                                                     |

### 修改

| 文件                                                                  | 说明                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `prisma/schema.prisma`                                                | 引用新的 `medicine-graph.prisma`                                         |
| `src/modules/medicines/services/risk/risk-detection.service.ts`       | 内存配对 → SQL JOIN（边表为唯一事实源；不依赖 AGE）                      |
| `src/modules/medicines/services/risk/risk-context-builder.service.ts` | 注入图查询结果到 LLM 上下文                                              |
| `src/modules/medicines/utils/ingredient-canonicalization.ts`          | 删除硬编码，保留纯函数                                                   |
| `src/modules/medicines/medicines.module.ts`                           | 注册新 service（risk-graph + ontology 相关）                             |
| `docker-compose.dev.yml`                                              | 新增 lightrag 服务                                                       |
| `deploy/compose.yml`                                                  | 新增 lightrag 服务                                                       |
| `.github/workflows/lucent-ci.yml`                                     | CI 镜像检查（保持 PG18）                                                 |
| `package.json`                                                        | 新增 `import:graph-edges`、`lightrag:*` 脚本                             |
| `prisma/models/medicine-knowledge.prisma`                             | 边表血缘：`source_import_id` / `data_version` 引用 `drug_source_imports` |
| `docs/01-reference/environment.md`                                    | 记录 LightRAG 环境变量、AGE 版本（钉 1.7）、OAG 相关配置                 |
| `docs/02-logs/migration-log/YYYY-MM-DD.md`                            | 迁移日志                                                                 |

### 删除（Phase 2 / Phase 3 完成后）

| 文件/代码                                                         | 说明                |
| ----------------------------------------------------------------- | ------------------- |
| `ingredient-canonicalization.ts` 中 `canonicalIngredientVariants` | 硬编码表已迁移到 DB |
| `risk-detection.service.ts` 中内存配对方法                        | 已改为图查询        |
