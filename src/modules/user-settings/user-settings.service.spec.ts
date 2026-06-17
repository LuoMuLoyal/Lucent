import type { PrismaService } from '../../prisma/prisma.service';
import { UserSettingsService } from './user-settings.service';

describe('UserSettingsService', () => {
  it('returns defaults when the user has no stored settings', async () => {
    const prisma = {
      userSetting: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
      },
    } as unknown as PrismaService;

    const service = new UserSettingsService(prisma);

    await expect(service.getSettings('user-1')).resolves.toEqual({
      aiSummariesEnabled: true,
      dataSharingConsent: false,
      aiChatEnabled: true,
      aiChatContext: {
        healthProfile: true,
        dailyRecords: true,
        sleepRecords: true,
        currentMedicines: true,
      },
      updatedAt: null,
    });
  });

  it('merges stored ai-chat settings and nested context permissions', async () => {
    const prisma = {
      userSetting: {
        findMany: jest.fn().mockResolvedValue([
          {
            key: 'aiChatContext.sleepRecords',
            value: false,
            updatedAt: new Date('2026-06-17T10:00:00.000Z'),
          },
          {
            key: 'aiChatEnabled',
            value: false,
            updatedAt: new Date('2026-06-17T09:00:00.000Z'),
          },
          {
            key: 'dataSharingConsent',
            value: true,
            updatedAt: new Date('2026-06-16T08:00:00.000Z'),
          },
        ]),
        upsert: jest.fn(),
      },
    } as unknown as PrismaService;

    const service = new UserSettingsService(prisma);

    await expect(service.getSettings('user-1')).resolves.toEqual({
      aiSummariesEnabled: true,
      dataSharingConsent: true,
      aiChatEnabled: false,
      aiChatContext: {
        healthProfile: true,
        dailyRecords: true,
        sleepRecords: false,
        currentMedicines: true,
      },
      updatedAt: '2026-06-17T10:00:00.000Z',
    });
  });

  it('upserts ai-chat fields and nested context toggles', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      userSetting: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert,
      },
    } as unknown as PrismaService;

    const service = new UserSettingsService(prisma);

    await service.updateSettings('user-1', {
      aiChatEnabled: false,
      aiChatContext: {
        healthProfile: false,
        sleepRecords: false,
      },
    });

    expect(upsert).toHaveBeenCalledTimes(3);
    expect(upsert).toHaveBeenCalledWith({
      where: {
        userId_key: { userId: 'user-1', key: 'aiChatEnabled' },
      },
      create: {
        userId: 'user-1',
        key: 'aiChatEnabled',
        value: false,
      },
      update: {
        value: false,
      },
    });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        userId_key: { userId: 'user-1', key: 'aiChatContext.healthProfile' },
      },
      create: {
        userId: 'user-1',
        key: 'aiChatContext.healthProfile',
        value: false,
      },
      update: {
        value: false,
      },
    });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        userId_key: { userId: 'user-1', key: 'aiChatContext.sleepRecords' },
      },
      create: {
        userId: 'user-1',
        key: 'aiChatContext.sleepRecords',
        value: false,
      },
      update: {
        value: false,
      },
    });
  });
});
