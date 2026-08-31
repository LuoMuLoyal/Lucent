---
status: active
owner: backend
---

# medicine-dose-logs

## 模块意图

服药剂量日志(标记/更新/查询)的写模型,并经 Reader port 向建议、分析、
报告模块提供只读访问。与 medicine-reminders(提醒计划)分工:本模块记录
"实际服没服",不管理"该何时服"。

## 边界

- 管:剂量日志 CRUD、按提醒的日志查询、`dose-log.changed` 领域事件发布。
- 不管:提醒计划与推送调度(medicine-reminders);健康事件上下文(依赖
  `HealthEventsModule` 获取)。

## 依赖方向

- imports:`HealthEventsModule`。
- 被引用:exports `MedicineDoseLogReaderPort`;barrel 消费方 `assistant`、
  `reports`、`today-analysis`、`today-suggestion`。

## 内部结构

- `services/dose-logs.service.ts` — `MedicineDoseLogsService`:剂量日志业务
  逻辑与归属校验。
- `repositories/dose-log.repository.ts` — 仓储 + Repository/Reader port。

## 测试承接

`medicine-dose-logs.controller.spec.ts`、`repositories/dose-log.repository.spec.ts`、
`services/dose-logs.service.spec.ts`
