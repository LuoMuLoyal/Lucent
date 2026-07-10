import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { DailyRecordKind } from '#generated/prisma/client';
import { DailyRecordRepositoryPort } from './repositories/daily-record.repository';
import { DailyRecordsOwnershipService } from './services/ownership.service';
import { DailyRecordsMapperService } from './services/mapper.service';
import { DailyRecordsService } from './services/records.service';
import { MealAnalysisQueueService } from './services/meal-analysis/queue.service';
import { MealDishTemplateLearningService } from './services/meal-dish/template-learning.service';

const mockUserId = 'user-uuid-1';

describe('DailyRecordsService', () => {
  let service: DailyRecordsService;
  let repository: jest.Mocked<DailyRecordRepositoryPort>;
  let txMock: jest.Mocked<{
    userDailyRecord: {
      create: jest.Mock;
      update: jest.Mock;
      findFirst: jest.Mock;
    };
    userDailyRecordAttachment: {
      createMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  }>;
  let mealAnalysisQueueService: { enqueue: jest.Mock };
  let mealDishTemplateLearningService: {
    learnFromConfirmedAnalysis: jest.Mock;
  };

  beforeEach(async () => {
    mealAnalysisQueueService = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    mealDishTemplateLearningService = {
      learnFromConfirmedAnalysis: jest.fn().mockResolvedValue(undefined),
    };

    txMock = {
      userDailyRecord: {
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
      },
      userDailyRecordAttachment: {
        createMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    const repositoryMock = {
      findManyWithAttachments: jest.fn(),
      findByIdWithAttachments: jest.fn(),
      findOwnershipData: jest.fn(),
      findManyByDateWithAttachments: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      transaction: jest.fn(
        async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock),
      ) as jest.Mock,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: I18nService,
          useValue: { t: jest.fn().mockImplementation((key: string) => key) },
        },
        DailyRecordsService,
        DailyRecordsOwnershipService,
        DailyRecordsMapperService,
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
    repository.create.mockResolvedValue({
      id: 'r1',

      userId: mockUserId,

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
    });

    const result = await service.create(mockUserId, {
      kind: DailyRecordKind.mood,
      occurredAt: '2026-06-04',
      occurredTime: '14:20',
      note: 'good',
    });

    expect(result.kind).toBe('mood');
    expect(result.note).toBe('good');
    expect(result.occurredTime).toBe('14:20');
  });

  it('should update a record with partial fields', async () => {
    repository.findOwnershipData.mockResolvedValue({
      userId: mockUserId,
      kind: 'mood',
      payload: null,
    });
    repository.update.mockResolvedValue({
      id: 'r1',

      userId: mockUserId,

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
    });

    const result = await service.update(mockUserId, 'r1', { note: 'updated' });

    expect(repository.update).toHaveBeenCalledWith('r1', {
      note: 'updated',
    });
    expect(result.note).toBe('updated');
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
    repository.update.mockResolvedValue({
      id: 'meal-2',

      userId: mockUserId,

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
    });

    await service.update(mockUserId, 'meal-2', {
      payload: {
        mealInput: {
          manualSummary: 'new summary',
        },
        mealAnalysis: {
          analysisStatus: 'analysis_failed',
          mealDescription: 'client overwrite attempt',
        },
      },
    });

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
    repository.update.mockResolvedValue({
      id: 'meal-3',

      userId: mockUserId,

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
    });

    await service.update(mockUserId, 'meal-3', {
      payload: {
        mealInput: {
          recognizedDishes: [{ rawName: '用户改过的菜名' }],
        },
      },
    });

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
    repository.update.mockResolvedValue({
      id: 'meal-4',

      userId: mockUserId,

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
    });

    await service.update(mockUserId, 'meal-4', {
      payload: {
        mealAnalysis: {
          analysisStatus: 'confirmed',
        },
      },
    });

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
    repository.update.mockResolvedValue({
      id: 'r1',

      userId: mockUserId,

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
    });

    await service.update(mockUserId, 'r1', { note: null, value: null });

    expect(repository.update).toHaveBeenCalledWith('r1', {
      note: null,
      value: null,
    });
  });

  it('should create a record with image attachment metadata', async () => {
    txMock.userDailyRecord.create.mockResolvedValue({
      id: 'r1',

      userId: mockUserId,

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

    const result = await service.create(mockUserId, {
      kind: DailyRecordKind.meal,
      occurredAt: '2026-06-04',
      title: 'Breakfast',
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
    });

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

    const result = await service.update(mockUserId, 'r1', {
      attachments: [
        {
          objectKey: 'daily-records/u1/r1/new.jpg',
          provider: 'tencent-cos',
          contentType: 'image/jpeg',
        },
      ],
    });

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

  it('should soft-delete a record', async () => {
    repository.findOwnershipData.mockResolvedValue({
      userId: mockUserId,
      kind: 'water',
      payload: null,
    });
    repository.softDelete.mockResolvedValue(undefined);

    await service.delete(mockUserId, 'r1');

    expect(repository.softDelete).toHaveBeenCalledWith('r1', expect.any(Date));
  });

  it('should return summary counts by kind', async () => {
    repository.findManyByDateWithAttachments.mockResolvedValue([
      {
        id: 'r1',

        userId: mockUserId,

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

  it('should throw NotFoundException for foreign record', async () => {
    repository.findOwnershipData.mockResolvedValue({
      userId: 'other',
      kind: 'water',
      payload: null,
    });

    await expect(service.update(mockUserId, 'r1', {})).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should throw NotFoundException when record does not exist', async () => {
    repository.findOwnershipData.mockResolvedValue(null);

    await expect(service.update(mockUserId, 'nonexistent', {})).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should update occurredTime when provided', async () => {
    repository.findOwnershipData.mockResolvedValue({
      userId: mockUserId,
      kind: 'water',
      payload: null,
    });
    repository.update.mockResolvedValue({
      id: 'r-time-2',

      userId: mockUserId,

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
    });

    await service.update(mockUserId, 'r-time-2', {
      occurredTime: '21:05',
    });

    expect(repository.update).toHaveBeenCalledWith('r-time-2', {
      occurredTime: '21:05',
    });
  });

  describe('sleep records', () => {
    it('should create a sleep record with valid payload (wake-date convention)', async () => {
      const sleepPayload = {
        durationMinutes: 450,
        startAt: '2026-06-12T23:00:00.000Z',
        endAt: '2026-06-13T06:30:00.000Z',
        quality: 'good',
      };
      repository.create.mockResolvedValue({
        id: 'rs1',

        userId: mockUserId,

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
      });

      const result = await service.create(mockUserId, {
        kind: DailyRecordKind.sleep,
        occurredAt: '2026-06-13',
        occurredTime: '07:10',
        payload: sleepPayload,
      });

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
        service.create(mockUserId, {
          kind: DailyRecordKind.sleep,
          occurredAt: '2026-06-13',
          payload: { quality: 'good' },
        }),
      ).rejects.toThrow(/durationMinutes/);
    });

    it('should reject a sleep record with zero durationMinutes', async () => {
      await expect(
        service.create(mockUserId, {
          kind: DailyRecordKind.sleep,
          occurredAt: '2026-06-13',
          payload: { durationMinutes: 0 },
        }),
      ).rejects.toThrow(/positive number/);
    });

    it('should reject a sleep record with negative durationMinutes', async () => {
      await expect(
        service.create(mockUserId, {
          kind: DailyRecordKind.sleep,
          occurredAt: '2026-06-13',
          payload: { durationMinutes: -30 },
        }),
      ).rejects.toThrow(/positive number/);
    });

    it('should validate sleep payload on update', async () => {
      repository.findOwnershipData.mockResolvedValue({
        userId: mockUserId,
        kind: 'sleep',
        payload: { durationMinutes: 420 },
      });

      await expect(
        service.update(mockUserId, 'rs1', {
          payload: { durationMinutes: 0 },
        }),
      ).rejects.toThrow(/positive number/);
    });
  });
});
