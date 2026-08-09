import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import {
  HealthEventOutcome,
  HealthEventStatus,
} from '#generated/prisma/client';
import { ResultCode } from '../../common';
import type { UserPayload } from '../auth';
import { HealthEventsController } from './health-events.controller';
import { CreateHealthEventDto } from './dto/create-event.dto';
import { EndHealthEventDto } from './dto/end-event.dto';
import { EventListQueryDto } from './dto/event-list-query.dto';
import { UpsertHealthEventCheckInDto } from './dto/upsert-check-in.dto';
import { CheckInsService } from './services/check-ins.service';
import { EventsService } from './services/events.service';

const user: UserPayload = {
  sub: 'user-1',
  email: 'user@example.com',
  status: 'active',
};

const eventView = {
  id: 'event-1',
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
            create: vi.fn(),
            findActiveView: vi.fn(),
            listViews: vi.fn(),
            findByIdView: vi.fn(),
            end: vi.fn(),
          },
        },
        {
          provide: CheckInsService,
          useValue: {
            upsertForDate: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(HealthEventsController);
    eventsService = module.get(EventsService);
    checkInsService = module.get(CheckInsService);
  });

  it('creates an event for the authenticated user and returns an envelope', async () => {
    const dto = {
      title: 'Headache',
      reasonRecordId: 'record-1',
      currentMedicineIds: ['medicine-1'],
    } as CreateHealthEventDto;
    eventsService.create.mockResolvedValue(eventView as never);

    const result = await controller.create(user, dto);

    expect(eventsService.create).toHaveBeenCalledWith(user.sub, dto);
    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: eventView,
    });
  });

  it('lists the active event with an optional requested date', async () => {
    eventsService.findActiveView.mockResolvedValue(eventView as never);

    const result = await controller.active(user, { date: '2026-08-08' });

    expect(eventsService.findActiveView).toHaveBeenCalledWith(
      user.sub,
      '2026-08-08',
    );
    expect(result.data).toEqual(eventView);
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
    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: { items: [eventView], total: 1 },
    });
  });

  it('gets detail by user-scoped id and forwards the requested date', async () => {
    eventsService.findByIdView.mockResolvedValue(eventView as never);

    const result = await controller.get(user, 'event-1', {
      date: '2026-08-08',
    });

    expect(eventsService.findByIdView).toHaveBeenCalledWith(
      user.sub,
      'event-1',
      '2026-08-08',
    );
    expect(result.data).toEqual(eventView);
  });

  it('preserves the service not-found semantics for another user event', async () => {
    eventsService.findByIdView.mockRejectedValue(new NotFoundException());

    await expect(
      controller.get(user, 'event-owned-by-someone-else'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(eventsService.findByIdView).toHaveBeenCalledWith(
      user.sub,
      'event-owned-by-someone-else',
      undefined,
    );
  });

  it('uses the path date for a check-in instead of resolving a server date', async () => {
    const dto = {
      outcome: HealthEventOutcome.improved,
    } as UpsertHealthEventCheckInDto;
    checkInsService.upsertForDate.mockResolvedValue({
      id: 'check-in-1',
      eventId: 'event-1',
      date: '2026-08-08',
      outcome: HealthEventOutcome.improved,
    } as never);
    eventsService.findByIdView.mockResolvedValue({
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
    } as never);

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
      code: ResultCode.SUCCESS,
      data: {
        checkIn: { date: '2026-08-08', outcome: HealthEventOutcome.improved },
        coverage: {
          checkInCount: 1,
          firstCheckInDate: '2026-08-08',
          lastCheckInDate: '2026-08-08',
        },
      },
    });
  });

  it('ends an event with the explicit outcome for the authenticated user', async () => {
    const dto = { outcome: HealthEventOutcome.worsened } as EndHealthEventDto;
    eventsService.end.mockResolvedValue({
      ...eventView,
      status: HealthEventStatus.ended,
      outcome: HealthEventOutcome.worsened,
    } as never);
    eventsService.findByIdView.mockResolvedValue({
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
    } as never);

    const result = await controller.end(user, 'event-1', dto);

    expect(eventsService.end).toHaveBeenCalledWith(user.sub, 'event-1', dto);
    expect(eventsService.findByIdView).toHaveBeenCalledWith(
      user.sub,
      'event-1',
    );
    expect(result).toMatchObject({
      code: ResultCode.SUCCESS,
      data: {
        status: HealthEventStatus.ended,
        endedAt: '2026-08-09T12:00:00.000Z',
        outcome: HealthEventOutcome.worsened,
        checkIn: { date: '2026-08-08' },
        coverage: {
          checkInCount: 1,
          firstCheckInDate: '2026-08-08',
          lastCheckInDate: '2026-08-08',
        },
      },
    });
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
