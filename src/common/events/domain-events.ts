/**
 * Domain event names used for cross-module cache invalidation.
 *
 * Each event carries a minimal payload so subscribers can act without
 * re-querying the source module.  This replaces direct service-to-service
 * imports (e.g. daily-records importing today-suggestion's cache service)
 * with a publish/subscribe model that respects the dependency direction.
 *
 * Convention: `<domain>.<action>` — e.g. `daily-record.changed`.
 */

// ─── Event names ───

/** Emitted when a daily record is created, updated, or soft-deleted. */
export const DAILY_RECORD_CHANGED = 'daily-record.changed';

/** Emitted when a dose log is created, marked, updated, or soft-deleted. */
export const DOSE_LOG_CHANGED = 'dose-log.changed';

/** Emitted when a medicine reminder is created, updated, or soft-deleted. */
export const REMINDER_CHANGED = 'reminder.changed';

/** Emitted when the user health context (profile, allergy, condition, medicine) changes. */
export const HEALTH_CONTEXT_CHANGED = 'health-context.changed';

/** Emitted when user settings are updated. */
export const SETTINGS_CHANGED = 'settings.changed';

/** Emitted when a health event is created, ended, or checked in. */
export const HEALTH_EVENT_CHANGED = 'health-event.changed';

// ─── Event payloads ───

export interface DailyRecordChangedPayload {
  userId: string;
  /** ISO date string (YYYY-MM-DD) of the record's occurredAt date. */
  date: string;
}

export interface DoseLogChangedPayload {
  userId: string;
  /** ISO date string (YYYY-MM-DD) of the dose log's scheduledFor date. */
  date: string;
}

export interface ReminderChangedPayload {
  userId: string;
}

export interface HealthContextChangedPayload {
  userId: string;
}

export interface SettingsChangedPayload {
  userId: string;
}

export type HealthEventChange = 'create' | 'end' | 'check-in';

export interface HealthEventChangedPayload {
  userId: string;
  eventId: string;
  /** ISO date string (YYYY-MM-DD) in the user's timezone. */
  date: string;
  change: HealthEventChange;
}

/** Union of all domain event names for type-safe emission. */
export type DomainEventName =
  | typeof DAILY_RECORD_CHANGED
  | typeof DOSE_LOG_CHANGED
  | typeof REMINDER_CHANGED
  | typeof HEALTH_CONTEXT_CHANGED
  | typeof SETTINGS_CHANGED
  | typeof HEALTH_EVENT_CHANGED;
