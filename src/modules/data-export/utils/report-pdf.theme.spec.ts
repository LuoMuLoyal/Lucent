import {
  kindLabel,
  statusPalette,
  metricLabel,
  statusLabel,
} from './report-pdf.theme';

describe('report-pdf theme helpers', () => {
  describe('kindLabel', () => {
    it('returns Chinese label for hospital kind', () => {
      expect(kindLabel('hospital', true)).toBe('导出类型：医疗就诊报告');
    });

    it('returns English label for hospital kind', () => {
      expect(kindLabel('hospital', false)).toBe('Export type: Hospital report');
    });

    it('returns Chinese label for monthly kind', () => {
      expect(kindLabel('monthly', true)).toBe('导出类型：月度报告');
    });

    it('returns English label for monthly kind', () => {
      expect(kindLabel('monthly', false)).toBe('Export type: Monthly report');
    });

    it('returns Chinese label for print kind', () => {
      expect(kindLabel('print', true)).toBe('导出类型：打印报告');
    });

    it('returns English label for print kind', () => {
      expect(kindLabel('print', false)).toBe('Export type: Print report');
    });
  });

  describe('statusPalette', () => {
    it('returns palette for good status', () => {
      const palette = statusPalette('good');
      expect(palette.fill).toBeDefined();
      expect(palette.border).toBeDefined();
      expect(palette.accent).toBeDefined();
      expect(palette.text).toBeDefined();
    });

    it('returns palette for stable status', () => {
      const palette = statusPalette('stable');
      expect(palette.fill).toBeDefined();
      expect(palette.border).toBeDefined();
    });

    it('returns palette for needs_attention status', () => {
      const palette = statusPalette('needs_attention');
      expect(palette.fill).toBeDefined();
      expect(palette.border).toBeDefined();
    });

    it('returns palette for insufficient_data status', () => {
      const palette = statusPalette('insufficient_data');
      expect(palette.fill).toBeDefined();
      expect(palette.border).toBeDefined();
    });

    it('returns default palette for unknown status', () => {
      const palette = statusPalette('unknown_status');
      const expectedDefault = statusPalette('insufficient_data');
      expect(palette.fill).toEqual(expectedDefault.fill);
      expect(palette.border).toEqual(expectedDefault.border);
    });

    it('returns different palettes for good vs needs_attention', () => {
      const good = statusPalette('good');
      const needsAttention = statusPalette('needs_attention');
      expect(good.fill).not.toEqual(needsAttention.fill);
    });
  });

  describe('metricLabel', () => {
    it('returns Chinese label for medication', () => {
      expect(metricLabel('medication', true)).toBe('服药完成度');
    });

    it('returns English label for medication', () => {
      expect(metricLabel('medication', false)).toBe('Medication adherence');
    });

    it('returns Chinese label for water', () => {
      expect(metricLabel('water', true)).toBe('饮水');
    });

    it('returns English label for water', () => {
      expect(metricLabel('water', false)).toBe('Hydration');
    });

    it('returns Chinese label for sleep', () => {
      expect(metricLabel('sleep', true)).toBe('睡眠');
    });

    it('returns English label for sleep', () => {
      expect(metricLabel('sleep', false)).toBe('Sleep');
    });

    it('returns the raw kind for unknown metric', () => {
      expect(metricLabel('exercise', true)).toBe('exercise');
      expect(metricLabel('exercise', false)).toBe('exercise');
    });
  });

  describe('statusLabel', () => {
    it('returns Chinese label for good', () => {
      expect(statusLabel('good', true)).toBe('良好');
    });

    it('returns English label for good', () => {
      expect(statusLabel('good', false)).toBe('Good');
    });

    it('returns Chinese label for stable', () => {
      expect(statusLabel('stable', true)).toBe('稳定');
    });

    it('returns English label for stable', () => {
      expect(statusLabel('stable', false)).toBe('Stable');
    });

    it('returns Chinese label for needs_attention', () => {
      expect(statusLabel('needs_attention', true)).toBe('需关注');
    });

    it('returns English label for needs_attention', () => {
      expect(statusLabel('needs_attention', false)).toBe('Needs attention');
    });

    it('returns Chinese label for insufficient_data', () => {
      expect(statusLabel('insufficient_data', true)).toBe('数据不足');
    });

    it('returns English label for insufficient_data', () => {
      expect(statusLabel('insufficient_data', false)).toBe('Insufficient data');
    });

    it('returns the raw status for unknown value', () => {
      expect(statusLabel('custom_status', true)).toBe('custom_status');
    });
  });
});
