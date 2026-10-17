# 药品不良反应数据源引入计划

Created: 2026-10-17
Status: 未开工

## 一、背景与动机

`medicines` 模块现有药品知识全部来自两个源：DrugBank（英文科学实体）与中文药品说明书 V3。
两个源能回答"这个药是什么、怎么用、和什么药冲突"，但**回答不了"这个药本身会带来什么风险"**。

具体表现：

| 现有字段                             | 位置                      | 问题                                                         |
| ------------------------------------ | ------------------------- | ------------------------------------------------------------ |
| `CnMedicineLeaflet.adverseReactions` | 中文说明书                | **String**，一段散文。无法按不良反应反查药品，无法做频次分层 |
| `DrugbankDrug` 毒性/副作用相关资料   | `drugbank_passage_chunks` | 仅作为 RAG 检索语料，无结构化关系                            |
| `DrugbankDrug.drugInteractions`      | JSONB                     | 是"药—药相互作用"，不是"药—不良反应"                         |

也就是说：用户问"我吃的这个药会不会引起皮疹"，系统只能拿说明书文本去语义检索，
**给不出确定性的、可计数的、可跨药品聚合的答案**。

本计划引入两个公开数据源补齐这一维，二者用途不同：

- **OnSIDES** —— 「说明书声称这个药会引起什么」。FDA 结构化产品标签（SPL）抽取，带来源与频次
- **FAERS** —— 「真实世界报告这个药引起了什么」。FDA 不良事件自发报告，可做信号检测

## 二、数据源评估

### 2.1 OnSIDES（主选）

- 仓库：https://github.com/tatonetti-lab/onsides
- 许可：MIT（代码）。数据为 FDA/EMA/EMC/KEGG 公开说明书抽取
- 规模：710 万条 drug–ADE 配对、4,097 个药物成分、51,460 份说明书
- 覆盖：DailyMed（美）、EMA（欧）、EMC（英）、KEGG（日）四套监管体系
- 更新：季度更新，有 `VERSIONING.md` 与 GitHub Releases 分发
- 抽取模型：PubMedBERT 微调，开源在 HuggingFace（`tatonettilab/onsides-bert`）
- 附带：导入 PostgreSQL 的建库脚本

**为什么选它**：这是目前唯一"许可宽松 + 规模化 + 带频次与来源 + 有版本机制"的开源药品不良反应数据集。
DrugBank 的商业版本有类似数据，但许可证不允许再分发。

### 2.2 FAERS（次选，作为真实世界上报信号）

- 数据入口：openFDA `api.fda.gov/drug/event.json`（CC0，可直接商用）
- 用途：与 OnSIDES 互补 —— OnSIDES 是"标签说了什么"，FAERS 是"实际报了什
  么"。两者不一致本身就是有价值的信号（药品上市后新发现的风险）
- 信号检测算法：参考 `bips-hb/pvm`（R 包）中 ROR / PRR / BCPNN / GPS 等方法，
  **只移植公式自行实现，不引入 R 依赖**

### 2.3 明确不采用的

| 数据源                               | 原因                                                               |
| ------------------------------------ | ------------------------------------------------------------------ |
| DrugBank 商业版副作用数据            | 许可证不允许再分发                                                 |
| `MenglinLu/Web-crawler` 中文药品爬虫 | 无许可证、7 年停更、数据来源法律风险                               |
| `cutcutjust/KnowledgeGraph` 药典图谱 | AGPL-3.0 强传染 + 药典正文版权                                     |
| `ndc_map` / `dgidb` / `pvm` 本体     | 一个是分类映射、一个是药物—基因、一个是 R 包，均非不良反应关系数据 |
| SageRx                               | NOASSERTION 许可；其 ETL 能力本项目已有等价实现                    |

## 三、目标

