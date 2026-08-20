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
- Missing preference rows return the documented defaults with `configured: false`.
