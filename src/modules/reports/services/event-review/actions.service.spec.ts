import { DoseLogStatus, HealthEventOutcome } from '#generated/prisma/client';
import {
  EventReviewActionsService,
  type ReviewActionCheckIn,
  type ReviewActionDoseLog,
  type ReviewActionFacts,
} from './actions.service';

const DAY_05 = new Date('2026-08-05T00:00:00.000Z');
const DAY_06 = new Date('2026-08-06T00:00:00.000Z');
const DAY_07 = new Date('2026-08-07T00:00:00.000Z');

function doseLog(
  overrides: Partial<ReviewActionDoseLog> = {},
): ReviewActionDoseLog {
  return {
    reminderId: 'rem-1',
    status: DoseLogStatus.taken,
    scheduledFor: new Date('2026-08-05T08:00:00.000Z'),
    scheduledTime: '08:00',
    ...overrides,
  };
}

function checkIn(date: Date, outcome: HealthEventOutcome): ReviewActionCheckIn {
  return { date, outcome };
}

function buildService() {
  return new EventReviewActionsService();
}

describe('EventReviewActionsService', () => {
  it('counts dose slots by confirmed/skipped/unconfirmed and lists completed check-ins', () => {
    const service = buildService();
    const input: ReviewActionFacts = {
      doseLogs: [
        doseLog(),
        doseLog({
          reminderId: 'rem-2',
          status: DoseLogStatus.taken,
        }),
        doseLog({
          scheduledFor: new Date('2026-08-06T08:00:00.000Z'),
          status: DoseLogStatus.skipped,
        }),
        doseLog({
          scheduledFor: new Date('2026-08-07T08:00:00.000Z'),
          status: DoseLogStatus.planned,
        }),
        doseLog({
          reminderId: null,
          status: DoseLogStatus.taken,
        }),
      ],
      checkIns: [
        checkIn(DAY_05, HealthEventOutcome.worsened),
        checkIn(DAY_06, HealthEventOutcome.unchanged),
      ],
    };

    expect(service.build(input)).toEqual({
      state: 'available',
      facts: {
        code: 'completed_actions',
        arguments: {
          doseSlots: { confirmed: 3, skipped: 1, unconfirmed: 1 },
          checkIns: [
            { date: '2026-08-05', outcome: HealthEventOutcome.worsened },
            { date: '2026-08-06', outcome: HealthEventOutcome.unchanged },
          ],
        },
      },
    });
  });

  it('counts missed slots as unconfirmed, never as failures', () => {
    const service = buildService();
    const input: ReviewActionFacts = {
      doseLogs: [
        doseLog(),
        doseLog({
          scheduledFor: new Date('2026-08-06T08:00:00.000Z'),
          status: DoseLogStatus.missed,
        }),
        doseLog({
          scheduledFor: new Date('2026-08-07T08:00:00.000Z'),
          status: DoseLogStatus.planned,
        }),
      ],
      checkIns: [],
    };

    const section = service.build(input);

    expect(section.state).toBe('available');
    expect(section.facts?.arguments['doseSlots']).toEqual({
      confirmed: 1,
      skipped: 0,
      unconfirmed: 2,
    });
  });

  it('merges duplicate rows for the same slot by status priority', () => {
    const service = buildService();
    const input: ReviewActionFacts = {
      doseLogs: [
        doseLog({ status: DoseLogStatus.planned }),
        doseLog({ status: DoseLogStatus.taken }),
        doseLog({ status: DoseLogStatus.skipped }),
      ],
      checkIns: [],
    };

    const section = service.build(input);

    expect(section.facts?.arguments['doseSlots']).toEqual({
      confirmed: 1,
      skipped: 0,
      unconfirmed: 0,
    });
  });

  it('keeps standalone logs without a reminder as their own slots', () => {
    const service = buildService();
    const input: ReviewActionFacts = {
      doseLogs: [
        doseLog({
          reminderId: null,
          status: DoseLogStatus.skipped,
        }),
        doseLog({
          reminderId: null,
          scheduledFor: DAY_06,
          status: DoseLogStatus.skipped,
        }),
      ],
      checkIns: [],
    };

    const section = service.build(input);

    expect(section.facts?.arguments['doseSlots']).toEqual({
      confirmed: 0,
      skipped: 2,
      unconfirmed: 0,
    });
  });

  it('is unknown with no_completed_actions when nothing was confirmed, skipped, or checked in', () => {
    const service = buildService();
    const input: ReviewActionFacts = {
      doseLogs: [
        doseLog({ status: DoseLogStatus.planned }),
        doseLog({
          scheduledFor: DAY_07,
          status: DoseLogStatus.missed,
        }),
      ],
      checkIns: [],
    };

    expect(service.build(input)).toEqual({
      state: 'unknown',
      reasonCode: 'no_completed_actions',
    });
  });

  it('is unknown with no_completed_actions for an empty window', () => {
    const service = buildService();
    const input: ReviewActionFacts = { doseLogs: [], checkIns: [] };

    expect(service.build(input)).toEqual({
      state: 'unknown',
      reasonCode: 'no_completed_actions',
    });
  });

  it('stays available on check-ins alone when no dose logs exist', () => {
    const service = buildService();
    const input: ReviewActionFacts = {
      doseLogs: [],
      checkIns: [checkIn(DAY_05, HealthEventOutcome.unchanged)],
    };

    expect(service.build(input)).toEqual({
      state: 'available',
      facts: {
        code: 'completed_actions',
        arguments: {
          doseSlots: { confirmed: 0, skipped: 0, unconfirmed: 0 },
          checkIns: [
            { date: '2026-08-05', outcome: HealthEventOutcome.unchanged },
          ],
        },
      },
    });
  });
});
