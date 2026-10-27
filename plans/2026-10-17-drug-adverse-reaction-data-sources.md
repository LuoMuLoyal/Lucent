# 药品不良反应数据源引入计划

Created: 2026-10-17
Updated: 2026-10-28
Status: 数据源评估已完成，待开工

## 一、背景与动机

`medicines` 模块现有药品知识全部来自两个源：DrugBank（英文科学实体）与中文药品说明书 V3。
两个源能回答"这个药是什么、怎么用、和什么药冲突"，但**回答不了"这个药本身会带来什么风险"**。

具体表现：

| 现有字段                             | 位置                            | 问题                                                         |
| ------------------------------------ | ------------------------------- | ------------------------------------------------------------ |
| `CnMedicineLeaflet.adverseReactions` | 中文说明书                      | **String**，一段散文。无法按不良反应反查药品，无法做频次分层 |
| `DrugbankDrug` 毒性/副作用相关资料   | `drugbank_passage_chunks`       | 仅作为 RAG 检索语料，无结构化关系                            |
| 药物相互作用                         | `drugbank_drug_interactions` 表 | 是"药—药相互作用"，不是"药—不良反应"                         |

> **2026-10-27 修订**：上表第二列原写 `DrugbankDrug.drugInteractions` / JSONB。该字段已在
> 2026-10-27 提升为 `drugbank_drug_interactions` 关系表（按 `drugbank_id` 与
> `interacts_with_id` 双列索引，支持反查）。**结论不变**——它记录的是药与药的关系，
> 与「药 → 不良反应」是不同维度，本计划要补的那一维仍然缺。
> 但工作量可以少一点：新表已经示范了「多值字段落关系表 + 双向索引」的做法，
> 本计划的 `ingredient × adverse_event` 可以照同一模式设计，不必再论证一次。

也就是说：用户问"我吃的这个药会不会引起皮疹"，系统只能拿说明书文本去语义检索，
**给不出确定性的、可计数的、可跨药品聚合的答案**。

本计划引入 **OnSIDES** 补齐这一维：「说明书声称这个药会引起什么」——FDA 结构化产品标签
（SPL）抽取，带来源、章节与抽取置信度。

## 二、数据源评估

### 2.1 结论

采用 OnSIDES；**不采用 FAERS**。

FAERS（openFDA 自发报告）原本作为"真实世界信号"次选，2026-10-28 决定放弃：自发报告存在
上报偏倚、重复报告与适应症混杂，未经信号检测校正不能直接作为「这个药会引起 X」的依据，
而做信号检测（ROR/PRR/BCPNN）需要常驻的季度离线管线，投入产出不划算。

### 2.2 OnSIDES 实测（v3.1.1，2026-10-28）

- 仓库：https://github.com/tatonetti-lab/onsides
- 许可：MIT（代码）。数据为 FDA/EMA/EMC/KEGG 公开说明书抽取
- 当前版本：v3.1.1（v3.2.1 为纯代码发布，数据未变，故 v3.1.1 即最新数据）
- 抽取模型：PubMedBERT 微调，开源在 HuggingFace（`tatonettilab/onsides-bert`）
- 更新：季度更新，有 `VERSIONING.md` 与 GitHub Releases 分发

规模与质量实测（`DrugDataBase/tools/onsides_quality_check.py`）：

| 项目           | 计划书原述 | 实测          | 说明                                       |
| -------------- | ---------- | ------------- | ------------------------------------------ |
| 药物—ADE 配对  | 7,100,000  | **6,928,666** | 差 2.4%，计划书数字来自更早版本            |
| 有配对的说明书 | 51,460     | **41,119**    | 差 19.9%                                   |
| 药物成分       | 4,097      | **1,866**     | 差 54.5%（原述疑为含 OMOP 前缀的全量计数） |
| MedDRA 术语    | —          | **6,423**     | LLT 级                                     |

- 外键完整性：`product_label_id`、`effect_meddra_id` 悬空引用均为 **0**
- 主键唯一性：说明书 / 成分 / MedDRA 字典均无重复
- 说明书章节分布：AR 76.3% · WP 17.3% · NA 5.6% · BW 0.9%
- 监管来源分布：US 94.4% · JP 3.3% · UK 1.2% · EU 1.1%
- 抽取置信度 `pred0`：≥0.9 占 35.6%，**<0.5 占 53.8%**
- `high_confidence.csv` 只有 342 行，是训练种子集，**不是**全量高置信子集

`pred0` 低于 0.5 的比例过半，因此**不能**把 `high_confidence.csv` 当数据源，也**不能**按
`pred0 ≥ 0.5` 过滤——那会砍掉一半数据。正确做法是保留原始 `pred0` 落库，口径留给展示层。

### 2.3 桥接成本（决定能用多少）

OnSIDES 的成分标识是 **RxNorm CUI**，DrugBank 侧已有的
`drugbank_external_identifiers` 表中带 `RxCUI` 记录，是唯一无需新建映射表即可用的桥。

