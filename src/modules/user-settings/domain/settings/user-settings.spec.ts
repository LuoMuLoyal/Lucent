import { UserSettings, type StoredSettingRow } from './user-settings.js';

function row(key: string, value: unknown, updatedAt: string): StoredSettingRow {
  return { key, value, updatedAt: new Date(updatedAt) };
}

describe('UserSettings aggregate', () => {
  describe('fromRows', () => {
    it('falls back to every default when the user has no rows', () => {
      const snapshot = UserSettings.fromRows('user-1', []).toSnapshot();

      expect(snapshot).toEqual({
        aiSummariesEnabled: true,
        dataSharingConsent: false,
        assistantEnabled: true,
        assistantMemoryEnabled: false,
        waterTargetCount: 8,
        assistantContext: {
          healthProfile: true,
          dailyRecords: true,
          sleepRecords: true,
          currentMedicines: true,
        },
        updatedAt: null,
        passwordReauthenticationRequired: true,
      });
    });

    it('merges stored rows over the defaults', () => {
      const snapshot = UserSettings.fromRows('user-1', [
        row('assistantMemoryEnabled', true, '2026-06-17T11:00:00.000Z'),
        row('assistantContext.sleepRecords', false, '2026-06-17T10:00:00.000Z'),
        row('assistantEnabled', false, '2026-06-17T09:00:00.000Z'),
        row('dataSharingConsent', true, '2026-06-16T08:00:00.000Z'),
      ]).toSnapshot();

      expect(snapshot.aiSummariesEnabled).toBe(true);
      expect(snapshot.dataSharingConsent).toBe(true);
      expect(snapshot.assistantEnabled).toBe(false);
      expect(snapshot.assistantMemoryEnabled).toBe(true);
      expect(snapshot.waterTargetCount).toBe(8);
      expect(snapshot.assistantContext).toEqual({
        healthProfile: true,
        dailyRecords: true,
        sleepRecords: false,
        currentMedicines: true,
      });
      expect(snapshot.updatedAt).toEqual(new Date('2026-06-17T11:00:00.000Z'));
    });

    it('ignores rows whose value has the wrong type instead of coercing', () => {
      // A hand-edited or half-migrated row must not turn `true` into `"true"`,
      // nor let a string reach a numeric field.
      const snapshot = UserSettings.fromRows('user-1', [
        row('aiSummariesEnabled', 'yes', '2026-06-17T11:00:00.000Z'),
        row('waterTargetCount', null, '2026-06-17T10:00:00.000Z'),
      ]).toSnapshot();

      expect(snapshot.aiSummariesEnabled).toBe(true);
      expect(snapshot.waterTargetCount).toBe(8);
      // The row still exists, so the resource has been written before.
      expect(snapshot.updatedAt).not.toBeNull();
    });

    it('rejects a non-finite numeric row', () => {
      const snapshot = UserSettings.fromRows('user-1', [
        row('waterTargetCount', Number.NaN, '2026-06-17T11:00:00.000Z'),
      ]).toSnapshot();

      expect(snapshot.waterTargetCount).toBe(8);
    });

    it('reads updatedAt from the newest row handed over by the repository', () => {
      const snapshot = UserSettings.fromRows('user-1', [
        row('waterTargetCount', 12, '2026-07-01T00:00:00.000Z'),
        row('assistantEnabled', false, '2026-06-01T00:00:00.000Z'),
      ]).toSnapshot();

      expect(snapshot.updatedAt).toEqual(new Date('2026-07-01T00:00:00.000Z'));
    });
  });

  describe('upsertsFor', () => {
    it('turns only the supplied top-level fields into rows', () => {
      const upserts = UserSettings.upsertsFor({
        assistantEnabled: false,
        waterTargetCount: 12,
      });

      expect(upserts).toEqual([
        { key: 'assistantEnabled', value: false },
        { key: 'waterTargetCount', value: 12 },
      ]);
    });

    it('turns nested context flags into their own prefixed rows', () => {
      const upserts = UserSettings.upsertsFor({
        assistantContext: { healthProfile: false, sleepRecords: false },
      });

      expect(upserts).toEqual([
        { key: 'assistantContext.healthProfile', value: false },
        { key: 'assistantContext.sleepRecords', value: false },
      ]);
    });

    it('produces no rows for an empty patch', () => {
      expect(UserSettings.upsertsFor({})).toEqual([]);
      expect(UserSettings.upsertsFor({ assistantContext: {} })).toEqual([]);
    });

    it('keeps an explicit false (falsy but supplied)', () => {
      expect(UserSettings.upsertsFor({ dataSharingConsent: false })).toEqual([
        { key: 'dataSharingConsent', value: false },
      ]);
    });
  });
});
