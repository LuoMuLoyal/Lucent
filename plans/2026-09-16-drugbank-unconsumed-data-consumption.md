# DrugBank 已导入数据 + 未导入结构数据的消费落地

> 目标:把 `DrugDataBase/unziped/` 中**已有价值但尚未被前端渲染**的数据全部接入 Lucent API 并在
> Luminous 渲染,并按**用户查看频次**重排详情页信息架构、整体优化 UI。
> 唯一排除项是 `structures.sdf` 的 **3D 构象/坐标**(理由见 §7)。
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

### 0.4 新发现:叙事文本含未清洗的 HTML 实体与伪 Markdown(阻断级)

实测 `full database.xml` 的 narrative 字段**原样保留 XML 实体与标记**:

| 药物      | 字段         | 实测片段                                        |
| --------- | ------------ | ----------------------------------------------- |
| Warfarin  | `indication` | `**Indicated** for:[label,L6616]&#13;`          |
| Cetuximab | `indication` | `Cetuximab is indicated for: &#13;`             |
| Cetuximab | `toxicity`   | `The intravenous LD&lt;sub&gt;50&lt;/sub&gt;`   |
| Metformin | `indication` | `**Metformin immediate-release formulations**&` |

而 `Lucent/scripts/import/medicine/parsers/common.py:15-20` 的 `normalize_text()` **仅做
`.strip()`**,`drugbank_drugs.py` 的 `child_text()` 无任何实体解码 → 这些字符**原样入库**,
前端也无解码 → **当前详情页就在显示 `&#13;` / `&lt;sub&gt;` / `**` 字面量\*\*。

> **这是既有缺陷,不是新增功能**。Phase 1 必须先修:否则新增的靶点/性质区块会与这些脏文本
> 混在一起,UI 再怎么排也难看。修复点有争议:`parser 端清洗`(需重跑导入)vs
> `API 端清洗`(免重导入)。见 §1.4 决策。

**决策(已实施):parser 端清洗 + 重跑导入。** `common.py` 新增 `clean_narrative_text()`,
`drugbank_drugs.py` 新增 `narrative_text()` 并只用于 prose 字段(标识符/URL 字段仍走
`normalize_text`,内容不被改写)。重跑后 19842 行入库,残留脏标记 1 行 —— 经核实是
DB06071 的 `TOP**` 脚注符号,属**源文本真实内容**,清洗器正确地未剥离。

### 0.5 实测发现:`actions` 数据根本不在 CSV 里(修正 §0.1 的假设)

`all.csv` 与 `pharmacologically_active.csv` 的**表头完全相同**,
均**没有 `Actions` / `Known Action` 列**(解析器的 `get_first_value(row, "Actions", "Action")`
回退永不触发)。实测入库结果:

| 列                                    | 非空行数 | 说明                                      |
| ------------------------------------- | -------- | ----------------------------------------- |
| `drugbank_drug_targets.actions`       | **0**    | CSV 无此列                                |
| `drugbank_drug_targets.known_action`  | **0**    | CSV 无此列                                |
| `drugbank_drug_targets.relation_kind` | 26793    | **恒为 `'all'`**(取的是 sourceDataset 值) |

真正的 actions 在 `full database.xml` 的 `<targets>/<enzymes>/<carriers>/<transporters>` 里,
结构为 `<target><id>BE0000451</id><name>…</name><organism>Humans</organism>
<actions><action>inhibitor</action></actions></target>`,实测有 **38 个取值**
(inhibitor / agonist / antagonist / substrate / inducer / …)。

> ⚠️ **ID 空间不相交**:XML 用 `BE0000451`,CSV 用数字 `451`。二者只能靠**靶点名称**关联
> (已验证:`5-hydroxytryptamine receptor 2A` → CSV 行 `HTR2A`/`P28223`)。

