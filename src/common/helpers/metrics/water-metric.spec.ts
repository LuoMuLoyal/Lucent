import {
  parseWaterMetric,
  summarizeWaterMetrics,
  type WaterMetricInput,
} from './water-metric';

describe('water-metric helpers', () => {
  describe('parseWaterMetric', () => {
    it('normalizes supported units to integer milliliters', () => {
      expect(parseWaterMetric({ value: '500', unit: ' ml ' })).toEqual({
        valueMl: 500,
      });
      expect(parseWaterMetric({ value: '0.5', unit: ' L ' })).toEqual({
        valueMl: 500,
      });
      expect(parseWaterMetric({ value: '0.25', unit: 'LITER' })).toEqual({
        valueMl: 250,
      });
      expect(parseWaterMetric({ value: 1, unit: ' litre ' })).toEqual({
        valueMl: 1000,
      });
    });

    it('keeps an explicitly recorded zero as a valid observation', () => {
      expect(parseWaterMetric({ value: '0', unit: 'ml' })).toEqual({
        valueMl: 0,
      });
    });

    it.each([
      { value: null, unit: 'ml' },
      { value: '', unit: 'ml' },
      { value: '   ', unit: 'ml' },
      { value: 'not-a-number', unit: 'ml' },
      { value: Infinity, unit: 'ml' },
      { value: -1, unit: 'ml' },
      { value: '1', unit: 'cup' },
      { value: '1', unit: null },
    ] satisfies WaterMetricInput[])('ignores invalid input %#', (input) => {
      expect(parseWaterMetric(input)).toBeNull();
    });
  });

  describe('summarizeWaterMetrics', () => {
    it('returns unknown for an empty collection', () => {
      expect(summarizeWaterMetrics([])).toEqual({
        totalMl: null,
        state: 'unknown',
        observedCount: 0,
        ignoredCount: 0,
      });
    });

    it('returns unknown when no record is valid', () => {
      const result = summarizeWaterMetrics([
        { value: null, unit: 'ml' },
        { value: '-10', unit: 'ml' },
        { value: '1', unit: 'cup' },
      ]);

      expect(result).toEqual({
        totalMl: null,
        state: 'unknown',
        observedCount: 0,
        ignoredCount: 3,
      });
    });

    it('sums valid records and keeps observed zero distinct from unknown', () => {
      const result = summarizeWaterMetrics([
        { value: '0', unit: 'ml' },
        { value: '0.5', unit: 'liter' },
        { value: 'bad', unit: 'ml' },
      ]);

      expect(result).toEqual({
        totalMl: 500,
        state: 'observed',
        observedCount: 2,
        ignoredCount: 1,
      });
    });

    it('returns observed zero when the only valid record is zero', () => {
      expect(summarizeWaterMetrics([{ value: 0, unit: 'ML' }])).toEqual({
        totalMl: 0,
        state: 'observed',
        observedCount: 1,
        ignoredCount: 0,
      });
    });
  });
});
