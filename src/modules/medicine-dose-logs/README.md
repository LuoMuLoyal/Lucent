---
status: active
owner: backend
---

# medicine-dose-logs

## 模块意图

服药剂量日志(标记/更新/查询)的写模型,并经 reader port 向建议、分析、
报告模块提供只读访问。与 medicine-reminders(提醒计划)分工:本模块记录
"实际服没服",不管理"该何时服"。

## 边界

- 管:剂量日志 CRUD、按提醒的日志查询、`dose-log.changed` 领域事件发布。
- 不管:提醒计划与推送调度(medicine-reminders);健康事件上下文(经 ACL 端口
  向 `HealthEventsModule` 校验,不直接依赖其服务)。

## 依赖方向

- imports:`HealthEventsModule`(经 `adapters/acl` 包装成 `HealthEventGuard`)。
- 被引用:barrel 只导出 `MedicineDoseLogReaderPort`(跨上下文只读端口);
  消费方 `reports`(dashboard、event-review)、`today-analysis`、
  `today-suggestion`(medication collector)。**没有任何跨模块写入口。**
- 端口名保持 `MedicineDoseLogReaderPort`:三个外部上下文已按该 token 注入,
  改名是跨模块破坏性变更且无行为收益(ADR-0024 的改名规则针对内部结构)。

## 内部结构（ADR-0024 四层）

```
domain/dose-log/
  dose-log.ts              槽位规则：slotIdentityOf / resolveScheduledTime / takenAtFor …
  dose-logs.ts             DoseLogs 写侧端口（按语义命名，不暴露 Prisma DSL）
  dose-log-facts.ts        MedicineDoseLogReaderPort 跨上下文只读端口
application/
  use_cases/create-dose-log.ts / mark-dose-log.ts / update-dose-log.ts / delete-dose-log.ts
  use_cases/dose-target-resolver.ts   两条写路径共用的目标解析
  use_cases/failures.ts    领域失败 + fromFailure（异常 → Result 单点折叠）
  read_models/dose-log.ts / dose-logs-for-date.ts
  services/medicine-dose-logs.ts       门面（每个端点一个方法）
  ports/dose-log-resource.ts / dose-log-events.ts / health-event-guard.ts
adapters/http/medicine-dose-logs.controller.ts + dto/
adapters/events/dose-log-changed.ts      best-effort 发布
adapters/acl/health-events-guard.ts      健康事件归属校验
infrastructure/persistence/dose-logs.ts  PrismaDoseLogs（同时实现两个端口）
```

## 不变量与陷阱

- 服药记录无法匹配到目标(找不到提醒、也没有可回落的在服药品,或
  提醒/药品配对不一致)时返回独立码 **`DOSE_LOG_TARGET_UNRESOLVED`**,而不是
  笼统的 `RESOURCE_NOT_FOUND`/`VALIDATION_FAILED`:客户端同步队列据此判定
  "原样重试永远不会成功"(payload 的身份有问题),与"记录不存在"区分开。
- `healthEventId` 经 `HealthEventGuard` 校验:只接受本人 **active** 事件(已结束
  的事件不能挂新的服药记录);不传则跳过事件校验。
- **槽位身份** = `(reminderId, scheduledFor, scheduledTime)`,只匹配未删除行:
  软删除的行不会被 `mark` 复活;临时日志(无 reminder)永不合并,每次插入。
- `takenAt` 只在 `taken` 时写入、`skipped` 时清空,避免报告把拒绝的剂量计入。

## 测试承接

`domain/dose-log/dose-log.spec.ts`(槽位规则)、
`application/use_cases/dose-target-resolver.spec.ts`(目标解析与失败传播)、
`adapters/http/medicine-dose-logs.controller.spec.ts`(端点).
