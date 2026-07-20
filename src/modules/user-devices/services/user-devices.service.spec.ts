import { UserDevicesService } from './user-devices.service';
import type { PrismaService } from '../../../prisma/prisma.service';

const now = new Date('2026-07-20T12:00:00.000Z');

function buildDeviceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'device-1',
    userId: 'user-1',
    pushToken: 'token-abc',
    platform: 'ios',
    deviceName: 'iPhone 15',
    notificationsEnabled: true,
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildPrisma() {
  return {
    userDevice: {
      upsert: vi.fn().mockResolvedValue(buildDeviceRow()),
      findMany: vi.fn().mockResolvedValue([buildDeviceRow()]),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe('UserDevicesService', () => {
  let service: UserDevicesService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(() => {
    prisma = buildPrisma();
    service = new UserDevicesService(prisma as unknown as PrismaService);
  });

  describe('register', () => {
    it('upserts a device by pushToken and returns the DTO', async () => {
      const result = await service.register('user-1', {
        pushToken: 'token-abc',
        platform: 'ios',
        deviceName: 'iPhone 15',
        notificationsEnabled: true,
      });

      expect(prisma.userDevice.upsert).toHaveBeenCalledWith({
        where: { pushToken: 'token-abc' },
        create: expect.objectContaining({
          userId: 'user-1',
          pushToken: 'token-abc',
          platform: 'ios',
        }),
        update: expect.objectContaining({
          userId: 'user-1',
          platform: 'ios',
        }),
      });

      expect(result).toEqual(
        expect.objectContaining({
          id: 'device-1',
          platform: 'ios',
          deviceName: 'iPhone 15',
          notificationsEnabled: true,
        }),
      );
    });
  });

  describe('list', () => {
    it('returns devices for the user', async () => {
      const result = await service.list('user-1');

      expect(prisma.userDevice.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe('device-1');
    });
  });

  describe('remove', () => {
    it('deletes the device and returns true when found', async () => {
      const result = await service.remove('user-1', 'device-1');

      expect(prisma.userDevice.deleteMany).toHaveBeenCalledWith({
        where: { id: 'device-1', userId: 'user-1' },
      });
      expect(result).toBe(true);
    });

    it('returns false when device not found', async () => {
      prisma.userDevice.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.remove('user-1', 'nonexistent');
      expect(result).toBe(false);
    });
  });
});
