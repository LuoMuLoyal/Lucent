# Lucent Current State

Last updated: 2026-07-18

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
- **LLM 重试 + 熔断器**：`BaseLlmGeneratorService` 和 `AssistantRuntimeService` 增加 `withLlmRetry`（指数退避，区分可重试/不可重试错误）；外层包裹 `LlmCircuitBreakerService`（5 次连续失败触发熔断，30s 恢复，`halfOpen` 探测成功关闭）
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

## 2026-07-14 NestJS 12 升级准备

- **移除 `request-ip`**：未维护库（2019 年最后更新），由 Express 5 原生 `req.ip` + `app.set('trust proxy', ...)` 替代；3 个 auth controller 移除 `ConfigService`/`trustProxy` 耦合
- **NestJS 12 alpha 评估**：核心包已有 `12.0.0-alpha.5`，peerDeps 仍为 rxjs 7 / reflect-metadata 0.2 / Node >=20，项目当前技术栈全部满足；生态包（throttler/jwt/passport）尚无 v12 alpha，需等待

## 2026-07-15 审查报告修复

- **health-context TOCTOU 消除**：`findAllergyById`/`findConditionById`/`findCurrentMedicineById` 改为 `(userId, id)` 签名，DB 层 `where: { id, userId }` 过滤，消除竞态窗口
- **通知类型白名单**：`CreateNotificationDto` 禁止用户创建 `system_announcement` 类型，新增 `USER_CREATABLE_NOTIFICATION_TYPES` 白名单
- **候选记录关联用户**：`generateCandidates` 传入 `userId` 用于日志追踪，`DailyRecordCandidatesService.generate` 签名新增 `userId` 参数
- **服药记录分页**：`medicine-dose-logs` 列表查询新增 `page`/`pageSize` 参数（默认 50 条上限），返回 `total` 总数
- **OpenAPI 导出修复**：`export-openapi.ts` CJS/ESM 互操作修复，`pnpm export:openapi` 恢复正常
- **medicine-dose-logs TOCTOU 消除**：`findReminderById`/`findCurrentMedicineById`/`ensureOwned` 改为 DB 层 `where: { id, userId }` 过滤，与 health-context 修复模式一致

## 2026-07-16 代码审查修复 + 五模块补充审查

- **pageSize 上限限制**：新增 `pagination.utils.ts` 统一分页参数范围限制（page ≥ 1，1 ≤ pageSize ≤ 100），`medicine-dose-logs` 和 `notifications` 控制器同步应用
- **E2E trustProxy 从配置读取**：`e2e-helpers.ts` 的 `trustProxy` 从硬编码改为从 `ConfigService` 读取
- **apiReference 类型断言**：`setup-app.ts` 改用 `@ts-expect-error` 指令
- **safeJsonPayload 提取**：新增 `json.utils.ts`（`toInputJsonValue` + `toNullableInputJsonValue`），替换全项目 8 处 `as Prisma.InputJsonValue` 类型断言
- **五模块补充审查**（auth / assistant / reports / medicines / today-suggestion）：
  - **P2 IDOR 修复**：`today-suggestion` 的 `explainSuggestionStatus` 和 `medicines` 的 `recognizeStatus` 缺少 userId 归属校验 — 已修复，队列 `getStatus` 和 `enqueue` 新增 `userId` 参数
  - **P3 重复代码修复**：`auth` 三个控制器的 `getAuthRequestContext` 提取为共享 `extractAuthRequestContext` 函数
  - **P3 防御性编程修复**：`assistant` 的 `findWithMessagesById` 和 `archiveConversation` 新增 `userId` 参数，DB 层强制所有权过滤
  - **审查通过**：`reports` 模块队列服务 IDOR 防护完整、诊所摘要分享链接安全；`auth` 开放重定向防护、验证码哈希、登录限流均正确；`today-suggestion` feedback/explain/dismiss 均正确验证 userId

## 2026-07-16 数据库索引优化

- **冗余索引删除（P0）**：10 个被唯一约束或复合索引前缀覆盖的冗余 `@@index` 从 `schema.prisma` 删除，减少写入开销
- **缺失索引补充（P1）**：`UserSession.expiresAt` 和 `UserReminderDelivery.scheduledFor` 新增跨用户索引，服务后台定时任务
- **低基数索引清理（P2）**：3 个保留 partial index（`UserCurrentMedicine`、`UserMedicineReminder`、`UserNotification`），3 个仅删除不重建（`User.status`、`MedicineSafetyTip`、`LegalDocument` — 表极小或无运行时查询），1 个 partial index（`MealDishTemplate`），1 个 B-tree on JSONB 删除（`CnMedicineLeaflet.approvalCodes`）
- **GIN trigram 索引（P3）**：启用 `pg_trgm` 扩展，为 `cn_medicine_products`（6 列）和 `drugbank_drugs`（4 列）的所有 ILIKE 搜索列添加 GIN trigram 索引；为 `food_composition_items` 的 `normalized_name` 和 `search_text` 添加 GIN trigram 索引（服务 `startsWith` 前缀匹配）
- **Migration**：`20260716120000_optimize_indexes` 包含所有 DROP/CREATE INDEX 语句

