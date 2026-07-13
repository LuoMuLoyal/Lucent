# Lucent Current State

Last updated: 2026-07-13

本文件只保留简介和按区域链接。具体后端实现细节见 `00-current/` 下各子文件。

## 当前区域

- [[00-current/Assistant_Runtime]] — Assistant 运行时、检索链路、今日分析通知
- [[00-current/Medicine_Data_RAG]] — 药品知识库、RAG 索引、slot-aware dose log 合同
- [[00-current/Public_Support_Resources]] — 公共支持资源、法律文档管理 API
- [[00-current/Toolchain_Contract]] — 工具链、OpenAPI 合同、环境变量解析
- [[00-current/Auth_Security_PIN]] — 认证、OAuth、Security PIN、安全配置
- [[00-current/Report_Export]] — 报告导出、PDF 生成
- [[00-current/Meal_Analysis]] — 餐食分析管道
- [[00-current/Code_Quality_Maintainability]] — 代码质量、模块结构、测试覆盖
- [[00-current/Today_Suggestion_Engine]] — Today 主动建议引擎
- [[00-current/Toolchain_Contract]] — 工具链、OpenAPI 合同、Git hooks（含 pre-commit 文档检查）

## 2026-07-10 架构升级

- **AI 管道**：LangGraph 重构为 `prepare_context → agent ↔ tools → respond` 真正的 tool-loop 图；LLM 通过 function calling 决定工具调用，替代旧的 keyword 路由
- **LLM 重试**：`BaseLlmGeneratorService` 和 `AssistantRuntimeService` 增加 `withLlmRetry`（指数退避，区分可重试/不可重试错误）
- **队列基础设施**：新增 `BullmqQueueFactory` + `BullmqModule`，三个队列服务（mail、meal-analysis、data-export）统一使用共享 Redis 连接和 Worker 生命周期管理
- **Repository 抽象**：六个模块完成 Repository 层抽象：
  - `daily-records`：`DailyRecordRepositoryPort` + `DailyRecordRepository`，`DailyRecordsService` 和 `DailyRecordsOwnershipService` 全量迁移到 Port
  - `assistant`：`AssistantConversationRepositoryPort`（封装会话+消息事务）、`AssistantSummaryRepositoryPort`（AI 摘要历史 CRUD）
  - `auth`：`AuthSessionRepositoryPort`（用户会话 CRUD）、`AuthAccountRepositoryPort`（账户软删除）
  - `user-health-context`：`UserHealthContextRepositoryPort`（profile upsert、allergy/condition/current-medicine CRUD）
  - `medicine-dose-logs`：`MedicineDoseLogRepositoryPort`（服药记录 CRUD）
  - `medicine-reminders`：`MedicineReminderRepositoryPort`（用药提醒 CRUD）
- **Metrics 集成**：BullMQ 任务和 LLM 调用接入 Prometheus 指标（`recordBullmqJob`、`recordLlmCall`），Grafana dashboard 新增 LLM 和 BullMQ 队列深度面板，修复 datasource UID 匹配问题
- **JSONB Zod 校验**：`MealRecordPayload` 读取时通过 Zod schema `safeParse` 校验，校验失败时回退到手动解析结果

## 2026-07-10 E2E 测试缺口审查与补充

