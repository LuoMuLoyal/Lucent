# 后端 DDD 重构计划：Identity & Access / Medicine Catalog / AI Assistant / Daily Guidance

Created: 2026-10-21
状态: 未开工
范围: Lucent 首批 4 个模块；不包含微服务拆分、不改公开 API
关系: 与 `2026-10-18-nestjs-microservices-monorepo.md` 互补；本计划先做单体内的限界上下文与聚合边界，后续服务拆分沿用同一张上下文映射
前置: 先落 ADR-0024（DDD 限界上下文、聚合边界、上下文映射与分层代码组织），由它取代 ADR-0009 中「读模型 / 纯 CRUD 模块可跳过 port」的豁免；ADR-0009 正文不改，仅更新 Status。

## 一、为什么先做这四个

判据：限界上下文是否清晰、聚合不变量是否值得保护、跨上下文耦合程度、模块规模，以及能否覆盖不同的 DDD 形态。

| 模块               | 限界上下文        | 子域类型   | 非 spec 文件 | LOC    | 直接 import Prisma | repositories | 选择理由                                                          |
| ------------------ | ----------------- | ---------- | ------------ | ------ | ------------------ | ------------ | ----------------------------------------------------------------- |
| `auth`             | Identity & Access | supporting | 55           | 7,365  | 7                  | 1            | 上游上下文；Account/Session/Challenge 聚合边界清楚，安全不变量多  |
| `medicines`        | Medicine Catalog  | core       | 33           | 4,843  | 6                  | 0            | 领域最富（药品、成分、导入、风险）；可同时验证 core 与 supporting |
| `assistant`        | AI Assistant      | core       | 82           | 16,809 | 5                  | 1            | 最大、最复杂；Conversation/Memory/Proposal 聚合与工具 ACL 典型    |
| `today-suggestion` | Daily Guidance    | core       | 67           | 9,497  | 12                 | 0            | 下游读模型 + 规则引擎；跨上下文信号采集与领域事件最密集           |

`medicines` 模块实际承载两个上下文：**Medicine Catalog**（core，药品目录/导入/安全贴士）与 **Medication Safety**（supporting，风险规则/风险检查）。重构时先在同一模块内分包，后续可独立拆服务。

不在首批：

- `daily-records`：**Health Log** 上下文，已有 repository/port 先例；作为下游 Daily Guidance 的上游，等首批事件契约稳定后再改，避免同时动 AI 管线。
- `medicine-dose-logs`、`medicine-reminders`：**Medication Tracking** 上下文，与 Medicine Catalog 有清晰上下游关系，放第二批。
- `user-health-context`、`user-settings`：**User Profile** 上下文，作为 supporting 上下文提供 `ProfileFact`，不占用首批。
- `admin`：**Admin BFF**，无领域模型；等微服务计划的 BFF 边界定稿。
- `reports`、`today-analysis`：报表读模型，不是独立领域；复用 Daily Guidance 的发布语言。

## 二、战略设计：限界上下文与上下文映射

### 2.1 子域划分

| 子域类型   | 上下文                                                                              | 说明                                     |
| ---------- | ----------------------------------------------------------------------------------- | ---------------------------------------- |
| core       | Medicine Catalog、AI Assistant、Daily Guidance、Health Log、Medication Tracking     | 产品差异化所在；聚合与不变量优先投入     |
| supporting | Identity & Access、Medication Safety、User Profile、Notifications、Content/Ontology | 支撑核心域；模型可以较薄，但边界必须清楚 |
| generic    | Admin BFF、Platform（LLM runtime、storage、mail、cache、queue）                     | 不承载业务规则；通过 port/ACL 接入       |

### 2.2 限界上下文与现有模块

| 限界上下文          | 现有模块                                   | 首批 | 聚合根（目标）                                            |
| ------------------- | ------------------------------------------ | ---- | --------------------------------------------------------- |
| Identity & Access   | `auth`、`user`（账号部分）                 | 是   | `Account`、`Session`、`VerificationChallenge`             |
| Medicine Catalog    | `medicines`（目录、导入、安全贴士）        | 是   | `Medicine`、`ImportBatch`、`SafetyTip`                    |
| Medication Safety   | `medicines`（风险检查）                    | 是   | `RiskAssessment`                                          |
| AI Assistant        | `assistant`                                | 是   | `Conversation`、`Memory`、`Proposal`、`Summary`           |
| Daily Guidance      | `today-suggestion`                         | 是   | `DailySuggestion`、`SuggestionFeedback`、`RuleDefinition` |
| Health Log          | `daily-records`                            | 否   | `DailyRecord`                                             |
| Medication Tracking | `medicine-dose-logs`、`medicine-reminders` | 否   | `DoseLog`、`Reminder`                                     |
| User Profile        | `user-health-context`、`user-settings`     | 否   | `HealthProfile`、`UserSettings`                           |
| Notifications       | `notifications`                            | 否   | `Notification`（投递记录）                                |
| Content/Ontology    | `assistant` 检索语料、`deploy/semantica`   | 否   | `KnowledgeDocument`、`OntologyAssertion`                  |
| Admin BFF           | `admin`                                    | 否   | 无（只编排命令/查询）                                     |

