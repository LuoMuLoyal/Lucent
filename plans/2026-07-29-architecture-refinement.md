# Lucent 架构精炼计划

> 创建于 2026-07-29。本计划记录对 Lucent 后端架构的全面审计结果和增量重构方案。
> 完成后删除本文件，将稳定决策更新到 `docs/01-reference/architecture.md`。

---

## 1. 现状诊断

### 1.1 数据概览

| 指标                                        | 数值                                    |
| ------------------------------------------- | --------------------------------------- |
| 非测试 TS 文件总数                          | 462                                     |
| >200 行文件                                 | 61 (13%)                                |
| >300 行文件                                 | 22 (5%)                                 |
| >500 行文件                                 | 5 (1%)                                  |
| 模块总数                                    | 24                                      |
| 最大模块 (today-suggestion)                 | 52 文件                                 |
| 最大单文件 (medicine-risk-check.service.ts) | 965 行                                  |
| 测试覆盖率                                  | 几乎 100%（每个 service 都有 .spec.ts） |

### 1.2 架构底子评估

Lucent 后端的架构**比 Luminous 前端更成熟**，已做了很多正确的事情：

1. **ADR-0009 跨模块数据访问治理** — 建立了表归属、读规则（`nonDeleted` helper + ReaderPort）、写规则（owning module service）
2. **Reader Port 模式已落地** — `DailyRecordReaderPort`、`MedicineDoseLogReaderPort` 已实施，返回 fact DTO 不暴露 Prisma DSL
3. **Assistant 消费方 Port 模式** — `assistant/types/ports.ts` 是全库最好的边界示范，消费方定义接口，提供方实现
4. **AI Pipeline 三层一致** — Context Service → Generator Service (extends `BaseLlmGeneratorService`) → Safety Policy，所有 AI 模块遵循
5. **BaseAsyncQueueService 抽象** — 6 个 BullMQ 队列服务共享基类，消除重复的 queue/cache/status 模式
6. **Module barrel export** — 每个模块有 `index.ts`，跨模块 import 通过 barrel 不走深路径
7. **测试覆盖优秀** — 几乎每个文件都有 co-located spec
8. **Module subdirectory 治理** — AGENTS.md 有明确的 whitelist，超过 8 文件时按 domain 拆子目录

### 1.3 核心问题

#### 问题 A：God Service 文件（最高优先级）

5 个文件超过 500 行，其中 3 个是真正的 god class：

| 文件                                                | 行数 | 问题                                                                                                                                    |
| --------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `medicines/services/medicine-risk-check.service.ts` | 965  | 混合了 6 种职责：成分规范化（纯领域逻辑）、过敏严重度推断（纯领域逻辑）、药品详情包装器、风险检测逻辑、LLM 上下文构建、缓存管理、主编排 |
| `data-export/services/report-pdf/draw.service.ts`   | 591  | PDF 绘制函数集合——可接受，纯渲染函数文件长不等于设计问题                                                                                |
| `assistant/agent/runtime/router.ts`                 | 563  | 大量 keyword regex 规则——应数据驱动而非代码驱动                                                                                         |
| `assistant/tools/read.service.ts`                   | 542  | 混合了 7 种 read tool 的实现——可按 tool 拆分                                                                                            |
| `assistant/tools/proposal.service.ts`               | 523  | 混合了 proposal 生成 + 验证 + 呈现——可拆分                                                                                              |

#### 问题 B：Reader Port 迁移未完成

ADR-0009 定义了 reader port 标准，但部分模块仍直接注入 `PrismaService` 做跨模块读：

| 文件                                                     | 问题                                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `today-suggestion/services/collectors/record.service.ts` | 同时注入 `PrismaService` 和 `DailyRecordReaderPort`——reader port 用于 daily records，但 `UserSetting` 查询仍直走 Prisma |
| `assistant/tools/read.service.ts`                        | 直接注入 `PrismaService`，而非全部通过 reader port                                                                      |
| `today-analysis/services/context.service.ts`             | 直接注入 `PrismaService` 查询 `UserMedicineReminder`，应通过 `medicine-reminders` 模块的 reader                         |
| `reports/dashboard/context.service.ts`                   | 同上，直接注入 `PrismaService` 查询多模块数据                                                                           |