**决策(已实施):Phase 1 内一并补上。** `drugbank_drugs.py` 新增 `parse_xml_targets()`
读取四类关系;导入器新增 `applyXmlTargetActions()`,在药物 upsert 之后按靶点名称
(case-insensitive)关联并回填 `actions`/`known_action`,同时以真实 `relation_kind`
(target/enzyme/carrier/transporter)插入 CSV 中没有的关系行。

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
│  │  Targets                                        (3) │  │  ← Tier 3,默认折叠
│  ├──────────────────────────────────────────────────────┤  │
│  │  Description                                      ›  │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │  Pharmacodynamics                                 ›  │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Metabolism / Absorption / Half-Life / …          ›  │  │  ← Tier 4
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Molecular Properties                             ›  │  │  ← Tier 5
│  ├──────────────────────────────────────────────────────┤  │
│  │  External Identifiers                          (11) │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │  Categories / ATC Codes / Synonyms                ›  │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Add to my medicines                     │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

### 1.3 UI 优化要点

- **分组而非平铺**:Tier 2/3 各用一个 `FCard` 包住相邻条目,形成 2~4 个视觉分组,
  替代当前一长条 20 项手风琴。
- **计数徽标**:`Targets`/`Drug Interactions`/`External Identifiers`/`Sequences` 在标题右侧显示
  条目数(折叠态可见),让用户不必展开就知道有没有内容。
- **空节彻底隐藏**:延续现有 `_section()` 返回 null 的约定;`Targets` 等新节同样
  "无数据即不渲染",不显示空占位。
- **列表可交互**:`Categories`/`ATC`/`Synonyms` 由当前 `join(', ')` 纯文本改为可换行的 chip 流;
  `External Identifiers` 改为可点击跳转的键值行。
- **长文本可展开**:`Toxicity`(实测 Imatinib 4633 字符、Metformin 3547)默认截断 4 行 +
  "展开全文",避免一次灌入数千字符。
- **文本清洗渲染**:清除后的段落按空行切分渲染为多段,而非一整块。
- **可复制字段**(SMILES / InChIKey / 序列)统一带 Copy 按钮;用 `AppToast` 反馈。
- **加载/错误**:序列与 PDB 按需加载,用 `AppSkeletonShimmer` / `AppStateErrorView`,
  禁止 `CircularProgressIndicator`。
- **所有文案走 ARB** —— 编辑 `lib/l10n/src/medicine_{zh,en}.arb` → `arb_tools.dart merge`
  → `flutter gen-l10n`。**禁止**直接改 `app_*.arb`。

### 1.4 文本清洗决策(需先定)

| 方案                 | 优点                    | 缺点                                          |
| -------------------- | ----------------------- | --------------------------------------------- |
| **A. parser 端清洗** | 数据干净,所有消费方受益 | 需重跑 1.9 GB XML 导入                        |
| **B. API 端清洗**    | 免重导入                | 每次请求都做;其他消费方(如 RAG chunk)仍是脏的 |
| **C. 前端清洗**      | 最快                    | 脏数据继续外泄给其他消费者,不推荐             |

**建议 A + 回填**:清洗函数进 `common.py`(解码 `&lt;`/`&gt;`/`&amp;`/`&#13;`,
剥离 `**`、`<sub>`/`<sup>` 转纯文本,`[label,xxx]` 引用标记按需保留/剥离),
重跑 drugbank 导入。**注意 RAG chunk(`drugbank_passage_chunks`)也基于这些字段**,
清洗后需重建索引(`pnpm import:rebuild-rag`)。

---

## 2. Phase 1:靶点 + 外部标识 + 文本清洗(零导入表,最高优先)

### 2.1 后端(Lucent)

- `src/modules/medicines/dto/detail.dto.ts`
  - 新增 `drugbankTargetSchema`:`name` / `geneName` / `uniprotId` / `uniprotTitle` / `species` /
    `pdbIds`(array) / `actions`(array) / `knownAction` / `relationKind`。
  - `drugbankMedicineDetailSchema` 增 `targets: z.array(drugbankTargetSchema).nullable()`。
  - `externalIdentifiers` / `externalLinks` 由 `z.unknown()` **强类型化**。
    > ⚠️ **破坏性契约变更**:改前必须抽样源 JSON 实际形态,否则 `export-openapi`
    > 的响应对账会失败。
