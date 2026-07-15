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

  abstract findManyWithCount(
    where: Prisma.UserMedicineDoseLogWhereInput,
    orderBy: Prisma.UserMedicineDoseLogOrderByWithRelationInput[],
    pagination: { page: number; pageSize: number },
  ): Promise<{
    items: Prisma.UserMedicineDoseLogGetPayload<object>[];
    total: number;
  }>;

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

  abstract findReminderById(
    userId: string,
    id: string,
  ): Promise<{
    userId: string;
    currentMedicineId: string | null;
    scheduledHour: number;
    scheduledMinute: number;
  } | null>;

  abstract findCurrentMedicineById(
    userId: string,
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

  override async findManyWithCount(
    where: Prisma.UserMedicineDoseLogWhereInput,
    orderBy: Prisma.UserMedicineDoseLogOrderByWithRelationInput[],
    pagination: { page: number; pageSize: number },
  ) {
    const [items, total] = await Promise.all([
      this.prisma.userMedicineDoseLog.findMany({
        where,
        orderBy,
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      this.prisma.userMedicineDoseLog.count({ where }),
    ]);
    return { items, total };
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

  override findReminderById(userId: string, id: string) {
    return this.prisma.userMedicineReminder.findFirst({
      where: { id, userId, deletedAt: null },
      select: {
        userId: true,
        currentMedicineId: true,
        scheduledHour: true,
        scheduledMinute: true,
      },
    });
  }

  override findCurrentMedicineById(userId: string, id: string) {
    return this.prisma.userCurrentMedicine.findFirst({
      where: { id, userId },
      select: { userId: true },
    });
  }
}
