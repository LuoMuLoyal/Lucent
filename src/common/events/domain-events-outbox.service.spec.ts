import type { DomainEventFanOutService } from './domain-events-fanout.service.js';
import { Prisma } from '#generated/prisma/client.js';
import {
  DomainEventOutboxService,
  OUTBOX_BATCH_SIZE,
} from './domain-events-outbox.service.js';
import type { PrismaService } from '../../prisma/index.js';
import {
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_POLL_INTERVAL_MS,
} from './outbox-tunings.js';

/** Synthetic row shape returned by the claim query. */
function makeRow(overrides: Record<string, unknown>) {
  return {
    id: 'evt-1',
    event_name: 'user_registered',
    payload_version: 1,
    payload: { userId: 'u1' },
    occurred_at: new Date('2026-10-21T00:00:00Z'),
    attempts: 0,
    dispatched_at: null,
    ...overrides,
  };
}

/** Prisma P2002 shaped the way the client raises it. */
function uniqueViolation(target: string): Error {
  const error = new Error(`Unique constraint failed on ${target}`);
  Object.assign(error, {
    code: 'P2002',
    name: 'PrismaClientKnownRequestError',
  });
  Object.setPrototypeOf(error, Prisma.PrismaClientKnownRequestError.prototype);
  return error;
}

