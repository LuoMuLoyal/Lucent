import { TodayAnalysisContextService } from './today-analysis-context.service';

describe('TodayAnalysisContextService', () => {
  it('includes unconfirmed meal analysis facts in recent records conservatively', async () => {
    const prisma = {
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
        findMany: jest.fn().mockResolvedValue([
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
        ]),
      },
      userAllergy: {
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const service = new TodayAnalysisContextService(prisma as never);

    const context = await service.build('u1', '2026-07-01');

    expect(context.recordSummary).toEqual([{ kind: 'meal', count: 1 }]);
    expect(context.recentRecords).toEqual([
      {
        kind: 'meal',
        title: '饮食估算中：一份米饭配西兰花和鸡胸肉',
        value: null,
        unit: null,
        note: '识别食物：米饭、鸡胸肉',
        createdAt: '2026-07-01T04:30:00.000Z',
      },
    ]);
  });

  it('does not surface analyzing meal records as completed meal summaries', async () => {
    const prisma = {
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
        findMany: jest.fn().mockResolvedValue([
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
        ]),
      },
      userAllergy: {
        count: jest.fn().mockResolvedValue(0),
      },
    };
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
});
