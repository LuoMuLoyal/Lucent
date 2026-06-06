# Reminder / Notification Contract

Last updated: 2026-06-06

## Boundary

Lucent's notification system is split into two layers with a clear ownership boundary:

**Device-local layer** — owned by Luminous, no backend involvement:

- System notification permission request and status
- Local notification preference toggles (medication reminders, health alerts, activity nudges)
- Local-only scheduled notifications (triggered by on-device timer, not by Lucent)
- Push token / FCM / APNs registration (future, not yet scoped)

**Backend-owned layer** — owned by Lucent, portable across devices:

- Reminder schedule definitions (what, when, how often)
- Notification preference profiles (preferred time window, quiet hours, per-type opt-in)
- Reminder delivery audit log (what was sent, when, to which device)
- Notification content templates (localized)

## Current Reality

| Capability                       | Status                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| Local notification permission    | Luminous `NotificationPermissionService` reads system state                                 |
| Local preference toggles         | Persisted in `SharedPreferences`, three toggles (medication, health, activity)              |
| Backend reminder schedule        | Not implemented — no Prisma model, no API                                                   |
| Backend notification preferences | Not implemented — `UserProfile.extras.preferredReminderHour` exists as OpenAPI example only |
| Push delivery (FCM/APNs)         | Not implemented — no credentials, no infrastructure                                         |
| Reminder delivery log            | Not implemented                                                                             |
| Notification content templates   | Not implemented                                                                             |

## Planned API Surface

### 1. Notification Preferences (User-scoped)

**Model:** `UserNotificationPreference` (new Prisma model, 1:1 with User)

```
UserNotificationPreference {
  userId           String   @id
  medicationEnabled  Boolean  @default(true)
  healthAlertEnabled Boolean  @default(false)
  activityNudgeEnabled Boolean @default(false)
  preferredStartHour  Int?     // 0-23, local device time
  preferredEndHour    Int?     // 0-23, local device time
  quietWeekends       Boolean  @default(false)
  createdAt         DateTime
  updatedAt         DateTime
}
```

**API endpoints:**

| Method  | Path                                  | Description        |
| ------- | ------------------------------------- | ------------------ |
| `GET`   | `/api/v1/me/notification-preferences` | Read preferences   |
| `PATCH` | `/api/v1/me/notification-preferences` | Update preferences |

**Notes:**

- These preferences are backed by Lucent and synced across devices.
- They do NOT control actual notification delivery — only the user's intent.
- Local device prefs in `SharedPreferences` remain the source of truth for on-device behavior until backend delivery exists.
- The `preferredReminderHour` from the OpenAPI `extras` example will be migrated here.

### 2. Reminder Schedule (User-scoped, per-medicine)

**Model:** `UserMedicineReminder` (new Prisma model)

```
UserMedicineReminder {
  id               String   @id
  userId           String
  currentMedicineId String?
  label            String?
  scheduledHour    Int      // 0-23
  scheduledMinute  Int      // 0-59
  daysOfWeek       Json?    // [0,1,2,3,4,5,6] or null = every day
  isActive         Boolean  @default(true)
  createdAt        DateTime
  updatedAt        DateTime
}
```

**API endpoints:**

| Method   | Path                                | Description     |
| -------- | ----------------------------------- | --------------- |
| `GET`    | `/api/v1/me/medicine-reminders`     | List reminders  |
| `POST`   | `/api/v1/me/medicine-reminders`     | Create reminder |
| `PATCH`  | `/api/v1/me/medicine-reminders/:id` | Update reminder |
| `DELETE` | `/api/v1/me/medicine-reminders/:id` | Delete reminder |

### 3. Reminder Delivery Log (read-only, audit)

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

| Method | Path                                          | Description       |
| ------ | --------------------------------------------- | ----------------- |
| `GET`  | `/api/v1/me/reminder-deliveries?date=&limit=` | Read delivery log |

## Explicit Non-Goals

1. **No push notification delivery (FCM/APNs).** This contract defines schedules and preferences only. Actual push delivery requires: Firebase project setup, APNs key/certificate, FCM server key, push token registration flow, and a delivery worker — none of which are in scope.

2. **No real-time / WebSocket notification.** The initial delivery model is polling-based: Luminous reads the schedule and triggers local notifications on-device.

3. **No third-party notification services** (OneSignal, Pusher, etc.).

4. **No email/SMS notification delivery** in this contract.

5. **No calendar integration** (Google Calendar, Apple Health, etc.).

## Migration Path

1. **Phase A (Task 10 — this doc):** Contract design and review.
2. **Phase B (Task 11):** Bridge local notification UX to system permission state; keep prefs device-local.
3. **Phase C (future):** Add `UserNotificationPreference` model + API; Luminous syncs prefs to backend.
4. **Phase D (future):** Add `UserMedicineReminder` model + CRUD API; Luminous creates/reads reminder schedules.
5. **Phase E (future):** Luminous uses local schedule + on-device notification triggers based on backend schedules.
6. **Phase F (future):** Push delivery infrastructure (FCM/APNs) + delivery worker + delivery log.

At every phase, Luminous remains the notification display layer; Lucent owns the schedule data.
