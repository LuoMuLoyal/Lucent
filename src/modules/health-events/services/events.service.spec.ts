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
} from '../repositories/event.repository.js';
import type { ProductEventsService } from '../../product-events/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../common/result/index.js';
import { fromPromise, okAsync } from '../../../common/result/index.js';
import { EventsService } from './events.service.js';

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
    recordServerEvents: vi.fn().mockResolvedValue({ received: 1, recorded: 1 }),
    recordBatch: vi.fn().mockResolvedValue({ received: 1, recorded: 1 }),
  } as unknown as ProductEventsService;
}

function event(overrides: Partial<HealthEventRecord> = {}): HealthEventRecord {
  return {
    id: EVENT_ID,
    userId: USER_ID,
    title: 'Headache',
    kind: HealthEventKind.symptom,
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

function buildRepository() {
  return {
    findActiveByUserId: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(event()),
    findManyByUserId: vi.fn(),
    findPageByUserId: vi
      .fn()
      .mockResolvedValue({ items: [], hasMore: false, total: 0 }),
    findMostRecentEndedByUserId: vi.fn(),
    findCheckIn: vi.fn(),
    findCheckIns: vi.fn(),
    findCheckInCoverage: vi.fn(),
    findOwnedCurrentMedicineIds: vi.fn().mockResolvedValue([]),
    findOwnedReasonRecord: vi.fn().mockResolvedValue(true),
    create: vi.fn().mockReturnValue(okAsync(event())),
    update: vi.fn().mockReturnValue(okAsync(event())),
    upsertCheckIn: vi.fn(),
    findUserTimezone: vi.fn().mockResolvedValue(null),
  } satisfies Record<keyof HealthEventRepositoryPort, vi.Mock>;
}

function buildService(repository: ReturnType<typeof buildRepository>) {
  return new EventsService(
    repository as unknown as HealthEventRepositoryPort,
    buildEventEmitter(),
    buildProductEvents(),
  );
}

describe('EventsService', () => {
  it('creates an active event when the user has no active event', async () => {
    const repository = buildRepository();
    repository.findOwnedCurrentMedicineIds.mockResolvedValue(['medicine-1']);
    const service = buildService(repository);

    const result = await collectResult(
      service.create(USER_ID, {
        title: 'Headache',
        reasonRecordId: 'record-1',
        currentMedicineIds: ['medicine-1'],
      }),
    );

    expect(result).toMatchObject({ ok: true });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        title: 'Headache',
        status: HealthEventStatus.active,
        reasonRecordId: 'record-1',
        currentMedicineIds: ['medicine-1'],
        startedAt: expect.any(Date),
      }),
    );
  });

  it('emits once after creating an event', async () => {
    const repository = buildRepository();
    const eventEmitter = buildEventEmitter();
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      eventEmitter,
      buildProductEvents(),
    );

    await collectResult(service.create(USER_ID, { title: 'Headache' }));

    expect(eventEmitter.emitAsync).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      'health-event.changed',
      {
        userId: USER_ID,
        eventId: EVENT_ID,
        date: '2026-07-20',
        change: 'create',
        kind: HealthEventKind.symptom,
      },
    );
  });

  it('rejects creating a second active event for the same user with RECORD_ALREADY_EXISTS', async () => {
    const repository = buildRepository();
    repository.findActiveByUserId.mockResolvedValue(event());
    const service = buildService(repository);

    const result = await collectResult(
      service.create(USER_ID, { title: 'Other symptom' }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'conflict', code: 'RECORD_ALREADY_EXISTS' },
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects creating with a medicine the user does not own (RESOURCE_NOT_FOUND)', async () => {
    const repository = buildRepository();
    repository.findOwnedCurrentMedicineIds.mockResolvedValue(['medicine-2']);
    const service = buildService(repository);

    const result = await collectResult(
      service.create(USER_ID, {
        title: 'Headache',
        currentMedicineIds: ['medicine-1', 'medicine-2'],
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects creating with a reason record the user does not own (RESOURCE_NOT_FOUND)', async () => {
    const repository = buildRepository();
    repository.findOwnedReasonRecord.mockResolvedValue(false);
    const service = buildService(repository);

    const result = await collectResult(
      service.create(USER_ID, {
        title: 'Headache',
        reasonRecordId: 'foreign-record',
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('returns FORBIDDEN when reading another user event', async () => {
    const repository = buildRepository();
    repository.findById.mockResolvedValue(event({ userId: 'user-2' }));
    const service = buildService(repository);

    const result = await collectResult(service.findById(USER_ID, EVENT_ID));

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'authorization', code: 'FORBIDDEN' },
    });
    expect(repository.findById).toHaveBeenCalledWith(EVENT_ID);
  });

  it('returns RESOURCE_NOT_FOUND when the event does not exist', async () => {
    const repository = buildRepository();
    repository.findById.mockResolvedValue(null);
    const service = buildService(repository);

    const result = await collectResult(service.findById(USER_ID, EVENT_ID));

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
    });
  });

  it('requires a valid outcome when ending an owned event (VALIDATION_FAILED)', async () => {
    const repository = buildRepository();
    const service = buildService(repository);

    const emptyResult = await collectResult(service.end(USER_ID, EVENT_ID, {}));
    const invalidResult = await collectResult(
      service.end(USER_ID, EVENT_ID, { outcome: 'unknown' }),
    );

    expect(emptyResult).toMatchObject({
      ok: false,
      error: { kind: 'validation', code: 'VALIDATION_FAILED' },
    });
    expect(invalidResult).toMatchObject({
      ok: false,
      error: { kind: 'validation', code: 'VALIDATION_FAILED' },
    });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('ends an owned active event only after explicit outcome confirmation', async () => {
    const repository = buildRepository();
    const eventEmitter = buildEventEmitter();
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      eventEmitter,
      buildProductEvents(),
    );

    const result = await collectResult(
      service.end(USER_ID, EVENT_ID, {
        outcome: HealthEventOutcome.improved,
      }),
    );

    expect(result).toMatchObject({ ok: true });
    expect(repository.update).toHaveBeenCalledWith(
      USER_ID,
      EVENT_ID,
      expect.objectContaining({
        status: HealthEventStatus.ended,
        outcome: HealthEventOutcome.improved,
        endedAt: expect.any(Date),
      }),
    );
    expect(eventEmitter.emitAsync).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      'health-event.changed',
      expect.objectContaining({
        userId: USER_ID,
        eventId: EVENT_ID,
        change: 'end',
        date: expect.any(String),
      }),
    );
  });

  it('does not emit when creating an event fails to persist', async () => {
    const repository = buildRepository();
    const eventEmitter = buildEventEmitter();
    repository.create.mockReturnValue(
      fromPromise(Promise.reject(new Error('write failed')), (error) => {
        throw error;
      }),
    );
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      eventEmitter,
      buildProductEvents(),
    );

    await expect(
      service.create(USER_ID, { title: 'Headache' }),
    ).rejects.toThrow('write failed');
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });

  it('does not emit when ending an event fails to persist', async () => {
    const repository = buildRepository();
    const eventEmitter = buildEventEmitter();
    repository.update.mockReturnValue(
      fromPromise(Promise.reject(new Error('write failed')), (error) => {
        throw error;
      }),
    );
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      eventEmitter,
      buildProductEvents(),
    );

    await expect(
      service.end(USER_ID, EVENT_ID, {
        outcome: HealthEventOutcome.improved,
      }),
    ).rejects.toThrow('write failed');
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });

  it("does not end another user's event", async () => {
    const repository = buildRepository();
    repository.findById.mockResolvedValue(event({ userId: 'user-2' }));
    const service = buildService(repository);

    const result = await collectResult(
      service.end(USER_ID, EVENT_ID, { outcome: HealthEventOutcome.improved }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'authorization', code: 'FORBIDDEN' },
    });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('does not end an already ended event (VALIDATION_FAILED)', async () => {
    const repository = buildRepository();
    repository.findById.mockResolvedValue(
      event({
        status: HealthEventStatus.ended,
        endedAt: new Date('2026-07-21T00:30:00.000Z'),
        outcome: HealthEventOutcome.unchanged,
      }),
    );
    const service = buildService(repository);

    const result = await collectResult(
      service.end(USER_ID, EVENT_ID, { outcome: HealthEventOutcome.worsened }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', code: 'VALIDATION_FAILED' },
    });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('emits health_event_started after the create write succeeds', async () => {
    const repository = buildRepository();
    const productEvents = buildProductEvents();
    const startedAt = new Date('2026-07-20T00:30:00.000Z');
    repository.create.mockReturnValue(okAsync(event({ startedAt })));
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      buildEventEmitter(),
      productEvents,
    );

    await collectResult(service.create(USER_ID, { title: 'Headache' }));

    expect(productEvents.emitServerEvent).toHaveBeenCalledTimes(1);
    expect(productEvents.emitServerEvent).toHaveBeenCalledWith(USER_ID, {
      name: ProductEventName.health_event_started,
      surface: ProductEventSurface.review,
      result: ProductEventResult.success,
      eventStatus: HealthEventStatus.active,
      occurredAt: startedAt,
      clientEventId: `server-health-started-${EVENT_ID}`,
    });
  });

  it('emits health_event_ended with the chosen outcome as result', async () => {
    const repository = buildRepository();
    const productEvents = buildProductEvents();
    repository.update.mockReturnValue(
      okAsync(
        event({
          status: HealthEventStatus.ended,
          outcome: HealthEventOutcome.improved,
          endedAt: new Date('2026-07-21T00:30:00.000Z'),
        }),
      ),
    );
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      buildEventEmitter(),
      productEvents,
    );

    await collectResult(
      service.end(USER_ID, EVENT_ID, {
        outcome: HealthEventOutcome.improved,
      }),
    );

    expect(productEvents.emitServerEvent).toHaveBeenCalledTimes(1);
    expect(productEvents.emitServerEvent).toHaveBeenCalledWith(USER_ID, {
      name: ProductEventName.health_event_ended,
      surface: ProductEventSurface.review,
      result: ProductEventResult.improved,
      eventStatus: HealthEventStatus.ended,
      occurredAt: expect.any(Date),
      clientEventId: `server-health-ended-${EVENT_ID}`,
    });
  });

  it('does not emit product events when the create write fails', async () => {
    const repository = buildRepository();
    const productEvents = buildProductEvents();
    repository.create.mockReturnValue(
      fromPromise(Promise.reject(new Error('write failed')), (error) => {
        throw error;
      }),
    );
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      buildEventEmitter(),
      productEvents,
    );

    await expect(
      service.create(USER_ID, { title: 'Headache' }),
    ).rejects.toThrow('write failed');
    expect(productEvents.emitServerEvent).not.toHaveBeenCalled();
  });

  it('does not emit product events when the end write fails', async () => {
    const repository = buildRepository();
    const productEvents = buildProductEvents();
    repository.update.mockReturnValue(
      fromPromise(Promise.reject(new Error('write failed')), (error) => {
        throw error;
      }),
    );
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      buildEventEmitter(),
      productEvents,
    );

    await expect(
      service.end(USER_ID, EVENT_ID, {
        outcome: HealthEventOutcome.improved,
      }),
    ).rejects.toThrow('write failed');
    expect(productEvents.emitServerEvent).not.toHaveBeenCalled();
  });
});
