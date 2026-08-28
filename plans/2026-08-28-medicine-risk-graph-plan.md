# 药品风险检查图数据结构引入计划

Created: 2026-08-28

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

| 痛点                          | 位置                                                                                                 | 影响                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **N² 笛卡尔积**               | `risk-detection.service.ts` 第 93-104 行：`for i, for j=i+1` 两两配对，每次重新提取 token 集合做交集 | 用户药品越多，延迟平方级增长                          |
| **成分归一化硬编码**          | `ingredient-canonicalization.ts` 第 5-31 行：仅 15 个成分别名映射，手工维护                          | 新药品成分不在此表则回退为原始 token，准确性下降      |
| **DrugBank 交互数据是 JSONB** | `DrugbankDrug.drugInteractions` 是 JSONB，非关系表                                                   | 查询必须先拉出整行再内存中解析，无法做高效 join       |
| **CN↔DrugBank 两张孤岛表**    | `CnMedicineProduct` 和 `DrugbankDrug` 无关系关联                                                     | 跨源的交互检测完全靠文本匹配                          |
| **过敏匹配是字符串包含**      | `risk-detection.service.ts` 第 124-178 行：`includes` 匹配                                           | "青霉素" 匹配 "青霉素V钾片" 但匹配不到 "penicillin"   |
| **无传递性推理**              | 整个 `RiskDetectionService`                                                                          | A→B 有共同成分、B→C 有相互作用，无法推导 A→C 间接风险 |

### 1.3 目标

将 JSONB 数据和硬编码映射关系化，利用 PG19 SQL/PGQ 原生图查询能力，把 N² 内存配对降为数据库图遍历，并解锁多跳间接风险推理。

## 二、技术选型：PostgreSQL 19 SQL/PGQ

### 2.1 为什么选 SQL/PGQ

PostgreSQL 19 原生引入了 **SQL/PGQ**（SQL 标准的 Property Graph Query），核心特性：

- **不是独立图数据库**——在现有关系表之上定义图视图（read-only view），数据底层还是关系表
- **`GRAPH_TABLE` 语法**——用 `MATCH` 子句做图模式匹配，表达力远超 SQL JOIN
- **关系查询与图查询可混合**——同一 SQL 中 JOIN 和 `GRAPH_TABLE` 共存
- **零新组件**——纯 PG 升级，不引入 Neo4j / Memgraph 等额外数据库

### 2.2 约束

- **PG19 当前为 Beta 3**（2026-08-13 发布），正式发布前不上生产
- **SQL/PGQ 图定义是只读视图**——写入仍走关系表 INSERT/UPDATE，风险检查是纯读操作，无冲突
- **Prisma 不支持 `GRAPH_TABLE`**——需用 `$queryRaw` 原生 SQL 或包成 SQL view
- **pgvector 需跟进支持 PG19**——可能存在滞后

### 2.3 PG19 SQL/PGQ vs Apache AGE 深度对比

两个方案都是在 PostgreSQL 内做图查询，不引入独立图数据库。但架构理念、成熟度、功能范围差异很大。

#### 2.3.1 架构理念

| 维度                 | PG19 SQL/PGQ                                                | Apache AGE                                                                     |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **本质**             | SQL 标准的图查询语法，PG 内核原生实现                       | PostgreSQL 扩展（C 扩展），独立图存储引擎                                      |
| **数据存储**         | 数据在现有关系表中，图是只读视图（`CREATE PROPERTY GRAPH`） | 数据在 AGE 自己的 `_ag_label_vertex` / `_ag_label_edge` 表中，图是独立命名空间 |
| **写入能力**         | 只读——图查询不能写，写入走关系表 INSERT/UPDATE              | 可读写——Cypher `CREATE` / `DELETE` / `SET` 直接写图数据                        |
| **与关系数据的关系** | 图定义在现有表之上，不复制数据                              | 图是独立存储，需要从关系表导入或用 Cypher CREATE 写入                          |

#### 2.3.2 查询语言