ADR-0009 明确"读模型模块（today-\*/reports）豁免"——但这些模块的直查可以用更清晰的内部
repository 封装，而非 service 直接操作 Prisma。

#### 问题 C：today-suggestion 模块内部复杂度

52 个非测试文件，30 个 service，9 个子目录——这是全库最复杂的模块。

```
today-suggestion/services/
├── arbitration/       (4 files) — 仲裁：评分 + 抑制
├── cache/             (3 files) — 缓存 + 失效监听
├── collectors/        (5 files) — 信号采集：medication / record / profile
├── copy/              (5 files) — LLM 文案生成 + 队列
├── explanation/       (5 files) — 解释生成 + 队列
├── feedback/          (3 files) — 反馈 + 统计
├── lifecycle/         (3 files) — 生命周期 + 基线
├── notification/      (1 file)  — 升级通知
├── rules/             (13 files) — 7 条规则 + registry + version registry
└── suggestion.service.ts        — 主编排器（13 个依赖注入）
```

**问题不在子目录结构**（结构本身合理），而在于：

1. `SuggestionService` 主编排器注入了 13 个依赖，`generate()` 方法 405 行
2. 7 条规则各自独立文件但共享大量 `types/` 和 `constants/` import——规则间隐式耦合通过 type 定义
3. `forwardRef` 双向引用虽已移除，但 `daily-records` 和 `medicine-dose-logs` 仍通过缓存失效监听器反向依赖 `today-suggestion`

#### 问题 D：文档不一致

`AGENTS.md` 规定 "No sub-directory barrels，跨模块通过 module root barrel"，但 `CLAUDE.md` 说
"Every sub-directory must have index.ts re-exporting with export \*"。两者矛盾。
实际代码遵循 `AGENTS.md`（无 sub-directory barrel）。

#### 问题 E：`medicine-risk-check.service.ts` 职责混合（965 行）

这个文件是全库最大文件，混合了 6 种职责：

```
行 1-200:   成分规范化 — canonicalIngredientVariants map + normalizeToken + extractIngredientTokens
行 142-175: 过敏严重度推断 — anaphylaxisKeywords + inferredAllergySeverity
行 176-200: 药品详情包装器 — MedicineDetailWrapper + getter 函数
行 200-500: 风险检测逻辑 — duplicate ingredients / allergy / interaction / coverage
行 500-700: LLM 上下文构建 — buildRiskLlmContext
行 700-965: 主服务 — MedicineRiskCheckService class (cache + orchestration)
```

其中前 200 行是**纯领域逻辑**（无 NestJS 依赖、无 Prisma、无 I/O），应该提取到独立的
domain 模块或至少独立的 `utils/` 文件中。

#### 问题 F：`assistant/agent/runtime/router.ts` 规则硬编码（563 行）

`TOOL_KEYWORD_RULES` 是一个 300+ 行的 `Record<ToolName, RegExp[]>` 常量。这些规则应
从代码中提取为配置文件或数据表，而非内联在 TS 文件中。

---

## 2. 方案选择

### 不选择全套 DDD

- DDD 战术模式对 NestJS 后端有一定价值（聚合根、值对象、领域事件），但全库 24 个模块
  中只有 `today-suggestion`、`medicines`、`daily-records` 有足够复杂的领域逻辑值得引入
- 其他模块（`files`、`notifications`、`user-devices` 等）是纯 CRUD，DDD 过度设计

### 选择：Pragmatic Module Refinement

与 Luminous 前端一样，**不换架构范式**，在现有 NestJS module + ADR-0009 基础上做增量改进：

