import { DeliveryReceiptsService } from './delivery-receipts.service';
import type { PrismaService } from '../../../prisma';
import type { MedicineRemindersOwnershipService } from './ownership.service';
import type { MedicineRemindersMapperService } from './mapper.service';
import type { Cache } from 'cache-manager';
import { errAsync, okAsync } from '../../../common/result';
import { createDomainFailure } from '../../../common/result';
import type { DomainFailure, ResultAsync } from '../../../common/result';
import type { ReminderDeliveryReceiptDto } from '../dto/reminder-delivery-receipt.dto';

/** Unwraps a ResultAsync, failing the test when it is an Err. */
async function unwrapOk<T>(result: ResultAsync<T, DomainFailure>): Promise<T> {
  const outcome = await result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
  if (!outcome.ok) {
    throw new Error(`Expected ok result, got ${outcome.error.code}`);
  }
  return outcome.value;
}

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
    ensureOwnedByUser: vi.fn().mockReturnValue(
      okAsync({
        userId: 'user-1',
        startDate: null,
        endDate: null,
      }),
    ),
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

    const item = await unwrapOk(service.recordLocalReceipt('user-1', dto));

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

    await unwrapOk(service.recordLocalReceipt('user-1', dto));

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

    const item = await unwrapOk(service.recordLocalReceipt('user-1', dto));

    expect(prisma.userReminderDelivery.createMany).not.toHaveBeenCalled();
    expect(item.id).toBe('delivery-1');
  });

  it('returns the same row without error when concurrent double-reports race on createMany', async () => {
    // 并发双报：两个请求都在 createMany 前读到 null；第二个 createMany 命中
    // 唯一约束去重（count: 0），行仍由兜底读取返回，不抛错、不重复写入。
    prisma.userReminderDelivery.findFirst
      .mockResolvedValueOnce(null) // 请求 A 首次查找
      .mockResolvedValueOnce(null) // 请求 B 首次查找
      .mockResolvedValueOnce(DELIVERY_ROW) // A 写后兜底读取
      .mockResolvedValueOnce(DELIVERY_ROW); // B 写后兜底读取
    prisma.userReminderDelivery.createMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const [first, second] = await Promise.all([
      unwrapOk(service.recordLocalReceipt('user-1', dto)),
      unwrapOk(service.recordLocalReceipt('user-1', dto)),
    ]);

    expect(prisma.userReminderDelivery.createMany).toHaveBeenCalledTimes(2);
    expect(first.id).toBe('delivery-1');
    expect(second.id).toBe('delivery-1');
  });

  it('propagates an ownership failure without any writes', async () => {
    ownership.ensureOwnedByUser.mockReturnValue(
      errAsync(
        createDomainFailure({
          kind: 'not_found',
          code: 'RESOURCE_NOT_FOUND',
        }),
      ),
    );

    const outcome = await service.recordLocalReceipt('user-1', dto).match(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );

    expect(outcome).toMatchObject({
      ok: false,
      error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
    });
    expect(prisma.userProfile.findUnique).not.toHaveBeenCalled();
    expect(prisma.userReminderDelivery.findFirst).not.toHaveBeenCalled();
    expect(prisma.userReminderDelivery.createMany).not.toHaveBeenCalled();
  });

  // ── reportLocalCapability ───────────────────────────────────────

  it('persists the capability state with the 14-day TTL and returns it', async () => {
    const outcome = await service
      .reportLocalCapability('user-1', 'active')
      .match(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error }),
      );

    expect(cache.set).toHaveBeenCalledWith(
      'reminder:local-capability:user-1',
      'active',
      1_209_600_000,
    );
    expect(outcome).toEqual({ ok: true, value: { state: 'active' } });
  });

  it('rethrows a cache write failure instead of reporting success', async () => {
    cache.set.mockRejectedValue(new Error('redis unavailable'));

    await expect(
      service.reportLocalCapability('user-1', 'active'),
    ).rejects.toThrow('redis unavailable');
  });
});
