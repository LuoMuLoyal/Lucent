# DrugBank 已导入数据 + 未导入结构数据的消费落地

> 目标:把 `DrugDataBase/unziped/` 中**已有价值但尚未被前端渲染**的数据全部接入 Lucent API 并在
> Luminous 渲染,并按**用户查看频次**重排详情页信息架构、整体优化 UI。
> 唯一排除项是 `structures.sdf` 的 **3D 构象/坐标**(理由见 §5)。
>
> 范围:后端契约 + 导入管线 + 前端渲染 + 详情页 UI 重构,分四个 Phase 独立可交付。

## 0. 现状盘点(2026-09-16 实测)

### 0.1 `unziped/` 文件与导入状态

| 文件                           | 大小   | 导入状态                                        | 消费状态                               |
| ------------------------------ | ------ | ----------------------------------------------- | -------------------------------------- |
| `full database.xml`            | 1.9 GB | ✅ `drugbank-drugs`                             | ⚠️ 字段已消费,但**文本未清洗**(见 0.4) |
| `drug links.csv`               | 2.1 MB | ✅ `drugbank-links` → `drugbank_external_links` | ❌ **完全未消费**                      |
| `all.csv`                      | 1.2 MB | ✅ `drugbank-targets-all` → `drugbank_targets`  | ❌ **完全未消费**(API 无字段)          |
| `pharmacologically_active.csv` | 423 KB | ✅ `drugbank-targets-active`                    | ❌ **完全未消费**(同上游)              |
| `drug sequences.fasta`         | 252 KB | ❌ 未导入                                       | ❌                                     |
| `protein.fasta`                | 3.3 MB | ❌ 未导入                                       | ❌                                     |
| `gene.fasta`                   | 8.0 MB | ❌ 未导入                                       | ❌                                     |
| `structures.sdf`               | 66 MB  | ❌ 未导入                                       | ❌(仅取标量属性,坐标排除)              |

### 0.2 关键实测事实

- `protein.fasta` → **5096** 条,header `>drugbank_target|P45059 Peptidoglycan ... (DB00303)`,
  可解析 **唯一 UniProt ID 5096 个**;header 为**单行**(328 条 >200 字符,无折行)。
- `gene.fasta` → **4726** 条,header 形式与 `protein.fasta` **完全一致** → 必须靠 `sourceDataset` 区分。
- `drug sequences.fasta` → **615** 条,**335 个唯一 DB ID**;同一 DB ID 多条(如 `DB00002`
  heavy + light chain)→ **一对多,不能按 drugbank_id 做唯一键**。
- `structures.sdf` → **14622** 条,SMILES / FORMULA / INCHI_KEY 覆盖率 **100%**,
  **全部 2D 坐标(z 恒为 0)**,数据字段 **42 个**。
- 蛋白序列行宽 60(42664 行)。

### 0.3 已导入但前端未消费的字段

**A. 已入库、API 未暴露:**

| 数据                                | 表                        | 后端现状                        | 前端现状 |
| ----------------------------------- | ------------------------- | ------------------------------- | -------- |
| 靶点名称/基因名/UniProt/PDB/Species | `drugbank_targets`        | 无 DTO 字段、`getDetail()` 不查 | 无       |
| 药物-靶点关系 + 作用类型            | `drugbank_drug_targets`   | 同上                            | 无       |
| 外部标识(KEGG/PubChem/ChEBI/…)      | `drugbank_external_links` | 无 DTO 字段、不查               | 无       |

**B. API 已返回、前端丢弃:**

| 字段                                            | 后端 | mapper  | 渲染          |
| ----------------------------------------------- | ---- | ------- | ------------- |
| `externalIdentifiers` / `externalLinks`         | ✅   | ❌ 丢弃 | ❌            |
| CN `barcode` / `nationalDrugCode` / `sourceUrl` | ✅   | ✅      | ❌ **未渲染** |

### 0.4 数据来源的既有特性(影响后续 Phase)

- **叙事文本自带标记**:`full database.xml` 的 prose 字段原样含 XML 实体与伪 Markdown
  (`&#13;`、`&lt;sub&gt;`、`**bold**`、`[label,L6616]`)。导入侧已做清洗并重跑,
  但 **Phase 3 解析 SDF 字段时需先抽查同类污染**,不要假设 SDF 是干净的。
- **RAG 索引当前为空,无需回填**:`drugbank_passage_chunks` 实测 0 行、
  `drugbank_passage_embeddings` 表尚未创建 —— 该索引在 dev 从未构建过,
  因此不存在"用脏文本建好的旧索引"。首次构建
  (`scripts/import/medicine/rebuild-drugbank-rag-index.ts`)会直接切到已清洗的文本。
