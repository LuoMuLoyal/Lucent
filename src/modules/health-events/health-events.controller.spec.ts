import { Test, type TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import {
  HealthEventKind,
  HealthEventOutcome,
  HealthEventStatus,
} from '#generated/prisma/client.js';
import { okAsync, errAsync } from '../../common/result/index.js';
import type { DomainFailure } from '../../common/result/index.js';
import type { UserPayload } from '../auth/index.js';
import { HealthEventsController } from './health-events.controller.js';
import { CreateHealthEventDto } from './dto/create-event.dto.js';
import { EndHealthEventDto } from './dto/end-event.dto.js';
import { EventListQueryDto } from './dto/event-list-query.dto.js';
import { UpsertHealthEventCheckInDto } from './dto/upsert-check-in.dto.js';
import { CheckInsService } from './services/check-ins.service.js';
import { EventsService } from './services/events.service.js';

const user: UserPayload = {
  sub: 'user-1',
  email: 'user@example.com',
  status: 'active',
};

const eventView = {
  id: 'event-1',
  kind: HealthEventKind.symptom,
  title: 'Headache',
  status: HealthEventStatus.active,
  startedAt: '2026-08-09T00:00:00.000Z',
  endedAt: null,
  outcome: null,
  reasonRecordId: 'record-1',
  currentMedicineIds: ['medicine-1'],
  checkIn: null,
  coverage: {
    checkInCount: 0,
    firstCheckInDate: null,
    lastCheckInDate: null,
  },
};

const notFoundFailure: DomainFailure = {
  _tag: 'DomainFailure',
  kind: 'not_found',
  code: 'RESOURCE_NOT_FOUND',
};
const forbiddenFailure: DomainFailure = {
  _tag: 'DomainFailure',
  kind: 'authorization',
  code: 'FORBIDDEN',
};
const conflictFailure: DomainFailure = {
  _tag: 'DomainFailure',
  kind: 'conflict',
  code: 'RECORD_ALREADY_EXISTS',
};

describe('HealthEventsController', () => {
  let controller: HealthEventsController;
  let eventsService: vi.Mocked<EventsService>;
  let checkInsService: vi.Mocked<CheckInsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthEventsController],
      providers: [
        {
          provide: EventsService,
          useValue: {
            create: vi.fn().mockReturnValue(okAsync(eventView)),
            findActiveView: vi.fn(),
            listViews: vi.fn(),
            findByIdView: vi.fn().mockReturnValue(okAsync(eventView)),
            end: vi.fn().mockReturnValue(okAsync(eventView)),
          },
        },
        {
          provide: CheckInsService,
          useValue: {
            upsertForDate: vi.fn().mockReturnValue(okAsync(eventView)),
          },
        },
      ],
    }).compile();

    controller = module.get(HealthEventsController);
    eventsService = module.get(EventsService);
    checkInsService = module.get(CheckInsService);
  });

  it('creates an event for the authenticated user and returns a resource', async () => {
    const dto = {
      title: 'Headache',
      reasonRecordId: 'record-1',
      currentMedicineIds: ['medicine-1'],
    } as CreateHealthEventDto;
    eventsService.create.mockReturnValue(okAsync(eventView as never));

    const result = await controller.create(user, dto);

    expect(eventsService.create).toHaveBeenCalledWith(user.sub, dto);
    expect(result).toEqual(eventView);
  });

  it('throws DomainFailureException with RECORD_ALREADY_EXISTS when an active event exists', async () => {
    eventsService.create.mockReturnValue(errAsync(conflictFailure));

    await expect(
      controller.create(user, { title: 'X' } as never),
    ).rejects.toMatchObject({
      failure: { kind: 'conflict', code: 'RECORD_ALREADY_EXISTS' },
    });
  });

  it('lists the active event with an optional requested date', async () => {
    eventsService.findActiveView.mockResolvedValue(eventView as never);

    const result = await controller.active(user, { date: '2026-08-08' });

    expect(eventsService.findActiveView).toHaveBeenCalledWith(
      user.sub,
      '2026-08-08',
    );
    expect(result).toEqual(eventView);
  });

  it('lists the authenticated user events and forwards the requested date', async () => {
    eventsService.listViews.mockResolvedValue({
      items: [eventView],
      total: 1,
    } as never);

    const result = await controller.list(user, { date: '2026-08-08' });

    expect(eventsService.listViews).toHaveBeenCalledWith(
      user.sub,
      '2026-08-08',
    );
    expect(result).toEqual({ items: [eventView], total: 1 });
  });

  it('gets detail by user-scoped id and forwards the requested date', async () => {
    eventsService.findByIdView.mockReturnValue(okAsync(eventView as never));

    const result = await controller.get(user, 'event-1', {
      date: '2026-08-08',
    });

    expect(eventsService.findByIdView).toHaveBeenCalledWith(
      user.sub,
      'event-1',
      '2026-08-08',
    );
    expect(result).toEqual(eventView);
  });

  it('folds a foreign event into DomainFailureException with FORBIDDEN', async () => {
    eventsService.findByIdView.mockReturnValue(errAsync(forbiddenFailure));

    await expect(
      controller.get(user, 'event-owned-by-someone-else', {}),
    ).rejects.toMatchObject({
      failure: { kind: 'authorization', code: 'FORBIDDEN' },
    });
    expect(eventsService.findByIdView).toHaveBeenCalledWith(
      user.sub,
      'event-owned-by-someone-else',
      undefined,
    );
  });

  it('folds a missing event into DomainFailureException with RESOURCE_NOT_FOUND', async () => {
    eventsService.findByIdView.mockReturnValue(errAsync(notFoundFailure));

    await expect(
      controller.get(user, 'missing-event', {}),
    ).rejects.toMatchObject({
      failure: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
    });
  });

  it('uses the path date for a check-in instead of resolving a server date', async () => {
    const dto = {
      outcome: HealthEventOutcome.improved,
    } as UpsertHealthEventCheckInDto;
    checkInsService.upsertForDate.mockReturnValue(
      okAsync({
        id: 'check-in-1',
        eventId: 'event-1',
        date: '2026-08-08',
        outcome: HealthEventOutcome.improved,
      } as never),
    );
    eventsService.findByIdView.mockReturnValue(
      okAsync({
        ...eventView,
        checkIn: {
          id: 'check-in-1',
          eventId: 'event-1',
          date: '2026-08-08',
          outcome: HealthEventOutcome.improved,
          createdAt: '2026-08-08T08:00:00.000Z',
          updatedAt: '2026-08-08T08:00:00.000Z',
        },
        coverage: {
          checkInCount: 1,
          firstCheckInDate: '2026-08-08',
          lastCheckInDate: '2026-08-08',
        },
      } as never),
    );

    const result = await controller.upsertCheckIn(
      user,
      'event-1',
      '2026-08-08',
      dto,
    );

    expect(checkInsService.upsertForDate).toHaveBeenCalledWith(
      user.sub,
      'event-1',
      '2026-08-08',
      dto,
    );
    expect(eventsService.findByIdView).toHaveBeenCalledWith(
      user.sub,
      'event-1',
      '2026-08-08',
    );
    expect(result).toMatchObject({
      checkIn: { date: '2026-08-08', outcome: HealthEventOutcome.improved },
      coverage: {
        checkInCount: 1,
        firstCheckInDate: '2026-08-08',
        lastCheckInDate: '2026-08-08',
      },
    });
  });

  it('folds an inactive-event check-in into DomainFailureException with VALIDATION_FAILED', async () => {
    const dto = {
      outcome: HealthEventOutcome.improved,
    } as UpsertHealthEventCheckInDto;
    const validationFailure: DomainFailure = {
      _tag: 'DomainFailure',
      kind: 'validation',
      code: 'VALIDATION_FAILED',
    };
    checkInsService.upsertForDate.mockReturnValue(errAsync(validationFailure));

    await expect(
      controller.upsertCheckIn(user, 'event-1', '2026-08-08', dto),
    ).rejects.toMatchObject({
      failure: { kind: 'validation', code: 'VALIDATION_FAILED' },
    });
    expect(eventsService.findByIdView).not.toHaveBeenCalled();
  });

  it('folds a duplicate check-in race into DomainFailureException with RESOURCE_CONFLICT', async () => {
    const dto = {
      outcome: HealthEventOutcome.improved,
    } as UpsertHealthEventCheckInDto;
    const conflictFailure: DomainFailure = {
      _tag: 'DomainFailure',
      kind: 'conflict',
      code: 'RESOURCE_CONFLICT',
    };
    checkInsService.upsertForDate.mockReturnValue(errAsync(conflictFailure));

    await expect(
      controller.upsertCheckIn(user, 'event-1', '2026-08-08', dto),
    ).rejects.toMatchObject({
      failure: { kind: 'conflict', code: 'RESOURCE_CONFLICT' },
    });
    expect(eventsService.findByIdView).not.toHaveBeenCalled();
  });

  it('ends an event with the explicit outcome for the authenticated user', async () => {
    const dto = { outcome: HealthEventOutcome.worsened } as EndHealthEventDto;
    eventsService.end.mockReturnValue(
      okAsync({
        ...eventView,
        status: HealthEventStatus.ended,
        outcome: HealthEventOutcome.worsened,
      } as never),
    );
    eventsService.findByIdView.mockReturnValue(
      okAsync({
        ...eventView,
        status: HealthEventStatus.ended,
        endedAt: '2026-08-09T12:00:00.000Z',
        outcome: HealthEventOutcome.worsened,
        checkIn: {
          id: 'check-in-1',
          eventId: 'event-1',
          date: '2026-08-08',
          outcome: HealthEventOutcome.improved,
          createdAt: '2026-08-08T08:00:00.000Z',
          updatedAt: '2026-08-08T08:00:00.000Z',
        },
        coverage: {
          checkInCount: 1,
          firstCheckInDate: '2026-08-08',
          lastCheckInDate: '2026-08-08',
        },
      } as never),
    );

    const result = await controller.end(user, 'event-1', dto);

    expect(eventsService.end).toHaveBeenCalledWith(user.sub, 'event-1', dto);
    expect(eventsService.findByIdView).toHaveBeenCalledWith(
      user.sub,
      'event-1',
    );
    expect(result).toMatchObject({
      status: HealthEventStatus.ended,
      endedAt: '2026-08-09T12:00:00.000Z',
      outcome: HealthEventOutcome.worsened,
      checkIn: { date: '2026-08-08' },
      coverage: {
        checkInCount: 1,
        firstCheckInDate: '2026-08-08',
        lastCheckInDate: '2026-08-08',
      },
    });
  });

  it('folds an already-ended event into DomainFailureException with VALIDATION_FAILED', async () => {
    const dto = { outcome: HealthEventOutcome.worsened } as EndHealthEventDto;
    const validationFailure: DomainFailure = {
      _tag: 'DomainFailure',
      kind: 'validation',
      code: 'VALIDATION_FAILED',
    };
    eventsService.end.mockReturnValue(errAsync(validationFailure));

    await expect(controller.end(user, 'event-1', dto)).rejects.toMatchObject({
      failure: { kind: 'validation', code: 'VALIDATION_FAILED' },
    });
    expect(eventsService.findByIdView).not.toHaveBeenCalled();
  });
});

