import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client';
import { PrismaService } from '../../../prisma';

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
}

@Injectable()
export class MedicineReminderRepository extends MedicineReminderRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
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
}