1. **拆 god class** — 把 `medicine-risk-check.service.ts` 拆成 3-4 个聚焦的 service
2. **补 reader port** — 完成 ADR-0009 未覆盖的 reader port
3. **数据驱动化** — 把 `router.ts` 的 regex 规则提取为配置
4. **修文档不一致** — 对齐 AGENTS.md 和 CLAUDE.md

---

## 3. 重构方案

### 3.1 拆分 `medicine-risk-check.service.ts`（最高优先级）

将 965 行拆为 4 个文件。现有 `medicine-risk-check.service.ts` 和
`medicine-risk-llm-generator.service.ts` 同时违反命名规则（`medicine-` 前缀重复
模块名 `medicines`），在拆分时一并重命名：

```
medicines/
├── services/
│   ├── risk-check.service.ts                 ← 主编排器 + 缓存 (~250 行)
│   ├── risk-detection.service.ts             ← 风险检测逻辑 (~300 行)
│   ├── risk-llm-generator.service.ts          ← 重命名自 medicine-risk-llm-generator
│   └── risk-context-builder.ts               ← LLM 上下文构建 (~150 行)
├── utils/
│   ├── helpers.ts                            ← 已存在
│   ├── ingredient-canonicalization.ts        ← 成分规范化 (纯函数) (~150 行)
│   └── allergy-severity.ts                   ← 过敏严重度推断 (纯函数) (~50 行)
```

**原则**：

- 纯函数（无 DI 依赖）→ `utils/`
- 有 DI 依赖的检测/构建逻辑 → `services/`
- 主 service 只做编排（收集输入 → 调用检测 → 调用 LLM → 缓存 → 返回）
- 文件名去掉 `medicine-` 前缀（模块名 `medicines` 已在路径中，`risk-` 是子主题）

### 3.2 拆分 `assistant/agent/runtime/router.ts`

```
assistant/
├── agent/
│   ├── runtime/
│   │   ├── router.ts              ← 路由逻辑 (~100 行)
│   │   └── tool-keyword-rules.ts  ← 规则常量提取 (~50 行)
│   └── ...
├── config/
│   └── tool-keyword-rules.json    ← 或 .ts 配置文件，数据驱动
```

将 `TOOL_KEYWORD_RULES` 和 `selectAllowedToolsForContextSources` 分离，规则定义变为
配置数据而非代码逻辑。

### 3.3 拆分 `assistant/tools/read.service.ts`

当前一个 service 实现了 7 个 read tool（`getTodayRecords`、`getRecordsByDate`、
`getRecordsByRange`、`getTodaySummaryByDate`、`getReportSummaryByRange`、
`getRecentTodaySummaries`、`getRecentReportSummaries`、`getUserProfile`）。

按 tool 分组拆为：

```
assistant/tools/
├── read.service.ts           ← 主入口，路由到子 service (~100 行)
├── records/
│   ├── query.service.ts      ← 已存在
│   ├── today-records.service.ts
│   ├── date-records.service.ts
│   └── range-records.service.ts
├── summaries/
│   ├── today-summary.service.ts
│   └── report-summary.service.ts
└── profile/
    └── read.service.ts
```

**注意**：这会增加文件数量但每个文件聚焦单一 tool，可读性和可测试性提升。
如果觉得过度拆分，可保持 `read.service.ts` 作为入口，把各 tool 的实现抽为 private
method 到独立文件再组合。

### 3.4 Reader Port 补全

| 待补 Port                        | 归属模块            | 消费方                      | 动作                                                        |
| -------------------------------- | ------------------- | --------------------------- | ----------------------------------------------------------- |
| `UserMedicineReminderReaderPort` | medicine-reminders  | today-analysis, reports     | 新增 reader port，返回 reminder fact DTO                    |
| `UserSettingReaderPort`          | user-settings       | today-suggestion collectors | 新增 reader port 或直接通过 `UserSettingsService` 导出      |
| `UserHealthContextReaderPort`    | user-health-context | today-suggestion collectors | 已有 `UserHealthContextService` 导出，确认是否需要 fact DTO |

**today-analysis 和 reports 的 PrismaService 直查**：ADR-0009 豁免了读模型模块，但
建议在模块内部增加 `repositories/` 封装，service 不直接操作 Prisma。

