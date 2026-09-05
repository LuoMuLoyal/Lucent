---
status: active
owner: product
updated: 2026-09-04
---

# Product Regulatory Positioning

本文档保留 Luminous 的产品监管定位与边界。

本文件下当前唯一活跃的定位是 **A 路径：医疗信息参考**。B（数字疗法 / SaMD）、C（互联网医院 / 医院 To B）两种路径仅在「为什么不做」一节留出占位，下次决策时再展开。

相关子文档：

- [Product Vision](product-vision.md)
- [Product Safety And Privacy](product-safety-privacy.md)
- [Product Mvp Scope](product-mvp-scope.md)

## 一句话定位

Luminous 是面向个人用户的医疗信息参考与个人健康伙伴：**提供经审核的药品信息、说明书内容与健康教育问答，不替代医生面诊**。产品不给出诊断、不出具处方、不自动调整治疗方案。

## 定位选择的结论

Luminous 不再以"健康参考、不构成医疗建议"的措辞全面撇清医疗关系——这层措辞会让已经具备药品说明书、DrugBank 科学数据、医疗问答语料的产品自我降级。A 路径承认产品是医疗信息、但严格守住边界；不跨到 SaMD（医疗器械软件）那条线。

A 路径与 B 路径的核心区别：

- A 路径：内容是「信息的整理与呈现」，不直接干预治疗决策；不需要 NMPA 医疗器械软件注册。
- B 路径：宣称对某疾病有预防/治疗/管理效果，自动给出治疗建议或闭环干预；属于 SaMD，必须走医疗器械注册路径（NMPA / FDA / CE-MDR），工作量与时间数量级与 A 路径不可比。

落到 Lucent 数据层的现成证据：`docs/archive/01-reference/contracts/data-sources.md` 已经把三源不合并、QA 检索上限 5 条、`medical_qa_chunks` 独立存储作为既定约束。F-15 落地的可验证性分层（`verifiability: 'open_corpus'` + 来源条提示）已经把 A 路径的合规护城河建在服务端 chunk 映射处——这是本路径成立的关键基础设施，**不能回退**。

## 法律文案必须重写

A 路径成立的第一步是替换现有免责措辞。位置：

- `assets/legal/disclaimer_zh.md`
- `assets/legal/disclaimer_en.md`
- 用户协议（Terms of Service）
- 隐私政策（Privacy Policy）

新措辞的关键转变：

- **承认**是医疗信息（这是 A 路径的标志）—— 把"不构成医疗诊断、治疗或处方建议"从核心承诺改为子句
- **声明**边界 —— 明确：不替代医生面诊、不用于紧急情况、不构成处方建议
- **不可省**的兜底 —— `medical_qa_chunks` 中仍包含诊断/治疗类答案，没有 disclaimer 直接触红线

参考措辞骨架（zh）：

```text
Luminous 提供经审核的药品信息、说明书内容与健康教育问答，仅供个人参考，
不替代医生面诊或专业医疗建议。如有不适或紧急情况，请前往医院或拨打急救电话。
Luminous 不出具诊断、处方或治疗方案。
```

英文版措辞骨架：

```text
Luminous provides curated medicine information, package insert content, and
health education Q&A for personal reference only. It is not a substitute for
professional medical advice, diagnosis, or treatment. In an emergency, contact
your local emergency service or go to the nearest hospital. Luminous does not
issue diagnoses, prescriptions, or treatment plans.
```

**不要做**：把 disclaimer 完全删掉 / 改成"信息仅供参考"的弱化措辞 / 把"不替代医生"降级为脚注。

## 数据源现状

A 路径依赖的三类内容已经在 Lucent 的 Prisma schema 里、且持久化在 PostgreSQL 中。**不需要新增数据源、不需要新增表、不需要改 schema**。

### DrugBank 英文药品数据库

- 表：`drugbank_drugs`、`drugbank_passage_chunks`、`drugbank_external_links`、`drugbank_targets`、`drugbank_drug_targets`
- 用途：科学端（机制、靶点、ATC、相互作用、药代动力学）；Lucent 的默认检索源
- 字段覆盖：name / description / casNumber / groups / indication / pharmacodynamics / mechanismOfAction / synonyms / atcCodes / drugInteractions
- **对前端的要求**：英文科学字段（pharmacodynamics、mechanismOfAction、toxicity、absorption 等）展示给中国用户前必须中文化，**不要直接渲染英文**
- 详情见 `Lucent/docs/archive/01-reference/contracts/data-sources-drugbank.md`

### 中文药品数据库

- 表：`cn_medicine_products`、`cn_medicine_leaflets`、`cn_medicine_product_leaflet_links`、`medicine_leaflet_chunks`
- 用途：中国市场产品/说明书端（批准文号、成分、适应症、用法用量、不良反应、禁忌、说明书全文）
- 锁定源：`ChineseDrugData_Master_V2/ChineseDrugData_Master_V2.xlsx`（4.0.0 起，V1 归档不再使用）
- 字段覆盖：name / approvalNumber / manufacturer / indications / dosage / adverseReactions / contraindications / precautions / drugInteractions / pharmacologyToxicology / storage
- **对运营的要求**：适应症、用法用量、不良反应字段必须抽样医师签字审核，**不能只靠自动 import**
- 详情见 `Lucent/docs/archive/01-reference/contracts/data-sources-cn-products.md`

