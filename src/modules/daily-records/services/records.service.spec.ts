import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { I18nService } from 'nestjs-i18n';
import { DailyRecordKind, Prisma } from '#generated/prisma/client';
import {
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result';
import { DomainFailureException } from '../../../common/result/unwrap-result';
import { DailyRecordRepositoryPort } from '../repositories/daily-record.repository';
import { HealthEventsOwnershipService } from '../../health-events';
import { DailyRecordsOwnershipService } from './ownership.service';
import { DailyRecordsMapperService } from './mapper.service';
import { DailyRecordsService } from './records.service';
import { MealAnalysisQueueService } from './meal-analysis/queue.service';
import { MealDishTemplateLearningService } from './meal-dish/template-learning.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

const mockUserId = 'user-uuid-1';

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  const error = Object.create(
    Prisma.PrismaClientKnownRequestError.prototype,
  ) as Prisma.PrismaClientKnownRequestError;
  error.code = code;
  return error;
}

async function unwrapOk<T>(result: ResultAsync<T, DomainFailure>): Promise<T> {
  const outcome = await result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
  if (!outcome.ok) {
    throw new Error(`Expected ok result, got ${outcome.error.code}`);
  }
  return outcome.value;
}

async function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

describe('DailyRecordsService', () => {
  let service: DailyRecordsService;
  let repository: vi.Mocked<DailyRecordRepositoryPort>;
  let txMock: vi.Mocked<{
    userDailyRecord: {
      create: vi.Mock;
      update: vi.Mock;
      findFirst: vi.Mock;
    };
    userDailyRecordAttachment: {
      createMany: vi.Mock;
      deleteMany: vi.Mock;
    };
  }>;
  let mealAnalysisQueueService: { enqueue: vi.Mock };
  let mealDishTemplateLearningService: {
    learnFromConfirmedAnalysis: vi.Mock;
  };
  let healthEventsOwnershipService: {
    ensureActiveOwnedByUser: vi.Mock;
  };
  let eventEmitter: { emitAsync: vi.Mock };

  beforeEach(async () => {
    mealAnalysisQueueService = {
      enqueue: vi.fn().mockResolvedValue(undefined),
    };
    mealDishTemplateLearningService = {
      learnFromConfirmedAnalysis: vi.fn().mockResolvedValue(undefined),
    };
    healthEventsOwnershipService = {
      ensureActiveOwnedByUser: vi.fn().mockResolvedValue({
        id: 'health-event-1',
        status: 'active',
      }),
    };
    eventEmitter = {
      emitAsync: vi.fn().mockResolvedValue(undefined),
    };

    txMock = {
      userDailyRecord: {
        create: vi.fn(),
        update: vi.fn(),
        findFirst: vi.fn(),
      },
      userDailyRecordAttachment: {
        createMany: vi.fn(),
        deleteMany: vi.fn(),
      },
    };

    const repositoryMock = {
      findManyWithAttachments: vi.fn(),
      findByIdWithAttachments: vi.fn(),
      findOwnershipData: vi.fn(),
      findManyByDateWithAttachments: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
      transaction: vi.fn(async (fn: (tx: typeof txMock) => Promise<unknown>) =>
        fn(txMock),
      ) as vi.Mock,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: I18nService,
          useValue: { t: vi.fn().mockImplementation((key: string) => key) },
        },
        DailyRecordsService,
        DailyRecordsOwnershipService,
        DailyRecordsMapperService,
        {
          provide: HealthEventsOwnershipService,
          useValue: healthEventsOwnershipService,
        },
        {
          provide: MealAnalysisQueueService,
          useValue: mealAnalysisQueueService,
        },
        {
          provide: MealDishTemplateLearningService,
          useValue: mealDishTemplateLearningService,
        },
        {
          provide: DailyRecordRepositoryPort,
          useValue: repositoryMock,
        },
        {
          provide: EventEmitter2,
          useValue: eventEmitter,
        },
      ],
    }).compile();

    service = module.get(DailyRecordsService);
    repository = module.get(DailyRecordRepositoryPort);
  });

  it('should list records for a given date', async () => {
    repository.findManyWithAttachments.mockResolvedValue({
      items: [
        {
          id: 'r1',

          userId: mockUserId,

          healthEventId: null,
          deletedAt: null,
          kind: 'water',
          occurredAt: new Date('2026-06-04'),
          occurredTime: '09:45',
          title: null,
          value: '3',
          unit: 'cups',
          note: null,
          source: 'manual',
          payload: null,
          mealAnalysisStatus: null,
          mealAnalysisCoverage: null,
          mealAnalysisUpdatedAt: null,
          mealAnalysisFailureReason: null,
          mealSourceRevision: 0,
          attachments: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      total: 1,
    });

    const result = await service.list(mockUserId, '2026-06-04');

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.items[0]?.kind).toBe('water');
    expect(result.items[0]?.occurredTime).toBe('09:45');
  });

  it('should hide heavy meal payload fields from default list reads', async () => {
    repository.findManyWithAttachments.mockResolvedValue({
      items: [
        {
          id: 'meal-1',

          userId: mockUserId,

          healthEventId: null,
          deletedAt: null,
          kind: 'meal',
          occurredAt: new Date('2026-07-01'),
          occurredTime: '12:30',
          title: 'Lunch',
          value: null,
          unit: null,
          note: null,
          payload: {
            mealInput: {
              manualSummary: 'rice and egg',
            },
            mealAnalysis: {
              analysisStatus: 'confirmed',
              mealDescription:
                'A bowl of rice with scrambled eggs and green vegetables.',
              nutritionEstimate: {
                energyKcal: 620,
              },
            },
          },
          source: 'manual',
          mealAnalysisStatus: 'confirmed',
          mealAnalysisCoverage: null,
          mealAnalysisUpdatedAt: null,
          mealAnalysisFailureReason: null,
          mealSourceRevision: 0,
          attachments: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      total: 1,
    });

    const result = await service.list(mockUserId, '2026-07-01');

    expect(result.items[0]?.payload).toBeNull();
  });

  it('should create a record', async () => {
    repository.create.mockReturnValue(
      okAsync({
        id: 'r1',

        userId: mockUserId,

        healthEventId: null,
        deletedAt: null,
        kind: 'mood',
        occurredAt: new Date('2026-06-04'),
        occurredTime: '14:20',
        title: null,
        value: null,
        unit: null,
        note: 'good',
        source: 'manual',
        payload: null,
        mealAnalysisStatus: null,
        mealAnalysisCoverage: null,
        mealAnalysisUpdatedAt: null,
        mealAnalysisFailureReason: null,
        mealSourceRevision: 0,
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    const result = await unwrapOk(
      service.create(mockUserId, {
        kind: DailyRecordKind.mood,
        occurredAt: '2026-06-04',
        occurredTime: '14:20',
        note: 'good',
      }),
    );

    expect(result.kind).toBe('mood');
    expect(result.note).toBe('good');
    expect(result.occurredTime).toBe('14:20');
  });

  it('should validate and persist an active health event when creating a record', async () => {
    repository.create.mockReturnValue(
      okAsync({
        id: 'r-health-event',
        userId: mockUserId,
        healthEventId: 'health-event-1',
        deletedAt: null,
        kind: 'mood',
        occurredAt: new Date('2026-06-04'),
        occurredTime: null,
        title: null,
        value: null,
        unit: null,
        note: null,
        source: 'manual',
        payload: null,
        mealAnalysisStatus: null,
        mealAnalysisCoverage: null,
        mealAnalysisUpdatedAt: null,
        mealAnalysisFailureReason: null,
        mealSourceRevision: 0,
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    const result = await unwrapOk(
      service.create(mockUserId, {
        kind: DailyRecordKind.mood,
        occurredAt: '2026-06-04',
        healthEventId: 'health-event-1',
      }),
    );

    expect(result.healthEventId).toBe('health-event-1');
    expect(
      healthEventsOwnershipService.ensureActiveOwnedByUser,
    ).toHaveBeenCalledWith(mockUserId, 'health-event-1');
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ healthEventId: 'health-event-1' }),
    );
  });

  it.each([
    ['ended event', { kind: 'validation', code: 'VALIDATION_FAILED' }],
    ['foreign event', { kind: 'authorization', code: 'FORBIDDEN' }],
  ])(
    'should fold %s ownership failures into Err when creating a record',
    async (_, failure) => {
      healthEventsOwnershipService.ensureActiveOwnedByUser.mockRejectedValue(
        new DomainFailureException(failure as DomainFailure),
      );

      await expect(
        collectResult(
          service.create(mockUserId, {
            kind: DailyRecordKind.mood,
            occurredAt: '2026-06-04',
            healthEventId: 'health-event-1',
          }),
        ),
      ).resolves.toMatchObject({ ok: false, error: failure });
      expect(repository.create).not.toHaveBeenCalled();
    },
  );

  it('rethrows an unknown health-event ownership error', async () => {
    healthEventsOwnershipService.ensureActiveOwnedByUser.mockRejectedValue(
      new Error('connection lost'),
    );

    await expect(
      service.create(mockUserId, {
        kind: DailyRecordKind.mood,
        occurredAt: '2026-06-04',
        healthEventId: 'health-event-1',
      }),
    ).rejects.toThrow('connection lost');
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('should not call health event ownership when healthEventId is omitted', async () => {
    repository.create.mockReturnValue(
      okAsync({
        id: 'r-without-health-event',
        userId: mockUserId,
        healthEventId: null,
        deletedAt: null,
        kind: 'mood',
        occurredAt: new Date('2026-06-04'),
        occurredTime: null,
        title: null,
        value: null,
        unit: null,
        note: null,
        source: 'manual',
        payload: null,
        mealAnalysisStatus: null,
        mealAnalysisCoverage: null,
        mealAnalysisUpdatedAt: null,
        mealAnalysisFailureReason: null,
        mealSourceRevision: 0,
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    await unwrapOk(
      service.create(mockUserId, {
        kind: DailyRecordKind.mood,
        occurredAt: '2026-06-04',
      }),
    );

    expect(
      healthEventsOwnershipService.ensureActiveOwnedByUser,
    ).not.toHaveBeenCalled();
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ healthEventId: null }),
    );
  });

  it('should update a record with partial fields', async () => {
    repository.findOwnershipData.mockResolvedValue({
      userId: mockUserId,
      kind: 'mood',
      payload: null,
    });
    repository.update.mockReturnValue(
      okAsync({
        id: 'r1',

        userId: mockUserId,

        healthEventId: null,
        deletedAt: null,
        kind: 'mood',
        occurredAt: new Date('2026-06-04'),
        occurredTime: null,
        title: null,
        value: null,
        unit: null,
        note: 'updated',
        source: 'manual',
        payload: null,
        mealAnalysisStatus: null,
        mealAnalysisCoverage: null,
        mealAnalysisUpdatedAt: null,
        mealAnalysisFailureReason: null,
        mealSourceRevision: 0,
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    const result = await unwrapOk(
      service.update(mockUserId, 'r1', { note: 'updated' }),
    );

    expect(repository.update).toHaveBeenCalledWith('r1', {
      note: 'updated',
    });
    expect(result.note).toBe('updated');
    expect(
      healthEventsOwnershipService.ensureActiveOwnedByUser,
    ).not.toHaveBeenCalled();
  });

  it('should clear a health event when update explicitly provides null', async () => {
    repository.findOwnershipData.mockResolvedValue({
      userId: mockUserId,
      kind: 'mood',
      payload: null,
    });
    repository.update.mockReturnValue(
      okAsync({
        id: 'r1',
        userId: mockUserId,
        healthEventId: null,
        deletedAt: null,
        kind: 'mood',
        occurredAt: new Date('2026-06-04'),
        occurredTime: null,
        title: null,
        value: null,
        unit: null,
        note: null,
        source: 'manual',
        payload: null,
        mealAnalysisStatus: null,
        mealAnalysisCoverage: null,
        mealAnalysisUpdatedAt: null,
        mealAnalysisFailureReason: null,
        mealSourceRevision: 0,
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    await unwrapOk(service.update(mockUserId, 'r1', { healthEventId: null }));

    expect(
      healthEventsOwnershipService.ensureActiveOwnedByUser,
    ).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith('r1', {
      healthEvent: { disconnect: true },
    });
  });

  it('should validate an active health event when update provides an id', async () => {
    repository.findOwnershipData.mockResolvedValue({
      userId: mockUserId,
      kind: 'mood',
      payload: null,
    });
    repository.update.mockReturnValue(
      okAsync({
        id: 'r1',
        userId: mockUserId,
        healthEventId: 'health-event-1',
        deletedAt: null,
        kind: 'mood',
        occurredAt: new Date('2026-06-04'),
        occurredTime: null,
        title: null,
        value: null,
        unit: null,
        note: null,
        source: 'manual',
        payload: null,
        mealAnalysisStatus: null,
        mealAnalysisCoverage: null,
        mealAnalysisUpdatedAt: null,
        mealAnalysisFailureReason: null,
        mealSourceRevision: 0,
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    await unwrapOk(
      service.update(mockUserId, 'r1', {
        healthEventId: 'health-event-1',
      }),
    );

    expect(
      healthEventsOwnershipService.ensureActiveOwnedByUser,
    ).toHaveBeenCalledWith(mockUserId, 'health-event-1');
    expect(repository.update).toHaveBeenCalledWith('r1', {
      healthEvent: { connect: { id: 'health-event-1' } },
    });
  });

  it('should preserve server-owned mealAnalysis when updating meal payload', async () => {
    repository.findOwnershipData.mockResolvedValue({
      userId: mockUserId,
      kind: 'meal',
      payload: {
        mealInput: {
          manualSummary: 'old summary',
        },
        mealAnalysis: {
          analysisStatus: 'confirmed',
          mealDescription: 'trusted analysis',
        },
      },
    });
    repository.update.mockReturnValue(
      okAsync({
        id: 'meal-2',

        userId: mockUserId,

        healthEventId: null,
        deletedAt: null,
        kind: 'meal',
        occurredAt: new Date('2026-07-01'),
        occurredTime: '18:20',
        title: 'Dinner',
        value: null,
        unit: null,
        note: null,
        payload: {
          mealInput: {
            manualSummary: 'new summary',
          },
          mealAnalysis: {
            analysisStatus: 'confirmed',
            mealDescription: 'trusted analysis',
          },
        },
        source: 'manual',
        mealAnalysisStatus: 'confirmed',
        mealAnalysisCoverage: null,
        mealAnalysisUpdatedAt: null,
        mealAnalysisFailureReason: null,
        mealSourceRevision: 0,
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    await unwrapOk(
      service.update(mockUserId, 'meal-2', {
        payload: {
          mealInput: {
            manualSummary: 'new summary',
          },
          mealAnalysis: {
            analysisStatus: 'analysis_failed',
            mealDescription: 'client overwrite attempt',
          },
        },
      }),
    );

    expect(repository.update).toHaveBeenCalledWith(
      'meal-2',
      expect.objectContaining({
        mealAnalysisStatus: 'confirmed',
        payload: {
          mealInput: {
            manualSummary: 'new summary',
          },
          mealAnalysis: {
            analysisStatus: 'confirmed',
            mealDescription: 'trusted analysis',
          },
        },
      }),
    );
  });

  it('should keep client meal dish edits in mealInput and preserve server-owned analysis branches', async () => {
    repository.findOwnershipData.mockResolvedValue({
      userId: mockUserId,
      kind: 'meal',
      payload: {
        mealInput: {
          recognizedDishes: [{ rawName: '旧菜名' }],
        },
        mealAnalysis: {
          analysisStatus: 'confirmed',
          recognizedDishes: [{ rawName: '服务端可信菜名' }],
        },
      },
    });
    repository.update.mockReturnValue(
      okAsync({
        id: 'meal-3',

        userId: mockUserId,

        healthEventId: null,
        deletedAt: null,
        kind: 'meal',
        occurredAt: new Date('2026-07-01'),
        occurredTime: '18:20',
        title: 'Dinner',
        value: null,
        unit: null,
        note: null,
        payload: {
          mealInput: {
            recognizedDishes: [{ rawName: '用户改过的菜名' }],
          },
          mealAnalysis: {
            analysisStatus: 'confirmed',
            recognizedDishes: [{ rawName: '服务端可信菜名' }],
          },
        },
        source: 'manual',
        mealAnalysisStatus: 'confirmed',
        mealAnalysisCoverage: null,
        mealAnalysisUpdatedAt: null,
        mealAnalysisFailureReason: null,
        mealSourceRevision: 0,
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    await unwrapOk(
      service.update(mockUserId, 'meal-3', {
        payload: {
          mealInput: {
            recognizedDishes: [{ rawName: '用户改过的菜名' }],
          },
        },
      }),
    );

    expect(repository.update).toHaveBeenCalledWith(
      'meal-3',
      expect.objectContaining({
        mealAnalysisStatus: 'confirmed',
        payload: {
          mealInput: {
            recognizedDishes: [{ rawName: '用户改过的菜名' }],
          },
          mealAnalysis: {
            analysisStatus: 'confirmed',
            recognizedDishes: [{ rawName: '服务端可信菜名' }],
          },
        },
      }),
    );
  });

  it('should mark the current meal analysis confirmed and learn a template from grounded ingredients', async () => {
    repository.findOwnershipData.mockResolvedValue({
      userId: mockUserId,
      kind: 'meal',
      payload: {
        mealAnalysis: {
          analysisStatus: 'unconfirmed',
          coverage: 'partial',
          recognizedDishes: [
            {
              dishKey: 'dish-1',
              rawName: '西红柿炒鸡蛋',
              normalizedDishName: '西红柿炒鸡蛋',
              confidence: 0.94,
              portionText: '一份',
              source: 'vision',
            },
          ],
          resolvedIngredients: [
            {
              dishKey: 'dish-1',
              ingredientName: '西红柿',
              normalizedIngredientName: '西红柿',
              defaultRatio: 0.6,
              decompositionSource: 'model',
              confidence: 0.93,
            },
            {
              dishKey: 'dish-1',
              ingredientName: '鸡蛋',
              normalizedIngredientName: '鸡蛋',
              defaultRatio: 0.4,
              decompositionSource: 'model',
              confidence: 0.92,
            },
          ],
          compositionMatches: [
            {
              dishKey: 'dish-1',
              ingredientName: '西红柿',
              matchedFoodId: 'food-tomato',
              matchedFoodName: '西红柿',
              matchMethod: 'exact',
              matchScore: 1,
            },
            {
              dishKey: 'dish-1',
              ingredientName: '鸡蛋',
              matchedFoodId: 'food-egg',
              matchedFoodName: '鸡蛋',
              matchMethod: 'exact',
              matchScore: 1,
            },
          ],
        },
      },
    });
    repository.update.mockReturnValue(
      okAsync({
        id: 'meal-4',

        userId: mockUserId,

        healthEventId: null,
        deletedAt: null,
        kind: 'meal',
        occurredAt: new Date('2026-07-01'),
        occurredTime: '12:20',
        title: 'Lunch',
        value: null,
        unit: null,
        note: null,
        payload: {
          mealAnalysis: {
            analysisStatus: 'confirmed',
            coverage: 'partial',
            recognizedDishes: [
              {
                dishKey: 'dish-1',
                rawName: '西红柿炒鸡蛋',
                normalizedDishName: '西红柿炒鸡蛋',
                confidence: 0.94,
                portionText: '一份',
                source: 'vision',
              },
            ],
            resolvedIngredients: [
              {
                dishKey: 'dish-1',
                ingredientName: '西红柿',
                normalizedIngredientName: '西红柿',
                defaultRatio: 0.6,
                decompositionSource: 'model',
                confidence: 0.93,
              },
              {
                dishKey: 'dish-1',
                ingredientName: '鸡蛋',
                normalizedIngredientName: '鸡蛋',
                defaultRatio: 0.4,
                decompositionSource: 'model',
                confidence: 0.92,
              },
            ],
            compositionMatches: [
              {
                dishKey: 'dish-1',
                ingredientName: '西红柿',
                matchedFoodId: 'food-tomato',
                matchedFoodName: '西红柿',
                matchMethod: 'exact',
                matchScore: 1,
              },
              {
                dishKey: 'dish-1',
                ingredientName: '鸡蛋',
                matchedFoodId: 'food-egg',
                matchedFoodName: '鸡蛋',
                matchMethod: 'exact',
                matchScore: 1,
              },
            ],
            confirmedAt: '2026-07-01T12:30:00.000Z',
          },
          mealAnalysisLastConfirmed: {
            analysisStatus: 'confirmed',
          },
        },
        source: 'manual',
        mealAnalysisStatus: 'confirmed',
        mealAnalysisCoverage: 'partial',
        mealAnalysisUpdatedAt: null,
        mealAnalysisFailureReason: null,
        mealSourceRevision: 0,
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    await unwrapOk(
      service.update(mockUserId, 'meal-4', {
        payload: {
          mealAnalysis: {
            analysisStatus: 'confirmed',
          },
        },
      }),
    );

    expect(repository.update).toHaveBeenCalledWith(
      'meal-4',
      expect.objectContaining({
        mealAnalysisStatus: 'confirmed',
        payload: expect.objectContaining({
          mealAnalysis: expect.objectContaining({
            analysisStatus: 'confirmed',
            confirmedAt: expect.any(String),
          }),
          mealAnalysisLastConfirmed: expect.objectContaining({
            analysisStatus: 'confirmed',
          }),
        }),
      }),
    );
    expect(
      mealDishTemplateLearningService.learnFromConfirmedAnalysis,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisStatus: 'confirmed',
        recognizedDishes: expect.any(Array),
        resolvedIngredients: expect.any(Array),
        compositionMatches: expect.any(Array),
      }),
    );
    expect(mealAnalysisQueueService.enqueue).not.toHaveBeenCalled();
  });

  it('should clear nullable fields when sending null', async () => {
    repository.findOwnershipData.mockResolvedValue({
      userId: mockUserId,
      kind: 'water',
      payload: null,
    });
    repository.update.mockReturnValue(
      okAsync({
        id: 'r1',

        userId: mockUserId,

        healthEventId: null,
        deletedAt: null,
        kind: 'water',
        occurredAt: new Date('2026-06-04'),
        occurredTime: null,
        title: null,
        value: null,
        unit: null,
        note: null,
        source: 'manual',
        payload: null,
        mealAnalysisStatus: null,
        mealAnalysisCoverage: null,
        mealAnalysisUpdatedAt: null,
        mealAnalysisFailureReason: null,
        mealSourceRevision: 0,
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    await unwrapOk(
      service.update(mockUserId, 'r1', { note: null, value: null }),
    );

    expect(repository.update).toHaveBeenCalledWith('r1', {
      note: null,
      value: null,
    });
  });

  it('should create a record with image attachment metadata', async () => {
    txMock.userDailyRecord.create.mockResolvedValue({
      id: 'r1',

      userId: mockUserId,

      healthEventId: null,
      deletedAt: null,
      kind: 'meal',
      occurredAt: new Date('2026-06-04'),
      occurredTime: '08:30',
      title: 'Breakfast',
      value: null,
      unit: null,
      note: null,
      source: 'manual',
      payload: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    txMock.userDailyRecordAttachment.createMany.mockResolvedValue({ count: 1 });
    txMock.userDailyRecord.findFirst.mockResolvedValue({
      id: 'r1',

      userId: mockUserId,

      healthEventId: null,
      deletedAt: null,
      kind: 'meal',
      occurredAt: new Date('2026-06-04'),
      occurredTime: '08:30',
      title: 'Breakfast',
      value: null,
      unit: null,
      note: null,
      source: 'manual',
      payload: null,
      mealAnalysisStatus: null,
      mealAnalysisCoverage: null,
      mealAnalysisUpdatedAt: null,
      mealAnalysisFailureReason: null,
      mealSourceRevision: 1,
      attachments: [
        {
          id: 'a1',
          kind: 'image',
          objectKey: 'daily-records/u1/r1/photo.jpg',
          bucket: 'lucent-dev',
          provider: 'tencent-cos',
          fileName: 'photo.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 1234,
          width: 640,
          height: 480,
          publicUrl: 'https://cdn.example.com/photo.jpg',
          createdAt: new Date('2026-06-04T00:00:00.000Z'),
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await unwrapOk(
      service.create(mockUserId, {
        kind: DailyRecordKind.meal,
        occurredAt: '2026-06-04',
        title: 'Breakfast',
        healthEventId: 'health-event-1',
        attachments: [
          {
            objectKey: 'daily-records/u1/r1/photo.jpg',
            bucket: 'lucent-dev',
            provider: 'tencent-cos',
            fileName: 'photo.jpg',
            contentType: 'image/jpeg',
            sizeBytes: 1234,
            width: 640,
            height: 480,
            publicUrl: 'https://cdn.example.com/photo.jpg',
          },
        ],
      }),
    );

    expect(txMock.userDailyRecordAttachment.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: mockUserId,
          recordId: 'r1',
          kind: 'image',
          objectKey: 'daily-records/u1/r1/photo.jpg',
          bucket: 'lucent-dev',
          provider: 'tencent-cos',
          fileName: 'photo.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 1234,
          width: 640,
          height: 480,
          publicUrl: 'https://cdn.example.com/photo.jpg',
        },
      ],
    });
    expect(txMock.userDailyRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ healthEventId: 'health-event-1' }),
    });
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.objectKey).toBe(
      'daily-records/u1/r1/photo.jpg',
    );
    expect(mealAnalysisQueueService.enqueue).toHaveBeenCalledWith({
      userId: mockUserId,
      recordId: 'r1',
      sourceRevision: 1,
    });
  });

  it('should replace attachments when update includes attachments', async () => {
    repository.findOwnershipData.mockResolvedValueOnce({
      userId: mockUserId,
      kind: 'meal',
      payload: null,
    });
    txMock.userDailyRecord.update.mockResolvedValue({});
    txMock.userDailyRecordAttachment.deleteMany.mockResolvedValue({ count: 1 });
    txMock.userDailyRecordAttachment.createMany.mockResolvedValue({ count: 1 });
    txMock.userDailyRecord.findFirst.mockResolvedValue({
      id: 'r1',

      userId: mockUserId,

      healthEventId: null,
      deletedAt: null,
      kind: 'meal',
      occurredAt: new Date('2026-06-04'),
      occurredTime: '13:40',
      title: null,
      value: null,
      unit: null,
      note: null,
      source: 'manual',
      payload: null,
      mealAnalysisStatus: null,
      mealAnalysisCoverage: null,
      mealAnalysisUpdatedAt: null,
      mealAnalysisFailureReason: null,
      mealSourceRevision: 0,
      attachments: [
        {
          id: 'a2',
          kind: 'image',
          objectKey: 'daily-records/u1/r1/new.jpg',
          bucket: null,
          provider: 'tencent-cos',
          fileName: null,
          contentType: 'image/jpeg',
          sizeBytes: null,
          width: null,
          height: null,
          publicUrl: null,
          createdAt: new Date('2026-06-04T00:00:00.000Z'),
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await unwrapOk(
      service.update(mockUserId, 'r1', {
        attachments: [
          {
            objectKey: 'daily-records/u1/r1/new.jpg',
            provider: 'tencent-cos',
            contentType: 'image/jpeg',
          },
        ],
      }),
    );

    expect(txMock.userDailyRecordAttachment.deleteMany).toHaveBeenCalledWith({
      where: { userId: mockUserId, recordId: 'r1' },
    });
    expect(txMock.userDailyRecordAttachment.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: mockUserId,
          recordId: 'r1',
          kind: 'image',
          objectKey: 'daily-records/u1/r1/new.jpg',
          bucket: null,
          provider: 'tencent-cos',
          fileName: null,
          contentType: 'image/jpeg',
          sizeBytes: null,
          width: null,
          height: null,
          publicUrl: null,
        },
      ],
    });
    expect(result.attachments[0]?.provider).toBe('tencent-cos');
  });

  it('returns RESOURCE_NOT_FOUND when the record disappears before the attachment update (P2025 race)', async () => {
    repository.findOwnershipData.mockResolvedValueOnce({
      userId: mockUserId,
      kind: 'meal',
      payload: null,
    });
    txMock.userDailyRecord.update.mockRejectedValue(prismaError('P2025'));

    await expect(
      collectResult(
        service.update(mockUserId, 'r1', {
          attachments: [
            {
              objectKey: 'daily-records/u1/r1/new.jpg',
              provider: 'tencent-cos',
              contentType: 'image/jpeg',
            },
          ],
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
    });
  });

  it('should soft-delete a record', async () => {
    repository.findOwnershipData.mockResolvedValue({
      userId: mockUserId,
      kind: 'water',
      payload: null,
    });
    repository.softDelete.mockReturnValue(okAsync(undefined));

    await unwrapOk(service.delete(mockUserId, 'r1'));

    expect(repository.softDelete).toHaveBeenCalledWith('r1', expect.any(Date));
  });

  it('should return summary counts by kind', async () => {
    repository.findManyByDateWithAttachments.mockResolvedValue([
      {
        id: 'r1',

        userId: mockUserId,

        healthEventId: null,
        deletedAt: null,
        kind: 'water',
        occurredAt: new Date('2026-06-04'),
        occurredTime: '10:10',
        title: null,
        value: '3',
        unit: 'cups',
        note: null,
        source: 'manual',
        payload: null,
        mealAnalysisStatus: null,
        mealAnalysisCoverage: null,
        mealAnalysisUpdatedAt: null,
        mealAnalysisFailureReason: null,
        mealSourceRevision: 0,
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'r2',

        userId: mockUserId,

        healthEventId: null,
        deletedAt: null,
        kind: 'water',
        occurredAt: new Date('2026-06-04'),
        occurredTime: '09:00',
        title: null,
        value: '2',
        unit: 'cups',
        note: null,
        source: 'manual',
        payload: null,
        mealAnalysisStatus: null,
        mealAnalysisCoverage: null,
        mealAnalysisUpdatedAt: null,
        mealAnalysisFailureReason: null,
        mealSourceRevision: 0,
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'r3',

        userId: mockUserId,

        healthEventId: null,
        deletedAt: null,
        kind: 'mood',
        occurredAt: new Date('2026-06-04'),
        occurredTime: '20:30',
        title: null,
        value: null,
        unit: null,
        note: 'ok',
        source: 'manual',
        payload: null,
        mealAnalysisStatus: null,
        mealAnalysisCoverage: null,
        mealAnalysisUpdatedAt: null,
        mealAnalysisFailureReason: null,
        mealSourceRevision: 0,
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await service.summary(mockUserId, '2026-06-04');

    expect(result.summaries).toHaveLength(2);
    const water = result.summaries.find((s) => s.kind === 'water');
    if (!water) throw new Error('water summary not found');
    expect(water.count).toBe(2);
    expect(water.latest?.value).toBe('3');
  });

  it('should return FORBIDDEN for foreign record', async () => {
    repository.findOwnershipData.mockResolvedValue({
      userId: 'other',
      kind: 'water',
      payload: null,
    });

    await expect(
      collectResult(service.update(mockUserId, 'r1', {})),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'authorization', code: 'FORBIDDEN' },
    });
  });

  it('should return RESOURCE_NOT_FOUND when record does not exist', async () => {
    repository.findOwnershipData.mockResolvedValue(null);

    await expect(
      collectResult(service.update(mockUserId, 'nonexistent', {})),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
    });
  });

  it('should update occurredTime when provided', async () => {
    repository.findOwnershipData.mockResolvedValue({
      userId: mockUserId,
      kind: 'water',
      payload: null,
    });
    repository.update.mockReturnValue(
      okAsync({
        id: 'r-time-2',

        userId: mockUserId,

        healthEventId: null,
        deletedAt: null,
        kind: 'water',
        occurredAt: new Date('2026-06-04'),
        occurredTime: '21:05',
        title: null,
        value: '250',
        unit: 'ml',
        note: null,
        source: 'manual',
        payload: null,
        mealAnalysisStatus: null,
        mealAnalysisCoverage: null,
        mealAnalysisUpdatedAt: null,
        mealAnalysisFailureReason: null,
        mealSourceRevision: 0,
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    await unwrapOk(
      service.update(mockUserId, 'r-time-2', {
        occurredTime: '21:05',
      }),
    );

    expect(repository.update).toHaveBeenCalledWith('r-time-2', {
      occurredTime: '21:05',
    });
  });

  it('should emit the new kind only for the target date when a record becomes a symptom', async () => {
    repository.findOwnershipData.mockResolvedValue({
      userId: mockUserId,
      kind: DailyRecordKind.water,
      occurredAt: new Date('2026-06-04'),
      payload: null,
    });
    repository.update.mockReturnValue(
      okAsync({
        id: 'r-symptom',
        userId: mockUserId,
        healthEventId: null,
        deletedAt: null,
        kind: DailyRecordKind.symptom,
        occurredAt: new Date('2026-06-05'),
        occurredTime: null,
        title: null,
        value: null,
        unit: null,
        note: null,
        source: 'manual',
        payload: null,
        mealAnalysisStatus: null,
        mealAnalysisCoverage: null,
        mealAnalysisUpdatedAt: null,
        mealAnalysisFailureReason: null,
        mealSourceRevision: 0,
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    await unwrapOk(
      service.update(mockUserId, 'r-symptom', {
        kind: DailyRecordKind.symptom,
        occurredAt: '2026-06-05',
      }),
    );

    expect(eventEmitter.emitAsync).toHaveBeenNthCalledWith(
      1,
      'daily-record.changed',
      {
        userId: mockUserId,
        date: '2026-06-04',
        kind: DailyRecordKind.water,
        recordId: 'r-symptom',
      },
    );
    expect(eventEmitter.emitAsync).toHaveBeenNthCalledWith(
      2,
      'daily-record.changed',
      {
        userId: mockUserId,
        date: '2026-06-05',
        kind: DailyRecordKind.symptom,
        recordId: 'r-symptom',
      },
    );
  });

  it.each([
    ['updates', {}],
    ['moves', { occurredAt: '2026-06-05' }],
  ] as const)(
    'should not emit a symptom event when an ordinary record %s',
    async (_, dto) => {
      repository.findOwnershipData.mockResolvedValue({
        userId: mockUserId,
        kind: DailyRecordKind.water,
        occurredAt: new Date('2026-06-04'),
        payload: null,
      });
      const movedDate = 'occurredAt' in dto ? dto.occurredAt : undefined;
      repository.update.mockReturnValue(
        okAsync({
          id: 'r-water',
          userId: mockUserId,
          healthEventId: null,
          deletedAt: null,
          kind: DailyRecordKind.water,
          occurredAt: new Date(movedDate ?? '2026-06-04'),
          occurredTime: null,
          title: null,
          value: null,
          unit: null,
          note: null,
          source: 'manual',
          payload: null,
          mealAnalysisStatus: null,
          mealAnalysisCoverage: null,
          mealAnalysisUpdatedAt: null,
          mealAnalysisFailureReason: null,
          mealSourceRevision: 0,
          attachments: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      await unwrapOk(service.update(mockUserId, 'r-water', dto));

      expect(eventEmitter.emitAsync).not.toHaveBeenCalledWith(
        'daily-record.changed',
        expect.objectContaining({ kind: DailyRecordKind.symptom }),
      );
    },
  );

  it('should emit symptom events for both dates when a symptom record moves', async () => {
    repository.findOwnershipData.mockResolvedValue({
      userId: mockUserId,
      kind: DailyRecordKind.symptom,
      occurredAt: new Date('2026-06-04'),
      payload: null,
    });
    repository.update.mockReturnValue(
      okAsync({
        id: 'r-moved-symptom',
        userId: mockUserId,
        healthEventId: null,
        deletedAt: null,
        kind: DailyRecordKind.symptom,
        occurredAt: new Date('2026-06-05'),
        occurredTime: null,
        title: null,
        value: null,
        unit: null,
        note: null,
        source: 'manual',
        payload: null,
        mealAnalysisStatus: null,
        mealAnalysisCoverage: null,
        mealAnalysisUpdatedAt: null,
        mealAnalysisFailureReason: null,
        mealSourceRevision: 0,
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    await unwrapOk(
      service.update(mockUserId, 'r-moved-symptom', {
        occurredAt: '2026-06-05',
      }),
    );

    expect(eventEmitter.emitAsync).toHaveBeenCalledTimes(2);
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      'daily-record.changed',
      expect.objectContaining({
        date: '2026-06-05',
        kind: DailyRecordKind.symptom,
      }),
    );
  });

  describe('sleep records', () => {
    it('should create a sleep record with valid payload (wake-date convention)', async () => {
      const sleepPayload = {
        durationMinutes: 450,
        startAt: '2026-06-12T23:00:00.000Z',
        endAt: '2026-06-13T06:30:00.000Z',
        quality: 'good',
      };
      repository.create.mockReturnValue(
        okAsync({
          id: 'rs1',

          userId: mockUserId,

          healthEventId: null,
          deletedAt: null,
          kind: 'sleep',
          occurredAt: new Date('2026-06-13'),
          occurredTime: '07:10',
          title: null,
          value: null,
          unit: null,
          note: null,
          payload: sleepPayload,
          source: 'manual',
          mealAnalysisStatus: null,
          mealAnalysisCoverage: null,
          mealAnalysisUpdatedAt: null,
          mealAnalysisFailureReason: null,
          mealSourceRevision: 0,
          attachments: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const result = await unwrapOk(
        service.create(mockUserId, {
          kind: DailyRecordKind.sleep,
          occurredAt: '2026-06-13',
          occurredTime: '07:10',
          payload: sleepPayload,
        }),
      );

      expect(result.kind).toBe('sleep');
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          occurredAt: new Date('2026-06-13T00:00:00.000Z'),
          occurredTime: '07:10',
          payload: sleepPayload,
        }),
      );
    });

    it('should reject a sleep record without durationMinutes', async () => {
      await expect(
        collectResult(
          service.create(mockUserId, {
            kind: DailyRecordKind.sleep,
            occurredAt: '2026-06-13',
            payload: { quality: 'good' },
          }),
        ),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'validation', code: 'VALIDATION_FAILED' },
      });
    });

    it('should reject an unknown sleep type', async () => {
      await expect(
        collectResult(
          service.create(mockUserId, {
            kind: DailyRecordKind.sleep,
            occurredAt: '2026-06-13',
            payload: {
              sleepType: 'other',
              startedAt: '2026-06-12T23:00:00.000Z',
              endedAt: '2026-06-13T06:30:00.000Z',
              durationMinutes: 450,
            },
          }),
        ),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'validation', code: 'VALIDATION_FAILED' },
      });
    });

    it('should reject a sleep episode whose end is not later than its start', async () => {
      await expect(
        collectResult(
          service.create(mockUserId, {
            kind: DailyRecordKind.sleep,
            occurredAt: '2026-06-13',
            payload: {
              sleepType: 'nightSleep',
              startedAt: '2026-06-13T06:30:00.000Z',
              endedAt: '2026-06-12T23:00:00.000Z',
              durationMinutes: 450,
            },
          }),
        ),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'validation', code: 'VALIDATION_FAILED' },
      });
    });

    it('should reject a sleep episode with only one endpoint', async () => {
      await expect(
        collectResult(
          service.create(mockUserId, {
            kind: DailyRecordKind.sleep,
            occurredAt: '2026-06-13',
            payload: {
              sleepType: 'nap',
              startedAt: '2026-06-13T13:00:00.000Z',
              durationMinutes: 30,
            },
          }),
        ),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'validation', code: 'VALIDATION_FAILED' },
      });
    });

    it('should allow temporary sleep start event record without durationMinutes', async () => {
      repository.create.mockReturnValue(
        okAsync({
          id: 'rs-start',
          userId: mockUserId,
          healthEventId: null,
          deletedAt: null,
          kind: 'sleep',
          occurredAt: new Date('2026-06-13'),
          occurredTime: '07:10',
          title: null,
          value: null,
          unit: null,
          note: null,
          payload: { sleepEvent: 'start', eventAt: '2026-06-13T23:00:00.000Z' },
          source: 'manual',
          mealAnalysisStatus: null,
          mealAnalysisCoverage: null,
          mealAnalysisUpdatedAt: null,
          mealAnalysisFailureReason: null,
          mealSourceRevision: 0,
          attachments: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const result = await unwrapOk(
        service.create(mockUserId, {
          kind: DailyRecordKind.sleep,
          occurredAt: '2026-06-13',
          payload: {
            sleepEvent: 'start',
            eventAt: '2026-06-13T23:00:00.000Z',
          },
        }),
      );

      expect(result.kind).toBe('sleep');
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: {
            sleepEvent: 'start',
            eventAt: '2026-06-13T23:00:00.000Z',
          },
        }),
      );
    });

    it('should allow temporary sleep wake event record without durationMinutes', async () => {
      repository.create.mockReturnValue(
        okAsync({
          id: 'rs-wake',
          userId: mockUserId,
          healthEventId: null,
          deletedAt: null,
          kind: 'sleep',
          occurredAt: new Date('2026-06-13'),
          occurredTime: '07:10',
          title: null,
          value: null,
          unit: null,
          note: null,
          payload: {
            sleepEvent: 'wake',
            eventAt: '2026-06-13T06:30:00.000Z',
            startedRecordId: 'rs-start',
          },
          source: 'manual',
          mealAnalysisStatus: null,
          mealAnalysisCoverage: null,
          mealAnalysisUpdatedAt: null,
          mealAnalysisFailureReason: null,
          mealSourceRevision: 0,
          attachments: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const result = await unwrapOk(
        service.create(mockUserId, {
          kind: DailyRecordKind.sleep,
          occurredAt: '2026-06-13',
          payload: {
            sleepEvent: 'wake',
            eventAt: '2026-06-13T06:30:00.000Z',
            startedRecordId: 'rs-start',
          },
        }),
      );

      expect(result.kind).toBe('sleep');
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: {
            sleepEvent: 'wake',
            eventAt: '2026-06-13T06:30:00.000Z',
            startedRecordId: 'rs-start',
          },
        }),
      );
    });

    it('should reject a sleep record with zero durationMinutes', async () => {
      await expect(
        collectResult(
          service.create(mockUserId, {
            kind: DailyRecordKind.sleep,
            occurredAt: '2026-06-13',
            payload: { durationMinutes: 0 },
          }),
        ),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'validation', code: 'VALIDATION_FAILED' },
      });
    });

    it('should reject a sleep record with negative durationMinutes', async () => {
      await expect(
        collectResult(
          service.create(mockUserId, {
            kind: DailyRecordKind.sleep,
            occurredAt: '2026-06-13',
            payload: { durationMinutes: -30 },
          }),
        ),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'validation', code: 'VALIDATION_FAILED' },
      });
    });

    it('should validate sleep payload on update', async () => {
      repository.findOwnershipData.mockResolvedValue({
        userId: mockUserId,
        kind: 'sleep',
        payload: { durationMinutes: 420 },
      });

      await expect(
        collectResult(
          service.update(mockUserId, 'rs1', {
            payload: { durationMinutes: 0 },
          }),
        ),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'validation', code: 'VALIDATION_FAILED' },
      });
    });
  });

  describe('vital records', () => {
    it('should create a vital record with valid payload', async () => {
      const vitalPayload = {
        vitalType: 'heartRate',
        value: 72,
        unit: 'bpm',
      };
      repository.create.mockReturnValue(
        okAsync({
          id: 'rv1',
          userId: mockUserId,
          healthEventId: null,
          deletedAt: null,
          kind: 'vital',
          occurredAt: new Date('2026-07-29'),
          occurredTime: '10:00',
          title: '心率',
          value: '72',
          unit: 'bpm',
          note: null,
          payload: vitalPayload,
          source: 'apple_health',
          mealAnalysisStatus: null,
          mealAnalysisCoverage: null,
          mealAnalysisUpdatedAt: null,
          mealAnalysisFailureReason: null,
          mealSourceRevision: 0,
          attachments: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const result = await unwrapOk(
        service.create(mockUserId, {
          kind: DailyRecordKind.vital,
          occurredAt: '2026-07-29',
          occurredTime: '10:00',
          title: '心率',
          value: '72',
          unit: 'bpm',
          payload: vitalPayload,
        }),
      );

      expect(result.kind).toBe('vital');
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: vitalPayload,
        }),
      );
    });

    it('should create a vital record without payload (manual entry)', async () => {
      repository.create.mockReturnValue(
        okAsync({
          id: 'rv2',
          userId: mockUserId,
          healthEventId: null,
          deletedAt: null,
          kind: 'vital',
          occurredAt: new Date('2026-07-29'),
          occurredTime: '10:00',
          title: '血压',
          value: '120',
          unit: 'mmHg',
          note: null,
          payload: null,
          source: 'manual',
          mealAnalysisStatus: null,
          mealAnalysisCoverage: null,
          mealAnalysisUpdatedAt: null,
          mealAnalysisFailureReason: null,
          mealSourceRevision: 0,
          attachments: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const result = await unwrapOk(
        service.create(mockUserId, {
          kind: DailyRecordKind.vital,
          occurredAt: '2026-07-29',
          title: '血压',
          value: '120',
          unit: 'mmHg',
        }),
      );

      expect(result.kind).toBe('vital');
    });

    it('should reject a vital record with payload missing vitalType', async () => {
      await expect(
        collectResult(
          service.create(mockUserId, {
            kind: DailyRecordKind.vital,
            occurredAt: '2026-07-29',
            payload: { value: 72, unit: 'bpm' },
          }),
        ),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'validation', code: 'VALIDATION_FAILED' },
      });
    });

    it('should reject a vital record with payload missing value', async () => {
      await expect(
        collectResult(
          service.create(mockUserId, {
            kind: DailyRecordKind.vital,
            occurredAt: '2026-07-29',
            payload: { vitalType: 'heartRate', unit: 'bpm' },
          }),
        ),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'validation', code: 'VALIDATION_FAILED' },
      });
    });
  });

  describe('activity records', () => {
    it('should create an activity record with valid payload', async () => {
      const activityPayload = {
        activityType: 'steps',
        value: 8432,
        unit: 'count',
      };
      repository.create.mockReturnValue(
        okAsync({
          id: 'ra1',
          userId: mockUserId,
          healthEventId: null,
          deletedAt: null,
          kind: 'activity',
          occurredAt: new Date('2026-07-29'),
          occurredTime: '22:00',
          title: '步数',
          value: '8432',
          unit: 'count',
          note: null,
          payload: activityPayload,
          source: 'apple_health',
          mealAnalysisStatus: null,
          mealAnalysisCoverage: null,
          mealAnalysisUpdatedAt: null,
          mealAnalysisFailureReason: null,
          mealSourceRevision: 0,
          attachments: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const result = await unwrapOk(
        service.create(mockUserId, {
          kind: DailyRecordKind.activity,
          occurredAt: '2026-07-29',
          title: '步数',
          value: '8432',
          unit: 'count',
          payload: activityPayload,
        }),
      );

      expect(result.kind).toBe('activity');
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: activityPayload,
        }),
      );
    });

    it('should create an activity record without payload (manual entry)', async () => {
      repository.create.mockReturnValue(
        okAsync({
          id: 'ra2',
          userId: mockUserId,
          healthEventId: null,
          deletedAt: null,
          kind: 'activity',
          occurredAt: new Date('2026-07-29'),
          occurredTime: '10:00',
          title: '运动',
          value: '30',
          unit: 'min',
          note: null,
          payload: null,
          source: 'manual',
          mealAnalysisStatus: null,
          mealAnalysisCoverage: null,
          mealAnalysisUpdatedAt: null,
          mealAnalysisFailureReason: null,
          mealSourceRevision: 0,
          attachments: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const result = await unwrapOk(
        service.create(mockUserId, {
          kind: DailyRecordKind.activity,
          occurredAt: '2026-07-29',
          title: '运动',
          value: '30',
          unit: 'min',
        }),
      );

      expect(result.kind).toBe('activity');
    });

    it('should reject an activity record with payload missing activityType', async () => {
      await expect(
        collectResult(
          service.create(mockUserId, {
            kind: DailyRecordKind.activity,
            occurredAt: '2026-07-29',
            payload: { value: 100, unit: 'count' },
          }),
        ),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'validation', code: 'VALIDATION_FAILED' },
      });
    });

    it('should reject an activity record with payload missing value', async () => {
      await expect(
        collectResult(
          service.create(mockUserId, {
            kind: DailyRecordKind.activity,
            occurredAt: '2026-07-29',
            payload: { activityType: 'steps', unit: 'count' },
          }),
        ),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'validation', code: 'VALIDATION_FAILED' },
      });
    });
  });
});
