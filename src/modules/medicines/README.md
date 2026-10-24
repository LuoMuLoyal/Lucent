---
status: active
owner: backend
---

# medicines

药品知识库查询（中/英双源分离）、AI 药盒图片识别、用药风险检查。
数据事实源是导入后的 PostgreSQL 持久表；导入策略变更须同步更新本文件。

## 限界上下文（ADR-0024 四层骨架）

本模块承载两个上下文（同模块、各自聚合）：**Medicine Catalog** 与
**Medication Safety**。代码已按 ADR-0024 迁入四层骨架：

- Catalog 聚合根：`Medicine`（双源）、`ImportBatch`（导入对账）、
  `SafetyTip`（安全提示内容）。搜索/详情/序列是 **MedicineFact 只读投影**，
  为读模型，不承担不变量。
- Safety 聚合根：`RiskAssessment`（一次请求一次评估，结果不可改写）。
- 领域事件（计划）：`medicine_imported`、`risk_assessment_completed` 等，
  经 outbox 发布；目录事实以 `MedicineFact` 契约面向下游发布。

### 层内布局

- `domain/` — `medicine/medicine-source.ts`（来源枚举与默认源）、
  `relations/{relation,relations}.ts`（图关系类型与 `GraphReader` port）、
  `services/{risk-model,risk-scoring,risk-mechanism,allergy-severity,ingredient-canonicalization,half-life,half-life-gap}.ts`。
  纯领域，不 import 上层。
- `application/ports/` — 每个外部依赖一个端口（`knowledge` / `knowledge-view` /
  `cache` / `cache-maintenance` / `risk-records` / `risk-llm` / `risk-check` /
  `safety-tips` / `qa-chunks`），同时导出 `const XXX = 'XXX'` 的 DI token。
  application 层不 import `infrastructure/`、`adapters/` 或 Prisma。
  `knowledge-view.ts` 是**投影形状**（卡片 / 判别联合详情 / 序列）的唯一定义处：
  持久层生产它、HTTP zod schema 与它结构兼容，两侧都只向内指。
- `application/read_models/` — 查询侧三件套：`medicine-card`（搜索卡片页）、
  `medicine-detail`（判别联合详情 + `source` 参数解析与 not_found 映射）、
  `medicine-sequence`（序列正文）。读模型不建 repository、不承担不变量；
  `medicine-card.format.ts` 是三个投影共用的纯格式化函数（持久层也要用，
  故不能留在 `adapters/`）。
- `application/use_cases/` — 只剩**有副作用**的用例：`medicines`（识别 + 安全贴士）、
  `check-risk`、`import-catalog`、`medication-overview`、`rebuild-index`
  （薄门面，委托 `MEDICINES_CACHE_MAINTENANCE`）。
- `adapters/http/` — controller + zod DTO，`presenters/medicine.ts` 承载
  `utils/data-format.ts` 迁来的展示格式化。
- `infrastructure/` — `persistence/`（cn、drugbank、risk-records、safety-tips、
  qa-chunks）、`cache/`（store、maintenance）、`llm/`（risk-check + prompts + schemas）。
- 端口在 `medicines.module.ts` 用 `{ provide: TOKEN, useExisting: Impl }` 绑定；
  新增实现只改 module 一处。

## 知识源与 source 参数

- `source=drugbank` → 查 `drugbank_drugs`（英文科学实体：机制/药理/靶点/
  相互作用，个人健康 copilot 默认源，`DEFAULT_MEDICINE_SOURCE='drugbank'`）。
- `source=cn` → 查 `cn_medicine_products` 目录 + 经
  `cn_medicine_product_leaflet_links`（1:1）join `cn_medicine_leaflets`
  获取正文字段（详情正文只来自说明书；产品表不存正文）。
- **选择器是 `source` 请求参数，不是 `Accept-Language`**（后者只管文案本地化）；
  跨源不做自动映射，无运行时桥接表（ADR-0008）。
- 搜索/详情端点为 `@Public()` 公开读；请求头可 bypass 读缓存（单次）。
  TTL 在写入时读运行时快照（`infrastructure/cache/store.ts`），存量的旧条目保留原寿命；
  验证码/会话/分享令牌的 TTL 不属于这一族。

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

  **交互类 finding 会带 `mechanism`**：图证据说明冲突经哪个酶/靶点/转运体发生
  （`domain/services/risk-mechanism.ts`）。机制是**增强不是阻塞**——图不可用时每条
  finding 带 `mechanism: { status: 'unavailable' }`，风险检查照常出结果。只认当前
  finding 涉及的两个药；机制查询用一次多药查询取回，不是每条 finding 打一次。
  `status` 的五态里 `notFound`（图上确实没有）与 `unavailable`/`timeout`/`notConfigured`
  （我们无法回答）**必须分开**，合并会让界面把知识缺口显示成「机制上没问题」。

