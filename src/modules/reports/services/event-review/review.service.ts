import { Injectable, Logger } from '@nestjs/common';
import { DailyRecordKind, HealthEventStatus } from '#generated/prisma/client';
import {
  DEFAULT_USER_TIMEZONE,
  badRequest,
  formatDateOnly,
  formatDateOnlyInTimezone,
  now,
  nowIsoString,
  parseDateOnly,
} from '../../../../common';
import type { ObservedMetricSource } from '../../../../common';
import {
  HealthEventsOwnershipService,
  type HealthEventCheckInRecord,
  type HealthEventCoverageRecord,
  type HealthEventRecord,
} from '../../../health-events';
import {
  DailyRecordReaderPort,
  type DailyRecordFact,
} from '../../../daily-records';
import { MedicineDoseLogReaderPort } from '../../../medicine-dose-logs';
import { MedicineRiskCheckService } from '../../../medicines';
import type {
  EventReviewDataDto,
  EventReviewEventDto,
  EventReviewListDataDto,
  EventReviewTodayCheckInDto,
} from '../../dto/event-review-response.dto';
import type { EventReviewListQueryDto } from '../../dto/event-review-list-query.dto';
import { EventReviewFactsService } from './facts.service';
import { EventReviewChangesService } from './changes.service';
import { EventReviewActionsService } from './actions.service';
import { EventReviewNextStepService } from './next-step.service';
import type { ReviewRedFlagInput } from './next-step.service';

const DEFAULT_REVIEW_LIST_LIMIT = 20;

/** Separator joining the composite review list cursor (`startedAt|id`). */
const REVIEW_CURSOR_SEPARATOR = '|';

/** Decoded review list cursor; events sort by `startedAt desc, id desc`. */
interface ReviewCursor {
  startedAtIso: string;
  id: string;
}

/** Raw facts the assembler passes to the section services. */
interface ReviewWindowFacts {
  windowEnd: Date;
  checkInCoverage: HealthEventCoverageRecord;
  /** Check-ins ordered by date ascending (changes/actions sections). */
  checkIns: HealthEventCheckInRecord[];
  /** Exact symptom-record count in the window (dedicated count query). */
  symptomRecordCount: number;
  /** Window records for trend computation (capped reader list). */
  dailyRecords: DailyRecordFact[];
  /** Exact daily-record count in the window (dedicated count query). */
  dailyRecordCount: number;
  latestDailyRecordCreatedAt: Date | null;
  /** Window dose logs for slot statistics (capped reader list). */
  doseLogs: Parameters<EventReviewActionsService['build']>[0]['doseLogs'];
  /** Exact dose-log count in the window (dedicated count query). */
  doseLogCount: number;
  latestDoseLogScheduledFor: Date | null;
  /** Reviewed static medication red flags; empty when unavailable. */
  redFlags: ReviewRedFlagInput[];
}

/**
 * Event Review read model.
 *
 * Reads health-event facts through the health-events ownership façade and
 * window observations through the daily-record / dose-log reader ports,
 * then assembles the four sections via the dedicated section services
 * (Task 2). Counts and latest timestamps come from uncapped dedicated
 * queries; section computations consume the capped reader lists, which only
 * affect trend content in extremely long windows.
 */
@Injectable()
export class EventReviewService {
  private readonly logger = new Logger(EventReviewService.name);

  constructor(
    private readonly healthEvents: HealthEventsOwnershipService,
    private readonly dailyRecordReader: DailyRecordReaderPort,
    private readonly doseLogReader: MedicineDoseLogReaderPort,
    private readonly factsSection: EventReviewFactsService,
    private readonly changesSection: EventReviewChangesService,
    private readonly actionsSection: EventReviewActionsService,
    private readonly nextStepSection: EventReviewNextStepService,
    private readonly riskCheck: MedicineRiskCheckService,
  ) {}

