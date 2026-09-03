import { TodayAnalysisMaterializationStore } from './store.service.js';

describe('TodayAnalysisMaterializationStore', () => {
  let store: TodayAnalysisMaterializationStore;
  let prisma: {
    $transaction: vi.Mock;
    userTodayAnalysisMaterialization: {
      findUnique: vi.Mock;
      create: vi.Mock;
      update: vi.Mock;
      updateMany: vi.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      $transaction: vi.fn(),
      userTodayAnalysisMaterialization: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'analysis-mat-1',
          userId: 'user-1',
          localDate: new Date('2026-08-10T00:00:00.000Z'),
          sourceVersion: 1,
          computedVersion: 0,
          status: 'pending',
          reasonCodes: ['symptom_check_in'],
          generationCount: 0,
          activeVersion: null,
          activeAt: null,
          lastManualAt: null,
          lastErrorCode: null,
          queuedAt: null,
          computedAt: null,
          updatedAt: new Date('2026-08-10T08:00:00.000Z'),
        }),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) =>
        callback(prisma),
    );
    store = new TodayAnalysisMaterializationStore(prisma as never);
  });

  it('returns empty status when no materialization exists', async () => {
    await expect(
      store.readStatus('user-1', '2026-08-10'),
    ).resolves.toMatchObject({
      status: 'empty',
      sourceVersion: 0,
      computedVersion: 0,
    });
  });

  it('does not queue once the daily generation cap is reached', async () => {
    prisma.userTodayAnalysisMaterialization.findUnique.mockResolvedValue({
      sourceVersion: 3,
      computedVersion: 2,
      status: 'pending',
      generationCount: 3,
      activeVersion: null,
      reasonCodes: [],
    });

    const result = await store.markPending({
      userId: 'user-1',
      localDate: '2026-08-10',
      reasonCode: 'dose_log_changed',
      triggerKey: 'dose:dose-1',
    });

    expect(result.shouldQueue).toBe(false);
    expect(result.status).toBe('stale');
  });

  it('merges pending triggers without an active claim into one source version', async () => {
    const row = {
      id: 'analysis-mat-1',
      userId: 'user-1',
      localDate: new Date('2026-08-10T00:00:00.000Z'),
      sourceVersion: 4,
      computedVersion: 3,
      status: 'pending',
      reasonCodes: ['dose_log_changed'],
      generationCount: 0,
      activeVersion: null,
      activeAt: null,
      lastManualAt: null,
      lastTriggerKey: 'dose:dose-1',
      lastErrorCode: null,
      queuedAt: new Date('2026-08-10T08:00:00.000Z'),
      computedAt: null,
      updatedAt: new Date('2026-08-10T08:00:00.000Z'),
    };
    prisma.userTodayAnalysisMaterialization.findUnique.mockResolvedValue(row);
    prisma.userTodayAnalysisMaterialization.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(row, data);
        return row;
      },
    );

    const first = await store.markPending({
      userId: 'user-1',
      localDate: '2026-08-10',
      reasonCode: 'health_event_changed',
      triggerKey: 'health:event-1',
    });
    const second = await store.markPending({
      userId: 'user-1',
      localDate: '2026-08-10',
      reasonCode: 'dose_log_changed',
      triggerKey: 'dose:dose-2',
    });

    expect(first.sourceVersion).toBe(4);
    expect(second.sourceVersion).toBe(4);
    expect(first.shouldQueue).toBe(false);
    expect(second.shouldQueue).toBe(false);
    expect(row.reasonCodes).toEqual([
      'dose_log_changed',
      'health_event_changed',
    ]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('advances the source version when a pending active claim receives a trigger', async () => {
    const row = {
      id: 'analysis-mat-1',
      userId: 'user-1',
      localDate: new Date('2026-08-10T00:00:00.000Z'),
      sourceVersion: 4,
      computedVersion: 3,
      status: 'pending',
      reasonCodes: ['dose_log_changed'],
      generationCount: 1,
      activeVersion: 4,
      activeAt: new Date('2026-08-10T08:00:00.000Z'),
      lastManualAt: null,
      lastTriggerKey: 'dose:dose-1',
      lastErrorCode: null,
      queuedAt: new Date('2026-08-10T08:00:00.000Z'),
      computedAt: null,
      updatedAt: new Date('2026-08-10T08:00:00.000Z'),
    };
    prisma.userTodayAnalysisMaterialization.findUnique.mockResolvedValue(row);
    prisma.userTodayAnalysisMaterialization.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(row, data);
        return row;
      },
    );

    const result = await store.markPending({
      userId: 'user-1',
      localDate: '2026-08-10',
      reasonCode: 'health_event_changed',
      triggerKey: 'health:event-1',
    });

    expect(result.sourceVersion).toBe(5);
    expect(result.shouldQueue).toBe(true);
    expect(row.activeVersion).toBeNull();
    expect(row.activeAt).toBeNull();
  });

  it('reclaims an expired active claim before claiming without incrementing during reclaim', async () => {
    const expiredAt = new Date(Date.now() - 16 * 60 * 1000);
    prisma.userTodayAnalysisMaterialization.findUnique.mockResolvedValue({
      id: 'analysis-mat-1',
      userId: 'user-1',
      localDate: new Date('2026-08-10T00:00:00.000Z'),
      sourceVersion: 4,
      computedVersion: 3,
      status: 'pending',
      reasonCodes: [],
      generationCount: 1,
      activeVersion: 4,
      activeAt: expiredAt,
      lastManualAt: null,
      lastTriggerKey: null,
      lastErrorCode: null,
      queuedAt: null,
      computedAt: null,
      updatedAt: new Date(),
    });
    prisma.userTodayAnalysisMaterialization.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    await expect(
      store.claimGeneration('user-1', '2026-08-10', 4),
    ).resolves.toEqual({
      claimed: true,
      status: 'claimed',
      activeVersion: 5,
    });

    expect(
      prisma.userTodayAnalysisMaterialization.updateMany.mock.calls[0]?.[0],
    ).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          activeVersion: 4,
          activeAt: expect.objectContaining({ lte: expect.any(Date) }),
        }),
        data: { activeVersion: null, activeAt: null },
      }),
    );
    expect(
      prisma.userTodayAnalysisMaterialization.updateMany.mock.calls[1]?.[0],
    ).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          activeVersion: 5,
          generationCount: { increment: 1 },
        }),
      }),
    );
  });

  it('rotates the fence so stale worker completions cannot commit after reclaim', async () => {
    const expiredAt = new Date(Date.now() - 16 * 60 * 1000);
    const row = {
      id: 'analysis-mat-1',
      userId: 'user-1',
      localDate: new Date('2026-08-10T00:00:00.000Z'),
      sourceVersion: 4,
      computedVersion: 3,
      status: 'pending',
      reasonCodes: [],
      generationCount: 1,
      activeVersion: 4 as number | null,
      activeAt: expiredAt as Date | null,
      lastManualAt: null,
      lastTriggerKey: null,
      lastErrorCode: null,
      queuedAt: null,
      computedAt: null,
      updatedAt: new Date(),
    };
    prisma.userTodayAnalysisMaterialization.findUnique.mockResolvedValue(row);
    prisma.userTodayAnalysisMaterialization.updateMany.mockImplementation(
      ({
        where,
        data,
      }: {
        where: { activeVersion?: number; status?: string };
        data: {
          activeVersion?: number | null;
          activeAt?: Date | null;
          status?: string;
        };
      }) => {
        if (data.activeVersion === null && data.status == null) {
          row.activeVersion = null;
          row.activeAt = null;
          return { count: 1 };
        }
        if (data.activeVersion != null) {
          row.activeVersion = data.activeVersion;
          row.activeAt = data.activeAt ?? null;
          row.generationCount += 1;
          return { count: 1 };
        }
        return {
          count:
            where.activeVersion === row.activeVersion &&
            where.status === row.status
              ? 1
              : 0,
        };
      },
    );

    const claim = await store.claimGeneration('user-1', '2026-08-10', 4);

    expect(claim).toEqual({
      claimed: true,
      status: 'claimed',
      activeVersion: 5,
    });
    await expect(
      store.markReady({
        userId: 'user-1',
        localDate: '2026-08-10',
        sourceVersion: 4,
        activeVersion: 4,
      }),
    ).resolves.toBe(false);
    await expect(
      store.markFailed({
        userId: 'user-1',
        localDate: '2026-08-10',
        sourceVersion: 4,
        activeVersion: 4,
        errorCode: 'STALE_WORKER',
      }),
    ).resolves.toBe(false);
    await expect(
      store.markReady({
        userId: 'user-1',
        localDate: '2026-08-10',
        sourceVersion: 4,
        activeVersion: 5,
      }),
    ).resolves.toBe(true);
  });

  it('does not let an expired claim bypass the daily generation cap', async () => {
    prisma.userTodayAnalysisMaterialization.findUnique.mockResolvedValue({
      id: 'analysis-mat-1',
      userId: 'user-1',
      localDate: new Date('2026-08-10T00:00:00.000Z'),
      sourceVersion: 4,
      computedVersion: 3,
      status: 'pending',
      reasonCodes: [],
      generationCount: 3,
      activeVersion: 4,
      activeAt: new Date(Date.now() - 16 * 60 * 1000),
      lastManualAt: null,
      lastTriggerKey: null,
      lastErrorCode: null,
      queuedAt: null,
      computedAt: null,
      updatedAt: new Date(),
    });

    await expect(
      store.claimGeneration('user-1', '2026-08-10', 4),
    ).resolves.toEqual({ claimed: false, status: 'capped' });

    expect(
      prisma.userTodayAnalysisMaterialization.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sourceVersion: 4 }),
        data: { status: 'capped' },
      }),
    );
    expect(
      prisma.userTodayAnalysisMaterialization.updateMany,
    ).toHaveBeenCalledTimes(1);
  });

  it('fences commit to the exact source version and active claim', async () => {
    const result = await store.markReady({
      userId: 'user-1',
      localDate: '2026-08-10',
      sourceVersion: 4,
      activeVersion: 4,
    });

    expect(
      prisma.userTodayAnalysisMaterialization.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceVersion: 4,
          activeVersion: 4,
        }),
      }),
    );
    expect(result).toBe(true);
  });

  it('releases a claim using the explicit active generation fence', async () => {
    await store.releaseClaim('user-1', '2026-08-10', 4, 5);

    expect(
      prisma.userTodayAnalysisMaterialization.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceVersion: 4,
          activeVersion: 5,
        }),
      }),
    );
  });
});