- **E2E 缺口审查**：对全部 ~80 个 Controller 端点与 19 个 E2E 测试文件逐端点比对，形成完整缺口矩阵（`plans/2026-07-10-test-gap-audit.md`），按 P0/P1/P2 分级
- **Notifications 单条操作 E2E**：GET/:id、PATCH/:id/read、PATCH/:id/unread、DELETE/:id 四个端点新增 14 个用例，含跨用户隔离验证
- **Security PIN 生命周期 E2E**：enable→verify→change→disable 全链路新增 19 个用例，含 PIN 格式校验、错误 PIN 拒绝、禁用后 verify 返回 403、用户隔离
- **Account set-password E2E**：OAuth-only 用户设置密码全链路（验证码 → 设置 → 登录验证），含 409 冲突、400/401 验证码错误、弱密码拒绝，新增 15 个用例
- **WeChat 身份关联 E2E**：mock WechatWebOAuthProvider/WechatMobileOAuthProvider 的 `buildAuthorizeUrl`/`fetchProfile`，补齐 authorize 200 + callbackUri、callback 身份关联 happy path、mobile callback 身份关联 happy path、503 未配置、401 无效 state，新增 7 个用例
- **Session 管理 E2E**：GET /auth/sessions + DELETE /auth/sessions/:id 新增 8 个用例，含多会话场景、撤销后 refresh token 失效验证、跨用户隔离
- **发现的问题**：`AuthTokenService.revokeById` 抛 raw Error 导致 500 — **已修复**（2026-07-12：改为 NotFoundException/ForbiddenException，返回 404/403）
- **P0 剩余端点全覆盖**：Reports clinic-summary（preview/share/shared/pdf 5 端点 8 用例）、Medicines safety-tips + recognize（8 用例）、Reminder Deliveries（5 用例）、Assistant open/clear/stream（9 用例）、Daily Records presign-upload（4 用例），P0 级 E2E 缺口全部补齐
- **P1 级 E2E 全覆盖**：Health liveness/deep 探针（4 用例）、Today Analysis generate + generate/stream SSE（8 用例）、Reports summary/generate/stream SSE（4 用例）；修复 TodayAnalysisService generatedAt 丢失 bug 和 app.e2e-spec.ts 缺少 MetricsService provider 的预存问题
- **P2 级 OAuth E2E 全覆盖**：新增 `test/e2e/auth/oauth.e2e-spec.ts`（25 用例），覆盖全部 7 个 OAuth 端点：wechat-web authorize/callback（含 302 重定向）、wechat-mobile callback、apple callback（含二次登录）、qq authorize/callback。通过 `jest.spyOn` mock provider 的 `buildAuthorizeUrl`/`fetchProfile` 方法绕过第三方依赖，测试新用户创建、已有用户登录、503 未配置、400 参数校验、401 无效 state 等场景
- **单元测试覆盖率补充**：`auth/strategies` 从 0% 覆盖升至 100%（新增 `jwt-access.strategy.spec.ts` 11 用例）；`today-analysis` services 新增 19 个用例（context.service 15 + analysis.service 4）覆盖 water/medication/sleep/reminder 等分支；`i18n` 模块从 0% 覆盖升至有测试（3 用例）；`llm-runtime` 模块从 0% 覆盖升至有测试 + `getModelName` 方法覆盖

## 2026-07-11 审查报告修复

- **mark 查找安全**：`MedicineDoseLogsService.mark` 入口新增运行时校验，要求 `reminderId` 或 `currentMedicineId` 至少一项非空；`buildMarkLookupWhere` 移除不安全的 fallback 分支，改为抛出 `BadRequestException`
- **helpers barrel export**：`src/common/helpers/index.ts` 移除三行 `.spec` 文件导出，避免测试模块污染生产构建
- **通知可观测性**：`TodayAnalysisService.createNotificationSafely` catch 块新增 `logger.warn` 日志，通知服务故障可追踪
- **通知查询性能**：`NotificationsService.createOrReplaceScoped` 的 `findMany` 新增 `take: 50` 限制，防止大数据量全量加载
- **通知去重兼容性**：`NotificationsService.matchesScope` 兼容数组结构 payload，数组元素中任一匹配 scope 即判定为重复

## 2026-07-11 部署优化

- **Dockerfile 重构**：三阶段构建（deps/builder/production），BuildKit cache mount（pnpm store + SWC），tini PID 1，non-root `lucent` 用户，修复 Prisma 客户端路径 bug
- **Compose 重构**：网络隔离（backend + observability），资源限制，安全加固（Redis 密码、app 端口不暴露），相对路径，Docker 日志轮转，Blue-Green 双 slot（`app-blue` + `app-green`）
- **Nginx 加固**：gzip、安全头、SSL OCSP stapling、SSE 端点关闭缓冲 + 300s 超时、upstream 双 slot 动态配置
- **Blue-Green 零停机部署**：`deploy.ts` 16 步流程（migrate → 启动 inactive → 切换 nginx upstream → reload → 停止旧 slot → smoke test），支持 `--rollback`，smoke 失败自动回滚
- **CI/CD 增强**：GHA 构建缓存，只推 git-sha tag，精确上传 assets（无 rm -rf），Staging 独立服务器 + 独立 workflow
- **Prometheus 适配**：抓取目标改为 `app-blue:3000` + `app-green:3000`
- **生产日志双写**：Winston stdout JSON + `winston-daily-rotate-file` 按天分割文件（`./logs/lucent.YYYY-MM-DD.log`，500MB 上限）
- **优雅关闭**：`enableShutdownHooks()` + `stop_grace_period: 30s` + SIGTERM

