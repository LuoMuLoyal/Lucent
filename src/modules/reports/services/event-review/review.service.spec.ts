import { NotFoundException } from '@nestjs/common';
import { DomainFailureException } from '../../../../common/result/domain-failure.exception';
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
import type { MedicineRiskCheckService } from '../../../medicines';
import { EventReviewFactsService } from './facts.service';
import { EventReviewChangesService } from './changes.service';
import { EventReviewActionsService } from './actions.service';
import { EventReviewNextStepService } from './next-step.service';
import { EventReviewService } from './review.service';

const USER_ID = 'u1';
const STARTED_AT = new Date('2026-08-01T08:00:00.000Z');
/** Start day at UTC midnight in the default timezone (Asia/Shanghai). */
const WINDOW_START = new Date('2026-08-01T00:00:00.000Z');
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

function checkInFixture(
  date: Date,
  outcome: HealthEventOutcome,
): {
  id: string;
  eventId: string;
  date: Date;
  outcome: HealthEventOutcome;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: `ci-${date.toISOString()}`,
    eventId: 'evt-active',
    date,
    outcome,
    createdAt: new Date(date.getTime() + 3_600_000),
    updatedAt: new Date(date.getTime() + 3_600_000),
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
    findCheckIns: vi.fn().mockResolvedValue([]),
    findPageByUser: vi
      .fn()
      .mockResolvedValue({ items: [], hasMore: false, total: 0 }),
    findUserTimezone: vi.fn().mockResolvedValue(null),
  };
  const dailyRecordReader = {
    listFactsInRange: vi.fn().mockResolvedValue([]),
    countFactsInRange: vi.fn().mockResolvedValue(0),
    findLatestCreatedAtInRange: vi.fn().mockResolvedValue(null),
    findByIdWithAttachments: vi.fn().mockResolvedValue(null),
  };
  const doseLogReader = {
    listFactsInRange: vi.fn().mockResolvedValue([]),
    countFactsInRange: vi.fn().mockResolvedValue(0),
    findLatestScheduledForInRange: vi.fn().mockResolvedValue(null),
  };
  const riskCheck = {
    getRecords: vi.fn().mockResolvedValue({ static: null, llm: null }),
  };
  const service = new EventReviewService(
    ownership as unknown as HealthEventsOwnershipService,
    dailyRecordReader as unknown as DailyRecordReaderPort,
    doseLogReader as unknown as MedicineDoseLogReaderPort,
    new EventReviewFactsService(),
    new EventReviewChangesService(),
    new EventReviewActionsService(),
    new EventReviewNextStepService(),
    riskCheck as unknown as MedicineRiskCheckService,
  );
  return { service, ownership, dailyRecordReader, doseLogReader, riskCheck };
}

