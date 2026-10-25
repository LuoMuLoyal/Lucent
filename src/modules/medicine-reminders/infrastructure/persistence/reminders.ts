import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client.js';
import { PrismaService } from '../../../../prisma/index.js';
import { fromPrismaResult, nonDeleted } from '../../../../common/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import {
  MedicineReminderReaderPort,
  ReminderRepositoryPort,
  type MedicineReminderFact,
} from '../../application/ports/reminder-repository.js';

/** Hard cap on facts returned by the reader port (ADR-0009). */
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
 * Prisma implementation of the reminder repository + reader ports.
 *
 * Split from the port file so `application/**` never imports Prisma (D5): the
 * port declares the shapes, this class only maps them.
 */
@Injectable()
export class PrismaReminders
  extends ReminderRepositoryPort
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
  ): ResultAsync<Prisma.UserMedicineReminderGetPayload<object>, DomainFailure> {
    return fromPrismaResult(this.prisma.userMedicineReminder.create({ data }));
  }

  override updateReminder(
    where: Prisma.UserMedicineReminderWhereUniqueInput,
    data:
      | Prisma.UserMedicineReminderUpdateInput
      | Prisma.UserMedicineReminderUncheckedUpdateInput,
  ): ResultAsync<Prisma.UserMedicineReminderGetPayload<object>, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userMedicineReminder.update({ where, data }),
    );
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
