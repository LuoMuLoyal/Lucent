import { Injectable, Logger } from '@nestjs/common';
import { DEFAULT_USER_TIMEZONE } from '../../../../common/index.js';

/**
 * Time/timezone calculation helpers for medication scheduling.
 *
 * Extracted from `MedicationCollectorService` to isolate the DST-aware
 * timezone arithmetic from the signal-collection business logic.
 */
@Injectable()
export class MedicationTimeResolverService {
  private readonly logger = new Logger(MedicationTimeResolverService.name);

  formatScheduledTime(hour: number, minute: number): string {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  normalizeScheduledTime(value: string): string | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (match == null) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return this.formatScheduledTime(hour, minute);
  }

  scheduledInstant(
    date: string,
    scheduledTime: string,
    timezone: string,
  ): Date | null {
    const normalizedTime = this.normalizeScheduledTime(scheduledTime);
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (normalizedTime == null || dateMatch == null) return null;

    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const [hour = 0, minute = 0] = normalizedTime.split(':').map(Number);
    const naiveUtc = Date.UTC(year, month - 1, day, hour, minute);
    const naiveDate = new Date(naiveUtc);
    if (
      naiveDate.getUTCFullYear() !== year ||
      naiveDate.getUTCMonth() !== month - 1 ||
      naiveDate.getUTCDate() !== day
    ) {
      return null;
    }

    const candidateOffsets = new Set<number>();
    for (const offset of [-48, -24, 0, 24, 48]) {
      candidateOffsets.add(
        this.timezoneOffsetMinutes(
          new Date(naiveUtc + offset * 60 * 60 * 1000),
          timezone,
        ),
      );
    }

    const candidates = [...candidateOffsets]
      .map((offsetMinutes) => new Date(naiveUtc - offsetMinutes * 60 * 1000))
      .filter((candidate) =>
        this.isSameLocalMinute(
          candidate,
          year,
          month,
          day,
          hour,
          minute,
          timezone,
        ),
      )
      .sort((left, right) => left.getTime() - right.getTime());

    // A DST fold has two valid instants. Choose the earlier occurrence
    // deterministically; a DST gap has no round-tripping candidate and returns
    // null instead of inventing an instant.
    return candidates[0] ?? null;
  }

  timezoneOffsetMinutes(date: Date, timezone: string): number {
    const localParts = this.zonedParts(date, timezone);
    const localAsUtc = Date.UTC(
      localParts.year,
      localParts.month - 1,
      localParts.day,
      localParts.hour,
      localParts.minute,
    );
    return Math.round((localAsUtc - date.getTime()) / 60_000);
  }

  isSameLocalMinute(
    date: Date,
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    timezone: string,
  ): boolean {
    const parts = this.zonedParts(date, timezone);
    return (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute
    );
  }

  zonedParts(
    date: Date,
    timezone: string,
  ): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  } {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const value = (type: string): number =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    return {
      year: value('year'),
      month: value('month'),
      day: value('day'),
      hour: value('hour'),
      minute: value('minute'),
    };
  }

  normalizeTimezone(timezone: unknown): string {
    if (typeof timezone !== 'string') {
      return DEFAULT_USER_TIMEZONE;
    }

    const trimmed = timezone.trim();
    if (trimmed.length === 0) {
      return DEFAULT_USER_TIMEZONE;
    }

    try {
      new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(
        new Date(0),
      );
      return trimmed;
    } catch (error) {
      this.logger.warn(
        `Invalid timezone "${trimmed}", falling back to default: ${error instanceof Error ? error.message : String(error)}`,
      );
      return DEFAULT_USER_TIMEZONE;
    }
  }
}
