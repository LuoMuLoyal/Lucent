import { MaterializationStore } from './store.service.js';
import type {
  MaterializationRow,
  MaterializationStatus,
} from '../../types/materialization.types.js';

function row(overrides: Partial<MaterializationRow> = {}): MaterializationRow {
  return {
    id: 'materialization-1',
    userId: 'user-1',
    localDate: new Date('2026-08-09T00:00:00.000Z'),
    sourceVersion: 1,
    computedVersion: 0,
    status: 'pending',
    reasonCodes: ['daily_record_changed'],
    lastErrorCode: null,
    queuedAt: new Date('2026-08-09T08:00:00.000Z'),
    computedAt: null,
    updatedAt: new Date('2026-08-09T08:00:00.000Z'),
    ...overrides,
  };
}

describe('MaterializationStore', () => {
  let store: MaterializationStore;
  let prisma: {
    userSuggestionMaterialization: {
      findUnique: vi.Mock;
      create: vi.Mock;
      update: vi.Mock;
      updateMany: vi.Mock;
    };
  };
  let metrics: {
    recordSuggestionMaterializationReady: vi.Mock;
    recordSuggestionMaterializationFailed: vi.Mock;
    recordSuggestionStaleAge: vi.Mock;
  };

  beforeEach(() => {
    prisma = {
      userSuggestionMaterialization: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(row()),
        update: vi.fn().mockResolvedValue(row()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    metrics = {
      recordSuggestionMaterializationReady: vi.fn(),
      recordSuggestionMaterializationFailed: vi.fn(),
      recordSuggestionStaleAge: vi.fn(),
    };
    store = new MaterializationStore(
      prisma as never,
      undefined,
      metrics as never,
    );
  });

  it('returns empty when no materialization exists', async () => {
    await expect(
      store.readStatus('user-1', '2026-08-09'),
    ).resolves.toMatchObject({
      status: 'empty' satisfies MaterializationStatus,
      sourceVersion: 0,
      computedVersion: 0,
    });
  });

  it.each([
    ['pending', row({ status: 'pending', sourceVersion: 2 })],
    ['ready', row({ status: 'ready', sourceVersion: 2, computedVersion: 2 })],
    ['failed', row({ status: 'failed', sourceVersion: 2, computedVersion: 1 })],
    ['stale', row({ status: 'ready', sourceVersion: 3, computedVersion: 2 })],
  ] as const)(
    'maps persisted %s to its public materialization status',
    async (expected, persisted) => {
      prisma.userSuggestionMaterialization.findUnique.mockResolvedValue(
        persisted,
      );

      await expect(
        store.readStatus('user-1', '2026-08-09'),
      ).resolves.toMatchObject({
        status: expected satisfies MaterializationStatus,
        sourceVersion: persisted.sourceVersion,
        computedVersion: persisted.computedVersion,
      });
    },
  );

  it('creates pending state without accepting raw suggestion content', async () => {
    await store.markPending({
      userId: 'user-1',
      localDate: '2026-08-09',
      sourceVersion: 4,
      reasonCodes: ['health_event_changed'],
    });

    expect(prisma.userSuggestionMaterialization.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          sourceVersion: 4,
          status: 'pending',
          reasonCodes: ['health_event_changed'],
        }),
      }),
    );
    expect(
      prisma.userSuggestionMaterialization.create.mock.calls[0]?.[0]?.data,
    ).not.toHaveProperty('payload');
  });

  it('does not let an older pending version overwrite a newer source version', async () => {
    const current = row({ sourceVersion: 5, status: 'pending' });
    prisma.userSuggestionMaterialization.findUnique.mockResolvedValue(current);

    await store.markPending({
      userId: 'user-1',
      localDate: '2026-08-09',
      sourceVersion: 4,
      reasonCodes: ['daily_record_changed'],
    });

    expect(prisma.userSuggestionMaterialization.update).not.toHaveBeenCalled();
    expect(
      prisma.userSuggestionMaterialization.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('does not mark a newer pending version ready when an older job completes', async () => {
    const current = row({ sourceVersion: 3, status: 'pending' });
    prisma.userSuggestionMaterialization.findUnique.mockResolvedValue(current);
    prisma.userSuggestionMaterialization.updateMany.mockResolvedValue({
      count: 0,
    });

    const result = await store.markReady({
      userId: 'user-1',
      localDate: '2026-08-09',
      sourceVersion: 2,
    });

    expect(
      prisma.userSuggestionMaterialization.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sourceVersion: 2 }),
      }),
    );
    expect(result.status).toBe('pending');
  });

  it('does not mark a ready materialization failed', async () => {
    const current = row({
      status: 'ready',
      sourceVersion: 3,
      computedVersion: 3,
    });
    prisma.userSuggestionMaterialization.findUnique.mockResolvedValue(current);

    await store.markFailed({
      userId: 'user-1',
      localDate: '2026-08-09',
      sourceVersion: 3,
      errorCode: 'RECOMPUTE_FAILED',
    });

    expect(
      prisma.userSuggestionMaterialization.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceVersion: 3,
          status: 'pending',
        }),
      }),
    );
  });

  it('advances computedVersion for a baseline observation failure so generated cards remain readable', async () => {
    const current = row({ sourceVersion: 4, computedVersion: 0 });
    prisma.userSuggestionMaterialization.findUnique.mockResolvedValue(current);

    await store.markFailed({
      userId: 'user-1',
      localDate: '2026-08-09',
      sourceVersion: 4,
      computedVersion: 4,
      errorCode: 'BASELINE_OBSERVATION_FAILED',
    });

    expect(
      prisma.userSuggestionMaterialization.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          computedVersion: 4,
          status: 'failed',
          lastErrorCode: 'BASELINE_OBSERVATION_FAILED',
        }),
      }),
    );
  });

  it('records ready, failed, and stale-age observations', async () => {
    prisma.userSuggestionMaterialization.findUnique
      .mockResolvedValueOnce(row({ status: 'pending' }))
      .mockResolvedValueOnce(
        row({
          status: 'ready',
          sourceVersion: 3,
          computedVersion: 2,
          computedAt: new Date(Date.now() - 5_000),
        }),
      );

    await store.markReady({
      userId: 'user-1',
      localDate: '2026-08-09',
      sourceVersion: 1,
    });
    await store.markFailed({
      userId: 'user-1',
      localDate: '2026-08-09',
      sourceVersion: 1,
      errorCode: 'RECOMPUTE_FAILED',
    });
    await store.readStatus('user-1', '2026-08-09');

    expect(metrics.recordSuggestionMaterializationReady).toHaveBeenCalledTimes(
      1,
    );
    expect(metrics.recordSuggestionMaterializationFailed).toHaveBeenCalledTimes(
      1,
    );
    expect(metrics.recordSuggestionStaleAge).toHaveBeenCalledWith(
      expect.any(Number),
    );
  });
});
