# Lucent Current State

Last updated: 2026-07-08

本文件只保留简介和按区域链接。具体后端实现细节见 `00-current/` 下各子文件。

## 当前区域

- [[00-current/Assistant_Runtime]]
- [[00-current/Medicine_Data_RAG]]
- [[00-current/Public_Support_Resources]]
- [[00-current/Toolchain_Contract]]
- [[00-current/Auth_Security_PIN]]
- [[00-current/Report_Export]]
- [[00-current/Meal_Analysis]]
- [[00-current/Code_Quality_Maintainability]]

当前共享目录边界以 `[[00-current/Code_Quality_Maintainability]]` 为准；`src/common/` 已按
`helpers/`、`services/`、`logger/` 等角色分层，不再使用单一 `utils/` 汇总共享代码。
后端日志基线现已切换到 `pino` / `nestjs-pino`，并带有 `X-Request-Id` + AsyncLocalStorage
请求上下文。
Lucent runtime、Prisma CLI 与本地 import 脚本现统一按
`.env.<NODE_ENV>.local` → `.env.<NODE_ENV>` 的优先级解析环境变量，不再使用根 `.env`
fallback。
仓库生成物边界现已明确：`generated/prisma/` 与 `docs/openapi.json` 均作为本地可重建产物保持
ignore；跨仓 API 合同通过本地 `pnpm export:openapi` 导出后再供 Luminous 消费。
User.email 字段已在数据库层添加唯一约束（`@unique`），应用层重复检查仍保留作为早期拦截。
Medicine dose logs 现已具备 slot-aware 基础合同：单条 dose log 可携带 `reminderId` +
`scheduledTime`，并新增幂等 `POST /api/v1/user/medicine-dose-logs/mark` 用于按提醒槽位标记。
Today analysis 在落库 `assistant_summary_histories` 之外，现会额外产出两类通知：
`ai_today_summary` 与 `ai_proactive_suggestion`，并在 `actionPayload` 中附带 `date` /
`source=today-analysis` 供前端做“历史建议回顾”归因。
同一天重复生成 today analysis 时，上述两类通知现按 `type + source + date` 做覆盖写入并清理旧重复项，
避免通知页和报告页的建议历史被重复生成污染。
OpenAPI 合同现已全面修复：所有 `nullable: true` 的 DTO 字段均显式标注 `type`，消除了 Flutter 生成客户端中
`int` 调用 `.toJson()` 的 P0 崩溃以及大量字段退化为 `dynamic` 的 P1 类型丢失问题。SSE 流端点已补充
`text/event-stream` content 标注，`/clear` 端点已提取具名响应 DTO。

## 相关文档

- 延后项：[[00-current/TODO]]
- 变更日志：[[00-current/MigrationLog]]
- 公共合同：`public/*.md`
- 参考规范：[[01-reference/architecture]]
