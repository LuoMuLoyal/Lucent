import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { DeepMocked } from '../../../../common/types/deep-mocked';
import type { PrismaService } from '../../../../prisma';
import { ShareService } from './share.service';

/**
 * Persisted-share store fake. Mirrors the generated `userClinicSummaryShare`
 * delegate's `findFirst` where semantics (tokenHash + revokedAt: null +
 * expiresAt > now) so tests exercise real filter behavior, not just mock
 * plumbing.
 */
interface ShareRow {
  id: string;
  userId: string;
  tokenHash: string;
  eventId: string | null;
  dateFrom: Date | null;
  dateTo: Date | null;
  selectedFields: string[];
  expiresAt: Date;
  revokedAt: Date | null;
  firstAccessedAt: Date | null;
  lastAccessedAt: Date | null;
  accessCount: number;
  createdAt: Date;
}

function makeShareStore(rows: ShareRow[]): {
  findFirst: vi.Mock;
  create: vi.Mock;
  update: vi.Mock;
  updateMany: vi.Mock;
} {
  return {
    findFirst: vi.fn(
      (args: {
        where: { tokenHash: string; revokedAt: null; expiresAt: { gt: Date } };
      }) => {
        const row = rows.find((r) => r.tokenHash === args.where.tokenHash);
        if (!row) return Promise.resolve(null);
        if (row.revokedAt !== null) return Promise.resolve(null);
        if (row.expiresAt.getTime() <= args.where.expiresAt.gt.getTime()) {
          return Promise.resolve(null);
        }
        return Promise.resolve(row);
      },
    ),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const validShareInput = {
  eventId: 'evt-1',
  selectedFields: ['event_overview', 'sleep', 'notes'],
};

describe('ShareService', () => {
  let service: ShareService;
  let prisma: DeepMocked<PrismaService>;
  let shareStore: ReturnType<typeof makeShareStore>;

  beforeEach(() => {
    shareStore = makeShareStore([]);
    prisma = {
      userClinicSummaryShare: shareStore,
    } as unknown as DeepMocked<PrismaService>;
    service = new ShareService(prisma);
  });

  describe('createShare', () => {
    it('returns the plaintext token exactly once and stores only its sha256 hash', async () => {
      shareStore.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: 'share-1',
            userId: 'user-1',
            createdAt: new Date(),
            revokedAt: null,
            firstAccessedAt: null,
            lastAccessedAt: null,
            accessCount: 0,
            ...data,
          }),
      );

      const result = await service.createShare('user-1', validShareInput);

      expect(result.token).toBeDefined();
      expect(result.token).toHaveLength(43); // base64url of 32 random bytes
      expect(shareStore.create).toHaveBeenCalledTimes(1);
      const stored = (
        shareStore.create.mock.calls[0]![0] as {
          data: { tokenHash: string };
        }
      ).data;
      expect(stored.tokenHash).toBe(sha256(result.token));
      expect(stored.tokenHash).not.toBe(result.token);
    });

    it('sets expiresAt from the default TTL and persists the scope', async () => {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      shareStore.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: 'share-1',
            userId: 'user-1',
            createdAt: new Date(),
            revokedAt: null,
            firstAccessedAt: null,
            lastAccessedAt: null,
            accessCount: 0,
            ...data,
          }),
      );

      await service.createShare('user-1', validShareInput);

      const stored = (
        shareStore.create.mock.calls[0]![0] as {
          data: {
            expiresAt: Date;
            eventId: string | null;
            dateFrom: Date | null;
            dateTo: Date | null;
          };
        }
      ).data;
      expect(
        Math.abs(stored.expiresAt.getTime() - expiresAt.getTime()),
      ).toBeLessThan(5000);
      expect(stored.eventId).toBe('evt-1');
      expect(stored.dateFrom).toBeNull();
      expect(stored.dateTo).toBeNull();
    });

    it('persists a date range scope when no eventId is given', async () => {
      shareStore.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: 'share-1',
            userId: 'user-1',
            createdAt: new Date(),
            revokedAt: null,
            firstAccessedAt: null,
            lastAccessedAt: null,
            accessCount: 0,
            ...data,
          }),
      );

      await service.createShare('user-1', {
        dateFrom: '2026-08-01',
        dateTo: '2026-08-07',
        selectedFields: ['water'],
      });

      const stored = (
        shareStore.create.mock.calls[0]![0] as {
          data: { eventId: string | null; dateFrom: Date; dateTo: Date };
        }
      ).data;
      expect(stored.eventId).toBeNull();
      expect(stored.dateFrom).toBeInstanceOf(Date);
      expect(stored.dateTo).toBeInstanceOf(Date);
    });

    it('rejects an empty selectedFields selection', async () => {
      await expect(
        service.createShare('user-1', {
          ...validShareInput,
          selectedFields: [],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(shareStore.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown selectedFields value', async () => {
      await expect(
        service.createShare('user-1', {
          ...validShareInput,
          selectedFields: ['event_overview', 'doctor_notes'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(shareStore.create).not.toHaveBeenCalled();
    });

    it('rejects a scope with both eventId and a date range', async () => {
      await expect(
        service.createShare('user-1', {
          eventId: 'evt-1',
          dateFrom: '2026-08-01',
          dateTo: '2026-08-07',
          selectedFields: ['water'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a scope with neither eventId nor a full date range', async () => {
      await expect(
        service.createShare('user-1', {
          selectedFields: ['water'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.createShare('user-1', {
          dateFrom: '2026-08-01',
          selectedFields: ['water'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.createShare('user-1', {
          dateTo: '2026-08-07',
          selectedFields: ['water'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getSharedSummaryByToken', () => {
    const makeValidRow = (overrides: Partial<ShareRow> = {}): ShareRow => ({
      id: 'share-1',
      userId: 'user-1',
      tokenHash: sha256('valid-token'),
      eventId: 'evt-1',
      dateFrom: null,
      dateTo: null,
      selectedFields: ['event_overview'],
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      revokedAt: null,
      firstAccessedAt: null,
      lastAccessedAt: null,
      accessCount: 0,
      createdAt: new Date(),
      ...overrides,
    });

    it('looks up by the sha256 token hash', async () => {
      shareStore.findFirst = makeShareStore([makeValidRow()])
        .findFirst as vi.Mock;

      await service.getSharedSummaryByToken('valid-token');

      expect(shareStore.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tokenHash: sha256('valid-token'),
            revokedAt: null,
            expiresAt: { gt: expect.any(Date) },
          }),
        }),
      );
    });

    it('returns null for an unknown token', async () => {
      const result = await service.getSharedSummaryByToken('missing-token');
      expect(result).toBeNull();
      expect(shareStore.update).not.toHaveBeenCalled();
    });

    it('returns null for an expired share', async () => {
      const store = makeShareStore([
        makeValidRow({
          tokenHash: sha256('expired-token'),
          expiresAt: new Date(Date.now() - 1000),
        }),
      ]);
      prisma = {
        userClinicSummaryShare: store,
      } as unknown as DeepMocked<PrismaService>;
      service = new ShareService(prisma);

      const result = await service.getSharedSummaryByToken('expired-token');
      expect(result).toBeNull();
    });

    it('returns null for a revoked share even when another non-revoked copy exists', async () => {
      const store = makeShareStore([
        makeValidRow({
          tokenHash: sha256('revoked-token'),
          revokedAt: new Date('2026-08-12T00:00:00.000Z'),
        }),
        makeValidRow({
          id: 'share-dup',
          tokenHash: sha256('revoked-token'),
        }),
      ]);
      prisma = {
        userClinicSummaryShare: store,
      } as unknown as DeepMocked<PrismaService>;
      service = new ShareService(prisma);

      const result = await service.getSharedSummaryByToken('revoked-token');
      expect(result).toBeNull();
    });

    it('atomically records the first access in one prisma update call', async () => {
      const store = makeShareStore([makeValidRow()]);
      store.update.mockResolvedValue({});
      prisma = {
        userClinicSummaryShare: store,
      } as unknown as DeepMocked<PrismaService>;
      service = new ShareService(prisma);

      const result = await service.getSharedSummaryByToken('valid-token');

      expect(result).not.toBeNull();
      expect(store.update).toHaveBeenCalledTimes(1);
      expect(store.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'share-1' },
          data: expect.objectContaining({
            accessCount: { increment: 1 },
            firstAccessedAt: expect.any(Date),
            lastAccessedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('only refreshes lastAccessedAt on subsequent opens', async () => {
      const already = new Date('2026-08-13T10:00:00.000Z');
      const store = makeShareStore([
        makeValidRow({ firstAccessedAt: already, accessCount: 3 }),
      ]);
      store.update.mockResolvedValue({});
      prisma = {
        userClinicSummaryShare: store,
      } as unknown as DeepMocked<PrismaService>;
      service = new ShareService(prisma);

      await service.getSharedSummaryByToken('valid-token');

      expect(store.update).toHaveBeenCalledTimes(1);
      const data = (
        store.update.mock.calls[0]![0] as { data: Record<string, unknown> }
      ).data;
      expect(data['accessCount']).toEqual({ increment: 1 });
      expect(data['firstAccessedAt']).toBeUndefined();
      expect(data['lastAccessedAt']).toEqual(expect.any(Date));
    });
  });

  describe('revokeShare', () => {
    it('revokes when the caller owns the share', async () => {
      shareStore.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.revokeShare('user-1', 'share-1');

      expect(result).toBe(true);
      expect(shareStore.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'share-1', userId: 'user-1' },
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });

    it('does not revoke a share owned by another user', async () => {
      shareStore.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.revokeShare('other-user', 'share-1');

      expect(result).toBe(false);
      const where = (
        shareStore.updateMany.mock.calls[0]![0] as {
          where: { id: string; userId: string };
        }
      ).where;
      expect(where).toEqual({ id: 'share-1', userId: 'other-user' });
    });

    it('returns false for an unknown shareId', async () => {
      shareStore.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.revokeShare('user-1', 'no-such-share');

      expect(result).toBe(false);
    });
  });
});
