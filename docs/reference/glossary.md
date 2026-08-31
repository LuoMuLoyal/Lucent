---
status: active
owner: backend
quadrant: reference
updated: 2026-08-31
---

# Glossary

常用术语单一来源。

- **Lucent** — 活跃 NestJS 后端，Luminous 的 API 提供方。
- **Luminous** — 活跃 Flutter 客户端。参见 `Luminous/docs/`。
- **Luminous-site** — Nuxt 竞赛/产品展示站点。
- **NestJS** — Lucent 后端框架。参见 [[explanation/architecture]]。
- **Prisma** — Lucent ORM 与 schema 工具。参见 [[explanation/architecture]]。
- **ADR** — Architecture Decision Record，见 [[reference/adr/README]]。
- **OpenAPI** — 后端 API 合同，导出为 `docs/reference/generated/openapi.json`。
- **AI Pipeline** — Lucent AI 管道分层：Context / Copy / Generator / Policy / Persistence。参见
  [[explanation/architecture]]。
- **Meal Analysis** — 餐食图片异步写入时分析管道。
- **Clinic Summary** — 后端脱敏的医生分享摘要，含 Redis 24h 分享链接与 PDF。
- **Data Export** — 报告/摘要 PDF 导出请求，支持 BullMQ 异步与内联 fallback。
- **AdminJS** — `/admin` 管理面板，基于 Prisma schema 自动生成资源。
- **Forui** — Luminous Flutter UI 库，项目根主题来源。
- **Riverpod** — Luminous 状态管理方案。
- **GoRouter** — Luminous 路由方案，使用 `StatefulShellRoute`。
- **P0–P3 优先级体系** — 跨项目产品优先级框架，定义于 `Luminous/docs/01-product/Product_Brainstorm_2026-07-07.md`。P0 为发布前必做项，P1 为首发版本内，P2 为 1.1.0 候选，P3 为 1.2.0+ 候选。核心主闭环是 `记录 -> 主动建议卡 -> 用户确认动作 -> 回顾`。
- **Proactive Guidance Card（主动建议卡）** — Luminous 核心产品对象。每张卡都必须包含
  `证据 -> 建议 -> 动作 -> 边界`，并且只在具备时效性和可干预性时进入 `Today` 首屏。
- **Observation Item（观察项）** — 证据不足、置信度较低或暂时不值得单独出卡的内容。
- **Slot-aware Dose Log** — 用药打卡槽位合同：单条 dose log 携带 `reminderId` + `scheduledTime`，
  幂等 `POST /mark` 按提醒槽位标记，区分同一天内多个提醒。
- **Talker** — Luminous `talker_flutter` 日志基础设施，替代 `debugPrint`，支持运行时级别过滤与 Release 静默。
- **BullMQ** — 任务队列，用于邮件发送、报告导出等异步任务。
