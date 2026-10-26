# DDD 四层迁移收尾：拆分余留大模块与文档校正

> 状态：**待评审**。2026-10-26 起草。
> 范围：仅 `Lucent`。前端契约不变，**公开 OpenAPI 必须零 diff**。
> 前置阅读：`docs/reference/adr/0024-ddd-bounded-contexts-and-aggregates.md`、
> `docs/reference/adr/0025-domain-events-vs-queues.md`、`docs/TODO.md`
> 「DDD 四层迁移收尾遗留（2026-10-25）」。

## 零、这轮为什么还要做

2026-10-25 的六轨合并让 18 个模块落了四层，`typecheck` / `lint` / `arch:check` /
单测 / e2e 当时全绿。本轮核查（只读，未跑测试）确认门禁仍然全绿：
`typecheck` 0 error、`lint:check` 0 error（2 个 style warning）、`arch:check`
174 条基线无新增、`docs:verify` 与 `docs:links` 通过。**`@OnEvent` 与
`emitAsync` 在 `src/` 下已彻底清零**，ADR-0025 的双轨是真收尾了，不是留了两套。

但「绿」和「完成」不是一回事。三个缺口没有被任何门禁捕获：

1. **两个最大的模块没迁**：`reports`（6,875 行）与 `today-analysis`（3,099 行
   - 物化/管道耦合）。`docs/TODO.md` 的收尾章节只记了「小模块不迁」的口径，
     **没有登记这两个**，读起来像是全部迁完了。
2. **`user` 是半拆状态**：有 `application/` + `infrastructure/`，缺 `domain/` 与
   `adapters/`。293 行的模块出现「半个四层」，比完全没迁更容易误导后来人。
3. **三处 module README 仍在描述已删除的机制**（见 §4.1）。`docs:links`
   只校验**路径记号**是否存在，而这些是**散文里的文件名**，所以门禁报绿、
   文档已经撒谎。

这三条都属「文档/登记与实际不符」或「迁移半途」，不是设计缺陷。本轮把它们
清零，而不是继续堆新方案。

### 本轮不做，且已裁决

- **不引入 Kafka / RabbitMQ。** ADR-0025 的 Options 表已把「直接上消息中间件」
  列为未采纳（理由：新增基础设施与运维面，当前吞吐与消费者数量不值得），
  「明确不做」里再写了一遍。Lucent 已有 BullMQ 15 个队列，真正的命题是
  「要不要把 BullMQ 换成 MQ」，前置是
  `plans/2026-10-18-nestjs-microservices-monorepo.md` 的微服务裁决，
  该计划状态是「未开工，待裁决」。**单体现状下先上 MQ 只是把单体依赖换成
  更贵的单体依赖**，本轮不碰。
- **不改 ADR-0025 记为「未达成」的事件原子性**（`append` 不在生产者写事务内）。
  它需要先定 6 个生产模块的事务边界，与
  `domain-events-outbox.service.ts` 的 `tx` 参数改造绑在一起，是独立批次。
  见 §六 的登记说明。

## 一、验收口径

每步都必须独立可编译、独立可回滚、独立可提交。**每一步跑完的门禁是同一套**：

```bash
pnpm typecheck && pnpm lint:check && pnpm arch:check && pnpm docs:verify && pnpm docs:links
```

外加该步涉及模块的单测。`arch:check` 的基线**只减不增**：文件移动导致的
路径改名可以，新增观察条目一律视为回归，处理掉再提。

**公开契约零 diff**：`pnpm export:openapi` 后
`docs/reference/generated/openapi.json` 必须无变化。任一步若产生 diff，
说明该步动了 controller / DTO 的形态，退回改法而不是接受 diff。

## 二、`reports` 四层化（6,875 行，最大的一块）

### 2.1 现状

`reports` 是唯一同时具备「4 个 HTTP 入口 + 7 个 service 子域 + 直接 Prisma」
的未迁移模块。12 个非 spec 文件直接 import Prisma，分布：

