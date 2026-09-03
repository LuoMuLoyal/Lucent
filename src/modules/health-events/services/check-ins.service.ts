import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  HealthEventKind,
  HealthEventStatus,
  ProductEventName,
  ProductEventSurface,
} from '#generated/prisma/client.js';
import {
  DEFAULT_USER_TIMEZONE,
  formatDateOnly,
  formatDateOnlyInTimezone,
  now,
  parseDateOnly,
} from '../../../common/index.js';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result/index.js';
import {
  HealthEventRepositoryPort,
  type HealthEventCheckInRecord,
} from '../repositories/event.repository.js';
import {
  parseHealthEventOutcome,
  toProductEventResult,
  type EndHealthEventInput,
} from './events.service.js';
import {
  HEALTH_EVENT_CHANGED,
  type HealthEventChangedPayload,
} from '../../../common/events/domain-events.js';
import { ProductEventsService } from '../../product-events/index.js';

export type UpsertCheckInInput = EndHealthEventInput;

@Injectable()
export class CheckInsService {
  constructor(
    private readonly repository: HealthEventRepositoryPort,
    private readonly eventEmitter: EventEmitter2,
    private readonly productEvents: ProductEventsService,
  ) {}

  upsert(
    userId: string,
    eventId: string,
    input: UpsertCheckInInput | string | undefined,
    at: Date = now(),
  ): ResultAsync<HealthEventCheckInRecord, DomainFailure> {
    return fromPromise(this.repository.findUserTimezone(userId), (error) => {
      throw error;
    })
      .map((timezone) =>
        formatDateOnlyInTimezone(at, timezone ?? DEFAULT_USER_TIMEZONE),
      )
      .andThen((date) => this.upsertForDate(userId, eventId, date, input));
  }

  upsertForDate(
    userId: string,
    eventId: string,
    date: string,
    input: UpsertCheckInInput | string | undefined,
  ): ResultAsync<HealthEventCheckInRecord, DomainFailure> {
    const outcome = parseHealthEventOutcome(
      typeof input === 'string' ? input : input?.outcome,
    );
    if (outcome == null) {
      return errAsync(this.validationFailed());
    }
    if (!this.isValidDateOnly(date)) {
      return errAsync(this.validationFailed());
    }

    return fromPromise(this.repository.findById(eventId), (error) => {
      throw error;
    }).andThen((event) => {
      if (event == null) {
        return errAsync(this.notFound());
      }
      if (event.userId !== userId) {
        return errAsync(
          createDomainFailure({ kind: 'authorization', code: 'FORBIDDEN' }),
        );
      }
      if (event.status !== HealthEventStatus.active) {
        return errAsync(this.validationFailed());
      }

      return this.repository
        .upsertCheckIn(userId, eventId, date, outcome)
        .andThen((checkIn) => {
          if (checkIn == null) {
            return errAsync(this.notFound());
          }
          return (
            fromPromise(
              this.eventEmitter.emitAsync(HEALTH_EVENT_CHANGED, {
                userId,
                eventId,
                date,
                change: 'check-in',
                kind: event.kind ?? HealthEventKind.symptom,
              } satisfies HealthEventChangedPayload),
              (error) => {
                throw error;
              },
            )
              // A successful check-in confirms the user's outcome for that
              // day — server-authoritative, emitted only after the upsert
              // write succeeded. Deterministic clientEventId: the upsert is
              // per (event, calendar date), so a retry yields the same id and
              // the unique constraint dedupes it.
              .andThen(() =>
                fromPromise(
                  this.productEvents.emitServerEvent(userId, {
                    name: ProductEventName.health_event_outcome_confirmed,
                    surface: ProductEventSurface.review,
                    result: toProductEventResult(outcome),
                    occurredAt: now(),
                    clientEventId: `server-checkin-${eventId}-${date}`,
                  }),
                  (error) => {
                    throw error;
                  },
                ),
              )
              .map(() => checkIn)
          );
        });
    });
  }

  private isValidDateOnly(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }

    const parsed = parseDateOnly(value);
    return !Number.isNaN(parsed.getTime()) && formatDateOnly(parsed) === value;
  }

  private notFound(): DomainFailure {
    return createDomainFailure({
      kind: 'not_found',
      code: 'RESOURCE_NOT_FOUND',
    });
  }

  private validationFailed(): DomainFailure {
    return createDomainFailure({
      kind: 'validation',
      code: 'VALIDATION_FAILED',
    });
  }
}