### 3.5 today-suggestion 模块内部优化

**不拆分模块**（子目录结构已合理），但优化主编排器：

```typescript
// 当前：SuggestionService 注入 13 个依赖
constructor(
  private readonly medicationCollector: MedicationCollectorService,
  private readonly recordCollector: RecordCollectorService,
  private readonly profileCollector: ProfileCollectorService,
  private readonly registry: RegistryService,
  private readonly suppression: SuppressionService,
  private readonly arbitration: ArbitrationService,
  private readonly baseline: BaselineService,
  private readonly lifecycle: LifecycleService,
  private readonly escalation: EscalationService,
  private readonly cache: SuggestionCacheService,
  private readonly copyService: SuggestionCopyService,
  private readonly copyQueue: SuggestionCopyQueueService,
  private readonly i18n: I18nService,
) {}

// 重构后：按 pipeline 阶段分组
constructor(
  private readonly pipeline: SuggestionPipeline,        // 封装 collect→rules→arbitrate
  private readonly lifecycle: SuggestionLifecycleService, // 生命周期管理
  private readonly presentation: SuggestionPresentationService, // copy + cache + DTO mapping
  private readonly escalation: EscalationService,
) {}
```

引入 `SuggestionPipeline` 封装 collect → rules → arbitrate 三步，
`SuggestionPresentationService` 封装 copy generation + cache + DTO mapping。

### 3.6 文件命名规范化

对全库 `src/modules/` 做 AGENTS.md 命名规则审计，发现 25 处违规（R1 模块名前缀 ×10、
R3 裸类型词 ×5、R5 子目录名前缀 ×10）。以下按违规类型列出，spec 文件（`.spec.ts`）
跟随源文件同步重命名（Rule 7）。

#### R1：模块名前缀（10 处）

模块 `medicines` 内部文件以 `medicine-`（模块名单数）为前缀，模块路径已表明归属：

| 当前文件                                                    | 重命名                          | 规则                 |
| ----------------------------------------------------------- | ------------------------------- | -------------------- |
| `medicines/dto/medicine-detail.dto.ts`                      | `detail.dto.ts`                 | R1                   |
| `medicines/dto/medicine-query.dto.ts`                       | `query.dto.ts`                  | R1                   |
| `medicines/dto/medicine-response.dto.ts`                    | `response.dto.ts`               | R1                   |
| `medicines/dto/medicine-safety-tip-response.dto.ts`         | `safety-tip-response.dto.ts`    | R1                   |
| `medicines/dto/medicine-search.dto.ts`                      | `search.dto.ts`                 | R1                   |
| `medicines/dto/medicine-source.dto.ts`                      | `source.dto.ts`                 | R1                   |
| `medicines/services/medicine-recognition-queue.service.ts`  | `recognition-queue.service.ts`  | R1                   |
| `medicines/services/medicine-risk-check.listener.ts`        | `risk-check.listener.ts`        | R1                   |
| `medicines/services/medicine-risk-check.service.ts`         | `risk-check.service.ts`         | R1（Phase 1 已覆盖） |
| `medicines/services/medicine-risk-llm-generator.service.ts` | `risk-llm-generator.service.ts` | R1（Phase 1 已覆盖） |

#### R3：裸类型词（5 处）

文件名为 `service.ts` / `constants.ts` / `types.ts` / `helpers.ts`，缺少业务限定词：

| 当前文件                                       | 重命名                    | 业务词依据            |
| ---------------------------------------------- | ------------------------- | --------------------- |
| `assistant/tools/constants.ts`                 | `tool-constants.ts`       | 工具常量              |
| `assistant/tools/types.ts`                     | `tool-types.ts`           | 工具类型定义          |
| `daily-records/services/candidates/service.ts` | `orchestrator.service.ts` | 编排 copy + generator |
| `medicines/utils/helpers.ts`                   | `data-format.ts`          | 数据格式化纯函数      |
| `reports/dashboard/types.ts`                   | `metrics.types.ts`        | 仪表盘指标类型        |

