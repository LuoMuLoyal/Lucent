import {
  DailyRecordKind,
  HealthEventOutcome,
} from '#generated/prisma/client.js';
import {
  EventReviewChangesService,
  type ReviewChangeCheckIn,
  type ReviewChangeDailyRecord,
  type ReviewChangeFacts,
} from './changes.service.js';

const DAY_10 = new Date('2026-08-10T00:00:00.000Z');
const DAY_11 = new Date('2026-08-11T00:00:00.000Z');
const DAY_12 = new Date('2026-08-12T00:00:00.000Z');

function checkIn(date: Date, outcome: HealthEventOutcome): ReviewChangeCheckIn {
  return { date, outcome };
}

function waterRecord(
  occurredAt: Date,
  value: string,
  unit: string,
): ReviewChangeDailyRecord {
  return {
    occurredAt,
    kind: DailyRecordKind.water,
    value,
    unit,
    payload: null,
  };
}

function sleepRecord(
  occurredAt: Date,
  durationMinutes: number,
): ReviewChangeDailyRecord {
  return {
    occurredAt,
    kind: DailyRecordKind.sleep,
    value: null,
    unit: null,
    payload: { durationMinutes },
  };
}

function buildService() {
  return new EventReviewChangesService();
}

describe('EventReviewChangesService', () => {
  it('reports an improved check-in sequence as a factual trend', () => {
    const service = buildService();
    const input: ReviewChangeFacts = {
      checkIns: [
        checkIn(DAY_10, HealthEventOutcome.worsened),
        checkIn(DAY_11, HealthEventOutcome.unchanged),
        checkIn(DAY_12, HealthEventOutcome.improved),
      ],
      dailyRecords: [],
    };

    expect(service.build(input)).toEqual({
      state: 'available',
      facts: {
        code: 'observed_changes',
        arguments: {
          checkIns: {
            direction: 'improved',
            fromOutcome: HealthEventOutcome.worsened,
            toOutcome: HealthEventOutcome.improved,
            firstDate: '2026-08-10',
            lastDate: '2026-08-12',
            count: 3,
          },
          water: null,
          sleep: null,
        },
      },
    });
  });

  it('reports an unchanged check-in sequence', () => {
    const service = buildService();
    const input: ReviewChangeFacts = {
      checkIns: [
        checkIn(DAY_10, HealthEventOutcome.unchanged),
        checkIn(DAY_11, HealthEventOutcome.unchanged),
      ],
      dailyRecords: [],
    };

    const section = service.build(input);

    expect(section.facts?.arguments['checkIns']).toEqual({
      direction: 'unchanged',
      fromOutcome: HealthEventOutcome.unchanged,
      toOutcome: HealthEventOutcome.unchanged,
      firstDate: '2026-08-10',
      lastDate: '2026-08-11',
      count: 2,
    });
  });

  it('reports a worsened check-in sequence', () => {
    const service = buildService();
    const input: ReviewChangeFacts = {
      checkIns: [
        checkIn(DAY_10, HealthEventOutcome.improved),
        checkIn(DAY_12, HealthEventOutcome.worsened),
      ],
      dailyRecords: [],
    };

    const section = service.build(input);

    expect(section.facts?.arguments['checkIns']).toEqual({
      direction: 'worsened',
      fromOutcome: HealthEventOutcome.improved,
      toOutcome: HealthEventOutcome.worsened,
      firstDate: '2026-08-10',
      lastDate: '2026-08-12',
      count: 2,
    });
  });

  it('reports a water single-dimension trend summing per-day values', () => {
    const service = buildService();
    const input: ReviewChangeFacts = {
      checkIns: [],
      dailyRecords: [
        waterRecord(DAY_10, '500', 'ml'),
        waterRecord(DAY_10, '300', 'ml'),
        waterRecord(DAY_11, '250', 'ml'),
        waterRecord(DAY_12, '1', 'l'),
      ],
    };

    expect(service.build(input)).toEqual({
      state: 'available',
      facts: {
        code: 'observed_changes',
        arguments: {
          checkIns: null,
          water: {
            direction: 'up',
            firstValue: 800,
            lastValue: 1000,
            firstDate: '2026-08-10',
            lastDate: '2026-08-12',
            observedDays: 3,
          },
          sleep: null,
        },
      },
    });
  });

  it('reports a sleep single-dimension trend from payload duration minutes', () => {
    const service = buildService();
    const input: ReviewChangeFacts = {
      checkIns: [],
      dailyRecords: [
        sleepRecord(DAY_10, 360),
        sleepRecord(DAY_11, 420),
        sleepRecord(DAY_12, 390),
      ],
    };

    expect(service.build(input)).toEqual({
      state: 'available',
      facts: {
        code: 'observed_changes',
        arguments: {
          checkIns: null,
          water: null,
          sleep: {
            direction: 'up',
            firstValue: 6,
            lastValue: 6.5,
            firstDate: '2026-08-10',
            lastDate: '2026-08-12',
            observedDays: 3,
          },
        },
      },
    });
  });

  it('ignores unparsable water and sleep records without failing the section', () => {
    const service = buildService();
    const input: ReviewChangeFacts = {
      checkIns: [checkIn(DAY_10, HealthEventOutcome.unchanged)],
      dailyRecords: [
        {
          occurredAt: DAY_10,
          kind: DailyRecordKind.water,
          value: 'not-a-number',
          unit: 'ml',
          payload: null,
        },
        {
          occurredAt: DAY_11,
          kind: DailyRecordKind.sleep,
          value: null,
          unit: null,
          payload: { sleepEvent: 'start' },
        },
      ],
    };

    const section = service.build(input);

    expect(section.state).toBe('unknown');
    expect(section.reasonCode).toBe('insufficient_coverage');
  });

  it('is unknown with no_observations when the window has no observations', () => {
    const service = buildService();
    const input: ReviewChangeFacts = { checkIns: [], dailyRecords: [] };

    expect(service.build(input)).toEqual({
      state: 'unknown',
      reasonCode: 'no_observations',
    });
  });

  it('is unknown with insufficient_coverage when a single point cannot form a trend', () => {
    const service = buildService();
    const input: ReviewChangeFacts = {
      checkIns: [checkIn(DAY_10, HealthEventOutcome.unchanged)],
      dailyRecords: [waterRecord(DAY_10, '250', 'ml')],
    };

    expect(service.build(input)).toEqual({
      state: 'unknown',
      reasonCode: 'insufficient_coverage',
    });
  });

  it('keeps missing dimensions null inside an available section', () => {
    const service = buildService();
    const input: ReviewChangeFacts = {
      checkIns: [
        checkIn(DAY_10, HealthEventOutcome.unchanged),
        checkIn(DAY_11, HealthEventOutcome.improved),
      ],
      dailyRecords: [waterRecord(DAY_10, '250', 'ml')],
    };

    const section = service.build(input);

    expect(section.state).toBe('available');
    expect(section.facts?.code).toBe('observed_changes');
    expect(section.facts?.arguments['checkIns']).not.toBeNull();
    expect(section.facts?.arguments['water']).toBeNull();
    expect(section.facts?.arguments['sleep']).toBeNull();
  });
});