- **同一逻辑实体的 id 空间可能不相交**:靶点的 XML id(`BE0000451`)与 CSV id(`451`)
  是两套编号,只能按名称关联。Phase 2 的 FASTA 又是第三套编号(UniProt),
  关联时先确认可用的连接键,不要假设 id 可直连。
- **`drugbank_drug_targets.relation_kind` 兼作来源标记**:CSV 导入写数据集名
  (`all`),XML 导入写真实关系类型(`target`/`enzyme`/`carrier`/`transporter`)。
  读取该列时需按此语义处理。

---

## 1. 详情页信息架构与 UI 重构(贯穿各 Phase)

按**用户查看频次**重排,而非当前"按数据源字段顺序平铺"。当前实现是 ~20 个 `FAccordion` 条目,
其中 `Drug Type` = `SmallMoleculeDrug` 这类单词字段也独占一节。

### 1.1 排序原则

目标用户是**用药者/家属**(非药理研究者),高频问题是:
"这药治什么 → 有什么风险 → 怎么吃 → 和我吃的别的药冲突吗"。

| 层级                          | 内容                                                                                                              | 默认状态     | 依据                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------- |
| **Tier 0** 头部卡             | 名称 / 来源 / CAS / 分子式·分子量·LogP 摘要 / groups badge                                                        | 常显(不折叠) | 一眼识别"是不是这个药"      |
| **Tier 1** 最上、**默认展开** | **Indications**(适应症)                                                                                           | **展开**     | 最高频问题:"这药治什么"     |
| **Tier 2** 高频               | Mechanism of Action / Toxicity(不良反应) / Drug Interactions / Food Interactions                                  | 折叠         | 用药安全核心关切            |
| **Tier 3** 中频               | **Targets**(靶点) / Description / Pharmacodynamics                                                                | 折叠         | **新增内容放此层,默认折叠** |
| **Tier 4** 低频               | Metabolism / Absorption / Half-Life / Protein Binding / Route of Elimination / Volume of Distribution / Clearance | 折叠         | 专业参数,患者少看           |
| **Tier 5** 最底、次要         | Molecular Properties / External Identifiers / Categories / ATC / Synonyms / **Sequences**                         | 折叠         | 参考型/工具型信息           |

**关键调整(相对上一版计划):**

1. **`Indications` 取代 `Description` 成为默认展开项** —— 原实现 `initiallyExpanded: index == 0`,
   而 `Description` 恰好排第一,导致用户每次进来先看到一段百科式概述而非"治什么"。
2. **`Targets` 不放在最前**,移入 Tier 3 且默认折叠 —— 上一版把它放在顶部,80 个 PDB ID 会
   淹没临床叙事。**靶点本质是专业信息,不是患者高频诉求**。
3. **单词字段(`Drug Type` / `State`)不再独占 section** —— 并入头部卡的摘要行/badge。
4. **`Sequences` 放最底** —— 仅生物药有,且是纯技术信息。
5. **`Molecular Properties` 排 External Identifiers 之前** —— 前者有可读结论(分子量/类药性),
   后者纯跳转链接。

### 1.2 目标页面骨架(以 Imatinib 真实数据为例)

