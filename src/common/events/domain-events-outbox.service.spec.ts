import type { EventEmitter2 } from '@nestjs/event-emitter';
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
    ...overrides,
  };
}

describe('DomainEventOutboxService', () => {
  let prisma: {
    $transaction: vi.Mock;
    $queryRaw: vi.Mock;
    domainEvent: { create: vi.Mock };
  };
  let eventEmitter: { emitAsync: vi.Mock };
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
    eventEmitter = { emitAsync: vi.fn().mockResolvedValue(undefined) };
    prisma = {
      $transaction: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([]),
      domainEvent: {
        create: vi.fn().mockResolvedValue({ id: 'evt-1' }),
      },
    };
    service = new DomainEventOutboxService(
      prisma as unknown as PrismaService,
      eventEmitter as unknown as EventEmitter2,
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
  });

  describe('publishPending', () => {
    it('emits and marks delivered when emitAsync resolves', async () => {
      const tx = makeTx([makeRow({})]);
      useTx(tx);
      const outcome = await service.publishPending();
      expect(outcome).toEqual({ delivered: 1, failed: 0, parked: 0 });
      const emitPayload: Record<string, unknown> = eventEmitter.emitAsync.mock
        .calls[0]?.[1] as Record<string, unknown>;
      expect(emitPayload['eventId']).toBe('evt-1');
      expect(emitPayload['eventType']).toBe('user_registered');
      expect(emitPayload['userId']).toBe('u1');
      expect(typeof emitPayload['occurredAt']).toBe('string');
      const settle = tx.domainEvent.update.mock.calls[0]?.[0] as {
        where: { id: string };
        data: { publishedAt: unknown };
      };
      expect(settle.where.id).toBe('evt-1');
      expect(settle.data.publishedAt).toBeTruthy();
    });

    it('records a failure and increments attempts when emitAsync rejects', async () => {
      eventEmitter.emitAsync.mockRejectedValue(new Error('subscriber boom'));
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
