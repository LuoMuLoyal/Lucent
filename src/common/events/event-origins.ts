/**
 * Where each domain event comes from (ADR-0025).
 *
 * `domain_events` requires a `context`, `aggregate_type` and `aggregate_id` on
 * every row. Producers should not have to repeat that bookkeeping at each call
 * site — it is a property of the event, not of the write — so it lives here as
 * pure data next to the event names.
 *
 * `aggregateIdField` names the payload field holding the most specific id. When
 * the payload does not carry it (many producers only know the user), the
 * publisher falls back to `userId`: the change is still attributable to that
 * user's aggregate set, which is what consumers act on.
 */

import {
  DAILY_RECORD_CHANGED,
  DOSE_LOG_CHANGED,
  HEALTH_CONTEXT_CHANGED,
  HEALTH_EVENT_CHANGED,
  REMINDER_CHANGED,
  SETTINGS_CHANGED,
} from './domain-events.js';

export interface EventOrigin {
  /** Owning bounded context. */
  readonly context: string;
  readonly aggregateType: string;
  /** Payload field holding the aggregate id; falls back to `userId`. */
  readonly aggregateIdField: string;
}

export const EVENT_ORIGINS: Readonly<Record<string, EventOrigin>> = {
  [DAILY_RECORD_CHANGED]: {
    context: 'daily-records',
    aggregateType: 'daily-record',
    aggregateIdField: 'recordId',
  },
  [DOSE_LOG_CHANGED]: {
    context: 'medicine-dose-logs',
    aggregateType: 'dose-log',
    aggregateIdField: 'doseLogId',
  },
  [REMINDER_CHANGED]: {
    context: 'medicine-reminders',
    aggregateType: 'reminder',
    aggregateIdField: 'userId',
  },
  [HEALTH_CONTEXT_CHANGED]: {
    context: 'user-health-context',
    aggregateType: 'health-context',
    aggregateIdField: 'userId',
  },
  [SETTINGS_CHANGED]: {
    context: 'user-settings',
    aggregateType: 'settings',
    aggregateIdField: 'userId',
  },
  [HEALTH_EVENT_CHANGED]: {
    context: 'health-events',
    aggregateType: 'health-event',
    aggregateIdField: 'eventId',
  },
};

/**
 * Origin for `eventName`, or a safe generic one when the event is not declared.
 *
 * A missing entry must not drop the event: an unregistered name still deserves
 * persistence, and the outbox is the record of what happened. The fallback
 * keeps the row attributable while making the omission visible in the context
 * column.
 */
export function eventOriginFor(eventName: string): EventOrigin {
  return (
    EVENT_ORIGINS[eventName] ?? {
      context: 'unknown',
      aggregateType: eventName,
      aggregateIdField: 'userId',
    }
  );
}
