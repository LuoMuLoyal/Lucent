import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  DailyRecordKind,
  DoseLogStatus,
  HealthEventKind,
  HealthEventOutcome,
  HealthEventStatus,
} from '#generated/prisma/client';
import type { HealthEventsOwnershipService } from '../../../health-events';
import type { DailyRecordReaderPort } from '../../../daily-records';
import type { MedicineDoseLogReaderPort } from '../../../medicine-dose-logs';
import { EventReviewService } from './review.service';

const USER_ID = 'u1';
const STARTED_AT = new Date('2026-08-01T08:00:00.000Z');
const TODAY_INSTANT = new Date('2026-08-13T12:00:00.000Z');

function activeEventFixture() {
  return {
    id: 'evt-active',
    userId: USER_ID,
    title: '头痛观察',
    kind: HealthEventKind.symptom,
    status: HealthEventStatus.active,
    startedAt: STARTED_AT,
    endedAt: null,
    outcome: null,
    reasonRecordId: null,
    deletedAt: null,
    currentMedicineIds: ['med-1'],
  };
}

function endedEventFixture() {
  return {
    ...activeEventFixture(),
    id: 'evt-ended',
    status: HealthEventStatus.ended,
    endedAt: new Date('2026-08-10T20:00:00.000Z'),
    outcome: HealthEventOutcome.improved,
  };
}

function dailyRecordFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    kind: DailyRecordKind.symptom,
    occurredAt: new Date('2026-08-02T00:00:00.000Z'),
    occurredTime: null,
    title: '头痛',
    value: null,
    unit: null,
    note: null,
    payload: null,
    createdAt: new Date('2026-08-02T08:00:00.000Z'),
    ...overrides,
  };
}

function doseLogFixture(overrides: Record<string, unknown> = {}) {
  return {
    currentMedicineId: 'med-1',
    reminderId: 'rem-1',
    status: DoseLogStatus.taken,
    scheduledTime: '08:00',
    scheduledFor: new Date('2026-08-05T08:00:00.000Z'),
    ...overrides,
  };
}

function buildService() {
  const ownership = {
    ensureOwnedByUser: vi.fn(),
    findActive: vi.fn().mockResolvedValue(null),
    findMostRecentEnded: vi.fn().mockResolvedValue(null),
    findTodayCheckIn: vi.fn().mockResolvedValue(null),
    findCheckInCoverage: vi.fn().mockResolvedValue({
      checkInCount: 0,
      firstCheckInDate: null,
      lastCheckInDate: null,
    }),
    findManyByUser: vi.fn().mockResolvedValue([]),
  };
  const dailyRecordReader = {
    listFactsInRange: vi.fn().mockResolvedValue([]),
  };
  const doseLogReader = {
    listFactsInRange: vi.fn().mockResolvedValue([]),
  };
  const service = new EventReviewService(
    ownership as unknown as HealthEventsOwnershipService,
    dailyRecordReader as unknown as DailyRecordReaderPort,
    doseLogReader as unknown as MedicineDoseLogReaderPort,
  );
  return { service, ownership, dailyRecordReader, doseLogReader };
}

