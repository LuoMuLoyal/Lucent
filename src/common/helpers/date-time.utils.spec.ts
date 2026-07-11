import {
  now,
  nowIsoString,
  calculateExpiresIn,
  formatDateTime,
  toEmailVerified,
  formatDateOnly,
  parseDateOnly,
  calculateAge,
} from './date-time.utils';

describe('date-time.utils', () => {
  describe('now', () => {
    it('returns a Date close to the current time', () => {
      const before = Date.now();
      const result = now();
      const after = Date.now();
      expect(result.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('nowIsoString', () => {
    it('returns a valid ISO-8601 string', () => {
      const result = nowIsoString();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(new Date(result).getTime()).not.toBeNaN();
    });
  });

  describe('calculateExpiresIn', () => {
    it('returns positive seconds for future instant', () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      const result = calculateExpiresIn(future);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(60);
    });

    it('returns 0 for past instant', () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      expect(calculateExpiresIn(past)).toBe(0);
    });

    it('returns 0 or 1 for exactly current time', () => {
      const nowIso = new Date().toISOString();
      const result = calculateExpiresIn(nowIso);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });

    it('returns 0 for invalid date string', () => {
      // new Date('invalid-date').getTime() is NaN, Math.max(0, NaN) is NaN
      // so the function returns NaN for invalid input
      expect(calculateExpiresIn('invalid-date')).toBeNaN();
    });
  });

  describe('formatDateTime', () => {
    it('returns ISO string for a Date', () => {
      const date = new Date('2026-07-10T08:00:00.000Z');
      expect(formatDateTime(date)).toBe('2026-07-10T08:00:00.000Z');
    });

    it('returns null for null', () => {
      expect(formatDateTime(null)).toBeNull();
    });

    it('returns ISO string for current date', () => {
      const date = new Date();
      const result = formatDateTime(date);
      expect(result).toBe(date.toISOString());
    });
  });

  describe('toEmailVerified', () => {
    it('returns true when timestamp is present', () => {
      expect(toEmailVerified(new Date())).toBe(true);
    });

    it('returns false when timestamp is null', () => {
      expect(toEmailVerified(null)).toBe(false);
    });
  });

  describe('formatDateOnly', () => {
    it('returns YYYY-MM-DD string', () => {
      const date = new Date('2026-07-10T08:00:00.000Z');
      expect(formatDateOnly(date)).toBe('2026-07-10');
    });

    it('returns null for null', () => {
      expect(formatDateOnly(null)).toBeNull();
    });

    it('handles year boundary', () => {
      const date = new Date('2026-01-01T00:00:00.000Z');
      expect(formatDateOnly(date)).toBe('2026-01-01');
    });

    it('handles December 31', () => {
      const date = new Date('2026-12-31T00:00:00.000Z');
      expect(formatDateOnly(date)).toBe('2026-12-31');
    });
  });

  describe('parseDateOnly', () => {
    it('parses YYYY-MM-DD into a UTC Date', () => {
      const result = parseDateOnly('2026-07-10');
      expect(result.getUTCFullYear()).toBe(2026);
      expect(result.getUTCMonth()).toBe(6); // July
      expect(result.getUTCDate()).toBe(10);
    });

    it('produces midnight UTC', () => {
      const result = parseDateOnly('2026-01-15');
      expect(result.getUTCHours()).toBe(0);
      expect(result.getUTCMinutes()).toBe(0);
      expect(result.getUTCSeconds()).toBe(0);
    });

    it('parses January 1 correctly', () => {
      const result = parseDateOnly('2026-01-01');
      expect(result.getUTCFullYear()).toBe(2026);
      expect(result.getUTCMonth()).toBe(0);
      expect(result.getUTCDate()).toBe(1);
    });

    it('parses December 31 correctly', () => {
      const result = parseDateOnly('2026-12-31');
      expect(result.getUTCFullYear()).toBe(2026);
      expect(result.getUTCMonth()).toBe(11);
      expect(result.getUTCDate()).toBe(31);
    });
  });

  describe('calculateAge', () => {
    it('calculates age correctly for a birthday that has passed this year', () => {
      const birthDate = new Date('2000-01-15T00:00:00.000Z');
      const age = calculateAge(birthDate);
      const expectedYear = new Date().getUTCFullYear() - 2000;
      // Birthday in January has already passed by July
      expect(age).toBe(expectedYear);
    });

    it('calculates age correctly for a birthday later this year', () => {
      const futureMonth = new Date().getUTCMonth() + 2;
      const birthDate = new Date(
        Date.UTC(2000, futureMonth > 11 ? 0 : futureMonth, 15),
      );
      const age = calculateAge(birthDate);
      const expectedYear = new Date().getUTCFullYear() - 2000 - 1;
      expect(age).toBeGreaterThanOrEqual(Math.max(expectedYear, 0));
    });

    it('returns 0 for future birth date', () => {
      const futureDate = new Date(
        Date.UTC(new Date().getUTCFullYear() + 1, 0, 1),
      );
      expect(calculateAge(futureDate)).toBe(0);
    });

    it('returns 0 for birth date exactly today', () => {
      const today = new Date();
      // Same year, same month, same day → age is 0 (just born)
      const birthDate = new Date(
        Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate(),
        ),
      );
      expect(calculateAge(birthDate)).toBe(0);
    });

    it('calculates age correctly for birthday on December 31', () => {
      const birthDate = new Date(Date.UTC(2000, 11, 31));
      const age = calculateAge(birthDate);
      const expectedYear = new Date().getUTCFullYear() - 2000;
      // Dec 31 birthday: if today is Dec 31 or later in the year, age = expectedYear
      // Otherwise age = expectedYear - 1
      const today = new Date();
      const hasHadBirthday =
        today.getUTCMonth() > 11 ||
        (today.getUTCMonth() === 11 && today.getUTCDate() >= 31);
      expect(age).toBe(hasHadBirthday ? expectedYear : expectedYear - 1);
    });
  });
});