### 2.3 上下文映射

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
外部 LLM / LightRAG / Semantica ──ACL──▶ AI Assistant / Medication Safety
Admin BFF ──命令/查询──▶ 各上下文
```

| 上游                | 下游                                                | 关系模式          | 发布语言 / 契约                                                  |
| ------------------- | --------------------------------------------------- | ----------------- | ---------------------------------------------------------------- |
| Identity & Access   | 所有上下文                                          | partnership       | `UserId`、`AccountStatus`；只共享标识与状态，不共享账号表        |
| Medicine Catalog    | Medication Safety                                   | shared kernel     | `MedicineId`、`IngredientId`、`MedicineFact`（仅只读事实）       |
| Medicine Catalog    | Medication Tracking / Daily Guidance / AI Assistant | customer-supplier | `MedicineFact`、`MedicineId`、`IngredientId`；下游只读           |
| Health Log          | Daily Guidance / AI Assistant                       | customer-supplier | `DailyRecordFact`、`MealFact`；经 reader port 或领域事件         |
| Medication Tracking | Daily Guidance / AI Assistant                       | customer-supplier | `DoseFact`、`ReminderFact`；经 reader port 或领域事件            |
| User Profile        | Daily Guidance / AI Assistant                       | conformist        | `ProfileFact`、`Locale`、`Timezone`、`Unit`                      |
| AI Assistant        | Health Log / User Settings                          | customer-supplier | `ProposedAction`；必须由用户确认，禁止直接写他上下文             |
| Daily Guidance      | Notifications                                       | customer-supplier | `SuggestionEscalated`；只发事实，不指定渠道细节                  |
| Content/Ontology    | AI Assistant                                        | ACL               | `OntologyQuery`、`OntologyFact`；sidecar 错误在 ACL 归一         |
| 外部 LLM / 检索     | AI Assistant / Medication Safety                    | ACL               | `LlmRequest`/`LlmResult`、`RetrievalHit`；超时与不可用是显式状态 |

上下文映射规则：

- **共享内核只允许标识与值对象**：`UserId`、`LocalDate`、`Timezone`、`Locale`、`Unit`。共享内核不包含实体、聚合或表。
- **跨上下文写只能经下游命令 + 上游确认**：AI Assistant 的写入提案必须先成为 `Proposal`，用户确认后由 Health Log / User Settings 的 use case 执行。
- **跨上下文读只能经 reader port 或领域事件**：禁止 import 对方 Prisma model、禁止 join 对方表、禁止复用对方 repository。
- **ACL 只放在下游**：外部 DTO、LLM 输出、检索结果、OAuth profile 都在下游 ACL 转成发布语言；领域层不出现外部字段名。
- **事件是事实，不是命令**：`SuggestionGenerated` 不告诉 Notifications「发什么」，只说明「生成了什么」；渠道策略由下游决定。

### 2.4 统一语言

| 术语                  | 含义                                                 | 归属              |
| --------------------- | ---------------------------------------------------- | ----------------- |
| Account               | 本地账号，持有凭据与 OAuth 身份链接                  | Identity & Access |
| Session               | 一次登录产生的 refresh/access 会话                   | Identity & Access |
| VerificationChallenge | 邮箱验证/重置密码的一次性挑战                        | Identity & Access |
| Medicine              | 药品目录中的可识别实体（源内唯一）                   | Medicine Catalog  |
| Ingredient            | 规范化后的成分；风险规则的匹配单位                   | Medicine Catalog  |
| ImportBatch           | 一次目录导入的元数据与行数对账结果                   | Medicine Catalog  |
| RiskAssessment        | 对一组药品/用户上下文的一次风险检查结果              | Medication Safety |
| Conversation          | 一次持续对话，包含有序消息与标题                     | AI Assistant      |
| Proposal              | 待用户确认的写入提案，有状态与过期时间               | AI Assistant      |
| Signal                | 规则引擎消费的只读事实（睡眠、饮食、用药、健康事件） | Daily Guidance    |
| DailySuggestion       | 某用户某日的一组建议卡片及其生命周期                 | Daily Guidance    |
| Feedback              | 用户对已交付建议的反馈（完成/忽略/抑制）             | Daily Guidance    |
| RuleDefinition        | 可版本化的规则定义与阈值                             | Daily Guidance    |

## 三、战术设计：聚合、不变量、事件、仓储

### 3.1 聚合设计规则

- 一个事务只改一个聚合；跨聚合一致性用领域事件与补偿，不用大事务。
- 聚合之间只持 ID，不持对象引用；聚合内部才允许实体/值对象引用。
- 聚合根是唯一对外入口；外部不能直接修改内部实体。
- 不变量放在聚合根方法里；应用服务只编排，不写业务判断。
- 聚合尽量小：只包住「必须同时成立」的规则；展示字段、统计、跨聚合查询放到读模型。
- 复杂创建用工厂（如 `Account.register`、`DailySuggestion.generate`）；跨聚合规则用领域服务。
- 不为 CRUD 造富领域模型：supporting 上下文允许薄聚合，但仍需明确的聚合根与仓储。

### 3.2 聚合与不变量

| 上下文            | 聚合根                  | 内部实体 / 值对象                                                          | 必须保护的不变量                                                                      | 领域事件                                                                                         |
| ----------------- | ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Identity & Access | `Account`               | `OAuthIdentity`、`Email`、`PasswordHash`、`AccountStatus`                  | 邮箱唯一；至少一种凭据或 OAuth 身份；停用后不能登录；OAuth `(provider, subject)` 唯一 | `AccountRegistered`、`EmailVerified`、`PasswordChanged`、`OAuthIdentityLinked`、`AccountDeleted` |
| Identity & Access | `Session`               | `RefreshToken`、`SessionId`、`ExpiresAt`                                   | refresh 轮换后旧 token 失效；撤销幂等；过期不可刷新；停用账号不可续期                 | `SessionIssued`、`SessionRefreshed`、`SessionRevoked`                                            |
| Identity & Access | `VerificationChallenge` | `ChallengePurpose`、`CodeHash`、`Attempts`、`ExpiresAt`                    | 单次消费；过期不可用；尝试次数上限；验证码不明文持久化                                | `ChallengeIssued`、`ChallengeConsumed`                                                           |
| Medicine Catalog  | `Medicine`              | `MedicineId`、`MedicineName`、`Ingredient`、`DosageForm`、`MedicineSource` | 源内 ID 唯一；至少一个名称；成分规范化；源字段缺失不造空值                            | `MedicineImported`、`MedicineUpdated`                                                            |
| Medicine Catalog  | `ImportBatch`           | `SourceId`、`Version`、`Hash`、`RowCounts`                                 | 目标表行数与源文件相等；重复导入幂等；失败批次不可标记完成                            | `ImportCompleted`、`ImportFailed`                                                                |
| Medicine Catalog  | `SafetyTip`             | `SafetyTipId`、`Locale`、`Body`                                            | 同 locale 内容非空；发布后版本不可原地改                                              | `SafetyTipPublished`                                                                             |
| Medication Safety | `RiskAssessment`        | `RiskFinding`、`RiskLevel`、`RiskPolicy`                                   | 一次请求对应一次评估；静态规则结果确定；完成后不可改写                                | `RiskAssessed`                                                                                   |
| AI Assistant      | `Conversation`          | `Message`、`ConversationTitle`、`ConversationStatus`                       | 消息顺序单调；归属用户；归档后不可追加；标题长度上限                                  | `ConversationStarted`、`MessageAppended`、`ConversationArchived`                                 |
| AI Assistant      | `Memory`                | `MemoryItem`、`MemoryId`                                                   | 每个用户一份；条目可去重；清空幂等                                                    | `MemoryCleared`                                                                                  |
| AI Assistant      | `Proposal`              | `ProposedAction`、`ProposalStatus`、`ExpiresAt`                            | 只有 pending 可确认；确认恰好一次；过期不可确认；动作目标必须属于当前用户             | `ProposalCreated`、`ProposalConfirmed`、`ProposalExpired`                                        |
| AI Assistant      | `Summary`               | `SummaryId`、`SummaryBody`                                                 | 每个对话版本一份摘要；摘要不反向修改消息                                              | `SummaryGenerated`                                                                               |
| Daily Guidance    | `DailySuggestion`       | `Candidate`、`SuggestionAction`、`SuggestionStatus`、`Explanation`         | 每用户每日一份；生命周期只前进；被抑制候选不再出现；文案与规则版本可追溯              | `SuggestionGenerated`、`SuggestionRecomputed`、`SuggestionSuppressed`                            |
| Daily Guidance    | `SuggestionFeedback`    | `FeedbackId`、`FeedbackType`、`Reason`                                     | 只接受已交付建议；同一用户/建议幂等；抑制反馈影响后续候选                             | `FeedbackRecorded`                                                                               |
| Daily Guidance    | `RuleDefinition`        | `RuleId`、`RuleVersion`、`Thresholds`                                      | `ruleId` 唯一；版本不可变；阈值变更产生新版本                                         | `RulePublished`                                                                                  |

读模型不是聚合：`MedicineSearchItem`、`MedicineDetail`、`MedicineWorkspace`、`ConversationSummary`、`SuggestionCard`、`DashboardProjection` 都由查询侧直接组装，不承担不变量。

### 3.3 领域事件

| 上下文            | 事件                                                                                                             | 主要消费者 / 用途                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Identity & Access | `AccountRegistered`、`EmailVerified`、`SessionRevoked`                                                           | 安全通知、审计、其他上下文的用户状态缓存失效 |
| Medicine Catalog  | `MedicineImported`、`MedicineUpdated`、`SafetyTipPublished`                                                      | 搜索/详情缓存失效、AI Assistant 知识版本更新 |
| Medication Safety | `RiskAssessed`                                                                                                   | 报告读模型、审计                             |
| AI Assistant      | `ConversationStarted`、`MessageAppended`、`ProposalConfirmed`、`MemoryCleared`                                   | 记忆抽取、审计、UI 订阅                      |
| Daily Guidance    | `SuggestionGenerated`、`SuggestionRecomputed`、`SuggestionSuppressed`、`FeedbackRecorded`、`SuggestionEscalated` | 通知、统计、today-analysis 物化              |

事件规则：

- 事件用过去式命名，字段只带 ID、版本、时间与必要事实；不塞整个聚合。
- 事件通过 **outbox** 与业务写入同事务提交；消费者幂等，按 `eventId` 去重。
- 事件 schema 版本化；新增字段保持向后兼容，删除/改义走新事件。
- 领域事件不是跨上下文同步调用的替代品：需要立即读结果时用 reader port，需要最终一致时用事件。

### 3.4 仓储与读模型

- 每个聚合根一个 repository，接口放在聚合目录内，命名用集合语义（`Accounts`、`Sessions`、`Medicines`、`Conversations`、`Suggestions`）。
- repository 方法表达领域语言：`findById`、`findByEmail`、`findActiveForUserOn`、`nextId`、`save`；不暴露 `WhereInput`、SQL、分页 DTO。
- 不为内部实体建 repository；不为读模型建 repository（读模型用 query service / reader port）。
- 实现放在 `infrastructure/persistence/`，类名用 `PrismaAccounts`、`PrismaConversations`；domain 不 import Prisma。
- 跨上下文读取用 `application/ports/` 的 reader port；reader 返回发布语言事实，不返回对方聚合。

### 3.5 应用服务

- 一个 use case 一个公开方法，负责：加载聚合 → 调用聚合行为 → 保存 → 通过 outbox 发布事件。
- 应用服务不写规则；规则在聚合或领域服务。应用服务可以编排多个聚合，但不跨聚合共享事务。
- 领域事件处理器放 `application/handlers/`；只做幂等副作用与后续命令，不反向修改已发布事实。
- 查询 use case 直接读读模型；不加载聚合，不触发领域事件。

## 四、代码组织：DDD 为设计，分层为落地

### 4.1 目录骨架

```text
src/modules/<module>/
  domain/
    <aggregate>/
      <aggregate>.ts          # 聚合根
      <entity>.ts             # 聚合内实体
      <value_object>.ts       # 值对象
      <aggregate>s.ts         # repository port（集合语义）
      events/
        <event>.ts
    services/                 # 跨聚合领域服务
    policies/                 # 无状态规则/策略
  application/
    use_cases/
    handlers/                 # 领域事件处理器
    read_models/
    ports/                    # LLM、通知、限流、时钟等出站 port
  adapters/
    http/
      <name>.controller.ts
      dto/
      presenters/
      guards/
      strategies/
      decorators/
    events/                   # 入站领域事件
    queue/                    # 入站队列消费者
    acl/                      # 外部/他上下文防腐层
    agent/                    # LangGraph 等框架适配（assistant）
  infrastructure/
    persistence/              # repository 实现
    llm/
    retrieval/
    ontology/
    oauth/
    cache/
    messaging/
  <module>.module.ts          # 组合根
  index.ts                    # 只导出跨上下文 port/service
