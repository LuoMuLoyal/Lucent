import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Abstract port for medicine dose-log data access.
 *
 * Allows `MedicineDoseLogsService` to depend on an interface rather than
 * `PrismaService` directly, simplifying unit testing and future data-source
 * swaps.
 */
export abstract class MedicineDoseLogRepositoryPort {
  abstract findMany(
    where: Prisma.UserMedicineDoseLogWhereInput,
    orderBy?: Prisma.UserMedicineDoseLogOrderByWithRelationInput[],
  ): Promise<Prisma.UserMedicineDoseLogGetPayload<object>[]>;

  abstract findFirst(
    where: Prisma.UserMedicineDoseLogWhereInput,
    options?: {
      select?: Prisma.UserMedicineDoseLogSelect;
      orderBy?: Prisma.UserMedicineDoseLogOrderByWithRelationInput[];
    },
  ): Promise<unknown>;

  abstract create(
    data: Prisma.UserMedicineDoseLogUncheckedCreateInput,
  ): Promise<Prisma.UserMedicineDoseLogGetPayload<object>>;

  abstract update(
    where: Prisma.UserMedicineDoseLogWhereUniqueInput,
    data:
      | Prisma.UserMedicineDoseLogUpdateInput
      | Prisma.UserMedicineDoseLogUncheckedUpdateInput,
  ): Promise<Prisma.UserMedicineDoseLogGetPayload<object>>;

  abstract findReminderById(id: string): Promise<{
    userId: string;
    currentMedicineId: string | null;
    scheduledHour: number;
    scheduledMinute: number;
  } | null>;

  abstract findCurrentMedicineById(
    id: string,
  ): Promise<{ userId: string } | null>;
}

@Injectable()
export class MedicineDoseLogRepository extends MedicineDoseLogRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  override findMany(
    where: Prisma.UserMedicineDoseLogWhereInput,
    orderBy?: Prisma.UserMedicineDoseLogOrderByWithRelationInput[],
  ) {
    const args: Parameters<
      PrismaService['userMedicineDoseLog']['findMany']
    >[0] = { where };
    if (orderBy !== undefined) args.orderBy = orderBy;
    return this.prisma.userMedicineDoseLog.findMany(args);
  }

  override findFirst(
    where: Prisma.UserMedicineDoseLogWhereInput,
    options?: {
      select?: Prisma.UserMedicineDoseLogSelect;
      orderBy?: Prisma.UserMedicineDoseLogOrderByWithRelationInput[];
    },
  ) {
    const args: Parameters<
      PrismaService['userMedicineDoseLog']['findFirst']
    >[0] = { where };
    if (options?.select !== undefined) args.select = options.select;
    if (options?.orderBy !== undefined) args.orderBy = options.orderBy;
    return this.prisma.userMedicineDoseLog.findFirst(args);
  }

  override create(data: Prisma.UserMedicineDoseLogUncheckedCreateInput) {
    return this.prisma.userMedicineDoseLog.create({ data });
  }

  override update(
    where: Prisma.UserMedicineDoseLogWhereUniqueInput,
    data:
      | Prisma.UserMedicineDoseLogUpdateInput
      | Prisma.UserMedicineDoseLogUncheckedUpdateInput,
  ) {
    return this.prisma.userMedicineDoseLog.update({ where, data });
  }

  override findReminderById(id: string) {
    return this.prisma.userMedicineReminder.findFirst({
      where: { id, deletedAt: null },
      select: {
        userId: true,
        currentMedicineId: true,
        scheduledHour: true,
        scheduledMinute: true,
      },
    });
  }

  override findCurrentMedicineById(id: string) {
    return this.prisma.userCurrentMedicine.findUnique({
      where: { id },
      select: { userId: true },
    });
  }
}
