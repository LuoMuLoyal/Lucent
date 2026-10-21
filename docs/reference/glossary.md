---
status: active
owner: backend
quadrant: reference
updated: 2026-10-21
---

# Glossary

常用术语单一来源。DDD 限界上下文术语词条见文末「领域上下文术语」；
上下文边界与发布语言见 [context-map.md](context-map.md)。

- **Lucent** — 活跃 NestJS 后端，Luminous 的 API 提供方。
- **Luminous** — 活跃 Flutter 客户端。参见 `Luminous/docs/`。
- **Luminous-site** — Nuxt 竞赛/产品展示站点。
- **NestJS** — Lucent 后端框架。参见 [[explanation/architecture]]。
- **Prisma** — Lucent ORM 与 schema 工具。参见 [[explanation/architecture]]。
- **ADR** — Architecture Decision Record，见 [[reference/adr/README]]。
- **OpenAPI** — 后端 API 合同，导出为 `docs/reference/generated/openapi.json`。
- **AI Pipeline** — Lucent AI 管道分层：Context / Copy / Generator / Policy / Persistence。参见
  [[explanation/architecture]]。
- **Meal Analysis** — 餐食图片异步写入时分析管道。v2 起为一次多模态调用直出
  「热量区间 + 按重要性排序的结论 + 封闭词表 facets」，人工确认与成分表接地已删除；
  列表/聚合/助手读投影列（`meal_headline` / `meal_calorie_*`），详情与需要明细的
  消费方才回读 `payload.mealAnalysis`。
- **Clinic Summary** — 后端脱敏的医生分享摘要，含 Redis 24h 分享链接与 PDF。
- **Data Export** — 报告/摘要 PDF 导出请求，支持 BullMQ 异步与内联 fallback。
- **管理控制台（Admin Console）** — `admin/` 独立 pnpm 项目构建的 React SPA，由后端同源挂载在
  `/admin`；身份与权限取自 `AdminUser` 角色矩阵，每个 `/api/v1/admin/*` 端点服务端复核。
- **Forui** — Luminous Flutter UI 库，项目根主题来源。
- **Riverpod** — Luminous 状态管理方案。
- **GoRouter** — Luminous 路由方案，使用 `StatefulShellRoute`。
- **P0–P3 优先级体系** — 跨项目产品优先级框架，定义于 `Luminous/docs/archive/product/Product_Brainstorm_2026-07-07.md`（已归档）。P0 为发布前必做项，P1 为首发版本内，P2 为 1.1.0 候选，P3 为 1.2.0+ 候选。核心主闭环是 `记录 -> 主动建议卡 -> 用户确认动作 -> 回顾`。
- **Proactive Guidance Card（主动建议卡）** — Luminous 核心产品对象。每张卡都必须包含
  `证据 -> 建议 -> 动作 -> 边界`，并且只在具备时效性和可干预性时进入 `Today` 首屏。
- **Observation Item（观察项）** — 证据不足、置信度较低或暂时不值得单独出卡的内容。
- **Slot-aware Dose Log** — 用药打卡槽位合同：单条 dose log 携带 `reminderId` + `scheduledTime`，
  幂等 `POST /mark` 按提醒槽位标记，区分同一天内多个提醒。
- **Talker** — Luminous `talker_flutter` 日志基础设施，替代 `debugPrint`，支持运行时级别过滤与 Release 静默。
- **BullMQ** — 任务队列，用于邮件发送、报告导出等异步任务。

## 领域上下文术语

同名概念在不同上下文含义不同时，必须加限定词，不强行合并。术语归属上下文与
[ADR-0024](adr/0024-ddd-bounded-contexts-and-aggregates.md) 的聚合边界。

### Identity & Access

- **Account** — 本地账号，持有凭据与 OAuth 身份链接；邮箱唯一，至少一种凭据或 OAuth 身份。
- **Credential** — 本地密码凭据（argon2 哈希），与 `providerId = 'credential'` 一一对应。
- **OAuthIdentity** — 第三方身份链接；`(provider, subject)` 唯一，受信提供商可自动关联。
- **Session** — 一次登录产生的 refresh/access 会话；refresh 轮换，撤销幂等，停用后不可续期。
- **VerificationChallenge** — 邮箱验证/重置密码的一次性挑战；单次消费，过期不可用，验证码不明文持久化。
- **AccountStatus** — 账号状态（active / disabled / deleted）；状态转换受控，停用即时失效。

### Medicine Catalog

- **Medicine** — 药品目录中的可识别实体；源内 ID 唯一，至少一个名称，源字段缺失不造空值。
- **Ingredient** — 规范化后的成分；风险规则与检索的匹配单位。
- **ImportBatch** — 一次目录导入的元数据与行数对账结果；目标表行数与源文件相等，重复导入幂等。
- **SafetyTip** — 面向用户的安全提示内容；同 locale 内容非空，发布后版本不可原地改。
- **MedicineFact** — 向下游发布的只读药品事实；只含 ID、名称、成分、来源等，不含可变聚合状态。

### Medication Safety

- **RiskAssessment** — 对一组药品/用户上下文的一次风险检查结果；一次请求一次评估，静态规则结果确定，完成后不可改写。
- **RiskFinding** — 评估中的单条发现；带级别、证据与来源，不直接等同诊断。
- **RiskPolicy** — 风险规则与阈值；规则版本化，变更产生新版本。

### AI Assistant

- **Conversation** — 一次持续对话，包含有序消息与标题；消息顺序单调，归属用户，归档后不可追加。
- **Message** — 对话中的一条用户/助手/工具消息；内容与角色不可变，修订保留历史。
- **Memory** — 跨对话记忆；每用户一份，条目可去重，清空幂等。
- **Proposal** — 待用户确认的写入提案；只有 pending 可确认，确认恰好一次，过期不可确认。
- **ProposedAction** — 提案中的目标动作（创建/更新/删除）；目标必须属于当前用户，不直接写他上下文。
- **Summary** — 对话或历史区间的摘要；不反向修改消息，按对话版本保存。

### Daily Guidance

- **Signal** — 规则引擎消费的只读事实（睡眠、饮食、用药、健康事件等）；不反向写源上下文。
- **SignalSnapshot** — 某次重算使用的信号集合；带时间范围与版本，是读模型，不是聚合。
- **SuggestionCandidate** — 规则产出的候选项；带规则 ID、证据与分数，被抑制后不再出现。
- **DailySuggestion** — 某用户某日的一组建议卡片及其生命周期；每用户每日一份，生命周期只前进，文案可追溯。
- **SuggestionFeedback** — 用户对已交付建议的反馈；只接受已交付建议，同用户/建议幂等，抑制影响后续候选。
- **RuleDefinition** — 可版本化的规则定义与阈值；`ruleId` 唯一，版本不可变，阈值变更产生新版本。

### 跨上下文

- **UserId** — 账号标识；Identity & Access 发布，所有上下文只读。
- **LocalDate** — 用户本地时区下的日期；共享值对象，wire 格式 `yyyy-MM-dd`。
- **Timezone** — IANA 时区标识；共享值对象。
- **Locale** — 展示/文案语言；共享值对象。
- **Unit** — 计量单位（公制/英制）；共享值对象。
- **DomainEvent** — 已发生事实的不可变描述；经 outbox 发布，消费者幂等，schema 版本化。
