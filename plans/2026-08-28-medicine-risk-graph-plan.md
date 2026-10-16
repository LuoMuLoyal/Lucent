# 药品风险检查图数据结构引入计划

Created: 2026-08-28
Revised: 2026-09-05（技术选型变更：PG19 SQL/PGQ → PolarDB PG17 + AGE/openCypher；评审修订：AGE 定位为 LightRAG 图存储后端而非风险图查询、删除相互作用传递推理、用户数据隔离、AGE 版本钉 1.7、边表血缘、PolarDB 迁移独立任务线）
Revised: 2026-09-06（PolarDB Ontology 引擎实测评测：自托管镜像不包含 Ontology/AGE/pgvector，仅含 pase 向量扩展；确认 OAG 全链路在自托管环境需自建；新增 Phase 4：OAG 本体增强生成）
Revised: 2026-09-06（Semantica 替代路线：OAG 六步中本体建模/知识存储/推理引擎可收敛为 semantica sidecar（Python, MIT），保留 Skill 声明式加载与 Action 执行在 Lucent 侧；方案取舍见 §6.9）
Revised: 2026-10-16（按三份独立计划的落地结果收窄本计划范围，见 §0）

## 〇、范围收窄说明（2026-10-16）

本计划原有的四个 Phase 中，两个已被独立计划接管并落地，一个（Phase 1 关系化）尚未开工。修订后本计划的**有效范围只剩 Phase 1 + Phase 2**：

| Phase                         | 原内容                                       | 现状                                                                                                                                                                                         |
| ----------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 1** 关系表 + ETL      | 四张边表、`RiskDetectionService` 改 SQL JOIN | **未开工**（`prisma/` 无 `drug_interaction_edges` 等表，`risk-detection.service.ts` 仍内存配对）。本计划的主体。                                                                             |
| **Phase 2** 风险图查询        | 关系表 + 递归 CTE                            | **未开工**，依赖 Phase 1。                                                                                                                                                                   |
| ~~Phase 3~~ LightRAG 开放检索 | 中文散文检索层                               | **已由 `2026-09-16-lightrag-introduction-plan.md` 独立落地**（P1/P3 完成，2026-09-18），工具为 `search_cn_medicine_knowledge`。本计划 §5 整章作废，不再作为 LightRAG 的执行源。              |
| ~~Phase 4~~ OAG 本体增强生成  | 本体建模 + 推理 + Skill/Action               | **已收敛为 Semantica sidecar 并落地**（ADR-0021 英文侧 OAG + ADR-0022 图后端 Neo4j；`reason_over_ontology` / `reason_over_rules` 两个工具在线）。本计划 §6 整章作废，不再作为 OAG 的执行源。 |

同时删除的过时表述：AGE 已整体退役（ADR-0022 决定 AGE → Neo4j，2026-10-01 清理镜像与元数据），本文所有「可选 AGE」「PGGraphStorage」表述一律不再有效；`PGTableGraphStorage` 随 Phase 3 一并作废。

**剩余执行顺序**：Phase 1 → Phase 2。两者都不依赖任何图引擎或新服务，纯标准 PostgreSQL 关系化改造。

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

将 JSONB 数据和硬编码映射关系化，利用标准 PostgreSQL 18 的关系 + pgvector 能力，把 N² 内存配对降为 SQL JOIN。风险图的确定性推理（成分共享、过敏/禁忌链路）由关系表 + SQL/递归 CTE 承载，**不依赖任何图引擎**。

> 原目标里的「AGE 作为 LightRAG / OAG 的图存储后端」已随 AGE 整体退役（ADR-0022：图后端改 Neo4j）作废，见 §0。

## 二、技术选型：标准 PostgreSQL 18 + pgvector

### 2.1 选型结论

维持现状的标准 PostgreSQL 18 + pgvector，**不换库、不引入任何图扩展**。

理由：

- **PolarDB 的「集成 AGE + pgvector」优势在自托管下不成立**，且 AGE 已于 2026-10-01 整体退役（ADR-0022），该路线彻底出局。
- **风险图本体只需关系表 + SQL/递归 CTE**（Phase 1/2），不依赖任何图引擎。
- 检索层的图能力已由两个独立计划分别落地：中文散文检索走 LightRAG sidecar（`2026-09-16-lightrag-introduction-plan.md`），英文关系推理走 Semantica sidecar + Neo4j（ADR-0021/0022）。本计划不重复建设。
- 仅在确认产品需要**直接对图执行 openCypher**（如「成分网络浏览器」：遍历共享成分的多跳链路、图可视化分析）时，才值得重新评估图引擎；届时按 ADR-0022 的 Neo4j 路线考虑，**不再考虑 AGE**。