```
┌────────────────────────────────────────────────────────────┐
│  ‹  Imatinib                                                │
├────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Imatinib                              [ DrugBank ]  │  │  ← Tier 0 常显
│  │  CAS 152459-95-5                                     │  │
│  │  C29H31N7O · 493.60 Da · LogP 3.47                   │  │  ← 单词字段并入摘要
│  │  [ Approved ] [ Investigational ] [ Small molecule ] │  │
│  └──────────────────────────────────────────────────────┘  │
│  ⓘ 仅供参考,不能替代医嘱                                     │
│  ⚠ 用药风险检查                                          ›  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Indications                                      ⌃  │  │  ← Tier 1 默认展开
│  │  Imatinib is indicated for the treatment of ad...    │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Mechanism of Action                              ›  │  │  ← Tier 2
│  ├──────────────────────────────────────────────────────┤  │
│  │  Toxicity                                         ›  │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │  Drug Interactions                             (12) │  │  ← 带计数
│  ├──────────────────────────────────────────────────────┤  │
│  │  Food Interactions                              (3) │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Targets                                        (28) │  │  ← clinical,默认折叠
│  ├──────────────────────────────────────────────────────┤  │
│  │  Description                                      ›  │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │  Pharmacodynamics                                 ›  │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Metabolism / Absorption / Half-Life / …          ›  │  │  ← pharmacokinetics
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Categories / ATC Codes / Synonyms                ›  │  │  ← reference
│  ├──────────────────────────────────────────────────────┤  │
│  │  External Identifiers                          (14) │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │  Sequences                                        ›  │  │  ← Phase 2,默认不加载
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Add to my medicines                     │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

### 1.3 UI 尚未落地部分(Phase 1 已完成分组/徽标/chip/长文截断)

- **分组而非平铺**:当前是单条 `FAccordion`(仅一个分区默认展开,
  视觉上已不冗长)。是否再拆成数个 `FCard` 视觉分组留待 Phase 2 一并评估 ——
  加入序列/结构后条目更多时再定,避免为分组而分组。
- **序列与结构的加载态**:按需加载用 `AppSkeletonShimmer` / `AppStateErrorView`,
  禁止 `CircularProgressIndicator`。
- **可复制字段**(SMILES / InChIKey / 序列)统一带复制按钮;用 `AppToast` 反馈
  (外部标识的复制已落地,Phase 2/3 复用同一形态)。
- **所有文案走 ARB** —— 编辑 `lib/l10n/src/medicine_{zh,en}.arb` → `arb_tools.dart merge`
  → `flutter gen-l10n`。**禁止**直接改 `app_*.arb`。

> 分区顺序与"仅最高频分区默认展开"的口径已固化在代码
> (`pages/detail_sections.dart` 的 `Tier`)并由 `detail_page_test.dart` 断言守住,
> 本文件不再重复维护一份顺序表。

### 1.4 文本清洗(已完成,记录结论)

选定 **parser 端清洗 + 重跑导入**:数据干净后所有消费方(REST、RAG chunk、将来的
结构化导出)一并受益;API 端清洗每次请求都要做且救不了 RAG,前端清洗只是把脏数据
继续外泄给别的消费者。清洗函数落在 `common.py`,重跑导入后重建 RAG 索引。

---

## 2. Phase 2:序列数据(FASTA 导入 + 渲染)

### 2.1 新增 Prisma model(`prisma/models/medicine-knowledge.prisma`)

```prisma
/// 靶点蛋白/基因序列(来自 protein.fasta / gene.fasta)。
model DrugbankTargetSequence {
  id            String   @id @default(uuid())
  importRunId   String?  @map("import_run_id")
  sourceDataset String   @map("source_dataset")  // protein_fasta | gene_fasta
  uniprotId     String   @map("uniprot_id")
  targetName    String?  @map("target_name")
  sequence      String
  length        Int
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt     DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@unique([sourceDataset, uniprotId])
  @@index([uniprotId])
  @@map("drugbank_target_sequences")
}

