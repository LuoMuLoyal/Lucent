import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createPdfTranslator } from './pdf-copy.js';
import { makeTestI18n } from '../../../common/tests/test-i18n.js';

/**
 * Every key the PDF renderers resolve must exist in both locales.
 *
 * A miss renders `[[data-export.<key>]]` into a user-facing PDF that cannot be
 * re-rendered for review, so this guards the dictionary rather than trusting
 * review to notice.
 */
const KEYS = [
  'title.hospital',
  'title.monthly',
  'title.print',
  'kind.hospital',
  'kind.monthly',
  'kind.print',
  'header.range_and_generated',
  'header.generated_at',
  'footer_note',
  'page_number',
  'section.overview',
  'section.metrics',
  'section.trends',
  'section.findings',
  'section.patterns',
  'overview_body',
  'empty.findings',
  'empty.patterns',
  'subsection.needs_attention',
  'subsection.other_patterns',
  'metric.medication',
  'metric.water',
  'metric.sleep',
  'status.good',
  'status.stable',
  'status.needs_attention',
  'status.insufficient_data',
  'table.day',
  'table.day_n',
  'table.no_value',
  'metadata.subject',
] as const;

describe('data-export PDF copy', () => {
  it.each(['zh-CN', 'en'] as const)('resolves every key in %s', (locale) => {
    const t = createPdfTranslator(makeTestI18n(), locale);

    for (const key of KEYS) {
      // `t` only knows how to report the resolved string; use a distinct
      // argument so a placeholder left unsubstituted is also caught.
      const out = key === 'table.day_n' ? t(key, { n: 1 }) : t(key);
      expect(out, `missing or placeholder key: ${key}`).not.toMatch(/^\[\[/);
      expect(out.length, key).toBeGreaterThan(0);
    }
  });

  it('interpolates the day number rather than leaving the placeholder', () => {
    const t = createPdfTranslator(makeTestI18n(), 'en');

    expect(t('table.day_n', { n: 3 })).toContain('3');
    expect(t('table.day_n', { n: 3 })).not.toContain('{');
  });

  it('keeps the zh-CN and en dictionaries in step', () => {
    const flatten = (node: unknown, prefix = ''): string[] => {
      if (node == null || typeof node !== 'object') return [prefix];
      return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
        flatten(v, prefix === '' ? k : `${prefix}.${k}`),
      );
    };
    const read = (locale: string): string[] =>
      flatten(
        JSON.parse(
          readFileSync(
            path.join('src', 'i18n', locale, 'data-export.json'),
            'utf8',
          ),
        ),
      ).sort();

    expect(read('zh-CN')).toEqual(read('en'));
  });

  it('marks a missing key visibly instead of printing the bare key', () => {
    const t = createPdfTranslator(makeTestI18n(), 'en');

    expect(t('does.not.exist')).toBe('[[data-export.does.not.exist]]');
  });
});
