import { Injectable } from '@nestjs/common';
import { HistoricalAiSummaryService } from '../historical-ai-summary.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { DailyRecordKind } from '../../../generated/prisma/client';
import { UserHealthContextService } from '../../user-health-context/user-health-context.service';
import { DailyRecordCandidatesService } from '../../daily-records/daily-record-candidates.service';
import { DailyRecordsService } from '../../daily-records/daily-records.service';
import { MedicineRemindersService } from '../../medicine-reminders/medicine-reminders.service';
import {
  REPORT_RANGE_LAST_30_DAYS,
  REPORT_RANGE_LAST_7_DAYS,
  type ReportRange,
} from '../../reports/dto/report-dashboard-query.dto';
import { UserSettingsService } from '../../user-settings/user-settings.service';
import type {
  AssistantCreateDailyRecordProposalPayload,
  AssistantReadConfidence,
  AssistantReadCoverage,
  AssistantReadResultEnvelope,
  AssistantToolExecutionContext,
  AssistantToolExecutionResult,
  AssistantUpdateDailyRecordProposalPayload,
  AssistantUpdateUserSettingsProposalPayload,
} from '../assistant.types';
import type { AssistantToolName } from './assistant-tool.types';

const DEFAULT_RANGE_DAYS = 7;
const MAX_RANGE_DAYS = 14;
const DEFAULT_HISTORY_LIMIT = 10;
const DEFAULT_PROPOSAL_DATE_OFFSET_DAYS = 0;
const PROPOSAL_TTL_MINUTES = 15;

type ToolDateRange = {
  startDate: string;
  endDate: string;
};

