---
status: active
owner: backend
---

# notification-preferences

用户级通知偏好（`UserNotificationPreference`，1:1 with User），跨设备同步的
通知门禁开关。偏好是「投递门禁」而非数据生产前置：偏好存储不可用时仅对通知
fail closed，不影响建议/报告等主流程。

## Endpoints（挂 `/user` 前缀，事实源 = openapi.json）

- `GET /api/v1/user/notification-preferences` — 返回偏好资源；无持久化行时返回
  默认值且 `configured: false`。
- `PATCH /api/v1/user/notification-preferences` — 部分更新（upsert）；分钟字段
  必须是 `0..1439` 整数，否则 400 `VALIDATION_FAILED`（本地化 Problem Details）。

字段与默认值：`healthAlertsEnabled=true`、`weeklyInsightEnabled=false`、
`waterRemindersEnabled=true`、`sleepReminderEnabled=false`、
`sleepBedtimeMinutes/sleepWakeTimeMinutes=null`。sleep 字段仅同步给客户端，
就寝提醒只由 Luminous 本地调度，后端不排程。

## 门禁语义（`isRuleEnabled`）

- `sleep_shortfall` / `event_check_in_trend` / `deteriorating_symptom` →
  读 `healthAlertsEnabled`。
- `water_behind_target` → 独立读 `waterRemindersEnabled`。
- 其他规则（如 `missed_dose_pending`）不受门禁，恒返回 `true`。

## Weekly Insight 调度（`WeeklyInsightSchedulerService`）

共享 BullMQ cron 队列驱动 `runTick`：按用户 profile 时区命中周一 09:00 →
检查 `weeklyInsightEnabled` → 用 reports 的 `IReportSummaryReader` 生成上一个
完整自然周摘要 → 无任何 tracked series 则跳过 → `createOrReplaceScoped`
写幂等站内通知（scope = user/week），JPush 仅 best-effort 补充。

## Dependencies

- 引用：`reports`（`IReportSummaryReader` port）、`notifications`
  （`INotificationSender` / `PushDeliveryService`）、Prisma。
- 被引用：`today-suggestion`（escalation 调 `isRuleEnabled`）、
  `common/queue`（cron-jobs 调 `WeeklyInsightSchedulerService`）。
- Barrel 导出：`NotificationPreferencesService`、`WeeklyInsightSchedulerService`、
  `NOTIFICATION_PREFERENCE_DEFAULTS`。

## Tests

`notification-preferences.controller.spec.ts`、
`services/notification-preferences.service.spec.ts`、
`services/weekly-insight-scheduler.service.spec.ts`。
