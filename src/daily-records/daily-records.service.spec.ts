/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any */

import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DailyRecordKind } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DailyRecordsService } from './daily-records.service';

const mockUserId = 'user-uuid-1';

describe('DailyRecordsService', () => {
  let service: DailyRecordsService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailyRecordsService,
        {
          provide: PrismaService,
          useValue: {
            userDailyRecord: {
              findMany: jest.fn(),
              count: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              findUnique: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get(DailyRecordsService);
    prisma = module.get(PrismaService);
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
    (prisma.userDailyRecord.findUnique as jest.Mock).mockResolvedValue({
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
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.update(mockUserId, 'r1', { note: 'updated' });

    expect(prisma.userDailyRecord.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { note: 'updated' },
    });
    expect(result.note).toBe('updated');
  });

  it('should clear nullable fields when sending null', async () => {
    (prisma.userDailyRecord.findUnique as jest.Mock).mockResolvedValue({
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
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.update(mockUserId, 'r1', { note: null, value: null });

    expect(prisma.userDailyRecord.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { note: null, value: null },
    });
  });

  it('should soft-delete a record', async () => {
    (prisma.userDailyRecord.findUnique as jest.Mock).mockResolvedValue({
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
    (prisma.userDailyRecord.findUnique as jest.Mock).mockResolvedValue({
      userId: 'other',
    });

    await expect(service.update(mockUserId, 'r1', {})).rejects.toThrow(
      NotFoundException,
    );
  });
});