## 2026-07-11 法律文档管理 API

- **新增模块**：`legal-documents`（`src/modules/legal-documents/`），公开端点 `GET /api/v1/legal-documents` 和 `GET /api/v1/legal-documents/:docType`
- **数据模型**：Prisma `LegalDocument` 模型，存储 7 类法律文档（terms、privacy、disclaimer、minor-protection、sdk-list、permissions、account-cancellation），支持中英文双语内容
- **语言切换**：`?lang=zh|en` 查询参数，默认 `zh`
- **AdminJS 管理**：`LegalDocument` 资源已在 AdminJS 面板注册，可直接编辑文档内容
- **迁移数据**：迁移脚本已插入 placeholder Markdown 内容，待法务审阅后替换

## 2026-07-12 TypeScript 升级 + 依赖清理

- **TypeScript 5.9.3 → 6.0.3**：devDependency 升级到 `^6.0.3`，typecheck / build / test / lint 全部兼容
- **移除 ts-jest**：项目使用 `@swc/jest` 作为 jest transform，`ts-jest` 从未被引用，已移除
- **TS 7 阻塞项**：`@nestjs/cli@11` 不兼容 TS 7 Go 原生 API，需等 NestJS CLI 12 稳定后升级

## 2026-07-12 Jest → Vitest 迁移完成

- **依赖替换**：移除 `jest`、`@types/jest`、`@swc/jest`、`eslint-plugin-jest`；新增 `vitest`、`@vitest/coverage-v8`、`unplugin-swc`
- **配置文件**：新建 `vitest.config.ts`（单元测试，SWC + ESM 模块）和 `vitest.e2e.config.ts`（E2E 测试，串行 forks 模式）；删除 `test/jest-e2e.json` 和 `package.json` 中的 `jest` 配置块
- **TypeScript**：`tsconfig.json` `types` 从 `jest` 改为 `vitest/globals`
- **ESLint**：移除 `eslint-plugin-jest` 和 `globals.jest`；测试文件覆盖规则保留（类型放宽）但移除 jest 专有规则
- **全局类型桥接**：新建 `src/types/vitest-globals.d.ts`，通过 `declare global { namespace vi { ... } }` 为 `vi.Mock`、`vi.Mocked<T>`、`vi.MockInstance<T>`、`vi.SpyInstance<T>` 提供全局类型声明，使 `jest.` → `vi.` 的批量替换对类型引用也生效
- **批量 Codemod**：
  - 160 个文件 `jest.` → `vi.`（函数调用）
  - 29 个文件 `jest` → `vi`（多行断句）
  - `fail()` → `expect.fail()`（5 处）
  - `jest.requireMock()` → `import * as` + 类型断言（3 个文件）
  - `deep-mocked.ts`：`jest.Mock` → `import type { Mock } from 'vitest'`
- **API 兼容性修复**：
  - `slow-request.interceptor.spec.ts`：Jest `(done)` 回调改为 `new Promise<void>((resolve) => ...)` 模式（Vitest 不支持 done 回调）
  - `.mockImplementation()` 无参调用改为 `.mockImplementation(() => undefined)`（Vitest 要求函数参数）
  - `vi.fn(() => mockObject)` 箭头函数构造器改为 `vi.fn(function () { return mockObject; })`（COS SDK、PGVectorStore mock）
  - `vi.mock('argon2', ...)` 补充 `argon2id: 2` 属性（Vitest 对 mock 属性访问更严格）
  - `mock.calls[0]` 添加 `!` 非空断言（Vitest MockInstance 类型 + `noUncheckedIndexedAccess`）
- **验证结果**：`pnpm build` ✓（694 文件）、`pnpm typecheck` ✓（0 错误）、`pnpm lint:check` ✓（0 警告）、`pnpm test` ✓（205 文件 / 2105 测试全部通过）、`pnpm test:e2e` ✓（226 文件 / 2400 测试全部通过）
- **E2E 配置**：`vitest.e2e.config.ts` 添加 `fileParallelism: false`（等价于 Jest `--runInBand`）
- **JWT `status` 遗漏修复**：3 个 E2E 文件的 `createAccessToken` helper 补充 `status: 'active'`（`e2e-helpers.ts`、`daily-records.e2e-spec.ts`、`medicines.e2e-spec.ts`），修复今天早些时候 `UserPayload.status` 改为必需后未同步 E2E helper 的问题