type ToolRecordItem = {
  id: string;
  kind: string;
  occurredAt: string;
  title: string | null;
  value: string | null;
  unit: string | null;
  note: string | null;
  tags: string[];
  payload: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type ToolSingleDateResolution = {
  date: string;
  matchedBy: string[];
  ambiguities: string[];
};

type ToolRangeResolution = ToolDateRange & {
  matchedBy: string[];
  ambiguities: string[];
  truncated: boolean;
  requestedDays: number | null;
};

const REQUEST_RANGE_CAP_MESSAGE = (
  requestedDays: number,
  maxRangeDays: number,
) =>
  `Requested ${String(requestedDays)} days, but range reads are capped at ${String(maxRangeDays)} days.`;

const DEFAULT_RANGE_FALLBACK_MESSAGE = (defaultRangeDays: number) =>
  `No explicit range detected, so the lookup defaulted to the last ${String(defaultRangeDays)} days.`;

const RANGE_TRUNCATED_MESSAGE = (maxRangeDays: number) =>
  `Requested range exceeded ${String(maxRangeDays)} days and was truncated.`;

type ToolMutationHints = {
  kindHint: string | null;
  numericHint: string | null;
  titleHint: string | null;
  noteHint: string | null;
};

type ToolMutationRankedRecord = {
  record: ToolRecordItem;
  score: number;
  matchedBy: string[];
};

type ToolMutationTargetMatch = {
  date: string;
  record: ToolRecordItem | null;
  matchedBy: string[];
  ambiguities: string[];
  reason: string;
  confidence: AssistantReadConfidence;
  candidateCount: number;
};

@Injectable()
export class AssistantToolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiSummaryHistoryService: HistoricalAiSummaryService,
    private readonly userHealthContextService: UserHealthContextService,
    private readonly dailyRecordCandidatesService: DailyRecordCandidatesService,
    private readonly dailyRecordsService: DailyRecordsService,
    private readonly medicineRemindersService: MedicineRemindersService,
    private readonly userSettingsService: UserSettingsService,
  ) {}

  async executeMany(
    context: AssistantToolExecutionContext,
    toolNames: readonly AssistantToolName[],
  ): Promise<AssistantToolExecutionResult[]> {
    const results: AssistantToolExecutionResult[] = [];
    for (const toolName of toolNames) {
      results.push(await this.executeOne(context, toolName));
    }
    return results;
  }

  private async executeOne(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
  ): Promise<AssistantToolExecutionResult> {
    switch (toolName) {
      case 'get_today_records':
        return {
          name: toolName,
          data: await this.buildTodayRecords(context),
        };
      case 'get_records_by_date':
        return {
          name: toolName,
          data: await this.buildRecordsByDate(context),
        };
      case 'get_records_by_range':
        return {
          name: toolName,
          data: await this.buildRecordsByRange(context),
        };
      case 'get_today_summary_by_date':
        return {
          name: toolName,
          data: await this.buildTodaySummaryByDate(context),
        };
      case 'get_report_summary_by_range':
        return {
          name: toolName,
          data: await this.buildReportSummaryByRange(context),
        };
      case 'get_recent_today_summaries':
        return {
          name: toolName,
          data: await this.buildRecentTodaySummaries(context),
        };
      case 'get_recent_report_summaries':
        return {
          name: toolName,
          data: await this.buildRecentReportSummaries(context),
        };
      case 'get_user_profile':
        return {
          name: toolName,
          data: await this.buildUserProfile(context),
        };
      case 'get_user_settings':
        return {
          name: toolName,
          data: await this.buildUserSettings(context),
        };
      case 'get_current_medicines':
        return {
          name: toolName,
          data: await this.buildCurrentMedicines(context),
        };
      case 'get_sleep_summary_by_range':
        return {
          name: toolName,
          data: await this.buildSleepSummaryByRange(context),
        };
      case 'propose_create_daily_record':
        return this.buildCreateDailyRecordProposal(context, toolName);
      case 'propose_update_daily_record':
        return this.buildUpdateDailyRecordProposal(context, toolName);
      case 'propose_delete_daily_record':
        return this.buildDeleteDailyRecordProposal(context, toolName);
      case 'propose_update_user_settings':
        return this.buildUpdateUserSettingsProposal(context, toolName);
    }
  }

  private async buildTodayRecords(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const date = this.todayDateString();
    const records = await this.listToolRecords(context.userId, date, {
      includeSleep: this.canReadSleep(context),
    });
    return this.buildReadEnvelope({
      toolName: 'get_today_records',
      query: {
        date,
        mode: 'today',
      },
      result: {
        records,
        total: records.length,
      },
      coverage: this.buildDailyRecordCoverage({
        hasData: records.length > 0,
        sleepIncluded: this.canReadSleep(context),
      }),
      timeRange: {
        timezone: 'UTC',
        startDate: date,
        endDate: date,
      },
      confidence: {
        level: 'high',
        reason: 'Resolved from the current UTC date without fuzzy matching.',
      },
      ambiguities: [],
      tables: ['daily_record'],
    });
  }

  private async buildRecordsByDate(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const dateResolution = this.resolveSingleDate(context.userMessage, {
      fallbackDate: this.todayDateString(),
      defaultAmbiguity:
        'No explicit date detected, so the lookup defaulted to today.',
    });
    const records = await this.listToolRecords(
      context.userId,
      dateResolution.date,
      {
        includeSleep: this.canReadSleep(context),
      },
    );
    return this.buildReadEnvelope({
      toolName: 'get_records_by_date',
      query: {
        date: dateResolution.date,
        matchedBy: dateResolution.matchedBy,
      },
      result: {
        records,
        total: records.length,
      },
      coverage: this.buildDailyRecordCoverage({
        hasData: records.length > 0,
        sleepIncluded: this.canReadSleep(context),
      }),
      timeRange: {
        timezone: 'UTC',
        startDate: dateResolution.date,
        endDate: dateResolution.date,
      },
      confidence: this.buildReadConfidence({
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

  private async buildRecordsByRange(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const range = this.resolveDateRange(context.userMessage);
    const dates = this.enumerateDates(
      range.startDate,
      range.endDate,
      range.truncated ? MAX_RANGE_DAYS : undefined,
    );
    const days = await Promise.all(
      dates.map(async (date) => {
        const records = await this.listToolRecords(context.userId, date, {
          includeSleep: this.canReadSleep(context),
        });
        return {
          date,
          records,
          total: records.length,
        };
      }),
    );
    const total = days.reduce((sum, day) => sum + day.total, 0);
    return this.buildReadEnvelope({
      toolName: 'get_records_by_range',
      query: {
        startDate: range.startDate,
        endDate: range.endDate,
        matchedBy: range.matchedBy,
        requestedDays: range.requestedDays,
      },
      result: {
        days,
        total,
        truncated: range.truncated,
      },
      coverage: this.buildDailyRecordRangeCoverage({
        total,
        truncated: range.truncated,
        sleepIncluded: this.canReadSleep(context),
      }),
      timeRange: {
        timezone: 'UTC',
        startDate: range.startDate,
        endDate: dates.at(-1) ?? range.endDate,
      },
      confidence: this.buildReadConfidence({
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

  private async buildRecentTodaySummaries(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const summaries =
      await this.aiSummaryHistoryService.listRecentTodaySummaries(
        context.userId,
        DEFAULT_HISTORY_LIMIT,
      );
    return this.buildReadEnvelope({
      toolName: 'get_recent_today_summaries',
      query: {
        limit: DEFAULT_HISTORY_LIMIT,
      },
      result: {
        summaries,
        total: summaries.length,
      },
      coverage:
        summaries.length > 0
          ? { status: 'complete', reason: null }
          : {
              status: 'empty',
              reason: 'No persisted Today AI summaries were found.',
            },
      timeRange: {
        timezone: 'UTC',
        startDate: null,
        endDate: null,
      },
      confidence: {
        level: 'high',
        reason: 'Read directly from persisted Today AI summary history.',
      },
      ambiguities: [],
      tables: ['historical_ai_summary'],
    });
  }

  private async buildRecentReportSummaries(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const summaries =
      await this.aiSummaryHistoryService.listRecentReportSummaries(
        context.userId,
        DEFAULT_HISTORY_LIMIT,
      );
    return this.buildReadEnvelope({
      toolName: 'get_recent_report_summaries',
      query: {
        limit: DEFAULT_HISTORY_LIMIT,
      },
      result: {
        summaries,
        total: summaries.length,
      },
      coverage:
        summaries.length > 0
          ? { status: 'complete', reason: null }
          : {
              status: 'empty',
              reason: 'No persisted Report AI summaries were found.',
            },
      timeRange: {
        timezone: 'UTC',
        startDate: null,
        endDate: null,
      },
      confidence: {
        level: 'high',
        reason: 'Read directly from persisted Report AI summary history.',
      },
      ambiguities: [],
      tables: ['historical_ai_summary'],
    });
  }

  private async buildTodaySummaryByDate(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const dateResolution = this.resolveSingleDate(context.userMessage, {
      fallbackDate: this.todayDateString(),
      defaultAmbiguity:
        'No explicit date detected, so the Today summary lookup defaulted to today.',
    });
    const summary =
      await this.aiSummaryHistoryService.getLatestTodaySummaryByDate(
        context.userId,
        dateResolution.date,
      );
    return this.buildReadEnvelope({
      toolName: 'get_today_summary_by_date',
      query: {
        date: dateResolution.date,
        matchedBy: dateResolution.matchedBy,
      },
      result: {
        summary,
        found: summary != null,
      },
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
      confidence: this.buildReadConfidence({
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

  private async buildReportSummaryByRange(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const rangeKey = this.extractReportRangeKey(context.userMessage);
    const range =
      rangeKey != null
        ? this.resolveReportRangeFromKey(rangeKey)
        : this.resolveDateRange(context.userMessage);
    const summary =
      await this.aiSummaryHistoryService.getLatestReportSummaryByRange(
        context.userId,
        rangeKey != null
          ? { rangeKey }
          : {
              startDate: range.startDate,
              endDate: range.endDate,
            },
      );
    const ambiguities = rangeKey != null ? [] : range.ambiguities;
    return this.buildReadEnvelope({
      toolName: 'get_report_summary_by_range',
      query: {
        rangeKey,
        startDate: rangeKey == null ? range.startDate : null,
        endDate: rangeKey == null ? range.endDate : null,
        matchedBy: range.matchedBy,
      },
      result: {
        summary,
        found: summary != null,
      },
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
      confidence: this.buildReadConfidence({
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

  private async buildUserProfile(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const health = await this.userHealthContextService.getForUser(
      context.userId,
    );
    const account = await this.prisma.user.findFirst({
      where: { id: context.userId, deletedAt: null },
      select: {
        nickname: true,
      },
    });
    return this.buildReadEnvelope({
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
          nickname: account?.nickname ?? null,
          sexAtBirth: health.profile.sexAtBirth,
          birthDate: health.profile.birthDate,
          age: health.summary.age,
          heightCm: health.profile.heightCm,
          bloodType: health.profile.bloodType,
          allergies: health.allergies
            .filter((item) => item.isActive)
            .map((item) => item.label),
        },
      },
      coverage: { status: 'complete', reason: null },
      timeRange: {
        timezone: 'UTC',
        startDate: null,
        endDate: null,
      },
      confidence: {
        level: 'high',
        reason:
          'Read directly from the user account and health profile sources.',
      },
      ambiguities: [],
      tables: ['user', 'user_health_profile', 'user_allergy'],
    });
  }

  private async buildUserSettings(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const settings = await this.userSettingsService.getSettings(context.userId);
    return this.buildReadEnvelope({
      toolName: 'get_user_settings',
      query: {
        scope: 'assistant_related_settings',
      },
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
      timeRange: {
        timezone: 'UTC',
        startDate: null,
        endDate: null,
      },
      confidence: {
        level: 'high',
        reason: 'Read directly from persisted assistant-related user settings.',
      },
      ambiguities: [],
      tables: ['user_settings'],
    });
  }

  private async buildCurrentMedicines(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const health = await this.userHealthContextService.getForUser(
      context.userId,
    );
    const reminders = await this.medicineRemindersService.list(
      context.userId,
      true,
    );
    const remindersByMedicineId = new Map<string, typeof reminders.items>();
    for (const reminder of reminders.items) {
      if (reminder.currentMedicineId == null) {
        continue;
      }
      const current =
        remindersByMedicineId.get(reminder.currentMedicineId) ?? [];
      current.push(reminder);
      remindersByMedicineId.set(reminder.currentMedicineId, current);
    }
    const medicines = health.currentMedicines
      .filter((item) => item.isCurrent)
      .map((item) => ({
        medicineId: item.id,
        medicineName: item.displayName,
        dose: item.doseText,
        frequency: this.describeReminderFrequency(
          remindersByMedicineId.get(item.id) ?? [],
        ),
        route: item.route,
        startedAt: item.startedAt,
        note: item.note,
      }));
    return this.buildReadEnvelope({
      toolName: 'get_current_medicines',
      query: {
        scope: 'current_only',
      },
      result: {
        medicines,
        total: medicines.length,
      },
      coverage:
        medicines.length > 0
          ? { status: 'complete', reason: null }
          : {
              status: 'empty',
              reason: 'No current medicines were found in the user profile.',
            },
      timeRange: {
        timezone: 'UTC',
        startDate: null,
        endDate: null,
      },
      confidence: {
        level: 'high',
        reason:
          'Merged current medicine profile entries with active reminder metadata.',
      },
      ambiguities: [],
      tables: ['current_medicine', 'medicine_reminder'],
    });
  }

  private async buildSleepSummaryByRange(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const range = this.resolveDateRange(context.userMessage);
    const dates = this.enumerateDates(
      range.startDate,
      range.endDate,
      range.truncated ? MAX_RANGE_DAYS : undefined,
    );
    const entries = await Promise.all(
      dates.map(async (date) => {
        const records = await this.listToolRecords(context.userId, date, {
          includeSleep: true,
          sleepOnly: true,
        });
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
      .map((entry) => this.mapSleepQuality(entry.quality))
      .filter((value): value is number => value != null);
    return this.buildReadEnvelope({
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
          : range.truncated
            ? {
                status: 'partial',
                reason:
                  'Requested range exceeded the bounded window and was truncated to 14 days. No sleep records were found in the truncated window.',
              }
            : {
                status: 'empty',
                reason:
                  'No sleep records were found in the selected date range.',
              },
      timeRange: {
        timezone: 'UTC',
        startDate: range.startDate,
        endDate: dates.at(-1) ?? range.endDate,
      },
      confidence: this.buildReadConfidence({
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

  private async buildCreateDailyRecordProposal(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
  ): Promise<AssistantToolExecutionResult> {
    const occurredAtResolution = this.resolveSingleDate(context.userMessage, {
      fallbackDate: this.offsetDateString(DEFAULT_PROPOSAL_DATE_OFFSET_DAYS),
      defaultAmbiguity:
        'No explicit date detected, so the draft defaults to today.',
    });
    const candidates = await this.dailyRecordCandidatesService.generate(
      {
        text: context.userMessage,
        occurredAt: occurredAtResolution.date,
      },
      context.locale,
    );
    const first = candidates.items[0];
    if (first == null) {
      return {
        name: toolName,
        data: {
          confirmationHint: candidates.confirmationHint,
          selectedDate: occurredAtResolution.date,
          ambiguities: occurredAtResolution.ambiguities,
          candidates: [],
        },
      };
    }
    const payload: AssistantCreateDailyRecordProposalPayload = {
      type: 'create_daily_record',
      draft: {
        kind: first.kind,
        occurredAt: first.occurredAt,
        title: first.title,
        value: first.value,
        unit: first.unit,
        note: first.note,
        payload: first.payload,
      },
    };
    return {
      name: toolName,
      data: {
        confirmationHint: candidates.confirmationHint,
        selectedDate: occurredAtResolution.date,
        ambiguities: occurredAtResolution.ambiguities,
        candidateCount: candidates.items.length,
        candidates: candidates.items,
      },
      proposedActions: [
        {
          id: `proposal-create-${String(Date.now())}`,
          type: 'create_daily_record',
          status: 'proposed',
          confirmationRequired: true,
          title: this.localeText(
            context.locale,
            '保存这条记录',
            'Save this record',
          ),
          summary: this.describeCreateRecordSummary(first, context.locale),
          reason: first.rationale,
          previewFields: this.buildCreateRecordPreviewFields(
            first,
            context.locale,
          ),
          target: {
            kind: 'daily_record_draft',
            label: this.describeRecordTargetLabel(first, context.locale),
            matchedBy: occurredAtResolution.matchedBy,
            snapshot: payload.draft,
          },
          constraints: [
            this.localeText(
              context.locale,
              '必须先经过你确认，后端不会直接写入。',
              'Must be confirmed by you before any write happens.',
            ),
            this.localeText(
              context.locale,
              '确认后只会按当前草稿创建一条记录，不会扩展到其他字段。',
              'Confirmation creates exactly one record from this draft and nothing broader.',
            ),
            this.localeText(
              context.locale,
              '如果你稍后改变想法，应重新生成新的草稿再确认。',
              'If your intent changes, generate a fresh draft instead of reusing this one.',
            ),
          ],
          expiresAt: this.buildProposalExpiryIso(),
          payloadVersion: 1,
          payload,
        },
      ],
    };
  }

  private async buildUpdateDailyRecordProposal(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
  ): Promise<AssistantToolExecutionResult> {
    const target = await this.findTargetDailyRecordForMutation(context);
    const updateDraft = this.extractRecordUpdateDraft(context.userMessage);
    if (target.record == null || updateDraft == null) {
      return {
        name: toolName,
        data: {
          selectedDate: target.date,
          matchedRecord: target.record,
          matchedBy: target.matchedBy,
          ambiguities: target.ambiguities,
          confidence: target.confidence,
          reason: target.reason,
          candidateCount: target.candidateCount,
          draft: updateDraft,
        },
      };
    }
    const payload: AssistantUpdateDailyRecordProposalPayload = {
      type: 'update_daily_record',
      recordId: target.record.id,
      draft: updateDraft,
    };
    return {
      name: toolName,
      data: {
        selectedDate: target.date,
        matchedRecord: target.record,
        matchedBy: target.matchedBy,
        ambiguities: target.ambiguities,
        confidence: target.confidence,
        reason: target.reason,
        candidateCount: target.candidateCount,
        draft: updateDraft,
      },
      proposedActions: [
        {
          id: `proposal-update-${target.record.id}`,
          type: 'update_daily_record',
          status: 'proposed',
          confirmationRequired: true,
          title: this.localeText(
            context.locale,
            '修改这条记录',
            'Update this record',
          ),
          summary: this.describeUpdateRecordSummary(
            target.record,
            context.locale,
          ),
          reason: target.reason,
          previewFields: this.buildUpdateRecordPreviewFields(
            updateDraft,
            context.locale,
          ),
          target: {
            kind: 'daily_record',
            label: this.describeRecordTargetLabel(
              target.record,
              context.locale,
            ),
            recordId: target.record.id,
            matchedBy: target.matchedBy,
            snapshot: target.record,
          },
          constraints: [
            this.localeText(
              context.locale,
              '必须先经过你确认，后端不会直接写入。',
              'Must be confirmed by you before any write happens.',
            ),
            this.localeText(
              context.locale,
              '只允许修改白名单字段：时间、标题、数值、单位、备注、结构化 payload。',
              'Only allowlisted fields can change: occurredAt, title, value, unit, note, and structured payload.',
            ),
            this.localeText(
              context.locale,
              '这条提案只针对当前匹配到的单条记录，若列表发生变化请重新生成。',
              'This proposal targets one matched record only. Regenerate it if the record list changes.',
            ),
          ],
          expiresAt: this.buildProposalExpiryIso(),
          payloadVersion: 1,
          payload,
        },
      ],
    };
  }

  private async buildDeleteDailyRecordProposal(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
  ): Promise<AssistantToolExecutionResult> {
    const target = await this.findTargetDailyRecordForMutation(context);
    if (target.record == null) {
      return {
        name: toolName,
        data: {
          selectedDate: target.date,
          matchedRecord: null,
          matchedBy: target.matchedBy,
          ambiguities: target.ambiguities,
          confidence: target.confidence,
          reason: target.reason,
          candidateCount: target.candidateCount,
        },
      };
    }
    const payload = {
      type: 'delete_daily_record',
      recordId: target.record.id,
    } as const;
    return {
      name: toolName,
      data: {
        selectedDate: target.date,
        matchedRecord: target.record,
        matchedBy: target.matchedBy,
        ambiguities: target.ambiguities,
        confidence: target.confidence,
        reason: target.reason,
        candidateCount: target.candidateCount,
      },
      proposedActions: [
        {
          id: `proposal-delete-${target.record.id}`,
          type: 'delete_daily_record',
          status: 'proposed',
          confirmationRequired: true,
          title: this.localeText(
            context.locale,
            '删除这条记录',
            'Delete this record',
          ),
          summary: this.describeDeleteRecordSummary(
            target.record,
            context.locale,
          ),
          reason: target.reason,
          previewFields: [
            {
              label: this.localeText(context.locale, '记录类型', 'Kind'),
              value: target.record.kind,
            },
            {
              label: this.localeText(context.locale, '日期', 'Date'),
              value: target.record.occurredAt,
            },
            {
              label: this.localeText(context.locale, '定位方式', 'Matched by'),
              value: target.matchedBy.join(', '),
            },
          ],
          target: {
            kind: 'daily_record',
            label: this.describeRecordTargetLabel(
              target.record,
              context.locale,
            ),
            recordId: target.record.id,
            matchedBy: target.matchedBy,
            snapshot: target.record,
          },
          constraints: [
            this.localeText(
              context.locale,
              '必须先经过你确认，后端不会直接删除。',
              'Must be confirmed by you before any deletion happens.',
            ),
            this.localeText(
              context.locale,
              '只会删除当前匹配到的这一条记录，不会批量删除。',
              'Only the single matched record can be deleted. No bulk delete is allowed.',
            ),
            this.localeText(
              context.locale,
              '如果你表达得不够具体，系统宁可拒绝生成提案，也不会猜测要删哪条。',
              'If your message is not specific enough, the system refuses to guess which record to delete.',
            ),
          ],
          expiresAt: this.buildProposalExpiryIso(),
          payloadVersion: 1,
          payload,
        },
      ],
    };
  }

  private buildUpdateUserSettingsProposal(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
  ): AssistantToolExecutionResult {
    const draft = this.extractSettingsDraft(context.userMessage);
    if (
      draft.assistantEnabled == null &&
      draft.assistantMemoryEnabled == null &&
      draft.assistantContext == null
    ) {
      return {
        name: toolName,
        data: {
          draft,
          matchedSettingKeys: [],
        },
      };
    }
    const payload: AssistantUpdateUserSettingsProposalPayload = {
      type: 'update_user_settings',
      draft,
    };
    const settingKeys = this.collectSettingsDraftKeys(draft);
    return {
      name: toolName,
      data: {
        draft,
        matchedSettingKeys: settingKeys,
      },
      proposedActions: [
        {
          id: `proposal-settings-${String(Date.now())}`,
          type: 'update_user_settings',
          status: 'proposed',
          confirmationRequired: true,
          title: this.localeText(
            context.locale,
            '更新助手相关设置',
            'Update assistant settings',
          ),
          summary: this.localeText(
            context.locale,
            '我整理出了一组设置变更，确认后才会真正写入。',
            'I prepared a settings change set. Nothing will be written until you confirm.',
          ),
          reason: null,
          previewFields: this.buildSettingsPreviewFields(draft, context.locale),
          target: {
            kind: 'user_settings',
            label: this.localeText(
              context.locale,
              '助手设置',
              'Assistant settings',
            ),
            settingKeys,
            snapshot: draft,
          },
          constraints: [
            this.localeText(
              context.locale,
              '必须先经过你确认，后端不会直接写入。',
              'Must be confirmed by you before any write happens.',
            ),
            this.localeText(
              context.locale,
              '这里只允许修改助手相关设置，不会触碰其他用户设置。',
              'Only assistant-related settings are allowed here. Nothing outside that scope can change.',
            ),
            this.localeText(
              context.locale,
              '如果你想调整更多设置，应重新生成新的提案。',
              'Generate a new proposal if you want a broader settings change.',
            ),
          ],
          expiresAt: this.buildProposalExpiryIso(),
          payloadVersion: 1,
          payload,
        },
      ],
    };
  }

  private async listToolRecords(
    userId: string,
    date: string,
    options: { includeSleep: boolean; sleepOnly?: boolean },
  ): Promise<ToolRecordItem[]> {
    const result = await this.dailyRecordsService.list(
      userId,
      date,
      undefined,
      1,
      100,
    );
    return result.items
      .filter((item) => {
        if (options.sleepOnly) {
          return item.kind === DailyRecordKind.sleep;
        }
        if (!options.includeSleep && item.kind === DailyRecordKind.sleep) {
          return false;
        }
        return true;
      })
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        occurredAt: item.occurredAt,
        title: item.title ?? null,
        value: item.value ?? null,
        unit: item.unit ?? null,
        note: item.note ?? null,
        tags: [],
        payload: item.payload ?? null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
  }

  private canReadSleep(context: AssistantToolExecutionContext): boolean {
    return context.enabledContextSources.includes('sleep_records');
  }

  private async findTargetDailyRecordForMutation(
    context: AssistantToolExecutionContext,
  ): Promise<ToolMutationTargetMatch> {
    const dateResolution = this.resolveSingleDate(context.userMessage, {
      fallbackDate: this.todayDateString(),
      defaultAmbiguity:
        'No explicit date detected, so record matching defaulted to today.',
    });
    const records = await this.listToolRecords(
      context.userId,
      dateResolution.date,
      {
        includeSleep: true,
      },
    );
    const hints: ToolMutationHints = {
      kindHint: this.extractDailyRecordKindHint(context.userMessage),
      numericHint: this.extractNumericHint(context.userMessage),
      titleHint: this.extractQuotedOrTailHint(context.userMessage),
      noteHint: this.extractNoteHint(context.userMessage),
    };
    const ambiguities = [...dateResolution.ambiguities];
    const candidateCount = records.length;

    if (candidateCount === 0) {
      return {
        date: dateResolution.date,
        record: null,
        matchedBy: dateResolution.matchedBy,
        ambiguities,
        reason: 'No records exist on the selected date.',
        confidence: {
          level: 'low',
          reason:
            'Record mutation requires an existing record, but none were found on that date.',
        },
        candidateCount,
      };
    }

    if (
      hints.kindHint == null &&
      hints.numericHint == null &&
      hints.titleHint == null &&
      hints.noteHint == null
    ) {
      ambiguities.push(
        'Missing a stable record identifier. Use a kind plus value, a quoted title, or a note fragment.',
      );
      return {
        date: dateResolution.date,
        record: null,
        matchedBy: dateResolution.matchedBy,
        ambiguities,
        reason:
          'The request did not include enough detail to identify one record safely.',
        confidence: {
          level: 'low',
          reason:
            'Update/delete proposals are withheld unless the target record can be identified with high confidence.',
        },
        candidateCount,
      };
    }

    const ranked = records
      .map((record, index) => this.rankMutationTarget(record, hints, index))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);

    const top = ranked[0];
    const second = ranked[1];
    if (top == null) {
      ambiguities.push(
        'The message hints did not match any existing record on the selected date.',
      );
      return {
        date: dateResolution.date,
        record: null,
        matchedBy: dateResolution.matchedBy,
        ambiguities,
        reason: 'No record matched the described kind/value/title/note hints.',
        confidence: {
          level: 'low',
          reason: 'No candidate record satisfied the requested mutation hints.',
        },
        candidateCount,
      };
    }

    const strongSignals = top.matchedBy.filter(
      (item) => item === 'value' || item === 'title' || item === 'note',
    );
    const hasStrongSignals = strongSignals.length > 0;
    const isSingleCandidateWithKind =
      candidateCount === 1 &&
      hints.kindHint != null &&
      top.matchedBy.includes('kind');
    const scoreGap =
      second == null ? Number.POSITIVE_INFINITY : top.score - second.score;

    if (!hasStrongSignals && !isSingleCandidateWithKind) {
      ambiguities.push(
        'Kind alone is not specific enough to mutate a record safely.',
      );
      return {
        date: dateResolution.date,
        record: null,
        matchedBy: [...dateResolution.matchedBy, ...top.matchedBy],
        ambiguities,
        reason: 'The best match is still too broad to modify safely.',
        confidence: {
          level: 'low',
          reason:
            'High-constraint mutation proposals require a stronger identifier than kind alone.',
        },
        candidateCount,
      };
    }

    if (scoreGap < 4) {
      ambiguities.push(
        'More than one record matched too closely, so no mutation proposal was created.',
      );
      return {
        date: dateResolution.date,
        record: null,
        matchedBy: [...dateResolution.matchedBy, ...top.matchedBy],
        ambiguities,
        reason:
          'Multiple nearby records remain too similar to distinguish safely.',
        confidence: {
          level: 'low',
          reason:
            'The highest-ranked candidate was not separated enough from the next candidate.',
        },
        candidateCount,
      };
    }

    return {
      date: dateResolution.date,
      record: top.record,
      matchedBy: [...dateResolution.matchedBy, ...top.matchedBy],
      ambiguities,
      reason: hasStrongSignals
        ? 'Matched one existing record with specific value/title/note evidence.'
        : 'Matched the only record on that date for the requested kind.',
      confidence: {
        level: hasStrongSignals ? 'high' : 'medium',
        reason: hasStrongSignals
          ? 'The target record was separated by specific user-provided hints.'
          : 'Only one record existed for the requested kind on the selected date.',
      },
      candidateCount,
    };
  }

  private rankMutationTarget(
    record: ToolRecordItem,
    hints: ToolMutationHints,
    index: number,
  ): ToolMutationRankedRecord {
    const matchedBy: string[] = [];
    let score = 0;

    if (hints.kindHint != null) {
      if (record.kind !== hints.kindHint) {
        return { record, score: 0, matchedBy };
      }
      matchedBy.push('kind');
      score += 10;
    }

    if (hints.numericHint != null) {
      if (record.value === hints.numericHint) {
        matchedBy.push('value');
        score += 8;
      }
    }

    if (
      hints.titleHint != null &&
      record.title != null &&
      record.title.toLowerCase().includes(hints.titleHint.toLowerCase())
    ) {
      matchedBy.push('title');
      score += 9;
    }

    if (
      hints.noteHint != null &&
      record.note != null &&
      record.note.toLowerCase().includes(hints.noteHint.toLowerCase())
    ) {
      matchedBy.push('note');
      score += 9;
    }

    if (matchedBy.length === 0 && hints.kindHint == null) {
      return { record, score: 0, matchedBy };
    }

    score += Math.max(0, 3 - index);
    return { record, score, matchedBy };
  }

  private resolveSingleDate(
    userMessage: string,
    input: {
      fallbackDate: string;
      defaultAmbiguity: string;
    },
  ): ToolSingleDateResolution {
    const iso = userMessage.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso?.[1] != null) {
      return {
        date: iso[1],
        matchedBy: ['explicit_iso_date'],
        ambiguities: [],
      };
    }

    const chinese = userMessage.match(/(\d{1,2})月(\d{1,2})日/);
    if (chinese?.[1] != null && chinese[2] != null) {
      const year = new Date().getUTCFullYear();
      const month = Number(chinese[1]);
      const day = Number(chinese[2]);
      return {
        date: this.makeDateString(year, month, day),
        matchedBy: ['explicit_month_day'],
        ambiguities: [],
      };
    }

    if (/今天|today/i.test(userMessage)) {
      return {
        date: this.todayDateString(),
        matchedBy: ['relative_today'],
        ambiguities: [],
      };
    }

    if (/昨天|yesterday/i.test(userMessage)) {
      return {
        date: this.offsetDateString(-1),
        matchedBy: ['relative_yesterday'],
        ambiguities: [],
      };
    }

    if (/前天/.test(userMessage)) {
      return {
        date: this.offsetDateString(-2),
        matchedBy: ['relative_day_before_yesterday'],
        ambiguities: [],
      };
    }

    return {
      date: input.fallbackDate,
      matchedBy: ['default_today'],
      ambiguities: [input.defaultAmbiguity],
    };
  }

  private resolveDateRange(userMessage: string): ToolRangeResolution {
    const explicitDates = Array.from(
      userMessage.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g),
      (match) => match[1],
    ).filter((value): value is string => typeof value === 'string');
    if (explicitDates.length >= 2) {
      const start = explicitDates[0];
      const end = explicitDates[1];
      if (start == null || end == null) {
        throw new Error('explicitDates length check failed unexpectedly');
      }
      const normalized = this.normalizeRange(start, end);
      const requestedDays = this.diffDaysInclusive(
        normalized.startDate,
        normalized.endDate,
      );
      return {
        ...normalized,
        matchedBy: ['explicit_range'],
        ambiguities:
          requestedDays > MAX_RANGE_DAYS
            ? [REQUEST_RANGE_CAP_MESSAGE(requestedDays, MAX_RANGE_DAYS)]
            : [],
        truncated: requestedDays > MAX_RANGE_DAYS,
        requestedDays,
      };
    }

    const recentDays = userMessage.match(/近\s*(\d+)\s*天/);
    if (recentDays?.[1] != null) {
      const requestedDays = Math.max(1, Number(recentDays[1]));
      const boundedDays = Math.min(MAX_RANGE_DAYS, requestedDays);
      return {
        startDate: this.offsetDateString(-(boundedDays - 1)),
        endDate: this.todayDateString(),
        matchedBy: ['relative_recent_days'],
        ambiguities:
          requestedDays > MAX_RANGE_DAYS
            ? [REQUEST_RANGE_CAP_MESSAGE(requestedDays, MAX_RANGE_DAYS)]
            : [],
        truncated: requestedDays > MAX_RANGE_DAYS,
        requestedDays,
      };
    }

    if (/这周/.test(userMessage)) {
      return {
        startDate: this.offsetDateString(-6),
        endDate: this.todayDateString(),
        matchedBy: ['relative_this_week'],
        ambiguities: [],
        truncated: false,
        requestedDays: 7,
      };
    }

    if (/上周/.test(userMessage)) {
      return {
        startDate: this.offsetDateString(-13),
        endDate: this.offsetDateString(-7),
        matchedBy: ['relative_last_week'],
        ambiguities: [],
        truncated: false,
        requestedDays: 7,
      };
    }

    if (/昨天|yesterday/i.test(userMessage)) {
      const date = this.offsetDateString(-1);
      return {
        startDate: date,
        endDate: date,
        matchedBy: ['relative_yesterday'],
        ambiguities: [],
        truncated: false,
        requestedDays: 1,
      };
    }

    if (/今天|today/i.test(userMessage)) {
      const date = this.todayDateString();
      return {
        startDate: date,
        endDate: date,
        matchedBy: ['relative_today'],
        ambiguities: [],
        truncated: false,
        requestedDays: 1,
      };
    }

    return {
      startDate: this.offsetDateString(-(DEFAULT_RANGE_DAYS - 1)),
      endDate: this.todayDateString(),
      matchedBy: ['default_recent_window'],
      ambiguities: [DEFAULT_RANGE_FALLBACK_MESSAGE(DEFAULT_RANGE_DAYS)],
      truncated: false,
      requestedDays: DEFAULT_RANGE_DAYS,
    };
  }

  private resolveReportRangeFromKey(
    rangeKey: ReportRange,
  ): ToolRangeResolution {
    const days =
      rangeKey === REPORT_RANGE_LAST_30_DAYS ? 30 : DEFAULT_RANGE_DAYS;
    return {
      startDate: this.offsetDateString(-(days - 1)),
      endDate: this.todayDateString(),
      matchedBy: [rangeKey],
      ambiguities: [],
      truncated: false,
      requestedDays: days,
    };
  }

  private extractDailyRecordKindHint(userMessage: string): string | null {
    if (/喝水|饮水|water/i.test(userMessage)) {
      return DailyRecordKind.water;
    }
    if (/吃饭|饮食|meal/i.test(userMessage)) {
      return DailyRecordKind.meal;
    }
    if (/症状|头痛|不舒服|symptom/i.test(userMessage)) {
      return DailyRecordKind.symptom;
    }
    if (/备注|自定义|note/i.test(userMessage)) {
      return DailyRecordKind.note;
    }
    if (/睡眠|睡觉|sleep/i.test(userMessage)) {
      return DailyRecordKind.sleep;
    }
    return null;
  }

  private extractRecordUpdateDraft(
    userMessage: string,
  ): AssistantUpdateDailyRecordProposalPayload['draft'] | null {
    const draft: AssistantUpdateDailyRecordProposalPayload['draft'] = {};
    const waterValueMatch = userMessage.match(
      /(\d+)\s*(ml|毫升|cup|cups|杯|次)/i,
    );
    if (waterValueMatch?.[1] != null) {
      draft.value = waterValueMatch[1];
      draft.unit = this.normalizeUnit(waterValueMatch[2] ?? null);
    }
    const noteMatch = userMessage.match(
      /(?:备注|note|改成|改为|更新为)\s*[:：]?\s*(.+)$/i,
    );
    if (noteMatch?.[1] != null) {
      draft.note = noteMatch[1].trim().replace(/^(?:改成|改为|更新为)\s*/i, '');
    }
    const titleMatch = userMessage.match(/(?:标题|title)\s*[:：]?\s*(.+)$/i);
    if (titleMatch?.[1] != null) {
      draft.title = titleMatch[1].trim();
    }
    return Object.keys(draft).length > 0 ? draft : null;
  }

  private extractSettingsDraft(
    userMessage: string,
  ): AssistantUpdateUserSettingsProposalPayload['draft'] {
    const draft: AssistantUpdateUserSettingsProposalPayload['draft'] = {};
    const lowered = userMessage.toLowerCase();
    if (/关闭.*ai|disable.*ai|turn off.*ai/.test(lowered)) {
      draft.assistantEnabled = false;
    } else if (/打开.*ai|enable.*ai|turn on.*ai/.test(lowered)) {
      draft.assistantEnabled = true;
    }
    if (/关闭.*记忆|disable.*memory|turn off.*memory/.test(lowered)) {
      draft.assistantMemoryEnabled = false;
    } else if (/打开.*记忆|enable.*memory|turn on.*memory/.test(lowered)) {
      draft.assistantMemoryEnabled = true;
    }
    const contextDraft: NonNullable<
      AssistantUpdateUserSettingsProposalPayload['draft']['assistantContext']
    > = {};
    this.applyContextToggle(
      contextDraft,
      lowered,
      'healthProfile',
      /健康档案|profile/,
    );
    this.applyContextToggle(
      contextDraft,
      lowered,
      'dailyRecords',
      /记录|daily record/,
    );
    this.applyContextToggle(
      contextDraft,
      lowered,
      'sleepRecords',
      /睡眠|sleep/,
    );
    this.applyContextToggle(
      contextDraft,
      lowered,
      'currentMedicines',
      /用药|药物|medicine|medication/,
    );
    if (Object.keys(contextDraft).length > 0) {
      draft.assistantContext = contextDraft;
    }
    return draft;
  }

  private applyContextToggle(
    output: Record<string, boolean>,
    lowered: string,
    key: 'healthProfile' | 'dailyRecords' | 'sleepRecords' | 'currentMedicines',
    rule: RegExp,
  ) {
    if (!rule.test(lowered)) {
      return;
    }
    if (/关闭|disable|turn off/.test(lowered)) {
      output[key] = false;
      return;
    }
    if (/打开|enable|turn on/.test(lowered)) {
      output[key] = true;
    }
  }

  private buildCreateRecordPreviewFields(
    item: {
      kind: string;
      occurredAt: string;
      title: string | null;
      value: string | null;
      unit: string | null;
      note: string | null;
    },
    locale: 'zh-CN' | 'en',
  ) {
    const fields = [
      {
        label: this.localeText(locale, '类型', 'Kind'),
        value: item.kind,
      },
      {
        label: this.localeText(locale, '日期', 'Date'),
        value: item.occurredAt,
      },
    ];
    if (item.value != null) {
      fields.push({
        label: this.localeText(locale, '数值', 'Value'),
        value: item.unit != null ? `${item.value} ${item.unit}` : item.value,
      });
    }
    if (item.title != null) {
      fields.push({
        label: this.localeText(locale, '标题', 'Title'),
        value: item.title,
      });
    }
    if (item.note != null) {
      fields.push({
        label: this.localeText(locale, '备注', 'Note'),
        value: item.note,
      });
    }
    return fields;
  }

  private buildUpdateRecordPreviewFields(
    draft: AssistantUpdateDailyRecordProposalPayload['draft'],
    locale: 'zh-CN' | 'en',
  ) {
    const fields: Array<{ label: string; value: string }> = [];
    if (draft.title != null) {
      fields.push({
        label: this.localeText(locale, '标题', 'Title'),
        value: draft.title,
      });
    }
    if (draft.value != null) {
      fields.push({
        label: this.localeText(locale, '数值', 'Value'),
        value:
          draft.unit != null ? `${draft.value} ${draft.unit}` : draft.value,
      });
    }
    if (draft.note != null) {
      fields.push({
        label: this.localeText(locale, '备注', 'Note'),
        value: draft.note,
      });
    }
    return fields;
  }

  private buildSettingsPreviewFields(
    draft: AssistantUpdateUserSettingsProposalPayload['draft'],
    locale: 'zh-CN' | 'en',
  ) {
    const fields: Array<{ label: string; value: string }> = [];
    if (draft.assistantEnabled != null) {
      fields.push({
        label: this.localeText(locale, '助手', 'Assistant'),
        value: this.boolText(draft.assistantEnabled, locale),
      });
    }
    if (draft.assistantMemoryEnabled != null) {
      fields.push({
        label: this.localeText(locale, '持久化记忆', 'Persistent memory'),
        value: this.boolText(draft.assistantMemoryEnabled, locale),
      });
    }
    if (draft.assistantContext != null) {
      for (const [key, value] of Object.entries(draft.assistantContext)) {
        fields.push({
          label: this.contextPreviewLabel(key, locale),
          value: this.boolText(value, locale),
        });
      }
    }
    return fields;
  }

  private contextPreviewLabel(key: string, locale: 'zh-CN' | 'en'): string {
    switch (key) {
      case 'healthProfile':
        return this.localeText(locale, '健康档案', 'Health profile');
      case 'dailyRecords':
        return this.localeText(locale, '最近记录', 'Recent records');
      case 'sleepRecords':
        return this.localeText(locale, '睡眠数据', 'Sleep data');
      case 'currentMedicines':
        return this.localeText(locale, '当前用药', 'Current medicines');
      default:
        return key;
    }
  }

  private describeCreateRecordSummary(
    item: {
      kind: string;
      occurredAt: string;
      value: string | null;
      unit: string | null;
    },
    locale: 'zh-CN' | 'en',
  ): string {
    if (locale === 'zh-CN') {
      return item.value != null
        ? `准备保存一条 ${item.occurredAt} 的 ${item.kind} 记录。`
        : `准备保存一条 ${item.occurredAt} 的记录。`;
    }
    return `Ready to save one ${item.kind} record for ${item.occurredAt}.`;
  }

  private describeUpdateRecordSummary(
    target: ToolRecordItem,
    locale: 'zh-CN' | 'en',
  ): string {
    return locale === 'zh-CN'
      ? `准备修改 ${target.occurredAt} 的一条 ${target.kind} 记录。`
      : `Ready to update one ${target.kind} record from ${target.occurredAt}.`;
  }

  private describeDeleteRecordSummary(
    target: ToolRecordItem,
    locale: 'zh-CN' | 'en',
  ): string {
    return locale === 'zh-CN'
      ? `准备删除 ${target.occurredAt} 的一条 ${target.kind} 记录。`
      : `Ready to delete one ${target.kind} record from ${target.occurredAt}.`;
  }

  private describeRecordTargetLabel(
    item: {
      kind: string;
      occurredAt: string;
      value?: string | null;
      unit?: string | null;
    },
    locale: 'zh-CN' | 'en',
  ): string {
    const valuePart =
      item.value != null
        ? ` ${item.value}${item.unit != null ? ` ${item.unit}` : ''}`
        : '';
    return locale === 'zh-CN'
      ? `${item.occurredAt} ${item.kind}${valuePart}`
      : `${item.occurredAt} ${item.kind}${valuePart}`;
  }

  private collectSettingsDraftKeys(
    draft: AssistantUpdateUserSettingsProposalPayload['draft'],
  ): string[] {
    const keys: string[] = [];
    if (draft.assistantEnabled != null) {
      keys.push('assistantEnabled');
    }
    if (draft.assistantMemoryEnabled != null) {
      keys.push('assistantMemoryEnabled');
    }
    if (draft.assistantContext != null) {
      for (const key of Object.keys(draft.assistantContext)) {
        keys.push(`assistantContext.${key}`);
      }
    }
    return keys;
  }

  private buildReadEnvelope(input: {
    toolName: AssistantToolName;
    query: Record<string, unknown>;
    result: Record<string, unknown>;
    coverage: AssistantReadCoverage;
    timeRange: AssistantReadResultEnvelope['timeRange'];
    confidence: AssistantReadConfidence;
    ambiguities: string[];
    tables: string[];
  }): AssistantReadResultEnvelope {
    return {
      query: input.query,
      result: input.result,
      coverage: input.coverage,
      timeRange: input.timeRange,
      source: {
        tool: input.toolName,
        generatedAt: new Date().toISOString(),
        tables: input.tables,
      },
      confidence: input.confidence,
      ambiguities: input.ambiguities,
    };
  }

  private buildDailyRecordCoverage(input: {
    hasData: boolean;
    sleepIncluded: boolean;
  }): AssistantReadCoverage {
    if (!input.sleepIncluded) {
      return {
        status: 'partial',
        reason: 'Sleep records are excluded because sleep context is disabled.',
        omittedContextSources: ['sleep_records'],
        omittedKinds: ['sleep'],
      };
    }
    if (!input.hasData) {
      return {
        status: 'empty',
        reason: 'No daily records were found for the selected date.',
      };
    }
    return {
      status: 'complete',
      reason: null,
    };
  }

  private buildDailyRecordRangeCoverage(input: {
    total: number;
    truncated: boolean;
    sleepIncluded: boolean;
  }): AssistantReadCoverage {
    const reasons: string[] = [];
    if (input.truncated) {
      reasons.push(RANGE_TRUNCATED_MESSAGE(MAX_RANGE_DAYS));
    }
    if (!input.sleepIncluded) {
      reasons.push(
        'Sleep records are excluded because sleep context is disabled.',
      );
    }
    if (reasons.length > 0) {
      const coverage: AssistantReadCoverage = {
        status: 'partial',
        reason: reasons.join(' '),
      };
      if (!input.sleepIncluded) {
        coverage.omittedContextSources = ['sleep_records'];
        coverage.omittedKinds = [DailyRecordKind.sleep];
      }
      return coverage;
    }
    if (input.total === 0) {
      return {
        status: 'empty',
        reason: 'No daily records were found in the selected range.',
      };
    }
    return {
      status: 'complete',
      reason: null,
    };
  }

  private buildReadConfidence(input: {
    ambiguities: string[];
    truncated?: boolean;
    preferredReason: string;
  }): AssistantReadConfidence {
    if (input.ambiguities.length === 0 && !input.truncated) {
      return {
        level: 'high',
        reason: input.preferredReason,
      };
    }
    if (input.ambiguities.length <= 2) {
      return {
        level: 'medium',
        reason: input.preferredReason,
      };
    }
    return {
      level: 'low',
      reason: input.preferredReason,
    };
  }

  private buildProposalExpiryIso(): string {
    return new Date(
      Date.now() + PROPOSAL_TTL_MINUTES * 60 * 1000,
    ).toISOString();
  }

  private localeText(
    locale: 'zh-CN' | 'en',
    zhText: string,
    enText: string,
  ): string {
    return locale === 'zh-CN' ? zhText : enText;
  }

  private boolText(value: boolean, locale: 'zh-CN' | 'en'): string {
    return locale === 'zh-CN'
      ? value
        ? '开启'
        : '关闭'
      : value
        ? 'On'
        : 'Off';
  }

  private normalizeUnit(raw: string | null): string | null {
    if (raw == null) {
      return null;
    }
    const normalized = raw.trim().toLowerCase();
    if (normalized === '毫升') {
      return 'ml';
    }
    if (normalized === '杯' || normalized === 'cups') {
      return 'cup';
    }
    if (normalized === '次') {
      return 'times';
    }
    return normalized.length > 0 ? normalized : null;
  }

  private extractReportRangeKey(userMessage: string): ReportRange | null {
    if (/30天|月报|last 30 days/i.test(userMessage)) {
      return REPORT_RANGE_LAST_30_DAYS;
    }
    if (/7天|周报|last 7 days/i.test(userMessage)) {
      return REPORT_RANGE_LAST_7_DAYS;
    }
    return null;
  }

  private extractNumericHint(userMessage: string): string | null {
    const match = userMessage.match(
      /\b(\d+(?:\.\d+)?)\s*(ml|毫升|cup|cups|杯|次)?/i,
    );
    return match?.[1] != null ? match[1].trim() : null;
  }

  private extractQuotedOrTailHint(userMessage: string): string | null {
    const quoted = userMessage.match(/["“](.+?)["”]/);
    if (quoted?.[1] != null) {
      return quoted[1].trim();
    }
    const tail = userMessage.match(
      /(?:标题|title|那条|这条)\s*[:：]?\s*(.+)$/i,
    );
    return tail?.[1] != null ? tail[1].trim() : null;
  }

  private extractNoteHint(userMessage: string): string | null {
    const noteMatch = userMessage.match(
      /(?:备注|note|内容|content)\s*[:：]?\s*(.+)$/i,
    );
    return noteMatch?.[1] != null ? noteMatch[1].trim() : null;
  }

  private normalizeRange(startDate: string, endDate: string): ToolDateRange {
    return startDate <= endDate
      ? { startDate, endDate }
      : { startDate: endDate, endDate: startDate };
  }

  private diffDaysInclusive(startDate: string, endDate: string): number {
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  }

  private enumerateDates(
    startDate: string,
    endDate: string,
    maxDays = Number.POSITIVE_INFINITY,
  ): string[] {
    const dates: string[] = [];
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    for (
      let cursor = start, index = 0;
      cursor.getTime() <= end.getTime() && index < maxDays;
      cursor = new Date(
        Date.UTC(
          cursor.getUTCFullYear(),
          cursor.getUTCMonth(),
          cursor.getUTCDate() + 1,
        ),
      ),
        index += 1
    ) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    return dates;
  }

  private todayDateString(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private offsetDateString(offsetDays: number): string {
    const now = new Date();
    const shifted = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + offsetDays,
      ),
    );
    return shifted.toISOString().slice(0, 10);
  }

  private makeDateString(year: number, month: number, day: number): string {
    return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
  }

  private mapSleepQuality(value: string | null): number | null {
    switch (value) {
      case 'poor':
        return 1;
      case 'fair':
        return 2;
      case 'good':
        return 3;
      default:
        return null;
    }
  }

  private describeReminderFrequency(
    reminders: Array<{
      daysOfWeek?: unknown;
      scheduledHour: number;
      scheduledMinute: number;
    }>,
  ): string | null {
    if (reminders.length === 0) {
      return null;
    }
    const first = reminders[0];
    if (first == null) {
      return null;
    }
    const daily =
      Array.isArray(first.daysOfWeek) && first.daysOfWeek.length > 0
        ? `${String(first.daysOfWeek.length)} days/week`
        : 'daily';
    const times = reminders
      .map(
        (item) =>
          `${item.scheduledHour.toString().padStart(2, '0')}:${item.scheduledMinute
            .toString()
            .padStart(2, '0')}`,
      )
      .join(', ');
    return `${daily} @ ${times}`;
  }
}
