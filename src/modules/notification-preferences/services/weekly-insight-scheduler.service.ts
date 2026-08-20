import { Injectable, Logger } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import {
  DEFAULT_USER_TIMEZONE,
  formatDateOnlyInTimezone,
} from '../../../common';
import { PrismaService } from '../../../prisma';
import { NotificationsService } from '../../notifications';
import { PushDeliveryService } from '../../notifications';
import { ReportsAiSummaryService } from '../../reports/services/ai-summary/summary.service';
import { NotificationPreferencesService } from './notification-preferences.service';

const WEEKLY_INSIGHT_SOURCE = 'ai_weekly_insight';
const DAY_MS = 86_400_000;

@Injectable()
export class WeeklyInsightSchedulerService {
  private readonly logger = new Logger(WeeklyInsightSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: NotificationPreferencesService,
    private readonly reports: ReportsAiSummaryService,
    private readonly notifications: NotificationsService,
    private readonly pushDelivery: PushDeliveryService,
    private readonly i18n: I18nService,
  ) {}

  async runTick(at: Date = new Date()): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        profile: { select: { timezone: true, locale: true } },
      },
    });

    for (const user of users) {
      try {
        const local = this.localParts(
          at,
          user.profile?.timezone ?? DEFAULT_USER_TIMEZONE,
        );
        if (
          local.weekday !== 'Monday' ||
          local.hour !== 9 ||
          local.minute !== 0
        ) {
          continue;
        }

        const preferences = await this.preferences.get(user.id);
        if (!preferences.weeklyInsightEnabled) {
          continue;
        }

        const week = this.previousCompleteWeek(local.date);
        const summary = await this.reports.generate(
          user.id,
          {
            range: 'custom',
            startDate: week.startDate,
            endDate: week.endDate,
          },
          user.profile?.locale ?? 'zh-CN',
        );
        if (!this.hasRealSeries(summary)) {
          continue;
        }

        const title = this.i18n.t('notifications.weekly_insight_title', {
          lang: user.profile?.locale ?? 'zh-CN',
        });
        await this.notifications.createOrReplaceScoped(
          user.id,
          {
            type: 'ai_weekly_insight',
            title,
            content: summary.summary,
            action: 'report',
            actionPayload: {
              source: WEEKLY_INSIGHT_SOURCE,
              date: week.startDate,
              weekStart: week.startDate,
              weekEnd: week.endDate,
            },
          },
          {
            source: WEEKLY_INSIGHT_SOURCE,
            date: week.startDate,
            scopeKey: week.startDate,
          },
        );
        try {
          await this.pushDelivery.sendToUser(user.id, {
            title,
            body: summary.summary,
            data: {
              action: 'ai_weekly_insight',
              weekStart: week.startDate,
              weekEnd: week.endDate,
            },
          });
        } catch (error) {
          this.logger.warn(
            `Weekly insight push failed for ${user.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `Weekly insight generation failed for ${user.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private hasRealSeries(summary: {
    coverage: {
      medication: { trackedDays: number };
      water: { trackedDays: number };
      sleep: { trackedDays: number };
    };
  }): boolean {
    return [
      summary.coverage.medication.trackedDays,
      summary.coverage.water.trackedDays,
      summary.coverage.sleep.trackedDays,
    ].some((days) => days > 0);
  }

  private localParts(
    at: Date,
    timezone: string,
  ): {
    date: string;
    weekday: string;
    hour: number;
    minute: number;
  } {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'long',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
      const parts = formatter.formatToParts(at);
      const value = (type: string) =>
        parts.find((part) => part.type === type)?.value ?? '';
      return {
        date: `${value('year')}-${value('month')}-${value('day')}`,
        weekday: value('weekday'),
        hour: Number(value('hour')),
        minute: Number(value('minute')),
      };
    } catch {
      return this.localParts(at, DEFAULT_USER_TIMEZONE);
    }
  }

  private previousCompleteWeek(date: string): {
    startDate: string;
    endDate: string;
  } {
    const parsed = this.parseDate(date);
    const daysFromMonday = (parsed.getUTCDay() + 6) % 7;
    const currentMonday = new Date(parsed.getTime() - daysFromMonday * DAY_MS);
    const startDate = formatDateOnlyInTimezone(
      new Date(currentMonday.getTime() - 7 * DAY_MS),
      'UTC',
    );
    return {
      startDate,
      endDate: formatDateOnlyInTimezone(
        new Date(currentMonday.getTime() - DAY_MS),
        'UTC',
      ),
    };
  }

  private parseDate(date: string): Date {
    const parts = date.split('-');
    const year = Number(parts[0] ?? 1970);
    const month = Number(parts[1] ?? 1);
    const day = Number(parts[2] ?? 1);
    return new Date(Date.UTC(year, month - 1, day));
  }
}