| 维度            | PG19 SQL/PGQ                                                               | Apache AGE                                                                                          |
| --------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **语言**        | `GRAPH_TABLE` + `MATCH`（SQL 标准的一部分）                                | openCypher（Neo4j 的 Cypher 方言）                                                                  |
| **语法风格**    | 嵌入 SQL：`SELECT ... FROM GRAPH_TABLE(g MATCH (a)-[e]->(b) COLUMNS(...))` | 嵌入 SQL：`SELECT * FROM cypher('g', $$ MATCH (a)-[e]->(b) RETURN a, b $$) AS (a agtype, b agtype)` |
| **返回类型**    | 标准 SQL 列，直接兼容 Prisma `$queryRaw`                                   | `agtype`（AGE 自定义类型），需要转换才能在 SQL 中使用                                               |
| **与 SQL 混合** | 原生混合——`GRAPH_TABLE` 子句可 JOIN 其他表、CTE、子查询                    | 有限混合——`cypher()` 函数可在 CTE / JOIN 中使用，但 `agtype` 转换有摩擦                             |
| **多跳遍历**    | 路径模式：`(a)-[:edge]->(b)-[:edge]->(c)`                                  | 变长边：`(a)-[:edge*2..3]->(c)`，支持 `*min..max` 语法                                              |
| **图算法**      | 不内置                                                                     | 不内置（需自建或用 AGE Viewer）                                                                     |

**语法对比示例——药物相互作用检测：**

PG19 SQL/PGQ：

```sql
SELECT d1.name AS drug_a, d2.name AS drug_b, e.description AS evidence
FROM GRAPH_TABLE (medicine_risk_graph
  MATCH (d1 IS drug)-[e IS interacts_with]->(d2 IS drug)
  COLUMNS (d1.name AS drug_a, d2.name AS drug_b, e.description AS evidence)
)
WHERE d1.drugbank_id = ANY($1::text[]);
```

Apache AGE：

```sql
SELECT * FROM cypher('medicine_risk_graph', $$
  MATCH (d1:drug)-[e:interacts_with]->(d2:drug)
  WHERE d1.drugbank_id IN $drugIds
  RETURN d1.name, d2.name, e.description
$$) AS (drug_a agtype, drug_b agtype, evidence agtype);
-- 注意：返回值是 agtype，需要 ->> 或 ::text 转换
```

#### 2.3.3 成熟度与 PG 版本兼容

| 维度              | PG19 SQL/PGQ                                    | Apache AGE                                                |
| ----------------- | ----------------------------------------------- | --------------------------------------------------------- |
| **当前状态**      | PG19 Beta 3（2026-08-13），正式版预计 2026 年内 | Apache 顶级项目，最新 v1.5.0-rc0                          |
| **PG 版本支持**   | 仅 PG19+                                        | PG 11–18（广泛覆盖），PG19 在 roadmap                     |
| **生产验证**      | 无（Beta）                                      | 有一定社区使用量，但大规模生产案例较少                    |
| **pgvector 共存** | 需等 pgvector 跟进 PG19                         | 已与 pgvector 有集成提案（#1121），可在 PG16/17/18 上共存 |
| **标准符合**      | SQL/PGQ 是 ISO/IEC 9075-16 标准                 | openCypher 是社区标准（非 ISO）                           |

**关键差异**：AGE 现在就能在 PG18 上跑，不需要等 PG19 正式发布。但 AGE 是独立存储——需要把 DrugBank 数据导入 AGE 图命名空间，不能直接在现有关系表上定义图视图。

#### 2.3.4 运维与集成

| 维度            | PG19 SQL/PGQ                             | Apache AGE                                                                                     |
| --------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **安装**        | PG19 内置，无需安装扩展                  | `CREATE EXTENSION age;` 需编译安装 C 扩展                                                      |
| **Docker**      | `pgvector/pgvector:pg19`（待发布）       | `apache/age` 官方镜像已有                                                                      |
| **数据同步**    | 无需同步——图定义在现有表上               | 需 ETL：关系表 → AGE 图表（或用 Cypher CREATE 实时写）                                         |
| **数据一致性**  | 强一致——图查询直接读关系表，无副本       | 有一致性风险——AGE 图表和关系表是两份数据                                                       |
| **事务**        | 完全共享 PG 事务                         | 共享 PG 事务，但 `ag_catalog` 写入有事务可见性陷阱（见 AGE README 中的 psycopg/JDBC 注意事项） |
| **Prisma 集成** | `$queryRaw` 原生 SQL，返回标准类型       | `$queryRaw` 可用，但 `agtype` 返回需要类型转换层                                               |
| **备份恢复**    | 标准 `pg_dump`——图定义是 DDL，数据在原表 | `pg_dump` 会备份 AGE 的表，但图结构恢复需 `ag_catalog` 完整                                    |

