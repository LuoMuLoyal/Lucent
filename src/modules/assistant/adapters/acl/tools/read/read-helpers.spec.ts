import { describeReminderFrequency, mapSleepQuality } from './read-helpers.js';

describe('read-helpers', () => {
  // -----------------------------------------------------------------------
  // describeReminderFrequency
  // -----------------------------------------------------------------------
  describe('describeReminderFrequency', () => {
    it('returns null for empty array', () => {
      expect(describeReminderFrequency([])).toBeNull();
    });

    it('returns "daily" when daysOfWeek is absent', () => {
      const result = describeReminderFrequency([
        { scheduledHour: 8, scheduledMinute: 30 },
      ]);
      expect(result).toBe('daily @ 08:30');
    });

    it('returns "daily" when daysOfWeek is empty array', () => {
      const result = describeReminderFrequency([
        { daysOfWeek: [], scheduledHour: 8, scheduledMinute: 30 },
      ]);
      expect(result).toBe('daily @ 08:30');
    });

    it('returns "N days/week" when daysOfWeek has entries', () => {
      const result = describeReminderFrequency([
        {
          daysOfWeek: [1, 3, 5],
          scheduledHour: 8,
          scheduledMinute: 30,
        },
      ]);
      expect(result).toContain('3 days/week');
      expect(result).toContain('08:30');
    });

    it('lists all reminder times sorted by hour:minute', () => {
      const result = describeReminderFrequency([
        { scheduledHour: 8, scheduledMinute: 0 },
        { scheduledHour: 12, scheduledMinute: 30 },
        { scheduledHour: 20, scheduledMinute: 0 },
      ]);
      expect(result).toBe('daily @ 08:00, 12:30, 20:00');
    });

    it('pads single-digit hours and minutes with leading zeros', () => {
      const result = describeReminderFrequency([
        { scheduledHour: 9, scheduledMinute: 5 },
      ]);
      expect(result).toBe('daily @ 09:05');
    });

    it('uses the first reminder for daily/days-per-week classification', () => {
      const result = describeReminderFrequency([
        { daysOfWeek: [1, 2, 3, 4, 5], scheduledHour: 8, scheduledMinute: 0 },
        { scheduledHour: 12, scheduledMinute: 0 },
      ]);
      expect(result).toContain('5 days/week');
    });
  });

  // -----------------------------------------------------------------------
  // mapSleepQuality
  // -----------------------------------------------------------------------
  describe('mapSleepQuality', () => {
    it('maps "poor" to 1', () => {
      expect(mapSleepQuality('poor')).toBe(1);
    });

    it('maps "fair" to 2', () => {
      expect(mapSleepQuality('fair')).toBe(2);
    });

    it('maps "good" to 3', () => {
      expect(mapSleepQuality('good')).toBe(3);
    });

    it('returns null for null input', () => {
      expect(mapSleepQuality(null)).toBeNull();
    });

    it('returns null for unrecognized string', () => {
      expect(mapSleepQuality('excellent')).toBeNull();
      expect(mapSleepQuality('')).toBeNull();
    });
  });
});
