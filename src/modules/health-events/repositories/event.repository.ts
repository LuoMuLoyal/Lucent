import type {
  HealthEventKind,
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
  /** Always populated by the Prisma implementation; optional for legacy ports. */
  kind?: HealthEventKind;
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

export interface HealthEventCoverageRecord {
  checkInCount: number;
  firstCheckInDate: Date | null;
  lastCheckInDate: Date | null;
}

export interface HealthEventView extends HealthEventRecord {
  checkIn: HealthEventCheckInRecord | null;
  coverage: HealthEventCoverageRecord;
}

export interface HealthEventCreateInput {
  userId: string;
  title: string;
  kind: HealthEventKind;
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
 * One page of a user's event history, ordered `startedAt desc, id desc`.
 * Business-shaped: the composite review-list cursor is decoded by the caller
 * into the exclusive `startedAt`/`id` bound.
 */
export interface HealthEventPageQuery {
  /** Status filter, or null for all statuses. */
  status: HealthEventStatus | null;
  /** Exclusive lower bound: only events sorting strictly after this pair. */
  cursor: { startedAt: Date; id: string } | null;
  /** Page size in records (> 0). */
  limit: number;
}

export interface HealthEventPage {
  items: HealthEventRecord[];
  /** True when another page exists beyond this one. */
  hasMore: boolean;
  /** Total events matching the status filter (cursor not applied). */
  total: number;
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

  abstract findManyByUserId(userId: string): Promise<HealthEventRecord[]>;

  /** The user's non-deleted events as one page, newest started first. */
  abstract findPageByUserId(
    userId: string,
    query: HealthEventPageQuery,
  ): Promise<HealthEventPage>;

  /** The user's most recently started ended event, or null when none exists. */
  abstract findMostRecentEndedByUserId(
    userId: string,
  ): Promise<HealthEventRecord | null>;

  abstract findCheckIn(
    userId: string,
    eventId: string,
    date: string,
  ): Promise<HealthEventCheckInRecord | null>;

  /** The event's check-ins ordered by date ascending. */
  abstract findCheckIns(
    userId: string,
    eventId: string,
  ): Promise<HealthEventCheckInRecord[]>;

  abstract findCheckInCoverage(
    userId: string,
    eventId: string,
  ): Promise<HealthEventCoverageRecord>;

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
