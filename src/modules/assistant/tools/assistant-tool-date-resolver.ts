import {
  DEFAULT_RANGE_DAYS,
  DEFAULT_RANGE_FALLBACK_MESSAGE,
  MAX_RANGE_DAYS,
  REQUEST_RANGE_CAP_MESSAGE,
  type ToolDateRange,
  type ToolSingleDateResolution,
  type ToolRangeResolution,
} from './assistant-tool.constants';
import {
  REPORT_RANGE_LAST_30_DAYS,
  REPORT_RANGE_LAST_7_DAYS,
  type ReportRange,
} from '../../reports/dto/report-dashboard-query.dto';

export function resolveSingleDate(
  userMessage: string,
  opts: { fallbackDate: string; defaultAmbiguity: string },
): ToolSingleDateResolution {
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
      const now = new Date();
      year = now.getUTCFullYear();
      month = parseInt(g1, 10);
      day = parseInt(g2, 10);
    }
    const date = makeDateString(year, month, day);
    return { date, matchedBy: [match[0]], ambiguities: [] };
  }

  if (/今天|today/i.test(userMessage)) {
    return { date: todayDateString(), matchedBy: ['today'], ambiguities: [] };
  }
  if (/昨天|yesterday/i.test(userMessage)) {
    return {
      date: offsetDateString(-1),
      matchedBy: ['yesterday'],
      ambiguities: [],
    };
  }
  if (/前天|the day before yesterday/i.test(userMessage)) {
    return {
      date: offsetDateString(-2),
      matchedBy: ['the day before yesterday'],
      ambiguities: [],
    };
  }

  return {
    date: opts.fallbackDate,
    matchedBy: [],
    ambiguities: [opts.defaultAmbiguity],
  };
}

export function resolveDateRange(userMessage: string): ToolRangeResolution {
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
          matchedBy: [match[0]],
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
        matchedBy: [match[0]],
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
        matchedBy: [match[0]],
        ambiguities: [REQUEST_RANGE_CAP_MESSAGE(days, MAX_RANGE_DAYS)],
        truncated: true,
        requestedDays: days,
      };
    }
    return {
      startDate: offsetDateString(-(days - 1)),
      endDate: todayDateString(),
      matchedBy: [match[0]],
      ambiguities: [],
      truncated: false,
      requestedDays: days,
    };
  }

  return {
    startDate: offsetDateString(-(DEFAULT_RANGE_DAYS - 1)),
    endDate: todayDateString(),
    matchedBy: [],
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
    matchedBy: [rangeKey],
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
    Math.floor(
      (new Date(`${endDate}T00:00:00.000Z`).getTime() -
        new Date(`${startDate}T00:00:00.000Z`).getTime()) /
        86400000,
    ) + 1
  );
}

export function enumerateDates(
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

export function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function offsetDateString(offsetDays: number): string {
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

export function makeDateString(
  year: number,
  month: number,
  day: number,
): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}
