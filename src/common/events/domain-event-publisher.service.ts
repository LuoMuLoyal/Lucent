/**
 * The single entry point producers use to publish a domain event (ADR-0025).
 *
 * It exists so the "persist the fact" and "deliver it" halves can move
 * independently. During the ADR-0025 migration a producer must do both:
 *
 * - **append** the event to the `domain_events` outbox, so the fan-out can turn
 *   it into per-consumer queue jobs;
 * - **emit** it in process, because consumers that have not migrated yet still
 *   react through `@OnEvent`.
 *
 * Doing exactly one of the two would either starve the migrated consumers or
 * blind the un-migrated ones. Routing both through this one method means the
 * eventual switch (removing the in-process emit) is a change *here*, not in
 * every producing service.
 *
 * Ordering is deliberate: persist first, then emit. A persistence failure is
 * logged and does not stop the in-process emit — otherwise a database hiccup
 * would also break the consumers that worked before this migration.
 *
 * **What this does not do:** the append is not part of the producer's write
 * transaction. Producers call this after their write commits, so a crash in
 * between still loses the event. That window is narrower than the old
 * emit-only path (a crash *after* this call leaves a durable row that the next
 * poll delivers), but it is not atomicity — see ADR-0025 Consequences.
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eventOriginFor } from './event-origins.js';
import { DomainEventOutboxService } from './domain-events-outbox.service.js';

@Injectable()
export class DomainEventPublisher {
  private readonly logger = new Logger(DomainEventPublisher.name);

  constructor(
    private readonly outbox: DomainEventOutboxService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Records `eventName` in the outbox and delivers it to the consumers that are
   * still in-process. Never throws: publishing is best-effort by contract, so a
   * failure must not fail the business write that triggered it.
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

    try {
      await this.eventEmitter.emitAsync(eventName, payload);
    } catch (error) {
      this.logger.warn(
        `Failed to emit ${eventName} in process: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
