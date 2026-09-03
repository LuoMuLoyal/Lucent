import {
  HealthEventKind,
  HealthEventOutcome,
  HealthEventStatus,
  ProductEventName,
  ProductEventResult,
  ProductEventSurface,
} from '#generated/prisma/client.js';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  HealthEventRepositoryPort,
  HealthEventRecord,
  HealthEventCheckInRecord,
} from '../repositories/event.repository.js';
import type { ProductEventsService } from '../../product-events/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../common/result/index.js';
import { fromPromise, okAsync } from '../../../common/result/index.js';
import { CheckInsService } from './check-ins.service.js';

const USER_ID = 'user-1';
const EVENT_ID = 'event-1';

async function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

function buildEventEmitter() {
  return {
    emitAsync: vi.fn().mockResolvedValue([]),
  } as unknown as EventEmitter2;
}

function buildProductEvents() {
  return {
    emitServerEvent: vi.fn().mockResolvedValue(undefined),
  } as unknown as ProductEventsService;
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
        okAsync(checkIn(outcome)),
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
      buildEventEmitter(),
      buildProductEvents(),
    );

    await collectResult(
      service.upsert(USER_ID, EVENT_ID, {
        outcome: HealthEventOutcome.improved,
      }),
    );
    await collectResult(
      service.upsert(USER_ID, EVENT_ID, {
        outcome: HealthEventOutcome.worsened,
      }),
    );

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
      buildEventEmitter(),
      buildProductEvents(),
    );

    await collectResult(
      service.upsert(USER_ID, EVENT_ID, {
        outcome: HealthEventOutcome.unchanged,
      }),
    );

    expect(repository.upsertCheckIn).toHaveBeenCalledWith(
      USER_ID,
      EVENT_ID,
      '2026-07-20',
      HealthEventOutcome.unchanged,
    );
    vi.useRealTimers();
  });

  it('accepts only the three HealthEventOutcome values (VALIDATION_FAILED)', async () => {
    const repository = buildRepository();
    const service = new CheckInsService(
      repository as unknown as HealthEventRepositoryPort,
      buildEventEmitter(),
      buildProductEvents(),
    );

    const result = await collectResult(
      service.upsert(USER_ID, EVENT_ID, { outcome: 'other' }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', code: 'VALIDATION_FAILED' },
    });
    expect(repository.upsertCheckIn).not.toHaveBeenCalled();
  });

  it('returns FORBIDDEN for another user event', async () => {
    const repository = buildRepository();
    repository.findById.mockResolvedValue(event({ userId: 'user-2' }));
    const service = new CheckInsService(
      repository as unknown as HealthEventRepositoryPort,
      buildEventEmitter(),
      buildProductEvents(),
    );

    const result = await collectResult(
      service.upsert(USER_ID, EVENT_ID, {
        outcome: HealthEventOutcome.improved,
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'authorization', code: 'FORBIDDEN' },
    });
    expect(repository.upsertCheckIn).not.toHaveBeenCalled();
  });

  it('returns RESOURCE_NOT_FOUND for a missing event', async () => {
    const repository = buildRepository();
    repository.findById.mockResolvedValue(null);
    const service = new CheckInsService(
      repository as unknown as HealthEventRepositoryPort,
      buildEventEmitter(),
      buildProductEvents(),
    );

    const result = await collectResult(
      service.upsert(USER_ID, EVENT_ID, {
        outcome: HealthEventOutcome.improved,
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
    });
    expect(repository.upsertCheckIn).not.toHaveBeenCalled();
  });

  it('does not allow check-ins after the event has ended (VALIDATION_FAILED)', async () => {
    const repository = buildRepository();
    repository.findById.mockResolvedValue(
      event({
        status: HealthEventStatus.ended,
        outcome: HealthEventOutcome.unchanged,
        endedAt: new Date('2026-07-21T00:30:00.000Z'),
      }),
    );
    const service = new CheckInsService(
      repository as unknown as HealthEventRepositoryPort,
      buildEventEmitter(),
      buildProductEvents(),
    );

    const result = await collectResult(
      service.upsert(USER_ID, EVENT_ID, {
        outcome: HealthEventOutcome.improved,
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', code: 'VALIDATION_FAILED' },
    });
    expect(repository.upsertCheckIn).not.toHaveBeenCalled();
  });

  it('rejects a malformed calendar date (VALIDATION_FAILED)', async () => {
    const repository = buildRepository();
    const service = new CheckInsService(
      repository as unknown as HealthEventRepositoryPort,
      buildEventEmitter(),
      buildProductEvents(),
    );

    const result = await collectResult(
      service.upsertForDate(USER_ID, EVENT_ID, '2026-13-99', {
        outcome: HealthEventOutcome.improved,
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', code: 'VALIDATION_FAILED' },
    });
    expect(repository.upsertCheckIn).not.toHaveBeenCalled();
  });

  it('emits once after a check-in is persisted', async () => {
    const repository = buildRepository();
    const eventEmitter = buildEventEmitter();
    const service = new CheckInsService(
      repository as unknown as HealthEventRepositoryPort,
      eventEmitter,
      buildProductEvents(),
    );

    await collectResult(
      service.upsertForDate(USER_ID, EVENT_ID, '2026-07-20', {
        outcome: HealthEventOutcome.improved,
      }),
    );

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
    repository.upsertCheckIn.mockReturnValue(
      fromPromise(Promise.reject(new Error('write failed')), (error) => {
        throw error;
      }),
    );
    const service = new CheckInsService(
      repository as unknown as HealthEventRepositoryPort,
      eventEmitter,
      buildProductEvents(),
    );

    await expect(
      service.upsertForDate(USER_ID, EVENT_ID, '2026-07-20', {
        outcome: HealthEventOutcome.improved,
      }),
    ).rejects.toThrow('write failed');
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });

  it('emits health_event_outcome_confirmed with the check-in outcome after the upsert succeeds', async () => {
    const repository = buildRepository();
    const productEvents = buildProductEvents();
    const service = new CheckInsService(
      repository as unknown as HealthEventRepositoryPort,
      buildEventEmitter(),
      productEvents,
    );

    await collectResult(
      service.upsertForDate(USER_ID, EVENT_ID, '2026-07-20', {
        outcome: HealthEventOutcome.worsened,
      }),
    );

    expect(productEvents.emitServerEvent).toHaveBeenCalledTimes(1);
    expect(productEvents.emitServerEvent).toHaveBeenCalledWith(USER_ID, {
      name: ProductEventName.health_event_outcome_confirmed,
      surface: ProductEventSurface.review,
      result: ProductEventResult.worsened,
      occurredAt: expect.any(Date),
      clientEventId: `server-checkin-${EVENT_ID}-2026-07-20`,
    });
  });

  it('does not emit the product event when the check-in write fails', async () => {
    const repository = buildRepository();
    const productEvents = buildProductEvents();
    repository.upsertCheckIn.mockReturnValue(
      fromPromise(Promise.reject(new Error('write failed')), (error) => {
        throw error;
      }),
    );
    const service = new CheckInsService(
      repository as unknown as HealthEventRepositoryPort,
      buildEventEmitter(),
      productEvents,
    );

    await expect(
      service.upsertForDate(USER_ID, EVENT_ID, '2026-07-20', {
        outcome: HealthEventOutcome.improved,
      }),
    ).rejects.toThrow('write failed');
    expect(productEvents.emitServerEvent).not.toHaveBeenCalled();
  });
});
