import { TodayAnalysisContextService } from './today-analysis-context.service';

describe('TodayAnalysisContextService', () => {
  const buildPrisma = (records: unknown[]) => ({
    userCurrentMedicine: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    userMedicineReminder: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    userMedicineDoseLog: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    userDailyRecord: {
      findMany: jest.fn().mockResolvedValue(records),
    },
    userAllergy: {
      count: jest.fn().mockResolvedValue(0),
    },
  });

  it('includes unconfirmed meal analysis facts in recent records conservatively', async () => {
    const prisma = buildPrisma([
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
    const service = new TodayAnalysisContextService(prisma as never);

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
    const prisma = buildPrisma([
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
    const service = new TodayAnalysisContextService(prisma as never);

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
    const prisma = buildPrisma([
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
    const service = new TodayAnalysisContextService(prisma as never);

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
    const prisma = buildPrisma([
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
    const service = new TodayAnalysisContextService(prisma as never);

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
    const prisma = buildPrisma([
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
    const service = new TodayAnalysisContextService(prisma as never);

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
});
