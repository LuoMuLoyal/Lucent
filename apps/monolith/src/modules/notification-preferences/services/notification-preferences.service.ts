import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '#generated/prisma/client.js';
import { PrismaService } from '../../../prisma/index.js';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result/index.js';
import { fromPrismaResult } from '../../../common/index.js';
import type { UpdateNotificationPreferencesDto } from '../dto/update.dto.js';
import type { NotificationPreferencesDataDto } from '../dto/response.dto.js';

export const NOTIFICATION_PREFERENCE_DEFAULTS = {
  isHealthAlertsEnabled: true,
  isWeeklyInsightEnabled: false,
  isWaterRemindersEnabled: true,
  isSleepReminderEnabled: false,
  sleepBedtimeMinutes: null,
  sleepWakeTimeMinutes: null,
} as const;

const HEALTH_ALERT_RULE_IDS = new Set([
  'sleep_shortfall',
  'event_check_in_trend',
  'deteriorating_symptom',
]);
const WATER_RULE_ID = 'water_behind_target';

@Injectable()
export class NotificationPreferencesService {
  private readonly logger = new Logger(NotificationPreferencesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<NotificationPreferencesDataDto> {
    const row = await this.prisma.userNotificationPreference.findUnique({
      where: { userId },
    });

    if (row == null) {
      return {
        ...NOTIFICATION_PREFERENCE_DEFAULTS,
        configured: false,
        updatedAt: null,
      };
    }

    return this.toDto(row);
  }

  async isRuleEnabled(userId: string, ruleId: string): Promise<boolean> {
    if (!HEALTH_ALERT_RULE_IDS.has(ruleId) && ruleId !== WATER_RULE_ID) {
      return true;
    }

    try {
      const preferences = await this.get(userId);
      return HEALTH_ALERT_RULE_IDS.has(ruleId)
        ? preferences.isHealthAlertsEnabled
        : preferences.isWaterRemindersEnabled;
    } catch (error) {
      // Notification preferences are a delivery gate, not a prerequisite for
      // materializing Today suggestions. Fail closed for the notification
      // only when the preference store is unavailable.
      this.logger.warn(
        `Notification preference lookup failed for user ${userId}, failing closed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  patch(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ): ResultAsync<NotificationPreferencesDataDto, DomainFailure> {
    const minutesFailure =
      this.validateMinutes(dto.sleepBedtimeMinutes, 'sleepBedtimeMinutes') ??
      this.validateMinutes(dto.sleepWakeTimeMinutes, 'sleepWakeTimeMinutes');
    if (minutesFailure != null) {
      return errAsync(minutesFailure);
    }

    const data = this.buildUpdateData(dto);

    if (Object.keys(data).length === 0) {
      return fromPromise(this.get(userId), (error) => {
        throw error;
      });
    }

    return fromPrismaResult(
      this.prisma.userNotificationPreference.upsert({
        where: { userId },
        create: {
          userId,
          isHealthAlertsEnabled:
            dto.isHealthAlertsEnabled ??
            NOTIFICATION_PREFERENCE_DEFAULTS.isHealthAlertsEnabled,
          isWeeklyInsightEnabled:
            dto.isWeeklyInsightEnabled ??
            NOTIFICATION_PREFERENCE_DEFAULTS.isWeeklyInsightEnabled,
          isWaterRemindersEnabled:
            dto.isWaterRemindersEnabled ??
            NOTIFICATION_PREFERENCE_DEFAULTS.isWaterRemindersEnabled,
          isSleepReminderEnabled:
            dto.isSleepReminderEnabled ??
            NOTIFICATION_PREFERENCE_DEFAULTS.isSleepReminderEnabled,
          sleepBedtimeMinutes: dto.sleepBedtimeMinutes ?? null,
          sleepWakeTimeMinutes: dto.sleepWakeTimeMinutes ?? null,
        },
        update: data,
      }),
    ).map((row) => this.toDto(row));
  }

  private buildUpdateData(
    dto: UpdateNotificationPreferencesDto,
  ): Prisma.UserNotificationPreferenceUpdateInput {
    const data: Prisma.UserNotificationPreferenceUpdateInput = {};
    if (dto.isHealthAlertsEnabled !== undefined) {
      data.isHealthAlertsEnabled = dto.isHealthAlertsEnabled;
    }
    if (dto.isWeeklyInsightEnabled !== undefined) {
      data.isWeeklyInsightEnabled = dto.isWeeklyInsightEnabled;
    }
    if (dto.isWaterRemindersEnabled !== undefined) {
      data.isWaterRemindersEnabled = dto.isWaterRemindersEnabled;
    }
    if (dto.isSleepReminderEnabled !== undefined) {
      data.isSleepReminderEnabled = dto.isSleepReminderEnabled;
    }
    if (dto.sleepBedtimeMinutes !== undefined) {
      data.sleepBedtimeMinutes = dto.sleepBedtimeMinutes;
    }
    if (dto.sleepWakeTimeMinutes !== undefined) {
      data.sleepWakeTimeMinutes = dto.sleepWakeTimeMinutes;
    }
    return data;
  }

  private validateMinutes(
    value: number | null | undefined,
    field: string,
  ): DomainFailure | null {
    if (value == null) return null;
    if (!Number.isInteger(value) || value < 0 || value > 1439) {
      return createDomainFailure({
        kind: 'validation',
        code: 'VALIDATION_FAILED',
        args: { field, min: 0, max: 1439 },
      });
    }
    return null;
  }

  private toDto(row: {
    isHealthAlertsEnabled: boolean;
    isWeeklyInsightEnabled: boolean;
    isWaterRemindersEnabled: boolean;
    isSleepReminderEnabled: boolean;
    sleepBedtimeMinutes: number | null;
    sleepWakeTimeMinutes: number | null;
    updatedAt: Date;
  }): NotificationPreferencesDataDto {
    return {
      isHealthAlertsEnabled: row.isHealthAlertsEnabled,
      isWeeklyInsightEnabled: row.isWeeklyInsightEnabled,
      isWaterRemindersEnabled: row.isWaterRemindersEnabled,
      isSleepReminderEnabled: row.isSleepReminderEnabled,
      sleepBedtimeMinutes: row.sleepBedtimeMinutes,
      sleepWakeTimeMinutes: row.sleepWakeTimeMinutes,
      configured: true,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
