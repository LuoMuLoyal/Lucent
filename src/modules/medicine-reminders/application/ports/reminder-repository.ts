import { type Prisma } from '#generated/prisma/client.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';

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

/**
 * Read-only port for cross-module reads of UserMedicineReminder (ADR-0009).
 * Implemented by PrismaReminders and exported from
 * MedicineRemindersModule; write paths stay behind MedicineRemindersService /
 * ReminderRepositoryPort.
 */
export abstract class MedicineReminderReaderPort {
  /** Lists non-deleted, active reminders for the user. */
  abstract listActiveFacts(userId: string): Promise<MedicineReminderFact[]>;
}

/**
 * Abstract port for medicine-reminder data access.
 *
 * Allows `MedicineRemindersService` and `MedicineRemindersOwnership`
 * to depend on an interface rather than `PrismaService` directly.
 */
export abstract class ReminderRepositoryPort {
  abstract findManyReminders(
    where: Prisma.UserMedicineReminderWhereInput,
    orderBy?: Prisma.UserMedicineReminderOrderByWithRelationInput[],
  ): Promise<Prisma.UserMedicineReminderGetPayload<object>[]>;

  abstract createReminder(
    data: Prisma.UserMedicineReminderUncheckedCreateInput,
  ): ResultAsync<Prisma.UserMedicineReminderGetPayload<object>, DomainFailure>;

  abstract updateReminder(
    where: Prisma.UserMedicineReminderWhereUniqueInput,
    data:
      | Prisma.UserMedicineReminderUpdateInput
      | Prisma.UserMedicineReminderUncheckedUpdateInput,
  ): ResultAsync<Prisma.UserMedicineReminderGetPayload<object>, DomainFailure>;

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
