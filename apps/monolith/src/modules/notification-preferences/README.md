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
  请求体没有任何可识别字段时直接返回当前值，不写库也不创建偏好行。

字段与默认值：`healthAlertsEnabled=true`、`weeklyInsightEnabled=false`、
`waterRemindersEnabled=true`、`sleepReminderEnabled=false`、
`sleepBedtimeMinutes/sleepWakeTimeMinutes=null`。sleep 字段仅同步给客户端，
就寝提醒只由 Luminous 本地调度，后端不排程。

## 门禁语义（`isRuleEnabled`）

- `sleep_shortfall` / `event_check_in_trend` / `deteriorating_symptom`
  （`HEALTH_ALERT_RULE_IDS`）→ 读 `healthAlertsEnabled`。
- `water_behind_target`（`WATER_RULE_ID`）→ 独立读 `waterRemindersEnabled`。
- 其他规则（如 `missed_dose_pending`）**没有偏好开关**，`isRuleEnabled`
  恒返回 `true`——新增规则若不加判分支就默认放行，是这里最容易被踩空的一处。
- 偏好行查询/解析失败时 fail closed（`false` + warn 日志），但**未知规则名
  返回 `true`**：闸门只对登记过的规则生效。

## Weekly Insight 调度（`WeeklyInsightSchedulerService`）

共享 BullMQ cron 队列（`JOB_WEEKLY_INSIGHT`，每分钟一次）驱动 `runTick`：
按用户 profile 时区命中周一 09:00 → 检查 `weeklyInsightEnabled` → 用 reports 的
`IReportSummaryReader` 生成上一个完整自然周摘要 → 无任何 tracked series 则跳过 →
`createOrReplaceScoped` 写幂等站内通知（scope = user/week）→ JPush 仅 best-effort
补充。时区换算失败回落 `DEFAULT_USER_TIMEZONE`，单个用户任何一步抛错只 warn 并
继续下一个用户，不中断整轮。

## Dependencies

- 引用：`reports`（`IReportSummaryReader` port）、`notifications`
  （`INotificationSender` / `PushDeliveryService`）、Prisma。
- 被引用：`today-suggestion`（escalation 调 `isRuleEnabled`；该模块直接 import
  本模块 `.module.ts`）、`common/queue`（cron-jobs 调
  `WeeklyInsightSchedulerService.runTick`）。
- Barrel 导出：`NotificationPreferencesModule`、`NotificationPreferencesService`、
  `WeeklyInsightSchedulerService`、`NOTIFICATION_PREFERENCE_DEFAULTS`、
  类型 `UpdateNotificationPreferencesDto` / `NotificationPreferencesDataDto`。

## Tests

`notification-preferences.controller.spec.ts`、
`services/notification-preferences.service.spec.ts`、
`services/weekly-insight-scheduler.service.spec.ts`。
