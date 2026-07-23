import {
  USER_SETTING_KEYS,
  ASSISTANT_CONTEXT_SETTING_KEYS,
  USER_SETTINGS_DEFAULTS,
  ASSISTANT_CONTEXT_DEFAULTS,
  listDefaultBooleanUserSettings,
} from './settings.constants';

describe('user-settings constants', () => {
  describe('USER_SETTING_KEYS', () => {
    it('contains expected keys', () => {
      expect(USER_SETTING_KEYS.aiSummariesEnabled).toBeDefined();
      expect(USER_SETTING_KEYS.dataSharingConsent).toBeDefined();
      expect(USER_SETTING_KEYS.assistantEnabled).toBeDefined();
      expect(USER_SETTING_KEYS.assistantMemoryEnabled).toBeDefined();
      expect(USER_SETTING_KEYS.waterTargetCount).toBeDefined();
    });

    it('all values are strings', () => {
      for (const value of Object.values(USER_SETTING_KEYS)) {
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      }
    });
  });

  describe('ASSISTANT_CONTEXT_SETTING_KEYS', () => {
    it('contains 4 context sources', () => {
      expect(Object.keys(ASSISTANT_CONTEXT_SETTING_KEYS)).toHaveLength(4);
    });

    it('has healthProfile, dailyRecords, sleepRecords, currentMedicines', () => {
      expect(ASSISTANT_CONTEXT_SETTING_KEYS.healthProfile).toBeDefined();
      expect(ASSISTANT_CONTEXT_SETTING_KEYS.dailyRecords).toBeDefined();
      expect(ASSISTANT_CONTEXT_SETTING_KEYS.sleepRecords).toBeDefined();
      expect(ASSISTANT_CONTEXT_SETTING_KEYS.currentMedicines).toBeDefined();
    });
  });

  describe('USER_SETTINGS_DEFAULTS', () => {
    it('aiSummariesEnabled defaults to true', () => {
      expect(USER_SETTINGS_DEFAULTS.aiSummariesEnabled).toBe(true);
    });

    it('dataSharingConsent defaults to false', () => {
      expect(USER_SETTINGS_DEFAULTS.dataSharingConsent).toBe(false);
    });

    it('assistantEnabled defaults to true', () => {
      expect(USER_SETTINGS_DEFAULTS.assistantEnabled).toBe(true);
    });

    it('assistantMemoryEnabled defaults to false', () => {
      expect(USER_SETTINGS_DEFAULTS.assistantMemoryEnabled).toBe(false);
    });

    it('waterTargetCount defaults to 8', () => {
      expect(USER_SETTINGS_DEFAULTS.waterTargetCount).toBe(8);
    });
  });

  describe('ASSISTANT_CONTEXT_DEFAULTS', () => {
    it('all context defaults are true', () => {
      expect(ASSISTANT_CONTEXT_DEFAULTS.healthProfile).toBe(true);
      expect(ASSISTANT_CONTEXT_DEFAULTS.dailyRecords).toBe(true);
      expect(ASSISTANT_CONTEXT_DEFAULTS.sleepRecords).toBe(true);
      expect(ASSISTANT_CONTEXT_DEFAULTS.currentMedicines).toBe(true);
    });
  });

  describe('listDefaultBooleanUserSettings', () => {
    it('returns 7 entries (3 user settings + 4 context settings)', () => {
      const entries = listDefaultBooleanUserSettings();
      expect(entries).toHaveLength(7);
    });

    it('all entries have key and value', () => {
      const entries = listDefaultBooleanUserSettings();
      for (const entry of entries) {
        expect(typeof entry.key).toBe('string');
        expect(typeof entry.value).toBe('boolean');
      }
    });

    it('includes aiSummariesEnabled with value true', () => {
      const entries = listDefaultBooleanUserSettings();
      const found = entries.find(
        (e) => e.key === USER_SETTING_KEYS.aiSummariesEnabled,
      );
      expect(found).toBeDefined();
      expect(found!.value).toBe(true);
    });

    it('includes assistantEnabled with value true', () => {
      const entries = listDefaultBooleanUserSettings();
      const found = entries.find(
        (e) => e.key === USER_SETTING_KEYS.assistantEnabled,
      );
      expect(found).toBeDefined();
      expect(found!.value).toBe(true);
    });

    it('includes assistantMemoryEnabled with value false', () => {
      const entries = listDefaultBooleanUserSettings();
      const found = entries.find(
        (e) => e.key === USER_SETTING_KEYS.assistantMemoryEnabled,
      );
      expect(found).toBeDefined();
      expect(found!.value).toBe(false);
    });

    it('includes all 4 context setting keys', () => {
      const entries = listDefaultBooleanUserSettings();
      const contextKeys = Object.values(ASSISTANT_CONTEXT_SETTING_KEYS);
      for (const key of contextKeys) {
        expect(entries.some((e) => e.key === key)).toBe(true);
      }
    });

    it('all context values match ASSISTANT_CONTEXT_DEFAULTS', () => {
      const entries = listDefaultBooleanUserSettings();
      const contextKeys = Object.entries(ASSISTANT_CONTEXT_SETTING_KEYS);
      for (const [field, key] of contextKeys) {
        const entry = entries.find((e) => e.key === key);
        expect(entry).toBeDefined();
        expect(entry!.value).toBe(
          ASSISTANT_CONTEXT_DEFAULTS[
            field as keyof typeof ASSISTANT_CONTEXT_DEFAULTS
          ],
        );
      }
    });
  });
});