- `src/modules/medicines/adapters/drugbank.service.ts`
  - `getDetail()` 加 `include: { targetRelations: { include: { target: true } } }`。
  - 新增 `toTargets()` / `toExternalIdentifiers()`。
- 文本清洗(按 §1.4 决策落地到 `common.py` 或 adapter)+ 重跑导入 + 重建 RAG 索引。
- 同步 `src/modules/medicines/README.md`;`pnpm export:openapi`。

### 2.2 前端(Luminous)

- `dart run scripts/contract/bootstrap.dart` 重生成客户端。
- 实体与 mapper:`MedicineDetailTarget` + `targets`;补齐 B 组字段映射(丢失根因)。
- **按 §1 重构 `medicine_detail_content.dart`**:Tier 分组、默认展开项改为 Indications、
  计数徽标、chip 流、长文本截断、头部卡摘要行。
  - 建议拆文件:`medicine_detail_sections.dart`(分组与排序)、
    `medicine_detail_header.dart`(头部卡)。遵守 `lib/features/medicine/presentation/**`
    命名规则(目录已传达类型,不再加 `_widget`/`_section` 后缀)。
- 补 CN 的 `barcode` / `nationalDrugCode` / `sourceUrl` 渲染。
- ARB + 测试(mapper 单测 + 详情页 widget test;golden 承接布局断言)。

---

## 3. Phase 2:序列数据(FASTA 导入 + 渲染)

### 3.1 新增 Prisma model(`prisma/models/medicine-knowledge.prisma`)

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

### 3.2 导入 parser 与 API

- 新增 `scripts/import/medicine/parsers/drugbank_fasta.py`(沿用
  `--source-path`/`--source-dataset`/`--limit` 约定,复用 `common.py`)。
- 在 `import-medicine-knowledge.ts` 注册 `drugbank-target-proteins` /
  `drugbank-target-genes` / `drugbank-drug-sequences`,并同步 `datasetOrder` 与
  `import-medicine-datasets.ts` 的 ALL 列表。
- **序列不进主详情响应**(单条可达数千字符)→ 新增独立端点
  `GET /medicines/:id/sequences?source=drugbank&kind=drug|target`;
  主详情只返回 `hasSequence` + `length` 摘要。

### 3.3 前端渲染(**默认不加载**)

- 详情页 `Sequences` 节默认折叠,折叠态**只显示摘要**(如 `Heavy chain · 449 aa`),
  **不发请求**;用户点开某条链才触发 `sequencesProvider` 拉取全文。
- 展示:`SelectableText` + 等宽字体,60 字符/行,带 Copy 按钮。
- 靶点序列同理:靶点卡上的 `[seq ⌄]` 点击后才加载。
- 加载中用 `AppSkeletonShimmer`,失败用 `AppStateErrorView`。

---

## 4. Phase 3:SDF 标量属性导入(不含坐标)

SDF 除坐标外有 **42 个数据字段**,含 `SMILES`/`FORMULA`/`MOLECULAR_WEIGHT`/`EXACT_MASS`/
`INCHI_KEY`/`TPSA`/`LogP`/`JCHEM_*` 类药性规则等,**现有表完全没有**。

- `drugbank_structures` 表:`drugbankId`(唯一)、`smiles`、`inchiKey`、`formula`、
  `molecularWeight`、`exactMass`、`alogp`、`jchemLogp`、`tpsa`、`hBondDonorCount`、
  `hBondAcceptorCount`、`rotatableBondCount`、`ringCount`、`bioavailability`、`ruleOfFive`、
  `veberRule`、`ghoseFilter`、`mddrLikeRule`、`iupacName`、`pka*` 等。
