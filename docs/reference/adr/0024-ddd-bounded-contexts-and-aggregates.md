# ADR-0024: 采用标准 DDD 的限界上下文与聚合边界

- **Status**: accepted
- **Date**: 2026-10-21
- **Deciders**: LuoMuLoyal

## Context

当前后端的默认形态是 `controller → service → Prisma`：27 个模块中只有 7 个有
`repositories/`，52 个非 spec service 直接 import Prisma。跨模块读写靠 ADR-0009 的
reader port 与「读模型 / 纯 CRUD 豁免」兜底，但模块内部仍普遍是贫血 service：
业务规则散在 service、SQL 与 DTO 之间，聚合边界与不变量没有显式建模。

这带来三个具体问题：

- **边界不可验证**：模块名是目录约定，不是限界上下文；一个模块可以同时承载目录、
  导入、风险检查等不同语言，拆分服务时无法直接沿用。
- **规则不可测试**：不变量写在 service 流程里，测试只能通过 Prisma mock 间接覆盖；
  换存储或换入口时规则容易漂移。
- **集成不可控**：跨模块直接 join/读表、同步调用链，最终会变成分布式单体；
  ADR-0009 的豁免条款（读模型、纯 CRUD）进一步放大了这个口子。

微服务计划（`plans/2026-10-18-nestjs-microservices-monorepo.md`）需要先有稳定的
上下文与聚合边界，否则拆出去只是把同一张表复制到更多进程。

## Decision

### 1. DDD 是设计方法，分层是代码组织

采用**标准 DDD**：战略设计划限界上下文与上下文映射，战术设计用聚合、聚合根、
实体、值对象、领域事件、领域服务与 repository 保护不变量。

Clean/Hex 四层不再作为「架构标准」，只作为代码组织方式：

```text
domain/          聚合、实体、值对象、领域事件、repository port、领域服务
application/     use case、事件处理器、读模型、出站 port
adapters/        HTTP、SSE、队列消费者、入站事件、ACL、框架适配
infrastructure/  Prisma、Redis、LLM、检索、OAuth、通知等实现
```

依赖只能向内：`adapters → application → domain`，`infrastructure` 实现
`domain`/`application` 的 port；`domain` 不依赖任何框架或 IO。

### 2. 首批限界上下文

| 限界上下文        | 现有模块                          | 子域类型   | 聚合根                                                    |
| ----------------- | --------------------------------- | ---------- | --------------------------------------------------------- |
| Identity & Access | `auth`                            | supporting | `Account`、`Session`、`VerificationChallenge`             |
| Medicine Catalog  | `medicines`（目录/导入/安全贴士） | core       | `Medicine`、`ImportBatch`、`SafetyTip`                    |
| Medication Safety | `medicines`（风险检查）           | supporting | `RiskAssessment`                                          |
| AI Assistant      | `assistant`                       | core       | `Conversation`、`Memory`、`Proposal`、`Summary`           |
| Daily Guidance    | `today-suggestion`                | core       | `DailySuggestion`、`SuggestionFeedback`、`RuleDefinition` |

`medicines` 模块当前同时承载 Medicine Catalog 与 Medication Safety。重构时先在模块内
按上下文分包，等事件与发布语言稳定后再评估拆服务；不在本 ADR 中拆进程。

上游 supporting 上下文（Health Log、Medication Tracking、User Profile、
Notifications、Content/Ontology）不在首批，但它们的发布语言与事件契约在本 ADR 中先固定。

### 3. 上下文映射

```text
Identity & Access ──UserId / AccountStatus──▶ 所有上下文
Medicine Catalog ──MedicineFact / IngredientId──▶ Medication Safety
Medicine Catalog ──MedicineFact──▶ Medication Tracking / Daily Guidance / AI Assistant
Health Log ──DailyRecordFact / MealFact──▶ Daily Guidance / AI Assistant
Medication Tracking ──DoseFact / ReminderFact──▶ Daily Guidance / AI Assistant
User Profile ──ProfileFact / Locale / Timezone / Unit──▶ Daily Guidance / AI Assistant
AI Assistant ──ProposedAction──▶ Health Log / User Settings（仅经用户确认）
Daily Guidance ──SuggestionEscalated──▶ Notifications
Content/Ontology ──ACL──▶ AI Assistant
```

规则：

- 共享内核只允许标识与值对象：`UserId`、`LocalDate`、`Timezone`、`Locale`、`Unit`。
  不共享实体、聚合、表或 Prisma model。
