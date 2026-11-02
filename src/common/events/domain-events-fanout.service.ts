/**
 * Outbox → queue fan-out (ADR-0025).
 *
 * This is the second half of the outbox: `DomainEventOutboxService` owns the
 * table (append inside the producer's transaction, claim rows, retry
 * bookkeeping), this service owns the **delivery**: it reads a claimed row and
 * turns it into one job per subscription in `subscriptions.ts`.
 *
 * Why a queue instead of `EventEmitter2.emitAsync`:
 *
 * - A producer's write latency stops depending on how many listeners exist and
 *   how slow they are; the write only pays for one INSERT.
 * - Each consumer gets its own retry policy, its own concurrency and its own
 *   backlog on the BullMQ board — impossible inside a synchronous emit.
 * - `common/` never imports a business module: it only knows queue names and
 *   resolves the owning module at runtime through the queue registry.
 *
 * Two delivery modes:
 *
 * - **Queue** (`REDIS_URL` configured): the module's worker queue exists (it
 *   was created by the module itself), so this service adds a job to it.
 * - **Inline** (no `REDIS_URL`, the local/e2e default): the module registers an
 *   inline handler through {@link registerInlineConsumer}, and this service
 *   calls it directly. Same code path as `RecomputeQueueService`'s
 *   `isConfigured` fallback.
 *
 * A subscriber with neither a queue nor an inline handler is a wiring error:
 * the row is not settled, its `attempts` goes up, and it parks after
 * `OUTBOX_MAX_ATTEMPTS` so the failure is visible instead of silently dropped.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { DomainEventEnvelope } from './domain-events.js';
import { subscriptionsFor } from './subscriptions.js';
import type { EventSubscription } from './subscriptions.js';
import { BullmqQueueFactory } from '../queue/queue.factory.js';
import type { QueueName } from '../queue/queue-names.js';

/** Job data every fanned-out job carries (the event's own fields plus the envelope). */
export interface DomainEventJobData extends DomainEventEnvelope {
  [field: string]: unknown;
}

/** One module's in-process consumer for one `queue + job` pair. */
export type InlineEventConsumer = (
  data: DomainEventJobData,
) => void | Promise<void>;

/** What a claimed row looks like to the fan-out service. */
export interface ClaimedEventRow {
  id: string;
  eventName: string;
  payloadVersion: number;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

/** Result of fanning one row out. */
export type FanOutOutcome =
  | { kind: 'no-subscribers' }
  | { kind: 'delivered'; jobs: number }
  | { kind: 'failed'; error: unknown };

/**
 * Registry of in-process consumers, keyed by `queue|job`.
 *
 * Module-owned queue services register themselves at construction time when
 * their BullMQ queue is not configured. Registration is idempotent, so repeated
 * module loading (tests, HMR) does not accumulate handlers.
 */
@Injectable()
export class EventConsumerRegistry {
  private readonly consumers = new Map<string, InlineEventConsumer>();

  private static key(queue: QueueName, job: string): string {
    return `${queue}|${job}`;
  }

  register(queue: QueueName, job: string, handler: InlineEventConsumer): void {
    this.consumers.set(EventConsumerRegistry.key(queue, job), handler);
  }

  unregister(queue: QueueName, job: string): void {
    this.consumers.delete(EventConsumerRegistry.key(queue, job));
  }

  has(queue: QueueName, job: string): boolean {
    return this.consumers.has(EventConsumerRegistry.key(queue, job));
  }

  resolve(queue: QueueName, job: string): InlineEventConsumer | undefined {
    return this.consumers.get(EventConsumerRegistry.key(queue, job));
  }

  /** Every registered `queue|job` pair — used by tests and diagnostics. */
  keys(): string[] {
    return [...this.consumers.keys()];
  }
}

@Injectable()
export class DomainEventFanOutService {
  private readonly logger = new Logger(DomainEventFanOutService.name);

  constructor(
    private readonly factory: BullmqQueueFactory,
    private readonly registry: EventConsumerRegistry,
  ) {}

  /** True when a job can go to BullMQ; false means inline dispatch. */
  get usesQueues(): boolean {
    return this.factory.isAvailable;
  }

