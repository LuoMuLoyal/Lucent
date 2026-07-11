# Lucent Current State

Last updated: 2026-07-11

本文件只保留简介和按区域链接。具体后端实现细节见 `00-current/` 下各子文件。

## 当前区域

- [[00-current/Assistant_Runtime]] — Assistant 运行时、检索链路、今日分析通知
- [[00-current/Medicine_Data_RAG]] — 药品知识库、RAG 索引、slot-aware dose log 合同
- [[00-current/Public_Support_Resources]] — 公共支持资源
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
- **发现的问题**：`AuthTokenService.revokeById` 抛 raw Error 导致 500，应修复为 404/403
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
- **生产日志双写**：Pino stdout JSON + `pino-roll` 按天分割文件（`./logs/lucent.YYYY-MM-DD.log`，500MB 上限）
- **优雅关闭**：`enableShutdownHooks()` + `stop_grace_period: 30s` + SIGTERM

## 相关文档

- 延后项：[[00-current/TODO]]
- 变更日志：[[00-current/MigrationLog]]
- 参考规范：[[01-reference/architecture]]
- API 合同：`01-reference/contracts/*.md`
- 操作指南：[[01-reference/how-to/README]]
