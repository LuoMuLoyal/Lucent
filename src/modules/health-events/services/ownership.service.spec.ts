import {
  HealthEventKind,
  HealthEventOutcome,
  HealthEventStatus,
} from '#generated/prisma/client';
import {
  DEFAULT_USER_TIMEZONE,
  formatDateOnlyInTimezone,
} from '../../../common';
import { okAsync, errAsync } from '../../../common/result';
import { DomainFailureException } from '../../../common/result/unwrap-result';
import type { EventsService } from './events.service';
import type { HealthEventRepositoryPort } from '../repositories/event.repository';
import { HealthEventsOwnershipService } from './ownership.service';

const USER_ID = 'u1';
const EVENT_ID = 'evt-1';
const TODAY_INSTANT = new Date('2026-08-13T17:00:00.000Z');

function eventFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    userId: USER_ID,
    title: '头痛观察',
    kind: HealthEventKind.symptom,
    status: HealthEventStatus.active,
    startedAt: new Date('2026-08-01T08:00:00.000Z'),
    endedAt: null,
    outcome: null,
    reasonRecordId: null,
    deletedAt: null,
    currentMedicineIds: [],
    ...overrides,
  };
}

function buildService() {
  const eventsService = {
    ensureOwnedByUser: vi.fn().mockReturnValue(okAsync(eventFixture())),
    ensureActiveOwnedByUser: vi.fn().mockReturnValue(okAsync(eventFixture())),
  };
  const repository = {
    findActiveByUserId: vi.fn().mockResolvedValue(null),
    findManyByUserId: vi.fn().mockResolvedValue([]),
    findPageByUserId: vi
      .fn()
      .mockResolvedValue({ items: [], hasMore: false, total: 0 }),
    findMostRecentEndedByUserId: vi.fn().mockResolvedValue(null),
    findUserTimezone: vi.fn().mockResolvedValue(null),
    findCheckIn: vi.fn().mockResolvedValue(null),
    findCheckIns: vi.fn().mockResolvedValue([]),
    findCheckInCoverage: vi.fn().mockResolvedValue({
      checkInCount: 0,
      firstCheckInDate: null,
      lastCheckInDate: null,
    }),
  };
  const service = new HealthEventsOwnershipService(
    eventsService as unknown as EventsService,
    repository as unknown as HealthEventRepositoryPort,
  );
  return { service, eventsService, repository };
}

