import type {
  HealthEventOutcome,
  HealthEventStatus,
} from '#generated/prisma/client';

/** Raised when the database rejects a concurrent active-event creation. */
export class HealthEventActiveConflictError extends Error {
  readonly code = 'HEALTH_EVENT_ACTIVE_CONFLICT';

  constructor() {
    super('An active health event already exists for this user.');
    this.name = HealthEventActiveConflictError.name;
  }
}

export interface HealthEventRecord {
  id: string;
  userId: string;
  title: string;
  status: HealthEventStatus;
  startedAt: Date;
  endedAt: Date | null;
  outcome: HealthEventOutcome | null;
  reasonRecordId: string | null;
  deletedAt: Date | null;
  currentMedicineIds: string[];
}

export interface HealthEventCheckInRecord {
  id: string;
  eventId: string;
  date: Date;
  outcome: HealthEventOutcome;
  createdAt: Date;
  updatedAt: Date;
}

export interface HealthEventCreateInput {
  userId: string;
  title: string;
  status: HealthEventStatus;
  startedAt: Date;
  reasonRecordId: string | null;
  currentMedicineIds: string[];
}

export interface HealthEventUpdateInput {
  status: HealthEventStatus;
  endedAt: Date;
  outcome: HealthEventOutcome;
}

/**
 * Persistence boundary for health events. Services receive business-shaped
 * arguments only; Prisma query input types stay inside the implementation.
 */
export abstract class HealthEventRepositoryPort {
  abstract findActiveByUserId(
    userId: string,
  ): Promise<HealthEventRecord | null>;

  abstract findById(
    userId: string,
    eventId: string,
  ): Promise<HealthEventRecord | null>;

  abstract findOwnedCurrentMedicineIds(
    userId: string,
    medicineIds: string[],
  ): Promise<string[]>;

  abstract findOwnedReasonRecord(
    userId: string,
    recordId: string,
  ): Promise<boolean>;

  abstract create(input: HealthEventCreateInput): Promise<HealthEventRecord>;

  abstract update(
    userId: string,
    eventId: string,
    input: HealthEventUpdateInput,
  ): Promise<HealthEventRecord | null>;

  abstract upsertCheckIn(
    userId: string,
    eventId: string,
    date: string,
    outcome: HealthEventOutcome,
  ): Promise<HealthEventCheckInRecord | null>;

  abstract findUserTimezone(userId: string): Promise<string | null>;
}