describe('DomainEventOutboxService', () => {
  let prisma: {
    $transaction: vi.Mock;
    $queryRaw: vi.Mock;
    domainEvent: { create: vi.Mock; findUnique: vi.Mock };
  };
  let fanOut: { fanOut: vi.Mock };
  let service: DomainEventOutboxService;

  const makeTx = (claims: unknown[]) => {
    const pending = [...claims];
    return {
      $queryRaw: vi
        .fn()
        .mockImplementation(() => Promise.resolve(pending.splice(0, 1))),
      domainEvent: {
        update: vi.fn().mockResolvedValue({ id: 'evt-1' }),
        create: vi.fn().mockResolvedValue({ id: 'evt-1' }),
      },
    };
  };

  beforeEach(() => {
    fanOut = {
      fanOut: vi.fn().mockResolvedValue({ kind: 'delivered', jobs: 1 }),
    };
    prisma = {
      $transaction: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([]),
      domainEvent: {
        create: vi.fn().mockResolvedValue({ id: 'evt-1' }),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    service = new DomainEventOutboxService(
      prisma as unknown as PrismaService,
      fanOut as unknown as DomainEventFanOutService,
    );
  });

  const useTx = (tx: unknown): void => {
    prisma.$transaction.mockImplementation(
      (fn: (t: unknown) => Promise<unknown>) => fn(tx),
    );
  };

  describe('append', () => {
    it('creates a row on the caller-provided transaction', async () => {
      const tx = {
        domainEvent: { create: vi.fn().mockResolvedValue({ id: 'row-1' }) },
      };
      const id = await service.append(
        {
          context: 'auth',
          aggregateType: 'account',
          aggregateId: 'user-1',
          eventName: 'user_registered',
          payload: { userId: 'user-1' },
        },
        tx as never,
      );
      expect(id).toBe('row-1');
      const call: { data: Record<string, unknown> } = tx.domainEvent.create.mock
        .calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(call.data['context']).toBe('auth');
      expect(call.data['eventName']).toBe('user_registered');
      expect(call.data['payloadVersion']).toBe(1);
    });

    it('serialises metadata explicitly as JSON', async () => {
      const metadata = { source: 'test' };
      await service.append({
        context: 'auth',
        aggregateType: 'account',
        aggregateId: 'user-1',
        eventName: 'user_registered',
        payload: { userId: 'user-1' },
        metadata,
      });
      expect(prisma.domainEvent.create.mock.calls[0]?.[0]).toMatchObject({
        data: { metadata },
      });
    });

    it('writes dedupeKey with the row when supplied', async () => {
      await service.append({
        context: 'daily-records',
        aggregateType: 'daily-record',
        aggregateId: 'rec-1',
        eventName: 'daily-record.changed',
        payload: { userId: 'u1' },
        dedupeKey: 'daily-record.changed:u1:2026-10-24:rec-1',
      });
      expect(prisma.domainEvent.create.mock.calls[0]?.[0]).toMatchObject({
        data: { dedupeKey: 'daily-record.changed:u1:2026-10-24:rec-1' },
      });
    });

    it('returns the existing row id and writes nothing on a duplicate dedupeKey', async () => {
      prisma.domainEvent.findUnique.mockResolvedValue({ id: 'row-existing' });
      const id = await service.append({
        context: 'daily-records',
        aggregateType: 'daily-record',
        aggregateId: 'rec-1',
        eventName: 'daily-record.changed',
        payload: { userId: 'u1' },
        dedupeKey: 'daily-record.changed:u1:2026-10-24:rec-1',
      });
      expect(id).toBe('row-existing');
      expect(prisma.domainEvent.create).not.toHaveBeenCalled();
    });

    it('falls back to the winner row when a concurrent append loses the unique race', async () => {
      prisma.domainEvent.create.mockRejectedValue(
        uniqueViolation('domain_events_dedupe_key_key'),
      );
      prisma.domainEvent.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'row-racer' });
      const id = await service.append({
        context: 'daily-records',
        aggregateType: 'daily-record',
        aggregateId: 'rec-1',
        eventName: 'daily-record.changed',
        payload: { userId: 'u1' },
        dedupeKey: 'daily-record.changed:u1:2026-10-24:rec-1',
      });
      expect(id).toBe('row-racer');
    });

    it('rethrows non-unique errors from the insert', async () => {
      prisma.domainEvent.create.mockRejectedValue(new Error('connection lost'));
      await expect(
        service.append({
          context: 'daily-records',
          aggregateType: 'daily-record',
          aggregateId: 'rec-1',
          eventName: 'daily-record.changed',
          payload: { userId: 'u1' },
          dedupeKey: 'daily-record.changed:u1:2026-10-24:rec-1',
        }),
      ).rejects.toThrow('connection lost');
    });
  });

  describe('publishPending', () => {
    it('emits and marks delivered when emitAsync resolves', async () => {
      const tx = makeTx([makeRow({})]);
      useTx(tx);
      const outcome = await service.publishPending();
      expect(outcome).toEqual({ delivered: 1, failed: 0, parked: 0 });
      const claimed: { id: string; eventName: string; payload: unknown } =
        fanOut.fanOut.mock.calls[0]?.[0] as {
          id: string;
          eventName: string;
          payload: unknown;
        };
      expect(claimed.id).toBe('evt-1');
      expect(claimed.eventName).toBe('user_registered');
      expect(claimed.payload).toEqual({ userId: 'u1' });
      const settle = tx.domainEvent.update.mock.calls[0]?.[0] as {
        where: { id: string };
        data: { publishedAt: unknown };
      };
      expect(settle.where.id).toBe('evt-1');
      expect(settle.data.publishedAt).toBeTruthy();
    });

    it('stamps both dispatchedAt and publishedAt on a fresh delivery', async () => {
      const tx = makeTx([makeRow({})]);
      useTx(tx);
      await service.publishPending();
      const settle = tx.domainEvent.update.mock.calls[0]?.[0] as {
        data: { publishedAt: unknown; dispatchedAt: unknown };
      };
      expect(settle.data.dispatchedAt).toBeInstanceOf(Date);
      expect(settle.data.publishedAt).toBeInstanceOf(Date);
    });

    it('settles an already-dispatched row without fanning it out again', async () => {
      const tx = makeTx([
        makeRow({ dispatched_at: new Date('2026-10-21T00:00:05Z') }),
      ]);
      useTx(tx);
      const outcome = await service.publishPending();
      expect(outcome).toEqual({ delivered: 1, failed: 0, parked: 0 });
      expect(fanOut.fanOut).not.toHaveBeenCalled();
      const settle = tx.domainEvent.update.mock.calls[0]?.[0] as {
        data: { publishedAt: unknown };
      };
      expect(settle.data.publishedAt).toBeInstanceOf(Date);
    });

    it('records a failure and increments attempts when fan-out fails', async () => {
      fanOut.fanOut.mockResolvedValue({
        kind: 'failed',
        error: new Error('subscriber boom'),
      });
      const tx = makeTx([makeRow({ id: 'evt-2', attempts: 0 })]);
      useTx(tx);
      const outcome = await service.publishPending();
      expect(outcome).toEqual({ delivered: 0, failed: 1, parked: 0 });
      const fail = tx.domainEvent.update.mock.calls[0]?.[0] as {
        where: { id: string };
        data: { attempts: unknown; lastError: unknown };
      };
      expect(fail.where.id).toBe('evt-2');
      expect(fail.data.attempts).toEqual({ increment: 1 });
      expect(fail.data.lastError).toContain('subscriber boom');
    });

    it('records a failure when the fan-out service throws', async () => {
      fanOut.fanOut.mockRejectedValue(new Error('redis down'));
      const tx = makeTx([makeRow({ id: 'evt-3', attempts: 0 })]);
      useTx(tx);
      const outcome = await service.publishPending();
      expect(outcome).toEqual({ delivered: 0, failed: 1, parked: 0 });
      const fail = tx.domainEvent.update.mock.calls[0]?.[0] as {
        data: { lastError: string };
      };
      expect(fail.data.lastError).toContain('redis down');
    });

    it('settles a row with no subscribers', async () => {
      fanOut.fanOut.mockResolvedValue({ kind: 'no-subscribers' });
      const tx = makeTx([makeRow({})]);
      useTx(tx);
      const outcome = await service.publishPending();
      expect(outcome).toEqual({ delivered: 1, failed: 0, parked: 0 });
      expect(tx.domainEvent.update).toHaveBeenCalled();
    });

    it('returns no-op when nothing is claimable', async () => {
      const tx = makeTx([]);
      useTx(tx);
      const outcome = await service.publishPending();
      expect(outcome).toEqual({ delivered: 0, failed: 0, parked: 0 });
      expect(tx.domainEvent.update).not.toHaveBeenCalled();
    });

    it('stops iterating after the batch cap', async () => {
      const rows = Array.from({ length: OUTBOX_BATCH_SIZE + 10 }, (_, i) =>
        makeRow({ id: `evt-${i}` }),
      );
      const tx = makeTx(rows);
      useTx(tx);
      const outcome = await service.publishPending();
      expect(outcome.delivered).toBe(OUTBOX_BATCH_SIZE);
    });
  });

  describe('tunings', () => {
    it('uses bounded retry and fast polling', () => {
      expect(OUTBOX_MAX_ATTEMPTS).toBeGreaterThan(0);
      expect(OUTBOX_BATCH_SIZE).toBeGreaterThan(0);
      expect(OUTBOX_POLL_INTERVAL_MS).toBeGreaterThan(0);
    });
  });
});