```

### 4.2 依赖规则

- `domain/` 只依赖纯 TypeScript 与领域内文件；禁止 Nest、Prisma、HTTP、队列、缓存、LLM SDK、环境变量。
- `application/` 只依赖 `domain/`、`application/ports/` 与 `@Injectable()` 标记；禁止 Prisma、HTTP、队列实现、环境变量读取。
- `adapters/` 依赖 `application/` + `domain/`；禁止 import `infrastructure/`。
- `infrastructure/` 实现 `domain/` 的 repository 与 `application/ports/`；禁止 import `adapters/`。
- `<module>.module.ts` 是唯一组合根：绑定 repository/port → 实现。
- 跨上下文只经对方模块根 `index.ts`（导出发布语言/port）或领域事件；禁止深引内部路径、禁止直查对方表。
- `@Injectable()` 只作为 DI 标记；`@Controller`、`@Body`、`@Query` 等 HTTP 装饰器只出现在 `adapters/http/`。

### 4.3 文件命名

文件名表示职责；目录已表达的类型不再重复。

| 位置                          | 错误示例                           | 正确示例                   | 说明                                        |
| ----------------------------- | ---------------------------------- | -------------------------- | ------------------------------------------- |
| `domain/account/`             | `account.entity.ts`                | `account.ts`               | 目录已表明聚合根                            |
| `domain/account/`             | `email.vo.ts`                      | `email.ts`                 | 值对象用业务名                              |
| `domain/account/`             | `account.repository.ts`            | `accounts.ts`              | 集合语义的 repository port；接口 `Accounts` |
| `domain/account/events/`      | `account-registered.event.ts`      | `account_registered.ts`    | 目录已表明事件；事件名用过去式              |
| `application/use_cases/`      | `register.use-case.ts`             | `register_account.ts`      | 目录已表明 use case                         |
| `application/handlers/`       | `on-account-registered.handler.ts` | `on_account_registered.ts` | 目录已表明 handler                          |
| `application/read_models/`    | `account-summary.read-model.ts`    | `account_summary.ts`       | 目录已表明读模型                            |
| `adapters/http/`              | `auth-controller.ts`               | `local.controller.ts`      | `.controller.ts` 是 Nest 约定，保留         |
| `adapters/http/dto/`          | `login.dto.ts`                     | `login.ts`                 | 目录已表明 DTO                              |
| `adapters/acl/`               | `medicine-catalog.acl.ts`          | `medicine_catalog.ts`      | 目录已表明 ACL；用上游上下文名              |
| `infrastructure/persistence/` | `account.repository.impl.ts`       | `accounts.ts`              | 目录已表明实现；类名 `PrismaAccounts`       |
| `infrastructure/oauth/`       | `apple-oauth.provider.ts`          | `apple.ts`                 | 目录已表明 OAuth provider                   |
| 模块根                        | `auth.module.ts`                   | `auth.module.ts`           | Nest 模块文件保留                           |

任一目录超过 10 个文件时按子域再分（如 `domain/medicine/catalog/`、`domain/medicine/safety/`），不引入子目录 barrel。

## 五、模块目标结构

### 5.1 `auth` — Identity & Access

```text
src/modules/auth/
  domain/
    account/
      account.ts
      account_id.ts
      email.ts
      password_hash.ts
      oauth_identity.ts
      account_status.ts
      accounts.ts
      events/
        account_registered.ts
        email_verified.ts
        password_changed.ts
        oauth_identity_linked.ts
        account_deleted.ts
    session/
      session.ts
      session_id.ts
      refresh_token.ts
      sessions.ts
      events/
        session_issued.ts
        session_refreshed.ts
        session_revoked.ts
    verification/
      challenge.ts
      challenge_purpose.ts
      challenges.ts
      events/
        challenge_issued.ts
        challenge_consumed.ts
    policies/
      password_policy.ts
      credential_failure.ts
    services/
      oauth_linking.ts
  application/
    use_cases/
      register_account.ts
      login_with_password.ts
      login_with_oauth.ts
      link_oauth_identity.ts
      refresh_session.ts
      revoke_session.ts
      change_password.ts
      change_email.ts
      request_email_verification.ts
      verify_email.ts
      reset_password.ts
      reauthenticate.ts
      delete_account.ts
    handlers/
      on_account_registered.ts
      on_session_revoked.ts
    read_models/
      account_summary.ts
      session_summary.ts
    ports/
      password_hasher.ts
      token_issuer.ts
      notification.ts
      rate_limit.ts
  adapters/
    http/
      local.controller.ts
      oauth.controller.ts
      session.controller.ts
      dto/
        login.ts
        register.ts
        refresh.ts
        logout.ts
        change_email.ts
        change_password.ts
        forgot_password.ts
        reset_password.ts
        set_password.ts
        verify_email.ts
        send_verification_code.ts
        delete_account.ts
        oauth.ts
        auth_response.ts
        session.ts
      presenters/
        auth_response.ts
      guards/
        jwt_auth.ts
      strategies/
        jwt_access.ts
      decorators/
        current_user.ts
        public.ts
    events/
      on_account_deleted.ts
  infrastructure/
    persistence/
      accounts.ts
      sessions.ts
      challenges.ts
    crypto/
      argon2.ts
      jwt.ts
    oauth/
      apple.ts
      google.ts
      qq.ts
      wechat_mobile.ts
      wechat_web.ts
    messaging/
      notification.ts
    cache/
      rate_limit.ts
  auth.module.ts
  index.ts
