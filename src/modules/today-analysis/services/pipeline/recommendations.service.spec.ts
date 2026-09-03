import { TodayRecommendationsService } from './recommendations.service.js';

describe('TodayRecommendationsService', () => {
  let service: TodayRecommendationsService;

  beforeEach(() => {
    service = new TodayRecommendationsService();
  });

  describe('getColdStartGuides', () => {
    it('returns all guides when no ids are excluded', () => {
      const result = service.getColdStartGuides([], 'en');
      expect(result.length).toBeGreaterThan(0);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'add-medicine',
            category: 'onboarding',
          }),
          expect.objectContaining({ id: 'log-water', category: 'onboarding' }),
          expect.objectContaining({
            id: 'record-sleep',
            category: 'onboarding',
          }),
          expect.objectContaining({ id: 'check-mood', category: 'onboarding' }),
        ]),
      );
    });

    it('returns guides with id and text', () => {
      const result = service.getColdStartGuides([], 'en');
      for (const item of result) {
        expect(item.id).toBeDefined();
        expect(item.text).toBeDefined();
        expect(typeof item.text).toBe('string');
        expect(item.text.length).toBeGreaterThan(0);
        expect(item.category).toBe('onboarding');
      }
    });

    it('returns Chinese text when lang starts with zh', () => {
      const result = service.getColdStartGuides([], 'zh-CN');
      const allChinese = result.every((r) => /[\u4E00-\u9FFF]/.test(r.text));
      expect(allChinese).toBe(true);
    });

    it('returns English text when lang is en', () => {
      const result = service.getColdStartGuides([], 'en');
      const allEnglish = result.every((r) => !/[\u4E00-\u9FFF]/.test(r.text));
      expect(allEnglish).toBe(true);
    });

    it('defaults to English when lang is undefined', () => {
      const result = service.getColdStartGuides([], undefined);
      const allEnglish = result.every((r) => !/[\u4E00-\u9FFF]/.test(r.text));
      expect(allEnglish).toBe(true);
    });

    it('excludes specified ids', () => {
      const result = service.getColdStartGuides(['add-medicine', 'log-water']);
      const ids = result.map((r) => r.id);
      expect(ids).not.toContain('add-medicine');
      expect(ids).not.toContain('log-water');
    });

    it('returns an empty array when all guides are excluded', () => {
      const allIds = [
        'add-medicine',
        'log-water',
        'record-sleep',
        'check-mood',
      ];
      const result = service.getColdStartGuides(allIds);
      expect(result).toHaveLength(0);
    });

    it('returns the same deterministic order across calls', () => {
      const first = service.getColdStartGuides([], 'en').map((r) => r.id);
      const second = service.getColdStartGuides([], 'en').map((r) => r.id);
      expect(first).toEqual(second);
    });
  });
});
