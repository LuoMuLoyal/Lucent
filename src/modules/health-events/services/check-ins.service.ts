import { Injectable } from '@nestjs/common';
import { HealthEventStatus } from '#generated/prisma/client';
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
  type EndHealthEventInput,
} from './events.service';

export type UpsertCheckInInput = EndHealthEventInput;

@Injectable()
export class CheckInsService {
  constructor(
    private readonly repository: HealthEventRepositoryPort,
    private readonly i18n: I18nService,
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
