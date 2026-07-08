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
User.email 字段已在数据库层添加唯一约束（`@unique`），应用层重复检查仍保留作为早期拦截。
Medicine dose logs 现已具备 slot-aware 基础合同：单条 dose log 可携带 `reminderId` +
`scheduledTime`，并新增幂等 `POST /api/v1/user/medicine-dose-logs/mark` 用于按提醒槽位标记。

## 相关文档

- 延后项：[[00-current/TODO]]
- 变更日志：[[00-current/MigrationLog]]
- 公共合同：`public/*.md`
- 参考规范：[[01-reference/architecture]]
