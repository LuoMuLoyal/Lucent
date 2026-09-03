import type { DeepMocked } from '../../../../common/types/deep-mocked.js';
import {
  DailyRecordKind,
  HealthEventOutcome,
} from '#generated/prisma/client.js';
import type { DailyRecordReaderPort } from '../../../daily-records/index.js';
import type {
  HealthEventsOwnershipService,
  HealthEventRecord,
  HealthEventCheckInRecord,
} from '../../../health-events/index.js';
import { HealthEventCollectorService } from './health-event.service.js';

describe('HealthEventCollectorService', () => {
  let service: HealthEventCollectorService;
  let healthEvents: DeepMocked<HealthEventsOwnershipService>;
  let dailyRecordReader: DeepMocked<DailyRecordReaderPort>;

  beforeEach(() => {
    healthEvents = {
      findActive: vi.fn(),
      findCheckIns: vi.fn(),
    } as unknown as DeepMocked<HealthEventsOwnershipService>;
    dailyRecordReader = {
      countFactsInRange: vi.fn(),
    } as unknown as DeepMocked<DailyRecordReaderPort>;
    service = new HealthEventCollectorService(healthEvents, dailyRecordReader);
  });

  function makeEvent(
    overrides: Partial<HealthEventRecord> = {},
  ): HealthEventRecord {
    return {
      id: 'evt-1',
      userId: 'user-1',
      title: '头痛观察',
      status: 'active' as HealthEventRecord['status'],
      startedAt: new Date('2026-07-05T00:00:00.000Z'),
      endedAt: null,
      outcome: null,
      reasonRecordId: null,
      deletedAt: null,
      currentMedicineIds: [],
      ...overrides,
    };
  }

  function makeCheckIn(
    date: string,
    outcome: HealthEventOutcome,
  ): HealthEventCheckInRecord {
    return {
      id: `ci-${date}`,
      eventId: 'evt-1',
      date: new Date(`${date}T00:00:00.000Z`),
      outcome,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  it('returns an empty array when there is no active event', async () => {
    (healthEvents.findActive as vi.Mock).mockResolvedValue(null);

    const signals = await service.collect('user-1', '2026-07-09');

    expect(signals).toEqual([]);
    expect(healthEvents.findCheckIns).not.toHaveBeenCalled();
    expect(dailyRecordReader.countFactsInRange).not.toHaveBeenCalled();
  });

  it('emits an event_check_in_trend signal when an active event exists', async () => {
    const event = makeEvent({
      endedAt: new Date('2026-07-10T00:00:00.000Z'),
    });
    (healthEvents.findActive as vi.Mock).mockResolvedValue(event);
    (healthEvents.findCheckIns as vi.Mock).mockResolvedValue([
      makeCheckIn('2026-07-05', HealthEventOutcome.unchanged),
      makeCheckIn('2026-07-08', HealthEventOutcome.worsened),
      makeCheckIn('2026-07-09', HealthEventOutcome.worsened),
    ]);
    (dailyRecordReader.countFactsInRange as vi.Mock).mockResolvedValue(2);

    const signals = await service.collect('user-1', '2026-07-09');

    expect(signals).toHaveLength(1);
    const signal = signals[0]!;
    expect(signal.signalId).toBe('he_event_check_in_trend_2026-07-09');
    expect(signal.source).toBe('health_event');
    expect(signal.kind).toBe('event_check_in_trend');
    expect(signal.userId).toBe('user-1');
    expect(signal.triggerType).toBe('event');

    expect(signal.payload).toMatchObject({
      eventId: 'evt-1',
      eventTitle: '头痛观察',
      startedAt: '2026-07-05T00:00:00.000Z',
      endedAt: '2026-07-10T00:00:00.000Z',
      checkIns: [
        { date: '2026-07-05', outcome: HealthEventOutcome.unchanged },
        { date: '2026-07-08', outcome: HealthEventOutcome.worsened },
        { date: '2026-07-09', outcome: HealthEventOutcome.worsened },
      ],
      symptomRecordCount: 2,
    });

    expect(dailyRecordReader.countFactsInRange).toHaveBeenCalledWith(
      'user-1',
      event.startedAt,
      event.endedAt,
      [DailyRecordKind.symptom],
    );
  });

  it('uses now() as the range end for an active event without endedAt', async () => {
    const event = makeEvent({ endedAt: null });
    (healthEvents.findActive as vi.Mock).mockResolvedValue(event);
    (healthEvents.findCheckIns as vi.Mock).mockResolvedValue([]);
    (dailyRecordReader.countFactsInRange as vi.Mock).mockResolvedValue(0);

    await service.collect('user-1', '2026-07-09');

    const [, , toArg] = (dailyRecordReader.countFactsInRange as vi.Mock).mock
      .calls[0]!;
    expect(toArg).toBeInstanceOf(Date);
  });
});