#### R5：子目录名前缀（10 处）

文件名重复了所在子目录名：

| 当前文件                                                       | 重命名                     | 说明                         |
| -------------------------------------------------------------- | -------------------------- | ---------------------------- |
| `medicines/cache/cache-admin.service.ts`                       | `admin.service.ts`         | `cache/` 已表明领域          |
| `medicines/cache/cache.constants.ts`                           | `store.constants.ts`       | 配合 `store.service.ts` 命名 |
| `medicines/cache/cache.service.ts`                             | `store.service.ts`         | 主缓存存储服务               |
| `today-suggestion/services/copy/copy-llm-generator.service.ts` | `llm-generator.service.ts` | `copy/` 已表明领域           |
| `today-suggestion/services/copy/copy-queue.service.ts`         | `queue.service.ts`         | 同上                         |
| `today-suggestion/services/copy/copy.service.ts`               | `writer.service.ts`        | 文案写入编排                 |
| `today-suggestion/services/arbitration/service.ts`             | `arbiter.service.ts`       | 仲裁器                       |
| `today-suggestion/services/explanation/service.ts`             | `explainer.service.ts`     | 解释生成                     |
| `today-suggestion/services/feedback/service.ts`                | `recorder.service.ts`      | 反馈记录                     |
| `today-suggestion/services/lifecycle/service.ts`               | `manager.service.ts`       | 生命周期管理                 |

**注意**：所有重命名仅改文件名，类名不变（Rule 6）。每个文件的 `.spec.ts` 同步重命名
（Rule 7）。barrel `index.ts` 中的 `export` 路径需同步更新。跨模块 import 通过 barrel，
只需更新 barrel 内部路径，消费方无需改动。

### 3.7 修复文档不一致

`CLAUDE.md` 中的 Barrel Exports 部分与 `AGENTS.md` 矛盾：

```
# CLAUDE.md (错误)
Every sub-directory inside a module must have an index.ts re-exporting with export *

# AGENTS.md (正确)
No sub-directory barrels — sub-directories are internal namespaces, not export surfaces
```

修改 `CLAUDE.md` 对齐 `AGENTS.md`。

---

## 4. 执行计划

### Phase 3：today-suggestion 编排器优化（中风险）

| 步骤 | 动作                                                                  |
| ---- | --------------------------------------------------------------------- |
| 3.1  | 新建 `SuggestionPipeline` service，封装 collect → rules → arbitrate   |
| 3.2  | 新建 `SuggestionPresentationService`，封装 copy + cache + DTO mapping |
| 3.3  | `SuggestionService` 瘦身为 4 个依赖，`generate()` 方法降到 ~150 行    |

**验证**：`pnpm test:ci`（today-suggestion 有完整 spec 覆盖）。

### Phase 4：文件命名规范化（低风险，高收益）

**目标**：修复 25 处命名违规，使全库文件名符合 AGENTS.md 规则。

| 步骤 | 范围                                                                                | 动作                                                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1  | `medicines/dto/`                                                                    | 6 个 DTO 文件去掉 `medicine-` 前缀 + 同步 spec                                                                                                                |
| 4.2  | `medicines/services/`                                                               | `medicine-recognition-queue` → `recognition-queue`；`medicine-risk-check.listener` → `risk-check.listener`（risk-check.service 和 risk-llm-generator 已完成） |
| 4.3  | `medicines/cache/`                                                                  | 3 个文件去掉 `cache-` 前缀 + 同步 spec                                                                                                                        |
| 4.4  | `medicines/utils/helpers.ts`                                                        | 重命名为 `data-format.ts` + 同步 spec                                                                                                                         |
| 4.5  | `assistant/tools/`                                                                  | `constants.ts` → `tool-constants.ts`；`types.ts` → `tool-types.ts` + 同步 spec                                                                                |
| 4.6  | `daily-records/services/candidates/service.ts`                                      | 重命名为 `orchestrator.service.ts` + 同步 spec                                                                                                                |
| 4.7  | `reports/dashboard/types.ts`                                                        | 重命名为 `metrics.types.ts` + 同步 spec                                                                                                                       |
| 4.8  | `today-suggestion/services/copy/`                                                   | 3 个文件去掉 `copy-` 前缀 + 同步 spec                                                                                                                         |
| 4.9  | `today-suggestion/services/{arbitration,explanation,feedback,lifecycle}/service.ts` | 4 个 `service.ts` 加业务词 + 同步 spec                                                                                                                        |
| 4.10 | 全局                                                                                | 更新所有 `index.ts` barrel 中的 export 路径                                                                                                                   |