describe('HealthEventsOwnershipService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('ensureOwnedByUser', () => {
    it('delegates to the events service and returns the event', async () => {
      const { service, eventsService } = buildService();
      const owned = eventFixture();

      await expect(
        service.ensureOwnedByUser(USER_ID, EVENT_ID),
      ).resolves.toEqual(owned);
      expect(eventsService.ensureOwnedByUser).toHaveBeenCalledWith(
        USER_ID,
        EVENT_ID,
      );
    });

    it('rethrows a DomainFailureException for a foreign or missing event', async () => {
      const { service, eventsService } = buildService();
      const failure = {
        _tag: 'DomainFailure',
        kind: 'authorization',
        code: 'FORBIDDEN',
      } as const;
      eventsService.ensureOwnedByUser.mockReturnValue(errAsync(failure));

      await expect(
        service.ensureOwnedByUser(USER_ID, EVENT_ID),
      ).rejects.toBeInstanceOf(DomainFailureException);
      await expect(
        service.ensureOwnedByUser(USER_ID, EVENT_ID),
      ).rejects.toMatchObject({ failure });
    });
  });

  describe('ensureActiveOwnedByUser', () => {
    it('delegates to the events service and returns the active event', async () => {
      const { service, eventsService } = buildService();

      await expect(
        service.ensureActiveOwnedByUser(USER_ID, EVENT_ID),
      ).resolves.toEqual(eventFixture());
      expect(eventsService.ensureActiveOwnedByUser).toHaveBeenCalledWith(
        USER_ID,
        EVENT_ID,
      );
    });

    it('rethrows a DomainFailureException for an inactive event', async () => {
      const { service, eventsService } = buildService();
      const failure = {
        _tag: 'DomainFailure',
        kind: 'validation',
        code: 'VALIDATION_FAILED',
      } as const;
      eventsService.ensureActiveOwnedByUser.mockReturnValue(errAsync(failure));

      await expect(
        service.ensureActiveOwnedByUser(USER_ID, EVENT_ID),
      ).rejects.toMatchObject({ failure });
    });
  });

  describe('findTodayCheckIn', () => {
    it('resolves today in the default timezone when the profile has no timezone', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(TODAY_INSTANT);
      const { service, repository } = buildService();
      repository.findUserTimezone.mockResolvedValue(null);
      repository.findCheckIn.mockResolvedValue({
        id: 'ci-1',
        eventId: EVENT_ID,
        date: new Date('2026-08-13T00:00:00.000Z'),
        outcome: HealthEventOutcome.unchanged,
        createdAt: new Date('2026-08-13T09:00:00.000Z'),
        updatedAt: new Date('2026-08-13T09:30:00.000Z'),
      });

      await service.findTodayCheckIn(USER_ID, EVENT_ID);

      expect(repository.findCheckIn).toHaveBeenCalledWith(
        USER_ID,
        EVENT_ID,
        formatDateOnlyInTimezone(TODAY_INSTANT, DEFAULT_USER_TIMEZONE),
      );
    });

    it('resolves today in the profile timezone when one is set', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(TODAY_INSTANT);
      const { service, repository } = buildService();
      repository.findUserTimezone.mockResolvedValue('America/New_York');

      await service.findTodayCheckIn(USER_ID, EVENT_ID);

      expect(repository.findCheckIn).toHaveBeenCalledWith(
        USER_ID,
        EVENT_ID,
        formatDateOnlyInTimezone(TODAY_INSTANT, 'America/New_York'),
      );
    });
  });

  describe('findMostRecentEnded', () => {
    it('delegates to the targeted most-recent-ended repository query', async () => {
      const { service, repository } = buildService();
      const newestEnded = eventFixture({
        id: 'evt-new',
        status: HealthEventStatus.ended,
        startedAt: new Date('2026-08-10T08:00:00.000Z'),
        endedAt: new Date('2026-08-11T08:00:00.000Z'),
        outcome: HealthEventOutcome.improved,
      });
      repository.findMostRecentEndedByUserId.mockResolvedValue(newestEnded);

      await expect(service.findMostRecentEnded(USER_ID)).resolves.toEqual(
        newestEnded,
      );
      expect(repository.findMostRecentEndedByUserId).toHaveBeenCalledWith(
        USER_ID,
      );
      expect(repository.findManyByUserId).not.toHaveBeenCalled();
    });

    it('returns null when the user has no ended event', async () => {
      const { service, repository } = buildService();
      repository.findMostRecentEndedByUserId.mockResolvedValue(null);

      await expect(service.findMostRecentEnded(USER_ID)).resolves.toBeNull();
    });
  });

  describe('findCheckIns', () => {
    it('delegates the ordered check-in read to the repository', async () => {
      const { service, repository } = buildService();
      const checkIns = [
        {
          id: 'ci-1',
          eventId: EVENT_ID,
          date: new Date('2026-08-10T00:00:00.000Z'),
          outcome: HealthEventOutcome.unchanged,
          createdAt: new Date('2026-08-10T09:00:00.000Z'),
          updatedAt: new Date('2026-08-10T09:30:00.000Z'),
        },
      ];
      repository.findCheckIns.mockResolvedValue(checkIns);

      await expect(service.findCheckIns(USER_ID, EVENT_ID)).resolves.toEqual(
        checkIns,
      );
      expect(repository.findCheckIns).toHaveBeenCalledWith(USER_ID, EVENT_ID);
    });
  });

  describe('findCheckInCoverage', () => {
    it('returns the empty coverage shape when no check-ins exist', async () => {
      const { service, repository } = buildService();
      const emptyCoverage = {
        checkInCount: 0,
        firstCheckInDate: null,
        lastCheckInDate: null,
      };
      repository.findCheckInCoverage.mockResolvedValue(emptyCoverage);

      await expect(
        service.findCheckInCoverage(USER_ID, EVENT_ID),
      ).resolves.toEqual(emptyCoverage);
      expect(repository.findCheckInCoverage).toHaveBeenCalledWith(
        USER_ID,
        EVENT_ID,
      );
    });

    it('returns counts and dates when check-ins exist', async () => {
      const { service, repository } = buildService();
      const coverage = {
        checkInCount: 3,
        firstCheckInDate: new Date('2026-08-08T00:00:00.000Z'),
        lastCheckInDate: new Date('2026-08-10T00:00:00.000Z'),
      };
      repository.findCheckInCoverage.mockResolvedValue(coverage);

      await expect(
        service.findCheckInCoverage(USER_ID, EVENT_ID),
      ).resolves.toEqual(coverage);
    });
  });

  describe('findPageByUser', () => {
    it('delegates the paginated read to the repository', async () => {
      const { service, repository } = buildService();
      const page = {
        items: [eventFixture({ status: HealthEventStatus.ended })],
        hasMore: false,
        total: 1,
      };
      repository.findPageByUserId.mockResolvedValue(page);
      const query = {
        status: HealthEventStatus.ended,
        cursor: {
          startedAt: new Date('2026-08-10T08:00:00.000Z'),
          id: 'evt-1',
        },
        limit: 20,
      };

      await expect(service.findPageByUser(USER_ID, query)).resolves.toEqual(
        page,
      );
      expect(repository.findPageByUserId).toHaveBeenCalledWith(USER_ID, query);
    });
  });

  describe('read delegation', () => {
    it('delegates findActive and findManyByUser to the repository', async () => {
      const { service, repository } = buildService();
      const active = eventFixture();
      const events = [active];
      repository.findActiveByUserId.mockResolvedValue(active);
      repository.findManyByUserId.mockResolvedValue(events);

      await expect(service.findActive(USER_ID)).resolves.toEqual(active);
      await expect(service.findManyByUser(USER_ID)).resolves.toEqual(events);
      expect(repository.findActiveByUserId).toHaveBeenCalledWith(USER_ID);
      expect(repository.findManyByUserId).toHaveBeenCalledWith(USER_ID);
    });

    it('delegates findUserTimezone to the repository', async () => {
      const { service, repository } = buildService();
      repository.findUserTimezone.mockResolvedValue('America/New_York');

      await expect(service.findUserTimezone(USER_ID)).resolves.toBe(
        'America/New_York',
      );
      expect(repository.findUserTimezone).toHaveBeenCalledWith(USER_ID);
    });
  });
});