/// 生物药自身序列,一个药可有多条链。
model DrugbankDrugSequence {
  id          String       @id @default(uuid())
  importRunId String?      @map("import_run_id")
  drugbankId  String       @map("drugbank_id")
  chainLabel  String?      @map("chain_label")   // 如 "Cetuximab heavy chain"
  sequence    String
  length      Int
  createdAt   DateTime     @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt   DateTime     @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  drug        DrugbankDrug @relation(fields: [drugbankId], references: [drugbankId], onDelete: Cascade)

  @@unique([drugbankId, chainLabel])
  @@index([drugbankId])
  @@map("drugbank_drug_sequences")
}
```

> **必须一对多**:实测 `DB00002` 有 heavy/light 两条链,单列唯一键会**静默丢数据**。
> `chainLabel` 为 null 时归一化为 `sequence` 常量以保唯一性。
> `DrugbankDrug` 加反向关系 `drugSequences DrugbankDrugSequence[]`。

### 2.2 导入 parser 与 API

- 新增 `scripts/import/medicine/parsers/drugbank_fasta.py`(沿用
  `--source-path`/`--limit` 约定,复用 `common.py`)。
- 在 `import-medicine-knowledge.ts` 注册 `drugbank-target-proteins` /
  `drugbank-target-genes` / `drugbank-drug-sequences`,并同步 `datasetOrder` 与
  `import-medicine-datasets.ts` 的 ALL 列表。
- **序列不进主详情响应**(单条可达数千字符)→ 新增独立端点
  `GET /medicines/:id/sequences?source=drugbank&kind=drug|target`;
  主详情只返回 `hasSequence` + `length` 摘要。

### 2.3 前端渲染(**默认不加载**)

- 详情页 `Sequences` 节挂在 `Tier.reference`(排序真源见 §1.3 说明),默认折叠,
  折叠态**只显示摘要**(如 `Heavy chain · 449 aa`),**不发请求**;
  用户点开某条链才触发 `sequencesProvider` 拉取全文。
- 展示:`SelectableText` + 等宽字体,60 字符/行,带复制按钮(复用 §1.3 既有形态)。
- 靶点序列同理:靶点卡上的 `[seq ⌄]` 点击后才加载。
- 加载中用 `AppSkeletonShimmer`,失败用 `AppStateErrorView`。
- ⚠️ `drug sequences.fasta` 是 **one-to-many**(`DB00002` 同时有重链与轻链),
  链标识必须进 unique 键,否则会静默丢数据。

---

## 3. Phase 3:SDF 标量属性导入(不含坐标)

SDF 除坐标外有 **42 个数据字段**,含 `SMILES`/`FORMULA`/`MOLECULAR_WEIGHT`/`EXACT_MASS`/
`INCHI_KEY`/`TPSA`/`LogP`/`JCHEM_*` 类药性规则等,**现有表完全没有**。

- `drugbank_structures` 表:`drugbankId`(唯一)、`smiles`、`inchiKey`、`formula`、
  `molecularWeight`、`exactMass`、`alogp`、`jchemLogp`、`tpsa`、`hBondDonorCount`、
  `hBondAcceptorCount`、`rotatableBondCount`、`ringCount`、`bioavailability`、`ruleOfFive`、
  `veberRule`、`ghoseFilter`、`mddrLikeRule`、`iupacName`、`pka*` 等。
- parser `drugbank_sdf.py`:**只读 `> <FIELD>` 数据块,显式跳过 molblock 坐标段**。
- 前端 `Molecular Properties` 节(Tier 5):分子式、分子量、SMILES(可复制)、InChIKey、
  LogP/TPSA/氢键/可旋转键/环数、类药性规则 badge。
- **SMILES 仅作文本,不做结构式渲染**(见 §5)。
- ⚠️ **数据质量待验证**:实测 `JCHEM_TRADITIONAL_IUPAC` 对 Imatinib 返回
  `tetrahydrofolic acid`(四氢叶酸),**明显错误**。该字段默认不展示,或抽样验证后再定。
- ⚠️ Imatinib 的 `structures.sdf` 记录里 **没有 JCHEM 块**(仅 8 个字段),
  而另一个 DB00619 记录有完整 42 字段 → **同一 DB ID 可能存在多条记录**,
  parser 需明确合并策略(取字段最全的一条)。

---

## 4. Phase 4(可选):2D 结构式可视化

- 实测 SDF **全部 2D 坐标**,后端可作 molblock 存档。
- Flutter **无成熟纯 Dart 结构式渲染包**;推荐后端 RDKit 渲染 SVG → 存 OSS
  (已有 ADR-0019),前端 `flutter_svg` 展示。
- **默认不做**,除非产品明确要求分子可视化。

---

## 5. 明确排除项与理由

| 排除内容                      | 理由                                                              |
| ----------------------------- | ----------------------------------------------------------------- |
| **SDF 的 3D 构象 / 原子坐标** | 实测 **100% 为 2D(z 恒为 0)**,不存在 3D 数据可消费                |
| SMILES 图形化渲染             | Flutter 生态无成熟包;纯文本+复制已满足需求                        |
| `gene.fasta` 独立 UI 入口     | 与 `protein.fasta` 同源同靶点,合并展示(标「编码序列」),不单开页面 |
| molblock 逐行几何解析         | 66 MB 逐原子解析成本极高且 Phase 3 用不到                         |

---

## 6. 执行顺序与依赖

```
Phase 1 (文本清洗 + 靶点 + 外部标识 + UI 重构)   ✅ 已完成
   ├─> Phase 2 (序列:独立端点 + 按需加载)            ← 下一步
   └─> Phase 3 (SDF 标量属性)
         └─> Phase 4 (2D 渲染,可选,默认不做)
```

**每个 Phase 完成时必做:**

1. Lucent:`pnpm lint:check` + `pnpm typecheck` + `pnpm test` + `pnpm export:openapi`;
   追加 `docs/logs/migration-log/YYYY-MM-DD.md`;契约变更同步
   `src/modules/medicines/README.md`。
2. Luminous:`dart run scripts/contract/bootstrap.dart` → `flutter analyze` + `flutter test`;
   追加 `docs/logs/migration-log/YYYY-MM-DD.md`。
3. 每个 Phase 拆成**独立可回滚的原子提交**(导入侧 / 契约侧 / 前端侧分开),
   提交体只在破坏性变更时写。
4. 收尾跑宽检查:`dart run scripts/workflows/daily.dart`。
5. 全部 Phase 完成后**整体删除本计划文件**。

## 7. 风险

- `getDetail` 加 include 后单请求变重;靶点极多的药(实测 Imatinib 28 条、
  ABL1 单个靶点 84 个 PDB id)需评估分页或独立端点 —— 前端已用"前 6 + 展开"缓解。
- 序列体积:615 条药序列 + ~9800 条靶点序列;独立端点 + 按需加载是必须的。
- 导入 parser 需与既有 `drugbank-targets-*` 的 `sourceDataset` 值区分,避免 unique 约束冲突。
- SDF 同一 DB ID 可能多条记录(见 §3),需定合并策略。
- SDF 字段同样可能含未清洗标记(见 §0.4),解析前先抽查。