#### 2.3.5 对本项目的适配分析

| 评估维度                 | PG19 SQL/PGQ                                                 | Apache AGE                                            | 评分    |
| ------------------------ | ------------------------------------------------------------ | ----------------------------------------------------- | ------- |
| **风险检查是只读**       | ✅ 完美匹配——图视图只读，写入走关系表                        | ⚠️ 可用但浪费——AGE 的读写能力对本场景无价值           | PG19 ✅ |
| **现有表结构已完善**     | ✅ 直接在 `drugbank_drugs` / `cn_medicine_products` 上定义图 | ❌ 需重新导入数据到 AGE 的 `_ag_label_*` 表           | PG19 ✅ |
| **CN↔DrugBank 跨源**     | ✅ 用同一 label `drug` 暴露两张表                            | ⚠️ 需在 AGE 中统一为同一 vertex label，导入逻辑更复杂 | PG19 ✅ |
| **不引入数据一致性风险** | ✅ 无副本                                                    | ❌ 两份数据（关系表 + AGE 图表）需同步                | PG19 ✅ |
| **现在可用**             | ❌ 需等 PG19 GA                                              | ✅ PG18 上立刻可用                                    | AGE ✅  |
| **pgvector 共存**        | ❌ 需等 pgvector 跟进 PG19                                   | ✅ 可在 PG18 上与 pgvector 共存                       | AGE ✅  |
| **查询语法简洁**         | ✅ `GRAPH_TABLE` 返回标准 SQL 类型                           | ⚠️ `agtype` 转换有摩擦                                | PG19 ✅ |
| **社区与长期维护**       | ✅ PG 核心团队维护，标准协议                                 | ⚠️ Apache 社区，活跃度中等                            | PG19 ✅ |

#### 2.3.6 结论

| 方案             | 适合场景                                 | 本项目结论                                                                                           |
| ---------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **PG19 SQL/PGQ** | 数据已关系化、查询为主、不需要图写入     | ✅ **首选**——Phase 1 关系化后直接在表上定义图视图，零数据副本                                        |
| **Apache AGE**   | 需要图写入、需要在 PG18 上立即使用图查询 | ⚠️ **备选**——如果 PG19 GA 延迟超过预期且急需图查询，可临时使用。但数据同步开销和 `agtype` 摩擦是缺点 |
| Neo4j            | 需要专业图算法、大规模图遍历             | ❌ 运维成本过高，不在考虑范围                                                                        |

**最终路线**：

- **Phase 1**（PG18）：关系化 JSONB 数据 → SQL JOIN 查询。不依赖任何图扩展
- **Phase 2**（PG19 GA 后）：`CREATE PROPERTY GRAPH` + `GRAPH_TABLE`。不选 AGE，因为：
  1. 风险检查是纯读场景，AGE 的读写能力无价值
  2. 数据已在关系表中，PG19 直接在表上定义图视图，零副本
  3. `GRAPH_TABLE` 返回标准 SQL 类型，Prisma `$queryRaw` 无缝集成
  4. PG 核心团队维护，长期稳定性优于 Apache 社区项目
- **如果 PG19 GA 延迟超预期**（如 2027Q1 仍未发布），可评估 AGE 作为 Phase 2 的临时替代，但需接受数据同步和 `agtype` 转换成本

## 三、Phase 1：JSONB → 关系表（PG18 可立即执行）

### 3.1 新增关系表

#### 3.1.1 `drug_interaction_edges` — 药物相互作用边

