import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client.js';
import { PrismaService } from '../../../../prisma/index.js';
import {
  fromPrismaResult,
  nonDeleted,
  PrismaTransactionRunner,
} from '../../../../common/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import {
  MedicineReminderReaderPort,
  ReminderRepositoryPort,
  type CurrentMedicineFact,
  type MedicineReminderFact,
} from '../../application/ports/reminder-repository.js';

/** Hard cap on facts returned by the reader port (ADR-0009). */
const MAX_READER_FACTS = 500;

const medicineReminderFactSelect = {
  id: true,
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: PrismaTransactionRunner,
  ) {
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

  /**
   * Current medicines for the user, ordered oldest-first so a consumer's slot
   * numbering stays stable across calls.
   *
   * Only `id` and `displayName` are selected: this port exists so another
   * context can build reminder slots without reading this context's table, and
   * anything beyond identity + label would invite it to reason about medicine
   * data it does not own.
   */
  async listCurrentMedicines(userId: string): Promise<CurrentMedicineFact[]> {
    // ## Why the half-life join happens here
    //
    // `user_current_medicines` carries only `source` + `sourceRefId`; the
    // `half_life` text lives in `drugbank_drugs`, which belongs to the
    // `medicines` context. A consumer (suggestion) joining them itself
    // would be exactly the cross-context table read ADR-0024 §3 forbids, so the
    // owning context resolves it and hands back a plain fact.
    //
    // The join is deliberately narrow:
    // - only `source = drugbank` rows have a counterpart (a `cn` product or a
    //   manual entry has no DrugBank ID), and
    // - a missing row or a NULL column yields `halfLife: null`, which consumers
    //   read as "unknown" rather than "no half-life".
    const rows = await this.prisma.userCurrentMedicine.findMany({
      where: { userId, isCurrent: true },
      select: { id: true, displayName: true, source: true, sourceRefId: true },
      orderBy: [{ createdAt: 'asc' }],
      take: MAX_READER_FACTS,
    });

    // `sourceRefId` is only a DrugBank ID when `source = 'drugbank'`; a `cn`
    // product id that happens to collide with one must not pick up its
    // half-life.
    const drugbankIds = rows
      .filter((row) => row.source === 'drugbank')
      .map((row) => row.sourceRefId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (drugbankIds.length === 0) {
      return rows.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        halfLife: null,
      }));
    }

    const knowledges = await this.prisma.drugbankDrug.findMany({
      where: { drugbankId: { in: drugbankIds } },
      select: { drugbankId: true, halfLife: true },
    });
    const halfLifeById = new Map(
      knowledges.map((row) => [row.drugbankId, row.halfLife]),
    );

    return rows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      halfLife:
        row.source === 'drugbank' && row.sourceRefId != null
          ? (halfLifeById.get(row.sourceRefId) ?? null)
          : null,
    }));
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

  /**
   * Goes through the shared runner so domain-event appends inside `fn` join this
   * transaction (ADR-0025 E0) instead of opening their own connection.
   */
  override transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.transactions.transaction(fn);
  }
}
