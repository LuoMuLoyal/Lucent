import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  HealthEventKind,
  HealthEventOutcome,
  HealthEventStatus,
} from '#generated/prisma/client';
import type { I18nService } from 'nestjs-i18n';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  HealthEventRepositoryPort,
  HealthEventRecord,
  HealthEventCheckInRecord,
} from '../repositories/event.repository';
import { CheckInsService } from './check-ins.service';

const USER_ID = 'user-1';
const EVENT_ID = 'event-1';

function buildI18n() {
  return {
    t: vi.fn().mockImplementation((key: string) => key),
  } as unknown as I18nService;
}

function buildEventEmitter() {
  return {
    emitAsync: vi.fn().mockResolvedValue([]),
  } as unknown as EventEmitter2;
}

function event(overrides: Partial<HealthEventRecord> = {}): HealthEventRecord {
  return {
    id: EVENT_ID,
    userId: USER_ID,
    title: 'Headache',
    status: HealthEventStatus.active,
    startedAt: new Date('2026-07-20T00:30:00.000Z'),
    endedAt: null,
    outcome: null,
    reasonRecordId: null,
    deletedAt: null,
    currentMedicineIds: [],
    ...overrides,
  };
}

function checkIn(outcome: HealthEventOutcome): HealthEventCheckInRecord {
  return {
    id: 'check-in-1',
    eventId: EVENT_ID,
    date: new Date('2026-07-20T00:00:00.000Z'),
    outcome,
    createdAt: new Date('2026-07-20T01:00:00.000Z'),
    updatedAt: new Date('2026-07-20T01:00:00.000Z'),
  };
}

function buildRepository() {
  return {
    findActiveByUserId: vi.fn(),
    findById: vi.fn().mockResolvedValue(event()),
    findManyByUserId: vi.fn(),
    findPageByUserId: vi
      .fn()
      .mockResolvedValue({ items: [], hasMore: false, total: 0 }),
    findMostRecentEndedByUserId: vi.fn(),
    findCheckIn: vi.fn(),
    findCheckIns: vi.fn(),
    findCheckInCoverage: vi.fn(),
    findOwnedCurrentMedicineIds: vi.fn(),
    findOwnedReasonRecord: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsertCheckIn: vi
      .fn()
      .mockImplementation((_userId, _eventId, _date, outcome) =>
        Promise.resolve(checkIn(outcome)),
      ),
    findUserTimezone: vi.fn().mockResolvedValue('America/New_York'),
  } satisfies Record<keyof HealthEventRepositoryPort, vi.Mock>;
}

describe('CheckInsService', () => {
  it('upserts one check-in per event and local calendar day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T02:30:00.000Z'));
    const repository = buildRepository();
    const service = new CheckInsService(
      repository as unknown as HealthEventRepositoryPort,
      buildI18n(),
      buildEventEmitter(),
    );

    await service.upsert(USER_ID, EVENT_ID, {
      outcome: HealthEventOutcome.improved,
    });
    await service.upsert(USER_ID, EVENT_ID, {
      outcome: HealthEventOutcome.worsened,
    });

    expect(repository.upsertCheckIn).toHaveBeenNthCalledWith(
      1,
      USER_ID,
      EVENT_ID,
      '2026-07-19',
      HealthEventOutcome.improved,
    );
    expect(repository.upsertCheckIn).toHaveBeenNthCalledWith(
      2,
      USER_ID,
      EVENT_ID,
      '2026-07-19',
      HealthEventOutcome.worsened,
    );
    vi.useRealTimers();
  });

  it('falls back to Asia/Shanghai when the profile timezone is missing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T16:30:00.000Z'));
    const repository = buildRepository();
    repository.findUserTimezone.mockResolvedValue(null);
    const service = new CheckInsService(
      repository as unknown as HealthEventRepositoryPort,
      buildI18n(),
      buildEventEmitter(),
    );

    await service.upsert(USER_ID, EVENT_ID, {
      outcome: HealthEventOutcome.unchanged,
    });

    expect(repository.upsertCheckIn).toHaveBeenCalledWith(
      USER_ID,
      EVENT_ID,
      '2026-07-20',
      HealthEventOutcome.unchanged,
    );
    vi.useRealTimers();
  });

  it('accepts only the three HealthEventOutcome values', async () => {
    const repository = buildRepository();
    const i18n = buildI18n();
    const service = new CheckInsService(
      repository as unknown as HealthEventRepositoryPort,
      i18n,
      buildEventEmitter(),
    );

    await expect(
      service.upsert(USER_ID, EVENT_ID, { outcome: 'other' }),
    ).rejects.toMatchObject({
      response: { message: 'health-events.invalid_outcome' },
    });
    expect(i18n.t).toHaveBeenCalledWith('health-events.invalid_outcome');
    expect(repository.upsertCheckIn).not.toHaveBeenCalled();
  });

  it('rejects a check-in for another user event with not-found semantics', async () => {
    const repository = buildRepository();
    const i18n = buildI18n();
    repository.findById.mockResolvedValue(null);
    const service = new CheckInsService(
      repository as unknown as HealthEventRepositoryPort,
      i18n,
      buildEventEmitter(),
    );

    await expect(
      service.upsert('user-2', EVENT_ID, {
        outcome: HealthEventOutcome.improved,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.upsertCheckIn).not.toHaveBeenCalled();
  });

  it('does not allow check-ins after the event has ended', async () => {
    const repository = buildRepository();
    const i18n = buildI18n();
    repository.findById.mockResolvedValue(
      event({
        status: HealthEventStatus.ended,
        outcome: HealthEventOutcome.unchanged,
        endedAt: new Date('2026-07-21T00:30:00.000Z'),
      }),
    );
    const service = new CheckInsService(
      repository as unknown as HealthEventRepositoryPort,
      i18n,
      buildEventEmitter(),
    );

    await expect(
      service.upsert(USER_ID, EVENT_ID, {
        outcome: HealthEventOutcome.improved,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.upsertCheckIn).not.toHaveBeenCalled();
  });

  it('emits once after a check-in is persisted', async () => {
    const repository = buildRepository();
    const eventEmitter = buildEventEmitter();
    const service = new CheckInsService(
      repository as unknown as HealthEventRepositoryPort,
      buildI18n(),
      eventEmitter,
    );

    await service.upsertForDate(USER_ID, EVENT_ID, '2026-07-20', {
      outcome: HealthEventOutcome.improved,
    });

    expect(eventEmitter.emitAsync).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      'health-event.changed',
      {
        userId: USER_ID,
        eventId: EVENT_ID,
        date: '2026-07-20',
        change: 'check-in',
        kind: HealthEventKind.symptom,
      },
    );
  });

  it('does not emit when a check-in write fails', async () => {
    const repository = buildRepository();
    const eventEmitter = buildEventEmitter();
    repository.upsertCheckIn.mockRejectedValue(new Error('write failed'));
    const service = new CheckInsService(
      repository as unknown as HealthEventRepositoryPort,
      buildI18n(),
      eventEmitter,
    );

    await expect(
      service.upsertForDate(USER_ID, EVENT_ID, '2026-07-20', {
        outcome: HealthEventOutcome.improved,
      }),
    ).rejects.toThrow('write failed');
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });
});
