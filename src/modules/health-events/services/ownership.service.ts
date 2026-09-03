import { Injectable } from '@nestjs/common';
import {
  DEFAULT_USER_TIMEZONE,
  formatDateOnlyInTimezone,
  now,
} from '../../../common/index.js';
import { unwrapResult } from '../../../common/result/index.js';
import { EventsService } from './events.service.js';
import {
  HealthEventRepositoryPort,
  type HealthEventCheckInRecord,
  type HealthEventCoverageRecord,
  type HealthEventPage,
  type HealthEventPageQuery,
  type HealthEventRecord,
} from '../repositories/event.repository.js';

/**
 * Cross-module ownership + read façade for health-event data (ADR-0009).
 * Write paths and the business service stay inside the module; consumers
 * reach the repository reads (already filtered by `userId` and
 * `deletedAt: null`) through the exported read-only methods below.
 *
 * `ensureOwnedByUser` / `ensureActiveOwnedByUser` keep the legacy
 * `Promise<T>` contract for out-of-scope consumers (reports, medicine-dose-
 * logs) and fold the module's `ResultAsync` with `unwrapResult`; the thrown
 * `DomainFailureException` is turned into the same Problem Details by the
 * global filter. TODO(error): remove this shim when those consumers migrate
 * (Tasks 8.2/10) and let them consume the Result directly.
 */
@Injectable()
export class HealthEventsOwnershipService {
  constructor(
    private readonly eventsService: EventsService,
    private readonly repository: HealthEventRepositoryPort,
  ) {}

  ensureOwnedByUser(
    userId: string,
    eventId: string,
  ): Promise<HealthEventRecord> {
    return unwrapResult(this.eventsService.ensureOwnedByUser(userId, eventId));
  }

  ensureActiveOwnedByUser(
    userId: string,
    eventId: string,
  ): Promise<HealthEventRecord> {
    return unwrapResult(
      this.eventsService.ensureActiveOwnedByUser(userId, eventId),
    );
  }

  /** Read-only: the user's active event, or null when none exists. */
  findActive(userId: string): Promise<HealthEventRecord | null> {
    return this.repository.findActiveByUserId(userId);
  }

  /**
   * Read-only: the user's most recently started ended event, or null when
   * none exists. Backed by a targeted repository query instead of an
   * in-memory filter over the full event list.
   */
  findMostRecentEnded(userId: string): Promise<HealthEventRecord | null> {
    return this.repository.findMostRecentEndedByUserId(userId);
  }

  /** Read-only: all of the user's non-deleted events, newest started first. */
  findManyByUser(userId: string): Promise<HealthEventRecord[]> {
    return this.repository.findManyByUserId(userId);
  }

  /**
   * Read-only: one page of the user's non-deleted events, newest started
   * first, with the total matching the status filter and a has-more probe.
   */
  findPageByUser(
    userId: string,
    query: HealthEventPageQuery,
  ): Promise<HealthEventPage> {
    return this.repository.findPageByUserId(userId, query);
  }

  /**
   * Read-only: the event's check-ins ordered by date ascending (used by the
   * review changes/actions sections).
   */
  findCheckIns(
    userId: string,
    eventId: string,
  ): Promise<HealthEventCheckInRecord[]> {
    return this.repository.findCheckIns(userId, eventId);
  }

  /**
   * Read-only: the user's profile timezone, or null when unset. Exposed so
   * consumers can align calendar-day window boundaries (e.g. the event
   * review start day) with the user's local date.
   */
  findUserTimezone(userId: string): Promise<string | null> {
    return this.repository.findUserTimezone(userId);
  }

  /**
   * Read-only: the event's check-in for today in the user's timezone, or
   * null when the event has no check-in today.
   */
  async findTodayCheckIn(
    userId: string,
    eventId: string,
  ): Promise<HealthEventCheckInRecord | null> {
    const timezone = await this.repository.findUserTimezone(userId);
    const today = formatDateOnlyInTimezone(
      now(),
      timezone ?? DEFAULT_USER_TIMEZONE,
    );
    return this.repository.findCheckIn(userId, eventId, today);
  }

  /** Read-only: the event's check-in coverage summary. */
  findCheckInCoverage(
    userId: string,
    eventId: string,
  ): Promise<HealthEventCoverageRecord> {
    return this.repository.findCheckInCoverage(userId, eventId);
  }
}