| 文件                                                                                | 性质                                     |
| ----------------------------------------------------------------------------------- | ---------------------------------------- |
| `dashboard/context.service.ts`                                                      | 跨模块数据收集（已走 reader port，见下） |
| `services/ai-summary/summary.service.ts`                                            | 摘要编排 + 持久化                        |
| `services/clinic-summary/{summary,share,summary-view}.service.ts`                   | 门诊摘要聚合 / 分享 / 投影               |
| `services/event-review/{review,changes,actions,next-step}.service.ts`               | 事件回顾读模型为主                       |
| `dto/{clinic-summary-request,event-review-list-query,event-review-response}.dto.ts` | DTO 里带 Prisma 类型                     |

`dashboard/context.service.ts` **已经是干净的 ACL**：它只 import
`daily-records` / `medicine-dose-logs` / `user-settings` 三个模块的
**reader port**（`DailyRecordReaderPort`、`MedicineDoseLogReaderPort`、
`IUserSettingsPort`），没有跨模块直连 Prisma。这说明「跨上下文读走 reader port」
这条 ADR-0024 纪律在 reports 里**已经被遵守**，迁移不需要补 ACL。
它的问题只是**住错了目录**（363 行住在 `dashboard/` 而非 `adapters/acl/`）。

### 2.2 目标结构

按 ADR-0024 与 `File Naming Rules` §9（目录语义、去 `.service.ts` 后缀）：

| 原                                              | 新                                                                 | 理由                                      |
| ----------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------- |
| `reports.controller.ts`                         | `adapters/http/reports.controller.ts`                              | 投递层                                    |
| `clinic-summary.controller.ts`                  | `adapters/http/clinic-summary.controller.ts`                       | 同上                                      |
| `event-review.controller.ts`                    | `adapters/http/event-review.controller.ts`                         | 同上                                      |
| `dto/*.dto.ts`                                  | `adapters/http/dto/*.ts`                                           | 去 `.dto` 后缀                            |
| `dashboard/dashboard.service.ts`                | `application/use_cases/get-dashboard.ts`                           | 编排                                      |
| `dashboard/computation.service.ts`              | `domain/dashboard/metric-computation.ts`                           | 纯计算，可脱离 Prisma 单测                |
| `dashboard/presenter.service.ts`                | `application/read_models/dashboard.ts`                             | 投影                                      |
| `dashboard/context.service.ts`                  | `adapters/acl/dashboard-context.ts`                                | 跨上下文读 = ACL                          |
| `dashboard/cache-invalidation.queue.service.ts` | `adapters/queue/cache-invalidation.ts`                             | 队列跟着消费者（ADR-0025 §3）             |
| `dashboard/query-reasons.ts`                    | `domain/dashboard/query-reasons.ts`                                | 16 行，是「为什么这个指标缺测」的领域词汇 |
| `services/ai-summary/*.service.ts`              | `application/{use_cases,services}/…` + `adapters/queue/summary.ts` | 生成走 `common/llm` 基类，属基础设施      |
| `services/clinic-summary/*.service.ts`          | `domain/clinic-summary/` + `application/` + `infrastructure/pdf/`  | 见 2.3                                    |
| `services/event-review/*.service.ts`            | `application/use_cases/` + `application/read_models/`              | 以读模型为主                              |
| `ports/report-summary-reader.port.ts`           | `application/ports/report-summary-reader.ts`                       | 端口归应用层                              |
| `prompts/` `schemas/`                           | `adapters/` 或 `infrastructure/llm/`                               | 提示词与 schema 是 LLM 适配细节           |

### 2.3 `clinic-summary` 是唯一需要真判定的一处

`services/clinic-summary/summary.service.ts` 642 行，是全模块最大的单文件。
迁移前必须先回答「有没有聚合」，判据与 `today-suggestion` 的物化表那次一致：
**聚合的状态集必须封闭且显式；若某状态是从别的字段算出来的，说明状态模型没建对，
派生状态归查询侧。**

