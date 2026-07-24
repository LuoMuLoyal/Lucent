import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma';
import { NotificationsService } from '../../notifications';
import { PushDeliveryService } from '../../notifications';
import { now } from '../../../common';
import { formatDateOnly } from '../../../common';

/** Cron expression for the reminder scheduler — every minute. */
export const REMINDER_SCHEDULER_CRON = '* * * * *';

/** Default timezone when user profile has no timezone set. */
const DEFAULT_TIMEZONE = 'Asia/Shanghai';

/** Channel name for in-app notification delivery. */
const DELIVERY_CHANNEL_IN_APP = 'in_app';

/** Delivery status when a notification is successfully sent. */
const DELIVERY_STATUS_DELIVERED = 'delivered';

/** Batch size for paginated reminder queries. */
const REMINDER_QUERY_BATCH_SIZE = 500;

/** Maps weekday short names to ISO weekday numbers (0 = Sunday). */
const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Raw reminder row with joined user profile timezone. */
interface ReminderWithTimezone {
  id: string;
  userId: string;
  label: string | null;
  scheduledHour: number;
  scheduledMinute: number;
  daysOfWeek: unknown;
  startDate: Date | null;
  endDate: Date | null;
  user: { profile: { timezone: string | null } | null } | null;
}

/** A reminder that is due at the current time. */
interface DueReminder {
  id: string;
  userId: string;
  label: string | null;
  timezone: string | null;
}

/** Local time components used for matching. */
interface LocalTime {
  hour: number;
  minute: number;
  weekday: number;
  dateStr: string;
}

/**
 * Periodically scans active medicine reminders and dispatches in-app
 * notifications for those whose scheduled local hour:minute matches the
 * current time in the user's timezone.
 *
 * Deduplication: a unique delivery record per (reminderId, scheduledFor)
 * prevents duplicate notifications if the scheduler ticks twice in the
 * same minute or the process restarts mid-tick.
 */