## 2026-07-17 部署加固（单 slot + 可观测性补全）

来源：`plans/2026-07-16-deployment-hardening.md`（15 项，除 LLM 熔断器外全部落地）。

- **单 slot 停机部署**：砍掉蓝绿双 slot（共享 DB 下挡不住 schema 风险，且 `.env.previous` 快照时机 bug 导致回滚失效），`deploy.ts` 重写为 12 步流程：部署前 `pg_dump` 快照（失败即中止、零停机）→ stop app → `prisma migrate deploy` → 启动新镜像 → 健康门禁（~150s，失败自动恢复上一镜像并打印日志）→ reload nginx（重解析 upstream 缓存 IP）→ smoke test；每次发布 15~45s 停机窗口，回滚 = `--rollback` 重部上一镜像 tag（schema 不回退）。决策补记在 ADR-0004
- **生产改人工发布**：`lucent-production.yml` 删除 `workflow_run` 自动触发，仅保留 `workflow_dispatch`（deploy/rollback，限 main），发布时间人工可控；staging 保持 CI 成功自动部署
- **告警通道**：新增 Alertmanager（profile=alerting，企业微信应用消息原生 `wechat_configs`）+ `prometheus/rules/lucent.yml` 告警规则（app 不可达、5xx 率、BullMQ 失败/积压、event loop lag、磁盘水位、证书过期）；发布成功/失败/回滚走独立的 `WECOM_WEBHOOK_URL` 群机器人通知；prometheus/alertmanager 配置改为模板 + 服务器本地 `render-configs.sh` 渲染（密钥不入库）
- **数据库备份**：`backup.sh` 每日 `pg_dump`（本地保留 7 份）+ 可选 COS 异地副本（coscli/coscmd，COS 生命周期 30 天）；部署前快照保留 10 份；恢复演练 runbook 见 `docs/01-reference/how-to/restore-database-backup.md`（每季度一次）
- **SSE 优雅关闭**：新增 `SseConnectionRegistry` 追踪活跃 SSE 连接，SIGTERM 时先推终止 `error` 事件（`reason: 'server_shutdown'`）再关闭；`stop_grace_period` 30s → 60s
- **基础设施指标**：新增 postgres-exporter / redis-exporter / node-exporter（磁盘水位可见）；Grafana/Prometheus 端口绑定 `127.0.0.1` 发布（SSH 隧道访问方式恢复可用）
- **请求级日志**：Fastify `onResponse` hook 写结构化完成日志，Winston 从 AsyncLocalStorage 注入顶层 `requestId` 字段；Postgres `log_min_duration_statement=500` 慢查询日志；Prisma log 配置 `['warn','error']`
- **CI 加固**：PR 上 `prisma migrate diff` 检测破坏性 migration 打 warning；新增 docker job（`docker build` 不推送 + Trivy HIGH/CRITICAL 严格扫描）
- **零散硬化**：BullMQ 队列深度 gauge 接线（30s 轮询 `getJobCounts()`）；nginx `limit_req`（20r/s burst 40）+ `limit_conn`（50，SSE 路径只限连接）；`.env` 行级写入保留注释 + `chmod 600`；限流确认为进程内存存储并修正注释；TLS 证书过期监控（`check-cert.sh` → textfile 指标 → 告警，续期仍手工）
- **文档**：`deployment.md` 全面重写（单 slot 流程、migration 纪律、备份、告警、TLS），ADR-0004 补记拓扑变更
- **遗留**：LLM 调用熔断器已完成（2026-07-18），见今日迁移日志

## 2026-07-17 跨模块数据访问治理（架构审查 #1）

来源：`plans/2026-07-16-architecture-review.md` 高优先级 #1。

