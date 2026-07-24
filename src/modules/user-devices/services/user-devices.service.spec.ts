import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { I18nService } from 'nestjs-i18n';
import { UserDevicesService } from './user-devices.service';
import type { PrismaService } from '../../../prisma';
import { DevicePlatform } from '../dto/register-device.dto';

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
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(buildDeviceRow()),
      update: vi.fn().mockResolvedValue(buildDeviceRow()),
      delete: vi.fn().mockResolvedValue(buildDeviceRow()),
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
    const i18nMock = {
      t: vi.fn((key: string) => key),
    } as unknown as I18nService;
    service = new UserDevicesService(
      prisma as unknown as PrismaService,
      i18nMock,
    );
  });

  describe('register', () => {
    it('creates a new device when pushToken does not exist', async () => {
      prisma.userDevice.findUnique.mockResolvedValue(null);

      const result = await service.register('user-1', {
        pushToken: 'token-abc',
        platform: DevicePlatform.ios,
        deviceName: 'iPhone 15',
        notificationsEnabled: true,
      });

      expect(prisma.userDevice.findUnique).toHaveBeenCalledWith({
        where: { pushToken: 'token-abc' },
        select: { id: true, userId: true },
      });
      expect(prisma.userDevice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          pushToken: 'token-abc',
          platform: 'ios',
        }),
      });
      expect(prisma.userDevice.update).not.toHaveBeenCalled();

      expect(result).toEqual(
        expect.objectContaining({
          id: 'device-1',
          platform: 'ios',
          deviceName: 'iPhone 15',
          notificationsEnabled: true,
        }),
      );
    });

    it('updates metadata when the same user re-registers the same token', async () => {
      prisma.userDevice.findUnique.mockResolvedValue({
        id: 'device-1',
        userId: 'user-1',
      });

      const result = await service.register('user-1', {
        pushToken: 'token-abc',
        platform: DevicePlatform.android,
        deviceName: 'Pixel 8',
        notificationsEnabled: true,
      });

      expect(prisma.userDevice.update).toHaveBeenCalledWith({
        where: { id: 'device-1' },
        data: expect.objectContaining({
          platform: 'android',
          deviceName: 'Pixel 8',
        }),
      });
      // userId must NOT be in the update data
      const updateCall = (prisma.userDevice.update as ReturnType<typeof vi.fn>)
        .mock.calls[0]![0];
      expect(updateCall.data).not.toHaveProperty('userId');
      expect(prisma.userDevice.create).not.toHaveBeenCalled();

      expect(result).toEqual(
        expect.objectContaining({ id: 'device-1', platform: 'ios' }),
      );
    });

    it('throws ForbiddenException when pushToken belongs to another user', async () => {
      prisma.userDevice.findUnique.mockResolvedValue({
        id: 'device-1',
        userId: 'user-other',
      });

      await expect(
        service.register('user-1', {
          pushToken: 'token-abc',
          platform: DevicePlatform.ios,
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.userDevice.create).not.toHaveBeenCalled();
      expect(prisma.userDevice.update).not.toHaveBeenCalled();
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
    it('deletes the device when it belongs to the user', async () => {
      prisma.userDevice.findUnique.mockResolvedValue({
        userId: 'user-1',
      });

      await service.remove('user-1', 'device-1');

      expect(prisma.userDevice.findUnique).toHaveBeenCalledWith({
        where: { id: 'device-1' },
        select: { userId: true },
      });
      expect(prisma.userDevice.delete).toHaveBeenCalledWith({
        where: { id: 'device-1' },
      });
    });

    it('throws NotFoundException when device does not exist', async () => {
      prisma.userDevice.findUnique.mockResolvedValue(null);

      await expect(service.remove('user-1', 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.userDevice.delete).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when device belongs to another user', async () => {
      prisma.userDevice.findUnique.mockResolvedValue({
        userId: 'user-other',
      });

      await expect(service.remove('user-1', 'device-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.userDevice.delete).not.toHaveBeenCalled();
    });
  });
});