@Injectable()
export class ReminderSchedulerService {
  private readonly logger = new Logger(ReminderSchedulerService.name);
  private isDispatching = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly pushDeliveryService: PushDeliveryService,
  ) {}

  @Cron(REMINDER_SCHEDULER_CRON)
  async dispatchDueReminders(): Promise<void> {
    if (this.isDispatching) {
      this.logger.warn('Previous dispatch still running — skipping this tick');
      return;
    }

    this.isDispatching = true;
    try {
      await this.runDispatch();
    } finally {
      this.isDispatching = false;
    }
  }

  private async runDispatch(): Promise<void> {
    const currentTime = now();
    const scheduledFor = this.truncateToMinute(currentTime);

    let dueReminders: DueReminder[];
    try {
      dueReminders = await this.findDueReminders(currentTime);
    } catch (error) {
      this.logger.error(
        `Failed to query due reminders: ${this.formatError(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return;
    }

    if (dueReminders.length === 0) {
      return;
    }

    this.logger.debug(
      `Found ${String(dueReminders.length)} due reminder(s) at ${currentTime.toISOString()}`,
    );

    for (const reminder of dueReminders) {
      await this.dispatchSingle(reminder, scheduledFor);
    }
  }

  // ─── Query ──────────────────────────────────────────────────────────

  /**
   * Queries all active, non-deleted reminders (with user profile timezone)
   * in batches and filters to those whose local hour:minute, weekday, and
   * date window match the current time.
   *
   * Uses cursor-based pagination to avoid loading the entire table into
   * memory when the number of active reminders grows large.
   */
  private async findDueReminders(currentTime: Date): Promise<DueReminder[]> {
    const due: DueReminder[] = [];
    let cursor: string | undefined;

    for (;;) {
      const rows = await this.prisma.userMedicineReminder.findMany({
        where: { isActive: true, deletedAt: null },
        take: REMINDER_QUERY_BATCH_SIZE,
        ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          userId: true,
          label: true,
          scheduledHour: true,
          scheduledMinute: true,
          daysOfWeek: true,
          startDate: true,
          endDate: true,
          user: {
            select: {
              profile: { select: { timezone: true } },
            },
          },
        },
      });

      for (const row of rows) {
        const timezone = row.user.profile?.timezone ?? null;
        const local = this.getLocalTime(currentTime, timezone);

        if (!this.isReminderDue(row, local)) {
          continue;
        }

        due.push({
          id: row.id,
          userId: row.userId,
          label: row.label,
          timezone,
        });
      }

      if (rows.length < REMINDER_QUERY_BATCH_SIZE) {
        break;
      }

      const lastRow = rows[rows.length - 1];
      if (lastRow === undefined) break;
      cursor = lastRow.id;
    }

    return due;
  }

  /**
   * Returns true when the reminder's scheduledHour/Minute, daysOfWeek,
   * and date-window all match the given local time.
   */
  private isReminderDue(row: ReminderWithTimezone, local: LocalTime): boolean {
    if (
      row.scheduledHour !== local.hour ||
      row.scheduledMinute !== local.minute
    ) {
      return false;
    }

    const days = this.parseDaysOfWeek(row.daysOfWeek);
    if (days != null && days.length > 0 && !days.includes(local.weekday)) {
      return false;
    }

    const startDateStr = formatDateOnly(row.startDate);
    if (startDateStr != null && local.dateStr < startDateStr) {
      return false;
    }

    const endDateStr = formatDateOnly(row.endDate);
    if (endDateStr != null && local.dateStr > endDateStr) {
      return false;
    }

    return true;
  }

  // ─── Dispatch ───────────────────────────────────────────────────────

  private async dispatchSingle(
    reminder: DueReminder,
    scheduledFor: Date,
  ): Promise<void> {
    try {
      const already = await this.prisma.userReminderDelivery.findFirst({
        where: { reminderId: reminder.id, scheduledFor },
        select: { id: true },
      });

      if (already != null) {
        return;
      }

      const localDate = this.formatLocalDate(scheduledFor, reminder.timezone);
      const label = reminder.label ?? '用药提醒';

      // Send the notification FIRST. If it fails, no delivery record is
      // created, so the next scheduler tick will retry. The previous order
      // (create delivery record first, then send notification) meant that a
      // notification failure would permanently block the reminder because the
      // dedup check would find the delivery record and skip.
      await this.notificationsService.createOrReplaceScoped(
        reminder.userId,
        {
          type: 'medicine_reminder',
          title: label,
          content: `该吃药了：${label}`,
          action: 'medicine',
          actionPayload: {
            source: `medicine_reminder_${reminder.id}`,
            date: localDate,
            reminderId: reminder.id,
          },
        },
        {
          source: `medicine_reminder_${reminder.id}`,
          date: localDate,
        },
      );

      // Notification succeeded — now persist the delivery record for dedup.
      await this.prisma.userReminderDelivery.create({
        data: {
          userId: reminder.userId,
          reminderId: reminder.id,
          channel: DELIVERY_CHANNEL_IN_APP,
          status: DELIVERY_STATUS_DELIVERED,
          scheduledFor,
          deliveredAt: now(),
        },
      });

      this.logger.debug(
        `Dispatched reminder ${reminder.id} to user ${reminder.userId}`,
      );

      // Push notification (best-effort — no-op when not configured)
      await this.pushDeliveryService.sendToUser(reminder.userId, {
        title: label,
        body: `该吃药了：${label}`,
        data: { reminderId: reminder.id, action: 'medicine_reminder' },
      });
    } catch (error) {
      this.logger.error(
        `Failed to dispatch reminder ${reminder.id}: ${this.formatError(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  // ─── Timezone helpers ────────────────────────────────────────────────

  /**
   * Returns the local hour, minute, weekday (0=Sun..6=Sat), and
   * date string (YYYY-MM-DD) for the given UTC instant in the given
   * timezone. Falls back to DEFAULT_TIMEZONE when null.
   */
  private getLocalTime(date: Date, timezone: string | null): LocalTime {
    const tz = timezone || DEFAULT_TIMEZONE;

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    }).formatToParts(date);

    const hourRaw = this.readPart(parts, 'hour', '0');
    const hour = Number.parseInt(hourRaw, 10) % 24;
    const minute = Number.parseInt(this.readPart(parts, 'minute', '0'), 10);
    const weekdayStr = this.readPart(parts, 'weekday', 'Sun');
    const weekday = WEEKDAY_MAP[weekdayStr] ?? 0;
    const dateStr = this.formatLocalDate(date, timezone);

    return { hour, minute, weekday, dateStr };
  }

  /**
   * Returns the local date as a YYYY-MM-DD string in the given timezone.
   * Uses the `en-CA` locale which natively produces ISO-style dates.
   */
  private formatLocalDate(date: Date, timezone: string | null): string {
    const tz = timezone || DEFAULT_TIMEZONE;

    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    return `${this.readPart(parts, 'year', '2026')}-${this.readPart(parts, 'month', '01')}-${this.readPart(parts, 'day', '01')}`;
  }

  // ─── Utils ──────────────────────────────────────────────────────────

  private parseDaysOfWeek(value: unknown): number[] | null {
    if (!Array.isArray(value)) {
      return null;
    }
    return value.filter((v): v is number => typeof v === 'number');
  }

  private truncateToMinute(date: Date): Date {
    const d = new Date(date);
    d.setSeconds(0, 0);
    return d;
  }

  private readPart(
    parts: Intl.DateTimeFormatPart[],
    type: string,
    fallback: string,
  ): string {
    return parts.find((p) => p.type === type)?.value ?? fallback;
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