- `POST recognize`（同步）/ `POST recognize/async` + `GET recognize/status/:jobId`
  （AI 药盒图片识别；同步端点直接返回识别资源，异步端点 `jobId|result` 互斥，
  队列不可用时同步兜底）。识别结果四个字段恒在、取不到时为 `null`，否则生成客户端
  会因字段缺失反序列化失败。
- `GET safety-tips` — 随机安全贴士（公开读）；管理写操作经 Admin `content:write`
  API（`/api/v1/admin/content/safety-tips`）调用本模块 owner service
  `SafetyTipsAdminService`，每次都记审计（actor + 前后摘要）并失效药品缓存。
- `GET/PUT /api/v1/admin/content/qa-chunks[/:id]` — 公开端无对应读取；管理面经
  Admin `content:read`/`content:write` 调用本模块 owner service
  `QaChunksAdminService`（列表分页/`q`/`safetyLabel` 过滤，写作审计 actor + 前后摘要）。
  `qaId` 不可改（语料身份，检索索引文档名为 `qa:<qaId>:0`）；行只落库，
  assistant 检索走 LightRAG `qa` workspace，需重建索引才可见；重新导入覆盖整表。

### 图关系查询（`/api/v1/medicines/relations/*`）

9 个多跳图查询，数据来自 **Neo4j**（与 Prisma 的药品知识表是两套数据，不要混淆）。
普通过滤、排序、正则扫描表达不了的图语义都在这里：二跳机理链、4 跳级联、
最短路径、反模式排除。

| 端点                                           | 回答什么                                                        |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `mechanism-paths?drugbankIds=`                 | 两药经同一酶形成的通路（`INHIBITS`/`INDUCES` × `SUBSTRATE_OF`） |
| `shared-targets?drugbankIds=`                  | 这组药共同作用的靶点                                            |
| `cascade-paths?drugbankId=`                    | 4 跳级联：A 抑制酶1 → C → 酶2 ← B                               |
| `substitutes?drugbankId=&enzymeGene=`          | 不走该酶、共享靶点的**候选**（结构事实，非处方建议）            |
| `actions?drugbankId=`                          | 单药作用谱                                                      |
| `shortest-route?fromDrugbankId=&toDrugbankId=` | 两药最短传播路径                                                |
| `target-drugs?geneName=`                       | 某靶点上的全部药物                                              |
| `transport-routes?drugbankId=`                 | 转运体外排/摄取（带边方向）                                     |
| `enzyme-duel?drugbankIds=`                     | 酶诱导 × 底物：浓度方向相反的间接相互作用                       |

**统一信封**：`{ status, ... }`，`status ∈ ok | notConfigured | unavailable | timeout`。
`ok` + 空数组 = 「图上确实没有」；其余 = 「我们无法回答」。**不要把两者合成空结果**——
用药场景里，把知识缺口渲染成「无风险」是最危险的静默降级。

**安全边界**：Cypher 固定在 `infrastructure/graph/schema.ts`，端点只收 DrugBank id /
基因名这类**参数**，没有任何接受 Cypher 或 GraphQL 的字段。schema **不出现在路由上**，
只在服务端内部经 OGM 执行。

**实现分层**：`domain/relations/`（类型与 port，零依赖）→ `infrastructure/graph/schema.ts`
（图模型 + `@cypher`）→ `executor.ts`（OGM 单例、变量注入、失败分类）→ `reader.ts`
（领域参数 → 受控查询）。

**两个排查要点**：

1. **`@cypher` 列表字段必须 `RETURN { ... } AS result` + `columnName: "result"`**。
   写成多列 + `columnName: "第一列"` 时查询**不报错但每行都是 null**。
2. **`INTERACTS_WITH` 在库中单向**（2,534 条），反向边由 semantica 出图时合成，
   直连走不到。涉及相互作用必须用无向匹配 `-[r]-`。

## 用药全景（`GET /api/v1/medicines/medication-overview`）

回答「**我实际在吃什么组合**」，而 `/risk-check` 回答「这一组药有没有冲突」。
两者的数据源相同（当前在服药品），但结论性质不同：前者是**描述**（同一成分几份、
条目按来源如何归类），后者是**判定**（风险等级）。所以这个响应里没有「风险等级」字段。

**需要登录**：与其余 `/medicines/*` 不同——那些是公共药品知识，这里涉及用户自己的
用药集合，`userId` 只从 token 取、不接受参数。

**两个聚合**（`domain/services/medication-overview.ts`，纯函数）：

