---
status: active
owner: backend
---

# medicines

药品知识库查询（中/英双源分离）、AI 药盒图片识别、用药风险检查。
数据事实源是导入后的 PostgreSQL 持久表；导入策略变更须同步更新本文件。

## 知识源与 source 参数

- `source=drugbank` → 查 `drugbank_drugs`（英文科学实体：机制/药理/靶点/
  相互作用，个人健康 copilot 默认源，`DEFAULT_MEDICINE_SOURCE='drugbank'`）。
- `source=cn` → 查 `cn_medicine_products` 目录 + 经
  `cn_medicine_product_leaflet_links`（1:1）join `cn_medicine_leaflets`
  获取正文字段（详情正文只来自说明书；产品表不存正文）。
- **选择器是 `source` 请求参数，不是 `Accept-Language`**（后者只管文案本地化）；
  跨源不做自动映射，无运行时桥接表（ADR-0008）。
- 搜索/详情端点为 `@Public()` 公开读；请求头可 bypass 读缓存（单次）。

## API 形态（事实源 = openapi.json）

- `GET /api/v1/medicines` — 搜索，返回公共卡片形：`id/source/name/subtitle/
summary/tags/imageUrl/matchedBy` + `pagination`。
- `GET /api/v1/medicines/:id` — 详情为判别联合：`kind: 'drugbank'` 与
  `kind: 'cnProduct'` 各保留原生字段；缺源字段不造空列。drugbank 分支另带
  `sequenceSummary`（仅有计数，无序列正文）与 `structure`（计算结构描述符，标量、随详情下发）。
- `GET /api/v1/medicines/:id/sequences` — 序列正文：药物自身各链 + 其靶点的蛋白/编码基因
  序列。**刻意与详情分离**——单药实测可达 96 KB（Imatinib 28 个靶点 × 2 个数据集），
  不该随每次详情请求下发；客户端只在用户展开序列区时才调。源无序列时返回空数组而非 404
  （CN 源没有序列列，但药品本身是存在的）。
- `POST risk-check`（static/LLM 用药风险检查；`candidate` 预检仅支持
  static：解析来源详情即时静态检查，不落库不写 records 缓存，不产生最新
  记录；已在药箱的候选不重复加入）/ `GET risk-check`（最近记录，30 分钟缓存）。
- `POST recognize`（同步）/ `POST recognize/async` + `GET recognize/status/:jobId`
  （AI 药盒图片识别，异步响应 `jobId|result` 互斥）。
- `GET safety-tips` — 随机安全贴士（`@Public()`，当前无 C 端消费方，保留死代码）。

## 持久表清单

`cn_medicine_products`、`cn_medicine_leaflets`、
`cn_medicine_product_leaflet_links`、`medicine_leaflet_chunks`（说明书 RAG）、
`drugbank_drugs`、`drugbank_external_links`、`drugbank_targets`、
`drugbank_drug_targets`、`drugbank_target_sequences`（靶点蛋白/编码基因序列）、
`drugbank_drug_sequences`（生物药各链序列）、`drugbank_structures`（计算结构描述符，
一药一行）、`drugbank_passage_chunks`（DrugBank RAG）、
`medical_qa_chunks`（assistant-only 语料，属 assistant 模块检索）、
`drug_source_imports`（导入元数据：来源/版本/哈希/行数/拒绝样本）。

## 导入策略（契约要点）

- 入口 `pnpm import:medicine:all`：drugbank-drugs → links → targets-all →
  targets-active → target-proteins → target-genes → drug-structures →
  cn-v3-leaflets → cn-v3-products → cn-v3-product-leaflet-links
  （顺序源于外键依赖：药序列对 `drugbank_drugs`
  有外键，故排在药物之后）；批量按目标表冲突键去重后 upsert，幂等。
- **导入路径（仅 V3）**：`DrugEntityDedup/products_dedup.parquet` 等 Parquet 文件，
  已做去重 + 保健品删除 + 名称冲突修正 + 条码/国药码并集；导入命令为
  `cn-v3-products` / `cn-v3-leaflets` / `cn-v3-product-leaflet-links`，
  源键为 `cn_v3_*`，写入 `cn_medicine_products` / `cn_medicine_leaflets` /
  `cn_medicine_product_leaflet_links`。
- **Schema 语义（V3 对齐）**：`cn_medicine_products` 是纯目录表（名称/批准文号/
  条码/价格/类别/overdose 等，无正文）；`cn_medicine_leaflets` 是权威正文
  （ingredients/indications/dosage/contraindications…）；链接表 1:1 关联，带
  `match_type` / `match_key` / `match_score`。V2 xlsx 命令（`cn-products` 等）
  已随 20260917120000 迁移移除（V2 列不存在于新 schema）。
- CN 唯一性：产品/说明书主键 = V3 的 `entity_id`（产品由 `drug_name_key + maker_key`
  派生）；导入按 `(id)` 冲突 upsert。无批准文号回退逻辑由 V3 上游解决。
  `pregnancy_lactation` 在 API 层
  按语境拆为 `pregnancy` + `lactation` 两个 DTO 字段。
- DrugBank 映射：`drugbank_id` 主键、`secondary_drugbank_ids`、科学叙事字段
  清单化进 RAG chunks（仅 description/indication/MoA/pd/toxicity 等核准字段）；
  原始大文件不入 Git。
- 序列唯一键：靶点序列按 `(source_dataset, uniprot_id)`——`protein.fasta` 与
  `gene.fasta` 表头格式相同，只靠 `source_dataset` 区分氨基酸与核苷酸；药序列按
  `(drugbank_id, description)`——一药多链（实测最多 11 条），链描述原样存原文，
  不强拆 name/chain。靶点序列**不建外键**（`drugbank_targets.uniprot_id` 可空且非唯一），
  消费方按 `uniprot_id` 关联。
- 结构描述符：`drugbank_id` 即主键（实测 14622 条 SDF 记录对 14622 个不同药物 id，
  无重复，不需要合并策略）。只落 XML 未提供的字段；`SALTS` 现有表没有故收下，
  而 `SYNONYMS`/`PRODUCTS`/`DRUG_GROUPS`/`SECONDARY_ACCESSION_NUMBERS` 与 XML 一致
  故不重复导入。**`JCHEM_TRADITIONAL_IUPAC` 刻意不收**：该字段上游系统性张冠李戴
  （阿司匹林读成地塞米松磷酸盐、二甲双胍与布洛芬都读成 biotin），而同记录内其余
  字段均正确。源里两个 pKa 单元格是字面量 `NaN`，解析时按非有限值剔除。
  不收 molblock 坐标：该文件实测为纯 2D（z 恒为 0），没有可消费的构象数据；
  2D 结构式出图见 `docs/TODO.md`。
- 中文产品 ↔ DrugBank 实体映射不建表：跨源问题由 assistant 源分离工具链完成。

## Dependencies

- 引用：LlmRuntime/LlmCommon（LLM 风险检查与识别）、Prisma、cache。
- 被引用：`assistant`（结构化药品查询）、`reports`（event-review 只读
  `redFlags`）。`medicine-reminders` 以 Prisma 外键关联 `currentMedicine`，
  不经本模块服务。
- Barrel 导出：`DrugbankMedicinesService`、`CnMedicinesService`、
  `MedicineRiskCheckService`。

## Tests

`medicines.controller.spec.ts`、`services/medicines.service.spec.ts`、
`adapters/cn.service.spec.ts`、`adapters/drugbank.service.spec.ts`、
`services/risk/*.spec.ts`、`services/recognition-queue.service.spec.ts`、
`cache/*.spec.ts`、`utils/*.spec.ts`。
