# Lucent Current State

Last updated: 2026-07-19

本文件是 `00-current/` 目录的索引。具体实现细节由各子文件负责，变更历史见 `02-logs/migration-log/`。

## 当前基线

- 运行后端为 `Lucent`；`Luminous/backend` 为遗留参考。
- 技术栈：NestJS 11、Prisma 7、PostgreSQL、Redis、JWT auth。
- 全局响应信封：`{ code, message, data }`。
- 健康检查：`GET /api/v1/health`。
- 全局 `JwtAuthGuard`（`APP_GUARD`），公开端点显式标注 `@Public()`。
- LLM 调用受 `LlmCircuitBreakerService` 熔断保护（5 次连续失败触发，30s 恢复）。
- 跨模块数据访问遵循 [ADR-0009](../01-reference/adr/0009-cross-module-data-access.md)：跨模块写经 owning module 导出 service，软删除模型用共享 `nonDeleted` helper。

## 目录索引

### 功能域

- [[00-current/Assistant_Runtime]] — Assistant 运行时、检索链路、LangGraph tool-loop
- [[00-current/Today_Suggestion_Engine]] — Today 主动建议引擎
- [[00-current/Medicine_Data_RAG]] — 药品知识库、RAG 索引、dose log 合同
- [[00-current/Meal_Analysis]] — 餐食分析管道
- [[00-current/Report_Export]] — 报告导出、PDF 生成
- [[00-current/Auth_Security_PIN]] — 认证、OAuth、Security PIN、安全配置
- [[00-current/Public_Support_Resources]] — 公共支持资源、法律文档管理 API

### 工具链与质量

- [[00-current/Toolchain_Contract]] — 工具链、OpenAPI 合同、Git hooks、环境变量解析
- [[00-current/Code_Quality_Maintainability]] — 代码质量、模块结构、测试覆盖

### 计划与跟踪

- [[00-current/TODO]] — 延后与门控事项
- [[00-current/MigrationLog]] — 变更日志索引

## 相关文档

- 参考规范：[[01-reference/architecture]]
- 环境配置：[[01-reference/environment]]
- API 合同：`01-reference/contracts/*.md`
- 架构决策：[[01-reference/adr/README]]
- 操作指南：[[01-reference/how-to/README]]