describe('Health event HTTP DTO validation', () => {
  it('requires a non-empty short title and limits its length', async () => {
    const emptyTitle = Object.assign(new CreateHealthEventDto(), {
      title: ' ',
    });
    const longTitle = Object.assign(new CreateHealthEventDto(), {
      title: 'x'.repeat(81),
    });

    expect(await validate(emptyTitle)).not.toHaveLength(0);
    expect(await validate(longTitle)).not.toHaveLength(0);
  });

  it('accepts only outcome enum values for end and check-in DTOs', async () => {
    const endDto = Object.assign(new EndHealthEventDto(), { outcome: 'other' });
    const checkInDto = Object.assign(new UpsertHealthEventCheckInDto(), {
      outcome: 'other',
    });

    expect(await validate(endDto)).not.toHaveLength(0);
    expect(await validate(checkInDto)).not.toHaveLength(0);
  });

  it('accepts only YYYY-MM-DD dates in list query and path DTO validation', async () => {
    const valid = Object.assign(new EventListQueryDto(), {
      date: '2026-08-08',
    });
    const invalid = Object.assign(new EventListQueryDto(), {
      date: '2026-08-08T00:00:00.000Z',
    });

    expect(await validate(valid)).toHaveLength(0);
    expect(await validate(invalid)).not.toHaveLength(0);
  });
});
