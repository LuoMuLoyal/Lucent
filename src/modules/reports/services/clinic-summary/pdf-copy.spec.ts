import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createClinicSummaryPdfTranslator } from './pdf-copy.js';
import { makeTestI18n } from '../../../../common/tests/test-i18n.js';

/**
 * Every key the clinic-summary PDF renderers resolve must exist in both
 * locales: a miss renders `[[reports-clinic-summary.pdf.<key>]]` into a
 * user-facing PDF that cannot be re-rendered for review.
 */
const KEYS = [
  'title',
  'kind',
  'header',
  'footer_note',
  'page_number',
  'metadata_subject',
  'disclaimer_line',
  'section.profile',
  'section.allergies',
  'section.conditions',
  'section.medicines',
  'section.findings',
  'section.water',
  'section.sleep',
  'section.notes',
  'field.nickname',
  'field.age',
  'field.sex',
  'value.age_years',
  'value.not_provided',
  'value.placeholder',
  'value.insufficient_data',
  'table.name',
  'table.reaction',
  'table.severity',
  'table.status',
  'table.diagnosed_year',
  'table.medicine_name',
  'table.dosage',
  'table.date',
  'table.water_intake_ml',
  'table.sleep_duration_min',
  'table.kind',
  'table.note',
  'empty.no_known_allergies',
  'empty.no_recorded_conditions',
  'empty.no_current_medicines',
  'findings_note',
] as const;

describe('clinic-summary PDF copy', () => {
  it.each(['zh-CN', 'en'] as const)('resolves every key in %s', (locale) => {
    const t = createClinicSummaryPdfTranslator(makeTestI18n(), locale);

    for (const key of KEYS) {
      expect(t(key), `missing key: ${key}`).not.toMatch(/^\[\[/);
      expect(t(key).length, key).toBeGreaterThan(0);
    }
  });

  it('interpolates the age and passes numbers through as text', () => {
    const t = createClinicSummaryPdfTranslator(makeTestI18n(), 'en');

    expect(t('value.age_years', { age: 30 })).toContain('30');
    expect(t('value.age_years', { age: 30 })).not.toContain('{');
  });

  it('interpolates the disclaimer body', () => {
    const t = createClinicSummaryPdfTranslator(makeTestI18n(), 'en');

    const out = t('disclaimer_line', { disclaimer: 'SENTINEL' });
    expect(out).toContain('SENTINEL');
    expect(out).not.toContain('{');
  });

  it('normalizes a zh-* tag to Chinese', () => {
    // `zh-Hans` and friends used to fall through to English in some paths; the
    // shared `resolveLocale` maps every zh-* tag to zh-CN.
    const t = createClinicSummaryPdfTranslator(makeTestI18n(), 'zh-Hans');

    expect(t('title')).toContain('就诊摘要');
  });

  it('keeps the zh-CN and en pdf subtrees in step', () => {
    const read = (locale: string): Record<string, unknown> =>
      (
        JSON.parse(
          readFileSync(
            path.join('src', 'i18n', locale, 'reports-clinic-summary.json'),
            'utf8',
          ),
        ) as { pdf: Record<string, unknown> }
      ).pdf;

    const flatten = (node: unknown, prefix = ''): string[] => {
      if (node == null || typeof node !== 'object') return [prefix];
      return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
        flatten(v, prefix === '' ? k : `${prefix}.${k}`),
      );
    };

    expect(flatten(read('zh-CN')).sort()).toEqual(flatten(read('en')).sort());
  });
});
