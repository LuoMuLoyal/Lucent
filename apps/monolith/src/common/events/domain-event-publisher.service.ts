/**
 * The single entry point producers use to publish a domain event (ADR-0025).
 *
 * It exists so the "persist the fact" and "deliver it" halves can move
 * independently — and so the eventual switch is a change *here*, not in every
 * producing service. Producers append to the outbox and **nothing else**;
 * delivery is the poller's job, which turns each row into the per-consumer jobs
 * listed in `subscriptions.ts`.
 *
 * **Local-transactional outbox (E0).** The append joins the caller's open
 * `Prisma.TransactionClient` automatically, picked up from the ambient scope in
 * `transaction-scope.ts`. A producer running inside
 * `PrismaTransactionRunner.transaction()` therefore writes its event in the same
 * transaction as the aggregate: if the write rolls back, the event rolls back
 * with it, and there is no window where the business state is committed but the
 * fact was never recorded.
 *
 * This is **not** a distributed transaction and does not touch delivery.
 * Consumers still run asynchronously with at-least-once semantics, so the
 * end-to-end system stays eventually consistent — only the pair (business
 * state, pending event) is atomic.
 *
 * **Failure semantics follow the context.** Inside a transaction an append
 * failure must propagate: swallowing it would commit the aggregate and drop the
 * event, which is exactly the bug E0 removes. Outside a transaction publishing
 * remains best-effort — the write already committed, so reporting an error for
 * a successful write would be worse than logging it.
 *
 * **What remains non-atomic:** producers whose write is a single Prisma
 * statement open no transaction, so their append happens afterwards. That
 * window is real and recorded in ADR-0025 Consequences.
 */

import { Injectable, Logger } from '@nestjs/common';
import { eventOriginFor } from './event-origins.js';
import { DomainEventOutboxService } from './domain-events-outbox.service.js';
import { activeTransaction } from './transaction-scope.js';

@Injectable()
export class DomainEventPublisher {
  private readonly logger = new Logger(DomainEventPublisher.name);

  constructor(private readonly outbox: DomainEventOutboxService) {}

  /**
   * Records `eventName` in the outbox.
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

    const append = this.outbox.append({
      context: origin.context,
      aggregateType: origin.aggregateType,
      aggregateId,
      eventName,
      payload: fields,
      ...(dedupeKey != null ? { dedupeKey } : {}),
    });

    // Inside a transaction: let the failure abort the transaction. The outbox
    // row is part of the same commit, so a swallowed error here would publish
    // nothing while telling the caller the fact was recorded.
    if (activeTransaction() != null) {
      await append;
      return;
    }

    try {
      await append;
    } catch (error) {
      this.logger.warn(
        `Failed to append ${eventName} to the outbox (aggregate=${origin.aggregateType}:${aggregateId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
