import type { PrismaService } from '../../../prisma/prisma.service';
import { UserSettingsService } from './user-settings.service';

function createMockCache() {
  return {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
  } as never;
}

describe('UserSettingsService', () => {
  it('returns defaults when the user has no stored settings', async () => {
    const prisma = {
      userSetting: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn(),
      },
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          securityPinEnabled: false,
          securityPinChangedAt: null,
        }),
      },
    } as unknown as PrismaService;

    const service = new UserSettingsService(prisma, createMockCache());

    await expect(service.getSettings('user-1')).resolves.toEqual({
      aiSummariesEnabled: true,
      dataSharingConsent: false,
      assistantEnabled: true,
      assistantMemoryEnabled: false,
      waterTargetCount: 8,
      assistantContext: {
        healthProfile: true,
        dailyRecords: true,
        sleepRecords: true,
        currentMedicines: true,
      },
      updatedAt: null,
      securityPin: {
        enabled: false,
        lastChangedAt: null,
      },
    });
  });

  it('merges stored assistant setting keys and nested context permissions', async () => {
    const prisma = {
      userSetting: {
        findMany: vi.fn().mockResolvedValue([
          {
            key: 'assistantMemoryEnabled',
            value: true,
            updatedAt: new Date('2026-06-17T11:00:00.000Z'),
          },
          {
            key: 'assistantContext.sleepRecords',
            value: false,
            updatedAt: new Date('2026-06-17T10:00:00.000Z'),
          },
          {
            key: 'assistantEnabled',
            value: false,
            updatedAt: new Date('2026-06-17T09:00:00.000Z'),
          },
          {
            key: 'dataSharingConsent',
            value: true,
            updatedAt: new Date('2026-06-16T08:00:00.000Z'),
          },
        ]),
        upsert: vi.fn(),
      },
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          securityPinEnabled: true,
          securityPinChangedAt: new Date('2026-07-03T12:00:00.000Z'),
        }),
      },
    } as unknown as PrismaService;

    const service = new UserSettingsService(prisma, createMockCache());

    await expect(service.getSettings('user-1')).resolves.toEqual({
      aiSummariesEnabled: true,
      dataSharingConsent: true,
      assistantEnabled: false,
      assistantMemoryEnabled: true,
      waterTargetCount: 8,
      assistantContext: {
        healthProfile: true,
        dailyRecords: true,
        sleepRecords: false,
        currentMedicines: true,
      },
      updatedAt: '2026-06-17T11:00:00.000Z',
      securityPin: {
        enabled: true,
        lastChangedAt: '2026-07-03T12:00:00.000Z',
      },
    });
  });

  it('upserts assistant setting keys and nested context toggles', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      userSetting: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert,
      },
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          securityPinEnabled: false,
          securityPinChangedAt: null,
        }),
      },
    } as unknown as PrismaService;

    const service = new UserSettingsService(prisma, createMockCache());

    await service.updateSettings('user-1', {
      assistantEnabled: false,
      assistantMemoryEnabled: true,
      assistantContext: {
        healthProfile: false,
        sleepRecords: false,
      },
    });

    expect(upsert).toHaveBeenCalledTimes(4);
    expect(upsert).toHaveBeenCalledWith({
      where: {
        userId_key: { userId: 'user-1', key: 'assistantEnabled' },
      },
      create: {
        userId: 'user-1',
        key: 'assistantEnabled',
        value: false,
      },
      update: {
        value: false,
      },
    });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        userId_key: { userId: 'user-1', key: 'assistantMemoryEnabled' },
      },
      create: {
        userId: 'user-1',
        key: 'assistantMemoryEnabled',
        value: true,
      },
      update: {
        value: true,
      },
    });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        userId_key: { userId: 'user-1', key: 'assistantContext.healthProfile' },
      },
      create: {
        userId: 'user-1',
        key: 'assistantContext.healthProfile',
        value: false,
      },
      update: {
        value: false,
      },
    });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        userId_key: { userId: 'user-1', key: 'assistantContext.sleepRecords' },
      },
      create: {
        userId: 'user-1',
        key: 'assistantContext.sleepRecords',
        value: false,
      },
      update: {
        value: false,
      },
    });
  });

  it('does not call upsert when update payload is empty', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      userSetting: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert,
      },
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          securityPinEnabled: false,
          securityPinChangedAt: null,
        }),
      },
    } as unknown as PrismaService;

    const service = new UserSettingsService(prisma, createMockCache());

    await service.updateSettings('user-1', {});

    expect(upsert).not.toHaveBeenCalled();
  });

  it('upserts waterTargetCount as a setting key', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      userSetting: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert,
      },
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          securityPinEnabled: false,
          securityPinChangedAt: null,
        }),
      },
    } as unknown as PrismaService;

    const service = new UserSettingsService(prisma, createMockCache());

    await service.updateSettings('user-1', { waterTargetCount: 12 });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        userId_key: { userId: 'user-1', key: 'waterTargetCount' },
      },
      create: {
        userId: 'user-1',
        key: 'waterTargetCount',
        value: 12,
      },
      update: {
        value: 12,
      },
    });
  });
});
