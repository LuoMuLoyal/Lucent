/**
 * The single entry point producers use to publish a domain event (ADR-0025).
 *
 * It exists so the "persist the fact" and "deliver it" halves can move
 * independently — and so the eventual switch is a change *here*, not in every
 * producing service. That switch has now happened: producers append to the
 * outbox and **nothing else**. Delivery is the poller's job, which turns each
 * row into the per-consumer jobs listed in `subscriptions.ts`.
 *
 * **What this does not do:** the append is not part of the producer's write
 * transaction. Producers call this after their write commits, so a crash in
 * between still loses the event. That window is narrower than the old
 * emit-only path (a crash *after* this call leaves a durable row that the next
 * poll delivers), but it is not atomicity — see ADR-0025 Consequences.
 */

import { Injectable, Logger } from '@nestjs/common';
import { eventOriginFor } from './event-origins.js';
import { DomainEventOutboxService } from './domain-events-outbox.service.js';

@Injectable()
export class DomainEventPublisher {
  private readonly logger = new Logger(DomainEventPublisher.name);

  constructor(private readonly outbox: DomainEventOutboxService) {}

  /**
   * Records `eventName` in the outbox. Never throws: publishing is
   * best-effort by contract, so a failure must not fail the business write
   * that triggered it.
   *
   * `dedupeKey` is optional and defaults to "no dedupe" — two identical-looking
   * changes are still two facts unless the caller can name them as one.
   */
  async publish(
    eventName: string,
    payload: object,
    dedupeKey?: string,
  ): Promise<void> {
    const fields = payload as Record<string, unknown>;
    const origin = eventOriginFor(eventName);
    const candidate = fields[origin.aggregateIdField];
    const userId = fields['userId'];
    const aggregateId =
      typeof candidate === 'string' && candidate.length > 0
        ? candidate
        : typeof userId === 'string'
          ? userId
          : '';

    try {
      await this.outbox.append({
        context: origin.context,
        aggregateType: origin.aggregateType,
        aggregateId,
        eventName,
        payload: fields,
        ...(dedupeKey != null ? { dedupeKey } : {}),
      });
    } catch (error) {
      this.logger.warn(
        `Failed to append ${eventName} to the outbox (aggregate=${origin.aggregateType}:${aggregateId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