### 2.4 与 LightRAG / Semantica 两个已落地计划的关系

原 §2.4（PolarDB Ontology 引擎实测）与 §2.5（PG19 SQL/PGQ）讨论的都是「图存储/推理引擎选型」，该问题已由两份独立计划分别闭环，本节改为关系说明：

| 能力                                         | 归属                                                          | 落地状态                                                    |
| -------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| 中文散文检索（说明书 / QA）                  | `2026-09-16-lightrag-introduction-plan.md` + LightRAG sidecar | P1/P3 已落地（2026-09-18）                                  |
| 英文关系推理（DrugBank 相互作用 / 本体推导） | ADR-0021（英文侧 OAG）+ ADR-0022（Neo4j）+ Semantica sidecar  | 已落地（`reason_over_ontology` / `reason_over_rules` 在线） |
| **风险检查的确定性关系查询（本计划）**       | Phase 1 边表 + Phase 2 CTE                                    | **未开工**                                                  |

三者语料与职责不重叠：LightRAG 管中文散文、Semantica 管英文本体推理、本计划管「用户药箱的风险检查」这条确定性链路。原 §5、§6 两章随 Phase 3/4 作废删除（见 §0）。

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

> 原 §4.5「AGE（可选，不阻塞当前）」已删除：AGE 已于 2026-10-01 整体退役（ADR-0022，图后端改 Neo4j），不再是可选项。若将来确需直接对图执行 openCypher，按 ADR-0022 的 Neo4j 路线重新立项，不考虑 AGE。

## 五、（已作废）Phase 3 / Phase 4

原 §5「Phase 3：LightRAG 图增强检索（开放检索层）」整章作废——中文散文检索层已由
`plans/2026-09-16-lightrag-introduction-plan.md` 独立立项并落地（P1/P3 完成于 2026-09-18），
工具为 `search_cn_medicine_knowledge`，检索层单点与 `retrieval_unavailable` 语义均已闭环。

原 §6「Phase 4：OAG 本体增强生成」整章作废——英文侧本体推理已收敛为 Semantica sidecar + Neo4j，
决策见 `docs/reference/adr/0021-semantica-english-side-oag.md` 与
`docs/reference/adr/0022-graph-backend-neo4j.md`；`reason_over_ontology` / `reason_over_rules`
两个工具在线，剩余运维项登记在 `docs/TODO.md`「2026-09-19 英文侧 OAG（Semantica）剩余项」。

AGE 相关表述（§4.5 与上述两章内的 `PGGraphStorage` / 钉 1.7 / LightRAG 图存储后端对比）
已随 2026-10-01 的 AGE 整体退役（ADR-0022）一并失效，不再作为任何决策依据。

## 七、依赖关系

```
Phase 1 (关系化，PG18)                       Phase 2 (风险图查询，PG18)
┌─────────────────────────────┐      ┌─────────────────────────────┐
│ 1. 新建 4 张关系表 + 迁移     │      │ 1. 确定性查询：SQL JOIN      │
│ 2. ETL 脚本：JSONB → 关系行  │      │ 2. 多跳：递归 CTE            │
│ 3. RiskDetectionService 改用 │  ──► │ 3. 删除内存配对 + 硬编码映射  │
│    SQL JOIN (唯一真相源)     │      │ 4. 删除内存配对 + 硬编码映射  │
│ 4. 删除 ingredient-          │      │ 5. LLM 上下文注入合法链路     │
│    canonicalization 硬编码   │      └─────────────────────────────┘
└─────────────────────────────┘

```

- Phase 1 各子任务有依赖：3.1 建表 → 3.2 ETL → 3.3 改 Service → 3.4 清理硬编码
- Phase 2 各子任务有依赖：4.1 确定性查询 → 4.2 Prisma 集成 → 4.3 删除旧代码 → 4.4 LLM 上下文；**无数据库迁移、无图引擎依赖**
- 两个 Phase 都不依赖 LightRAG / Semantica / Neo4j / AGE 中的任何一个——它们是独立的检索层，本计划只做风险检查的确定性链路。

## 八、执行顺序

