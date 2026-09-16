import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../../../prisma/index.js';
import { MEAL_ANALYSIS_STALE_AFTER_MS } from '../../constants/meal-analysis.constants.js';
import { MealAnalysisSweeperService } from './sweeper.service.js';

function analyzingPayload(sourceRevision: number) {
  return {
    mealAnalysis: {
      version: 2,
      analysisStatus: 'analyzing',
      analyzedAt: null,
      sourceRevision,
      model: null,
      promptVersion: 'meal-analysis.v2',
      locale: 'zh-CN',
      failureReason: null,
      calorieRange: null,
      dishes: [],
      items: [],
      facets: {},
    },
  };
}

function buildPrisma(candidates: unknown[], updateCount = 1) {
  const userDailyRecord = {
    findMany: vi.fn().mockResolvedValue(candidates),
    updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
  };
  return {
    prisma: { userDailyRecord } as unknown as PrismaService,
    userDailyRecord,
  };
}

describe('MealAnalysisSweeperService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('marks long-running analyzing records as job_lost failures', async () => {
    const { prisma, userDailyRecord } = buildPrisma([
      { id: 'r1', userId: 'u1', payload: analyzingPayload(4) },
      // 已经不是 analyzing 的记录不再处理（并发分析刚写完结果）。
      {
        id: 'r2',
        userId: 'u1',
        payload: { mealAnalysis: { analysisStatus: 'analyzed' } },
      },
    ]);
    const service = new MealAnalysisSweeperService(prisma);

    const reaped = await service.reapStaleAnalyses();

    expect(reaped).toBe(1);
    expect(userDailyRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: 'meal',
          deletedAt: null,
          mealAnalysisStatus: 'analyzing',
          updatedAt: expect.objectContaining({
            lt: expect.any(Date),
          }),
        }),
      }),
    );
    expect(userDailyRecord.updateMany).toHaveBeenCalledTimes(1);
    expect(userDailyRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'r1',
        userId: 'u1',
        deletedAt: null,
        mealAnalysisStatus: 'analyzing',
        mealSourceRevision: 4,
      },
      data: expect.objectContaining({
        mealAnalysisStatus: 'analysis_failed',
        mealAnalysisFailureReason: 'job_lost',
        mealSourceRevision: 4,
        payload: expect.objectContaining({
          mealAnalysis: expect.objectContaining({
            analysisStatus: 'analysis_failed',
            failureReason: 'job_lost',
            sourceRevision: 4,
          }),
        }),
      }),
    });
  });

  it('scans only records older than the staleness threshold', async () => {
    const { prisma, userDailyRecord } = buildPrisma([]);
    const service = new MealAnalysisSweeperService(prisma);

    await expect(service.reapStaleAnalyses()).resolves.toBe(0);
    expect(userDailyRecord.updateMany).not.toHaveBeenCalled();

    const where = userDailyRecord.findMany.mock.calls[0]?.[0] as {
      where: { updatedAt: { lt: Date } };
    };
    const threshold = where.where.updatedAt.lt.getTime();
    expect(Date.now() - threshold).toBeGreaterThanOrEqual(
      MEAL_ANALYSIS_STALE_AFTER_MS - 5_000,
    );
  });
});
