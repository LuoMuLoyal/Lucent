import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  HealthEventKind,
  HealthEventOutcome,
  HealthEventStatus,
  ProductEventName,
  ProductEventResult,
  ProductEventSurface,
} from '#generated/prisma/client';
import type { I18nService } from 'nestjs-i18n';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { HealthEventActiveConflictError } from '../repositories/event.repository';
import type {
  HealthEventRepositoryPort,
  HealthEventRecord,
} from '../repositories/event.repository';
import type { ProductEventsService } from '../../product-events';
import { EventsService } from './events.service';

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
    create: vi.fn().mockResolvedValue(event()),
    update: vi.fn().mockResolvedValue(event()),
    upsertCheckIn: vi.fn(),
    findUserTimezone: vi.fn().mockResolvedValue(null),
  } satisfies Record<keyof HealthEventRepositoryPort, vi.Mock>;
}

describe('EventsService', () => {
  it('creates an active event when the user has no active event', async () => {
    const repository = buildRepository();
    const i18n = buildI18n();
    repository.findOwnedCurrentMedicineIds.mockResolvedValue(['medicine-1']);
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      i18n,
      buildEventEmitter(),
      buildProductEvents(),
    );

    await service.create(USER_ID, {
      title: 'Headache',
      reasonRecordId: 'record-1',
      currentMedicineIds: ['medicine-1'],
    });

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
    const i18n = buildI18n();
    const eventEmitter = buildEventEmitter();
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      i18n,
      eventEmitter,
      buildProductEvents(),
    );

    await service.create(USER_ID, { title: 'Headache' });

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

  it('rejects creating a second active event for the same user', async () => {
    const repository = buildRepository();
    const i18n = buildI18n();
    repository.findActiveByUserId.mockResolvedValue(event());
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      i18n,
      buildEventEmitter(),
      buildProductEvents(),
    );

    await expect(
      service.create(USER_ID, { title: 'Other symptom' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('maps a repository active conflict to a localized conflict exception', async () => {
    const repository = buildRepository();
    const i18n = buildI18n();
    repository.create.mockRejectedValue(new HealthEventActiveConflictError());
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      i18n,
      buildEventEmitter(),
      buildProductEvents(),
    );

    await expect(
      service.create(USER_ID, { title: 'Headache' }),
    ).rejects.toMatchObject({
      response: { message: 'health-events.active_conflict' },
    });
    expect(i18n.t).toHaveBeenCalledWith('health-events.active_conflict');
  });

  it('uses one not-found result when reading another user event', async () => {
    const repository = buildRepository();
    const i18n = buildI18n();
    repository.findById.mockResolvedValue(null);
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      i18n,
      buildEventEmitter(),
      buildProductEvents(),
    );

    await expect(service.findById('user-2', EVENT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repository.findById).toHaveBeenCalledWith('user-2', EVENT_ID);
  });

  it('requires a valid outcome when ending an owned event', async () => {
    const repository = buildRepository();
    const i18n = buildI18n();
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      i18n,
      buildEventEmitter(),
      buildProductEvents(),
    );

    await expect(service.end(USER_ID, EVENT_ID, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.end(USER_ID, EVENT_ID, { outcome: 'unknown' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('ends an owned active event only after explicit outcome confirmation', async () => {
    const repository = buildRepository();
    const i18n = buildI18n();
    const eventEmitter = buildEventEmitter();
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      i18n,
      eventEmitter,
      buildProductEvents(),
    );

    await service.end(USER_ID, EVENT_ID, {
      outcome: HealthEventOutcome.improved,
    });

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
    const i18n = buildI18n();
    const eventEmitter = buildEventEmitter();
    repository.create.mockRejectedValue(new Error('write failed'));
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      i18n,
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
    const i18n = buildI18n();
    const eventEmitter = buildEventEmitter();
    repository.update.mockRejectedValue(new Error('write failed'));
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      i18n,
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
    const i18n = buildI18n();
    repository.findById.mockResolvedValue(null);
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      i18n,
      buildEventEmitter(),
      buildProductEvents(),
    );

    await expect(
      service.end('user-2', EVENT_ID, { outcome: HealthEventOutcome.improved }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('does not end an already ended event', async () => {
    const repository = buildRepository();
    const i18n = buildI18n();
    repository.findById.mockResolvedValue(
      event({
        status: HealthEventStatus.ended,
        endedAt: new Date('2026-07-21T00:30:00.000Z'),
        outcome: HealthEventOutcome.unchanged,
      }),
    );
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      i18n,
      buildEventEmitter(),
      buildProductEvents(),
    );

    await expect(
      service.end(USER_ID, EVENT_ID, { outcome: HealthEventOutcome.worsened }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('uses localized copy for invalid outcomes', async () => {
    const repository = buildRepository();
    const i18n = buildI18n();
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      i18n,
      buildEventEmitter(),
      buildProductEvents(),
    );

    await expect(
      service.end(USER_ID, EVENT_ID, { outcome: 'unknown' }),
    ).rejects.toMatchObject({
      response: { message: 'health-events.invalid_outcome' },
    });
    expect(i18n.t).toHaveBeenCalledWith('health-events.invalid_outcome');
  });

  it('emits health_event_started after the create write succeeds', async () => {
    const repository = buildRepository();
    const productEvents = buildProductEvents();
    const startedAt = new Date('2026-07-20T00:30:00.000Z');
    repository.create.mockResolvedValue(event({ startedAt }));
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      buildI18n(),
      buildEventEmitter(),
      productEvents,
    );

    await service.create(USER_ID, { title: 'Headache' });

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
    repository.update.mockResolvedValue(
      event({
        status: HealthEventStatus.ended,
        outcome: HealthEventOutcome.improved,
        endedAt: new Date('2026-07-21T00:30:00.000Z'),
      }),
    );
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      buildI18n(),
      buildEventEmitter(),
      productEvents,
    );

    await service.end(USER_ID, EVENT_ID, {
      outcome: HealthEventOutcome.improved,
    });

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
    repository.create.mockRejectedValue(new Error('write failed'));
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      buildI18n(),
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
    repository.update.mockRejectedValue(new Error('write failed'));
    const service = new EventsService(
      repository as unknown as HealthEventRepositoryPort,
      buildI18n(),
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
