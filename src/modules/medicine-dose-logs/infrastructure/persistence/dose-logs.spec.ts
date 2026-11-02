import { Prisma } from '#generated/prisma/client.js';

import type { DeepMocked } from '../../../../common/types/deep-mocked.js';
import { DomainFailureException } from '../../../../common/result/index.js';
import type { PrismaService } from '../../../../prisma/index.js';
import { PrismaDoseLogs } from './dose-logs.js';

/**
 * `PrismaDoseLogs` — the persistence adapter behind both the write-side
 * `DoseLogs` port and the cross-context `MedicineDoseLogReaderPort`.
 *
 * ## Why this spec exists (it replaces coverage that was lost in migration)
 *
 * The module's four-layer migration deleted `repositories/dose-log.repository.spec.ts`
 * (20 cases) and rewrote the service spec. The reader-port methods
 * (`listFactsInRange` / `countFactsInRange` / `findLatestScheduledForInRange`) and
 * the Prisma error mapping had **no adapter-level coverage left**, even though
 * three other contexts (`reports` dashboard, `reports` event-review,
 * `today-analysis`) depend on those reads. This spec restores it.
 *
 * ## Why mocks rather than a real database
 *
 * The unit suite (`pnpm test:ci`) runs in CI with a placeholder `DATABASE_URL` and
 * no Postgres service — every one of the ~250 `src/**` specs is mock-based, and a
 * real database is used only by the e2e suite under `test/`. A DB-backed spec here
 * would therefore pass locally and fail in CI. The SQL-level assertions below
 * (filters, ordering, cap) are checked by inspecting the arguments Prisma
 * receives, which is what a mock can verify faithfully.
 *
 * The one behaviour a mock cannot prove is that Postgres itself rejects a
 * duplicate slot — see the note on `create` below.
 */

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  const error = Object.create(
    Prisma.PrismaClientKnownRequestError.prototype,
  ) as Prisma.PrismaClientKnownRequestError;
  error.code = code;
  return error;
}

function doseLogRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dose-1',
    userId: 'user-1',
    healthEventId: null,
    currentMedicineId: null,
    reminderId: null,
    status: 'taken',
    scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
    scheduledTime: null,
    doseText: null,
    note: null,
    source: 'manual',
    takenAt: null,
    deletedAt: null,
    createdAt: new Date('2026-07-08T01:00:00.000Z'),
    updatedAt: new Date('2026-07-08T01:00:00.000Z'),
    ...overrides,
  };
}