  async buildForEvent(
    userId: string,
    eventId: string,
  ): Promise<EventReviewDataDto> {
    const event = await this.healthEvents.ensureOwnedByUser(userId, eventId);
    const eventDto = this.toEventDto(event);
    const windowEnd = event.endedAt ?? now();
    // Window lower bound: the event start day at 00:00 in the user's
    // timezone. Daily records and dose logs are stored as calendar dates
    // (UTC midnight), so a midday `startedAt` would otherwise exclude the
    // whole start day.
    const timezone = await this.healthEvents.findUserTimezone(userId);
    const windowStart = this.toWindowStart(event.startedAt, timezone);

    const [
      todayCheckIn,
      checkInCoverage,
      checkIns,
      dailyRecords,
      symptomRecordCount,
      dailyRecordCount,
      latestDailyRecordCreatedAt,
      doseLogs,
      doseLogCount,
      latestDoseLogScheduledFor,
      redFlags,
    ] = await Promise.all([
      this.healthEvents.findTodayCheckIn(userId, eventId),
      this.healthEvents.findCheckInCoverage(userId, eventId),
      this.healthEvents.findCheckIns(userId, eventId),
      this.dailyRecordReader.listFactsInRange(userId, windowStart, windowEnd),
      this.dailyRecordReader.countFactsInRange(userId, windowStart, windowEnd, [
        DailyRecordKind.symptom,
      ]),
      this.dailyRecordReader.countFactsInRange(userId, windowStart, windowEnd),
      this.dailyRecordReader.findLatestCreatedAtInRange(
        userId,
        windowStart,
        windowEnd,
      ),
      this.doseLogReader.listFactsInRange(userId, windowStart, windowEnd),
      this.doseLogReader.countFactsInRange(userId, windowStart, windowEnd),
      this.doseLogReader.findLatestScheduledForInRange(
        userId,
        windowStart,
        windowEnd,
      ),
      this.loadStaticRedFlags(userId),
    ]);

    return this.assemble(
      eventDto,
      todayCheckIn == null ? null : this.toTodayCheckIn(todayCheckIn),
      {
        windowEnd,
        checkInCoverage,
        checkIns,
        symptomRecordCount,
        dailyRecords,
        dailyRecordCount,
        latestDailyRecordCreatedAt,
        doseLogs,
        doseLogCount,
        latestDoseLogScheduledFor,
        redFlags,
      },
    );
  }

  /**
   * Resolves the calendar-day start of the event in the user's timezone as a
   * UTC-midnight date, matching how daily records (`occurredAt`) and dose
   * logs (`scheduledFor`) are stored.
   */
  private toWindowStart(startedAt: Date, timezone: string | null): Date {
    return parseDateOnly(
      formatDateOnlyInTimezone(startedAt, timezone ?? DEFAULT_USER_TIMEZONE),
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
   * Known simplification (follow-up for Task 3, see migration log
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

  /**
   * Red flags come from the reviewed static medication risk check only
   * (severeAllergy / informationGap rules). Stale records are skipped — a
   * stale static check no longer matches the user's medicines. Known
   * limitation (Task 3 follow-up, see migration log 2026-08-13): red flags
   * are user-level and are not aligned to the event's medicines. The read
   * is best-effort: when the risk service or its cache is unavailable the
   * review stays usable without red flags.
   */
  private async loadStaticRedFlags(
    userId: string,
  ): Promise<ReviewRedFlagInput[]> {
    try {
      const records = await this.riskCheck.getRecords(userId);
      const staticRecord = records.static;
      if (staticRecord == null || staticRecord.stale) {
        return [];
      }
      return staticRecord.result.redFlags.map((flag) => ({
        rule: flag.rule,
        medicineName: flag.primaryMedicineName,
        ...(flag.relatedLabel != null
          ? { relatedLabel: flag.relatedLabel }
          : {}),
      }));
    } catch (error) {
      this.logger.warn(
        `Failed to load static risk red flags for event review: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
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
        whatHappened: this.factsSection.build({
          event,
          symptomRecordCount: facts.symptomRecordCount,
          checkInCount,
        }),
        keyChanges: this.changesSection.build({
          checkIns: facts.checkIns,
          dailyRecords: facts.dailyRecords,
        }),
        completedActions: this.actionsSection.build({
          doseLogs: facts.doseLogs,
          checkIns: facts.checkIns,
        }),
        nextStep: this.nextStepSection.build({
          event,
          hasTodayCheckIn: todayCheckIn != null,
          redFlags: facts.redFlags,
        }),
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

  private doseLogSources(facts: ReviewWindowFacts): ObservedMetricSource[] {
    if (facts.doseLogCount === 0) {
      return [];
    }
    // Known simplification (Task 3 follow-up, see migration log 2026-08-13):
    // the reminder-linked check reads the capped reader list, so in windows
    // with >500 dose logs a reminder-linked log could be missed and the
    // source mislabeled as `manual`. A dedicated has-reminder query should
    // replace this when such windows become realistic.
    const hasReminderLinkedDoseLog = facts.doseLogs.some(
      (log) => log.reminderId != null,
    );
    return hasReminderLinkedDoseLog ? ['reminder_plan'] : ['manual'];
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
}
