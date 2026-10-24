/**
 * Domain event names and payloads (ADR-0025).
 *
 * A domain event is a **fact**: "this happened". Producers append it to the
 * `domain_events` outbox inside their own write transaction and never wait for
 * a consumer. `src/common/events/subscriptions.ts` decides which queues get a
 * job for it; a consumer that was not in the table simply never sees it.
 *
 * Convention: `<domain>.<action>` — kebab-case domain, kebab-case past/change
 * action, e.g. `daily-record.changed`, `risk-assessment.completed`.
 */

// ─── Event names ───

import type {
  DailyRecordKind,
  HealthEventKind,
} from '#generated/prisma/client.js';

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

/** Emitted when the server advances a Today Suggestion materialization version. */
export const TODAY_SUGGESTION_MATERIALIZATION_CHANGED =
  'today-suggestion.materialization.changed';

/** Emitted when a risk assessment finishes and its result is persisted. */
export const RISK_ASSESSMENT_COMPLETED = 'risk-assessment.completed';

// ─── Event payloads ───

export interface DailyRecordChangedPayload {
  userId: string;
  /** ISO date string (YYYY-MM-DD) of the record's occurredAt date. */
  date: string;
  /** Persisted kind; consumers must not infer semantics from title text. */
  kind?: DailyRecordKind;
  recordId?: string;
  triggerKey?: string;
}

export interface DoseLogChangedPayload {
  userId: string;
  /** ISO date string (YYYY-MM-DD) of the dose log's scheduledFor date. */
  date: string;
  doseLogId?: string;
  triggerKey?: string;
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
  /** Persisted event kind, required by Today Analysis for check-ins. */
  kind?: HealthEventKind;
}

export interface TodaySuggestionMaterializationChangedPayload {
  userId: string;
  /** ISO date string (YYYY-MM-DD) of the suggestion materialization. */
  date: string;
  sourceVersion: number;
  analysisEligible: boolean;
  triggerKey?: string;
}

/** Agreed severity ladder of a persisted risk assessment, least severe first. */
export type RiskSeverity = 'none' | 'low' | 'moderate' | 'high';

export interface RiskAssessmentCompletedPayload {
  userId: string;
  /** Medicines the assessment was computed over. */
  medicineIds: string[];
  /** Highest severity among the findings of this assessment. */
  severity: RiskSeverity;
  /** Number of findings above the informational level. */
  findingCount: number;
  /** The persisted assessment aggregate. */
  assessmentId: string;
}

/**
 * Envelope every fanned-out event carries on top of its own payload: the
 * outbox row id, the event name, its payload version and when it happened.
 * Consumers use `eventId` for idempotency (ADR-0025).
 */
export interface DomainEventEnvelope {
  eventId: string;
  eventType: string;
  version: number;
  /** ISO-8601 timestamp of the aggregate change. */
  occurredAt: string;
}

/** Payload as delivered by the outbox: the event's own fields plus the envelope. */
export type DeliveredEventPayload = Record<string, unknown> &
  DomainEventEnvelope;

/** Union of all domain event names for type-safe emission. */
export type DomainEventName =
  | typeof DAILY_RECORD_CHANGED
  | typeof DOSE_LOG_CHANGED
  | typeof REMINDER_CHANGED
  | typeof HEALTH_CONTEXT_CHANGED
  | typeof SETTINGS_CHANGED
  | typeof HEALTH_EVENT_CHANGED
  | typeof TODAY_SUGGESTION_MATERIALIZATION_CHANGED
  | typeof RISK_ASSESSMENT_COMPLETED;
