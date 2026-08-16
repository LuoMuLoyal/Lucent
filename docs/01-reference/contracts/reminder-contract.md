# Reminder / Notification Contract

Last updated: 2026-08-16

## Boundary

Lucent's notification system is split into two layers with a clear ownership boundary:

**Device-local layer** — owned by Luminous, no backend involvement:

- System notification permission request and status
- Local notification preference toggles (medication reminders, health alerts, weekly summaries)
- Local-only scheduled notifications (triggered by on-device timer, not by Lucent)
- Push token / FCM / APNs registration (future, not yet scoped)

**Backend-owned layer** — owned by Lucent, portable across devices:

- Reminder schedule definitions (what, when, how often)
- Notification preference profiles (preferred time window, quiet hours, per-type opt-in)
- Reminder delivery audit log (what was sent, when, to which device)
- Notification content templates (localized)

## Current Reality

- Local notification permission
  - Status: Luminous `NotificationPermissionService` reads system state
- Local preference toggles
  - Status: Persisted in `SharedPreferences`, three toggles (medication reminders, health alerts,
    weekly summary)
- Backend reminder schedule
  - Status: Implemented schedule-only medicine reminders with optional start/end date window:
    Prisma model + `/api/v1/user/medicine-reminders` CRUD
- Dose-log to health-event association
  - Status: Dose logs may explicitly carry an active `healthEventId`; reminder schedules remain
    independent, and no dose log is automatically assigned to the user's latest event.
- Dose-log recomputation trigger
  - Status: A successful dose-log write emits a date-scoped `dose-log.changed` event with the
    persisted log id. Suggestion materialization consumes it; Today Analysis can enqueue a
    versioned refresh from the same event, subject to its per-date generation cap.
- Backend notification preferences
  - Status: Not implemented — `UserProfile.extras.preferredReminderHour` exists as OpenAPI example
    only
- Push delivery (JPush)
  - Status: `PushDeliveryService` sends the user ID as a JPush alias through the JPush REST API. Missing credentials skip delivery and the send result resolves `{ sent: false }`. Provider failures are logged and do not block the in-app notification flow. Push is a **background fallback only**: the scheduler sends it when the user's local capability is `unconfirmed` or `unavailable`, and never when it is `active` or `disabled`.
- Reminder delivery log
  - Status: `ReminderSchedulerService` (BullMQ `@Cron('* * * * *')` equivalent) writes `UserReminderDelivery` rows every minute for due reminders — matching `scheduledHour:Minute` in user timezone + `daysOfWeek` + date window. **Three channels** each get their own audit row per reminder event (ADR-0013): `in_app` always (in-app notification center record), `local` written idempotently by the client receipt endpoint, `push` written by the scheduler with the actual send result (`delivered`/`failed`). Deduplicated per channel by the `(userId, reminderId, scheduledFor, channel)` unique constraint (`findFirst` fast path + `createMany({ skipDuplicates: true })` atomic fallback, at-least-once — see [ADR-0011](../adr/0011-reminder-delivery-at-least-once.md) and [ADR-0013](../adr/0013-reminder-delivery-three-channel.md)). Uses cursor-based pagination (batch size 500) to avoid OOM on large datasets.
- Medicine risk check cross-module read
  - Status: `MedicineRiskCheckService` is exported from `MedicinesModule` (persisted static/LLM
    risk records behind a 30-minute cache). The reports event review next-step section reads only
    the static `redFlags` (`severeAllergy`/`informationGap` reviewed rules) as structured
    data and degrades to an empty list when the read fails.
- Notification content templates
  - Status: Implemented — the scheduler localizes reminder title/content per `UserProfile.locale`
    via `I18nService` (keys `medicine-reminders.reminder_fallback_label` and
    `medicine-reminders.reminder_due_content`, `{label}` interpolation). Missing locale falls
    back to `zh-CN`; in-app and JPush share the same translated copy.

## Planned API Surface

### 1. Notification Preferences (User-scoped)

**Model:** `UserNotificationPreference` (new Prisma model, 1:1 with User)

```
UserNotificationPreference {
  userId           String   @id
  medicationEnabled  Boolean  @default(true)
  healthAlertEnabled Boolean  @default(false)
  weeklySummaryEnabled Boolean @default(false)
  preferredStartHour  Int?     // 0-23, local device time
  preferredEndHour    Int?     // 0-23, local device time
  quietWeekends       Boolean  @default(false)
  createdAt         DateTime
  updatedAt         DateTime
}
```

**API endpoints:**

- `GET`
  - Path: `/api/v1/user/notification-preferences`
  - Description: Read preferences
- `PATCH`
  - Path: `/api/v1/user/notification-preferences`
  - Description: Update preferences

**Notes:**

