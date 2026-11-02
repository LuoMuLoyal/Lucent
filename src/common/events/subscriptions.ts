/**
 * Subscription table for cross-context domain events (ADR-0025).
 *
 * Every row in `domain_events` is turned into one BullMQ job per subscription
 * listed here. A module that wants to react to an event adds a line to this
 * table instead of importing the event constant and writing an `@OnEvent`
 * handler — which is what made `common/` depend on business modules and what
 * made a producer's write latency accumulate along the listener chain.
 *
 * **Pure data, no functions.** `common/` may only know queue *names*; creating
 * the queue, owning its worker and running the business logic stays inside the
 * owning module. The job name is a tag the consumer dispatches on, so one queue
 * can serve several subscriptions without the consumer guessing which event it
 * is looking at.
 *
 * **A row may only name a queue whose owning module already consumes it.** The
 * table is filled in per migrated consumer, not up front: declaring a
 * subscription before its worker exists means the fan-out enqueues a job nobody
 * claims, and the event goes unhandled. Until a consumer migrates, its event
 * keeps travelling the old in-process path.
 *
 * A consumer whose queue is not configured (no `REDIS_URL`) runs its handler
 * inline instead — local development and e2e have no Redis.
 *
 * **Delivery is at-least-once, and `common/` does not dedupe for you.** Every
 * job carries the outbox row id as `eventId` (`DomainEventEnvelope`); a crash
 * between the queue write and the outbox settle can deliver the same row
 * twice. The BullMQ job id is deterministic per `(eventId, job, queue)`, which
 * absorbs a re-run of the fan-out itself, but it does **not** cover "consumed,
 * then crashed, then replayed". A consumer with side effects must therefore
 * persist the `eventId`s it has already applied and skip repeats. There is no
 * shared dedupe table or Redis key on purpose: consumers differ in what
 * "applied" means and how long it must hold, so each owns its own record.
 *
 * An event with **no consumers is absent from this table on purpose**. An empty
 * array would claim "we checked and nobody listens", which stops being true the
 * first time someone does; absence is the honest state, and the publisher just
 * settles the row.
 */

import { QUEUE_NAMES, type QueueName } from '../queue/queue-names.js';
import {
  DAILY_RECORD_CHANGED,
  DOSE_LOG_CHANGED,
  HEALTH_CONTEXT_CHANGED,
  HEALTH_EVENT_CHANGED,
  REMINDER_CHANGED,
  SETTINGS_CHANGED,
  TODAY_SUGGESTION_MATERIALIZATION_CHANGED,
} from './domain-events.js';
import {
  MEDICINE_RISK_REFRESH_JOB,
  REPORT_CACHE_INVALIDATION_JOB,
  SUGGESTION_EVENT_TRIGGER_JOB,
  TODAY_ANALYSIS_EVENT_JOB,
} from './jobs.js';

/** One consumer of one event: the queue to enqueue into and the job name. */
export interface EventSubscription {
  readonly queue: QueueName;
  readonly job: string;
}

/**
 * Every subscription, keyed by event name. Deliberately **not** typed as
 * `Record<DomainEventName, …>`: that would force an entry (empty or not) for
 * every declared event, and "this event has no consumers" has to be
 * expressible without inventing a placeholder.
 *
 * Rows are added together with the consumer that claims them.
 */
export const EVENT_SUBSCRIPTIONS: Readonly<
  Record<string, readonly EventSubscription[]>
> = {
  // `reports` and `today-suggestion` have migrated (ADR-0025). Every event that
  // used to invalidate the dashboard or trigger a suggestion recompute through
  // an in-process `@OnEvent` now does it through a queue. The remaining
  // consumers of these same events still run in process until their own row
  // lands, which is why a producer both appends and emits during the migration.
  [DAILY_RECORD_CHANGED]: [
    {
      queue: QUEUE_NAMES.reportCacheInvalidation,
      job: REPORT_CACHE_INVALIDATION_JOB,
    },
    {
      queue: QUEUE_NAMES.suggestionRecompute,
      job: SUGGESTION_EVENT_TRIGGER_JOB,
    },
    {
      queue: QUEUE_NAMES.todayAnalysis,
      job: TODAY_ANALYSIS_EVENT_JOB,
    },
  ],
  [DOSE_LOG_CHANGED]: [
    {
      queue: QUEUE_NAMES.reportCacheInvalidation,
      job: REPORT_CACHE_INVALIDATION_JOB,
    },
    {
      queue: QUEUE_NAMES.suggestionRecompute,
      job: SUGGESTION_EVENT_TRIGGER_JOB,
    },
    {
      queue: QUEUE_NAMES.todayAnalysis,
      job: TODAY_ANALYSIS_EVENT_JOB,
    },
  ],
  [REMINDER_CHANGED]: [
    {
      queue: QUEUE_NAMES.reportCacheInvalidation,
      job: REPORT_CACHE_INVALIDATION_JOB,
    },
    {
      queue: QUEUE_NAMES.suggestionRecompute,
      job: SUGGESTION_EVENT_TRIGGER_JOB,
    },
    {
      queue: QUEUE_NAMES.medicineRiskRefresh,
      job: MEDICINE_RISK_REFRESH_JOB,
    },
  ],
  [HEALTH_CONTEXT_CHANGED]: [
    {
      queue: QUEUE_NAMES.reportCacheInvalidation,
      job: REPORT_CACHE_INVALIDATION_JOB,
    },
    {
      queue: QUEUE_NAMES.suggestionRecompute,
      job: SUGGESTION_EVENT_TRIGGER_JOB,
    },
    {
      queue: QUEUE_NAMES.medicineRiskRefresh,
      job: MEDICINE_RISK_REFRESH_JOB,
    },
  ],
  [SETTINGS_CHANGED]: [
    {
      queue: QUEUE_NAMES.reportCacheInvalidation,
      job: REPORT_CACHE_INVALIDATION_JOB,
    },
    {
      queue: QUEUE_NAMES.suggestionRecompute,
      job: SUGGESTION_EVENT_TRIGGER_JOB,
    },
  ],
  [HEALTH_EVENT_CHANGED]: [
    {
      queue: QUEUE_NAMES.reportCacheInvalidation,
      job: REPORT_CACHE_INVALIDATION_JOB,
    },
    {
      queue: QUEUE_NAMES.suggestionRecompute,
      job: SUGGESTION_EVENT_TRIGGER_JOB,
    },
    {
      queue: QUEUE_NAMES.todayAnalysis,
      job: TODAY_ANALYSIS_EVENT_JOB,
    },
  ],
  // Only today-analysis consumes this: a freshly materialized suggestion is an
  // input to the analysis, and no other migrated consumer reacts to it.
  [TODAY_SUGGESTION_MATERIALIZATION_CHANGED]: [
    {
      queue: QUEUE_NAMES.todayAnalysis,
      job: TODAY_ANALYSIS_EVENT_JOB,
    },
  ],
};

/** Subscription list for `eventName`; empty when nobody listens. */
export function subscriptionsFor(
  eventName: string,
): readonly EventSubscription[] {
  return EVENT_SUBSCRIPTIONS[eventName] ?? [];
}