- `duplicates`：按**成分键**而非药名分组。按药名比对永远发现不了「芬必得」与
  「布洛芬缓释胶囊」是同一成分——而患者自己加购时最常见的重复正是这个场景。
  严重度：同成分 ≥3 条，或跨 CN/DrugBank 两源，判 `high`；2 条判 `medium`。
- `sourceOverlaps`：按健康事件分组，无关联的归入 `unattributed`。
  `HealthEventMedicine` 是**多对多**（`@@unique([eventId, currentMedicineId])`），
  所以输入的 `healthEventIds` 是数组——用单值会把「一个药同时挂在两条病程下」这个
  信号掩盖掉。

**`totalMedicines` 与 `resolvableMedicines` 都要给**：只看总数会让「有 3 个药没解析出
成分」隐形，而分析结论的可靠性正取决于可解析比例。解析不出成分的条目（手动录入、
CN 源查不到详情）计入前者、不计入后者，**不让整体失败**。

`healthEventIds` 来自 `CurrentMedicineRow`——`HealthEventMedicine` 是多对多，在
`loadHealthContext` 的 `currentMedicines` include 里一次带出，不额外往返。没有关联事件的
条目归入 `unattributed`。**两组同时存在是正常的**：已归类的说明这个药由某条病程解释，
`unattributed` 的那些往往是自己加购或长期服用的，反而更值得关注——没有任何一个医生
在统筹它们。

## 半衰期解析与漏服判定（领域逻辑，**尚未接进提示链路**）

`domain/services/half-life.ts` 把 DrugBank 的 `half_life` **叙述文本**解析成小时区间，
`half-life-gap.ts` 基于该区间判断「漏服缺口是否值得提示」。

**为什么需要它**：固定时长的漏服规则在两类药上说反话——半衰期 3 小时的药漏 6 小时
（两个半衰期，浓度掉到 25%）该提醒；半衰期 102 小时的依那西普漏 6 小时浓度几乎没动，
提醒只制造焦虑。

**解析**：覆盖 `4-5 hours` / `8.4-19.3 hrs` / `112 minutes` / `3 days` / `25 ± 10 hours`
（按中心±偏差展开）/ `>20 hours`（标记 `openEnded`）/ `three hours` / 整段叙述
（取第一次出现的值）。在 dev 库 78 条非空 `half_life` 上覆盖 **76 条**；剩下 2 条是
语义上就没有半衰期的（文本被截断、明确「不被吸收」），返回 `null` 是正确行为。
解析失败**不回落到默认值**——那等于给一个我们自己编的生理参数。

**判定口径**：

- 阈值取**上界的一半**（偏晚触发）。区间宽的药（`8.4-19.3 hrs`）用下界口径阈值 4.2 小时、
  缺口 5 小时就弹；用上界口径阈值 9.65 小时、不弹。**误报代价更高**——每天多弹几次会让
  用户失去对提醒系统的信任。代价是短半衰期且区间宽的药提醒明显延后，这是有意取舍。
- 每日上限按**自然日**而非滚动 24 小时（与日历一致，避免同一天弹两次、跨零点又放行）。
- 已确认、尚未到时的记录一律不提示；无可用半衰期时返回 `noData`，调用方应保持原逻辑。

**未接入**：`today-suggestion` 的 `missed_dose_pending` 仍按固定时长运行。接入需要
「每药每日已提示」的持久化（领域函数接受 `lastNotifiedAt`，但没有地方存它）与
`UserCurrentMedicine → half_life` 的关联。见 `docs/TODO.md`「半衰期感知的漏服提示接入」。
⚠️ 该 TODO 还记着一个前提：dev 库只有 78 条药有 `half_life`，不先补数据则接入后
绝大多数药会落到 `noData`。

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
- **完整性契约**：导入完成的判据是**目标表行数与源文件相等**，不是脚本退出码，
  也不是它打印的 `importedRowCount`（该值由写入侧累加，丢行时照样报满）。
  逐表对账口径与排查步骤见 [`docs/howto/run-medicine-import.md`](../../../docs/howto/run-medicine-import.md)。
  读取侧的余数批丢失缺陷已修复并被 `scripts/shared/db-upsert.spec.ts` 覆盖。
- **检索索引（说明书侧）有两套灌入口径，按需要选**：`pnpm import:lightrag`
  以 chunk 表为粒度（一份说明书 = 几十个文档），批量快但中断后无法按说明书续传；
  `pnpm import:lightrag:leaflets` 以**一份说明书 = 一个文档**
  （`file_source = leaflet:<leafletId>`）为原子单位，支持断点续传，
  完成状态以 LightRAG 的 `doc_status` 为准（本地账本仅作缓存）。
  两者写入同一 workspace，**不要对同一批说明书混用**，否则同一说明书会出现两份文档。
  命令语义与排查见 [`docs/howto/run-medicine-import.md`](../../../docs/howto/run-medicine-import.md)。
