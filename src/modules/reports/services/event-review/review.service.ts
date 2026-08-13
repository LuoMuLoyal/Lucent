import { Injectable } from '@nestjs/common';
import { DoseLogStatus, HealthEventStatus } from '#generated/prisma/client';
import {
  badRequest,
  formatDateOnly,
  now,
  nowIsoString,
} from '../../../../common';
import type { ObservedMetricSource } from '../../../../common';
import {
  HealthEventsOwnershipService,
  type HealthEventCheckInRecord,
  type HealthEventCoverageRecord,
  type HealthEventRecord,
} from '../../../health-events';
import { DailyRecordReaderPort } from '../../../daily-records';
import { MedicineDoseLogReaderPort } from '../../../medicine-dose-logs';
import type {
  EventReviewDataDto,
  EventReviewEventDto,
  EventReviewListDataDto,
  EventReviewSectionDto,
  EventReviewTodayCheckInDto,
} from '../../dto/event-review-response.dto';
import type { EventReviewListQueryDto } from '../../dto/event-review-list-query.dto';

const DEFAULT_REVIEW_LIST_LIMIT = 20;

/** Separator joining the composite review list cursor (`startedAt|id`). */
const REVIEW_CURSOR_SEPARATOR = '|';

/** Decoded review list cursor; events sort by `startedAt desc, id desc`. */
interface ReviewCursor {
  startedAtIso: string;
  id: string;
}

/** Raw facts the assembler needs; keeps section builders DTO-typed only. */
interface ReviewWindowFacts {
  windowEnd: Date;
  checkInCoverage: HealthEventCoverageRecord;
  dailyRecordCount: number;
  latestDailyRecordCreatedAt: Date | null;
  doseLogCount: number;
  hasReminderLinkedDoseLog: boolean;
  takenDoseLogCount: number;
  skippedDoseLogCount: number;
  latestDoseLogScheduledFor: Date | null;
}

/**
 * Event Review read model (Task 1 skeleton).
 *
 * Reads health-event facts through the health-events ownership façade and
 * window observations through the daily-record / dose-log reader ports.
 * No aggregation rules are duplicated here: sections carry basic facts when
 * the corresponding feed has data, or a fixed reason code when unknown.
 * Task 2 replaces each section builder with a dedicated section service
 * without changing the DTO shape.
 */
@Injectable()
export class EventReviewService {
  constructor(
    private readonly healthEvents: HealthEventsOwnershipService,
    private readonly dailyRecordReader: DailyRecordReaderPort,
    private readonly doseLogReader: MedicineDoseLogReaderPort,
  ) {}

  async buildForEvent(
    userId: string,
    eventId: string,
  ): Promise<EventReviewDataDto> {
    const event = await this.healthEvents.ensureOwnedByUser(userId, eventId);
    const eventDto = this.toEventDto(event);
    const windowEnd = event.endedAt ?? now();

    // Reader ports cap facts at MAX_READER_FACTS (500) per range, so the
    // counts and "latest" timestamps below are capped summaries rather than
    // exact totals. Task 2/3 follow-up: replace with dedicated count/latest
    // queries (see migration log 2026-08-13).
    const [todayCheckIn, checkInCoverage, dailyRecords, doseLogs] =
      await Promise.all([
        this.healthEvents.findTodayCheckIn(userId, eventId),
        this.healthEvents.findCheckInCoverage(userId, eventId),
        this.dailyRecordReader.listFactsInRange(
          userId,
          event.startedAt,
          windowEnd,
        ),
        this.doseLogReader.listFactsInRange(userId, event.startedAt, windowEnd),
      ]);

    return this.assemble(
      eventDto,
      todayCheckIn == null ? null : this.toTodayCheckIn(todayCheckIn),
      {
        windowEnd,
        checkInCoverage,
        dailyRecordCount: dailyRecords.length,
        latestDailyRecordCreatedAt: this.latestDate(
          dailyRecords.map((record) => record.createdAt),
        ),
        doseLogCount: doseLogs.length,
        hasReminderLinkedDoseLog: doseLogs.some(
          (log) => log.reminderId != null,
        ),
        takenDoseLogCount: doseLogs.filter(
          (log) => log.status === DoseLogStatus.taken,
        ).length,
        skippedDoseLogCount: doseLogs.filter(
          (log) => log.status === DoseLogStatus.skipped,
        ).length,
        latestDoseLogScheduledFor: this.latestDate(
          doseLogs.map((log) => log.scheduledFor),
        ),
      },
    );
  }