### 医疗问答语料 135 万条

- 表：`medical_qa_chunks`
- 用途：开放语料兜底（症状解释、健康教育、就医建议类问答）
- 字段：qaId / question / answer / safetyLabel
- 状态：assistant-only RAG；`docs/archive/01-reference/contracts/data-sources-medical-qa.md` 已写明 5 条边界
  1. 范围限制：仅健康教育、症状解释、就医建议；**排除**诊断、处方、剂量、治疗方案
  2. 内容过滤：`safetyLabel` 预过滤/标签化，剔除高风险类目
  3. Disclaimer：每条答案必须标注"参考、不替代医生"
  4. 人类审核：未经验证，**不作为权威内容呈现**
  5. 独立存储：不与说明书 / DrugBank 切片混存
  6. 法律复核：上线前过法务/产品
- F-15 落地：可验证性分层在服务端 chunk 映射处生成，**不改数据库、不改导入脚本**

## Lucent 服务端约束（基本不动）

A 路径下 Lucent 端的工作量极小，因为基础已经打好。**核心是验证而不重写**。

### 不动的部分

- `MedicalQaChunk` schema / `safetyLabel` 字段定义
- `MEDICAL_QA_MAX_LIMIT = 5`（医疗问答检索每页最多 5 条）
- 三源不合并的检索架构（`data-sources.md` 第 1 节"Medicine Data Strategy"）
- CN 药库 ↔ DrugBank 桥表（4.0.0 冻结，**别手痒**）
- `drug_source_imports` 表（source、version、hash、行数、rejection summary）—— 已经满足审计要求

### 要验证的部分

- 药品搜索 / 详情 API 响应 DTO 是否已经把 F-15 字段（`verifiability`、`sourceNote`）外露
  - 位置：`Lucent/src/modules/medicines/dto/`
- 助手工具（`search_medicine_leaflets`、`search_drugbank_passages`、`search_medical_qa_corpus`）的响应是否带 `verifiability` 标签
  - 位置：`Lucent/src/modules/assistant/dto/` 与 `src/modules/assistant/services/`
- 说明书 / DrugBank 检索是否标注 `verifiability: 'curated'`（说明书 / DrugBank 优先档）

如果 DTO 没带 F-15 字段，前端拿不到"低可信教育参考，无独立可验证来源"那条来源标签——等效于没做。**这是本路径能否成立的最小可验证前端信号**。

## Luminous 前端必须做的

A 路径落地的工作集中在 Luminous 前端。优先级如下。

### 优先级 P0：disclaimer 替换 + 来源条渲染

1. `assets/legal/disclaimer_zh.md` / `disclaimer_en.md` 按本文档「法律文案必须重写」一节措辞替换
2. 用户协议 / 隐私政策同步重写
3. AI 助手回答中 F-15 那个"低可信教育参考，无独立可验证来源"红条 **必须在前端渲染**（服务端已发，前端没渲染等于没做）
4. 用户首次启动 / 设置页 / 助手入口三处**必须展示**新 disclaimer（用户主动确认）

### 优先级 P1：药品详情页与搜索卡片 UI 升级

- 药品详情页：从"健康参考"标识 → "医疗信息（来源：说明书 / DrugBank / 开放语料）"
- 搜索结果卡片：右上角带 `source` 标签 + `verifiability` 角标
- 三种来源用三种不同视觉权重：
  - 说明书 = 最高（绿色 / 印章样式）
  - DrugBank = 次高（蓝色 / 引用样式）
  - 医疗 QA = 最低（黄色 / 提示样式 + "低可信"角标）
- DrugBank 英文科学字段在展示前中文化（前端 i18n key 化，不要硬编码翻译）

### 优先级 P2：现有功能再审

逐项核对 Luminous 现有功能是否触线：

- **主动建议**（基于 health-event 触发 AI）—— 限定为"就医建议"类，禁止"诊断倾向"类表述
- **风险评分 / 跨事件聚合评分** —— A 路径下**移除或标注为参考**
- **跨事件"健康评分"** —— 已从产品方向退出（`product-vision.md` 已明确），本路径再次确认
- **用药提醒** —— A 路径允许，措辞改"提醒你记得吃药，建议遵医嘱"
- **就诊摘要 / PDF / 分享链接** —— 保留为用户主动寻找的次级出口，不作为核心使用假设（沿用 vision 决策）

### 优先级 P3：审计与可追溯

- Luminous 端：用户每次访问药品详情 / 助手回答时记录访问日志（时间、用户、drug id、source、verifiability）
- Lucent 端：`drug_source_imports` 已记录 source/hash，**新增** `medicine_content_review` 表：医师复审签字（drug id / 复审人 / 复审时间 / 抽样字段 / 结论）

