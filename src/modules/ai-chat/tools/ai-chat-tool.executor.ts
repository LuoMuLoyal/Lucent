import { Injectable } from '@nestjs/common';
import { UserHealthContextService } from '../../user-health-context/user-health-context.service';
import { DailyRecordsService } from '../../daily-records/daily-records.service';
import { MedicineRemindersService } from '../../medicine-reminders/medicine-reminders.service';
import type { AiChatToolExecutionResult } from '../ai-chat.types';
import type { AiChatToolName } from './ai-chat-tool.types';

const DEFAULT_RECENT_DAYS = 3;

@Injectable()
export class AiChatToolExecutor {
  constructor(
    private readonly userHealthContextService: UserHealthContextService,
    private readonly dailyRecordsService: DailyRecordsService,
    private readonly medicineRemindersService: MedicineRemindersService,
  ) {}

  async executeMany(
    userId: string,
    locale: string,
    toolNames: readonly AiChatToolName[],
  ): Promise<AiChatToolExecutionResult[]> {
    const results: AiChatToolExecutionResult[] = [];

    for (const toolName of toolNames) {
      results.push(await this.executeOne(userId, locale, toolName));
    }

    return results;
  }

  private async executeOne(
    userId: string,
    locale: string,
    toolName: AiChatToolName,
  ): Promise<AiChatToolExecutionResult> {
    switch (toolName) {
      case 'health_context_snapshot':
        return {
          name: toolName,
          data: await this.buildHealthContextSnapshot(userId),
        };
      case 'recent_daily_records':
        return {
          name: toolName,
          data: await this.buildRecentDailyRecords(userId),
        };
      case 'recent_sleep_summary':
        return {
          name: toolName,
          data: await this.buildRecentSleepSummary(userId),
        };
      case 'current_medicines':
        return {
          name: toolName,
          data: await this.buildCurrentMedicines(userId, locale),
        };
    }
  }

  private async buildHealthContextSnapshot(
    userId: string,
  ): Promise<Record<string, unknown>> {
    const context = await this.userHealthContextService.getForUser(userId);

    return {
      summary: context.summary,
      profile: {
        birthDate: context.profile.birthDate,
        sexAtBirth: context.profile.sexAtBirth,
        heightCm: context.profile.heightCm,
        pregnancyState: context.profile.pregnancyState,
        lactationState: context.profile.lactationState,
        bloodType: context.profile.bloodType,
        locale: context.profile.locale,
        timezone: context.profile.timezone,
        unitSystem: context.profile.unitSystem,
      },
      allergies: context.allergies
        .filter((item) => item.isActive)
        .map((item) => ({
          kind: item.kind,
          label: item.label,
          reaction: item.reaction,
          severity: item.severity,
        })),
      conditions: context.conditions.map((item) => ({
        label: item.label,
        status: item.status,
        diagnosedAt: item.diagnosedAt,
        resolvedAt: item.resolvedAt,
      })),
    };
  }

  private async buildRecentDailyRecords(
    userId: string,
  ): Promise<Record<string, unknown>> {
    const dates = this.recentDateStrings(DEFAULT_RECENT_DAYS);
    const dailyGroups = await Promise.all(
      dates.map(async (date) => ({
        date,
        summary: await this.dailyRecordsService.summary(userId, date),
      })),
    );

    return {
      days: dailyGroups.map((group) => ({
        date: group.date,
        items: group.summary.summaries.slice(0, 20),
      })),
    };
  }

  private async buildRecentSleepSummary(
    userId: string,
  ): Promise<Record<string, unknown>> {
    const dates = this.recentDateStrings(DEFAULT_RECENT_DAYS);
    const sleepDays = await Promise.all(
      dates.map(async (date) => {
        const summary = await this.dailyRecordsService.summary(userId, date);
        const sleep =
          summary.summaries.find((item) => item.kind === 'sleep') ?? null;
        return {
          date,
          sleep,
        };
      }),
    );

    return {
      days: sleepDays,
    };
  }

  private async buildCurrentMedicines(
    userId: string,
    locale: string,
  ): Promise<Record<string, unknown>> {
    const context = await this.userHealthContextService.getForUser(userId);
    const reminders = await this.medicineRemindersService.list(userId, true);

    return {
      locale,
      currentMedicines: context.currentMedicines
        .filter((item) => item.isCurrent)
        .map((item) => ({
          displayName: item.displayName,
          strengthText: item.strengthText,
          doseText: item.doseText,
          route: item.route,
          startedAt: item.startedAt,
          note: item.note,
        })),
      activeReminders: reminders.items.map((item) => ({
        currentMedicineId: item.currentMedicineId,
        label: item.label,
        scheduledHour: item.scheduledHour,
        scheduledMinute: item.scheduledMinute,
        daysOfWeek: item.daysOfWeek,
        startDate: item.startDate,
        endDate: item.endDate,
      })),
    };
  }

  private recentDateStrings(days: number): string[] {
    const today = new Date();
    const dates: string[] = [];

    for (let offset = 0; offset < days; offset += 1) {
      const current = new Date(
        Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate() - offset,
        ),
      );
      dates.push(current.toISOString().slice(0, 10));
    }

    return dates;
  }
}
