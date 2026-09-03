import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  HealthEventKind,
  HealthEventOutcome,
  HealthEventStatus,
  ProductEventName,
  ProductEventResult,
  ProductEventSurface,
} from '#generated/prisma/client.js';
import {
  DEFAULT_USER_TIMEZONE,
  formatDateOnlyInTimezone,
  now,
} from '../../../common/index.js';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result/index.js';
import {
  HealthEventRepositoryPort,
  type HealthEventView,
  type HealthEventRecord,
} from '../repositories/event.repository.js';
import {
  HEALTH_EVENT_CHANGED,
  type HealthEventChangedPayload,
} from '../../../common/events/domain-events.js';
import { ProductEventsService } from '../../product-events/index.js';

/**
 * `ProductEventResult` mirrors `HealthEventOutcome` string-for-string in the
 * schema (improved/unchanged/worsened); the explicit switch keeps the link
 * visible and type-checked.
 */
export function toProductEventResult(
  outcome: HealthEventOutcome,
): ProductEventResult {
  switch (outcome) {
    case HealthEventOutcome.improved:
      return ProductEventResult.improved;
    case HealthEventOutcome.unchanged:
      return ProductEventResult.unchanged;
    case HealthEventOutcome.worsened:
      return ProductEventResult.worsened;
  }
}

export interface CreateHealthEventInput {
  title: string;
  kind?: HealthEventKind | undefined;
  startedAt?: Date | undefined;
  reasonRecordId?: string | null | undefined;
  currentMedicineIds?: string[] | undefined;
}

export interface EndHealthEventInput {
  outcome?: string;
}

export interface HealthEventListView {
  items: HealthEventView[];
  total: number;
}

export function parseHealthEventOutcome(
  value: unknown,
): HealthEventOutcome | undefined {
  if (
    value === HealthEventOutcome.improved ||
    value === HealthEventOutcome.unchanged ||
    value === HealthEventOutcome.worsened
  ) {
    return value;
  }
  return undefined;
}

@Injectable()
export class EventsService {
  constructor(
    private readonly repository: HealthEventRepositoryPort,
    private readonly eventEmitter: EventEmitter2,
    private readonly productEvents: ProductEventsService,
  ) {}

  create(
    userId: string,
    input: CreateHealthEventInput,
  ): ResultAsync<HealthEventRecord, DomainFailure> {
    return fromPromise(this.repository.findActiveByUserId(userId), (error) => {
      throw error;
    }).andThen((active) => {
      if (active != null) {
        return errAsync(
          createDomainFailure({
            kind: 'conflict',
            code: 'RECORD_ALREADY_EXISTS',
          }),
        );
      }

      const currentMedicineIds = [...new Set(input.currentMedicineIds ?? [])];
      return fromPromise(
        this.repository.findOwnedCurrentMedicineIds(userId, currentMedicineIds),
        (error) => {
          throw error;
        },
      ).andThen((ownedMedicineIds) => {
        if (new Set(ownedMedicineIds).size !== currentMedicineIds.length) {
          return errAsync(this.notFound());
        }

        const reasonRecordId = input.reasonRecordId ?? null;
        if (reasonRecordId == null) {
          return this.persistCreate(
            userId,
            input,
            currentMedicineIds,
            reasonRecordId,
          );
        }
        return fromPromise(
          this.repository.findOwnedReasonRecord(userId, reasonRecordId),
          (error) => {
            throw error;
          },
        ).andThen((owned) => {
          if (!owned) {
            return errAsync(this.notFound());
          }
          return this.persistCreate(
            userId,
            input,
            currentMedicineIds,
            reasonRecordId,
          );
        });
      });
    });
  }

  private persistCreate(
    userId: string,
    input: CreateHealthEventInput,
    currentMedicineIds: string[],
    reasonRecordId: string | null,
  ): ResultAsync<HealthEventRecord, DomainFailure> {
    return this.repository
      .create({
        userId,
        title: input.title,
        kind: input.kind ?? HealthEventKind.symptom,
        status: HealthEventStatus.active,
        startedAt: input.startedAt ?? now(),
        reasonRecordId,
        currentMedicineIds,
      })
      .andThen((created) => {
        return (
          fromPromise(this.repository.findUserTimezone(userId), (error) => {
            throw error;
          })
            .andThen((timezone) =>
              fromPromise(
                this.eventEmitter.emitAsync(HEALTH_EVENT_CHANGED, {
                  userId,
                  eventId: created.id,
                  date: formatDateOnlyInTimezone(
                    created.startedAt,
                    timezone ?? DEFAULT_USER_TIMEZONE,
                  ),
                  change: 'create',
                  kind: created.kind ?? HealthEventKind.symptom,
                } satisfies HealthEventChangedPayload),
                (error) => {
                  throw error;
                },
              ),
            )
            // Server-authoritative lifecycle event — emitted only after the
            // create write succeeded; the client must not re-report
            // health_event_started. Deterministic clientEventId: a client retry
            // that re-runs this idempotent create is deduped by the
            // (userId, clientEventId) unique constraint. Caveat: a user-supplied
            // `startedAt` more than 24h in the future fails the product-event
            // future-skew check, so the started event is dropped
            // (low-sensitivity log + emission-failure metric only — the main
            // create is unaffected).
            .andThen(() =>
              fromPromise(
                this.productEvents.emitServerEvent(userId, {
                  name: ProductEventName.health_event_started,
                  surface: ProductEventSurface.review,
                  result: ProductEventResult.success,
                  eventStatus: HealthEventStatus.active,
                  occurredAt: created.startedAt,
                  clientEventId: `server-health-started-${created.id}`,
                }),
                (error) => {
                  throw error;
                },
              ),
            )
            .map(() => created)
        );
      });
  }

