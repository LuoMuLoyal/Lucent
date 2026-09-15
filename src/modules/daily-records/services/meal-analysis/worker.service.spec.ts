import { Logger } from '@nestjs/common';
import {
  createDomainFailure,
  errAsync,
  okAsync,
} from '../../../../common/result/index.js';
import type { PrismaService } from '../../../../prisma/index.js';
import type { ObjectStorageRuntime } from '../../../../common/index.js';
import type { MealAnalysisVisionService } from './vision.service.js';
import { MealAnalysisWorkerService } from './worker.service.js';

interface RecordFixtureOptions {
  recordId?: string;
  revision?: number;
  status?: string;
  attachments?: Array<{ objectKey: string }>;
  locale?: string | null;
}

function buildRecord(options: RecordFixtureOptions = {}) {
  const revision = options.revision ?? 1;
  return {
    id: options.recordId ?? 'r1',
    userId: 'u1',
    kind: 'meal',
    mealSourceRevision: revision,
    deletedAt: null,
    payload: {
      mealAnalysis: {
        version: 2,
        analysisStatus: options.status ?? 'analyzing',
        analyzedAt: null,
        sourceRevision: revision,
        model: null,
        promptVersion: 'meal-analysis.v2',
        locale: null,
        failureReason: null,
        calorieRange: null,
        dishes: [],
        items: [],
        facets: {},
      },
    },
    attachments: options.attachments ?? [
      { objectKey: 'daily-records/u1/m.jpg' },
    ],
    user: { profile: { locale: options.locale ?? 'zh-CN' } },
  };
}

function buildPrisma(record: unknown, updateCount = 1) {
  const userDailyRecord = {
    findFirst: vi.fn().mockResolvedValue(record),
    updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
  };
  return {
    prisma: { userDailyRecord } as unknown as PrismaService,
    userDailyRecord,
  };
}

function buildVision(outcome: unknown, configured = true) {
  const analyze = vi.fn().mockResolvedValue(outcome);
  return {
    service: {
      isConfigured: vi.fn().mockReturnValue(configured),
      analyze,
    } as unknown as MealAnalysisVisionService,
    analyze,
  };
}

function buildStorage(url = 'https://cdn.example.com/signed.jpg') {
  const createSignedGetUrl = vi.fn().mockResolvedValue(url);
  return {
    service: { createSignedGetUrl } as unknown as ObjectStorageRuntime,
    createSignedGetUrl,
  };
}

const analyzedOutcome = okAsync({
  model: 'vision-model',
  draft: {
    calorieRange: { min: 520, max: 780 },
    dishes: [{ name: '红烧肉', source: 'model' }],
    items: [
      {
        rank: 1,
        kind: 'fried',
        polarity: 'watch',
        headline: '油炸偏多',
        detail: '午饭油炸食品摄入偏多',
      },
    ],
    facets: { fried: 'high' },
  },
});

/** 依赖失败（超时/不可达/输出不可用）都走同一条 Result 边界。 */
function dependencyFailureOutcome(
  code:
    | 'DEPENDENCY_TIMEOUT'
    | 'DEPENDENCY_UNAVAILABLE'
    | 'DEPENDENCY_BAD_GATEWAY',
) {
  return errAsync(createDomainFailure({ kind: 'dependency', code }));
}

