import {
  HealthEventOutcome,
  HealthEventStatus,
} from '#generated/prisma/client';
import type { Prisma } from '#generated/prisma/client';
import type { DeepMocked } from '../../../common/types/deep-mocked';
import type { PrismaService } from '../../../prisma';
import { PrismaEventRepository } from './prisma-event.repository';

const USER_ID = 'user-1';
const EVENT_ID = 'event-1';

describe('PrismaEventRepository', () => {
  let repository: PrismaEventRepository;
  let prisma: DeepMocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      healthEvent: {
        findFirst: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
      },
      healthEventCheckIn: {
        upsert: vi.fn(),
        findMany: vi.fn(),
      },
      userCurrentMedicine: {
        findMany: vi.fn(),
      },
      $transaction: vi.fn(),
    } as unknown as DeepMocked<PrismaService>;
    repository = new PrismaEventRepository(prisma);
  });

  it('queries the targeted most-recent-ended event', async () => {
    prisma.healthEvent.findFirst.mockResolvedValue(null as never);

    await repository.findMostRecentEndedByUserId(USER_ID);

    expect(prisma.healthEvent.findFirst).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        status: HealthEventStatus.ended,
        deletedAt: null,
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: expect.anything(),
    });
  });

  it('lists check-ins ordered by date for an owned event', async () => {
    prisma.healthEventCheckIn.findMany.mockResolvedValue([] as never);

    await repository.findCheckIns(USER_ID, EVENT_ID);

    expect(prisma.healthEventCheckIn.findMany).toHaveBeenCalledWith({
      where: {
        eventId: EVENT_ID,
        event: { userId: USER_ID, deletedAt: null },
      },
      select: {
        id: true,
        eventId: true,
        date: true,
        outcome: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { date: 'asc' },
    });
  });

  it('only returns current medicines owned by the user', async () => {
    prisma.userCurrentMedicine.findMany.mockResolvedValue([] as never);

    await repository.findOwnedCurrentMedicineIds(USER_ID, ['medicine-1']);

    expect(prisma.userCurrentMedicine.findMany).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        id: { in: ['medicine-1'] },
        isCurrent: true,
      },
      select: { id: true },
    });
  });

  it('rechecks the locked event status before ending it', async () => {
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ id: EVENT_ID, status: HealthEventStatus.ended }]),
      healthEvent: {
        updateMany: vi.fn(),
        findFirst: vi.fn(),
      },
    };
    prisma.$transaction.mockImplementation(
      (callback: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(tx as unknown as Prisma.TransactionClient),
    );

    const result = await repository.update(USER_ID, EVENT_ID, {
      status: HealthEventStatus.ended,
      endedAt: new Date('2026-07-21T00:30:00.000Z'),
      outcome: HealthEventOutcome.improved,
    });

    expect(result).toBeNull();
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.healthEvent.updateMany).not.toHaveBeenCalled();
  });

  it('rechecks the locked event status before writing a check-in', async () => {
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ id: EVENT_ID, status: HealthEventStatus.ended }]),
      healthEventCheckIn: {
        upsert: vi.fn(),
      },
    };
    prisma.$transaction.mockImplementation(
      (callback: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(tx as unknown as Prisma.TransactionClient),
    );

    const result = await repository.upsertCheckIn(
      USER_ID,
      EVENT_ID,
      '2026-07-20',
      HealthEventOutcome.improved,
    );

    expect(result).toBeNull();
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.healthEventCheckIn.upsert).not.toHaveBeenCalled();
  });
});
