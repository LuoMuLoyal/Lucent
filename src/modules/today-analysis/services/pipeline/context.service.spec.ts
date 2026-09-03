import { TodayAnalysisContextService } from './context.service.js';
import { DailyRecordKind } from '#generated/prisma/client.js';

function createMockCache() {
  return {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
  } as never;
}

describe('TodayAnalysisContextService', () => {
  const buildMocks = (records: unknown[]) => ({
    prisma: {
      userCurrentMedicine: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      userAllergy: {
        count: vi.fn().mockResolvedValue(0),
      },
      userSetting: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    },
    dailyRecordReader: {
      listFactsInRange: vi.fn().mockResolvedValue(records),
    },
    doseLogReader: {
      listFactsInRange: vi.fn().mockResolvedValue([]),
    },
    reminderReader: {
      listActiveFacts: vi.fn().mockResolvedValue([]),
    },
  });

  it('includes unconfirmed meal analysis facts in recent records conservatively', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([
        {
          kind: 'meal',
          occurredTime: '12:30',
          title: null,
          value: null,
          unit: null,
          note: null,
          payload: {
            mealAnalysis: {
              analysisStatus: 'unconfirmed',
              coverage: 'partial',
              mealDescription: '一份米饭配西兰花和鸡胸肉',
              foodItems: [{ name: '米饭' }, { name: '鸡胸肉' }],
            },
          },
          createdAt: new Date('2026-07-01T04:30:00.000Z'),
        },
      ]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.recordSummary).toEqual([{ kind: 'meal', count: 1 }]);
    expect(context.recentRecords).toEqual([
      {
        kind: 'meal',
        title: '饮食估算中（部分匹配）：一份米饭配西兰花和鸡胸肉',
        value: null,
        unit: null,
        note: '部分估算 · 识别食物：米饭、鸡胸肉',
        createdAt: '2026-07-01T04:30:00.000Z',
      },
    ]);
  });

  it('does not surface analyzing meal records as completed meal summaries', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([
        {
          kind: 'meal',
          occurredTime: '18:30',
          title: '晚饭',
          value: null,
          unit: null,
          note: null,
          payload: {
            mealAnalysis: {
              analysisStatus: 'analyzing',
              coverage: 'none',
            },
          },
          createdAt: new Date('2026-07-01T10:30:00.000Z'),
        },
      ]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.recentRecords[0]).toEqual({
      kind: 'meal',
      title: '晚饭',
      value: null,
      unit: null,
      note: null,
      createdAt: '2026-07-01T10:30:00.000Z',
    });
  });

  it('surfaces analysis_failed meal records as missing meal-analysis data', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([
        {
          kind: 'meal',
          occurredTime: '18:30',
          title: '晚饭',
          value: null,
          unit: null,
          note: null,
          payload: {
            mealAnalysis: {
              analysisStatus: 'analysis_failed',
              coverage: 'none',
              failureReason: 'Attachment not readable',
            },
          },
          createdAt: new Date('2026-07-01T10:30:00.000Z'),
        },
      ]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.recentRecords[0]).toEqual({
      kind: 'meal',
      title: '饮食分析缺失',
      value: null,
      unit: null,
      note: '未能识别饮食内容，缺少可使用的餐食分析数据',
      createdAt: '2026-07-01T10:30:00.000Z',
    });
  });

  it('labels confirmed meals with partial coverage as partial estimates', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([
        {
          kind: 'meal',
          occurredTime: '12:00',
          title: null,
          value: null,
          unit: null,
          note: null,
          payload: {
            mealAnalysis: {
              analysisStatus: 'confirmed',
              coverage: 'partial',
              mealDescription: '一份牛肉面',
              foodItems: [{ name: '牛肉' }, { name: '面条' }],
            },
          },
          createdAt: new Date('2026-07-01T04:00:00.000Z'),
        },
      ]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.recentRecords[0]).toEqual({
      kind: 'meal',
      title: '饮食已确认（部分匹配）：一份牛肉面',
      value: null,
      unit: null,
      note: '部分估算 · 识别食物：牛肉、面条',
      createdAt: '2026-07-01T04:00:00.000Z',
    });
  });

  it('surfaces complete confirmed meals without partial labels', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([
        {
          kind: 'meal',
          occurredTime: '12:00',
          title: null,
          value: null,
          unit: null,
          note: null,
          payload: {
            mealAnalysis: {
              analysisStatus: 'confirmed',
              coverage: 'complete',
              mealDescription: '一份米饭配青菜',
              foodItems: [{ name: '米饭' }, { name: '青菜' }],
            },
          },
          createdAt: new Date('2026-07-01T04:00:00.000Z'),
        },
      ]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.recentRecords[0]).toEqual({
      kind: 'meal',
      title: '饮食已确认：一份米饭配青菜',
      value: null,
      unit: null,
      note: '识别食物：米饭、青菜',
      createdAt: '2026-07-01T04:00:00.000Z',
    });
  });

  it('uses recognizedDishes when foodItems is not available', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([
        {
          kind: 'meal',
          occurredTime: '12:00',
          title: null,
          value: null,
          unit: null,
          note: null,
          payload: {
            mealAnalysis: {
              analysisStatus: 'unconfirmed',
              coverage: 'complete',
              mealDescription: '一份面条',
              recognizedDishes: [
                { rawName: '牛肉面' },
                { normalizedDishName: '面条' },
              ],
            },
          },
          createdAt: new Date('2026-07-01T04:00:00.000Z'),
        },
      ]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.recentRecords[0]?.note).toContain('牛肉面');
  });

  it('returns water target from user settings when configured', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([]);
    prisma.userSetting.findUnique = vi.fn().mockResolvedValue({
      value: 12,
    });
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.water.targetCount).toBe(12);
  });

  it('falls back to default water target when user setting is not a number', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([]);
    prisma.userSetting.findUnique = vi.fn().mockResolvedValue({
      value: 'not-a-number',
    });
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.water.targetCount).toBe(8);
  });

  it('falls back to default water target when user setting is null', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([]);
    prisma.userSetting.findUnique = vi.fn().mockResolvedValue(null);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.water.targetCount).toBe(8);
  });

  it('computes water remaining count as max(0, target - completed)', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([
        {
          kind: 'water',
          occurredTime: null,
          title: null,
          value: '250',
          unit: 'ml',
          note: null,
          payload: null,
          createdAt: new Date('2026-07-01T01:00:00.000Z'),
        },
        {
          kind: 'water',
          occurredTime: null,
          title: null,
          value: '250',
          unit: 'ml',
          note: null,
          payload: null,
          createdAt: new Date('2026-07-01T02:00:00.000Z'),
        },
      ]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.water.completedCount).toBe(2);
    expect(context.water.targetCount).toBe(8);
    expect(context.water.remainingCount).toBe(6);
  });

  it('clamps water remaining to 0 when completed exceeds target', async () => {
    const records = Array.from({ length: 10 }, (_, i) => ({
      kind: 'water',
      occurredTime: null,
      title: null,
      value: '250',
      unit: 'ml',
      note: null,
      payload: null,
      createdAt: new Date(
        `2026-07-01T${String(i).padStart(2, '0')}:00:00.000Z`,
      ),
    }));
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks(records);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.water.completedCount).toBe(10);
    expect(context.water.remainingCount).toBe(0);
  });

  it('keeps unknown water from becoming a remaining deficit', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.water.observedMetric).toMatchObject({
      value: null,
      state: 'unknown',
      coverage: 'none',
    });
    expect(context.water.remainingCount).toBe(0);
  });

  it('computes Today water from canonical milliliters', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([
        {
          kind: 'water',
          occurredTime: null,
          title: null,
          value: '500',
          unit: 'ml',
          note: null,
          payload: null,
          createdAt: new Date('2026-07-01T01:00:00.000Z'),
        },
      ]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.water).toMatchObject({
      completedCount: 1,
      remainingCount: 6,
      observedMetric: {
        value: 500,
        state: 'observed',
        coverage: 'sufficient',
      },
    });
  });

  it('includes medication context with pending count and next dose time', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([]);
    prisma.userCurrentMedicine.findMany = vi.fn().mockResolvedValue([
      {
        id: 'med-1',
        displayName: '阿司匹林',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
      {
        id: 'med-2',
        displayName: '维生素B族',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]);
    reminderReader.listActiveFacts = vi.fn().mockResolvedValue([
      {
        currentMedicineId: 'med-2',
        scheduledHour: 8,
        scheduledMinute: 0,
        daysOfWeek: null,
        startDate: null,
        endDate: null,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]);
    doseLogReader.listFactsInRange = vi
      .fn()
      .mockResolvedValue([{ currentMedicineId: 'med-1', status: 'taken' }]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.medication.medicineCount).toBe(2);
    expect(context.medication.pendingCount).toBe(1);
    expect(context.medication.nextMedicineName).toBe('维生素B族');
    expect(context.medication.nextDoseTimeLabel).toBe('08:00');
    expect(context.medication.currentMedicineNames).toEqual([
      '阿司匹林',
      '维生素B族',
    ]);
  });

  it('shows "--" for next dose time when no pending reminder matches', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([]);
    prisma.userCurrentMedicine.findMany = vi.fn().mockResolvedValue([
      {
        id: 'med-1',
        displayName: '阿司匹林',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]);
    reminderReader.listActiveFacts = vi.fn().mockResolvedValue([]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.medication.nextDoseTimeLabel).toBe('--');
    expect(context.medication.nextMedicineName).toBeNull();
  });

  it('extracts sleep data from daily record payload', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([
        {
          kind: 'sleep',
          occurredTime: null,
          title: null,
          value: null,
          unit: null,
          note: null,
          payload: {
            durationMinutes: 480,
            quality: 'good',
            startAt: '2026-06-30T23:00:00.000Z',
            endAt: '2026-07-01T07:00:00.000Z',
            deepMinutes: 120,
            lightMinutes: 240,
            remMinutes: 120,
          },
          createdAt: new Date('2026-07-01T07:00:00.000Z'),
        },
      ]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.sleep.status).toBe('ok');
    expect(context.sleep.durationMinutes).toBe(480);
    expect(context.sleep.quality).toBe('good');
    expect(context.sleep.deepMinutes).toBe(120);
    expect(context.sleep.lightMinutes).toBe(240);
    expect(context.sleep.remMinutes).toBe(120);
  });

  it('returns insufficient_data for sleep when duration is 0', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([
        {
          kind: 'sleep',
          occurredTime: null,
          title: null,
          value: null,
          unit: null,
          note: null,
          payload: {
            durationMinutes: 0,
          },
          createdAt: new Date('2026-07-01T07:00:00.000Z'),
        },
      ]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.sleep.status).toBe('insufficient_data');
  });

  it('returns insufficient_data for sleep when payload is null', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([
        {
          kind: 'sleep',
          occurredTime: null,
          title: null,
          value: null,
          unit: null,
          note: null,
          payload: null,
          createdAt: new Date('2026-07-01T07:00:00.000Z'),
        },
      ]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.sleep.status).toBe('insufficient_data');
    expect(context.sleep.durationMinutes).toBeNull();
  });

  it('handles non-meal daily records in recent records', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([
        {
          kind: 'weight',
          occurredTime: '08:00',
          title: '体重',
          value: '65.5',
          unit: 'kg',
          note: '空腹',
          payload: null,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.recentRecords).toHaveLength(1);
    expect(context.recentRecords[0]).toEqual({
      kind: 'weight',
      title: '体重',
      value: '65.5',
      unit: 'kg',
      note: '空腹',
      createdAt: '2026-07-01T00:00:00.000Z',
    });
  });

  it('trims whitespace from daily record text fields', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([
        {
          kind: 'weight',
          occurredTime: '08:00',
          title: '  体重  ',
          value: '  65.5  ',
          unit: '  kg  ',
          note: '  ',
          payload: null,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.recentRecords[0]?.title).toBe('体重');
    expect(context.recentRecords[0]?.value).toBe('65.5');
    expect(context.recentRecords[0]?.unit).toBe('kg');
    expect(context.recentRecords[0]?.note).toBeNull();
  });

  it('includes active allergy count in low-risk context', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([]);
    prisma.userAllergy.count = vi.fn().mockResolvedValue(3);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.lowRiskContext.activeAllergyCount).toBe(3);
  });

  it('builds record summary grouped by kind', async () => {
    // The service re-sorts facts by createdAt desc; keep the water records
    // newest so the summary order stays water-first.
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([
        {
          kind: 'water',
          occurredTime: null,
          title: null,
          value: null,
          unit: null,
          note: null,
          payload: null,
          createdAt: new Date('2026-07-01T02:00:00.000Z'),
        },
        {
          kind: 'water',
          occurredTime: null,
          title: null,
          value: null,
          unit: null,
          note: null,
          payload: null,
          createdAt: new Date('2026-07-01T03:00:00.000Z'),
        },
        {
          kind: 'weight',
          occurredTime: null,
          title: null,
          value: null,
          unit: null,
          note: null,
          payload: null,
          createdAt: new Date('2026-07-01T01:00:00.000Z'),
        },
      ]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.recordSummary).toEqual([
      { kind: 'water', count: 2 },
      { kind: 'weight', count: 1 },
    ]);
  });

  it('limits current medicine names to 5 entries', async () => {
    const meds = Array.from({ length: 7 }, (_, i) => ({
      id: `med-${i}`,
      displayName: `药品${i}`,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    }));
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([]);
    prisma.userCurrentMedicine.findMany = vi.fn().mockResolvedValue(meds);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.medication.currentMedicineNames).toHaveLength(5);
  });

  it('filters out empty medicine display names', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([]);
    prisma.userCurrentMedicine.findMany = vi.fn().mockResolvedValue([
      {
        id: 'med-1',
        displayName: '阿司匹林',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
      {
        id: 'med-2',
        displayName: '  ',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
      {
        id: 'med-3',
        displayName: '',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.medication.currentMedicineNames).toEqual(['阿司匹林']);
    expect(context.medication.medicineCount).toBe(3);
  });

  it('filters reminder by startDate and endDate', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([]);
    prisma.userCurrentMedicine.findMany = vi.fn().mockResolvedValue([
      {
        id: 'med-1',
        displayName: '药品A',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]);
    // Reminder is for a future start date — should not match
    reminderReader.listActiveFacts = vi.fn().mockResolvedValue([
      {
        currentMedicineId: 'med-1',
        scheduledHour: 8,
        scheduledMinute: 0,
        daysOfWeek: null,
        startDate: new Date('2026-08-01'),
        endDate: null,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.medication.nextDoseTimeLabel).toBe('--');
  });

  it('matches reminder with daysOfWeek including the current weekday', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([]);
    prisma.userCurrentMedicine.findMany = vi.fn().mockResolvedValue([
      {
        id: 'med-1',
        displayName: '药品A',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]);
    // 2026-07-01 is a Wednesday → weekday = 3
    reminderReader.listActiveFacts = vi.fn().mockResolvedValue([
      {
        currentMedicineId: 'med-1',
        scheduledHour: 14,
        scheduledMinute: 30,
        daysOfWeek: [1, 3, 5],
        startDate: null,
        endDate: null,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.medication.nextDoseTimeLabel).toBe('14:30');
  });

  it('does not match reminder with daysOfWeek excluding the current weekday', async () => {
    const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
      buildMocks([]);
    prisma.userCurrentMedicine.findMany = vi.fn().mockResolvedValue([
      {
        id: 'med-1',
        displayName: '药品A',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]);
    // 2026-07-01 is a Wednesday → weekday = 3
    reminderReader.listActiveFacts = vi.fn().mockResolvedValue([
      {
        currentMedicineId: 'med-1',
        scheduledHour: 14,
        scheduledMinute: 30,
        daysOfWeek: [0, 1, 2],
        startDate: null,
        endDate: null,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]);
    const service = new TodayAnalysisContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
      reminderReader as never,
      createMockCache(),
    );

    const context = await service.build('u1', '2026-07-01');

    expect(context.medication.nextDoseTimeLabel).toBe('--');
  });

  describe('shouldTriggerForDimension', () => {
    it('passes when coverage reaches 3 records in the last 7 days', async () => {
      const records = Array.from({ length: 3 }, (_, i) => ({
        kind: 'water',
        occurredAt: new Date(`2026-07-0${i + 1}T08:00:00.000Z`),
        value: '250',
        unit: 'ml',
        payload: null,
        createdAt: new Date(`2026-07-0${i + 1}T08:00:00.000Z`),
      }));
      const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
        buildMocks(records);
      const service = new TodayAnalysisContextService(
        prisma as never,
        dailyRecordReader as never,
        doseLogReader as never,
        reminderReader as never,
        createMockCache(),
      );

      const result = await service.shouldTriggerForDimension(
        'u1',
        '2026-07-03',
        DailyRecordKind.water,
      );

      expect(result).toBe(true);
    });

    it('fails when coverage is below 3 and change is small', async () => {
      const records = [
        {
          kind: 'water',
          occurredAt: new Date('2026-07-01T08:00:00.000Z'),
          value: '250',
          unit: 'ml',
          payload: null,
          createdAt: new Date('2026-07-01T08:00:00.000Z'),
        },
        {
          kind: 'water',
          occurredAt: new Date('2026-06-25T08:00:00.000Z'),
          value: '250',
          unit: 'ml',
          payload: null,
          createdAt: new Date('2026-06-25T08:00:00.000Z'),
        },
      ];
      const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
        buildMocks(records);
      const service = new TodayAnalysisContextService(
        prisma as never,
        dailyRecordReader as never,
        doseLogReader as never,
        reminderReader as never,
        createMockCache(),
      );

      const result = await service.shouldTriggerForDimension(
        'u1',
        '2026-07-01',
        DailyRecordKind.water,
      );

      expect(result).toBe(false);
    });

    it('passes for water when today increases >= 50% over baseline', async () => {
      const records = [
        {
          kind: 'water',
          occurredAt: new Date('2026-07-01T08:00:00.000Z'),
          value: '1500',
          unit: 'ml',
          payload: null,
          createdAt: new Date('2026-07-01T08:00:00.000Z'),
        },
        ...Array.from({ length: 7 }, (_, i) => ({
          kind: 'water',
          occurredAt: new Date(`2026-06-2${4 + i}T08:00:00.000Z`),
          value: '500',
          unit: 'ml',
          payload: null,
          createdAt: new Date(`2026-06-2${4 + i}T08:00:00.000Z`),
        })),
      ];
      const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
        buildMocks(records);
      const service = new TodayAnalysisContextService(
        prisma as never,
        dailyRecordReader as never,
        doseLogReader as never,
        reminderReader as never,
        createMockCache(),
      );

      const result = await service.shouldTriggerForDimension(
        'u1',
        '2026-07-01',
        DailyRecordKind.water,
      );

      expect(result).toBe(true);
    });

    it('passes for sleep when duration changes >= 50% over baseline', async () => {
      const records = [
        {
          kind: 'sleep',
          occurredAt: new Date('2026-07-01T08:00:00.000Z'),
          value: null,
          unit: null,
          payload: { durationMinutes: 120 },
          createdAt: new Date('2026-07-01T08:00:00.000Z'),
        },
        ...Array.from({ length: 7 }, (_, i) => ({
          kind: 'sleep',
          occurredAt: new Date(`2026-06-2${4 + i}T08:00:00.000Z`),
          value: null,
          unit: null,
          payload: { durationMinutes: 480 },
          createdAt: new Date(`2026-06-2${4 + i}T08:00:00.000Z`),
        })),
      ];
      const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
        buildMocks(records);
      const service = new TodayAnalysisContextService(
        prisma as never,
        dailyRecordReader as never,
        doseLogReader as never,
        reminderReader as never,
        createMockCache(),
      );

      const result = await service.shouldTriggerForDimension(
        'u1',
        '2026-07-01',
        DailyRecordKind.sleep,
      );

      expect(result).toBe(true);
    });

    it('passes for meal when today count increases >= 50% over baseline', async () => {
      const records = [
        {
          kind: 'meal',
          occurredAt: new Date('2026-07-01T08:00:00.000Z'),
          value: null,
          unit: null,
          payload: {
            mealAnalysis: { analysisStatus: 'confirmed', coverage: 'complete' },
          },
          createdAt: new Date('2026-07-01T08:00:00.000Z'),
        },
        {
          kind: 'meal',
          occurredAt: new Date('2026-07-01T12:00:00.000Z'),
          value: null,
          unit: null,
          payload: {
            mealAnalysis: { analysisStatus: 'confirmed', coverage: 'complete' },
          },
          createdAt: new Date('2026-07-01T12:00:00.000Z'),
        },
        ...Array.from({ length: 7 }, (_, i) => ({
          kind: 'meal',
          occurredAt: new Date(`2026-06-2${4 + i}T08:00:00.000Z`),
          value: null,
          unit: null,
          payload: {
            mealAnalysis: {
              analysisStatus: 'confirmed',
              coverage: 'complete',
            },
          },
          createdAt: new Date(`2026-06-2${4 + i}T08:00:00.000Z`),
        })),
      ];
      const { prisma, dailyRecordReader, doseLogReader, reminderReader } =
        buildMocks(records);
      const service = new TodayAnalysisContextService(
        prisma as never,
        dailyRecordReader as never,
        doseLogReader as never,
        reminderReader as never,
        createMockCache(),
      );

      const result = await service.shouldTriggerForDimension(
        'u1',
        '2026-07-01',
        DailyRecordKind.meal,
      );

      expect(result).toBe(true);
    });
  });
});