`DrugDataBase/tools/rxnorm_drugbank_coverage.py` 实测：

| 指标                        | 数值                               |
| --------------------------- | ---------------------------------- |
| OnSIDES 成分（numeric CUI） | 1,813                              |
| DrugBank 侧带 RxCUI 的条目  | 5,791                              |
| 成分级直接命中              | **1,622 / 1,813 = 89.5%**          |
| 药物级命中                  | 1,623 / 19,842 = 8.2%              |
| **ADE 配对级命中**          | **6,417,478 / 6,928,666 = 92.62%** |

**配对级 92.62% 是本计划的可用性判据**——即"能展示多少条不良反应"。药物级 8.2% 低，原因
不是桥接失败，而是：

1. DrugBank 19,842 个条目里只有 17,309 个有 `external_identifiers`，其中带 RxCUI 的仅 5,791；
2. DrugBank 的 RxCUI 粒度不一致——部分记录的是**成分 CUI**，部分记录的是**临床药品 CUI**
   （lisinopril 记 `1546022` 而非成分 CUI `29046`，docetaxel 记 `1299922` 而非 `72962`）。

未映射的 7.38%（511,188 条配对）高度集中：仅 **191 个** numeric 成分贡献了几乎全部缺口，
且都是常用药——阿奇霉素、丙戊酸、他克莫司、阿托伐他汀、阿莫西林、达沙替尼、赖诺普利、
多西他赛。补一张 191 行的成分别名表即可回收绝大部分，**不在本计划范围**，列为后续优化。

另有 1,866 个成分中的 53 个只有 OMOP 前缀 CUI（疫苗、生物制品为主），RxCUI 链路天生无法
接住，但只对应 **1,497 条配对（0.02%）**，可忽略。

## 三、目标

1. 新增结构化「药品成分 — 不良反应」关系表，支持**双向查询**（药→反应、反应→药）
2. OnSIDES 数据按时可重导入，版本可追溯，复用现有 `drug_source_imports` 元数据表
3. 药品详情可展示「不良反应」区块（按说明书章节分组，带抽取置信度）
4. 为风险检查提供不良反应维度的确定性依据（本计划只做**数据供给**，不改
   `RiskDetectionService` 判定逻辑）

## 四、数据模型

新增两张表（放在 `prisma/models/medicine-knowledge.prisma`），**不新建桥接表**——桥接
直接复用已有的 `drugbank_external_identifiers`。

> **2026-10-27 一致性核对**：下表设计已符合当日为 DrugBank 关系表确立的统一口径
> （`id` 主键 + `import_run_id` 外键 + `created_at`/`updated_at`），实现时不必再改形状。
> 反查索引沿用 `drugbank_drug_interactions` 的 `(drugbank_id)` / `(interacts_with_id)`
> 双向模式——"关系表必须两个方向都能查"的规则那边已经验证过。

### 4.1 `onsides_adverse_reactions` —— MedDRA 术语字典

```prisma
model OnsidesAdverseReaction {
  id             String   @id @default(uuid())
  /// MedDRA code, string because the code is numeric and may carry leading zeros
  meddraId       String   @unique @map("meddra_id")
  meddraName     String   @map("meddra_name")
  /// MedDRA term type: LLT today; kept so a future PT-level feed does not need a migration
  meddraTermType String   @map("meddra_term_type")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt      DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)

  effectLinks OnsidesIngredientAdverseEffect[]

  @@map("onsides_adverse_reactions")
}
```

### 4.2 `onsides_ingredient_adverse_effects` —— 成分—反应配对（事实表）

导入时把 `product_adverse_effect × product_to_rxnorm × ingredient_to_product` 逐层上溯并
按 `(rxnorm_cui, reaction)` 聚合，**不保留 label 级明细**（那是 693 万行；聚合后按成分×反应
去重，说明书的重复命中折成计数与来源集合）。

```prisma
model OnsidesIngredientAdverseEffect {
  id             String   @id @default(uuid())
  importRunId    String?  @map("import_run_id")
  /// RxNorm ingredient CUI; joins drugbank_external_identifiers where resource = 'RxCUI'
  rxnormCui      String   @map("rxnorm_cui")
  reactionId     String   @map("reaction_id")
  /// 命中该配对的说明书数，作权重
  labelCount     Int      @map("label_count")
  /// 章节集合（AR/WP/NA/BW），有序去重
  labelSections  String[] @map("label_sections")
  /// 监管来源集合（US/JP/UK/EU）
  sources        String[] @map("sources")
  /// 该配对全部命中里的最高抽取置信度，保留原始 pred0 不做二值化
  confidenceMax  Float    @map("confidence_max")
  /// 上游数据版本，便于增量替换
  sourceVersion  String   @map("source_version")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)

  importRun DrugSourceImport?      @relation(fields: [importRunId], references: [id], onDelete: SetNull)
  reaction  OnsidesAdverseReaction @relation(fields: [reactionId], references: [id], onDelete: Cascade)

  @@unique([rxnormCui, reactionId])
  @@index([rxnormCui])
  @@index([reactionId])
  @@map("onsides_ingredient_adverse_effects")
}
```