  async buildCurrent(userId: string): Promise<EventReviewDataDto | null> {
    // Known simplification (follow-up for Task 2/3, see migration log
    // 2026-08-13): the selected event is read here and again inside
    // buildForEvent, which re-validates ownership. An internal assembler
    // taking the record directly can collapse this into a single read.
    const active = await this.healthEvents.findActive(userId);
    if (active != null) {
      return this.buildForEvent(userId, active.id);
    }
    const mostRecentEnded = await this.healthEvents.findMostRecentEnded(userId);
    if (mostRecentEnded != null) {
      return this.buildForEvent(userId, mostRecentEnded.id);
    }
    return null;
  }

  /**
   * Known simplification (follow-up for Task 2/3, see migration log
   * 2026-08-13): events are pulled in full and filtered/paginated in memory.
   * A dedicated paginated repository query should replace this when event
   * history grows.
   */
  async list(
    userId: string,
    query: EventReviewListQueryDto,
  ): Promise<EventReviewListDataDto> {
    const limit = query.limit ?? DEFAULT_REVIEW_LIST_LIMIT;
    const events = await this.healthEvents.findManyByUser(userId);
    const statusFiltered =
      query.status == null
        ? events
        : events.filter((event) => event.status === query.status);
    const cursor = this.resolveCursor(query.cursor);
    const afterCursor =
      cursor == null
        ? statusFiltered
        : statusFiltered.filter((event) => this.isAfterCursor(event, cursor));
    const page = afterCursor.slice(0, limit);
    const lastItem = page.at(-1);
    return {
      items: page.map((event) => this.toEventDto(event)),
      total: statusFiltered.length,
      nextCursor:
        afterCursor.length > limit && lastItem != null
          ? this.encodeCursor(lastItem)
          : null,
    };
  }

  private assemble(
    event: EventReviewEventDto,
    todayCheckIn: EventReviewTodayCheckInDto | null,
    facts: ReviewWindowFacts,
  ): EventReviewDataDto {
    const checkInCount = facts.checkInCoverage.checkInCount;
    const windowEnd = facts.windowEnd.toISOString();
    return {
      event,
      sections: {
        whatHappened: this.buildWhatHappenedSection(event),
        keyChanges: this.buildKeyChangesSection(facts),
        completedActions: this.buildCompletedActionsSection(facts),
        nextStep: this.buildNextStepSection(event, todayCheckIn != null),
      },
      coverage: {
        checkIns: {
          state: checkInCount > 0 ? 'observed' : 'unknown',
          coverage: checkInCount > 0 ? 'partial' : 'none',
          sources: checkInCount > 0 ? ['manual'] : [],
          observedCount: checkInCount,
          expectedCount: null,
          firstCheckInDate: formatDateOnly(
            facts.checkInCoverage.firstCheckInDate,
          ),
          lastCheckInDate: formatDateOnly(
            facts.checkInCoverage.lastCheckInDate,
          ),
          todayCheckIn,
          windowStart: event.startedAt,
          windowEnd,
        },
        dailyRecords: {
          state: facts.dailyRecordCount > 0 ? 'observed' : 'unknown',
          coverage: facts.dailyRecordCount > 0 ? 'partial' : 'none',
          sources: facts.dailyRecordCount > 0 ? ['manual'] : [],
          observedCount: facts.dailyRecordCount,
          expectedCount: null,
          windowStart: event.startedAt,
          windowEnd,
        },
        doseLogs: {
          state: facts.doseLogCount > 0 ? 'observed' : 'unknown',
          coverage: facts.doseLogCount > 0 ? 'partial' : 'none',
          sources: this.doseLogSources(facts),
          observedCount: facts.doseLogCount,
          expectedCount: null,
          windowStart: event.startedAt,
          windowEnd,
        },
      },
      sourceTimestamps: {
        checkIns: formatDateOnly(facts.checkInCoverage.lastCheckInDate),
        dailyRecords: facts.latestDailyRecordCreatedAt?.toISOString() ?? null,
        doseLogs: facts.latestDoseLogScheduledFor?.toISOString() ?? null,
      },
      availableActions:
        event.status === HealthEventStatus.active
          ? ['check_in', 'end_event']
          : ['clinic_summary', 'export'],
      generatedAt: nowIsoString(),
    };
  }

  /** Task 2: replaced by the facts section service. */
  private buildWhatHappenedSection(
    event: EventReviewEventDto,
  ): EventReviewSectionDto {
    return {
      state: 'available',
      facts: {
        code: 'health_event',
        arguments: { startedAt: event.startedAt, endedAt: event.endedAt },
      },
    };
  }