**验证**：`pnpm lint:check` + `pnpm build` + `pnpm test:ci`。

### Phase 5：文档对齐（低风险）

| 步骤 | 动作                                                               |
| ---- | ------------------------------------------------------------------ |
| 5.1  | 修改 `CLAUDE.md` Barrel Exports 部分对齐 `AGENTS.md`               |
| 5.2  | 更新 `docs/01-reference/architecture.md` 补充 reader port 完整列表 |
| 5.3  | 运行 `pnpm docs:check` 确认文档覆盖                                |

---

## 5. 风险与缓解

| 风险                                       | 概率 | 缓解                                                  |
| ------------------------------------------ | ---- | ----------------------------------------------------- |
| Phase 3 编排器重构破坏 suggestion pipeline | 中   | today-suggestion 有完整 spec 覆盖，每步验证           |
| Reader port 新增导致 module 循环依赖       | 低   | 使用 `forwardRef` 或事件驱动解耦（ADR-0009 已有先例） |

---

## 6. 不做的事情

- **不拆分 today-suggestion 模块** — 子目录结构已合理，问题在编排器不在模块划分
- **不为纯 CRUD 模块引入 reader port** — ADR-0009 已豁免
- **不引入 CQRS / Event Sourcing** — 读模型模块的直查在 ADR-0009 中已豁免
- **不重写 BaseAsyncQueueService** — 基类稳定且被 6 个队列服务共享
- **不迁移到 hexagonal architecture** — ADR-0009 的 port 模式已在做同样的事情
- **不碰 Prisma schema** — 数据模型不在重构范围
- **不碰 generated/** — 生成代码不在重构范围

---

## 7. 优先级总结

| 优先级 | Phase                     | 预期工作量 | 收益                                          |
| ------ | ------------------------- | ---------- | --------------------------------------------- |
| 🟡 中  | Phase 2: Reader Port 补全 | 0.5 天     | 完成 ADR-0009 遗留项，消除 PrismaService 直查 |
| 🟡 中  | Phase 3: 编排器优化       | 0.5 天     | SuggestionService 依赖 13→4，可读性提升       |
| 🟡 中  | Phase 4: 命名规范化       | 0.5 天     | 25 处违规修复，全库命名一致                   |
| 🟢 低  | Phase 5: 文档对齐         | 0.5 小时   | 消除 AGENTS.md / CLAUDE.md 矛盾               |

---

## 8. 与 Luminous 前端的对比

| 维度        | Lucent 后端                            | Luminous 前端                                                     |
| ----------- | -------------------------------------- | ----------------------------------------------------------------- |
| 最大文件    | 965 行 (1 个)                          | 1226 行 (1 个)                                                    |
| >500 行文件 | 5 个                                   | 16 个                                                             |
| 膨胀根因    | God class 混合多种职责                 | 缺少 application 层，页面承载编排逻辑                             |
| 跨模块耦合  | ADR-0009 已治理，有 reader port        | 无契约，直接 import 其他 feature 的 data/presentation             |
| 架构成熟度  | 更高（ADR + port + barrel + 测试覆盖） | 有基础但缺少 application 层和跨 feature 契约                      |
| 重构量      | 较小（拆几个文件 + 补 port）           | 较大（新增 application 层 + 提升 cross-cutting + 瘦身 16 个文件） |