`clinic-summary` 有一个值得建聚合的点：**分享（share）**。`share.service.ts` 321 行
管 token 签发、撤销、公开访问。它满足聚合条件：有 `active` / `revoked` 的状态
转移、有「撤销后公开访问必须立即失效」的不变量、能脱离 Prisma 单测。
**先做这一步的判定记录**（写进 `src/modules/reports/README.md`），再决定
`summary.service.ts` 里哪些是真规则、哪些只是「查库 + 拼 DTO」。

**不建聚合的部分不要硬造**。`summary.service.ts` 若主要是分段拼装抽屉
（`clinical-drawers.ts` 312 行 + `record-drawers.ts` 171 行是**呈现**，不是领域），
它们应落 `application/read_models/`，不是 `domain/`。

### 2.4 建议分步

`reports` 太大，一步做完无法审查。按「无被依赖方优先」拆：

1. **R1**：`event-review` 子域（以读模型为主，无跨模块写，风险最低）。
2. **R2**：`dashboard` 子域（`computation` 下沉 `domain/`，`context` 落
   `adapters/acl/`，`presenter` 落读模型，队列落 `adapters/queue/`）。
3. **R3**：`ai-summary` 子域。
4. **R4**：`clinic-summary` 子域（先出 2.3 的聚合判定，再动手）。

每步结束更新 `src/modules/reports/README.md` 的 `内部结构` 一节——**该节目前
写的是 `cache-invalidation.listener`，已不存在**，见 §4.1。

## 三、`today-analysis` 四层化（3,099 行）

### 3.1 现状

比 `reports` 小，但耦合更紧：它是**事件驱动**的，且与 `today-suggestion` 的
物化模式同构。目录是 `dto/ prompts/ schemas/ services/ types/`，
`services/` 下分 `materialization/`、`pipeline/`、`recompute/` 三个子域。

它已经有 `common/events/subscriptions.ts` 的订阅行（`todayAnalysis` 队列 +
`TODAY_ANALYSIS_EVENT_JOB`），消费逻辑在
`services/recompute/event-consumer.service.ts`（262 行）。**这是 ADR-0025 接上了
但没归位**：队列消费者按 §3「队列跟着消费者走」应住 `adapters/queue/`。

### 3.2 目标结构

| 原                                               | 新                                                                                     | 理由                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------- |
| `today-analysis.controller.ts`                   | `adapters/http/today-analysis.controller.ts`                                           | 516 行，先拆再搬                         |
| `dto/*.dto.ts`                                   | `adapters/http/dto/*.ts`                                                               | 去 `.dto` 后缀                           |
| `services/analysis-queue.service.ts`             | `adapters/queue/analysis.ts`                                                           | 161 行，队列归位                         |
| `services/recompute/event-consumer.service.ts`   | `adapters/queue/event-consumer.ts`                                                     | 同上                                     |
| `services/recompute/analysis-queue.port.ts`      | `application/ports/analysis-queue.ts`                                                  | 端口归应用层                             |
| `services/pipeline/context.service.ts`           | `adapters/acl/analysis-context.ts`                                                     | 476 行跨上下文汇聚 = ACL，**最大的一个** |
| `services/pipeline/generator.service.ts`         | `infrastructure/llm/analysis-generator.ts`                                             | LLM 适配                                 |
| `services/pipeline/copy.service.ts`              | `application/services/copy.ts`                                                         | i18n 文案属编排                          |
| `services/pipeline/recommendations.service.ts`   | `domain/analysis/recommendations.ts` 或读模型                                          | **先判定**：内置指南是否含规则           |
| `services/pipeline/trigger-evaluator.service.ts` | `domain/analysis/trigger-evaluator.ts`                                                 | 178 行，「什么变化值得重算」是领域判断   |
| `services/materialization/store.service.ts`      | `infrastructure/persistence/materialization.ts` + `domain/analysis/materialization.ts` | **对照 `today-suggestion` 的既有判据**   |
| `types/materialization.types.ts`                 | 跟随实现                                                                               | 持久化行形状                             |
| `services/analysis.service.ts`                   | `application/use_cases/generate-analysis.ts`                                           | 574 行，先拆成用例                       |
| `index.ts`（**当前 0 字节**）                    | 删除                                                                                   | 无导出面的空 barrel 是遗迹               |