  findById(
    userId: string,
    eventId: string,
  ): ResultAsync<HealthEventRecord, DomainFailure> {
    return this.ensureOwnedByUser(userId, eventId);
  }

  findActive(userId: string): Promise<HealthEventRecord | null> {
    return this.repository.findActiveByUserId(userId);
  }

  async findActiveView(
    userId: string,
    date?: string,
  ): Promise<HealthEventView | null> {
    const event = await this.findActive(userId);
    return event == null ? null : this.buildView(userId, event, date);
  }

  async listViews(userId: string, date?: string): Promise<HealthEventListView> {
    const events = await this.repository.findManyByUserId(userId);
    if (events.length === 0) {
      return { items: [], total: 0 };
    }

    const resolvedDate = await this.resolveViewDate(userId, date);
    const items = await Promise.all(
      events.map((event) => this.buildView(userId, event, resolvedDate)),
    );
    return { items, total: items.length };
  }

  findByIdView(
    userId: string,
    eventId: string,
    date?: string,
  ): ResultAsync<HealthEventView, DomainFailure> {
    return this.findById(userId, eventId).andThen((event) =>
      this.buildViewAsResult(userId, event, date),
    );
  }

  ensureOwnedByUser(
    userId: string,
    eventId: string,
  ): ResultAsync<HealthEventRecord, DomainFailure> {
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
      return okAsync(event);
    });
  }

  ensureActiveOwnedByUser(
    userId: string,
    eventId: string,
  ): ResultAsync<HealthEventRecord, DomainFailure> {
    return this.ensureOwnedByUser(userId, eventId).andThen((event) => {
      if (event.status !== HealthEventStatus.active) {
        return errAsync(this.validationFailed());
      }
      return okAsync(event);
    });
  }

  end(
    userId: string,
    eventId: string,
    input: EndHealthEventInput | string | undefined,
  ): ResultAsync<HealthEventRecord, DomainFailure> {
    const outcome = parseHealthEventOutcome(
      typeof input === 'string' ? input : input?.outcome,
    );
    if (outcome == null) {
      return errAsync(this.validationFailed());
    }
    return this.ensureOwnedByUser(userId, eventId).andThen((event) => {
      if (event.status !== HealthEventStatus.active) {
        return errAsync(this.validationFailed());
      }

      const endedAt = now();
      return fromPromise(this.repository.findUserTimezone(userId), (error) => {
        throw error;
      }).andThen((timezone) =>
        this.repository
          .update(userId, eventId, {
            status: HealthEventStatus.ended,
            endedAt,
            outcome,
          })
          .andThen((updated) => {
            if (updated == null) {
              return errAsync(this.notFound());
            }
            return (
              fromPromise(
                this.eventEmitter.emitAsync(HEALTH_EVENT_CHANGED, {
                  userId,
                  eventId,
                  date: formatDateOnlyInTimezone(
                    endedAt,
                    timezone ?? DEFAULT_USER_TIMEZONE,
                  ),
                  change: 'end',
                  kind: updated.kind ?? HealthEventKind.symptom,
                } satisfies HealthEventChangedPayload),
                (error) => {
                  throw error;
                },
              )
                // The end flow carries the definitive outcome, so
                // health_event_ended reports it as `result`;
                // health_event_outcome_confirmed belongs to the daily check-in
                // (CheckInsService) — no double emission. Deterministic
                // clientEventId dedupes retries that re-run this idempotent
                // end write.
                .andThen(() =>
                  fromPromise(
                    this.productEvents.emitServerEvent(userId, {
                      name: ProductEventName.health_event_ended,
                      surface: ProductEventSurface.review,
                      result: toProductEventResult(outcome),
                      eventStatus: HealthEventStatus.ended,
                      occurredAt: endedAt,
                      clientEventId: `server-health-ended-${eventId}`,
                    }),
                    (error) => {
                      throw error;
                    },
                  ),
                )
                .map(() => updated)
            );
          }),
      );
    });
  }

  private buildViewAsResult(
    userId: string,
    event: HealthEventRecord,
    date?: string,
  ): ResultAsync<HealthEventView, DomainFailure> {
    return fromPromise(this.buildView(userId, event, date), (error) => {
      throw error;
    });
  }

  private async buildView(
    userId: string,
    event: HealthEventRecord,
    date?: string,
  ): Promise<HealthEventView> {
    const resolvedDate = await this.resolveViewDate(userId, date);
    const [checkIn, coverage] = await Promise.all([
      this.repository.findCheckIn(userId, event.id, resolvedDate),
      this.repository.findCheckInCoverage(userId, event.id),
    ]);
    return { ...event, checkIn, coverage };
  }

  private async resolveViewDate(
    userId: string,
    date?: string,
  ): Promise<string> {
    if (date != null) {
      return date;
    }

    const timezone = await this.repository.findUserTimezone(userId);
    return formatDateOnlyInTimezone(now(), timezone ?? DEFAULT_USER_TIMEZONE);
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
