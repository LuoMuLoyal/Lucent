import {
  resolveSingleDate,
  resolveDateRange,
  resolveReportRangeFromKey,
  extractReportRangeKey,
  normalizeRange,
  diffDaysInclusive,
  enumerateDates,
  offsetDateString,
  todayDateString,
} from './date-resolver.js';
import { DEFAULT_RANGE_DAYS, MAX_RANGE_DAYS } from './tool-constants.js';
import {
  REPORT_RANGE_LAST_7_DAYS,
  REPORT_RANGE_LAST_30_DAYS,
} from '../../../reports/index.js';
import { formatDateOnly, parseDateOnly } from '../../../../common/index.js';

describe('date-resolver', () => {
  // -----------------------------------------------------------------------
  // resolveSingleDate
  // -----------------------------------------------------------------------
  describe('resolveSingleDate', () => {
    it('parses ISO date format (YYYY-MM-DD)', () => {
      const result = resolveSingleDate('查看 2026-06-30 的记录', {
        fallbackDate: '2026-07-11',
        defaultAmbiguity: 'ambiguity',
      });
      expect(result.date).toBe('2026-06-30');
      expect(result.matchedBy).toEqual(['explicit_iso_date']);
      expect(result.ambiguities).toEqual([]);
    });

    it('parses Chinese month-day format (M月D日)', () => {
      const result = resolveSingleDate('6月30日的数据', {
        fallbackDate: '2026-07-11',
        defaultAmbiguity: 'ambiguity',
      });
      expect(result.date).toMatch(/^\d{4}-06-30$/);
      expect(result.matchedBy).toEqual(['explicit_month_day']);
    });

    it('parses Chinese month-day without 日 suffix (M月D)', () => {
      const result = resolveSingleDate('6月30 的数据', {
        fallbackDate: '2026-07-11',
        defaultAmbiguity: 'ambiguity',
      });
      expect(result.date).toMatch(/^\d{4}-06-30$/);
      expect(result.matchedBy).toEqual(['explicit_month_day']);
    });

    it('parses US slash date format (MM/DD/YYYY)', () => {
      const result = resolveSingleDate('check 06/30/2026', {
        fallbackDate: '2026-07-11',
        defaultAmbiguity: 'ambiguity',
      });
      expect(result.date).toBe('2026-06-30');
      expect(result.matchedBy).toEqual(['explicit_slash_date']);
    });

    it('parses short slash format (MM/DD) assuming current year', () => {
      const result = resolveSingleDate('check 06/30', {
        fallbackDate: '2026-07-11',
        defaultAmbiguity: 'ambiguity',
      });
      const currentYear = new Date().getUTCFullYear();
      expect(result.date).toBe(`${currentYear}-06-30`);
      expect(result.matchedBy).toEqual(['explicit_month_day_slash']);
    });

    it('resolves "今天/today" to current date', () => {
      const result = resolveSingleDate('今天的记录', {
        fallbackDate: '2026-07-11',
        defaultAmbiguity: 'ambiguity',
      });
      expect(result.date).toBe(todayDateString());
      expect(result.matchedBy).toEqual(['relative_today']);
    });

    it('resolves "昨天/yesterday" to yesterday', () => {
      const result = resolveSingleDate('yesterday data', {
        fallbackDate: '2026-07-11',
        defaultAmbiguity: 'ambiguity',
      });
      expect(result.date).toBe(offsetDateString(-1));
      expect(result.matchedBy).toEqual(['relative_yesterday']);
    });

    it('resolves "前天" to two days ago', () => {
      const result = resolveSingleDate('前天的记录', {
        fallbackDate: '2026-07-11',
        defaultAmbiguity: 'ambiguity',
      });
      expect(result.date).toBe(offsetDateString(-2));
      expect(result.matchedBy).toEqual(['relative_day_before_yesterday']);
    });

    it('returns fallback date when no pattern matches', () => {
      const result = resolveSingleDate('just some text', {
        fallbackDate: '2026-07-11',
        defaultAmbiguity: 'could not detect date',
      });
      expect(result.date).toBe('2026-07-11');
      expect(result.matchedBy).toEqual(['default_today']);
      expect(result.ambiguities).toEqual(['could not detect date']);
    });

    it('tries patterns in order and uses the first match', () => {
      // Both ISO and Chinese patterns present — ISO should match first
      const result = resolveSingleDate('2026-03-15 和 6月30日', {
        fallbackDate: '2026-07-11',
        defaultAmbiguity: 'ambiguity',
      });
      expect(result.date).toBe('2026-03-15');
      expect(result.matchedBy).toEqual(['explicit_iso_date']);
    });
  });

  // -----------------------------------------------------------------------
  // resolveDateRange
  // -----------------------------------------------------------------------
  describe('resolveDateRange', () => {
    it('parses explicit ISO range with ~ separator', () => {
      const result = resolveDateRange('2026-06-01~2026-06-05');
      expect(result.startDate).toBe('2026-06-01');
      expect(result.endDate).toBe('2026-06-05');
      expect(result.matchedBy).toEqual(['explicit_date_range']);
      expect(result.truncated).toBe(false);
      expect(result.requestedDays).toBe(5);
    });

    it('parses explicit ISO range with 到 separator', () => {
      const result = resolveDateRange('2026-06-01 到 2026-06-03');
      expect(result.startDate).toBe('2026-06-01');
      expect(result.endDate).toBe('2026-06-03');
      expect(result.requestedDays).toBe(3);
    });

    it('parses explicit ISO range with 至 separator', () => {
      const result = resolveDateRange('2026-06-01 至 2026-06-03');
      expect(result.startDate).toBe('2026-06-01');
      expect(result.endDate).toBe('2026-06-03');
      expect(result.requestedDays).toBe(3);
    });

    it('parses explicit ISO range with "to" separator', () => {
      const result = resolveDateRange('2026-06-01 to 2026-06-03');
      expect(result.startDate).toBe('2026-06-01');
      expect(result.endDate).toBe('2026-06-03');
      expect(result.requestedDays).toBe(3);
    });

    it('normalizes reversed start/end dates in explicit range', () => {
      const result = resolveDateRange('2026-06-05~2026-06-01');
      expect(result.startDate).toBe('2026-06-01');
      expect(result.endDate).toBe('2026-06-05');
      expect(result.requestedDays).toBe(5);
    });

    it('truncates explicit range exceeding MAX_RANGE_DAYS', () => {
      const result = resolveDateRange('2026-06-01~2026-07-15');
      expect(result.truncated).toBe(true);
      expect(result.ambiguities).toHaveLength(1);
      expect(result.requestedDays).toBeGreaterThan(MAX_RANGE_DAYS);
    });

    it('parses "最近N天" relative range', () => {
      const result = resolveDateRange('最近7天');
      expect(result.matchedBy).toEqual(['relative_last_n_days']);
      expect(result.requestedDays).toBe(7);
      expect(result.truncated).toBe(false);
      expect(result.endDate).toBe(todayDateString());
      expect(result.startDate).toBe(offsetDateString(-6));
    });

    it('parses "last N days" relative range', () => {
      const result = resolveDateRange('last 7 days');
      expect(result.matchedBy).toEqual(['relative_last_n_days']);
      expect(result.requestedDays).toBe(7);
    });

    it('parses "past N days" relative range', () => {
      const result = resolveDateRange('past 3 days');
      expect(result.matchedBy).toEqual(['relative_last_n_days']);
      expect(result.requestedDays).toBe(3);
    });

    it('parses "过去N天" relative range', () => {
      const result = resolveDateRange('过去5天');
      expect(result.matchedBy).toEqual(['relative_last_n_days']);
      expect(result.requestedDays).toBe(5);
    });

    it('truncates relative range exceeding MAX_RANGE_DAYS', () => {
      const result = resolveDateRange('最近30天');
      expect(result.truncated).toBe(true);
      expect(result.ambiguities).toHaveLength(1);
      expect(result.requestedDays).toBe(30);
    });

    it('defaults to last 7 days when no range pattern matches', () => {
      const result = resolveDateRange('just some text');
      expect(result.matchedBy).toEqual(['default_last_7_days']);
      expect(result.requestedDays).toBe(DEFAULT_RANGE_DAYS);
      expect(result.truncated).toBe(false);
      expect(result.ambiguities).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // resolveReportRangeFromKey
  // -----------------------------------------------------------------------
  describe('resolveReportRangeFromKey', () => {
    it('resolves last_7_days to a 7-day range', () => {
      const result = resolveReportRangeFromKey(REPORT_RANGE_LAST_7_DAYS);
      expect(result.startDate).toBe(offsetDateString(-6));
      expect(result.endDate).toBe(todayDateString());
      expect(result.matchedBy).toEqual(['report_range_last_7_days']);
      expect(result.requestedDays).toBe(7);
      expect(result.truncated).toBe(false);
    });

    it('resolves last_30_days to a 30-day range', () => {
      const result = resolveReportRangeFromKey(REPORT_RANGE_LAST_30_DAYS);
      expect(result.startDate).toBe(offsetDateString(-29));
      expect(result.endDate).toBe(todayDateString());
      expect(result.matchedBy).toEqual(['report_range_last_30_days']);
      expect(result.requestedDays).toBe(30);
      expect(result.truncated).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // extractReportRangeKey
  // -----------------------------------------------------------------------
  describe('extractReportRangeKey', () => {
    it('extracts last_30_days from "30天"', () => {
      expect(extractReportRangeKey('查看30天的报告')).toBe(
        REPORT_RANGE_LAST_30_DAYS,
      );
    });

    it('extracts last_30_days from "月报"', () => {
      expect(extractReportRangeKey('月报')).toBe(REPORT_RANGE_LAST_30_DAYS);
    });

    it('extracts last_30_days from "last 30 days"', () => {
      expect(extractReportRangeKey('last 30 days')).toBe(
        REPORT_RANGE_LAST_30_DAYS,
      );
    });

    it('extracts last_7_days from "7天"', () => {
      expect(extractReportRangeKey('7天报告')).toBe(REPORT_RANGE_LAST_7_DAYS);
    });

    it('extracts last_7_days from "周报"', () => {
      expect(extractReportRangeKey('周报')).toBe(REPORT_RANGE_LAST_7_DAYS);
    });

    it('extracts last_7_days from "last 7 days"', () => {
      expect(extractReportRangeKey('last 7 days')).toBe(
        REPORT_RANGE_LAST_7_DAYS,
      );
    });

    it('returns null when no pattern matches', () => {
      expect(extractReportRangeKey('just text')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // normalizeRange
  // -----------------------------------------------------------------------
  describe('normalizeRange', () => {
    it('returns dates in order when start <= end', () => {
      expect(normalizeRange('2026-06-01', '2026-06-05')).toEqual({
        startDate: '2026-06-01',
        endDate: '2026-06-05',
      });
    });

    it('swaps dates when start > end', () => {
      expect(normalizeRange('2026-06-05', '2026-06-01')).toEqual({
        startDate: '2026-06-01',
        endDate: '2026-06-05',
      });
    });

    it('handles equal start and end dates', () => {
      expect(normalizeRange('2026-06-01', '2026-06-01')).toEqual({
        startDate: '2026-06-01',
        endDate: '2026-06-01',
      });
    });
  });

  // -----------------------------------------------------------------------
  // diffDaysInclusive
  // -----------------------------------------------------------------------
  describe('diffDaysInclusive', () => {
    it('returns 1 for same day', () => {
      expect(diffDaysInclusive('2026-06-01', '2026-06-01')).toBe(1);
    });

    it('returns correct count for multi-day range', () => {
      expect(diffDaysInclusive('2026-06-01', '2026-06-05')).toBe(5);
    });

    it('returns correct count for cross-month range', () => {
      expect(diffDaysInclusive('2026-05-28', '2026-06-03')).toBe(7);
    });

    it('returns correct count for cross-year range', () => {
      expect(diffDaysInclusive('2025-12-30', '2026-01-02')).toBe(4);
    });
  });

  // -----------------------------------------------------------------------
  // enumerateDates
  // -----------------------------------------------------------------------
  describe('enumerateDates', () => {
    it('lists all dates in a range', () => {
      const dates = enumerateDates('2026-06-01', '2026-06-03');
      expect(dates).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
    });

    it('returns single date for same start and end', () => {
      const dates = enumerateDates('2026-06-01', '2026-06-01');
      expect(dates).toEqual(['2026-06-01']);
    });

    it('respects maxDays limit', () => {
      const dates = enumerateDates('2026-06-01', '2026-06-10', 3);
      expect(dates).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
    });

    it('returns all dates when maxDays is not provided', () => {
      const dates = enumerateDates('2026-06-01', '2026-06-05');
      expect(dates).toHaveLength(5);
    });
  });

  // -----------------------------------------------------------------------
  // todayDateString / offsetDateString
  // -----------------------------------------------------------------------
  describe('todayDateString', () => {
    it('returns today as YYYY-MM-DD', () => {
      const today = todayDateString();
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(today).toBe(formatDateOnly(new Date()));
    });
  });

  describe('offsetDateString', () => {
    it('returns today for offset 0', () => {
      expect(offsetDateString(0)).toBe(todayDateString());
    });

    it('returns yesterday for offset -1', () => {
      const yesterday = offsetDateString(-1);
      const expected = formatDateOnly(
        new Date(
          parseDateOnly(todayDateString()).getTime() - 24 * 60 * 60 * 1000,
        ),
      );
      expect(yesterday).toBe(expected);
    });

    it('returns tomorrow for offset +1', () => {
      const tomorrow = offsetDateString(1);
      const expected = formatDateOnly(
        new Date(
          parseDateOnly(todayDateString()).getTime() + 24 * 60 * 60 * 1000,
        ),
      );
      expect(tomorrow).toBe(expected);
    });
  });
});