describe('MealAnalysisWorkerService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('skips a job whose revision no longer matches the record', async () => {
    const { prisma, userDailyRecord } = buildPrisma(
      buildRecord({ revision: 3 }),
    );
    const { service: vision } = buildVision(analyzedOutcome);
    const { service: storage } = buildStorage();
    const worker = new MealAnalysisWorkerService(prisma, vision, storage);

    await worker.process({ userId: 'u1', recordId: 'r1', sourceRevision: 2 });

    expect(userDailyRecord.updateMany).not.toHaveBeenCalled();
  });

  it('skips a job when the record is no longer analyzing', async () => {
    const { prisma, userDailyRecord } = buildPrisma(
      buildRecord({ status: 'analyzed' }),
    );
    const { service: vision } = buildVision(analyzedOutcome);
    const { service: storage } = buildStorage();
    const worker = new MealAnalysisWorkerService(prisma, vision, storage);

    await worker.process({ userId: 'u1', recordId: 'r1', sourceRevision: 1 });

    expect(userDailyRecord.updateMany).not.toHaveBeenCalled();
  });

  it('fails the record when it does not carry exactly one image', async () => {
    const { prisma, userDailyRecord } = buildPrisma(
      buildRecord({ recordId: 'r2', attachments: [] }),
    );
    const { service: vision, analyze } = buildVision(analyzedOutcome);
    const { service: storage } = buildStorage();
    const worker = new MealAnalysisWorkerService(prisma, vision, storage);

    await worker.process({ userId: 'u1', recordId: 'r2', sourceRevision: 1 });

    expect(analyze).not.toHaveBeenCalled();
    expect(userDailyRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'r2',
        userId: 'u1',
        deletedAt: null,
        mealSourceRevision: 1,
      },
      data: expect.objectContaining({
        mealAnalysisStatus: 'analysis_failed',
        mealAnalysisFailureReason: 'image_count_invalid',
        payload: expect.objectContaining({
          mealAnalysis: expect.objectContaining({
            analysisStatus: 'analysis_failed',
            failureReason: 'image_count_invalid',
          }),
        }),
      }),
    });
  });

  it('fails the record when the vision model is not configured', async () => {
    const { prisma, userDailyRecord } = buildPrisma(
      buildRecord({ recordId: 'r3' }),
    );
    const { service: vision, analyze } = buildVision(analyzedOutcome, false);
    const { service: storage } = buildStorage();
    const worker = new MealAnalysisWorkerService(prisma, vision, storage);

    await worker.process({ userId: 'u1', recordId: 'r3', sourceRevision: 1 });

    expect(analyze).not.toHaveBeenCalled();
    expect(userDailyRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mealAnalysisStatus: 'analysis_failed',
          mealAnalysisFailureReason: 'vision_unavailable',
        }),
      }),
    );
  });

  it('writes the normalized analysis and the revision-guarded hot columns', async () => {
    const { prisma, userDailyRecord } = buildPrisma(buildRecord());
    const { service: vision, analyze } = buildVision(analyzedOutcome);
    const { service: storage, createSignedGetUrl } = buildStorage();
    const worker = new MealAnalysisWorkerService(prisma, vision, storage);

    await worker.process({ userId: 'u1', recordId: 'r1', sourceRevision: 1 });

    expect(createSignedGetUrl).toHaveBeenCalledWith({
      objectKey: 'daily-records/u1/m.jpg',
      audience: 'external',
    });
    expect(analyze).toHaveBeenCalledWith({
      imageUrl: 'https://cdn.example.com/signed.jpg',
      locale: 'zh-CN',
    });
    expect(userDailyRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'r1',
        userId: 'u1',
        deletedAt: null,
        mealSourceRevision: 1,
      },
      data: expect.objectContaining({
        mealAnalysisStatus: 'analyzed',
        mealAnalysisFailureReason: null,
        mealSourceRevision: 1,
        mealAnalysisUpdatedAt: expect.any(Date),
        payload: expect.objectContaining({
          mealAnalysis: expect.objectContaining({
            analysisStatus: 'analyzed',
            model: 'vision-model',
            locale: 'zh-CN',
            calorieRange: expect.objectContaining({ bucket: 'medium' }),
            items: [expect.objectContaining({ headline: '油炸偏多' })],
          }),
        }),
      }),
    });
  });

  it('persists the model failure reason instead of leaving the record analyzing', async () => {
    const { prisma, userDailyRecord } = buildPrisma(buildRecord());
    const { service: vision } = buildVision(
      dependencyFailureOutcome('DEPENDENCY_TIMEOUT'),
    );
    const { service: storage } = buildStorage();
    const worker = new MealAnalysisWorkerService(prisma, vision, storage);

    await worker.process({ userId: 'u1', recordId: 'r1', sourceRevision: 1 });

    expect(userDailyRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mealAnalysisStatus: 'analysis_failed',
          mealAnalysisFailureReason: 'model_timeout',
        }),
      }),
    );
  });

  it('maps an unusable model output to invalid_output', async () => {
    const { prisma, userDailyRecord } = buildPrisma(buildRecord());
    const { service: vision } = buildVision(
      dependencyFailureOutcome('DEPENDENCY_BAD_GATEWAY'),
    );
    const { service: storage } = buildStorage();
    const worker = new MealAnalysisWorkerService(prisma, vision, storage);

    await worker.process({ userId: 'u1', recordId: 'r1', sourceRevision: 1 });

    expect(userDailyRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mealAnalysisFailureReason: 'invalid_output',
        }),
      }),
    );
  });

  it('discards the result when the user re-analyzed while the model was running', async () => {
    const { prisma } = buildPrisma(buildRecord(), 0);
    const { service: vision } = buildVision(analyzedOutcome);
    const { service: storage } = buildStorage();
    const worker = new MealAnalysisWorkerService(prisma, vision, storage);

    await worker.process({ userId: 'u1', recordId: 'r1', sourceRevision: 1 });

    expect(vi.mocked(Logger.prototype.log)).toHaveBeenCalledWith(
      expect.stringContaining('Discarded stale meal analysis'),
    );
  });

  it('passes the profile locale to the prompt and falls back to zh-CN', async () => {
    const english = buildPrisma(buildRecord({ locale: 'en-US' }));
    const englishVision = buildVision(analyzedOutcome);
    const englishWorker = new MealAnalysisWorkerService(
      english.prisma,
      englishVision.service,
      buildStorage().service,
    );

    await englishWorker.process({
      userId: 'u1',
      recordId: 'r1',
      sourceRevision: 1,
    });
    expect(englishVision.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'en' }),
    );

    const unknown = buildPrisma(buildRecord({ locale: null }));
    const unknownVision = buildVision(analyzedOutcome);
    const unknownWorker = new MealAnalysisWorkerService(
      unknown.prisma,
      unknownVision.service,
      buildStorage().service,
    );

    await unknownWorker.process({
      userId: 'u1',
      recordId: 'r1',
      sourceRevision: 1,
    });
    expect(unknownVision.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'zh-CN' }),
    );
  });
});