describe('EventReviewService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('buildForEvent', () => {
    it('returns event facts and available sections for an active event with a today check-in', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(TODAY_INSTANT);
      const { service, ownership, dailyRecordReader, doseLogReader } =
        buildService();
      ownership.ensureOwnedByUser.mockResolvedValue(activeEventFixture());
      ownership.findTodayCheckIn.mockResolvedValue({
        id: 'ci-1',
        eventId: 'evt-active',
        date: new Date('2026-08-13T00:00:00.000Z'),
        outcome: HealthEventOutcome.unchanged,
        createdAt: new Date('2026-08-13T09:00:00.000Z'),
        updatedAt: new Date('2026-08-13T09:30:00.000Z'),
      });
      ownership.findCheckInCoverage.mockResolvedValue({
        checkInCount: 3,
        firstCheckInDate: new Date('2026-08-10T00:00:00.000Z'),
        lastCheckInDate: new Date('2026-08-13T00:00:00.000Z'),
      });
      dailyRecordReader.listFactsInRange.mockResolvedValue([
        dailyRecordFixture(),
      ]);
      doseLogReader.listFactsInRange.mockResolvedValue([
        doseLogFixture(),
        doseLogFixture({
          status: DoseLogStatus.planned,
          scheduledFor: new Date('2026-08-13T08:00:00.000Z'),
        }),
      ]);

      const review = await service.buildForEvent(USER_ID, 'evt-active');

      expect(review.event).toEqual({
        id: 'evt-active',
        kind: HealthEventKind.symptom,
        title: '头痛观察',
        status: HealthEventStatus.active,
        startedAt: '2026-08-01T08:00:00.000Z',
        endedAt: null,
        outcome: null,
        currentMedicineIds: ['med-1'],
      });
      expect(review.sections.whatHappened).toEqual({
        state: 'available',
        facts: {
          code: 'health_event',
          arguments: {
            startedAt: '2026-08-01T08:00:00.000Z',
            endedAt: null,
          },
        },
      });
      expect(review.sections.keyChanges).toEqual({
        state: 'available',
        facts: {
          code: 'observed_coverage',
          arguments: { checkInCount: 3, dailyRecordCount: 1, doseLogCount: 2 },
        },
      });
      expect(review.sections.completedActions).toEqual({
        state: 'available',
        facts: {
          code: 'completed_actions',
          arguments: { confirmedDoseLogs: 1, skippedDoseLogs: 0, checkIns: 3 },
        },
      });
      expect(review.sections.nextStep).toEqual({
        state: 'available',
        facts: {
          code: 'active_check_in',
          arguments: { hasTodayCheckIn: true },
        },
      });
      expect(review.coverage.checkIns).toMatchObject({
        state: 'observed',
        coverage: 'partial',
        sources: ['manual'],
        observedCount: 3,
        expectedCount: null,
        firstCheckInDate: '2026-08-10',
        lastCheckInDate: '2026-08-13',
        windowStart: '2026-08-01T08:00:00.000Z',
        windowEnd: '2026-08-13T12:00:00.000Z',
      });
      expect(review.coverage.checkIns.todayCheckIn).toEqual({
        date: '2026-08-13',
        outcome: HealthEventOutcome.unchanged,
        updatedAt: '2026-08-13T09:30:00.000Z',
      });
      expect(review.coverage.dailyRecords).toMatchObject({
        state: 'observed',
        coverage: 'partial',
        sources: ['manual'],
        observedCount: 1,
        expectedCount: null,
      });
      expect(review.coverage.doseLogs).toMatchObject({
        state: 'observed',
        coverage: 'partial',
        sources: ['reminder_plan'],
        observedCount: 2,
        expectedCount: null,
      });
      expect(review.sourceTimestamps).toEqual({
        checkIns: '2026-08-13',
        dailyRecords: '2026-08-02T08:00:00.000Z',
        doseLogs: '2026-08-13T08:00:00.000Z',
      });
      expect(review.availableActions).toEqual(['check_in', 'end_event']);
      expect(review.generatedAt).toBe('2026-08-13T12:00:00.000Z');
      expect(ownership.findTodayCheckIn).toHaveBeenCalledWith(
        USER_ID,
        'evt-active',
      );
      expect(dailyRecordReader.listFactsInRange).toHaveBeenCalledWith(
        USER_ID,
        STARTED_AT,
        TODAY_INSTANT,
      );
      expect(doseLogReader.listFactsInRange).toHaveBeenCalledWith(
        USER_ID,
        STARTED_AT,
        TODAY_INSTANT,
      );
    });

    it('returns the confirmed outcome for an ended event', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(TODAY_INSTANT);
      const { service, ownership, dailyRecordReader, doseLogReader } =
        buildService();
      ownership.ensureOwnedByUser.mockResolvedValue(endedEventFixture());
      ownership.findCheckInCoverage.mockResolvedValue({
        checkInCount: 2,
        firstCheckInDate: new Date('2026-08-08T00:00:00.000Z'),
        lastCheckInDate: new Date('2026-08-10T00:00:00.000Z'),
      });

      const review = await service.buildForEvent(USER_ID, 'evt-ended');

      expect(review.event).toMatchObject({
        id: 'evt-ended',
        status: HealthEventStatus.ended,
        endedAt: '2026-08-10T20:00:00.000Z',
        outcome: HealthEventOutcome.improved,
      });
      expect(review.sections.nextStep).toEqual({
        state: 'available',
        facts: {
          code: 'event_ended',
          arguments: { outcome: HealthEventOutcome.improved },
        },
      });
      expect(review.sections.completedActions).toEqual({
        state: 'available',
        facts: {
          code: 'completed_actions',
          arguments: { confirmedDoseLogs: 0, skippedDoseLogs: 0, checkIns: 2 },
        },
      });
      expect(review.coverage.checkIns).toMatchObject({
        state: 'observed',
        observedCount: 2,
        todayCheckIn: null,
        windowStart: '2026-08-01T08:00:00.000Z',
        windowEnd: '2026-08-10T20:00:00.000Z',
      });
      expect(review.availableActions).toEqual(['clinic_summary', 'export']);
      expect(review.sourceTimestamps.checkIns).toBe('2026-08-10');
      expect(dailyRecordReader.listFactsInRange).toHaveBeenCalledWith(
        USER_ID,
        STARTED_AT,
        new Date('2026-08-10T20:00:00.000Z'),
      );
      expect(doseLogReader.listFactsInRange).toHaveBeenCalledWith(
        USER_ID,
        STARTED_AT,
        new Date('2026-08-10T20:00:00.000Z'),
      );
    });

    it('returns event facts with unknown sections for a sparse fixture instead of an overall not-ready', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(TODAY_INSTANT);
      const { service, ownership } = buildService();
      ownership.ensureOwnedByUser.mockResolvedValue(activeEventFixture());

      const review = await service.buildForEvent(USER_ID, 'evt-active');

      expect(review.event.id).toBe('evt-active');
      expect(review.event.title).toBe('头痛观察');
      expect(review.sections.whatHappened.state).toBe('available');
      expect(review.sections.keyChanges).toEqual({
        state: 'unknown',
        reasonCode: 'no_observations',
      });
      expect(review.sections.completedActions).toEqual({
        state: 'unknown',
        reasonCode: 'no_completed_actions',
      });
      expect(review.sections.nextStep).toEqual({
        state: 'available',
        facts: {
          code: 'active_check_in',
          arguments: { hasTodayCheckIn: false },
        },
      });
      expect(review.coverage.checkIns).toMatchObject({
        state: 'unknown',
        coverage: 'none',
        sources: [],
        observedCount: 0,
        firstCheckInDate: null,
        lastCheckInDate: null,
        todayCheckIn: null,
      });
      expect(review.coverage.dailyRecords).toMatchObject({
        state: 'unknown',
        coverage: 'none',
        observedCount: 0,
      });
      expect(review.coverage.doseLogs).toMatchObject({
        state: 'unknown',
        coverage: 'none',
        observedCount: 0,
      });
      expect(review.sourceTimestamps).toEqual({
        checkIns: null,
        dailyRecords: null,
        doseLogs: null,
      });
      expect(review.availableActions).toEqual(['check_in', 'end_event']);
    });

    it('rejects with not found for a foreign event without reading sources', async () => {
      const { service, ownership, dailyRecordReader, doseLogReader } =
        buildService();
      const notFoundError = new NotFoundException({
        code: 404,
        message: 'health-events.not_found',
      });
      ownership.ensureOwnedByUser.mockRejectedValue(notFoundError);

      await expect(service.buildForEvent(USER_ID, 'evt-foreign')).rejects.toBe(
        notFoundError,
      );
      expect(dailyRecordReader.listFactsInRange).not.toHaveBeenCalled();
      expect(doseLogReader.listFactsInRange).not.toHaveBeenCalled();
      expect(ownership.findTodayCheckIn).not.toHaveBeenCalled();
    });

    it('rejects an event record missing its kind instead of defaulting to symptom', async () => {
      const { service, ownership } = buildService();
      const missingKindEvent: Record<string, unknown> = {
        ...activeEventFixture(),
      };
      missingKindEvent['kind'] = undefined;
      ownership.ensureOwnedByUser.mockResolvedValue(missingKindEvent);

      await expect(
        service.buildForEvent(USER_ID, 'evt-active'),
      ).rejects.toThrow('has no kind');
    });
  });

  describe('buildCurrent', () => {
    it('resolves null when the user has no events', async () => {
      const { service, ownership } = buildService();

      await expect(service.buildCurrent(USER_ID)).resolves.toBeNull();
      expect(ownership.ensureOwnedByUser).not.toHaveBeenCalled();
    });

    it('falls back to the most recent ended event when no active event exists', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(TODAY_INSTANT);
      const { service, ownership } = buildService();
      ownership.findActive.mockResolvedValue(null);
      ownership.findMostRecentEnded.mockResolvedValue(endedEventFixture());
      ownership.ensureOwnedByUser.mockResolvedValue(endedEventFixture());

      const review = await service.buildCurrent(USER_ID);

      expect(review).not.toBeNull();
      expect(review?.event.id).toBe('evt-ended');
      expect(review?.event.status).toBe(HealthEventStatus.ended);
      expect(review?.sections.nextStep).toEqual({
        state: 'available',
        facts: {
          code: 'event_ended',
          arguments: { outcome: HealthEventOutcome.improved },
        },
      });
      expect(ownership.ensureOwnedByUser).toHaveBeenCalledWith(
        USER_ID,
        'evt-ended',
      );
    });
  });

  describe('list', () => {
    it('paginates by cursor with status filtering', async () => {
      const { service, ownership } = buildService();
      const events = [
        {
          ...endedEventFixture(),
          id: 'evt-3',
          startedAt: new Date('2026-08-10T08:00:00.000Z'),
        },
        {
          ...endedEventFixture(),
          id: 'evt-2',
          startedAt: new Date('2026-08-05T08:00:00.000Z'),
        },
        {
          ...endedEventFixture(),
          id: 'evt-1',
          startedAt: new Date('2026-08-01T08:00:00.000Z'),
        },
        activeEventFixture(),
      ];
      ownership.findManyByUser.mockResolvedValue(events);

      const firstPage = await service.list(USER_ID, {
        status: HealthEventStatus.ended,
        limit: 2,
      });

      expect(firstPage.items.map((item) => item.id)).toEqual([
        'evt-3',
        'evt-2',
      ]);
      expect(firstPage.total).toBe(3);
      expect(firstPage.nextCursor).toBe('2026-08-05T08:00:00.000Z|evt-2');

      const secondPage = await service.list(USER_ID, {
        status: HealthEventStatus.ended,
        ...(firstPage.nextCursor == null
          ? {}
          : { cursor: firstPage.nextCursor }),
        limit: 2,
      });

      expect(secondPage.items.map((item) => item.id)).toEqual(['evt-1']);
      expect(secondPage.total).toBe(3);
      expect(secondPage.nextCursor).toBeNull();
    });

    it('does not skip events sharing the same startedAt across pages', async () => {
      const { service, ownership } = buildService();
      const sharedStartedAt = new Date('2026-08-05T08:00:00.000Z');
      const events = [
        { ...endedEventFixture(), id: 'evt-b', startedAt: sharedStartedAt },
        { ...endedEventFixture(), id: 'evt-a', startedAt: sharedStartedAt },
        {
          ...endedEventFixture(),
          id: 'evt-older',
          startedAt: new Date('2026-08-01T08:00:00.000Z'),
        },
      ];
      ownership.findManyByUser.mockResolvedValue(events);

      const firstPage = await service.list(USER_ID, {
        status: HealthEventStatus.ended,
        limit: 2,
      });

      expect(firstPage.items.map((item) => item.id)).toEqual([
        'evt-b',
        'evt-a',
      ]);
      expect(firstPage.nextCursor).toBe('2026-08-05T08:00:00.000Z|evt-a');

      const secondPage = await service.list(USER_ID, {
        status: HealthEventStatus.ended,
        ...(firstPage.nextCursor == null
          ? {}
          : { cursor: firstPage.nextCursor }),
        limit: 2,
      });

      expect(secondPage.items.map((item) => item.id)).toEqual(['evt-older']);
      expect(secondPage.total).toBe(3);
      expect(secondPage.nextCursor).toBeNull();
    });

    it('rejects a malformed cursor', async () => {
      const { service } = buildService();

      await expect(
        service.list(USER_ID, { cursor: '2026-08-05T08:00:00.000Z' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.list(USER_ID, { cursor: 'a|b|c' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns an empty list when the user has no events', async () => {
      const { service, ownership } = buildService();
      ownership.findManyByUser.mockResolvedValue([]);

      await expect(service.list(USER_ID, {})).resolves.toEqual({
        items: [],
        total: 0,
        nextCursor: null,
      });
    });
  });
});
