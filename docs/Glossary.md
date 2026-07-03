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
