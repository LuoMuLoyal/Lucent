import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  HealthEventStatus,
  Prisma,
  ProductEventName,
  ProductEventResult,
  ProductEventSurface,
  UserDevicePlatform,
} from '#generated/prisma/client.js';
import { fromPrismaResult, now } from '../../../common/index.js';
import {
  createDomainFailure,
  errAsync,
  isDomainFailure,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result/index.js';
import { MetricsService } from '../../../common/metrics/metrics.service.js';
import { PrismaService } from '../../../prisma/index.js';
import { isKnownSuggestionRuleCode } from '../constants/rule-code-allowlist.constants.js';
import {
  MAX_PRODUCT_EVENT_FUTURE_SKEW_MS,
  CreateProductEventDto,
} from '../dto/create-product-event.dto.js';

/** Result of a batch write: events received vs rows actually inserted. */
export interface ProductEventRecordResult {
  /** Events accepted from the client (after validation). */
  received: number;
  /** Rows actually inserted — fewer when duplicate clientEventIds were skipped. */
  recorded: number;
}

/**
 * One server-emitted product event. Server-side events carry no meaningful
 * appVersion/platform (there is no client build to attribute), so this input
 * omits those client-only fields: `recordServerEvents` fills `appVersion:
 * 'server'`, `platform: web` and a default `occurredAt` (now) for the caller.
 * The HTTP DTO stays strict for clients.
 *
 * `clientEventId` semantics: by default each emission gets a fresh
 * `server-<uuid>` (per-occurrence events — share opens, suggestion actions).
 * Retryable lifecycle emitters MAY pass a DETERMINISTIC id derived from the
 * business operation identity (`server-health-started-<eventId>`, …), so a
 * client retry that re-runs an idempotent main write is deduped by the
 * (userId, clientEventId) unique constraint instead of double-inserting.
 */
export interface ServerProductEventInput {
  name: ProductEventName;
  surface: ProductEventSurface;
  result: ProductEventResult;
  /** Lifecycle status — health_event_started (active) / health_event_ended (ended). */
  eventStatus?: HealthEventStatus | null;
  /** Known server-side suggestion rule code (allowlisted). */
  suggestionRuleCode?: string | null;
  /** Event time; defaults to now. */
  occurredAt?: Date;
  /**
   * Explicit clientEventId (deterministic, business-operation-derived) for
   * retryable emitters; when omitted a fresh `server-<uuid>` is generated.
   */
  clientEventId?: string;
}

/**
 * Server events carry no client build to attribute — fixed markers so the
 * raw store stays honest about the source of the row.
 */
const SERVER_APP_VERSION = 'server';
const SERVER_PLATFORM = UserDevicePlatform.web;

/**
 * Write-only product measurement store (privacy-minimal: enums + bounded
 * attributes, no metadata JSON, no free text). No aggregation happens on the
 * request path — raw events only; aggregates are a separate task.
 *
 * Idempotency: `createMany` with `skipDuplicates` — the unique
 * (userId, clientEventId) constraint makes client retries and in-batch
 * duplicates silently skip instead of double-inserting.
 */
@Injectable()
export class ProductEventsService {
  private readonly logger = new Logger(ProductEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Records a client batch. Validation failures (unknown suggestion rule
   * code, future-skewed `occurredAt`) return `VALIDATION_FAILED` without
   * writing anything; known Prisma request errors map via `fromPrismaResult`;
   * unknown DB/connection errors rethrow.
   */
  recordBatch(
    userId: string,
    events: CreateProductEventDto[],
  ): ResultAsync<ProductEventRecordResult, DomainFailure> {
    const validationError = this.validateEvents(events);
    if (validationError != null) {
      return errAsync(validationError);
    }

    return fromPrismaResult(
      this.prisma.userProductEvent.createMany({
        data: events.map((event) => ({
          userId,
          clientEventId: event.clientEventId,
          name: event.name,
          surface: event.surface,
          result: event.result,
          eventStatus: event.eventStatus ?? null,
          suggestionRuleCode: event.suggestionRuleCode ?? null,
          appVersion: event.appVersion,
          platform: event.platform,
          occurredAt: new Date(event.occurredAt),
        })),
        skipDuplicates: true,
      }),
    ).map((recorded) => ({
      received: events.length,
      recorded: recorded.count,
    }));
  }

  /**
   * Server-internal batch write (Task 6 emitters). Same validation and
   * idempotent `createMany` path as `recordBatch`, with the client-only
   * fields supplied server-side: `appVersion: 'server'`, `platform: web`,
   * `occurredAt` defaulting to now, and `clientEventId` defaulting to a fresh
   * `server-<uuid>` per event. Emitters of retryable lifecycle operations
   * pass a DETERMINISTIC id (see `ServerProductEventInput.clientEventId`) so
   * the unique (userId, clientEventId) constraint dedupes client retries that
   * re-run an idempotent main write; per-occurrence events (share opens,
   * suggestion actions) intentionally keep the per-emission uuid because each
   * occurrence is a distinct event. The HTTP contract (DTO) is untouched —
   * this is not reachable from the controller.
   */
  recordServerEvents(
    userId: string,
    events: ServerProductEventInput[],
  ): ResultAsync<ProductEventRecordResult, DomainFailure> {
    return this.recordBatch(
      userId,
      events.map((event) => ({
        name: event.name,
        surface: event.surface,
        result: event.result,
        ...(event.eventStatus != null
          ? { eventStatus: event.eventStatus }
          : {}),
        ...(event.suggestionRuleCode != null
          ? { suggestionRuleCode: event.suggestionRuleCode }
          : {}),
        appVersion: SERVER_APP_VERSION,
        platform: SERVER_PLATFORM,
        occurredAt: (event.occurredAt ?? now()).toISOString(),
        clientEventId: event.clientEventId ?? `server-${randomUUID()}`,
      })),
    );
  }

  /**
   * Fire-and-forget emission for server-authoritative events: NEVER throws.
   * A failed product-event write logs a low-sensitivity identifier (event
   * name + fixed Prisma error code or error class — never the raw driver
   * message, which can embed connection strings, hosts, table names or the
   * event payload) and increments the emission-failure metric; the caller's
   * main transaction is neither rolled back nor failed. Called only AFTER
   * the main write already succeeded.
   */
  async emitServerEvent(
    userId: string,
    event: ServerProductEventInput,
  ): Promise<void> {
    try {
      const result = await this.recordServerEvents(userId, [event]);
      if (result.isErr()) {
        this.logEmissionFailure(event.name, result.error);
        this.metrics.recordProductEventEmissionFailure(event.name);
      }
    } catch (error) {
      // Unknown DB/connection errors rethrow out of `fromPrismaResult` — they
      // still must never escape the fire-and-forget contract.
      this.logEmissionFailure(event.name, error);
      this.metrics.recordProductEventEmissionFailure(event.name);
    }
  }

  /**
   * Logs an emission failure with a whitelisted detail: the Prisma stable
   * non-sensitive error code (P1001, P2002, …), the error class name, or the
   * DomainFailure `code` — the raw message is never logged, so a
   * driver/Prisma failure cannot leak internals. A DomainFailure prefers the
   * `cause` attached by `fromPrismaResult` (e.g. `prisma P2002`); when the
   * failure carries no `cause` (e.g. `VALIDATION_FAILED`) its own `code` is
   * used so the failure reason stays visible. `cause` never enters Problem
   * Details (fire-and-forget path).
   */
  private logEmissionFailure(
    eventName: ProductEventName,
    failure: unknown,
  ): void {
    const detail = this.failureDetail(failure);
    this.logger.error(
      `Product event emission failed (${eventName}): ${detail}`,
    );
  }

  /** Whitelisted stable identifier for a failure — never the raw message. */
  private failureDetail(failure: unknown): string {
    if (failure instanceof Prisma.PrismaClientKnownRequestError) {
      return `prisma ${failure.code}`;
    }
    if (failure instanceof Error) {
      return failure.constructor.name;
    }
    if (isDomainFailure(failure)) {
      return failure.cause instanceof Prisma.PrismaClientKnownRequestError
        ? `prisma ${failure.cause.code}`
        : `domain ${failure.code}`;
    }
    return 'unknown error';
  }

  /**
   * Rejects the whole batch when any event fails a server-side boundary:
   * - `suggestionRuleCode` outside the server-side allowlist — no free-form
   *   strings;
   * - `occurredAt` more than `MAX_PRODUCT_EVENT_FUTURE_SKEW_MS` into the
   *   future, which would never match the 90-day retention cleanup.
   *
   * Nothing is written if any event is invalid.
   */
  private validateEvents(
    events: CreateProductEventDto[],
  ): DomainFailure | null {
    const futureCutoff = now().getTime() + MAX_PRODUCT_EVENT_FUTURE_SKEW_MS;
    for (const event of events) {
      if (!isKnownSuggestionRuleCode(event.suggestionRuleCode)) {
        return this.validationFailed();
      }
      if (new Date(event.occurredAt).getTime() > futureCutoff) {
        return this.validationFailed();
      }
    }
    return null;
  }

  private validationFailed(): DomainFailure {
    return createDomainFailure({
      kind: 'validation',
      code: 'VALIDATION_FAILED',
    });
  }
}