- **ADR-0009 确立规则**：表归属表（含 User 表字段分组：`securityPin*`/`securityElevationVersion` 归 security-pin 域）；跨模块读允许但软删除模型必须用共享 `nonDeleted` helper；跨模块写必须经 owning module 导出 service（具名例外：testing-support 夹具、AdminJS、security-pin 字段组、`common/llm` 读 userSetting）；被 ≥2 个外部模块高频跨读的表收敛提供方只读 reader port
- **DailyRecordReaderPort**：8 处跨模块直查中的 5 处 `userDailyRecord` 查询（today-suggestion collectors/record、lifecycle/baseline、today-analysis context、reports dashboard context）收敛为 `listFactsInRange(userId, from, to, kinds?)`，实现于 `DailyRecordRepository`，规范排序 `occurredAt asc, createdAt asc`；需要 `createdAt desc` 的消费方内存重排
- **MedicineDoseLogReaderPort**：3 处 `userMedicineDoseLog` 直查（collectors/medication、today-analysis、reports dashboard）收敛为 `listFactsInRange(userId, from, to)`；`MedicineDoseLogsModule` 首次有了 exports
- **account 写路径改道**：`AccountService` 不再注入 `PrismaService`，昵称/头像更新经 `UserService.update`，解绑经新增的 `UserService.unlinkIdentity`，账户+身份读取经新增的 `UserService.findByIdWithIdentities`；`AccountModule` 新增 `UserModule` import
- **事件驱动缓存失效**：缓存失效从直接调用改为 `@nestjs/event-emitter` 事件驱动；5 个资源模块（daily-records / medicine-dose-logs / medicine-reminders / user-health-context / user-settings）写路径 emit domain event，today-suggestion 内 `SuggestionCacheInvalidationListener` 订阅并触发 `invalidateSignals` / `invalidateBaseline`；移除 `forwardRef(DailyRecordsModule/MedicineDoseLogsModule)` 反向依赖和 `SuggestionCacheService` export
- **Domain event 定义**：`src/common/events/domain-events.ts`，5 个事件（`DAILY_RECORD_CHANGED` / `DOSE_LOG_CHANGED` / `REMINDER_CHANGED` / `HEALTH_CONTEXT_CHANGED` / `SETTINGS_CHANGED`）及对应 payload 类型
- **模块绑定统一**：daily-records 的 repository 注册从 `useClass` 改为具体类 + `useExisting`（与 dose-logs/health-context 一致，单实例挂两个 port）
- **附带补齐**：`daily-records/repositories/index.ts` barrel 新建（该子目录此前无 barrel）

## 2026-07-17 PrismaService 软删除扩展 + 慢查询日志（架构审查 #3）

来源：`plans/2026-07-16-architecture-review.md` 高优先级 #3。

- **Prisma `$extends` 软删除扩展**：`src/prisma/prisma.extension.ts` 使用 `Prisma.defineExtension` 为 4 个含 `deletedAt` 的模型（User、UserDailyRecord、UserMedicineReminder、UserMedicineDoseLog）添加 `nonDeleted` 查询命名空间；`PrismaService.nonDeleted` getter 暴露这些变体
- **慢查询可观测性**：`PrismaService` 构造函数注入 Winston logger，`$on('query')` 注册慢查询处理器（默认阈值 `SLOW_QUERY_THRESHOLD_MS=500ms`），记录参数化 SQL + duration + requestId
- **迁移路径**：现有 `deletedAt: null` 手写查询点可逐步迁移到 `prisma.nonDeleted.<model>.findMany(...)`，非破坏性变更

## 2026-07-17 架构文档与代码漂移修复（架构审查 #4）

来源：`plans/2026-07-16-architecture-review.md` 高优先级 #4。

- **architecture.md**：依赖图新增 today-suggestion 节点及全部边；新增队列拓扑 mermaid 图 + 7+1 队列服务表格；common/ 目录清单补全
- **AGENTS.md**：`common/ai/` → `common/llm/`；补全 `queue/`、`metrics/`、`events/`、`storage/`、`types/`
- **目录合并**：`common/queues/` 并入 `common/queue/`（`base-async-queue.service.ts` + spec 移入，barrel 统一导出）

## 2026-07-17 全局 JwtAuthGuard + SSE/轮询限流豁免（架构审查 #9/#10）

来源：`plans/2026-07-16-architecture-review.md` 中优先级 #9、#10。

- **全局 JWT 认证**：`JwtAuthGuard` 注册为 `APP_GUARD`，所有 controller 默认受保护；新增 controller 无需手动挂载 guard
- **`@Public()` 白名单**：health、auth local/oauth、environment、support-resources、legal-documents 等公开端点显式标注 `@Public()`
- **`@SkipThrottle()` 豁免**：7 个 SSE 流和 getStatus 轮询端点豁免全局 Throttler 限流，避免前端轮询触发 429