1. **Phase 1.1**：新建 `drug_interaction_edges`、`drug_ingredient_edges`、`ingredient_synonym_edges`、`allergen_ingredient_edges` 四张表（Prisma schema + migration）
2. **Phase 1.2**：编写 ETL 脚本 `scripts/medicine/build-graph-edges.ts`，从 JSONB 和硬编码表导入关系数据（含血缘 `source_import_id` / `data_version`；挂在 `DrugSourceImport` 导入完成后）
3. **Phase 1.3**：改造 `RiskDetectionService`，将内存 N² 配对改为 SQL JOIN 查询（边表为唯一事实源）
4. **Phase 1.4**：清理 `ingredient-canonicalization.ts`，删除硬编码 `canonicalIngredientVariants`，改为 DB 查询 + 缓存
5. **Phase 1.5**：更新测试 + 性能基准验证
6. **Phase 2.1**：风险图确定性查询（JOIN）走 `RiskDetectionService` + `RiskContextBuilderService`
7. **Phase 2.2**：Prisma `$queryRaw` 集成（标准 SQL）
8. **Phase 2.3**：删除 `ingredient-canonicalization.ts` 残余归一化函数
9. **Phase 2.4**：LLM 上下文注入合法链路（成分蕴含 + 过敏/禁忌链路；**禁止注入相互作用传递链**）
10. **Phase 2.5**：更新测试 + 文档

## 九、风险与缓解

| 风险                                 | 影响                               | 缓解                                                                                       |
| ------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| **ETL 数据不一致**                   | JSONB 和关系表数据不同步           | ETL 脚本做幂等 + 全量重建；DrugBank 导入时触发增量同步；边表挂在 DrugSourceImport 完成钩子 |
| **成分归一化准确率下降**             | 从硬编码迁移到 DB 后，匹配规则变化 | Phase 1.4 保留硬编码作为 fallback；DB 查询 miss 时回退                                     |
| **Prisma `$queryRaw` 类型安全**      | 原生 SQL 返回类型不安全            | 定义 TypeScript interface + Zod schema 验证返回                                            |
| **用户数据进入共享知识**             | 隐私泄漏（多租户红线）             | 边表只含全局知识映射；用户过敏/药箱只留关系表，查询参数化 JOIN                             |
| **"相互作用传递"假阳性**             | 误导性风险结论（医疗事故级）       | 4.1/4.4 明确禁止该推理；LLM 上下文只注入成分蕴含 + 过敏/禁忌链路                           |
| **图查询性能未达预期**               | 大图上可能不如预期                 | 风险图查询走关系表 + CTE（单用户子图，毫秒级）；必要时加索引/物化视图                      |
| **Phase 1 改动影响在用药检查主路径** | 改错会直接改风险检查结论           | Phase 1.3 改 Service 前后跑同一组药箱 fixture 对比；旧实现保留到评测通过再删               |

## 十、涉及的文件

### 新增

| 文件                                                             | 说明                                     |
| ---------------------------------------------------------------- | ---------------------------------------- |
| `prisma/models/medicine-graph.prisma`                            | 四张关系表的 Prisma schema               |
| `scripts/medicine/build-graph-edges.ts`                          | ETL 导入脚本                             |
| `src/modules/medicines/services/risk/risk-graph.service.ts`      | 图查询服务（关系表 + 递归 CTE，Phase 2） |
| `src/modules/medicines/services/risk/risk-graph.service.spec.ts` | 图查询测试                               |

### 修改

| 文件                                                                  | 说明                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `prisma/schema.prisma`                                                | 引用新的 `medicine-graph.prisma`                                         |
| `src/modules/medicines/services/risk/risk-detection.service.ts`       | 内存配对 → SQL JOIN（边表为唯一事实源）                                  |
| `src/modules/medicines/services/risk/risk-context-builder.service.ts` | 注入图查询结果到 LLM 上下文                                              |
| `src/modules/medicines/utils/ingredient-canonicalization.ts`          | 删除硬编码，保留纯函数                                                   |
| `src/modules/medicines/medicines.module.ts`                           | 注册新 service（risk-graph）                                             |
| `compose.dev.yaml`                                                    | dev 环境（无需新增服务：纯 PG 关系化）                                   |
| `.github/workflows/lucent-ci.yml`                                     | CI 镜像检查（保持 PG18）                                                 |
| `package.json`                                                        | 新增 `import:graph-edges` 脚本                                           |
| `prisma/models/medicine-knowledge.prisma`                             | 边表血缘：`source_import_id` / `data_version` 引用 `drug_source_imports` |
| `docs/logs/migration-log/YYYY-MM-DD.md`                               | 迁移日志                                                                 |

### 删除（Phase 2 完成后）

| 文件/代码                                                         | 说明                |
| ----------------------------------------------------------------- | ------------------- |
| `ingredient-canonicalization.ts` 中 `canonicalIngredientVariants` | 硬编码表已迁移到 DB |
| `risk-detection.service.ts` 中内存配对方法                        | 已改为图查询        |
