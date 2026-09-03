import type {
  HealthEventKind,
  HealthEventOutcome,
  HealthEventStatus,
} from '#generated/prisma/client.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../common/result/index.js';

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
 *
 * Write methods return `ResultAsync<T, DomainFailure>`: known Prisma request
 * errors (P2002 -> RESOURCE_CONFLICT, P2025 -> RESOURCE_NOT_FOUND) are mapped
 * to domain failures while unknown database/connection errors are re-thrown
 * and reach the global exception filter unchanged. Reads stay
 * `Promise<T | null>` — a missing row is a legitimate value; the application
 * service decides when absence is a failure.
 */
export abstract class HealthEventRepositoryPort {
  abstract findActiveByUserId(
    userId: string,
  ): Promise<HealthEventRecord | null>;

  /**
   * Looks up an event by id regardless of owner so the service can
   * distinguish "missing" (RESOURCE_NOT_FOUND) from "owned by another user"
   * (FORBIDDEN). The caller must never return the row to the client.
   */
  abstract findById(eventId: string): Promise<HealthEventRecord | null>;

  abstract findManyByUserId(userId: string): Promise<HealthEventRecord[]>;

  /** The user's non-deleted events as one page, newest started first.
   *
   * `items` and `total` come from two independent queries, so `total` is an
   * approximate snapshot for the status filter — the cursor bound does not
   * apply to the count and concurrent writes may shift either side.
   */
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

  abstract create(
    input: HealthEventCreateInput,
  ): ResultAsync<HealthEventRecord, DomainFailure>;

  abstract update(
    userId: string,
    eventId: string,
    input: HealthEventUpdateInput,
  ): ResultAsync<HealthEventRecord | null, DomainFailure>;

  abstract upsertCheckIn(
    userId: string,
    eventId: string,
    date: string,
    outcome: HealthEventOutcome,
  ): ResultAsync<HealthEventCheckInRecord | null, DomainFailure>;

  abstract findUserTimezone(userId: string): Promise<string | null>;
}
