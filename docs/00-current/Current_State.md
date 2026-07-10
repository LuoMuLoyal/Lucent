# Lucent Current State

Last updated: 2026-07-10

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

## 相关文档

- 延后项：[[00-current/TODO]]
- 变更日志：[[00-current/MigrationLog]]
- 参考规范：[[01-reference/architecture]]
- API 合同：`01-reference/contracts/*.md`
- 操作指南：[[01-reference/how-to/README]]
