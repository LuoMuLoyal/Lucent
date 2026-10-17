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

- imports:`HealthEventsModule`(`HealthEventsOwnershipService`);读写
  `UserMedicineDoseLog`,并回读提醒行做归属/目标校验。
- 被引用:barrel 只导出 `MedicineDoseLogReaderPort`(仓储实现注册为
  Reader port);消费方 `reports`(dashboard、event-review)、`today-analysis`、
  `today-suggestion`(medication collector)。**`MedicineDoseLogsService` 不在
  barrel 内**,没有任何跨模块写入口。

## 内部结构

- `services/dose-logs.service.ts` — `MedicineDoseLogsService`:剂量日志业务
  逻辑与归属校验(`HealthEventsOwnershipService.ensureActiveOwnedByUser`、
  提醒归属),发布 `dose-log.changed` 领域事件。
- `repositories/dose-log.repository.ts` — 仓储 + Repository/Reader port。

## 不变量与陷阱

- 服药记录无法匹配到目标(找不到提醒、也没有可回落的在服药品,或
  提醒/药品配对不一致)时返回独立码 **`DOSE_LOG_TARGET_UNRESOLVED`**,而不是
  笼统的 `RESOURCE_NOT_FOUND`/`VALIDATION_FAILED`:客户端同步队列据此判定
  "原样重试永远不会成功"(payload 的身份有问题),与"记录不存在"区分开。
- `healthEventId` 通过 `ensureActiveOwnedByUser` 校验:只接受本人 **active**
  事件(已结束的事件不能挂新的服药记录);不传则跳过事件校验。

## 测试承接

`medicine-dose-logs.controller.spec.ts`、`repositories/dose-log.repository.spec.ts`、
`services/dose-logs.service.spec.ts`
