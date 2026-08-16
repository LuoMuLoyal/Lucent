import {
  DEFAULT_TIMEZONE,
  formatLocalDate,
  wallClockToScheduledFor,
} from './delivery-moment';

describe('delivery-moment', () => {
  describe('DEFAULT_TIMEZONE', () => {
    it('defaults to Asia/Shanghai', () => {
      expect(DEFAULT_TIMEZONE).toBe('Asia/Shanghai');
    });
  });

  describe('formatLocalDate', () => {
    it('renders the local date in the given timezone', () => {
      // 2026-07-20T00:30:00Z = 08:30 in Asia/Shanghai
      const date = new Date('2026-07-20T00:30:00.000Z');
      expect(formatLocalDate(date, 'Asia/Shanghai')).toBe('2026-07-20');
    });

    it('falls back to the default timezone when null', () => {
      const date = new Date('2026-07-20T00:30:00.000Z');
      expect(formatLocalDate(date, null)).toBe('2026-07-20');
    });

    it('handles negative-offset timezones (previous calendar day)', () => {
      // 2026-07-20T00:30:00Z = 20:30 on 2026-07-19 in America/New_York (UTC-4)
      const date = new Date('2026-07-20T00:30:00.000Z');
      expect(formatLocalDate(date, 'America/New_York')).toBe('2026-07-19');
    });
  });

  describe('wallClockToScheduledFor', () => {
    it('converts a positive-offset wall clock to UTC truncated to the minute', () => {
      // Asia/Shanghai (UTC+8) 08:30 → UTC 00:30
      expect(
        wallClockToScheduledFor('2026-07-20', '08:30', 'Asia/Shanghai'),
      ).toEqual(new Date('2026-07-20T00:30:00.000Z'));
    });

    it('converts a negative-offset wall clock to UTC', () => {
      // America/New_York (UTC-4 in July) 08:30 → UTC 12:30
      expect(
        wallClockToScheduledFor('2026-07-20', '08:30', 'America/New_York'),
      ).toEqual(new Date('2026-07-20T12:30:00.000Z'));
    });

    it('respects DST (winter offset for New York is UTC-5)', () => {
      // January 2026: America/New_York is UTC-5 → 08:30 local = 13:30 UTC
      expect(
        wallClockToScheduledFor('2026-01-15', '08:30', 'America/New_York'),
      ).toEqual(new Date('2026-01-15T13:30:00.000Z'));
    });

    it('falls back to the default timezone when null', () => {
      // Asia/Shanghai 00:30 → UTC 16:30（前一天）
      expect(wallClockToScheduledFor('2026-07-20', '00:30', null)).toEqual(
        new Date('2026-07-19T16:30:00.000Z'),
      );
      expect(
        wallClockToScheduledFor(
          '2026-07-20',
          '00:30',
          undefined as unknown as string | null,
        ),
      ).toEqual(new Date('2026-07-19T16:30:00.000Z'));
    });

    it('keeps seconds and milliseconds at zero', () => {
      const result = wallClockToScheduledFor(
        '2026-07-20',
        '08:30',
        'Asia/Shanghai',
      );
      expect(result.getUTCSeconds()).toBe(0);
      expect(result.getUTCMilliseconds()).toBe(0);
    });
  });
});
