# Lucent 文档地图

本页按区域列出所有活跃文档。当前后端状态见 [[00-current/Current_State]]。

## 00-current — 当前状态与计划

- [[00-current/Current_State]] — 当前后端实现状态入口，链接到各区域详情
- [[00-current/TODO]] — 活跃延后后端项
- [[00-current/MigrationLog]] — 变更日志索引
- [[00-current/Assistant_Runtime]] — 助手运行时
- [[00-current/Medicine_Data_RAG]] — 药品数据与 RAG
- [[00-current/Public_Support_Resources]] — 公共支持资源
- [[00-current/Toolchain_Contract]] — 工具链与合同
- [[00-current/Auth_Security_PIN]] — 认证与安全 PIN
- [[00-current/Report_Export]] — 报告导出
- [[00-current/Meal_Analysis]] — 餐食分析
- [[00-current/Code_Quality_Maintainability]] — 代码质量与可维护性

## 01-reference — 参考规范

- [[01-reference/architecture]] — 模块依赖图、AI 管道架构、路由架构、数据库约定
- [[01-reference/deployment]] — 生产部署手册
- [[01-reference/environment]] — 本地环境、Docker 与快速命令总览
- [[01-reference/environment-variables]] — 环境变量参考
- [[01-reference/adr/README]] — 架构决策记录

## 02-logs — 变更日志

- `migration-log/YYYY-MM-DD.md` — 单日详细后端变更

## public — 公共合同

- `public/README.md` — 公共合同目录边界
- `public/data-sources.md` — 数据源索引与概述
- `public/data-sources-cn-products.md` — 中文药品/说明书
- `public/data-sources-drugbank.md` — DrugBank
- `public/data-sources-medical-qa.md` — 医疗问答数据集
- `public/data-sources-food-composition.md` — 食物成分/餐食分析
- `public/reminder-contract.md` — 提醒/通知边界
- `public/environment-contract.md` — 环境快照 API 边界
- `public/mine-settings-contract.md` — Mine/Settings API 总览
- `public/support-resources-contract.md` — Support Resources 边界
- `public/app-info-contract.md` — App Info 边界
- `public/data-export-contract.md` — Data Export 边界
- `public/assistant-contract.md` — 助手合同总览与边界
- `public/assistant-capabilities.md` — 助手能力/工具细节
- `public/assistant-rollout.md` — 助手 Rollout/Runtime Truth
- `public/assistant-safety.md` — 助手 Safety/Policy

## 生成产物

- `openapi.json` — Lucent 导出的 API 合同
- `compodoc/` — 生成的 NestJS 架构文档
