/**
 * Outbox publisher for cross-context domain events (ADR-0024).
 *
 * Producers append events to `domain_events` inside the same transaction as
 * the aggregate write; this service polls the outbox, re-dispatches events to
 * the in-process event bus, and marks delivery. Rows are append-only in
 * semantics — delivery failure only bumps `attempts` / stores `lastError`, the
 * row itself is never mutated into a different event.
 *
 * One row is claimed, emitted, and settled inside a single transaction that
 * holds the row lock (`FOR UPDATE SKIP LOCKED`), so multiple app instances can
 * poll concurrently without double-delivering the same row. Consumers must still
 * dedupe on `eventId` per the ADR — a crash between emit and commit can, at
 * worst, deliver one event twice.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '#generated/prisma/client.js';
import {
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_POLL_INTERVAL_MS,
} from './outbox-tunings.js';
import { PrismaService } from '../../prisma/index.js';

/** How many unpublished rows a single publish cycle handles. */
export const OUTBOX_BATCH_SIZE = 50;

type OutboxRow = {
  id: string;
  event_name: string;
  payload_version: number;
  payload: Prisma.JsonValue;
  occurred_at: Date;
  attempts: number;
};

export interface DomainEventAppendInput {
  /** Owning bounded context, e.g. `auth` or `medicines`. */
  context: string;
  aggregateType: string;
  aggregateId: string;
  /** Published event name, past tense, e.g. `account_registered`. */
  eventName: string;
  /** Already checked minimal payload (never raw domain content). */
  payload: Record<string, unknown>;
  payloadVersion?: number;
  metadata?: Record<string, unknown>;
}

export interface OutboxPublishOutcome {
  delivered: number;
  failed: number;
  parked: number;
}

@Injectable()
export class DomainEventOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DomainEventOutboxService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Persists a domain event. May be called with the caller's Prisma client
   * (transactional with the aggregate write) or without (standalone).
   */
  async append(
    input: DomainEventAppendInput,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const client = tx ?? this.prisma;
    const row = await client.domainEvent.create({
      data: {
        context: input.context,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        eventName: input.eventName,
        payloadVersion: input.payloadVersion ?? 1,
        payload: asJson(input.payload),
        metadata: input.metadata ? asJson(input.metadata) : Prisma.DbNull,
      },
      select: { id: true },
    });
    return row.id;
  }

  /**
   * Drains unpublished rows in `occurred_at` order. Never throws — failures
   * are recorded on the rows and retried next poll.
   */
  async publishPending(): Promise<OutboxPublishOutcome> {
    const outcome: OutboxPublishOutcome = {
      delivered: 0,
      failed: 0,
      parked: 0,
    };
    for (let i = 0; i < OUTBOX_BATCH_SIZE; i += 1) {
      const row = await this.dispatchOne();
      if (row === null) {
        break;
      }
      if (row.success) {
        outcome.delivered += 1;
      } else if (row.parked) {
        outcome.parked += 1;
      } else {
        outcome.failed += 1;
      }
    }
    return outcome;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.safePublishPending();
    }, OUTBOX_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async safePublishPending(): Promise<void> {
    try {
      await this.publishPending();
    } catch (error) {
      this.logger.warn(
        `Outbox poll cycle failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Claims, emits, and settles exactly one row inside one transaction. The
   * row lock spans the emit, so concurrent pollers skip the claimed row.
   * Returns `null` when nothing is claimable.
   */
  private async dispatchOne(): Promise<{
    success: boolean;
    parked: boolean;
  } | null> {
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<OutboxRow[]>(Prisma.sql`
        SELECT id, event_name, payload, payload_version, occurred_at, attempts
        FROM "domain_events"
        WHERE published_at IS NULL AND attempts < ${OUTBOX_MAX_ATTEMPTS}
        ORDER BY occurred_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `);
      if (!row) {
        return null;
      }
      const parkedBefore = row.attempts + 1 >= OUTBOX_MAX_ATTEMPTS;
      try {
        await this.emitRow(row);
      } catch (error) {
        this.logger.warn(
          `Outbox delivery failed: ${row.event_name} (${row.id}), attempt ${String(
            row.attempts + 1,
          )}/${String(OUTBOX_MAX_ATTEMPTS)}: ${outboxErrorMessage(error)}`,
        );
        await this.recordFailure(tx, row, error);
        return { success: false, parked: parkedBefore };
      }
      await tx.domainEvent.update({
        where: { id: row.id },
        data: { publishedAt: new Date() },
      });
      return { success: true, parked: false };
    });
  }

  /** Re-dispatches the stored payload to the in-process event bus. */
  private async emitRow(row: OutboxRow): Promise<void> {
    const payload =
      row.payload !== null &&
      typeof row.payload === 'object' &&
      !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {};
    await this.eventEmitter.emitAsync(row.event_name, {
      ...payload,
      eventId: row.id,
      eventType: row.event_name,
      version: row.payload_version,
      occurredAt: row.occurred_at.toISOString(),
    });
  }

  private async recordFailure(
    tx: Prisma.TransactionClient,
    row: OutboxRow,
    error: unknown,
  ): Promise<void> {
    await tx.domainEvent.update({
      where: { id: row.id },
      data: {
        attempts: { increment: 1 },
        lastError: outboxErrorMessage(error).slice(0, 2000),
      },
    });
  }
}

function outboxErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  return 'unknown error';
}

/** Ensures the column value is JSON-safe (prisma Json accepts plain objects). */
function asJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
