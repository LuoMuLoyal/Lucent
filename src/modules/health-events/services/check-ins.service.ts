import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  HealthEventKind,
  HealthEventStatus,
  ProductEventName,
  ProductEventSurface,
} from '#generated/prisma/client';
import { I18nService } from 'nestjs-i18n';
import {
  DEFAULT_USER_TIMEZONE,
  badRequest,
  formatDateOnly,
  formatDateOnlyInTimezone,
  notFound,
  now,
  parseDateOnly,
} from '../../../common';
import {
  HealthEventRepositoryPort,
  type HealthEventCheckInRecord,
} from '../repositories/event.repository';
import {
  parseHealthEventOutcome,
  toProductEventResult,
  type EndHealthEventInput,
} from './events.service';
import {
  HEALTH_EVENT_CHANGED,
  type HealthEventChangedPayload,
} from '../../../common/events/domain-events.js';
import { ProductEventsService } from '../../product-events';

export type UpsertCheckInInput = EndHealthEventInput;

@Injectable()
export class CheckInsService {
  constructor(
    private readonly repository: HealthEventRepositoryPort,
    private readonly i18n: I18nService,
    private readonly eventEmitter: EventEmitter2,
    private readonly productEvents: ProductEventsService,
  ) {}

  async upsert(
    userId: string,
    eventId: string,
    input: UpsertCheckInInput | string | undefined,
    at: Date = now(),
  ): Promise<HealthEventCheckInRecord> {
    const timezone = await this.repository.findUserTimezone(userId);
    const date = formatDateOnlyInTimezone(
      at,
      timezone ?? DEFAULT_USER_TIMEZONE,
    );
    return this.upsertForDate(userId, eventId, date, input);
  }

  async upsertForDate(
    userId: string,
    eventId: string,
    date: string,
    input: UpsertCheckInInput | string | undefined,
  ): Promise<HealthEventCheckInRecord> {
    const outcome = parseHealthEventOutcome(
      typeof input === 'string' ? input : input?.outcome,
      this.i18n.t('health-events.invalid_outcome'),
    );
    if (!this.isValidDateOnly(date)) {
      badRequest(this.i18n.t('health-events.invalid_date'));
    }

    const event = await this.repository.findById(userId, eventId);
    if (event == null) {
      notFound(this.i18n.t('health-events.not_found'));
    }
    if (event.status !== HealthEventStatus.active) {
      badRequest(this.i18n.t('health-events.inactive'));
    }

    const checkIn = await this.repository.upsertCheckIn(
      userId,
      eventId,
      date,
      outcome,
    );
    if (checkIn == null) {
      notFound(this.i18n.t('health-events.not_found'));
    }
    await this.eventEmitter.emitAsync(HEALTH_EVENT_CHANGED, {
      userId,
      eventId,
      date,
      change: 'check-in',
      kind: event.kind ?? HealthEventKind.symptom,
    } satisfies HealthEventChangedPayload);

    // A successful check-in confirms the user's outcome for that day —
    // server-authoritative, emitted only after the upsert write succeeded.
    // Deterministic clientEventId: the upsert is per (event, calendar date),
    // so a retry yields the same id and the unique constraint dedupes it.
    await this.productEvents.emitServerEvent(userId, {
      name: ProductEventName.health_event_outcome_confirmed,
      surface: ProductEventSurface.review,
      result: toProductEventResult(outcome),
      occurredAt: now(),
      clientEventId: `server-checkin-${eventId}-${date}`,
    });
    return checkIn;
  }

  private isValidDateOnly(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }

    const parsed = parseDateOnly(value);
    return !Number.isNaN(parsed.getTime()) && formatDateOnly(parsed) === value;
  }
}