## 运营流程（最容易漏的）

A 路径要求运营侧有三件事配合，**不能只动代码**。

### 1. 持证医师对中文药库字段的抽样审核

- 范围：适应症、用法用量、不良反应、禁忌、注意事项
- 频率：每次 import 重跑后抽样（建议每批 1% 抽样，最低 50 条/批）
- 记录：医师签字 + 时间，存 `medicine_content_review`
- **未签字字段**：前端隐藏或加"待审核"角标

### 2. DrugBank 字段中文化

- 范围：pharmacodynamics、mechanismOfAction、toxicity、absorption、halfLife、proteinBinding、routeOfElimination、volumeOfDistribution、clearance
- 方式：i18n key 化（`docs/reference/localization.md` 同步）
- 维护：Lucent 升级 DrugBank 版本时同步更新翻译 key

### 3. 医疗 QA 的 `safetyLabel` 双重过滤

- 服务端：`safetyLabel` 字段已做一次过滤（`medical_qa_chunks` import 时）
- prompt 层：助手调用 RAG 时**再做一次** `safetyLabel` 二次过滤，防止 LLM 召回时误升级表述
- 输出层：每条 QA 引用必须带 `verifiability: 'open_corpus'` 和 `sourceNote: '开放语料,低可信教育参考,无独立可验证来源'`

## 功能边界（明确划线）

### 可以做（A 路径允许）

- 药品说明书全文查询与浏览
- 适应症、用法用量、不良反应、禁忌字段展示
- 药物相互作用查询（基于 DrugBank 字段）
- ATC 分类浏览
- 症状解释、就医建议类问答
- 用药提醒（措辞调整后）
- 主动建议的"就医建议"类表述
- 数据导出与就诊摘要（用户主动行为）

### 不能做（触红线，超出 A 路径）

- 给出疾病诊断或诊断倾向
- 给出具体处方或剂量建议
- 自动调整用户治疗方案或服药计划
- 跨用户数据聚合生成"风险评分"
- 宣称对某疾病"有效"、"治愈率 X%"、"推荐用于 XX 病"
- 在没有医师审核流程下提供医疗信息
- 紧急医疗情况下的分诊建议（红旗信号仅提示"建议尽快就医"，不评判紧急程度）

## 为什么不做 B / C 路径

B（数字疗法 / SaMD）—— 宣称对某疾病有预防/治疗/管理效果即触发医疗器械软件监管。

- 注册：NMPA 二类/三类 医疗器械软件注册 / FDA 510(k) / De Novo / CE-MDR
- 质量体系：ISO 13485 体系贯标
- 软件生存周期：IEC 62304（A/B/C 级取决于风险等级）
- 风险管理：ISO 14971 全套
- 临床评价：临床试验或同品种对比，**不可省**
- AI 部分按医疗器械 AI 单独审，必须可解释、可追溯
- 上市后：不良事件上报、变更控制、年度自查
- 投入：3-5 年 + 数千万到亿级，全职 RA/QA/临床团队
- **当前资源/团队/资金结构不支持**——**切换到 B 等同于换公司**

C（互联网医院 / 医院 To B）—— 卖给医院或挂靠实体医院，处方权在执业医师手上。

- 牌照：互联网医院牌照（与实体医院合作）
- 医生：必须有执业医师在线问诊
- HIS/EMR 集成
- 数据：医疗数据本地化部署 + 驻留要求
- 隐私：HIPAA（美国）/ 国内医疗数据规范
- 投入：1-2 年，依赖医院合作方
- **当前业务结构（To C 个人助手）不支持**——**切换到 C 等同于业务模式重组**

两条路径都保留为下次战略评估时的候选，**当前不在 roadmap 上**。

## 引用与关联

- `Lucent/docs/archive/01-reference/contracts/data-sources.md` —— 三源检索策略与 durable table 清单
- `Lucent/docs/archive/01-reference/contracts/data-sources-cn-products.md` —— 中文药库源
- `Lucent/docs/archive/01-reference/contracts/data-sources-drugbank.md` —— DrugBank 源
- `Lucent/docs/archive/01-reference/contracts/data-sources-medical-qa.md` —— 医疗 QA 源 + F-15 可验证性分层
- `Lucent/prisma/models/medicine-knowledge.prisma` —— schema（DrugSourceImport / CnMedicineProduct / CnMedicineLeaflet / MedicalQaChunk / DrugbankDrug / DrugbankPassageChunk 等）
- `Luminous/assets/legal/disclaimer_zh.md` / `disclaimer_en.md` —— 法律文案（待替换）
- `Luminous/docs/product/product-vision.md` —— 产品愿景
- `Luminous/docs/product/product-safety-privacy.md` —— 安全与隐私边界（用药安全 / 漏服 / 红旗信号）

## 变更记录

- 2026-09-04：创建本文档，确立 A 路径（医疗信息）作为当前活跃监管定位；B / C 路径仅作占位说明