## 2026-07-12 NestJS 12 升级准备

- **移除 ts-loader**：`ts-loader` 是 `@nestjs/cli@11` 传递依赖的遗留物，项目已使用 SWC builder，不经过 webpack。升级到 CLI 12 后 webpack 依赖自动消失。已从 `devDependencies` 中删除
- **Jest → Vitest 迁移**：完整迁移已完成，见上方详细记录。`plans/2026-07-12-jest-to-vitest-migration.md` 计划已全部执行
- **关闭 pino-http autoLogging**：每请求 HTTP 访问日志与 Nginx access_log、ApiExceptionFilter、SlowRequestInterceptor、Prometheus 指标完全重复，已关闭；保留 PinoLogger 业务日志和 genReqId request ID 关联
- **Pino → Winston 迁移**：移除 pino 全家桶（nestjs-pino / pino / pino-http / pino-pretty / pino-roll），切换到 nest-winston + winston + winston-daily-rotate-file；6 个 PinoLogger DI 全部改为 `new Logger()` 字段方式，全项目 logger 统一；Winston 主线程执行，不再有 worker 线程绕过 console 拦截的问题

## 2026-07-12 新增测试类型：契约测试、性能测试、安全测试

- **契约测试**：`test/contract/contract.e2e-spec.ts`，验证 API 响应匹配 OpenAPI schema（公开 + 认证端点 + 错误信封），`pnpm test:contract`
- **性能测试**：`test/performance/` 下 3 个 k6 脚本（health / medicines / authenticated），TypeScript 编写，`pnpm test:perf:*`；k6 脚本已从 `.js` 迁移到 `.ts`，从 ESLint 和 tsc typecheck 中排除（k6 运行时独立于 Node.js）
- **安全测试**：`test/security/` 下 3 个测试文件
  - `authorization.e2e-spec.ts` — 跨用户越权测试（health-context / daily-records / reminders / notifications / sessions / assistant / data-export + JWT 篡改）
  - `fuzzing.e2e-spec.ts` — 输入模糊测试（SQL/NoSQL 注入、超大 payload、null byte、XSS、HTTP 方法 fuzzing、header 注入）
  - `rate-limiting.e2e-spec.ts` — 速率限制集成测试（全局 Throttler、登录限流锁定、验证码冷却）
- **package.json scripts:** `test:contract`、`test:security`、`test:perf:health`、`test:perf:medicines`、`test:perf:auth`

## 2026-07-12 队列与缓存增强

- **缓存增强（8 项）**：SuggestionCacheService 接入（3 层缓存 + 失效调用）、Reports Dashboard 缓存（5min TTL）、Today Analysis Context 缓存（3min TTL）、Legal Documents 缓存（1h TTL）、User Settings 缓存 + 主动失效（10min TTL）、Medicine Safety Tips 缓存（10min TTL）、Support Resources AppInfo 初始化读一次、Suggestion History 缓存（1min TTL）
- **队列增强（5 项）**：新增 5 个 BullMQ 队列（today-analysis / report-summary / suggestion-explanation / medicine-recognition / clinic-summary-pdf），所有队列复用 `BullmqQueueFactory`，Redis 不可用时降级为同步处理。每个队列新增 `/async` 入队端点和 `/status/:jobId` 轮询端点，保留现有同步端点兼容旧客户端
- **BullMQ 评估结论**：无需升级为 RabbitMQ，BullMQ 完全满足当前 fire-and-forget + 重试场景

## 2026-07-12 文件命名大重构

- **全量命名清理**：根据 `plans/2026-07-12-naming-cleanup.md` 计划，清理约 49 个文件的命名冗余问题，涵盖 6 个阶段：
  - spec 文件名称不匹配修复（3 个）+ 放置位置统一（9 个）
  - dto/ 模块名前缀清理（16 个）
  - services/ 模块名前缀清理（5 个）
  - 子目录名前缀 + constants/types/config 清理（13 个）
  - common/ 后缀统一（3 个）
- **class 名保持不变**：NestJS DI 基于 class 名而非文件名，仅改文件名
- **验证结果**：lint:check / typecheck / build / test 全部通过

## 2026-07-13 部署预审计修复

