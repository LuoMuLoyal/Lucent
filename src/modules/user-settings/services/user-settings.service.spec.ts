import type { PrismaService } from '../../../prisma';
import { Prisma } from '#generated/prisma/client';
import { UserSettingsService } from './user-settings.service';
import type { DomainFailure, ResultAsync } from '../../../common/result';

function createMockCache() {
  return {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
  } as never;
}

function createPrisma(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  } as unknown as PrismaService;
}

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

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  const error = Object.create(
    Prisma.PrismaClientKnownRequestError.prototype,
  ) as Prisma.PrismaClientKnownRequestError;
  error.code = code;
  return error;
}

describe('UserSettingsService', () => {
  it('returns defaults when the user has no stored settings', async () => {
    const service = new UserSettingsService(createPrisma(), createMockCache(), {
      emitAsync: vi.fn().mockResolvedValue(undefined),
    } as never);

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
    const prisma = createPrisma({
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
    });

    const service = new UserSettingsService(prisma, createMockCache(), {
      emitAsync: vi.fn().mockResolvedValue(undefined),
    } as never);

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
    const prisma = createPrisma({
      userSetting: { findMany: vi.fn().mockResolvedValue([]), upsert },
    });

    const service = new UserSettingsService(prisma, createMockCache(), {
      emitAsync: vi.fn().mockResolvedValue(undefined),
    } as never);

    await unwrapOk(
      service.updateSettings('user-1', {
        assistantEnabled: false,
        assistantMemoryEnabled: true,
        assistantContext: {
          healthProfile: false,
          sleepRecords: false,
        },
      }),
    );

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
    const prisma = createPrisma({
      userSetting: { findMany: vi.fn().mockResolvedValue([]), upsert },
    });

    const service = new UserSettingsService(prisma, createMockCache(), {
      emitAsync: vi.fn().mockResolvedValue(undefined),
    } as never);

    await unwrapOk(service.updateSettings('user-1', {}));

    expect(upsert).not.toHaveBeenCalled();
  });

  it('upserts waterTargetCount as a setting key', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const prisma = createPrisma({
      userSetting: { findMany: vi.fn().mockResolvedValue([]), upsert },
    });

    const service = new UserSettingsService(prisma, createMockCache(), {
      emitAsync: vi.fn().mockResolvedValue(undefined),
    } as never);

    await unwrapOk(service.updateSettings('user-1', { waterTargetCount: 12 }));

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

  it('maps a unique constraint violation on upsert to RESOURCE_CONFLICT', async () => {
    const upsert = vi.fn().mockRejectedValue(prismaError('P2002'));
    const prisma = createPrisma({
      userSetting: { findMany: vi.fn().mockResolvedValue([]), upsert },
    });

    const service = new UserSettingsService(prisma, createMockCache(), {
      emitAsync: vi.fn().mockResolvedValue(undefined),
    } as never);

    const outcome = await service
      .updateSettings('user-1', { assistantEnabled: false })
      .match(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error }),
      );

    expect(outcome).toMatchObject({
      ok: false,
      error: { kind: 'conflict', code: 'RESOURCE_CONFLICT' },
    });
  });

  it('rethrows unknown database errors on update', async () => {
    const upsert = vi.fn().mockRejectedValue(new Error('connection lost'));
    const prisma = createPrisma({
      userSetting: { findMany: vi.fn().mockResolvedValue([]), upsert },
    });

    const service = new UserSettingsService(prisma, createMockCache(), {
      emitAsync: vi.fn().mockResolvedValue(undefined),
    } as never);

    await expect(
      service.updateSettings('user-1', { assistantEnabled: false }),
    ).rejects.toThrow('connection lost');
  });
});
