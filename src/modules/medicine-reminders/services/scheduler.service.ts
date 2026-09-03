import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { I18nService } from 'nestjs-i18n';
import { PrismaService } from '../../../prisma/index.js';
import { INotificationSender } from '../../notifications/index.js';
import { PushDeliveryService } from '../../notifications/index.js';
import { now } from '../../../common/index.js';
import { formatDateOnly } from '../../../common/index.js';
import { resolveLocale } from '../../../common/index.js';
import {
  DELIVERY_CHANNEL_IN_APP,
  DELIVERY_CHANNEL_LOCAL,
  DELIVERY_CHANNEL_PUSH,
  DELIVERY_STATUS_DELIVERED,
  DELIVERY_STATUS_FAILED,
  localCapabilityCacheKey,
  type ResolvedLocalCapability,
} from '../constants/delivery.constants.js';
import { DEFAULT_TIMEZONE, formatLocalDate } from './delivery-moment.js';

/** Cron expression for the reminder scheduler — every minute. */
export const REMINDER_SCHEDULER_CRON = '* * * * *';

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

/** Raw reminder row with joined user profile timezone and locale. */
interface ReminderWithTimezone {
  id: string;
  userId: string;
  label: string | null;
  scheduledHour: number;
  scheduledMinute: number;
  daysOfWeek: unknown;
  startDate: Date | null;
  endDate: Date | null;
  user: {
    profile: { timezone: string | null; locale: string | null } | null;
  } | null;
}

/** A reminder that is due at the current time. */
interface DueReminder {
  id: string;
  userId: string;
  label: string | null;
  timezone: string | null;
  locale: string | null;
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
 * Runs every minute via BullMQ Repeatable Job. The previous process-level
 * `isDispatching` re-entrancy guard has been removed: BullMQ guarantees a
 * single worker does not consume the same job concurrently, and adjacent
 * repeat instances that might overlap are deduplicated by the
 * `(userId, reminderId, scheduledFor, channel)` unique constraint: `findFirst`
 * is the fast path, and `createMany({ skipDuplicates: true })` makes the
 * record write atomic under a race (see ADR-0011 / ADR-0013). Delivery is
 * at-least-once — a notification can be sent twice in a true multi-instance
 * overlap, but the delivery record is never duplicated.
 *
 * Three-channel semantics（ADR-0013）：in_app 始终写入通知中心；local 由客户端
 * 展示后幂等回写（存在即跳过 push）；push 仅在本地能力为 unconfirmed/unavailable
 * 时作为后台回退发送，active/disabled 完全不发。
 */
@Injectable()
export class ReminderSchedulerService {
  private readonly logger = new Logger(ReminderSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: INotificationSender,
    private readonly pushDeliveryService: PushDeliveryService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly i18n: I18nService,
  ) {}