1. 新增结构化「药品成分 — 不良反应」关系表，支持**双向查询**（药→反应、反应→药）
2. OnSIDES 数据按时可重导入，版本可追溯，复用现有 `drug_source_imports` 元数据表
3. 药品详情可展示「不良反应」区块，按频次分层（常见/少见/罕见/未知）
4. 为风险检查提供不良反应维度的确定性依据（本计划只做**数据供给**，不改
   `RiskDetectionService` 判定逻辑）
5. FAERS 信号检测作为独立离线任务，输出信号结果表，不进入实时请求链路

## 四、数据模型

新增三张表（放在 `prisma/models/medicine-knowledge.prisma`）。

### 4.1 `onsides_adverse_reactions` —— 不良反应主数据（去重字典）

```prisma
model OnsidesAdverseReaction {
  id              String   @id @default(uuid())
  /// 规范化后的反应名（小写、去空白），用于跨源匹配
  normalizedName  String   @unique @map("normalized_name")
  displayName     String   @map("display_name")
  /// Ontology 编码（若上游提供，如 MedDRA/SNOMED）
  ontologySystem  String?  @map("ontology_system")
  ontologyCode    String?  @map("ontology_code")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt       DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)

  ingredientLinks OnsidesIngredientAdverseReaction[]

  @@map("onsides_adverse_reactions")
}
```

### 4.2 `onsides_ingredient_adverse_reactions` —— 成分—反应配对（事实表）

```prisma
model OnsidesIngredientAdverseReaction {
  id                  String   @id @default(uuid())
  importRunId         String?  @map("import_run_id")
  /// 药物成分规范名，与 DrugbankDrug.ingredients 的归一化 token 对齐
  ingredientName      String   @map("ingredient_name")
  ingredientNormalized String  @map("ingredient_normalized")
  reactionId          String   @map("reaction_id")
  /// 频次分层：common / uncommon / rare / unknown
  frequencyLabel      String?  @map("frequency_label")
  /// 上游原始频次描述，保留原文以便追溯
  frequencyRaw        String?  @map("frequency_raw")
  /// 来源监管体系：dailymed / ema / emc / kegg
  sourceLabel         String   @map("source_label")
  /// 命中该配对的说明书数（可作权重）
  labelCount          Int?     @map("label_count")
  /// 上游数据版本，便于增量替换
  sourceVersion       String?  @map("source_version")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)

  importRun DrugSourceImport?       @relation(fields: [importRunId], references: [id], onDelete: SetNull)
  reaction  OnsidesAdverseReaction @relation(fields: [reactionId], references: [id], onDelete: Cascade)

  @@unique([ingredientNormalized, reactionId, sourceLabel])
  @@index([ingredientNormalized])
  @@index([reactionId])
  @@map("onsides_ingredient_adverse_reactions")
}
```

### 4.3 `faers_signal_stats` —— FAERS 信号检测结果（离线产出）

```prisma
model FaersSignalStat {
  id              String   @id @default(uuid())
  importRunId     String?  @map("import_run_id")
  drugName        String   @map("drug_name")
  drugNormalized  String   @map("drug_normalized")
  reactionName    String   @map("reaction_name")
  reactionNormalized String @map("reaction_normalized")
  /// 报告数（a）、总报告数等列联表基数
  reportCount     Int      @map("report_count")
  /// 各信号检测方法结果，JSONB 保存 {ror, prr, bcppn, gps} 及各自下限
  signalMetrics   Json     @map("signal_metrics") @db.JsonB
  /// 是否达到任一方法信号阈值
  isSignal        Boolean  @default(false) @map("is_signal")
  dataQuarter     String   @map("data_quarter")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)

  importRun DrugSourceImport? @relation(fields: [importRunId], references: [id], onDelete: SetNull)

  @@unique([drugNormalized, reactionNormalized, dataQuarter])
  @@index([drugNormalized])
  @@map("faers_signal_stats")
}
```

**索引理由**：`ingredientNormalized` 与 `reactionId` 双向查询都要走索引；
详情页查某成分的全部反应是高频路径，属性能关键路径。