```prisma
model DrugInteractionEdge {
  id           String   @id @default(uuid())
  drugAId      String   @map("drug_a_id")   // DrugbankDrug.drugbankId
  drugBId      String   @map("drug_b_id")   // 被交互药品的 drugbankId
  description  String?
  source       String   @default("drugbank") // "drugbank" | "cn" | "inferred"
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  @@unique([drugAId, drugBId, source])
  @@index([drugAId])
  @@index([drugBId])
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
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  @@unique([drugSource, drugRefId, ingredientKey])
  @@index([drugSource, drugRefId])
  @@index([ingredientKey])
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

将 `risk-detection.service.ts` 中的内存配对逻辑逐步改为 SQL JOIN 查询：

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

## 四、Phase 2：引入 SQL/PGQ 图查询（PG19 正式发布后）

### 4.1 前置条件

- [ ] PG19 正式发布
- [ ] pgvector 发布支持 PG19 的镜像
- [ ] `docker-compose.dev.yml` 和 `deploy/compose.yml` 升级到 `pgvector/pgvector:pg19`

### 4.2 定义属性图

```sql
CREATE PROPERTY GRAPH medicine_risk_graph
  VERTEX TABLES (
    drugbank_drugs       LABEL drug,
    cn_medicine_products LABEL drug,
    user_allergies       LABEL allergen,
    user_conditions      LABEL condition,
    drugbank_targets     LABEL target,
    drug_ingredient_edges LABEL ingredient
  )
  EDGE TABLES (
    drug_interaction_edges
      SOURCE drugbank_drugs DESTINATION drugbank_drugs LABEL interacts_with,
    drug_ingredient_edges
      SOURCE drugbank_drugs DESTINATION drug_ingredient_edges LABEL has_ingredient,
    drug_ingredient_edges
      SOURCE cn_medicine_products DESTINATION drug_ingredient_edges LABEL has_ingredient,
    allergen_ingredient_edges
      SOURCE user_allergies DESTINATION drug_ingredient_edges LABEL allergic_to,
    drugbank_drug_targets
      SOURCE drugbank_drugs DESTINATION drugbank_targets LABEL targets
  );
```

### 4.3 图查询替代 SQL JOIN

**药物相互作用（一跳）：**

```sql
SELECT d1.name AS drug_a, d2.name AS drug_b, e.description AS evidence
FROM GRAPH_TABLE (medicine_risk_graph
  MATCH (d1 IS drug)-[e IS interacts_with]->(d2 IS drug)
  COLUMNS (d1.name AS drug_a, d2.name AS drug_b, e.description AS evidence)
)
WHERE d1.drugbank_id = ANY($drugIds)
  AND d2.drugbank_id = ANY($drugIds)
  AND d1.drugbank_id < d2.drugbank_id;
```

**重复成分（两跳）：**

```sql
SELECT d1.name AS drug_a, d2.name AS drug_b, i.ingredient_key
FROM GRAPH_TABLE (medicine_risk_graph
  MATCH (d1 IS drug)-[:has_ingredient]->(i IS ingredient)<-[:has_ingredient]-(d2 IS drug)
  COLUMNS (d1.name AS drug_a, d2.name AS drug_b, i.ingredient_key AS ingredient_key)
)
WHERE d1.name < d2.name;
```

**过敏匹配（两跳）：**

```sql
SELECT d.name AS drug_name, a.label AS allergen, i.ingredient_key
FROM GRAPH_TABLE (medicine_risk_graph
  MATCH (a IS allergen)-[:allergic_to]->(i IS ingredient)<-[:has_ingredient]-(d IS drug)
  COLUMNS (d.name AS drug_name, i.ingredient_key AS ingredient_key)
)
JOIN user_allergies a ON a.label = a.label
WHERE a.user_id = $userId AND a.is_active = true;
```

**间接风险链路（三跳，当前不支持）：**

```sql
SELECT d1.name, d2.name, d3.name
FROM GRAPH_TABLE (medicine_risk_graph
  MATCH (d1 IS drug)-[:has_ingredient]->(i IS ingredient)
        <-[:has_ingredient]-(d2 IS drug)-[e IS interacts_with]->(d3 IS drug)
  COLUMNS (d1.name AS drug1, d2.name AS drug2, d3.name AS drug3)
)
WHERE d1.name NOT IN (d2.name, d3.name);
```

### 4.4 Prisma 集成

```typescript
// 方式 1：$queryRaw 原生 SQL
const interactions = await this.prisma.$queryRaw<InteractionRow[]>`
  SELECT d1.name AS drug_a, d2.name AS drug_b, e.description AS evidence
  FROM GRAPH_TABLE (medicine_risk_graph
    MATCH (d1 IS drug)-[e IS interacts_with]->(d2 IS drug)
    COLUMNS (d1.name AS drug_a, d2.name AS drug_b, e.description AS evidence)
  )
  WHERE d1.drugbank_id = ANY(${drugIds}::text[])
    AND d2.drugbank_id = ANY(${drugIds}::text[])
`;

