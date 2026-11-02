import { type Prisma } from '#generated/prisma/client.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';

/**
 * Lean read-model shape for cross-module consumers (ADR-0009). Exposes
 * reminder fields only — no Prisma query DSL. Canonical order is
 * `scheduledHour asc, scheduledMinute asc, createdAt asc`.
 *
 * ## `id` is part of the contract, not an accident
 *
 * Consumers (`today-suggestion`'s medication collector) use the reminder id as
 * the **slot key**: two reminders for the same medicine can share a time, so the
 * `(reminderId, date, time)` triple is what makes a slot unique. Without `id`
 * a consumer would have to fall back to positional keys, which drift whenever
 * the reminder list is reordered — so the id is read here deliberately.
 */
export interface MedicineReminderFact {
  id: string;
  currentMedicineId: string | null;
  scheduledHour: number;
  scheduledMinute: number;
  daysOfWeek: Prisma.JsonValue;
  startDate: Date | null;
  endDate: Date | null;
  createdAt: Date;
}

/**
 * A current-medicine entry as seen from outside the Medication Tracking
 * context: identity plus the display label, nothing else.
 *
 * Exists so `today-suggestion`'s medication collector can build reminder slots
 * from the owning context instead of querying `user_current_medicines` directly
 * — direct table reads across contexts are what ADR-0024 §3 forbids.
 */
export interface CurrentMedicineFact {
  id: string;
  displayName: string;
}

/**
 * Read-only port for cross-module reads of this context's tables (ADR-0009).
 *
 * Implemented by `PrismaReminders` and exported from `MedicineRemindersModule`;
 * write paths stay behind `MedicineRemindersService` / `ReminderRepositoryPort`.
 */
export abstract class MedicineReminderReaderPort {
  /** Lists non-deleted, active reminders for the user. */
  abstract listActiveFacts(userId: string): Promise<MedicineReminderFact[]>;

  /**
   * Lists the user's current medicines (identity + label only).
   *
   * Ordered oldest-first so a consumer's slot numbering is stable across calls.
   */
  abstract listCurrentMedicines(userId: string): Promise<CurrentMedicineFact[]>;
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