`match_method` 全量为 `PMB`（1.2M 抽样无第二种值），不单独成列。

**索引理由**：`rxnormCui` 与 `reactionId` 双向查询都要走索引；详情页查某成分的全部反应是
高频路径，属性能关键路径。

## 五、实施步骤

### Phase 1 —— OnSIDES 接入

1. **取得数据**：下载 v3.1.1 压缩包解压到 `DrugDataBase/raw/onsides/v3.1.1/`（已就位，
   490.8 MB）。数据不在 git 仓库内，导入脚本从本地路径读取，路径由环境变量
   `ONSIDES_DATA_DIR` 指定
2. **解析与聚合**：Python 侧不新增依赖（已确认 `.venv312` 只有标准库 + duckdb 够用）。
   按 label → product → ingredient 上溯，产出中间 parquet（`rxnorm_cui, meddra_id,
label_count, sections, sources, confidence_max`），再由 TS 导入器消费——与现有
   DrugBank 导入的「Python 出中间产物 → TS 分批 upsert」模式一致
3. **导入脚本**：新增 `scripts/import/medicine/import-onsides.ts`，遵循
   `scripts/shared/db-upsert` 的分批 upsert 模式
4. **完整性契约**：按 `src/modules/medicines/README.md` 的要求，导入完成判据是
   **目标表行数与中间产物相等**，不是脚本退出码
5. **注册命令**：`package.json` 增加 `import:onsides`，接入 `import:medicine:all` 末尾
   （无外键依赖，可后置）
6. **元数据**：写入 `drug_source_imports`，`sourceKey = 'onsides-v3.1.1'`

### Phase 2 —— API 与展示

7. **详情接口扩展**：`GET /api/v1/medicines/:id` 的 drugbank 分支增加 `adverseReactions`
   字段。查询路径：
   `drugbank_external_identifiers (resource='RxCUI') → onsides_ingredient_adverse_effects → onsides_adverse_reactions`
8. **展示口径**：按 `label_sections` 分组（AR 优先），每组限量；`confidenceMax` 随行返回，
   阈值由前端决定，**后端不做过滤**
9. **CN 源**：中文说明书无 ingredient 编码，**先不映射**，仅对 drugbank 源提供
10. **反向查询**：如需要「哪些药会引起皮疹」，走新增的内部查询方法，暂不暴露公开端点
11. **契约同步**：`pnpm export:openapi` → Luminous `bootstrap.dart`

## 六、风险与缓解

| 风险                      | 影响                             | 缓解                                                                                |
| ------------------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| DrugBank RxCUI 粒度不一致 | 191 个常用药接不上（7.38% 配对） | 已量化且缺口集中；后续补 191 行成分别名表即可回收，不阻塞本计划                     |
| 抽取置信度整体偏低        | 53.8% 配对 `pred0 < 0.5`         | 保原始值不做二值化，展示层自行决定阈值；不采信 `high_confidence.csv` 当全量高置信集 |
| 数据许可边界              | MIT 覆盖代码，数据来自说明书     | 商用前阅读 OnSIDES Limitations；保存来源与版本以便溯源                              |
| 数据体积                  | 693 万行配对                     | 导入时按 (成分, 反应) 聚合，不存 label 明细；预期落库量远小于原始行数               |
| 时效性                    | 季度更新，滞后于新药             | 版本化 + 可重导入；新药缺失时回落到说明书文本 RAG                                   |
| 英文数据                  | 无中文说明书不良反应             | 本计划不解决；中文侧继续用说明书文本检索，后续另行立项                              |

## 七、验证方式

- 导入对账：两张表行数与中间产物逐表相等；`meddra_id` 与 `product_label_id` 悬空数为 0
- 数据抽查：取 20 个 DrugBank 已知有不良反应的药品，人工核对返回结果与说明书一致
- 覆盖率回归：`rxnorm_drugbank_coverage.py` 的配对级覆盖率作为基线（92.62%），
  补别名表后应上升而不是下降
- e2e：详情接口新增字段的序列化与空值处理（无 RxCUI 的药物必须返回空数组而非报错）

## 八、不做什么

- 不改 `RiskDetectionService` 的判定逻辑与评分权重（本计划只供数据）
- 不做 FAERS / 自发报告数据（已于 2026-10-28 决定放弃，理由见 §2.1）
- 不做 CN ↔ OnSIDES 的跨源映射（沿用 ADR-0008 的不建桥接表决策）
- 不按 `pred0` 过滤数据，不引入二值化置信标记
- 不引入 R 运行时
