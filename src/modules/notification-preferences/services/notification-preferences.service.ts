import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '#generated/prisma/client';
import { PrismaService } from '../../../prisma';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result';
import { fromPrismaResult } from '../../../common';
import type { UpdateNotificationPreferencesDto } from '../dto/update.dto';
import type { NotificationPreferencesDataDto } from '../dto/response.dto';

export const NOTIFICATION_PREFERENCE_DEFAULTS = {
  healthAlertsEnabled: true,
  weeklyInsightEnabled: false,
  waterRemindersEnabled: true,
  sleepReminderEnabled: false,
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
        ? preferences.healthAlertsEnabled
        : preferences.waterRemindersEnabled;
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
          healthAlertsEnabled:
            dto.healthAlertsEnabled ??
            NOTIFICATION_PREFERENCE_DEFAULTS.healthAlertsEnabled,
          weeklyInsightEnabled:
            dto.weeklyInsightEnabled ??
            NOTIFICATION_PREFERENCE_DEFAULTS.weeklyInsightEnabled,
          waterRemindersEnabled:
            dto.waterRemindersEnabled ??
            NOTIFICATION_PREFERENCE_DEFAULTS.waterRemindersEnabled,
          sleepReminderEnabled:
            dto.sleepReminderEnabled ??
            NOTIFICATION_PREFERENCE_DEFAULTS.sleepReminderEnabled,
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
    if (dto.healthAlertsEnabled !== undefined) {
      data.healthAlertsEnabled = dto.healthAlertsEnabled;
    }
    if (dto.weeklyInsightEnabled !== undefined) {
      data.weeklyInsightEnabled = dto.weeklyInsightEnabled;
    }
    if (dto.waterRemindersEnabled !== undefined) {
      data.waterRemindersEnabled = dto.waterRemindersEnabled;
    }
    if (dto.sleepReminderEnabled !== undefined) {
      data.sleepReminderEnabled = dto.sleepReminderEnabled;
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
        detail: `${field} must be between 0 and 1439.`,
      });
    }
    return null;
  }

  private toDto(row: {
    healthAlertsEnabled: boolean;
    weeklyInsightEnabled: boolean;
    waterRemindersEnabled: boolean;
    sleepReminderEnabled: boolean;
    sleepBedtimeMinutes: number | null;
    sleepWakeTimeMinutes: number | null;
    updatedAt: Date;
  }): NotificationPreferencesDataDto {
    return {
      healthAlertsEnabled: row.healthAlertsEnabled,
      weeklyInsightEnabled: row.weeklyInsightEnabled,
      waterRemindersEnabled: row.waterRemindersEnabled,
      sleepReminderEnabled: row.sleepReminderEnabled,
      sleepBedtimeMinutes: row.sleepBedtimeMinutes,
      sleepWakeTimeMinutes: row.sleepWakeTimeMinutes,
      configured: true,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