## 2026-07-17 向量检索工具去重 + 队列可观测性增强（架构审查 #5/#7/#8）

来源：`plans/2026-07-16-architecture-review.md` 中优先级 #5、#7、#8。

- **VectorStoreFactory**：抽取共享工厂，复用 `LlmRuntimeService.createEmbeddingModel()` + 按 tableName 缓存 PGVectorStore；三个 assistant 工具（leaflet/drugbank/knowledge）消除约 120 行重复代码、三份 `OpenAIEmbeddings` 实例、三份 pg 连接池
- **ADR-0004 队列拓扑**：补记 BullMQ worker 全部跑在 API 进程内的设计决策 + 中期拆分计划
- **failed job 结构化日志**：`BaseAsyncQueueService.processJob` 和 `BullmqQueueFactory` worker failed 事件升级为 Winston 结构化日志（含 queue/jobId/attemptsMade/errorLabel）
- **Grafana alert rules**：已有 `BullMQJobFailures` 和 `BullMQWaitingBacklog`，无需新增

## 2026-07-17 代码审查安全修复

来源：`plans/lucent-review-2026-07-17.md`（3 个 🔴 + 2 个 🟡）。

- **Assistant IDOR 越权修复（🔴 ×2）**：`activateConversation` 和 `persistTurn` 的 `assistantConversation.update` where 条件从 `{ id }` 改为 `{ id, userId }`，与 `archiveConversation` 写法一致，阻断跨用户对话操作
- **刷新令牌竞态条件修复（🟡）**：`AuthSessionRepository` 新增 `claimSessionForRefresh` 原子性声明方法（`deleteMany` + 条件 where），`AuthTokenService.refresh` 从「先生成后删除」改为「先声明后生成」，消除同一 refresh token 并发产生多个有效会话的窗口
- **通知去重防御性加固（🟡）**：`matchesScope` 对 `source`/`date` 字段增加 `typeof === 'string'` 类型守卫，`duplicateIds` 增加 `.slice(0, 50)` 显式上限

## 2026-07-17 架构审查剩余项落地（#6/#11/#12/#13/#14/#15）

来源：`plans/2026-07-16-architecture-review.md` 中低优先级剩余 6 项全部落地。

- **#15 读模型查询条数上限**：`DailyRecordReaderPort` 和 `MedicineDoseLogReaderPort` 的 `listFactsInRange` 新增 `take: 500` 上限，防止用户数据增长后 context 构建拖慢 AI 管道
- **#13 LlmSafetyPolicyService 收敛**：新建 `common/llm/llm-common.module.ts` 共享模块，4 个 feature 模块（daily-records / reports / today-analysis / today-suggestion）从各自 providers 注册改为 import `LlmCommonModule`，消除 4 份重复实例
- **#12 Barrel 规则 + ESLint 强制**：新建 `llm-runtime/services/index.ts` 和 `llm-runtime/index.ts` barrel；16 个文件的深路径引用 `llm-runtime/services/llm-runtime.service` 改为 barrel 导入；ESLint `no-restricted-imports` 新增 pattern 禁止 `**/llm-runtime/services/*` 深路径引用
- **#14 data-export 名不副实**：模块、`DataExportService`、`DataExportProcessorService` 新增文档注释明确边界——此模块是报告 PDF 生成下载管道，不导出原始用户数据；若未来需 GDPR 式数据导出应另建模块
- **#6 Repository 模式统一**：ADR-0009 新增「Port 标准」章节（哪些模块必须有 Port、绑定规范 `useExisting`、export 规则）；auth 模块 `AuthSessionRepositoryPort`/`AuthAccountRepositoryPort` 从 `useClass` 改为 `useExisting`（单实例）；`DailyRecordRepositoryPort` 从 daily-records exports 移除（无外部消费者）
- **#11 auth 模块拆分**：`services/identity/` 子目录新建，`CredentialAuthService`/`VerificationCodeService`/`AuthRateLimitService` 及其 spec 移入；`services/identity/index.ts` barrel 导出；孤儿 spec `auth/auth.service.spec.ts` 移至 `services/auth.service.spec.ts`（spec-next-to-source）；外部引用统一经 barrel
- **附带修复**：`tool.service.spec.ts` 中 `VectorStoreFactory` mock 从 `{ get: vi.fn() }` 修正为 `{ getStore: vi.fn() }`（#5 遗留 mock 不匹配）
- **验证**：`pnpm lint:check` ✓、`pnpm typecheck` ✓、`pnpm build` ✓（744 文件）、`pnpm test` ✓（103 文件 / 1165 测试全部通过）