## 五、实施步骤

### Phase 1 —— OnSIDES 接入（核心）

1. **取得数据**：从 OnSIDES 的 GitHub Releases 下载最新版本（记录版本号与
   release tag）。数据不在仓库内，必须在导入脚本中显式下载或从本地路径读取
2. **成分归一化**：复用 `medicines/utils/ingredient-canonicalization.ts` 的
   normalize 逻辑，把 OnSIDES 的 ingredient 名转成与 DrugBank 侧一致的 token。
   ⚠️ 现有归一化仅 15 个别名映射，OnSIDES 有 4,097 个成分，需评估覆盖率；
   覆盖不到的不丢弃，保留 `ingredientNormalized` 原值并标记低置信
3. **导入脚本**：新增 `scripts/import/medicine/import-onsides.ts`，遵循现有
   `scripts/shared/db-upsert` 的分批 upsert 模式
4. **完整性契约**：按 `Lucent/src/modules/medicines/README.md` 的要求，
   导入完成判据是**目标表行数与源文件相等**，不是脚本退出码
5. **注册命令**：在 `package.json` 增加 `import:onsides`，并接入
   `import:medicine:all` 的末尾（无外键依赖，可后置）
6. **元数据**：写入 `drug_source_imports`，`sourceKey = 'onsides-v<版本>'`

### Phase 2 —— API 与展示

7. **详情接口扩展**：`GET /api/v1/medicines/:id` 的 drugbank 分支增加
   `adverseReactions` 字段（按 frequencyLabel 分组返回，每组限量，避免响应膨胀）
8. **CN 源**：中文说明书无 ingredient 编码，**先不映射**，仅对 drugbank 源提供
9. **反向查询**：如需要「哪些药会引起皮疹」，走新增的内部查询方法，
   暂不暴露公开端点
10. **契约同步**：`pnpm export:openapi` → Luminous `bootstrap.dart`

### Phase 3 —— FAERS 信号（可选，后置）

11. 拉取 FAERS 季度数据 → 计算 ROR/PRR/BCPNN/GPS → 写入 `faers_signal_stats`
12. 作为离线任务，不进入请求链路；结果供运营侧分析与后续规则调优参考

## 六、风险与缓解

| 风险                 | 影响                             | 缓解                                                                   |
| -------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| 成分归一化覆盖率不足 | 关系表关联不上现有药品           | 先跑覆盖率统计再决定是否扩大别名表；不与 DrugBank 强绑定，允许独立查询 |
| 数据许可边界         | MIT 覆盖代码，数据来自商业说明书 | 商用前阅读 OnSIDES Limitations；保存来源与版本以便溯源                 |
| 数据体积             | 710 万配对，可能显著增大库       | 只存需要的列（不存原文），评估后按 sourceLabel 裁剪                    |
| 时效性               | 季度更新，滞后于新药             | 版本化 + 可重导入；新药缺失时回落到说明书文本 RAG                      |
| 英文数据             | 无中文说明书不良反应             | 本计划不解决；中文侧继续用说明书文本检索，后续另行立项                 |

## 七、验证方式

- 导入对账：三张表行数与源文件逐表相等
- 数据抽查：随机取 20 个 DrugBank 已知有不良反应的药品，人工核对返回结果与说明书一致
- 覆盖率统计：DrugBank 药品中能关联到 OnSIDES 成分的比例（作为是否继续投入的判据）
- e2e：详情接口新增字段的序列化与空值处理

## 八、不做什么

- 不改 `RiskDetectionService` 的判定逻辑与评分权重（本计划只供数据）
- 不做 CN ↔ OnSIDES 的跨源映射（沿用 ADR-0008 的不建桥接表决策）
- 不引入 R 运行时（pvm 只作算法参考）
- 不做 FAERS 实时查询（openFDA 有速率限制，且响应不可控）