```

主要迁移：

| 现有                                                  | 目标                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `controllers/*.controller.ts`                         | `adapters/http/*.controller.ts`                                                                    |
| `controllers/auth-response.helper.ts`                 | `adapters/http/presenters/auth_response.ts`                                                        |
| `dto/**`                                              | `adapters/http/dto/**`                                                                             |
| `guards/`、`strategies/`、`decorators/`               | `adapters/http/` 对应子目录                                                                        |
| `repositories/account.repository.ts`                  | `domain/account/accounts.ts` + `infrastructure/persistence/accounts.ts`                            |
| `repositories/session.repository.ts`                  | `domain/session/sessions.ts` + `infrastructure/persistence/sessions.ts`                            |
| `providers/*-oauth.provider.ts`、`providers/wechat/*` | `infrastructure/oauth/*`                                                                           |
| `services/token.service.ts`                           | `domain/session/session.ts` + `application/ports/token_issuer.ts` + `infrastructure/crypto/jwt.ts` |
| `services/notification.service.ts`                    | `application/ports/notification.ts` + `infrastructure/messaging/notification.ts`                   |
| `services/identity/rate-limit.service.ts`             | `application/ports/rate_limit.ts` + `infrastructure/cache/rate_limit.ts`                           |
| `services/auth.service.ts`                            | 拆成 `application/use_cases/*`                                                                     |
| `services/identity/*.service.ts`                      | 拆成 use case + 聚合行为 / 领域服务                                                                |
| `services/oauth/*.service.ts`                         | `application/use_cases/login_with_oauth.ts` + `domain/services/oauth_linking.ts`                   |
| `services/session-admin.service.ts`                   | `application/use_cases/revoke_session.ts`                                                          |
| `services/account.service.ts`                         | `application/use_cases/*` + `domain/account/account.ts`                                            |
| `config/argon2-options.ts`                            | `infrastructure/crypto/argon2.ts`                                                                  |
| `types/oauth.types.ts`                                | `application/ports/` 或 `infrastructure/oauth/` 的 ACL 类型                                        |
| `types/auth-request.ts`                               | `adapters/http/` 的请求类型                                                                        |

### 5.2 `medicines` — Medicine Catalog + Medication Safety

```text
src/modules/medicines/
  domain/
    medicine/
      medicine.ts
      medicine_id.ts
      medicine_name.ts
      ingredient.ts
      dosage_form.ts
      medicine_source.ts
      medicines.ts
      events/
        medicine_imported.ts
        medicine_updated.ts
    import/
      import_batch.ts
      source_id.ts
      import_batches.ts
      events/
        import_completed.ts
        import_failed.ts
    safety/
      risk_assessment.ts
      risk_finding.ts
      risk_level.ts
      risk_policy.ts
      risk_assessments.ts
      events/
        risk_assessed.ts
    safety_tip/
      safety_tip.ts
      safety_tips.ts
      events/
        safety_tip_published.ts
    services/
      ingredient_canonicalization.ts
      allergy_severity.ts
      risk_scoring.ts
  application/
    use_cases/
      import_catalog.ts
      rebuild_index.ts
      check_risk.ts
      recognize_medicine.ts
      publish_safety_tip.ts
      search_medicines.ts
      get_medicine_detail.ts
    handlers/
      on_medicine_imported.ts
      on_risk_policy_published.ts
    read_models/
      medicine_card.ts
      medicine_detail.ts
      risk_check_view.ts
    ports/
      llm.ts
      recognition.ts
      cache.ts
  adapters/
    http/
      medicines.controller.ts
      dto/
        search.ts
        detail.ts
        risk_check.ts
        recognition.ts
        safety_tip.ts
        source.ts
        structure.ts
        sequence.ts
      presenters/
        medicine.ts
    queue/
      recognition.ts
    events/
      risk_assessment_requested.ts
    acl/
      drug_source.ts
  infrastructure/
    persistence/
      medicines.ts
      import_batches.ts
      risk_assessments.ts
      safety_tips.ts
    cache/
      store.ts
    llm/
      risk_check.ts
      prompts/
        risk_check.ts
      schemas/
        risk_check.ts
    recognition/
      vision.ts
    import/
      cn.ts
      drugbank.ts
  medicines.module.ts
  index.ts
```

主要迁移：

| 现有                                            | 目标                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| `adapters/cn.service.ts`                        | `infrastructure/persistence/medicines.ts`（CN 源实现）+ `adapters/acl/drug_source.ts` |
| `adapters/drugbank.service.ts`                  | `infrastructure/persistence/medicines.ts`（DrugBank 源实现）                          |
| `cache/store.service.ts`                        | `infrastructure/cache/store.ts`                                                       |
| `cache/admin.service.ts`                        | `application/use_cases/rebuild_index.ts`                                              |
| `services/risk/risk-llm-generator.service.ts`   | `infrastructure/llm/risk_check.ts`                                                    |
| `services/risk/risk-check.listener.ts`          | `adapters/events/risk_assessment_requested.ts`                                        |
| `services/risk/risk-check.service.ts`           | `application/use_cases/check_risk.ts`                                                 |
| `services/risk/risk-context-builder.service.ts` | `adapters/acl/drug_source.ts` + `application/use_cases/check_risk.ts`                 |
| `services/risk/risk-detection.service.ts`       | `domain/services/risk_scoring.ts`                                                     |
| `services/recognition-queue.service.ts`         | `adapters/queue/recognition.ts` + `application/use_cases/recognize_medicine.ts`       |
| `services/medicines.service.ts`                 | `application/use_cases/{search_medicines,get_medicine_detail}.ts`                     |
| `services/admin.service.ts`                     | `application/use_cases/import_catalog.ts`                                             |
| `prompts/risk-check.prompt.ts`                  | `infrastructure/llm/prompts/risk_check.ts`                                            |
| `schemas/risk-check.schema.ts`                  | `infrastructure/llm/schemas/risk_check.ts`                                            |
| `utils/allergy-severity.ts`                     | `domain/services/allergy_severity.ts`                                                 |
| `utils/ingredient-canonicalization.ts`          | `domain/services/ingredient_canonicalization.ts`                                      |
| `utils/data-format.ts`                          | `adapters/http/presenters/medicine.ts`                                                |

边界修正：`medical_qa_chunks` 与 LightRAG 语料属于 **Content/Ontology**，不属于 Medicine Catalog；本模块只保留目录、导入、风险与安全贴士。

### 5.3 `assistant` — AI Assistant

```text
src/modules/assistant/
  domain/
    conversation/
      conversation.ts
      message.ts
      message_id.ts
      conversation_title.ts
      conversation_status.ts
      conversations.ts
      events/
        conversation_started.ts
        message_appended.ts
        conversation_archived.ts
    memory/
      memory.ts
      memory_item.ts
      memories.ts
      events/
        memory_cleared.ts
    proposal/
      proposal.ts
      proposed_action.ts
      proposal_status.ts
      proposals.ts
      events/
        proposal_created.ts
        proposal_confirmed.ts
        proposal_expired.ts
    summary/
      summary.ts
      summaries.ts
      events/
        summary_generated.ts
    policies/
      tool_policy.ts
      tool_capability.ts
  application/
    use_cases/
      stream_message.ts
      open_conversation.ts
      rename_conversation.ts
      archive_conversation.ts
      clear_memory.ts
      confirm_proposal.ts
      regenerate_reply.ts
    services/
      intent_routing.ts
      tool_orchestration.ts
      historical_summary.ts
    handlers/
      on_conversation_archived.ts
    read_models/
      conversation_summary.ts
      capability_view.ts
    ports/
      agent_runtime.ts
      llm.ts
      retrieval.ts
      ontology.ts
      tool.ts
  adapters/
    http/
      assistant.controller.ts
      dto/
        capabilities.ts
        conversation.ts
        proposal.ts
        rename.ts
        stream.ts
      presenters/
        conversation.ts
        tools.ts
    sse/
      stream.ts
    agent/
      langgraph.ts
    tools/
      medicine_lookup.ts
      drugbank_lookup.ts
      records_query.ts
      ontology_reasoning.ts
      proposals.ts
      retrieval.ts
  infrastructure/
    persistence/
      conversations.ts
      memories.ts
      summaries.ts
      proposals.ts
    agent/
      checkpointer.ts
    llm/
      runtime.ts
      prompts/
        system.ts
        intent_router.ts
      schemas/
        intent_routing.ts
    retrieval/
      lightrag.ts
    ontology/
      semantica.ts
  assistant.module.ts
  index.ts
```

主要迁移：

| 现有                                        | 目标                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `repositories/conversation.repository.ts`   | `domain/conversation/conversations.ts` + `infrastructure/persistence/conversations.ts` |
| `repositories/memory.repository.ts`         | `domain/memory/memories.ts` + `infrastructure/persistence/memories.ts`                 |
| `repositories/summary.repository.ts`        | `domain/summary/summaries.ts` + `infrastructure/persistence/summaries.ts`              |
| `agent/runtime/*`                           | `application/services/*` + `adapters/agent/langgraph.ts`                               |
| `agent/checkpointer.service.ts`             | `infrastructure/agent/checkpointer.ts`                                                 |
| `agent/stream.service.ts`                   | `application/use_cases/stream_message.ts`                                              |
| `services/conversation.service.ts`          | `application/use_cases/*` + `domain/conversation/conversation.ts`                      |
| `services/core.service.ts`                  | `application/use_cases/stream_message.ts`                                              |
| `services/memory.service.ts`                | `domain/memory/memory.ts` + `application/use_cases/clear_memory.ts`                    |
| `services/policy.service.ts`                | `domain/policies/tool_policy.ts`                                                       |
| `services/stream-orchestrator.service.ts`   | `application/use_cases/stream_message.ts`                                              |
| `services/historical-ai-summary.service.ts` | `application/services/historical_summary.ts`                                           |
| `services/proposal-confirm.service.ts`      | `domain/proposal/proposal.ts` + `application/use_cases/confirm_proposal.ts`            |
| `tools/**`                                  | `adapters/tools/**`（纯规则/策略可上移 domain）                                        |
| `tools/presenters.ts`                       | `adapters/http/presenters/tools.ts`                                                    |
| `prompts/*`                                 | `infrastructure/llm/prompts/*`                                                         |
| `schemas/*`                                 | `infrastructure/llm/schemas/*`                                                         |
| `types/ports.ts`                            | `application/ports/*`                                                                  |
| `dto/**`                                    | `adapters/http/dto/**`                                                                 |

LangGraph 只在 `adapters/agent/langgraph.ts`；`application/` 不 import LangGraph。节点业务逻辑（意图路由、工具编排、审核）留在 `application/services/`，由 `application/ports/agent_runtime.ts` 抽象。

### 5.4 `today-suggestion` — Daily Guidance

```text
src/modules/today-suggestion/
  domain/
    suggestion/
      daily_suggestion.ts
      suggestion_candidate.ts
      suggestion_action.ts
      suggestion_status.ts
      suggestions.ts
      events/
        suggestion_generated.ts
        suggestion_recomputed.ts
        suggestion_suppressed.ts
    feedback/
      feedback.ts
      feedbacks.ts
      events/
        feedback_recorded.ts
    rule/
      rule_definition.ts
      rule_version.ts
      rule_registry.ts
    signal/
      signal.ts
      signal_snapshot.ts
    policies/
      scoring.ts
      suppression.ts
      arbitration.ts
      lifecycle.ts
  application/
    use_cases/
      get_today_suggestion.ts
      get_suggestion_history.ts
      recompute_suggestion.ts
      record_feedback.ts
    services/
      pipeline.ts
      presentation.ts
    handlers/
      on_daily_record_changed.ts
      on_dose_log_changed.ts
      on_profile_changed.ts
    read_models/
      suggestion_card.ts
      suggestion_history.ts
    ports/
      signal_source.ts
      copy_generator.ts
      explanation_generator.ts
      notification.ts
  adapters/
    http/
      today_suggestion.controller.ts
      dto/
        suggestion.ts
        history.ts
        feedback.ts
        explanation.ts
    events/
      recompute_trigger.ts
      cache_invalidation.ts
    queue/
      recompute.ts
      copy.ts
      explanation.ts
    acl/
      collectors/
        health_event.ts
        medication.ts
        medication_time.ts
        profile.ts
        record.ts
        sleep_trend.ts
  infrastructure/
    persistence/
      suggestions.ts
      feedbacks.ts
      materialization.ts
      baselines.ts
    cache/
      suggestion.ts
    llm/
      copy.ts
      explanation.ts
      prompts/
        copy.ts
        explanation.ts
      schemas/
        copy.ts
        explanation.ts
    notifications/
      escalation.ts
  today-suggestion.module.ts
  index.ts
```

主要迁移：

| 现有                                                       | 目标                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| `services/collectors/*`                                    | `adapters/acl/collectors/*`                                            |
| `services/arbitration/*`                                   | `domain/policies/*`                                                    |
| `services/rules/*`                                         | `domain/rule/*` + `domain/policies/*`                                  |
| `services/lifecycle/*`                                     | `domain/policies/lifecycle.ts` + `application/services/pipeline.ts`    |
| `services/recompute/queue.service.ts`                      | `adapters/queue/recompute.ts`                                          |
| `services/recompute/worker.service.ts`                     | `adapters/queue/recompute.ts`                                          |
| `services/recompute/trigger.listener.ts`                   | `adapters/events/recompute_trigger.ts`                                 |
| `services/cache/suggestion-cache-invalidation.listener.ts` | `adapters/events/cache_invalidation.ts`                                |
| `services/copy/queue.service.ts`                           | `adapters/queue/copy.ts`                                               |
| `services/copy/llm-generator.service.ts`                   | `infrastructure/llm/copy.ts`                                           |
| `services/explanation/queue.service.ts`                    | `adapters/queue/explanation.ts`                                        |
| `services/explanation/generator.service.ts`                | `infrastructure/llm/explanation.ts`                                    |
| `services/notification/escalation.service.ts`              | `infrastructure/notifications/escalation.ts`                           |
| `services/materialization/store.service.ts`                | `infrastructure/persistence/materialization.ts`                        |
| `services/suggestion.service.ts`                           | `application/use_cases/{get_today_suggestion,recompute_suggestion}.ts` |
| `services/pipeline.service.ts`                             | `application/services/pipeline.ts`                                     |
| `services/presentation.service.ts`                         | `application/services/presentation.ts`                                 |
| `services/feedback/*`                                      | `domain/feedback/*` + `application/use_cases/record_feedback.ts`       |
| `constants/copy-*.ts`、`locale.constants.ts`               | `infrastructure/llm/prompts/` 或 copy 模板                             |
| `dto/**`                                                   | `adapters/http/dto/**`                                                 |
| `types/**`                                                 | `domain/` 或 `application/read_models/`                                |

Daily Guidance 的查询侧（`get_today_suggestion`、`get_suggestion_history`）只读物化读模型；重算侧加载 `DailySuggestion` 聚合并通过 outbox 发布事件。信号采集是 ACL，不是领域服务。

## 六、迁移顺序

每个上下文独立成一个 PR 批次，批次内不做行为变更；公开 OpenAPI 必须零 diff。

1. **Phase 0：战略设计与护栏**
   - 落 ADR-0024（限界上下文、聚合边界、上下文映射、分层代码组织）；ADR-0009 仅更新 Status。
   - 建 `docs/reference/context-map.md` 与 `docs/reference/ubiquitous-language.md`，作为跨上下文契约。
   - 修订 `AGENTS.md`：Module Subdirectory Whitelist 加入 `domain/`、`application/`、`adapters/`、`infrastructure/`；File Naming Rules 改为按目录语义去重；Barrel Exports 明确 domain/application 子目录不设 barrel。
   - 更新 `docs/explanation/architecture.md` 与各模块 `README.md` 的上下文/聚合说明。
   - 扩 dependency-cruiser：domain 禁框架/IO；application 禁 Prisma/HTTP；adapters 禁 infrastructure；跨上下文禁内部路径；禁止跨上下文关联查询。
   - 新增 outbox 表（如 `domain_events`，只增不改现有表）与发布 worker；事件带 `eventId`、`eventType`、`version`、`occurredAt`。
   - 生成基线例外清单（文件 + 规则 + 到期日），CI 只允许递减。
2. **Phase 1：`medicines` — Medicine Catalog + Medication Safety**
   - 先划 `Medicine`、`ImportBatch`、`SafetyTip`、`RiskAssessment` 聚合，再建 repository 与事件；搜索/详情/风险读模型走查询侧。
   - 把风险规则拆成 `domain/policies` + `domain/services`；LLM/识别/导入落 infrastructure；`medical_qa_chunks` 移出本上下文。
3. **Phase 2：`auth` — Identity & Access**
   - 先划 `Account`、`Session`、`VerificationChallenge` 聚合与不变量；再拆 use case；OAuth/Argon2/JWT/限流落 infrastructure + port。
   - 反枚举、依赖故障不折进认证失败、refresh 轮换、停用即时失效全部进聚合/领域服务测试。
4. **Phase 3：`today-suggestion` — Daily Guidance**
   - 先划 `DailySuggestion`、`SuggestionFeedback`、`RuleDefinition` 聚合；规则/评分/抑制/仲裁进 domain；collectors 变 ACL。
   - 查询侧只读物化读模型；重算侧用 outbox 发布 `SuggestionGenerated` / `SuggestionRecomputed`；通知只发 `SuggestionEscalated`。
5. **Phase 4：`assistant` — AI Assistant**
   - 先划 `Conversation`、`Memory`、`Proposal`、`Summary` 聚合；LangGraph 落 adapter，工具变 ACL，LLM/检索/本体落 infrastructure。
   - 写入提案必须经 `Proposal` 聚合与用户确认；确认后由目标上下文 use case 执行，不直接写对方表。

每批次完成后的门禁：

```bash
pnpm typecheck
pnpm lint:check
pnpm test
pnpm build
pnpm export:openapi   # 与基线零 diff
pnpm docs:verify
pnpm docs:links
```

## 七、验收标准

- 每个限界上下文有明确的聚合根、不变量、领域事件与上下文映射；`context-map.md` 与代码目录一致。
- 每个聚合根一个 repository；没有内部实体 repository、通用 repository、读模型 repository。
- 聚合不变量有单元测试；应用服务测试只验证编排与事务边界，不重复测规则。
- 跨上下文写只经命令/提案；跨上下文读只经 reader port 或领域事件；`dependency-cruiser` 零新增违规。
- 领域事件经 outbox 发布；消费者按 `eventId` 幂等；事件 schema 有版本。
- `domain/` 无 Nest/Prisma/HTTP/队列/LLM SDK；`application/` 无 Prisma/HTTP/队列实现；ACL 是唯一外部 DTO 映射点。
- 读模型可绕过聚合，但只用于查询；写路径不读读模型做决策。
- 公开路径、operationId、DTO 字段、错误码、事件名零变化；OpenAPI diff 为空。
- 每个模块 `README.md` 记录上下文边界、聚合、发布语言与禁止依赖。

## 八、风险与非目标

- **风险：分布式单体**。上下文之间用同步调用串起来，等于把单体切成更贵的单体。跨上下文默认事件/reader，只有命令确认链路允许同步。
- **风险：聚合过大**。`Medicine` 与 `Conversation` 容易变成全表聚合；写模型只保留必须同时成立的不变量，搜索/详情/列表全部走读模型。
- **风险：最终一致性影响 UX**。写后立即读可能看不到结果；UI 用 pending 状态与本地回执，服务端保证幂等与事件可重放。
- **风险：为 CRUD 硬造领域模型**。Identity 的通知、Settings 的偏好等 supporting 上下文允许薄聚合；不强制领域服务、不强推事件。
- **风险：事件 schema 漂移**。事件版本化，消费者契约测试进 CI；删除字段走新事件，不原地改义。
- **风险：迁移期双模型**。每个上下文一个批次，批次结束删除旧 service/repository；不做长期双轨。
- **非目标**：不拆微服务、不改数据库表名、不引入新框架、不重写 AI 管线、不改公开 API、不做 event sourcing。
