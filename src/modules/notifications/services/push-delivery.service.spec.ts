import { PushDeliveryService } from './push-delivery.service';
import type { PrismaService } from '../../../prisma/prisma.service';

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    userDevice: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

describe('PushDeliveryService', () => {
  let service: PushDeliveryService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(() => {
    prisma = buildPrisma();
    service = new PushDeliveryService(prisma as unknown as PrismaService);
  });

  it('does nothing when user has no enabled devices', async () => {
    prisma.userDevice.findMany.mockResolvedValue([]);

    await service.sendToUser('user-1', {
      title: 'Test',
      body: 'Body',
    });

    expect(prisma.userDevice.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', notificationsEnabled: true },
      select: expect.objectContaining({
        pushToken: true,
        platform: true,
      }),
    });
  });

  it('queries devices with notificationsEnabled=true', async () => {
    prisma.userDevice.findMany.mockResolvedValue([
      { id: 'd1', pushToken: 'token-1', platform: 'ios' },
      { id: 'd2', pushToken: 'token-2', platform: 'android' },
    ]);

    await service.sendToUser('user-1', {
      title: 'Reminder',
      body: 'Take medicine',
      data: { reminderId: 'r1' },
    });

    expect(prisma.userDevice.findMany).toHaveBeenCalledTimes(1);
  });

  it('swallows database errors and does not throw', async () => {
    prisma.userDevice.findMany.mockRejectedValue(
      new Error('connection refused'),
    );

    await expect(
      service.sendToUser('user-1', { title: 'Test', body: 'Body' }),
    ).resolves.toBeUndefined();
  });
});
