import {
  clampPage,
  clampPageSize,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
} from './pagination.utils';

describe('pagination utils', () => {
  describe('clampPage', () => {
    it('returns 1 for values less than 1', () => {
      expect(clampPage(0)).toBe(1);
      expect(clampPage(-5)).toBe(1);
    });

    it('returns the input for values >= 1', () => {
      expect(clampPage(1)).toBe(1);
      expect(clampPage(10)).toBe(10);
      expect(clampPage(1000)).toBe(1000);
    });
  });

  describe('clampPageSize', () => {
    it('clamps to 1 for values less than 1', () => {
      expect(clampPageSize(0)).toBe(1);
      expect(clampPageSize(-10)).toBe(1);
    });

    it('returns the input for values within [1, MAX_PAGE_SIZE]', () => {
      expect(clampPageSize(1)).toBe(1);
      expect(clampPageSize(50)).toBe(50);
      expect(clampPageSize(MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE);
    });

    it('clamps to MAX_PAGE_SIZE for values exceeding it', () => {
      expect(clampPageSize(101)).toBe(MAX_PAGE_SIZE);
      expect(clampPageSize(999999)).toBe(MAX_PAGE_SIZE);
    });

    it('respects a custom max', () => {
      expect(clampPageSize(200, 20)).toBe(20);
      expect(clampPageSize(15, 20)).toBe(15);
    });
  });

  describe('constants', () => {
    it('DEFAULT_PAGE_SIZE is 50', () => {
      expect(DEFAULT_PAGE_SIZE).toBe(50);
    });

    it('MAX_PAGE_SIZE is 100', () => {
      expect(MAX_PAGE_SIZE).toBe(100);
    });
  });
});