- These preferences are backed by Lucent and synced across devices.
- They do NOT control actual notification delivery — only the user's intent.
- Local device prefs in `SharedPreferences` remain the source of truth for on-device behavior until
  backend delivery exists.
- The `preferredReminderHour` from the OpenAPI `extras` example will be migrated here.

### 2. Reminder Schedule (User-scoped, per-medicine)

**Status:** implemented as a schedule-only contract. It stores reminder timing and user ownership;
it does not store inventory, stock, refill, push delivery, or local-notification runtime state.

**Model:** `UserMedicineReminder`

```
UserMedicineReminder {
  id               String   @id
  userId           String
  currentMedicineId String?
  label            String?
  scheduledHour    Int      // 0-23
  scheduledMinute  Int      // 0-59
  daysOfWeek       Json?    // [0,1,2,3,4,5,6] or null = every day
  startDate        DateTime?
  endDate          DateTime?
  isActive         Boolean  @default(true)
  note             String?
  deletedAt        DateTime?
  createdAt        DateTime
  updatedAt        DateTime
}
```

**API endpoints:**

- `GET`
  - Path: `/api/v1/user/medicine-reminders`
  - Description: List reminders
- `POST`
  - Path: `/api/v1/user/medicine-reminders`
  - Description: Create reminder
- `PATCH`
  - Path: `/api/v1/user/medicine-reminders/:id`
  - Description: Update reminder
- `DELETE`
  - Path: `/api/v1/user/medicine-reminders/:id`
  - Description: Delete reminder
- `PUT`
  - Path: `/api/v1/user/medicine-reminders/group`
  - Description: Upsert a whole reminder group for a medicine in a single transaction.
    Body: `{ currentMedicineId, label?, daysOfWeek?, startDate?, endDate?, isActive?, note?,
slots: [{ id?, scheduledHour, scheduledMinute }] }` (`slots` requires at least one entry).

**Notes:**

- `daysOfWeek = null` means every day; otherwise weekday numbers are `0-6` with Sunday as `0`.
- Delete is a soft delete: `deletedAt` is set and `isActive` becomes `false`.
- `PUT .../group` treats `slots` as the source of truth and replaces the whole group for
  `currentMedicineId`: a slot with an `id` updates the existing row (the id must belong to the user,
  reference the same `currentMedicineId`, and not be soft-deleted, otherwise `404`), a slot without
  an `id` is created, and every existing non-deleted group row whose id is absent from the request is
  implicitly soft-deleted (`deletedAt=now()`, `isActive=false`). The whole operation runs in one
  transaction and emits a single `reminder.changed` event after commit.
- When a group-level optional field is omitted, `label`, `daysOfWeek`, `startDate`, `endDate`,
  and `note` are reset to `null` (cleared); an omitted `isActive` defaults to `true`. `slots`
  must contain at least one entry.
- Luminous reads active reminders for Medicine and Today next-dose display. It filters reminders by
  `startDate` / `endDate` when evaluating a target date.
- Medication inventory/refill tracking is intentionally out of scope.

#### Suggestion slot evaluation

For proactive Today suggestions, a reminder is evaluated as an independent slot,
not as a medicine-day aggregate:

- `scheduledFor` is the user's local calendar date and `scheduledTime` is combined
  with the user's profile IANA timezone before comparing with the current instant.
  Missing or invalid profile timezone falls back to `Asia/Shanghai`; invalid calendar
  dates and DST gaps do not create a synthetic overdue instant.
- Dose-log reader facts include `reminderId`. Logs with a reminder ID match that slot
  exactly. Legacy logs without it may match only when the medicine plus scheduled time
  identifies one reminder; ambiguous same-time reminders remain unconfirmed.
- Persisted `planned` is mapped to `unconfirmed` at the suggestion/report contract
  boundary. Slot states exposed to consumers are `taken`, `skipped`, `unconfirmed`, and
  `overdueUnconfirmed`; only `overdueUnconfirmed` is eligible for the missed-dose
  suggestion rule.
- Reminder slots use `reminderId + scheduledFor + scheduledTime` identity. Logs without a
  reminder are independent temporary observations and do not create adherence denominator
  slots; a legacy log may match a single unambiguous reminder by medicine and scheduled time.
- Dashboard adherence exposes `observedMetric`: `taken` is the numerator, `skipped` and
  `overdueUnconfirmed` remain separate counts, and an unplanned-only window is `unknown`
  rather than `0%`.

### 3. Reminder Delivery Log (read + write, audit)

**Status:** implemented. `ReminderSchedulerService` (BullMQ `@Cron('* * * * *')` equivalent) writes delivery rows every minute for due reminders. **Three channels** per reminder event, each with its own audit row (ADR-0013):

