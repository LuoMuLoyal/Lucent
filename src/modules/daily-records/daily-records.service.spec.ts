import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { DailyRecordKind } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DailyRecordsOwnershipService } from './services/ownership.service';
import { DailyRecordsMapperService } from './services/daily-records-mapper.service';
import { DailyRecordsService } from './services/daily-records.service';
import { MealAnalysisQueueService } from './services/meal-analysis-queue.service';

const mockUserId = 'user-uuid-1';

describe('DailyRecordsService', () => {
  let service: DailyRecordsService;
  let prisma: jest.Mocked<PrismaService>;
  let mealAnalysisQueueService: { enqueue: jest.Mock };

  beforeEach(async () => {
    mealAnalysisQueueService = {
      enqueue: jest.fn().mockResolvedValue(undefined),
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
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn(),
            userDailyRecord: {
              findMany: jest.fn(),
              count: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              findFirst: jest.fn(),
            },
            userDailyRecordAttachment: {
              createMany: jest.fn(),
              deleteMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get(DailyRecordsService);
    prisma = module.get(PrismaService);
    const runTransaction = async <T>(
      callback: (tx: jest.Mocked<PrismaService>) => Promise<T>,
    ): Promise<T> => callback(prisma);
    (prisma.$transaction as jest.Mock).mockImplementation(runTransaction);
  });

  it('should list records for a given date', async () => {
    (prisma.userDailyRecord.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'r1',
        kind: 'water',
        occurredAt: new Date('2026-06-04'),
        occurredTime: '09:45',
        title: null,
        value: '3',
        unit: 'cups',
        note: null,
        source: 'manual',
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    (prisma.userDailyRecord.count as jest.Mock).mockResolvedValue(1);

    const result = await service.list(mockUserId, '2026-06-04');

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.items[0]?.kind).toBe('water');
    expect(result.items[0]?.occurredTime).toBe('09:45');
  });

  it('should hide heavy meal payload fields from default list reads', async () => {
    (prisma.userDailyRecord.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'meal-1',
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
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    (prisma.userDailyRecord.count as jest.Mock).mockResolvedValue(1);

    const result = await service.list(mockUserId, '2026-07-01');

    expect(result.items[0]?.payload).toBeNull();
  });

  it('should create a record', async () => {
    (prisma.userDailyRecord.create as jest.Mock).mockResolvedValue({
      id: 'r1',
      kind: 'mood',
      occurredAt: new Date('2026-06-04'),
      occurredTime: '14:20',
      title: null,
      value: null,
      unit: null,
      note: 'good',
      source: 'manual',
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
    (prisma.userDailyRecord.findFirst as jest.Mock).mockResolvedValue({
      userId: mockUserId,
    });
    (prisma.userDailyRecord.update as jest.Mock).mockResolvedValue({
      id: 'r1',
      kind: 'mood',
      occurredAt: new Date('2026-06-04'),
      occurredTime: null,
      title: null,
      value: null,
      unit: null,
      note: 'updated',
      source: 'manual',
      attachments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.update(mockUserId, 'r1', { note: 'updated' });

    expect(prisma.userDailyRecord.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { note: 'updated' },
      include: { attachments: { orderBy: { createdAt: 'asc' } } },
    });
    expect(result.note).toBe('updated');
  });

  it('should preserve server-owned mealAnalysis when updating meal payload', async () => {
    (prisma.userDailyRecord.findFirst as jest.Mock).mockResolvedValue({
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
    (prisma.userDailyRecord.update as jest.Mock).mockResolvedValue({
      id: 'meal-2',
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

    expect(prisma.userDailyRecord.update).toHaveBeenCalledWith({
      where: { id: 'meal-2' },
      data: {
        mealAnalysisCoverage: null,
        mealAnalysisFailureReason: null,
        mealAnalysisStatus: 'confirmed',
        mealAnalysisUpdatedAt: null,
        mealSourceRevision: 0,
        payload: {
          mealInput: {
            manualSummary: 'new summary',
          },
          mealAnalysis: {
            analysisStatus: 'confirmed',
            mealDescription: 'trusted analysis',
          },
        },
      },
      include: { attachments: { orderBy: { createdAt: 'asc' } } },
    });
  });

  it('should clear nullable fields when sending null', async () => {
    (prisma.userDailyRecord.findFirst as jest.Mock).mockResolvedValue({
      userId: mockUserId,
    });
    (prisma.userDailyRecord.update as jest.Mock).mockResolvedValue({
      id: 'r1',
      kind: 'water',
      occurredAt: new Date('2026-06-04'),
      occurredTime: null,
      title: null,
      value: null,
      unit: null,
      note: null,
      source: 'manual',
      attachments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.update(mockUserId, 'r1', { note: null, value: null });

    expect(prisma.userDailyRecord.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { note: null, value: null },
      include: { attachments: { orderBy: { createdAt: 'asc' } } },
    });
  });

  it('should create a record with image attachment metadata', async () => {
    (prisma.userDailyRecord.create as jest.Mock).mockResolvedValue({
      id: 'r1',
      kind: 'meal',
      occurredAt: new Date('2026-06-04'),
      occurredTime: '08:30',
      title: 'Breakfast',
      value: null,
      unit: null,
      note: null,
      source: 'manual',
      attachments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (
      prisma.userDailyRecordAttachment.createMany as jest.Mock
    ).mockResolvedValue({
      count: 1,
    });
    (prisma.userDailyRecord.findFirst as jest.Mock).mockResolvedValue({
      id: 'r1',
      kind: 'meal',
      occurredAt: new Date('2026-06-04'),
      occurredTime: '08:30',
      title: 'Breakfast',
      value: null,
      unit: null,
      note: null,
      source: 'manual',
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

    expect(prisma.userDailyRecordAttachment.createMany).toHaveBeenCalledWith({
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
    (prisma.userDailyRecord.findFirst as jest.Mock)
      .mockResolvedValueOnce({
        userId: mockUserId,
      })
      .mockResolvedValueOnce({
        id: 'r1',
        kind: 'meal',
        occurredAt: new Date('2026-06-04'),
        occurredTime: '13:40',
        title: null,
        value: null,
        unit: null,
        note: null,
        source: 'manual',
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
    (prisma.userDailyRecord.update as jest.Mock).mockResolvedValue({
      id: 'r1',
      kind: 'meal',
      occurredAt: new Date('2026-06-04'),
      occurredTime: '13:40',
      title: null,
      value: null,
      unit: null,
      note: null,
      source: 'manual',
      attachments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (
      prisma.userDailyRecordAttachment.deleteMany as jest.Mock
    ).mockResolvedValue({
      count: 1,
    });
    (
      prisma.userDailyRecordAttachment.createMany as jest.Mock
    ).mockResolvedValue({
      count: 1,
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

    expect(prisma.userDailyRecordAttachment.deleteMany).toHaveBeenCalledWith({
      where: { userId: mockUserId, recordId: 'r1' },
    });
    expect(prisma.userDailyRecordAttachment.createMany).toHaveBeenCalledWith({
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
    (prisma.userDailyRecord.findFirst as jest.Mock).mockResolvedValue({
      userId: mockUserId,
    });
    (prisma.userDailyRecord.update as jest.Mock).mockResolvedValue({});

    await service.delete(mockUserId, 'r1');

    expect(prisma.userDailyRecord.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('should return summary counts by kind', async () => {
    (prisma.userDailyRecord.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'r1',
        kind: 'water',
        occurredAt: new Date('2026-06-04'),
        occurredTime: '10:10',
        title: null,
        value: '3',
        unit: 'cups',
        note: null,
        source: 'manual',
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'r2',
        kind: 'water',
        occurredAt: new Date('2026-06-04'),
        occurredTime: '09:00',
        title: null,
        value: '2',
        unit: 'cups',
        note: null,
        source: 'manual',
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'r3',
        kind: 'mood',
        occurredAt: new Date('2026-06-04'),
        occurredTime: '20:30',
        title: null,
        value: null,
        unit: null,
        note: 'ok',
        source: 'manual',
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
    (prisma.userDailyRecord.findFirst as jest.Mock).mockResolvedValue({
      userId: 'other',
    });

    await expect(service.update(mockUserId, 'r1', {})).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should throw NotFoundException when record does not exist', async () => {
    (prisma.userDailyRecord.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(service.update(mockUserId, 'nonexistent', {})).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should update occurredTime when provided', async () => {
    (prisma.userDailyRecord.findFirst as jest.Mock).mockResolvedValue({
      userId: mockUserId,
      kind: 'water',
      payload: null,
    });
    (prisma.userDailyRecord.update as jest.Mock).mockResolvedValue({
      id: 'r-time-2',
      kind: 'water',
      occurredAt: new Date('2026-06-04'),
      occurredTime: '21:05',
      title: null,
      value: '250',
      unit: 'ml',
      note: null,
      source: 'manual',
      attachments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.update(mockUserId, 'r-time-2', {
      occurredTime: '21:05',
    });

    expect(prisma.userDailyRecord.update).toHaveBeenCalledWith({
      where: { id: 'r-time-2' },
      data: { occurredTime: '21:05' },
      include: { attachments: { orderBy: { createdAt: 'asc' } } },
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
      (prisma.userDailyRecord.create as jest.Mock).mockResolvedValue({
        id: 'rs1',
        kind: 'sleep',
        occurredAt: new Date('2026-06-13'), // wake date
        occurredTime: '07:10',
        title: null,
        value: null,
        unit: null,
        note: null,
        payload: sleepPayload,
        source: 'manual',
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.create(mockUserId, {
        kind: DailyRecordKind.sleep,
        occurredAt: '2026-06-13', // wake date
        occurredTime: '07:10',
        payload: sleepPayload,
      });

      expect(result.kind).toBe('sleep');
      expect(prisma.userDailyRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            occurredAt: new Date('2026-06-13T00:00:00.000Z'),
            occurredTime: '07:10',
            payload: sleepPayload,
          }),
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
      (prisma.userDailyRecord.findFirst as jest.Mock).mockResolvedValue({
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
