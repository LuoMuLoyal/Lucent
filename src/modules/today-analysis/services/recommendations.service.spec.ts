import { TodayRecommendationsService } from './recommendations.service';

describe('TodayRecommendationsService', () => {
  let service: TodayRecommendationsService;

  beforeEach(() => {
    service = new TodayRecommendationsService();
  });

  describe('getRandomRecommendations', () => {
    it('returns at most 3 recommendations', () => {
      const result = service.getRandomRecommendations([], 'en');
      expect(result).toHaveLength(3);
    });

    it('returns recommendations with id and text', () => {
      const result = service.getRandomRecommendations([], 'en');
      for (const item of result) {
        expect(item.id).toBeDefined();
        expect(item.text).toBeDefined();
        expect(typeof item.text).toBe('string');
        expect(item.text.length).toBeGreaterThan(0);
      }
    });

    it('returns Chinese text when lang starts with zh', () => {
      const result = service.getRandomRecommendations([], 'zh-CN');
      const allChinese = result.every((r) => /[\u4e00-\u9fff]/.test(r.text));
      expect(allChinese).toBe(true);
    });

    it('returns English text when lang is en', () => {
      const result = service.getRandomRecommendations([], 'en');
      const allEnglish = result.every((r) => !/[\u4e00-\u9fff]/.test(r.text));
      expect(allEnglish).toBe(true);
    });

    it('defaults to English when lang is undefined', () => {
      const result = service.getRandomRecommendations([], undefined);
      const allEnglish = result.every((r) => !/[\u4e00-\u9fff]/.test(r.text));
      expect(allEnglish).toBe(true);
    });

    it('excludes recommendations by id', () => {
      const allIds = [
        'hydration',
        'sleep',
        'record-meal',
        'record-symptom',
        'medicine-safety',
        'walk',
        'mood',
        'report',
      ];
      const result = service.getRandomRecommendations(allIds, 'en');
      // All excluded → falls back to full list
      expect(result).toHaveLength(3);
    });

    it('excludes specified ids when possible', () => {
      const result = service.getRandomRecommendations(
        ['hydration', 'sleep'],
        'en',
      );
      const ids = result.map((r) => r.id);
      expect(ids).not.toContain('hydration');
      expect(ids).not.toContain('sleep');
    });

    it('includes category when available', () => {
      const result = service.getRandomRecommendations([], 'en');
      const withCategory = result.filter((r) => r.category != null);
      // Most recommendations have a category
      expect(withCategory.length).toBeGreaterThan(0);
    });

    it('returns different results across calls (randomization)', () => {
      const results: string[][] = [];
      for (let i = 0; i < 20; i++) {
        const ids = service.getRandomRecommendations([], 'en').map((r) => r.id);
        results.push(ids);
      }
      // At least 2 different orderings in 20 calls (extremely unlikely to be same)
      const unique = new Set(results.map((r) => r.join(',')));
      expect(unique.size).toBeGreaterThan(1);
    });
  });
});