  async dispatchDueReminders(): Promise<void> {
    await this.runDispatch();
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
              profile: { select: { timezone: true, locale: true } },
            },
          },
        },
      });

      for (const row of rows) {
        const timezone = row.user.profile?.timezone ?? null;
        const locale = row.user.profile?.locale ?? null;
        const local = this.getLocalTime(currentTime, timezone);

        if (!this.isReminderDue(row, local)) {
          continue;
        }

        due.push({
          id: row.id,
          userId: row.userId,
          label: row.label,
          timezone,
          locale,
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
      // a. 站内通知去重（快速路径）：同一事件已有 in_app 行则整体跳过
      //    （含 local/push 回退），避免重复打扰。
      const already = await this.prisma.userReminderDelivery.findFirst({
        where: {
          reminderId: reminder.id,
          scheduledFor,
          channel: DELIVERY_CHANNEL_IN_APP,
        },
        select: { id: true },
      });

      if (already != null) {
        return;
      }

      const localDate = formatLocalDate(scheduledFor, reminder.timezone);
      // 用户未设置 locale 或为空串时显式回退 zh-CN（保持现状中文文案）；
      // resolveLocale 对 null 回退 en，空串同 null 兜底 zh-CN 保持现状。
      const lang =
        reminder.locale == null || reminder.locale.trim() === ''
          ? 'zh-CN'
          : resolveLocale(reminder.locale);
      const fallbackLabel = this.i18n.t(
        'medicine-reminders.reminder_fallback_label',
        { lang },
      );
      const label = reminder.label ?? fallbackLabel;
      const content = this.i18n.t('medicine-reminders.reminder_due_content', {
        lang,
        args: { label },
      });

      // b. 先发站内通知。如果失败（DomainFailure Err 或异常），不写任何
      //    投递记录，下一个 tick 重试（原语义保留）。Err 路径记录结构化
      //    warn（含 failure.code 与 reminder/user 上下文），已知业务失败
      //    （如 P2002/P2025 映射的 RESOURCE_CONFLICT/RESOURCE_NOT_FOUND）
      //    不再静默；rejection 仍走外层 catch。
      const notificationResult =
        await this.notificationsService.createOrReplaceScoped(
          reminder.userId,
          {
            type: 'medicine_reminder',
            title: label,
            content,
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
      if (notificationResult.isErr()) {
        this.logger.warn(
          `Failed to send reminder notification (reminder=${reminder.id}, user=${reminder.userId}): code=${notificationResult.error.code}`,
        );
        return;
      }

      // c. 站内通知成功——写入 in_app 审计行（通知中心记录）。唯一约束
      //    (userId, reminderId, scheduledFor, channel) 保证重叠 tick 的
      //    重复 insert 被原子跳过（skipDuplicates），不会抛 P2002。
      await this.prisma.userReminderDelivery.createMany({
        data: {
          userId: reminder.userId,
          reminderId: reminder.id,
          channel: DELIVERY_CHANNEL_IN_APP,
          status: DELIVERY_STATUS_DELIVERED,
          scheduledFor,
          deliveredAt: now(),
        },
        skipDuplicates: true,
      });

      this.logger.debug(
        `Dispatched reminder ${reminder.id} to user ${reminder.userId}`,
      );

      // d. 本地已送达（客户端幂等回写 local 行）→ 跳过 push，保证
      //    「一个事件最多一次打扰」。
      const localDelivery = await this.prisma.userReminderDelivery.findFirst({
        where: {
          reminderId: reminder.id,
          scheduledFor,
          channel: DELIVERY_CHANNEL_LOCAL,
        },
        select: { id: true },
      });

      if (localDelivery != null) {
        return;
      }

      // e. 本地调度能力门控：active（本地可达）/ disabled（用户关闭）时
      //    完全不发 push；仅 unconfirmed（能力未知，首次下发前）或
      //    unavailable（本地不可达）时允许 JPush 后台回退。
      const capability = await this.readLocalCapability(reminder.userId);
      if (capability === 'active' || capability === 'disabled') {
        return;
      }

      // f. JPush 后台回退（best-effort——未配置时静默失败），按结果落 push
      //    审计行；push 失败不重试（见 ADR-0013）。
      const result = await this.pushDeliveryService.sendToUser(
        reminder.userId,
        {
          title: label,
          body: content,
          data: { reminderId: reminder.id, action: 'medicine_reminder' },
        },
      );

      if (result.sent) {
        await this.prisma.userReminderDelivery.createMany({
          data: {
            userId: reminder.userId,
            reminderId: reminder.id,
            channel: DELIVERY_CHANNEL_PUSH,
            status: DELIVERY_STATUS_DELIVERED,
            scheduledFor,
            deliveredAt: now(),
          },
          skipDuplicates: true,
        });
      } else {
        await this.prisma.userReminderDelivery.createMany({
          data: {
            userId: reminder.userId,
            reminderId: reminder.id,
            channel: DELIVERY_CHANNEL_PUSH,
            status: DELIVERY_STATUS_FAILED,
            scheduledFor,
            errorMessage: result.errorMessage ?? null,
          },
          skipDuplicates: true,
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to dispatch reminder ${reminder.id}: ${this.formatError(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  // ─── Local capability ──────────────────────────────────────────────

  /**
   * 读取用户本地调度能力缓存（`reminder:local-capability:{userId}`）。
   * 缓存缺失或读取异常均视为 `unconfirmed`（能力未知，允许 JPush 回退）。
   * 缓存异常只 warn 一次并继续走 push 兜底，不中断 dispatch——否则
   * in_app 行已写而 JPush 兜底会被静默跳过（下一 tick 去重）。
   */
  private async readLocalCapability(
    userId: string,
  ): Promise<ResolvedLocalCapability> {
    let cached: string | undefined;
    try {
      cached = await this.cache.get<string>(localCapabilityCacheKey(userId));
    } catch (error) {
      this.logger.warn(
        `Failed to read local capability cache for user ${userId}: ${this.formatError(error)}`,
      );
      return 'unconfirmed';
    }
    if (
      cached === 'active' ||
      cached === 'unavailable' ||
      cached === 'disabled'
    ) {
      return cached;
    }
    return 'unconfirmed';
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
    const dateStr = formatLocalDate(date, timezone);

    return { hour, minute, weekday, dateStr };
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
