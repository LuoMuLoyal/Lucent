import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client';
import { PrismaService } from '../../../prisma';
import { nonDeleted } from '../../../common';

/**
 * Lean read-model shape for cross-module consumers (ADR-0009). Exposes
 * reminder fields only — no Prisma query DSL. Canonical order is
 * `scheduledHour asc, scheduledMinute asc, createdAt asc`.
 */
export interface MedicineReminderFact {
  currentMedicineId: string | null;
  scheduledHour: number;
  scheduledMinute: number;
  daysOfWeek: Prisma.JsonValue;
  startDate: Date | null;
  endDate: Date | null;
  createdAt: Date;
}

/**
 * Hard upper bound on facts returned by reader ports. Prevents unbounded
 * context queries from slowing the AI pipeline as user data grows.
 * (ADR-0009 reader ports; architecture review #15)
 */
const MAX_READER_FACTS = 500;

const medicineReminderFactSelect = {
  currentMedicineId: true,
  scheduledHour: true,
  scheduledMinute: true,
  daysOfWeek: true,
  startDate: true,
  endDate: true,
  createdAt: true,
} satisfies Prisma.UserMedicineReminderSelect;

/**
 * Read-only port for cross-module reads of UserMedicineReminder (ADR-0009).
 * Implemented by MedicineReminderRepository and exported from
 * MedicineRemindersModule; write paths stay behind MedicineRemindersService /
 * MedicineReminderRepositoryPort.
 */
export abstract class MedicineReminderReaderPort {
  /** Lists non-deleted, active reminders for the user. */
  abstract listActiveFacts(userId: string): Promise<MedicineReminderFact[]>;
}

/**
 * Abstract port for medicine-reminder data access.
 *
 * Allows `MedicineRemindersService` and `MedicineRemindersOwnershipService`
 * to depend on an interface rather than `PrismaService` directly.
 */
export abstract class MedicineReminderRepositoryPort {
  abstract findManyReminders(
    where: Prisma.UserMedicineReminderWhereInput,
    orderBy?: Prisma.UserMedicineReminderOrderByWithRelationInput[],
  ): Promise<Prisma.UserMedicineReminderGetPayload<object>[]>;

  abstract createReminder(
    data: Prisma.UserMedicineReminderUncheckedCreateInput,
  ): Promise<Prisma.UserMedicineReminderGetPayload<object>>;

  abstract updateReminder(
    where: Prisma.UserMedicineReminderWhereUniqueInput,
    data:
      | Prisma.UserMedicineReminderUpdateInput
      | Prisma.UserMedicineReminderUncheckedUpdateInput,
  ): Promise<Prisma.UserMedicineReminderGetPayload<object>>;

  abstract findManyDeliveries(
    where: Prisma.UserReminderDeliveryWhereInput,
    orderBy?: Prisma.UserReminderDeliveryOrderByWithRelationInput[],
    take?: number,
  ): Promise<Prisma.UserReminderDeliveryGetPayload<object>[]>;

  abstract findReminderById(
    id: string,
    select: Prisma.UserMedicineReminderSelect,
  ): Promise<unknown>;

  abstract findCurrentMedicine(
    id: string,
    userId: string,
  ): Promise<{ id: string; userId: string } | null>;

  abstract transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;
}

@Injectable()
export class MedicineReminderRepository
  extends MedicineReminderRepositoryPort
  implements MedicineReminderReaderPort
{
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listActiveFacts(userId: string): Promise<MedicineReminderFact[]> {
    return this.prisma.userMedicineReminder.findMany({
      where: { userId, isActive: true, ...nonDeleted },
      select: medicineReminderFactSelect,
      orderBy: [
        { scheduledHour: 'asc' },
        { scheduledMinute: 'asc' },
        { createdAt: 'asc' },
      ],
      take: MAX_READER_FACTS,
    });
  }

  override findManyReminders(
    where: Prisma.UserMedicineReminderWhereInput,
    orderBy?: Prisma.UserMedicineReminderOrderByWithRelationInput[],
  ) {
    const args: Parameters<
      PrismaService['userMedicineReminder']['findMany']
    >[0] = { where };
    if (orderBy !== undefined) args.orderBy = orderBy;
    return this.prisma.userMedicineReminder.findMany(args);
  }

  override createReminder(
    data: Prisma.UserMedicineReminderUncheckedCreateInput,
  ) {
    return this.prisma.userMedicineReminder.create({ data });
  }

  override updateReminder(
    where: Prisma.UserMedicineReminderWhereUniqueInput,
    data:
      | Prisma.UserMedicineReminderUpdateInput
      | Prisma.UserMedicineReminderUncheckedUpdateInput,
  ) {
    return this.prisma.userMedicineReminder.update({ where, data });
  }

  override findManyDeliveries(
    where: Prisma.UserReminderDeliveryWhereInput,
    orderBy?: Prisma.UserReminderDeliveryOrderByWithRelationInput[],
    take?: number,
  ) {
    const args: Parameters<
      PrismaService['userReminderDelivery']['findMany']
    >[0] = { where };
    if (orderBy !== undefined) args.orderBy = orderBy;
    if (take !== undefined) args.take = take;
    return this.prisma.userReminderDelivery.findMany(args);
  }

  override findReminderById(
    id: string,
    select: Prisma.UserMedicineReminderSelect,
  ) {
    return this.prisma.nonDeleted.userMedicineReminder.findFirst({
      where: { id },
      select,
    });
  }

  override findCurrentMedicine(id: string, userId: string) {
    return this.prisma.userCurrentMedicine.findFirst({
      where: { id, userId, isCurrent: true },
      select: { id: true, userId: true },
    });
  }

  override transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(fn);
  }
}
