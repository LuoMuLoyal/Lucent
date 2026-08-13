import { Injectable } from '@nestjs/common';
import { HealthEventStatus } from '#generated/prisma/client';
import {
  DEFAULT_USER_TIMEZONE,
  formatDateOnlyInTimezone,
  now,
} from '../../../common';
import { EventsService } from './events.service';
import {
  HealthEventRepositoryPort,
  type HealthEventCheckInRecord,
  type HealthEventCoverageRecord,
  type HealthEventRecord,
} from '../repositories/event.repository';

/**
 * Cross-module ownership + read façade for health-event data (ADR-0009).
 * Write paths and the business service stay inside the module; consumers
 * reach the repository reads (already filtered by `userId` and
 * `deletedAt: null`) through the exported read-only methods below.
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
    return this.eventsService.ensureOwnedByUser(userId, eventId);
  }

  ensureActiveOwnedByUser(
    userId: string,
    eventId: string,
  ): Promise<HealthEventRecord> {
    return this.eventsService.ensureActiveOwnedByUser(userId, eventId);
  }

  /** Read-only: the user's active event, or null when none exists. */
  findActive(userId: string): Promise<HealthEventRecord | null> {
    return this.repository.findActiveByUserId(userId);
  }

  /**
   * Read-only: the user's most recently started ended event, or null when
   * none exists.
   *
   * Known simplification (follow-up for Task 2/3, see migration log
   * 2026-08-13): relies on the repository's `startedAt desc` ordering and
   * pulls all events in memory; a dedicated query should replace this when
   * event history grows.
   */
  async findMostRecentEnded(userId: string): Promise<HealthEventRecord | null> {
    const events = await this.repository.findManyByUserId(userId);
    return (
      events.find((event) => event.status === HealthEventStatus.ended) ?? null
    );
  }

  /** Read-only: all of the user's non-deleted events, newest started first. */
  findManyByUser(userId: string): Promise<HealthEventRecord[]> {
    return this.repository.findManyByUserId(userId);
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
