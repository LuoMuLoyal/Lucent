---
status: active
owner: backend
quadrant: reference
updated: 2026-08-30
---

# Domain Event Catalog

Cross-module domain events published via NestJS `EventEmitter2`. All event names,
payload types, and the typed union are defined in `src/common/events/domain-events.ts`.

## Conventions

- **Naming**: `<domain>.<action>` — e.g. `daily-record.changed`.
- **Transport**: synchronous `emitAsync` within the same process (EventEmitter2).
  No serialization overhead, no network hop. Failures are caught and logged by
  the publisher; subscribers must not throw (cache invalidation is best-effort).
- **Post-write trigger**: events are emitted **only after** the source write
  succeeds (after the DB transaction commits). Subscribers treat events as
  invalidation/recompute triggers, never as source-of-truth reads.
- **Minimal payload**: payloads carry only the `userId`, the affected `date`
  (ISO `YYYY-MM-DD`), and optional IDs/kind. Subscribers re-query the owning
  module for full data if needed.
- **No mutation**: subscribers must not mutate the source domain state. The
  only allowed subscriber actions are cache invalidation, recompute enqueue,
  and risk-check scheduling.

## Event: `daily-record.changed`

| Field                 | Value                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Constant**          | `DAILY_RECORD_CHANGED`                                                                                                                                                   |
| **Publisher module**  | `daily-records`                                                                                                                                                          |
| **Publisher file**    | `services/records.service.ts`                                                                                                                                            |
| **Trigger condition** | A daily record is created, updated, or soft-deleted. For updates that move a record across calendar days, events are emitted for **both** the previous and the new date. |

**Payload**: `DailyRecordChangedPayload`

| Field        | Type              | Required | Description                                                               |
| ------------ | ----------------- | -------- | ------------------------------------------------------------------------- |
| `userId`     | `string`          | Yes      | Target user                                                               |
| `date`       | `string`          | Yes      | ISO date (`YYYY-MM-DD`) of the record's `occurredAt`                      |
| `kind`       | `DailyRecordKind` | No       | Persisted record kind (`symptom`, `water`, `meal`, `sleep`, `mood`, etc.) |
| `recordId`   | `string`          | No       | The record's database ID                                                  |
| `triggerKey` | `string`          | No       | Dedup key for materialization fencing                                     |

**Subscribers**:

| Subscriber                                                     | Module           | File                                                       | Behavior                                                                                                                                                    |
| -------------------------------------------------------------- | ---------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RecomputeTriggerListener.handleDailyRecordChanged`            | today-suggestion | `services/recompute/trigger.listener.ts`                   | Marks materialization pending (`daily_record_changed`) and enqueues recompute                                                                               |
| `SuggestionCacheInvalidationListener.handleDailyRecordChanged` | today-suggestion | `services/cache/suggestion-cache-invalidation.listener.ts` | Invalidates suggestion signal cache for `(userId, date)`                                                                                                    |
| `TodayAnalysisTriggerListener.handleDailyRecordChanged`        | today-analysis   | `services/recompute/trigger.listener.ts`                   | Invalidates analysis context, triggers analysis if kind is `symptom` (always) or `water`/`meal`/`sleep`/`mood` (conditional on `shouldTriggerForDimension`) |
| `ReportsCacheInvalidationListener.handleDailyRecordChanged`    | reports          | `dashboard/cache-invalidation.listener.ts`                 | Invalidates dashboard cache for the user                                                                                                                    |

## Event: `dose-log.changed`

| Field                 | Value                                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| **Constant**          | `DOSE_LOG_CHANGED`                                                       |
| **Publisher module**  | `medicine-dose-logs`                                                     |
| **Publisher file**    | `services/dose-logs.service.ts`                                          |
| **Trigger condition** | A dose log is created, marked (taken/skipped), updated, or soft-deleted. |

**Payload**: `DoseLogChangedPayload`

| Field        | Type     | Required | Description                               |
| ------------ | -------- | -------- | ----------------------------------------- |
| `userId`     | `string` | Yes      | Target user                               |
| `date`       | `string` | Yes      | ISO date of the dose log's `scheduledFor` |
| `doseLogId`  | `string` | No       | The dose log's database ID                |
| `triggerKey` | `string` | No       | Dedup key for materialization fencing     |

**Subscribers**:

| Subscriber                                                 | Module           | File                                                       | Behavior                                                                  |
| ---------------------------------------------------------- | ---------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `RecomputeTriggerListener.handleDoseLogChanged`            | today-suggestion | `services/recompute/trigger.listener.ts`                   | Marks materialization pending (`dose_log_changed`) and enqueues recompute |
| `SuggestionCacheInvalidationListener.handleDoseLogChanged` | today-suggestion | `services/cache/suggestion-cache-invalidation.listener.ts` | Invalidates suggestion signal cache for `(userId, date)`                  |
| `TodayAnalysisTriggerListener.handleDoseLogChanged`        | today-analysis   | `services/recompute/trigger.listener.ts`                   | Invalidates analysis context, triggers analysis (`dose_log_changed`)      |
| `ReportsCacheInvalidationListener.handleDoseLogChanged`    | reports          | `dashboard/cache-invalidation.listener.ts`                 | Invalidates dashboard cache for the user                                  |

## Event: `reminder.changed`

| Field                 | Value                                                                                |
| --------------------- | ------------------------------------------------------------------------------------ |
| **Constant**          | `REMINDER_CHANGED`                                                                   |
| **Publisher module**  | `medicine-reminders`                                                                 |
| **Publisher file**    | `services/reminders.service.ts`                                                      |
| **Trigger condition** | A medicine reminder is created, updated, or soft-deleted (after transaction commit). |

**Payload**: `ReminderChangedPayload`

| Field    | Type     | Required | Description |
| -------- | -------- | -------- | ----------- |
| `userId` | `string` | Yes      | Target user |

> Note: No `date` field — reminder changes are not date-scoped. Subscribers
> resolve the user's local today via timezone lookup.

**Subscribers**:

| Subscriber                                                  | Module           | File                                                       | Behavior                                                                                      |
| ----------------------------------------------------------- | ---------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `RecomputeTriggerListener.handleReminderChanged`            | today-suggestion | `services/recompute/trigger.listener.ts`                   | Marks materialization pending (`reminder_changed`), enqueues recompute for user's local today |
| `SuggestionCacheInvalidationListener.handleReminderChanged` | today-suggestion | `services/cache/suggestion-cache-invalidation.listener.ts` | Invalidates signal cache + baseline cache for user's local today                              |
| `MedicineRiskCheckListener.handleReminderChanged`           | medicines        | `services/risk/risk-check.listener.ts`                     | Marks risk check stale, schedules debounced static check (5s debounce)                        |
| `ReportsCacheInvalidationListener.handleReminderChanged`    | reports          | `dashboard/cache-invalidation.listener.ts`                 | Invalidates dashboard cache for the user                                                      |

## Event: `health-context.changed`

| Field                 | Value                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| **Constant**          | `HEALTH_CONTEXT_CHANGED`                                                                                 |
| **Publisher module**  | `user-health-context`                                                                                    |
| **Publisher file**    | `services/health-context.service.ts`                                                                     |
| **Trigger condition** | User health context changes — profile updates, allergy/condition changes, current medicine list changes. |

**Payload**: `HealthContextChangedPayload`

| Field    | Type     | Required | Description |
| -------- | -------- | -------- | ----------- |
| `userId` | `string` | Yes      | Target user |

**Subscribers**:

| Subscriber                                                       | Module           | File                                                       | Behavior                                                                                            |
| ---------------------------------------------------------------- | ---------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `RecomputeTriggerListener.handleHealthContextChanged`            | today-suggestion | `services/recompute/trigger.listener.ts`                   | Marks materialization pending (`health_context_changed`), enqueues recompute for user's local today |
| `SuggestionCacheInvalidationListener.handleHealthContextChanged` | today-suggestion | `services/cache/suggestion-cache-invalidation.listener.ts` | Invalidates signal cache + baseline cache for user's local today                                    |
| `MedicineRiskCheckListener.handleHealthContextChanged`           | medicines        | `services/risk/risk-check.listener.ts`                     | Marks risk check stale, schedules debounced static check (5s debounce)                              |
| `ReportsCacheInvalidationListener.handleHealthContextChanged`    | reports          | `dashboard/cache-invalidation.listener.ts`                 | Invalidates dashboard cache for the user                                                            |

## Event: `settings.changed`

| Field                 | Value                                                                           |
| --------------------- | ------------------------------------------------------------------------------- |
| **Constant**          | `SETTINGS_CHANGED`                                                              |
| **Publisher module**  | `user-settings`                                                                 |
| **Publisher file**    | `services/user-settings.service.ts`                                             |
| **Trigger condition** | User settings are updated (e.g. water target count, assistant context toggles). |

**Payload**: `SettingsChangedPayload`

| Field    | Type     | Required | Description |
| -------- | -------- | -------- | ----------- |
| `userId` | `string` | Yes      | Target user |

**Subscribers**:

| Subscriber                                                  | Module           | File                                                       | Behavior                                                                                      |
| ----------------------------------------------------------- | ---------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `RecomputeTriggerListener.handleSettingsChanged`            | today-suggestion | `services/recompute/trigger.listener.ts`                   | Marks materialization pending (`settings_changed`), enqueues recompute for user's local today |
| `SuggestionCacheInvalidationListener.handleSettingsChanged` | today-suggestion | `services/cache/suggestion-cache-invalidation.listener.ts` | Invalidates signal cache + baseline cache for user's local today                              |
| `ReportsCacheInvalidationListener.handleSettingsChanged`    | reports          | `dashboard/cache-invalidation.listener.ts`                 | Invalidates dashboard cache for the user                                                      |

## Event: `health-event.changed`

| Field                 | Value                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Constant**          | `HEALTH_EVENT_CHANGED`                                                                                         |
| **Publisher module**  | `health-events`                                                                                                |
| **Publisher files**   | `services/events.service.ts` (create, end), `services/check-ins.service.ts` (check-in)                         |
| **Trigger condition** | A health event is created, ended, or daily-checked-in. Emitted only after a successful repository transaction. |

**Payload**: `HealthEventChangedPayload`

| Field     | Type                | Required | Description                                    |
| --------- | ------------------- | -------- | ---------------------------------------------- |
| `userId`  | `string`            | Yes      | Target user                                    |
| `eventId` | `string`            | Yes      | The health event's database ID                 |
| `date`    | `string`            | Yes      | ISO date in the user's timezone                |
| `change`  | `HealthEventChange` | Yes      | One of `create`, `end`, `check-in`             |
| `kind`    | `HealthEventKind`   | No       | Persisted event kind (e.g. `symptom`, `other`) |

> Constraint: payload never carries health-content payloads. Subscribers must
> treat this as a post-write trigger and must not mutate the source event state.

**Subscribers**:

| Subscriber                                                     | Module           | File                                                       | Behavior                                                                   | Filter                                     |
| -------------------------------------------------------------- | ---------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| `RecomputeTriggerListener.handleHealthEventChanged`            | today-suggestion | `services/recompute/trigger.listener.ts`                   | Marks materialization pending (`health_event_changed`), enqueues recompute | Skips `check-in` with `kind === 'other'`   |
| `SuggestionCacheInvalidationListener.handleHealthEventChanged` | today-suggestion | `services/cache/suggestion-cache-invalidation.listener.ts` | Invalidates signal cache for `(userId, date)`                              | —                                          |
| `TodayAnalysisTriggerListener.handleHealthEventChanged`        | today-analysis   | `services/recompute/trigger.listener.ts`                   | Invalidates analysis context, triggers analysis                            | Skips `check-in` when `kind !== 'symptom'` |
| `ReportsCacheInvalidationListener.handleHealthEventChanged`    | reports          | `dashboard/cache-invalidation.listener.ts`                 | Invalidates dashboard cache for the user                                   | —                                          |

## Event: `today-suggestion.materialization.changed`

| Field                 | Value                                                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Constant**          | `TODAY_SUGGESTION_MATERIALIZATION_CHANGED`                                                                                                                                                                      |
| **Publisher module**  | `today-suggestion`                                                                                                                                                                                              |
| **Publisher file**    | `services/materialization/store.service.ts`                                                                                                                                                                     |
| **Trigger condition** | The suggestion materialization store advances a `sourceVersion` for a user+date **and** the reason codes include `dose_log_changed` or `health_event_changed` (i.e. the change is eligible for today-analysis). |

**Payload**: `TodaySuggestionMaterializationChangedPayload`

| Field              | Type      | Required | Description                                                  |
| ------------------ | --------- | -------- | ------------------------------------------------------------ |
| `userId`           | `string`  | Yes      | Target user                                                  |
| `date`             | `string`  | Yes      | ISO date of the materialization                              |
| `sourceVersion`    | `number`  | Yes      | The new source version number                                |
| `analysisEligible` | `boolean` | Yes      | Whether the change is eligible for today-analysis triggering |
| `triggerKey`       | `string`  | No       | Dedup key for materialization fencing                        |

> This is an internal event — the only subscriber is today-analysis, which
> uses it to chain suggestion materialization → analysis triggering.

**Subscribers**:

| Subscriber                                                            | Module         | File                                     | Behavior                                                                                                      |
| --------------------------------------------------------------------- | -------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `TodayAnalysisTriggerListener.handleSuggestionMaterializationChanged` | today-analysis | `services/recompute/trigger.listener.ts` | If `analysisEligible`, triggers today-analysis (`suggestion_materialization_changed`) with the source version |

## Summary Table

| Event                                      | Publishers          | Subscriber count | Pattern                                     |
| ------------------------------------------ | ------------------- | ---------------- | ------------------------------------------- |
| `daily-record.changed`                     | daily-records       | 4                | Cache invalidation + recompute + analysis   |
| `dose-log.changed`                         | medicine-dose-logs  | 4                | Cache invalidation + recompute + analysis   |
| `reminder.changed`                         | medicine-reminders  | 4                | Cache invalidation + recompute + risk check |
| `health-context.changed`                   | user-health-context | 4                | Cache invalidation + recompute + risk check |
| `settings.changed`                         | user-settings       | 3                | Cache invalidation + recompute              |
| `health-event.changed`                     | health-events       | 4                | Cache invalidation + recompute + analysis   |
| `today-suggestion.materialization.changed` | today-suggestion    | 1                | Analysis trigger (internal)                 |

All 7 events follow the same pattern: **data change → invalidate caches + enqueue recompute**.
No subscriber mutates source domain state. The event layer is the correct seam for
future migration to BullMQ async events if any subscriber needs to move to a worker process.