describe('PrismaDoseLogs', () => {
  let repository: PrismaDoseLogs;
  let prisma: DeepMocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      userMedicineDoseLog: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      nonDeleted: {
        userMedicineReminder: {
          findFirst: vi.fn(),
        },
      },
      userCurrentMedicine: {
        findFirst: vi.fn(),
      },
    } as unknown as DeepMocked<PrismaService>;

    repository = new PrismaDoseLogs(prisma);
  });

  // ── Reader port (ADR-0009) ────────────────────────────────────────────────
  // Consumed by reports (dashboard + event-review) and today-analysis.

  describe('listFactsInRange (reader port)', () => {
    it('filters out soft-deleted rows and bounds the date range inclusively', async () => {
      prisma.userMedicineDoseLog.findMany.mockResolvedValue([] as never);
      const from = new Date('2026-07-01T00:00:00.000Z');
      const to = new Date('2026-07-31T00:00:00.000Z');

      await repository.listFactsInRange('user-1', from, to);

      expect(prisma.userMedicineDoseLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-1',
            deletedAt: null,
            scheduledFor: { gte: from, lte: to },
          },
        }),
      );
    });

    it('orders oldest-first and caps the result set', async () => {
      // Canonical order is part of the port contract: consumers build a
      // chronological timeline from this list.
      prisma.userMedicineDoseLog.findMany.mockResolvedValue([] as never);

      await repository.listFactsInRange(
        'user-1',
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-07-31T00:00:00.000Z'),
      );

      expect(prisma.userMedicineDoseLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ scheduledFor: 'asc' }],
          take: 500,
        }),
      );
    });

    it('selects only the five fact fields, never the whole row', async () => {
      // The narrow select is what keeps another context from reading columns it
      // does not own.
      prisma.userMedicineDoseLog.findMany.mockResolvedValue([] as never);

      await repository.listFactsInRange(
        'user-1',
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-07-31T00:00:00.000Z'),
      );

      const [args] = prisma.userMedicineDoseLog.findMany.mock.calls[0] as [
        { select: Record<string, boolean> },
      ];
      expect(Object.keys(args.select).sort()).toEqual([
        'currentMedicineId',
        'reminderId',
        'scheduledFor',
        'scheduledTime',
        'status',
      ]);
    });
  });

  describe('countFactsInRange (reader port)', () => {
    it('counts with the same filters as the list, so the two agree', async () => {
      prisma.userMedicineDoseLog.count.mockResolvedValue(3 as never);
      const from = new Date('2026-07-01T00:00:00.000Z');
      const to = new Date('2026-07-31T00:00:00.000Z');

      await expect(
        repository.countFactsInRange('user-1', from, to),
      ).resolves.toBe(3);
      expect(prisma.userMedicineDoseLog.count).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          deletedAt: null,
          scheduledFor: { gte: from, lte: to },
        },
      });
    });
  });

  describe('findLatestScheduledForInRange (reader port)', () => {
    it('takes the newest row in range', async () => {
      const latest = new Date('2026-07-30T00:00:00.000Z');
      prisma.userMedicineDoseLog.findFirst.mockResolvedValue({
        scheduledFor: latest,
      } as never);

      await expect(
        repository.findLatestScheduledForInRange(
          'user-1',
          new Date('2026-07-01T00:00:00.000Z'),
          new Date('2026-07-31T00:00:00.000Z'),
        ),
      ).resolves.toBe(latest);
      expect(prisma.userMedicineDoseLog.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ scheduledFor: 'desc' }],
          select: { scheduledFor: true },
        }),
      );
    });

    it('returns null when the range holds no rows', async () => {
      prisma.userMedicineDoseLog.findFirst.mockResolvedValue(null as never);

      await expect(
        repository.findLatestScheduledForInRange(
          'user-1',
          new Date('2026-07-01T00:00:00.000Z'),
          new Date('2026-07-31T00:00:00.000Z'),
        ),
      ).resolves.toBeNull();
    });
  });

  // ── Write side ────────────────────────────────────────────────────────────

  describe('listByDate', () => {
    it('pages the requested date and reports the unpaged total', async () => {
      prisma.userMedicineDoseLog.findMany.mockResolvedValue([
        doseLogRow(),
      ] as never);
      prisma.userMedicineDoseLog.count.mockResolvedValue(11 as never);

      const result = await repository.listByDate(
        'user-1',
        new Date('2026-07-08T00:00:00.000Z'),
        { page: 2, pageSize: 10 },
      );

      expect(result.total).toBe(11);
      expect(result.items).toHaveLength(1);
      expect(prisma.userMedicineDoseLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });

    it('orders by slot time then newest-first within the slot', async () => {
      prisma.userMedicineDoseLog.findMany.mockResolvedValue([] as never);
      prisma.userMedicineDoseLog.count.mockResolvedValue(0 as never);

      await repository.listByDate(
        'user-1',
        new Date('2026-07-08T00:00:00.000Z'),
        { page: 1, pageSize: 50 },
      );

      expect(prisma.userMedicineDoseLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ scheduledTime: 'asc' }, { createdAt: 'desc' }],
        }),
      );
    });
  });

  describe('findBySlot', () => {
    it('matches the slot identity and ignores soft-deleted rows', async () => {
      // A deleted row must never be resurrected by a later `mark`: deleting a
      // mistakenly-logged dose and re-marking the slot inserts a fresh row.
      prisma.userMedicineDoseLog.findFirst.mockResolvedValue(null as never);
      const scheduledFor = new Date('2026-07-08T00:00:00.000Z');

      await repository.findBySlot('user-1', {
        reminderId: 'reminder-1',
        scheduledFor,
        scheduledTime: '08:30',
      });

      expect(prisma.userMedicineDoseLog.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-1',
            reminderId: 'reminder-1',
            scheduledFor,
            scheduledTime: '08:30',
            deletedAt: null,
          },
        }),
      );
    });
  });

  describe('findOwned', () => {
    it('scopes the lookup by owner, so a foreign id is indistinguishable from a missing one', async () => {
      prisma.userMedicineDoseLog.findFirst.mockResolvedValue(null as never);

      await expect(
        repository.findOwned('user-1', 'dose-9'),
      ).resolves.toBeNull();
      expect(prisma.userMedicineDoseLog.findFirst).toHaveBeenCalledWith({
        where: { id: 'dose-9', userId: 'user-1', deletedAt: null },
        select: { userId: true, scheduledFor: true },
      });
    });
  });

  describe('create', () => {
    it('persists every supplied field and maps the row back', async () => {
      const row = doseLogRow({ scheduledTime: '08:30' });
      prisma.userMedicineDoseLog.create.mockResolvedValue(row as never);

      const record = await repository.create({
        userId: 'user-1',
        healthEventId: null,
        currentMedicineId: 'medicine-1',
        reminderId: 'reminder-1',
        status: 'taken',
        scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
        scheduledTime: '08:30',
        takenAt: new Date('2026-07-08T02:00:00.000Z'),
        doseText: null,
        note: null,
      });

      expect(record.id).toBe('dose-1');
      expect(prisma.userMedicineDoseLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          currentMedicineId: 'medicine-1',
          reminderId: 'reminder-1',
          scheduledTime: '08:30',
        }),
      });
    });

    it('maps a unique-constraint violation to RESOURCE_CONFLICT', async () => {
      // The controller documents 409 for a duplicate slot, so this mapping is
      // part of the public error contract: without it a concurrent insert would
      // surface as a 500 instead.
      //
      // NOTE: this asserts the *mapping*, not that Postgres rejects the duplicate.
      // `user_medicine_dose_logs` currently has no UNIQUE constraint covering the
      // slot (verified against both local databases), so in production P2002 can
      // only come from another constraint. The mapping is still required, and the
      // missing constraint is tracked separately.
      prisma.userMedicineDoseLog.create.mockRejectedValue(prismaError('P2002'));

      await expect(
        repository.create({
          userId: 'user-1',
          healthEventId: null,
          currentMedicineId: null,
          reminderId: 'reminder-1',
          status: 'taken',
          scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
          scheduledTime: '08:30',
          takenAt: null,
          doseText: null,
          note: null,
        }),
      ).rejects.toMatchObject({
        failure: { kind: 'conflict', code: 'RESOURCE_CONFLICT' },
      });
    });

    it('maps a missing required row (P2025) to RESOURCE_NOT_FOUND', async () => {
      prisma.userMedicineDoseLog.create.mockRejectedValue(prismaError('P2025'));

      await expect(
        repository.create({
          userId: 'user-1',
          healthEventId: null,
          currentMedicineId: null,
          reminderId: null,
          status: 'taken',
          scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
          scheduledTime: null,
          takenAt: null,
          doseText: null,
          note: null,
        }),
      ).rejects.toMatchObject({
        failure: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });

    it('rethrows unknown database errors instead of folding them into a domain failure', async () => {
      // A connection loss must reach the global filter as infrastructure, never
      // be rendered as a 4xx the client would treat as a business outcome.
      const original = new Error('connection lost');
      prisma.userMedicineDoseLog.create.mockRejectedValue(original);

      await expect(
        repository.create({
          userId: 'user-1',
          healthEventId: null,
          currentMedicineId: null,
          reminderId: null,
          status: 'taken',
          scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
          scheduledTime: null,
          takenAt: null,
          doseText: null,
          note: null,
        }),
      ).rejects.toBe(original);
    });
  });

  describe('update', () => {
    it('writes only the keys present in the patch', async () => {
      // `undefined` means "leave alone"; `null` is a real value. Collapsing the
      // two would clear columns the caller never mentioned.
      prisma.userMedicineDoseLog.update.mockResolvedValue(
        doseLogRow() as never,
      );

      await repository.update('dose-1', {
        status: 'skipped',
        takenAt: null,
      });

      expect(prisma.userMedicineDoseLog.update).toHaveBeenCalledWith({
        where: { id: 'dose-1' },
        data: { status: 'skipped', takenAt: null },
      });
    });

    it('keeps an explicit null, which clears the column', async () => {
      prisma.userMedicineDoseLog.update.mockResolvedValue(
        doseLogRow({ doseText: null }) as never,
      );

      await repository.update('dose-1', { doseText: null, note: null });

      expect(prisma.userMedicineDoseLog.update).toHaveBeenCalledWith({
        where: { id: 'dose-1' },
        data: { doseText: null, note: null },
      });
    });

    it('maps a missing row (P2025) to RESOURCE_NOT_FOUND', async () => {
      prisma.userMedicineDoseLog.update.mockRejectedValue(prismaError('P2025'));

      await expect(
        repository.update('missing', { note: 'x' }),
      ).rejects.toBeInstanceOf(DomainFailureException);
    });

    it('rethrows unknown database errors', async () => {
      const original = new Error('connection lost');
      prisma.userMedicineDoseLog.update.mockRejectedValue(original);

      await expect(repository.update('dose-1', { note: 'x' })).rejects.toBe(
        original,
      );
    });
  });

  describe('softDelete', () => {
    it('stamps deletedAt rather than removing the row', async () => {
      // History is preserved so a slot can be re-marked as a new row later.
      prisma.userMedicineDoseLog.update.mockResolvedValue(
        doseLogRow() as never,
      );
      const at = new Date('2026-07-09T00:00:00.000Z');

      await repository.softDelete('dose-1', at);

      expect(prisma.userMedicineDoseLog.update).toHaveBeenCalledWith({
        where: { id: 'dose-1' },
        data: { deletedAt: at },
      });
    });
  });

  describe('ownership probes', () => {
    it('looks the reminder up through the non-deleted view and returns its schedule', async () => {
      prisma.nonDeleted.userMedicineReminder.findFirst.mockResolvedValue({
        userId: 'user-1',
        currentMedicineId: 'medicine-1',
        scheduledHour: 8,
        scheduledMinute: 30,
      } as never);

      await expect(
        repository.findReminder('user-1', 'reminder-1'),
      ).resolves.toEqual({
        userId: 'user-1',
        currentMedicineId: 'medicine-1',
        scheduledHour: 8,
        scheduledMinute: 30,
      });
      expect(
        prisma.nonDeleted.userMedicineReminder.findFirst,
      ).toHaveBeenCalledWith({
        where: { id: 'reminder-1', userId: 'user-1' },
        select: {
          userId: true,
          currentMedicineId: true,
          scheduledHour: true,
          scheduledMinute: true,
        },
      });
    });

    it('scopes the current-medicine probe by owner', async () => {
      prisma.userCurrentMedicine.findFirst.mockResolvedValue(null as never);

      await expect(
        repository.findOwnedCurrentMedicine('user-1', 'medicine-9'),
      ).resolves.toBeNull();
      expect(prisma.userCurrentMedicine.findFirst).toHaveBeenCalledWith({
        where: { id: 'medicine-9', userId: 'user-1' },
        select: { userId: true },
      });
    });
  });
});
