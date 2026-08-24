import type { DeepMocked } from '../../../common/types/deep-mocked';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';

import * as argon2 from 'argon2';
import { PrismaService } from '../../../prisma';
import { TestingSupportService } from './fixtures.service';
import { ARGON2_OPTIONS } from '../../auth';

vi.mock('argon2', () => ({
  argon2id: 2,
  hash: vi.fn(),
}));

describe('TestingSupportService', () => {
  let service: TestingSupportService;
  let prisma: DeepMocked<PrismaService>;
  let cache: { del: vi.Mock };

  beforeEach(async () => {
    cache = {
      del: vi.fn(),
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
            $transaction: vi.fn(),
            user: {
              findFirst: vi.fn(),
              create: vi.fn(),
              update: vi.fn(),
            },
            account: {
              upsert: vi.fn(),
            },
            userDailyRecord: {
              findMany: vi.fn(),
              deleteMany: vi.fn(),
            },
            userDailyRecordAttachment: {
              deleteMany: vi.fn(),
            },
            userSession: {
              deleteMany: vi.fn(),
            },
            userSetting: {
              upsert: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get(TestingSupportService);
    prisma = module.get(PrismaService);

    const runTransaction = async <T>(
      callback: (tx: DeepMocked<PrismaService>) => Promise<T>,
    ): Promise<T> => callback(prisma);
    (prisma.$transaction as vi.Mock).mockImplementation(runTransaction);
    (argon2.hash as vi.Mock).mockResolvedValue('$argon2id$e2e');
  });

  it('should create a dedicated record-lane user when none exists', async () => {
    (prisma.user.findFirst as vi.Mock).mockResolvedValue(null);
    (prisma.user.create as vi.Mock).mockResolvedValue({
      id: 'user-1',
      nickname: 'Record Lane User',
    });
    (prisma.userDailyRecord.findMany as vi.Mock).mockResolvedValue([]);

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
        nickname: 'Record Lane User',
        profile: { create: {} },
      }),
      select: { id: true, nickname: true },
    });
    expect(prisma.account.upsert).toHaveBeenCalledWith({
      where: {
        providerId_accountId: {
          providerId: 'credential',
          accountId: 'user-1',
        },
      },
      create: expect.objectContaining({
        userId: 'user-1',
        providerId: 'credential',
        issuer: 'local:credential',
        accountId: 'user-1',
        password: '$argon2id$e2e',
      }),
      update: {
        password: '$argon2id$e2e',
      },
    });
    expect(prisma.userSession.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(prisma.userDailyRecord.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        occurredAt: new Date('2026-06-12T00:00:00.000Z'),
      },
      select: { id: true },
    });
    expect(prisma.userSetting.upsert).toHaveBeenCalledTimes(7);
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
    expect(prisma.userSetting.upsert).toHaveBeenCalledWith({
      where: {
        userId_key: {
          userId: 'user-1',
          key: 'assistantEnabled',
        },
      },
      create: {
        userId: 'user-1',
        key: 'assistantEnabled',
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
    (prisma.user.findFirst as vi.Mock).mockResolvedValue({
      id: 'user-1',
      nickname: 'Old Nickname',
    });
    (prisma.user.update as vi.Mock).mockResolvedValue({
      id: 'user-1',
      nickname: 'Record Lane User',
    });
    (prisma.userDailyRecord.findMany as vi.Mock).mockResolvedValue([
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
    expect(prisma.account.upsert).toHaveBeenCalledWith({
      where: {
        providerId_accountId: {
          providerId: 'credential',
          accountId: 'user-1',
        },
      },
      create: expect.objectContaining({
        userId: 'user-1',
        providerId: 'credential',
        issuer: 'local:credential',
        accountId: 'user-1',
        password: '$argon2id$e2e',
      }),
      update: {
        password: '$argon2id$e2e',
      },
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
    expect(prisma.userDailyRecord.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        occurredAt: new Date('2026-06-12T00:00:00.000Z'),
      },
      select: { id: true },
    });
    expect(prisma.userSetting.upsert).toHaveBeenCalledTimes(7);
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
    expect(prisma.userSetting.upsert).toHaveBeenCalledWith({
      where: {
        userId_key: {
          userId: 'user-1',
          key: 'assistantEnabled',
        },
      },
      create: {
        userId: 'user-1',
        key: 'assistantEnabled',
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