- **P0 关键修复**：生产 compose postgres 镜像改为 `pgvector/pgvector:pg18`（与 dev/CI 一致）；prometheus 服务添加 `env_file: .env`（修复 Basic Auth 变量注入）；smoke.ts `/metrics` 认证检查改为 `docker exec` 在 app 容器内执行（修复 3000 端口不暴露到宿主机导致直连失败）；Dockerfile 添加 `curl` 包
- **P1 文档一致性**：environment.md / README.md 部署目录结构更新为单 `/opt/lucent/` 布局；`.env.production.example` 移除 `DATABASE_URL` / `REDIS_URL`（由 compose 拼接）；environment.md 生产服务列表补全；environment-variables.md `pino` → `Winston`；deployment.md CD 工作流文件名修正
- **P2 增强规范化**：CI JWT Secret 值更新为 ≥32 字符；`deploy.ts` / `smoke.ts` 从 CommonJS 改为 ESM 风格；新建 `deploy/package.json`（`{"type":"module"}`）；CD 工作流 scp 上传列表同步更新

## 2026-07-13 安全审查修复

- **来源**：2026-07-12 Luminous + Lucent 联合安全性审查，P0/P1/P2 共 12 项全部修复
- **P0 高危**：导出任务 IDOR（job 归属校验）、`/metrics` 端点 Basic Auth、Helmet 安全头、测试端点共享密钥守卫
- **P1 中危**：Admin 面板 `timingSafeEqual` 常量时间比较、JWT Secret `.min(32)`、诊所摘要 Token 256 位 + SHA-256 哈希存储、生产环境强制 REDIS_URL
- **P2 低危**：验证码 SHA-256 哈希存储 + 常量时间比较、dev/test CORS 通配符改明确域名、`TRUST_PROXY` 移除 test 自动开启
- **延后**：Refresh Token 轮换非原子（当前设计已接受风险）
- **部署配置同步**：`deploy/` 目录下配置文件同步更新安全变更
  - `prometheus/prometheus.yml`：抓取配置添加 `basic_auth`，使用 `METRICS_USER` / `METRICS_PASSWORD`
  - `compose.yml`：app 容器环境变量新增 `METRICS_USER`、`METRICS_PASSWORD`、`TRUST_PROXY=true`
  - `nginx/nginx.conf`：`/metrics` 端点在 Nginx 层返回 403，阻止外部访问
  - `smoke.ts`：新增 `/metrics` Nginx 拦截验证（403）和直连 app 容器的 Basic Auth 验证（401 无认证 / 200 有认证）
  - `docs/01-reference/deployment.md`：安全加固章节扩充为容器与网络 / Nginx 层 / 应用层三部分，新增 Helmet、Basic Auth、测试端点守卫、常量时间比较、验证码哈希、分享 Token 强度、JWT 密钥强度、CORS、TRUST_PROXY 等条目；.env 示例新增 `METRICS_USER` / `METRICS_PASSWORD`；GitHub Secrets 新增 `METRICS_USER` / `METRICS_PASSWORD`；最低上线检查和 Smoke Test 新增 `/metrics` 验证步骤
  - `docs/01-reference/environment-variables.md`：新增 `METRICS_USER` / `METRICS_PASSWORD` / `TESTING_SHARED_SECRET` / `TRUST_PROXY` 变量文档
  - `docs/01-reference/environment.md`：新增 Helmet 中间件、`/metrics` Basic Auth、测试端点守卫、`TRUST_PROXY` 运行时说明

## 2026-07-13 JS → TS 全量迁移

- **项目源码 JS 清零**：`scripts/dev/fix-generated-prisma-internal.js` → `.ts`（CommonJS 风格，Node 24 原生 type stripping）
- **工具配置 TS 化**：`eslint.config.mjs` → `eslint.config.ts`（新增 `jiti` devDependency）；`commitlint.config.mjs` → `commitlint.config.ts`（commitlint v21 内置 `cosmiconfig-typescript-loader`）
- **Luminous-website 同步**：`eslint.config.mjs` → `eslint.config.ts`；`commitlint.config.cjs` → `commitlint.config.ts`（CJS → ESM 语法转换）
- 此后项目中除编译产物（`drift_worker.js`、`flutter_bootstrap.js`）外不再有 `.js`/`.mjs`/`.cjs` 文件

## 相关文档

- 延后项：[[00-current/TODO]]
- 变更日志：[[00-current/MigrationLog]]
- 参考规范：[[01-reference/architecture]]
- API 合同：`01-reference/contracts/*.md`
- 操作指南：[[01-reference/how-to/README]]
