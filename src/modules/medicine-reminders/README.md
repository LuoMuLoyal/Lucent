---
status: active
owner: backend
---

# medicine-reminders

用药提醒的调度定义与投递审计。schedule-only：只存「什么药、几点、哪几天、
起止窗口」，不存库存/补货/推送运行时状态。通知偏好端点属
`notification-preferences` 模块；投递语义详见 ADR-0011（at-least-once）与
ADR-0013（三通道）。

## Endpoints（挂 `/user` 前缀，事实源 = openapi.json）

- `GET /api/v1/user/medicine-reminders?activeOnly=` — 提醒列表。
- `POST /api/v1/user/medicine-reminders` — 创建（currentMedicineId 校验
  归属，404）；`PATCH /:id` — 更新（403 他人 / 404 不存在）。
- `DELETE /:id` — **软删除**（`deletedAt=now()` 且 `isActive=false`），204。
- `PUT /api/v1/user/medicine-reminders/group` — 整组 upsert（单事务）：
  `slots` 为唯一事实源——带 `id` 更新（须属本人/同药/未删，否则 404）、
  无 `id` 创建、请求中缺席的现存槽位隐式软删；组级可选字段缺省即重置
  为 `null`（`isActive` 缺省 `true`）；提交后发一条 `reminder.changed` 事件。

槽位语义：`daysOfWeek=null` 表示每天，否则 0–6（周日为 0）；提醒按独立
槽位（`reminderId + scheduledFor + scheduledTime` 身份）参与建议/依从性
评估，而非按药-天聚合；`scheduledFor` 由用户 profile IANA 时区换算
（缺省/非法回落 `Asia/Shanghai`，DST 空档不造虚假逾期时刻）。

## 投递（scheduler + 三通道审计）

- `ReminderSchedulerService` 由共享 BullMQ repeatable job 每分钟驱动
  （`REMINDER_SCHEDULER_CRON`，注册在**独立**的 `reminder-dispatch` 队列上，
  避免高频派发被低频 cron 阻塞）：按用户本地时区匹配 `scheduledHour:Minute` +
  `daysOfWeek` + 起止日期窗口，cursor 分页（batch 500）防 OOM。
  进程级 `isDispatching` 重入锁已移除——由 BullMQ 单 worker 语义 + 唯一约束兜底
  （邻近重复实例重叠时通知可能重复发，但审计行绝不重复，即 at-least-once）。
- 三通道各写一条 `UserReminderDelivery` 审计行，
  `(userId, reminderId, scheduledFor, channel)` 唯一约束去重（findFirst 快速路径 +
  `createMany({ skipDuplicates: true })` 原子兜底）：`in_app` 始终写入
  通知中心；`local` 由客户端展示后幂等回写（存在即跳过 push）；`push`
  仅在本地能力 `unconfirmed`/`unavailable` 时走 JPush 后台回退，
  `active`/`disabled` 完全不发。文案按 `UserProfile.locale` 经 I18nService
  本地化，缺省回落 `zh-CN`。
- 本地能力缓存缺失一律解析为 `unconfirmed`（首次下发前未知，允许 JPush 回退，
  保证提醒不丢）——不要把它当成 `active` 处理。

## Delivery Endpoints（`reminder-deliveries.controller.ts`）

- `GET /api/v1/user/reminder-deliveries?date=&limit=` — 投递审计读取
  （limit 钳制 1–100，默认 20）。
- `POST /api/v1/user/reminder-deliveries/receipts` — 本地通知展示后回执
  （幂等；墙钟日期/时间按 profile 时区换算截断到分钟）。
- `PUT /api/v1/user/reminder-deliveries/local-capability` — 上报本地调度
  能力 `active|unavailable|disabled`，14 天 TTL 缓存
  （`reminder:local-capability:{userId}`）供 scheduler 门控 push。

## Dependencies

- 引用：`notifications`（`INotificationSender`、`PushDeliveryService`）、
  Prisma、cache-manager、EventEmitter2。
- 被引用：`assistant`（注入 `MedicineRemindersService`，只调 `list` 列提醒，
  供只读工具使用；模块里导出的 `MedicineReminderReaderPort` 由
  `MedicineReminderRepository` 的 `useExisting` 提供，目前无跨模块消费者）、
  `common/queue`（cron-jobs 以 `ReminderSchedulerService.dispatchDueReminders`
  驱动调度）。
- Barrel 导出：`MedicineRemindersService`、`ReminderSchedulerService`、
  `REMINDER_SCHEDULER_CRON`、`MedicineReminderReaderPort`、类型
  `MedicineReminderFact` / `MedicineReminderItemDto`（后者目前仅被 assistant
  的 ports 引用，实际数据来自注入的 `MedicineRemindersService`）。
- 队列名来自 `common/queue/queue-names.ts` 的 `QUEUE_NAMES.reminderDispatch`；
  本模块不自己建队列，只提供 cron 调用的方法。

## Tests

`medicine-reminders.controller.spec.ts`、`reminder-deliveries.controller.spec.ts`、
`services/reminders.service.spec.ts`、`services/scheduler.service.spec.ts`、
`services/delivery-receipts.service.spec.ts`、`services/delivery-moment.spec.ts`、
`services/ownership.service.spec.ts`、`services/mapper.service.spec.ts`、
`repositories/reminder.repository.spec.ts`。