  /**
   * Task 2: replaced by the changes section service (check-in sequences,
   * water/sleep trends, coverage thresholds). The skeleton only describes
   * observed coverage and never claims causation.
   */
  private buildKeyChangesSection(
    facts: ReviewWindowFacts,
  ): EventReviewSectionDto {
    const observationCount =
      facts.checkInCoverage.checkInCount +
      facts.dailyRecordCount +
      facts.doseLogCount;
    if (observationCount === 0) {
      return { state: 'unknown', reasonCode: 'no_observations' };
    }
    return {
      state: 'available',
      facts: {
        code: 'observed_coverage',
        arguments: {
          checkInCount: facts.checkInCoverage.checkInCount,
          dailyRecordCount: facts.dailyRecordCount,
          doseLogCount: facts.doseLogCount,
        },
      },
    };
  }

  /**
   * Task 2: replaced by the actions section service (dose-slot statistics
   * confirmed/skipped/unconfirmed and completed check-ins). The skeleton
   * counts raw dose-log rows without reminder-slot resolution.
   */
  private buildCompletedActionsSection(
    facts: ReviewWindowFacts,
  ): EventReviewSectionDto {
    const completedCount =
      facts.takenDoseLogCount +
      facts.skippedDoseLogCount +
      facts.checkInCoverage.checkInCount;
    if (completedCount === 0) {
      return { state: 'unknown', reasonCode: 'no_completed_actions' };
    }
    return {
      state: 'available',
      facts: {
        code: 'completed_actions',
        arguments: {
          confirmedDoseLogs: facts.takenDoseLogCount,
          skippedDoseLogs: facts.skippedDoseLogCount,
          checkIns: facts.checkInCoverage.checkInCount,
        },
      },
    };
  }

  /** Task 2: replaced by the next-step section service fixed rules. */
  private buildNextStepSection(
    event: EventReviewEventDto,
    hasTodayCheckIn: boolean,
  ): EventReviewSectionDto {
    if (event.status === HealthEventStatus.active) {
      return {
        state: 'available',
        facts: {
          code: 'active_check_in',
          arguments: { hasTodayCheckIn },
        },
      };
    }
    return {
      state: 'available',
      facts: { code: 'event_ended', arguments: { outcome: event.outcome } },
    };
  }

  private doseLogSources(facts: ReviewWindowFacts): ObservedMetricSource[] {
    if (facts.doseLogCount === 0) {
      return [];
    }
    return facts.hasReminderLinkedDoseLog ? ['reminder_plan'] : ['manual'];
  }

  private toEventDto(event: HealthEventRecord): EventReviewEventDto {
    // `kind` is optional on the repository record only for legacy ports; the
    // Prisma-backed read always populates it. Fail loudly on a missing value
    // instead of silently defaulting to `symptom` and mislabeling the event.
    if (event.kind == null) {
      throw new Error(`Health event ${event.id} has no kind.`);
    }
    return {
      id: event.id,
      kind: event.kind,
      title: event.title,
      status: event.status,
      startedAt: event.startedAt.toISOString(),
      endedAt: event.endedAt == null ? null : event.endedAt.toISOString(),
      outcome: event.outcome,
      currentMedicineIds: [...event.currentMedicineIds],
    };
  }

  private resolveCursor(cursor: string | undefined): ReviewCursor | null {
    if (cursor == null) {
      return null;
    }
    const [startedAtIso, id, ...rest] = cursor.split(REVIEW_CURSOR_SEPARATOR);
    if (
      rest.length > 0 ||
      startedAtIso == null ||
      id == null ||
      startedAtIso === '' ||
      id === ''
    ) {
      badRequest('Invalid review cursor.');
    }
    return { startedAtIso, id };
  }

  private encodeCursor(event: HealthEventRecord): string {
    return `${event.startedAt.toISOString()}${REVIEW_CURSOR_SEPARATOR}${event.id}`;
  }

  /**
   * Events are ordered by `startedAt desc, id desc`. An event belongs to the
   * next page when it sorts strictly after the cursor pair, so events sharing
   * the cursor's startedAt are not skipped at page boundaries.
   */
  private isAfterCursor(
    event: HealthEventRecord,
    cursor: ReviewCursor,
  ): boolean {
    const startedAtIso = event.startedAt.toISOString();
    return (
      startedAtIso < cursor.startedAtIso ||
      (startedAtIso === cursor.startedAtIso && event.id < cursor.id)
    );
  }

  private toTodayCheckIn(
    checkIn: HealthEventCheckInRecord,
  ): EventReviewTodayCheckInDto {
    return {
      date: formatDateOnly(checkIn.date),
      outcome: checkIn.outcome,
      updatedAt: checkIn.updatedAt.toISOString(),
    };
  }

  private latestDate(dates: Date[]): Date | null {
    let latest: Date | null = null;
    for (const date of dates) {
      if (latest == null || date > latest) {
        latest = date;
      }
    }
    return latest;
  }
}