describe('EventReviewService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('buildForEvent', () => {
    it('returns section facts and exact coverage for an active event with a today check-in', async () => {
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
      ownership.findCheckIns.mockResolvedValue([
        checkInFixture(
          new Date('2026-08-10T00:00:00.000Z'),
          HealthEventOutcome.worsened,
        ),
        checkInFixture(
          new Date('2026-08-11T00:00:00.000Z'),
          HealthEventOutcome.unchanged,
        ),
        checkInFixture(
          new Date('2026-08-13T00:00:00.000Z'),
          HealthEventOutcome.unchanged,
        ),
      ]);
      dailyRecordReader.listFactsInRange.mockResolvedValue([
        dailyRecordFixture(),
      ]);
      dailyRecordReader.countFactsInRange.mockResolvedValue(1);
      dailyRecordReader.findLatestCreatedAtInRange.mockResolvedValue(
        new Date('2026-08-02T08:00:00.000Z'),
      );
      doseLogReader.listFactsInRange.mockResolvedValue([
        doseLogFixture(),
        doseLogFixture({
          status: DoseLogStatus.planned,
          scheduledFor: new Date('2026-08-13T08:00:00.000Z'),
        }),
      ]);
      doseLogReader.countFactsInRange.mockResolvedValue(2);
      doseLogReader.findLatestScheduledForInRange.mockResolvedValue(
        new Date('2026-08-13T08:00:00.000Z'),
      );

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
            kind: HealthEventKind.symptom,
            title: '头痛观察',
            startedAt: '2026-08-01T08:00:00.000Z',
            endedAt: null,
            medicineIds: ['med-1'],
            symptomRecordCount: 1,
            checkInCount: 3,
            reasonRecordTitle: null,
          },
        },
      });
      expect(review.sections.keyChanges).toEqual({
        state: 'available',
        facts: {
          code: 'observed_changes',
          arguments: {
            checkIns: {
              direction: 'improved',
              fromOutcome: HealthEventOutcome.worsened,
              toOutcome: HealthEventOutcome.unchanged,
              firstDate: '2026-08-10',
              lastDate: '2026-08-13',
              count: 3,
            },
            water: null,
            sleep: null,
          },
        },
      });
      expect(review.sections.completedActions).toEqual({
        state: 'available',
        facts: {
          code: 'completed_actions',
          arguments: {
            doseSlots: { confirmed: 1, skipped: 0, unconfirmed: 1 },
            checkIns: [
              { date: '2026-08-10', outcome: HealthEventOutcome.worsened },
              { date: '2026-08-11', outcome: HealthEventOutcome.unchanged },
              { date: '2026-08-13', outcome: HealthEventOutcome.unchanged },
            ],
          },
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
      expect(ownership.findCheckIns).toHaveBeenCalledWith(
        USER_ID,
        'evt-active',
      );
      expect(dailyRecordReader.listFactsInRange).toHaveBeenCalledWith(
        USER_ID,
        WINDOW_START,
        TODAY_INSTANT,
      );
      expect(dailyRecordReader.countFactsInRange).toHaveBeenCalledWith(
        USER_ID,
        WINDOW_START,
        TODAY_INSTANT,
        [DailyRecordKind.symptom],
      );
      expect(dailyRecordReader.countFactsInRange).toHaveBeenCalledWith(
        USER_ID,
        WINDOW_START,
        TODAY_INSTANT,
      );
      expect(doseLogReader.listFactsInRange).toHaveBeenCalledWith(
        USER_ID,
        WINDOW_START,
        TODAY_INSTANT,
      );
      expect(doseLogReader.countFactsInRange).toHaveBeenCalledWith(
        USER_ID,
        WINDOW_START,
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
      ownership.findCheckIns.mockResolvedValue([
        checkInFixture(
          new Date('2026-08-08T00:00:00.000Z'),
          HealthEventOutcome.unchanged,
        ),
        checkInFixture(
          new Date('2026-08-10T00:00:00.000Z'),
          HealthEventOutcome.improved,
        ),
      ]);

      const review = await service.buildForEvent(USER_ID, 'evt-ended');

      expect(review.event).toMatchObject({
        id: 'evt-ended',
        status: HealthEventStatus.ended,
        endedAt: '2026-08-10T20:00:00.000Z',
        outcome: HealthEventOutcome.improved,
      });
      expect(review.sections.keyChanges).toEqual({
        state: 'available',
        facts: {
          code: 'observed_changes',
          arguments: {
            checkIns: {
              direction: 'improved',
              fromOutcome: HealthEventOutcome.unchanged,
              toOutcome: HealthEventOutcome.improved,
              firstDate: '2026-08-08',
              lastDate: '2026-08-10',
              count: 2,
            },
            water: null,
            sleep: null,
          },
        },
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
          arguments: {
            doseSlots: { confirmed: 0, skipped: 0, unconfirmed: 0 },
            checkIns: [
              { date: '2026-08-08', outcome: HealthEventOutcome.unchanged },
              { date: '2026-08-10', outcome: HealthEventOutcome.improved },
            ],
          },
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
      expect(review.sourceTimestamps).toEqual({
        checkIns: '2026-08-10',
        dailyRecords: null,
        doseLogs: null,
      });
      expect(dailyRecordReader.listFactsInRange).toHaveBeenCalledWith(
        USER_ID,
        WINDOW_START,
        new Date('2026-08-10T20:00:00.000Z'),
      );
      expect(doseLogReader.listFactsInRange).toHaveBeenCalledWith(
        USER_ID,
        WINDOW_START,
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
      expect(review.sections.whatHappened).toEqual({
        state: 'available',
        facts: {
          code: 'health_event',
          arguments: {
            kind: HealthEventKind.symptom,
            title: '头痛观察',
            startedAt: '2026-08-01T08:00:00.000Z',
            endedAt: null,
            medicineIds: ['med-1'],
            symptomRecordCount: 0,
            checkInCount: 0,
            reasonRecordTitle: null,
          },
        },
      });
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

    it('attaches reviewed static red flags to the next-step section', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(TODAY_INSTANT);
      const { service, ownership, riskCheck } = buildService();
      ownership.ensureOwnedByUser.mockResolvedValue(activeEventFixture());
      riskCheck.getRecords.mockResolvedValue({
        static: {
          stale: false,
          result: {
            redFlags: [
              {
                rule: 'severeAllergy',
                primaryMedicineName: '阿司匹林',
                relatedLabel: '阿司匹林',
              },
              {
                rule: 'informationGap',
                primaryMedicineName: '手写药名',
              },
            ],
          },
        },
        llm: null,
      });

      const review = await service.buildForEvent(USER_ID, 'evt-active');

      expect(review.sections.nextStep).toEqual({
        state: 'available',
        facts: {
          code: 'active_check_in',
          arguments: {
            hasTodayCheckIn: false,
            redFlags: [
              {
                rule: 'severeAllergy',
                medicineName: '阿司匹林',
                relatedLabel: '阿司匹林',
              },
              { rule: 'informationGap', medicineName: '手写药名' },
            ],
          },
        },
      });
    });

    it('keeps the review usable when the static risk read fails', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(TODAY_INSTANT);
      const { service, ownership, riskCheck } = buildService();
      ownership.ensureOwnedByUser.mockResolvedValue(activeEventFixture());
      riskCheck.getRecords.mockRejectedValue(new Error('cache unavailable'));

      const review = await service.buildForEvent(USER_ID, 'evt-active');

      expect(review.sections.nextStep).toEqual({
        state: 'available',
        facts: {
          code: 'active_check_in',
          arguments: { hasTodayCheckIn: false },
        },
      });
    });

    it('skips red flags from a stale static risk check', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(TODAY_INSTANT);
      const { service, ownership, riskCheck } = buildService();
      ownership.ensureOwnedByUser.mockResolvedValue(activeEventFixture());
      riskCheck.getRecords.mockResolvedValue({
        static: {
          stale: true,
          result: {
            redFlags: [
              {
                rule: 'severeAllergy',
                primaryMedicineName: '阿司匹林',
                relatedLabel: '阿司匹林',
              },
            ],
          },
        },
        llm: null,
      });

      const review = await service.buildForEvent(USER_ID, 'evt-active');

      expect(review.sections.nextStep).toEqual({
        state: 'available',
        facts: {
          code: 'active_check_in',
          arguments: { hasTodayCheckIn: false },
        },
      });
    });

    it('resolves the window start to the event start day in the profile timezone', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(TODAY_INSTANT);
      const { service, ownership, dailyRecordReader } = buildService();
      ownership.ensureOwnedByUser.mockResolvedValue({
        ...activeEventFixture(),
        // 2026-08-01T05:00Z is still 2026-07-31 in America/Los_Angeles.
        startedAt: new Date('2026-08-01T05:00:00.000Z'),
      });
      ownership.findUserTimezone.mockResolvedValue('America/Los_Angeles');

      await service.buildForEvent(USER_ID, 'evt-active');

      const windowStart = new Date('2026-07-31T00:00:00.000Z');
      expect(dailyRecordReader.listFactsInRange).toHaveBeenCalledWith(
        USER_ID,
        windowStart,
        TODAY_INSTANT,
      );
      expect(dailyRecordReader.countFactsInRange).toHaveBeenCalledWith(
        USER_ID,
        windowStart,
        TODAY_INSTANT,
      );
    });

    it('resolves the triggering record title into the whatHappened facts', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(TODAY_INSTANT);
      const { service, ownership, dailyRecordReader } = buildService();
      ownership.ensureOwnedByUser.mockResolvedValue({
        ...activeEventFixture(),
        reasonRecordId: 'rec-reason',
      });
      dailyRecordReader.findByIdWithAttachments.mockResolvedValue({
        id: 'rec-reason',
        title: '头晕',
      });

      const review = await service.buildForEvent(USER_ID, 'evt-active');

      expect(
        review.sections.whatHappened.facts?.arguments['reasonRecordTitle'],
      ).toBe('头晕');
      expect(dailyRecordReader.findByIdWithAttachments).toHaveBeenCalledWith(
        USER_ID,
        'rec-reason',
      );
    });

    it('keeps reasonRecordTitle null when the triggering record is missing', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(TODAY_INSTANT);
      const { service, ownership, dailyRecordReader } = buildService();
      ownership.ensureOwnedByUser.mockResolvedValue({
        ...activeEventFixture(),
        reasonRecordId: 'rec-gone',
      });
      dailyRecordReader.findByIdWithAttachments.mockResolvedValue(null);

      const review = await service.buildForEvent(USER_ID, 'evt-active');

      expect(
        review.sections.whatHappened.facts?.arguments['reasonRecordTitle'],
      ).toBeNull();
    });

    it('keeps the review usable when the triggering record read fails', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(TODAY_INSTANT);
      const { service, ownership, dailyRecordReader } = buildService();
      ownership.ensureOwnedByUser.mockResolvedValue({
        ...activeEventFixture(),
        reasonRecordId: 'rec-failing',
      });
      dailyRecordReader.findByIdWithAttachments.mockRejectedValue(
        new Error('db unavailable'),
      );

      const review = await service.buildForEvent(USER_ID, 'evt-active');

      expect(review.event.id).toBe('evt-active');
      expect(
        review.sections.whatHappened.facts?.arguments['reasonRecordTitle'],
      ).toBeNull();
      expect(review.sections.nextStep).toEqual({
        state: 'available',
        facts: {
          code: 'active_check_in',
          arguments: { hasTodayCheckIn: false },
        },
      });
    });

    it('rejects with not found for a foreign event without reading sources', async () => {
      const {
        service,
        ownership,
        dailyRecordReader,
        doseLogReader,
        riskCheck,
      } = buildService();
      const notFoundError = new NotFoundException({
        code: 404,
        message: 'health-events.not_found',
      });
      ownership.ensureOwnedByUser.mockRejectedValue(notFoundError);

      await expect(service.buildForEvent(USER_ID, 'evt-foreign')).rejects.toBe(
        notFoundError,
      );
      expect(dailyRecordReader.listFactsInRange).not.toHaveBeenCalled();
      expect(dailyRecordReader.countFactsInRange).not.toHaveBeenCalled();
      expect(doseLogReader.listFactsInRange).not.toHaveBeenCalled();
      expect(ownership.findTodayCheckIn).not.toHaveBeenCalled();
      expect(ownership.findCheckIns).not.toHaveBeenCalled();
      expect(riskCheck.getRecords).not.toHaveBeenCalled();
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
      ).rejects.toThrow('INTERNAL_ERROR');
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

    it('prefers the active event when both active and ended events exist', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(TODAY_INSTANT);
      const { service, ownership } = buildService();
      const buildForEventSpy = vi.spyOn(service, 'buildForEvent');
      ownership.findActive.mockResolvedValue(activeEventFixture());
      ownership.findMostRecentEnded.mockResolvedValue(endedEventFixture());
      ownership.ensureOwnedByUser.mockResolvedValue(activeEventFixture());

      const review = await service.buildCurrent(USER_ID);

      expect(review?.event.id).toBe('evt-active');
      expect(buildForEventSpy).toHaveBeenCalledWith(USER_ID, 'evt-active');
      expect(ownership.findMostRecentEnded).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('paginates by cursor with status filtering via the repository page query', async () => {
      const { service, ownership } = buildService();
      const evt3 = {
        ...endedEventFixture(),
        id: 'evt-3',
        startedAt: new Date('2026-08-10T08:00:00.000Z'),
      };
      const evt2 = {
        ...endedEventFixture(),
        id: 'evt-2',
        startedAt: new Date('2026-08-05T08:00:00.000Z'),
      };
      const evt1 = {
        ...endedEventFixture(),
        id: 'evt-1',
        startedAt: new Date('2026-08-01T08:00:00.000Z'),
      };
      ownership.findPageByUser
        .mockResolvedValueOnce({ items: [evt3, evt2], hasMore: true, total: 3 })
        .mockResolvedValueOnce({
          items: [evt1],
          hasMore: false,
          total: 3,
        });

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
      expect(ownership.findPageByUser).toHaveBeenNthCalledWith(1, USER_ID, {
        status: HealthEventStatus.ended,
        cursor: null,
        limit: 2,
      });

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
      expect(ownership.findPageByUser).toHaveBeenNthCalledWith(2, USER_ID, {
        status: HealthEventStatus.ended,
        cursor: {
          startedAt: new Date('2026-08-05T08:00:00.000Z'),
          id: 'evt-2',
        },
        limit: 2,
      });
    });

    it('passes a decoded cursor for events sharing the same startedAt', async () => {
      const { service, ownership } = buildService();
      const sharedStartedAt = new Date('2026-08-05T08:00:00.000Z');
      const evtB = {
        ...endedEventFixture(),
        id: 'evt-b',
        startedAt: sharedStartedAt,
      };
      const evtA = {
        ...endedEventFixture(),
        id: 'evt-a',
        startedAt: sharedStartedAt,
      };
      const evtOlder = {
        ...endedEventFixture(),
        id: 'evt-older',
        startedAt: new Date('2026-08-01T08:00:00.000Z'),
      };
      ownership.findPageByUser
        .mockResolvedValueOnce({ items: [evtB, evtA], hasMore: true, total: 3 })
        .mockResolvedValueOnce({
          items: [evtOlder],
          hasMore: false,
          total: 3,
        });

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
      expect(ownership.findPageByUser).toHaveBeenNthCalledWith(2, USER_ID, {
        status: HealthEventStatus.ended,
        cursor: { startedAt: sharedStartedAt, id: 'evt-a' },
        limit: 2,
      });
    });

    it('rejects a malformed cursor', async () => {
      const { service } = buildService();

      await expect(
        service.list(USER_ID, { cursor: '2026-08-05T08:00:00.000Z' }),
      ).rejects.toBeInstanceOf(DomainFailureException);
      await expect(
        service.list(USER_ID, { cursor: 'a|b|c' }),
      ).rejects.toBeInstanceOf(DomainFailureException);
      await expect(
        service.list(USER_ID, { cursor: 'not-a-date|evt-1' }),
      ).rejects.toBeInstanceOf(DomainFailureException);
      // Parseable by `new Date` but not the exact toISOString shape.
      await expect(
        service.list(USER_ID, { cursor: '2026-08-05T08:00:00Z|evt-1' }),
      ).rejects.toBeInstanceOf(DomainFailureException);
    });

    it('returns an empty list when the user has no events', async () => {
      const { service, ownership } = buildService();
      ownership.findPageByUser.mockResolvedValue({
        items: [],
        hasMore: false,
        total: 0,
      });

      await expect(service.list(USER_ID, {})).resolves.toEqual({
        items: [],
        total: 0,
        nextCursor: null,
      });
      expect(ownership.findPageByUser).toHaveBeenCalledWith(USER_ID, {
        status: null,
        cursor: null,
        limit: 20,
      });
    });
  });
});