### 3.3 必须先回答的两个判定

**判定 A —— 物化表要不要建聚合？**
`today-suggestion` 那次已经裁决过同构问题的答案：`user_suggestion_materializations`
**不建聚合**，因为 `stale` 不是状态而是投影，管理的是并发控制而非业务规则，
口径改述为「**版本只前进**」。`today-analysis` 的
`services/materialization/store.service.ts` 306 行是同一个模式
（`claim` / `stale` / 版本）。**除非能指出它与 suggestion 不同的第二条规则，
否则沿用同一裁决**，落 `infrastructure/persistence/` 并写判定理由。
不重复设计一次。

**判定 B —— `trigger-evaluator` 是不是领域规则？**
它决定「哪类变更值得重算分析」。这属于产品行为（`WATER_SHORTFALL_MIN_DAYS`
那类阈值同理），应进 `domain/`。但 `event-consumer.service.ts` 里有
`DIMENSION_RECORD_KINDS` 白名单——**这两处要一起判定**，否则会出现
「白名单在 adapter、判定在 domain」的割裂。

### 3.4 建议分步

1. **T1**：先删空 `index.ts`，把 `analysis-queue.port.ts` 与
   `event-consumer.service.ts` 归位到 `application/ports/` 与 `adapters/queue/`。
   **这一步最小且直接消掉「接上没归位」的那条**，可以独立提交。
2. **T2**：出 3.3 两条判定，写进 `src/modules/today-analysis/README.md`。
3. **T3**：`materialization` 落 `infrastructure/persistence/`。
4. **T4**：`pipeline` 四件套按 3.2 拆散。
5. **T5**：`analysis.service.ts` 574 行拆成用例，控制器 516 行随之瘦身。

**注意 T1 的一个真实陷阱**：`event-consumer.service.ts` 的 JSDoc 明确写了
「`markPending` 分配 `sourceVersion`，worker 与之比对，所以 `markPending` 必须先于
`enqueue`；context 失效最先跑」。搬目录时**这一步顺序不能动**，
搬完要在 spec 里补一条断言钉住顺序，否则将来改一处就变成「拿着旧上下文算出
一份看起来正常的错分析」。这是本轮唯一需要新增测试的强制项。

## 四、文档校正

### 4.1 三处已撒谎的 module README（必须改）

门禁抓不到：`docs:links` 只校验路径记号是否存在，而这些是散文里的文件名。

1. `src/modules/reports/README.md` 第 35 行：`cache-invalidation.listener`
   —— 实际是 `dashboard/cache-invalidation.queue.service.ts`，且已按 ADR-0025
   改为队列消费。
2. `src/modules/today-analysis/README.md` 第 28 行：`…经 trigger.listener.ts 驱动`
   —— `trigger.listener.ts` 已删除，实际是 `services/recompute/event-consumer.service.ts`。
3. `src/modules/today-analysis/README.md` 第 40 行：`services/recompute/trigger.listener.ts`
   —— 同上，该文件不在「内部结构」列表里存在。

另核 `src/modules/today-suggestion/README.md` 第 40 行有无同类残留
（`services/recompute/trigger.listener.ts`），确认后一并改。

**修法**：改描述，不改结构。三处都是「把已删除的监听器写成现状」，
属措辞校正，不新增文档。

### 4.2 `docs/TODO.md` 补登两个未迁大模块

「DDD 四层迁移收尾遗留（2026-10-25）」章节现在只有「小模块不迁」的口径，
缺 `reports` 与 `today-analysis`。**这两条不写进 TODO 作为遗留，而是指向本计划**
（TODO 是台账，计划是执行源）：

