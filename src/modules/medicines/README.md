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
- `source=cn` → 查 `cn_medicine_products`（中国市场产品 + 说明书）。
- **选择器是 `source` 请求参数，不是 `Accept-Language`**（后者只管文案本地化）；
  跨源不做自动映射，无运行时桥接表（ADR-0008）。
- 搜索/详情端点为 `@Public()` 公开读；请求头可 bypass 读缓存（单次）。

## API 形态（事实源 = openapi.json）

- `GET /api/v1/medicines` — 搜索，返回公共卡片形：`id/source/name/subtitle/
summary/tags/imageUrl/matchedBy` + `pagination`。
- `GET /api/v1/medicines/:id` — 详情为判别联合：`kind: 'drugbank'` 与
  `kind: 'cnProduct'` 各保留原生字段；缺源字段不造空列。
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
`drugbank_drug_targets`、`drugbank_passage_chunks`（DrugBank RAG）、
`medical_qa_chunks`（assistant-only 语料，属 assistant 模块检索）、
`drug_source_imports`（导入元数据：来源/版本/哈希/行数/拒绝样本）。

## 导入策略（契约要点）

- 入口 `pnpm import:medicine:all`：drugbank-drugs → links → targets-all →
  targets-active → cn-leaflets → cn-products → cn-product-leaflet-links
  （顺序源于外键依赖）；批量按目标表冲突键去重后 upsert，幂等。
- CN 源 = `ChineseDrugData_Master_V2.xlsx`（4.0.0 锁定）；构建细节见
  `DrugDataBase/ChineseDrugData_Master_V2/build_master_v2.py`。
- CN 唯一性：优先 `(approval_number, package_spec, manufacturer)`，
  无批准文号退 `(name, package_spec, manufacturer, national_drug_code)`；
  表观重复留 staging 上报，不静默丢弃。`pregnancy_lactation` 在 API 层
  按语境拆为 `pregnancy` + `lactation` 两个 DTO 字段。
- DrugBank 映射：`drugbank_id` 主键、`secondary_drugbank_ids`、科学叙事字段
  清单化进 RAG chunks（仅 description/indication/MoA/pd/toxicity 等核准字段）；
  原始大文件不入 Git。
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
