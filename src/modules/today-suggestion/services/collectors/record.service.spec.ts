import type { DeepMocked } from '../../../../common/types/deep-mocked';
import { DailyRecordKind } from '#generated/prisma/client';
import type { DailyRecordReaderPort } from '../../../daily-records';
import { RecordCollectorService } from './record.service';
import type { UserSettingsService } from '../../../user-settings';
import { USER_SETTINGS_DEFAULTS } from '../../../user-settings';
import { TREND_LOOKBACK_DAYS } from '../../constants/thresholds.constants';

describe('RecordCollectorService', () => {
  let service: RecordCollectorService;
  let userSettingsService: DeepMocked<UserSettingsService>;
  let dailyRecordReader: DeepMocked<DailyRecordReaderPort>;

  beforeEach(() => {
    userSettingsService = {
      getSettings: vi.fn(),
    } as unknown as DeepMocked<UserSettingsService>;
    dailyRecordReader = {
      listFactsInRange: vi.fn(),
    } as unknown as DeepMocked<DailyRecordReaderPort>;
    service = new RecordCollectorService(
      userSettingsService,
      dailyRecordReader,
    );
  });

  function makeRecord(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'rec-1',
      kind: DailyRecordKind.water,
      occurredAt: new Date('2026-07-09T00:00:00.000Z'),
      occurredTime: null,
      title: null,
      value: null,
      unit: null,
      note: null,
      payload: null,
      createdAt: new Date('2026-07-09T08:00:00.000Z'),
      ...overrides,
    };
  }

  function mockSettings(waterTargetCount: number) {
    (userSettingsService.getSettings as vi.Mock).mockResolvedValue({
      waterTargetCount,
    });
  }

  describe('collect', () => {
    it('emits a water_count signal with remaining count', async () => {
      (dailyRecordReader.listFactsInRange as vi.Mock)
        // todayRecords
        .mockResolvedValueOnce([
          makeRecord({
            id: 'w1',
            kind: DailyRecordKind.water,
            value: '250',
            unit: 'ml',
          }),
          makeRecord({
            id: 'w2',
            kind: DailyRecordKind.water,
            value: '250',
            unit: 'ml',
          }),
        ])
        // multiDayRecords
        .mockResolvedValueOnce([
          makeRecord({
            id: 'w1',
            kind: DailyRecordKind.water,
            value: '250',
            unit: 'ml',
          }),
          makeRecord({
            id: 'w2',
            kind: DailyRecordKind.water,
            value: '250',
            unit: 'ml',
          }),
        ]);
      mockSettings(8);

      const signals = await service.collect('user-1', '2026-07-09');

      const water = signals.find((s) => s.kind === 'water_count');
      expect(water).toBeDefined();
      expect(water!.payload).toMatchObject({
        completedCount: 2,
        targetCount: 8,
        remainingCount: 6,
        observedValue: 2,
        coverage: { sufficient: true },
      });
      const trend = signals.find((s) => s.kind === 'water_trend');
      expect(trend?.payload).toMatchObject({
        semantics: 'legacy_record_count',
        source: 'daily_record',
      });
    });

    it('uses default water target when setting is missing', async () => {
      (dailyRecordReader.listFactsInRange as vi.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockSettings(USER_SETTINGS_DEFAULTS.waterTargetCount);

      const signals = await service.collect('user-1', '2026-07-09');

      const water = signals.find((s) => s.kind === 'water_count');
      expect(water!.payload).toMatchObject({
        targetCount: USER_SETTINGS_DEFAULTS.waterTargetCount,
        remainingCount: USER_SETTINGS_DEFAULTS.waterTargetCount,
        coverage: { sufficient: false },
      });
      expect(water!.payload).not.toHaveProperty('observedValue');
    });

    it('distinguishes unknown water from an explicitly observed zero', async () => {
      (dailyRecordReader.listFactsInRange as vi.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockSettings(8);

      const unknownSignals = await service.collect('user-1', '2026-07-09');
      const unknownWater = unknownSignals.find((s) => s.kind === 'water_count');

      expect(unknownWater!.payload).toMatchObject({
        observedMetric: {
          value: null,
          state: 'unknown',
          coverage: 'none',
          sources: [],
          observedCount: 0,
          expectedCount: null,
        },
      });

      (dailyRecordReader.listFactsInRange as vi.Mock)
        .mockResolvedValueOnce([makeRecord({ value: '0', unit: 'ml' })])
        .mockResolvedValueOnce([makeRecord({ value: '0', unit: 'ml' })]);

      const zeroSignals = await service.collect('user-1', '2026-07-09');
      const zeroWater = zeroSignals.find((s) => s.kind === 'water_count');

      expect(zeroWater!.payload).toMatchObject({
        observedMetric: {
          value: 0,
          state: 'observed',
          coverage: 'sufficient',
          sources: ['manual'],
          observedCount: 1,
          expectedCount: null,
        },
      });
    });

    it('normalizes water records to milliliters instead of record count', async () => {
      (dailyRecordReader.listFactsInRange as vi.Mock)
        .mockResolvedValueOnce([makeRecord({ value: '500', unit: 'ml' })])
        .mockResolvedValueOnce([makeRecord({ value: '500', unit: 'ml' })]);
      mockSettings(8);

      const signals = await service.collect('user-1', '2026-07-09');
      const water = signals.find((s) => s.kind === 'water_count');

      expect(water!.payload).toMatchObject({
        observedMetric: {
          value: 500,
          state: 'observed',
          coverage: 'sufficient',
          sources: ['manual'],
        },
      });
    });

    it('emits a sleep_record signal when a sleep record exists', async () => {
      const sleepPayload = { durationMinutes: 420, quality: 'good' };
      (dailyRecordReader.listFactsInRange as vi.Mock)
        // todayRecords
        .mockResolvedValueOnce([
          makeRecord({
            id: 's1',
            kind: DailyRecordKind.sleep,
            payload: sleepPayload,
          }),
        ])
        // multiDayRecords
        .mockResolvedValueOnce([
          makeRecord({
            id: 's1',
            kind: DailyRecordKind.sleep,
            payload: sleepPayload,
          }),
        ]);
      mockSettings(8);

      const signals = await service.collect('user-1', '2026-07-09');

      const sleep = signals.find((s) => s.kind === 'sleep_record');
      expect(sleep).toBeDefined();
      expect(sleep!.payload).toMatchObject({
        durationMinutes: 420,
        quality: 'good',
        recordId: 's1',
        observedValue: 420,
        coverage: { sufficient: true },
      });
    });

    it('emits a sleep_trend signal when multiple days of sleep exist', async () => {
      const day1 = new Date('2026-07-08T00:00:00.000Z');
      const day2 = new Date('2026-07-09T00:00:00.000Z');
      (dailyRecordReader.listFactsInRange as vi.Mock)
        // todayRecords
        .mockResolvedValueOnce([
          makeRecord({
            id: 's1',
            kind: DailyRecordKind.sleep,
            occurredAt: day2,
            payload: { durationMinutes: 360 },
          }),
        ])
        // multiDayRecords
        .mockResolvedValueOnce([
          makeRecord({
            id: 's0',
            kind: DailyRecordKind.sleep,
            occurredAt: day1,
            payload: { durationMinutes: 400 },
          }),
          makeRecord({
            id: 's1',
            kind: DailyRecordKind.sleep,
            occurredAt: day2,
            payload: { durationMinutes: 360 },
          }),
        ]);
      mockSettings(8);

      const signals = await service.collect('user-1', '2026-07-09');

      const trend = signals.find((s) => s.kind === 'sleep_trend');
      expect(trend).toBeDefined();
      expect(trend!.payload).toMatchObject({
        consecutiveDays: 2,
      });
    });

    it('emits a record_density signal with today and multi-day counts', async () => {
      (dailyRecordReader.listFactsInRange as vi.Mock)
        // todayRecords
        .mockResolvedValueOnce([
          makeRecord({ id: 'r1', kind: DailyRecordKind.water }),
          makeRecord({ id: 'r2', kind: DailyRecordKind.sleep }),
        ])
        // multiDayRecords
        .mockResolvedValueOnce([
          makeRecord({ id: 'r1', kind: DailyRecordKind.water }),
          makeRecord({ id: 'r2', kind: DailyRecordKind.sleep }),
          makeRecord({ id: 'r3', kind: DailyRecordKind.mood }),
        ]);
      mockSettings(8);

      const signals = await service.collect('user-1', '2026-07-09');

      const density = signals.find((s) => s.kind === 'record_density');
      expect(density).toBeDefined();
      expect(density!.payload).toMatchObject({
        todayCount: 2,
        multiDayCount: 3,
        lookbackDays: TREND_LOOKBACK_DAYS,
      });
    });

    it('emits a caffeine_trend signal for meal records with coffee keywords', async () => {
      (dailyRecordReader.listFactsInRange as vi.Mock)
        // todayRecords
        .mockResolvedValueOnce([
          makeRecord({
            id: 'c1',
            kind: DailyRecordKind.meal,
            title: 'Coffee',
          }),
        ])
        // multiDayRecords
        .mockResolvedValueOnce([
          makeRecord({
            id: 'c1',
            kind: DailyRecordKind.meal,
            title: 'Coffee',
            occurredAt: new Date('2026-07-09T00:00:00.000Z'),
          }),
          makeRecord({
            id: 'c2',
            kind: DailyRecordKind.meal,
            title: '咖啡',
            occurredAt: new Date('2026-07-08T00:00:00.000Z'),
          }),
        ]);
      mockSettings(8);

      const signals = await service.collect('user-1', '2026-07-09');

      const caffeine = signals.find((s) => s.kind === 'caffeine_trend');
      expect(caffeine).toBeDefined();
      expect(caffeine!.payload).toMatchObject({
        consecutiveDays: 2,
      });
    });

    it('emits a mood_trend signal for mood records', async () => {
      (dailyRecordReader.listFactsInRange as vi.Mock)
        // todayRecords
        .mockResolvedValueOnce([
          makeRecord({
            id: 'm1',
            kind: DailyRecordKind.mood,
            title: 'Good',
            value: '4',
          }),
        ])
        // multiDayRecords
        .mockResolvedValueOnce([
          makeRecord({
            id: 'm0',
            kind: DailyRecordKind.mood,
            title: 'Bad',
            value: '2',
            occurredAt: new Date('2026-07-08T00:00:00.000Z'),
          }),
          makeRecord({
            id: 'm1',
            kind: DailyRecordKind.mood,
            title: 'Good',
            value: '4',
            occurredAt: new Date('2026-07-09T00:00:00.000Z'),
          }),
        ]);
      mockSettings(8);

      const signals = await service.collect('user-1', '2026-07-09');

      const mood = signals.find((s) => s.kind === 'mood_trend');
      expect(mood).toBeDefined();
      expect(mood!.payload).toMatchObject({
        consecutiveDays: 2,
      });
    });

    it('emits a symptom_trend signal for symptom records', async () => {
      (dailyRecordReader.listFactsInRange as vi.Mock)
        // todayRecords
        .mockResolvedValueOnce([
          makeRecord({
            id: 'sym1',
            kind: DailyRecordKind.symptom,
            title: 'Headache',
            value: 'mild',
          }),
        ])
        // multiDayRecords
        .mockResolvedValueOnce([
          makeRecord({
            id: 'sym1',
            kind: DailyRecordKind.symptom,
            title: 'Headache',
            value: 'mild',
            occurredAt: new Date('2026-07-09T00:00:00.000Z'),
          }),
        ]);
      mockSettings(8);

      const signals = await service.collect('user-1', '2026-07-09');

      const symptom = signals.find((s) => s.kind === 'symptom_trend');
      expect(symptom).toBeDefined();
      expect(symptom!.payload).toMatchObject({
        totalRecords: 1,
        uniqueDates: 1,
      });
    });
  });

  describe('getTimeOfDay', () => {
    it('returns morning for 5:00 UTC', () => {
      expect(
        RecordCollectorService.getTimeOfDay(new Date('2026-07-09T05:00:00Z')),
      ).toBe('morning');
    });

    it('returns afternoon for 12:00 UTC', () => {
      expect(
        RecordCollectorService.getTimeOfDay(new Date('2026-07-09T12:00:00Z')),
      ).toBe('afternoon');
    });

    it('returns evening for 17:00 UTC', () => {
      expect(
        RecordCollectorService.getTimeOfDay(new Date('2026-07-09T17:00:00Z')),
      ).toBe('evening');
    });

    it('returns night for 22:00 UTC', () => {
      expect(
        RecordCollectorService.getTimeOfDay(new Date('2026-07-09T22:00:00Z')),
      ).toBe('night');
    });

    it('returns night for 3:00 UTC', () => {
      expect(
        RecordCollectorService.getTimeOfDay(new Date('2026-07-09T03:00:00Z')),
      ).toBe('night');
    });
  });
});