## 2026-07-18 LLM 调用熔断器

- **新增 `LlmCircuitBreakerService`**（`src/common/llm/llm-circuit-breaker.service.ts`）：三态机 `closed → open → halfOpen → closed`，5 次连续失败触发熔断，30s 恢复超时，`halfOpen` 单探测成功后关闭；`open`/`halfOpen` 容量耗尽时 `acquire()` 抛出 `LlmCircuitOpenError`（HTTP 503）
- **接入点**：`LlmCommonModule` 注册并导出熔断器；`BaseLlmGeneratorService`（4 个子类）和 `AssistantRuntimeService` 所有 LLM 调用包裹 `acquire/recordSuccess/recordFailure`；`AssistantModule` 新增 `LlmCommonModule` 导入
- **设计决策**：不引入 `opossum` 依赖（单 slot 单进程计数器够用）；全局单例而非 per-role（同一提供商宕机影响所有 role）；熔断器在 `withLlmRetry` 外层，`open` 时快速失败不重试
- **计划清零**：`plans/2026-07-16-deployment-hardening.md` 全部章节已清空

## 2026-07-18 修复 refresh token 接口缺少 @Public() 装饰器

- **问题**：`SessionController.refresh`（`POST /api/v1/auth/refresh`）缺少 `@Public()` 装饰器。全局 `JwtAuthGuard`（`APP_GUARD` 注册）会对所有未标记 `@Public()` 的路由执行 JWT 验证，导致 access token 过期后 refresh 接口返回 401，形成死循环——用户无法刷新令牌只能重新登录。代码注释 `// No auth guard` 与实际行为矛盾。
- **修复**：`session.controller.ts` 的 `refresh` 方法添加 `@Public()` 装饰器（方法级别，不影响同控制器中 `logout`/`sessions`/`revokeSession` 的认证要求）；运行 `pnpm export:openapi` 重新生成 `docs/openapi.json`，refresh 端点不再包含 `security` 字段。
- **验证**：lint:check / typecheck / build / session.controller.spec.ts（4 测试）全部通过。

## 2026-07-18 修复 daily-records 候选记录生成器测试 + CI trivy-action 版本

- **测试依赖修复**：`DailyRecordCandidatesGeneratorService` 接入熔断器后新增了 `LlmCircuitBreakerService` 构造参数，但 `generator.service.spec.ts` 未同步补 provider，4 个测试全部失败；补上 `useValue: new LlmCircuitBreakerService()` 后通过。
- **CI 版本修复**：`lucent-ci.yml` 的 trivy-action 从已删除的 `@0.28.0` 升级到 `@v0.36.0`（trivy-action 供应链攻击后所有 tag 迁移到 `v` 前缀）。

## 2026-07-18 修复 LlmCircuitBreakerService 破坏全部 E2E 测试 + medicines 公开端点 401

- **E2E 引导崩溃修复**：`LlmCircuitBreakerService` 构造函数的 `options: Partial<CircuitBreakerOptions> = {}` 参数在 NestJS DI 中无法解析（TS 默认参数值无效、接口类型无 provider），导致全部 ~16 个 E2E 测试 `beforeAll` 失败，连锁抛出 `Cannot read properties of undefined (reading 'prisma'/'close'/…)`。修复：参数加 `@Optional()` + `?? {}` 回退默认值。
- **medicines 公开端点修复**：E2E 引导修复后暴露 `GET /api/v1/medicines`（搜索）、`GET /api/v1/medicines/:id`（详情）、`GET /api/v1/medicines/safety-tips` 缺少 `@Public()` 装饰器（2026-07-17 全局 `JwtAuthGuard` 启用时遗漏），8 个测试 401。修复：三个 GET 端点加 `@Public()`，`recognize` 系列保持需认证。
- **app.e2e-spec.ts 缺少 Winston provider**：2026-07-17 部署加固在 `setup-app.ts` 新增 `app.get(WINSTON_MODULE_PROVIDER)` 用于 HTTP 访问日志，但精简测试模块 `app.e2e-spec.ts` 未同步补 provider。修复：providers 数组新增 `{ provide: WINSTON_MODULE_PROVIDER, useValue: { log: vi.fn() } }`。完整 E2E 套件 261 文件全部通过。

## 相关文档

- 延后项：[[00-current/TODO]]
- 变更日志：[[00-current/MigrationLog]]
- 参考规范：[[01-reference/architecture]]
- API 合同：`01-reference/contracts/*.md`
- 操作指南：[[01-reference/how-to/README]]