```markdown
### reports / today-analysis 未迁四层（2026-10-26 核查发现）

两者是剩余最大的两块，`docs/TODO.md` 此前只记了小模块不迁的口径，遗漏了它们。
执行源：`plans/2026-10-26-ddd-migration-completion.md` §二 / §三。计划完成时
连同本条一起删除。
```

### 4.3 `user` 半拆状态的处置

`user` 293 行，现有 `application/{ports,use_cases}` + `infrastructure/persistence`，
缺 `domain/` 与 `adapters/`。**处置口径二选一，本轮选前者**：

- **补完**：controller 落 `adapters/http/`，补 `domain/`（若无聚合则不建，
  按 ADR-0024「不为 CRUD 硬造富领域模型」）。293 行的模块这样是完整的。
- **回退**：完全退回旧结构，与 `app-info` / `audit-log` 同一档。

选「补完」的理由：`user` 已有 application 层在跑，回退会制造一次无收益的
反向变更；补完只需搬 controller 并出一次聚合判定。**工作量约半天。**

### 4.4 修正既有 README 的引用错误

`src/modules/reports/README.md` 的 `Tests` 节列了
`services/ai-summary/*.spec.ts`、`services/clinic-summary/*.spec.ts` 等路径，
§二 迁移后这些路径会变。**R1–R4 每步结束同步更新，不在最后一次性补**——
一次性补是漂移的来源。

## 五、执行顺序与依赖

```text
D0  文档校正（§四）——零风险，先做，立刻消除误导
      ├── 4.1 三处 README
      ├── 4.2 TODO 补登
      └── 4.3 user 补完
T1  today-analysis 归位（§3.4 T1）——小而独立，先拿一个完整闭环
R1  reports/event-review
R2  reports/dashboard
T2  today-analysis 判定
R3  reports/ai-summary
T3–T5 today-analysis 收尾
R4  reports/clinic-summary —— 最大，放最后
```

**D0 与 T1 可以并行**，写作用域不重叠。R 系列与 T 系列之间无依赖，
但**不要同时开 R2 与 T3**：两者都动各自模块的 `application/`，虽不冲突，
但同一轮里两份 diff 一起审容易漏。

## 六、不并入本计划的既有遗留（明确划清）

以下在 `docs/TODO.md` 里已有条目，**本轮不动**,避免计划边界膨胀：

- **`append` 不在生产者写事务内**（ADR-0025「未达成」）。需要先定 6 个生产模块的
  事务边界，并联动 `domain-events-outbox.service.ts` 的 `tx` 参数改造。
- **消费者侧 `eventId` 幂等**（ADR-0025 §4 要求有副作用的消费者自行持久化）。
  需逐个消费者核实现状，是独立核查项。
- **`cron-jobs.service.ts` 仍持有 4 个业务模块引用**（`common-no-module-imports`
  3 条基线）。ADR-0025 已说明这是「cron 注册表知道所有定时任务」的另一类债。
- **剂量日志槽位唯一性缺失**（`mark` 的幂等只是「通常成立」）。需改 schema。
- 2 个 lint style warning（`JSON.parse(JSON.stringify)` 可用 `structuredClone`、
  `CONTROL_CHARACTERS` 正则）。纯风格，不阻断。

前两条是**数据正确性缺口，优先级高于本计划**，但需要独立裁决，故不在本轮。

## 七、完成标准

- `reports`、`today-analysis`、`user` 三个模块均具备完整四层结构，
  `arch:check` 基线**不高于 174**。
- `src/modules/**/README.md` 的 `内部结构` 一节与实际文件一一对应
  （**本轮新增一条人工核对项**：commit 前 `Get-ChildItem` 对照 README 列表）。
- `docs/TODO.md` 中 4.2 的临时条目删除。
- 全套门禁绿，`openapi.json` 零 diff。
- 每日变更写入 `docs/logs/migration-log/YYYY-MM-DD.md`（append-only），
  计划完成后本文件整体删除。
