import { DeliveryReceiptsService } from './delivery-receipts.service';
import type { PrismaService } from '../../../prisma';
import type { MedicineRemindersOwnershipService } from './ownership.service';
import type { MedicineRemindersMapperService } from './mapper.service';
import type { Cache } from 'cache-manager';
import type { ReminderDeliveryReceiptDto } from '../dto/reminder-delivery-receipt.dto';

function buildPrisma() {
  return {
    userReminderDelivery: {
      findFirst: vi.fn().mockResolvedValue(null),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    userProfile: {
      findUnique: vi.fn().mockResolvedValue({ timezone: null }),
    },
  };
}

function buildOwnership() {
  return {
    ensureOwnedByUser: vi.fn().mockResolvedValue({
      userId: 'user-1',
      startDate: null,
      endDate: null,
    }),
  };
}

function buildMapper() {
  return {
    toDeliveryItem: vi.fn((row: Record<string, unknown>) => ({
      id: row['id'],
      reminderId: row['reminderId'],
      deviceId: row['deviceId'],
      channel: row['channel'],
      status: row['status'],
      scheduledFor: (row['scheduledFor'] as Date).toISOString(),
      deliveredAt: row['deliveredAt']
        ? (row['deliveredAt'] as Date).toISOString()
        : null,
      errorMessage: row['errorMessage'],
      createdAt: (row['createdAt'] as Date).toISOString(),
    })),
  };
}

function buildCache() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn((key: string) => Promise.resolve(store.get(key))),
    set: vi.fn((key: string, value: string, _ttl?: number) => {
      store.set(key, value);
      return Promise.resolve(value);
    }),
    del: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
}

const DELIVERY_ROW = {
  id: 'delivery-1',
  reminderId: 'reminder-1',
  deviceId: null,
  channel: 'local',
  status: 'delivered',
  scheduledFor: new Date('2026-07-20T00:30:00.000Z'),
  deliveredAt: new Date('2026-07-20T00:30:05.000Z'),
  errorMessage: null,
  createdAt: new Date('2026-07-20T00:30:05.000Z'),
};

describe('DeliveryReceiptsService', () => {
  let service: DeliveryReceiptsService;
  let prisma: ReturnType<typeof buildPrisma>;
  let ownership: ReturnType<typeof buildOwnership>;
  let mapper: ReturnType<typeof buildMapper>;
  let cache: ReturnType<typeof buildCache>;

  const dto: ReminderDeliveryReceiptDto = {
    reminderId: 'reminder-1',
    scheduledDate: '2026-07-20',
    scheduledTime: '08:30',
  };

  beforeEach(() => {
    prisma = buildPrisma();
    ownership = buildOwnership();
    mapper = buildMapper();
    cache = buildCache();

    service = new DeliveryReceiptsService(
      prisma as unknown as PrismaService,
      ownership as unknown as MedicineRemindersOwnershipService,
      mapper as unknown as MedicineRemindersMapperService,
      cache as unknown as Cache,
    );
  });

  // ── recordLocalReceipt ──────────────────────────────────────────

  it('writes a local delivered row using the default timezone when profile tz is null', async () => {
    prisma.userProfile.findUnique.mockResolvedValue({ timezone: null });
    prisma.userReminderDelivery.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(DELIVERY_ROW);

    const item = await service.recordLocalReceipt('user-1', dto);

    expect(ownership.ensureOwnedByUser).toHaveBeenCalledWith(
      'user-1',
      'reminder-1',
    );
    expect(prisma.userReminderDelivery.createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        reminderId: 'reminder-1',
        channel: 'local',
        status: 'delivered',
        // Asia/Shanghai 08:30 → UTC 00:30（截断到分钟）
        scheduledFor: new Date('2026-07-20T00:30:00.000Z'),
        deliveredAt: expect.any(Date),
      }),
      skipDuplicates: true,
    });
    expect(item.id).toBe('delivery-1');
    expect(item.channel).toBe('local');
    expect(item.status).toBe('delivered');
  });

  it('converts wall clock to UTC using the profile timezone', async () => {
    prisma.userProfile.findUnique.mockResolvedValue({
      timezone: 'America/New_York',
    });
    prisma.userReminderDelivery.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(DELIVERY_ROW);

    await service.recordLocalReceipt('user-1', dto);

    expect(prisma.userReminderDelivery.createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        // America/New_York（7月 UTC-4）08:30 → UTC 12:30
        scheduledFor: new Date('2026-07-20T12:30:00.000Z'),
      }),
      skipDuplicates: true,
    });
  });

  it('returns the existing local row without writing on duplicate receipt', async () => {
    prisma.userReminderDelivery.findFirst.mockResolvedValue(DELIVERY_ROW);

    const item = await service.recordLocalReceipt('user-1', dto);

    expect(prisma.userReminderDelivery.createMany).not.toHaveBeenCalled();
    expect(item.id).toBe('delivery-1');
  });

  it('propagates ownership failure without any writes', async () => {
    ownership.ensureOwnedByUser.mockRejectedValue(new Error('not found'));

    await expect(service.recordLocalReceipt('user-1', dto)).rejects.toThrow(
      'not found',
    );

    expect(prisma.userProfile.findUnique).not.toHaveBeenCalled();
    expect(prisma.userReminderDelivery.findFirst).not.toHaveBeenCalled();
    expect(prisma.userReminderDelivery.createMany).not.toHaveBeenCalled();
  });

  // ── reportLocalCapability ───────────────────────────────────────

  it('persists the capability state with the 14-day TTL and returns it', async () => {
    const result = await service.reportLocalCapability('user-1', 'active');

    expect(cache.set).toHaveBeenCalledWith(
      'reminder:local-capability:user-1',
      'active',
      1_209_600_000,
    );
    expect(result).toEqual({ state: 'active' });
  });
});
