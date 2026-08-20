---
status: active
owner: backend
quadrant: reference
updated: 2026-08-20
---

# Notification Preferences

Lucent stores user-scoped notification preferences in
`UserNotificationPreference` and exposes them through
`GET/PATCH /api/v1/user/notification-preferences`.

- The preference row stores health, weekly insight, water, and sleep reminder
  intent for cross-device consumers.
- Today health escalation reads `healthAlertsEnabled`; the water shortfall rule
  reads `waterRemindersEnabled` independently.
- Weekly longitudinal insight generation reads `weeklyInsightEnabled`; it uses
  the previous complete local week and sends an idempotent in-app notification.
- Sleep reminder enablement and bedtime/wake-time minutes are synchronized to
  Luminous; only Luminous schedules the bedtime notification.
- Missing preference rows return the documented defaults with `configured: false`.
