import {
  HealthEventKind,
  HealthEventOutcome,
  HealthEventStatus,
} from '#generated/prisma/client';
import {
  DEFAULT_USER_TIMEZONE,
  formatDateOnlyInTimezone,
} from '../../../common';
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
    ensureOwnedByUser: vi.fn(),
    ensureActiveOwnedByUser: vi.fn(),
  };
  const repository = {
    findActiveByUserId: vi.fn().mockResolvedValue(null),
    findManyByUserId: vi.fn().mockResolvedValue([]),
    findUserTimezone: vi.fn().mockResolvedValue(null),
    findCheckIn: vi.fn().mockResolvedValue(null),
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
    it('returns the most recently started ended event from the repository order', async () => {
      const { service, repository } = buildService();
      const newestEnded = eventFixture({
        id: 'evt-new',
        status: HealthEventStatus.ended,
        startedAt: new Date('2026-08-10T08:00:00.000Z'),
        endedAt: new Date('2026-08-11T08:00:00.000Z'),
        outcome: HealthEventOutcome.improved,
      });
      const newerActive = eventFixture({
        id: 'evt-active',
        startedAt: new Date('2026-08-09T08:00:00.000Z'),
      });
      const olderEnded = eventFixture({
        id: 'evt-old',
        status: HealthEventStatus.ended,
        startedAt: new Date('2026-08-01T08:00:00.000Z'),
        endedAt: new Date('2026-08-02T08:00:00.000Z'),
        outcome: HealthEventOutcome.worsened,
      });
      // Repository contract: startedAt desc, id desc.
      repository.findManyByUserId.mockResolvedValue([
        newestEnded,
        newerActive,
        olderEnded,
      ]);

      await expect(service.findMostRecentEnded(USER_ID)).resolves.toEqual(
        newestEnded,
      );
      expect(repository.findManyByUserId).toHaveBeenCalledWith(USER_ID);
    });

    it('returns null when the user has no ended event', async () => {
      const { service, repository } = buildService();
      repository.findManyByUserId.mockResolvedValue([eventFixture()]);

      await expect(service.findMostRecentEnded(USER_ID)).resolves.toBeNull();
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
  });
});
