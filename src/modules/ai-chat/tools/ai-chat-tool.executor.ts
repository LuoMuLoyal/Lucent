import { Injectable } from '@nestjs/common';
import { AiSummaryHistoryService } from '../ai-summary-history.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { DailyRecordKind } from '../../../generated/prisma/client';
import { UserHealthContextService } from '../../user-health-context/user-health-context.service';
import { DailyRecordsService } from '../../daily-records/daily-records.service';
import { MedicineRemindersService } from '../../medicine-reminders/medicine-reminders.service';
import { UserSettingsService } from '../../user-settings/user-settings.service';
import type {
  AiChatToolExecutionContext,
  AiChatToolExecutionResult,
} from '../ai-chat.types';
import type { AiChatToolName } from './ai-chat-tool.types';

const DEFAULT_RANGE_DAYS = 7;
const MAX_RANGE_DAYS = 14;
const DEFAULT_HISTORY_LIMIT = 10;

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
};

@Injectable()
export class AiChatToolExecutor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiSummaryHistoryService: AiSummaryHistoryService,
    private readonly userHealthContextService: UserHealthContextService,
    private readonly dailyRecordsService: DailyRecordsService,
    private readonly medicineRemindersService: MedicineRemindersService,
    private readonly userSettingsService: UserSettingsService,
  ) {}

  async executeMany(
    context: AiChatToolExecutionContext,
    toolNames: readonly AiChatToolName[],
  ): Promise<AiChatToolExecutionResult[]> {
    const results: AiChatToolExecutionResult[] = [];

    for (const toolName of toolNames) {
      results.push(await this.executeOne(context, toolName));
    }

    return results;
  }

  private async executeOne(
    context: AiChatToolExecutionContext,
    toolName: AiChatToolName,
  ): Promise<AiChatToolExecutionResult> {
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
    }
  }

  private async buildTodayRecords(
    context: AiChatToolExecutionContext,
  ): Promise<Record<string, unknown>> {
    const date = this.todayDateString();
    const records = await this.listToolRecords(context.userId, date, {
      includeSleep: this.canReadSleep(context),
    });

    return {
      timezone: 'UTC',
      date,
      records,
      total: records.length,
    };
  }

  private async buildRecordsByDate(
    context: AiChatToolExecutionContext,
  ): Promise<Record<string, unknown>> {
    const date =
      this.extractSingleDate(context.userMessage) ?? this.todayDateString();
    const records = await this.listToolRecords(context.userId, date, {
      includeSleep: this.canReadSleep(context),
    });

    return {
      timezone: 'UTC',
      date,
      records,
      total: records.length,
    };
  }

  private async buildRecordsByRange(
    context: AiChatToolExecutionContext,
  ): Promise<Record<string, unknown>> {
    const range = this.extractDateRange(context.userMessage);
    const dates = this.enumerateDates(range.startDate, range.endDate);
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

    return {
      timezone: 'UTC',
      startDate: range.startDate,
      endDate: range.endDate,
      truncated: false,
      days,
    };
  }

  private async buildRecentTodaySummaries(
    context: AiChatToolExecutionContext,
  ): Promise<Record<string, unknown>> {
    const summaries =
      await this.aiSummaryHistoryService.listRecentTodaySummaries(
        context.userId,
        DEFAULT_HISTORY_LIMIT,
      );

    return {
      summaries,
      total: summaries.length,
    };
  }

  private async buildRecentReportSummaries(
    context: AiChatToolExecutionContext,
  ): Promise<Record<string, unknown>> {
    const summaries =
      await this.aiSummaryHistoryService.listRecentReportSummaries(
        context.userId,
        DEFAULT_HISTORY_LIMIT,
      );

    return {
      summaries,
      total: summaries.length,
    };
  }

  private async buildUserProfile(
    context: AiChatToolExecutionContext,
  ): Promise<Record<string, unknown>> {
    const health = await this.userHealthContextService.getForUser(
      context.userId,
    );
    const account = await this.prisma.user.findFirst({
      where: { id: context.userId, deletedAt: null },
      select: {
        nickname: true,
      },
    });

    return {
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
    };
  }

  private async buildUserSettings(
    context: AiChatToolExecutionContext,
  ): Promise<Record<string, unknown>> {
    const settings = await this.userSettingsService.getSettings(context.userId);

    return {
      settings: {
        aiSummariesEnabled: settings.aiSummariesEnabled,
        dataSharingConsent: settings.dataSharingConsent,
        aiChatEnabled: settings.aiChatEnabled,
        aiChatMemoryEnabled: settings.aiChatMemoryEnabled,
        aiChatContext: settings.aiChatContext,
      },
    };
  }

  private async buildCurrentMedicines(
    context: AiChatToolExecutionContext,
  ): Promise<Record<string, unknown>> {
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

    return {
      medicines,
      total: medicines.length,
    };
  }

  private async buildSleepSummaryByRange(
    context: AiChatToolExecutionContext,
  ): Promise<Record<string, unknown>> {
    const range = this.extractDateRange(context.userMessage);
    const dates = this.enumerateDates(range.startDate, range.endDate);
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

    return {
      startDate: range.startDate,
      endDate: range.endDate,
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
      entries,
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
      }));
  }

  private canReadSleep(context: AiChatToolExecutionContext): boolean {
    return context.enabledContextSources.includes('sleep_records');
  }

  private extractSingleDate(userMessage: string): string | null {
    if (/今天|today/i.test(userMessage)) {
      return this.todayDateString();
    }
    if (/昨天/.test(userMessage)) {
      return this.offsetDateString(-1);
    }
    if (/前天/.test(userMessage)) {
      return this.offsetDateString(-2);
    }

    const iso = userMessage.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso?.[1] != null) {
      return iso[1];
    }

    const chinese = userMessage.match(/(\d{1,2})月(\d{1,2})日/);
    if (chinese?.[1] != null && chinese[2] != null) {
      const year = new Date().getUTCFullYear();
      const month = Number(chinese[1]);
      const day = Number(chinese[2]);
      return this.makeDateString(year, month, day);
    }

    return null;
  }

  private extractDateRange(userMessage: string): ToolDateRange {
    const explicitDates = Array.from(
      userMessage.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g),
      (match) => match[1],
    ).filter((value): value is string => typeof value === 'string');
    if (explicitDates.length >= 2) {
      const startDate = explicitDates[0];
      const endDate = explicitDates[1];
      if (startDate != null && endDate != null) {
        return this.normalizeRange(startDate, endDate);
      }
    }

    const recentDays = userMessage.match(/近\s*(\d+)\s*天/);
    if (recentDays?.[1] != null) {
      const days = Math.max(1, Math.min(MAX_RANGE_DAYS, Number(recentDays[1])));
      return {
        startDate: this.offsetDateString(-(days - 1)),
        endDate: this.todayDateString(),
      };
    }

    if (/这周/.test(userMessage)) {
      return {
        startDate: this.offsetDateString(-6),
        endDate: this.todayDateString(),
      };
    }

    if (/上周/.test(userMessage)) {
      return {
        startDate: this.offsetDateString(-13),
        endDate: this.offsetDateString(-7),
      };
    }

    if (/昨天/.test(userMessage)) {
      const date = this.offsetDateString(-1);
      return { startDate: date, endDate: date };
    }

    if (/今天|today/i.test(userMessage)) {
      const date = this.todayDateString();
      return { startDate: date, endDate: date };
    }

    return {
      startDate: this.offsetDateString(-(DEFAULT_RANGE_DAYS - 1)),
      endDate: this.todayDateString(),
    };
  }

  private normalizeRange(startDate: string, endDate: string): ToolDateRange {
    return startDate <= endDate
      ? { startDate, endDate }
      : { startDate: endDate, endDate: startDate };
  }

  private enumerateDates(startDate: string, endDate: string): string[] {
    const dates: string[] = [];
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    const maxDays = MAX_RANGE_DAYS;

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