- 跨上下文读只经 reader port 或领域事件；跨上下文写只经命令/提案，由目标上下文执行。
- 外部系统（OAuth、LLM、LightRAG、Semantica、邮件）只在下游 ACL 出现；领域层不出现
  外部字段名或 SDK 类型。
- 事件是事实，不是命令；事件经 outbox 发布，消费者幂等，schema 版本化。

完整上下文、发布语言与术语见
[context-map.md](../context-map.md) 与
[glossary.md](../glossary.md)。

### 4. 聚合、仓储与读模型

- 一个事务只改一个聚合；聚合之间只持 ID；不变量放在聚合根方法内。
- 每个聚合根一个 repository；repository 只服务于写侧聚合加载/保存，不暴露查询 DSL。
- 读模型（搜索、详情、工作台、时间线、建议卡片、会话列表）直接由查询侧组装，
  不建 repository、不承担不变量。
- 跨聚合规则用领域服务；应用服务只编排「加载 → 行为 → 保存 → 发布事件」。
- 不为 CRUD 硬造富领域模型；supporting 上下文允许薄聚合，但聚合根、仓储与事件边界
  仍必须显式。

### 5. 迁移与治理

- 首批按 `medicines` → `auth` → `today-suggestion` → `assistant` 迁移；每个上下文
  一个批次，批次内不改公开 API。
- 公开路径、operationId、DTO 字段、错误码、事件名保持零变化；
  `pnpm export:openapi` 必须零 diff。
- ADR-0009 中「读模型 / 纯 CRUD 模块可跳过 port」的豁免由本 ADR 取代；
  ADR-0009 的其余读写规则、表归属与 reader port 约定继续有效。
- `AGENTS.md` 的目录白名单、文件命名与 barrel 规则同步修订；
  dependency-cruiser 增加 domain/application/adapters/infrastructure 与跨上下文约束。
- **文件名分隔符统一 kebab-case（`-`），四层内不例外**。原先把 DDD 层的示例写成
  snake*case（`account_registered.ts`、`on*<event>.ts`），实作时跟着写成了
`risk_scoring.ts`/`cookie_policy.ts`这类；而仓库其余 359 个多词文件全部是 kebab。
结果是「分隔符取决于你在哪个目录」——一条没有任何工具强制的约定分裂成两套。
分隔符是**文件级**的统一规则（见`AGENTS.md` File Naming Rules 第 10 条），
与分层无关；目录名不在其内（`use_cases/`、`read_models/` 保持不变）。
  _2026-10-24 修订：本条为对初版措辞的更正，其余决策不变。_
- 不引入 event sourcing、独立事件存储或完整 CQRS 平台；读模型只做查询侧投影。

## Options Considered

| Option                              | Pros                                                         | Cons                                                                 |
| ----------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| **标准 DDD + 分层代码组织（采纳）** | 边界可验证；不变量可单测；为后续服务拆分提供上下文与事件契约 | 文件更多、学习曲线更陡；最终一致性与事件版本需要治理                 |
| 只做 Clean Architecture             | 分层清晰、依赖向内；改动相对小                               | 仍然是贫血模型；聚合/不变量/上下文映射缺位，跨模块耦合继续存在       |
| 只做模块化单体（无显式聚合）        | 目录调整少；短期速度快                                       | 规则继续散在 service；Prisma 泄漏与跨模块 join 难以收敛              |
| 先拆微服务再补 DDD                  | 服务边界看起来更“彻底”                                       | 边界未定就拆进程，会把耦合变成网络调用；数据所有权与事件契约更难回滚 |

## Consequences

- **变简单**：每个上下文有明确的聚合根、repository 与事件；业务规则可以脱离 Nest/Prisma
  做纯单测；跨上下文集成有发布语言与 ACL，不再靠直查对方表。
- **变复杂**：目录层级与文件数增加；团队需要统一语言与事件契约；读模型与写模型分离后，
  「写后立即读」需要 pending/刷新策略。
- **明确不做**：不引入 event sourcing、不新建独立事件存储、不做完整 CQRS 平台；
  读模型只是查询侧投影，事件只是上下文集成事实。
- **迁移成本**：首批四个模块需要分批搬迁；旧 `services/`、`repositories/` 在批次结束后
  删除，不做长期双轨。公开 API 不变，但内部 import 路径会大面积调整。
- **后续决策**：微服务拆分沿用本 ADR 的上下文映射；服务边界、数据库所有权与部署形态
  由微服务计划及其 ADR（0025/0026）决定。
