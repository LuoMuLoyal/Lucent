import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  isValid,
} from 'date-fns';
import { formatDateOnly, now, parseDateOnly } from '../../../common';
import {
  DEFAULT_RANGE_DAYS,
  DEFAULT_RANGE_FALLBACK_MESSAGE,
  MAX_RANGE_DAYS,
  REQUEST_RANGE_CAP_MESSAGE,
  type ToolDateRange,
  type ToolSingleDateResolution,
  type ToolRangeResolution,
} from './tool-constants';
import {
  REPORT_RANGE_LAST_30_DAYS,
  REPORT_RANGE_LAST_7_DAYS,
} from '../../reports';

import type { ReportRange } from '../../reports';

export function resolveSingleDate(
  userMessage: string,
  opts: { fallbackDate: string; defaultAmbiguity: string },
): ToolSingleDateResolution {
  // Supported explicit formats:
  // - ISO-like: 2026-06-30
  // - Chinese:  6月30日 or 6月30
  // - US slash: 06/30/2026
  // - Short slash (assumes current year): 06/30
  const datePatterns: RegExp[] = [
    /(\d{4})-(\d{1,2})-(\d{1,2})/,
    /(\d{1,2})月(\d{1,2})日?/,
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
    /(\d{1,2})\/(\d{1,2})/,
  ];

  for (const pattern of datePatterns) {
    const match = userMessage.match(pattern);
    if (!match) continue;

    const g1 = match[1];
    const g2 = match[2];
    const g3 = match[3];
    if (g1 == null || g2 == null) continue;

    let year: number;
    let month: number;
    let day: number;
    if (g3 != null && g3.length === 4) {
      year = parseInt(g3, 10);
      month = parseInt(g1, 10);
      day = parseInt(g2, 10);
    } else if (g3 != null) {
      year = parseInt(g1, 10);
      month = parseInt(g2, 10);
      day = parseInt(g3, 10);
    } else {
      const currentTime = now();
      year = currentTime.getUTCFullYear();
      month = parseInt(g1, 10);
      day = parseInt(g2, 10);
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    if (!isValid(date)) {
      continue;
    }

    const dateString = formatDateOnly(date);
    const matchedBy =
      g3 != null && g3.length === 4
        ? ['explicit_slash_date']
        : g3 != null
          ? ['explicit_iso_date']
          : pattern.source.includes('月')
            ? ['explicit_month_day']
            : ['explicit_month_day_slash'];
    return { date: dateString, matchedBy, ambiguities: [] };
  }

  if (/今天|today/i.test(userMessage)) {
    return {
      date: todayDateString(),
      matchedBy: ['relative_today'],
      ambiguities: [],
    };
  }
  if (/昨天|yesterday/i.test(userMessage)) {
    return {
      date: offsetDateString(-1),
      matchedBy: ['relative_yesterday'],
      ambiguities: [],
    };
  }
  if (/前天|the day before yesterday/i.test(userMessage)) {
    return {
      date: offsetDateString(-2),
      matchedBy: ['relative_day_before_yesterday'],
      ambiguities: [],
    };
  }

  return {
    date: opts.fallbackDate,
    matchedBy: ['default_today'],
    ambiguities: [opts.defaultAmbiguity],
  };
}

export function resolveDateRange(userMessage: string): ToolRangeResolution {
  // Supported range formats:
  // - Explicit ISO range: 2026-06-01~2026-06-30 (also 到/至/to)
  // - Relative last-N days in Chinese or English (e.g. 最近7天, last 7 days)
  const rangePatterns: RegExp[] = [
    /(\d{4}-\d{1,2}-\d{1,2})\s*(?:~|到|至|to)\s*(\d{4}-\d{1,2}-\d{1,2})/,
    /最近\s*(\d+)\s*天/,
    /last\s*(\d+)\s*days?/i,
    /past\s*(\d+)\s*days?/i,
    /过去\s*(\d+)\s*天/,
  ];

  for (const pattern of rangePatterns) {
    const match = userMessage.match(pattern);
    if (!match) continue;

    const m1 = match[1];
    const m2 = match[2];
    if (m1 == null) continue;

    if (m2 != null && m1.includes('-') && m2.includes('-')) {
      const { startDate, endDate } = normalizeRange(m1, m2);
      const requestedDays = diffDaysInclusive(startDate, endDate);
      if (requestedDays > MAX_RANGE_DAYS) {
        return {
          startDate,
          endDate,
          matchedBy: ['explicit_date_range'],
          ambiguities: [
            REQUEST_RANGE_CAP_MESSAGE(requestedDays, MAX_RANGE_DAYS),
          ],
          truncated: true,
          requestedDays,
        };
      }
      return {
        startDate,
        endDate,
        matchedBy: ['explicit_date_range'],
        ambiguities: [],
        truncated: false,
        requestedDays,
      };
    }

    const days = parseInt(m1, 10);
    if (isNaN(days) || days <= 0) break;
    if (days > MAX_RANGE_DAYS) {
      const endDate = todayDateString();
      const startDate = offsetDateString(-(MAX_RANGE_DAYS - 1));
      return {
        startDate,
        endDate,
        matchedBy: ['relative_last_n_days'],
        ambiguities: [REQUEST_RANGE_CAP_MESSAGE(days, MAX_RANGE_DAYS)],
        truncated: true,
        requestedDays: days,
      };
    }
    return {
      startDate: offsetDateString(-(days - 1)),
      endDate: todayDateString(),
      matchedBy: ['relative_last_n_days'],
      ambiguities: [],
      truncated: false,
      requestedDays: days,
    };
  }

  return {
    startDate: offsetDateString(-(DEFAULT_RANGE_DAYS - 1)),
    endDate: todayDateString(),
    matchedBy: ['default_last_7_days'],
    ambiguities: [DEFAULT_RANGE_FALLBACK_MESSAGE(DEFAULT_RANGE_DAYS)],
    truncated: false,
    requestedDays: DEFAULT_RANGE_DAYS,
  };
}

export function resolveReportRangeFromKey(
  rangeKey: ReportRange,
): ToolRangeResolution {
  const days = rangeKey === REPORT_RANGE_LAST_30_DAYS ? 30 : DEFAULT_RANGE_DAYS;
  return {
    startDate: offsetDateString(-(days - 1)),
    endDate: todayDateString(),
    matchedBy: [
      rangeKey === REPORT_RANGE_LAST_30_DAYS
        ? 'report_range_last_30_days'
        : 'report_range_last_7_days',
    ],
    ambiguities: [],
    truncated: false,
    requestedDays: days,
  };
}

export function extractReportRangeKey(userMessage: string): ReportRange | null {
  if (/30天|月报|last 30 days/i.test(userMessage))
    return REPORT_RANGE_LAST_30_DAYS;
  if (/7天|周报|last 7 days/i.test(userMessage))
    return REPORT_RANGE_LAST_7_DAYS;
  return null;
}

export function normalizeRange(
  startDate: string,
  endDate: string,
): ToolDateRange {
  return startDate <= endDate
    ? { startDate, endDate }
    : { startDate: endDate, endDate: startDate };
}

export function diffDaysInclusive(startDate: string, endDate: string): number {
  return (
    differenceInCalendarDays(parseDateOnly(endDate), parseDateOnly(startDate)) +
    1
  );
}

export function enumerateDates(
  startDate: string,
  endDate: string,
  maxDays = Number.POSITIVE_INFINITY,
): string[] {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  return eachDayOfInterval({ start, end })
    .slice(0, maxDays)
    .map((date) => formatDateOnly(date));
}

export function todayDateString(): string {
  return formatDateOnly(now());
}

export function offsetDateString(offsetDays: number): string {
  return formatDateOnly(addDays(parseDateOnly(todayDateString()), offsetDays));
}