// 方式 2：SQL view + Prisma 模型映射
// CREATE VIEW medicine_interactions_view AS SELECT ... FROM GRAPH_TABLE (...);
// Prisma schema: model MedicineInteractionsView { ... @@map("medicine_interactions_view") }
```

### 4.5 删除的代码

Phase 2 完成后可删除：

- `ingredient-canonicalization.ts` 中的 `canonicalIngredientKeysFor`、`expandCanonicalIngredientTokens`（图遍历自动传递）
- `risk-detection.service.ts` 中的内存 `pairInteractionFinding`、`duplicateIngredientFinding`、`allergyFindings` 方法
- `risk-context-builder.service.ts` 中手工拼接 findings 的逻辑

### 4.6 LLM 上下文增强

`RiskContextBuilderService` 注入图查询结果时，可以包含多跳链路：

```typescript
// 新增：间接风险链路
const indirectChains = await this.prisma.$queryRaw`
  SELECT d1.name, d2.name, d3.name, e.description
  FROM GRAPH_TABLE (medicine_risk_graph
    MATCH (d1 IS drug)-[:has_ingredient]->(i IS ingredient)
          <-[:has_ingredient]-(d2 IS drug)-[e IS interacts_with]->(d3 IS drug)
    COLUMNS (d1.name AS drug1, d2.name AS drug2, d3.name AS drug3, e.description AS evidence)
  )
`;