- **Schema 语义（V3 对齐）**：`cn_medicine_products` 是纯目录表（名称/批准文号/
  条码/价格/类别/overdose 等，无正文）；`cn_medicine_leaflets` 是权威正文
  （ingredients/indications/dosage/contraindications…）；链接表 1:1 关联，带
  `match_type` / `match_key` / `match_score`。V2 xlsx 命令（`cn-products` 等）
  已随 20260917120000 迁移移除（V2 列不存在于新 schema）。
- CN 唯一性：产品/说明书主键 = V3 的 `entity_id`（产品由 `drug_name_key + maker_key`
  派生）；导入按 `(id)` 冲突 upsert。无批准文号回退逻辑由 V3 上游解决。
  `pregnancy_lactation` 在 API 层
  按语境拆为 `pregnancy` + `lactation` 两个 DTO 字段。
- **DrugBank 源**：`DrugDataBase/derived/drugbank/drugbank_drugs.parquet` —— `full
database.xml` 全部 55 个顶层字段的列存。导出侧已按「`<drugbank>` 的直接子元素
  `<drug>`」过滤掉 `<pathways>` 里的约 99.4 万条嵌套引用，因此解析器一药一行；
  `full database.xml` 不再参与导入。落库仍是原来的 34 列，Parquet 多出的 `prices` /
  `manufacturers` / `patents` / `dosages` / `pathways` / `snp_effects` 等尚无对应表列。
- DrugBank 映射：`drugbank_id` 主键、`secondary_drugbank_ids`、科学叙事字段
  清单化进 RAG chunks（仅 description/indication/MoA/pd/toxicity 等核准字段）；
  原始大文件不入 Git。
- 序列唯一键：靶点序列按 `(source_dataset, uniprot_id)`——`protein.fasta` 与
  `gene.fasta` 表头格式相同，只靠 `source_dataset` 区分氨基酸与核苷酸；药序列按
  `(drugbank_id, description)`——一药多链（实测最多 11 条），链描述原样存原文，
  不强拆 name/chain。靶点序列**不建外键**（`drugbank_targets.uniprot_id` 可空且非唯一），
  消费方按 `uniprot_id` 关联。
- 结构描述符：`drugbank_id` 即主键（实测 14622 条 SDF 记录对 14622 个不同药物 id，
  无重复，不需要合并策略）。只落药表未提供的字段；`SALTS` 现有表没有故收下，
  而 `SYNONYMS`/`PRODUCTS`/`DRUG_GROUPS`/`SECONDARY_ACCESSION_NUMBERS` 与药表一致
  故不重复导入。**`JCHEM_TRADITIONAL_IUPAC` 刻意不收**：该字段上游系统性张冠李戴
  （阿司匹林读成地塞米松磷酸盐、二甲双胍与布洛芬都读成 biotin），而同记录内其余
  字段均正确。源里两个 pKa 单元格是字面量 `NaN`，解析时按非有限值剔除。
  不收 molblock 坐标：该文件实测为纯 2D（z 恒为 0），没有可消费的构象数据；
  2D 结构式出图见 `docs/TODO.md`。
- 中文产品 ↔ DrugBank 实体映射不建表：跨源问题由 assistant 源分离工具链完成。

## Dependencies

- 引用：LlmRuntime/LlmCommon（LLM 风险检查与识别）、Prisma、cache、`audit-log`
  （安全贴士管理写的审计）。
- 被引用：`assistant`（结构化药品查询）、`reports`（event-review 只读
  `redFlags`）、`admin`（内容管理 API 调用 `SafetyTipsAdminService`）。
  `medicine-reminders` 以 Prisma 外键关联 `currentMedicine`，
  不经本模块服务。
- Barrel 导出：`DrugbankMedicinesService`、`CnMedicinesService`、
  `MedicineRiskCheckService`、`SafetyTipsAdminService`、`QaChunksAdminService`，
  以及类型 `MedicineSearchItemLike` / `MedicineSearchResultLike`。

## Tests

`adapters/http/medicines.controller.spec.ts`、
`application/use_cases/{medicines,check_risk,import_catalog}.spec.ts`、
`adapters/{events,queue}/*.spec.ts`、`domain/services/*.spec.ts`、
`infrastructure/persistence/*.spec.ts`、`infrastructure/cache/*.spec.ts`、
`infrastructure/llm/**/*.spec.ts`、`adapters/http/presenters/medicine.spec.ts`。

用例测试只对着端口断言（不 mock Prisma）：查询形状与 ISO 序列化由
`infrastructure/persistence/*.spec.ts` 覆盖，用例测试覆盖审计、缓存失效、
缺失行与分页回显。
