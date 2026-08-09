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
      },
      userCurrentMedicine: {
        findMany: vi.fn(),
      },
      $transaction: vi.fn(),
    } as unknown as DeepMocked<PrismaService>;
    repository = new PrismaEventRepository(prisma);
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