- parser `drugbank_sdf.py`:**只读 `> <FIELD>` 数据块,显式跳过 molblock 坐标段**。
- 前端 `Molecular Properties` 节(Tier 5):分子式、分子量、SMILES(可复制)、InChIKey、
  LogP/TPSA/氢键/可旋转键/环数、类药性规则 badge。
- **SMILES 仅作文本,不做结构式渲染**(见 §7)。
- ⚠️ **数据质量待验证**:实测 `JCHEM_TRADITIONAL_IUPAC` 对 Imatinib 返回
  `tetrahydrofolic acid`(四氢叶酸),**明显错误**。该字段默认不展示,或抽样验证后再定。
- ⚠️ Imatinib 的 `structures.sdf` 记录里 **没有 JCHEM 块**(仅 8 个字段),
  而另一个 DB00619 记录有完整 42 字段 → **同一 DB ID 可能存在多条记录**,
  parser 需明确合并策略(取字段最全的一条)。

---

## 5. Phase 4(可选):2D 结构式可视化

- 实测 SDF **全部 2D 坐标**,后端可作 molblock 存档。
- Flutter **无成熟纯 Dart 结构式渲染包**;推荐后端 RDKit 渲染 SVG → 存 OSS
  (已有 ADR-0019),前端 `flutter_svg` 展示。
- **默认不做**,除非产品明确要求分子可视化。

---

## 6. 明确排除项与理由

| 排除内容                      | 理由                                                              |
| ----------------------------- | ----------------------------------------------------------------- |
| **SDF 的 3D 构象 / 原子坐标** | 实测 **100% 为 2D(z 恒为 0)**,不存在 3D 数据可消费                |
| SMILES 图形化渲染             | Flutter 生态无成熟包;纯文本+复制已满足需求                        |
| `gene.fasta` 独立 UI 入口     | 与 `protein.fasta` 同源同靶点,合并展示(标「编码序列」),不单开页面 |
| molblock 逐行几何解析         | 66 MB 逐原子解析成本极高且 Phase 3 用不到                         |

---

## 7. 执行顺序与依赖

```
Phase 1 (文本清洗 + 靶点 + 外部标识 + UI 重构)   ← 先做,立即见效
   ├─> Phase 2 (序列:独立端点 + 按需加载)
   └─> Phase 3 (SDF 标量属性)
         └─> Phase 4 (2D 渲染,可选,默认不做)
```

**每个 Phase 完成时必做:**

1. Lucent:`pnpm lint:check` + `pnpm typecheck` + `pnpm test` + `pnpm export:openapi`;
   追加 `docs/logs/migration-log/YYYY-MM-DD.md`;契约变更同步
   `src/modules/medicines/README.md`。
2. Luminous:`dart run scripts/contract/bootstrap.dart` → `flutter analyze` + `flutter test`;
   追加 `docs/logs/migration-log/YYYY-MM-DD.md`;l10n 变更同步 `docs/reference/localization.md`。
3. 收尾跑宽检查:`dart run scripts/workflows/daily.dart`。
4. 全部 Phase 完成后**整体删除本计划文件**。

## 8. 风险

- **`externalIdentifiers`/`externalLinks` 强类型化是破坏性契约变更**,改前必须抽样源 JSON
  实际形态。
- **文本清洗影响 RAG**:`drugbank_passage_chunks` 基于这些字段,清洗后需
  `pnpm import:rebuild-rag`,否则检索质量与展示内容不一致。
- **UI 重构触面大**:`medicine_detail_content.dart` 现为单一 409 行文件,承载 CN/DrugBank
  两套 section;重排需拆文件,建议一个 PR 只做重排(不改数据源),另一 PR 接新数据。
- `getDetail` 加 include 后单请求变重;靶点极多的药需评估分页或独立端点。
- 序列体积:615 条药序列 + ~9800 条靶点序列;独立端点 + 按需加载是必须的。
- 导入 parser 需与既有 `drugbank-targets-*` 的 `sourceDataset` 值区分,避免 unique 约束冲突。
- SDF 同一 DB ID 可能多条记录(见 §4),需定合并策略。