- `in_app` — always written by the scheduler as the notification-center record (`status='delivered'`), best-effort JPush and local display are decoupled from it.
- `local` — written idempotently by the client via `POST .../receipts` after the local notification is actually shown (`status='delivered'`). If a local row exists for the event, the scheduler skips push entirely.
- `push` — written by the scheduler only when the user's local capability is `unconfirmed`/`unavailable`; result is `delivered` or `failed` (with `errorMessage`). `active`/`disabled` capability means no push at all.

Local capability is reported by the client via `PUT .../local-capability` and cached for 14 days. Overlap dedup is DB-level per channel: `(userId, reminderId, scheduledFor, channel)` unique constraint + `findFirst` fast path + `createMany({ skipDuplicates: true })` (at-least-once, see [ADR-0011](../adr/0011-reminder-delivery-at-least-once.md) and [ADR-0013](../adr/0013-reminder-delivery-three-channel.md)); the previous in-process overlap guard has been removed. Uses cursor-based pagination (batch size 500) to avoid OOM.

**Model:** `UserReminderDelivery` (new Prisma model)

```
UserReminderDelivery {
  id           String    @id
  userId       String
  reminderId   String?
  deviceId     String?
  channel      String    // "in_app" | "local" | "push"
  status       String    // "scheduled" | "delivered" | "failed"
  scheduledFor DateTime
  deliveredAt  DateTime?
  errorMessage String?
  createdAt    DateTime
  // @@unique([userId, reminderId, scheduledFor, channel])
}
```

**API endpoints:**

- `GET`
  - Path: `/api/v1/user/reminder-deliveries?date=&limit=`
  - Description: Read delivery log
- `POST`
  - Path: `/api/v1/user/reminder-deliveries/receipts`
  - Description: Record a local notification delivery receipt (idempotent).
    Body: `{ reminderId, scheduledDate: 'YYYY-MM-DD', scheduledTime: 'HH:mm' }`.
    `scheduledFor` is derived from wall-clock date/time in the user's profile
    timezone (default `Asia/Shanghai`), truncated to the minute. Returns the
    persisted `channel='local'`, `status='delivered'` row.
- `PUT`
  - Path: `/api/v1/user/reminder-deliveries/local-capability`
  - Description: Report client local scheduling capability.
    Body: `{ state: 'active' | 'unavailable' | 'disabled' }`. Cached for
    14 days and used by the scheduler to gate the JPush fallback.

## Explicit Non-Goals

1. **No real-time / WebSocket notification.** The initial delivery model is polling-based: Luminous
   reads the schedule and triggers local notifications on-device.

2. **No third-party notification services** (OneSignal, Pusher, etc.).

3. **No email/SMS notification delivery** in this contract.

4. **No calendar integration** (Google Calendar, Apple Health, etc.).

## Migration Path

1. **Phase A (Task 10 — this doc):** Contract design and review.
2. **Phase B (Task 11):** Bridge local notification UX to system permission state; keep prefs
   device-local.
3. **Phase C (future):** Add `UserNotificationPreference` model + API; Luminous syncs prefs to
   backend.
4. **Phase D (done on 2026-06-08):** Add `UserMedicineReminder` model + CRUD API; Luminous reads
   reminder schedules.
5. **Phase E (done on 2026-06-10):** Luminous creates/edits reminder schedules, supports optional
   start/end dates, stores local sound preference, shows SMS as unavailable, and displays the
   backend read-only delivery log.
6. **Phase F (done on 2026-07-20):** `ReminderSchedulerService` implemented — `@Cron` every
   minute scans due reminders by user timezone, writes `UserReminderDelivery` rows, and sends
   in-app notifications via `NotificationsService`. `PushDeliveryService` integrated as
   best-effort JPush alias channel. Device registration is handled by the client JPush
   SDK and no longer has a backend `user-devices` API.
   `AuditLogModule` added for sensitive operation audit trail.
7. **Phase G (done on 2026-07-21):** Security and reliability hardening — scheduler
   cursor-based pagination (OOM prevention), scheduler overlap guard, escalation atomic
   conditional update (race condition fix), throttler Redis connection failure graceful
   degradation, data retention direct `deleteMany` (no ID pre-load), and
   `UserDevicePlatform` retained for `UserSession.platform` compatibility.
8. **Phase H (done on 2026-08-16):** Three-channel delivery audit (ADR-0013) — unique
   constraint extended with `channel`; scheduler writes `in_app` always, skips push when a
   `local` row exists, and writes `push` rows (`delivered`/`failed`) gated by the local
   capability cache; `PushDeliveryService.sendToUser` returns a `PushSendResult`;
   `POST .../receipts` (idempotent local receipt) and `PUT .../local-capability` added.

At every phase, Luminous remains the notification display layer; Lucent owns the schedule data.
Reminder and dose-log repository queries migrated to `prisma.nonDeleted` API.
