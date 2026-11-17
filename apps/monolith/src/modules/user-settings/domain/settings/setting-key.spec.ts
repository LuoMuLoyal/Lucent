import {
  ASSISTANT_CONTEXT_DEFAULTS,
  ASSISTANT_CONTEXT_SETTING_KEYS,
  USER_SETTING_KEYS,
  USER_SETTINGS_DEFAULTS,
  listDefaultBooleanUserSettings,
} from './setting-key.js';

describe('user-settings keys', () => {
  describe('USER_SETTING_KEYS', () => {
    it('contains the five top-level settings', () => {
      expect(Object.keys(USER_SETTING_KEYS)).toHaveLength(5);
      expect(USER_SETTING_KEYS.aiSummariesEnabled).toBeDefined();
      expect(USER_SETTING_KEYS.dataSharingConsent).toBeDefined();
      expect(USER_SETTING_KEYS.assistantEnabled).toBeDefined();
      expect(USER_SETTING_KEYS.assistantMemoryEnabled).toBeDefined();
      expect(USER_SETTING_KEYS.waterTargetCount).toBeDefined();
    });

    it('all stored keys are non-empty strings', () => {
      for (const value of Object.values(USER_SETTING_KEYS)) {
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      }
    });

    it('persists assistant context toggles as their own prefixed rows', () => {
      for (const key of Object.values(ASSISTANT_CONTEXT_SETTING_KEYS)) {
        expect(key.startsWith('assistantContext.')).toBe(true);
      }
    });
  });

  describe('defaults', () => {
    it('keeps memory off while the assistant itself is on', () => {
      expect(USER_SETTINGS_DEFAULTS.assistantEnabled).toBe(true);
      expect(USER_SETTINGS_DEFAULTS.assistantMemoryEnabled).toBe(false);
    });

    it('grants every assistant context source by default', () => {
      for (const value of Object.values(ASSISTANT_CONTEXT_DEFAULTS)) {
        expect(value).toBe(true);
      }
    });
  });

  describe('listDefaultBooleanUserSettings', () => {
    it('covers the top-level booleans plus the four context toggles', () => {
      const defaults = listDefaultBooleanUserSettings();
      // aiSummariesEnabled, assistantEnabled, assistantMemoryEnabled + 4 context
      expect(defaults).toHaveLength(7);
      const keys = defaults.map((entry) => entry.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys).toContain(USER_SETTING_KEYS.aiSummariesEnabled);
      expect(keys).toContain(ASSISTANT_CONTEXT_SETTING_KEYS.currentMedicines);
    });

    it('only lists boolean settings (waterTargetCount is numeric)', () => {
      for (const entry of listDefaultBooleanUserSettings()) {
        expect(typeof entry.value).toBe('boolean');
        expect(entry.key).not.toBe(USER_SETTING_KEYS.waterTargetCount);
      }
    });
  });
});
