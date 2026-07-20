import {
  REFERENCE_DATA_UPDATED_AT,
  STATIC_SUPPORT_RESOURCES,
} from './support-resources-reference';

describe('support-resources-reference', () => {
  describe('REFERENCE_DATA_UPDATED_AT', () => {
    it('is a valid ISO 8601 timestamp', () => {
      expect(REFERENCE_DATA_UPDATED_AT).toBeTruthy();
      const date = new Date(REFERENCE_DATA_UPDATED_AT);
      expect(date.toISOString()).toBe(REFERENCE_DATA_UPDATED_AT);
    });
  });

  describe('STATIC_SUPPORT_RESOURCES', () => {
    it('is a non-empty array', () => {
      expect(Array.isArray(STATIC_SUPPORT_RESOURCES)).toBe(true);
      expect(STATIC_SUPPORT_RESOURCES.length).toBeGreaterThan(0);
    });

    it('each entry has required fields with correct types', () => {
      for (const entry of STATIC_SUPPORT_RESOURCES) {
        expect(typeof entry.id).toBe('string');
        expect(entry.id).toBeTruthy();
        expect(typeof entry.scope).toBe('string');
        expect(typeof entry.title).toBe('string');
        expect(typeof entry.titleKey).toBe('string');
        expect(typeof entry.subtitle).toBe('string');
        expect(typeof entry.subtitleKey).toBe('string');
        expect(typeof entry.icon).toBe('string');
        expect(typeof entry.available).toBe('boolean');
        // actionUrl and actionType are either string or null
        expect(
          entry.actionUrl === null || typeof entry.actionUrl === 'string',
        ).toBe(true);
        expect(
          entry.actionType === null || typeof entry.actionType === 'string',
        ).toBe(true);
      }
    });

    it('all IDs are unique', () => {
      const ids = STATIC_SUPPORT_RESOURCES.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('contains help-faq entry', () => {
      const faq = STATIC_SUPPORT_RESOURCES.find((r) => r.id === 'help-faq');
      expect(faq).toBeDefined();
      expect(faq!.scope).toBe('help');
      expect(faq!.available).toBe(false);
    });

    it('contains help-feedback entry', () => {
      const feedback = STATIC_SUPPORT_RESOURCES.find(
        (r) => r.id === 'help-feedback',
      );
      expect(feedback).toBeDefined();
      expect(feedback!.scope).toBe('help');
      expect(feedback!.available).toBe(false);
    });
  });
});
