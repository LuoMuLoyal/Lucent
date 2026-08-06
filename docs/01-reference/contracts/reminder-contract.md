# Reminder / Notification Contract

Last updated: 2026-07-21

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
- Backend notification preferences
  - Status: Not implemented — `UserProfile.extras.preferredReminderHour` exists as OpenAPI example
    only
- Push delivery (JPush)
  - Status: `PushDeliveryService` sends the user ID as a JPush alias through the JPush REST API. Missing credentials skip delivery; provider failures are logged and do not block the in-app notification flow.
- Reminder delivery log
  - Status: `ReminderSchedulerService` (`@Cron('* * * * *')`) now writes `UserReminderDelivery` rows every minute for due reminders — matching `scheduledHour:Minute` in user timezone + `daysOfWeek` + date window. Channel=`in_app`, status=`delivered`. Deduplicated by the `(userId, reminderId, scheduledFor)` unique constraint (`findFirst` fast path + `createMany({ skipDuplicates: true })` atomic fallback, at-least-once — see [ADR-0011](../adr/0011-reminder-delivery-at-least-once.md)). Uses cursor-based pagination (batch size 500) to avoid OOM on large datasets.
- Notification content templates
  - Status: Not implemented

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

**Notes:**

- `daysOfWeek = null` means every day; otherwise weekday numbers are `0-6` with Sunday as `0`.
- Delete is a soft delete: `deletedAt` is set and `isActive` becomes `false`.
- Luminous reads active reminders for Medicine and Today next-dose display. It filters reminders by
  `startDate` / `endDate` when evaluating a target date.
- Medication inventory/refill tracking is intentionally out of scope.

### 3. Reminder Delivery Log (read-only, audit)

**Status:** implemented. `ReminderSchedulerService` (`@Cron('* * * * *')`) writes delivery rows every minute for due reminders, creating `UserReminderDelivery` records with `channel='in_app'` and `status='delivered'`. Push delivery via `PushDeliveryService` is integrated as a best-effort second channel through the JPush alias provider; missing credentials skip the network request and provider failures do not block in-app delivery. Uses cursor-based pagination (batch size 500) to avoid OOM. Overlap dedup is DB-level: `(userId, reminderId, scheduledFor)` unique constraint + `findFirst` fast path + `createMany({ skipDuplicates: true })` (at-least-once, see [ADR-0011](../adr/0011-reminder-delivery-at-least-once.md)); the previous in-process overlap guard has been removed.

**Model:** `UserReminderDelivery` (new Prisma model)

```
UserReminderDelivery {
  id           String    @id
  userId       String
  reminderId   String?
  deviceId     String?
  channel      String    // "local" | "push" | "email"
  status       String    // "scheduled" | "delivered" | "failed"
  scheduledFor DateTime
  deliveredAt  DateTime?
  errorMessage String?
  createdAt    DateTime
}
```

**API endpoint:**

- `GET`
  - Path: `/api/v1/user/reminder-deliveries?date=&limit=`
  - Description: Read delivery log

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

At every phase, Luminous remains the notification display layer; Lucent owns the schedule data.
Reminder and dose-log repository queries migrated to `prisma.nonDeleted` API.
