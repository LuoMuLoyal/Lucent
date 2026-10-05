import {
  kindLabel,
  statusPalette,
  metricLabel,
  statusLabel,
} from './report-pdf.theme.js';
import { createPdfTranslator } from './pdf-copy.js';
import { makeTestI18n } from '../../../common/tests/test-i18n.js';

/**
 * Labels resolve through the `data-export` dictionary, so these assertions
 * exercise the real shipped copy rather than inline ternaries. A missing key
 * would surface as `[[data-export.…]]` and fail here.
 */
const zh = createPdfTranslator(makeTestI18n(), 'zh-CN');
const en = createPdfTranslator(makeTestI18n(), 'en');

describe('report-pdf theme helpers', () => {
  describe('kindLabel', () => {
    it('returns Chinese label for hospital kind', () => {
      expect(kindLabel('hospital', zh)).toBe('导出类型：医疗就诊报告');
    });

    it('returns English label for hospital kind', () => {
      expect(kindLabel('hospital', en)).toBe('Export type: Hospital report');
    });

    it('returns Chinese label for monthly kind', () => {
      expect(kindLabel('monthly', zh)).toBe('导出类型：月度报告');
    });

    it('returns English label for monthly kind', () => {
      expect(kindLabel('monthly', en)).toBe('Export type: Monthly report');
    });

    it('returns Chinese label for print kind', () => {
      expect(kindLabel('print', zh)).toBe('导出类型：打印报告');
    });

    it('returns English label for print kind', () => {
      expect(kindLabel('print', en)).toBe('Export type: Print report');
    });
  });

  describe('statusPalette', () => {
    it('returns a palette for each known status', () => {
      for (const status of [
        'good',
        'stable',
        'needs_attention',
        'insufficient_data',
      ]) {
        const palette = statusPalette(status);
        expect(palette.fill, status).toBeDefined();
        expect(palette.border, status).toBeDefined();
        expect(palette.accent, status).toBeDefined();
        expect(palette.text, status).toBeDefined();
      }
    });

    it('falls back to the neutral palette for an unknown status', () => {
      expect(statusPalette('unknown').accent).toEqual(
        statusPalette('insufficient_data').accent,
      );
    });
  });

  describe('metricLabel', () => {
    it('returns Chinese label for medication metric', () => {
      expect(metricLabel('medication', zh)).toBe('服药完成度');
    });

    it('returns English label for medication metric', () => {
      expect(metricLabel('medication', en)).toBe('Medication adherence');
    });

    it('returns Chinese label for water metric', () => {
      expect(metricLabel('water', zh)).toBe('饮水');
    });

    it('returns English label for water metric', () => {
      expect(metricLabel('water', en)).toBe('Hydration');
    });

    it('returns Chinese label for sleep metric', () => {
      expect(metricLabel('sleep', zh)).toBe('睡眠');
    });

    it('returns English label for sleep metric', () => {
      expect(metricLabel('sleep', en)).toBe('Sleep');
    });

    it('passes an unknown metric through verbatim', () => {
      // Unrecognised kinds are schema drift; showing the raw value is more
      // diagnosable than a generic label.
      expect(metricLabel('exercise', zh)).toBe('exercise');
      expect(metricLabel('exercise', en)).toBe('exercise');
    });
  });

  describe('statusLabel', () => {
    it('returns Chinese label for good status', () => {
      expect(statusLabel('good', zh)).toBe('良好');
    });

    it('returns English label for good status', () => {
      expect(statusLabel('good', en)).toBe('Good');
    });

    it('returns Chinese label for stable status', () => {
      expect(statusLabel('stable', zh)).toBe('稳定');
    });

    it('returns English label for stable status', () => {
      expect(statusLabel('stable', en)).toBe('Stable');
    });

    it('returns Chinese label for needs_attention status', () => {
      expect(statusLabel('needs_attention', zh)).toBe('需关注');
    });

    it('returns English label for needs_attention status', () => {
      expect(statusLabel('needs_attention', en)).toBe('Needs attention');
    });

    it('returns Chinese label for insufficient_data status', () => {
      expect(statusLabel('insufficient_data', zh)).toBe('数据不足');
    });

    it('returns English label for insufficient_data status', () => {
      expect(statusLabel('insufficient_data', en)).toBe('Insufficient data');
    });

    it('passes an unknown status through verbatim', () => {
      expect(statusLabel('custom_status', zh)).toBe('custom_status');
    });
  });
});
