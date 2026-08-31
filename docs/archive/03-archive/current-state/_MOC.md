# Lucent 文档地图

## 归档说明

本文档是 Obsidian 文档地图，于 2026-08-01 归档至 `03-archive/current-state/`。导航由 `docs/README.md` 承担。

本页按区域列出所有活跃文档。当前后端状态见 [[Current_State]]。

## 00-current — 当前状态与计划

- [[Current_State]] — 当前后端实现状态入口（索引页），链接到各区域详情
- [[00-current/TODO]] — 活跃延后后端项
- [[02-logs/README]] — 变更日志索引
- [[Assistant_Runtime]] — 助手运行时
- [[Medicine_Data_RAG]] — 药品数据与 RAG
- [[Public_Support_Resources]] — 公共支持资源
- [[01-reference/toolchain]] — 工具链与合同
- [[Auth_Security_PIN]] — 认证与安全 PIN
- [[Report_Export]] — 报告导出
- [[Meal_Analysis]] — 餐食分析
- [[01-reference/code-quality]] — 代码质量与可维护性

## 01-reference — 参考规范与合同

- [[01-reference/architecture]] — 模块依赖图、AI 管道架构、路由架构、数据库约定
- [[01-reference/deployment]] — 生产部署手册
- [[01-reference/environment]] — 本地环境、Docker 与快速命令总览
- [[01-reference/environment-variables]] — 环境变量参考
- [[01-reference/adr/README]] — 架构决策记录
- [[01-reference/how-to/README]] — 操作指南

### contracts — 公共合同

- `01-reference/contracts/README.md` — 公共合同目录边界
- `01-reference/contracts/data-sources.md` — 数据源索引与概述
- `01-reference/contracts/data-sources-cn-products.md` — 中文药品/说明书
- `01-reference/contracts/data-sources-drugbank.md` — DrugBank
- `01-reference/contracts/data-sources-medical-qa.md` — 医疗问答数据集
- `01-reference/contracts/data-sources-food-composition.md` — 食物成分/餐食分析
- `01-reference/contracts/reminder-contract.md` — 提醒/通知边界
- `01-reference/contracts/environment-contract.md` — 环境快照 API 边界
- `01-reference/contracts/mine-settings-contract.md` — Mine/Settings API 总览
- `01-reference/contracts/support-resources-contract.md` — Support Resources 边界
- `01-reference/contracts/app-info-contract.md` — App Info 边界
- `01-reference/contracts/data-export-contract.md` — Data Export 边界
- `01-reference/contracts/assistant-contract.md` — 助手合同总览与边界
- `01-reference/contracts/assistant-capabilities.md` — 助手能力/工具细节
- `01-reference/contracts/assistant-rollout.md` — 助手 Rollout/Runtime Truth
- `01-reference/contracts/assistant-safety.md` — 助手 Safety/Policy

## 02-logs — 变更日志

- `migration-log/YYYY-MM-DD.md` — 单日详细后端变更

## 生成产物

- `openapi.json` — Lucent 导出的 API 合同
- `compodoc/` — 生成的 NestJS 架构文档

## 03-archive — 归档

- `03-archive/migration-log/` — 旧后端变更日志
