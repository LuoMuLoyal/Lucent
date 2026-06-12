/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any */

import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DailyRecordKind } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DailyRecordsGuardService } from './daily-records-guard.service';
import { DailyRecordsMapperService } from './daily-records-mapper.service';
import { DailyRecordsService } from './daily-records.service';

const mockUserId = 'user-uuid-1';

describe('DailyRecordsService', () => {
  let service: DailyRecordsService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailyRecordsService,
        DailyRecordsGuardService,
        DailyRecordsMapperService,
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
    expect(result.items[0].kind).toBe('water');
  });

  it('should create a record', async () => {
    (prisma.userDailyRecord.create as jest.Mock).mockResolvedValue({
      id: 'r1',
      kind: 'mood',
      occurredAt: new Date('2026-06-04'),
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
      note: 'good',
    });

    expect(result.kind).toBe('mood');
    expect(result.note).toBe('good');
  });

  it('should update a record with partial fields', async () => {
    (prisma.userDailyRecord.findFirst as jest.Mock).mockResolvedValue({
      userId: mockUserId,
    });
    (prisma.userDailyRecord.update as jest.Mock).mockResolvedValue({
      id: 'r1',
      kind: 'mood',
      occurredAt: new Date('2026-06-04'),
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

  it('should clear nullable fields when sending null', async () => {
    (prisma.userDailyRecord.findFirst as jest.Mock).mockResolvedValue({
      userId: mockUserId,
    });
    (prisma.userDailyRecord.update as jest.Mock).mockResolvedValue({
      id: 'r1',
      kind: 'water',
      occurredAt: new Date('2026-06-04'),
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
    expect(result.attachments[0]!.objectKey).toBe(
      'daily-records/u1/r1/photo.jpg',
    );
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
    expect(result.attachments[0]!.provider).toBe('tencent-cos');
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
    const water = result.summaries.find((s: any) => s.kind === 'water')!;
    expect(water.count).toBe(2);
    expect(water.latest!.value).toBe('3');
  });

  it('should throw NotFoundException for foreign record', async () => {
    (prisma.userDailyRecord.findFirst as jest.Mock).mockResolvedValue({
      userId: 'other',
    });

    await expect(service.update(mockUserId, 'r1', {})).rejects.toThrow(
      NotFoundException,
    );
  });
});
