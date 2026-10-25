import { Injectable, Logger } from '@nestjs/common';

import { formatDateOnlyInTimezone, now } from '../../../../common/index.js';
import type { DomainEventJobData } from '../../../../common/index.js';
import { PrismaService } from '../../../../prisma/index.js';
import { SuggestionCacheService } from '../cache/suggestion-cache.service.js';
import { MaterializationStore } from '../../infrastructure/persistence/materialization.js';
import type { MaterializationReasonCode } from '../../infrastructure/persistence/materialization.types.js';
import type { RecomputeJobData } from './recompute-job.types.js';

/** Event name → the reason code recorded on the materialization row. */
const REASON_CODES: Readonly<Record<string, MaterializationReasonCode>> = {
  'daily-record.changed': 'daily_record_changed',
  'dose-log.changed': 'dose_log_changed',
  'reminder.changed': 'reminder_changed',
  'health-context.changed': 'health_context_changed',
  'settings.changed': 'settings_changed',
  'health-event.changed': 'health_event_changed',
};

/** Events whose change also invalidates the per-user baseline cache. */
const BASELINE_INVALIDATING_EVENTS: ReadonlySet<string> = new Set([
  'reminder.changed',
  'health-context.changed',
  'settings.changed',
]);

/**
 * Turns a fanned-out domain event into suggestion work (ADR-0025).
 *
 * Replaces the two in-process listeners that reacted to the same six events —
 * `recompute/trigger.listener.ts` (recompute) and
 * `cache/suggestion-cache-invalidation.listener.ts` (cache). They are one
 * consumer now because their work has an order that matters: invalidate the
 * caches, then mark pending, then enqueue. Two separate jobs could run in
 * either order, and a recompute that started before the invalidation would
 * persist a result computed from signals that were already known to be stale.
 *
 * The three steps of the old `trigger()` keep their original order:
 * `readStatus` → `markPending` (bumps `sourceVersion`) → enqueue carrying that
 * new version. The enqueued version must be the one just written, otherwise the
 * worker computes against a superseded version and is stale on arrival.
 */
@Injectable()
export class RecomputeEventTriggerService {
  private readonly logger = new Logger(RecomputeEventTriggerService.name);

  constructor(
    private readonly store: MaterializationStore,
    private readonly cache: SuggestionCacheService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Prepares the recompute for one event, or `null` when the event must not
   * trigger one (unrecognised name, missing user, or a check-in that carries no
   * signal).
   *
   * Returns data instead of enqueueing it: the caller owns the queue, which
   * keeps this service free of a queue dependency and avoids a provider cycle
   * between the trigger and the queue service.
   */
  async resolve(data: DomainEventJobData): Promise<RecomputeJobData | null> {
    const userId = data['userId'];
    if (typeof userId !== 'string' || userId.length === 0) {
      this.logger.warn(
        `Skipping suggestion recompute for ${data.eventType}: payload has no userId (eventId=${data.eventId})`,
      );
      return null;
    }

    const reasonCode = REASON_CODES[data.eventType];
    if (reasonCode == null) {
      // The table routes this event here but this consumer does not know it.
      // Settle the job rather than retry it forever.
      this.logger.warn(
        `No suggestion reason code for event ${data.eventType} (eventId=${data.eventId}); skipping`,
      );
      return null;
    }

    const payloadDate = data['date'];
    const explicitDate =
      typeof payloadDate === 'string' && payloadDate.length > 0
        ? payloadDate
        : null;
    // Events without a payload date (reminder/health-context/settings) affect
    // the user's local today, so resolve it once in their timezone.
    const localDate = explicitDate ?? (await this.todayForUser(userId));

    // Invalidation runs for every event, including ones that turn out not to
    // need a recompute: the old cache listener had no filter, and skipping it
    // for a non-symptom check-in would leave stale signals behind.
    await this.invalidateForEvent(userId, data.eventType, localDate);

    if (!this.shouldRecompute(data)) {
      return null;
    }

    try {
      const current = await this.store.readStatus(userId, localDate);
      const pending = await this.store.markPending({
        userId,
        localDate,
        sourceVersion: current.sourceVersion + 1,
        reasonCodes: [reasonCode],
      });
      return {
        userId,
        localDate,
        sourceVersion: pending.sourceVersion,
        reasonCodes: pending.reasonCodes,
      };
    } catch (error) {
      this.logger.error(
        `Failed to prepare suggestion recompute on ${data.eventType}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
        { userId, localDate, reasonCode, eventType: data.eventType },
      );
      return null;
    }
  }

  /**
   * A non-symptom check-in records the user's own outcome for the day and
   * carries no new signal to score, so it invalidates caches without paying for
   * a recompute. Mirrors the guard the old recompute listener applied.
   */
  private shouldRecompute(data: DomainEventJobData): boolean {
    if (data.eventType !== 'health-event.changed') {
      return true;
    }
    return !(data['change'] === 'check-in' && data['kind'] === 'other');
  }

  /** Invalidates the cache layers the old listener cleared for this event. */
  private async invalidateForEvent(
    userId: string,
    eventType: string,
    localDate: string,
  ): Promise<void> {
    try {
      await this.cache.invalidateSignals(userId, localDate);
      if (BASELINE_INVALIDATING_EVENTS.has(eventType)) {
        await this.cache.invalidateBaseline(userId);
      }
    } catch (error) {
      // The cache is an accelerator, and the recompute invalidates signals on
      // its own path, so a failure here must not skip the recompute.
      this.logger.warn(
        `Failed to invalidate suggestion cache on ${eventType} (userId=${userId}, date=${localDate}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Today's date in the user's timezone, for events that carry no date of their
   * own. A missing profile falls back to the product default.
   */
  private async todayForUser(userId: string): Promise<string> {
    const profile = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { profile: { select: { timezone: true } } },
    });
    return formatDateOnlyInTimezone(now(), profile?.profile?.timezone ?? null);
  }
}