// 注入 LLM prompt
context.indirectRiskChains = indirectChains;
```

## 五、依赖关系

```
Phase 1 (PG18)                              Phase 2 (PG19)
┌─────────────────────────────┐            ┌─────────────────────────────┐
│ 1. 新建 4 张关系表 + 迁移     │            │ 1. 升级 PG19 + pgvector      │
│ 2. ETL 脚本：JSONB → 关系行  │  ───────►  │ 2. CREATE PROPERTY GRAPH    │
│ 3. RiskDetectionService 改用 │  PG19 GA   │ 3. GRAPH_TABLE 查询替代 JOIN │
│    SQL JOIN                 │            │ 4. 删除内存配对 + 硬编码映射  │
│ 4. 删除 ingredient-          │            │ 5. LLM 上下文注入多跳链路     │
│    canonicalization 硬编码   │            │                              │
└─────────────────────────────┘            └─────────────────────────────┘
```

- Phase 1 各子任务有依赖：3.1 建表 → 3.2 ETL → 3.3 改 Service → 3.4 清理硬编码
- Phase 2 前置条件：PG19 正式发布 + pgvector 支持
- Phase 2 各子任务有依赖：4.1 升级 → 4.2 建图 → 4.3 图查询 → 4.5 删除旧代码

## 六、执行顺序

1. **Phase 1.1**：新建 `drug_interaction_edges`、`drug_ingredient_edges`、`ingredient_synonym_edges`、`allergen_ingredient_edges` 四张表（Prisma schema + migration）
2. **Phase 1.2**：编写 ETL 脚本 `scripts/medicine/build-graph-edges.ts`，从 JSONB 和硬编码表导入关系数据
3. **Phase 1.3**：改造 `RiskDetectionService`，将内存 N² 配对改为 SQL JOIN 查询
4. **Phase 1.4**：清理 `ingredient-canonicalization.ts`，删除硬编码 `canonicalIngredientVariants`，改为 DB 查询 + 缓存
5. **Phase 1.5**：更新测试 + 性能基准验证
6. **Phase 2.1**：（PG19 GA 后）升级 Docker 镜像 + CI 配置
7. **Phase 2.2**：定义 `CREATE PROPERTY GRAPH`
8. **Phase 2.3**：`RiskDetectionService` 改用 `GRAPH_TABLE` 查询
9. **Phase 2.4**：删除 `ingredient-canonicalization.ts` 中残余的归一化函数
10. **Phase 2.5**：LLM 上下文注入多跳间接风险链路
11. **Phase 2.6**：更新测试 + 文档

## 七、风险与缓解

| 风险                            | 影响                               | 缓解                                                           |
| ------------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| **ETL 数据不一致**              | JSONB 和关系表数据不同步           | ETL 脚本做幂等 + 全量重建；DrugBank 导入时触发增量同步         |
| **成分归一化准确率下降**        | 从硬编码迁移到 DB 后，匹配规则变化 | Phase 1.4 保留硬编码作为 fallback；DB 查询 miss 时回退         |
| **Prisma `$queryRaw` 类型安全** | 原生 SQL 返回类型不安全            | 定义 TypeScript interface + Zod schema 验证返回                |
| **PG19 发布延迟**               | Phase 2 阻塞                       | Phase 1 的 SQL JOIN 方案已足够解决 N² 瓶颈；Phase 2 是锦上添花 |
| **pgvector 滞后 PG19**          | 无法同时用 pgvector + SQL/PGQ      | Phase 2 等 pgvector 跟进；如长期不跟进，评估 Apache AGE 替代   |
| **图查询性能未达预期**          | `GRAPH_TABLE` 在大图上可能不如预期 | 先在 dev 环境做基准测试；保留 SQL JOIN 作为 fallback           |

## 八、涉及的文件

### 新增

| 文件                                                             | 说明                       |
| ---------------------------------------------------------------- | -------------------------- |
| `prisma/models/medicine-graph.prisma`                            | 四张关系表的 Prisma schema |
| `scripts/medicine/build-graph-edges.ts`                          | ETL 导入脚本               |
| `src/modules/medicines/services/risk/risk-graph.service.ts`      | 图查询服务（Phase 2）      |
| `src/modules/medicines/services/risk/risk-graph.service.spec.ts` | 图查询测试                 |

### 修改

| 文件                                                                  | 说明                              |
| --------------------------------------------------------------------- | --------------------------------- |
| `prisma/schema.prisma`                                                | 引用新的 `medicine-graph.prisma`  |
| `src/modules/medicines/services/risk/risk-detection.service.ts`       | 内存配对 → SQL JOIN / GRAPH_TABLE |
| `src/modules/medicines/services/risk/risk-context-builder.service.ts` | 注入图查询结果到 LLM 上下文       |
| `src/modules/medicines/utils/ingredient-canonicalization.ts`          | 删除硬编码，保留纯函数            |
| `src/modules/medicines/medicines.module.ts`                           | 注册新 service                    |
| `docker-compose.dev.yml`                                              | PG18 → PG19（Phase 2）            |
| `deploy/compose.yml`                                                  | PG18 → PG19（Phase 2）            |
| `.github/workflows/lucent-ci.yml`                                     | CI 镜像升级（Phase 2）            |
| `package.json`                                                        | 新增 `import:graph-edges` 脚本    |
| `docs/01-reference/environment.md`                                    | 记录 PG 版本变更                  |
| `docs/02-logs/migration-log/YYYY-MM-DD.md`                            | 迁移日志                          |

### 删除（Phase 2 完成后）

| 文件/代码                                                         | 说明                |
| ----------------------------------------------------------------- | ------------------- |
| `ingredient-canonicalization.ts` 中 `canonicalIngredientVariants` | 硬编码表已迁移到 DB |
| `risk-detection.service.ts` 中内存配对方法                        | 已改为图查询        |
