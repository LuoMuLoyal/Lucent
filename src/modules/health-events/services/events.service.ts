import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  HealthEventKind,
  HealthEventOutcome,
  HealthEventStatus,
  ProductEventName,
  ProductEventResult,
  ProductEventSurface,
} from '#generated/prisma/client';
import { I18nService } from 'nestjs-i18n';
import {
  DEFAULT_USER_TIMEZONE,
  badRequest,
  conflict,
  formatDateOnlyInTimezone,
  notFound,
  now,
} from '../../../common';
import {
  HealthEventActiveConflictError,
  HealthEventRepositoryPort,
  type HealthEventView,
  type HealthEventRecord,
} from '../repositories/event.repository';
import {
  HEALTH_EVENT_CHANGED,
  type HealthEventChangedPayload,
} from '../../../common/events/domain-events.js';
import { ProductEventsService } from '../../product-events';

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
  kind?: HealthEventKind;
  startedAt?: Date;
  reasonRecordId?: string | null;
  currentMedicineIds?: string[];
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
  invalidMessage = 'Health event outcome must be improved, unchanged, or worsened.',
): HealthEventOutcome {
  if (
    value === HealthEventOutcome.improved ||
    value === HealthEventOutcome.unchanged ||
    value === HealthEventOutcome.worsened
  ) {
    return value;
  }
  badRequest(invalidMessage);
}

@Injectable()
export class EventsService {
  constructor(
    private readonly repository: HealthEventRepositoryPort,
    private readonly i18n: I18nService,
    private readonly eventEmitter: EventEmitter2,
    private readonly productEvents: ProductEventsService,
  ) {}

  async create(
    userId: string,
    input: CreateHealthEventInput,
  ): Promise<HealthEventRecord> {
    const active = await this.repository.findActiveByUserId(userId);
    if (active != null) {
      conflict(this.i18n.t('health-events.active_conflict'));
    }

    const currentMedicineIds = [...new Set(input.currentMedicineIds ?? [])];
    const ownedMedicineIds = await this.repository.findOwnedCurrentMedicineIds(
      userId,
      currentMedicineIds,
    );
    if (new Set(ownedMedicineIds).size !== currentMedicineIds.length) {
      notFound(this.i18n.t('health-events.related_medicine_not_found'));
    }

    const reasonRecordId = input.reasonRecordId ?? null;
    if (
      reasonRecordId != null &&
      !(await this.repository.findOwnedReasonRecord(userId, reasonRecordId))
    ) {
      notFound(this.i18n.t('health-events.related_reason_record_not_found'));
    }

    let created: HealthEventRecord;
    try {
      created = await this.repository.create({
        userId,
        title: input.title,
        kind: input.kind ?? HealthEventKind.symptom,
        status: HealthEventStatus.active,
        startedAt: input.startedAt ?? now(),
        reasonRecordId,
        currentMedicineIds,
      });
    } catch (error) {
      if (error instanceof HealthEventActiveConflictError) {
        conflict(this.i18n.t('health-events.active_conflict'));
      }
      throw error;
    }

    const timezone = await this.repository.findUserTimezone(userId);
    await this.eventEmitter.emitAsync(HEALTH_EVENT_CHANGED, {
      userId,
      eventId: created.id,
      date: formatDateOnlyInTimezone(
        created.startedAt,
        timezone ?? DEFAULT_USER_TIMEZONE,
      ),
      change: 'create',
      kind: created.kind ?? HealthEventKind.symptom,
    } satisfies HealthEventChangedPayload);

    // Server-authoritative lifecycle event — emitted only after the create
    // write succeeded; the client must not re-report health_event_started.
    // Deterministic clientEventId: a client retry that re-runs this idempotent
    // create is deduped by the (userId, clientEventId) unique constraint.
    // Caveat: a user-supplied `startedAt` more than 24h in the future fails
    // the product-event future-skew check, so the started event is dropped
    // (low-sensitivity log + emission-failure metric only — the main create
    // is unaffected).
    await this.productEvents.emitServerEvent(userId, {
      name: ProductEventName.health_event_started,
      surface: ProductEventSurface.review,
      result: ProductEventResult.success,
      eventStatus: HealthEventStatus.active,
      occurredAt: created.startedAt,
      clientEventId: `server-health-started-${created.id}`,
    });
    return created;
  }

  async findById(userId: string, eventId: string): Promise<HealthEventRecord> {
    const event = await this.repository.findById(userId, eventId);
    if (event == null) {
      notFound(this.i18n.t('health-events.not_found'));
    }
    return event;
  }

  async findActive(userId: string): Promise<HealthEventRecord | null> {
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

  async findByIdView(
    userId: string,
    eventId: string,
    date?: string,
  ): Promise<HealthEventView> {
    const event = await this.findById(userId, eventId);
    return this.buildView(userId, event, date);
  }

  async ensureOwnedByUser(
    userId: string,
    eventId: string,
  ): Promise<HealthEventRecord> {
    return this.findById(userId, eventId);
  }

  async ensureActiveOwnedByUser(
    userId: string,
    eventId: string,
  ): Promise<HealthEventRecord> {
    const event = await this.ensureOwnedByUser(userId, eventId);
    if (event.status !== HealthEventStatus.active) {
      badRequest(this.i18n.t('health-events.inactive'));
    }
    return event;
  }

  async end(
    userId: string,
    eventId: string,
    input: EndHealthEventInput | string | undefined,
  ): Promise<HealthEventRecord> {
    const outcome = parseHealthEventOutcome(
      typeof input === 'string' ? input : input?.outcome,
      this.i18n.t('health-events.invalid_outcome'),
    );
    const event = await this.ensureOwnedByUser(userId, eventId);
    if (event.status !== HealthEventStatus.active) {
      badRequest(this.i18n.t('health-events.already_ended'));
    }

    const endedAt = now();
    const timezone = await this.repository.findUserTimezone(userId);
    const updated = await this.repository.update(userId, eventId, {
      status: HealthEventStatus.ended,
      endedAt,
      outcome,
    });
    if (updated == null) {
      notFound(this.i18n.t('health-events.not_found'));
    }
    await this.eventEmitter.emitAsync(HEALTH_EVENT_CHANGED, {
      userId,
      eventId,
      date: formatDateOnlyInTimezone(
        endedAt,
        timezone ?? DEFAULT_USER_TIMEZONE,
      ),
      change: 'end',
      kind: updated.kind ?? HealthEventKind.symptom,
    } satisfies HealthEventChangedPayload);

    // The end flow carries the definitive outcome, so health_event_ended
    // reports it as `result`; health_event_outcome_confirmed belongs to the
    // daily check-in (CheckInsService) — no double emission. Deterministic
    // clientEventId dedupes retries that re-run this idempotent end write.
    await this.productEvents.emitServerEvent(userId, {
      name: ProductEventName.health_event_ended,
      surface: ProductEventSurface.review,
      result: toProductEventResult(outcome),
      eventStatus: HealthEventStatus.ended,
      occurredAt: endedAt,
      clientEventId: `server-health-ended-${eventId}`,
    });
    return updated;
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
}
