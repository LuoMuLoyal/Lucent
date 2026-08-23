import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma';
import type { IMedicineReminderReader } from '../../types/ports';
import { MEDICINE_REMINDER_READER } from '../../types/ports';
import { UserHealthContextService } from '../../../user-health-context';
import { UserSettingsService } from '../../../user-settings';
import { HistoricalAiSummaryService } from '../../services/historical-ai-summary.service';
import type {
  AssistantReadResultEnvelope,
  AssistantToolExecutionContext,
} from '../../types/assistant.types';
import {
  DEFAULT_HISTORY_LIMIT,
  MAX_RANGE_DAYS,
} from '../shared/tool-constants';
import {
  enumerateDates,
  extractReportRangeKey,
  resolveDateRange,
  resolveReportRangeFromKey,
  resolveSingleDate,
  todayDateString,
} from '../shared/date-resolver';
import {
  buildDailyRecordCoverage,
  buildDailyRecordRangeCoverage,
  buildReadConfidence,
  buildReadEnvelope,
} from '../presenters';
import { AssistantToolRecordQueryService } from '../records/query.service';
import { describeReminderFrequency, mapSleepQuality } from './read-helpers';

@Injectable()
export class AssistantToolReadService {
  private readonly logger = new Logger(AssistantToolReadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiSummaryHistoryService: HistoricalAiSummaryService,
    private readonly userHealthContextService: UserHealthContextService,
    @Inject(MEDICINE_REMINDER_READER)
    private readonly medicineRemindersService: IMedicineReminderReader,
    private readonly userSettingsService: UserSettingsService,
    private readonly recordQueryService: AssistantToolRecordQueryService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public read tool entry points
  // ---------------------------------------------------------------------------

  async getTodayRecords(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const date = todayDateString();
    const records = await this.recordQueryService.listToolRecords(
      context.userId,
      date,
      { includeSleep: this.canReadSleep(context) },
    );
    return buildReadEnvelope({
      toolName: 'get_today_records',
      query: { date, mode: 'today' },
      result: { records, total: records.length },
      coverage: buildDailyRecordCoverage({
        hasData: records.length > 0,
        sleepIncluded: this.canReadSleep(context),
      }),
      timeRange: { timezone: 'UTC', startDate: date, endDate: date },
      confidence: {
        level: 'high',
        reason: 'Resolved from the current UTC date without fuzzy matching.',
      },
      ambiguities: [],
      tables: ['daily_record'],
    });
  }

  async getRecordsByDate(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const dateResolution = resolveSingleDate(context.userMessage, {
      fallbackDate: todayDateString(),
      defaultAmbiguity:
        'No explicit date detected, so the lookup defaulted to today.',
    });
    const records = await this.recordQueryService.listToolRecords(
      context.userId,
      dateResolution.date,
      { includeSleep: this.canReadSleep(context) },
    );
    return buildReadEnvelope({
      toolName: 'get_records_by_date',
      query: {
        date: dateResolution.date,
        matchedBy: dateResolution.matchedBy,
      },
      result: { records, total: records.length },
      coverage: buildDailyRecordCoverage({
        hasData: records.length > 0,
        sleepIncluded: this.canReadSleep(context),
      }),
      timeRange: {
        timezone: 'UTC',
        startDate: dateResolution.date,
        endDate: dateResolution.date,
      },
      confidence: buildReadConfidence({
        ambiguities: dateResolution.ambiguities,
        preferredReason:
          records.length > 0
            ? 'Matched a single calendar date for record lookup.'
            : 'Matched a single calendar date, but no records were stored there.',
      }),
      ambiguities: dateResolution.ambiguities,
      tables: ['daily_record'],
    });
  }

  async getRecordsByRange(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const range = resolveDateRange(context.userMessage);
    const dates = enumerateDates(
      range.startDate,
      range.endDate,
      range.truncated ? MAX_RANGE_DAYS : undefined,
    );
    const days = await Promise.all(
      dates.map(async (date) => {
        const records = await this.recordQueryService.listToolRecords(
          context.userId,
          date,
          { includeSleep: this.canReadSleep(context) },
        );
        return { date, records, total: records.length };
      }),
    );
    const total = days.reduce((sum, day) => sum + day.total, 0);
    return buildReadEnvelope({
      toolName: 'get_records_by_range',
      query: {
        startDate: range.startDate,
        endDate: range.endDate,
        matchedBy: range.matchedBy,
        requestedDays: range.requestedDays,
      },
      result: { days, total, truncated: range.truncated },
      coverage: buildDailyRecordRangeCoverage({
        total,
        truncated: range.truncated,
        sleepIncluded: this.canReadSleep(context),
      }),
      timeRange: {
        timezone: 'UTC',
        startDate: range.startDate,
        endDate: dates.at(-1) ?? range.endDate,
      },
      confidence: buildReadConfidence({
        ambiguities: range.ambiguities,
        truncated: range.truncated,
        preferredReason:
          total > 0
            ? 'Resolved a bounded date range for historical record lookup.'
            : 'Resolved a bounded date range, but no records were stored in it.',
      }),
      ambiguities: range.ambiguities,
      tables: ['daily_record'],
    });
  }

  async getTodaySummaryByDate(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const dateResolution = resolveSingleDate(context.userMessage, {
      fallbackDate: todayDateString(),
      defaultAmbiguity:
        'No explicit date detected, so the Today summary lookup defaulted to today.',
    });
    const summary =
      await this.aiSummaryHistoryService.getLatestTodaySummaryByDate(
        context.userId,
        dateResolution.date,
      );
    return buildReadEnvelope({
      toolName: 'get_today_summary_by_date',
      query: {
        date: dateResolution.date,
        matchedBy: dateResolution.matchedBy,
      },
      result: { summary, found: summary != null },
      coverage:
        summary != null
          ? { status: 'complete', reason: null }
          : {
              status: 'empty',
              reason:
                'No persisted Today AI summary was found for the selected date.',
            },
      timeRange: {
        timezone: 'UTC',
        startDate: dateResolution.date,
        endDate: dateResolution.date,
      },
      confidence: buildReadConfidence({
        ambiguities: dateResolution.ambiguities,
        preferredReason:
          summary != null
            ? 'Checked persisted Today AI summaries for one specific date.'
            : 'Checked persisted Today AI summaries for one specific date, but none existed.',
      }),
      ambiguities: dateResolution.ambiguities,
      tables: ['historical_ai_summary'],
    });
  }

  async getReportSummaryByRange(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const rangeKey = extractReportRangeKey(context.userMessage);
    const range =
      rangeKey != null
        ? resolveReportRangeFromKey(rangeKey)
        : resolveDateRange(context.userMessage);
    const summary =
      await this.aiSummaryHistoryService.getLatestReportSummaryByRange(
        context.userId,
        rangeKey != null
          ? { rangeKey }
          : { startDate: range.startDate, endDate: range.endDate },
      );
    const ambiguities = rangeKey != null ? [] : range.ambiguities;
    return buildReadEnvelope({
      toolName: 'get_report_summary_by_range',
      query: {
        rangeKey,
        startDate: rangeKey == null ? range.startDate : null,
        endDate: rangeKey == null ? range.endDate : null,
        matchedBy: range.matchedBy,
      },
      result: { summary, found: summary != null },
      coverage:
        summary != null
          ? { status: 'complete', reason: null }
          : {
              status: 'empty',
              reason:
                'No persisted Report AI summary was found for the selected range.',
            },
      timeRange: {
        timezone: 'UTC',
        startDate: range.startDate,
        endDate: range.endDate,
      },
      confidence: buildReadConfidence({
        ambiguities,
        truncated: rangeKey == null ? range.truncated : false,
        preferredReason:
          summary != null
            ? 'Checked persisted Report AI summaries for the requested range.'
            : 'Checked persisted Report AI summaries for the requested range, but none existed.',
      }),
      ambiguities,
      tables: ['historical_ai_summary'],
    });
  }

  async getRecentTodaySummaries(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const summaries =
      await this.aiSummaryHistoryService.listRecentTodaySummaries(
        context.userId,
        DEFAULT_HISTORY_LIMIT,
      );
    return buildReadEnvelope({
      toolName: 'get_recent_today_summaries',
      query: { limit: DEFAULT_HISTORY_LIMIT },
      result: { summaries, total: summaries.length },
      coverage:
        summaries.length > 0
          ? { status: 'complete', reason: null }
          : {
              status: 'empty',
              reason: 'No persisted Today AI summaries were found.',
            },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: {
        level: 'high',
        reason: 'Read directly from persisted Today AI summary history.',
      },
      ambiguities: [],
      tables: ['historical_ai_summary'],
    });
  }

  async getRecentReportSummaries(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const summaries =
      await this.aiSummaryHistoryService.listRecentReportSummaries(
        context.userId,
        DEFAULT_HISTORY_LIMIT,
      );
    return buildReadEnvelope({
      toolName: 'get_recent_report_summaries',
      query: { limit: DEFAULT_HISTORY_LIMIT },
      result: { summaries, total: summaries.length },
      coverage:
        summaries.length > 0
          ? { status: 'complete', reason: null }
          : {
              status: 'empty',
              reason: 'No persisted Report AI summaries were found.',
            },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: {
        level: 'high',
        reason: 'Read directly from persisted Report AI summary history.',
      },
      ambiguities: [],
      tables: ['historical_ai_summary'],
    });
  }

  async getUserProfile(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    // Best-effort read tool: a failed health-context read degrades to an
    // empty profile (logged) instead of aborting the agent turn.
    const health = await this.userHealthContextService
      .getForUser(context.userId)
      .match(
        (value) => value,
        (failure) => {
          this.logger.warn(
            `get_user_profile health context read failed (${failure.code}); degrading to empty profile.`,
          );
          return null;
        },
      );
    const account = await this.prisma.user.findFirstOrThrow({
      where: { id: context.userId, deletedAt: null },
      select: { nickname: true },
    });
    return buildReadEnvelope({
      toolName: 'get_user_profile',
      query: {
        include: [
          'nickname',
          'sexAtBirth',
          'birthDate',
          'age',
          'heightCm',
          'bloodType',
          'allergies',
        ],
      },
      result: {
        profile: {
          nickname: account.nickname ?? null,
          sexAtBirth: health?.profile.sexAtBirth ?? null,
          birthDate: health?.profile.birthDate ?? null,
          age: health?.summary.age ?? null,
          heightCm: health?.profile.heightCm ?? null,
          bloodType: health?.profile.bloodType ?? null,
          allergies: (health?.allergies ?? [])
            .filter((item) => item.isActive)
            .map((item) => item.label),
        },
      },
      coverage: { status: 'complete', reason: null },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: {
        level: 'high',
        reason:
          'Read directly from the user account and health profile sources.',
      },
      ambiguities: [],
      tables: ['user', 'user_health_profile', 'user_allergy'],
    });
  }

  async getUserSettings(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const settings = await this.userSettingsService.getSettings(context.userId);
    return buildReadEnvelope({
      toolName: 'get_user_settings',
      query: { scope: 'assistant_related_settings' },
      result: {
        settings: {
          aiSummariesEnabled: settings.aiSummariesEnabled,
          dataSharingConsent: settings.dataSharingConsent,
          assistantEnabled: settings.assistantEnabled,
          assistantMemoryEnabled: settings.assistantMemoryEnabled,
          assistantContext: settings.assistantContext,
        },
      },
      coverage: { status: 'complete', reason: null },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: {
        level: 'high',
        reason: 'Read directly from persisted assistant-related user settings.',
      },
      ambiguities: [],
      tables: ['user_settings'],
    });
  }

  async getCurrentMedicines(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    // Best-effort read tool: a failed health-context read degrades to an
    // empty medicine list (logged) instead of aborting the agent turn.
    const health = await this.userHealthContextService
      .getForUser(context.userId)
      .match(
        (value) => value,
        (failure) => {
          this.logger.warn(
            `get_current_medicines health context read failed (${failure.code}); degrading to empty medicine list.`,
          );
          return null;
        },
      );
    const reminders = await this.medicineRemindersService.list(
      context.userId,
      true,
    );
    const remindersByMedicineId = new Map<string, typeof reminders.items>();
    for (const reminder of reminders.items) {
      if (reminder.currentMedicineId == null) continue;
      const current =
        remindersByMedicineId.get(reminder.currentMedicineId) ?? [];
      current.push(reminder);
      remindersByMedicineId.set(reminder.currentMedicineId, current);
    }
    const medicines = (health?.currentMedicines ?? [])
      .filter((item) => item.isCurrent)
      .map((item) => ({
        medicineId: item.id,
        medicineName: item.displayName,
        dose: item.doseText,
        frequency: describeReminderFrequency(
          remindersByMedicineId.get(item.id) ?? [],
        ),
        route: item.route,
        startedAt: item.startedAt,
        note: item.note,
      }));
    return buildReadEnvelope({
      toolName: 'get_current_medicines',
      query: { scope: 'current_only' },
      result: { medicines, total: medicines.length },
      coverage:
        medicines.length > 0
          ? { status: 'complete', reason: null }
          : {
              status: 'empty',
              reason: 'No current medicines were found in the user profile.',
            },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: {
        level: 'high',
        reason:
          'Merged current medicine profile entries with active reminder metadata.',
      },
      ambiguities: [],
      tables: ['current_medicine', 'medicine_reminder'],
    });
  }

  async getSleepSummaryByRange(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const range = resolveDateRange(context.userMessage);
    const dates = enumerateDates(
      range.startDate,
      range.endDate,
      range.truncated ? MAX_RANGE_DAYS : undefined,
    );
    const entries = await Promise.all(
      dates.map(async (date) => {
        const records = await this.recordQueryService.listToolRecords(
          context.userId,
          date,
          { includeSleep: true, sleepOnly: true },
        );
        const latest = records[0] ?? null;
        const payload = latest?.payload ?? null;
        const durationMinutes =
          typeof payload?.['durationMinutes'] === 'number'
            ? payload['durationMinutes']
            : null;
        const quality =
          typeof payload?.['quality'] === 'string' ? payload['quality'] : null;
        return {
          date,
          durationMinutes,
          quality,
          startAt:
            typeof payload?.['startAt'] === 'string'
              ? payload['startAt']
              : null,
          endAt:
            typeof payload?.['endAt'] === 'string' ? payload['endAt'] : null,
        };
      }),
    );
    const durations = entries
      .map((entry) => entry.durationMinutes)
      .filter(
        (value): value is number => typeof value === 'number' && value > 0,
      );
    const qualityScores = entries
      .map((entry) => mapSleepQuality(entry.quality))
      .filter((value): value is number => value != null);
    return buildReadEnvelope({
      toolName: 'get_sleep_summary_by_range',
      query: {
        startDate: range.startDate,
        endDate: range.endDate,
        matchedBy: range.matchedBy,
        requestedDays: range.requestedDays,
      },
      result: {
        entries,
        nightsWithData: durations.length,
        averageDurationMinutes:
          durations.length > 0
            ? Math.round(
                durations.reduce((sum, value) => sum + value, 0) /
                  durations.length,
              )
            : null,
        averageQuality:
          qualityScores.length > 0
            ? Number(
                (
                  qualityScores.reduce((sum, value) => sum + value, 0) /
                  qualityScores.length
                ).toFixed(2),
              )
            : null,
        truncated: range.truncated,
      },
      coverage:
        durations.length > 0
          ? range.truncated
            ? {
                status: 'partial',
                reason:
                  'Requested range exceeded the bounded window and was truncated to 14 days.',
              }
            : { status: 'complete', reason: null }
          : {
              status: 'empty',
              reason: 'No sleep records were found in the selected date range.',
            },
      timeRange: {
        timezone: 'UTC',
        startDate: range.startDate,
        endDate: dates.at(-1) ?? range.endDate,
      },
      confidence: buildReadConfidence({
        ambiguities: range.ambiguities,
        truncated: range.truncated,
        preferredReason:
          durations.length > 0
            ? 'Resolved a bounded date range for sleep summary lookup.'
            : 'Resolved a bounded date range for sleep summary lookup, but no sleep data was stored there.',
      }),
      ambiguities: range.ambiguities,
      tables: ['daily_record'],
    });
  }

  canReadSleep(context: AssistantToolExecutionContext): boolean {
    return context.enabledContextSources.includes('sleep_records');
  }
}
