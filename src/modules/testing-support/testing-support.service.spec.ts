/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';

import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { TestingSupportService } from './testing-support.service';
import { ARGON2_OPTIONS } from '../auth/argon2-options';

jest.mock('argon2', () => ({
  hash: jest.fn(),
}));

describe('TestingSupportService', () => {
  let service: TestingSupportService;
  let prisma: jest.Mocked<PrismaService>;
  let cache: { del: jest.Mock };

  beforeEach(async () => {
    cache = {
      del: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestingSupportService,
        {
          provide: CACHE_MANAGER,
          useValue: cache,
        },
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn(),
            user: {
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
            userDailyRecord: {
              findMany: jest.fn(),
              deleteMany: jest.fn(),
            },
            userDailyRecordAttachment: {
              deleteMany: jest.fn(),
            },
            userSession: {
              deleteMany: jest.fn(),
            },
            userSetting: {
              upsert: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get(TestingSupportService);
    prisma = module.get(PrismaService);

    const runTransaction = async <T>(
      callback: (tx: jest.Mocked<PrismaService>) => Promise<T>,
    ): Promise<T> => callback(prisma);
    (prisma.$transaction as jest.Mock).mockImplementation(runTransaction);
    (argon2.hash as jest.Mock).mockResolvedValue('$argon2id$e2e');
  });

  it('should create a dedicated record-lane user when none exists', async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.user.create as jest.Mock).mockResolvedValue({
      id: 'user-1',
      nickname: 'Record Lane User',
    });
    (prisma.userDailyRecord.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.prepareFullstackRecordLane({
      email: 'RecordLane@example.com',
      password: 'RecordLane123',
      date: '2026-06-12',
      nickname: 'Record Lane User',
    });

    expect(argon2.hash).toHaveBeenCalledWith('RecordLane123', ARGON2_OPTIONS);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'recordlane@example.com',
        passwordHash: '$argon2id$e2e',
        nickname: 'Record Lane User',
        profile: { create: {} },
      }),
      select: { id: true, nickname: true },
    });
    expect(prisma.userSession.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(prisma.userSetting.upsert).toHaveBeenCalledWith({
      where: {
        userId_key: {
          userId: 'user-1',
          key: 'aiSummariesEnabled',
        },
      },
      create: {
        userId: 'user-1',
        key: 'aiSummariesEnabled',
        value: true,
      },
      update: {
        value: true,
      },
    });
    expect(result).toEqual({
      createdUser: true,
      userId: 'user-1',
      email: 'recordlane@example.com',
      nickname: 'Record Lane User',
      date: '2026-06-12',
      clearedRecordCount: 0,
    });
    expect(cache.del).toHaveBeenCalledWith(
      `auth:login-failure:${createHash('sha256').update('recordlane@example.com').digest('hex')}`,
    );
  });

  it('should update an existing user and hard-delete daily records for the target date', async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValue({
      id: 'user-1',
      nickname: 'Old Nickname',
    });
    (prisma.user.update as jest.Mock).mockResolvedValue({
      id: 'user-1',
      nickname: 'Record Lane User',
    });
    (prisma.userDailyRecord.findMany as jest.Mock).mockResolvedValue([
      { id: 'record-1' },
      { id: 'record-2' },
    ]);

    const result = await service.prepareFullstackRecordLane({
      email: 'recordlane@example.com',
      password: 'RecordLane123',
      date: '2026-06-12',
      nickname: 'Record Lane User',
    });

    expect(argon2.hash).toHaveBeenCalledWith('RecordLane123', ARGON2_OPTIONS);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: expect.objectContaining({
        passwordHash: '$argon2id$e2e',
        nickname: 'Record Lane User',
        profile: {
          upsert: {
            create: {},
            update: {},
          },
        },
      }),
      select: { id: true, nickname: true },
    });
    expect(prisma.userDailyRecordAttachment.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        recordId: { in: ['record-1', 'record-2'] },
      },
    });
    expect(prisma.userDailyRecord.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        id: { in: ['record-1', 'record-2'] },
      },
    });
    expect(prisma.userSetting.upsert).toHaveBeenCalledWith({
      where: {
        userId_key: {
          userId: 'user-1',
          key: 'aiSummariesEnabled',
        },
      },
      create: {
        userId: 'user-1',
        key: 'aiSummariesEnabled',
        value: true,
      },
      update: {
        value: true,
      },
    });
    expect(result.clearedRecordCount).toBe(2);
    expect(result.createdUser).toBe(false);
  });
});
