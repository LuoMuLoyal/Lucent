# Migration Log - 2026-06-30

## Documentation Governance

- 建立 Lucent migration-log 变更日志体系（`docs/00-current/MigrationLog.md` + `docs/02-logs/migration-log/`）。
- `docs/README.md` Document Boundaries 表和 Update Map 补齐 `architecture.md` 和 `MigrationLog.md` 治理条目。
- `AGENTS.md` Read First 新增 `docs/01-reference/architecture.md`，Working Rules 新增 migration-log 追加规则。

## Current Architecture Baseline

以下基线在 migration-log 建立前已完成，此处仅作归档记录：

- **Stack**: NestJS 11, Prisma 7 (client provider: `prisma-client`), PostgreSQL, Redis, JWT auth.
- **API**: `/api/v1` base, `{ code, message, data }` envelope, 79 paths / 185 schemas (generated
  OpenAPI).
- **Auth**: 4 OAuth providers (WeChat Web, WeChat Mobile, Apple, QQ) 统一 `OAuthProvider` 接口。
- **AI Pipeline**: 三层架构（Context → Generation → Policy & Persistence），覆盖 ReportsAiSummary、
  TodayAnalysis、DailyRecordCandidates、Assistant。
- **Modules**: auth, account, medicines, environment, support-resources (public); assistant,
  daily-records, data-export, files, medicine-dose-logs, medicine-reminders, notifications,
  reports, today-analysis, user-health-context, user-settings (user-scoped via RouterModule).
- **Admin**: AdminJS + `@sergiyiva/adminjs-prisma` adapter, resources auto-generated from Prisma
  schema.
- **Deployment**: `/opt/lucent/app` (GitHub Actions 覆盖) + `/opt/lucent/server` (本地文件: .env, certs,
  data, logs).

## Privacy-Preserving Clinic Summary

### 后端实现

**新增模块**：

- `src/modules/reports/services/clinic-summary.service.ts` — 数据聚合 + 脱敏 + Redis 分享链接
  - `buildClinicSummary(userId)` — Prisma 查询用户档案/过敏史/既往病史/当前用药，脱敏处理（maskName: 张\*\*、age 替代
    birthDate、diagnosedYear 替代 diagnosedAt）
  - `createShareLink(userId)` — 24h TTL Redis 分享链接（`clinic-share:{token}` key 前缀）
  - `getSharedSummary(token)` — 公开读取，过期返回 null
  - `exportPdf(userId, locale)` / `exportSharedPdf(token, locale)` — PDF 导出
- `src/modules/reports/services/clinic-summary-pdf.service.ts` — PDF 生成服务，复用 `pdf-lib` + CJK
  字体（`@fontpkg/source-han-sans-sc-vf`）+ 现有绘图原语（`report-export-pdf-draw.service.ts`），无需新依赖
- `src/modules/reports/dto/clinic-summary-response.dto.ts` — 6 个 DTO（Profile, Allergy, Condition,
  Medicine, Summary, ShareResponse）

**新增端点**（`ReportsController`）：

- POST
  - Path: `/reports/clinic-summary/preview`
  - Auth: JWT
- POST
  - Path: `/reports/clinic-summary/share`
  - Auth: JWT
- GET
  - Path: `/reports/clinic-summary/shared/:token`
  - Auth: 公开（@Public）
- GET
  - Path: `/reports/clinic-summary/preview/pdf`
  - Auth: JWT
- GET
  - Path: `/reports/clinic-summary/shared/:token/pdf`
  - Auth: 公开（@Public）

**基础设施**：

- `src/modules/auth/decorators/public.decorator.ts` — `@Public()` 装饰器，跳过 JWT 认证
- `src/modules/auth/guards/jwt-auth.guard.ts` — 更新支持 `IS_PUBLIC_KEY`，注入 `Reflector`

**修复**：

- 原 `getSharedClinicSummary` 端点因 class-level `@UseGuards(JwtAuthGuard)` 无法公开访问，现已加 `@Public()` 修复

### 验证

- `pnpm typecheck`: 0 errors
- `pnpm lint:check --max-warnings=0`: 0 errors, 0 warnings
- `pnpm test:ci`: 78 suites, 473 tests all passed

---

## 代码审查修复：配置管理 + 错误处理 + 代码组织

### process.env → ConfigService（5 个文件）

**问题**：新代码（RAG 工具 + 诊所摘要）直接读取 `process.env`，绕过已有的 ConfigService 模式。

**修复**：

- `clinic-summary.service.ts`
  - 原方式: `process.env['PUBLIC_BASE_URL']`
  - 新方式: `configService.get('app').publicBaseUrl`
- `assistant-tool-medical-knowledge.service.ts`
  - 原方式: `process.env['DATABASE_URL']`
  - 新方式: `configService.get('DATABASE_URL')`
- 同上
  - 原方式: `process.env` 读 AI embedding 三个 key
  - 新方式: `configService.get('ai').embedding`
- `assistant-tool-leaflet-read.service.ts`
  - 原方式: 同上
  - 新方式: 同上
- `assistant-tool-leaflet-read.service.spec.ts`
  - 原方式: `process.env` 模拟
  - 新方式: mock `ConfigService`

**配套变更**：

- `env-keys.enum.ts`：新增 `PUBLIC_BASE_URL`
- `app.config.ts`：新增 `publicBaseUrl` 字段
- `environment.validation.ts`：接口 + Joi schema 新增 `PUBLIC_BASE_URL`
- `.env.development.example` / `.env.production.example` / `.env.test.example`：新增 `PUBLIC_BASE_URL` 配置项

### throw new Error → api-errors.ts

- `clinic-summary.service.ts`：`throw new Error('User not found')` → `throw notFound('User not found')`（后因改用 `findFirstOrThrow`，此检查已移除）

### findFirst 按主键 id → findFirstOrThrow（2 个文件）

- `clinic-summary.service.ts`：`findFirst({ where: { id: userId } })` → `findFirstOrThrow`，删除手动 null 检查
- `assistant-tool-read.service.ts`：同上

> `account.service.ts` 和 `user-health-context.service.ts` 保留了 `findFirst` + 手动 `notFound(i18n)` 模式，因为需要本地化错误消息。

### Controller 工具函数 → common/utils/

- 提取 `httpExceptionPayload()` + `withOptionalErrorFields()` 从 `reports.controller.ts` 到 `src/common/utils/error-payload.ts`
- Controller 改为导入共享模块

### 服务目录位置修复

- `assistant-tool-medical-knowledge.service.ts` 从 `tools/` 移到 `tools/services/`
- 更新 `tools/index.ts` barrel + `assistant-tool.service.ts` 导入 + 内部相对路径

### 硬编码中文 → i18n

- `assistant-tool-medical-knowledge.service.ts`：删除硬编码 `DISCLAIMER` 常量
- 注入 `I18nService`，改用 `i18n.t('assistant.medical_knowledge_disclaimer', { lang: context.locale })`
- `src/i18n/zh-CN/assistant.json` + `src/i18n/en/assistant.json`：新增 `medical_knowledge_disclaimer`

### pre-push hook 修复

- `.husky/pre-push`：`pnpm test:e2e:ci` → `pnpm test:ci`（e2e 留给 CI，pre-push 只跑轻量检查）

### 验证

- `pnpm typecheck`: 0 errors
- `pnpm test:ci`: 78 suites, 473 tests 全部通过
