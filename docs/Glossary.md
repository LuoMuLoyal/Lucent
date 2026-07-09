# Glossary

常用术语单一来源。

- **Lucent** — 活跃 NestJS 后端，Luminous 的 API 提供方。
- **Luminous** — 活跃 Flutter 客户端。参见 `Luminous/docs/`。
- **Luminous-site** — Nuxt 竞赛/产品展示站点。
- **NestJS** — Lucent 后端框架。参见 [[01-reference/architecture]]。
- **Prisma** — Lucent ORM 与 schema 工具。参见 [[01-reference/architecture]]。
- **ADR** — Architecture Decision Record，见 [[01-reference/adr/README]]。
- **OpenAPI** — 后端 API 合同，导出为 `openapi.json`。
- **Security PIN** — 6 位应用内安全码，替代旧 TOTP 2FA。参见 [[00-current/Auth_Security_PIN]]。
- **AI Pipeline** — Lucent 三层 AI 架构：Context / Generation / Policy & Persistence。参见
  [[01-reference/architecture]]。
- **Meal Analysis** — 餐食图片异步写入时分析管道。参见 [[00-current/Meal_Analysis]]。
- **Clinic Summary** — 后端脱敏的医生分享摘要，含 Redis 24h 分享链接与 PDF。
- **Data Export** — 报告/摘要 PDF 导出请求，支持 BullMQ 异步与内联 fallback。参见 [[00-current/Report_Export]]。
- **AdminJS** — `/admin` 管理面板，基于 Prisma schema 自动生成资源。
- **Forui** — Luminous Flutter UI 库，项目根主题来源。
- **Riverpod** — Luminous 状态管理方案。
- **GoRouter** — Luminous 路由方案，使用 `StatefulShellRoute`。
- **MVP** — Minimum Viable Product，当前 1.0 主闭环是 `记录 -> 主动建议卡 -> 用户确认动作 -> 回顾`。
- **Proactive Guidance Card（主动建议卡）** — Luminous 1.0 的核心产品对象。每张卡都必须包含
  `证据 -> 建议 -> 动作 -> 边界`，并且只在具备时效性和可干预性时进入 `Today` 首屏。
- **Observation Item（观察项）** — 证据不足、置信度较低或暂时不值得单独出卡的内容。
- **Slot-aware Dose Log** — 用药打卡槽位合同：单条 dose log 携带 `reminderId` + `scheduledTime`，
  幂等 `POST /mark` 按提醒槽位标记，区分同一天内多个提醒。
- **Talker** — Luminous `talker_flutter` 日志基础设施，替代 `debugPrint`，支持运行时级别过滤与 Release 静默。
- **BullMQ** — 任务队列，用于邮件发送、报告导出等异步任务。