  /**
   * Delivers one claimed row to every subscriber. Never throws: the caller
   * (`DomainEventOutboxService`) decides what a failure means for the row.
   */
  async fanOut(row: ClaimedEventRow): Promise<FanOutOutcome> {
    const subscriptions = subscriptionsFor(row.eventName);
    const data: DomainEventJobData = {
      ...row.payload,
      eventId: row.id,
      eventType: row.eventName,
      version: row.payloadVersion,
      occurredAt: row.occurredAt.toISOString(),
    };

    if (subscriptions.length === 0) {
      // A fact with no interested party still gets recorded and settled; this
      // is the normal state for an event whose consumer does not exist yet.
      this.logger.debug(
        `No subscribers for ${row.eventName} (${row.id}); settling without delivery`,
      );
      return { kind: 'no-subscribers' };
    }

    // Deliveries are independent: one broken subscriber must not lose the
    // jobs of the others, so every delivery is settled on its own and the
    // failures are reported together afterwards.
    const results = await Promise.all(
      subscriptions.map(async (subscription) =>
        this.deliver(subscription, data, `${row.eventName} ${row.id}`),
      ),
    );
    const failures = results.filter(
      (result): result is Error => result instanceof Error,
    );
    if (failures.length > 0) {
      return { kind: 'failed', error: new AggregateDeliveryError(failures) };
    }
    return { kind: 'delivered', jobs: results.length };
  }

  /**
   * Delivers one job. A delivery failure is logged here and re-thrown so
   * `fanOut` can count it; a *wiring* problem (queue or handler missing) is
   * logged and returned as an `Error` value instead of being thrown, because
   * it is a configuration fact rather than a runtime fault.
   */
  private async deliver(
    subscription: EventSubscription,
    data: DomainEventJobData,
    rowLabel: string,
  ): Promise<Error | null> {
    const { queue: queueName, job: jobName } = subscription;
    const label = `${queueName}#${jobName}`;
    let problem: string | null;
    try {
      problem = await this.attempt(queueName, jobName, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Fan-out to ${label} failed for ${rowLabel}: ${message}`,
      );
      return new DeliveryFailureError(`${label}: ${message}`);
    }
    if (problem == null) {
      return null;
    }
    this.logger.warn(`Fan-out to ${label} failed for ${rowLabel}: ${problem}`);
    return new DeliveryFailureError(`${label}: ${problem}`);
  }

  /**
   * Dispatches to BullMQ when Redis is configured and to the registered inline
   * consumer otherwise. Returns `null` on success, or the reason it could not
   * be dispatched at all (missing queue / missing handler).
   */
  private async attempt(
    queueName: QueueName,
    jobName: string,
    data: DomainEventJobData,
  ): Promise<string | null> {
    if (this.factory.isAvailable) {
      const queue = this.findQueue(queueName);
      if (queue != null) {
        await queue.add(jobName, data, {
          // Deterministic id: re-delivering the same outbox row (allowed by
          // ADR-0025's at-least-once contract) does not create a second job.
          jobId: `${data.eventId}:${jobName}:${queueName}`,
        });
        return null;
      }
      // A subscribed queue that no module created is a wiring error, not a
      // fallback case: silently switching to inline would hide it.
      return `no queue created for "${queueName}"; wire the owning module's queue service`;
    }

    const inline = this.registry.resolve(queueName, jobName);
    if (inline == null) {
      // No Redis and nobody registered a handler: registering it is the
      // owning module's job, and the row is parked after the retry budget.
      return `no inline consumer for "${queueName}#${jobName}" and REDIS_URL is not configured`;
    }
    await inline(data);
    return null;
  }

  private findQueue(queueName: QueueName): Queue | null {
    const match = this.factory
      .getQueues()
      .find((queue) => queue.name === queueName);
    return match ?? null;
  }
}

/** One subscriber's delivery failure, named so the outbox row says which one. */
export class DeliveryFailureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeliveryFailureError';
  }
}

/** All subscriber failures of one fan-out, so the row error names every one. */
export class AggregateDeliveryError extends Error {
  constructor(readonly causes: readonly unknown[]) {
    super(
      causes
        .map((cause) =>
          cause instanceof Error ? cause.message : String(cause),
        )
        .join('; '),
    );
    this.name = 'AggregateDeliveryError';
  }
}
